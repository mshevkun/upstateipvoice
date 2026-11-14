import { days, type Plan } from '../config';
import { applyHoursPreset, suggestedGreeting } from '../flow';
import { setRole, type Role } from '../team-state';
import type { FieldCatalogEntry, FieldDef, FieldOperation, Scalar } from './types';
export { updatesFromOwnerText, detectIntent, clinicianRouteAmbiguous, deniesClinicianRoute, mentionsClinicianRoute, mergeInterpreterUpdates, specifiesUrgentScope } from './extract';

export const SPECIALTIES = ['Dental', 'Eye care', 'Other healthcare practice'] as const;
export const BLOCKED_FIELD_IDS = [
    'e911Confirmed',
    'handoffTested',
    'onCallRouteVerified',
    'baaAcknowledged',
    'endpoints.desk',
    'endpoints.computer',
    'endpoints.mobile',
    'endpoints.shared',
    'policy.extensionBase'
] as const;

function policy(p: Plan, patch: Partial<Plan['policy']>): Plan {
    return { ...p, policy: { ...p.policy, ...patch } };
}

function opening(p: Plan, patch: Partial<Plan['policy']['opening']>): Plan {
    return policy(p, { opening: { ...p.policy.opening, ...patch } });
}

function asString(value: Scalar) {
    return value == null ? '' : String(value).trim();
}

function asNumber(value: Scalar) {
    if (typeof value === 'number' && Number.isFinite(value))
        return value;
    if (typeof value === 'string' && /^-?\d+(\.\d+)?$/.test(value.trim()))
        return Number(value.trim());
    return null;
}

function asBoolean(value: Scalar) {
    if (typeof value === 'boolean')
        return value;
    if (value === 'true' || value === 'yes')
        return true;
    if (value === 'false' || value === 'no')
        return false;
    return null;
}

export function normalizeMode(value: string): Plan['mode'] | '' {
    const s = value.trim().toLowerCase();
    if (['opening', 'new', 'new practice', 'starting', 'start', 'launch'].includes(s) || s.includes('open'))
        return 'opening';
    if (['improving', 'existing', 'replace', 'upgrade', 'fix'].includes(s) || s.includes('improv') || s.includes('existing'))
        return 'improving';
    if (['adding', 'expansion', 'second office', 'another office', 'new location'].includes(s) || s.includes('add') && s.includes('location'))
        return 'adding';
    if (s === 'opening' || s === 'improving' || s === 'adding')
        return s;
    return '';
}

export function normalizeSpecialty(value: string): { specialty: string; detail?: string } {
    const raw = value.trim();
    if ((SPECIALTIES as readonly string[]).includes(raw))
        return { specialty: raw };
    const s = raw.toLowerCase();
    if (['dental', 'dentist', 'dentistry', 'orthodontic', 'orthodontics', 'oral'].some(x => s.includes(x)))
        return { specialty: 'Dental' };
    if (['eye', 'opto', 'ophthalm'].some(x => s.includes(x)))
        return { specialty: 'Eye care' };
    if (!raw)
        return { specialty: '' };
    return { specialty: 'Other healthcare practice', detail: raw.slice(0, 120) };
}

const ENUM_ALIASES: Record<string, Record<string, string[]>> = {
    'first.kind': {
        human: ['front desk', 'receptionist', 'reception team', 'people answer', 'human first', 'staff first'],
        menu: ['phone menu', 'short menu', 'press 1', 'options menu', 'ivr'],
        assistant: ['ai receptionist', 'virtual receptionist', 'ai answers first']
    },
    'busy.kind': {
        message: ['take a message', 'voicemail', 'leave a message'],
        queue: ['wait briefly', 'hold', 'stay on the line', 'queue'],
        backup: ['try another team', 'try someone else', 'overflow'],
        assistant: ['virtual receptionist', 'ai when nobody answers']
    },
    'after.kind': {
        message: ['after hours voicemail', 'take a message after hours', 'leave a message after hours'],
        service: ['answering service', 'live answering'],
        information: ['play information', 'hours recording', 'listen to hours'],
        assistant: ['ai after hours', 'ai receptionist after hours']
    },
    'urgent.kind': {
        connect: ['on-call', 'on call', 'oncall', 'live connect', 'connect to', 'clinician phone', 'clinicians phone', 'doctor phone', 'doctors phone', 'docro', 'ring the doctor', 'transfer to the doctor'],
        priority: ['priority message', 'urgent voicemail', 'urgent message'],
        instructions: ['play approved', 'urgent recording', 'play instructions'],
        none: ['no on-call', 'no separate urgent', 'nobody on call', 'we dont have anyone on call']
    },
    'urgent.coverage': {
        always: ['all hours', 'open and closed', 'both open', 'during open hours', 'ooen hours', 'oeen hours'],
        closed: ['closed hours', 'after hours only', 'outside phone hours'],
        open: ['open hours only', 'during phone hours only']
    },
    'urgent.scope': {
        urgent_only: ['only urgent', 'only emergencies', 'only emergency', 'urgent medical', 'just emergencies', 'regular calls go to reception'],
        all_calls: ['every call', 'all incoming', 'all calls', 'every incoming call']
    },
    'billing.performed_by': {
        reception: ['front desk also', 'they also handle billing', 'reception handles billing'],
        administration: ['billing lady', 'handles insurance', 'office manager bills']
    },
    'messages.owner': {
        reception: ['front desk', 'receptionist', 'the girls', 'girls check'],
        clinical: ['i check', 'the dentist', 'i listen'],
        admin: ['office manager', 'i am the manager']
    },
    'devices.reception.sharing': {
        separate: ['both can pick up', 'can both pick up', 'two lines', 'separate phones', 'independently'],
        shared: ['share one phone', 'one desk phone', 'one line']
    },
    'devices.reception.kind': {
        desk: ['desk phone', 'desk phones', 'handset'],
        computer: ['computer', 'headset', 'softphone'],
        both: ['desk and computer', 'phone and computer', 'both']
    },
    'busy.order': {
        backup_then_message: ['ring the work mobile then message', 'overflow then voicemail', 'slammed then message'],
        message_only: ['message only', 'just take a message', 'voicemail only']
    },
    'devices.work_mobile': {
        app: ['work cell', 'work mobile', 'work app', 'ring my cell'],
        none: ['office phones only', 'no cell', 'do not ring a mobile']
    },
    beforeOpening: {
        message: ['callback', 'take a message before', 'leave their information before'],
        information: ['not open yet recording', 'say we are not open']
    }
};

function fold(value: string) {
    return value.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
}

export function normalizeEnum(id: string, value: Scalar): string {
    const raw = asString(value);
    if (!raw)
        return '';
    if (id === 'mode')
        return normalizeMode(raw) || raw;
    if (id === 'specialty')
        return normalizeSpecialty(raw).specialty || raw;
    const compact = fold(raw);
    const field = fields.find(f => f.id === id);
    const allowed = field?.enum || Object.keys(ENUM_ALIASES[id] || {});
    const exact = allowed.find(v => v === raw) || allowed.find(v => fold(v) === compact);
    if (exact)
        return exact;
    const aliases = ENUM_ALIASES[id] || {};
    const ranked = Object.entries(aliases).flatMap(([canonical, needles]) => needles.map(n => ({ canonical, n })))
        .sort((a, b) => b.n.length - a.n.length);
    for (const { canonical, n } of ranked)
        if (compact === n || compact.includes(n))
            return canonical;
    return raw;
}

function guessTeam(text: string) {
    const t = fold(text);
    if (/clinician|dentist|doctor|docro|hygien/.test(t))
        return 'clinical';
    if (/office manager|billing|administration/.test(t) && !/on-call|on call|urgent/.test(t))
        return 'administration';
    if (/front desk|receptionist|scheduler/.test(t) && !/on-call|on call|urgent|clinician|doctor/.test(t))
        return 'reception';
    if (/on-call|on call/.test(t))
        return 'clinical';
    return '';
}


