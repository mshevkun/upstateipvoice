import { formatOpening, formatTime, hoursSummary } from '../flow';
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
    const detail = set.specialtyDetail ? String(set.specialtyDetail).trim() : '';
    const spec = detail
        ? detail.toLowerCase()
        : set.specialty === 'Other healthcare practice'
            ? 'healthcare'
            : set.specialty ? String(set.specialty).toLowerCase() : '';
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
        bits.push('an AI receptionist first — confirm before install');
    if (set['busy.kind'] === 'message')
        bits.push('a message if nobody answers during open hours');
    else if (set['busy.kind'] === 'queue')
        bits.push('a short wait if staff are busy');
    else if (set['busy.kind'] === 'backup')
        bits.push('try another team if the first line is busy');
    if (set['after.kind'] === 'message')
        bits.push('voicemail after hours');
    else if (set['after.kind'] === 'service')
        bits.push('a live answering service after hours — confirm the contract before install');
    else if (set['after.kind'] === 'assistant')
        bits.push('after-hours AI — we’ll confirm this before install');
    else if (set['after.kind'] === 'information')
        bits.push('hours information after close, then the call ends');
    if (set['urgent.kind'] === 'none')
        bits.push('no live on-call transfer');
    else if (set['urgent.kind'] === 'connect')
        bits.push('a live on-call attempt — we’ll confirm this before install');
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
    if (update.operation === 'set' && update.field_id === 'specialtyDetail' && update.value)
        return 'treating this as a ' + String(update.value) + ' practice';
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
        return first.endsWith('.') ? first : first + '.';
    if (rest.length === 1)
        return first + ' ' + rest[0] + (rest[0].endsWith('.') ? '' : '.');
    return first + ' ' + rest.slice(0, -1).join(', ') + ', and ' + rest[rest.length - 1] + '.';
}

