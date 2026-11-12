import type { Fact, InterpreterIntent, InterpreterUpdate, NextQuestion, Scalar } from './types';

const WORD_N: Record<string, number> = {
    zero: 0, none: 0, a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10
};

const CITIES = [
    'kingston', 'poughkeepsie', 'newburgh', 'middletown', 'albany', 'troy',
    'new paltz', 'beacon', 'hudson', 'catskill', 'new york'
];

const HINT_WINS = new Set([
    'mode', 'specialty', 'cityState', 'policy.rooms',
    'teams.reception.count', 'teams.clinical.count', 'teams.administration.count',
    'billing.performed_by', 'first.kind', 'first.team',
    'busy.kind', 'busy.wait', 'after.kind',
    'urgent.kind', 'urgent.team', 'urgent.coverage', 'urgent.scope', 'urgent.pending_route',
    'hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.lunch', 'hours.weekdays_break_start', 'hours.weekdays_break_end',
    'opening.construction',
    'opening.date', 'opening.precision', 'opening.numbers', 'opening.pms',
    'languages.decision', 'languages.spanish', 'policy.ring', 'followup',
    'devices.reception.desk_count', 'devices.reception.sharing', 'devices.work_mobile',
    'messages.owner', 'beforeOpening',
    'continuity.backupRouting', 'current.monthly',
    'current.contract', 'policy.notes', 'name'
]);

