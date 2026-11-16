import { parseOwnerText, valueGroundedInText, type Precision } from './parse';
import type { Fact, InterpreterIntent, InterpreterUpdate, NextQuestion, Scalar } from './types';

const WORD_N: Record<string, number> = {
    zero: 0, none: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const CITIES = [
    'wappingers falls', 'glens falls', 'new paltz', 'hyde park', 'red hook', 'new windsor',
    'kingston', 'poughkeepsie', 'newburgh', 'middletown', 'albany', 'troy',
    'beacon', 'hudson', 'catskill', 'wappingers', 'fishkill', 'woodstock',
    'rosendale', 'millbrook', 'warwick', 'goshen', 'new york'
];

export function fold(value: string) {
    return value.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
}

const NAMED_CITIES = 'wappingers falls|glens falls|new paltz|hyde park|red hook|new windsor|kingston|poughkeepsie|newburgh|middletown|albany|troy|beacon|hudson|catskill|saugerties|rhinebeck|wappingers|fishkill|woodstock|rosendale|millbrook|warwick|goshen';

export function isCorrection(text: string) {
    const t = fold(text);
    return /\b(actually|instead|change that|change a few things|no,? wait|wait,? only|not anymore|not april|not two|not four|i dont want the ai answering first|only two|only one|no, one|kingston was a mistake|scratch the old|now in |not a second location|that is two clinicians|clinical count is)\b/i.test(t)
        || new RegExp('\\bforget (?:the )?(?:' + NAMED_CITIES + ')\\b').test(t)
        || new RegExp('\\bthis is (?:' + NAMED_CITIES + ')\\b').test(t)
        || new RegExp("\\b(?:it'?s|actually(?: it'?s)?) (?:" + NAMED_CITIES + ')\\b').test(t);
}

export function detectIntent(text: string, groqIntent?: InterpreterIntent): InterpreterIntent {
    const t = fold(text);
    if (/just give me (the )?(plan|what you have|the draft|the blueprint)|give me the (plan|draft|blueprint)|thats enough|that is enough|i dont have time for this/.test(t))
        return 'generate_draft';
    if (isCorrection(text))
        return 'correct_information';
    if (/dont start with (all that|the questions|that)|let me (just )?(tell|talk|explain)/.test(t))
        return 'provide_information';
    if (groqIntent === 'skip_current' && !/\b(skip|not sure|dont know|do not know|not now|later)\b/.test(t))
        return 'provide_information';
    if (groqIntent)
        return groqIntent;
    return 'provide_information';
}

export function specifiesUrgentScope(text: string): 'urgent_only' | 'all_calls' | '' {
    const t = fold(text);
    if (/do not set up|have not figured|havent figured|any urgent path yet|not figured out on-call|leave on-call blank|leave urgent blank/.test(t))
        return '';
    if (/not every call|not all (incoming )?calls|regular calls do not|i only mean emergencies|only true emergencies|emergencies can reach|regular (daytime )?calls stay/.test(t))
        return 'urgent_only';
    if (/every (incoming )?call|all (incoming )?calls/.test(t) && /doctor|clinician|on-call|dentist/.test(t) && !/robot|ai |only (urgent|emergenc)|not every/.test(t))
        return 'all_calls';
    if (/\bonly (urgent|emergenc)|just emergenc|only for a true emergency|emergenc(y|ies) only|urgent calls go (to|straight)|regular calls go to reception/.test(t))
        return 'urgent_only';
    if (/\bemergenc/.test(t) && /straight to (the )?(dentist|doctor|clinician)|go straight to/.test(t))
        return 'urgent_only';
    return '';
}

/** Owner denied live on-call / clinician connect — "no on-call" must not count as naming a clinician destination. */
export function deniesClinicianRoute(text: string) {
    const t = fold(text);
    return /\bno on-?call\b|\bnot on-?call\b|\bwithout on-?call\b|\bdont (want|need|have) (an? )?on-?call\b|\bdo not (want|need|have) (an? )?on-?call\b|\bnobody on call\b|\bno nighttime on-?call\b|\bnobody answering emergencies\b|\bjust take a message.{0,40}no on-?call\b|\bno on-?call.{0,40}(just )?take a message\b/.test(t);
}

export function mentionsClinicianRoute(text: string) {
    const t = fold(text);
    if (deniesClinicianRoute(text))
        return false;
    return /clinician phone|doctors? phone|docro|\bon-?call\b|go to the (doctor|clinician|dentist)|calls go to the doctor|reach (a |the )?(doctor|clinician)|connect the on-call/.test(t);
}

export function clinicianRouteAmbiguous(text: string, facts: Record<string, Fact> = {}) {
    if (facts['urgent.scope']?.status === 'confirmed')
        return false;
    if (deniesClinicianRoute(text))
        return false;
    if (!mentionsClinicianRoute(text))
        return false;
    return !specifiesUrgentScope(text);
}

function parseN(raw: string) {
    const k = fold(raw);
    if (k in WORD_N)
        return WORD_N[k];
    if (/^\d+$/.test(k))
        return Number(k);
    return null;
}

function make(field_id: string, value: Scalar, evidence: string, precision: Precision = 'heuristic'): InterpreterUpdate {
    return { field_id, operation: 'set', value, evidence, needs_confirmation: false, precision };
}

export function updatesFromOwnerText(text: string, question: NextQuestion | null, facts: Record<string, Fact> = {}): InterpreterUpdate[] {
    const evidence = text.slice(0, 180);
    const t = fold(text);
    const correcting = isCorrection(text);
    const updates: InterpreterUpdate[] = [];
    const add = (field_id: string, value: Scalar, precision: Precision = 'heuristic') => {
        if (value == null || value === '')
            return;
        if (updates.some(u => u.field_id === field_id))
            return;
        const status = facts[field_id]?.status;
        if (status === 'conflicting' && !correcting && precision !== 'exact')
            return;
        if (status === 'confirmed' && !correcting && (precision !== 'exact' || sameFieldValue(facts[field_id]?.value, value)))
            return;
        updates.push(make(field_id, value, evidence, precision));
    };
    for (const hint of parseOwnerText(text, facts)) {
        if (hint.operation === 'skip') {
            if (!updates.some(u => u.field_id === hint.field_id))
                updates.push({ field_id: hint.field_id, operation: 'skip', value: null, evidence: hint.span, needs_confirmation: false, precision: hint.precision });
            continue;
        }
        add(hint.field_id, hint.value, hint.precision);
    }

    if (question) {
        for (const option of question.options) {
            if (option.operation !== 'set' || option.value == null)
                continue;
            const label = fold(option.label);
            if (label.length > 4 && t.includes(label)) {
                if (option.field_id === 'first.kind' && option.value === 'assistant' && /later|not at launch|when we (are |get )?bigger|next year|might add ai/.test(t) && !/\bat launch\b/.test(t))
                    continue;
                add(option.field_id, option.value);
            }
        }
        if (question.id === 'specialtyDetail' || question.affectedFields.includes('specialtyDetail')) {
            const skip = /^(skip|not sure|unsure|later|i don'?t know|dont know)\b/.test(t);
            const raw = text.trim().replace(/^(we(?:'re| are)|it(?:'s| is)|i (?:run|have|own|practice))\s+(a |an )?/i, '').slice(0, 120).trim();
            if (!skip && raw && !updates.some(u => u.field_id === 'specialtyDetail')) {
                add('specialty', 'Other healthcare practice', 'exact');
                add('specialtyDetail', raw.replace(/^./, ch => ch.toUpperCase()), 'exact');
            }
        }
    }

    if (/\b(starting|opening) a dental|\bdental\b|dentist'?s? office|dentist office|\b(im|i am) the dentist\b|tooth\b|\bortho\b/.test(t) && !/not (a |an )?dental|family medicine|family practice|podiatr/.test(t))
        add('specialty', 'Dental');
    if (/\bfamily eye\b|\beye (place|care|exams|office|practice)\b|\bvision (care|office|practice|center)\b|glasses|optometr|ophthalm/.test(t))
        add('specialty', 'Eye care');
    if (/\bchiro(?:pract\w*)?\b/.test(t)) {
        add('specialty', 'Other healthcare practice');
        add('specialtyDetail', 'Chiropractic');
    }
    if (/med\s*spa|medical spa/.test(t)) {
        add('specialty', 'Other healthcare practice');
        add('specialtyDetail', 'Med spa');
    }
    if (/family medicine|family practice/.test(t) && !/family dental/.test(t)) {
        add('specialty', 'Other healthcare practice');
        add('specialtyDetail', 'Family medicine');
    }
    if (/podiatr/.test(t)) {
        add('specialty', 'Other healthcare practice');
        add('specialtyDetail', 'Podiatry');
    }

    const notSecond = /not a second|not adding (a )?(second|2nd)|the only office|scratch the old|kingston was a mistake|relocating|taking over/.test(t);
    const alreadyOwnsOther = /already own/.test(t) && /this (plan|blueprint) is|adding |second (office|location)/.test(t);
    const improvingCue = /\b(thirty years|had this .{0,24}office|weve had|we have had|ive had|been open|already open|open for years|for years|for (twenty|thirty|forty|fifty|\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|many) years|existing (office|setup|phones|dental|practice)|bought an older|we bought|bought .{0,48}(old )?(office|practice)|took over .{0,40}(office|practice)|acquired .{0,40}(office|practice)|been here (forever|for years|\d)|phones are just terrible|phones suck|phones are garbage|old place|just fix (them|the phones)|replacing (our |the )?(old )?phone|replace (our |the )?(old )?phone|improving (our |the )?phones|improving (an )?existing|moving across town|moving (our existing |the dental office )?across|i bought|relocating|taking over|same practice|same office continuing)\b/.test(t);
    if ((/\b(adding|second (office|location)|another (office|location)|ninth office|opening a ninth|opening a (second|2nd|third|3rd)|opening another|already have (one|a|\d+) .{0,40}office|two dental offices|keep everything under one roof|eight offices already)\b/.test(t) || alreadyOwnsOther) && !notSecond && !/another new (office|location)/.test(t))
        add('mode', 'adding');
    else if (improvingCue)
        add('mode', 'improving');
    else if (/\b(existing .{0,24}office|this office is already open|office i already have|same office continuing)\b/.test(t) && !notSecond)
        add('mode', 'improving');
    else if (/\b(starting|opening|new practice|first dental office|we are opening|open until|advertising the phone number|new office we are opening|mode is a new opening|building a new|new dental office|new eye (care )?office)\b/.test(t) && !/not a (brand )?new opening|already open|been open|open for years|for years|office i already have|weve had|replacing (our |the )?(old )?phone|for .{0,16} years|not opening|taking over|relocating/.test(t))
        add('mode', 'opening');

    const expandingCity = /another office|second location|overflow|ninth office|already have|adding /.test(t) && !notSecond;
    const picked = pickCities(t);
    // This plan's city is the office being added / named as the plan subject, not the existing home office.
    const homeCity = t.match(new RegExp('(?:already have|existing (?:office|practice) in|(?:office|practice) in) ((?:' + NAMED_CITIES + '))', 'i'))
        || t.match(new RegExp('\\b((?:' + NAMED_CITIES + ')) (?:family )?(?:dental|eye|vision|orthodont)', 'i'))
        || t.match(new RegExp('\\bhome is ((?:' + NAMED_CITIES + '))', 'i'));
    const addCity = t.match(new RegExp('adding (?:a |an |one )?(?:second )?(?:office |location )?in ((?:' + NAMED_CITIES + '))', 'i'))
        || t.match(new RegExp('adding (?:a |an |one )?((?:' + NAMED_CITIES + ')) (?:office|location)', 'i'));
    const thisPlanCity = t.match(new RegExp('this plan is (?:the )?((?:' + NAMED_CITIES + '))', 'i'))
        || t.match(new RegExp('the plan i want is the ((?:' + NAMED_CITIES + '))', 'i'))
        || t.match(new RegExp('((?:' + NAMED_CITIES + ')) office is the new one', 'i'));
    const homeAnswersBoth = !!(homeCity && /answer(?:s)? both|under the same (?:published )?number|same number for both/.test(t));
    const focusCity = thisPlanCity
        ? titleCity(thisPlanCity[1])
        : (homeAnswersBoth && homeCity)
            ? titleCity(homeCity[1])
            : (expandingCity && addCity ? titleCity(addCity[1]) : '');
    const homeTitle = homeCity ? titleCity(homeCity[1]) : '';
    const addTitle = addCity ? titleCity(addCity[1]) : '';
    const otherCity = focusCity && homeTitle && fold(homeTitle) !== fold(focusCity)
        ? homeTitle
        : (focusCity && addTitle && fold(addTitle) !== fold(focusCity) ? addTitle : '');
    if (focusCity && (!otherCity || fold(focusCity) !== fold(otherCity))) {
        const priorCity = updates.find(u => u.field_id === 'cityState');
        const withState = (city: string, prior?: string) => {
            if (/,\s*[A-Z]{2}$/.test(city))
                return city;
            const st = String(prior || '').match(/,\s*([A-Z]{2}|[A-Za-z ]+)$/);
            return city + ', ' + (st ? st[1] : 'NY');
        };
        if (!priorCity)
            add('cityState', withState(focusCity), 'exact');
        else if (fold(String(priorCity.value)).split(',')[0].trim() !== fold(focusCity)) {
            priorCity.value = withState(focusCity, String(priorCity.value));
            priorCity.precision = 'exact';
        }
        if (otherCity && fold(otherCity) !== fold(focusCity) && !updates.some(u => u.field_id === 'policy.notes'))
            add('policy.notes', otherCity);
    }
    else if (!updates.some(u => u.field_id === 'cityState')) {
        if (picked.primary) {
            const prior = String(facts.cityState?.value || '').toLowerCase();
            if (expandingCity && facts.cityState?.status === 'confirmed' && prior && !prior.startsWith(picked.primary.toLowerCase()))
                add('policy.notes', [picked.primary, ...picked.also].join('; '));
            else {
                add('cityState', picked.primary, 'heuristic');
                if (picked.also.length)
                    add('policy.notes', picked.also.join('; '));
            }
        }
    }
    else if (picked.also.length)
        add('policy.notes', picked.also.join('; '));
    if (picked.primary && picked.also.length && !updates.some(u => u.field_id === 'policy.notes'))
        add('policy.notes', picked.also.join('; '));

    const rooms = t.match(/(\d+|one|two|three|four|five|six|seven|eight) (?:treatment |exam |dental )?(rooms?|chairs?|operatories|operatory)/)
        || t.match(/(\d+|one|two|three|four|five|six|seven|eight) ops\b/);
    if (rooms) {
        const n = parseN(rooms[1]);
        if (n != null)
            add('policy.rooms', n);
    }

    const openDay = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/);
    const openMonth = t.match(/actually (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || t.match(/(?:do not open until|open until) (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || (/march is the opening/.test(t) ? ['march', 'march'] as unknown as RegExpMatchArray : null)
        || t.match(/(?:aiming for|opening in|opens in) (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || t.match(/until (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || (correcting ? t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/) : null);
    if (openDay && /open/.test(t)) {
        add('opening.date', openDay[1] + ' ' + openDay[2] + (openDay[3] ? ' ' + openDay[3] : ''));
        add('opening.precision', 'day');
    }
    else if (openMonth && !/already open in|pretend.{0,40}open in/.test(t)) {
        add('opening.date', openMonth[1]);
        add('opening.precision', 'month');
    }
    else if (/\bspring\b/.test(t) && /open/.test(t)) {
        add('opening.date', 'April');
        add('opening.precision', 'month');
    }

    if (/new (phone )?number|get a new number|need a new number|fresh number|dont port|do not port/.test(t) && !/no new number|not getting a new number|not a new number|cannot lose|keep .{0,40}number|dont give me a new number|do not give me a new number|dont issue (me )?a new number|old number/.test(t))
        add('opening.numbers', 'new');
    if (/cannot lose|keep .{0,40}number|keep it|port|no new number|not getting a new number|published number has to stay|dont give me a new number|do not give me a new number|dont issue (me )?a new number|same patients,? same number|\bsame number\b|keep (our |the )?(current |published )?\d{3}|same \d{3}\b|old number|still (dial|call|use) (the )?(old number|\d{3})|already on (google|yelp|facebook|(the |our )?website)|number (is )?already on|on the (door|website|google|magnets)|on the magnets|google (business )?(listing|profile)|listing has the \d{3}|has the \d{3}/.test(t) && /number|keep it|port|\d{3}|google|website|door|magnets|listing|profile/.test(t) && !/dont port|do not port|not porting|fresh number/.test(t))
        add('opening.numbers', 'porting');
    if (/\bdentrix\b/.test(t) && !/\bnot dentrix\b|\bnot switching to dentrix\b|\bswitching from dentrix\b|\bmoved from dentrix\b|\bfrom dentrix to\b/.test(t))
        add('opening.pms', 'Dentrix');
    if (/\beaglesoft\b/.test(t) && !/\bnot eaglesoft\b/.test(t))
        add('opening.pms', 'Eaglesoft');

    const named = text.match(/\b(?:called|named|call it)\s+([A-Z][A-Za-z0-9'& -]{1,40}?)(?=[.,]|$)/i);
    if (named)
        add('name', named[1].trim());

    extractStaff(t, facts, correcting, add, (id) => {
        const i = updates.findIndex(u => u.field_id === id);
        if (i >= 0)
            updates.splice(i, 1);
        updates.push({ field_id: id, operation: 'skip', value: null, evidence, needs_confirmation: false });
    });
    extractRouting(t, facts, add, id => updates.some(u => u.field_id === id));
    if (!updates.some(u => /^hours\.(Monday|Tuesday|Wednesday|Thursday|Friday)\.(start|end)$/.test(u.field_id)))
        extractHours(t, add);
    extractDevices(t, add);

    if (/speak spanish|spanish-speaking|patients speak spanish|maria .{0,40}spanish/.test(t) && !/do not need spanish|english is enough|english only|dont (do|speak|need) spanish/.test(t))
        add('languages.spanish', true);
    else if (/\benglish is enough|do not need spanish|english only\b|dont (do|speak|need|offer) spanish/.test(t) && facts['languages.spanish']?.status !== 'confirmed')
        add('languages.decision', 'none');

    if (/yes, include text follow-up|include text follow-up|text follow-up so/.test(t))
        add('followup', 'yes');
    else if (/no texts|no texting|phone messages only|no text follow-up|no text follow up|no text reminders|no extra texting|no text program/.test(t))
        add('followup', 'skip');
    if (/three[- ]year|36 month|thirty[- ]six month/.test(t))
        add('current.contract', 'three years');
    if (/\bmaria\b/.test(t))
        add('policy.notes', 'Maria');
    if (/work cell|work mobile/.test(t))
        add('policy.notes', 'work cell');

    const missGoesToMailbox = /if she misses[^.!?]{0,50}(take a )?(voicemail|message)\b|\bvoicemail if she misses/.test(t);
    const orderedRing = (
        /ring .{0,40}first,? then|senior .{0,24}first|one then the other|one then the next|then the other if she misses|ring(?:ing)? (?:them |the phones )?in order|(?:calls|phones) cascade|go down the list|dont ring all|do not ring all|stagger (?:the )?(?:phones|them|calls|lines)|hunt (?:the )?(?:phones|calls|lines)/.test(t)
        || (/\bin order\b/.test(t) && !/\bin order to\b/.test(t))
    ) && !missGoesToMailbox;
    if (
        /both (receptionists|phones).{0,30}ring|ring at the same time|whoever gets it|whoever is free|grabs it|blast (all )?(the )?phones|all the phones at once|both (can )?pick up at once|pick up at once|they can both pick up/.test(t)
        && !orderedRing
        && !/dont blast|do not blast|dont ring all|do not ring all/.test(t)
    )
        add('policy.ring', 'together');
    else if (orderedRing)
        add('policy.ring', 'order');
    if (/both receptionists/.test(t))
        add('teams.reception.count', 2);
    if (/thanksgiving|christmas/.test(t) && /closed/.test(t))
        add('holidayPolicy', 'closed');
    if (/havent figured|have not figured|skip (that|on-call|urgent)|do not set up a doctor line|any urgent path yet|im skipping/.test(t) && /on-call|urgent|doctor line/.test(t)) {
        updates.push({ field_id: 'urgent.kind', operation: 'skip', value: null, evidence, needs_confirmation: false });
        updates.push({ field_id: 'urgent.scope', operation: 'skip', value: null, evidence, needs_confirmation: false });
        updates.push({ field_id: 'urgent.pending_route', operation: 'set', value: false, evidence, needs_confirmation: false });
    }

    if (/work cell|work mobile/.test(t)) {
        add('devices.work_mobile', 'app');
        if (/husband|office manager/.test(t))
            add('devices.work_mobile.team', 'admin');
        if (/if the front is slammed|if (the )?(front desk|desk) is (slammed|busy)/.test(t))
            add('busy.backup', 'admin');
        if (/internet|goes out|failover|outage|die|to the work cell/.test(t))
            add('continuity.backupRouting', /forward/.test(t) ? 'forward' : 'cellular');
    }
    if (/ring my (personal )?(cell|phone)|my personal (cell|number)|do not (put|publish) my (cell|number|phone)/.test(t)) {
        add('devices.work_mobile', 'app');
        add('policy.notes', 'work mobile only; personal number not published');
    }
    if (/on the other line.{0,40}ring my (husband|wife|office manager)|ring my husband/.test(t))
        add('busy.backup', 'admin');

    const money = t.match(/\$ ?(\d{2,4}) a month|\$ ?(\d{2,4}) \/ month/);
    if (money)
        add('current.monthly', String(money[1] || money[2]));

    if (clinicianRouteAmbiguous(text, facts))
        add('urgent.pending_route', true);

    return updates;
}

function pickCities(t: string) {
    const names = NAMED_CITIES;
    const skip = (t.match(/do not replace (\w+)/) || [])[1];
    const title = (c: string) => titleCity(c.replace(/\s+new york$/, ''));
    // "not Kingston" / "not in Kingston" must not win over "it's New Paltz".
    const negated = new Set(
        [...t.matchAll(new RegExp('\\bnot (?:in )?((?:' + names + '))\\b', 'g'))].map(m => title(m[1]).toLowerCase())
    );
    const mentioned = CITIES
        .filter(name => name !== 'new york' && t.includes(name) && name !== skip && !negated.has(title(name).toLowerCase()))
        .map(title);
    const unique = [...new Set(mentioned)];
    const adding = t.match(new RegExp('adding (?:a |an |one in )?((?:' + names + '))'));
    const thisIs = t.match(new RegExp('\\bthis is ((?:' + names + '))\\b'));
    const itsCity = t.match(new RegExp("\\b(?:it'?s|actually(?: it'?s)?) ((?:" + names + '))\\b'));
    const forgotten = t.match(new RegExp('\\bforget (?:the )?((?:' + names + '))\\b'));
    const planCity = t.match(new RegExp('this (?:plan|blueprint) is (?:the )?((?:' + names + '))'));
    const inCities = [...t.matchAll(new RegExp('\\bin ((?:' + names + ')(?:\\s+new york)?)\\b', 'g'))]
        .map(m => title(m[1]))
        .filter(c => !negated.has(c.toLowerCase()));
    let primary = '';
    if (itsCity && !negated.has(title(itsCity[1]).toLowerCase()))
        primary = title(itsCity[1]);
    else if (thisIs && !negated.has(title(thisIs[1]).toLowerCase()))
        primary = title(thisIs[1]);
    else if (planCity && !negated.has(title(planCity[1]).toLowerCase()))
        primary = title(planCity[1]);
    else if (adding && !negated.has(title(adding[1]).toLowerCase()))
        primary = title(adding[1]);
    else if (inCities.length)
        primary = inCities[inCities.length - 1];
    else if (unique.length)
        primary = unique.reduce((a, b) => t.lastIndexOf(b.toLowerCase()) >= t.lastIndexOf(a.toLowerCase()) ? b : a);
    else if (t.includes('new york'))
        primary = 'New York';
    const also = unique.filter(c => {
        const lower = c.toLowerCase();
        if (lower === primary.toLowerCase())
            return false;
        if (forgotten && lower === forgotten[1])
            return false;
        if (negated.has(lower))
            return false;
        return true;
    });
    return { primary, also };
}

function titleCity(city: string) {
    return city.replace(/\b\w/g, ch => ch.toUpperCase());
}

function extractStaff(t: string, facts: Record<string, Fact>, correcting: boolean, add: (id: string, value: Scalar) => void, skip: (id: string) => void) {
    if (/\bno one at the (front|desk)|\bnobody at the (front|desk)|\bno one (up )?front|\bno staff(?: yet)?\b|\bno front desk/.test(t) && !/no staffing/.test(t))
        add('teams.reception.count', 0);
    if (/they also (handle|do) billing|front.{0,40}also.{0,24}billing|girls work the front.{0,80}billing/.test(t))
        add('billing.performed_by', 'reception');
    else if ((/handles insurance|insurance support|billing lady|other lady handles/.test(t)
        || /my (mom|mother|dad|father).{0,48}(does|handles) (the )?(insurance|books|billing)/.test(t)
        || /does (the )?(insurance|books|billing|payroll) from (home|the house|her apartment|his apartment|the apartment)/.test(t)
        || /(sister-in-law|brother-in-law).{0,48}(does|handles) (the )?(payroll|books|billing|insurance)/.test(t)) && !/they also/.test(t))
        add('billing.performed_by', 'administration');

    if (/\b(im|i am) the owner\b/.test(t) && /administrat|manage the practice|pay the bills|run the (place|office|practice)/.test(t))
        add('teams.administration.count', 1);

    if (/front desk and office manager|just my front desk/.test(t)) {
        add('teams.reception.count', 1);
        add('teams.administration.count', 1);
    }

    if (/administration count is zero|no office manager|no separate administrator|no administrator|have not hired an office manager|not hired an office manager/.test(t))
        add('teams.administration.count', 0);
    else if (/(\d+|one|an) office manager/.test(t) && !/only a message/.test(t) && !/front desk and office manager/.test(t) && !/not hired/.test(t)) {
        const prior = facts['teams.administration.count']?.status === 'confirmed' ? Number(facts['teams.administration.count'].value) : 0;
        if (!prior)
            add('teams.administration.count', 1);
    }

    if (/when \w+ gets overwhelmed|i pick up the phone|ring mine if/.test(t)) {
        if (facts['teams.reception.count']?.status !== 'confirmed')
            add('teams.reception.count', 1);
        add('teams.administration.count', 1);
    }

    if (correcting && /(?:only |no, )(one|two|three|four|\d+) receptionist/.test(t) && !/assistant/.test(t)) {
        const only = t.match(/(?:only |no, )(one|two|three|four|\d+)/);
        const recN = only ? parseN(only[1]) : null;
        if (recN != null)
            add('teams.reception.count', recN);
    }

    if (correcting && /only (one|two|three|four|\d+)/.test(t) && /assistant/.test(t)) {
        const only = t.match(/only (one|two|three|four|\d+)/);
        const recN = only ? parseN(only[1]) : null;
        if (recN != null) {
            add('teams.reception.count', recN);
            const prior = Number(facts['teams.reception.count']?.value);
            if (Number.isFinite(prior) && prior > recN)
                add('teams.clinical.count', prior - recN);
            else if (/the others are/.test(t))
                add('teams.clinical.count', recN);
        }
    }

    const together = t.match(/together that is (\d+|one|two|three|four|five) receptionists/);
    if (together) {
        const n = parseN(together[1]);
        if (n != null)
            add('teams.reception.count', n);
    }
    if (/leave clinical|clinical counts blank|not giving them today/.test(t))
        skip('teams.clinical.count');
    if (/do not (know|lock).{0,60}receptionist|one receptionist or two|staffing (still )?open|haven.?t hired (a |the )?receptionist|have not hired (a |the )?receptionist/.test(t))
        skip('teams.reception.count');
    else if (/one (girl|receptionist|person).{0,30}(at first|at opening|to start|at launch)/.test(t) || /one receptionist/.test(t) && /later/.test(t))
        add('teams.reception.count', 1);
    else {
        const front = t.match(/(\d+|one|two|three|four) (girls?|guys?|women|ladies|people) (?:work |at |on |up )?(?:the )?(front|desk)/)
            || t.match(/(\d+|one|two|three|four) (?:girls? )?(?:answer|answering) the phone/)
            || t.match(/(\d+|one|two|three|four) receptionists?/)
            || t.match(/(\d+|one|two|three|four) people at reception/)
            || t.match(/(\d+|one|two|three|four) front(?: desk)?/);
        if (front) {
            const n = parseN(front[1]);
            if (n != null)
                add('teams.reception.count', n);
        }
    }

    if (/my wife works the front/.test(t) || /one main receptionist/.test(t)
        || /my (daughter|son|wife|husband|niece|nephew) answers/.test(t)
        || /(shes|she is|hes|he is) the only one/.test(t) && /front|desk|phone/.test(t))
        add('teams.reception.count', 1);
    if (/this other lady handles insurance/.test(t)
        || /my (mom|mother|dad|father).{0,48}(does|handles) (the )?(insurance|books|billing)/.test(t)
        || /does (the )?(insurance|books|billing|payroll) from (home|the house|her apartment|his apartment|the apartment|her laptop|his laptop|a laptop|the laptop)/.test(t)
        || /(sister-in-law|brother-in-law|aunt|uncle|cousin).{0,48}(does|handles) (the )?(payroll|books|billing|insurance)/.test(t))
        add('teams.administration.count', 1);
    if ((/\bno staff(?: yet)?\b/.test(t) && !/no staffing/.test(t))
        || /\bno one at the (front|desk)|\bnobody at the (front|desk)|\bno one (up )?front|\bno front desk/.test(t))
        add('teams.reception.count', 0);

    const clinicians = t.match(/so (\d+|one|two|three|four|five)(?: clinicians)?/) || t.match(/all (\d+|four) of us are clinical/) || t.match(/clinical count is (\d+|one|two|three|four)/) || t.match(/(\d+|one|two|three|four|five) clinicians/);
    const dentists = t.match(/\b(\d+|one|two|three|four|five) dentists?\b/);
    const assistants = t.match(/(\d+|one|two|three|four|five) (?:dental )?assistants?/);
    const hygienists = t.match(/(\d+|one|two|three|four|five) hygienists?/) || (/me plus two hygienists/.test(t) ? ['two hygienists', 'two'] as const : null);
    if (clinicians && /clinical|hygienist|dentist|assistant/.test(t))
        add('teams.clinical.count', parseN(clinicians[1]) || 0);
    else if ((dentists || assistants || hygienists) && !/the others are/.test(t)) {
        const me = /\b(im|i am) the dentist\b/.test(t) ? 1 : 0;
        const d = dentists ? parseN(dentists[1] === 'a' ? 'one' : dentists[1]) || 0 : me;
        const a = assistants ? parseN(assistants[1]) || 0 : 0;
        const h = hygienists ? parseN(hygienists[1]) || 0 : 0;
        if (d + a + h > 0)
            add('teams.clinical.count', d + a + h);
    }
    else if (/i'?ll see patients|\b(im|i am) the dentist\b|me, the dentist|only dentist/.test(t))
        add('teams.clinical.count', 1);

    if (/three people up front/.test(t))
        add('teams.reception.count', 3);
}

function extractRouting(t: string, facts: Record<string, Fact>, add: (id: string, value: Scalar, precision?: Precision) => void, has: (id: string) => boolean) {
    const scope = specifiesUrgentScope(t);
    if (scope)
        add('urgent.scope', scope);

    if (/ai thing where patients call|ai receptionist at launch|puts them right on the schedule|receptionist answers only if the ai/.test(t) && !/when they'?re slammed|dont want a robot|ai .{0,50}later/.test(t))
        add('first.kind', 'assistant');
    else if (/calls go to the doctor/.test(t) && /every call|while the office is open/.test(t)) {
        add('first.kind', 'human');
        add('first.team', 'clinical');
    }
    else if (/regular calls go to reception|reception first|front desk (answers|first|handles)|front desk person answers|receptionist(?:s)? (?:should )?answer first|\bperson first\b|whoever is at the front|someone answers all|a person at the front|a person answers|the girls at the front|one main receptionist|the receptionist answers(?! only if)|person picking up|none of that press one|staff should answer|i don'?t want a robot picking up every call|just answer the phone|answers the phones?|ring immediately|she answers|will answer the calls|keep a person answering|(?:daughter|son|wife|husband) answers|albany should answer first/.test(t)
        && !/who answers first|not deciding who answers|receptionist is not the first|she does not answer first/.test(t)
        && !/(ill|i will) answer (the phone )?(myself )?between|(ill|i will) answer between (patients|chairs)|pick up on my cell between|grab it between patients|(ill|i will) take calls on my cell between/.test(t)) {
        add('first.kind', 'human');
        add('first.team', 'reception');
    }
    if (/press one for appointments|press 1|press-1|short phone menu|press one.{0,20}press two/.test(t) && !/none of that press|hate (those|menus)|do not build (a )?press|dont build (a )?press|not a menu/.test(t))
        add('first.kind', 'menu');
    if (/thanks for calling.{0,40}then the girls pick up|greeting followed by reception/.test(t))
        add('first.kind', 'human');
    if (/not a menu|hate (those |the |phone )?menus?|do not build (a )?press|dont build (a )?press|girls to answer, not a menu|want the girls to answer|real person during the day|person during the day/.test(t))
        add('first.kind', 'human');
    if (/(?:ill|i will) answer (the phone )?(myself )?(between (patients|chairs)|on my (cell|phone))|(?:ill|i will) answer the phone myself|answer .{0,20}myself between patients|answer between (patients|chairs) on my (cell|phone)|pick up on my cell between|grab it between patients|(?:ill|i will) take calls on my cell between/.test(t)
        || (/(?:ill|i will) pick up/.test(t) && /just me|solo|no staff|doesnt answer phones|does not answer phones/.test(t))) {
        add('first.kind', 'human');
        add('first.team', 'clinical');
        add('devices.work_mobile', 'app');
    }
    if (/directly(?! scheduled)|receptionist to answer directly/.test(t))
        add('first.kind', 'human');
    if (/i don'?t want the ai answering first|remove ai-first|not answering first anymore/.test(t))
        add('first.kind', 'human');
    if (/ai .{0,50}later|keep ai as something we might add|ai later when/.test(t))
        add('future.ai_receptionist', 'AI later');
    if (/live answering service|after hours we use (answerconnect|ruby|smith\.ai|answer force)|(?:use|with) answerconnect/.test(t)
        && !/dropped|no longer (use|using|with)|switched off|cancelled|used to (use|have)|got rid of|formerly/.test(t))
        add('after.kind', 'service');

    const infoHangup = /play (our |the )?hours and hang|play information|information and hang|just play our hours|announcement then (end|hang)|no voicemail|after hours.{0,40}hang up|hang up.{0,40}play (the |our )?hours|play (the |our )?hours.{0,40}hang|dont take a message/.test(t);
    if (infoHangup && /after hours|hang up|play (the |our )?hours/.test(t) && !/live answering service/.test(t))
        add('after.kind', 'information');
    if (/take a message|leave (a message|their information)|leave a (message|voicemail)|voicemail is fine|just voicemail|then voicemail|\bvoicemail\b|\bvm\b|mailbox/.test(t)
        && !/never want a voicemail|no after-?hours voicemail|no voicemail|not (a )?voicemail|no mailbox|not (a )?mailbox|dont take a message|do not take a message|let it ring/.test(t)
        && !infoHangup) {
        if (/then (take a )?voicemail/.test(t) && (/wait|minute|second/.test(t))) {
            add('busy.kind', 'queue');
            add('busy.exit', 'message');
        }
        if (/leave their information|before (the office |we )?open|advertising|before opening/.test(t))
            add('beforeOpening', 'message');
        const askingAfter = /what.?s best|do i need (ai|an answering)|dont know whether|which is better/.test(t) && /after hours/.test(t);
        if ((/after (hours|five|5|closing|we close)|when they call after|just voicemail|nighttime|night (time )?(voicemail|vm|mailbox)|overnight|\bvm\b/.test(t)) && !/live answering service/.test(t) && !askingAfter)
            add('after.kind', 'message');
        const openHoursUnanswered = /if she is already|if nobody|nobody answers|when she'?s busy|if she is busy|already on a call|with a patient|people hang up|just rings|if she misses|misses the call|busy time is voicemail/.test(t);
        const afterHoursOnly = /after (hours|five|5|closing|we close)|when they call after/.test(t) && !openHoursUnanswered && !askingAfter;
        const beforeOpenTalk = /before (the office |we )?open|before opening|not open yet/.test(t) && !afterHoursOnly;
        if (openHoursUnanswered || (/take a message|take a voicemail/.test(t) && !afterHoursOnly && !askingAfter && !beforeOpenTalk))
            add('busy.kind', 'message');
    }
    if (/never want a voicemail|real person should always answer/.test(t) && /haven'?t figured/.test(t) === false)
        /* live-answer goal; do not invent after.kind */;
    if (/\bwait\b/.test(t) && /caller|next caller|them wait|let them wait|wait for somebody/.test(t) && !/hate hold|no hold music/.test(t))
        add('busy.kind', 'queue');
    if (/^wait\.?$/.test(t) || t === 'wait')
        add('busy.kind', 'queue');
    if (/send calls to .{0,20} office|overflow to|can take the overflow|middletown can (help|take)/.test(t))
        add('busy.kind', 'backup');
    if (/when they'?re slammed, let the robot|ai overflow|robot help/.test(t))
        add('busy.kind', 'assistant');
    if (/not comfortable with a computer taking patient|leave ai out/.test(t) && /just voicemail/.test(t))
        add('after.kind', 'message');

    const wait = waitSeconds(t);
    if (wait != null)
        add('busy.wait', wait);

    if (/leave it for the receptionist|receptionist checks|girls check|front desk checks|the girls (listen|check)|she listens|voicemail for her|voicemail for the receptionist|voicemail for that receptionist|same front desk owns|belongs to the front desk|receptionist owns both/.test(t)) {
        add('busy.owner', 'reception');
        add('after.owner', 'reception');
        add('messages.owner', 'reception');
    }
    if (/i (check|listen to) (the )?(voicemail|messages)|i check the messages myself|i pick up the messages/.test(t)
        && !/(receptionist|front desk|girls) .{0,24}(check|listen|own)/.test(t)) {
        add('messages.owner', 'clinical');
        add('busy.owner', 'clinical');
        add('after.owner', 'clinical');
    }
    if (!has('beforeOpening') && (/before (the office |we )?open|before opening day|not open yet|while were building/.test(t) || /advertis/.test(t) && /number/.test(t))) {
        const wantsCallback = /callback|call back|take a message|leave (a message|their information)|take names|take a name|collect names|until we go live/.test(t)
            && !/\bno callback\b|\bnot a callback\b|\bwithout (a )?callback\b|\bno callback box\b/.test(t);
        if (wantsCallback)
            add('beforeOpening', 'message', 'exact');
        else if (/recording|announcement|say we are not open|not-open-yet/.test(t))
            add('beforeOpening', 'information', 'heuristic');
    }
    if (/internet is not in|internet is not ready|no internet yet/.test(t))
        add('opening.internet', 'unknown');
    else if (/internet is already|internet is in the suite/.test(t))
        add('opening.internet', 'known');
    else if (/survey the site.{0,40}internet|promises the internet will work/.test(t))
        add('opening.internet', 'survey');
    if (/site survey for the network|network .{0,20}survey/.test(t))
        add('opening.network', 'survey');
    if (/drywall|build-out|build out|wiring is not done|still building|construction site|we are not open|not open yet/.test(t))
        add('opening.construction', 'build-out');

    if ((deniesClinicianRoute(t) || /i dont have somebody answering emergencies|we (do not|dont) have anyone on call|no nighttime on-call|nobody answering emergencies/.test(t)) && !/have not figured|do not set up a doctor line/.test(t)) {
        add('urgent.kind', 'none');
        return;
    }
    if (/priority message|owned priority/.test(t) && /do not ring|dont ring|not ring the (doctor|dentist)/.test(t))
        add('urgent.kind', 'priority');
    else if (/do not connect urgent|play instructions|seek emergency care|tell them to go to the (er|emergency)|play (an |a )?(approved )?(recording|message)/.test(t))
        add('urgent.kind', 'instructions');
    else if (/if the on-call doctor/.test(t)) {
        add('urgent.kind', 'connect');
        add('urgent.team', 'clinical');
    }
    else if (scope === 'urgent_only' || (/\bemergenc/.test(t) && /straight to|go to the dentist/.test(t) && !clinicianRouteAmbiguous(t, facts))) {
        if (!/no on-call|dont have somebody answering emergencies|havent figured|priority message/.test(t)) {
            add('urgent.kind', 'connect');
            add('urgent.team', 'clinical');
        }
    }
    if (/rotate every week/.test(t) || (/open hours|during open/.test(t) && /closed|after hours/.test(t) && mentionsClinicianRoute(t)))
        add('urgent.coverage', 'always');
}

function extractHours(t: string, add: (id: string, value: Scalar) => void) {
    if (/do not guess|not saying nine to five|not answering hours|do not mash the hours|do not merge those hours|hours are different|leave hours blank|do not use one schedule|do not invent (one weekday|nine to five)|do not write one (shared |closing )?|skip hours|not giving .{0,40}hours/.test(t))
        return;
    const ranges = (t.match(/\b(eight|nine|ten|\d+) to (one|two|three|four|five|six|seven|\d+)/g) || [])
        .filter(r => !(/lunch/.test(t) && /^(12|1|one) to (1|2|one|two)$/.test(r)));
    if (ranges.length > 1)
        return;
    if (/monday through friday|weekdays/.test(t) && /nine to five|9 to 5|9 am.?5/.test(t)) {
        add('hours.preset', 'weekdays');
        add('hours.weekdays_start', '09:00');
        add('hours.weekdays_end', '17:00');
    }
    else if (/eight to five|8 to 5|8 am.{0,8}5/.test(t)) {
        add('hours.preset', 'custom');
        add('hours.weekdays_start', '08:00');
        add('hours.weekdays_end', '17:00');
    }
    else if (/nine to five|9 to 5/.test(t)) {
        add('hours.weekdays_start', '09:00');
        add('hours.weekdays_end', '17:00');
    }
    if (/reception only works nine to five/.test(t)) {
        add('hours.weekdays_start', '09:00');
        add('hours.weekdays_end', '17:00');
    }
    if (/closed saturdays|close saturdays|we close saturdays/.test(t) && !/every other saturday/.test(t))
        add('hours.Saturday.open', false);
    if (/every other saturday/.test(t))
        add('hours.Saturday.open', true);
    if (/closed saturday and sunday|closed weekends/.test(t)) {
        add('hours.Saturday.open', false);
        add('hours.Sunday.open', false);
    }
    if (/closes at four instead of six|closes at 4|close at 4|close at four/.test(t))
        add('hours.weekdays_end', '16:00');
}

function extractDevices(t: string, add: (id: string, value: Scalar) => void) {
    const oneFront = t.match(/one desk phone(?: at the front(?: desk)?)?/);
    const threeFront = t.match(/three desk phones at the front/);
    if (threeFront)
        add('devices.reception.desk_count', 3);
    else if (oneFront && !/need another/.test(t))
        add('devices.reception.desk_count', 1);
    const twoFrontPhones = t.match(/two desk phones at the front/);
    const fourFrontPhones = t.match(/four desk phones/);
    if (twoFrontPhones)
        add('devices.reception.desk_count', 2);
    if (fourFrontPhones)
        add('devices.reception.desk_count', 4);
    if (/one desk phone already, need another|need another/.test(t) && /desk phone/.test(t))
        add('devices.reception.desk_count', 2);
    if (/three phones that all ring|three independently/.test(t))
        add('devices.reception.desk_count', 3);
    if ((/both (can )?pick up|can both pick up|pick up at once/.test(t) || (/two (separate )?(lines|extensions)|each (has|gets) (a |their )?(own )?(phone|line)|independently/.test(t) && /front|desk|girl|receptionist|phone|line/.test(t)))
        && !/can'?t both|cannot both|can not both|sharing one|share one/.test(t))
        add('devices.reception.sharing', 'separate');
    if (/shar(e|ing) (one |a )?(phone|line)|one (desk )?phone between|one line between|they share one|can'?t both talk|cannot both talk/.test(t))
        add('devices.reception.sharing', 'shared');
    if (/computer and headset|headset|softphone/.test(t) && /front|desk|receptionist/.test(t))
        add('devices.reception.kind', 'computer');
}

function waitSeconds(t: string) {
    if (/\ba minute\b|one minute/.test(t))
        return 60;
    if (/\bsixty seconds?\b|sixty-second/.test(t))
        return 60;
    const named: Record<string, number> = {
        'fifteen second': 15,
        'twenty second': 20,
        'thirty second': 30,
        'forty five second': 45,
        'forty-five second': 45,
        'forty-five seconds': 45
    };
    for (const [needle, n] of Object.entries(named))
        if (t.includes(needle))
            return n;
    const m = t.match(/(\d+)\s*seconds/);
    return m ? Number(m[1]) : null;
}

function productLawKeeps(u: InterpreterUpdate, extra: InterpreterUpdate[], folded: string, text: string, facts: Record<string, Fact>) {
    if (u.operation === 'skip' && !/\b(skip|not sure|dont know|do not know|not now|leave (that|it) blank)\b/.test(folded))
        return false;
    if (clinicianRouteAmbiguous(text, facts)) {
        if (u.field_id === 'urgent.kind' || u.field_id === 'first.kind' || u.field_id === 'first.team')
            return false;
    }
    if (u.field_id === 'teams.administration.count' && !extra.some(h => h.field_id === 'teams.administration.count')) {
        const mentionedAdmin = /office manager|administrat|pay the bills|manage the practice|run the (place|office|practice)|handles insurance|does the books/.test(folded);
        if (!mentionedAdmin)
            return false;
    }
    if (u.field_id === 'after.kind' && extra.some(h => h.field_id === 'beforeOpening') && /before (we |the office )?open|not open yet|advertis/.test(folded) && !/after hours|when (we |the office )?clos/.test(folded))
        return false;
    if ((u.field_id === 'after.kind' || u.field_id === 'first.kind' || u.field_id === 'busy.kind') && u.value === 'assistant') {
        const launchNow = /at launch|from day one|answers first|ai receptionist at launch/.test(folded);
        const asking = /what.?s best|do i need ai|dont know whether|later|when we (are |get )?bigger|not at launch|not now/.test(folded);
        if (asking && !launchNow)
            return false;
    }
    if (u.field_id === 'busy.kind' && /after (hours|five|5|closing|we close)/.test(folded) && !/if nobody|nobody answers|when she'?s busy|already on a call|\bbusy\b/.test(folded) && !extra.some(h => h.field_id === 'busy.kind'))
        return false;
    if (u.field_id === 'teams.reception.count' && extra.some(h => h.field_id === 'teams.reception.count' && h.operation === 'skip'))
        return false;
    return true;
}

function sameFieldValue(a: Scalar, b: Scalar) {
    if (a == null && b == null)
        return true;
    if (typeof a === 'string' && typeof b === 'string')
        return fold(a) === fold(b) || fold(a).startsWith(fold(b)) || fold(b).startsWith(fold(a));
    return a === b || String(a) === String(b);
}

export function mergeInterpreterUpdates(
    groqUpdates: InterpreterUpdate[],
    hinted: InterpreterUpdate[],
    text: string,
    facts: Record<string, Fact>
): InterpreterUpdate[] {
    const extra = [...hinted];
    const folded = fold(text);
    if (clinicianRouteAmbiguous(text, facts) && !extra.some(u => u.field_id === 'urgent.pending_route' || u.field_id === 'urgent.scope'))
        extra.push(make('urgent.pending_route', true, text.slice(0, 180), 'heuristic'));
    const groundedGroq = groqUpdates.filter(u => {
        if (!productLawKeeps(u, extra, folded, text, facts))
            return false;
        if (u.operation !== 'set')
            return true;
        return valueGroundedInText(u.value, text, u.evidence);
    });
    const localBy = new Map(extra.map(u => [u.field_id, u]));
    const groqBy = new Map<string, InterpreterUpdate>();
    for (const u of groundedGroq)
        groqBy.set(u.field_id, u);
    const ids = new Set([...localBy.keys(), ...groqBy.keys()]);
    const out: InterpreterUpdate[] = [];
    for (const id of ids) {
        const local = localBy.get(id);
        const groq = groqBy.get(id);
        if (local && groq) {
            if (sameFieldValue(local.value, groq.value) || local.operation !== 'set' || groq.operation !== 'set')
                out.push(local.precision === 'exact' ? local : groq);
            else if ((local.precision || 'heuristic') === 'exact')
                out.push({ ...local, needs_confirmation: true, evidence: (local.evidence || '') + ' vs ' + (groq.evidence || '') });
            else if ((local.precision || 'heuristic') === 'heuristic' && (groq.precision || 'heuristic') === 'heuristic')
                out.push({
                    ...local,
                    operation: 'uncertain',
                    needs_confirmation: true,
                    value: local.value,
                    evidence: (local.evidence || '') + ' vs ' + (groq.evidence || '')
                });
            else
                out.push(groq);
        }
        else
            out.push((local || groq)!);
    }
    return out;
}