function goldShape(set: Record<string, InterpreterUpdate['value']>, plan: Plan) {
    const chenId = !!(set.name && set.cityState);
    const chenStaff = set['teams.reception.count'] != null && set['teams.clinical.count'] != null && set['billing.performed_by'];
    const chenHours = !!(set['hours.Monday.start'] && set['hours.lunch']);
    const chenBusy = !!(set['busy.kind'] && set['devices.work_mobile'] && set['devices.reception.sharing']);
    const chenUrgent = !!(set['urgent.kind'] && set['urgent.scope']);
    const chenLang = !!(set['languages.spanish'] && set['languages.availability']);
    const chenOpen = !!(set.beforeOpening && set['opening.pms']);
    const chenReasons = !!(set['reasons.appointments.team'] && set['current.lines']);
    if (!(chenId || chenStaff || chenHours || chenBusy || chenUrgent || chenLang || chenOpen || chenReasons))
        return '';
    if ((chenId || ((set.cityState || set.name || set['opening.date']) && !chenStaff && !chenHours && !chenBusy)) && !chenOpen && !set.beforeOpening) {
        const city = String(set.cityState || plan.policy.cityState || '');
        const spec = String(set.specialty || plan.specialty || 'practice').toLowerCase();
        const rooms = set['policy.rooms'] != null ? Number(set['policy.rooms']) : plan.policy.rooms;
        const open = formatOpening(plan) || String(set['opening.date'] || '');
        const name = String(set.name || plan.name || '');
        const bits = ['A new ' + spec + ' office' + (city ? ' in ' + city : '')];
        if (name)
            bits[0] += ' — ' + name;
        if (rooms)
            bits.push(rooms + ' treatment rooms (not phones)');
        if (plan.policy.opening.construction === 'build-out' || set['opening.construction'] === 'build-out')
            bits.push('still a build-out');
        if (open)
            bits.push('aiming for the week of ' + open);
        return bits.join(', ') + '.';
    }
    if ((set['teams.reception.count'] != null || set['teams.clinical.count'] != null || set['billing.performed_by']) && !set.beforeOpening) {
        const rec = Number(set['teams.reception.count'] ?? roleState(plan, 'reception').count);
        const clin = Number(set['teams.clinical.count'] ?? roleState(plan, 'clinical').count);
        const bits: string[] = [];
        if (Number.isFinite(rec) && rec > 0)
            bits.push(rec + ' at the front desk' + (rec >= 2 ? ', both answer' : ''));
        if (Number.isFinite(clin) && clin > 0)
            bits.push(clin + ' clinical');
        if (set['billing.performed_by'] === 'administration' || plan.policy.billingPerformedBy === 'administration')
            bits.push('Your office manager handles billing and insurance');
        if (set['first.kind'] === 'human' || plan.first.kind === 'human')
            bits.push('A person answers first, no menu');
        return bits.join('. ') + '.';
    }
    if (set['hours.Monday.start'] || set['hours.lunch'] || set['hours.Friday.end'] || set['hours.weekdays_start']) {
        const mon = plan.hours.days.find(d => d.day === 'Monday');
        const fri = plan.hours.days.find(d => d.day === 'Friday');
        const bits: string[] = [];
        if (mon?.start)
            bits.push('Mon–Thu ' + clock(mon.start) + '–' + clock(mon.end));
        if (fri?.start)
            bits.push('Fri ' + clock(fri.start) + '–' + clock(fri.end));
        bits.push('closed weekends');
        if (mon?.breakStart && mon?.breakEnd)
            bits.push('Phones close for lunch ' + clock(mon.breakStart) + '–' + clock(mon.breakEnd) + ' Mon–Thu');
        if (fri && !fri.breakStart)
            bits.push('Friday has no lunch close');
        return bits.join('. ') + '.';
    }
    if (set['busy.kind'] || set['devices.work_mobile'] || set['devices.reception.sharing']) {
        const bits: string[] = [];
        if (set['busy.kind'] === 'message')
            bits.push('If both are busy: message, front desk checks the inbox');
        if (set['devices.reception.sharing'] === 'separate')
            bits.push('Two separate lines');
        if (set['devices.work_mobile'] === 'app')
            bits.push("Your office manager's work mobile rings if the front is slammed — never a personal number");
        return bits.join('. ') + '.';
    }
    if (set['urgent.kind'] || set['after.kind'] || set['urgent.scope']) {
        const bits: string[] = [];
        if (set.beforeOpening === 'message' || plan.policy.beforeOpening === 'message')
            bits.push('callback messages before opening');
        else if (set.beforeOpening === 'information' || plan.policy.beforeOpening === 'information')
            bits.push('a not-open-yet recording before opening');
        if (set['after.kind'] === 'message' || plan.after.kind === 'message')
            bits.push('After hours: voicemail, front desk owns it');
        if (set['urgent.kind'] === 'connect' || plan.policy.urgentKind === 'connect')
            bits.push('Press 9 after hours for swelling, trauma, or bleeding tries the on-call dentist' + (plan.policy.urgentRoster === 'rotation' || set['urgent.roster'] === 'rotation' ? ' (rotation)' : ''));
        if (set['urgent.backup'] === 'message' || plan.policy.urgentBackup === 'message')
            bits.push('if missed, a priority message');
        bits.push('911 for emergencies');
        return bits.join('. ') + '.';
    }
    if (set['languages.spanish'] || set['languages.decision']) {
        if (set['languages.spanish'] === true || plan.languages.some(l => l.name === 'Spanish'))
            return 'Spanish during open hours by your bilingual receptionist. After hours is English.';
        if (set['languages.decision'] === 'none')
            return 'English is enough.';
    }
    if (set.beforeOpening || set['opening.pms'] || set['opening.numbers'] || set['continuity.notes'] || set['hours.holidays']) {
        const bits: string[] = [];
        if (set.beforeOpening === 'message' || plan.policy.beforeOpening === 'message')
            bits.push("Before opening: take a callback, don't advertise the number until that recording exists");
        if (set['opening.numbers'] === 'new' || plan.policy.opening.numbers === 'new')
            bits.push('New number');
        if (set['opening.internet'] === 'survey' || plan.policy.opening.internet === 'survey')
            bits.push('Site survey for internet and network');
        if (set['opening.pms'] || plan.policy.opening.pms)
            bits.push(String(set['opening.pms'] || plan.policy.opening.pms));
        if (plan.hours.holidays.length || set['hours.holidays'])
            bits.push('Closed Thanksgiving and Christmas');
        if (String(set['continuity.notes'] || plan.policy.continuity.notes).toLowerCase().includes('snow'))
            bits.push('Snow days follow closed hours');
        return bits.join('. ') + '.';
    }
    if (set['reasons.appointments.team'] || set['current.lines'] || set['current.notes']) {
        const bits: string[] = [];
        if (set['reasons.appointments.team'] || plan.reasons.some(r => r.team))
            bits.push('Appointments → front desk, billing → office manager, clinical → clinical after screening');
        if (/fax/i.test(String(set['current.notes'] || set['current.lines'] || plan.current.notes || plan.current.lines)))
            bits.push('The fax stays off the patient number');
        return bits.join('. ') + '.';
    }
    return '';
}

