import type { Plan } from '../config';
import { dayIsStated, hasOpenPhoneHours, hoursSummary } from '../flow';
import { ringMembers } from '../provisioning';
import { roleState } from '../team-state';
import type { Chip, Fact, NextQuestion } from './types';

function skipped(facts: Record<string, Fact>, id: string) {
    return facts[id]?.status === 'skipped';
}

function confirmed(facts: Record<string, Fact>, id: string) {
    return facts[id]?.status === 'confirmed';
}

function settled(facts: Record<string, Fact>, id: string) {
    // proposed ("Help me decide") must not dismiss the question — owners still need a real choice.
    return ['skipped', 'confirmed'].includes(facts[id]?.status || '');
}

function chip(id: string, label: string, field_id: string, value: string | number | boolean | null, operation: Chip['operation'] = 'set'): Chip {
    return { id, label, field_id, value, operation };
}

const skipChip = (field_id: string): Chip => chip('skip', 'Skip for now', field_id, null, 'skip');
const unsureChip = (field_id: string): Chip => chip('unsure', "I'm not sure yet", field_id, null, 'uncertain');
const helpChip = (field_id: string): Chip => chip('help', 'Help me decide', field_id, null, 'uncertain');

function restClosedDays(p: Plan) {
    return p.hours.days.filter(d => !dayIsStated(d)).map(d => d.day.slice(0, 3));
}

function restClosedText(p: Plan) {
    const days = restClosedDays(p);
    if (!days.length)
        return 'Are the remaining days closed?';
    if (days.length === 1)
        return 'Is ' + days[0] + ' closed?';
    return 'Are ' + days.slice(0, -1).join(', ') + ', and ' + days[days.length - 1] + ' closed?';
}

function reasonsSplitDetail(p: Plan) {
    const rec = roleState(p, 'reception').count > 0;
    const adm = roleState(p, 'administration').count > 0;
    const clin = roleState(p, 'clinical').count > 0;
    const bits = [
        'Appointments stay at the front desk',
        adm ? 'billing to the office manager' : rec ? 'billing stays with the front desk' : 'billing with whoever answers',
        clin ? 'clinical questions to the clinical team after screening' : 'clinical questions stay with whoever answers'
    ];
    return bits.join('; ') + '. One choice sets all three. You can still type a different split.';
}

