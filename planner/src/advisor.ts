import { decisions, journeySeconds, menuDigits, overflowTeams, teamName, urgentMechanism, type Plan } from './config';
import { formatOpening, formatTime, hoursSummary } from './flow';
import { inventory } from './policy';
import { provisioningMap, ringMembers } from './provisioning';
import { unapprovedTerminals } from './status';
import { billOfMaterials, scopeAgainstQuote } from './bom';
import { openingChecklist } from './opening';
import { ownerQuestionCount, readiness } from './readiness';

export type Insight = {
    id: string;
    severity: 'critical' | 'high' | 'note';
    title: string;
    detail: string;
    category: 'owner' | 'provider' | 'test';
};

export type Action = {
    id: string;
    label: string;
    detail: string;
};

export type Milestone = {
    id: string;
    label: string;
    window: string;
    status: 'ready' | 'blocked' | 'done' | 'needed';
    note: string;
};

export type PurchaseBand = 'required' | 'optional' | 'not-yet';

export { urgentMechanism };

function receptionCount(p: Plan) {
    return p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
}

function receptionSharing(p: Plan): Plan['policy']['placements'][number]['sharing'] {
    return p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing || 'undecided';
}

export function workMobileNoted(p: Plan) {
    return /work mobile answering|work app \/ follow me/i.test((p.policy.notes || '') + ' ' + (p.policy.continuity.notes || ''));
}

export function urgentMechanismNote(p: Plan) {
    const m = urgentMechanism(p);
    const dentist = p.specialty === 'Dental' ? 'dentist' : 'clinician';
    if (p.policy.urgentKind === 'connect' && (p.policy.urgentCoverage === 'closed' || p.policy.urgentCoverage === 'always' || m === 'menu-digit'))
        return 'After hours, callers press 9 to try the on-call ' + dentist + '. During open hours, the front desk spots urgent calls after they answer.';
    if (m === 'staff')
        return 'A person who already answered can identify an urgent request. The published number does not route to on-call by itself.';
    if (m === 'menu-digit')
        return 'The keypad must offer a dedicated urgent option (digit 9). A reason menu cannot classify spoken urgency.';
    if (m === 'assistant')
        return 'Urgent classification is a proposed virtual-receptionist capability until a vendor verifies it on a live call.';
    return 'No urgent-detection path is configured.';
}

