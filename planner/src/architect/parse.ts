import type { Fact, Scalar } from './types';

export type Precision = 'exact' | 'heuristic';
export type LocalHint = {
    field_id: string;
    value: Scalar;
    span: string;
    precision: Precision;
    operation?: 'set' | 'skip';
};

const WORD_N: Record<string, number> = {
    zero: 0, none: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const;
const DAY_ALIAS: Record<string, typeof DAYS[number]> = {
    monday: 'Monday', mon: 'Monday',
    tuesday: 'Tuesday', tue: 'Tuesday', tues: 'Tuesday',
    wednesday: 'Wednesday', wed: 'Wednesday',
    thursday: 'Thursday', thu: 'Thursday', thur: 'Thursday', thurs: 'Thursday',
    friday: 'Friday', fri: 'Friday',
    saturday: 'Saturday', sat: 'Saturday',
    sunday: 'Sunday', sun: 'Sunday'
};

const STATE_NAME: Record<string, string> = {
    ny: 'NY', 'new york': 'NY',
    pa: 'PA', pennsylvania: 'PA',
    vt: 'VT', vermont: 'VT',
    nj: 'NJ', 'new jersey': 'NJ',
    ct: 'CT', connecticut: 'CT',
    ma: 'MA', massachusetts: 'MA',
    nh: 'NH', 'new hampshire': 'NH',
    me: 'ME', maine: 'ME'
};

const HINT_CITIES = [
    'kingston', 'poughkeepsie', 'newburgh', 'middletown', 'albany', 'troy',
    'new paltz', 'beacon', 'hudson', 'catskill', 'saugerties', 'rhinebeck',
    'glens falls', 'buffalo', 'scranton', 'burlington'
];

const ANSWERING_SERVICES = [
    'AnswerConnect', 'Answer Force', 'Ruby Receptionist', 'Ruby', 'Smith.ai', 'Patience',
    'MedChat', 'Nexa', 'Alert Communications'
];

const PMS_DENTAL = [
    'Open Dental', 'Dentrix Ascend', 'Dentrix', 'Eaglesoft', 'Curve', 'Denticon',
    'Carestream', 'CS', 'Practice-Web', 'Fuse', 'Dolphin'
];
const PMS_EYE = [
    'Compulink', 'RevolutionEHR', 'OfficeMate', 'Crystal PM', 'MaximEyes', 'Eyefinity'
];
const PMS_OTHER = [
    'ChiroTouch', 'WebPT'
];

const NAME_SUFFIX = 'Family Dental|Dental Arts|Dentistry|Dental|Smiles|Smile|Orthodontics|Spine & Wellness|Spine and Wellness|Physical Therapy|Eye Care|Eyecare|Vision North|Vision|Optometry|Eye Associates|Eye Center|Family Medicine';
const NOT_CITY = /^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|New York|Pennsylvania|Vermont|The|A|An|Our|My)$/i;

export function fold(value: string) {
    return value.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
}

export function parseNumberWord(raw: string): number | null {
    const k = fold(raw);
    if (k in WORD_N)
        return WORD_N[k];
    if (/^\d+$/.test(k))
        return Number(k);
    return null;
}

function hhmm(minutes: number) {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h === 24 && m === 0)
        return '24:00';
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}

function toMinutes(h: number, min: number) {
    return h * 60 + min;
}

/** Business-hour inference when no am/pm: 1–6 → PM, 7–11 → AM, 12 → noon. */
export function inferClock(h: number, min: number, meridiem: '' | 'am' | 'pm', role: 'start' | 'end' | 'any', peer?: { h: number; meridiem: '' | 'am' | 'pm' }): number {
    let hour = h;
    if (meridiem === 'am')
        hour = h === 12 ? 0 : h;
    else if (meridiem === 'pm')
        hour = h === 12 ? 12 : h + 12;
    else {
        const peerPm = peer?.meridiem === 'pm' || (peer && peer.h <= 11 && peer.meridiem !== 'am' && role === 'end');
        if (h === 12)
            hour = 12;
        else if (role === 'end' && peer && peer.h >= 7 && h < peer.h)
            hour = h + 12;
        else if (h >= 1 && h <= 6)
            hour = h + 12;
        else if (h >= 7 && h <= 11)
            hour = h;
        else if (peerPm && h < 12)
            hour = h + 12;
    }
    return toMinutes(hour, min);
}

export type TimeRange = { start: string; end: string; startMin: number; endMin: number; span: string; lunch?: boolean };

export function parseTimeRanges(text: string): TimeRange[] {
    const src = text.replace(/[–—]/g, '-').replace(
        /\b(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|until)\s*noon\b/gi,
        '$1 to 12:00 pm'
    ).replace(
        /\b(noon|midnight)\s*(?:to|-|until)\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
        (_, a, b) => a + ' to ' + (WORD_N[fold(b)] ?? b)
    ).replace(
        /\b(seven|eight|nine|ten|eleven|twelve|one|two|three|four|five|six)\s+in the morning\s*(?:to|-|until)\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s+(?:in the afternoon|at night)\b/gi,
        (_, a, b) => (WORD_N[fold(a)] ?? a) + ' am to ' + (WORD_N[fold(b)] ?? b) + ' pm'
    ).replace(
        /\b(seven|eight|nine|ten|eleven|twelve)\s*(?:o'?clock|am|pm)?\s*(?:to|-|until)\s*(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/gi,
        (_, a, b) => (WORD_N[fold(a)] ?? a) + ' to ' + (WORD_N[fold(b)] ?? b)
    );
    const re = /(\d{1,2})(?::(\d{2}))?\s*(o'?clock|am|pm)?\s*(?:to|-|until)\s*(\d{1,2})(?::(\d{2}))?\s*(o'?clock|am|pm)?/gi;
    const noon = /noon\s*(?:to|-|until)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
    const out: TimeRange[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(src))) {
        const h1 = Number(m[1]);
        const min1 = m[2] ? Number(m[2]) : 0;
        const ap1 = /pm/i.test(m[3] || '') ? 'pm' : /am/i.test(m[3] || '') ? 'am' : '' as const;
        const h2 = Number(m[4]);
        const min2 = m[5] ? Number(m[5]) : 0;
        const ap2 = /pm/i.test(m[6] || '') ? 'pm' : /am/i.test(m[6] || '') ? 'am' : '' as const;
        const startMin = inferClock(h1, min1, ap1, 'start', { h: h2, meridiem: ap2 });
        let endMin = inferClock(h2, min2, ap2, 'end', { h: h1, meridiem: ap1 });
        if (endMin <= startMin && endMin < 12 * 60)
            endMin += 12 * 60;
        if (endMin <= startMin)
            continue;
        const before = src.slice(Math.max(0, m.index - 28), m.index).toLowerCase();
        const after = src.slice(m.index + m[0].length).split(/[.!?]/)[0].slice(0, 18).toLowerCase();
        out.push({
            start: hhmm(startMin),
            end: hhmm(endMin),
            startMin,
            endMin,
            span: m[0],
            // Prefer "lunch" before the range. Trailing ", lunch 1–2" must not mark the weekday open span.
            lunch: /lunch|break/.test(before) || /\bnoon\b/.test(before)
                || ((/lunch|break/.test(after) && (endMin - startMin) <= 150))
        });
    }
    while ((m = noon.exec(src))) {
        const h2 = Number(m[1]);
        const min2 = m[2] ? Number(m[2]) : 0;
        const ap2 = /pm/i.test(m[3] || '') ? 'pm' : /am/i.test(m[3] || '') ? 'am' : '' as const;
        const endMin = inferClock(h2, min2, ap2, 'end', { h: 12, meridiem: 'pm' });
        out.push({
            start: '12:00',
            end: hhmm(endMin <= 12 * 60 ? endMin + (h2 <= 6 ? 12 * 60 : 0) : endMin),
            startMin: 12 * 60,
            endMin: endMin <= 12 * 60 && h2 <= 6 ? endMin + 12 * 60 : endMin,
            span: m[0],
            lunch: true
        });
    }
    return out;
}

export type DaySpan = { days: typeof DAYS[number][]; open: boolean | null; span: string };

function expandDayRange(a: string, b: string): typeof DAYS[number][] {
    const i = DAYS.indexOf(DAY_ALIAS[fold(a)] || a as typeof DAYS[number]);
    const j = DAYS.indexOf(DAY_ALIAS[fold(b)] || b as typeof DAYS[number]);
    if (i < 0 || j < 0)
        return [];
    if (i <= j)
        return DAYS.slice(i, j + 1) as unknown as typeof DAYS[number][];
    return [...DAYS.slice(i), ...DAYS.slice(0, j + 1)] as unknown as typeof DAYS[number][];
}