function questionCatalog(p: Plan, facts: Record<string, Fact>): NextQuestion[] {
    return [
        {
            id: 'urgent.scope',
            text: 'Just to make sure I set that up correctly: is that only for urgent medical questions, or for every incoming call?',
            detail: 'Those produce different phone systems. I will not guess.',
            priority: 5,
            skipAllowed: true,
            affectedFields: ['urgent.scope'],
            options: [
                chip('urgent_only', 'Only urgent calls', 'urgent.scope', 'urgent_only'),
                chip('all_calls', 'Every call', 'urgent.scope', 'all_calls'),
                chip('explain', 'Let me explain', 'urgent.scope', null, 'uncertain'),
                skipChip('urgent.scope')
            ]
        },
        {
            id: 'mode',
            text: 'What are you setting up?',
            detail: 'This shapes later questions. You can change it.',
            priority: 10,
            skipAllowed: true,
            affectedFields: ['mode'],
            options: [
                chip('opening', 'Opening a new practice', 'mode', 'opening'),
                chip('improving', 'Improving an existing setup', 'mode', 'improving'),
                chip('adding', 'Adding a location', 'mode', 'adding'),
                unsureChip('mode'),
                skipChip('mode')
            ]
        },
        {
            id: 'name',
            text: 'What is the practice called?',
            detail: 'Type the name patients will hear on the greeting and both PDFs. Skip if you do not have it yet.',
            priority: 12,
            skipAllowed: true,
            affectedFields: ['name'],
            options: [
                skipChip('name')
            ]
        },
        {
            id: 'specialty',
            text: 'What kind of practice is this?',
            detail: 'Dental and eye-care rooms look different. Other specialties use a consultation layout.',
            priority: 20,
            skipAllowed: true,
            affectedFields: ['specialty'],
            options: [
                chip('dental', 'Dental', 'specialty', 'Dental'),
                chip('eye', 'Eye care', 'specialty', 'Eye care'),
                chip('other', 'Other healthcare practice', 'specialty', 'Other healthcare practice'),
                skipChip('specialty')
            ]
        },
        {
            id: 'specialtyDetail',
            text: 'What kind—chiropractic, PT, family medicine?',
            detail: 'A short label is enough. It shows on the rail and in both PDFs.',
            priority: 21,
            skipAllowed: true,
            affectedFields: ['specialtyDetail'],
            options: [
                skipChip('specialtyDetail')
            ]
        },
        {
            id: 'teams.reception.count',
            text: 'How many people usually work at the front desk?',
            detail: 'Approximate counts are fine. This is not a phone order.',
            priority: 30,
            skipAllowed: true,
            affectedFields: ['teams.reception.count'],
            options: [
                chip('0', 'None', 'teams.reception.count', 0),
                chip('1', '1', 'teams.reception.count', 1),
                chip('2', '2', 'teams.reception.count', 2),
                chip('3', '3', 'teams.reception.count', 3),
                chip('4', '4 or more', 'teams.reception.count', 4),
                chip('defer', 'Not sure yet', 'teams.reception.count', null, 'skip')
            ]
        },
        {
            id: 'teams.clinical.count',
            text: 'How many clinicians and clinical assistants work here?',
            detail: 'Dentists, hygienists, and assistants count together.',
            priority: 32,
            skipAllowed: true,
            affectedFields: ['teams.clinical.count'],
            options: [
                chip('0', 'None', 'teams.clinical.count', 0),
                chip('1', '1', 'teams.clinical.count', 1),
                chip('2', '2', 'teams.clinical.count', 2),
                chip('3', '3', 'teams.clinical.count', 3),
                chip('5', '4 or more', 'teams.clinical.count', 5),
                chip('defer', 'Not sure yet', 'teams.clinical.count', null, 'skip')
            ]
        },
        {
            id: 'teams.administration.count',
            text: 'How many people handle office management, besides anyone already counted at the front desk?',
            detail: 'Billing done by reception is a responsibility, not extra administration seats.',
            priority: 34,
            skipAllowed: true,
            affectedFields: ['teams.administration.count'],
            options: [
                chip('0', 'None', 'teams.administration.count', 0),
                chip('1', '1', 'teams.administration.count', 1),
                chip('2', '2', 'teams.administration.count', 2),
                chip('defer', 'Not sure yet', 'teams.administration.count', null, 'skip')
            ]
        },
        {
            id: 'hours.preset',
            text: 'When can your team answer calls during a normal week?',
            detail: confirmed(facts, 'hours.preset') && hoursSummary(p) ? 'Currently noted as ' + hoursSummary(p) + '.' : 'Start with a normal week. You can change individual days later.',
            priority: 40,
            skipAllowed: true,
            affectedFields: ['hours.preset'],
            options: [
                chip('weekdays', 'Monday–Friday · 9 AM–5 PM', 'hours.preset', 'weekdays'),
                chip('always', '24-hour phone coverage', 'hours.preset', 'always'),
                chip('custom', 'Different hours by day', 'hours.preset', 'custom'),
                unsureChip('hours.preset'),
                skipChip('hours.preset')
            ]
        },
        {
            id: 'hours.rest_closed',
            text: restClosedText(p),
            detail: 'I will not fill Monday–Friday 9–5 for days you did not name.',
            priority: 41,
            skipAllowed: true,
            affectedFields: ['hours.rest_closed'],
            options: [
                chip('closed', 'Yes — those days are closed', 'hours.rest_closed', 'closed'),
                skipChip('hours.rest_closed')
            ]
        },
        {
            id: 'hours.lunch',
            text: 'What happens to the phones at lunch?',
            detail: 'Lunch is the most common missed-call window. A lunch close is not the same as after-hours voicemail.',
            priority: 42,
            skipAllowed: true,
            affectedFields: ['hours.lunch'],
            options: [
                chip('covered', 'Someone stays on the desk', 'hours.lunch', 'covered'),
                chip('closed', 'Phones close around noon–1', 'hours.lunch', 'closed'),
                helpChip('hours.lunch'),
                skipChip('hours.lunch')
            ]
        },
        {
            id: 'first.kind',
            text: 'Who should answer first when the office is open?',
            detail: 'Choose what patients experience during your answering hours.',
            priority: 50,
            skipAllowed: true,
            affectedFields: ['first.kind'],
            options: [
                chip('human', 'Your reception team', 'first.kind', 'human'),
                chip('menu', 'A short phone menu', 'first.kind', 'menu'),
                chip('assistant', 'An AI receptionist', 'first.kind', 'assistant'),
                helpChip('first.kind'),
                skipChip('first.kind')
            ]
        },
        {
            id: 'busy.kind',
            text: 'What should happen if nobody answers during open hours?',
            detail: 'Ringing already has a timeout. This is the next step for the caller.',
            priority: 60,
            skipAllowed: true,
            affectedFields: ['busy.kind'],
            options: [
                chip('message', 'Take a message', 'busy.kind', 'message'),
                chip('queue', 'Let them wait briefly', 'busy.kind', 'queue'),
                chip('backup', 'Try another team', 'busy.kind', 'backup'),
                chip('assistant', 'Use a virtual receptionist', 'busy.kind', 'assistant'),
                skipChip('busy.kind')
            ]
        },
        {
            id: 'after.kind',
            text: 'What should patients experience when they call after hours?',
            detail: 'You can also explain this in your own words. A later AI idea will not be configured for opening day.',
            priority: 70,
            skipAllowed: true,
            affectedFields: ['after.kind'],
            options: [
                chip('message', 'Take a message', 'after.kind', 'message'),
                chip('service', 'Live answering service', 'after.kind', 'service'),
                chip('assistant', 'AI receptionist', 'after.kind', 'assistant'),
                chip('information', 'Play information, then end', 'after.kind', 'information'),
                helpChip('after.kind'),
                skipChip('after.kind')
            ]
        },
        {
            id: 'messages.owner',
            text: 'Who checks those messages in the morning?',
            detail: 'Voicemail lives on someone’s mailbox. A miss that nobody opens is not a working path.',
            priority: 72,
            skipAllowed: true,
            affectedFields: ['messages.owner'],
            options: [
                chip('reception', 'Front desk', 'messages.owner', 'reception'),
                chip('clinical', 'I do', 'messages.owner', 'clinical'),
                chip('admin', 'Office manager', 'messages.owner', 'admin'),
                helpChip('messages.owner'),
                skipChip('messages.owner')
            ]
        },
        {
            id: 'devices.reception.sharing',
            text: 'When two people are at the front, can both pick up at once?',
            detail: 'That is a line question, not a phone-per-room order. One shared identity is one conversation at a time.',
            priority: 74,
            skipAllowed: true,
            affectedFields: ['devices.reception.sharing'],
            options: [
                chip('separate', 'Yes — they need two lines', 'devices.reception.sharing', 'separate'),
                chip('shared', 'No — they share one phone', 'devices.reception.sharing', 'shared'),
                helpChip('devices.reception.sharing'),
                skipChip('devices.reception.sharing')
            ]
        },
        {
            id: 'devices.reception.kind',
            text: 'What does the front desk answer on?',
            detail: 'That is a model question, not a phone-per-room order. Separate lines still need a device type.',
            priority: 75,
            skipAllowed: true,
            affectedFields: ['devices.reception.kind'],
            options: [
                chip('desk', 'Desk phones', 'devices.reception.kind', 'desk'),
                chip('computer', 'Computer + headset', 'devices.reception.kind', 'computer'),
                chip('both', 'Both', 'devices.reception.kind', 'both'),
                helpChip('devices.reception.kind'),
                skipChip('devices.reception.kind')
            ]
        },
        {
            id: 'devices.work_mobile',
            text: 'If the front desk cannot pick up, should a work mobile ring?',
            detail: 'A work app is fine. We will not put a personal cell number in a recording or on a wall card.',
            priority: 76,
            skipAllowed: true,
            affectedFields: ['devices.work_mobile'],
            options: [
                chip('none', 'Just the office phones', 'devices.work_mobile', 'none'),
                chip('app', 'Yes, a work phone or app', 'devices.work_mobile', 'app'),
                helpChip('devices.work_mobile'),
                skipChip('devices.work_mobile')
            ]
        },
        {
            id: 'busy.order',
            text: 'If the front is slammed, should we ring the office manager’s work mobile first, then take a message — or just take a message?',
            detail: 'You said both. I will not guess the order.',
            priority: 77,
            skipAllowed: true,
            affectedFields: ['busy.order'],
            options: [
                chip('backup_then_message', "Ring office manager's work mobile, then message", 'busy.order', 'backup_then_message'),
                chip('message_only', 'Message only', 'busy.order', 'message_only'),
                helpChip('busy.order'),
                skipChip('busy.order')
            ]
        },
        {
            id: 'urgent.kind',
            text: 'Do urgent calls need a separate path?',
            detail: 'Live connect is a transfer attempt with a backup. Skipping this does not mean you have no on-call coverage.',
            priority: 80,
            skipAllowed: true,
            affectedFields: ['urgent.kind'],
            options: [
                chip('connect', 'Connect to on-call', 'urgent.kind', 'connect'),
                chip('priority', 'Take a priority message', 'urgent.kind', 'priority'),
                chip('instructions', 'Play approved instructions', 'urgent.kind', 'instructions'),
                chip('none', 'No separate urgent path', 'urgent.kind', 'none'),
                skipChip('urgent.kind')
            ]
        },
        {
            id: 'opening.date',
            text: 'When do you expect to open?',
            detail: 'An approximate month is enough.',
            priority: 90,
            skipAllowed: true,
            affectedFields: ['opening.date'],
            options: [
                skipChip('opening.date'),
                unsureChip('opening.date')
            ]
        },
        {
            id: 'beforeOpening',
            text: 'If someone finds the number before you open, what should they hear?',
            detail: 'Do not advertise the number until this exists. This is not the after-hours path.',
            priority: 92,
            skipAllowed: true,
            affectedFields: ['beforeOpening'],
            options: [
                chip('information', 'A short recording — not open yet', 'beforeOpening', 'information'),
                chip('message', 'Take a callback message', 'beforeOpening', 'message'),
                helpChip('beforeOpening'),
                skipChip('beforeOpening')
            ]
        },
        {
            id: 'policy.rooms',
            text: 'How many treatment rooms are you planning?',
            detail: 'Room count does not order phones.',
            // Ask before clinical-area devices so "rooms aren't phones" is not followed by a room-count re-ask.
            priority: 77,
            skipAllowed: true,
            affectedFields: ['policy.rooms'],
            options: [
                chip('2', '2', 'policy.rooms', 2),
                chip('4', '4', 'policy.rooms', 4),
                chip('6', '6', 'policy.rooms', 6),
                chip('8', '8', 'policy.rooms', 8),
                skipChip('policy.rooms')
            ]
        },
        {
            id: 'languages.decision',
            text: 'Do callers need another language besides English?',
            detail: 'Only add coverage your practice can actually provide.',
            priority: 110,
            skipAllowed: true,
            affectedFields: ['languages.decision'],
            options: [
                chip('none', 'English is enough', 'languages.decision', 'none'),
                chip('spanish', 'Spanish', 'languages.spanish', true),
                skipChip('languages.decision')
            ]
        },
        {
            id: 'hours.lunch.time',
            text: 'When do phones close for lunch?',
            detail: 'I will not assume noon to 1 unless you pick it.',
            priority: 43,
            skipAllowed: true,
            affectedFields: ['hours.lunch.time'],
            options: [
                chip('12-1', '12–1', 'hours.lunch.time', '12-1'),
                chip('12:30', '12:30–1:30', 'hours.lunch.time', '12:30-13:30'),
                chip('1-2', '1–2', 'hours.lunch.time', '13-14'),
                skipChip('hours.lunch.time')
            ]
        },
        {
            id: 'reasons.routing',
            text: 'Where should appointments, billing, and clinical questions go?',
            detail: reasonsSplitDetail(p),
            priority: 55,
            skipAllowed: true,
            affectedFields: ['reasons.default_split', 'reasons.appointments.team', 'reasons.billing.team', 'reasons.clinical-question.team'],
            options: [
                chip('use-split', 'Use this split', 'reasons.default_split', 'standard'),
                skipChip('reasons.appointments.team')
            ]
        },
        {
            id: 'urgent.roster',
            text: 'Who is on call when that path is used?',
            detail: 'A rotation is a roster, not a verified transfer. We will not put a personal cell in the greeting.',
            priority: 82,
            skipAllowed: true,
            affectedFields: ['urgent.roster'],
            options: [
                chip('rotation', 'We rotate', 'urgent.roster', 'rotation'),
                chip('fixed', 'One person', 'urgent.roster', 'fixed'),
                skipChip('urgent.roster')
            ]
        },
        {
            id: 'urgent.miss',
            text: 'If the on-call attempt is missed, what should happen?',
            detail: 'Live connect still needs a backup. A miss with nowhere to go is not a working path.',
            priority: 84,
            skipAllowed: true,
            affectedFields: ['urgent.backup'],
            options: [
                chip('message', 'Take a priority message', 'urgent.backup', 'message'),
                chip('instructions', 'Play instructions', 'urgent.backup', 'instructions'),
                skipChip('urgent.backup')
            ]
        },
        {
            id: 'devices.administration.place',
            text: 'Where does the office manager answer from?',
            detail: 'A work computer or work mobile is fine. This is not a phone-per-room order.',
            priority: 78,
            skipAllowed: true,
            affectedFields: ['devices.administration.place'],
            options: [
                chip('computer', 'Computer', 'devices.administration.place', 'computer'),
                chip('desk', 'Desk phone', 'devices.administration.place', 'desk'),
                chip('mobile', 'Work mobile only', 'devices.administration.place', 'mobile'),
                skipChip('devices.administration.place')
            ]
        },
        {
            id: 'devices.clinical.area',
            text: 'Do treatment rooms need a phone?',
            detail: 'Default is none. Rooms are not phones. One internal computer is an answering position in the clinical area, not six room phones.',
            priority: 79,
            skipAllowed: true,
            affectedFields: ['devices.clinical.area'],
            options: [
                chip('none', 'None — rooms are not phones', 'devices.clinical.area', 'none'),
                chip('internal', 'One internal computer', 'devices.clinical.area', 'internal_computer'),
                chip('desk', 'One desk in the clinical area', 'devices.clinical.area', 'desk'),
                skipChip('devices.clinical.area')
            ]
        }
    ];
}

