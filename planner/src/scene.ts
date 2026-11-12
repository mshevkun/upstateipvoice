import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { softenShadows } from './soft-shadows';
import type { SceneMode } from './state';
import type { Plan } from './config';
import type {TeamScene} from './team-scene';
import { ClinicalBay } from './clinical-bay';
type Motor = {
    value: number;
    velocity: number;
    target: number;
};
type Part = {
    object: THREE.Object3D;
    base: THREE.Vector3;
    meshes: THREE.Mesh[];
    materials: THREE.MeshStandardMaterial[];
    motor: Motor;
    phase: number;
    wall: boolean;
    bottom: number;
    top: number;
    clip: THREE.Plane;
};
type Support = {
    object: THREE.Object3D;
    local: THREE.Matrix4;
    parent: THREE.Object3D;
};
const motor = (value: number): Motor => ({ value, velocity: 0, target: value });
/** Critically damped scalar. Position AND velocity survive every new intent. */
function advance(m: Motor, dt: number, omega = 14) {
    const x = m.value - m.target, e = Math.exp(-omega * dt), v = m.velocity;
    const next = m.target + (x + (v + omega * x) * dt) * e;
    m.velocity = (v - omega * (v + omega * x) * dt) * e;
    m.value = THREE.MathUtils.clamp(next, 0, 1);
    if (m.value !== next)
        m.velocity = 0;
    if (Math.abs(m.value - m.target) < .0005 && Math.abs(m.velocity) < .006) {
        m.value = m.target;
        m.velocity = 0;
    }
}
interface Diagnostics {
    mode: SceneMode;
    settled: boolean;
    generation: number;
    frames: number;
    drawCalls: number;
    triangles: number;
    frameMs: number[];
    renderer: string;
    reducedMotion: boolean;
    primaryX: number;
    secondaryVisible: boolean;
    partsAtRest: boolean;
    highlight: number;
    connection: number;
    elapsed: number;
    floorPenetration: number;
    supportError: number;
    clipping: number;
    floorY: number;
    objectIds: string;
    maxFloorPenetration: number;
    maxSupportError: number;
    maxClipping: number;
    loadMs: number;
    team?:ReturnType<TeamScene['audit']>;
    clinical: ReturnType<ClinicalBay['audit']>[];
}
declare global {
    interface Window {
        __plannerScene?: Diagnostics;
    }
}
export class PracticeScene {
    private scene = new THREE.Scene();
    private camera = new THREE.OrthographicCamera(-5, 5, 4, -4, .1, 60);
    private renderer: THREE.WebGLRenderer;
    private composer: EffectComposer;
    private ao: SSAOPass;
    private output: OutputPass;
    private primary = new THREE.Group();
    private secondary = new THREE.Group();
    private parts: Part[][] = [[], []];
    private supports: Support[] = [];
    private expansion = motor(0);
    private second = motor(0);
    private emphasis = motor(0);
    private linkAmount = motor(0);
    private mode: SceneMode = 'welcome';
    private ready = false;
    private bays: ClinicalBay[] = [];
    private teamScene:TeamScene|null=null;
    private config: Plan | null = null;
    private chapter = -1;
    private mixers: THREE.AnimationMixer[] = [];
    private gestureUntil = 0;
    private activity = false;
    private actorActions: THREE.AnimationAction[] = [];
    private observer: IntersectionObserver;
    private inView = true;
    private failed = false;
    private dead = false;
    private frame = 0;
    private frames = 0;
    private start = 0;
    private last = 0;
    private generation = 0;
    private assembly = false;
    private frameTimes: number[] = [];
    private outline!: THREE.LineSegments;
    private rings: THREE.Mesh[] = [];
    private link!: THREE.Line;
    private media = matchMedia('(prefers-reduced-motion: reduce)');
    private resizeObserver: ResizeObserver;
    private pmrem: THREE.WebGLRenderTarget;
    private sourceMaterials = new Set<THREE.Material>();
    private textures = new Set<THREE.Texture>();
    private loadStart = performance.now();
    private loadMs = 0;
    private maxFloor = 0;
    private maxSupport = 0;
    private maxClip = 0;
    private restBox = new THREE.Box3();
    constructor(private mount: HTMLElement, onReady: () => void, private onFailure: () => void) {
        this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
        this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
        this.renderer.setClearColor(0xebe8e4, 0);
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1;
        this.renderer.shadowMap.enabled = true;
        this.renderer.localClippingEnabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.info.autoReset = false;
        this.renderer.domElement.setAttribute('aria-hidden', 'true');
        mount.append(this.renderer.domElement);
        if (import.meta.env.DEV)
            (window as unknown as {
                __plannerController: PracticeScene;
            }).__plannerController = this;
        this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
        const env = new RoomEnvironment(), pm = new THREE.PMREMGenerator(this.renderer);
        this.pmrem = pm.fromScene(env, .04);
        this.scene.environment = this.pmrem.texture;
        this.scene.environmentIntensity = .23;
        env.dispose();
        pm.dispose();
        this.scene.add(new THREE.HemisphereLight(0xf8f3e8, 0x8b8275, .42));
        const key = new THREE.DirectionalLight(0xfff1dd, 2.8);
        key.position.set(-3, 12, 4);
        key.castShadow = true;
        key.shadow.mapSize.set(2048, 2048);
        Object.assign(key.shadow.camera, { left: -12, right: 12, top: 8, bottom: -8, near: 1, far: 35 });
        key.shadow.normalBias = .012;
        key.shadow.bias = -.0001;
        key.shadow.radius = 5;
        this.scene.add(key);
        const fill = new THREE.DirectionalLight(0xdfe9fc, .35);
        fill.position.set(6, 5, -3);
        this.scene.add(fill);
        const ground = new THREE.Mesh(new THREE.PlaneGeometry(100, 100), new THREE.ShadowMaterial({ opacity: .07 }));
        ground.rotation.x = -Math.PI / 2;
        ground.position.y = -.235;
        ground.receiveShadow = true;
        this.scene.add(ground);
        this.scene.add(this.primary, this.secondary);
        this.secondary.visible = false;
        this.secondary.position.set(3.85, 0, -.9);
        this.overlays();
        this.composer = new EffectComposer(this.renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }));
        this.composer.addPass(new RenderPass(this.scene, this.camera));
        this.ao = new SSAOPass(this.scene, this.camera, 512, 512, 16);
        this.ao.kernelRadius = .24;
        this.ao.minDistance = .00008;
        this.ao.maxDistance = .009;
        this.ao.ssaoMaterial.defines.PERSPECTIVE_CAMERA = 0;
        this.composer.addPass(this.ao);
        this.output = new OutputPass();
        this.composer.addPass(this.output);
        this.resizeObserver = new ResizeObserver(() => { this.resize(); this.invalidate(); });
        this.resizeObserver.observe(mount);
        this.observer = new IntersectionObserver(entries => { this.inView = entries[0].isIntersecting; if (this.inView) {
            this.last = 0;
            this.invalidate();
        }
        else {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        } });
        this.observer.observe(mount);
        this.media.addEventListener('change', this.motionChange);
        document.addEventListener('visibilitychange', this.visibilityChange);
        this.resize();
        Promise.all([new GLTFLoader().loadAsync('/assets/practice-module.glb'), new GLTFLoader().loadAsync('/assets/clinical-bay.glb')]).then(([gltf, clinical]) => {
            if (this.dead)
                return;
            gltf.scene.traverse(o => {
                if (o instanceof THREE.Mesh) {
                    const ms = Array.isArray(o.material) ? o.material : [o.material];
                    o.castShadow = true;
                    o.receiveShadow = true;
                    ms.forEach(m => {
                        this.sourceMaterials.add(m);
                        Object.values(m).forEach(v => {
                            if (v instanceof THREE.Texture)
                                this.textures.add(v);
                        });
                    });
                }
            });
            [this.primary, this.secondary].forEach((wrapper, index) => {
                const model = gltf.scene.clone(true);
                wrapper.add(model);
                const mixer = new THREE.AnimationMixer(model);
                for (const clip of gltf.animations) {
                    const action = mixer.clipAction(clip);
                    action.setLoop(THREE.LoopOnce, 1);
                    action.clampWhenFinished = true;
                    action.play();
                    this.actorActions.push(action);
                }
                this.mixers.push(mixer);
                for (const x of [-2.55, -1.65, -.75]) {
                    const lamp = new THREE.PointLight(0xffd29a, .65, 2.5, 2);
                    lamp.position.set(x, 2.52, -1.51);
                    wrapper.add(lamp);
                }
                model.updateMatrixWorld(true);
                model.traverse(o => {
                    // Only assembly roots own transforms. Supported child groups remain addressable but never get a second motor.
                    if (o.userData.assembly_phase !== undefined && !o.userData.supported_by) {
                        const p: Part = { object: o, base: o.position.clone(), meshes: [], materials: [], motor: motor(1), phase: o.userData.assembly_phase, wall: !!o.userData.wall_anchor, bottom: 0, top: 3, clip: new THREE.Plane(new THREE.Vector3(0, -1, 0), 4) };
                        o.traverse(child => {
                            if (child instanceof THREE.Mesh) {
                                p.meshes.push(child);
                                child.castShadow = true;
                                child.receiveShadow = true;
                                const ms = (Array.isArray(child.material) ? child.material : [child.material]).map(m => {
                                    const c = m.clone() as THREE.MeshStandardMaterial;
                                    c.side = THREE.FrontSide;
                                    c.transparent = false;
                                    c.alphaToCoverage = false;
                                    c.alphaHash = false;
                                    c.envMapIntensity = .5;
                                    softenShadows(c);
                                    c.clippingPlanes = [];
                                    c.clipShadows = true;
                                    ;
                                    p.materials.push(c);
                                    return c;
                                });
                                child.material = Array.isArray(child.material) ? ms : ms[0];
                            }
                        });
                        const bounds = new THREE.Box3().setFromObject(o, true);
                        p.bottom = bounds.min.y;
                        p.top = bounds.max.y;
                        this.parts[index].push(p);
                    }
                    if (o.userData.supported_by && o.parent)
                        this.supports.push({ object: o, local: o.matrix.clone(), parent: o.parent });
                });
            });
            this.restBox.setFromObject(this.primary, true);
            clinical.scene.traverse(o => {
                if (!(o instanceof THREE.Mesh)) return;
                o.castShadow = true; o.receiveShadow = true;
                const ms = Array.isArray(o.material) ? o.material : [o.material];
                ms.forEach(m => { this.sourceMaterials.add(m); Object.values(m).forEach(v => { if(v instanceof THREE.Texture)this.textures.add(v); }); if(m instanceof THREE.MeshStandardMaterial){m.envMapIntensity=.5;softenShadows(m);} });
            });
            for(const wrapper of [this.primary,this.secondary]){
                const model=clinical.scene.clone(true);wrapper.add(model);
                const bay=new ClinicalBay(model);this.bays.push(bay);
                bay.select(this.config?.specialty || '',performance.now(),true);
            }
            this.configureObjects();
            this.loadMs = performance.now() - this.loadStart;
            this.ready = true;
            this.setMode(this.mode, true);
            if (this.mode === 'welcome')
                this.snap();
            onReady();
        }).catch(() => { this.failed = true; this.onFailure(); });
    }
    private overlays() {
        const v: THREE.Vector3[] = [];
        const edge = (a: number[], b: number[]) => v.push(new THREE.Vector3(...a), new THREE.Vector3(...b));
        for (const z of [-2.5, 2.5])
            edge([-3.4, .07, z], [3.4, .07, z]);
        for (const x of [-3.4, 3.4])
            edge([x, .07, -2.5], [x, .07, 2.5]);
        edge([-3.4, .07, -2.5], [-3.4, 2.9, -2.5]);
        edge([-3.4, 2.9, -2.5], [3.4, 2.9, -2.5]);
        edge([3.4, .07, -2.5], [3.4, 2.9, -2.5]);
        this.outline = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(v), new THREE.LineBasicMaterial({ color: 0x81968b, transparent: true, opacity: 0 }));
        this.primary.add(this.outline);
        for (const [x, y, z] of [[-1.12, 1.30, -.58], [2.15, .96, -1.80]]) {
            const r = new THREE.Mesh(new THREE.RingGeometry(.24, .265, 48), new THREE.MeshBasicMaterial({ color: 0x426e69, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
            r.position.set(x, y, z);
            r.rotation.x = -Math.PI / 2;
            this.primary.add(r);
            this.rings.push(r);
        }
        const curve = new THREE.CubicBezierCurve3(new THREE.Vector3(.02, .08, 1.1), new THREE.Vector3(1.3, .08, 1.7), new THREE.Vector3(3.5, .08, 1.0), new THREE.Vector3(3.6, .08, -.12));
        this.link = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(80)), new THREE.LineDashedMaterial({ color: 0x426e69, dashSize: .11, gapSize: .09, transparent: true, opacity: 0 }));
        this.link.computeLineDistances();
        this.scene.add(this.link);
    }
    setMode(mode: SceneMode, force = false, replay = false) {
        if (this.dead || this.failed)
            return;
        if (mode === this.mode && !force && this.ready)
            return;
        this.mode = mode;
        if (!this.ready)
            return;
        this.start = performance.now();
        this.last = 0;
        this.generation++;
        this.frameTimes = [];
        this.maxFloor = 0;
        this.maxSupport = 0;
        this.maxClip = 0;
        this.assembly = mode === 'opening' || (replay && mode === 'welcome');
        if (this.assembly)
            this.parts[0].forEach(p => {
                if (p.object.name === 'Floor')
                    return;
                p.motor.value = 0;
                p.motor.velocity = 0;
                p.motor.target = 0;
            });
        // Replay improving is a small pulse; adding always spreads then reveals the second office.
        if (replay && mode === 'improving')
            this.emphasis.target = 0;
        if (mode === 'adding') {
            this.expansion.value = this.expansion.target = 0;
            this.expansion.velocity = 0;
            this.second.value = this.second.target = 0;
            this.second.velocity = 0;
            this.linkAmount.value = this.linkAmount.target = 0;
            this.linkAmount.velocity = 0;
        }
        this.replaying = replay;
        if (this.media.matches)
            this.snap();
        else
            this.invalidate();
    }
    private replaying = false;
    setConfiguration(config: Plan, chapter: number) {
        const changed = JSON.stringify(this.config?.teams) !== JSON.stringify(config.teams) || this.chapter !== chapter;
        this.config = config;
        this.chapter = chapter;
        this.configureObjects();
        const now=performance.now();
        for(const bay of this.bays)bay.select(config.specialty,now,this.media.matches || chapter < 1);
        this.teamScene?.set(config,chapter,now,this.media.matches);
        this.last = 0;
        this.invalidate();
    }
    setActivity(label: string) { this.activity = label.startsWith('Ring '); this.invalidate(); }
    private configureObjects() {
        for(const bay of this.bays)bay.root.visible=this.chapter >= 1;
        for (const wrapper of [this.primary, this.secondary])
            wrapper.traverse(o => {
                if (o.userData.character) {
                    o.visible = false; // Replaced by stable seven-slot asset.
                }
                if (o.userData.specialty)
                    o.visible = false; // Superseded old insert; reception is never replaced by specialty.
                if (o.name === 'Character_Administration') {
                    o.userData.restX ??= o.position.x;
                    o.position.x = o.userData.restX;
                }
                if (o.userData.workspace_role)
                    o.visible = false; // Clinical work now lives in the separate illustrative bay.
                if (o.userData.role === 'communication_touchpoint') {
                    const e = this.config?.endpoints;
                    const role = o.userData.endpoint_role || 'reception';
                    const type = o.userData.device_type || (o.name.includes('Monitor') ? 'computer' : 'desk');
                    const selected = this.config?.policy.placements.filter(a => a.device === type && this.config?.teams.find(t => t.id === a.team)?.role === role).reduce((n, a) => n + a.count, 0) || 0;
                    o.visible = this.chapter < 3 ? (o.userData.endpoint_index || 1) === 1 : !e || e.undecided ? false : selected >= (o.userData.endpoint_index || 1);
                }
            });
    }
    private updateGoals(t: number) {
        const adding = this.mode === 'adding';
        this.second.target = adding && this.expansion.value > .98 && (!this.replaying || t > 180) ? 1 : 0;
        this.expansion.target = adding || this.second.value > .002 ? 1 : 0;
        this.emphasis.target = (this.mode === 'improving' || this.activity) && (!this.replaying || t > 100) ? 1 : 0;
        this.linkAmount.target = adding && this.second.value > .6 ? 1 : 0;
        for (const p of this.parts[0]) {
            const release = p.wall ? 500 + p.phase * 22 : 720 + p.phase * 42;
            p.motor.target = p.object.name === 'Floor' ? 1 : this.assembly && t < release ? 0 : 1;
        }
    }
    private pose() {
        const e = this.expansion.value;
        this.primary.position.set(-(this.chapter >= 1 ? 5.2 : 3.5) * e, 0, 2.7 * e);
        this.secondary.position.set((this.chapter >= 1 ? 5.2 : 3.5) + .18 * (1 - this.second.value), 0, -2.7);
        this.secondary.visible = this.second.value > .003;
        this.parts.forEach((parts, index) => parts.forEach(p => {
            const q = index === 0 ? p.motor.value : this.second.value;
            p.object.position.copy(p.base);
            p.object.scale.set(1, 1, 1);
            if (p.object.name !== 'Floor') {
                if (p.wall)
                    p.object.position.y += (1 - q) * .065;
                else
                    p.object.position.y += (1 - q) * .055;
            }
            p.object.visible = !(p.object.name==='Reception_Chair' && this.chapter>=2) && !p.object.userData.representative_role && (p.object.name === 'Floor' || q > .012) && (!p.object.userData.representative_role || this.chapter >= 2 && (this.config?.teams.filter(t => t.role === p.object.userData.representative_role).reduce((n, t) => n + t.count, 0) || 0) >= p.object.userData.minimum_people);
            for (const m of p.materials) {
                m.opacity = 1;
                m.depthWrite = true;
            }
            for (const m of p.meshes) {
                m.castShadow = true;
                m.receiveShadow = true;
            }
        }));
        const wallProgress = Math.min(...this.parts[0].filter(p => p.wall).map(p => p.motor.value), 1);
        (this.outline.material as THREE.LineBasicMaterial).opacity = this.assembly ? (1 - wallProgress) * .55 : 0;
        this.outline.visible = this.assembly && wallProgress < .99;
        this.primary.updateMatrixWorld(true);
        const touchpoints: THREE.Object3D[] = [];
        this.primary.traverse(o => { if (o.userData.role !== 'communication_touchpoint')
            return; let visible = true; for (let a: THREE.Object3D | null = o; a; a = a.parent)
            visible = visible && a.visible; if (visible)
            touchpoints.push(o); });
        this.rings.forEach((r, i) => { const device = touchpoints[i]; r.visible = !!device && (this.mode === 'improving' || this.activity) && this.emphasis.value > .01; if (device) {
            const b = new THREE.Box3().setFromObject(device, true);
            const center = b.getCenter(new THREE.Vector3());
            center.y = b.max.y + .025;
            r.position.copy(this.primary.worldToLocal(center));
        } (r.material as THREE.MeshBasicMaterial).opacity = this.emphasis.value * .65; });
        this.link.visible = this.linkAmount.value > .01;
        (this.link.material as THREE.LineDashedMaterial).opacity = this.linkAmount.value * .9;
        this.ao.enabled = true;
        this.frameCamera(e);
    }
    private frameCamera(e: number) {
        const angle = THREE.MathUtils.lerp(.38, .20, e);
        this.camera.position.set(Math.sin(angle) * 18, 8.8, Math.cos(angle) * 18);
        this.camera.lookAt(0, 1.25, 0);
        this.camera.updateMatrixWorld();
        const box = this.restBox.isEmpty() ? new THREE.Box3(new THREE.Vector3(-3.5, -.22, -2.6), new THREE.Vector3(3.5, 3, 2.6)) : this.restBox.clone();
        if(this.chapter >= 1)box.union(new THREE.Box3(new THREE.Vector3(3.40,-.24,-2.6),new THREE.Vector3(6.65,3.02,2.6)));
        box.max.y += .12;
        // Project each module separately; the empty diagonal corners of a combined
        // world AABB must not shrink the offices into thumbnails.
        const view = new THREE.Box3();
        for (const offset of [this.primary.position, this.secondary.visible ? this.secondary.position : new THREE.Vector3(3.6 * e, 0, -2.7 * e)])
            for (const x of [box.min.x, box.max.x])
                for (const y of [box.min.y, box.max.y])
                    for (const z of [box.min.z, box.max.z])
                        view.expandByPoint(new THREE.Vector3(x, y, z).add(offset).applyMatrix4(this.camera.matrixWorldInverse));
        const aspect = this.mount.clientWidth / Math.max(1, this.mount.clientHeight), size = view.getSize(new THREE.Vector3()), center = view.getCenter(new THREE.Vector3());
        const width = Math.max(size.x / .94, size.y / .94 * aspect), height = width / aspect;
        this.camera.left = center.x - width / 2;
        this.camera.right = center.x + width / 2;
        this.camera.top = center.y + height / 2;
        this.camera.bottom = center.y - height / 2;
        this.camera.updateProjectionMatrix();
        this.ao?.ssaoMaterial.uniforms.cameraProjectionMatrix.value.copy(this.camera.projectionMatrix);
        this.ao?.ssaoMaterial.uniforms.cameraInverseProjectionMatrix.value.copy(this.camera.projectionMatrixInverse);
    }
    private resize() {
        const w = this.mount.clientWidth, h = this.mount.clientHeight;
        if (!w || !h)
            return;
        this.renderer.setSize(w, h);
        this.composer.setSize(w, h);
        this.ao.setSize(Math.round(w * .8), Math.round(h * .8));
    }
    private tick = (now: number) => {
        this.frame = 0;
        if (this.dead || this.failed || document.hidden || !this.inView)
            return;
        const elapsed = Math.max(0, now - this.start), dt = this.last ? Math.min((now - this.last) / 1000, .08) : 1 / 60;
        if (this.ready) {
            this.updateGoals(elapsed);
            [this.expansion, this.second, this.emphasis, this.linkAmount].forEach(m => advance(m, dt, 24));
            this.parts[0].forEach(p => advance(p.motor, dt, 28));
        }
        if (!this.media.matches && now < this.gestureUntil)
            this.mixers.forEach(m => m.update(dt));
        for(const bay of this.bays)bay.sample(now);
        this.teamScene?.sample(now, this.media.matches ? 0 : dt, this.media.matches);
        this.pose();
        this.renderer.info.reset();
        this.composer.render();
        this.frames++;
        if (this.last)
            this.frameTimes.push(now - this.last);
        this.last = now;
        const done = this.ready && (!this.teamScene || this.teamScene.settled) && this.bays.every(b=>b.settled) && (!this.assembly || this.parts[0].every(p => p.motor.value === 1)) && [this.expansion, this.second, this.emphasis, this.linkAmount, ...this.parts[0].map(p => p.motor)].every(m => m.value === m.target && m.velocity === 0) && this.second.value === (this.mode === 'adding' ? 1 : 0);
        this.audit(done, elapsed);
        if (!done || now < this.gestureUntil || this.teamScene?.needsIdle)
            this.invalidate();
    };
    private audit(settled: boolean, elapsed: number) {
        this.scene.updateMatrixWorld(true);
        let penetration = 0, supportError = 0, clipping = 0;
        // True transformed geometry bounds, not origins. Native grounded plane stored on each root.
        this.parts.forEach((parts, index) => {
            if (index === 1 && !this.secondary.visible)
                return;
            for (const p of parts) {
                if (!p.object.visible)
                    continue;
                const b = new THREE.Box3().setFromObject(p.object, true);
                if (!p.wall && p.object.name !== 'Floor' && p.object.userData.floor_anchor !== undefined)
                    penetration = Math.max(penetration, p.object.userData.floor_anchor - b.min.y);
                for (const x of [b.min.x, b.max.x])
                    for (const y of [b.min.y, b.max.y])
                        for (const z of [b.min.z, b.max.z]) {
                            const v = new THREE.Vector3(x, y, z).project(this.camera);
                            clipping = Math.max(clipping, Math.abs(v.x) - 1, Math.abs(v.y) - 1);
                        }
            }
        });
        for (const root of [this.primary, this.secondary]) {
            if (!root.visible)
                continue;
            root.traverse(o => { if (!o.visible || o.userData.assembly_phase !== undefined || o.userData.floor_anchor === undefined)
                return; const box = new THREE.Box3().setFromObject(o, true); penetration = Math.max(penetration, o.userData.floor_anchor - box.min.y); });
        }
        for (const s of this.supports) {
            const relative = new THREE.Matrix4().copy(s.parent.matrixWorld).invert().multiply(s.object.matrixWorld);
            supportError = Math.max(supportError, ...relative.elements.map((v, i) => Math.abs(v - s.local.elements[i])));
        }
        const visibleBays=this.bays.filter(b=>b.root.visible && b.root.parent?.visible);
        for(const bay of visibleBays){const b=new THREE.Box3().setFromObject(bay.root,true);for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const v=new THREE.Vector3(x,y,z).project(this.camera);clipping=Math.max(clipping,Math.abs(v.x)-1,Math.abs(v.y)-1);}}
        const clinical=visibleBays.map(b=>b.audit());
        for(const b of clinical){penetration=Math.max(penetration,b.penetration);supportError=Math.max(supportError,b.supportError);}
        this.maxFloor = Math.max(this.maxFloor, penetration);
        this.maxSupport = Math.max(this.maxSupport, supportError);
        this.maxClip = Math.max(this.maxClip, clipping);
        const gl = this.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
        this.mount.dataset.mode = this.mode;
        this.mount.dataset.settled = String(settled);
        window.__plannerScene = { team:this.teamScene?.audit(),mode: this.mode, settled, generation: this.generation, frames: this.frames, drawCalls: this.renderer.info.render.calls, triangles: this.renderer.info.render.triangles, frameMs: this.frameTimes.slice(), renderer: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'WebGL2', reducedMotion: this.media.matches, primaryX: this.primary.position.x, secondaryVisible: this.secondary.visible, partsAtRest: this.parts[0].every(p => p.motor.value === 1), highlight: this.emphasis.value, connection: this.linkAmount.value, elapsed, floorPenetration: penetration, supportError, clipping, floorY: this.parts[0].find(p => p.object.name === 'Floor')?.object.position.y ?? 0, objectIds: this.parts.flat().map(p => p.object.uuid).join(','), maxFloorPenetration: this.maxFloor, maxSupportError: this.maxSupport, maxClipping: this.maxClip, loadMs: this.loadMs, clinical };
    }
    private invalidate() {
        if (!this.frame && !this.dead && !this.failed && !document.hidden && this.inView)
            this.frame = requestAnimationFrame(this.tick);
    }
    private snap() { this.teamScene?.snap(); this.bays.forEach(b=>b.snap()); this.assembly = false; const adding = this.mode === 'adding'; this.expansion.value = this.expansion.target = adding ? 1 : 0; this.second.value = this.second.target = adding ? 1 : 0; this.emphasis.value = this.emphasis.target = this.mode === 'improving' ? 1 : 0; this.linkAmount.value = this.linkAmount.target = adding ? 1 : 0; [this.expansion, this.second, this.emphasis, this.linkAmount, ...this.parts[0].map(p => p.motor)].forEach(m => { m.velocity = 0; }); this.parts[0].forEach(p => { p.motor.value = p.motor.target = 1; }); this.replaying = false; this.gestureUntil = 0; this.mixers.forEach(m => m.setTime(0)); this.invalidate(); }
        replay() {
        if(this.chapter >= 1){const now=performance.now();this.bays.forEach(b=>b.select(this.config?.specialty || '',now,this.media.matches,true));this.last=0;this.invalidate();}
        else this.setMode(this.mode, true, true);
    }
    private motionChange = () => {
        this.gestureUntil = 0;
        this.mixers.forEach(m => m.setTime(0));
        if (this.media.matches)
            this.snap();
        else
            this.invalidate();
    };
    private visibilityChange = () => {
        if (document.hidden) {
            cancelAnimationFrame(this.frame);
            this.frame = 0;
        }
        else {
            this.last = 0;
            this.invalidate();
        }
    };
    private contextLost = (e: Event) => { e.preventDefault(); this.failed = true; cancelAnimationFrame(this.frame); this.onFailure(); };
    dispose() {
        this.dead = true;
        this.teamScene?.dispose();
        cancelAnimationFrame(this.frame);
        this.resizeObserver.disconnect();
        this.observer.disconnect();
        this.mixers.forEach(m => m.stopAllAction());
        this.media.removeEventListener('change', this.motionChange);
        document.removeEventListener('visibilitychange', this.visibilityChange);
        const geo = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>(this.sourceMaterials);
        this.scene.traverse(o => {
            if (o instanceof THREE.Mesh || o instanceof THREE.Line) {
                geo.add(o.geometry);
                (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => mats.add(m));
            }
            if (o instanceof THREE.DirectionalLight)
                o.shadow.map?.dispose();
        });
        geo.forEach(g => g.dispose());
        mats.forEach(m => m.dispose());
        this.textures.forEach(t => t.dispose());
        this.ao.dispose();
        this.output.dispose();
        this.composer.dispose();
        this.pmrem.dispose();
        this.renderer.dispose();
        this.renderer.domElement.remove();
        delete window.__plannerScene;
    }
}
