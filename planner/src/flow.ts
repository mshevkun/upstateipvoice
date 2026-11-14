import type { Plan } from './config';

export const chapters = [
    'Your practice',
    'People & hours',
    'Call experience',
    'When closed',
    'Equipment',
    'Your blueprint'
] as const;

/** Same IDs as before so confirmed[] and PDFs stay valid. Order is the owner journey. */
export const steps = [
    ['start', 'Your practice', 'What are you setting up?', 'This choice shapes later questions. You can change it.'],
    ['kind', 'Your practice', 'What kind of practice is this?', 'You can change this anytime. Dental and eye-care rooms look different.'],
    ['practice', 'Your practice', 'Tell us about this location.', 'Keep this compact. We will ask about phones after you design the call experience.'],
    ['team', 'People & hours', 'Who will work at this location?', 'Approximate counts are fine. We decide which staff need phones later.'],
    ['hours', 'People & hours', 'When can your team answer calls?', 'Start with a normal week. Change individual days only when you need to.'],
    ['first', 'Call experience', 'Who should answer first?', 'Choose what patients experience when they call during your answering hours.'],
    ['reasons', 'Call experience', 'Where should different calls go?', 'Start with common reasons. Destinations are editable.'],
    ['busy', 'Call experience', 'What if nobody answers?', 'Pick the patient experience first. Timing and fallbacks appear after that.'],
    ['after', 'When closed', 'What happens after hours?', 'Choose the main policy. Details appear for the option you pick.'],
    ['urgent', 'When closed', 'Do urgent calls need a separate path?', 'Use practice-approved wording. Private numbers stay out of this plan.'],
    ['languages', 'When closed', 'Do callers need another language?', 'Skip this if English is enough. Coverage is only added when you can provide it.'],
    ['followup', 'When closed', 'Any extra patient messaging?', 'Voicemail ownership is already part of missed-call handling. This is optional.'],
    ['positions', 'Equipment', 'Where do phones need to be?', 'Based on who answers calls. Shared identities stay behind advanced setup.'],
    ['current', 'Equipment', 'What still needs to be ready?', 'Numbers, network, and opening-day calls. Packages are optional to explore.'],
    ['review', 'Your blueprint', 'Your communications blueprint', 'See what to buy, what is still open, and download a free plan.']
] as const;

export type StepId = typeof steps[number][0];

const legacyOrder = ['start', 'practice', 'team', 'positions', 'first', 'reasons', 'busy', 'languages', 'hours', 'after', 'urgent', 'followup', 'current', 'review'];

export const help: Record<string, string> = {
    welcome: 'This planner records how you want calls handled. It does not install phones or create an account.',
    start: 'Opening a new practice asks about construction and opening-day calls. Improving an existing office skips those and asks what is broken today. Adding a location asks whether it shares reception.',
    kind: 'Dental and eye-care illustrations change the exam space. Other specialties stay a consultation room. You can type a specialty if you choose Other.',
    practice: 'A name and city help with timezone and installation planning. An approximate month is enough if you do not have an exact day.',
    team: 'Count each person once by their main role. Zero is allowed. Decide later keeps the role as an open decision. Who takes inbound calls is not a phone order.',
    hours: 'These are phone-answering hours, which may differ from office hours. Overnight coverage can use 24-hour coverage or a custom day. Lunch is a separate window — many offices lose new-patient calls then.',
    first: 'A person rings your team. A menu asks the caller to choose. An AI receptionist is a proposed service until Upstate verifies it. Help me choose leaves this open.',
    reasons: 'With a person first, these are handoff policies — not an IVR. A menu is only created if you chose one.',
    busy: 'Ringing has a timeout. Waiting is extra time after that. The total is the sum, and it is shown before you continue. Someone has to own the mailbox — a miss should not sit unheard.',
    after: 'An answering service and virtual receptionist stay unverified until a vendor confirms them. No booking or clinical advice is assumed.',
    urgent: 'Live connect is a transfer attempt with a backup. A priority message is not clinician contact. Do not enter private numbers.',
    languages: 'Add only coverage your practice can actually provide. Selected-hour coverage uses your practice timezone.',
    followup: 'Callback requests are not bookings. SMS and reminders need consent and a configured service.',
    positions: 'Count positions that can answer at the same time. Shared devices on one identity are not independently usable phones. Rooms do not automatically get phones.',
    current: 'Quantities and contractor tasks, not prices. Checking a box here does not verify a live installation.',
    review: 'The owner blueprint is free and does not require a meeting. Simulation walks the same routing graph as the PDF and sends no calls.'
};

