import type { Plan, Day } from './config';
export type Placement = {
    id: string;
    team: string;
    label: string;
    device: 'desk' | 'computer' | 'mobile' | 'none' | 'undecided';
    count: number;
    sharing: 'shared' | 'separate' | 'undecided';
    access: 'outside' | 'internal';
    extension: string;
};
export type OpeningPrep = {
    date: string;
    precision: 'day' | 'month' | 'none';
    construction: 'planning' | 'build-out' | 'near' | 'undecided';
    numbers: 'new' | 'porting' | 'undecided';
    internet: 'known' | 'unknown' | 'survey' | 'undecided';
    network: 'known' | 'unknown' | 'survey' | 'undecided';
    pms: string;
};
export type Continuity = {
    internet: 'undecided' | 'failover' | 'none' | 'survey';
    power: 'undecided' | 'ups' | 'none' | 'survey';
    backupRouting: 'undecided' | 'cellular' | 'forward' | 'none';
    notes: string;
};
export type Policy = {
    languageDecision: 'none' | 'selected' | 'undecided';
    languageProviders: Record<string, 'team' | 'service' | 'arrange' | 'undecided'>;
    queueExit: 'message' | 'backup' | 'assistant' | 'undecided';
    notification: 'inbox' | 'practice' | 'email' | 'undecided';
    version: 1 | 2;
    priorities: string[];
    number: 'own' | 'shared' | 'undecided';
    locationEntry: 'shared' | 'menu' | 'separate' | 'undecided';
    activeLocation: string;
    rooms: number;
    roomsSpecified: boolean;
    terminalApprovals: Record<string, boolean>;
    opening: OpeningPrep;
    continuity: Continuity;
    handoffTested: boolean;
    onCallRouteVerified: boolean;
    e911Confirmed: boolean;
    baaAcknowledged: boolean;
    bomTier: 'essential' | 'balanced' | 'automation' | 'undecided';
    placements: Placement[];
    ring: 'together' | 'order' | 'undecided';
    ringOrder: {
        team: string;
        seconds: number;
    }[];
    recommendation: string;
    assistant: {
        handoffTasks?: string[];
        tasks: string[];
        humanWhen: 'request' | 'selected' | 'unfinished';
        team: string;
        owner: string;
        status: 'needs-confirmation' | 'not-configured';
    };
    languageSchedules: Record<string, Day[]>;
    languageFallbacks: Record<string, {
        kind: 'callback' | 'team' | 'instructions' | 'undecided';
        team: string;
        text: string;
        approved: boolean;
    }>;
    urgentKind: 'connect' | 'priority' | 'instructions' | 'undecided' | 'none';
    urgentCoverage: 'always' | 'closed' | 'open' | 'selected' | 'undecided';
    urgentDays: Day[];
    urgentRoster: 'fixed' | 'rotation' | 'undecided';
    urgentBackup: 'team' | 'message' | 'instructions';
    urgentAlert: 'email' | 'service' | 'undecided';
    acceptance: boolean;
    followup: 'yes' | 'calls' | 'skip';
    followupOwners: Record<string, string>;
    system: string;
    comparison: boolean;
    costIncludes: string[];
    contract: string;
    portNumbers: boolean;
    beforeOpeningText?: string;
    beforeOpeningOwner?: string;
    beforeOpening: 'information' | 'message' | 'undecided';
    menuRetries: number;
    closures: string[];
    hoursExceptionsConfirmed: boolean;
    teamFallbacks: Record<string, {
        kind: 'message' | 'backup';
        team: string;
        owner: string;
    }>;
    teamAvailability: Record<string, Day[]>;
    notes: string;
    extensionBase: number;
    cityState: string;
    hoursPreset: 'weekdays' | 'always' | 'custom' | 'undecided';
    billingPerformedBy: 'reception' | 'administration' | 'clinical' | 'split' | 'undecided';
    urgentScope: 'urgent_only' | 'all_calls' | 'undecided';
    pendingClinicianRoute: boolean;
};
export function policyDefaults(): Policy { return { languageDecision: 'undecided', languageProviders: {}, queueExit: 'message', notification: 'undecided', version: 2, priorities: [], number: 'undecided', locationEntry: 'undecided', activeLocation: 'location-1', rooms: 0, roomsSpecified: false, terminalApprovals: {}, opening: { date: '', precision: 'none', construction: 'undecided', numbers: 'undecided', internet: 'undecided', network: 'undecided', pms: '' }, continuity: { internet: 'undecided', power: 'undecided', backupRouting: 'undecided', notes: '' }, handoffTested: false, onCallRouteVerified: false, e911Confirmed: false, baaAcknowledged: false, bomTier: 'undecided', placements: [], ring: 'undecided', ringOrder: [], recommendation: '', assistant: { tasks: [], humanWhen: 'request', team: '', owner: '', status: 'not-configured' }, languageSchedules: {}, languageFallbacks: {}, urgentKind: 'undecided', urgentCoverage: 'undecided', urgentDays: [], urgentRoster: 'undecided', urgentBackup: 'message', urgentAlert: 'undecided', acceptance: false, followup: 'skip', followupOwners: {}, system: '', comparison: false, costIncludes: [], contract: '', portNumbers: false, beforeOpening: 'undecided', menuRetries: 1, closures: [], hoursExceptionsConfirmed: false, teamFallbacks: {}, teamAvailability: {}, notes: '', extensionBase: 201, cityState: '', hoursPreset: 'weekdays', billingPerformedBy: 'undecided', urgentScope: 'undecided', pendingClinicianRoute: false }; }
export function suggestPlacements(p: Plan): Placement[] {
    if (p.policy.placements.length)
        return p.policy.placements;
    return p.teams.filter(t => t.count > 0).map(t => {
        const answers = p.first.kind === 'human' ? t.id === (p.first.team || 'reception') : t.role === 'reception';
        const device: Placement['device'] = t.role === 'reception' ? 'desk' : t.role === 'clinical' ? 'computer' : 'mobile';
        const count = t.role === 'reception' ? Math.min(Math.max(answers ? t.count : 1, 1), 8) : t.role === 'clinical' ? Math.min(2, Math.max(t.count, 1)) : 1;
        return { id: t.id, team: t.id, label: t.name, device, count, sharing: count > 1 && t.role === 'reception' ? 'separate' : count > 1 ? 'shared' : 'shared', access: 'outside' as const, extension: '' };
    });
}
export function inventory(p: Plan) { const x = { desk: 0, computer: 0, mobile: 0, shared: 0, undecided: !p.policy.placements.length || p.teams.some(t => t.count > 0 && !p.policy.placements.some(a => a.team === t.id)) }; for (const a of p.policy.placements) {
    if (a.device === 'undecided')
        x.undecided = true;
    else if (a.device !== 'none') {
        x[a.device] += a.count;
        if (a.sharing === 'undecided' && a.count > 1)
            x.undecided = true;
    }
} return x; }
export function canRing(p:Plan,id:string,outside=false){return p.teams.some(t=>t.id===id&&t.count>0)&&p.policy.placements.some(x=>x.team===id&&!['none','undecided'].includes(x.device)&&x.count>0&&(!outside||x.access==='outside'));}
export function directory(p: Plan) { return p.policy.placements.filter(x => !['none', 'undecided'].includes(x.device) && x.count > 0).map((x, i) => ({ id: x.id, label: x.label, team: x.team, device: x.device, count: x.count, access: x.access, sharing: x.sharing, extension: x.extension || String(p.policy.extensionBase + i * 10), suggested: !x.extension, identities: x.sharing === 'separate' && x.count > 1 ? x.count : 1, concurrent: x.sharing === 'separate' ? x.count : x.sharing === 'shared' ? 1 : 0 })); }
export function policyDecisions(p: Plan) { const a: string[] = []; const q = p.policy, has = (id: string) => p.teams.some(t => t.id === id && t.count > 0); if (p.mode === 'opening') {
    if (q.beforeOpening === 'undecided')
        a.push('Choose the before-opening phone behavior');
    if (q.beforeOpening === 'information' && !q.beforeOpeningText?.trim())
        a.push('Provide approved before-opening information');
    if (q.beforeOpening === 'message' && !has(q.beforeOpeningOwner || ''))
        a.push('Assign before-opening callback ownership');
    const precision = q.opening.precision || (q.opening.date ? 'day' : 'none');
    if (precision === 'day' && q.opening.date && !/^\d{4}-\d{2}-\d{2}$/.test(q.opening.date))
        a.push('Use a full calendar day for the opening date');
    if (precision === 'month' && q.opening.date && !/^\d{4}-\d{2}/.test(q.opening.date))
        a.push('Choose an opening month');
    if (q.opening.numbers === 'undecided')
        a.push('Choose new numbers or porting');
    if (q.opening.internet === 'undecided')
        a.push('Record internet readiness, or mark a site survey');
    if (q.opening.network === 'undecided')
        a.push('Record network and cabling readiness, or mark a site survey');
} if (!p.languages.length && q.languageDecision === 'undecided')
    a.push('Confirm whether additional language coverage is needed'); if (p.busy.kind === 'queue' && q.queueExit === 'undecided')
    a.push('Choose the queue exit'); if (p.busy.kind === 'queue' && q.queueExit === 'backup' && !has(p.busy.backup))
    a.push('Assign the queue-exit backup'); if (q.notification === 'undecided')
    a.push('Choose the message notification requirement'); if (!p.locations.some(l => l.id === q.activeLocation))
    a.push('Choose an available active location'); if (p.mode === 'adding' && q.number === 'undecided')
    a.push('Choose a number arrangement for the new location'); if (p.locations.length > 1) {
    if (q.locationEntry === 'shared' && p.first.kind !== 'human')
        a.push('Choose human-first answering for shared reception location identification');
    if (q.locationEntry === 'undecided')
        a.push('Choose the multi-location main-number entry');
    for (const l of p.locations.filter(l => l.id !== q.activeLocation))
        if (!p.profiles[l.id])
            a.push('Configure ' + l.name + ': local staff, devices, phone hours/timezone and on-call policy');
        else if (!['team', 'positions', 'hours', 'urgent'].every(k => p.profiles[l.id].confirmed.includes(k)))
            a.push('Reconfirm local staff, devices, hours and on-call coverage for ' + l.name);
} if (p.first.kind === 'human' && !q.placements.some(x => x.team === p.first.team && x.access === 'outside' && !['none', 'undecided'].includes(x.device) && x.count > 0))
    a.push('Assign an outside-call answering position to the first-answer team'); if (p.first.kind === 'human' && q.ring === 'undecided')
    a.push('Choose together or ordered ringing'); if (p.first.kind === 'human' && q.ring === 'order' && !q.ringOrder.length)
    a.push('Add the ordered ringing destinations'); for (const r of q.ringOrder)
    if (!canRing(p,r.team,true))
        a.push('Assign an available outside-call position for ordered-ring team '+(p.teams.find(t=>t.id===r.team)?.name||r.team)); if (q.placements.some(x => x.device !== 'none' && x.device !== 'undecided' && x.count === 0))
    a.push('Set a positive endpoint count or choose no direct calls'); if (!q.placements.length)
    a.push('Assign answering positions to teams or rooms'); for (const t of p.teams.filter(t => t.count > 0))
    if (!q.placements.some(x => x.team === t.id))
        a.push('Choose devices or no direct calls for ' + t.name); for (const x of q.placements) {
    if (x.team && !has(x.team))
        a.push('Replace the unavailable team for ' + x.label);
    if (x.device === 'undecided')
        a.push('Choose an endpoint for ' + x.label);
    if (x.count > 1 && x.sharing === 'undecided' && !['none', 'undecided'].includes(x.device))
        a.push('Choose shared identity or separate extensions for ' + x.label);
} for (const r of p.reasons) {
    const team = r.team === '@main' ? p.first.team : r.team;
    const owner = (team && q.teamFallbacks[team]?.owner) || p.busy.owner;
    if (team && owner && team !== owner && has(owner) && !q.terminalApprovals['reason:' + r.id])
        a.push('Confirm that ' + r.label + ' unanswered messages may go to ' + (p.teams.find(t => t.id === owner)?.name || owner) + ' rather than that team’s own mailbox');
} if (p.urgent.enabled && p.urgent.owner && p.urgent.team && p.urgent.owner !== p.urgent.team && !q.terminalApprovals.urgent)
    a.push('Confirm the urgent-miss mailbox owner'); if ([p.first.kind, p.busy.kind, p.after.kind, p.busy.kind === 'queue' ? q.queueExit : ''].includes('assistant')) {
    if (q.assistant.humanWhen === 'selected' && !q.assistant.handoffTasks?.length)
        a.push('Choose which requests can reach the human fallback');
    if (!q.assistant.tasks.length)
        a.push('Choose the virtual receptionist’s permitted tasks');
    if (!has(q.assistant.team))
        a.push('Assign the virtual receptionist’s human fallback');
    if (!has(q.assistant.owner))
        a.push('Assign unfinished virtual receptionist requests');
    a.push('Verify virtual receptionist capabilities; requests are not bookings');
} for (const l of p.languages) {
    const provider = q.languageProviders[l.name] || 'team';
    if (provider === 'service')
        a.push('Verify ' + l.name + ' language-service coverage');
    if (provider === 'arrange' || provider === 'undecided')
        a.push('Arrange confirmed ' + l.name + ' coverage');
    if (l.availability === 'limited' && !q.languageSchedules[l.name]?.some(d => d.open))
        a.push('Set selected coverage hours for ' + l.name);
    const f = q.languageFallbacks[l.name];
    if (f?.kind === 'undecided')
        a.push('Choose the unavailable-language fallback for ' + l.name);
    if (f?.kind === 'team' && !has(f.team))
        a.push('Assign an alternate ' + l.name + ' team');
    if (f?.kind === 'instructions' && (!f.approved || !f.text.trim()))
        a.push('Approve unavailable ' + l.name + ' instructions');
} if (p.urgent.enabled) {
    if (q.urgentKind === 'undecided')
        a.push('Choose the urgent workflow');
    if (q.urgentKind === 'connect') {
        if (q.urgentCoverage === 'undecided')
            a.push('Confirm on-call coverage hours');
        if (q.urgentCoverage === 'selected' && !q.urgentDays.some(d => d.open))
            a.push('Set on-call coverage hours');
        if (q.urgentRoster === 'undecided')
            a.push('Assign a fixed contact or on-call rotation');
        if (q.urgentRoster === 'rotation')
            a.push('Assign and verify the on-call rotation before implementation');
        if (!q.acceptance)
            a.push('Confirm transfer acceptance before reporting a connected on-call handoff');
    }
    if (q.urgentKind === 'priority' && q.urgentAlert === 'undecided')
        a.push('Choose how priority-message owners are alerted');
} if (q.followup === 'yes') {
    if (!has(p.followup.owner))
        a.push('Assign follow-up ownership');
    if (!p.followup.channels.length)
        a.push('Choose follow-up requirements');
    if (q.system)
        a.push('Verify integration with ' + q.system + ' (needs confirmation)');
} for (const date of q.closures)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        a.push('Correct temporary closure dates'); for (const [team, f] of Object.entries(q.teamFallbacks)) {
    if (!has(team) || !has(f.owner) || f.kind === 'backup' && !has(f.team))
        a.push('Resolve the fallback for ' + (p.teams.find(t => t.id === team)?.name || 'a deleted team'));
} for (const [label, owner] of Object.entries(q.followup === 'yes' ? q.followupOwners : {}))
    if (owner && !has(owner))
        a.push('Replace the follow-up owner for ' + label);     if ((q.closures.length > 0 || p.hours.holidays.length > 0) && !q.hoursExceptionsConfirmed)
        a.push('Confirm holiday and temporary-closure handling');
    return a; }