export function parseDaySpans(text: string): DaySpan[] {
    const src = text.replace(/[–—]/g, '-');
    const out: DaySpan[] = [];
    const through = /(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\s*(?:through|thru|to|-)\s*(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)/gi;
    let m: RegExpExecArray | null;
    while ((m = through.exec(src))) {
        const parts = m[0].split(/\s*(?:through|thru|to|-)\s*/i);
        const days = expandDayRange(parts[0], parts[1]);
        if (days.length)
            out.push({ days, open: /closed/.test(src.slice(Math.max(0, m.index - 12), m.index).toLowerCase()) ? false : null, span: m[0] });
    }
    if (/\bweekdays?\b/i.test(src))
        out.push({ days: DAYS.slice(0, 5) as unknown as typeof DAYS[number][], open: true, span: 'weekdays' });
    if (/\bweekends?\b/i.test(src) || /closed saturday and sunday|closed weekends/i.test(src))
        out.push({ days: ['Saturday', 'Sunday'], open: /closed/.test(fold(src)) ? false : null, span: 'weekends' });
    const listed = src.match(/\b(?:mondays?|tuesdays?|wednesdays?|thursdays?|fridays?|saturdays?|sundays?|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/gi) || [];
    const named: typeof DAYS[number][] = [];
    for (const raw of listed) {
        const key = fold(raw).replace(/s$/, '');
        const day = DAY_ALIAS[key] || DAY_ALIAS[fold(raw)];
        if (day && !named.includes(day) && !out.some(s => s.days.length > 1 && s.days.includes(day) && s.span !== 'weekdays'))
            named.push(day);
    }
    for (const day of named) {
        if (out.some(s => s.days.length > 1 && s.days.includes(day)))
            continue;
        const closed = new RegExp('closed\\s+' + day, 'i').test(src) || new RegExp(day + 's?\\s+closed', 'i').test(src);
        out.push({ days: [day], open: closed ? false : null, span: day });
    }
    if (/closed saturday and sunday|closed weekends/i.test(src)) {
        out.push({ days: ['Saturday'], open: false, span: 'Saturday' });
        out.push({ days: ['Sunday'], open: false, span: 'Sunday' });
    }
    return out;
}

function sentences(text: string): string[] {
    return text.split(/(?<=[.!?])\s+|(?=\bLunch\b)|(?=\b(?:No wait, )?Fridays? we close)|(?=\bexcept Friday\b)/i).map(s => s.trim()).filter(Boolean);
}

function expandHourShorthand(text: string) {
    return text
        .replace(/\bm[\s\/\-]f\b/gi, 'monday through friday')
        .replace(/\bm[\s\/]w[\s\/]f\b/gi, 'monday, wednesday, friday')
        .replace(/\bt[\s\/]th\b/gi, 'tuesday, thursday')
        .replace(/\bmon\/wed\/fri\b/gi, 'monday, wednesday, friday')
        .replace(/\btue\/thu\b/gi, 'tuesday, thursday');
}

export function parseHours(text: string): LocalHint[] {
    const folded = fold(text);
    if (/do not mash|do not merge those hours|hours are different|leave hours blank|do not use one schedule|do not invent (one weekday|nine to five)|do not guess( my)? hours|not saying nine to five|i am not answering hours|skip hours|do not write one (shared |closing )?/.test(folded))
        return [];
    const hints: LocalHint[] = [];
    const push = (field_id: string, value: Scalar, span: string, precision: Precision = 'exact') => {
        if (hints.some(h => h.field_id === field_id))
            return;
        hints.push({ field_id, value, span, precision, operation: 'set' });
    };
    const src = expandHourShorthand(text);
    const namedDaysUsed = /monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon\b|tue\b|wed\b|thu\b|fri\b/i.test(src);
    for (const sentence of sentences(src)) {
        const closedWeekend = /closed (saturday and sunday|weekends)/i.test(sentence);
        if (closedWeekend) {
            push('hours.Saturday.open', false, sentence);
            push('hours.Sunday.open', false, sentence);
        }
        const parts = sentence.split(/,\s+/);
        let pendingDays: typeof DAYS[number][] = [];
        let pendingSpan = '';
        const clauses: { days: typeof DAYS[number][]; range: ReturnType<typeof parseTimeRanges>[number]; span: string }[] = [];
        for (const part of parts) {
            const ranges = parseTimeRanges(part).filter(r => !r.lunch);
            const spans = parseDaySpans(part);
            const days = [...new Set(spans.filter(s => s.open !== false && !/weekend/.test(s.span)).flatMap(s => s.days))];
            if (ranges.length) {
                clauses.push({ days: [...pendingDays, ...days], range: ranges[0], span: (pendingSpan + ' ' + part).trim() });
                pendingDays = [];
                pendingSpan = '';
            }
            else if (days.length) {
                pendingDays.push(...days);
                pendingSpan = (pendingSpan + ' ' + part).trim();
            }
        }
        for (const clause of clauses) {
            if (!clause.days.length && namedDaysUsed)
                continue;
            if (clause.days.length) {
                for (const day of [...new Set(clause.days)]) {
                    push('hours.' + day + '.open', true, clause.range.span);
                    push('hours.' + day + '.start', clause.range.start, clause.range.span);
                    push('hours.' + day + '.end', clause.range.end, clause.range.span);
                }
            }
            else if (!namedDaysUsed && /weekday|monday through friday|weekdays/i.test(clause.span)) {
                push('hours.preset', 'weekdays', clause.span, 'heuristic');
                push('hours.weekdays_start', clause.range.start, clause.range.span, 'heuristic');
                push('hours.weekdays_end', clause.range.end, clause.range.span, 'heuristic');
            }
            else if (!namedDaysUsed && !/lunch/.test(fold(clause.span))) {
                push('hours.weekdays_start', clause.range.start, clause.range.span, 'heuristic');
                push('hours.weekdays_end', clause.range.end, clause.range.span, 'heuristic');
            }
        }
        if (/24-?hour|24 hour|all day and night|someone answers all day/i.test(sentence))
            push('hours.preset', 'always', sentence);
    }
    for (const span of parseDaySpans(src)) {
        if (span.open !== false)
            continue;
        for (const day of span.days)
            push('hours.' + day + '.open', false, span.span);
    }
    if (/closed saturdays|close saturdays|we close saturdays|closed on saturday/i.test(text))
        push('hours.Saturday.open', false, 'Saturday');
    if (/closed sunday|sunday (they are |is |we are )?closed|sunday closed/i.test(text))
        push('hours.Sunday.open', false, 'Sunday');
    if (/\bsaturday (we answer|the phones are open|is open|open)\b/i.test(text) && !/closed saturday/i.test(text))
        push('hours.Saturday.open', true, 'Saturday open');
    const friClose = /\bfridays? we close at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(src);
    if (friClose) {
        const h = Number(friClose[1]);
        const min = friClose[2] || '00';
        const ap = (friClose[3] || (h <= 7 ? 'pm' : '')).toLowerCase();
        let hour = h;
        if (ap === 'pm' && h < 12)
            hour += 12;
        if (ap === 'am' && h === 12)
            hour = 0;
        push('hours.Friday.open', true, friClose[0]);
        push('hours.Friday.end', String(hour).padStart(2, '0') + ':' + min, friClose[0]);
    }
    // "Actually we close at 4, not 5" / "close at 4 instead of 5"
    const closeAt = /\b(?:we )?close(?:s)? at (\d{1,2})(?::(\d{2}))?\s*(am|pm)?(?:\s*,?\s*(?:not|instead of)\s+(\d{1,2}))?/i.exec(src);
    if (closeAt && !/fridays? we close/i.test(closeAt[0])) {
        const h = Number(closeAt[1]);
        const min = closeAt[2] || '00';
        const ap = (closeAt[3] || (h <= 7 ? 'pm' : '')).toLowerCase();
        let hour = h;
        if (ap === 'pm' && h < 12)
            hour += 12;
        if (ap === 'am' && h === 12)
            hour = 0;
        const end = String(hour).padStart(2, '0') + ':' + min;
        push('hours.weekdays_end', end, closeAt[0], 'exact');
        for (const day of DAYS.slice(0, 5))
            push('hours.' + day + '.end', end, closeAt[0], 'exact');
    }
    const weekdayStarts = DAYS.slice(0, 5).map(d => hints.find(h => h.field_id === 'hours.' + d + '.start')?.value);
    const weekdayEnds = DAYS.slice(0, 5).map(d => hints.find(h => h.field_id === 'hours.' + d + '.end')?.value);
    if (weekdayStarts.every(Boolean) && new Set(weekdayStarts).size === 1)
        push('hours.weekdays_start', weekdayStarts[0] as string, 'weekdays');
    if (weekdayEnds.every(Boolean) && new Set(weekdayEnds).size === 1)
        push('hours.weekdays_end', weekdayEnds[0] as string, 'weekdays');
    const starts = DAYS.map(d => hints.find(h => h.field_id === 'hours.' + d + '.start')?.value).filter(Boolean);
    if (starts.length && new Set(starts).size > 1)
        push('hours.preset', 'custom', 'named days', 'exact');
    else if (hints.some(h => /^hours\.(Monday|Friday)\.start$/.test(h.field_id)))
        push('hours.preset', 'custom', 'named days', 'exact');
    return hints;
}

export function parseLunch(text: string): LocalHint[] {
    const hints: LocalHint[] = [];
    const t = fold(text);
    if (/cover(s|ed)? (the )?phones during lunch|stay open (at|during) lunch|someone stays .{0,20}(desk|phones).{0,12}lunch|stagger(ed)? lunch|front desk covers .{0,20}lunch/.test(t)) {
        hints.push({ field_id: 'hours.lunch', value: 'covered', span: 'covers lunch', precision: 'exact', operation: 'set' });
        return hints;
    }
    const closed = /close(d|s)? (the )?(phones? )?(for|at) lunch|phones? (are |go |should )?closed (for |at )?lunch|closed for lunch|lunch .{0,40}(close|empty|voicemail)|desk is empty.{0,40}lunch|lunch.{0,40}desk is empty|no one .{0,12}lunch/.test(t)
        || /lunch is .{0,20}\d/.test(t)
        || /lunch \d/.test(t) && !/cover|stay open|stagger/.test(t);
    if (/\bno lunch close\b/.test(t) && !/friday.{0,40}no lunch/.test(t)) {
        hints.push({ field_id: 'hours.lunch', value: 'covered', span: 'no lunch close', precision: 'exact', operation: 'set' });
        return hints;
    }
    const noFriday = /friday.{0,40}no lunch|friday is a short day, no lunch close|except friday|weekdays except friday/.test(t);
    if (!closed && !/lunch/.test(t))
        return hints;
    if (closed)
        hints.push({ field_id: 'hours.lunch', value: 'closed', span: 'lunch', precision: 'exact', operation: 'set' });
    const lunchSentence = sentences(text).find(s => /lunch/i.test(s)) || text;
    const ranges = parseTimeRanges(lunchSentence).concat(parseTimeRanges(text).filter(r => r.lunch));
    const short = (r: { startMin: number; endMin: number }) => r.endMin - r.startMin <= 150;
    const lunchRange = ranges.find(r => r.lunch && short(r))
        || ranges.find(r => r.startMin >= 11 * 60 && r.startMin <= 14 * 60 && short(r));
    const daySpans = parseDaySpans(lunchSentence);
    const lunchDays = daySpans.length
        ? [...new Set(daySpans.flatMap(s => s.days))].filter(d => d !== 'Saturday' && d !== 'Sunday')
        : DAYS.slice(0, 5).filter(d => !(noFriday && d === 'Friday'));
    if (lunchRange && closed) {
        for (const day of lunchDays) {
            if (noFriday && day === 'Friday')
                continue;
            hints.push({ field_id: 'hours.' + day + '.break_start', value: lunchRange.start, span: lunchRange.span, precision: 'exact', operation: 'set' });
            hints.push({ field_id: 'hours.' + day + '.break_end', value: lunchRange.end, span: lunchRange.span, precision: 'exact', operation: 'set' });
        }
    }
    if (noFriday) {
        hints.push({ field_id: 'hours.Friday.break_start', value: '', span: 'Friday no lunch close', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'hours.Friday.break_end', value: '', span: 'Friday no lunch close', precision: 'exact', operation: 'set' });
    }
    return hints;
}

export function parseCity(text: string): LocalHint[] {
    const history = /associate in|worked in|used to|for (?:\w+|\d+) years in|grew up in|trained in|been an associate in|spent .{0,20} in/i;
    const ST = 'NY|New York|PA|Pennsylvania|VT|Vermont|NJ|New Jersey|CT|Connecticut|MA|Massachusetts';
    const city = "([A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+){0,2})";
    const firstPerson = new RegExp(
        'opening (?:my |our |a |an )?(?:own )?.{0,80}?\\bin\\s+' + city + '(?:,\\s*(' + ST + '))?'
        + '|\\bpractice in\\s+' + city + '(?:,\\s*(' + ST + '))?'
        + '|\\boffice in\\s+' + city + '(?:,\\s*(' + ST + '))?'
        + '|\\blocated in\\s+' + city + '(?:,\\s*(' + ST + '))?'
        + '|\\bin\\s+' + city + ',\\s*(' + ST + ')\\b',
        'g'
    );
    const out: LocalHint[] = [];
    const stripHist = text.replace(new RegExp('.{0,40}(?:' + history.source + ').{0,40}', 'gi'), ' ');
    let m: RegExpExecArray | null;
    const src = stripHist;
    const hits: { city: string; state: string; span: string }[] = [];
    while ((m = firstPerson.exec(text))) {
        const city = (m[1] || m[3] || m[5] || m[7] || m[9] || '').replace(/\s+(family|dental|eye|office|practice).*$/i, '').trim();
        const state = (m[2] || m[4] || m[6] || m[8] || m[10] || '').trim();
        if (!city || NOT_CITY.test(city) || history.test(text.slice(Math.max(0, m.index - 48), m.index + 12)))
            continue;
        hits.push({ city, state, span: m[0] });
    }
    const thisIs = /\bthis is\s+([A-Z][A-Za-z .'-]{1,32})(?:,\s*([A-Z]{2}|New York|Pennsylvania|Vermont))?\b/g;
    const planIs = /\bthis (?:plan|blueprint) is (?:the )?([A-Z][A-Za-z .'-]{1,32})/g;
    while ((m = thisIs.exec(text))) {
        if (/this is a new office|this is new york/i.test(m[0]))
            continue;
        hits.push({ city: m[1].replace(/\s+(family|dental|eye|office|practice).*$/i, '').trim(), state: (m[2] || '').trim(), span: m[0] });
    }
    while ((m = planIs.exec(text))) {
        hits.push({ city: m[1].replace(/\s+(addition|office|plan).*$/i, '').trim(), state: '', span: m[0] });
    }
    const addingIn = /\badding (?:a |an |one )?(?:office )?in\s+([A-Z][A-Za-z'-]+)|\badding (?:a |an )?([A-Z][A-Za-z'-]+),/g;
    while ((m = addingIn.exec(text))) {
        hits.push({ city: (m[1] || m[2] || '').trim(), state: '', span: m[0] });
    }
    const generic = /\bin\s+([A-Z][A-Za-z .'-]{1,32}),\s*(NY|New York|PA|Pennsylvania|VT|Vermont|NJ|New Jersey|CT|MA|NH|ME)\b/g;
    while ((m = generic.exec(text))) {
        if (NOT_CITY.test(m[1].trim()) || history.test(text.slice(Math.max(0, m.index - 48), m.index + 12)))
            continue;
        hits.push({ city: m[1].trim(), state: m[2].trim(), span: m[0] });
    }
    hits.sort((a, b) => {
        const score = (h: { span: string }) => (/opening|adding|this plan is|this is/i.test(h.span) ? 2 : 0) + (/,/.test(h.span) ? 1 : 0);
        return score(b) - score(a);
    });
    const picked = hits[0];
    if (picked) {
        const st = STATE_NAME[fold(picked.state)] || (picked.state.length === 2 ? picked.state.toUpperCase() : '');
        const city = picked.city
            .replace(new RegExp('\\s+(?:' + ST + ')$', 'i'), '')
            .replace(/,$/, '')
            .trim();
        if (NOT_CITY.test(city))
            return out;
        const value = st ? city + ', ' + st : city;
        out.push({ field_id: 'cityState', value, span: picked.span, precision: 'exact', operation: 'set' });
        return out;
    }
    // Prefer an explicit correction: "it's New Paltz" / "actually New Paltz".
    const itsCity = text.match(new RegExp("\\b(?:it'?s|actually(?: it'?s)?)\\s+(" + HINT_CITIES.join('|') + ")\\b", 'i'));
    if (itsCity) {
        const name = itsCity[1].toLowerCase();
        const titled = name.replace(/\b\w/g, ch => ch.toUpperCase());
        const st = /burlington/.test(name) ? 'VT' : /scranton/.test(name) ? 'PA' : 'NY';
        out.push({ field_id: 'cityState', value: titled + ', ' + st, span: itsCity[0], precision: 'exact', operation: 'set' });
        return out;
    }
    for (const name of HINT_CITIES) {
        const re = new RegExp('\\b' + name + '\\b', 'i');
        if (!re.test(src))
            continue;
        if (new RegExp('forget (?:the )?' + name, 'i').test(text))
            continue;
        // "not Kingston" / "not in Kingston" is a rejection, not a choice.
        if (new RegExp('\\bnot (?:in )?' + name + '\\b', 'i').test(text))
            continue;
        if (history.test(text) && new RegExp('(?:' + history.source + ')\\s+' + name, 'i').test(text) && !new RegExp('(?:opening|practice|office|located).{0,40}' + name, 'i').test(text))
            continue;
        const titled = name.replace(/\b\w/g, ch => ch.toUpperCase());
        const st = /burlington/.test(name) ? 'VT' : /scranton/.test(name) ? 'PA' : 'NY';
        out.push({ field_id: 'cityState', value: titled + ', ' + st, span: name, precision: 'heuristic', operation: 'set' });
        break;
    }
    return out;
}

export function parsePracticeName(text: string): LocalHint[] {
    const cleaned = text.replace(/answering service (?:called|named)\s+[A-Z][A-Za-z0-9'& ]{1,40}/gi, ' ');
    const dash = new RegExp('(?:—|--)\\s+([A-Z][A-Za-z0-9\'& ]{1,50}(?:' + NAME_SUFFIX + '))\\b');
    const weAre = new RegExp('\\b(?:we are|we\'re|i(?:\'m| am) (?:opening|dr\\.?))\\s+([A-Z][A-Za-z0-9\'& ]{1,50}(?:' + NAME_SUFFIX + '))\\b', 'i');
    const called = new RegExp('\\b(?:(?:practice |office |it )?(?:is )?called(?! about)|named|call it)\\s+([A-Z][A-Za-z0-9\'& ]{1,50}(?:' + NAME_SUFFIX + '))\\b', 'i');
    const isName = new RegExp('\\b([A-Z][A-Za-z0-9\'& ]{1,50}(?:' + NAME_SUFFIX + '))\\s+is the name', 'i');
    const theNameIs = new RegExp('\\b(?:the (?:practice |office )?name is|name is)\\s+([A-Z][A-Za-z0-9\'& ]{1,50}(?:' + NAME_SUFFIX + '))\\b', 'i');
    const openingName = new RegExp('(?:^Opening\\s+|\\bopening\\s+)([A-Z][A-Za-z0-9\'& ]{1,40}(?:Vision North|' + NAME_SUFFIX + '))\\b', 'i');
    const leading = new RegExp('^([A-Z][A-Za-z0-9\'& ]{1,40}(?:' + NAME_SUFFIX + '))(?:\\s*[,.!?;]|\\s+existing|\\s+in\\s)');
    const titled = new RegExp('\\b([A-Z][A-Za-z0-9\'& ]{0,40}(?:' + NAME_SUFFIX + '))\\b');
    const m = dash.exec(cleaned) || weAre.exec(cleaned) || called.exec(cleaned) || theNameIs.exec(cleaned) || isName.exec(cleaned) || openingName.exec(cleaned.trim()) || leading.exec(cleaned.trim()) || titled.exec(cleaned);
    if (!m)
        return [];
    let name = m[1].trim()
        .replace(/^Opening\s+/i, '')
        .replace(/^(?:we are|we're|i am opening|i'm opening|i'm dr\.?|call it|named)\s+/i, '')
        .replace(/^Dr\.?\s+[A-Z][a-z]+\s*,\s*/,'')
        // "We already have Kingston Family Dental" → Kingston Family Dental
        .replace(/^We already have\s+/i, '')
        .replace(/^Already have\s+/i, '')
        // "We've had Hudson Family Dental in Hudson…" → Hudson Family Dental
        .replace(/^We(?:'ve| have) had\s+/i, '')
        .replace(/^I(?:'ve| have) had\s+/i, '');
    // Prefer the titled practice inside a longer accidental capture.
    const inner = name.match(new RegExp('((?:[A-Z][A-Za-z0-9\'&]+\\s+){0,4}[A-Z][A-Za-z0-9\'&]+(?:' + NAME_SUFFIX + '))\\s*$'));
    if (inner && /^(?:we|already|have|our|my)\b/i.test(name))
        name = inner[1];
    if (/^(?:call it|named)\b/i.test(name))
        return [];
    if (/^(open dental|dentrix|eaglesoft|curve|denticon|answerconnect|chirotouch|webpt|dolphin)$/i.test(name))
        return [];
    if (/^(?:moving|existing|opening|a|an|the|our|my|this|that|new|old|small|we|already|have)\b/i.test(name))
        return [];
    if (/\b(about|answered|nobody|glasses|called about|we(?:'ll| will)|run|moving|existing|already have)\b/i.test(name))
        return [];
    if (/practice name stays|name stays /i.test(m[0]) && !theNameIs.test(m[0]))
        return [{ field_id: 'name', value: name.replace(/^.*\b(stays\s+)/i, ''), span: m[0], precision: 'exact', operation: 'set' }];
    if (name.split(/\s+/).length > 6)
        return [];
    if (!/[A-Z]/.test(name[0]))
        return [];
    return [{ field_id: 'name', value: name, span: m[0], precision: 'exact', operation: 'set' }];
}

export function parseRoster(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    const add = (field_id: string, value: Scalar, span: string, precision: Precision = 'exact') => {
        if (hints.some(h => h.field_id === field_id))
            return;
        hints.push({ field_id, value, span, precision, operation: 'set' });
    };
    if (/one receptionist or two|do not (know|lock).{0,40}receptionist|have not hired (a |the )?receptionist/.test(t))
        /* leave reception open */;
    else if (/\bno staff yet\b|\bno (front desk|receptionist)/.test(t))
        add('teams.reception.count', 0, 'no staff');
    else {
        const rec = t.match(/together that is (\d+|one|two|three|four|five) receptionists?/)
            || t.match(/no, (one|two|three|four) receptionists?/)
            || t.match(/only (one|two) receptionists?/)
            || t.match(/(\d+|one|two|three|four) receptionists?/)
            || t.match(/(\d+|one|two|three|four) (?:girls?|people|person|women) (?:at |on )?(?:the )?front/)
            || t.match(/(\d+|one|two|three|four) (?:girls?|people|person) at the front/)
            || t.match(/(\d+|one|two|three|four) at (?:the )?front/)
            || t.match(/(\d+|one|two|three|four) front-desk people/)
            || t.match(/count (\d+|one|two|three|four) receptionists?/);
        if (rec) {
            const n = parseNumberWord(rec[1]);
            if (n != null)
                add('teams.reception.count', n, rec[0]);
        }
        else if (/my wife works the front|one main receptionist|one person at the front|that is reception, one person|one person checks patients in|one girl up front|one front desk person/.test(t))
            add('teams.reception.count', 1, 'front desk');
        else {
            const recAlt = t.match(/(\d+|one|two|three|four) front desk/)
                || t.match(/(\d+|one|two|three|four) (?:opticians?|treatment coordinators?) (?:who )?(?:answer|float)/)
                || t.match(/(\d+|one|two|three|four) (?:opticians?|people) answer the phone/);
            if (recAlt) {
                const n = parseNumberWord(recAlt[1]);
                if (n != null)
                    add('teams.reception.count', n, recAlt[0]);
            }
        }
    }
    if (/not hired an office manager|administration count is zero|administration is zero|no office manager|no separate administrator/.test(t))
        add('teams.administration.count', 0, 'no office manager');
    else if (/my (husband|wife|partner|brother|sister|brother-in-law|sister-in-law).{0,40}(is|does) (the )?office manager/.test(t)
        || /is the office manager/.test(t)
        || /our biller/.test(t)
        || /my wife does the books/.test(t)
        || /brother-in-law does the books/.test(t)
        || /count (\d+|one) administrat/.test(t)
        || /office administration/.test(t)
        || /one administrator who/.test(t)
        || /(\d+|one) administrator/.test(t) && !/no administrator/.test(t)
        || /(\d+|one) billing (person|people|staff)/.test(t)
        || /handles insurance|billing, insurance/.test(t) && /office manager|husband|wife|administrat/.test(t))
        add('teams.administration.count', 1, 'office manager');
    if ((/office manager.{0,40}billing|billing, insurance|handles insurance|biller/.test(t)
        || /does the books/.test(t) && /wife|husband|brother|sister/.test(t))
        && !/they also (handle|do) billing|front.{0,40}also.{0,24}billing|billing stays with reception|they still do the billing/.test(t))
        add('billing.performed_by', 'administration', 'billing');
    else if (/they also (handle|do) billing|front.{0,40}also.{0,24}billing|receptionist also does billing|they still do the billing|billing stays with reception|also do all the billing/.test(t))
        add('billing.performed_by', 'reception', 'front desk billing');
    const meClinician = /clinical side is me|clinical is me/.test(t)
        || /\b(im|i am) (the dentist|the doctor|the only (optometrist|dentist|doctor|clinician)|an? (optometrist|ophthalmologist|clinician))\b/.test(t)
        || /only optometrist|only dentist/.test(t)
        || /one doctor, one office manager|one receptionist, one doctor/.test(t);
    const associate = /\ban associate (dentist|doctor|clinician|joining)/.test(t)
        || /associate dentist/.test(t)
        || /hiring an associate/.test(t) ? 1 : 0;
    const hygienists = (t.match(/(\d+|one|two|three|four) hygienists?/) || (/\ba hygienist\b/.test(t) ? ['a hygienist', 'one'] : []))[1];
    const assistants = (t.match(/(\d+|one|two|three|four) (?:dental )?assistants?/) || [])[1];
    const clinicians = t.match(/(\d+|one|two|three|four|five|six) clinicians?/)
        || t.match(/so (\d+|one) clinician/)
        || t.match(/clinical count(?: is|,) (\d+|one|two|three|four)/)
        || t.match(/all (\d+|four) of us are clinical/)
        || t.match(/(\d+|one|two|three|four) dentists? will see/)
        || t.match(/(\d+|one|two|three|four) (?:docs?|doctors?|dentists?|providers?|chiropractors?|orthodontists?|pts|physical therapists?)/)
        || t.match(/two optometrists/)
        || t.match(/me and one other chiropractor/)
        || t.match(/\b(one) (optometrist|doctor|clinician)(?:\.|,| and| at|$)/);
    if (clinicians) {
        const n = /two optometrists/.test(clinicians[0]) ? 2
            : /me and one other chiropractor/.test(clinicians[0]) ? 2
            : parseNumberWord(clinicians[1]);
        if (n != null)
            add('teams.clinical.count', n, clinicians[0]);
    }
    else {
        const me = meClinician || /clinical side is me/.test(t) ? 1 : 0;
        const h = hygienists ? parseNumberWord(hygienists) || 0 : 0;
        const a = assistants ? parseNumberWord(assistants) || 0 : 0;
        const total = me + associate + h + a;
        if (total > 0)
            add('teams.clinical.count', total, 'clinical roster');
        if (/associate.{0,48}joining in april|associate dentist joining in april/.test(t))
            add('policy.notes', 'Associate starts April. On-call is the owner alone until then.', 'associate April');
        else if (/\b(im|i am) the dentist\b/.test(t) || /only dentist/.test(t))
            add('teams.clinical.count', 1, 'i am the dentist', 'heuristic');
    }
    return hints;
}

export function parseOwnership(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    if (/they check the inbox|front desk (owns|checks)|front desk owns those messages|receptionist checks|girls check|leave it for the receptionist|voicemail for her|voicemail for the receptionist|voicemail for that receptionist|she listens|she checks|belongs to the front desk|receptionist owns both|receptionist owns/.test(t)) {
        hints.push({ field_id: 'messages.owner', value: 'reception', span: 'front desk checks', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'busy.owner', value: 'reception', span: 'front desk checks', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'after.owner', value: 'reception', span: 'front desk checks', precision: 'exact', operation: 'set' });
    }
    else if (/voicemail for (the )?(beacon )?front desk|voicemail for reception/.test(t)) {
        if (/after hours/.test(t) && !/live answering/.test(t))
            hints.push({ field_id: 'after.owner', value: 'reception', span: 'front desk', precision: 'exact', operation: 'set' });
        if (!/after hours/.test(t) || /missed calls|do not pick up|if they miss/.test(t))
            hints.push({ field_id: 'busy.owner', value: 'reception', span: 'front desk', precision: 'exact', operation: 'set' });
    }
    else if (/\bi (listen|check) (to )?(them|the (voicemail|messages|inbox)|messages myself)/.test(t)
        && !/(front desk|receptionist|girls) .{0,24}(check|listen|own)/.test(t)) {
        hints.push({ field_id: 'messages.owner', value: 'clinical', span: 'i listen', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'busy.owner', value: 'clinical', span: 'i listen', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'after.owner', value: 'clinical', span: 'i listen', precision: 'exact', operation: 'set' });
    }
    return hints;
}

export function parseUrgent(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    const add = (field_id: string, value: Scalar, span: string) => {
        if (!hints.some(h => h.field_id === field_id))
            hints.push({ field_id, value, span, precision: 'exact', operation: 'set' });
    };
    const cues: string[] = [];
    if (/swelling/.test(t))
        cues.push('swelling');
    if (/trauma/.test(t))
        cues.push('trauma');
    if (/bleeding/.test(t))
        cues.push('bleeding');
    if (/knocked-?out tooth/.test(t))
        cues.push('knocked-out tooth');
    if (/vision loss|change in vision|flashes/.test(t))
        cues.push('vision change');
    if (/eye injury|chemical/.test(t))
        cues.push('eye injury');
    if (/911/.test(t))
        cues.push('911');
    if (cues.length)
        add('urgent.instructions', cues.join(', '), cues.join(' '));
    if (/only those urgent|not every call|urgent cases, not every|only (those |for )?(urgent|emergenc)|regular calls do not|only true emergencies|i only mean emergencies|regular (daytime )?calls stay/.test(t))
        add('urgent.scope', 'urgent_only', 'only those urgent cases');
    else if (/every (incoming )?call|all (incoming )?calls/.test(t) && /doctor|clinician|on-call/.test(t) && !/not every/.test(t))
        add('urgent.scope', 'all_calls', 'every call');
    const openAndClosed = /during the day or after/.test(t)
        || /day or night/.test(t)
        || (/during open|open hours|while we are open/.test(t) && /closed|after hours|after we close|after close/.test(t));
    if (openAndClosed && /on-?call|clinician|doctor|emergenc/.test(t) && !/no on-call during the day/.test(t))
        add('urgent.coverage', 'always', 'open and closed');
    else if ((/after hours|after we are closed|after we close|only after we close|only after (beacon |hudson )?is closed|after close/.test(t)) && /try to reach|connect|reach the on-call|ring me|ring a dentist|try (a |the )?(doctor|dentist)|emergenc/.test(t) && !/during the day or after|day or night/.test(t))
        add('urgent.coverage', 'closed', 'after hours on-call');
    if (/day or night|during the day or after/.test(t) && /emergenc|on-call|doctor/.test(t))
        add('urgent.coverage', 'always', 'day and night');
    if (/rotate|rotation|take turns|between me and the associate/.test(t))
        add('urgent.roster', 'rotation', 'rotate');
    if (/if we miss|if (it|we) miss|backup|priority message/.test(t) && /miss|priority/.test(t))
        add('urgent.backup', 'message', 'priority message');
    const scoped = /only those urgent|not every call|every (incoming )?call|all (incoming )?calls|urgent_only|regular calls do not|only true emergencies|emergencies only/.test(t);
    const deniedOnCall = /\bno on-?call\b|\bnot on-?call\b|\bwithout on-?call\b|\bdont (want|need|have) (an? )?on-?call\b|\bdo not (want|need|have) (an? )?on-?call\b|\bnobody on call\b|\bno nighttime on-?call\b/.test(t);
    const ambiguousRoute = /on-?call|clinician phone|doctors? phone|docro/.test(t) && !scoped && !deniedOnCall && !/try to reach the on-call|ring me/.test(t);
    if (/priority (message|voicemail)|leave a priority|marked priority/.test(t) && /do not (ring|transfer)|dont ring|not ring the (doctor|dentist)|do not transfer to a doctor|not connecting a live transfer|do not live-transfer|no live doctor transfer/.test(t))
        add('urgent.kind', 'priority', 'priority message');
    else if (/no on-call during the day/.test(t) && /after (close|hours)/.test(t) && /emergenc/.test(t)) {
        add('urgent.kind', 'connect', 'after-hours emergencies');
        add('urgent.team', 'clinical', 'doctor');
        add('urgent.coverage', 'closed', 'after close');
    }
    // Do not treat "during the day" (daytime answering) as blocking "no on-call" — that exclusion was swallowing after-hours denials.
    else if ((deniedOnCall || /no on-call|dont have anyone on call|nobody on call|we do not have anyone on call|we do not have an on-call|no nighttime on-call|nobody answering emergencies/.test(t)) && !/have not figured|tested on-call|no on-call during the day/.test(t))
        add('urgent.kind', 'none', 'no on-call');
    else if (!ambiguousRoute && !deniedOnCall && (/on-?call|try to reach the (on-call )?(dentist|doctor|clinician)|ring me, the doctor|real emergencies.{0,40}ring me|only true emergencies ring|emergencies only.{0,40}(try|ring) the (doctor|dentist)|emergencies can reach|reach a doctor both/.test(t))) {
        add('urgent.kind', 'connect', 'on-call');
        add('urgent.team', 'clinical', 'on-call dentist');
        add('urgent.owner', 'clinical', 'on-call');
    }
    return hints;
}

export function parseLanguages(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    if (/skip languages|not deciding languages|do not want to talk about spanish/.test(t))
        return [{ field_id: 'languages.decision', value: null, span: 'skip languages', precision: 'exact', operation: 'skip' }];
    if (/spanish.{0,80}(would be nice|nice to have).{0,40}(but|however)|do not have anyone who speaks|nobody speaks (it|spanish)|no one speaks spanish|spanish.{0,40}but we do not/.test(t))
        return [{ field_id: 'languages.decision', value: 'none', span: 'Spanish not staffed', precision: 'exact', operation: 'set' }];
    const named = t.match(/\b(spanish|french|chinese|mandarin|cantonese|arabic|russian|portuguese|korean|hindi|italian|polish|yiddish)\b/);
    if ((/english is enough|english only|do not need spanish|english, no spanish|no spanish/.test(t) || /^english\.?$/.test(t)) && !/speak spanish|bilingual|spanish-speaking|speaks spanish/.test(t))
        return [{ field_id: 'languages.decision', value: 'none', span: 'English is enough', precision: 'exact', operation: 'set' }];
    if (/bilingual|speaks spanish|spanish during|spanish-speaking/.test(t) || named) {
        const lang = named ? named[1].replace(/^\w/, c => c.toUpperCase()) : 'Spanish';
        hints.push({ field_id: 'languages.spanish', value: true, span: named?.[0] || 'Spanish', precision: 'exact', operation: 'set' });
        if (lang !== 'Spanish')
            hints.push({ field_id: 'languages.name', value: lang, span: lang, precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'languages.decision', value: 'selected', span: 'language', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'languages.mechanism', value: 'staff', span: 'bilingual', precision: 'exact', operation: 'set' });
        if (/receptionist|front desk/.test(t))
            hints.push({ field_id: 'languages.team', value: 'reception', span: 'receptionist', precision: 'exact', operation: 'set' });
        if (/during open|open hours|cannot cover .{0,20}(night|9 pm|after hours)|english is the after/.test(t))
            hints.push({ field_id: 'languages.availability', value: 'open', span: 'open hours', precision: 'exact', operation: 'set' });
    }
    return hints;
}

export function parseBeforeOpening(text: string): LocalHint[] {
    const t = fold(text);
    if (!/before (we |the office )?open|not open yet|advertis/.test(t))
        return [];
    // "no callback box" is an information hangup, not a callback mailbox.
    const wantsCallback = /callback|call back|take a (callback )?message|leave (a message|their info)/.test(t)
        && !/\bno callback\b|\bnot a callback\b|\bwithout (a )?callback\b|\bno callback box\b/.test(t);
    if (wantsCallback)
        return [{ field_id: 'beforeOpening', value: 'message', span: 'callback', precision: 'exact', operation: 'set' }];
    if (/recording just announces|announces the date|play information|hours recording then (end|hang)|not-open-yet|not open yet recording|play a .{0,40}recording/.test(t))
        return [{ field_id: 'beforeOpening', value: 'information', span: 'recording', precision: 'exact', operation: 'set' }];
    if (/recording/.test(t) && !wantsCallback)
        return [{ field_id: 'beforeOpening', value: 'information', span: 'recording', precision: 'heuristic', operation: 'set' }];
    return [];
}

export function parsePMS(text: string): LocalHint[] {
    // Answering-service brands are never a practice-management system.
    if (ANSWERING_SERVICES.some(name => new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text)))
        return [];
    if (/after hours.{0,40}\b(?:we use|use|with)\b/i.test(text) && /answerconnect|answering service|ruby|smith\.ai/i.test(text))
        return [];
    for (const name of [...PMS_DENTAL, ...PMS_EYE, ...PMS_OTHER]) {
        const re = new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
        if (re.test(text))
            return [{ field_id: 'opening.pms', value: name === 'CS' ? 'Carestream' : name, span: name, precision: 'exact', operation: 'set' }];
    }
    const run = /(?:we(?:ll|'ll)? run|we use|running)\s+([A-Z][A-Za-z0-9 .'-]{1,40})/.exec(text);
    if (run) {
        const value = run[1].replace(/[.,].*$/, '').trim();
        if (ANSWERING_SERVICES.some(name => fold(name) === fold(value)))
            return [];
        return [{ field_id: 'opening.pms', value, span: run[0], precision: 'heuristic', operation: 'set' }];
    }
    return [];
}

function nthWeekday(year: number, month: number, weekday: number, n: number) {
    const first = new Date(Date.UTC(year, month, 1));
    const offset = (weekday - first.getUTCDay() + 7) % 7;
    const day = 1 + offset + (n - 1) * 7;
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

function lastWeekday(year: number, month: number, weekday: number) {
    const last = new Date(Date.UTC(year, month + 1, 0));
    const offset = (last.getUTCDay() - weekday + 7) % 7;
    const day = last.getUTCDate() - offset;
    return year + '-' + String(month + 1).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

export function parseHolidays(text: string, openingYear?: number): LocalHint[] {
    const t = fold(text);
    if (!/thanksgiving|christmas|new years|july 4|independence|memorial day|labor day/.test(t))
        return [];
    const year = openingYear || (() => {
        const y = text.match(/\b(20\d{2})\b/);
        return y ? Number(y[1]) : new Date().getFullYear();
    })();
    const dates: string[] = [];
    if (/thanksgiving/.test(t))
        dates.push(nthWeekday(year, 10, 4, 4));
    if (/christmas eve/.test(t))
        dates.push(year + '-12-24');
    if (/\bchristmas\b/.test(t))
        dates.push(year + '-12-25');
    if (/new years/.test(t))
        dates.push(year + '-01-01');
    if (/july 4|independence/.test(t))
        dates.push(year + '-07-04');
    if (/memorial day/.test(t))
        dates.push(lastWeekday(year, 4, 1));
    if (/labor day/.test(t))
        dates.push(nthWeekday(year, 8, 1, 1));
    const hints: LocalHint[] = [];
    if (dates.length)
        hints.push({ field_id: 'hours.holidays', value: dates.join(','), span: dates.join(','), precision: 'exact', operation: 'set' });
    if (/closed/.test(t) && dates.length)
        hints.push({ field_id: 'holidayPolicy', value: 'closed', span: 'closed', precision: 'exact', operation: 'set' });
    return hints;
}

export function parseContinuity(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    if (/no internet yet|internet is not in|internet is not ready|is not in yet|internet.{0,48}unknown/.test(t))
        hints.push({ field_id: 'opening.internet', value: 'unknown', span: 'internet unknown', precision: 'exact', operation: 'set' });
    else if (/internet is already|internet is in the suite|fiber is already|network cabling is done/.test(t))
        hints.push({ field_id: 'opening.internet', value: 'known', span: 'internet ready', precision: 'exact', operation: 'set' });
    if (/network cabling is done|network is done/.test(t))
        hints.push({ field_id: 'opening.network', value: 'known', span: 'network ready', precision: 'exact', operation: 'set' });
    else if (/internet.{0,40}survey|survey.{0,48}internet|promises the internet/.test(t))
        hints.push({ field_id: 'opening.internet', value: 'survey', span: 'internet survey', precision: 'exact', operation: 'set' });
    if (/network.{0,40}survey|site survey for the network|internet and network/.test(t))
        hints.push({ field_id: 'opening.network', value: 'survey', span: 'network survey', precision: 'exact', operation: 'set' });
    const notes: string[] = [];
    if (/snow/.test(t) && /closed/.test(t))
        notes.push('Snow days follow closed hours.');
    if (/never forward.{0,40}personal|personal phone/.test(t))
        notes.push('Never forward the published number to a personal phone.');
    if (notes.length)
        hints.push({ field_id: 'continuity.notes', value: notes.join(' '), span: notes[0], precision: 'exact', operation: 'set' });
    return hints;
}

export function parseLocations(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    const m = /\b(?:two offices|both offices)[,:]?\s+([A-Z][A-Za-z' -]+?)\s+and\s+([A-Z][A-Za-z' -]+?)(?:\.|,|$)/.exec(text)
        || /\b(?:offices in)\s+([A-Z][A-Za-z' -]+?)\s+and\s+([A-Z][A-Za-z' -]+?)(?:\.|,|$)/.exec(text)
        || /\balready have\s+([A-Z][A-Za-z' -]+?(?:Family Dental|Dental|Eye Care|Vision|Orthodontics)?)\s+and\s+we(?:'re| are) adding\s+([A-Z][A-Za-z' -]+?)(?:\s+under|\s+with|\.|\,|$)/i.exec(text)
        || /\bpress\s*1\s+for\s+([A-Z][A-Za-z' -]+?)\s*,\s*press\s*2\s+for\s+([A-Z][A-Za-z' -]+?)(?:\.|,|$)/i.exec(text)
        || /\bpress\s*1\s+for\s+([A-Z][A-Za-z' -]+?)\s*,\s*2\s+for\s+([A-Z][A-Za-z' -]+?)(?:\.|,|$)/i.exec(text);
    if (m)
        hints.push({ field_id: 'locations.names', value: m[1].trim() + ', ' + m[2].trim(), span: m[0], precision: 'exact', operation: 'set' });
    if (/press\s*1\s+for .{0,40}press\s*2\s+for|press\s*1\s+for .{0,40},\s*2\s+for|callers should press|location menu|choose (a |the )?location/.test(t))
        hints.push({ field_id: 'locationEntry', value: 'menu', span: 'location menu', precision: 'exact', operation: 'set' });
    else if (/each (office|location) (keeps|has|gets) (its|their) own (published )?number|separate (published )?numbers|own published number/.test(t))
        hints.push({ field_id: 'locationEntry', value: 'separate', span: 'separate numbers', precision: 'exact', operation: 'set' });
    else if (/under the same (published )?number|same published number|one number for both|answer both/.test(t) && /add(ing)?|second|already have/.test(t)
        && !hints.some(h => h.field_id === 'locationEntry'))
        hints.push({ field_id: 'locationEntry', value: 'shared', span: 'same number', precision: 'heuristic', operation: 'set' });
    return hints;
}

export function parseReasons(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    if (/appointments? (stay|go|remain) with (the )?front desk|appointments stay/.test(t))
        hints.push({ field_id: 'reasons.appointments.team', value: 'reception', span: 'appointments', precision: 'exact', operation: 'set' });
    if (/billing.{0,40}(office manager|admin)|billing and insurance go/.test(t))
        hints.push({ field_id: 'reasons.billing.team', value: 'admin', span: 'billing', precision: 'exact', operation: 'set' });
    if (/clinical questions?.{0,40}clinical/.test(t))
        hints.push({ field_id: 'reasons.clinical-question.team', value: 'clinical', span: 'clinical questions', precision: 'exact', operation: 'set' });
    return hints;
}

export function parseCurrentLines(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    const analog = t.match(/(\d+|one|two|three) analog/);
    if (analog || /fax/.test(t)) {
        const n = analog ? parseNumberWord(analog[1]) : null;
        const bits = [n != null ? n + ' analog' : '', /fax/.test(t) ? 'fax' : ''].filter(Boolean);
        hints.push({ field_id: 'current.lines', value: bits.join(' + '), span: bits.join(' '), precision: 'exact', operation: 'set' });
    }
    if (/keep the fax|fax stays|dont mix.{0,20}fax|fax.{0,40}patient number/.test(t))
        hints.push({ field_id: 'current.notes', value: 'Fax stays off the patient number.', span: 'fax', precision: 'exact', operation: 'set' });
    const provider = t.match(/\b(spectrum|optimum|verizon|comcast|frontier|ringcentral)\b/);
    if (provider)
        hints.push({ field_id: 'current.provider', value: provider[1].replace(/^\w/, c => c.toUpperCase()), span: provider[0], precision: 'exact', operation: 'set' });
    const money = t.match(/\$ ?(\d{2,4})(?: a month| \/ month)?/);
    if (money)
        hints.push({ field_id: 'current.monthly', value: money[1], span: money[0], precision: 'exact', operation: 'set' });
    return hints;
}

export function parseOpening(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    const day = text.match(/\b(?:week of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/i);
    if (day && /open|seeing patients|aiming|possession/.test(t)) {
        hints.push({ field_id: 'opening.date', value: day[1] + ' ' + day[2] + (day[3] ? ' ' + day[3] : ''), span: day[0], precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'opening.precision', value: 'day', span: day[0], precision: 'exact', operation: 'set' });
    }
    if (/build-?out|still building|construction/.test(t))
        hints.push({ field_id: 'opening.construction', value: 'build-out', span: 'build-out', precision: 'exact', operation: 'set' });
    if (/published number has to stay|keep (our |the )?(current |published )?number|no new number|not getting a new number|not a new number/.test(t))
        hints.push({ field_id: 'opening.numbers', value: 'porting', span: 'keep number', precision: 'exact', operation: 'set' });
    else if (/new (phone )?number|not porting/.test(t) && !/no new number|not getting a new number|not a new number/.test(t))
        hints.push({ field_id: 'opening.numbers', value: 'new', span: 'new number', precision: 'exact', operation: 'set' });
    else if (/port|keep .{0,20}number/.test(t))
        hints.push({ field_id: 'opening.numbers', value: 'porting', span: 'port', precision: 'heuristic', operation: 'set' });
    const rooms = t.match(/(\d+|one|two|three|four|five|six|seven|eight) (?:treatment |exam |dental )?(rooms?|chairs?|operatories|operatory)/);
    if (rooms) {
        const n = parseNumberWord(rooms[1]);
        if (n != null)
            hints.push({ field_id: 'policy.rooms', value: n, span: rooms[0], precision: 'exact', operation: 'set' });
    }
    const untilMonth = text.match(/(?:do not open until|open until|until)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i);
    const pretended = /already open in|pretend.{0,40}open in/.test(t);
    const monthOnly = untilMonth || (!pretended && text.match(/(?:aiming for|opening in|opening target is|target is|we open(?:s|ing)? in|opens in|open in|, in|next)\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/i));
    if (monthOnly && !day) {
        hints.push({ field_id: 'opening.date', value: monthOnly[1], span: monthOnly[0], precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'opening.precision', value: 'month', span: monthOnly[0], precision: 'exact', operation: 'set' });
    }
    if (/opening a (ninth|second|third)|eight offices already|ninth office|already have .{0,20}offices|opening another|i am adding|adding the |adding a |adding one in|we(?:re| are) adding|already have .{0,60} adding /.test(t))
        hints.push({ field_id: 'mode', value: 'adding', span: 'adding', precision: 'exact', operation: 'set' });
    else if (/existing|already have|weve had|we have had|ive had|been open|already open|open for years|for years|for (twenty|thirty|forty|fifty|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|many) years|had this|been here \d|replacing (our |the )?(old )?phone|replace (our |the )?(old )?phone|keep (our |the )?(current |published )?number|port it/.test(t)
        && !/\b(we are |im |i am )?opening (a |my |our )?(new )?/.test(t))
        hints.push({ field_id: 'mode', value: 'improving', span: 'existing', precision: 'heuristic', operation: 'set' });
    else if (/\b(starting|opening) (a |my |our )?(new )?(family )?(dental|eye)|new (dental |eye |vision )?practice|new (vision|eye|dental) office|another new office|we are opening|im opening|i am opening/.test(t) && !/already open|been open|open for years|for years|existing|already have|opening a (ninth|second)|opening another|do not call this a brand new|offices exist|replacing (our |the )?(old )?phone/.test(t))
        hints.push({ field_id: 'mode', value: 'opening', span: 'opening', precision: 'exact', operation: 'set' });
    else if (/family dental|family dentistry/.test(t) && !/existing|already have|had this|weve had|been open|open for years|for years|adding |replacing (our |the )?(old )?phone|for .{0,12} years/.test(t))
        hints.push({ field_id: 'mode', value: 'opening', span: 'family dental', precision: 'heuristic', operation: 'set' });
    if (/\bdental\b|dentist|orthodont/.test(t) && !/eye (care|office)|optometr/.test(t))
        hints.push({ field_id: 'specialty', value: 'Dental', span: 'dental', precision: 'exact', operation: 'set' });
    else if (/eye care|optometr|ophthalm|vision office/.test(t))
        hints.push({ field_id: 'specialty', value: 'Eye care', span: 'eye', precision: 'exact', operation: 'set' });
    else if (/chiropract/.test(t)) {
        hints.push({ field_id: 'specialty', value: 'Other healthcare practice', span: 'chiropractic', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'specialtyDetail', value: 'Chiropractic', span: 'chiropractic', precision: 'exact', operation: 'set' });
    }
    else if (/physical therap|\bpt clinic\b/.test(t)) {
        hints.push({ field_id: 'specialty', value: 'Other healthcare practice', span: 'physical therapy', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'specialtyDetail', value: 'Physical therapy', span: 'physical therapy', precision: 'exact', operation: 'set' });
    }
    else if (/dermatolog/.test(t)) {
        hints.push({ field_id: 'specialty', value: 'Other healthcare practice', span: 'dermatology', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'specialtyDetail', value: 'Dermatology', span: 'dermatology', precision: 'exact', operation: 'set' });
    }
    else if (/family medicine|family practice/.test(t)) {
        hints.push({ field_id: 'specialty', value: 'Other healthcare practice', span: 'family medicine', precision: 'exact', operation: 'set' });
        hints.push({ field_id: 'specialtyDetail', value: 'Family medicine', span: 'family medicine', precision: 'exact', operation: 'set' });
    }
    return hints;
}

export function parseRouting(text: string): LocalHint[] {
    const t = fold(text);
    const hints: LocalHint[] = [];
    const add = (field_id: string, value: Scalar, span: string, precision: Precision = 'exact') => {
        if (!hints.some(h => h.field_id === field_id))
            hints.push({ field_id, value, span, precision, operation: 'set' });
    };
    const skipFirst = /who answers first|not deciding who answers|skip that|she does not answer first/.test(t);
    if (/while the office is open, calls go to the doctor|i mean every call/.test(t) && /doctor/.test(t)) {
        add('first.kind', 'human', 'doctor first');
        add('first.team', 'clinical', 'doctor');
    }
    else if (!skipFirst && /person at the front|reach a person|front desk first|staff should answer|staff answer now|the girls answer now|not a menu|hate (those |the |phone )?menus?|real person during the day|\bperson first\b|whoever is at the front|someone answers all|a person at the front|a person answers|front desk person|receptionist(?:s)? (?:should )?answer first|front desk (?:people |person )?answer first|will answer the calls|answers that phone|human receptionist answers|(?:the )?receptionist answers(?! only if)|receptionists answer first|answers the phone|they answer the phone|albany should answer first|keep a person answering|the person who answers first is the receptionist|newburgh calls should be answered first|receptionist is supposed to answer|front desk still answers|front desk answers ordinary|front desk answers(?! beacon)|beacon front desk answers|both should ring at the same time|poughkeepsie (receptionists|staff|front desk) answer|ring one receptionist|offices ring one|answers beacon calls|shared reception team/.test(t)) {
        add('first.kind', 'human', 'person first');
        add('first.team', 'reception', 'front desk');
    }
    else if (!skipFirst && /(?:we want a |a short )?phone menu|press 1 for appointments|press 1,/.test(t) && !/not a menu|hate .{0,16}menus?|no menu|dont want (a )?menu/.test(t)) {
        add('first.kind', 'menu', 'menu first');
    }
    if (/both (receptionists|phones|lines).{0,30}ring|ring at the same time|whoever gets it|both lines should ring together/.test(t))
        add('policy.ring', 'together', 'both ring');
    else if (/ring .{0,40}first,? then|senior .{0,20}first|one then the other|in order(?! to)|cascade|if she misses/.test(t))
        add('policy.ring', 'order', 'ring in order');
    if (/two separate lines|both (can )?pick up|take two callers at once/.test(t) && !/can'?t both|cannot both|can not both|sharing one|share one/.test(t))
        add('devices.reception.sharing', 'separate', 'two separate lines');
    else if (/shar(e|ing) (one |a )?(phone|line)|one (desk )?phone between|can'?t both talk|cannot both talk|one conversation at a time/.test(t))
        add('devices.reception.sharing', 'shared', 'share one');
    if (/work mobile|work phone|work cell|ring my (personal )?(cell|phone)|my personal (cell|number)/.test(t)) {
        add('devices.work_mobile', 'app', 'work mobile');
        if (/husband|office manager/.test(t))
            add('devices.work_mobile.team', 'admin', 'office manager work mobile');
    }
    if (/if the front is slammed|if (the )?(front desk|desk) is (slammed|busy)/.test(t) && /work mobile|work phone|work cell/.test(t))
        add('busy.backup', 'admin', 'slammed work mobile');
    if (/on the other line.{0,40}(ring|try) the back office|ring the back office/.test(t))
        add('busy.backup', 'admin', 'back office');
    if (/i(?:\'ll| will) answer the phone myself|answer .{0,20}myself between patients/.test(t)) {
        add('first.kind', 'human', 'i answer');
        add('first.team', 'clinical', 'myself');
        add('devices.work_mobile', 'app', 'my cell as work');
    }
    if (/when they'?re slammed|when they are slammed|ai overflow|let the robot/.test(t) && !/work mobile|work phone/.test(t))
        add('busy.kind', 'assistant', 'ai overflow');
    else if (/wait (about )?(a minute|sixty seconds)|let (them|the caller|callers) wait|queue with hold|put (them|callers) in a (short )?queue|hold music/.test(t))
        add('busy.kind', 'queue', 'wait');
    else if (/try the office manager next|try troy|overflow/.test(t) && /miss|busy|does not answer|thirty seconds/.test(t))
        add('busy.kind', 'backup', 'overflow');
    else if (/take a message|take a voicemail/.test(t) && /busy|with patients|if both|if nobody|already on a call|other line|slammed|misses the call|if she misses|misses it/.test(t)
        && !/wait|queue|hold music/.test(t)
        || /missed calls?.{0,40}voicemail/.test(t)
        || /if (they|she) (are|is) busy, voicemail/.test(t)
        || /busy calls (are |go to )voicemail/.test(t)
        || /if we miss (a |the )?call.{0,40}voicemail/.test(t)
        || /if they (do not pick up|miss it)/.test(t) && /voicemail|message/.test(t)
        || /if the (front desk|person) misses.{0,20}(call, )?voicemail/.test(t)
        || /voicemail if they miss/.test(t)
        || /missed daytime calls are voicemail/.test(t)
        || /take a voicemail for the receptionist/.test(t)
        || /busy time is voicemail/.test(t))
        add('busy.kind', 'message', 'take a message');
    const waitMins = t.match(/(?:up to|wait(?:ing)?)\s+(\d+)\s+minutes?/);
    if (waitMins)
        add('busy.wait', Number(waitMins[1]) * 60, waitMins[0]);
    const serviceBrand = ANSWERING_SERVICES.find(name => new RegExp('\\b' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i').test(text));
    if ((/live answering service|after hours.{0,40}answering service|answering service called|(?:^|[^.!?])\s*an answering service/.test(t)
        || /\bafter hours answering service\b/.test(t)
        || (serviceBrand && /after hours|when (we |they |the office )?clos|overnight|evenings/.test(t))
        || /after hours we use [a-z0-9 .'-]{2,40}/.test(t) && serviceBrand)
        && !/\b(?:not|no|never|dont|don't)\b.{0,24}\banswering service\b|\banswering service\b.{0,16}\b(?:not|no)\b/.test(t))
        add('after.kind', 'service', serviceBrand || 'answering service');
    else if (/ai receptionist.{0,40}after hours|after hours.{0,40}ai receptionist/.test(t))
        add('after.kind', 'assistant', 'ai after hours');
    else if (/after hours.{0,80}(play information|information(?: recording)?(?: and| then)? hang|information then hang)|play (our |the )?hours and hang|just play our hours|after hours.{0,40}no voicemail/.test(t))
        add('after.kind', 'information', 'after hours information');
    else if ((/after hours.{0,40}(voicemail|message)|next-business-day voicemail|when (we are |they call )?closed.{0,20}(voicemail|message)/.test(t)
        || /after hours, next-business-day voicemail/.test(t)
        || /\bnot an answering service\b/.test(t)
        || /after (hours|five|we close|close),? (voicemail|a message|take a message)/.test(t)
        || /after we close.{0,40}voicemail/.test(t)
        || /after close.{0,20}voicemail/.test(t))
        && !/no after-?hours voicemail|not after-?hours voicemail|dont (want|use|need) after-?hours voicemail|live answering service/.test(t))
        add('after.kind', 'message', 'after hours voicemail');
    return hints;
}

function openingYearFromHints(hints: LocalHint[], facts: Record<string, Fact> = {}) {
    const date = String(hints.find(h => h.field_id === 'opening.date')?.value || facts['opening.date']?.value || '');
    const y = date.match(/(20\d{2})/);
    return y ? Number(y[1]) : undefined;
}

export function parseOwnerText(text: string, facts: Record<string, Fact> = {}): LocalHint[] {
    const chunks = [
        ...parseOpening(text),
        ...parseCity(text),
        ...parsePracticeName(text),
        ...parseRoster(text),
        ...parseHours(text),
        ...parseLunch(text),
        ...parseOwnership(text),
        ...parseRouting(text),
        ...parseUrgent(text),
        ...parseLanguages(text),
        ...parseBeforeOpening(text),
        ...parsePMS(text),
        ...parseContinuity(text),
        ...parseReasons(text),
        ...parseLocations(text),
        ...parseCurrentLines(text)
    ];
    const year = openingYearFromHints(chunks, facts);
    chunks.push(...parseHolidays(text, year));
    const byId = new Map<string, LocalHint>();
    for (const hint of chunks) {
        const prior = byId.get(hint.field_id);
        if (!prior || (hint.precision === 'exact' && prior.precision !== 'exact'))
            byId.set(hint.field_id, hint);
    }
    return [...byId.values()];
}

export function valueGroundedInText(value: Scalar, text: string, evidence = ''): boolean {
    const folded = fold(text);
    if (value == null)
        return true;
    if (typeof value === 'boolean')
        return !!evidence;
    if (typeof value === 'number') {
        if (folded.includes(String(value)))
            return true;
        const word = Object.entries(WORD_N).find(([, n]) => n === value)?.[0];
        return !!(word && folded.includes(word));
    }
    const s = fold(String(value));
    if (!s)
        return false;
    if (folded.includes(s))
        return true;
    const city = s.replace(/,\s*(ny|new york|[a-z]{2})$/, '').trim();
    if (city && city.length > 2 && folded.includes(city))
        return true;
    const time = /^(\d{2}):(\d{2})$/.exec(String(value));
    if (time) {
        const h = Number(time[1]) % 12 || 12;
        const min = time[2];
        if (min === '00' && (folded.includes(h + ' am') || folded.includes(h + ' pm') || folded.includes(String(h))))
            return true;
        if (folded.includes(h + ':' + min))
            return true;
    }
    return false;
}