export function stepIndex(id: string) {
    return steps.findIndex(s => s[0] === id);
}

export function restoreStep() {
    try {
        const raw = sessionStorage.getItem('upstate.step');
        if (raw === null || raw === '')
            return -1;
        const byId = stepIndex(raw);
        if (byId >= 0)
            return byId;
        const n = Number(raw);
        if (Number.isInteger(n) && n === -1)
            return -1;
        if (Number.isInteger(n) && n >= 0 && n < legacyOrder.length)
            return Math.max(0, stepIndex(legacyOrder[n]));
    }
    catch { /* private browsing */ }
    return -1;
}

export function chapterIndex(id: string) {
    const row = steps.find(s => s[0] === id);
    return row ? chapters.indexOf(row[1] as typeof chapters[number]) : 0;
}

export function chapterStart(chapter: number) {
    const name = chapters[chapter];
    return Math.max(0, steps.findIndex(s => s[1] === name));
}

/** Numeric chapter the 3D scene already understands. */
export function sceneChapter(id: string, step: number) {
    if (step < 0)
        return 0;
    if (id === 'start')
        return 0;
    if (id === 'kind' || id === 'practice')
        return 1;
    if (id === 'team' || id === 'hours')
        return 2;
    if (id === 'positions' || id === 'current' || id === 'review')
        return 3;
    return 2;
}

export function dayIsStated(d: Plan['hours']['days'][number]) {
    return d.stated === true || !!(d.start && d.end);
}

/** True when at least one day has a real open answering window (not lunch-only). */
export function hasOpenPhoneHours(p: Plan) {
    return p.hours.days.some(d => !!(d.start && d.end));
}

export function applyHoursPreset(days: Plan['hours']['days'], preset: 'weekdays' | 'always' | 'custom' | 'undecided') {
    if (preset === 'always')
        return days.map(d => ({ ...d, open: true, start: '00:00', end: '24:00', breakStart: '', breakEnd: '', stated: true }));
    if (preset === 'weekdays')
        return days.map((d, i) => ({
            ...d,
            open: i < 5,
            start: i < 5 ? '09:00' : '',
            end: i < 5 ? '17:00' : '',
            breakStart: i < 5 ? d.breakStart : '',
            breakEnd: i < 5 ? d.breakEnd : '',
            stated: true
        }));
    if (preset === 'undecided')
        return days.map(d => ({ ...d, open: false, start: '', end: '', breakStart: '', breakEnd: '', stated: false }));
    return days;
}

