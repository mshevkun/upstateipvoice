import { teamName, type Plan } from './config';
import { formatOpening, formatTime, lunchCallbackPhrase, openingLabel } from './flow';
import { buySummary, openingRoadmap, reviewOpenActions, workMobileNoted } from './advisor';
import { callerHear } from './architect/hear';
import { PRIVACY_COPY } from './privacy';
import { stillOpen as installOpen } from './readiness';

export type BriefStat = { value: string; label: string; note: string };
export type BriefRow = { label: string; value: string };
export type BriefMoment = { when: string; happen: string };
export type BriefScript = { when: string; hear: string };
export type BriefStep = { label: string; window: string; note: string };
export type BriefBlock =
    | { kind: 'prose'; text: string }
    | { kind: 'kicker'; text: string }
    | { kind: 'stats'; items: BriefStat[] }
    | { kind: 'hours'; items: BriefRow[] }
    | { kind: 'moments'; items: BriefMoment[] }
    | { kind: 'scripts'; items: BriefScript[] }
    | { kind: 'rows'; items: BriefRow[] }
    | { kind: 'steps'; items: BriefStep[] }
    | { kind: 'checks'; items: string[] }
    | { kind: 'list'; items: string[] }
    | { kind: 'note'; text: string }
    | { kind: 'table'; headers: string[]; rows: string[][]; widths: number[] };

export type BriefPage = {
    kicker: string;
    title: string;
    lede?: string;
    blocks: BriefBlock[];
};

function who(p: Plan, id: string) {
    return teamName(p, id) || 'the practice';
}

function people(n: number) {
    return n + (n === 1 ? ' person' : ' people');
}

function lunchDay(p: Plan) {
    return p.hours.days.find(d => d.breakStart && d.breakEnd);
}

function alwaysOn(p: Plan) {
    return p.hours.days.every(d => d.open && d.start === '00:00' && (d.end === '24:00' || d.end === '23:59'));
}

function receptionShare(p: Plan) {
    return p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing;
}

function placedCount(p: Plan, device: string, access?: string) {
    return (p.policy.placements || [])
        .filter(x => x.device === device && (access ? x.access === access : true))
        .reduce((n, x) => n + (x.count || 0), 0);
}

function receptionOutsideComputers(p: Plan) {
    const team = p.first.team || 'reception';
    return (p.policy.placements || [])
        .filter(x => x.team === team && x.device === 'computer' && x.access === 'outside')
        .reduce((n, x) => n + (x.count || 0), 0);
}

function deskToBuy(p: Plan) {
    const phys = placedCount(p, 'desk');
    if (phys > 0)
        return phys;
    if (receptionOutsideComputers(p) > 0)
        return 0;
    return buySummary(p).desk.qty;
}

function receptionKindOpen(p: Plan) {
    return p.first.kind === 'human'
        && !!(p.policy.placements || []).find(x => x.team === 'reception' && x.sharing !== 'undecided')
        && !(p.policy.placements || []).some(x => x.team === 'reception' && x.count > 0 && x.device !== 'undecided' && x.device !== 'none');
}

function onCallLabel(p: Plan) {
    return p.specialty === 'Dental' ? 'on-call dentist' : 'on-call clinician';
}

function urgentCue(p: Plan) {
    if (p.specialty === 'Dental')
        return 'swelling, trauma, or uncontrolled bleeding';
    if (p.specialty === 'Eye care')
        return 'a sudden change in vision or an eye injury';
    return 'a practice-approved urgent matter';
}

function urgentCueShort(p: Plan) {
    if (p.specialty === 'Dental')
        return 'swelling, trauma, bleeding';
    if (p.specialty === 'Eye care')
        return 'sudden vision change or eye injury';
    return 'a practice-approved urgent matter';
}

function answeringPlaces(p: Plan) {
    const places = p.policy.placements || [];
    const first = p.first.team || 'reception';
    const sum = (device: string, access?: string, team?: string) => places
        .filter(x => x.device === device && (access ? x.access === access : true) && (!team || x.team === team))
        .reduce((n, x) => n + (x.count || 0), 0);
    return {
        outsideComputer: sum('computer', 'outside', first),
        internalComputer: sum('computer', 'internal')
    };
}

function teamKit(p: Plan, teamId: string) {
    const xs = (p.policy.placements || []).filter(x => x.team === teamId);
    const bits: string[] = [];
    const n = (device: string, access?: string) => xs
        .filter(x => x.device === device && (access ? x.access === access : true))
        .reduce((sum, x) => sum + (x.count || 0), 0);
    const desk = n('desk');
    const mobile = n('mobile');
    const outside = n('computer', 'outside');
    const internal = n('computer', 'internal');
    if (desk)
        bits.push(desk + ' desk phone' + (desk === 1 ? '' : 's'));
    if (outside)
        bits.push(teamId === (p.first.team || 'reception')
            ? (outside === 1 ? 'answering computer' : outside + ' answering computers')
            : (outside === 1 ? 'office computer — not inbound' : outside + ' office computers — not inbound'));
    if (mobile)
        bits.push('work app — not a desk phone');
    if (internal)
        bits.push('internal computer — not the published number');
    return bits.join(' · ');
}

function staffRows(p: Plan): BriefRow[] {
    const buy = buySummary(p);
    const row = (role: Plan['teams'][number]['role'], fallback: string) => {
        const t = p.teams.find(x => x.role === role && x.status === 'known');
        if (!t)
            return { label: fallback, value: 'Not recorded' };
        if (role === 'administration' && !t.count)
            return { label: t.name || fallback, value: 'No separate administrator' };
        const kit = teamKit(p, t.id);
        const extra = !kit
            ? role === 'reception' && buy.desk.qty != null
                ? receptionShare(p) === 'shared'
                    ? (buy.desk.qty === 1 ? 'one shared line' : buy.desk.qty + ' phones sharing one line')
                    : buy.desk.qty + ' independent line' + (buy.desk.qty === 1 ? '' : 's')
                : role === 'clinical'
                    ? 'not a room-phone order'
                    : role === 'administration' && buy.mobile.qty
                        ? 'work app — not a desk phone'
                        : ''
            : kit;
        return { label: t.name || fallback, value: people(t.count) + (extra ? ' · ' + extra : '') };
    };
    return [
        row('reception', 'Front desk'),
        row('administration', 'Administration'),
        row('clinical', 'Clinical')
    ];
}