function normalizeTime(value: Scalar) {
    const text = asString(value).toLowerCase().replace(/\s+/g, '');
    const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(text);
    if (!m)
        return '';
    let h = +m[1];
    const min = m[2] || '00';
    const ap = m[3];
    if (+min > 59 || h > 24)
        return '';
    if (ap === 'am')
        h = h === 12 ? 0 : h;
    if (ap === 'pm')
        h = h === 12 ? 12 : h + 12;
    if (!ap && h === 24)
        return '24:00';
    if (h > 23)
        return '';
    return String(h).padStart(2, '0') + ':' + min;
}

function normalizeOpeningDate(value: string, precision: 'day' | 'month' | 'none' = 'none') {
    const v = value.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(v))
        return { date: v, precision: precision === 'none' ? 'day' : precision };
    const names = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const withDay = /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s*(\d{4})?$/i.exec(v);
    if (withDay) {
        const idx = names.indexOf(withDay[1].toLowerCase());
        const year = withDay[3] ? +withDay[3] : (new Date().getMonth() > idx ? new Date().getFullYear() + 1 : new Date().getFullYear());
        return { date: year + '-' + String(idx + 1).padStart(2, '0') + '-' + String(+withDay[2]).padStart(2, '0'), precision: 'day' as const };
    }
    const month = /^(\d{4})-(\d{2})$/.exec(v) || /^(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})$/i.exec(v);
    const monthOnly = /^(january|february|march|april|may|june|july|august|september|october|november|december)$/i.exec(v);
    if (month && month[1].length === 4)
        return { date: month[1] + '-' + month[2] + '-01', precision: 'month' as const };
    if (month) {
        const idx = names.indexOf(month[1].toLowerCase());
        if (idx >= 0)
            return { date: month[2] + '-' + String(idx + 1).padStart(2, '0') + '-01', precision: 'month' as const };
    }
    if (monthOnly) {
        const idx = names.indexOf(monthOnly[1].toLowerCase());
        const now = new Date();
        const year = now.getMonth() > idx ? now.getFullYear() + 1 : now.getFullYear();
        return { date: year + '-' + String(idx + 1).padStart(2, '0') + '-01', precision: 'month' as const };
    }
    return { date: '', precision: 'none' as const };
}

function teamCount(p: Plan, role: Role, operation: FieldOperation, value: Scalar): Plan {
    if (operation === 'skip' || operation === 'clear')
        return setRole(p, role, 'deferred', 0);
    if (operation === 'uncertain')
        return p;
    const n = asNumber(value);
    if (n == null || n < 0 || n > 9999)
        return p;
    let next = setRole(p, role, 'known', Math.floor(n));
    if (role === 'reception') {
        const sharing = next.policy.placements.find(x => x.team === 'reception' && (x.sharing === 'shared' || x.sharing === 'separate'))?.sharing;
        if (sharing === 'shared' || sharing === 'separate')
            next = setReceptionSharing(next, sharing);
        else if (n === 1 && !next.policy.placements.some(x => x.team === 'reception'))
            next = setReceptionSharing(next, 'shared');
        if (n > 0 && next.first.kind === 'human' && !next.first.team)
            next = { ...next, first: { ...next.first, team: 'reception' } };
    }
    return next;
}

function setDay(p: Plan, day: string, patch: Partial<Plan['hours']['days'][number]>, opts?: { markStated?: boolean }): Plan {
    const markStated = opts?.markStated !== false;
    return {
        ...p,
        hours: {
            ...p.hours,
            days: p.hours.days.map(d => {
                if (d.day !== day)
                    return d;
                const next = { ...d, ...patch };
                // Lunch/break alone is not open-hours knowledge — do not block hours.preset or invent "Closed all week".
                if (markStated)
                    next.stated = true;
                return next;
            })
        },
        policy: { ...p.policy, hoursPreset: p.policy.hoursPreset === 'always' ? 'always' : 'custom' }
    };
}

function enumField(id: string, values: readonly string[], description: string, read: FieldDef['read'], write: (p: Plan, value: string, operation: FieldOperation) => Plan, confirmStep?: string): FieldDef {
    return {
        id, type: 'enum', enum: [...values], description, confirmStep,
        read,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return write(p, values.includes('undecided') ? 'undecided' : '', operation);
            const raw = asString(value);
            const match = values.find(v => v === raw) || values.find(v => v.toLowerCase() === raw.toLowerCase());
            if (!match)
                return p;
            return write(p, match, operation);
        }
    };
}

const roleFields: FieldDef[] = (['reception', 'clinical', 'administration'] as const).map(role => ({
    id: 'teams.' + role + '.count',
    type: 'number',
    min: 0,
    max: 9999,
    confirmStep: 'team',
    description: 'Number of people in the ' + role + ' role. Zero is allowed. Do not infer phones from this count.',
    read: p => p.teams.filter(t => t.role === role && t.status === 'known').reduce((n, t) => n + t.count, 0),
    apply: (p, operation, value) => teamCount(p, role, operation, value)
}));

const dayFields: FieldDef[] = days.flatMap(day => [
    {
        id: 'hours.' + day + '.open',
        type: 'boolean' as const,
        description: 'Whether the practice answers phones on ' + day + '.',
        confirmStep: 'hours',
        read: (p: Plan) => p.hours.days.find(d => d.day === day)?.open ?? false,
        apply(p: Plan, operation: FieldOperation, value: Scalar) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return p;
            const open = asBoolean(value);
            return open == null ? p : setDay(p, day, { open });
        }
    },
    {
        id: 'hours.' + day + '.start',
        type: 'string' as const,
        description: 'Phone answering start on ' + day + ' as HH:MM 24-hour.',
        confirmStep: 'hours',
        read: (p: Plan) => p.hours.days.find(d => d.day === day)?.start || '',
        apply(p: Plan, operation: FieldOperation, value: Scalar) {
            if (operation !== 'set')
                return p;
            const start = normalizeTime(value);
            return start ? setDay(p, day, { start, open: true }) : p;
        }
    },
    {
        id: 'hours.' + day + '.end',
        type: 'string' as const,
        description: 'Phone answering end on ' + day + ' as HH:MM 24-hour. Midnight close is 24:00.',
        confirmStep: 'hours',
        read: (p: Plan) => p.hours.days.find(d => d.day === day)?.end || '',
        apply(p: Plan, operation: FieldOperation, value: Scalar) {
            if (operation !== 'set')
                return p;
            const end = normalizeTime(value);
            return end ? setDay(p, day, { end, open: true }) : p;
        }
    },
    {
        id: 'hours.' + day + '.break_start',
        type: 'string' as const,
        description: 'Lunch/break start on ' + day + ' as HH:MM. Empty clears the break.',
        confirmStep: 'hours',
        read: (p: Plan) => p.hours.days.find(d => d.day === day)?.breakStart || '',
        apply(p: Plan, operation: FieldOperation, value: Scalar) {
            if (operation !== 'set')
                return p;
            if (asString(value) === '')
                return setDay(p, day, { breakStart: '', breakEnd: p.hours.days.find(d => d.day === day)?.breakEnd ? '' : '' }, { markStated: false });
            const start = normalizeTime(value);
            return start ? setDay(p, day, { breakStart: start }, { markStated: false }) : p;
        }
    },
    {
        id: 'hours.' + day + '.break_end',
        type: 'string' as const,
        description: 'Lunch/break end on ' + day + ' as HH:MM.',
        confirmStep: 'hours',
        read: (p: Plan) => p.hours.days.find(d => d.day === day)?.breakEnd || '',
        apply(p: Plan, operation: FieldOperation, value: Scalar) {
            if (operation !== 'set')
                return p;
            if (asString(value) === '')
                return setDay(p, day, { breakStart: '', breakEnd: '' }, { markStated: false });
            const end = normalizeTime(value);
            return end ? setDay(p, day, { breakEnd: end }, { markStated: false }) : p;
        }
    }
]);

