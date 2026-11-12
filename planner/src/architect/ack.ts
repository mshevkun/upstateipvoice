import { roleState } from '../team-state';
import type { Plan } from '../config';
import type { Chip, Fact, InterpreterUpdate, NextQuestion } from './types';

const GENERIC = /^(got it!?\.?|i captured that\.?|i recorded that( from what you wrote)?\.?|understood\.?|okay\.?|ok\.?|perfect\.?|thanks\.?|noted\.?)$/i;
const UNSAFE = /verified (on-call|live|transfer|install|booking)|e911 confirmed|hipaa compliant|guaranteed live|dentrix (is|booking) enabled/i;

function thin(text: string) {
    const trimmed = text.trim();
    if (!trimmed || GENERIC.test(trimmed))
        return true;
    return trimmed.split(/\s+/).length < 5;
}

function clock(value: unknown) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
    if (!m)
        return String(value || '');
    let hour = Number(m[1]);
    const minutes = m[2];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return minutes === '00' ? hour + ' ' + suffix : hour + ':' + minutes + ' ' + suffix;
}

function taken(updates: InterpreterUpdate[]) {
    const out: Record<string, InterpreterUpdate['value']> = {};
    for (const update of updates)
        if (update.operation === 'set' && update.value != null)
            out[update.field_id] = update.value;
    return out;
}

function identity(set: Record<string, InterpreterUpdate['value']>) {
    const spec = set.specialty ? String(set.specialty).toLowerCase() : '';
    const city = set.cityState ? String(set.cityState) : '';
    const office = spec ? spec + ' office' : 'office';
    if (set.mode === 'opening' && spec && city)
        return 'a new ' + office + ' in ' + city;
    if (set.mode === 'opening' && spec)
        return 'a new ' + office;
    if (set.mode === 'adding' && spec && city)
        return 'a second ' + office + ' in ' + city;
    if (set.mode === 'adding')
        return city ? 'a second location in ' + city : 'a second-location plan';
    if (set.mode === 'improving' && spec && city)
        return 'existing ' + office + ' in ' + city;
    if (set.mode === 'improving' && spec)
        return 'an existing ' + office;
    if (set.mode === 'improving')
        return city ? 'an existing office in ' + city : 'an existing-office plan';
    if (spec && city)
        return office + ' in ' + city;
    if (spec)
        return spec;
    if (city)
        return 'in ' + city;
    if (set.mode === 'opening')
        return 'a new-office plan';
    return '';
}

function staff(set: Record<string, InterpreterUpdate['value']>) {
    const bits: string[] = [];
    if (set['teams.reception.count'] != null) {
        const n = Number(set['teams.reception.count']);
        bits.push(n === 0 ? 'no front desk' : n === 1 ? 'one person at the front' : n + ' at the front');
    }
    if (set['teams.clinical.count'] != null) {
        const n = Number(set['teams.clinical.count']);
        const dentist = String(set.specialty || '') === 'Dental';
        if (n === 1)
            bits.push(dentist ? 'one dentist' : 'one clinician');
        else if (n === 0)
            bits.push('no clinicians yet');
        else
            bits.push(n + (dentist ? ' dentists and clinical staff' : ' clinicians'));
    }
    if (set['teams.administration.count'] != null) {
        const n = Number(set['teams.administration.count']);
        bits.push(n === 0 ? 'no office manager' : n === 1 ? 'one office manager' : n + ' in administration');
    }
    if (set['billing.performed_by'] === 'reception')
        bits.push('billing stays with the front desk');
    return bits;
}

function answering(set: Record<string, InterpreterUpdate['value']>) {
    const bits: string[] = [];
    if (set['first.kind'] === 'human')
        bits.push('front desk picks up, not a menu');
    else if (set['first.kind'] === 'menu')
        bits.push('a short phone menu first');
    else if (set['first.kind'] === 'assistant')
        bits.push('an AI receptionist first, still proposed');
    if (set['busy.kind'] === 'message')
        bits.push('a message if nobody answers during open hours');
    else if (set['busy.kind'] === 'queue')
        bits.push('a short wait if staff are busy');
    else if (set['busy.kind'] === 'backup')
        bits.push('try another team if the first line is busy');
    if (set['after.kind'] === 'message')
        bits.push('voicemail after hours');
    else if (set['after.kind'] === 'service')
        bits.push('a live answering service after hours, still proposed');
    else if (set['after.kind'] === 'assistant')
        bits.push('after-hours AI, still proposed');
    else if (set['after.kind'] === 'information')
        bits.push('hours information after close, then the call ends');
    if (set['urgent.kind'] === 'none')
        bits.push('no live on-call transfer');
    else if (set['urgent.kind'] === 'connect')
        bits.push('a proposed on-call path, not a verified transfer');
    else if (set['urgent.kind'] === 'priority')
        bits.push('a priority message for urgent calls');
    if (set['urgent.scope'] === 'urgent_only')
        bits.push('clinician routing only for urgent calls');
    else if (set['urgent.scope'] === 'all_calls')
        bits.push('clinician routing for every incoming call');
    return bits;
}