function dayKey(d: Plan['hours']['days'][number]) {
    if (!d.open)
        return 'closed';
    return [d.start, d.end, d.breakStart || '', d.breakEnd || ''].join('|');
}

export function hoursLines(p: Plan): BriefRow[] {
    const days = p.hours.days;
    if (!days.some(d => d.stated === true || !!(d.start && d.end)))
        return [{ label: 'Hours', value: 'Hours not given yet' }];
    const groups: { start: number; end: number; key: string }[] = [];
    days.forEach((d, i) => {
        const stated = d.stated === true || !!(d.start && d.end);
        if (!stated)
            return;
        const key = dayKey(d);
        const last = groups[groups.length - 1];
        if (last && last.key === key && last.end === i - 1)
            last.end = i;
        else
            groups.push({ start: i, end: i, key });
    });
    const short = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const unstated = days.map((d, i) => (d.stated === true || !!(d.start && d.end)) ? '' : short[i]).filter(Boolean);
    const rows = groups.map(g => {
        const d = days[g.start];
        const label = g.start === g.end ? short[g.start] : short[g.start] + '–' + short[g.end];
        if (!d.open)
            return { label, value: 'Closed' };
        if (d.start === '00:00' && (d.end === '24:00' || d.end === '23:59'))
            return { label, value: 'Open 24 hours' };
        let value = formatTime(d.start) + '–' + formatTime(d.end);
        if (d.breakStart && d.breakEnd)
            value += ' · lunch ' + formatTime(d.breakStart) + '–' + formatTime(d.breakEnd);
        return { label, value };
    });
    if (unstated.length)
        rows.push({ label: unstated.join(', '), value: 'Not given yet' });
    return rows;
}

function prettyDay(iso: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m)
        return iso;
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function holidayLine(p: Plan): BriefRow | null {
    const dates = p.hours.holidays.filter(Boolean).slice(0, 4).map(prettyDay);
    if (!dates.length)
        return null;
    const policy = p.hours.holidayPolicy === 'closed' ? 'Closed' : 'Follow posted hours';
    return { label: 'Holidays', value: policy + ' · ' + dates.join(' · ') };
}

function recCount(p: Plan) {
    return p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
}

export function ownerPromise(p: Plan) {
    const desk = deskToBuy(p);
    const share = receptionShare(p);
    const parts: string[] = [];
    if (p.first.kind === 'human')
        parts.push('Patients reach a person at the ' + (who(p, p.first.team) || 'front desk').toLowerCase() + ' — not a menu.');
    else if (p.first.kind === 'menu')
        parts.push('Callers hear a short menu, then the matching team.');
    else if (p.first.kind === 'assistant')
        parts.push('A virtual receptionist is proposed to answer first. That is not live until a vendor verifies it.');
    else
        parts.push('First answer is still open. The rest of this plan stays a draft until that choice is made.');
    const recN = recCount(p);
    if (share === 'shared' && recN > 1)
        parts.push(recN + ' people at the front share one line. A second caller does not get a second person.');
    else if (desk && recN && recN === desk && recN > 1)
        parts.push(desk + ' front-desk phones because ' + recN + ' people at the front can both pick up.');
    else if (desk && desk > 1)
        parts.push(desk + ' front-desk lines can take callers at the same time.');
    else if (desk === 1)
        parts.push('One front-desk line answers the published number.');
    else if (desk === 0 && receptionOutsideComputers(p) > 0)
        parts.push('No desk phone. The answering computer picks up the published number.');
    if (buySummary(p).rooms)
        parts.push('The ' + buySummary(p).rooms + ' treatment room' + (buySummary(p).rooms === 1 ? ' is a chair' : 's are chairs') + ' — not phones.');
    if (alwaysOn(p))
        parts.push('Phones are posted 24 hours. Overnight is still open hours — not an after-hours recording.');
    else if (p.after.kind === 'message' && onCallAfterHours(p))
        parts.push('After hours, ordinary callers leave a message. ' + who(p, p.after.owner) + ' calls back the next business day. Urgent (' + urgentCueShort(p) + ') gets one extra choice to try the ' + onCallLabel(p) + '.');
    else if (p.after.kind === 'message')
        parts.push('After hours, callers leave a message. ' + who(p, p.after.owner) + ' calls back the next business day.');
    else if (p.after.kind === 'service')
        parts.push('After hours, a live answering service is proposed. Confirm the contract before go-live.');
    else if (p.after.kind === 'information')
        parts.push('After hours, an announcement plays and the call ends. No message is taken unless you add one.');
    else if (p.after.kind === 'assistant')
        parts.push('After hours, a virtual receptionist is proposed. Not live until a vendor proves it.');
    if (p.mode === 'opening' && p.policy.beforeOpening === 'message')
        parts.push('Before opening day, early callers leave a callback. Do not publish the number until that recording exists.');
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'information')
        parts.push('Before opening day, a not-open-yet recording plays. Do not publish the number until it exists.');
    return parts.join(' ');
}

function deskStat(p: Plan): BriefStat {
    const buy = buySummary(p);
    const desk = deskToBuy(p);
    const recN = recCount(p);
    const share = receptionShare(p);
    const recComputers = receptionOutsideComputers(p);
    if (receptionKindOpen(p) && desk && desk > 0)
        return {
            value: String(desk),
            label: desk === 1 ? 'Front-desk line' : 'Front-desk lines',
            note: recN && recN === desk
                ? recN + (recN === 1 ? ' person at the front · model not chosen' : ' people at the front · model not chosen')
                : 'model not chosen'
        };
    if ((!desk || desk === 0) && recComputers > 0)
        return {
            value: String(recComputers),
            label: recComputers === 1 ? 'Answering computer' : 'Answering computers',
            note: 'Headset — not a desk phone'
        };
    const deskNote = share === 'shared' && recN > 1
        ? recN + ' people · one shared line'
        : recN && desk === recN
            ? recN + (recN === 1 ? ' person at the front' : ' people at the front')
            : recN && desk && recN > desk
                ? recN + ' people · ' + desk + ' line' + (desk === 1 ? '' : 's')
                : buy.desk.note;
    return { value: desk == null ? '—' : String(desk), label: desk === 1 ? 'Desk phone' : 'Desk phones', note: deskNote };
}

