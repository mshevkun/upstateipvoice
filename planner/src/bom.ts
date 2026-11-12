import type { Plan } from './config';
import { inventory } from './policy';
import { provisioningMap } from './provisioning';

export type BomRow = {
    item: string;
    qty: string;
    purpose: string;
    required: boolean;
    quote: boolean;
};

export type BomTier = 'essential' | 'balanced' | 'automation';

const receptionCount = (p: Plan) => p.teams.filter(t => t.role === 'reception' && t.count > 0).reduce((n, t) => n + t.count, 0);
const clinicalCount = (p: Plan) => p.teams.filter(t => t.role === 'clinical' && t.count > 0).reduce((n, t) => n + t.count, 0);
const adminCount = (p: Plan) => p.teams.filter(t => t.role === 'administration' && t.count > 0).reduce((n, t) => n + t.count, 0);

function row(item: string, qty: string | number, purpose: string, required = true, quote = true): BomRow {
    return { item, qty: String(qty), purpose, required, quote };
}

export function billOfMaterials(p: Plan) {
    const inv = inventory(p);
    const rooms = p.policy.roomsSpecified ? p.policy.rooms : 0;
    const front = Math.max(1, receptionCount(p) || 1);
    const identities = provisioningMap(p).identities.length;
    const assumptions = [
        'People, rooms, physical phones and concurrent calling capacity are separate decisions.',
        'Quantities are planning requirements, not a vendor quote and not an order.',
        'Hardware, licensing, taxes, professional services and after-hours contracts need a vendor quote.',
        'No monthly savings figure is invented from the optional current-bill fields.',
        p.policy.roomsSpecified ? rooms + (rooms === 1 ? ' clinical room is specified; phone placement still needs a floor plan or site survey.' : ' clinical rooms are specified; phone placement still needs a floor plan or site survey.') : 'Clinical rooms are not specified; do not treat the illustration as a cabling plan.'
    ];
    const essential: BomRow[] = [
        row('Reception desk phones', Math.min(front, 2), 'Lean front-desk answering. Shared devices count as one identity unless you choose separate positions.'),
        row('Computer answering position', 1, 'A workstation that can take calls without a second desk phone for the same person.'),
        row('Published practice number', 1, p.policy.opening.numbers === 'porting' ? 'Port the existing number. Porting time is a vendor dependency.' : 'New number or port — confirm with the provider.'),
        row('Voicemail with named owner', 1, 'Every unanswered path needs an owner. A recording is not a booked appointment.'),
        row('Basic after-hours coverage', 1, 'Information recording or next-business-day voicemail. Not live booking.')
    ];
    const balanced: BomRow[] = [
        row('Reception answering positions', Math.max(front, inv.desk || front), 'Match simultaneous coverage, not headcount.'),
        row('Computer answering positions', Math.max(1, inv.computer || 1), 'Overflow / second answering place.'),
        row('Work-mobile answering', Math.max(1, inv.mobile || 1), 'Optional. Do not put a personal cell in any recording.', false),
        row('Clinical-room phones', rooms ? String(rooms) + ' (only if the workflow calls the room)' : '0 unless workflow needs them', 'Rooms do not automatically get phones.', false),
        row('Overflow / backup path', 1, 'Queue or backup team with a hard exit to an owned message.'),
        row('After-hours messaging or service', 1, 'Owned callback, or a contracted service whose permitted actions are written down.'),
        row('Message notification', 1, 'Inbox, practice alert or email — delivery must still be configured.')
    ];
    const automation: BomRow[] = [
        ...balanced,
        row('Virtual receptionist (optional)', [p.first.kind, p.busy.kind, p.after.kind].includes('assistant') ? 'Selected in this plan' : 'Not selected', 'Scope, languages and PMS writeback stay proposed until verified.', false),
        row('Staff handoff from the assistant', 1, 'Named human fallback. Unsupported requests become owned messages, not bookings.'),
        row('Practice-system integration', p.policy.system || p.policy.opening.pms || 'Named system required', 'A system name does not establish booking or writeback.', false),
        row('Operational call reporting', 1, 'Proposed. Not included until a vendor confirms it.', false)
    ];
    const current = [
        row('Desk phones in this plan', inv.desk, 'Physical desk endpoints the owner recorded.'),
        row('Computer positions in this plan', inv.computer, 'SIP.js / computer answering.'),
        row('Mobile endpoints in this plan', inv.mobile, 'Work mobile / app.'),
        row('SIP identities (from sharing choices)', identities, 'Shared devices on one extension count as one identity.'),
        row('After-hours method', p.after.kind, 'information / message / answering service / virtual receptionist.')
    ];
    const warnings: string[] = [];
    if (inv.desk > front + adminCount(p) + (rooms || 0))
        warnings.push('Desk-phone count is higher than reception + administration + specified rooms. Ask the vendor why extra sets are on the quote.');
    if (!inv.desk && !inv.computer && !inv.mobile)
        warnings.push('No answering position is confirmed yet.');
    if (p.after.kind === 'undecided')
        warnings.push('After-hours coverage is still open — a quote that omits it is incomplete.');
    if (p.current.monthly && !p.policy.comparison)
        warnings.push('A current monthly amount is stored but comparison was skipped; no savings are calculated.');
    if (p.policy.comparison && p.current.monthly)
        warnings.push('Compare the quote’s scope to this bill of materials. Extra unused phones or a missing after-hours path matter more than the monthly number.');
    if (clinicalCount(p) && !p.policy.roomsSpecified)
        warnings.push(clinicalCount(p) + ' clinical staff are listed and no room count is specified. Do not order room phones from staff count alone.');
    return { essential, balanced, automation, current, assumptions, warnings, identities, rooms };
}