export function inSchedule(days: Day[], timezone: string, date: Date) { try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'long', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(date);
    const get = (k: string) => parts.find(x => x.type === k)?.value || '';
    const d = days.find(d => d.day === get('weekday')), t = get('hour') + ':' + get('minute');
    return !!d?.open && t >= d.start && t < d.end && !(d.breakStart && t >= d.breakStart && t < d.breakEnd);
}
catch {
    return false;
} }
export function publicInstructions(text: string) { return text.replace(/(?:\+?\d[\d ().-]{7,}\d)/g, '[private number omitted]'); }
export function validPolicy(q: Policy): boolean { try {
    const schedules = [...Object.values(q.languageSchedules), ...Object.values(q.teamAvailability), q.urgentDays];
    const opening = q.opening, continuity = q.continuity;
    return ['none','selected','undecided'].includes(q.languageDecision)&&['message','backup','assistant','undecided'].includes(q.queueExit)&&['inbox','practice','email','undecided'].includes(q.notification)&&['request','selected','unfinished'].includes(q.assistant.humanWhen)&&['fixed','rotation','undecided'].includes(q.urgentRoster)&&['team','message','instructions'].includes(q.urgentBackup)&&['email','service','undecided'].includes(q.urgentAlert)&&['information','message','undecided'].includes(q.beforeOpening)&&Object.values(q.languageProviders).every(v=>['team','service','arrange','undecided'].includes(v))&&Object.values(q.followupOwners).every(v=>typeof v==='string')&&(!q.assistant.handoffTasks||q.assistant.handoffTasks.every(x=>typeof x==='string'))&&[1, 2].includes(q.version) && ['own', 'shared', 'undecided'].includes(q.number) && ['shared', 'menu', 'separate', 'undecided'].includes(q.locationEntry) && ['together', 'order', 'undecided'].includes(q.ring) && ['yes', 'calls', 'skip'].includes(q.followup) && ['connect', 'priority', 'instructions', 'undecided', 'none'].includes(q.urgentKind) && ['always', 'closed', 'open', 'selected', 'undecided'].includes(q.urgentCoverage) && Number.isInteger(q.rooms) && q.rooms >= 0 && q.rooms <= 100 && typeof q.roomsSpecified === 'boolean' && Number.isInteger(q.menuRetries) && q.menuRetries >= 0 && q.menuRetries <= 2 && q.placements.length <= 100 && new Set(q.placements.map(x => x.id)).size === q.placements.length && q.placements.every(x => ['id', 'team', 'label', 'extension'].every(k => typeof x[k as 'id'] === 'string') && ['desk', 'computer', 'mobile', 'none', 'undecided'].includes(x.device) && ['shared', 'separate', 'undecided'].includes(x.sharing) && ['outside', 'internal'].includes(x.access) && Number.isInteger(x.count) && x.count >= 0 && x.count <= 999) && q.ringOrder.length <= 20 && q.ringOrder.every(x => typeof x.team === 'string' && Number.isFinite(x.seconds) && x.seconds >= 5 && x.seconds <= 600) && schedules.every(ds => Array.isArray(ds) && ds.length <= 7 && ds.every(d => typeof d.day === 'string' && typeof d.open === 'boolean' && [d.start, d.end, d.breakStart, d.breakEnd].every(x => typeof x === 'string'))) && Object.values(q.languageFallbacks).every(f => ['callback', 'team', 'instructions', 'undecided'].includes(f.kind) && typeof f.team === 'string' && typeof f.text === 'string' && typeof f.approved === 'boolean') && Object.values(q.teamFallbacks).every(f => ['message', 'backup'].includes(f.kind) && typeof f.team === 'string' && typeof f.owner === 'string') && q.closures.every(x => typeof x === 'string') && q.priorities.every(x => typeof x === 'string') && q.assistant.tasks.every(x => typeof x === 'string') && typeof q.handoffTested === 'boolean' && typeof q.onCallRouteVerified === 'boolean' && typeof q.e911Confirmed === 'boolean' && typeof q.baaAcknowledged === 'boolean' && ['essential', 'balanced', 'automation', 'undecided'].includes(q.bomTier) && opening && typeof opening.date === 'string' && ['day', 'month', 'none'].includes(opening.precision || 'none') && ['planning', 'build-out', 'near', 'undecided'].includes(opening.construction) && ['new', 'porting', 'undecided'].includes(opening.numbers) && ['known', 'unknown', 'survey', 'undecided'].includes(opening.internet) && ['known', 'unknown', 'survey', 'undecided'].includes(opening.network) && typeof opening.pms === 'string' && continuity && ['undecided', 'failover', 'none', 'survey'].includes(continuity.internet) && ['undecided', 'ups', 'none', 'survey'].includes(continuity.power) && ['undecided', 'cellular', 'forward', 'none'].includes(continuity.backupRouting) && typeof continuity.notes === 'string' && q.terminalApprovals && Object.values(q.terminalApprovals).every(v => typeof v === 'boolean') && typeof (q.cityState ?? '') === 'string' && ['weekdays', 'always', 'custom', 'undecided'].includes(q.hoursPreset || 'weekdays') && ['reception','administration','clinical','split','undecided'].includes(q.billingPerformedBy || 'undecided') && ['urgent_only','all_calls','undecided'].includes(q.urgentScope || 'undecided') && typeof (q.pendingClinicianRoute ?? false) === 'boolean';
}
catch {
    return false;
} }