function extras(set: Record<string, InterpreterUpdate['value']>) {
    const bits: string[] = [];
    const start = set['hours.weekdays_start'];
    const end = set['hours.weekdays_end'];
    if (start && end)
        bits.push((set['hours.preset'] === 'weekdays' ? 'weekdays ' : '') + clock(start) + ' to ' + clock(end));
    else if (set['hours.preset'] === 'weekdays')
        bits.push('weekday phone hours');
    else if (set['hours.preset'] === 'always')
        bits.push('24-hour phone coverage');
    else if (start)
        bits.push('phones starting at ' + clock(start));
    else if (end)
        bits.push('phones until ' + clock(end));
    if (set['opening.numbers'] === 'porting')
        bits.push('keeping the existing number');
    else if (set['opening.numbers'] === 'new')
        bits.push('a new phone number');
    if (set['languages.decision'] === 'none')
        bits.push('English is enough');
    else if (set['languages.spanish'] === true)
        bits.push('Spanish coverage');
    if (set['policy.rooms'] != null)
        bits.push(Number(set['policy.rooms']) + ' treatment rooms');
    if (set['messages.owner'] === 'reception' || set['busy.owner'] === 'reception' || set['after.owner'] === 'reception')
        bits.push('the front desk checks the messages');
    else if (set['messages.owner'] === 'clinical' || set['busy.owner'] === 'clinical' || set['after.owner'] === 'clinical')
        bits.push('you check the messages');
    else if (set['messages.owner'] === 'admin' || set['busy.owner'] === 'admin' || set['after.owner'] === 'administration')
        bits.push('the office manager checks the messages');
    if (set['devices.reception.sharing'] === 'separate')
        bits.push('two front-desk lines so both can pick up');
    else if (set['devices.reception.sharing'] === 'shared')
        bits.push('one shared front-desk line');
    if (set['devices.work_mobile'] === 'app')
        bits.push('a work mobile can ring — personal number not published');
    else if (set['devices.work_mobile'] === 'none')
        bits.push('office phones only, no mobile answering');
    if (set.beforeOpening === 'information')
        bits.push('a not-open-yet recording before opening day');
    else if (set.beforeOpening === 'message')
        bits.push('callback messages before opening day');
    if (set['hours.lunch'] === 'closed') {
        const start = set['hours.weekdays_break_start'] || '12:00';
        const end = set['hours.weekdays_break_end'] || '13:00';
        bits.push('phones closed for lunch ' + clock(start) + ' to ' + clock(end));
    }
    else if (set['hours.lunch'] === 'covered')
        bits.push('someone stays on the phones at lunch');
    if (set['opening.construction'] === 'build-out')
        bits.push('the space is still under construction, so phone counts stay planning figures');
    if (set['opening.date'])
        bits.push('opening around ' + set['opening.date']);
    if (set['opening.precision'] === 'day' && !set['opening.date'])
        bits.push('a specific opening day');
    if (set.name)
        bits.push('the practice name ' + set.name);
    if (set.followup === 'skip')
        bits.push('call messages only, no extra texts');
    if (set['busy.wait'] != null && set['busy.kind'] !== 'message')
        bits.push(Number(set['busy.wait']) + ' seconds as the wait target');
    return bits;
}

const GROUPED = new Set([
    'mode', 'specialty', 'cityState', 'name',
    'teams.reception.count', 'teams.clinical.count', 'teams.administration.count', 'billing.performed_by',
    'first.kind', 'first.team', 'busy.kind', 'after.kind', 'urgent.kind', 'urgent.scope',
    'hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.lunch', 'hours.weekdays_break_start', 'hours.weekdays_break_end',
    'opening.numbers', 'opening.date', 'opening.precision', 'opening.construction',
    'languages.decision', 'languages.spanish', 'policy.rooms', 'followup', 'busy.wait',
    'messages.owner', 'busy.owner', 'after.owner', 'devices.reception.sharing', 'devices.work_mobile', 'beforeOpening'
]);

function leftover(update: InterpreterUpdate) {
    if (update.operation === 'skip' && update.field_id === 'teams.reception.count')
        return 'the receptionist count still open';
    if (update.operation === 'skip' && update.field_id === 'urgent.kind')
        return 'on-call left undecided, not marked as none';
    if (GROUPED.has(update.field_id) || update.operation !== 'set' || update.value == null)
        return '';
    return '';
}

function sentence(bits: string[]) {
    const unique = [...new Set(bits.filter(Boolean))].slice(0, 8);
    if (!unique.length)
        return '';
    const first = unique[0][0].toUpperCase() + unique[0].slice(1);
    const rest = unique.slice(1);
    if (!rest.length)
        return 'Understood. ' + first + '.';
    if (rest.length === 1)
        return 'Understood. ' + first + ', and ' + rest[0] + '.';
    return 'Understood. ' + first + ', ' + rest.slice(0, -1).join(', ') + ', and ' + rest[rest.length - 1] + '.';
}