/** Cover numbers: desk phones and rooms. Rooms are never a phone order. */
export function ownerStats(p: Plan): BriefStat[] {
    const buy = buySummary(p);
    const desk = deskStat(p);
    if (buy.rooms)
        return [
            desk,
            { value: String(buy.rooms), label: buy.rooms === 1 ? 'Treatment room' : 'Treatment rooms', note: 'Chairs — not phones' }
        ];
    return [desk];
}

function orderStats(p: Plan): BriefStat[] {
    const buy = buySummary(p);
    const admin = p.teams.find(t => t.role === 'administration' && t.status === 'known' && t.count > 0);
    const items: BriefStat[] = [deskStat(p)];
    if (buy.mobile.qty)
        items.push({
            value: String(buy.mobile.qty),
            label: buy.mobile.qty === 1 ? 'Work mobile' : 'Work mobiles',
            note: admin ? 'Office manager overflow' : buy.mobile.note
        });
    return items;
}

function phoneCount(p: Plan) {
    const desk = deskToBuy(p);
    const mobile = buySummary(p).mobile.qty || 0;
    if (desk == null)
        return null;
    return (desk || 0) + mobile;
}

function orderTotal(p: Plan) {
    const buy = buySummary(p);
    const n = phoneCount(p);
    const computers = receptionOutsideComputers(p);
    if (n == null)
        return buy.roomsNote || 'Phone count is still open. Rooms and staff are not the answer.';
    const desk = deskToBuy(p) || 0;
    const mobile = buy.mobile.qty || 0;
    if (desk === 0 && mobile === 0 && computers)
        return 'No desk phones to order. ' + (computers === 1 ? 'One answering computer.' : computers + ' answering computers.');
    let line = 'Phones to order: ' + n + '  (' + desk + ' desk';
    if (mobile)
        line += ' + ' + mobile + ' work mobile';
    line += ').';
    return line;
}

function orderTitle(p: Plan) {
    const n = phoneCount(p);
    if (n == null)
        return 'What to order.';
    if (n === 0 && receptionOutsideComputers(p))
        return 'No desk phones to order.';
    return n === 1 ? '1 phone to order.' : n + ' phones to order.';
}

function orderLede(p: Plan) {
    const buy = buySummary(p);
    const n = phoneCount(p);
    if (n == null)
        return orderTotal(p);
    const desk = deskToBuy(p) || 0;
    const mobile = buy.mobile.qty || 0;
    const places = answeringPlaces(p);
    const share = receptionShare(p);
    if (desk === 0 && mobile === 0 && places.outsideComputer)
        return (places.outsideComputer === 1 ? 'One answering computer' : places.outsideComputer + ' answering computers')
            + '. No desk phones.'
            + (buy.rooms ? ' Not a phone per room.' : '');
    let line = desk + ' desk' + (mobile ? ' + ' + mobile + ' work mobile' : '') + '.';
    if (share === 'shared' && recCount(p) > 1)
        line += ' They share one line.';
    if (places.outsideComputer)
        line += places.outsideComputer === 1 ? ' One headset computer.' : ' ' + places.outsideComputer + ' headset computers.';
    if (buy.rooms)
        line += ' Not a phone per room.';
    return line;
}

function coverGlance(p: Plan): BriefMoment[] {
    const desk = deskToBuy(p);
    const share = receptionShare(p);
    const items: BriefMoment[] = [];
    if (p.first.kind === 'human') {
        const recComputers = receptionOutsideComputers(p);
        const lines = recComputers && !desk
            ? ' on the answering computer'
            : share === 'shared' && recCount(p) > 1
                ? ' · one shared line'
                : desk && desk > 1 && share !== 'shared'
                    ? ' · ' + desk + ' independent lines'
                    : '';
        const order = p.policy.ring === 'order' && p.policy.ringOrder?.length
            ? ' Rings ' + who(p, p.policy.ringOrder[0].team) + ' first, not both at once.'
            : '';
        items.push({
            when: 'Open hours',
            happen: who(p, p.first.team) + ' answers' + lines + '. No menu.' + order
        });
    }
    else if (p.first.kind === 'menu')
        items.push({ when: 'Open hours', happen: 'A short keypad menu, then the matching team.' });
    else if (p.first.kind === 'assistant')
        items.push({ when: 'Open hours', happen: 'A virtual receptionist is proposed — not live until a vendor proves it.' });
    else
        items.push({ when: 'Open hours', happen: 'Who answers first is still open.' });
    const lunch = lunchDay(p);
    if (lunch)
        items.push({
            when: 'Lunch',
            happen: formatTime(lunch.breakStart) + '–' + formatTime(lunch.breakEnd) + ' · front desk closed · lunch recording, we will call you back'
                + (/lunch callback this afternoon/i.test(p.policy.notes || '') ? ' this afternoon' : '')
                + '. Not overnight.'
                + (onCallAfterHours(p) ? ' Not ' + onCallLabel(p) + '.' : '')
        });
    if (alwaysOn(p))
        items.push({
            when: 'Overnight',
            happen: 'Phones are posted 24 hours. Overnight still rings the same people — not an after-hours recording.'
        });
    else if (p.after.kind === 'message')
        items.push({
            when: 'After hours',
            happen: onCallAfterHours(p)
                ? 'Next-business-day message. Urgent (' + urgentCueShort(p) + ') can try on-call. Life-threatening: hang up and dial 911.'
                : 'Message. ' + who(p, p.after.owner) + ' calls back the next business day. Life-threatening: hang up and dial 911.'
        });
    else if (p.after.kind === 'service')
        items.push({ when: 'After hours', happen: 'Live answering service — confirm the contract before go-live.' });
    else if (p.after.kind === 'information')
        items.push({ when: 'After hours', happen: 'Announcement, then the call ends. No message unless you add one.' });
    else if (p.after.kind === 'assistant')
        items.push({ when: 'After hours', happen: 'A virtual receptionist is proposed after hours — not live until a vendor proves it.' });
    if (p.mode === 'opening') {
        if (p.policy.beforeOpening === 'message')
            items.push({ when: 'Before opening', happen: 'Callback recording. Do not publish the number until it exists.' });
        else if (p.policy.beforeOpening === 'information')
            items.push({ when: 'Before opening', happen: 'Not-open-yet recording. Do not publish the number until it exists.' });
        else
            items.push({ when: 'Before opening', happen: 'No approved destination yet. Do not publish the number.' });
    }
    return items.slice(0, 5);
}

