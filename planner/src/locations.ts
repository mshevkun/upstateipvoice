import { initial, type Plan } from './config';
export type LocalDraft = Pick<Plan, 'teams' | 'endpoints' | 'first' | 'reasons' | 'busy' | 'menu' | 'languages' | 'hours' | 'after' | 'urgent' | 'followup' | 'confirmed' | 'policy'>;
export function localDraft(p: Plan): LocalDraft { return structuredClone({ teams: p.teams, endpoints: p.endpoints, first: p.first, reasons: p.reasons, busy: p.busy, menu: p.menu, languages: p.languages, hours: p.hours, after: p.after, urgent: p.urgent, followup: p.followup, confirmed: p.confirmed, policy: p.policy }); }
export function locationPlan(p: Plan, id: string): Plan | undefined { if (id === p.policy.activeLocation)
    return p; const d = p.profiles[id], location = p.locations.find(l => l.id === id); return d && location ? { ...p, ...structuredClone(d), locations: [location], profiles: {}, policy: { ...d.policy, activeLocation: id } } : undefined; }
export function switchLocation(p: Plan, id: string, copy = false): Plan {
    if (id === p.policy.activeLocation || !p.locations.some(l => l.id === id))
        return p;
    const profiles = { ...p.profiles, [p.policy.activeLocation]: localDraft(p) };
    let draft = p.profiles[id];
    if (!draft) {
        const fresh = initial();
        fresh.policy.activeLocation = id;
        if (copy) { // Copy only confirmed reusable requirements; never local people, ownership or coverage.
            if (p.confirmed.includes('first'))
                fresh.first.kind = p.first.kind;
            if (p.confirmed.includes('reasons'))
                fresh.reasons = p.reasons.map(r => ({ ...r, team: '' }));
            if (p.confirmed.includes('busy'))
                fresh.busy = { ...p.busy, backup: '', owner: '' };
            if (p.confirmed.includes('after'))
                fresh.after = { ...p.after, owner: '' };
            fresh.policy.queueExit = p.confirmed.includes('busy') ? p.policy.queueExit : 'message';
            if ((p.confirmed.includes('first') && p.first.kind === 'assistant') || (p.confirmed.includes('busy') && (p.busy.kind === 'assistant' || p.policy.queueExit === 'assistant')) || (p.confirmed.includes('after') && p.after.kind === 'assistant'))
                fresh.policy.assistant = { ...p.policy.assistant, team: '', owner: '' };
            fresh.policy.notes = 'Reusable requirements copied. Reconfirm local staff, endpoints, number, hours/timezone and on-call coverage.';
        }
        draft = localDraft(fresh);
    }
    return { ...p, ...structuredClone(draft), profiles, policy: { ...draft.policy, activeLocation: id, locationEntry: p.policy.locationEntry } };
}