export function afterHoursComparison(): { id: string; title: string; covers: string; gaps: string; cost: string }[] {
    return [
        { id: 'information', title: 'Play information, then end', covers: 'Hours, location, approved wording.', gaps: 'No message, no booking, no urgent connect unless you add a separate option.', cost: 'Recording + installer time. Quote.' },
        { id: 'message', title: 'Take a voicemail', covers: 'Named owner, next-business-day callback.', gaps: 'Not a live person. Not a booked appointment.', cost: 'Mailbox + notification. Quote.' },
        { id: 'service', title: 'Answering service', covers: 'A person after hours, within the written contract.', gaps: 'Not authorized to book or give clinical advice unless the contract says so.', cost: 'Monthly service contract. Quote.' },
        { id: 'assistant', title: 'Virtual receptionist', covers: 'Only the tasks you permit, with a human fallback.', gaps: 'Languages, PMS and booking stay unverified. Requests are not appointments.', cost: 'Usage + setup + integration. Quote.' }
    ];
}

export function sampleAssistantTurns(p: Plan) {
    const tasks = p.policy.assistant.tasks;
    const turns: string[] = ['Caller: “Hi, I need to see the dentist this week.”'];
    if (tasks.includes('Appointment requests'))
        turns.push('Assistant: “I can take an appointment request. I cannot confirm a time on the schedule until the practice reviews it.”');
    else
        turns.push('Assistant: “I cannot book from this line. I can take a callback request for the team.”');
    turns.push('Caller: “Can you just put me in on Thursday?”');
    turns.push('Assistant: “I will record the request for ' + (p.teams.find(t => t.id === p.policy.assistant.owner)?.name || 'the assigned owner') + '. A request is not a confirmed appointment.”');
    if (p.policy.assistant.humanWhen === 'request')
        turns.push('If the caller asks for a person, the call is offered to the human fallback. Acceptance still has to be tested.');
    return turns;
}

export function scopeAgainstQuote(p: Plan) {
    if (!p.policy.comparison)
        return ['Comparison skipped. Previously entered costs are excluded from recommendations.'];
    const lines = [
        `Current provider note: ${p.current.provider || 'Not supplied'}; monthly USD (as entered): ${p.current.monthly || 'Not supplied'}; lines: ${p.current.lines || 'Not supplied'}.`,
        'Amount includes: ' + (p.policy.costIncludes.join(', ') || 'Not specified') + '. Contract/rental: ' + (p.policy.contract || 'Not supplied') + '. Retain numbers: ' + p.policy.portNumbers + '.',
        'No savings estimate has been invented. Check the quote against the bill of materials: devices, after-hours, AI, porting and notification.'
    ];
    if (p.current.notes)
        lines.push(p.current.notes);
    return lines;
}