function pruneChips(p: Plan, facts: Record<string, Fact>, question: NextQuestion): NextQuestion {
    const inboundStuck = needsInboundDevice(question.id, p);
    const options = question.options.filter(chip => {
        // Skipping or soft-deferring would leave Fusion RG 7000 with no members.
        if (inboundStuck && (chip.operation === 'skip' || chip.operation === 'uncertain'))
            return false;
        if (inboundStuck && question.id === 'devices.clinical.area'
            && (chip.value === 'none' || chip.value === 'internal_computer' || chip.value === 'internal'))
            return false;
        // Do not offer after-hours paths that cannot host digit-9 on-call.
        if (question.id === 'after.kind' && p.urgent.enabled && p.policy.urgentKind === 'connect'
            && chip.value === 'information')
            return false;
        // Menu first-answer cannot use staff language ID; AI first uses VR keypad only.
        if (question.id === 'languages.decision') {
            if (p.first.kind === 'menu' && chip.value === 'staff')
                return false;
            if (p.first.kind === 'assistant' && (chip.value === 'staff' || chip.value === 'menu'))
                return false;
        }
        if (question.id === 'first.kind' && p.locations.length > 1 && p.policy.locationEntry === 'shared'
            && (chip.value === 'menu' || chip.value === 'assistant'))
            return false;
        if (chip.operation !== 'set')
            return true;
        if (settled(facts, chip.field_id) && String(facts[chip.field_id]?.value) === String(chip.value))
            return false;
        const team = String(chip.value);
        const role = team === 'admin' || team === 'administration' ? 'administration' : team === 'reception' ? 'reception' : team === 'clinical' ? 'clinical' : '';
        if (role && /(?:^|\.)(team|place)$/.test(chip.field_id) && roleState(p, role).count === 0)
            return false;
        if (chip.field_id === 'messages.owner' && role && roleState(p, role).count === 0 && role !== 'clinical')
            return false;
        return true;
    });
    return options.length ? { ...question, options } : question;
}