export const CHIP_SUBJECT: Record<string, string> = {
    'mode=opening': 'Opening a new practice.',
    'mode=improving': 'Improving an existing setup.',
    'mode=adding': 'Adding a location.',
    'specialty=Dental': 'A dental practice.',
    'specialty=Eye care': 'An eye-care practice.',
    'specialty=Other healthcare practice': 'Another kind of healthcare practice.',
    'teams.reception.count=0': 'No one at the front desk yet.',
    'teams.reception.count=1': 'One person at the front desk.',
    'teams.reception.count=2': 'Two people at the front desk.',
    'teams.reception.count=3': 'Three people at the front desk.',
    'teams.reception.count=4': 'Four or more at the front desk.',
    'teams.clinical.count=0': 'No clinicians counted yet.',
    'teams.clinical.count=1': 'One clinician.',
    'teams.clinical.count=2': 'Two clinicians.',
    'teams.clinical.count=3': 'Three clinicians.',
    'teams.clinical.count=5': 'Four or more clinicians.',
    'teams.administration.count=0': 'No separate office manager.',
    'teams.administration.count=1': 'One office manager.',
    'teams.administration.count=2': 'Two people in administration.',
    'hours.preset=weekdays': 'Monday–Friday, 9 to 5, until you change a day.',
    'hours.preset=always': 'Phones covered around the clock.',
    'hours.preset=custom': 'Hours vary by day — tell me each day that matters.',
    'hours.rest_closed=closed': 'The days you did not name are closed.',
    'hours.lunch=covered': 'Someone stays on the desk at lunch.',
    'hours.lunch=closed': 'Phones close at lunch — not the overnight mailbox.',
    'hours.lunch.time=12-1': 'Lunch close is 12–1.',
    'hours.lunch.time=12:30-13:30': 'Lunch close is 12:30–1:30.',
    'hours.lunch.time=13-14': 'Lunch close is 1–2.',
    'first.kind=human': 'A person at the front answers first, not a menu.',
    'first.kind=menu': 'A short phone menu answers first.',
    'first.kind=assistant': 'An AI receptionist answers first. We’ll confirm this before install.',
    'busy.kind=message': 'If nobody answers during open hours, take a message.',
    'busy.kind=queue': 'If nobody answers during open hours, callers wait briefly.',
    'busy.kind=backup': 'If nobody answers during open hours, try another team.',
    'busy.kind=assistant': 'If nobody answers during open hours, a virtual receptionist can help. We’ll confirm this before install.',
    'after.kind=message': 'After hours, take a voicemail for the next business day.',
    'after.kind=service': 'After hours, a live answering service. We’ll confirm the contract before install.',
    'after.kind=assistant': 'After hours, an AI receptionist. We’ll confirm this before install.',
    'after.kind=information': 'After hours, play information and end the call.',
    'messages.owner=reception': 'The front desk checks those messages.',
    'messages.owner=clinical': 'You check those messages.',
    'messages.owner=admin': 'The office manager checks those messages.',
    'devices.reception.sharing=separate': 'Two front-desk lines, so both can pick up.',
    'devices.reception.sharing=shared': 'One shared front-desk line — one conversation at a time.',
    'devices.reception.kind=desk': 'Front desk answers on desk phones.',
    'devices.reception.kind=computer': 'Front desk answers on a computer and headset.',
    'devices.reception.kind=both': 'Front desk uses desk phones, with a computer on the same lines if needed.',
    'devices.work_mobile=none': 'Just the office phones — no work mobile overflow.',
    'devices.work_mobile=app': 'A work phone or app can ring. Personal cells stay off the greeting.',
    'busy.order=backup_then_message': "If the front is slammed, the office manager's work mobile rings, then a message.",
    'busy.order=message_only': 'If the front is slammed, take a message only.',
    'urgent.kind=connect': 'Urgent calls get a live on-call attempt, with a backup if it is missed. We’ll confirm this before install.',
    'urgent.kind=priority': 'Urgent calls leave a priority message — not a live clinician.',
    'urgent.kind=instructions': 'Urgent calls hear instructions, not a live transfer.',
    'urgent.kind=none': 'No separate urgent path.',
    'urgent.scope=urgent_only': 'That path is only for urgent calls, not every incoming call.',
    'urgent.scope=all_calls': 'Every incoming call uses that clinician path.',
    'urgent.roster=rotation': 'On-call rotates between your clinicians.',
    'urgent.roster=fixed': 'One person is on call. Personal cells stay off the greeting.',
    'urgent.backup=message': 'If the on-call attempt is missed, take a priority message.',
    'urgent.backup=instructions': 'If the on-call attempt is missed, play instructions.',
    'beforeOpening=message': 'Before opening, take a callback. Do not advertise the number until that recording exists.',
    'beforeOpening=information': 'Before opening, play a not-open-yet recording, then end.',
    'languages.decision=none': 'English is enough.',
    'languages.spanish=true': 'Spanish coverage, only if your team can actually provide it.',
    'policy.rooms=0': 'No treatment-room count. Rooms are not phones.',
    'policy.rooms=2': 'Two treatment rooms recorded. Rooms are not phones.',
    'policy.rooms=4': 'Four treatment rooms recorded. Rooms are not phones.',
    'policy.rooms=6': 'Six treatment rooms recorded. Rooms are not phones.',
    'policy.rooms=8': 'Eight treatment rooms recorded. Rooms are not phones.',
    'devices.administration.place=computer': 'Your office manager answers on a computer.',
    'devices.administration.place=desk': 'Your office manager answers on a desk phone.',
    'devices.administration.place=mobile': 'Your office manager answers on a work mobile.',
    'devices.clinical.area=none': 'No phones in treatment rooms. Rooms are not phones.',
    'devices.clinical.area=internal_computer': 'The clinical team shares one internal computer, not on the published number.',
    'devices.clinical.area=internal': 'The clinical team shares one internal computer, not on the published number.',
    'devices.clinical.area=desk': 'One desk in the clinical area, not a phone per room.',
    'reasons.default_split=standard': 'Appointments stay at the front desk, billing goes to whoever handles the books, clinical questions go to the clinical team after screening.'
};