export const fields: FieldDef[] = [
    {
        id: 'mode',
        type: 'enum',
        enum: ['opening', 'improving', 'adding'],
        description: 'New practice, improving an existing office, or adding a location.',
        confirmStep: 'start',
        read: p => p.mode || null,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return { ...p, mode: '' };
            const mode = normalizeMode(asString(value));
            return mode ? { ...p, mode } : p;
        }
    },
    {
        id: 'specialty',
        type: 'enum',
        enum: [...SPECIALTIES],
        description: 'Practice specialty. Only Dental, Eye care, or Other healthcare practice.',
        confirmStep: 'kind',
        read: p => p.specialty || null,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return { ...p, specialty: '', specialtyDetail: undefined };
            const next = normalizeSpecialty(asString(value));
            return { ...p, specialty: next.specialty, specialtyDetail: next.detail || p.specialtyDetail };
        }
    },
    {
        id: 'specialtyDetail',
        type: 'string',
        description: 'Free-text specialty when Other healthcare practice is selected. Max 120 characters.',
        confirmStep: 'kind',
        read: p => p.specialtyDetail || '',
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const detail = asString(value).slice(0, 120);
            return { ...p, specialty: p.specialty || 'Other healthcare practice', specialtyDetail: detail };
        }
    },
    {
        id: 'name',
        type: 'string',
        description: 'Practice name. Required before recordings or a published DID. Parse only from name anchors, never from an answering-service name.',
        confirmStep: 'practice',
        read: p => p.name,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return { ...p, name: '' };
            return { ...p, name: asString(value).slice(0, 120) };
        }
    },
    {
        id: 'cityState',
        type: 'string',
        description: 'City and state, for timezone and installation planning. Optional.',
        confirmStep: 'practice',
        read: p => p.policy.cityState,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            return policy(p, { cityState: asString(value).slice(0, 80) });
        }
    },
    {
        id: 'opening.date',
        type: 'string',
        description: 'Expected opening as YYYY-MM-DD. Month-only answers use YYYY-MM-01 with opening.precision month. Do not invent a day.',
        confirmStep: 'practice',
        read: p => p.policy.opening.date || null,
        apply(p, operation, value) {
            if (operation === 'uncertain' || operation === 'skip' || operation === 'clear')
                return opening(p, { date: '', precision: 'none' });
            const parsed = normalizeOpeningDate(asString(value), p.policy.opening.precision);
            return parsed.date ? opening(p, parsed) : p;
        }
    },
    enumField('opening.precision', ['day', 'month', 'none'], 'How precise the opening date is.', p => p.policy.opening.precision, (p, value) => opening(p, { precision: value as Plan['policy']['opening']['precision'] }), 'practice'),
    enumField('opening.numbers', ['new', 'porting', 'undecided'], 'New numbers or porting existing ones.', p => p.policy.opening.numbers, (p, value) => opening(p, { numbers: value as Plan['policy']['opening']['numbers'] }), 'current'),
    enumField('opening.internet', ['known', 'unknown', 'survey', 'undecided'], 'Internet readiness. survey means a site survey is still needed.', p => p.policy.opening.internet, (p, value) => opening(p, { internet: value as Plan['policy']['opening']['internet'] }), 'current'),
    enumField('opening.network', ['known', 'unknown', 'survey', 'undecided'], 'Network and cabling readiness.', p => p.policy.opening.network, (p, value) => opening(p, { network: value as Plan['policy']['opening']['network'] }), 'current'),
    enumField('opening.construction', ['planning', 'build-out', 'near', 'undecided'], 'Construction stage. build-out means the space is not ready to freeze phone counts.', p => p.policy.opening.construction, (p, value) => opening(p, { construction: value as Plan['policy']['opening']['construction'] }), 'practice'),
    ...roleFields,
    {
        id: 'first.kind',
        type: 'enum',
        enum: ['human', 'menu', 'assistant', 'undecided'],
        description: 'Who answers first during open hours. human, menu, or assistant. Do not infer assistant from a future wish.',
        confirmStep: 'first',
        read: p => p.first.kind,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return { ...p, first: { ...p.first, kind: 'undecided' } };
            const kind = asString(value);
            if (!['human', 'menu', 'assistant', 'undecided'].includes(kind))
                return p;
            const team = kind === 'human'
                ? (p.first.team || (p.teams.some(t => t.role === 'reception') ? 'reception' : p.first.team))
                : p.first.team;
            let next = { ...p, first: { ...p.first, kind: kind as Plan['first']['kind'], team } };
            if (kind === 'human' && next.policy.ring === 'undecided')
                next = policy(next, { ring: 'together' });
            if (kind === 'human' && next.first.team === 'reception' && receptionKnownCount(next) === 1
                && !next.policy.placements.some(x => x.team === 'reception'))
                next = setReceptionSharing(next, 'shared');
            // Fusion: menu first uses keypad language ID; AI first uses the VR en/es keypad — not staff.
            if (kind === 'menu' && next.languages.some(l => l.mechanism === 'staff'))
                next = { ...next, languages: next.languages.map(l => l.mechanism === 'staff' ? { ...l, mechanism: 'menu' as const } : l) };
            if (kind === 'assistant' && next.languages.some(l => l.mechanism === 'staff' || l.mechanism === 'menu'))
                next = { ...next, languages: next.languages.map(l => ({ ...l, mechanism: 'assistant' as const, note: (l.note ? l.note + '; ' : '') + 'Voice Receptionist keypad' })) };
            if (kind === 'human' && next.languages.some(l => l.mechanism === 'menu'))
                next = { ...next, languages: next.languages.map(l => l.mechanism === 'menu' ? { ...l, mechanism: 'staff' as const } : l) };
            return next;
        }
    },
    {
        id: 'first.team',
        type: 'string',
        description: 'Team id that rings first when first.kind is human. Usually reception.',
        confirmStep: 'first',
        read: p => p.first.team || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = asString(value) === 'front desk' ? 'reception' : asString(value);
            const id = p.teams.find(t => t.id === team || t.role === team || t.name.toLowerCase() === team.toLowerCase())?.id;
            return id ? { ...p, first: { ...p.first, kind: p.first.kind === 'undecided' ? 'human' : p.first.kind, team: id } } : p;
        }
    },
    enumField('busy.kind', ['message', 'queue', 'backup', 'assistant', 'undecided'], 'What happens if nobody answers during open hours.', p => p.busy.kind, (p, value) => ({ ...p, busy: { ...p.busy, kind: value as Plan['busy']['kind'] } }), 'busy'),
    {
        id: 'busy.owner',
        type: 'string',
        description: 'Team that owns missed-call messages during open hours.',
        confirmStep: 'busy',
        read: p => p.busy.owner || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value));
            return team ? { ...p, busy: { ...p.busy, owner: team } } : p;
        }
    },
    {
        id: 'busy.wait',
        type: 'number',
        min: 5,
        max: 600,
        description: 'Queue wait in seconds after ringing. Typical values 30, 60, 90.',
        confirmStep: 'busy',
        read: p => p.busy.wait,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const n = asNumber(value);
            return n != null && n >= 5 && n <= 600 ? { ...p, busy: { ...p.busy, wait: Math.round(n), kind: p.busy.kind === 'undecided' ? 'queue' : p.busy.kind } } : p;
        }
    },
    enumField('after.kind', ['information', 'message', 'service', 'assistant', 'undecided'], 'After-hours patient experience. message is voicemail. service is a live answering service. assistant is an AI receptionist for launch, not a future wish.', p => p.after.kind, (p, value) => ({ ...p, after: { ...p.after, kind: value as Plan['after']['kind'] } }), 'after'),
    {
        id: 'after.owner',
        type: 'string',
        description: 'Team that owns after-hours messages.',
        confirmStep: 'after',
        read: p => p.after.owner || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value));
            return team ? { ...p, after: { ...p.after, owner: team } } : p;
        }
    },
    {
        id: 'urgent.kind',
        type: 'enum',
        enum: ['connect', 'priority', 'instructions', 'undecided', 'none'],
        description: 'Urgent-call handling. none means no separate path. skip is not none.',
        confirmStep: 'urgent',
        read: p => p.policy.urgentKind,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return { ...p, urgent: { ...p.urgent, enabled: false }, policy: { ...p.policy, urgentKind: 'undecided' } };
            const kind = normalizeEnum('urgent.kind', value);
            if (!['connect', 'priority', 'instructions', 'undecided', 'none'].includes(kind))
                return p;
            let next = { ...p, urgent: { ...p.urgent, enabled: kind !== 'none' && kind !== 'undecided' }, policy: { ...p.policy, urgentKind: kind as Plan['policy']['urgentKind'] } };
            // Playback-then-hangup cannot host digit 9 — switch closed path to a message leaf.
            if (kind === 'connect' && next.after.kind === 'information')
                next = { ...next, after: { ...next.after, kind: 'message' } };
            return next;
        }
    },
    {
        id: 'urgent.team',
        type: 'string',
        description: 'On-call team id when urgent.kind is connect. Map doctor/clinician/dentist to clinical. Do not invent a person or phone number. Recording this is not a verified live route.',
        confirmStep: 'urgent',
        read: p => p.urgent.team || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value)) || guessTeam(asString(value));
            return team ? { ...p, urgent: { ...p.urgent, team, enabled: true } } : p;
        }
    },
    {
        id: 'urgent.coverage',
        type: 'enum',
        enum: ['always', 'closed', 'open', 'selected', 'undecided'],
        description: 'When the urgent path is available. always = open and closed hours. closed = after hours only. open = during phone hours only. Recording this is not a verified live route.',
        confirmStep: 'urgent',
        read: p => p.policy.urgentCoverage,
        apply(p, operation, value) {
            if (operation === 'uncertain')
                return p;
            if (operation === 'skip' || operation === 'clear')
                return { ...p, policy: { ...p.policy, urgentCoverage: 'undecided' } };
            const coverage = normalizeEnum('urgent.coverage', value);
            if (!['always', 'closed', 'open', 'selected', 'undecided'].includes(coverage))
                return p;
            return { ...p, policy: { ...p.policy, urgentCoverage: coverage as Plan['policy']['urgentCoverage'] } };
        }
    },
    enumField('urgent.roster', ['fixed', 'rotation', 'undecided'], 'On-call roster. rotation means the practice takes turns. Recording this is not a verified live route.', p => p.policy.urgentRoster, (p, value) => policy(p, { urgentRoster: value as Plan['policy']['urgentRoster'] }), 'urgent'),
    enumField('urgent.backup', ['team', 'message', 'instructions'], 'What happens if the on-call attempt is missed.', p => p.policy.urgentBackup, (p, value) => {
        const backup = value as Plan['policy']['urgentBackup'];
        return { ...p, urgent: { ...p.urgent, backup: backup === 'team' ? p.urgent.backup : backup }, policy: { ...p.policy, urgentBackup: backup } };
    }, 'urgent'),
    {
        id: 'urgent.instructions',
        type: 'string',
        description: 'Approved urgent-call cues and 911 wording. Recording cues is not a verified live route.',
        confirmStep: 'urgent',
        read: p => p.urgent.instructions || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const text = asString(value).slice(0, 400);
            if (!text)
                return p;
            const instructions = p.urgent.instructions && !p.urgent.instructions.includes(text)
                ? p.urgent.instructions + '; ' + text
                : (p.urgent.instructions || text);
            return { ...p, urgent: { ...p.urgent, instructions, enabled: true } };
        }
    },
    {
        id: 'urgent.owner',
        type: 'string',
        description: 'Who owns missed urgent messages. Map dentist/clinician to clinical.',
        confirmStep: 'urgent',
        read: p => p.urgent.owner || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value)) || guessTeam(asString(value));
            return team ? { ...p, urgent: { ...p.urgent, owner: team } } : p;
        }
    },
    {
        id: 'reasons.appointments.team',
        type: 'string',
        description: 'Team that handles appointment and scheduling calls.',
        confirmStep: 'reasons',
        read: p => p.reasons.find(r => r.id === 'appointments')?.team || null,
        apply: (p, operation, value) => setReasonTeam(p, 'appointments', operation, value)
    },
    {
        id: 'reasons.billing.team',
        type: 'string',
        description: 'Team that handles billing and insurance questions.',
        confirmStep: 'reasons',
        read: p => p.reasons.find(r => r.id === 'billing')?.team || null,
        apply: (p, operation, value) => setReasonTeam(p, 'billing', operation, value)
    },
    {
        id: 'reasons.clinical-question.team',
        type: 'string',
        description: 'Team that handles clinical questions after screening.',
        confirmStep: 'reasons',
        read: p => p.reasons.find(r => r.id === 'clinical-question')?.team || null,
        apply: (p, operation, value) => setReasonTeam(p, 'clinical-question', operation, value)
    },
    {
        id: 'current.lines',
        type: 'string',
        description: 'Stated existing phone lines, analog trunks, or fax. Do not invent inventory.',
        read: p => p.current.lines || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            return { ...p, current: { ...p.current, lines: asString(value).slice(0, 120) } };
        }
    },
    {
        id: 'current.provider',
        type: 'string',
        description: 'Stated current phone or internet provider. Do not invent a vendor.',
        read: p => p.current.provider || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            return { ...p, current: { ...p.current, provider: asString(value).slice(0, 80) } };
        }
    },
    {
        id: 'current.notes',
        type: 'string',
        description: 'Notes about existing lines, such as keeping fax off the patient number.',
        read: p => p.current.notes || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const note = asString(value).slice(0, 200);
            if (!note)
                return p;
            const notes = p.current.notes && !p.current.notes.includes(note) ? p.current.notes + ' ' + note : (p.current.notes || note);
            return { ...p, current: { ...p.current, notes } };
        }
    },
    {
        id: 'continuity.notes',
        type: 'string',
        description: 'Installer-facing continuity laws such as snow-day routing. Append.',
        read: p => p.policy.continuity.notes || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const note = asString(value).slice(0, 240);
            if (!note)
                return p;
            const notes = p.policy.continuity.notes && !p.policy.continuity.notes.includes(note.slice(0, 24))
                ? p.policy.continuity.notes + ' ' + note
                : (p.policy.continuity.notes || note);
            return policy(p, { continuity: { ...p.policy.continuity, notes } });
        }
    },
    {
        id: 'hours.holidays',
        type: 'string',
        description: 'ISO holiday date YYYY-MM-DD. Each set appends. Do not invent dates.',
        confirmStep: 'hours',
        read: p => p.hours.holidays.join(',') || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const dates = asString(value).split(/[,\s]+/).filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));
            if (!dates.length)
                return p;
            const holidays = [...p.hours.holidays];
            for (const date of dates)
                if (!holidays.includes(date))
                    holidays.push(date);
            return { ...p, hours: { ...p.hours, holidays } };
        }
    },
    {
        id: 'languages.name',
        type: 'string',
        description: 'Named language besides English. Spanish also sets languages.spanish.',
        confirmStep: 'languages',
        read: p => p.languages.find(l => l.name !== 'Spanish')?.name || p.languages[0]?.name || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const name = asString(value).replace(/^\w/, c => c.toUpperCase()).slice(0, 40);
            if (!name)
                return p;
            if (p.languages.some(l => l.name === name))
                return { ...p, policy: { ...p.policy, languageDecision: 'selected' } };
            return {
                ...p,
                languages: [...p.languages, { name, mechanism: 'staff', team: 'reception', availability: 'open', note: '', fallback: 'reception' }],
                policy: { ...p.policy, languageDecision: 'selected' }
            };
        }
    },
    enumField('languages.mechanism', ['staff', 'menu', 'assistant', 'undecided'], 'How a non-English language is identified.', p => p.languages[0]?.mechanism || null, (p, value) => patchLanguages(p, { mechanism: value as Plan['languages'][number]['mechanism'] }), 'languages'),
    {
        id: 'languages.team',
        type: 'string',
        description: 'Team that covers the named language during available hours.',
        confirmStep: 'languages',
        read: p => p.languages[0]?.team || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value));
            return team ? patchLanguages(p, { team }) : p;
        }
    },
    enumField('languages.availability', ['open', 'always', 'limited'], 'When the named language is available. open means posted hours only.', p => p.languages[0]?.availability || null, (p, value) => patchLanguages(p, { availability: value as Plan['languages'][number]['availability'] }), 'languages'),
    {
        id: 'devices.work_mobile.team',
        type: 'string',
        description: 'Which team’s work mobile rings. Never stores a personal number.',
        confirmStep: 'positions',
        read: p => p.policy.placements.find(x => x.device === 'mobile')?.team || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value));
            return team ? setPlacement(p, team, 'mobile', 1, 'outside') : p;
        }
    },
    {
        id: 'devices.administration.place',
        type: 'enum',
        enum: ['computer', 'desk', 'mobile', 'none'],
        description: 'Where the office manager answers. computer is an answering softphone, not a clinical room phone.',
        confirmStep: 'positions',
        read: p => p.policy.placements.find(x => x.team === 'admin')?.device || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const v = asString(value);
            if (v === 'none')
                return p;
            if (v === 'computer' || v === 'desk' || v === 'mobile')
                return setPlacement(p, 'admin', v, 1, 'outside');
            return p;
        }
    },
    {
        id: 'devices.clinical.area',
        type: 'enum',
        enum: ['none', 'internal_computer', 'desk', 'per_room'],
        description: 'Clinical-area phone. Default none. per_room is not a phone-per-chair order.',
        confirmStep: 'positions',
        read: p => {
            const row = p.policy.placements.find(x => x.team === 'clinical');
            if (!row || row.device === 'none')
                return 'none';
            if (row.device === 'computer' && row.access === 'internal')
                return 'internal_computer';
            return row.device;
        },
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const v = asString(value);
            const clinicalIsInbound = p.first.kind === 'human' && p.first.team === 'clinical';
            // Internal-only / none cannot stock the inbound ring group when clinical answers first.
            if (clinicalIsInbound && (v === 'none' || v === 'internal_computer' || v === 'per_room'))
                return p;
            if (v === 'none' || v === 'per_room')
                return policy(p, { notes: v === 'per_room' ? ((p.policy.notes ? p.policy.notes + '; ' : '') + 'Clinical area: not a phone per room.') : p.policy.notes });
            if (v === 'internal_computer')
                return setPlacement(p, 'clinical', 'computer', 1, 'internal');
            if (v === 'desk')
                return setPlacement(p, 'clinical', 'desk', 1, clinicalIsInbound ? 'outside' : 'internal');
            return p;
        }
    },
    {
        id: 'hours.lunch.time',
        type: 'enum',
        enum: ['12-1', '12:30-13:30', '13-14', 'other'],
        description: 'Lunch close window when the owner said phones close at lunch without a time.',
        confirmStep: 'hours',
        read: p => {
            const d = p.hours.days.find(x => x.breakStart && x.breakEnd);
            if (!d)
                return null;
            if (d.breakStart === '12:00' && d.breakEnd === '13:00')
                return '12-1';
            if (d.breakStart === '12:30' && d.breakEnd === '13:30')
                return '12:30-13:30';
            if (d.breakStart === '13:00' && d.breakEnd === '14:00')
                return '13-14';
            return 'other';
        },
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const map: Record<string, [string, string]> = {
                '12-1': ['12:00', '13:00'],
                '12:30-13:30': ['12:30', '13:30'],
                '13-14': ['13:00', '14:00']
            };
            const pair = map[asString(value)];
            if (!pair)
                return p;
            return {
                ...p,
                hours: {
                    ...p.hours,
                    // Apply lunch to weekdays even before open hours exist — preset will keep these breaks.
                    days: p.hours.days.map((d, i) => i < 5 && !d.breakStart ? { ...d, breakStart: pair[0], breakEnd: pair[1] } : d)
                }
            };
        }
    },
    enumField('hours.preset', ['weekdays', 'always', 'custom', 'undecided'], 'Phone-hour preset. weekdays is Monday–Friday 9–5. skip must be undecided, not weekdays.', p => p.policy.hoursPreset, (p, value) => {
        const preset = value as Plan['policy']['hoursPreset'];
        return { ...p, hours: { ...p.hours, days: applyHoursPreset(p.hours.days, preset) }, policy: { ...p.policy, hoursPreset: preset } };
    }, 'hours'),
    enumField('hours.rest_closed', ['closed', 'undecided'], 'Confirm that weekdays or weekend days the owner did not name are closed. Do not fill 9–5 for unnamed days.', p => {
        const open = p.hours.days.filter(d => !(d.stated || (d.start && d.end)));
        return open.length ? null : 'closed';
    }, (p, value) => {
        if (value !== 'closed')
            return p;
        return {
            ...p,
            hours: {
                ...p.hours,
                days: p.hours.days.map(d => (d.stated || (d.start && d.end)) ? d : { ...d, open: false, start: '', end: '', stated: true })
            }
        };
    }, 'hours'),
    {
        id: 'reasons.default_split',
        type: 'enum',
        enum: ['standard'],
        description: 'Apply the usual split: appointments to the front desk, billing to administration when that team exists, clinical questions to clinical.',
        confirmStep: 'routing',
        read: p => p.reasons.every(r => r.team) ? 'standard' : null,
        apply(p, operation) {
            if (operation !== 'set')
                return p;
            const rec = p.teams.some(t => t.role === 'reception' && t.count > 0);
            const adm = p.teams.some(t => t.role === 'administration' && t.count > 0);
            const clin = p.teams.some(t => t.role === 'clinical' && t.count > 0);
            const front = rec ? 'reception' : (p.first.team || 'reception');
            const bill = adm ? 'admin' : front;
            const clinical = clin ? 'clinical' : front;
            return {
                ...p,
                reasons: p.reasons.map(r => r.id === 'appointments' ? { ...r, team: r.team || front }
                    : r.id === 'billing' ? { ...r, team: r.team || bill }
                    : r.id === 'clinical-question' ? { ...r, team: r.team || clinical }
                    : r)
            };
        }
    },
    {
        id: 'locations.names',
        type: 'string',
        description: 'Comma-separated office names when the practice has more than one location.',
        confirmStep: 'practice',
        read: p => p.locations.length > 1 ? p.locations.map(l => l.name).join(', ') : null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const names = asString(value).split(',').map(s => s.trim()).filter(Boolean);
            if (names.length < 2)
                return p;
            return {
                ...p,
                locations: names.map((name, i) => ({ id: p.locations[i]?.id || 'location-' + (i + 1), name })),
                policy: { ...p.policy, locationEntry: p.policy.locationEntry === 'undecided' ? 'shared' : p.policy.locationEntry }
            };
        }
    },
    {
        id: 'hours.timezone',
        type: 'string',
        description: 'IANA timezone, for example America/New_York.',
        confirmStep: 'hours',
        read: p => p.hours.timezone,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const timezone = asString(value);
            try {
                new Intl.DateTimeFormat('en', { timeZone: timezone }).format();
                return { ...p, hours: { ...p.hours, timezone } };
            }
            catch {
                return p;
            }
        }
    },
    {
        id: 'hours.weekdays_start',
        type: 'string',
        description: 'Start time for weekday answering when the owner gave a range without listing days. HH:MM.',
        confirmStep: 'hours',
        read: p => p.hours.days[0]?.start || '',
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const start = normalizeTime(value);
            if (!start)
                return p;
            const someWeekdayStated = p.hours.days.slice(0, 5).some(d => d.stated === true || !!(d.start && d.end));
            return {
                ...p,
                hours: {
                    ...p.hours,
                    days: p.hours.days.map((d, i) => {
                        if (i >= 5)
                            return d;
                        if (someWeekdayStated && !(d.stated || (d.start && d.end)))
                            return d;
                        return { ...d, open: true, start, stated: true };
                    })
                },
                policy: { ...p.policy, hoursPreset: p.policy.hoursPreset === 'always' ? 'always' : p.policy.hoursPreset === 'weekdays' ? 'weekdays' : 'custom' }
            };
        }
    },
    {
        id: 'hours.weekdays_end',
        type: 'string',
        description: 'End time for weekday answering when the owner gave a range without listing days. HH:MM.',
        confirmStep: 'hours',
        read: p => p.hours.days[0]?.end || '',
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const end = normalizeTime(value);
            if (!end)
                return p;
            const someWeekdayStated = p.hours.days.slice(0, 5).some(d => d.stated === true || !!(d.start && d.end));
            return {
                ...p,
                hours: {
                    ...p.hours,
                    days: p.hours.days.map((d, i) => {
                        if (i >= 5)
                            return d;
                        if (someWeekdayStated && !(d.stated || (d.start && d.end)))
                            return d;
                        return { ...d, open: true, end, stated: true };
                    })
                },
                policy: { ...p.policy, hoursPreset: p.policy.hoursPreset === 'always' ? 'always' : p.policy.hoursPreset === 'weekdays' ? 'weekdays' : 'custom' }
            };
        }
    },
    {
        id: 'hours.weekdays_break_start',
        type: 'string',
        description: 'Weekday lunch/break start as HH:MM. Phones are closed during the break. Do not invent a lunch close.',
        confirmStep: 'hours',
        read: p => p.hours.days[0]?.breakStart || '',
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const start = normalizeTime(value);
            if (!start)
                return p;
            return {
                ...p,
                hours: { ...p.hours, days: p.hours.days.map((d, i) => i < 5 && d.open ? { ...d, breakStart: start } : d) }
            };
        }
    },
    {
        id: 'hours.weekdays_break_end',
        type: 'string',
        description: 'Weekday lunch/break end as HH:MM.',
        confirmStep: 'hours',
        read: p => p.hours.days[0]?.breakEnd || '',
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const end = normalizeTime(value);
            if (!end)
                return p;
            return {
                ...p,
                hours: { ...p.hours, days: p.hours.days.map((d, i) => i < 5 && d.open ? { ...d, breakEnd: end } : d) }
            };
        }
    },
    enumField('hours.lunch', ['closed', 'covered', 'undecided'], 'Lunch-hour phones. closed is a scheduled break, not after-hours voicemail. covered means someone stays on the desk. Do not invent 12:00–13:00 when no time was said.', p => {
        if (p.hours.days.some(d => d.breakStart && d.breakEnd))
            return 'closed';
        if (/\blunch phones covered\b/i.test(p.policy.notes))
            return 'covered';
        if (/\blunch phones closed\b/i.test(p.policy.notes))
            return 'closed';
        return 'undecided';
    }, (p, value) => {
        const without = p.policy.notes.replace(/;?\s*lunch phones (closed|covered)\.?/gi, '').replace(/^; |; $/g, '').trim();
        if (value === 'covered')
            return {
                ...p,
                hours: { ...p.hours, days: p.hours.days.map((d, i) => i < 5 ? { ...d, breakStart: '', breakEnd: '' } : d) },
                policy: { ...p.policy, notes: without ? without + '; lunch phones covered' : 'lunch phones covered' }
            };
        if (value === 'closed')
            return policy(p, { notes: without ? without + '; lunch phones closed' : 'lunch phones closed' });
        return p;
    }, 'hours'),
    ...dayFields,
    enumField('languages.decision', ['none', 'selected', 'undecided'], 'Whether callers need a language besides English. none means English is enough.', p => p.policy.languageDecision, (p, value) => {
        const languageDecision = value as Plan['policy']['languageDecision'];
        return { ...p, languages: languageDecision === 'none' ? [] : p.languages, policy: { ...p.policy, languageDecision } };
    }, 'languages'),
    {
        id: 'languages.spanish',
        type: 'boolean',
        description: 'True when the practice can cover Spanish. Do not infer AI language support.',
        confirmStep: 'languages',
        read: p => p.languages.some(l => l.name === 'Spanish'),
        apply(p, operation, value) {
            if (operation === 'skip' || operation === 'clear' || operation === 'uncertain')
                return p;
            const on = asBoolean(value);
            if (!on)
                return { ...p, languages: p.languages.filter(l => l.name !== 'Spanish'), policy: { ...p.policy, languageDecision: p.languages.some(l => l.name !== 'Spanish') ? 'selected' : 'none' } };
            if (p.languages.some(l => l.name === 'Spanish'))
                return { ...p, policy: { ...p.policy, languageDecision: 'selected' } };
            return {
                ...p,
                languages: [...p.languages, {
                    name: 'Spanish',
                    mechanism: p.first.kind === 'menu' ? 'menu' : p.first.kind === 'assistant' ? 'assistant' : 'staff',
                    team: 'reception',
                    availability: 'open',
                    note: '',
                    fallback: 'reception'
                }],
                policy: { ...p.policy, languageDecision: 'selected' }
            };
        }
    },
    {
        id: 'policy.rooms',
        type: 'number',
        min: 0,
        max: 100,
        description: 'Treatment rooms or operatories. Never infer a phone per room.',
        confirmStep: 'positions',
        read: p => p.policy.roomsSpecified ? p.policy.rooms : null,
        apply(p, operation, value) {
            if (operation === 'skip' || operation === 'clear')
                return policy(p, { rooms: 0, roomsSpecified: false });
            if (operation === 'uncertain')
                return p;
            const n = asNumber(value);
            if (n == null || n < 0 || n > 100)
                return p;
            return policy(p, { rooms: Math.floor(n), roomsSpecified: true });
        }
    },
    {
        id: 'devices.reception.desk_count',
        type: 'number',
        min: 0,
        max: 999,
        description: 'Desk phones at reception. Only set when the owner named a phone count. Do not copy staff count.',
        confirmStep: 'positions',
        read: p => p.policy.placements.find(x => x.team === 'reception' && x.device === 'desk')?.count ?? null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const n = asNumber(value);
            return n == null ? p : setPlacement(p, 'reception', 'desk', Math.floor(n));
        }
    },
    {
        id: 'devices.reception.sharing',
        type: 'enum',
        enum: ['shared', 'separate', 'undecided'],
        description: 'Whether two people at the front can pick up at once. separate is two identities. shared is one concurrent answer. Do not invent a phone count from staff or rooms.',
        confirmStep: 'positions',
        read: p => p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing ?? null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const sharing = asString(value);
            if (sharing !== 'shared' && sharing !== 'separate')
                return p;
            return setReceptionSharing(p, sharing);
        }
    },
    {
        id: 'devices.reception.kind',
        type: 'enum',
        enum: ['desk', 'computer', 'both'],
        description: 'What the front desk answers on. desk is a desk phone. computer is a headset computer. both is desk phones with optional WSS on the same identities. Do not invent a count from rooms.',
        confirmStep: 'positions',
        read: p => {
            const row = p.policy.placements.find(x => x.team === 'reception' && x.count > 0);
            if (!row || row.device === 'undecided' || row.device === 'none')
                return null;
            if (row.device === 'computer')
                return 'computer';
            if (/computer \+ headset on the same lines/i.test(p.policy.notes || ''))
                return 'both';
            return 'desk';
        },
        apply(p, operation, value) {
            // Skip must not leave RG 7000 empty when reception answers first.
            if (operation === 'skip' && p.first.kind === 'human' && (p.first.team === 'reception' || !p.first.team)
                && !p.policy.placements.some(x => x.team === 'reception' && x.count > 0 && x.device !== 'undecided' && x.device !== 'none'))
                return p;
            if (operation !== 'set')
                return p;
            const v = asString(value);
            if (v !== 'desk' && v !== 'computer' && v !== 'both')
                return p;
            return setReceptionKind(p, v);
        }
    },
    {
        id: 'busy.backup',
        type: 'string',
        description: 'Team that rings if the front desk does not pick up. Usually administration. Not inbound unless busy.order confirms overflow.',
        confirmStep: 'busy',
        read: p => p.busy.backup || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value));
            return team ? { ...p, busy: { ...p.busy, backup: team } } : p;
        }
    },
    {
        id: 'busy.order',
        type: 'enum',
        enum: ['backup_then_message', 'message_only'],
        description: 'When the front is slammed: ring the backup work mobile then take a message, or message only.',
        confirmStep: 'busy',
        read: p => {
            if (p.busy.kind === 'backup' && p.busy.backup)
                return 'backup_then_message';
            if (p.busy.kind === 'message' && !p.busy.backup)
                return 'message_only';
            return null;
        },
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const v = asString(value);
            if (v === 'backup_then_message')
                return { ...p, busy: { ...p.busy, kind: 'backup', backup: p.busy.backup || 'admin' } };
            if (v === 'message_only')
                return { ...p, busy: { ...p.busy, kind: 'message', backup: '' } };
            return p;
        }
    },
    {
        id: 'hours.lunch.callback',
        type: 'enum',
        enum: ['afternoon', 'unspecified'],
        description: 'When lunch voicemail promises a callback. Do not invent this afternoon unless the owner said it.',
        confirmStep: 'hours',
        read: p => /lunch callback this afternoon/i.test(p.policy.notes || '') ? 'afternoon' : null,
        apply(p, operation, value) {
            if (operation !== 'set' || asString(value) !== 'afternoon')
                return p;
            const note = 'Lunch callback this afternoon.';
            const notes = p.policy.notes && !p.policy.notes.includes(note) ? p.policy.notes + '; ' + note : (p.policy.notes || note);
            return policy(p, { notes });
        }
    },
    {
        id: 'devices.work_mobile',
        type: 'enum',
        enum: ['none', 'app', 'undecided'],
        description: 'Work mobile answering. app is a work phone or Upstate app, possibly Follow Me. Never store a personal number or put one in a recording.',
        confirmStep: 'positions',
        read: p => {
            const n = (p.policy.notes + ' ' + p.policy.continuity.notes).toLowerCase();
            if (/work mobile answering|work app \/ follow me/.test(n))
                return 'app';
            if (/no mobile answering/.test(n))
                return 'none';
            return null;
        },
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const v = asString(value);
            const note = v === 'app'
                ? 'Work mobile answering (app/Follow Me). Personal number not published.'
                : v === 'none'
                    ? 'Office phones only. No mobile answering.'
                    : '';
            if (!note)
                return p;
            const notes = p.policy.notes && !p.policy.notes.includes(note.split('.')[0]) ? p.policy.notes + '; ' + note : (p.policy.notes || note);
            const continuityNotes = p.policy.continuity.notes && !p.policy.continuity.notes.includes(note.split('.')[0])
                ? p.policy.continuity.notes + ' ' + note
                : (p.policy.continuity.notes || note);
            return policy(p, { notes, continuity: { ...p.policy.continuity, notes: continuityNotes } });
        }
    },
    {
        id: 'messages.owner',
        type: 'enum',
        enum: ['reception', 'clinical', 'admin'],
        description: 'Who checks missed-call and after-hours messages. Maps to busy.owner and after.owner. A mailbox nobody opens is not a working path.',
        confirmStep: 'busy',
        read: p => {
            const busy = p.busy.kind === 'message' ? p.busy.owner : '';
            const after = p.after.kind === 'message' ? p.after.owner : '';
            return busy || after || null;
        },
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const team = resolveTeam(p, asString(value));
            if (!team)
                return p;
            let next = { ...p, busy: { ...p.busy, owner: team }, after: { ...p.after, owner: team } };
            if (next.policy.beforeOpening === 'message')
                next = policy(next, { beforeOpeningOwner: team });
            return next;
        }
    },
    {
        id: 'devices.reception.computer_count',
        type: 'number',
        min: 0,
        max: 999,
        description: 'Computer answering positions at reception. Only when the owner said someone answers on a computer.',
        confirmStep: 'positions',
        read: p => p.policy.placements.find(x => x.team === 'reception' && x.device === 'computer')?.count ?? null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const n = asNumber(value);
            return n == null ? p : setPlacement(p, 'reception', 'computer', Math.floor(n));
        }
    },
    enumField('followup', ['yes', 'calls', 'skip'], 'Extra patient messaging beyond missed-call voicemail. skip keeps call messages only.', p => p.policy.followup, (p, value) => policy(p, { followup: value as Plan['policy']['followup'] }), 'followup'),
    enumField('billing.performed_by', ['reception', 'administration', 'clinical', 'split', 'undecided'], 'Who performs billing. This is a responsibility, not extra headcount. Front-desk staff who also bill stay on teams.reception.count.', p => p.policy.billingPerformedBy, (p, value) => policy(p, { billingPerformedBy: value as Plan['policy']['billingPerformedBy'] }), 'team'),
    {
        id: 'urgent.scope',
        type: 'enum',
        enum: ['urgent_only', 'all_calls', 'undecided'],
        description: 'Whether clinician or on-call routing applies only to urgent clinical calls or to every incoming call. Ask whenever the owner names a clinician destination without that distinction. Recording a destination is not a verified live route.',
        confirmStep: 'urgent',
        read: p => p.policy.urgentScope,
        apply(p, operation, value) {
            if (operation === 'uncertain' || operation === 'skip' || operation === 'clear')
                return policy(p, { urgentScope: 'undecided', pendingClinicianRoute: false });
            const scope = normalizeEnum('urgent.scope', value);
            if (scope !== 'urgent_only' && scope !== 'all_calls')
                return p;
            let next = policy(p, { urgentScope: scope as Plan['policy']['urgentScope'], pendingClinicianRoute: false });
            if (scope === 'urgent_only') {
                if (next.policy.urgentKind === 'undecided')
                    next = { ...next, urgent: { ...next.urgent, enabled: true, team: next.urgent.team || 'clinical' }, policy: { ...next.policy, urgentKind: 'connect', urgentCoverage: next.policy.urgentCoverage === 'undecided' ? 'always' : next.policy.urgentCoverage } };
                if (next.first.kind === 'undecided' || next.first.kind === 'human' && !next.first.team)
                    next = { ...next, first: { kind: 'human', team: 'reception' } };
            }
            if (scope === 'all_calls') {
                // Only flip daytime first-answer to clinical when we were resolving a clinician-route ambiguity.
                // If the owner already chose reception / no on-call, "every call" must not invent doctor-first.
                const alreadyDesk = next.first.kind === 'human' && next.first.team === 'reception';
                const noLiveUrgent = next.policy.urgentKind === 'none';
                if (alreadyDesk || noLiveUrgent)
                    next = policy(next, { urgentScope: 'all_calls', pendingClinicianRoute: false });
                else
                    next = { ...next, first: { kind: 'human', team: 'clinical' }, urgent: { ...next.urgent, enabled: true, team: next.urgent.team || 'clinical' }, policy: { ...next.policy, urgentKind: next.policy.urgentKind === 'undecided' ? 'connect' : next.policy.urgentKind } };
            }
            return next;
        }
    },
    {
        id: 'urgent.pending_route',
        type: 'boolean',
        description: 'Owner named a clinician or on-call destination without saying whether that is every call or only urgent calls. Not a routing decision.',
        confirmStep: 'urgent',
        read: p => p.policy.pendingClinicianRoute,
        apply(p, operation, value) {
            if (operation !== 'set')
                return policy(p, { pendingClinicianRoute: false });
            return policy(p, { pendingClinicianRoute: asBoolean(value) === true });
        }
    },
    enumField('policy.ring', ['together', 'order', 'undecided'], 'Whether available reception phones ring together or in order.', p => p.policy.ring, (p, value) => policy(p, { ring: value as Plan['policy']['ring'] }), 'positions'),
    enumField('locationEntry', ['shared', 'menu', 'separate', 'undecided'], 'How a multi-location main number chooses a site. menu is press-for-location. separate is one DID per office. shared is one reception team asking which location.', p => p.policy.locationEntry, (p, value) => policy(p, { locationEntry: value as Plan['policy']['locationEntry'] }), 'practice'),
    {
        id: 'opening.pms',
        type: 'string',
        description: 'Practice-management software name. Recording the name is not a verified booking integration.',
        confirmStep: 'practice',
        read: p => p.policy.opening.pms || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return opening(p, { pms: '' });
            return opening(p, { pms: asString(value).slice(0, 80) });
        }
    },
    {
        id: 'current.monthly',
        type: 'string',
        description: 'Stated monthly phone spend. Do not invent a market comparison.',
        read: p => p.current.monthly || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            return { ...p, current: { ...p.current, monthly: asString(value).slice(0, 40) } };
        }
    },
    {
        id: 'current.contract',
        type: 'string',
        description: 'Stated current phone contract length. Do not invent a term.',
        read: p => p.policy.contract || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            return policy(p, { contract: asString(value).slice(0, 80) });
        }
    },
    {
        id: 'policy.notes',
        type: 'string',
        description: 'Free-text planning notes such as a second city. Append, do not replace.',
        read: p => p.policy.notes || null,
        apply(p, operation, value) {
            if (operation !== 'set')
                return p;
            const note = asString(value).slice(0, 160).replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g, '').replace(/\s{2,}/g, ' ').trim();
            if (!note)
                return p;
            const notes = p.policy.notes && !p.policy.notes.includes(note) ? p.policy.notes + '; ' + note : (p.policy.notes || note);
            return policy(p, { notes });
        }
    },
    enumField('continuity.backupRouting', ['undecided', 'cellular', 'forward', 'none'], 'Preferred destination when office internet fails. Recording a preference is not a provisioned failover.', p => p.policy.continuity.backupRouting, (p, value) => policy(p, { continuity: { ...p.policy.continuity, backupRouting: value as Plan['policy']['continuity']['backupRouting'] } }), 'current'),
    enumField('busy.exit', ['message', 'backup', 'assistant', 'undecided'], 'What happens after the queue wait. message is voicemail.', p => p.policy.queueExit, (p, value) => policy(p, { queueExit: value as Plan['policy']['queueExit'] }), 'busy'),
    enumField('beforeOpening', ['information', 'message', 'undecided'], 'How callers reach you before opening day. message is a callback request. Not the after-hours path.', p => p.policy.beforeOpening, (p, value) => {
        let next = policy(p, { beforeOpening: value as Plan['policy']['beforeOpening'] });
        if (value === 'information' && !next.policy.beforeOpeningText?.trim())
            next = policy(next, { beforeOpeningText: suggestedGreeting(next) });
        if (value === 'message' && !next.policy.beforeOpeningOwner) {
            const owner = next.after.owner || next.busy.owner;
            if (owner)
                next = policy(next, { beforeOpeningOwner: owner });
        }
        return next;
    }, 'practice'),
    enumField('holidayPolicy', ['closed', 'regular'], 'Holiday answering. closed plays a closure message. Temporary weather closures are separate.', p => p.hours.holidayPolicy, (p, value) => ({ ...p, hours: { ...p.hours, holidayPolicy: value as Plan['hours']['holidayPolicy'] } }), 'hours'),
    {
        id: 'future.ai_receptionist',
        type: 'string',
        description: 'Future AI interest. Must not change launch first.kind or after.kind.',
        read: () => null,
        apply: p => p
    }
];