function rankedCatalog(p: Plan, facts: Record<string, Fact>) {
    return questionCatalog(p, facts).slice().sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

function emptyReceptionDesk(p: Plan) {
    return p.first.kind === 'human' && (p.first.team === 'reception' || !p.first.team)
        && roleState(p, 'reception').count === 0
        && !p.policy.placements.some(x => x.team === 'reception' && x.count > 0 && x.device !== 'undecided' && x.device !== 'none');
}

/** Human first-answer with no outside SIP identities → Fusion RG 7000 would be empty. */
function emptyInboundRg(p: Plan) {
    if (p.first.kind !== 'human')
        return false;
    const team = p.first.team || 'reception';
    return ringMembers(p, team, true).filter(m => m.device !== 'undecided' && m.device !== 'none').length === 0;
}

/** Align Plan fields so fusionBuild only keeps install-time blockers. */
export function repairFusionConflicts(p: Plan): Plan {
    let next = p;
    if (next.first.kind === 'menu' && next.languages.some(l => l.mechanism === 'staff'))
        next = { ...next, languages: next.languages.map(l => l.mechanism === 'staff' ? { ...l, mechanism: 'menu' as const } : l) };
    if (next.first.kind === 'assistant' && next.languages.some(l => l.mechanism === 'staff' || l.mechanism === 'menu'))
        next = { ...next, languages: next.languages.map(l => ({ ...l, mechanism: 'assistant' as const })) };
    if (next.first.kind === 'human' && next.languages.some(l => l.mechanism === 'menu'))
        next = { ...next, languages: next.languages.map(l => l.mechanism === 'menu' ? { ...l, mechanism: 'staff' as const } : l) };
    if (next.after.kind === 'information' && next.urgent.enabled && next.policy.urgentKind === 'connect')
        next = { ...next, after: { ...next.after, kind: 'message' } };
    if (next.locations.length > 1 && next.policy.locationEntry === 'shared' && next.first.kind !== 'human' && next.first.kind !== 'undecided')
        next = { ...next, first: { kind: 'human', team: next.first.team || 'reception' } };
    if (next.first.kind === 'human' && !next.first.team)
        next = { ...next, first: { ...next.first, team: 'reception' } };
    return next;
}

/** Non-install Fusion conflicts that must keep the chat open (after repair). */
function conflictQuestionId(p: Plan): string | null {
    if (p.locations.length > 1 && p.policy.locationEntry === 'shared' && p.first.kind !== 'human' && p.first.kind !== 'undecided')
        return 'first.kind';
    if (p.first.kind === 'human' && p.languages.some(l => l.mechanism === 'menu'))
        return 'languages.decision';
    if (p.first.kind === 'menu' && p.languages.some(l => l.mechanism === 'staff'))
        return 'languages.decision';
    if (p.first.kind === 'assistant' && p.languages.some(l => l.mechanism === 'staff' || l.mechanism === 'menu'))
        return 'languages.decision';
    if (p.after.kind === 'information' && p.urgent.enabled && p.policy.urgentKind === 'connect')
        return 'after.kind';
    return null;
}

function needsInboundDevice(questionId: string, p: Plan) {
    if (!emptyInboundRg(p))
        return false;
    const team = p.first.team || 'reception';
    if (questionId === 'teams.reception.count')
        return team === 'reception' && roleState(p, 'reception').count === 0;
    if (questionId === 'devices.reception.sharing')
        return team === 'reception'
            && roleState(p, 'reception').count >= 2
            && !p.policy.placements.some(x => x.team === 'reception' && x.sharing !== 'undecided');
    if (questionId === 'devices.reception.kind')
        return team === 'reception'
            && !p.policy.placements.some(x => x.team === 'reception' && x.count > 0 && x.device !== 'undecided' && x.device !== 'none');
    if (questionId === 'devices.clinical.area')
        return team === 'clinical'
            && !p.policy.placements.some(x => x.team === 'clinical' && x.count > 0 && x.access === 'outside' && x.device !== 'undecided' && x.device !== 'none');
    if (questionId === 'devices.administration.place')
        return (team === 'admin' || team === 'administration')
            && !p.policy.placements.some(x => x.team === 'admin' && x.count > 0 && x.access === 'outside' && x.device !== 'undecided' && x.device !== 'none');
    return false;
}

export function nextQuestion(p: Plan, facts: Record<string, Fact>): NextQuestion | null {
    const catalog = rankedCatalog(p, facts);
    const conflictId = conflictQuestionId(p);
    for (const question of catalog) {
        const reopenReception = question.id === 'teams.reception.count' && emptyReceptionDesk(p);
        const reopenInbound = needsInboundDevice(question.id, p);
        const reopenConflict = conflictId === question.id;
        if (!reopenReception && !reopenInbound && !reopenConflict && question.affectedFields.every(id => settled(facts, id)))
            continue;
        if (!ready(question.id, p, facts) && !reopenConflict && !reopenInbound && !reopenReception)
            continue;
        return pruneChips(p, facts, question);
    }
    // Install-only leftovers (E911, Follow Me identity, site survey) belong in stillOpen / walkthrough — never here.
    // After every ordinary question is settled, still refuse to finish with an empty inbound RG.
    if (emptyInboundRg(p)) {
        const inboundIds = ['devices.reception.kind', 'devices.reception.sharing', 'devices.clinical.area', 'devices.administration.place', 'teams.reception.count'];
        for (const id of inboundIds) {
            const question = catalog.find(q => q.id === id);
            if (question && needsInboundDevice(id, p))
                return pruneChips(p, facts, question);
        }
    }
    if (conflictId) {
        const question = catalog.find(q => q.id === conflictId);
        if (question)
            return pruneChips(p, facts, question);
    }
    return null;
}

function ready(id: string, p: Plan, facts: Record<string, Fact>) {
    if (id === 'urgent.scope')
        return !!p.policy.pendingClinicianRoute && !confirmed(facts, 'urgent.scope') && !skipped(facts, 'urgent.scope');
    if (id === 'mode')
        return !p.mode && !skipped(facts, 'mode');
    if (id === 'name')
        return !!p.mode && !p.name.trim() && !skipped(facts, 'name');
    if (id === 'specialty')
        return !!p.mode && !p.specialty && !skipped(facts, 'specialty');
    if (id === 'specialtyDetail')
        return p.specialty === 'Other healthcare practice' && !String(p.specialtyDetail || '').trim() && !skipped(facts, 'specialtyDetail');
    if (id === 'teams.reception.count')
        return (roleState(p, 'reception').status === 'unanswered' || emptyReceptionDesk(p) || needsInboundDevice(id, p))
            && (!skipped(facts, 'teams.reception.count') || needsInboundDevice(id, p));
    if (id === 'teams.clinical.count')
        return roleState(p, 'reception').status !== 'unanswered' && roleState(p, 'clinical').status === 'unanswered' && !skipped(facts, 'teams.clinical.count');
    if (id === 'teams.administration.count')
        return roleState(p, 'clinical').status !== 'unanswered' && roleState(p, 'administration').status === 'unanswered' && !skipped(facts, 'teams.administration.count') && !confirmed(facts, 'billing.performed_by');
    if (id === 'hours.preset')
        // Offer the preset until a real open window exists. Closed weekends or lunch-only must not block it.
        return !p.confirmed.includes('hours') && !skipped(facts, 'hours.preset') && !confirmed(facts, 'hours.preset') && !hasOpenPhoneHours(p);
    if (id === 'hours.rest_closed')
        // Never ask "rest closed?" until a real open window exists — lunch alone is not hours.
        return hasOpenPhoneHours(p) && restClosedDays(p).length > 0 && !settled(facts, 'hours.rest_closed') && !skipped(facts, 'hours.preset');
    if (id === 'hours.lunch')
        return (confirmed(facts, 'hours.preset') || confirmed(facts, 'hours.weekdays_start') || p.confirmed.includes('hours') || hasOpenPhoneHours(p))
            && !settled(facts, 'hours.lunch')
            && !skipped(facts, 'hours.preset')
            && !p.hours.days.some(d => d.breakStart && d.breakEnd)
            && !/lunch phones (closed|covered)/i.test(p.policy.notes);
    if (id === 'first.kind')
        return p.first.kind === 'undecided' && !skipped(facts, 'first.kind') && !p.policy.pendingClinicianRoute;
    if (id === 'busy.kind')
        return p.first.kind !== 'undecided' && p.busy.kind === 'undecided' && !skipped(facts, 'busy.kind');
    if (id === 'after.kind')
        return p.after.kind === 'undecided' && !skipped(facts, 'after.kind');
    if (id === 'messages.owner') {
        const needBusy = p.busy.kind === 'message' && !p.busy.owner;
        const needAfter = p.after.kind === 'message' && !p.after.owner;
        return (needBusy || needAfter) && !skipped(facts, 'messages.owner');
    }
    if (id === 'devices.reception.sharing')
        return roleState(p, 'reception').count >= 2 && p.first.kind === 'human'
            && (!settled(facts, 'devices.reception.sharing') || needsInboundDevice(id, p))
            && !p.policy.placements.some(x => x.team === 'reception' && x.sharing !== 'undecided');
    if (id === 'devices.reception.kind')
        return p.first.kind === 'human'
            && (roleState(p, 'reception').count > 0 || needsInboundDevice(id, p))
            && (needsInboundDevice(id, p)
                || (!settled(facts, 'devices.reception.kind')
                    && !p.policy.placements.some(x => x.team === 'reception' && x.count > 0 && x.device !== 'undecided' && x.device !== 'none')));
    if (id === 'devices.work_mobile')
        return p.first.kind !== 'undecided' && !settled(facts, 'devices.work_mobile')
            && !p.policy.placements.some(x => x.device === 'mobile' && x.count > 0)
            && !/work mobile answering|work app \/ follow me/i.test((p.policy.notes || '') + ' ' + (p.policy.continuity.notes || ''));
    if (id === 'busy.order')
        return p.first.kind === 'human'
            && !!p.busy.backup
            && p.busy.kind === 'message'
            && !settled(facts, 'busy.order');
    if (id === 'urgent.kind')
        return !p.policy.pendingClinicianRoute && p.policy.urgentKind === 'undecided' && !skipped(facts, 'urgent.kind') && !skipped(facts, 'urgent.scope') && !p.confirmed.includes('urgent');
    if (id === 'opening.date')
        return p.mode === 'opening' && !p.policy.opening.date && !skipped(facts, 'opening.date');
    if (id === 'beforeOpening')
        return p.mode === 'opening' && p.policy.beforeOpening === 'undecided' && !skipped(facts, 'beforeOpening');
    if (id === 'policy.rooms') {
        // After "none — rooms are not phones", do not immediately ask for a room count.
        const clinicalNone = settled(facts, 'devices.clinical.area')
            && (facts['devices.clinical.area']?.value === 'none' || facts['devices.clinical.area']?.value === 'per_room');
        return !p.policy.roomsSpecified && !skipped(facts, 'policy.rooms') && !clinicalNone;
    }
    if (id === 'languages.decision')
        return p.policy.languageDecision === 'undecided' && !skipped(facts, 'languages.decision');
    if (id === 'hours.lunch.time')
        // Only ask a lunch-close clock when phones actually close — never after “someone stays on”.
        return ((confirmed(facts, 'hours.lunch') && facts['hours.lunch']?.value === 'closed')
            || /\blunch phones closed\b/i.test(p.policy.notes))
            && !p.hours.days.some(d => d.breakStart && d.breakEnd)
            && !settled(facts, 'hours.lunch.time')
            && !/\blunch phones covered\b/i.test(p.policy.notes);
    if (id === 'reasons.routing')
        return p.first.kind !== 'undecided'
            && p.reasons.some(r => !r.team)
            && !skipped(facts, 'reasons.appointments.team')
            && !skipped(facts, 'reasons.default_split')
            && !confirmed(facts, 'reasons.default_split')
            && !(p.reasons.every(r => r.team));
    if (id === 'urgent.roster')
        return p.policy.urgentKind === 'connect' && p.policy.urgentRoster === 'undecided' && !skipped(facts, 'urgent.roster');
    if (id === 'urgent.miss')
        return p.policy.urgentKind === 'connect' && !p.urgent.backup && !skipped(facts, 'urgent.backup') && !confirmed(facts, 'urgent.backup');
    if (id === 'devices.administration.place')
        return (roleState(p, 'administration').count > 0 || needsInboundDevice(id, p))
            && (needsInboundDevice(id, p)
                || (!p.policy.placements.some(x => x.team === 'admin' && x.device !== 'mobile' && x.device !== 'undecided' && x.count > 0)
                    && !skipped(facts, 'devices.administration.place')));
    if (id === 'devices.clinical.area')
        return (roleState(p, 'clinical').count > 0 || needsInboundDevice(id, p))
            && (needsInboundDevice(id, p)
                || (!p.policy.placements.some(x => x.team === 'clinical' && x.count > 0)
                    && !skipped(facts, 'devices.clinical.area')));
    return false;
}

export function ownerQuestions(p: Plan, facts: Record<string, Fact> = {}) {
    const conflictId = conflictQuestionId(p);
    return rankedCatalog(p, facts).filter(question => {
        const reopenReception = question.id === 'teams.reception.count' && emptyReceptionDesk(p);
        const reopenInbound = needsInboundDevice(question.id, p);
        const reopenConflict = conflictId === question.id;
        if (!reopenReception && !reopenInbound && !reopenConflict && question.affectedFields.every(id => settled(facts, id)))
            return false;
        return reopenConflict || ready(question.id, p, facts);
    }).map(question => pruneChips(p, facts, question));
}

export { questionCatalog as ownerQuestionCatalog };

export function questionById(id: string, p: Plan, facts: Record<string, Fact>) {
    return questionCatalog(p, facts).find(question => question.id === id) || null;
}

export { composeAcknowledgement, CHIP_SUBJECT } from './ack';
export function acknowledgementFor(p: Plan, text: string, future: string[]) {
    void p;
    void future;
    return text;
}