function onCallAfterHours(p: Plan) {
    return p.urgent.enabled && p.policy.urgentKind === 'connect'
        && (p.policy.urgentCoverage === 'closed' || p.policy.urgentCoverage === 'always');
}

function afterHoursLine(p: Plan) {
    if (alwaysOn(p))
        return 'Phones are posted 24 hours. Overnight still rings the same people — not an after-hours recording.';
    const next = 'Ordinary messages: ' + who(p, p.after.owner) + ' calls back the next business day.';
    if (onCallAfterHours(p))
        return next + ' Urgent (' + urgentCueShort(p) + '): the recording offers one extra choice to try the ' + onCallLabel(p) + '. Life-threatening: hang up and dial 911.';
    return 'Message. ' + who(p, p.after.owner) + ' calls back the next business day. Life-threatening: hang up and dial 911.';
}

function missedLine(p: Plan) {
    const owner = who(p, p.busy.owner);
    const desk = deskToBuy(p) || 0;
    const share = receptionShare(p);
    let mobile = '';
    if (workMobileNoted(p)) {
        if (share === 'shared')
            mobile = ' If that line is busy, the work app can also ring. Never a personal cell.';
        else if (desk > 1)
            mobile = ' If both desk phones are busy, the work app can also ring. Never a personal cell.';
        else if (desk === 1)
            mobile = ' If the desk cannot pick up, the work app can also ring. Never a personal cell.';
        else
            mobile = ' If the answering computer cannot pick up, the work app can also ring. Never a personal cell.';
    }
    if (p.busy.kind === 'message')
        return 'If nobody picks up after ' + p.busy.seconds + ' seconds, they leave a message. ' + owner + ' owns that inbox.' + mobile;
    if (p.busy.kind === 'queue')
        return 'If nobody picks up after ' + p.busy.seconds + ' seconds, they wait up to ' + p.busy.wait + ' more seconds, then leave a message for ' + owner + '.' + mobile;
    if (p.busy.kind === 'backup')
        return 'If nobody picks up after ' + p.busy.seconds + ' seconds, '
            + (who(p, p.busy.backup) || 'a backup team')
            + (workMobileNoted(p) ? "'s work mobile rings" : ' rings')
            + ', then a message for ' + owner + '. Never a personal cell.';
    if (p.busy.kind === 'assistant')
        return 'If nobody picks up, a virtual receptionist is proposed to help. That stays unverified until a vendor proves it.';
    return 'What happens if nobody answers is still open.';
}

function ringOrderLine(p: Plan) {
    if (p.policy.ring !== 'order' || !p.policy.ringOrder?.length)
        return '';
    const hops = p.policy.ringOrder.slice(0, 3).map(h => who(p, h.team));
    if (hops.length < 2)
        return 'Rings ' + hops[0] + ' first. ';
    return 'Rings ' + hops[0] + ' first, then ' + hops.slice(1).join(', then ') + ' if nobody picks up. ';
}

function callMoments(p: Plan): BriefMoment[] {
    const items: BriefMoment[] = [];
    const desk = deskToBuy(p);
    const computers = receptionOutsideComputers(p);
    if (p.first.kind === 'human')
        items.push({
            when: 'During phone hours',
            happen: 'The published number rings ' + who(p, p.first.team) + '. '
                + (computers && !desk ? 'The answering computer picks up. There is no keypad. ' : 'A person answers. There is no keypad. ')
                + ringOrderLine(p)
                + missedLine(p).replace(/^\s+/, '')
        });
    else if (p.first.kind === 'menu')
        items.push({
            when: 'During phone hours',
            happen: 'A short keypad menu asks why they are calling, then rings that team. ' + missedLine(p)
        });
    else if (p.first.kind === 'assistant')
        items.push({
            when: 'During phone hours',
            happen: 'A virtual receptionist is proposed to answer first. Until a vendor verifies it, treat this as a draft — not a live system.'
        });
    else
        items.push({
            when: 'During phone hours',
            happen: 'Who answers first is still open. Do not order hardware against a missing first-answer choice.'
        });
    const lunch = lunchDay(p);
    if (lunch)
        items.push({
            when: 'Lunch · ' + formatTime(lunch.breakStart) + '–' + formatTime(lunch.breakEnd),
            happen: 'The front desk is closed on purpose. Callers hear a lunch recording and can leave a message. ' + who(p, p.busy.owner || p.after.owner) + ' ' + lunchCallbackPhrase(p, 'brief') + ' — not the next business day'
                + (onCallAfterHours(p) ? ', and not the ' + onCallLabel(p) + '.' : '.')
        });
    if (alwaysOn(p))
        items.push({
            when: 'Overnight',
            happen: afterHoursLine(p)
        });
    else if (p.after.kind === 'message')
        items.push({
            when: 'After hours',
            happen: afterHoursLine(p)
        });
    else if (p.after.kind === 'service')
        items.push({
            when: 'After hours',
            happen: 'A live answering service is proposed. They may take a message. They are not automatically allowed to book or give clinical advice until the contract says so.'
        });
    else if (p.after.kind === 'information')
        items.push({
            when: 'After hours',
            happen: 'An announcement plays, then the call ends. No message is taken unless you add one.'
        });
    else if (p.after.kind === 'assistant')
        items.push({
            when: 'After hours',
            happen: 'A virtual receptionist is proposed after hours. Not live until a vendor proves it.'
        });
    else if (p.after.kind !== 'undecided')
        items.push({ when: 'After hours', happen: 'Closed-hours handling is recorded as a proposal until verified.' });
    if (p.mode === 'opening') {
        if (p.policy.beforeOpening === 'message')
            items.push({
                when: 'Before opening day',
                happen: 'Early callers leave a callback for ' + who(p, p.policy.beforeOpeningOwner || p.after.owner || p.busy.owner) + '. Do not publish the number until that recording exists.'
            });
        else if (p.policy.beforeOpening === 'information')
            items.push({
                when: 'Before opening day',
                happen: 'A not-open-yet recording plays, then the call ends. Do not publish the number until that recording exists.'
            });
        else
            items.push({
                when: 'Before opening day',
                happen: 'There is no approved destination for someone who finds the number early. Decide this before the number is public.'
            });
    }
    return items.slice(0, 4);
}

