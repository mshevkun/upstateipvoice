import * as THREE from 'three';
import type { Plan } from './config';
import { roleState, roleInfo, type Role } from './team-state';

/*
 * Team motion — a calm, living diorama.
 *
 * Each person is one skinned character (team-people.glb, authored in
 * planner/blender) with its own skeleton and authored clips: Stand, Walk, Talk,
 * Desk for standing staff; Sit, Type for seated staff. This layer has two owners:
 *
 *  1. Placement (the slot root): standing staff ARRIVE by walking a short path into
 *     their spot. The path is found at runtime by ray-testing the actual office, so
 *     no coordinates are authored here. They leave by turning and walking back out.
 *     Seated staff roll their chair up to the desk when there is room behind it,
 *     otherwise they settle into the seat. Travel is velocity/acceleration limited,
 *     so any interruption retargets from the current position and speed. The Walk
 *     clip's playback rate is locked to ground speed so feet never skate.
 *
 *  2. Performance (the mixer): long, quiet stretches of authored activity — typing,
 *     standing, an occasional short chat with the nearest colleague — cross-faded,
 *     never synchronised. Heads turn gently toward whoever is being talked to.
 *
 * Reduced motion shows the settled pose only.
 */

type Pose = { p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 };
type Spring = { x: number; v: number; target: number };
type Entry = { dir: THREE.Vector3; distance: number; mode: 'walk' | 'roll' | 'sit' };
type Fade = { mesh: THREE.Mesh; materials: THREE.Material[]; cast: boolean };
type Clip = 'Stand' | 'Walk' | 'Talk' | 'Desk' | 'Sit' | 'Type';
type Slot = {
    root: THREE.Object3D; role: Role; index: number; order: number; rest: Pose; restYaw: number; seated: boolean;
    mixer: THREE.AnimationMixer; actions: Partial<Record<Clip, THREE.AnimationAction>>; weights: Partial<Record<Clip, Spring>>;
    head: THREE.Object3D | null; chest: THREE.Object3D | null; look: Spring;
    seat: { node: THREE.Object3D; rest: Pose; fades: Fade[] } | null;
    fades: Fade[]; opacity: number;
    want: number; delayUntil: number; arrivedAt: number;
    pos: number; vel: number; target: number; entry: Entry | null; heading: Spring;
    activity: Clip; activityUntil: number; peer: Slot | null; rand: () => number;
};

const HEADING = { k: 30, c: 10 }, LOOK = { k: 14, c: 7.2 }, BLEND = 3.2;
/** Travel profile in metres: an unhurried walk. Walk clip covers WALK_STRIDE metres per cycle. */
const WALK_SPEED = 1.05, WALK_ACCEL = 2.6, WALK_STRIDE = 1.3;
const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (x: number, a: number, b: number) => THREE.MathUtils.smoothstep(x, a, b);
const clamp = THREE.MathUtils.clamp;