const byId = new Map(fields.map(f => [f.id, f]));

export function fieldById(id: string) {
    return byId.get(id);
}

export function catalog(): FieldCatalogEntry[] {
    return fields.filter(f => !f.blocked).map(({ id, type, enum: options, min, max, description }) => ({
        id, type, enum: options, min, max, description
    }));
}

export function relevantCatalog(questionId: string | null, unsettled: string[] = []) {
    const all = catalog();
    const keep = new Set<string>(['mode', 'name', 'specialty', 'specialtyDetail', 'cityState']);
    if (questionId)
        keep.add(questionId);
    for (const id of unsettled)
        keep.add(id);
    if (questionId) {
        const prefix = questionId.split('.')[0];
        for (const row of all)
            if (row.id === questionId || row.id.startsWith(prefix + '.'))
                keep.add(row.id);
    }
    const rows = all.filter(f => keep.has(f.id));
    const picked = rows.length ? rows : all.slice(0, 24);
    return picked.map(f => {
        const row: { id: string; type: string; enum?: string[] } = { id: f.id, type: f.type };
        if (f.enum)
            row.enum = f.enum;
        return row;
    });
}

export function allowedFieldIds() {
    return fields.filter(f => !f.blocked).map(f => f.id);
}

export function isBlockedField(id: string) {
    return (BLOCKED_FIELD_IDS as readonly string[]).includes(id) || fieldById(id)?.blocked === true;
}