export function fingerprint(p: Plan) {
    const body = JSON.stringify({
        planId: p.planId,
        revision: p.revision,
        mode: p.mode,
        name: p.name,
        specialty: p.specialty,
        teams: p.teams,
        endpoints: p.endpoints,
        first: p.first,
        reasons: p.reasons,
        busy: p.busy,
        menu: p.menu,
        languages: p.languages,
        hours: p.hours,
        after: p.after,
        urgent: p.urgent,
        followup: p.followup,
        current: p.current,
        confirmed: p.confirmed,
        policy: p.policy,
        locations: p.locations
    });
    let h = 2166136261;
    for (let i = 0; i < body.length; i++) {
        h ^= body.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

export function identity(p: Plan) {
    return { planId: p.planId, revision: p.revision, checksum: fingerprint(p) };
}

export function isLocked(p: Plan) {
    return !!p.lock && p.lock.checksum === fingerprint(p);
}

export function queuePlan(p: Plan) {
    if (p.busy.kind !== 'queue')
        return { needed: false, shared: false, queues: [] as { team: string; label: string; members: ReturnType<typeof ringMembers>; owner: string; wait: number }[] };
    const queues = overflowTeams(p).map(team => ({
        team,
        label: teamName(p, team),
        members: ringMembers(p, team),
        owner: p.policy.teamFallbacks[team]?.owner || p.busy.owner,
        wait: p.busy.wait
    }));
    return { needed: true, shared: queues.length <= 1, queues };
}

export function queueAgents(p: Plan) {
    const plan = queuePlan(p);
    const members = [...new Map(plan.queues.flatMap(q => q.members).map(m => [m.extension, m])).values()];
    return {
        needed: plan.needed,
        teamIds: plan.queues.map(q => q.team),
        members,
        note: !plan.needed
            ? 'This plan does not use a wait queue.'
            : !members.length
                ? 'Queue membership is unresolved. Do not provision a Call Center until the overflowing teams have answering identities.'
                : plan.shared
                    ? `Queue agents are the outside identities of ${plan.queues[0].label}: ${plan.queues[0].members.map(m => m.extension + ' (' + m.label + ')').join(', ')}. If nobody is logged in, the queue still exits after ${p.busy.wait}s.`
                    : `Separate waits per destination — ${plan.queues.map(q => q.label + ' queue agents ' + (q.members.map(m => m.extension).join(', ') || 'unassigned') + ', then ' + teamName(p, q.owner)).join('; ')}. A clinical wait is not answered by reception unless that team is the destination.`
    };
}

export function ownerActions(p: Plan): Action[] {
    const items: Action[] = decisions(p).map((d, i) => ({
        id: 'q-' + i,
        label: d,
        detail: /before-opening|before opening/i.test(d)
            ? 'Do not publish the number until this destination exists.'
            : /porting|numbers/i.test(d)
                ? 'Porting has carrier lead time. Do not cancel existing service before a port starts.'
                : /desk, computer, or mobile|phone or computer/.test(d)
                    ? 'Who answers is already in the plan if you named a front desk. This is the device count, not another staff question.'
                    : /stays with the front desk/.test(d)
                        ? 'Callers still reach a person. Pick a different destination only if another team should own that reason.'
                        : 'Still open in the planner.'
    }));
    for (const t of unapprovedTerminals(p))
        items.push({ id: 'term-' + t.id, label: 'Approve who owns “' + t.label + '”', detail: 'Currently ' + (teamName(p, t.owner) || 'unassigned') + '. A miss should not silently share reception voicemail.' });
    return unique(items);
}

export function providerRequirements(p: Plan): Action[] {
    const q = p.policy, items: Action[] = [];
    const qa = queueAgents(p);
    if (qa.needed) {
        const plan = queuePlan(p);
        items.push({
            id: 'queue',
            label: plan.shared ? 'Install the wait queue with named agents and a hard exit' : 'Install one wait queue per menu destination',
            detail: plan.shared
                ? (qa.members.length ? qa.members.length + ' named agents; exit after ' + p.busy.wait + 's. Extensions are in the implementation spec.' : qa.note)
                : plan.queues.map(q => q.label + ': ' + (q.members.map(m => m.extension).join(', ') || 'unassigned') + ', then ' + teamName(p, q.owner)).join('. ')
        });
    }
    if (p.policy.roomsSpecified && p.policy.rooms > 0)
        items.push({ id: 'rooms', label: 'Do not pull room phones from room count', detail: p.policy.rooms + ' clinical room' + (p.policy.rooms === 1 ? '' : 's') + ' specified. Placement still needs a floor plan or site survey.' });
    if ([p.first.kind, p.busy.kind, p.after.kind, q.queueExit].includes('assistant'))
        items.push({ id: 'ai', label: 'Verify virtual-receptionist tasks, languages, and handoff', detail: 'Appointment requests recorded here are not bookings until a vendor demonstrates writeback.' });
    if (p.after.kind === 'service')
        items.push({ id: 'svc', label: 'Confirm the answering-service contract and permitted actions', detail: 'A person after hours is not automatically authorized to book or give clinical advice.' });
    if (p.urgent.enabled && q.urgentKind === 'connect' && urgentMechanism(p) === 'menu-digit' && p.first.kind === 'menu')
        items.push({ id: 'digit9', label: 'Program digit 9 on the open-hours menu for urgent calls', detail: urgentMechanismNote(p) });
    if (p.policy.notification !== 'undecided')
        items.push({ id: 'notify', label: 'Configure message notification delivery', detail: 'The planner records the requirement (' + p.policy.notification + '). Delivery is not implemented here.' });
    return items;
}

export function testsBeforeOpen(p: Plan): Action[] {
    const q = p.policy, items: Action[] = [];
    if (p.urgent.enabled && q.urgentKind === 'connect') {
        if (!q.onCallRouteVerified)
            items.push({ id: 'route', label: 'Supply a verified on-call contact route', detail: 'This planner does not collect private numbers.' });
        items.push({ id: 'handoff', label: 'Complete a live on-call acceptance test on installed phones', detail: q.handoffTested ? 'Marked done in the planner — that is not an installation certificate.' : 'Simulated acceptance is not a real test.' });
    }
    if (p.mode === 'opening')
        items.push({ id: 'e911', label: 'Verify the emergency-calling address (E911) with the installer', detail: q.e911Confirmed ? 'Owner acknowledged the need. That is not a carrier filing.' : 'Not confirmed.' });
    items.push({ id: 'two-calls', label: 'Demonstrate two simultaneous calls where the plan requires independent positions', detail: 'Shared identity is one concurrent answer, even with two devices registered.' });
    if (mayNeedPhi(p))
        items.push({ id: 'baa', label: 'Confirm whether vendors handling patient information need a BAA', detail: q.baaAcknowledged ? 'Acknowledged as a requirement. This planner is not legal advice.' : 'Not acknowledged.' });
    return items;
}

function mayNeedPhi(p: Plan) {
    return p.after.kind === 'service' || p.after.kind === 'assistant' || p.first.kind === 'assistant' || p.busy.kind === 'assistant' || p.policy.followup === 'yes';
}

export function insights(p: Plan): Insight[] {
    const q = p.policy, list: Insight[] = [];
    const j = journeySeconds(p, { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false });
    if (p.mode === 'opening' && q.beforeOpening === 'undecided')
        list.push({ id: 'before', severity: 'critical', category: 'owner', title: 'Approve your pre-opening phone behavior', detail: 'Your future phone system is planned, but incoming patient calls before opening day have no approved destination. Do not publish the number until this is chosen.' });
    else if (p.mode === 'opening' && q.beforeOpening !== 'undecided')
        list.push({ id: 'before-ok', severity: 'note', category: 'owner', title: 'Before-opening destination is recorded', detail: q.beforeOpening === 'message' ? 'Callback owner: ' + (teamName(p, q.beforeOpeningOwner || '') || 'unset') + '.' : 'An approved announcement will play until opening day.' });
    if (p.urgent.enabled && q.urgentKind === 'connect') {
        list.push({
            id: 'urgent',
            severity: q.handoffTested ? 'note' : 'critical',
            category: q.handoffTested ? 'test' : 'test',
            title: q.handoffTested ? 'On-call path is recorded' : 'Confirm your urgent-call handoff',
            detail: urgentMechanismNote(p) + (q.handoffTested ? ' A live test is marked in the planner; still confirm it on installed phones.' : ' An on-call transfer is proposed but has not been tested on a real phone.')
        });
    }
    const qa = queueAgents(p);
    if (qa.needed && !qa.members.length)
        list.push({ id: 'queue', severity: 'high', category: 'provider', title: 'The wait queue has no assigned agents', detail: qa.note });
    else if (qa.needed)
        list.push({
            id: 'queue-ok',
            severity: 'note',
            category: 'owner',
            title: queuePlan(p).shared ? 'One wait, one answering team' : 'Each call reason waits with its own staff',
            detail: qa.note
        });
    if (j.total >= 90)
        list.push({ id: 'wait', severity: 'high', category: 'owner', title: 'A caller can wait ' + j.total + ' seconds before a message', detail: (j.parts.map(x => x.seconds + 's ' + x.label).join(' + ') || 'Ring then busy path') + '. Greeting playback and menu time are extra. Decide whether that wait is acceptable.' });
    const map = provisioningMap(p);
    const shared = map.groups.filter(g => g.sharing === 'shared' && g.deviceCount > 1);
    if (shared.length)
        list.push({ id: 'share', severity: 'note', category: 'owner', title: 'Some devices share one answering identity', detail: shared.map(g => g.label + ': ' + g.deviceCount + ' devices, 1 concurrent call.').join(' ') });
    const recN = receptionCount(p);
    const share = receptionSharing(p);
    const independentNow = map.groups.reduce((n, g) => n + g.concurrent, 0);
    if (share === 'separate' && recN > 1 && independentNow < recN)
        list.push({ id: 'share-intent', severity: 'high', category: 'owner', title: recN + ' front-desk lines so both can pick up', detail: 'That is separate identities, not one shared phone. Device models are not chosen yet. This is not a phone-per-room order.' });
    else if (share === 'shared' && recN > 1)
        list.push({ id: 'share-one', severity: 'note', category: 'owner', title: 'Front desk shares one line', detail: 'Two people at the desk are still one conversation at a time until you add a second identity.' });
    if (workMobileNoted(p))
        list.push({ id: 'work-mobile', severity: 'note', category: 'owner', title: 'A work mobile can ring', detail: 'Use a work app or Follow Me. A personal cell number is not stored and must not be spoken in any recording.' });
    const lunch = p.hours.days.find(d => d.breakStart && d.breakEnd);
    if (lunch)
        list.push({ id: 'lunch', severity: 'note', category: 'owner', title: 'Lunch is a scheduled close', detail: 'Phones follow the closed-hours path ' + formatTime(lunch.breakStart) + '–' + formatTime(lunch.breakEnd) + '. That is not overnight voicemail, even if the recording is similar.' });
    const extra = billOfMaterials(p).warnings;
    for (const w of extra.slice(0, 2))
        list.push({ id: 'bom-' + w.slice(0, 12), severity: 'high', category: 'owner', title: 'Check this against any quote', detail: w });
    return list;
}

export function headlineInsights(p: Plan) {
    const pin = ['share-intent', 'share-one', 'work-mobile', 'lunch', 'before', 'before-ok'];
    const all = insights(p);
    const pinned = pin.map(id => all.find(i => i.id === id)).filter((x): x is Insight => !!x);
    const rest = all
        .filter(i => !pin.includes(i.id))
        .sort((a, b) => ({ critical: 0, high: 1, note: 2 }[a.severity] - { critical: 0, high: 1, note: 2 }[b.severity]));
    return [...pinned, ...rest].slice(0, 4);
}

export function purchaseBands(p: Plan) {
    const inv = inventory(p);
    const map = provisioningMap(p);
    const rooms = p.policy.roomsSpecified ? p.policy.rooms : 0;
    const required = map.groups.filter(g => g.device !== 'none' && g.device !== 'undecided' && g.concurrent > 0).map(g => ({
        item: g.label,
        qty: String(g.deviceCount),
        purpose: g.sharing === 'separate'
            ? g.deviceCount + ' independent ' + deviceWord(g.device) + 's so more than one call can be handled at once.'
            : g.deviceCount + ' ' + deviceWord(g.device) + (g.deviceCount > 1 ? 's sharing one identity — one concurrent call.' : '.'),
        band: 'required' as PurchaseBand
    }));
    const recN = receptionCount(p);
    const share = receptionSharing(p);
    if (share === 'separate' && recN > 1 && !required.some(r => /front desk|reception/i.test(r.item)))
        required.push({
            item: 'Front-desk lines so both can pick up',
            qty: String(recN),
            purpose: 'Required. Separate identities, models not chosen yet. Not a phone per room.',
            band: 'required'
        });
    const optional: { item: string; qty: string; purpose: string; band: PurchaseBand }[] = [];
    if ((inv.mobile || workMobileNoted(p)) && !required.some(r => /mobile/i.test(r.item) || /Administration/i.test(r.item)))
        optional.push({ item: 'Work-mobile answering', qty: inv.mobile ? String(inv.mobile) : 'App / Follow Me', purpose: 'A work app can ring. Do not print a personal cell on a recording or wall card.', band: 'optional' });
    if ([p.first.kind, p.busy.kind, p.after.kind].includes('assistant'))
        optional.push({ item: 'Virtual receptionist', qty: 'Selected', purpose: 'Optional service. Scope stays proposed until verified. Requests are not bookings.', band: 'optional' });
    const alsoRequired = [{
        item: 'After-hours coverage as specified',
        qty: '1',
        purpose: afterLabel(p) + ' — quote the method you chose, not a generic auto attendant.',
        band: 'required' as PurchaseBand
    }];
    const notYet: { item: string; qty: string; purpose: string; band: PurchaseBand }[] = [];
    if (rooms)
        notYet.push({ item: 'Clinical-room phones', qty: '0 selected', purpose: rooms + ' rooms to evaluate. Do not treat room count as a shopping quantity.', band: 'not-yet' });
    const monthly = Number(String(p.current.monthly || '').replace(/[^0-9.]/g, ''));
    const entered = p.policy.comparison && monthly
        ? { provider: p.current.provider || 'Current provider', monthly, lines: p.current.lines, notes: p.current.notes, months12: monthly * 12, months24: monthly * 24, months36: monthly * 36 }
        : null;
    return { required, optional, alsoRequired, notYet, entered, warnings: billOfMaterials(p).warnings, missing: p.policy.comparison ? scopeAgainstQuote(p) : [] };
}

export type BuyLine = {
    qty: number | null;
    label: string;
    note: string;
};

/** Shopping quantities from answering policy. Rooms and staff are not phones. Models stay unset. */
export function buySummary(p: Plan) {
    const inv = inventory(p);
    const recN = receptionCount(p);
    const share = receptionSharing(p);
    const mobileNoted = workMobileNoted(p);
    const talked = share !== 'undecided' || inv.desk > 0 || inv.computer > 0 || inv.mobile > 0 || mobileNoted || p.first.kind === 'human';
    let desk: number | null = inv.desk > 0 ? inv.desk : null;
    let deskNote = 'Reception phones';
    if (desk == null) {
        if (share === 'separate' && recN > 1) {
            desk = recN;
            deskNote = 'Both can pick up';
        }
        else if (share === 'shared' && recN > 0) {
            desk = 1;
            deskNote = recN > 1 ? 'One shared line' : 'One answering position';
        }
        else if (p.first.kind === 'human' && recN === 1) {
            desk = 1;
            deskNote = 'One answering position';
        }
        else if (p.first.kind === 'human' && recN > 1) {
            deskNote = 'Choose if both can pick up';
        }
        else
            deskNote = 'Not chosen yet';
    }
    else if (share === 'separate' && recN > 1)
        deskNote = recN + ' people at the front';
    const computer = talked ? inv.computer : null;
    const mobile = !talked ? null : inv.mobile > 0 ? inv.mobile : mobileNoted ? 1 : 0;
    const rooms = p.policy.roomsSpecified ? p.policy.rooms : 0;
    return {
        desk: { qty: desk, label: desk === 1 ? 'Desk phone' : 'Desk phones', note: deskNote } satisfies BuyLine,
        computer: { qty: computer, label: computer === 1 ? 'Computer' : 'Computers', note: computer ? 'Computer answering' : talked ? 'None yet' : 'Not chosen yet' } satisfies BuyLine,
        mobile: { qty: mobile, label: mobile === 1 ? 'Mobile' : 'Mobiles', note: mobileNoted ? 'Work app' : mobile ? 'Mobile answering' : talked ? 'None yet' : 'Not chosen yet' } satisfies BuyLine,
        rooms,
        roomsNote: rooms
            ? rooms + (rooms === 1 ? ' treatment room is a chair, not a phone' : ' treatment rooms are chairs, not a phone order')
            : '',
        deskKnown: desk != null && desk > 0
    };
}

export function reviewOpenActions(p: Plan) {
    const buy = buySummary(p);
    const filtered = ownerActions(p).filter(a => !(buy.deskKnown && /desk, computer, or mobile|phone or computer for answering/i.test(a.label)));
    return { items: filtered.slice(0, 3), more: Math.max(0, filtered.length - 3), total: filtered.length };
}

function deviceWord(d: string) {
    return d === 'desk' ? 'desk phone' : d === 'computer' ? 'computer position' : d === 'mobile' ? 'mobile' : d;
}

function afterLabel(p: Plan) {
    return ({ information: 'Play information, then end', message: 'Owned voicemail', service: 'Answering service', assistant: 'Virtual receptionist', undecided: 'Undecided' } as Record<string, string>)[p.after.kind];
}

export function openingRoadmap(p: Plan): Milestone[] {
    if (p.mode !== 'opening')
        return [];
    const q = p.policy;
    const construction = q.opening.construction === 'planning' || q.opening.construction === 'build-out';
    const checks = openingChecklist(p);
    const byId = (id: string) => checks.find(c => c.id === id);
    const done = (id: string) => !!byId(id)?.done;
    return [
        { id: 'req', label: 'Freeze answering requirements', window: 'Can start today', status: p.endpoints.undecided ? 'needed' : 'done', note: 'People, devices, and identities are separate decisions.' },
        { id: 'before', label: 'Approve before-opening call behavior', window: 'Before the number is published', status: q.beforeOpening === 'undecided' ? 'needed' : 'done', note: q.beforeOpening === 'undecided' ? 'No safe destination exists for a patient who calls early.' : 'Recorded. Repoint the DID on opening morning.' },
        { id: 'survey', label: 'Internet and cabling site survey', window: construction ? 'Blocked until the space can be surveyed' : 'Schedule with the contractor', status: done('internet') && done('network') ? 'done' : construction ? 'blocked' : 'needed', note: construction ? 'Cabling, PoE, and drops belong on the contractor brief — not on staff count.' : (byId('network')?.note || '') },
        { id: 'numbers', label: 'Numbers — new or port', window: q.opening.numbers === 'porting' ? 'Carrier lead time. Do not cancel existing service before the port starts.' : 'Can proceed once the destination is approved', status: q.opening.numbers === 'undecided' ? 'needed' : 'ready', note: q.opening.numbers === 'new' ? 'New published number.' : q.opening.numbers === 'porting' ? 'Keep the current service live until the port completes.' : 'Undecided.' },
        { id: 'buy', label: 'Order only the required devices', window: 'After quantities are frozen', status: p.endpoints.undecided ? 'blocked' : 'ready', note: 'Do not order a phone per clinical room unless the workflow needs one.' },
        { id: 'recordings', label: 'Approve menu and after-hours recordings', window: 'Before go-live', status: p.after.kind === 'undecided' ? 'needed' : 'ready', note: 'Wording is a policy the installer records. It is not live until uploaded.' },
        { id: 'e911', label: 'Verify emergency-calling address', window: 'On the installed system, before first patient day', status: q.e911Confirmed ? 'done' : 'needed', note: 'Checking a box in this planner is not a carrier filing.' },
        { id: 'test', label: 'Live acceptance tests', window: q.opening.date ? 'Before ' + q.opening.date : 'Before first patient day', status: q.handoffTested ? 'done' : 'needed', note: 'Two simultaneous calls where required, plus the on-call handoff if you selected one.' }
    ];
}

export function glance(p: Plan) {
    const map = provisioningMap(p);
    const j = journeySeconds(p, { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false });
    const ready = readiness(p);
    const pretty = formatOpening(p);
    const rooms = p.policy.roomsSpecified ? p.policy.rooms : 0;
    const specialty = (p.specialty || 'practice').toLowerCase();
    const practice = p.name.trim() || 'Your practice';
    const independent = map.groups.reduce((n, g) => n + g.concurrent, 0);
    const planned = receptionSharing(p) === 'separate' && receptionCount(p) > 1 ? receptionCount(p) : 0;
    const positions = independent || planned;
    const remaining = ownerQuestionCount(p);
    const dek = p.mode === 'opening'
        ? `${rooms ? rooms + '-room ' : ''}${specialty} practice${pretty ? ' · target opening ' + pretty : ''}.`.replace(/^ /, '')
        : 'A vendor-neutral record of how this practice wants calls answered, transferred, and followed up.';
    return {
        practice,
        dek,
        metrics: [
            { value: positions ? String(positions) : '—', label: independent ? 'Independent answering positions' : positions ? 'Independent lines required' : 'Independent answering positions' },
            { value: String(remaining), label: remaining === 1 ? 'Owner decision remaining' : 'Owner decisions remaining' },
            { value: String(j.total || p.busy.seconds) + ' s', label: 'Modeled unanswered wait' }
        ],
        waitNote: j.total
            ? j.parts.map(x => x.seconds + 's ' + x.label).join(' + ') + ', excluding greeting and menu time.'
            : 'Ringing timeout, then the busy path. Greeting time is extra.',
        ready
    };
}

export type CallBranch = {
    digit: string;
    label: string;
    team: string;
    ring: string;
    answered: string;
    missed: string;
    then: string;
    agents: string;
};

function overflowFor(p: Plan, team: string, urgent: boolean): Pick<CallBranch, 'ring' | 'missed' | 'then' | 'agents'> {
    if (urgent) {
        const owner = teamName(p, p.urgent.owner);
        const then = p.policy.urgentBackup === 'team'
            ? 'Backup, then message → ' + owner
            : p.policy.urgentBackup === 'instructions'
                ? 'Approved urgent recording'
                : 'Message → ' + owner;
        return {
            ring: p.urgent.seconds + 's',
            missed: 'On-call timeout ' + p.urgent.seconds + 's',
            then,
            agents: teamName(p, p.urgent.team) || 'On-call unset'
        };
    }
    const q = queuePlan(p).queues.find(x => x.team === team);
    const owner = teamName(p, q?.owner || p.busy.owner);
    const agents = q?.members.length ? q.members.map(m => m.label).join(', ') : (teamName(p, team) || 'Agents unresolved');
    if (p.busy.kind === 'queue')
        return { ring: p.busy.seconds + 's', missed: 'Queue ' + (q?.wait || p.busy.wait) + 's · ' + (q?.label || teamName(p, team)), then: 'Message → ' + owner, agents };
    if (p.busy.kind === 'backup')
        return { ring: p.busy.seconds + 's', missed: 'Backup team', then: 'Message → ' + owner, agents };
    if (p.busy.kind === 'assistant')
        return { ring: p.busy.seconds + 's', missed: 'Virtual receptionist overflow (proposed)', then: 'Unfinished request → ' + owner, agents };
    return { ring: p.busy.seconds + 's', missed: 'Owned message', then: 'Message → ' + owner, agents };
}

/** One column per menu digit (or the single human-first team), drawn from the same graph as Fusion. */
export function callBranches(p: Plan): CallBranch[] {
    if (p.first.kind === 'menu')
        return menuDigits(p).map(d => ({
            digit: d.digit,
            label: d.kind === 'urgent' ? 'Urgent practice matter' : d.label,
            team: teamName(p, d.team) || d.label,
            answered: 'Connect — path ends',
            ...overflowFor(p, d.team, d.kind === 'urgent')
        }));
    if (p.first.kind === 'human' && p.first.team)
        return [{
            digit: '',
            label: teamName(p, p.first.team),
            team: teamName(p, p.first.team),
            answered: 'Connect — path ends',
            ...overflowFor(p, p.first.team, false)
        }];
    if (p.first.kind === 'assistant')
        return [{
            digit: '',
            label: 'Virtual receptionist',
            team: teamName(p, p.policy.assistant.team) || 'Human fallback unset',
            ring: 'Proposed',
            answered: 'Handled if the vendor verifies the task',
            missed: 'Human fallback / unfinished request',
            then: 'Owner → ' + (teamName(p, p.policy.assistant.owner) || 'unset'),
            agents: 'Proposed until verified'
        }];
    return [];
}

export function callMaps(p: Plan) {
    const rec = p.first.kind === 'human' && p.first.team
        ? (p.teams.find(t => t.id === p.first.team)?.name || 'Front desk')
        : 'Front desk';
    const mechanism = urgentMechanism(p);
    const mailbox = (id: string) => p.teams.find(t => t.id === id)?.name || 'unset';
    const owner = mailbox(p.busy.owner);
    const afterOwner = mailbox(p.after.owner);
    const digits = p.first.kind === 'menu'
        ? menuDigits(p).map(d => d.digit + ' · ' + (d.kind === 'urgent' ? 'Urgent' : d.label))
        : [];
    const missed = p.busy.kind === 'queue'
        ? 'Queue, up to ' + p.busy.wait + 's'
        : p.busy.kind === 'backup'
            ? 'Backup team, then a message'
            : p.busy.kind === 'assistant'
                ? 'Virtual receptionist overflow (proposed)'
                : p.busy.kind === 'message'
                    ? 'Owned message'
                    : 'Busy path undecided';
    const closed = p.after.kind === 'information'
        ? 'Approved announcement, then end'
        : p.after.kind === 'message'
            ? 'Voicemail, checked by ' + afterOwner
            : p.after.kind === 'service'
                ? 'Answering service (contract still required)'
                : p.after.kind === 'assistant'
                    ? 'Virtual receptionist (proposed)'
                    : 'After-hours path undecided';
    const urgent = !p.urgent.enabled
        ? 'No separate urgent path'
        : p.policy.urgentKind === 'connect'
            ? (mechanism === 'menu-digit' ? 'Digit 9 → on-call ring' : mechanism === 'staff' ? 'Staff who answered classifies urgency' : mechanism === 'assistant' ? 'Proposed AI classification' : 'Urgent detection unset')
            : p.policy.urgentKind === 'priority'
                ? 'Priority voicemail, not a live clinician'
                : p.policy.urgentKind === 'instructions'
                    ? 'Approved urgent recording'
                    : 'Urgent workflow undecided';
    const before = p.mode !== 'opening'
        ? ''
        : p.policy.beforeOpening === 'undecided'
            ? 'Incoming calls have no approved destination.'
            : p.policy.beforeOpening === 'message'
                ? 'Callback owner ' + mailbox(p.policy.beforeOpeningOwner || p.after.owner || p.busy.owner) + '.'
                : 'Approved announcement, then end.';
    const lunch = p.hours.days.find(d => d.breakStart && d.breakEnd);
    return {
        incoming: 'Incoming patient call',
        entry: p.first.kind === 'menu' ? 'Main phone menu' : p.first.kind === 'human' ? rec + ' rings' : p.first.kind === 'assistant' ? 'Virtual receptionist (proposed)' : 'First answer undecided',
        digits,
        ring: p.first.kind === 'menu' ? 'Assigned teams · ' + p.busy.seconds + 's' : rec + ' · ' + p.busy.seconds + 's',
        answered: 'Connect — path ends',
        missed,
        timeout: 'Message, checked by ' + owner,
        closed,
        urgent,
        before,
        hours: hoursSummary(p) || p.hours.timezone,
        lunch: lunch ? 'Lunch close ' + lunch.breakStart + '–' + lunch.breakEnd + ' follows the closed-hours path.' : '',
        mechanism
    };
}

function unique(items: Action[]) {
    const seen = new Set<string>();
    return items.filter(i => {
        const k = i.label.toLowerCase();
        if (seen.has(k))
            return false;
        seen.add(k);
        return true;
    });
}