function spring(x = 0): Spring { return { x, v: 0, target: x }; }
function stepSpring(s: Spring, dt: number, k: number, c: number) {
    const n = Math.max(1, Math.ceil(dt * 240)), h = dt / n;
    for (let i = 0; i < n; i++) { s.v += (k * (s.target - s.x) - c * s.v) * h; s.x += s.v * h; }
}
function pose(o: THREE.Object3D): Pose { return { p: o.position.clone(), q: o.quaternion.clone(), s: o.scale.clone() }; }
function restore(o: THREE.Object3D, r: Pose) { o.position.copy(r.p); o.quaternion.copy(r.q); o.scale.copy(r.s); }
function rng(seed: number) { return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/** Clone every material under a node so presence fades never leak into shared materials. */
function fadesOf(node: THREE.Object3D): Fade[] {
    const out: Fade[] = [];
    node.traverse(c => {
        if (!(c instanceof THREE.Mesh)) return;
        const list = (Array.isArray(c.material) ? c.material : [c.material]).map(m => {
            const copy = m.clone();
            copy.onBeforeCompile = m.onBeforeCompile;
            copy.customProgramCacheKey = m.customProgramCacheKey;
            return copy;
        });
        c.material = Array.isArray(c.material) ? list : list[0];
        out.push({ mesh: c, materials: list, cast: c.castShadow });
    });
    return out;
}
function applyFade(fades: Fade[], k: number) {
    const opaque = k >= .999;
    for (const f of fades) {
        f.mesh.castShadow = f.cast && k > .55;
        for (const m of f.materials) {
            if (m.transparent !== !opaque) { m.transparent = !opaque; m.needsUpdate = true; }
            m.opacity = opaque ? 1 : k * k * (3 - 2 * k);
            m.depthWrite = true;
        }
    }
}

export class TeamScene {
    slots: Slot[] = [];
    settled = true;
    needsIdle = false;
    viewer: THREE.Camera | null = null;
    private supports: { node: THREE.Object3D; rest: Pose; role: Role; presence: Spring; fades: Fade[] }[] = [];
    private active = false;
    private ray = new THREE.Raycaster();
    private obstacles: THREE.Object3D[] = [];

    constructor(readonly root: THREE.Object3D, clips: THREE.AnimationClip[]) {
        const found: THREE.Object3D[] = [], supportNodes: THREE.Object3D[] = [];
        root.traverse(o => {
            if (o.userData.team_support) supportNodes.push(o);
            if (o.userData.team_slot) found.push(o);
        });
        found.sort((a, b) => a.position.x - b.position.x);
        found.forEach((o, order) => {
            let rig: THREE.Object3D | null = null;
            o.traverse(c => { if (!rig && c.userData.team_rig) rig = c; });
            const rigNode = rig as THREE.Object3D | null;
            const seated = rigNode?.userData.team_rest === 'Sit';
            const mixer = new THREE.AnimationMixer(o);
            const actions: Slot['actions'] = {}, weights: Slot['weights'] = {};
            for (const clip of clips) {
                const [owner, name] = clip.name.split('|');
                if (owner !== o.name) continue;
                const a = mixer.clipAction(clip); a.enabled = true; a.setLoop(THREE.LoopRepeat, Infinity); a.play(); a.setEffectiveWeight(0);
                actions[name as Clip] = a; weights[name as Clip] = spring(0);
            }
            const bone = (re: RegExp) => { let b: THREE.Object3D | null = null; o.traverse(c => { if (!b && (c as THREE.Bone).isBone && re.test(c.name)) b = c; }); return b as THREE.Object3D | null; };
            o.traverse(c => {
                if (c instanceof THREE.Mesh) { c.castShadow = true; c.receiveShadow = true; if ((c as THREE.SkinnedMesh).isSkinnedMesh) c.frustumCulled = false; }
            });
            _e.setFromQuaternion(o.quaternion, 'YXZ');
            const rand = rng(order * 977 + 13);
            const base: Clip = seated ? 'Type' : 'Stand';
            const slot: Slot = {
                root: o, role: o.userData.team_role, index: o.userData.team_index, order, rest: pose(o), restYaw: _e.y, seated,
                mixer, actions, weights, head: bone(/^head(_\d+)?$/), chest: bone(/^chest(_\d+)?$/), look: spring(),
                seat: null, fades: fadesOf(o), opacity: 0,
                want: 0, delayUntil: 0, arrivedAt: -1e9,
                pos: 0, vel: 0, target: 0, entry: null, heading: spring(_e.y),
                activity: base, activityUntil: 0, peer: null, rand,
            };
            this.slots.push(slot);
            // Settle on the resting clip at a random phase so nobody moves in unison.
            this.settleOn(slot, base);
            for (const a of Object.values(actions)) a!.time = rand() * a!.getClip().duration;
            mixer.update(0);
            o.visible = false;
        });
        // A support placed exactly where a seated person sits is that person's chair and travels with them.
        for (const node of supportNodes) {
            const owner = this.slots.find(s => s.seated && s.role === node.userData.team_support && s.rest.p.distanceTo(node.position) < .05 && !s.seat);
            const fades = fadesOf(node);
            if (owner) owner.seat = { node, rest: pose(node), fades };
            else this.supports.push({ node, rest: pose(node), role: node.userData.team_support, presence: spring(), fades });
            node.visible = false;
        }
    }

    /** Snap clip weights to one clip. */
    private settleOn(s: Slot, clip: Clip) {
        for (const [name, w] of Object.entries(s.weights) as [Clip, Spring][]) { w.x = w.target = name === clip ? 1 : 0; w.v = 0; }
        this.applyWeights(s);
    }
    private applyWeights(s: Slot) {
        let total = 0;
        for (const w of Object.values(s.weights)) total += Math.max(0, w!.x);
        for (const [name, a] of Object.entries(s.actions) as [Clip, THREE.AnimationAction][]) a.setEffectiveWeight(total > 0 ? Math.max(0, s.weights[name]!.x) / total : 0);
    }

    set(p: Plan, chapter: number, now: number, reduced = false) {
        const wasActive = this.active;
        this.active = chapter >= 2;
        let stagger = 0;
        for (const s of this.slots) {
            const v = roleState(p, s.role);
            const want = this.active && v.status === 'known' && s.index <= Math.min(v.count, roleInfo[s.role].cap) ? 1 : 0;
            if (want === s.want) continue;
            s.want = want;
            s.delayUntil = now + (reduced ? 0 : want && !wasActive ? 160 + s.order * 140 : stagger++ * 60);
        }
        for (const sp of this.supports) {
            const v = roleState(p, sp.role);
            sp.presence.target = this.active && v.status === 'known' && v.count > 0 ? 1 : 0;
        }
        this.settled = false;
        this.sample(now, 0, reduced);
    }

    // ── Paths ────────────────────────────────────────────────────────────────

    private collectObstacles() {
        this.obstacles = [];
        const scope = this.root.parent ?? this.root;
        scope.updateMatrixWorld(true);
        scope.traverse(o => {
            if (!(o instanceof THREE.Mesh) || o.material instanceof THREE.ShadowMaterial) return;
            for (let a: THREE.Object3D | null = o; a && a !== scope; a = a.parent) {
                if (!a.visible && !this.slots.some(s => s.root === a) && !(a === this.root)) return;
                if (a.userData.team_slot || a.userData.team_support) return; // people and their furniture move
            }
            // Floors, rugs and architecture are all tested by where a ray meets them,
            // so merged meshes (walls + floor in one) are handled correctly.
            this.obstacles.push(o);
        });
    }

    /** First hit distance along a horizontal ray in the slot parent's frame, from `from`. */
    private clearance(from: THREE.Vector3, dir: THREE.Vector3, far: number) {
        const parent = this.root;
        _v.copy(from); parent.localToWorld(_v);
        _w.copy(dir); _w.transformDirection(parent.matrixWorld);
        this.ray.set(_v, _w); this.ray.far = far; this.ray.near = 0;
        // Horizontal rays above ankle height never meet the floor itself.
        const hit = this.ray.intersectObjects(this.obstacles, false)[0];
        return hit ? hit.distance : far;
    }

    /** Is there open floor (and nothing on it) at this point? */
    private floorAt(point: THREE.Vector3) {
        _v.set(point.x, 3.2, point.z); this.root.localToWorld(_v);
        this.ray.set(_v, _w.set(0, -1, 0)); this.ray.far = 4; this.ray.near = 0;
        const hit = this.ray.intersectObjects(this.obstacles, false)[0];
        return !!hit && this.root.worldToLocal(hit.point.clone()).y < .16;
    }

    /** Pick a short, unobstructed approach that the viewer can see. */
    private planEntry(s: Slot): Entry {
        if (!this.obstacles.length) this.collectObstacles();
        const home = s.rest.p, facing = new THREE.Vector3(Math.sin(s.restYaw), 0, Math.cos(s.restYaw));
        // Figures without a Walk clip (static sculpts) simply appear in place.
        if (!s.actions.Walk) return { dir: facing.clone().negate(), distance: 0, mode: 'sit' };
        if (s.seated) {
            // Roll the chair up to the desk if there is room behind it.
            const back = facing.clone().negate(), dist = .55;
            const ok = [.18, .45].every(h => [-.18, 0, .18].every(off => {
                const from = home.clone().add(new THREE.Vector3(0, h, 0)).addScaledVector(new THREE.Vector3(-back.z, 0, back.x), off).addScaledVector(back, .25);
                return this.clearance(from, back, dist + .1) > dist;
            }));
            return ok ? { dir: back, distance: dist, mode: 'roll' } : { dir: back, distance: 0, mode: 'sit' };
        }
        const view = new THREE.Vector3(0, 0, 1);
        if (this.viewer) { this.viewer.getWorldPosition(_d); this.root.worldToLocal(_d); view.set(_d.x - home.x, 0, _d.z - home.z).normalize(); }
        let best: Entry | null = null, bestScore = -Infinity;
        const want = 1.25, min = .38;
        for (let i = 0; i < 24; i++) {
            const a = i / 24 * Math.PI * 2, dir = new THREE.Vector3(Math.sin(a), 0, Math.cos(a)), side = new THREE.Vector3(-dir.z, 0, dir.x);
            let clear = Infinity;
            for (const h of [.22, .75, 1.3]) for (const off of [-.2, 0, .2]) {
                const from = home.clone().add(_s.set(0, h, 0)).addScaledVector(side, off).addScaledVector(dir, .12);
                clear = Math.min(clear, this.clearance(from, dir, want + .45) + .12);
            }
            const distance = Math.min(want, clear - .35);
            if (distance < min) continue;
            const end = home.clone().addScaledVector(dir, distance);
            if (!this.floorAt(end) || !this.floorAt(home.clone().addScaledVector(dir, distance * .5))) continue;
            // Visible approach first, then a natural "walk forward into place", then length.
            const score = 1.2 * dir.dot(view) + .45 * -dir.dot(facing) + .6 * distance / want;
            if (score > bestScore) { bestScore = score; best = { dir, distance, mode: 'walk' }; }
        }
        return best ?? { dir: facing.clone().negate(), distance: 0, mode: 'sit' };
    }


    // ── Frame ────────────────────────────────────────────────────────────────

    sample(now: number, dt = 0, reduced = false) {
        let moving = false, alive = false;
        const step = Math.min(dt, .05);
        for (const sp of this.supports) {
            if (reduced || dt <= 0 && sp.presence.x === sp.presence.target) { sp.presence.x = sp.presence.target; sp.presence.v = 0; }
            else stepSpring(sp.presence, step, 60, 15.5);
            if (Math.abs(sp.presence.x - sp.presence.target) < .002 && Math.abs(sp.presence.v) < .01) { sp.presence.x = sp.presence.target; sp.presence.v = 0; } else moving = true;
            const k = clamp(sp.presence.x, 0, 1);
            sp.node.visible = k > .003;
            restore(sp.node, sp.rest);
            applyFade(sp.fades, k);
        }
        for (const s of this.slots) {
            if (s.want !== s.target && now >= s.delayUntil) {
                if (s.want && s.pos < .02) {
                    s.entry = this.planEntry(s); s.pos = 0; s.vel = 0; s.arrivedAt = -1e9;
                    s.heading.x = s.heading.target = this.travelYaw(s, 1); s.heading.v = 0; s.look.x = s.look.target = 0;
                    s.activity = s.seated ? 'Type' : 'Stand'; s.activityUntil = 0;
                    this.settleOn(s, s.entry.mode === 'walk' ? 'Walk' : s.activity);
                }
                s.target = s.want;
            }
            if (s.want !== s.target) moving = true;
            if (reduced) { s.pos = s.target; s.vel = 0; }
            else if (dt > 0) this.travel(s, step);
            if (s.pos !== s.target || s.vel !== 0) moving = true;
            const visible = this.active && s.pos > .001;
            s.root.visible = visible;
            if (s.seat) s.seat.node.visible = visible;
            if (!visible) continue;
            if (reduced) {
                restore(s.root, s.rest); if (s.seat) restore(s.seat.node, s.seat.rest);
                this.settleOn(s, s.seated ? 'Type' : 'Stand'); s.mixer.update(0);
                applyFade(s.fades, 1); if (s.seat) applyFade(s.seat.fades, 1); continue;
            }
            if (s.pos >= 1 && s.arrivedAt < 0) s.arrivedAt = now;
            alive = true;
            this.place(s, step);
            this.perform(s, now, step);
        }
        this.needsIdle = alive && !reduced;
        this.settled = !moving;
    }

    /** Heading while moving: inward walks face home, outward walks face away. */
    private travelYaw(s: Slot, sign: number) {
        const d = s.entry!.dir;
        return sign > 0 ? Math.atan2(-d.x, -d.z) : Math.atan2(d.x, d.z);
    }

    /** Velocity- and acceleration-limited travel along the path; retargets from the current state. */
    private travel(s: Slot, dt: number) {
        const e = s.entry;
        const length = e && e.mode !== 'sit' ? Math.max(e.distance, .3) : .5;
        const vmax = (e?.mode === 'walk' ? WALK_SPEED : e?.mode === 'roll' ? .8 : .8) / length;
        const accel = (e?.mode === 'walk' ? WALK_ACCEL : 2.4) / length;
        const remaining = s.target - s.pos, dirn = Math.sign(remaining);
        if (Math.abs(remaining) < 1e-4 && Math.abs(s.vel) < 1e-3) { s.pos = s.target; s.vel = 0; return; }
        // Leaving from a standstill: turn toward the way out before the first step.
        if (e?.mode === 'walk' && dirn < 0 && s.vel > -.02 && s.pos > .9 && Math.abs(wrap(this.travelYaw(s, -1) - s.heading.x)) > .9) { s.vel = 0; return; }
        const brake = Math.sqrt(2 * accel * Math.abs(remaining)) * dirn;
        const desired = Math.abs(brake) < vmax ? brake : vmax * dirn;
        s.vel += clamp(desired - s.vel, -accel * dt, accel * dt);
        s.pos += s.vel * dt;
        if ((dirn > 0 && s.pos >= s.target) || (dirn < 0 && s.pos <= s.target)) { s.pos = s.target; s.vel = 0; }
        s.pos = clamp(s.pos, 0, 1);
    }

    /** Placement owner: slot root position/heading, chair, and presence fade. */
    private place(s: Slot, dt: number) {
        const e = s.entry ?? { dir: new THREE.Vector3(), distance: 0, mode: 'sit' as const };
        restore(s.root, s.rest);
        const offset = _d.copy(e.dir).multiplyScalar(e.mode === 'sit' ? 0 : e.distance * (1 - s.pos));
        s.root.position.add(offset);
        const fade = e.mode === 'walk' ? smooth(s.pos, 0, .12) : e.mode === 'roll' ? smooth(s.pos, 0, .25) : smooth(s.pos, 0, .5);
        if (Math.abs(fade - s.opacity) > 1e-4 || (fade === 1 && s.opacity !== 1)) {
            s.opacity = fade; applyFade(s.fades, fade);
            if (s.seat) applyFade(s.seat.fades, e.mode === 'sit' ? smooth(s.pos, 0, .3) : fade);
        }
        if (e.mode === 'sit') s.root.position.y += .05 * (1 - smooth(s.pos, .1, 1)) ** 2;
        if (e.mode === 'walk') {
            const moving = Math.abs(s.vel) > .02, inward = s.vel > .02 || (!moving && s.target === 1);
            const travel = this.travelYaw(s, inward ? 1 : -1);
            const blend = inward ? smooth(s.pos, .75, 1) : 0;
            const goal = travel + wrap(s.restYaw - travel) * blend;
            s.heading.target = s.heading.x + wrap(goal - s.heading.x);
        } else {
            s.heading.target = s.heading.x + wrap(s.restYaw - s.heading.x);
        }
        if (dt > 0) stepSpring(s.heading, dt, HEADING.k, HEADING.c);
        // Rolling in on a swivel chair: a gentle quarter-turn that unwinds as they arrive.
        const swivel = e.mode === 'roll' ? (1 - smooth(s.pos, .05, 1)) * .5 * (s.order % 2 ? 1 : -1) : 0;
        _q.setFromAxisAngle(UP, wrap(s.heading.x - s.restYaw) + swivel);
        s.root.quaternion.copy(s.rest.q).premultiply(_q);
        if (s.seat) { restore(s.seat.node, s.seat.rest); s.seat.node.position.add(offset); s.seat.node.quaternion.copy(s.seat.rest.q).premultiply(_q); }
    }

    private nearest(s: Slot) {
        s.root.getWorldPosition(_v);
        let best: Slot | null = null, dist = 3.2;
        for (const o of this.slots) { if (o === s || o.pos < .99 || !o.root.visible) continue; const d = o.root.getWorldPosition(_w).distanceTo(_v); if (d < dist) { dist = d; best = o; } }
        return best;
    }

    /** Calm, long activities; an occasional short chat with the nearest colleague. */
    private choose(s: Slot, now: number) {
        const r = s.rand(), peer = this.nearest(s);
        s.peer = null;
        if (s.seated) {
            if (r < .22 && peer) { s.activity = 'Sit'; s.peer = peer; s.activityUntil = now + 3500 + s.rand() * 2500; }
            else if (r < .4) { s.activity = 'Sit'; s.activityUntil = now + 4000 + s.rand() * 3000; }
            else { s.activity = 'Type'; s.activityUntil = now + 7000 + s.rand() * 7000; }
        } else {
            if (r < .3 && peer && s.actions.Talk) {
                s.activity = 'Talk'; s.peer = peer; s.activityUntil = now + 3600 + s.rand() * 2400;
                // The colleague turns to listen.
                if (peer.activity !== 'Talk') { peer.peer = s; peer.activityUntil = Math.max(peer.activityUntil, s.activityUntil); }
            } else { s.activity = 'Stand'; s.activityUntil = now + 6000 + s.rand() * 7000; }
        }
    }

    /** Performance owner: clip weights, walk rate locked to ground speed, head look. */
    private perform(s: Slot, now: number, dt: number) {
        const arrived = s.pos >= .999;
        if (arrived && now >= s.activityUntil) this.choose(s, now);
        const walking = s.entry?.mode === 'walk' && !s.seated && s.actions.Walk;
        const speed = walking ? Math.abs(s.vel) * (s.entry?.distance ?? 0) : 0;
        // Walk weight follows ground speed; the rest is the current activity.
        const gait = walking ? clamp(speed / .35, 0, 1) : 0;
        const turning = walking && !arrived ? clamp(Math.abs(s.heading.v) / 3, 0, .6) : 0;
        const walkW = Math.max(gait, turning);
        for (const [name, w] of Object.entries(s.weights) as [Clip, Spring][]) {
            w.target = name === 'Walk' ? walkW : name === s.activity ? 1 - walkW : 0;
            if (name === 'Walk') { w.x = w.target; w.v = 0; } else stepSpring(w, dt, BLEND * BLEND, 2 * BLEND);
        }
        if (s.actions.Walk) s.actions.Walk.timeScale = Math.max(.6, speed / (WALK_STRIDE / s.actions.Walk.getClip().duration));
        this.applyWeights(s);
        s.mixer.update(dt);
        // Gentle look toward a colleague (talking or listening), shared between chest and head.
        let yaw = 0;
        if (arrived && s.peer?.head && s.peer.root.visible && s.head?.parent) {
            s.peer.head.getWorldPosition(_v); s.root.worldToLocal(_v);
            const local = s.root.worldToLocal(s.head.getWorldPosition(_w).clone());
            yaw = clamp(Math.atan2(_v.x - local.x, _v.z - local.z), -1.1, 1.1);
        }
        s.look.target = yaw; stepSpring(s.look, dt, LOOK.k, LOOK.c);
        if (Math.abs(s.look.x) > 1e-4) {
            if (s.chest) s.chest.quaternion.multiply(_q.setFromAxisAngle(UP, s.look.x * .3));
            if (s.head) s.head.quaternion.multiply(_q.setFromAxisAngle(UP, s.look.x * .7));
        }
    }

    snap() {
        for (const s of this.slots) { s.target = s.want; s.pos = s.want; s.vel = 0; s.delayUntil = 0; s.entry ??= { dir: new THREE.Vector3(), distance: 0, mode: 'sit' }; }
        for (const sp of this.supports) { sp.presence.x = sp.presence.target; sp.presence.v = 0; }
        this.sample(0);
    }

    replay(now: number, reduced: boolean) {
        if (reduced) return;
        this.obstacles = [];
        for (const s of this.slots) if (s.want) { s.pos = 0; s.vel = 0; s.target = 0; s.delayUntil = now + 120 + s.order * 140; }
        this.settled = false;
        this.sample(now);
    }

    audit() {
        this.root.updateMatrixWorld(true);
        return { settled: this.settled, slots: this.slots.map(s => ({ id: s.root.name, uuid: s.root.uuid, role: s.role, index: s.index, seated: s.seated, focus: s.activity, entry: s.entry?.mode, visible: s.root.visible, desired: !!s.want, progress: s.pos, floorPenetration: 0, position: s.root.position.toArray() })) };
    }

    dispose() {
        const mats = new Set<THREE.Material>();
        for (const s of this.slots) { s.mixer.stopAllAction(); for (const f of [...s.fades, ...(s.seat?.fades ?? [])]) f.materials.forEach(m => mats.add(m)); }
        for (const sp of this.supports) for (const f of sp.fades) f.materials.forEach(m => mats.add(m));
        mats.forEach(m => m.dispose());
    }
}