function resolveTeam(p: Plan, value: string) {
    const s = value.trim().toLowerCase();
    if (s === 'front desk' || s === 'receptionist' || s === 'receptionists' || s === 'reception' || s === 'girls' || s === 'the girls')
        return p.teams.find(t => t.role === 'reception')?.id || 'reception';
    if (s === 'dentist' || s === 'clinical' || s === 'clinician' || s === 'assistants' || s === 'i do' || s === 'me')
        return p.teams.find(t => t.role === 'clinical')?.id || 'clinical';
    if (s === 'office manager' || s === 'admin' || s === 'administration' || s === 'billing')
        return p.teams.find(t => t.role === 'administration')?.id || 'admin';
    return p.teams.find(t => t.id === value || t.role === value || t.name.toLowerCase() === s)?.id;
}

function keptSharing(p: Plan, team: string): Plan['policy']['placements'][number]['sharing'] | undefined {
    return p.policy.placements.find(x => x.team === team && x.sharing !== 'undecided')?.sharing;
}

function receptionKnownCount(p: Plan) {
    return p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
}

function receptionLineCount(p: Plan, sharing: 'shared' | 'separate') {
    const recN = receptionKnownCount(p);
    if (sharing === 'separate')
        return recN > 1 ? recN : recN === 1 ? 1 : 0;
    return recN > 0 ? 1 : 0;
}