function scripts(p: Plan): BriefScript[] {
    return callerHear(p).filter(row => row.kind !== 'note').map(row => ({ when: row.when, hear: row.hear }));
}

function coverage(p: Plan): BriefRow[] {
    const rows: BriefRow[] = [];
    if (p.first.kind === 'human') {
        const desk = who(p, p.first.team);
        for (const r of p.reasons) {
            const dest = r.team && r.team !== '@main' ? who(p, r.team) : desk;
            if (!dest)
                rows.push({ label: r.label, value: 'Still choose whether this stays at the front desk' });
            else if (r.team === p.first.team || r.team === '@main' || r.team === '')
                rows.push({ label: r.label, value: desk + ' keeps this after they pick up' });
            else
                rows.push({ label: r.label, value: desk + ' answers, then ' + dest + ' owns it' });
        }
    }
    else if (p.first.kind === 'menu') {
        for (const r of p.reasons)
            rows.push({ label: r.label, value: r.team ? 'Menu route → ' + who(p, r.team) : 'Menu destination still open' });
    }
    const spanish = p.languages.find(l => l.name === 'Spanish');
    if (spanish) {
        const hours = spanish.availability === 'open'
            ? 'After hours stay English.'
            : spanish.availability === 'always'
                ? 'Intended at all hours — confirm the after-hours identification actually exists.'
                : 'Limited hours. Confirm the schedule before go-live.';
        const how = spanish.mechanism === 'menu'
            ? 'Callers press a language choice on the keypad during open hours. '
            : spanish.mechanism === 'assistant'
                ? 'The proposed virtual receptionist would handle Spanish. '
                : spanish.note
                    ? spanish.note.replace(/\.$/, '') + '. '
                    : 'A person at the practice during open hours. ';
        rows.push({ label: 'Spanish', value: (how + hours).replace(/\.\s+\./g, '.') });
    }
    else if (p.policy.languageDecision === 'none')
        rows.push({ label: 'Language', value: 'English only. No extra language option is in this plan.' });
    if (/Associate starts April/i.test(p.policy.notes || ''))
        rows.push({
            label: 'On-call until April',
            value: /chen/i.test(p.name) ? 'On-call is Dr. Chen alone until the associate starts.' : 'On-call is the owner alone until the associate starts.'
        });
    return rows.slice(0, 6);
}

function orderPoints(p: Plan) {
    const buy = buySummary(p);
    const desk = deskToBuy(p);
    const bits: string[] = [];
    if (desk == null)
        bits.push('Front-desk phone count is still open. Do not let a vendor fill it from rooms or staff.');
    if (buy.mobile.qty) {
        const admin = p.teams.find(t => t.role === 'administration' && t.status === 'known' && t.count > 0);
        bits.push((buy.mobile.qty === 1 ? 'One work mobile' : buy.mobile.qty + ' work mobiles')
            + (admin ? ' for ' + (admin.name === 'Administration' ? 'the office manager' : admin.name) : '')
            + ' when the front is slammed. Work app only — never a personal cell. That is not a third desk phone.');
    }
    const outside = (p.policy.placements || []).filter(x => x.device === 'computer' && x.access === 'outside' && x.count > 0);
    if (outside.length)
        bits.push(outside.map(x => {
            const n = x.count;
            const where = x.label || who(p, x.team) || 'the practice';
            const place = (n === 1 ? ' computer at the ' : ' computers at the ') + where.replace(/^the /i, '');
            return x.team === (p.first.team || 'reception')
                ? n + place + ' can answer the published number. Confirm headset and network there.'
                : n + place + ' is not inbound on the published number.';
        }).join('. '));
    else if (buy.computer.qty)
        bits.push(buy.computer.qty + (buy.computer.qty === 1 ? ' computer position' : ' computer positions') + ' can answer. Confirm headset and network there.');
    const places = answeringPlaces(p);
    if (places.internalComputer)
        bits.push(places.internalComputer === 1 ? 'one clinical computer (internal)' : places.internalComputer + ' clinical computers (internal)');
    return bits;
}

function stillOpen(p: Plan) {
    const q = p.policy;
    const buy = buySummary(p);
    const items: string[] = [];
    if (p.first.kind === 'undecided')
        items.push('Decide who answers first — a person, a short menu, or a proposed virtual receptionist.');
    if (!buy.deskKnown && deskToBuy(p) !== 0)
        items.push('Decide how many front-desk phones. Staff count and room count are not the answer.');
    if (p.after.kind === 'undecided')
        items.push('Decide what a caller hears after hours.');
    if (p.mode === 'opening' && q.beforeOpening === 'undecided')
        items.push('Decide what a caller hears before opening day. Do not publish the number until then.');
    if (p.urgent.enabled && q.urgentKind === 'connect') {
        if (q.urgentRoster === 'undecided')
            items.push('Name who is on-call. Do not print a personal cell on a wall card or in a recording.');
        else if (q.urgentRoster === 'rotation')
            items.push('Keep a written on-call rotation. The published greeting never includes a personal cell.');
        if (onCallAfterHours(p) && !alwaysOn(p))
            items.push('Approve the after-hours urgent choice (' + urgentCueShort(p) + ').'
                + (lunchDay(p) ? ' Lunch must not play that recording.' : ''));
        else if (!q.acceptance)
            items.push('Test that the ' + onCallLabel(p) + ' actually answers a transfer. A voicemail is not a handoff.');
    }
    if (q.followup === 'yes' && (q.opening.pms || q.system))
        items.push('Ask whether ' + (q.opening.pms || q.system) + ' should connect to the phones. This plan does not install it.');
    if (p.after.kind === 'service')
        items.push('Confirm what the answering service is allowed to do. Taking a message is not the same as booking.');
    if ([p.first.kind, p.busy.kind, p.after.kind].includes('assistant'))
        items.push('A virtual receptionist is proposed, not live. Do not advertise it until a vendor proves it.');
    if (!items.length)
        return reviewOpenActions(p).items.map(a => a.label).slice(0, 3);
    return items.slice(0, 4);
}