function chipSubject(chip?: Chip | null) {
    if (!chip || chip.operation !== 'set')
        return '';
    const key = chip.field_id + '=' + String(chip.value);
    if (CHIP_SUBJECT[key])
        return CHIP_SUBJECT[key];
    if (chip.field_id === 'devices.administration.place' && chip.value === 'computer')
        return 'Your office manager answers on a computer.';
    if (chip.label)
        return chip.label.replace(/\.$/, '') + '.';
    return '';
}

function summarize(accepted: InterpreterUpdate[], plan: Plan, chip?: Chip | null) {
    const named = chipSubject(chip);
    if (named)
        return named;
    const set = taken(accepted);
    const shaped = goldShape(set, plan);
    if (shaped)
        return shaped;
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
        return chip.label.replace(/\.$/, '') + '.';
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
        return 'Skipped for now — we can come back to that.';
    if (opts.chip?.operation === 'uncertain') {
        const help = adviceFor(opts.chip.field_id);
        return help || 'Left open for now — I won’t treat that as a launch choice.';
    }
    const groq = (opts.groqAck || '').trim();
    const groqOk = groq && !thin(groq) && !UNSAFE.test(groq) && !GENERIC.test(groq);
    const specific = summarize(opts.accepted, opts.plan, opts.chip);
    const asked = opts.userText && wantsAdvice(opts.userText);
    const help = asked ? (adviceFor(adviceTopic(opts.userText, opts.chip?.field_id || null)) || adviceFor('after.kind')) : '';
    const notesOnly = opts.accepted.filter(u => /notes|continuity\.notes|current\.notes|policy\.notes/.test(u.field_id));
    const empty = !opts.accepted.some(u => u.operation === 'set' && u.value != null && !/notes/.test(u.field_id));
    let text = asked && help
        ? [specific, help].filter(Boolean).join(' ')
        : specific || (groqOk ? groq : '');
    if (!text && empty && notesOnly.length)
        text = 'I’ll pass this to your installer: ' + notesOnly.map(u => String(u.value || u.evidence)).filter(Boolean).slice(0, 2).join('; ') + '.';
    if (!text) {
        const topic = (opts.unmapped && opts.unmapped[0]) || '';
        const ask = opts.next?.text ? ' ' + opts.next.text : '';
        text = "I didn't turn that into a setting yet." + (topic ? ' (' + topic + ')' : '') + ask;
    }
    void hoursSummary;
    return text.replace(/\s+/g, ' ').trim();
}