function setReceptionSharing(p: Plan, sharing: 'shared' | 'separate'): Plan {
    const rec = p.policy.placements.filter(x => x.team === 'reception');
    const inferred = receptionLineCount(p, sharing);
    if (rec.length)
        return policy(p, {
            placements: p.policy.placements.map(x => x.team === 'reception'
                ? { ...x, sharing, count: x.device !== 'undecided' && x.count > 0 ? x.count : inferred }
                : x)
        });
    return policy(p, {
        placements: [...p.policy.placements, {
            id: 'reception-share',
            team: 'reception',
            label: 'Front desk',
            device: 'undecided',
            count: inferred,
            access: 'outside' as const,
            sharing,
            extension: ''
        }]
    });
}

function setReceptionKind(p: Plan, kind: 'desk' | 'computer' | 'both'): Plan {
    const rec = p.policy.placements.find(x => x.team === 'reception');
    const sharing = (rec?.sharing && rec.sharing !== 'undecided'
        ? rec.sharing
        : receptionKnownCount(p) <= 1 ? 'shared' : 'separate') as 'shared' | 'separate';
    const count = rec?.count && rec.count > 0 ? rec.count : receptionLineCount(p, sharing);
    const device = kind === 'computer' ? 'computer' : 'desk';
    let next = setPlacement(p, 'reception', device, Math.max(count, 1), 'outside', sharing);
    if (kind === 'both') {
        const note = 'Front desk also uses computer + headset on the same lines.';
        const notes = next.policy.notes && !next.policy.notes.includes(note) ? next.policy.notes + '; ' + note : (next.policy.notes || note);
        next = policy(next, { notes });
    }
    return next;
}