function doNotOrder(p: Plan) {
    const buy = buySummary(p);
    const bits: string[] = [];
    if (buy.rooms)
        bits.push('Do not order a phone per treatment room.');
    if (p.first.kind === 'human' && receptionOutsideComputers(p) && !deskToBuy(p))
        bits.push('Do not let a quote invent a keypad menu. The answering computer picks up first.');
    else if (p.first.kind === 'human')
        bits.push('Do not let a quote invent a keypad menu. Callers reach a person first.');
    if (p.first.kind === 'menu')
        bits.push('Do not let a quote skip the keypad and ring the front desk first. Callers press a menu.');
    if (p.first.kind === 'assistant')
        bits.push('Do not advertise a live virtual receptionist. It is proposed until a vendor proves it.');
    if (workMobileNoted(p))
        bits.push('Do not print a personal cell in a greeting or on a wall card.');
    if (/fax/i.test((p.current.notes || '') + ' ' + (p.policy.notes || '') + ' ' + (p.current.lines || '')))
        bits.push('Do not mix the insurance fax with the published patient number.');
    return bits;
}

function boundaries(p: Plan): BriefRow[] {
    const rows: BriefRow[] = [
        { label: 'True emergency', value: 'Hang up and dial 911. This published number is never dispatch.' }
    ];
    if (workMobileNoted(p))
        rows.push({ label: 'Personal cell', value: 'Never in a recording, never on a wall card. Work app only.' });
    if (/fax/i.test((p.current.notes || '') + ' ' + (p.policy.notes || '') + ' ' + (p.current.lines || '')))
        rows.push({ label: 'Insurance fax', value: 'Stays off the published patient number.' });
    return rows.slice(0, 4);
}

function darkOffice(p: Plan): BriefRow[] {
    const c = p.policy.continuity;
    const rows: BriefRow[] = [];
    if (c.internet === 'survey')
        rows.push({ label: 'Internet', value: 'Site survey still needed. Do not assume the build-out is ready.' });
    else if (c.internet === 'failover')
        rows.push({ label: 'Internet', value: 'Failover is recorded as a requirement — not as something already installed.' });
    else if (c.internet === 'none')
        rows.push({ label: 'Internet', value: 'No internet failover is in this plan.' });
    if (c.power === 'ups')
        rows.push({ label: 'Power', value: 'UPS on the phones and network. Confirm it on site.' });
    else if (c.power === 'survey')
        rows.push({ label: 'Power', value: 'Power backup still needs a site look.' });
    else if (c.power === 'none')
        rows.push({ label: 'Power', value: 'No UPS is in this plan.' });
    if (c.backupRouting === 'cellular')
        rows.push({ label: 'If internet fails', value: 'Cellular backup — never a personal cell.' });
    else if (c.backupRouting === 'forward')
        rows.push({ label: 'If internet fails', value: 'Forwarding is proposed. Never to a personal cell.' });
    else if (c.backupRouting === 'none')
        rows.push({ label: 'If internet fails', value: 'No backup route is in this plan.' });
    if (/snow/i.test(c.notes || ''))
        rows.push({ label: 'Snow days', value: 'Follow the after-hours recording. Never forward the published number to a personal phone.' });
    return rows;
}

function fileMeaning(): BriefRow[] {
    return [
        { label: 'This document', value: 'How patients reach this practice. Draft until the live tests below pass.' },
        { label: 'Matching spec', value: 'Hand the implementation spec with the same ID · revision · checksum in the footer.' },
        { label: 'Not a quote', value: 'Page 03 is quantities. Prices stay with the vendor.' },
        { label: 'Not installed', value: 'Nothing here is live until phones are on the wall and those tests pass.' }
    ];
}

function openingSteps(p: Plan): BriefStep[] {
    if (p.mode !== 'opening')
        return [];
    const buy = buySummary(p);
    return openingRoadmap(p).slice(0, 6).map(m => {
        if (m.id === 'req' && buy.deskKnown)
            return { label: 'Freeze how patients reach you', window: 'Can start today', note: 'Front-desk answering is recorded. Device models are still a vendor choice.' };
        if (m.id === 'before' && p.policy.beforeOpening !== 'undecided')
            return { label: 'Keep the before-opening recording on until opening morning', window: m.window, note: 'Then switch the published number to live hours. Do not publish the number before that recording exists.' };
        if (m.id === 'survey')
            return { label: 'Walk the space for internet and cabling', window: m.window, note: 'Cabling and network drops belong on the contractor brief — not on staff count.' };
        if (m.id === 'numbers' && p.policy.opening.numbers === 'new')
            return { label: 'Get a new published number', window: 'After the before-opening recording exists', note: 'This is not a port. Keep any old office number out of patient marketing until you switch.' };
        if (m.id === 'recordings')
            return {
                label: 'Approve the recordings',
                window: m.window,
                note: (lunchDay(p) ? 'Lunch (callback, not overnight). ' : '')
                    + (!alwaysOn(p) && p.after.kind === 'message'
                        ? 'After hours' + (onCallAfterHours(p) ? ' (ordinary message plus the urgent choice). ' : '. ')
                        : p.after.kind === 'information'
                            ? 'After-hours announcement. '
                            : p.after.kind === 'service'
                                ? 'Answering-service greeting. '
                                : '')
                    + (p.policy.beforeOpening === 'information'
                        ? 'Before-opening announcement. '
                        : p.policy.beforeOpening === 'message'
                            ? 'Before-opening callback. '
                            : '')
                    + 'Nothing is live until those files are uploaded.'
            };
        if (m.id === 'buy' && (buy.deskKnown || receptionOutsideComputers(p) > 0)) {
            const places = answeringPlaces(p);
            const desk = deskToBuy(p) || 0;
            return {
                label: 'Order the recorded quantities',
                window: m.window,
                note: (desk === 0 && places.outsideComputer
                    ? places.outsideComputer + ' answering computer' + (places.outsideComputer === 1 ? '' : 's')
                    : desk + ' desk phone' + (desk === 1 ? '' : 's')
                        + (buy.mobile.qty ? ', ' + buy.mobile.qty + ' work mobile' : '')
                        + (places.outsideComputer ? ', ' + places.outsideComputer + ' answering computer' : ''))
                    + '. Not a phone per room.'
            };
        }
        if (m.id === 'e911')
            return { label: 'Confirm the emergency-calling address', window: m.window, note: 'Ask the installer to verify it on the installed system. Checking a box here is not a carrier filing.' };
        if (m.id === 'test')
            return { label: 'Live tests on installed phones', window: m.window, note: 'Page 06 is the checklist. Simulated tests in this planner are not those tests.' };
        return { label: m.label, window: m.window, note: m.note };
    });
}