export function hoursSummary(p: Plan) {
    const known = p.hours.days.filter(dayIsStated);
    if (!known.length)
        return 'Hours not given yet';
    const open = known.filter(d => d.open && d.start && d.end);
    if (!open.length) {
        // Lunch breaks parked on days with no open window are not a closed week.
        if (known.some(d => d.breakStart || d.breakEnd) && !hasOpenPhoneHours(p))
            return 'Hours not given yet';
        if (known.every(d => !d.open))
            return 'Closed all week';
        return 'Hours not given yet';
    }
    if (open.length === 7 && open.every(d => d.start === '00:00' && (d.end === '24:00' || d.end === '23:59')))
        return '24-hour phone coverage';
    const same = open.every(d => d.start === open[0].start && d.end === open[0].end);
    const closed = known.filter(d => !d.open).map(d => d.day.slice(0, 3)).join(', ');
    const weekdaysStatedOpen = p.hours.days.slice(0, 5).every(d => dayIsStated(d) && d.open);
    if (same && open.length === 5 && weekdaysStatedOpen)
        return 'Mon–Fri · ' + formatTime(open[0].start) + '–' + formatTime(open[0].end) + (open[0].breakStart && open[0].breakEnd ? ' · lunch ' + formatTime(open[0].breakStart) + '–' + formatTime(open[0].breakEnd) : '');
    if (same)
        return open.map(d => d.day.slice(0, 3)).join(', ') + ' · ' + formatTime(open[0].start) + '–' + formatTime(open[0].end) + (open[0].breakStart && open[0].breakEnd ? ' · lunch ' + formatTime(open[0].breakStart) + '–' + formatTime(open[0].breakEnd) : '') + (closed ? ' · Closed ' + closed : '');
    return open.map(d => {
        const lunch = d.breakStart && d.breakEnd ? ' lunch ' + formatTime(d.breakStart) + '–' + formatTime(d.breakEnd) : '';
        return d.day.slice(0, 3) + ' ' + formatTime(d.start) + '–' + formatTime(d.end) + lunch;
    }).join(' · ') + (closed ? ' · Closed ' + closed : '');
}

export function lunchCallbackPhrase(p: Plan, kind: 'script' | 'brief' = 'script') {
    const afternoon = /lunch callback this afternoon/i.test(p.policy.notes || '');
    if (kind === 'brief')
        return afternoon ? 'calls back the same afternoon' : 'calls back';
    return afternoon ? 'we will call you back this afternoon' : 'we will call you back';
}

export function formatTime(value: string) {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    if (!m)
        return value;
    let h = +m[1];
    const min = m[2];
    if (h === 24 && min === '00')
        return '12:00 AM';
    const suffix = h >= 12 && h < 24 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0)
        h = 12;
    return h + ':' + min + ' ' + suffix;
}

export function parseTime(text: string) {
    const t = text.trim().toLowerCase().replace(/\s+/g, '');
    const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(t);
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

export function suggestedGreeting(p: Plan) {
    const name = p.name.trim() || 'the practice';
    const when = formatOpening(p);
    const openBit = when
        ? 'We are not open yet. We open ' + when + '. '
        : 'We are not open yet. Please check back after we open. ';
    return 'Thank you for calling ' + name + '. ' + openBit + 'For a true emergency, hang up and dial 911.';
}

export function formatOpening(p: Plan) {
    const date = p.policy.opening.date;
    const precision = p.policy.opening.precision || (date ? 'day' : 'none');
    if (precision === 'none' || !date)
        return '';
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?/.exec(date);
    if (!m)
        return date;
    const d = new Date(+m[1], +m[2] - 1, precision === 'month' ? 1 : +(m[3] || 1));
    return precision === 'month'
        ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

export function openingLabel(p: Plan) {
    const mode = p.mode === 'opening' ? 'New' : p.mode === 'improving' ? 'Existing' : p.mode === 'adding' ? 'Added location' : '';
    const spec = p.specialty === 'Other healthcare practice' ? (p.specialtyDetail || 'healthcare') : p.specialty;
    const noun = spec ? spec.toLowerCase() + ' practice' : 'practice';
    const head = mode ? mode + ' ' + noun : (spec ? noun.charAt(0).toUpperCase() + noun.slice(1) : '');
    const when = formatOpening(p);
    const bits = [head, when ? (p.policy.opening.precision === 'month' ? 'Planned opening ' + when : 'Opening ' + when) : ''].filter(Boolean);
    return bits.join(' · ');
}

export const waitChoices = [30, 60, 90] as const;

export const reasonPresets = [
    { id: 'appointments', label: 'Appointments and scheduling', team: 'reception' },
    { id: 'billing', label: 'Billing and insurance questions', team: 'admin' },
    { id: 'clinical-question', label: 'Clinical questions', team: 'clinical' }
] as const;