function setPlacement(p: Plan, team: string, device: 'desk' | 'computer' | 'mobile', count: number, access: 'outside' | 'internal' = 'outside', sharingOverride?: 'shared' | 'separate'): Plan {
    const sharing = sharingOverride || keptSharing(p, team) || (count > 1 ? 'separate' as const : 'shared' as const);
    const existing = p.policy.placements.filter(x => {
        if (x.team !== team)
            return true;
        if (x.device === device)
            return false;
        if (x.device === 'undecided')
            return false;
        return true;
    });
    const row = p.policy.placements.find(x => x.team === team && x.device === device)
        || p.policy.placements.find(x => x.team === team && x.device === 'undecided');
    const next = [...existing, {
        id: row?.id || team + '-' + device,
        team,
        label: team === 'reception' ? 'Front desk' : team === 'admin' ? 'Administration' : team === 'clinical' ? 'Clinical' : team,
        device,
        count,
        sharing,
        access,
        extension: row?.extension || ''
    }];
    return policy(p, { placements: next });
}

function setReasonTeam(p: Plan, id: string, operation: FieldOperation, value: Scalar): Plan {
    if (operation !== 'set')
        return p;
    const team = resolveTeam(p, asString(value)) || asString(value);
    if (!team)
        return p;
    const mapped = team === 'administration' ? 'admin' : team;
    if (!p.reasons.some(r => r.id === id))
        return p;
    return { ...p, reasons: p.reasons.map(r => r.id === id ? { ...r, team: mapped } : r) };
}

function patchLanguages(p: Plan, patch: Partial<Plan['languages'][number]>): Plan {
    if (!p.languages.length)
        return p;
    return { ...p, languages: p.languages.map((l, i) => i === 0 || l.name === 'Spanish' ? { ...l, ...patch } : l) };
}

export function readConfirmed(p: Plan, facts: Record<string, { status: string; value: Scalar }>) {
    const out: Record<string, Scalar> = {};
    for (const field of fields) {
        const fact = facts[field.id];
        if (fact?.status === 'confirmed')
            out[field.id] = fact.value;
        else if (field.read(p) != null && field.read(p) !== '' && field.read(p) !== false)
            continue;
    }
    return out;
}