function useChecks(p: Plan) {
    const desk = deskToBuy(p) || 0;
    const share = receptionShare(p);
    const computers = receptionOutsideComputers(p);
    const items: string[] = [];
    if (p.first.kind === 'menu')
        items.push('Call the published number. Hear the keypad menu. Press a choice and confirm the right team rings. Do not invent extra options.');
    else if (p.first.kind === 'assistant')
        items.push('A virtual receptionist is proposed, not live. Do not advertise the published number as AI-answered until a vendor proves it.');
    else if (computers && !desk)
        items.push('Call the published number during hours. The answering computer should pick up. There is no keypad.');
    else if (p.policy.ring === 'order' && p.policy.ringOrder?.length)
        items.push('Call the published number. It should ring ' + who(p, p.policy.ringOrder[0].team) + ' first'
            + (p.policy.ringOrder[1] ? ', then ' + who(p, p.policy.ringOrder[1].team) + ' if nobody picks up.' : '.'));
    else if (share === 'shared' && recCount(p) > 1)
        items.push('Call the published number twice at the same time. The second caller should not get a second person — they wait or leave a message.');
    else if (desk > 1 && share !== 'shared')
        items.push('Call the published number twice at the same time. Both front-desk phones should ring.');
    else
        items.push('Call the published number during hours. A person at the front desk should answer.');
    if (p.busy.kind === 'message')
        items.push('Let it ring with nobody answering. Confirm the message, and that ' + who(p, p.busy.owner) + ' opens that inbox.');
    else if (p.busy.kind === 'queue')
        items.push('Let it ring with nobody answering. They should wait, then leave a message for ' + who(p, p.busy.owner) + '.');
    const lunch = lunchDay(p);
    if (lunch)
        items.push('Call during lunch. Hear the lunch recording — we will call you back'
            + (/lunch callback this afternoon/i.test(p.policy.notes || '') ? ' this afternoon' : '')
            + ' — not overnight voicemail'
            + (onCallAfterHours(p) ? ', and not the ' + onCallLabel(p) + '.' : '.'));
    if (alwaysOn(p))
        items.push('Phones are posted 24 hours. Call overnight. Confirm it still rings the same people — not an after-hours recording.');
    else if (p.after.kind === 'message')
        items.push('Call after hours. Hear the after-hours recording. Confirm ' + who(p, p.after.owner) + ' returns ordinary messages the next business day.');
    else if (p.after.kind === 'information')
        items.push('Call after hours. Hear the announcement, then the call should end.');
    else if (p.after.kind === 'service')
        items.push('Call after hours. Confirm the answering service picks up, and that they only do what the contract allows.');
    else if (p.after.kind === 'assistant')
        items.push('Call after hours. A virtual receptionist is proposed here — not live until a vendor proves it.');
    if (onCallAfterHours(p) && !alwaysOn(p))
        items.push('After hours, use the urgent choice. A person must pick up — voicemail is not a handoff. Do not put a personal cell in that recording.');
    else if (p.urgent.enabled && p.policy.urgentKind === 'connect')
        items.push('From an answered call, try the ' + onCallLabel(p) + '. A person must pick up — voicemail is not a handoff.');
    if (p.mode === 'opening' && p.policy.beforeOpening !== 'undecided')
        items.push(p.policy.beforeOpening === 'information'
            ? 'Call before opening day. Hear the not-open-yet announcement, then the call should end. Keep the number unpublished until this is true.'
            : 'Call before opening day. Hear the callback recording. Keep the number unpublished until this is true.');
    if (p.mode === 'opening')
        items.push('Ask the installer to confirm the emergency-calling address for this location. Checking a box here is not that filing.');
    if (p.after.kind === 'service' || p.after.kind === 'assistant' || p.first.kind === 'assistant' || p.busy.kind === 'assistant' || p.policy.followup === 'yes')
        items.push('If a vendor will hear or store patient information, ask whether a BAA is required. This file is not legal advice.');
    return items.slice(0, 8);
}

