import { hasTeam, teamName, type Plan } from './config';

export type ClaimStatus = 'configured' | 'proposed' | 'unresolved' | 'tested';
export type Claim = { id: string; label: string; status: ClaimStatus; detail: string };

export function terminals(p: Plan) {
    const q = p.policy;
    const rows: { id: string; label: string; owner: string; source: string; sensitive: boolean }[] = [];
    if (p.busy.kind !== 'undecided')
        rows.push({ id: 'busy', label: 'Busy / unanswered message', owner: p.busy.owner, source: p.first.team || 'first answer', sensitive: false });
    for (const r of p.reasons) {
        const team = r.team === '@main' ? p.first.team : r.team;
        if (!team)
            continue;
        const owner = q.teamFallbacks[team]?.owner || p.busy.owner;
        const sensitive = p.teams.find(t => t.id === team)?.role === 'clinical' || /clinical|billing/i.test(r.label);
        rows.push({ id: 'reason:' + r.id, label: r.label + ' unanswered', owner, source: team, sensitive });
    }
    if (p.after.kind !== 'undecided' && p.after.kind !== 'information')
        rows.push({ id: 'after', label: 'After-hours messages', owner: p.after.owner, source: 'closed hours', sensitive: true });
    if (p.urgent.enabled)
        rows.push({ id: 'urgent', label: 'Urgent / on-call miss', owner: p.urgent.owner, source: p.urgent.team || 'on-call', sensitive: true });
    if ([p.first.kind, p.busy.kind, p.after.kind, p.busy.kind === 'queue' ? q.queueExit : ''].includes('assistant'))
        rows.push({ id: 'assistant', label: 'Unfinished virtual receptionist requests', owner: q.assistant.owner, source: 'virtual receptionist', sensitive: false });
    for (const l of p.languages)
        rows.push({ id: 'language:' + l.name, label: l.name + ' unavailable callback', owner: l.fallback, source: l.name, sensitive: false });
    return rows;
}

function needsShareApproval(p: Plan, t: ReturnType<typeof terminals>[number]) {
    if (!t.owner || !hasTeam(p, t.owner))
        return true;
    if (t.owner === t.source)
        return false;
    return t.sensitive || t.owner !== t.source;
}

export function unapprovedTerminals(p: Plan) {
    return terminals(p).filter(t => needsShareApproval(p, t) && !p.policy.terminalApprovals[t.id]);
}

export function claims(p: Plan): Claim[] {
    const q = p.policy, list: Claim[] = [];
    const add = (id: string, label: string, status: ClaimStatus, detail: string) => list.push({ id, label, status, detail });
    add('staff', 'Staff counts', p.teams.some(t => t.count > 0) ? 'configured' : 'unresolved', p.teams.filter(t => t.count > 0).map(t => t.name + ' ' + t.count).join('; ') || 'No staff recorded');
    add('positions', 'Answering positions', p.endpoints.undecided ? 'unresolved' : 'configured', `${p.endpoints.desk} desk, ${p.endpoints.computer} computer, ${p.endpoints.mobile} mobile. People, phones and extensions are separate decisions.`);
    add('rooms', 'Clinical rooms', q.roomsSpecified ? 'configured' : 'unresolved', q.roomsSpecified ? q.rooms + ' rooms specified. Placement still needs a floor plan or site survey.' : 'Room count not specified. The illustration is not a floor plan.');
    add('routing', 'Call routing', p.first.kind === 'undecided' || p.busy.kind === 'undecided' ? 'unresolved' : 'configured', 'Owner-chosen first answer and busy path.');
    if (p.after.kind === 'service')
        add('after', 'After-hours answering service', 'proposed', 'Contract, permitted actions and booking authority need verification. An answering service is not automatically authorized to book.');
    else if (p.after.kind === 'assistant')
        add('after', 'After-hours virtual receptionist', 'proposed', 'Language handling, integrations and supported tasks need confirmation.');
    else if (p.after.kind === 'undecided')
        add('after', 'After-hours handling', 'unresolved', 'Closed-hours path not chosen.');
    else
        add('after', 'After-hours handling', 'configured', p.after.kind === 'information' ? 'Approved information, then end.' : 'Owned voicemail.');
    if ([p.first.kind, p.busy.kind, p.after.kind, q.queueExit].includes('assistant'))
        add('assistant', 'Virtual receptionist', q.assistant.status === 'not-configured' ? 'unresolved' : 'proposed', 'Permitted tasks are requirements until verified. Appointment requests are not bookings.');
    for (const l of p.languages) {
        const provider = q.languageProviders[l.name] || 'team';
        add('language-' + l.name, l.name + ' coverage', provider === 'team' && hasTeam(p, l.team) ? 'configured' : provider === 'service' ? 'proposed' : 'unresolved', `Identification: ${l.mechanism}. Availability: ${l.availability}. Channel coverage is not verified until tested.`);
    }
    if (p.urgent.enabled && q.urgentKind === 'connect')
        add('urgent', 'On-call live connect', q.onCallRouteVerified && q.handoffTested ? 'tested' : q.acceptance ? 'proposed' : 'unresolved', q.handoffTested ? 'Handoff test recorded in this plan (not a live installation certificate).' : 'Simulated recipient acceptance is not a real handoff test. A verified on-call route is still required.');
    else if (p.urgent.enabled)
        add('urgent', 'Urgent handling', p.urgent.approved ? 'configured' : 'unresolved', q.urgentKind === 'priority' ? 'Priority message is not clinician contact.' : 'Practice-approved instructions only.');
    if (q.system)
        add('pms', 'Practice system', 'proposed', q.system + ' — integration and writeback need confirmation.');
    if (p.mode === 'opening')
        add('opening', 'Opening date', q.opening.date ? 'configured' : 'unresolved', q.opening.date || 'No opening date recorded. The planner does not infer that the practice is open.');
    for (const t of unapprovedTerminals(p))
        add('terminal-' + t.id, t.label, 'unresolved', `Currently owned by ${teamName(p, t.owner)}. Confirm this destination; a clinical or billing miss should not silently share reception voicemail.`);
    return list;
}

export function statusLabel(s: ClaimStatus) {
    return s === 'configured' ? 'Configured by the owner' : s === 'proposed' ? 'Proposed, needs technical verification' : s === 'tested' ? 'Tested in a real deployment' : 'Unresolved, cannot approve';
}