export function fold(value: string) {
    return value.toLowerCase().replace(/['’]/g, '').replace(/\s+/g, ' ').trim();
}

const NAMED_CITIES = 'kingston|poughkeepsie|newburgh|middletown|albany|troy|new paltz|beacon|hudson|catskill|saugerties';

export function isCorrection(text: string) {
    const t = fold(text);
    return /\b(actually|instead|change that|change a few things|no,? wait|wait,? only|not anymore|not april|not two|not four|i dont want the ai answering first|only two|only one|no, one|kingston was a mistake|scratch the old|now in |not a second location|that is two clinicians|clinical count is)\b/i.test(t)
        || new RegExp('\\bforget (?:the )?(?:' + NAMED_CITIES + ')\\b').test(t)
        || new RegExp('\\bthis is (?:' + NAMED_CITIES + ')\\b').test(t);
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
    if (/not every call|not all (incoming )?calls/.test(t))
        return 'urgent_only';
    if (/every (incoming )?call|all (incoming )?calls/.test(t) && /doctor|clinician|on-call|dentist/.test(t) && !/robot|ai |only (urgent|emergenc)|not every/.test(t))
        return 'all_calls';
    if (/\bonly (urgent|emergenc)|just emergenc|only for a true emergency|emergenc(y|ies) only|urgent calls go (to|straight)|regular calls go to reception/.test(t))
        return 'urgent_only';
    if (/\bemergenc/.test(t) && /straight to (the )?(dentist|doctor|clinician)|go straight to/.test(t))
        return 'urgent_only';
    return '';
}

export function mentionsClinicianRoute(text: string) {
    const t = fold(text);
    return /clinician phone|doctors? phone|docro|on-?call|go to the (doctor|clinician|dentist)|calls go to the doctor|reach (a |the )?(doctor|clinician)|connect the on-call/.test(t);
}

export function clinicianRouteAmbiguous(text: string, facts: Record<string, Fact> = {}) {
    if (facts['urgent.scope']?.status === 'confirmed')
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

function make(field_id: string, value: Scalar, evidence: string): InterpreterUpdate {
    return { field_id, operation: 'set', value, evidence, needs_confirmation: false };
}

export function updatesFromOwnerText(text: string, question: NextQuestion | null, facts: Record<string, Fact> = {}): InterpreterUpdate[] {
    const evidence = text.slice(0, 180);
    const t = fold(text);
    const correcting = isCorrection(text);
    const updates: InterpreterUpdate[] = [];
    const add = (field_id: string, value: Scalar) => {
        if (value == null || value === '')
            return;
        if (updates.some(u => u.field_id === field_id))
            return;
        const status = facts[field_id]?.status;
        if (status === 'conflicting' && !correcting)
            return;
        if (status === 'confirmed' && !correcting)
            return;
        updates.push(make(field_id, value, evidence));
    };

    if (question) {
        for (const option of question.options) {
            if (option.operation !== 'set' || option.value == null)
                continue;
            const label = fold(option.label);
            if (label.length > 4 && t.includes(label))
                add(option.field_id, option.value);
        }
    }

    if (/\b(starting|opening) a dental|\bdental\b|dentist'?s? office|dentist office|\b(im|i am) the dentist\b|tooth\b/.test(t))
        add('specialty', 'Dental');
    if (/\beye (place|care|exams|office)|glasses|optometr|ophthalm/.test(t))
        add('specialty', 'Eye care');

    const notSecond = /not a second|the only office|scratch the old|kingston was a mistake/.test(t);
    if (/\b(adding|second (office|location)|another (office|location)|ninth office|opening a ninth|opening another|already have (one|a|\d+) .{0,40}office|two dental offices|keep everything under one roof|eight offices already)\b/.test(t) && !notSecond)
        add('mode', 'adding');
    else if (/\b(thirty years|had this .{0,24}office|weve had this|for (twenty|\d+|many) years|existing (office|setup|phones|dental)|bought an older|phones are just terrible|just fix (them|the phones)|moving across town|i bought|relocating)\b/.test(t) && !notSecond)
        add('mode', 'improving');
    else if (/\b(existing .{0,24}office|this office is already open|office i already have|same office continuing)\b/.test(t) && !notSecond)
        add('mode', 'improving');
    else if (/\b(starting|opening|new practice|first dental office|we are opening|open until|advertising the phone number|new office we are opening|mode is a new opening|building a new|new dental office|new eye (care )?office)\b/.test(t) && !/not a (brand )?new opening|already open|office i already have/.test(t))
        add('mode', 'opening');

    const expandingCity = /another office|second location|overflow|ninth office|already have|adding /.test(t) && !notSecond;
    const picked = pickCities(t);
    if (picked.primary) {
        const prior = String(facts.cityState?.value || '').toLowerCase();
        if (expandingCity && facts.cityState?.status === 'confirmed' && prior && !prior.startsWith(picked.primary.toLowerCase()))
            add('policy.notes', [picked.primary, ...picked.also].join('; '));
        else {
            add('cityState', picked.primary);
            if (picked.also.length)
                add('policy.notes', picked.also.join('; '));
        }
    }

    const rooms = t.match(/(\d+|one|two|three|four|five|six|seven|eight) (?:treatment |exam |dental )?(rooms?|chairs?|operatories|operatory)/);
    if (rooms) {
        const n = parseN(rooms[1]);
        if (n != null)
            add('policy.rooms', n);
    }

    const openDay = t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s*(\d{4}))?\b/);
    const openMonth = t.match(/actually (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || t.match(/(?:open(?:ing)?(?: until| in)?|aiming for|opening in) (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || t.match(/until (january|february|march|april|may|june|july|august|september|october|november|december)/)
        || (correcting ? t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/) : null);
    if (openDay && /open/.test(t)) {
        add('opening.date', openDay[1] + ' ' + openDay[2] + (openDay[3] ? ' ' + openDay[3] : ''));
        add('opening.precision', 'day');
    }
    else if (openMonth) {
        add('opening.date', openMonth[1]);
        add('opening.precision', 'month');
    }
    else if (/\bspring\b/.test(t) && /open/.test(t)) {
        add('opening.date', 'April');
        add('opening.precision', 'month');
    }

    if (/new (phone )?number|get a new number|need a new number/.test(t) && !/no new number|not getting a new number|not a new number|cannot lose|keep .{0,40}number/.test(t))
        add('opening.numbers', 'new');
    if (/cannot lose|keep .{0,40}number|keep it|port|no new number|not getting a new number|published number has to stay/.test(t) && /number|keep it/.test(t))
        add('opening.numbers', 'porting');
    if (/\bdentrix\b/.test(t))
        add('opening.pms', 'Dentrix');

    const named = text.match(/\b(?:called|named|call it)\s+([A-Z][A-Za-z0-9'& -]{1,40}?)(?=[.,]|$)/i);
    if (named)
        add('name', named[1].trim());

    extractStaff(t, facts, correcting, add, (id) => {
        if (updates.some(u => u.field_id === id))
            return;
        updates.push({ field_id: id, operation: 'skip', value: null, evidence, needs_confirmation: false });
    });
    extractRouting(t, facts, add);
    extractHours(t, add);
    extractDevices(t, add);

    if (/speak spanish|spanish-speaking|patients speak spanish|maria .{0,40}spanish/.test(t))
        add('languages.spanish', true);
    else if (/\benglish is enough|do not need spanish|english only\b/.test(t) && facts['languages.spanish']?.status !== 'confirmed')
        add('languages.decision', 'none');

    if (/no texts|no texting|phone messages only|no text follow-up|no text follow up/.test(t))
        add('followup', 'skip');
    if (/three[- ]year|36 month|thirty[- ]six month/.test(t))
        add('current.contract', 'three years');
    if (/\bmaria\b/.test(t))
        add('policy.notes', 'Maria');
    if (/work cell|work mobile/.test(t))
        add('policy.notes', 'work cell');

    if (/both (receptionists|phones).{0,30}ring|ring at the same time|whoever gets it|they pick up|not a menu/.test(t))
        add('policy.ring', 'together');
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
        if (/internet|goes out|failover|outage|die|to the work cell/.test(t))
            add('continuity.backupRouting', /forward/.test(t) ? 'forward' : 'cellular');
    }
    if (/ring my (personal )?(cell|phone)|my personal (cell|number)|do not (put|publish) my (cell|number|phone)/.test(t)) {
        add('devices.work_mobile', 'app');
        add('policy.notes', 'work mobile only; personal number not published');
    }

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
    const mentioned = CITIES.filter(name => name !== 'new york' && t.includes(name) && name !== skip).map(title);
    const unique = [...new Set(mentioned)];
    const adding = t.match(new RegExp('adding (?:a |an |one in )?((?:' + names + '))'));
    const thisIs = t.match(new RegExp('\\bthis is ((?:' + names + '))\\b'));
    const forgotten = t.match(new RegExp('\\bforget (?:the )?((?:' + names + '))\\b'));
    const planCity = t.match(new RegExp('this (?:plan|blueprint) is (?:the )?((?:' + names + '))'));
    const inCities = [...t.matchAll(new RegExp('\\bin ((?:' + names + ')(?:\\s+new york)?)\\b', 'g'))].map(m => title(m[1]));
    let primary = '';
    if (thisIs)
        primary = title(thisIs[1]);
    else if (planCity)
        primary = title(planCity[1]);
    else if (adding)
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
        return true;
    });
    return { primary, also };
}

function titleCity(city: string) {
    return city.replace(/\b\w/g, ch => ch.toUpperCase());
}

function extractStaff(t: string, facts: Record<string, Fact>, correcting: boolean, add: (id: string, value: Scalar) => void, skip: (id: string) => void) {
    if (/they also (handle|do) billing|front.{0,40}also.{0,24}billing|girls work the front.{0,80}billing/.test(t))
        add('billing.performed_by', 'reception');
    else if (/handles insurance|insurance support|billing lady|other lady handles/.test(t) && !/they also/.test(t))
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
        const front = t.match(/(\d+|one|two|three|four) (girls?|guys?|women|ladies|people) (?:work |at |on )?(?:the )?(front|desk)/)
            || t.match(/(\d+|one|two|three|four) (?:girls? )?(?:answer|answering) the phone/)
            || t.match(/(\d+|one|two|three|four) receptionists?/)
            || t.match(/(\d+|one|two|three|four) people at reception/);
        if (front) {
            const n = parseN(front[1]);
            if (n != null)
                add('teams.reception.count', n);
        }
    }

    if (/my wife works the front/.test(t) || /one main receptionist/.test(t))
        add('teams.reception.count', 1);
    if (/this other lady handles insurance/.test(t))
        add('teams.administration.count', 1);

    const clinicians = t.match(/so (\d+|one|two|three|four|five)(?: clinicians)?/) || t.match(/all (\d+|four) of us are clinical/) || t.match(/clinical count is (\d+|one|two|three|four)/) || t.match(/(\d+|one|two|three|four|five) clinicians/);
    const dentists = t.match(/(\d+|one|two|three|four|five|a) dentists?/);
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

function extractRouting(t: string, facts: Record<string, Fact>, add: (id: string, value: Scalar) => void) {
    const scope = specifiesUrgentScope(t);
    if (scope)
        add('urgent.scope', scope);

    if (/ai thing where patients call|ai receptionist at launch|puts them right on the schedule|receptionist answers only if the ai/.test(t) && !/when they'?re slammed|dont want a robot|ai .{0,50}later/.test(t))
        add('first.kind', 'assistant');
    else if (/regular calls go to reception|reception first|front desk (answers|first|handles)|the girls at the front|one main receptionist|the receptionist answers|receptionist answers|person picking up|none of that press one|staff should answer|i don'?t want a robot picking up every call|just answer the phone|ring immediately|she answers/.test(t)) {
        add('first.kind', 'human');
        add('first.team', 'reception');
    }
    if (/press one for appointments|press 1|press-1|short phone menu|press one.{0,20}press two/.test(t) && !/none of that press|hate (those|menus)|do not build (a )?press|not a menu/.test(t))
        add('first.kind', 'menu');
    if (/thanks for calling.{0,40}then the girls pick up|greeting followed by reception/.test(t))
        add('first.kind', 'human');
    if (/not a menu|hate (those|menus)|do not build (a )?press|girls to answer, not a menu|want the girls to answer/.test(t))
        add('first.kind', 'human');
    if (/directly(?! scheduled)|receptionist to answer directly/.test(t))
        add('first.kind', 'human');
    if (/i don'?t want the ai answering first|remove ai-first|not answering first anymore/.test(t))
        add('first.kind', 'human');
    if (/ai .{0,50}later|keep ai as something we might add|ai later when/.test(t))
        add('future.ai_receptionist', 'AI later');
    if (/live answering service/.test(t))
        add('after.kind', 'service');

    if (/take a message|leave (a message|their information)|leave a (message|voicemail)|voicemail is fine|just voicemail|then voicemail|\bvoicemail\b/.test(t) && !/never want a voicemail/.test(t)) {
        if (/then (take a )?voicemail/.test(t) && (/wait|minute|second/.test(t))) {
            add('busy.kind', 'queue');
            add('busy.exit', 'message');
        }
        if (/leave their information|before (the office |we )?open|advertising|before opening/.test(t))
            add('beforeOpening', 'message');
        const askingAfter = /what.?s best|do i need (ai|an answering)|dont know whether|which is better/.test(t) && /after hours/.test(t);
        if ((/after (hours|five|5|closing|we close)|when they call after|just voicemail/.test(t)) && !/live answering service/.test(t) && !askingAfter)
            add('after.kind', 'message');
        const openHoursUnanswered = /if she is already|if nobody|nobody answers|when she'?s busy|if she is busy|already on a call|with a patient|people hang up|just rings/.test(t);
        const afterHoursOnly = /after (hours|five|5|closing|we close)|when they call after/.test(t) && !openHoursUnanswered && !askingAfter;
        const beforeOpenTalk = /before (the office |we )?open|before opening|not open yet/.test(t) && !afterHoursOnly;
        if (openHoursUnanswered || (/take a message|take a voicemail/.test(t) && !afterHoursOnly && !askingAfter && !beforeOpenTalk))
            add('busy.kind', 'message');
    }
    if (/never want a voicemail|real person should always answer/.test(t) && /haven'?t figured/.test(t) === false)
        /* live-answer goal; do not invent after.kind */;
    if (/\bwait\b/.test(t) && /caller|next caller|them wait|let them wait|wait for somebody/.test(t))
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

    if (/leave it for the receptionist|receptionist checks|girls check|front desk checks|the girls (listen|check)/.test(t)) {
        add('busy.owner', 'reception');
        add('after.owner', 'reception');
        add('messages.owner', 'reception');
    }
    if (/i (check|listen to) (the )?(voicemail|messages)|i pick up the messages/.test(t) && !/receptionist|front desk|girls/.test(t)) {
        add('messages.owner', 'clinical');
        add('busy.owner', 'clinical');
        add('after.owner', 'clinical');
    }
    if (/before (the office |we )?open|before opening day|not open yet|while were building/.test(t) || /advertis/.test(t) && /number/.test(t)) {
        if (/recording|announcement|say we are not open/.test(t))
            add('beforeOpening', 'information');
        else if (/take a message|callback|leave (a message|their information)/.test(t))
            add('beforeOpening', 'message');
    }
    if (/internet is not in|internet is not ready|no internet yet/.test(t))
        add('opening.internet', 'unknown');
    if (/site survey|needs a survey|network .{0,20}survey/.test(t))
        add('opening.network', 'survey');
    if (/drywall|build-out|build out|wiring is not done|still building|construction site|we are not open|not open yet/.test(t))
        add('opening.construction', 'build-out');

    if (/i dont have somebody answering emergencies|we (do not|dont) have anyone on call|no nighttime on-call|nobody answering emergencies/.test(t) && !/have not figured|do not set up a doctor line/.test(t)) {
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
    if (/do not guess|not saying nine to five|not answering hours|do not mash the hours|do not merge those hours|hours are different|leave hours blank|do not use one schedule|do not invent one weekday/.test(t))
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
    if (/closed saturdays|close saturdays|we close saturdays/.test(t))
        add('hours.Saturday.open', false);
    if (/closed saturday and sunday|closed weekends/.test(t)) {
        add('hours.Saturday.open', false);
        add('hours.Sunday.open', false);
    }
    if (/closes at four instead of six|closes at 4/.test(t))
        add('hours.weekdays_end', '16:00');
    const lunchTimes = t.match(/(?:lunch|noon).{0,24}(\d+|twelve|noon|one|1)\s*(?:to|-|until)\s*(\d+|one|two|1|2)/)
        || t.match(/(\d+|twelve|noon)\s*(?:to|-|until)\s*(\d+|one|1).{0,12}lunch/);
    if (/cover(s|ed)? (the )?phones during lunch|stay open (at|during) lunch|someone stays .{0,20}(desk|phones) .{0,12}lunch|stagger(ed)? lunch|front desk covers .{0,20}lunch/.test(t))
        add('hours.lunch', 'covered');
    else if (/close(d|s)? (the )?(phones? )?(for|at) lunch|phones? (are |go )?closed (for |at )?lunch|closed for lunch|lunch (we |phones )?(close|voicemail)|no one .{0,12}lunch/.test(t)) {
        add('hours.lunch', 'closed');
        if (lunchTimes) {
            const start = lunchTimes[1] === 'noon' || lunchTimes[1] === 'twelve' || lunchTimes[1] === '12' ? '12:00' : lunchTimes[1] === '1' || lunchTimes[1] === 'one' ? '13:00' : null;
            const end = lunchTimes[2] === 'one' || lunchTimes[2] === '1' ? '13:00' : lunchTimes[2] === 'two' || lunchTimes[2] === '2' ? '14:00' : null;
            if (start)
                add('hours.weekdays_break_start', start);
            if (end)
                add('hours.weekdays_break_end', end);
        }
    }
}

function extractDevices(t: string, add: (id: string, value: Scalar) => void) {
    if (/one desk phone already, need another|need another/.test(t) && /desk phone/.test(t))
        add('devices.reception.desk_count', 2);
    if (/three phones that all ring|three independently/.test(t))
        add('devices.reception.desk_count', 3);
    if (/both (can )?pick up|can both pick up|pick up at once/.test(t) || (/two (separate )?(lines|extensions)|each (has|gets) (a |their )?(own )?(phone|line)|independently/.test(t) && /front|desk|girl|receptionist|phone|line/.test(t)))
        add('devices.reception.sharing', 'separate');
    if (/share (one |a )?(phone|line)|one (desk )?phone between|one line between|they share one/.test(t))
        add('devices.reception.sharing', 'shared');
}

function waitSeconds(t: string) {
    if (/\ba minute\b|one minute/.test(t))
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

export function mergeInterpreterUpdates(
    groqUpdates: InterpreterUpdate[],
    hinted: InterpreterUpdate[],
    text: string,
    facts: Record<string, Fact>
): InterpreterUpdate[] {
    const extra = [...hinted];
    const folded = fold(text);
    if (clinicianRouteAmbiguous(text, facts) && !extra.some(u => u.field_id === 'urgent.pending_route' || u.field_id === 'urgent.scope'))
        extra.push(make('urgent.pending_route', true, text.slice(0, 180)));
    const hintedIds = new Set(extra.map(u => u.field_id));
    const groq = groqUpdates.filter(u => {
        if (u.operation === 'skip' && !/\b(skip|not sure|dont know|do not know|not now|leave (that|it) blank)\b/.test(folded))
            return false;
        if (hintedIds.has(u.field_id) && HINT_WINS.has(u.field_id))
            return false;
        if (clinicianRouteAmbiguous(text, facts)) {
            if (u.field_id === 'urgent.kind' || u.field_id === 'first.kind' || u.field_id === 'first.team')
                return false;
        }
        if (u.field_id === 'teams.administration.count' && !extra.some(h => h.field_id === 'teams.administration.count')) {
            const mentionedAdmin = /office manager|administrat|pay the bills|manage the practice|run the (place|office|practice)|handles insurance/.test(folded);
            if (!mentionedAdmin)
                return false;
        }
        if (u.field_id === 'teams.administration.count' && extra.some(h => h.field_id === 'billing.performed_by' && h.value === 'reception')) {
            const n = Number(u.value);
            const hintedAdmin = extra.find(h => h.field_id === 'teams.administration.count');
            if (!hintedAdmin && n > 1)
                return false;
        }
        if (u.field_id === 'after.kind' && extra.some(h => h.field_id === 'beforeOpening'))
            return false;
        if ((u.field_id === 'messages.owner' || u.field_id === 'busy.owner' || u.field_id === 'after.owner') && !extra.some(h => h.field_id === u.field_id || h.field_id === 'messages.owner')) {
            if (!/check|listen|mailbox|voicemail box|girls check|i check/.test(folded))
                return false;
        }
        if (u.field_id === 'devices.reception.sharing' && !extra.some(h => h.field_id === 'devices.reception.sharing')) {
            if (!/share|pick up at once|separate (line|phone|extension)|one (desk )?phone|one line|both can pick/.test(folded))
                return false;
        }
        if (u.field_id === 'devices.work_mobile' && !extra.some(h => h.field_id === 'devices.work_mobile')) {
            if (!/work (cell|mobile|app)|ring my cell|personal (cell|number)|follow me/.test(folded))
                return false;
        }
        if (u.field_id === 'beforeOpening' && !extra.some(h => h.field_id === 'beforeOpening')) {
            if (!/before (we |the office )?open|not open yet|advertis/.test(folded))
                return false;
        }
        if (u.field_id === 'busy.kind' && /after (hours|five|5|closing|we close)/.test(folded) && !/if nobody|nobody answers|when she'?s busy|already on a call|\bbusy\b/.test(folded) && !extra.some(h => h.field_id === 'busy.kind'))
            return false;
        if ((u.field_id === 'after.kind' || u.field_id === 'first.kind' || u.field_id === 'busy.kind') && u.value === 'assistant') {
            const launchNow = /at launch|from day one|answers first|ai receptionist at launch/.test(folded);
            const asking = /what.?s best|do i need ai|dont know whether|later|when we (are |get )?bigger|not at launch|not now/.test(folded);
            if (asking && !launchNow)
                return false;
        }
        if (u.field_id.startsWith('hours.') && extra.some(h => h.field_id === u.field_id))
            return false;
        if (/^hours\.(preset|weekdays_start|weekdays_end)$/.test(u.field_id)) {
            const mentionedHours = /\b(hours|o'?clock|\d+\s*(am|pm)|nine to five|eight to five|8 to 5|9 to 5|weekday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|lunch)\b/.test(folded);
            if (!mentionedHours && !extra.some(h => /^hours\.(preset|weekdays_start|weekdays_end)$/.test(h.field_id)))
                return false;
        }
        if (u.field_id === 'teams.reception.count' && extra.some(h => h.field_id === 'teams.reception.count' && h.operation === 'skip'))
            return false;
        return true;
    });
    return [...groq, ...extra];
}
