import type { Plan, Team } from './config';
export const roles = ['reception', 'clinical', 'administration'] as const;
export type Role = typeof roles[number];
export const roleInfo = { reception: { title: 'Front desk', short: 'Front desk', description: 'Scheduling and patient reception', cap: 2 }, clinical: { title: 'Clinical team', short: 'Clinicians', description: 'Providers and clinical support', cap: 3 }, administration: { title: 'Administration', short: 'Administration', description: 'Billing and office management', cap: 2 } };
export const MAX_PEOPLE = 9999;
export function state(t: Team) { return t.status ?? 'known'; }
export function roleState(p: Pick<Plan, 'teams'>, role: Role) { const ts = p.teams.filter(t => t.role === role); const status = !ts.length ? 'unanswered' : ts.some(t => state(t) === 'unanswered') ? 'unanswered' : ts.some(t => state(t) === 'deferred') ? 'deferred' : 'known'; return { status, count: ts.filter(t => state(t) === 'known').reduce((n, t) => n + t.count, 0) }; }
export function teamSummary(p: Pick<Plan, 'teams'>) { const values = roles.map(r => roleState(p, r)); const total = values.reduce((n, v) => n + v.count, 0), unknown = values.filter(v => v.status !== 'known').length, shown = values.reduce((n, v, i) => n + (v.status === 'known' ? Math.min(v.count, roleInfo[roles[i]].cap) : 0), 0); return { total, unknown, shown, capped: values.some((v, i) => v.status === 'known' && v.count > roleInfo[roles[i]].cap), label: unknown === 3 && total === 0 ? values.every(v => v.status === 'deferred') ? 'Team size to decide' : 'Your team · Add your people' : unknown ? `${total} ${total === 1 ? 'person' : 'people'} counted · ${unknown} ${unknown === 1 ? 'role' : 'roles'} undecided` : `Your team · ${total} ${total === 1 ? 'person' : 'people'}` }; }
export function parseCount(text: string) { if (!/^\d+$/.test(text.trim()))
    return null; const n = Number(text.trim()); return Number.isSafeInteger(n) && n <= MAX_PEOPLE ? n : null; }
export function setRole(p: Plan, role: Role, status: 'known' | 'deferred', count = 0): Plan {
    const existing = p.teams.filter(t => t.role === role);
    if (!existing.length)
        return { ...p, teams: [...p.teams, { id: role, name: roleInfo[role].short, role, count: status === 'known' ? count : 0, status }] };
    // Preserve routed team identities and their allocation where possible. A role
    // total increase goes to the first team; reductions consume the last team first.
    const counts = existing.map(t => status === 'known' ? t.count : 0);
    let delta = count - counts.reduce((a, b) => a + b, 0);
    if (status === 'known' && delta > 0)
        counts[0] += delta;
    if (status === 'known' && delta < 0)
        for (let i = counts.length - 1; i >= 0 && delta < 0; i--) {
            const take = Math.min(counts[i], -delta);
            counts[i] -= take;
            delta += take;
        }
    const updates = new Map(existing.map((t, i) => [t.id, { ...t, count: counts[i], status }]));
    return { ...p, teams: p.teams.map(t => updates.get(t.id) ?? t) };
}