function summarize(accepted: InterpreterUpdate[], plan: Plan, chip?: Chip | null) {
    const set = taken(accepted);
    const bits = [
        identity(set),
        ...staff(set),
        ...answering(set),
        ...extras(set),
        ...accepted.map(leftover)
    ];
    const text = sentence(bits);
    if (text)
        return text;
    if (chip?.operation === 'set' && chip.label)
        return "I'll record " + chip.label.replace(/\.$/, '') + '.';
    const rec = roleState(plan, 'reception').count;
    const adm = roleState(plan, 'administration').count;
    if (rec && adm && plan.policy.billingPerformedBy === 'reception')
        return 'So that is ' + adm + ' owner/admin and ' + rec + ' front-desk staff who also handle billing. I did not add extra administration seats.';
    return '';
}

export function wantsAdvice(text: string) {
    const t = text.toLowerCase().replace(/['’]/g, '');
    return /what.?s best|which is better|do i need (ai|an answering)|should i (get|use|have) (ai|an answering|a menu|voicemail)|help me (decide|choose)|i dont know whether|what do most (offices|practices)/.test(t);
}

function adviceTopic(text: string, fallback?: string | null) {
    const t = text.toLowerCase().replace(/['’]/g, '');
    if (/after hours|when (we |the office )?clos|evenings/.test(t))
        return 'after.kind';
    if (/who checks|voicemail|mailbox|messages in the morning/.test(t) && !/after hours/.test(t))
        return 'messages.owner';
    if (/both pick up|one phone|two lines|share one/.test(t))
        return 'devices.reception.sharing';
    if (/work (cell|mobile|app)|personal (cell|number)|ring my cell/.test(t))
        return 'devices.work_mobile';
    if (/before (we |the office )?open|not open yet/.test(t))
        return 'beforeOpening';
    if (/lunch/.test(t))
        return 'hours.lunch';
    if (/who (should )?answer|a menu|person at the front/.test(t) && !/after hours/.test(t))
        return 'first.kind';
    if (/if nobody|already on a call|overflow|with a patient/.test(t) && !/after hours/.test(t))
        return 'busy.kind';
    return fallback || '';
}

export function adviceFor(fieldId?: string | null) {
    if (fieldId === 'first.kind')
        return 'Most small practices start with a person at the front if someone is there. A menu only helps if callers need different teams. AI at launch stays a proposal until it is verified — I will not put it in opening day unless you say it answers from day one.';
    if (fieldId === 'after.kind')
        return 'Voicemail after hours is the simple path: they leave a name and number, you call back next business day. A live answering service is a person after close, with a contract to confirm. AI after hours is a later option, not a launch config unless you choose it now.';
    if (fieldId === 'busy.kind')
        return 'If the front desk is already with a patient, a message is the usual small-office path. A short wait only helps if someone will actually pick up. Overflow to another office needs that office agreeing to answer.';
    if (fieldId === 'hours.lunch')
        return 'Lunch is the window most offices lose new-patient calls. Closed phones at lunch is a scheduled close, not the same as after-hours voicemail. Someone staying on the desk is a different plan.';
    if (fieldId === 'messages.owner')
        return 'Whoever owns the mailbox checks it in the morning. A miss that sits in a box nobody opens is not a working path.';
    if (fieldId === 'devices.reception.sharing')
        return 'If both people should pick up at the same time, they need separate lines. One shared phone is one conversation at a time, even if two people sit there. This is not a phone-per-room order.';
    if (fieldId === 'devices.work_mobile')
        return 'A work app or work mobile can ring if the desk cannot pick up. We will not put a personal cell number in the greeting or on a wall card.';
    if (fieldId === 'beforeOpening')
        return 'Do not advertise the number until callers have somewhere to go. A short recording or a callback box is enough. This is not the after-hours path.';
    return '';
}

export function composeAcknowledgement(opts: {
    groqAck?: string;
    accepted: InterpreterUpdate[];
    plan: Plan;
    facts: Record<string, Fact>;
    next: NextQuestion | null;
    chip?: Chip | null;
    unmapped?: string[];
    userText?: string;
}): string {
    if (opts.chip?.operation === 'skip')
        return 'Skipped. I will leave that as an open decision.';
    if (opts.chip?.operation === 'uncertain') {
        const help = adviceFor(opts.chip.field_id);
        return help || 'Noted as uncertain. I will not treat that as a launch choice.';
    }
    const groq = (opts.groqAck || '').trim();
    const groqOk = groq && !thin(groq) && !UNSAFE.test(groq) && !GENERIC.test(groq);
    const specific = summarize(opts.accepted, opts.plan, opts.chip);
    const asked = opts.userText && wantsAdvice(opts.userText);
    const help = asked ? (adviceFor(adviceTopic(opts.userText, opts.chip?.field_id || null)) || adviceFor('after.kind')) : '';
    const text = asked && help
        ? [specific, help].filter(Boolean).join(' ')
        : specific || (groqOk ? groq : "I'll record that.");
    return text.replace(/\s+/g, ' ').trim();
}