/** Groq writes facts into the Plan. This writer is the only owner-language layer. */
export function ownerBrief(p: Plan): BriefPage[] {
    const opening = formatOpening(p);
    const label = openingLabel(p).split(' · ')[0];
    const city = p.policy.cityState;
    const coverNumbers = ownerStats(p);
    const orderNumbers = orderStats(p);
    const hours = hoursLines(p);
    const holiday = holidayLine(p);
    const tz = p.hours.timezone === 'America/New_York' ? 'Eastern Time' : (p.hours.timezone && p.hours.timezone !== 'UTC' ? p.hours.timezone.replace(/_/g, ' ') : '');
    const coverLede = [label, city, opening ? 'Opens ' + opening : ''].filter(Boolean).join(' · ');
    const coverHours = holiday ? [...hours, holiday] : hours;
    const page5 = p.mode === 'opening'
        ? {
            kicker: '05  ·  Opening',
            title: 'What can start today.',
            lede: opening
                ? 'Target opening ' + opening + '. Dates here are planning, not a vendor promise.'
                    + (p.policy.opening.numbers === 'porting'
                        ? ' Do not cancel existing phone service before a port starts.'
                        : p.policy.opening.numbers === 'new'
                            ? ' This is a new published number, not a port.'
                            : '')
                : 'An opening date is not set. Freeze answering rules before the number is public.',
            blocks: [
                { kind: 'steps', items: openingSteps(p) },
                ...(installOpen(p).length
                    ? [{ kind: 'kicker' as const, text: 'Still open — handled at install' }, { kind: 'checks' as const, items: installOpen(p) }]
                    : [{ kind: 'note' as const, text: 'Owner policy on this page is recorded. Live tests still happen on installed phones.' }])
            ] as BriefBlock[]
        }
        : {
            kicker: '05  ·  Before you sign',
            title: 'Things worth checking.',
            lede: 'A quote should match the quantities on page 03. Room count is not a shopping list.',
            blocks: [
                { kind: 'rows', items: [
                    ...(darkOffice(p).length ? darkOffice(p) : [
                        { label: 'Internet outage', value: 'Not recorded yet' },
                        { label: 'Power', value: 'Not recorded yet' },
                        { label: 'If internet fails', value: 'Not recorded yet' }
                    ]),
                    ...(workMobileNoted(p) ? [{ label: 'Work mobile', value: 'App / Follow Me. Personal number not published.' }] : [])
                ] },
                { kind: 'checks', items: installOpen(p) }
            ] as BriefBlock[]
        };

    return [
        {
            kicker: '01  ·  Cover',
            title: p.name.trim() || 'Your practice',
            lede: coverLede || 'A plan for how patients reach you. Nothing here is installed.',
            blocks: [
                { kind: 'stats', items: coverNumbers },
                { kind: 'note', text: orderTotal(p) },
                { kind: 'hours', items: coverHours },
                { kind: 'note', text: (tz ? 'Phone hours in ' + tz + '. ' : '') + 'Draft. Nothing is installed.' },
                { kind: 'kicker', text: 'When someone calls' },
                { kind: 'moments', items: coverGlance(p) }
            ]
        },
        {
            kicker: '02  ·  Every call',
            title: 'What happens when someone calls.',
            lede: p.first.kind === 'menu'
                ? 'Callers press a keypad first. The scripts below are what to record.'
                : p.first.kind === 'assistant'
                    ? 'A virtual receptionist is proposed to answer first — not live until a vendor proves it.'
                    : receptionOutsideComputers(p) && !deskToBuy(p)
                        ? 'The answering computer picks up. No keypad. The scripts below are what to record.'
                        : 'A person answers. No keypad. The scripts below are what to record.',
            blocks: [
                // Scripts first so freeze-fit owner pages never drop lunch / before-opening hears.
                { kind: 'kicker', text: 'What a caller hears' },
                { kind: 'scripts', items: scripts(p) },
                { kind: 'kicker', text: 'In plain words' },
                { kind: 'moments', items: callMoments(p).slice(0, 4) },
                { kind: 'note', text: 'Wording is a preview of the path, not a live call. Approve it before anything is recorded.' }
            ]
        },
        {
            kicker: '03  ·  What to order',
            title: orderTitle(p),
            lede: orderLede(p),
            blocks: [
                { kind: 'stats', items: orderNumbers },
                { kind: 'list', items: orderPoints(p) },
                { kind: 'kicker', text: 'Do not order' },
                { kind: 'list', items: doNotOrder(p) },
                { kind: 'note', text: 'A quote should match these quantities. This file never invents a price.' },
                { kind: 'rows', items: staffRows(p) }
            ]
        },
        {
            kicker: '04  ·  How work is split',
            title: 'Who owns each kind of call.',
            lede: p.first.kind === 'menu'
                ? 'Callers choose on a keypad first. These are the menu destinations — not handoffs after pickup.'
                : p.first.kind === 'assistant'
                    ? 'A virtual receptionist is proposed to answer first. These are handoffs only if that vendor is live.'
                    : receptionOutsideComputers(p) && !deskToBuy(p)
                        ? 'The answering computer picks up. These are handoffs after pickup — not a daytime menu.'
                        : 'Front desk answers first. These are handoffs after pickup — not a daytime menu.',
            blocks: [
                { kind: 'rows', items: coverage(p) },
                { kind: 'kicker', text: 'This number is not' },
                { kind: 'rows', items: boundaries(p) },
                ...(darkOffice(p).length
                    ? [{ kind: 'kicker' as const, text: 'If the office cannot take calls' }, { kind: 'rows' as const, items: darkOffice(p) }]
                    : []),
                { kind: 'note', text: p.first.kind === 'human'
                    ? 'Appointments staying at the front desk is a choice, not a missing route.'
                    : p.first.kind === 'menu'
                        ? 'A vendor quote that skips this keypad and rings the front desk first is not this plan.'
                        : 'A vendor quote that adds a menu you did not ask for is not this plan.' }
            ]
        },
        page5,
        {
            kicker: '06  ·  How to use this',
            title: 'Hand this to any provider.',
            lede: 'If the implementation spec does not show the same plan ID, revision, and checksum printed in this footer, do not install from either file.',
            blocks: [
                { kind: 'rows', items: fileMeaning() },
                { kind: 'kicker', text: 'Live tests on installed phones' },
                { kind: 'checks', items: useChecks(p) },
                { kind: 'prose', text: 'Book a time with Upstate at upstateipvoice.com/review. ' + PRIVACY_COPY },
                { kind: 'note', text: 'Owner _____________________  Date __________\nProvider __________________  Date __________\nLive test _________________  Date __________' }
            ]
        }
    ];
}

export function ownerBriefText(p: Plan) {
    return ownerBrief(p).flatMap(page => [
        page.title,
        page.lede || '',
        ...page.blocks.flatMap(block => {
            if (block.kind === 'prose' || block.kind === 'note' || block.kind === 'kicker')
                return [block.text];
            if (block.kind === 'stats')
                return block.items.map(i => i.value + ' ' + i.label + ' ' + i.note);
            if (block.kind === 'hours' || block.kind === 'rows')
                return block.items.map(i => i.label + ': ' + i.value);
            if (block.kind === 'moments')
                return block.items.map(i => i.when + ' ' + i.happen);
            if (block.kind === 'scripts')
                return block.items.map(i => i.when + ' ' + i.hear);
            if (block.kind === 'steps')
                return block.items.map(i => i.label + ' ' + i.window + ' ' + i.note);
            if (block.kind === 'checks' || block.kind === 'list')
                return block.items;
            if (block.kind === 'table')
                return [block.headers.join(' | '), ...block.rows.map(r => r.join(' | '))];
            return [];
        })
    ].filter(Boolean)).join('\n');
}
