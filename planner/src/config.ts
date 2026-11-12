import type { LocalDraft } from './locations';
import { policyDefaults, policyDecisions, inventory, validPolicy, type Policy } from './policy';
/** Canonical, versioned business configuration. Presentation state lives elsewhere. */
export type Mode = 'opening' | 'improving' | 'adding';
export type Team = {
    id: string;
    name: string;
    role: 'reception' | 'clinical' | 'administration';
    count: number;
    status?: 'unanswered' | 'known' | 'deferred';
};
export type Day = {
    day: string;
    open: boolean;
    start: string;
    end: string;
    breakStart: string;
    breakEnd: string;
};
export type Plan = {
    profiles: Record<string, LocalDraft>;
    policy: Policy;
    schema: 2;
    planId: string;
    revision: number;
    updatedAt: string;
    mode: Mode | '';
    name: string;
    specialty: string;
    specialtyDetail?: string;
    locations: {
        id: string;
        name: string;
    }[];
    teams: Team[];
    endpoints: {
        desk: number;
        computer: number;
        mobile: number;
        shared: number;
        undecided: boolean;
    };
    first: {
        kind: 'human' | 'menu' | 'assistant' | 'undecided';
        team: string;
    };
    reasons: {
        id: string;
        label: string;
        team: string;
    }[];
    busy: {
        kind: 'message' | 'queue' | 'backup' | 'assistant' | 'undecided';
        seconds: number;
        wait: number;
        backup: string;
        owner: string;
    };
    menu: {
        invalid: 'message' | 'team';
        noInput: 'message' | 'team';
        team: string;
    };
    languages: {
        name: string;
        mechanism: 'staff' | 'menu' | 'assistant' | 'undecided';
        team: string;
        availability: 'open' | 'always' | 'limited';
        note: string;
        fallback: string;
    }[];
    hours: {
        timezone: string;
        days: Day[];
        holidays: string[];
        holidayPolicy: 'closed' | 'regular';
    };
    after: {
        kind: 'information' | 'message' | 'service' | 'assistant' | 'undecided';
        owner: string;
        instructions: string;
    };
    urgent: {
        enabled: boolean;
        approved: boolean;
        instructions: string;
        team: string;
        backup: string;
        seconds: number;
        owner: string;
    };
    followup: {
        owner: string;
        target: string;
        channels: string[];
    };
    current: {
        provider: string;
        monthly: string;
        lines: string;
        notes: string;
    };
    confirmed: string[];
};
export const key = 'upstate.practice-plan.v2';
export const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
export function newPlanId() { return 'UP-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }
export const initial = (): Plan => ({ profiles: {}, policy: policyDefaults(), schema: 2, planId: newPlanId(), revision: 0, updatedAt: new Date().toISOString(), mode: '', name: '', specialty: '', locations: [{ id: 'location-1', name: 'Main practice' }], teams: [{ id: 'reception', name: 'Reception', role: 'reception', count: 0, status: 'unanswered' }, { id: 'clinical', name: 'Clinical team', role: 'clinical', count: 0, status: 'unanswered' }, { id: 'admin', name: 'Administration', role: 'administration', count: 0, status: 'unanswered' }], endpoints: { desk: 0, computer: 0, mobile: 0, shared: 0, undecided: true }, first: { kind: 'undecided', team: '' }, reasons: [{ id: 'appointments', label: 'Appointments and scheduling', team: '' }, { id: 'billing', label: 'Billing and insurance questions', team: '' }, { id: 'clinical-question', label: 'Clinical questions', team: '' }], busy: { kind: 'undecided', seconds: 25, wait: 90, backup: '', owner: '' }, menu: { invalid: 'message', noInput: 'message', team: '' }, languages: [], hours: { timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/New_York', days: days.map((day, i) => ({ day, open: i < 5, start: '09:00', end: '17:00', breakStart: '', breakEnd: '' })), holidays: [], holidayPolicy: 'closed' }, after: { kind: 'undecided', owner: '', instructions: '' }, urgent: { enabled: false, approved: false, instructions: '', team: '', backup: '', seconds: 30, owner: '' }, followup: { owner: '', target: '', channels: [] }, current: { provider: '', monthly: '', lines: '', notes: '' }, confirmed: [] });
const kinds = ['opening', 'improving', 'adding'];
function structural(c: unknown, template: unknown): boolean { if (Array.isArray(template))
    return Array.isArray(c); if (template !== null && typeof template === 'object')
    return !!c && typeof c === 'object' && Object.entries(template).every(([k, v]) => structural((c as Record<string, unknown>)[k], v)); return typeof c === typeof template; }
export function valid(p: unknown): p is Plan { try {
    const c = p as Plan;
    return structural(c, initial()) && validPolicy(c.policy) && Object.entries(inventory(c)).every(([k, v]) => c.endpoints[k as keyof typeof c.endpoints] === v) && Object.entries(c.profiles).length <= 50 && Object.entries(c.profiles).every(([id, d]) => valid({ ...initial(), ...d, profiles: {}, locations: [{ id, name: '' }], endpoints: inventory({ ...c, ...d }), policy: { ...policyDefaults(), ...d.policy, opening: { ...policyDefaults().opening, ...d.policy?.opening }, continuity: { ...policyDefaults().continuity, ...d.policy?.continuity }, assistant: { ...policyDefaults().assistant, ...d.policy?.assistant }, terminalApprovals: { ...policyDefaults().terminalApprovals, ...d.policy?.terminalApprovals }, activeLocation: id } })) && c.schema === 2 && Number.isInteger(c.revision) && c.revision >= 0 && [...kinds, ''].includes(c.mode) && typeof c.name === 'string' && typeof c.specialty === 'string' && (c.specialtyDetail === undefined || typeof c.specialtyDetail === 'string' && c.specialtyDetail.length <= 120) && Array.isArray(c.locations) && c.locations.length > 0 && c.locations.length <= 50 && c.locations.every(x => typeof x.id === 'string' && typeof x.name === 'string') && new Set(c.locations.map(x => x.id)).size === c.locations.length && Array.isArray(c.teams) && c.teams.length <= 30 && new Set(c.teams.map(x => x.id)).size === c.teams.length && c.teams.every(t => typeof t.id === 'string' && typeof t.name === 'string' && ['reception', 'clinical', 'administration'].includes(t.role) && Number.isInteger(t.count) && t.count >= 0 && t.count <= 9999 && (t.status === undefined || ['known','unanswered','deferred'].includes(t.status))) && ['desk', 'computer', 'mobile', 'shared'].every(k => Number.isInteger(c.endpoints[k as 'desk']) && c.endpoints[k as 'desk'] >= 0 && c.endpoints[k as 'desk'] <= 99900) && ['human', 'menu', 'assistant', 'undecided'].includes(c.first.kind) && ['message', 'queue', 'backup', 'assistant', 'undecided'].includes(c.busy.kind) && [c.busy.seconds, c.busy.wait, c.urgent.seconds].every(x => Number.isFinite(x) && x >= 5 && x <= 600) && Array.isArray(c.reasons) && c.reasons.length <= 20 && c.reasons.every(x => typeof x.label === 'string' && typeof x.team === 'string') && new Set(c.reasons.map(x => x.id)).size === c.reasons.length && ['message', 'team'].includes(c.menu.invalid) && ['message', 'team'].includes(c.menu.noInput) && Array.isArray(c.languages) && c.languages.length <= 20 && c.languages.every(x => ['name', 'team', 'note', 'fallback'].every(k => typeof x[k as 'name'] === 'string') && typeof x.name === 'string' && ['staff', 'menu', 'assistant', 'undecided'].includes(x.mechanism) && ['open', 'always', 'limited'].includes(x.availability)) && c.hours.days.length === 7 && c.hours.days.every((x, i) => x.day === days[i] && typeof x.open === 'boolean' && [x.start, x.end, x.breakStart, x.breakEnd].every(v => typeof v === 'string')) && Array.isArray(c.hours.holidays) && typeof c.hours.timezone === 'string' && ['information', 'message', 'service', 'assistant', 'undecided'].includes(c.after.kind) && typeof c.urgent.enabled === 'boolean' && typeof c.urgent.approved === 'boolean' && Array.isArray(c.followup.channels) && c.followup.channels.every(x => typeof x === 'string') && Array.isArray(c.confirmed) && c.confirmed.every(x => typeof x === 'string') && typeof c.current.monthly === 'string';
}
catch {
    return false;
} }
export function read(): {
    plan: Plan;
    warning: string;
} { try {
    const raw = localStorage.getItem(key);
    if (raw) {
        const p = JSON.parse(raw);
        if (p?.schema === 2) {
            const d = policyDefaults();
            p.policy = { ...d, ...p.policy, opening: { ...d.opening, ...p.policy?.opening }, continuity: { ...d.continuity, ...p.policy?.continuity }, assistant: { ...d.assistant, ...p.policy?.assistant }, terminalApprovals: { ...d.terminalApprovals, ...p.policy?.terminalApprovals } };
            p.profiles ??= {};
            p.planId = typeof p.planId === 'string' && p.planId ? p.planId : newPlanId();
            for(const t of p.teams || []) t.status ??= t.count>0 || p.confirmed?.includes('team') ? 'known' : 'unanswered';
            p.endpoints = inventory(p);
            p.policy.cityState ??= '';
            p.policy.hoursPreset ??= 'weekdays';
            p.policy.opening.precision ??= /^\d{4}-\d{2}-\d{2}$/.test(p.policy.opening.date) ? 'day' : p.policy.opening.date ? 'month' : 'none';
        }
        if (valid(p))
            return { plan: p, warning: '' };
        return { plan: initial(), warning: 'The saved plan could not be read safely. It remains in storage; this visit starts a new draft.' };
    }
    const p = initial();
    const legacy = JSON.parse(localStorage.getItem('upstate.practice-plan.v1') || 'null');
    if (legacy && kinds.includes(legacy.planningMode))
        p.mode = legacy.planningMode;
    return { plan: p, warning: '' };
}
catch {
    return { plan: initial(), warning: 'Local storage is unavailable. Keep this tab open and download your plan.' };
} }
export function commit(previous: Plan, next: Plan) { const p = { ...next, endpoints: inventory(next), revision: previous.revision + 1, updatedAt: new Date().toISOString() }; if (!valid(p))
    throw Error('Invalid configuration'); return p; }
export const teamName = (p: Plan, id: string) => p.teams.find(t => t.id === id && t.count > 0)?.name || 'Unresolved destination';
export const hasTeam = (p: Plan, id: string) => p.teams.some(t => t.id === id && t.count > 0);
export function affected(p: Plan, id: string) { const refs: string[] = []; if(p.policy.beforeOpeningOwner===id)refs.push('before-opening callback ownership');for(const [name,f]of Object.entries(p.policy.languageFallbacks))if(f.team===id)refs.push(name+' alternate coverage');for(const [team,f]of Object.entries(p.policy.teamFallbacks))if(team===id||f.team===id||f.owner===id)refs.push('team-specific fallback for '+teamName(p,team)); if (p.policy.placements.some(x => x.team === id))
    refs.push('endpoint assignments'); if (p.policy.ringOrder.some(x => x.team === id))
    refs.push('ringing order'); if ([p.policy.assistant.team, p.policy.assistant.owner, ...Object.values(p.policy.followupOwners)].includes(id))
    refs.push('assistant or follow-up ownership'); if (p.first.team === id)
    refs.push('first answer'); for (const r of p.reasons)
    if (r.team === id)
        refs.push(r.label); for (const l of p.languages)
    if (l.team === id || l.fallback === id)
        refs.push(l.name + ' coverage'); for (const [name, v] of Object.entries({ busyBackup: p.busy.backup, busyOwner: p.busy.owner, menuFallback: p.menu.team, afterOwner: p.after.owner, onCall: p.urgent.team, onCallBackup: p.urgent.backup, urgentOwner: p.urgent.owner, followup: p.followup.owner }))
    if (v === id)
        refs.push(name); return refs; }
export function decisions(p: Plan) {
    const a: string[] = [];
    const need = (test: boolean, text: string) => { if (!test)
        a.push(text); };
    need(!!p.mode, 'Choose a starting point');
    need(!!p.specialty, 'Confirm the practice specialty');
    need(p.teams.some(t => t.count > 0), 'Confirm the teams available to answer');
    need(!p.endpoints.undecided, 'Choose desk, computer, or mobile devices');
    need(p.endpoints.desk + p.endpoints.computer + p.endpoints.mobile + p.endpoints.shared > 0, 'Identify at least one phone or computer for answering');
    need(p.first.kind !== 'undecided', 'Choose the first-answer method');
    if (p.first.kind === 'human')
        need(hasTeam(p, p.first.team), 'Assign the first-answer team');
    if (p.first.kind === 'assistant' || p.after.kind === 'assistant')
        a.push('Verify virtual-assistant service, supported languages and integrations with Upstate');
    need(p.reasons.length > 0, 'Add at least one caller reason');
    for (const r of p.reasons)
        need(hasTeam(p, r.team === '@main' ? p.first.team : r.team), p.first.kind === 'human' && p.first.team
            ? 'Confirm whether ' + r.label + ' stays with the front desk or goes elsewhere'
            : 'Assign a destination for ' + r.label);
    need(p.busy.kind !== 'undecided', 'Choose busy/unanswered behavior');
    need(hasTeam(p, p.busy.owner), 'Assign the busy/unanswered message owner');
    if (p.busy.kind === 'backup')
        need(hasTeam(p, p.busy.backup), 'Assign a busy-call backup');
    if ((p.first.kind === 'menu'||p.locations.length>1&&p.policy.locationEntry==='menu') && (p.menu.invalid === 'team' || p.menu.noInput === 'team'))
        need(hasTeam(p, p.menu.team), 'Assign the menu fallback team');
    for (const l of p.languages) {
        need(l.mechanism !== 'undecided', 'Choose how ' + l.name + ' is identified');
        if ((p.policy.languageProviders[l.name] || 'team') === 'team')
            need(hasTeam(p, l.team), 'Assign ' + l.name + ' coverage');
        need(hasTeam(p, l.fallback), 'Assign ' + l.name + ' fallback message owner');
        if (l.mechanism === 'staff')
            need(p.first.kind === 'human', 'Choose human-first answering for staff identification of ' + l.name);
        if (l.availability === 'always')
            need(l.mechanism === 'assistant' && p.after.kind === 'assistant' || l.mechanism === 'staff' && p.after.kind === 'service', 'Confirm an after-hours identification service for ' + l.name);
        if (l.mechanism === 'menu')
            need(p.first.kind === 'menu', 'Enable a menu for ' + l.name + ' selection');
        if (l.mechanism === 'assistant')
            need(p.first.kind === 'assistant', 'Enable an assistant for ' + l.name + ' identification');
    }
    need(p.hours.holidays.every(x => !x || /^\d{4}-\d{2}-\d{2}$/.test(x)), 'Use calendar dates for holidays');
    if (p.policy.hoursPreset === 'undecided')
        a.push('Phone hours are not set yet');
    else
        need(p.confirmed.includes('hours'), 'Confirm the phone hours');
    try {
        new Intl.DateTimeFormat('en', { timeZone: p.hours.timezone }).format();
    }
    catch {
        a.push('Choose a valid timezone');
    }
    for (const d of p.hours.days) {
        if (d.open) {
            need(/^\d\d:\d\d$/.test(d.start) && /^\d\d:\d\d$/.test(d.end) && d.start < d.end, 'Correct ' + d.day + ' opening hours');
            if (d.breakStart || d.breakEnd)
                need(!!d.breakStart && !!d.breakEnd && d.breakStart >= d.start && d.breakEnd <= d.end && d.breakStart < d.breakEnd, 'Correct ' + d.day + ' break');
        }
    }
    need(p.after.kind !== 'undecided', 'Choose after-hours behavior');
    if (p.after.kind !== 'information')
        need(hasTeam(p, p.after.owner), 'Assign the after-hours message owner');
    if (p.after.kind === 'information' || p.after.kind === 'service')
        need(!!p.after.instructions.trim(), 'Provide after-hours information or service details');
    if (p.after.kind === 'service')
        a.push('Confirm answering-service contract and permitted actions');
    if (p.urgent.enabled) {
        if (p.policy.urgentKind === 'instructions' || p.policy.urgentBackup === 'instructions')
            need(p.urgent.approved && !!p.urgent.instructions.trim(), 'Approve the urgent-call instructions');
        if (p.policy.urgentKind === 'connect') {
            need(hasTeam(p, p.urgent.team), 'Assign the on-call role');
            if (p.policy.urgentBackup === 'team')
                need(hasTeam(p, p.urgent.backup), 'Assign the on-call backup');
        }
        if (p.policy.urgentKind !== 'instructions')
            need(hasTeam(p, p.urgent.owner), 'Assign unanswered urgent messages');
    }
    need(p.confirmed.includes('urgent'), 'Confirm whether an urgent-call path is needed');
    for (const location of p.locations.filter(l => l.id !== p.policy.activeLocation)) {
        const d = p.profiles[location.id];
        if (d)
            for (const issue of decisions({ ...p, ...d, profiles: {}, locations: [location], policy: { ...d.policy, activeLocation: location.id } }))
                a.push(location.name + ': ' + issue);
    }
    return [...new Set([...a, ...policyDecisions(p)])];
}
export type Scenario = {
    beforeOpening?: boolean;
    humanRequested?: boolean;
    request?: string;
    id: string;
    label: string;
    open: boolean;
    busy?: boolean;
    language?: string;
    languageAvailable?: boolean;
    urgent?: boolean;
    onCallAnswered?: boolean;
    backupAnswered?: boolean;
    invalid?: boolean;
    noInput?: boolean;
    answered?: boolean;
    reason?: string;
    at?: string;
    location?: string;
    assistantFailed?: boolean;
    onCallAvailable?: boolean;
    unavailableTeams?: string[];
};
export type Node = {
    id: string;
    label: string;
    detail: string;
    kind: 'decision' | 'action' | 'end';
    seconds?: number;
    edges: {
        to: string;
        when: string;
    }[];
};
export type Graph = {
    revision: number;
    start: string;
    nodes: Record<string, Node>;
};
export { graph, simulate, scenarios, journeySeconds, urgentMechanism, menuDigits, overflowTeams } from './routing';
export function isOpen(p: Plan, date = new Date()) { try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: p.hours.timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
    const get = (k: string) => parts.find(x => x.type === k)?.value || '';
    const day = p.hours.days.find(x => x.day === get('weekday'));
    const time = get('hour') + ':' + get('minute'), iso = get('year') + '-' + get('month') + '-' + get('day');
    return !!day?.open && time >= day.start && time < day.end && !(day.breakStart && time >= day.breakStart && time < day.breakEnd) && !p.policy.closures.includes(iso) && !(p.hours.holidayPolicy === 'closed' && p.hours.holidays.includes(iso));
}
catch {
    return false;
} }
export { steps } from './flow';
