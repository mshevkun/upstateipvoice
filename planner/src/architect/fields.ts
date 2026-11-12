import { days, type Plan } from '../config';
import { applyHoursPreset } from '../flow';
import { setRole, type Role } from '../team-state';
import type { FieldCatalogEntry, FieldDef, FieldOperation, Scalar } from './types';
export { updatesFromOwnerText, detectIntent, clinicianRouteAmbiguous, mergeInterpreterUpdates, specifiesUrgentScope } from './extract';

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
    return setRole(p, role, 'known', Math.floor(n));
}

function setDay(p: Plan, day: string, patch: Partial<Plan['hours']['days'][number]>): Plan {
    return {
        ...p,
        hours: {
            ...p.hours,
            days: p.hours.days.map(d => d.day === day ? { ...d, ...patch } : d)
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
        description: 'Practice name. Optional.',
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
            const team = kind === 'human' && !p.first.team && p.teams.some(t => t.role === 'reception' && t.count > 0) ? 'reception' : p.first.team;
            let next = { ...p, first: { ...p.first, kind: kind as Plan['first']['kind'], team } };
            if (kind === 'human' && next.policy.ring === 'undecided')
                next = policy(next, { ring: 'together' });
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
            return { ...p, urgent: { ...p.urgent, enabled: kind !== 'none' && kind !== 'undecided' }, policy: { ...p.policy, urgentKind: kind as Plan['policy']['urgentKind'] } };
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
    enumField('hours.preset', ['weekdays', 'always', 'custom', 'undecided'], 'Phone-hour preset. weekdays is Monday–Friday 9–5. skip must be undecided, not weekdays.', p => p.policy.hoursPreset, (p, value) => {
        const preset = value as Plan['policy']['hoursPreset'];
        return { ...p, hours: { ...p.hours, days: applyHoursPreset(p.hours.days, preset) }, policy: { ...p.policy, hoursPreset: preset } };
    }, 'hours'),
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
            return {
                ...p,
                hours: { ...p.hours, days: p.hours.days.map((d, i) => i < 5 ? { ...d, open: true, start } : d) },
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
            return {
                ...p,
                hours: { ...p.hours, days: p.hours.days.map((d, i) => i < 5 ? { ...d, open: true, end } : d) },
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
    enumField('hours.lunch', ['closed', 'covered', 'undecided'], 'Lunch-hour phones. closed is a scheduled break, not after-hours voicemail. covered means someone stays on the desk.', p => {
        const day = p.hours.days[0];
        if (day?.breakStart && day?.breakEnd)
            return 'closed';
        return 'undecided';
    }, (p, value) => {
        if (value === 'covered')
            return { ...p, hours: { ...p.hours, days: p.hours.days.map((d, i) => i < 5 ? { ...d, breakStart: '', breakEnd: '' } : d) } };
        if (value === 'closed')
            return {
                ...p,
                hours: {
                    ...p.hours,
                    days: p.hours.days.map((d, i) => i < 5 && d.open ? { ...d, breakStart: d.breakStart || '12:00', breakEnd: d.breakEnd || '13:00' } : d)
                }
            };
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
                languages: [...p.languages, { name: 'Spanish', mechanism: p.first.kind === 'menu' ? 'menu' : p.first.kind === 'assistant' ? 'assistant' : 'staff', team: '', availability: 'open', note: '', fallback: '' }],
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
            if (scope === 'all_calls')
                next = { ...next, first: { kind: 'human', team: 'clinical' }, urgent: { ...next.urgent, enabled: true, team: next.urgent.team || 'clinical' }, policy: { ...next.policy, urgentKind: next.policy.urgentKind === 'undecided' ? 'connect' : next.policy.urgentKind } };
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

function setReceptionSharing(p: Plan, sharing: 'shared' | 'separate'): Plan {
    const rec = p.policy.placements.filter(x => x.team === 'reception');
    if (rec.length)
        return policy(p, { placements: p.policy.placements.map(x => x.team === 'reception' ? { ...x, sharing } : x) });
    return policy(p, { placements: [...p.policy.placements, {
        id: 'reception-sharing',
        team: 'reception',
        label: 'Front desk',
        device: 'undecided',
        count: 0,
        sharing,
        access: 'outside',
        extension: ''
    }] });
}

function setPlacement(p: Plan, team: string, device: 'desk' | 'computer' | 'mobile', count: number): Plan {
    const sharing = keptSharing(p, team) || (count > 1 ? 'separate' as const : 'shared' as const);
    const existing = p.policy.placements.filter(x => !(x.team === team && (x.device === device || x.device === 'undecided' && x.count === 0)));
    const row = p.policy.placements.find(x => x.team === team && x.device === device);
    const next = [...existing, {
        id: row?.id || team + '-' + device,
        team,
        label: team === 'reception' ? 'Front desk' : team,
        device,
        count,
        sharing,
        access: 'outside' as const,
        extension: row?.extension || ''
    }];
    return policy(p, { placements: next });
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
