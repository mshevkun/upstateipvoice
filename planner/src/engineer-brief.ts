import { menuDigits, type Day, type Plan } from './config';
import { formatTime, lunchCallbackPhrase } from './flow';
import { buySummary, identity, providerRequirements, testsBeforeOpen, workMobileNoted } from './advisor';
import { directory } from './policy';
import { ringMembers } from './provisioning';
import { effectiveHolidayDates, fusionBuild, mailboxExt, onCallUnbuilt, skippedHolidayDates, type FusionBuild, type FusionKind } from './fusion';
import { type BriefMoment, type BriefPage, type BriefRow, type BriefScript, type BriefStat } from './owner-brief';

function boxFor(kind: 'busy' | 'lunch' | 'after' | 'before' | 'priority' = 'after') {
    return mailboxExt(kind);
}

function findObj(b: FusionBuild, kind: FusionKind, re: RegExp) {
    return b.objects.find(o => o.kind === kind && re.test((o.name || '') + ' ' + (o.extension || '')));
}

function stripGui(s: string) {
    return s
        .replace(/^Apps → [^:]+:\s*/, '')
        .replace(/^Temporary Destination:\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function lunchDay(p: Plan) {
    return p.hours.days.find(d => d.breakStart && d.breakEnd);
}

function minute(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function clock(mins: number) {
    const n = Math.max(0, Math.min(1439, mins));
    const h = Math.floor(n / 60);
    const m = n % 60;
    const p = h >= 12 ? 'PM' : 'AM';
    return (h % 12 || 12) + ':' + String(m).padStart(2, '0') + ' ' + p;
}

/** Planner `end` is exclusive. Fusion minute-of-day is inclusive, so store end-1. */
function dayWindows(day: Day) {
    if (!day.open)
        return [] as { start: number; end: number }[];
    const open = minute(day.start);
    const close = Math.max(open, minute(day.end) - 1);
    if (!day.breakStart || !day.breakEnd)
        return [{ start: open, end: close }];
    const br0 = minute(day.breakStart);
    const br1 = minute(day.breakEnd);
    const out: { start: number; end: number }[] = [];
    if (br0 > open)
        out.push({ start: open, end: br0 - 1 });
    if (close >= br1)
        out.push({ start: br1, end: close });
    return out;
}

function prettyDay(iso: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m)
        return iso;
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function physicalDesk(p: Plan) {
    return directory(p).filter(d => d.device === 'desk').reduce((n, d) => n + d.count, 0);
}

function rgHop(p: Plan, o: { name: string; extension?: string }) {
    if (p.policy.ring !== 'order' || !p.policy.ringOrder?.length)
        return -1;
    return p.policy.ringOrder.findIndex(r => {
        const name = p.teams.find(t => t.id === r.team)?.name || '';
        return (!!name && o.name.includes(name)) || o.name.toLowerCase().includes(r.team);
    });
}

function inboundRg(p: Plan, b: FusionBuild) {
    if (p.first.kind !== 'human')
        return undefined;
    const name = p.teams.find(t => t.id === p.first.team)?.name || '';
    return b.objects.find(o => o.kind === 'ring_group' && !/on-call/i.test(o.name) && !!name && o.name.includes(name))
        || b.objects.find(o => o.kind === 'ring_group' && !/on-call/i.test(o.name));
}

function weekendDays(p: Plan, open: boolean) {
    return p.hours.days.filter(d => (d.day === 'Saturday' || d.day === 'Sunday') && d.open === open);
}

function alwaysOn(p: Plan) {
    return p.hours.days.every(d => d.open && d.start === '00:00' && (d.end === '24:00' || d.end === '23:59'));
}

function openAction(p: Plan, b: FusionBuild) {
    if (p.first.kind === 'human')
        return 'RG ' + (inboundRg(p, b)?.extension || '7000');
    if (p.first.kind === 'menu') {
        const lang = b.objects.find(o => o.kind === 'ivr' && / · language$/i.test(o.name));
        const open = findObj(b, 'ivr', /reason menu/i);
        return lang ? 'IVR ' + lang.extension : 'IVR ' + (open?.extension || '9000');
    }
    if (p.first.kind === 'assistant') {
        const ai = b.objects.find(o => o.kind === 'ai_bridge');
        return 'AI ' + (ai?.extension || '6100');
    }
    return 'undecided';
}

function closedAction(p: Plan, b: FusionBuild) {
    const closedIvr = findObj(b, 'ivr', /after hours/i);
    const ai = b.objects.find(o => o.kind === 'ai_bridge');
    if (p.after.kind === 'assistant')
        return 'AI ' + (ai?.extension || '6100');
    if (p.after.kind === 'service')
        return 'answering-service bridge';
    if (p.after.kind === 'information' && !(p.urgent.enabled && p.policy.urgentKind === 'connect'))
        return closedIvr ? 'IVR ' + closedIvr.extension + ' hangup' : 'after-hours-info.wav hangup';
    if (closedIvr && p.urgent.enabled && p.policy.urgentKind === 'connect')
        return 'IVR ' + closedIvr.extension;
    if (p.after.kind === 'message')
        return 'box ' + boxFor('after');
    if (closedIvr)
        return 'IVR ' + closedIvr.extension;
    return 'undecided';
}

export type CallHop = {
    id: string;
    when: string;
    happen: string;
    object: string;
    test: string;
    blocked?: boolean;
};

function sequenceHops(p: Plan, b: FusionBuild) {
    if (p.policy.ring !== 'order' || !p.policy.ringOrder?.length)
        return '';
    return p.policy.ringOrder.map(r => {
        const rg = b.objects.find(o => o.kind === 'ring_group' && o.name.includes(p.teams.find(t => t.id === r.team)?.name || r.team));
        return 'RG ' + (rg?.extension || '') + ' ' + r.seconds + 's';
    }).filter(s => /RG \d/.test(s)).join(' then ');
}

/** One path of record. Directory, objects, build, and tests only quote this. */
export function callPath(p: Plan, b: FusionBuild): CallHop[] {
    const tc = findObj(b, 'time_condition', /Time Condition/);
    const tcExt = tc?.extension || '8000';
    const dayRg = inboundRg(p, b);
    const urgentRg = findObj(b, 'ring_group', /on-call/i);
    const closedIvr = findObj(b, 'ivr', /after hours/i);
    const members = ringMembers(p, p.first.team || 'reception', true).map(m => m.extension).filter(Boolean);
    const box = boxFor('busy');
    const afterBox = boxFor('after');
    const beforeBox = boxFor('before');
    const hops: CallHop[] = [];
    if (p.mode === 'opening' && p.policy.beforeOpening === 'information')
        hops.push({
            id: 'before',
            when: 'Before opening',
            object: 'DID playback',
            happen: 'DID → playback before-opening.wav then hangup. Not TC ' + tcExt
                + '. Not a mailbox. Put that file on the temporary Destination before the number is public.',
            test: 'Before opening: DID still plays before-opening.wav then hangup, not TC ' + tcExt + '.'
        });
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'message')
        hops.push({
            id: 'before',
            when: 'Before opening',
            object: '*99' + beforeBox,
            happen: 'DID → *99' + beforeBox + ' (box ' + beforeBox + '). Not TC ' + tcExt
                + '. Put before-opening-callback.wav on that box before the number is public.',
            test: 'Before opening: DID still → *99' + beforeBox + ', not TC ' + tcExt + '.'
        });
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'undecided')
        hops.push({
            id: 'before',
            when: 'Before opening',
            object: 'unresolved',
            blocked: true,
            happen: 'Do not publish the DID. The owner has not approved a pre-opening destination.',
            test: 'DID is not public. Before-opening destination is unresolved.'
        });
    const seq = sequenceHops(p, b);
    if (p.first.kind === 'human') {
        const extras = directory(p)
            .filter(d => d.access === 'outside' && !inboundExts(p).includes(d.extension)
                && !(d.sharing === 'separate' && inboundExts(p).includes(String(Number(d.extension) + 1))))
            .map(d => d.sharing === 'separate' && d.count > 1
                ? d.extension + '–' + String(Number(d.extension) + d.count - 1)
                : d.extension);
        hops.push({
            id: 'open',
            when: 'Open hours',
            object: seq || ('RG ' + (dayRg?.extension || '7000')),
            happen: seq
                ? 'DID → TC ' + tcExt + ' → ' + seq + '. Sequence, not simultaneous. No IVR.'
                : 'DID → TC ' + tcExt
                    + ' → RG ' + (dayRg?.extension || '7000')
                    + (members.length ? ' (' + members.join(', ') + ' simultaneous, ' + p.busy.seconds + 's)' : '')
                    + '. No IVR.'
                    + (extras.length ? ' ' + extras.join(', ') + ' are not inbound members.' : ''),
            test: seq
                ? 'Open hours: sequence ' + seq + '. After a hop timeout the next group rings. Not simultaneous across hops. No IVR.'
                : directory(p).find(d => d.device === 'desk' && d.sharing === 'separate' && d.count > 1)
                    ? 'Open hours: two simultaneous calls. '
                        + directory(p).find(d => d.device === 'desk' && d.sharing === 'separate' && d.count > 1)!.extension
                        + ' and ' + String(Number(directory(p).find(d => d.device === 'desk' && d.sharing === 'separate' && d.count > 1)!.extension) + 1)
                        + ' both ring. No IVR.'
                    : directory(p).find(d => d.sharing === 'shared' && d.count > 1)
                        ? 'Open hours: ' + directory(p).find(d => d.sharing === 'shared' && d.count > 1)!.count
                            + ' devices on SIP user ' + directory(p).find(d => d.sharing === 'shared' && d.count > 1)!.extension
                            + '. A second caller does not get a second person. No IVR.'
                        : 'Open hours: ' + openAction(p, b) + ' answers. No IVR.'
        });
    }
    else if (p.first.kind === 'menu')
        hops.push({
            id: 'open',
            when: 'Open hours',
            object: openAction(p, b),
            happen: 'DID → TC ' + tcExt + ' → ' + openAction(p, b)
                + '. Callers hear the IVR, not ringing. Digit destinations are ring groups — the DID does not ring them first.',
            test: 'Open hours: hear ' + openAction(p, b) + '. A digit lands on a ring group. The DID does not ring staff first.'
        });
    else if (p.first.kind === 'assistant')
        hops.push({
            id: 'open',
            when: 'Open hours',
            object: openAction(p, b),
            happen: 'DID → TC ' + tcExt + ' → ' + openAction(p, b) + '. Not an IVR. Not a user extension.',
            test: 'Open hours: DID reaches the Voice Receptionist bridge. Not an IVR. Not a user extension.'
        });
    else
        hops.push({
            id: 'open',
            when: 'Open hours',
            object: 'undecided',
            blocked: true,
            happen: 'First-answer object is still open. Do not point the DID at a user extension.',
            test: 'BLOCKED: first-answer object is undecided. Do not point the DID at a user extension.'
        });
    const lunch = lunchDay(p);
    if (lunch)
        hops.push({
            id: 'lunch',
            when: 'Lunch · ' + formatTime(lunch.breakStart) + '–' + formatTime(lunch.breakEnd),
            object: 'lunch-closed.wav → box ' + box,
            happen: 'TC lunch groups → lunch-closed.wav → box ' + box + '. ' + lunchCallbackPhrase(p) + '. Not group 999. Not on-call.',
            test: 'Lunch: lunch-closed.wav, ' + lunchCallbackPhrase(p) + ' — not group 999, not on-call.'
        });
    if (alwaysOn(p))
        hops.push({
            id: 'closed',
            when: 'After hours',
            object: 'Group 999 safety',
            happen: 'Open groups cover every day 0–1439. Group 999 is a safety catch-all (' + closedAction(p, b) + ') and should not receive traffic if those windows are continuous.',
            test: 'Overnight: posted 24 hours. Confirm open groups still ring. Group 999 must not receive live traffic.'
        });
    else if (p.after.kind === 'assistant')
        hops.push({
            id: 'closed',
            when: 'After hours',
            object: closedAction(p, b),
            happen: 'TC group 999 → ' + closedAction(p, b) + '. Not the daytime IVR.',
            test: 'After hours: Voice Receptionist bridge. Not the daytime IVR.'
        });
    else if (p.after.kind === 'service')
        hops.push({
            id: 'closed',
            when: 'After hours',
            object: 'answering-service bridge',
            happen: 'TC group 999 → answering-service bridge. Contracted actions only. Timeout to the after-hours mailbox if the service misses.',
            test: 'After hours: answering-service bridge. Confirm the contract on a live call.'
        });
    else if (p.after.kind === 'information' && !(p.urgent.enabled && p.policy.urgentKind === 'connect'))
        hops.push({
            id: 'closed',
            when: 'After hours',
            object: closedAction(p, b),
            happen: 'TC group 999 → ' + closedAction(p, b) + '. This is not voicemail.',
            test: 'After hours: after-hours-info.wav then hangup. No mailbox.'
        });
    else if (closedIvr && p.policy.urgentKind === 'connect' && p.after.kind !== 'assistant') {
        const unbuilt = onCallUnbuilt(p);
        hops.push({
            id: 'closed',
            when: 'After hours',
            object: 'IVR ' + closedIvr.extension,
            blocked: unbuilt,
            happen: unbuilt
                ? 'TC group 999 → IVR ' + closedIvr.extension + '. Digit 1 / timeout → box ' + afterBox
                    + '. Digit 9 → RG ' + (urgentRg?.extension || '7900')
                    + ' is BLOCKED — no outside on-call identity. Do not go live until Follow Me is populated. Not the internal computer.'
                : 'TC group 999 → IVR ' + closedIvr.extension + '. Digit 9 → RG ' + (urgentRg?.extension || '7900')
                    + ' (' + p.urgent.seconds + 's). Digit 1 / timeout → box ' + afterBox + '.',
            test: unbuilt
                ? 'BLOCKED: after hours digit 9 must not go live. RG ' + (urgentRg?.extension || '7900')
                    + ' has no outside member. Follow Me is empty — fail the install.'
                : 'After hours: IVR ' + closedIvr.extension + '. Digit 9 rings RG ' + (urgentRg?.extension || '7900')
                    + ' for ' + p.urgent.seconds + 's — a person picks up. Digit 1 / timeout → box ' + afterBox
                    + '. On-call miss stays a mailbox, not the daytime group.'
        });
    }
    else if (p.after.kind === 'message')
        hops.push({
            id: 'closed',
            when: 'After hours',
            object: 'box ' + afterBox,
            happen: 'TC group 999 → box ' + afterBox + '. No live connect.',
            test: 'After hours: box ' + afterBox + '. Next-business-day handling.'
        });
    const overflowConfirmed = p.busy.kind === 'backup' && !!p.busy.backup;
    const mobileOverflow = directory(p).some(d => d.device === 'mobile' && !inboundExts(p).includes(d.extension));
    hops.push({
        id: 'busy',
        when: 'Nobody answers',
        object: busyAction(p, b),
        happen: (p.first.kind === 'menu'
            ? 'After a digit, that reason ring group'
            : p.first.kind === 'assistant'
                ? openAction(p, b)
                : 'RG ' + (dayRg?.extension || '7000'))
            + ' timeout ' + p.busy.seconds + 's → ' + busyAction(p, b) + '.'
            + (overflowConfirmed
                ? ' Overflow RG dials the work-mobile extension so Follow Me can fire.'
                : mobileOverflow ? ' Follow Me on a work-mobile extension does not fire: the DID never dialed that extension.' : ''),
        test: p.busy.kind === 'queue'
            ? 'Nobody answers (' + p.busy.seconds + 's): enter ' + busyAction(p, b) + '.'
            : 'Nobody answers (' + p.busy.seconds + 's). Hear ' + busyAction(p, b) + '.'
    });
    return hops;
}

function busyAction(p: Plan, b: FusionBuild) {
    const box = boxFor('busy');
    if (p.busy.kind === 'queue') {
        const q = b.objects.find(o => o.kind === 'call_center');
        return 'Call Center ' + (q?.extension || '5000') + ' (' + p.busy.wait + 's) then box ' + box;
    }
    if (p.busy.kind === 'backup')
        return 'RG ' + (b.objects.find(o => o.kind === 'ring_group' && o.extension === '7001')?.extension || '7001') + ' then box ' + box;
    if (p.busy.kind === 'assistant') {
        const ai = b.objects.find(o => o.kind === 'ai_bridge');
        return 'AI ' + (ai?.extension || '6100');
    }
    return 'busy-voicemail.wav → box ' + box;
}

function ivrValue(p: Plan, b: FusionBuild, o: { name: string; extension?: string; setup: string[] }) {
    const digits = o.setup.filter(s => /Digit \d/i.test(s)).map(s => stripGui(s));
    const digitBit = digits.length ? digits.join('. ') : '';
    if (/after hours/i.test(o.name)) {
        if (alwaysOn(p))
            return 'Safety catch-all only. Posted hours are 24h. Do not treat this as a live after-hours path.';
        if (p.after.kind === 'information' && !(p.urgent.enabled && p.policy.urgentKind === 'connect'))
            return 'Closed. greet_long = after-hours-info.wav. Exit hangup. No mailbox. No digit 9.';
        const urgentRg = findObj(b, 'ring_group', /on-call/i);
        if (onCallUnbuilt(p))
            return 'Closed hours. greet_long = after-hours-urgent-option.wav. Digit 1 / timeout → box '
                + boxFor('after') + '. Digit 9 → RG ' + (urgentRg?.extension || '7900')
                + ' is BLOCKED until Follow Me is populated. Do not go live.';
        return 'Closed hours. greet_long = after-hours-urgent-option.wav. Digit 9 → RG '
            + (urgentRg?.extension || '7900') + '. Digit 1 / timeout → box ' + boxFor('after') + '.';
    }
    if (/ · language$/i.test(o.name))
        return 'Open-hours language menu. greet_long = ivr-language.wav. ' + (digitBit || 'Digit 1 English. Digit 2 Spanish. Timeout → English reason IVR.');
    if (/Spanish reason/i.test(o.name))
        return 'Spanish reason menu. Same digits as English. greet_long = ivr-open-es.wav.';
    if (/location/i.test(o.name))
        return 'Location menu. ' + (digitBit || stripGui(o.setup[0] || o.name));
    if (/reason menu/i.test(o.name))
        return 'Open hours. greet_long = ivr-open-greeting.wav. '
            + (digitBit || 'Digits in Fusion.')
            + (p.languages.some(l => l.mechanism === 'menu') ? ' Reached via the language IVR.' : ' Time Condition open groups land here.');
    return stripGui(o.setup[0] || o.name);
}

function inboundExts(p: Plan) {
    return ringMembers(p, p.first.team || 'reception', true).map(m => m.extension).filter(Boolean);
}

function timeoutTarget(o: { setup: string[] }) {
    const raw = o.setup.find(s => /timeout_data/i.test(s)) || '';
    const data = raw
        .replace(/^timeout_app = transfer; timeout_data = /i, '')
        .replace(/^timeout_data:\s*/i, '')
        .replace(/\s*XML\s+\S+/i, '')
        .replace(/\.$/, '')
        .trim();
    return data;
}

function pinRecording(filename: string, usedBy: string) {
    if (/before-opening-callback/.test(filename))
        return 'DID before open → box greeting';
    if (/before-opening\.wav/.test(filename))
        return 'DID before open playback';
    if (/lunch/.test(filename))
        return 'TC lunch groups → box, not 999';
    if (/busy/.test(filename))
        return 'Inbound RG timeout → box';
    if (/urgent-option/.test(filename))
        return usedBy.replace(/^Closed IVR/, 'IVR');
    if (/greeting_1/.test(filename))
        return usedBy.replace(/^Voicemail box/, 'Box');
    return usedBy;
}

function provisionStats(p: Plan): BriefStat[] {
    const buy = buySummary(p);
    const places = directory(p);
    const deskN = physicalDesk(p);
    const outsideComp = places.filter(d => d.device === 'computer' && d.access === 'outside').reduce((n, d) => n + d.count, 0);
    const items: BriefStat[] = [];
    if (deskN > 0)
        items.push({ value: String(deskN), label: deskN === 1 ? 'Desk phone' : 'Desk phones', note: buy.desk.note });
    else if (!(outsideComp && p.first.kind === 'human'))
        items.push({ value: buy.desk.qty == null ? '—' : String(buy.desk.qty), label: buy.desk.label, note: buy.desk.note });
    if (buy.mobile.qty)
        items.push({
            value: String(buy.mobile.qty),
            label: buy.mobile.qty === 1 ? 'Work mobile' : 'Work mobiles',
            note: 'Follow Me · not a personal cell'
        });
    if (outsideComp) {
        const inbound = inboundExts(p);
        const inboundComp = places.filter(d => d.device === 'computer' && d.access === 'outside' && inbound.includes(d.extension)).length;
        items.push({
            value: String(outsideComp),
            label: outsideComp === 1 ? 'Answering computer' : 'Answering computers',
            note: p.first.kind !== 'human'
                ? 'WSS · not first answer'
                : inboundComp && inboundComp === outsideComp
                    ? 'WSS · inbound member'
                    : inboundComp
                        ? 'WSS · see directory'
                        : 'WSS · not inbound RG'
        });
    }
    return items.slice(0, 3);
}

function pathMoments(p: Plan, b: FusionBuild): BriefMoment[] {
    return callPath(p, b).map(h => ({ when: h.when, happen: h.happen }));
}

function addressNote(p: Plan, b: FusionBuild) {
    const rec = directory(p).find(d => d.device === 'desk' && d.sharing === 'separate' && d.count > 1);
    const shared = directory(p).find(d => d.sharing === 'shared' && d.count > 1);
    const split = rec
        ? rec.extension + ' and ' + String(Number(rec.extension) + 1) + ' are two SIP users so both can pick up. Do not register two phones on one user. '
        : shared
            ? shared.count + ' devices on one SIP user (' + shared.extension + ') — one concurrent call. '
            : '';
    return split + 'Transfer “<ext> XML ' + b.domain + '”. Voicemail *99<ext>. Users 2xx · TC 8xxx · RG 7xxx · IVR 9xxx. Desk TLS :5081 · computer WSS :7443. reloadxml after writes.';
}

function directoryTable(p: Plan, b: FusionBuild): { headers: string[]; rows: string[][]; widths: number[] } {
    const rg = inboundRg(p, b)?.extension || '7000';
    const inbound = inboundExts(p);
    const rows = directory(p).map(d => {
        const ext = d.sharing === 'separate' && d.count > 1
            ? d.extension + '–' + String(Number(d.extension) + d.count - 1)
            : d.extension;
        const ids = d.sharing === 'separate' && d.count > 1
            ? Array.from({ length: d.count }, (_, i) => String(Number(d.extension) + i))
            : [d.extension];
        const place = d.device === 'mobile' ? 'Work mobile' : d.label;
        const sip = d.device === 'desk' ? 'TLS :5081' : d.device === 'computer' ? 'WSS :7443' : d.device === 'mobile' ? 'App + Follow Me' : d.device;
        const digit = menuDigits(p).find(x => x.kind !== 'urgent' && x.team === d.team);
        const hop = p.policy.ring === 'order' ? p.policy.ringOrder.findIndex(r => r.team === d.team) : -1;
        const inboundCell = d.access === 'internal'
            ? 'No · internal'
            : p.first.kind === 'assistant'
                ? 'No · AI first'
                : p.first.kind === 'menu'
                    ? (digit ? 'No · IVR digit ' + digit.digit : d.device === 'mobile' ? 'No · Follow Me' : 'No · transfer')
                    : hop === 0
                        ? 'Yes · hop 1 RG ' + rg
                        : hop > 0
                            ? 'No · sequence hop ' + (hop + 1)
                            : ids.some(x => inbound.includes(x))
                                ? 'Yes · RG ' + rg
                                : d.device === 'mobile'
                                    ? 'No · Follow Me'
                                    : 'No · transfer';
        return [place, ext, sip, inboundCell, String(d.concurrent), '☐ pwd', 'MAC ______', '______'];
    });
    return {
        headers: ['Place', 'Ext', 'Register', 'DID member', 'Conc.', 'Password', 'MAC', 'Tested'],
        rows: rows.length ? rows : [['None yet', '—', '—', '—', '—', '—', '—', '—']],
        widths: [88, 48, 78, 90, 40, 52, 70, 48]
    };
}

function fusionGroupTable(p: Plan, b: FusionBuild): { headers: string[]; rows: string[][]; widths: number[] } {
    const box = boxFor(p.hours.days.some(d => d.breakStart && d.breakEnd) ? 'lunch' : 'after');
    const closed = closedAction(p, b);
    const open = openAction(p, b);
    const short = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const days = p.hours.days;
    const groups: { start: number; end: number; key: string }[] = [];
    days.forEach((d, i) => {
        const key = !d.open ? 'closed' : [d.start, d.end, d.breakStart || '', d.breakEnd || ''].join('|');
        const last = groups[groups.length - 1];
        if (last && last.key === key && last.end === i - 1)
            last.end = i;
        else
            groups.push({ start: i, end: i, key });
    });
    const rows: string[][] = [];
    const holidayDates = effectiveHolidayDates(p);
    if (holidayDates.length)
        rows.push(['Dates first', holidayDates.map(prettyDay).join(', '), 'date-only', 'evaluate before weekday groups · ' + closed]);
    const skipped = skippedHolidayDates(p);
    if (skipped.length)
        rows.push(['Skip', skipped.map(s => prettyDay(s.iso) + ' (observe ' + prettyDay(s.observed) + '?)').join(', '), 'no-op', 'already closed — do not type']);
    for (const g of groups) {
        const d = days[g.start];
        const label = g.start === g.end ? short[g.start] : short[g.start] + '–' + short[g.end];
        if (!d.open)
            continue;
        const wins = dayWindows(d);
        if (d.breakStart && d.breakEnd && wins.length === 2) {
            const lunchEnd = Math.max(minute(d.breakStart), minute(d.breakEnd) - 1);
            rows.push([label + ' AM', clock(wins[0].start) + '–' + clock(wins[0].end), wins[0].start + '–' + wins[0].end, open]);
            rows.push([label + ' lunch', formatTime(d.breakStart) + '–' + clock(lunchEnd), minute(d.breakStart) + '–' + lunchEnd, 'lunch-closed.wav → ' + box]);
            rows.push([label + ' PM', clock(wins[1].start) + '–' + clock(wins[1].end), wins[1].start + '–' + wins[1].end, open]);
        }
        else if (wins[0])
            rows.push([label, clock(wins[0].start) + '–' + clock(wins[0].end), wins[0].start + '–' + wins[0].end, open]);
    }
    const catchClock = alwaysOn(p)
        ? 'Safety only'
        : weekendDays(p, true).length
            ? 'Outside open windows'
            : 'Nights, weekends';
    rows.push(['Group 999', catchClock, 'catch-all', closed]);
    return {
        headers: ['Group', 'Clock (inclusive)', 'Minutes', 'Action'],
        rows,
        widths: [100, 128, 88, 188]
    };
}

function hourNotes(p: Plan, b: FusionBuild): string[] {
    const tc = findObj(b, 'time_condition', /Time Condition/);
    const items = [
        'Timezone ' + (p.hours.timezone || 'unset') + '. TC ' + (tc?.extension || '8000') + ' · dialplan order 300. Minute-of-day, inclusive.'
    ];
    const closedWeekend = weekendDays(p, false).map(d => d.day);
    const openWeekend = weekendDays(p, true).map(d => d.day);
    if (alwaysOn(p))
        items.push('Open groups are 0–1439 every day. Group 999 is a safety catch-all and should not receive traffic if those windows are continuous.');
    else if (closedWeekend.length)
        items.push('Do not create empty ' + closedWeekend.join('/') + ' groups. Closed days fall through to 999.');
    if (openWeekend.length && !alwaysOn(p))
        items.push('Create open groups for ' + openWeekend.join('/') + ' as in the table. Do not leave weekend days on 999 if they are posted open.');
    if (lunchDay(p))
        items.push('Lunch groups must not fall through to group 999.');
    else
        items.push('No lunch close. Do not invent a lunch group.');
    if (p.mode === 'opening')
        items.push('Cutover: Destination flips to TC ' + (tc?.extension || '8000') + ' on opening morning. Two objects, one change.');
    const holidayDates = effectiveHolidayDates(p);
    if (holidayDates.length)
        items.push('Date-only groups first. Evaluate before weekday groups. Renew each year. ' + holidayDates.map(prettyDay).join(', ') + '.');
    const skipped = skippedHolidayDates(p);
    if (skipped.length)
        items.push(skipped.map(s => prettyDay(s.iso) + ' is already closed; do not type a no-op date. Observe ' + prettyDay(s.observed) + '?').join(' '));
    return items;
}

function recordingScripts(p: Plan, b: FusionBuild): BriefScript[] {
    const rank = (f: string) => {
        if (/before-opening/.test(f))
            return 0;
        if (/ivr-open-greeting/.test(f))
            return 1;
        if (/ivr-language/.test(f))
            return 2;
        if (/lunch/.test(f))
            return 3;
        if (/after-hours-urgent|after-hours-info/.test(f))
            return 4;
        if (/busy/.test(f))
            return 5;
        if (/greeting_1/.test(f))
            return 6;
        return 7;
    };
    return [...b.recordings]
        .filter(r => p.busy.kind !== 'queue' || !/busy-voicemail/.test(r.filename))
        .sort((a, c) => rank(a.filename) - rank(c.filename))
        .map(r => ({
            when: r.filename,
            hear: pinRecording(r.filename, r.usedBy) + '.  “' + r.script + '”'
        }));
}

function chunk<T>(xs: T[], n: number): T[][] {
    if (!xs.length)
        return [[]];
    const out: T[][] = [];
    for (let i = 0; i < xs.length; i += n)
        out.push(xs.slice(i, i + n));
    return out;
}

function pickSetup(o: { setup: string[] }, re: RegExp) {
    const s = o.setup.find(x => re.test(x));
    return s ? stripGui(s) : '';
}

function objectFields(o: { kind: string; setup: string[] }) {
    if (o.kind === 'ring_group')
        return pickSetup(o, /strategy|Ring Groups:/i);
    if (o.kind === 'ivr')
        return o.setup.filter(s => /greet_long|Digit \d|exit/i.test(s)).map(stripGui).join(' · ');
    if (o.kind === 'call_center')
        return pickSetup(o, /max wait|Agents|BLOCKED/i);
    if (o.kind === 'ai_bridge')
        return 'sofia/external Voice Receptionist SIP bridge. Not an IVR.';
    return '';
}

function objectRows(p: Plan, b: FusionBuild): BriefRow[] {
    const inbound = inboundRg(p, b)?.extension;
    const rows: BriefRow[] = [];
    for (const o of b.objects.filter(x => x.kind === 'destination')) {
        if (/after opening/i.test(o.name))
            rows.push({
                label: 'DID · after open',
                value: 'Cutover only. Transfer TC ' + (findObj(b, 'time_condition', /Time Condition/)?.extension || '8000') + ' XML ' + b.domain + '. Match Telnyx 10-digit, 11-digit, or +1.'
            });
        else if (/before opening/i.test(o.name))
            rows.push({
                label: 'DID · before open',
                value: p.policy.beforeOpening === 'information'
                    ? 'Playback before-opening.wav then hangup. Not TC 8000. Not a mailbox.'
                    : p.policy.beforeOpening === 'undecided'
                        ? 'Do not publish the DID — before-opening unresolved.'
                        : 'Transfer *99' + boxFor('before') + '. Not TC 8000.'
            });
        else
            rows.push({ label: 'DID', value: stripGui(o.setup[0] || o.name) });
    }
    const tc = b.objects.find(o => o.kind === 'time_condition');
    if (tc)
        rows.push({
            label: (tc.extension || '8000') + ' · time condition',
            value: 'Groups on page 03. Open → ' + openAction(p, b) + '. '
                + (lunchDay(p) ? 'Lunch → lunch-closed.wav. ' : 'No lunch group. ')
                + '999 → ' + closedAction(p, b) + '.'
        });
    for (const o of b.objects.filter(x => x.kind === 'ivr'))
        rows.push({
            label: (o.extension || '') + ' · IVR',
            value: ivrValue(p, b, o)
        });
    for (const o of b.objects.filter(x => x.kind === 'call_center'))
        rows.push({
            label: (o.extension || '') + ' · queue',
            value: objectFields(o) || stripGui((o.setup.find(s => /max wait|Agents/i.test(s)) || o.setup[0] || o.name))
        });
    for (const o of b.objects.filter(x => x.kind === 'ai_bridge'))
        rows.push({
            label: (o.extension || '') + ' · AI bridge',
            value: 'Voice Receptionist SIP bridge. Not an IVR. Failure → unfinished-request voicemail.'
        });
    for (const o of b.objects.filter(x => x.kind === 'ring_group')) {
        const blob = o.setup.join(' ');
        const memberExts = [...blob.matchAll(/\b(\d{3,4}) \(/g)].map(m => m[1]);
        const timeout = timeoutTarget(o);
        const name = o.name.replace(/^Ring group \d+ · /, '');
        let role: string;
        if (/on-call/i.test(o.name)) {
            const outside = ringMembers(p, p.urgent.team, true);
            const internal = directory(p).find(d => d.team === p.urgent.team && d.access === 'internal');
            role = outside.length
                ? p.urgent.seconds + 's · miss is a mailbox, not inbound'
                : 'no outside members — Follow Me on a dedicated on-call identity'
                    + (internal ? ', not ' + internal.extension : '')
                    + ' — do not go live';
        }
        else if (p.first.kind === 'menu')
            role = 'IVR destination — DID does not ring this group until a digit';
        else if (rgHop(p, o) === 0)
            role = 'sequence hop 1 · DID rings this group first';
        else if (rgHop(p, o) > 0)
            role = 'sequence hop ' + (rgHop(p, o) + 1) + ' · rings after previous hop timeout';
        else if (o.extension === inbound)
            role = 'inbound simultaneous — DID rings this group';
        else
            role = 'transfer target only — DID does not ring this group';
        const shown = /on-call/i.test(name) ? '' : name;
        const timeoutLine = timeout
            ? 'timeout_app = transfer; timeout_data = ' + timeout
            : 'timeout_app MISSING — do not go live';
        const memberLine = memberExts.length
            ? 'members ' + memberExts.join(', ')
            : /on-call/i.test(o.name)
                ? 'members none · BLOCKED until Follow Me is populated'
                : o.extension === inbound
                    ? 'members none · BLOCKED: assign outside-call devices'
                    : 'members: assign outside devices first';
        rows.push({
            label: (o.extension || '') + ' · RG',
            value: [shown, memberLine, role, timeoutLine, objectFields(o)]
                .filter(Boolean)
                .join(' · ')
        });
    }
    for (const o of b.objects.filter(x => x.kind === 'follow_me'))
        rows.push({
            label: (o.extension || '') + ' · Follow Me',
            value: 'Work app on this extension. Fires when this extension is dialed, not when the inbound object rings. No personal cell.'
        });
    return rows;
}

function buildOrder(p: Plan, b: FusionBuild): string[] {
    const tc = findObj(b, 'time_condition', /Time Condition/);
    const exts = directory(p).map(d => d.sharing === 'separate' && d.count > 1
        ? d.extension + '–' + String(Number(d.extension) + d.count - 1)
        : d.extension).join(', ');
    const files = b.recordings.filter(r => p.busy.kind !== 'queue' || !/busy-voicemail/.test(r.filename)).map(r => r.filename).join(', ');
    const buildBits = [
        p.first.kind === 'menu' ? 'IVR digits' : '',
        'ring groups',
        p.busy.kind === 'queue' ? 'Call Center queues' : '',
        (p.first.kind === 'assistant' || p.after.kind === 'assistant' || p.busy.kind === 'assistant') ? 'the Voice Receptionist bridge' : ''
    ].filter(Boolean).join(', ');
    const items = [
        '1 · Confirm domain ' + b.domain + ' and the portal tenant_fusion_domains row.',
        '2 · Create extensions' + (exts ? ' ' + exts : ' in the directory') + '. Confirm each is free on this domain_uuid.',
        '3 · Upload ' + (files || 'the practice recordings') + '. Listen to each file on a handset.',
        '4 · Build ' + buildBits + '. timeout_app is required. Daytime ' + p.busy.seconds + 's. On-call '
            + (p.urgent.enabled && p.policy.urgentKind === 'connect'
                ? (onCallUnbuilt(p) ? p.urgent.seconds + 's BLOCKED until Follow Me is populated' : p.urgent.seconds + 's')
                : 'off') + '. Do not mix them.',
        '5 · Build Time Condition ' + (tc?.extension || '8000') + ' from the page 03 table.'
            + (lunchDay(p) ? ' Lunch must not fall through to 999.' : '')
    ];
    if (p.mode === 'opening' && p.policy.beforeOpening === 'information')
        items.push('6 · Point the DID at playback before-opening.wav. Not TC ' + (tc?.extension || '8000') + '. Flip Destinations on opening morning.');
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'undecided')
        items.push('6 · Do not publish the DID. Before-opening destination is unresolved.');
    else if (p.mode === 'opening')
        items.push('6 · Point the DID at *99' + boxFor('before') + '. Not TC ' + (tc?.extension || '8000') + '. Flip Destinations on opening morning.');
    else
        items.push('6 · Point the DID at Time Condition ' + (tc?.extension || '8000') + '. Never a user extension.');
    if (workMobileNoted(p))
        items.push('7 · Enable Follow Me on the work-mobile extension. Work app only. No personal cell.');
    items.push((workMobileNoted(p) ? '8' : '7') + ' · reloadxml, then run every test on page 07 on the real DID.');
    return items;
}

function liveTestTable(p: Plan, b: FusionBuild) {
    const path = callPath(p, b);
    const inboundIds = inboundExts(p);
    const notInbound = directory(p).filter(d => {
        const ids = d.sharing === 'separate' && d.count > 1
            ? Array.from({ length: d.count }, (_, i) => String(Number(d.extension) + i))
            : [d.extension];
        return !ids.some(x => inboundIds.includes(x));
    }).map(d => d.extension);
    const recFor = (hop: CallHop) => {
        const rec = b.recordings.find(r => hop.id === 'before' && /before-opening/.test(r.filename)
            || hop.id === 'lunch' && /lunch/.test(r.filename)
            || /closed|after/.test(hop.when) && /after-hours|greeting_1/.test(r.filename)
            || hop.id === 'open' && /busy-voicemail|ivr-open/.test(r.filename));
        return rec?.filename || '—';
    };
    const rows: string[][] = path.map(h => [
        h.when,
        recFor(h),
        h.object,
        h.test,
        '☐'
    ]);
    if (p.first.kind === 'menu') {
        const firstDigit = menuDigits(p).find(d => d.kind === 'reason');
        if (firstDigit)
            rows.push(['Open hours', '—', 'IVR digit ' + firstDigit.digit, 'Press ' + firstDigit.digit + ' for ' + firstDigit.label + '. Invalid / no-input retries, then the IVR exit.', '☐']);
        rows.push(['Open hours', '—', 'DID', 'Inbound DID must not ring a user extension. It lands on the IVR.', '☐']);
    }
    else if (p.first.kind === 'human' && notInbound.length)
        rows.push(['Open hours', '—', 'DID', 'Inbound DID must not ring ' + notInbound.join(', ') + '. Transfer or Follow Me only.', '☐']);
    const separateFront = directory(p).some(d => d.team === (p.first.team || 'reception') && d.sharing === 'separate' && d.count > 1);
    if (separateFront)
        rows.push(['Two calls at once', '—', 'front-desk lines', 'Two simultaneous calls on separate front-desk lines.', '☐']);
    if (onCallUnbuilt(p))
        rows.push(['Press 9 empty Follow Me', 'after-hours-urgent-option.wav', 'RG 7900', 'MUST FAIL. Digit 9 with Follow Me empty does not connect. Do not go live.', '☐']);
    if (p.urgent.enabled && p.policy.urgentKind === 'connect' && !onCallUnbuilt(p))
        rows.push(['Press 9 with Follow Me', 'after-hours-urgent-option.wav', 'on-call RG', 'MUST CONNECT. Digit 9 rings the work on-call phone, not a personal cell.', '☐']);
    for (const t of testsBeforeOpen(p))
        if (/E911|emergency-calling/i.test(t.label))
            rows.push(['Install', '—', 'E911', 'E911 address on the installed system. Checking a box here is not a carrier filing.', '☐']);
    // Drop exact duplicate hop tests (same when + object + test).
    const seen = new Set<string>();
    const deduped = rows.filter(r => {
        const key = r.slice(0, 4).join('|');
        if (seen.has(key))
            return false;
        seen.add(key);
        return true;
    });
    return {
        headers: ['When', 'File', 'Object', 'Hop test', '☐'],
        widths: [78, 120, 70, 210, 24],
        rows: deduped
    };
}

function guardrails(p: Plan, b: FusionBuild): string[] {
    const items: string[] = [];
    const buy = buySummary(p);
    if (buy.rooms)
        items.push('Do not invent ' + buy.rooms + ' room phones from room count.');
    items.push('Do not point a DID at a user extension when hours or after-hours exist.');
    if (lunchDay(p))
        items.push('Do not let lunch groups fall through to group 999.');
    if (p.first.kind === 'human')
        items.push(p.languages.some(l => l.mechanism === 'staff')
            ? 'Do not build an open-hours IVR or a language IVR. Spanish is staff-identified after a person answers.'
            : 'Do not build an open-hours IVR. Callers reach a person first.');
    if (p.first.kind === 'menu')
        items.push('Do not point open Time Condition groups at a ring group. Open groups land on the IVR. Do not skip a configured digit.');
    if (p.first.kind === 'assistant')
        items.push('Do not point open hours at an IVR or a user extension. Open groups land on the Voice Receptionist bridge.');
    if (workMobileNoted(p) || /never forward|personal (cell|phone)/i.test((p.policy.notes || '') + ' ' + (p.policy.continuity.notes || '')))
        items.push('Do not store a personal cell in Follow Me, a recording, or a wall card. Snow days use group 999 — never forward the published number to a personal cell.');
    if (onCallUnbuilt(p))
        items.push('Do not enable digit 9 or go live. On-call RG has no outside member. Follow Me is empty.');
    if (p.urgent.enabled && p.policy.urgentKind === 'connect')
        items.push('Do not copy the on-call ' + p.urgent.seconds + 's timeout onto daytime RG ' + (b.objects.find(o => o.kind === 'ring_group' && !/on-call/i.test(o.name))?.extension || '7000') + ' (' + p.busy.seconds + 's).');
    const internal = directory(p).filter(d => d.access === 'internal');
    if (internal.length)
        items.push('Do not add internal ' + internal.map(d => d.extension).join(', ') + ' to inbound ring groups.');
    const mobile = directory(p).filter(d => d.device === 'mobile').map(d => d.extension);
    if (mobile.length && p.first.kind === 'human')
        items.push(p.busy.kind === 'backup' && p.busy.backup
            ? 'Do not add ' + mobile.join(', ') + ' to inbound RG ' + (inboundRg(p, b)?.extension || '7000') + '. Overflow is RG 7001, which dials that extension so Follow Me can fire.'
            : 'Do not add ' + mobile.join(', ') + ' to inbound RG ' + (inboundRg(p, b)?.extension || '7000') + ' unless the owner confirms inbound overflow. Follow Me does not fire when that group rings.');
    if (p.mode === 'opening' && p.policy.beforeOpening === 'information')
        items.push('Do not publish the DID until before-opening.wav is on the temporary Destination.');
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'undecided')
        items.push('Do not publish the DID. Before-opening destination is unresolved.');
    else if (p.mode === 'opening')
        items.push('Do not publish the DID until the before-opening recording is on the callback box.');
    return items;
}

function unresolved(p: Plan): BriefRow[] {
    const rows: BriefRow[] = [];
    if (p.urgent.enabled && p.policy.urgentKind === 'connect') {
        const outside = ringMembers(p, p.urgent.team, true);
        const team = p.teams.find(t => t.id === p.urgent.team)?.name || 'On-call team';
        rows.push({
            label: 'On-call',
            value: outside.length
                ? 'Verified contact is not in this planner. Put it in Follow Me, never in a recording. Fusion does not rotate the roster.'
                : 'BLOCKED. Do not go live. ' + team + ' has no outside identity. Follow Me on a dedicated on-call extension. Not the internal computer. Fusion does not rotate the roster.'
        });
    }
    for (const a of providerRequirements(p).filter(x => x.id !== 'rooms'))
        rows.push({
            label: a.id === 'notify' ? 'Inbox' : a.label,
            value: a.id === 'notify' ? 'Voicemail notification: ' + p.policy.notification + '. Delivery is not built here.' : a.detail
        });
    const c = p.policy.continuity;
    const site: string[] = [];
    if (c.internet === 'survey')
        site.push('Internet/network survey');
    if (c.power === 'ups')
        site.push('UPS on phones and network');
    else if (c.power === 'survey')
        site.push('Power backup survey');
    if (c.backupRouting === 'cellular')
        site.push('Cellular backup — never a personal cell');
    if (c.backupRouting === 'forward')
        site.push('do not forward the published number to a personal cell');
    if (site.length)
        rows.push({ label: 'Site', value: site.join('. ') + '.' });
    if (p.languages.some(l => l.mechanism === 'staff'))
        rows.push({ label: 'Spanish', value: 'Staff-identified during open hours. Do not build a language IVR.' });
    if (/fax|analog/i.test((p.current.lines || '') + ' ' + (p.current.notes || '')))
        rows.push({
            label: 'Fax / analog',
            value: 'Insurance fax: keep on its current line or move to a separate fax DID, never the patient DID. Two analog lines: cancel after cutover?'
        });
    for (const s of skippedHolidayDates(p))
        rows.push({
            label: 'Holiday observe',
            value: prettyDay(s.iso) + ' is already closed. Observe ' + prettyDay(s.observed) + '?'
        });
    return rows;
}

function kickerOf(num: string, name: string, i: number) {
    return (i === 0 ? num : num + String.fromCharCode(97 + i)) + '  ·  ' + name;
}

/** Groq does not write this. fusionBuild is the object authority; this is the reading order. */
export function engineerBrief(p: Plan): BriefPage[] {
    const b = fusionBuild(p);
    const id = identity(p);
    const loc = p.locations[0]?.name || 'Main practice';
    const tz = p.hours.timezone === 'America/New_York' ? 'Eastern Time' : (p.hours.timezone || '');
    const dir = directoryTable(p, b);
    const groups = fusionGroupTable(p, b);
    const blockers = [...b.blockers, ...b.parity];
    const moments = pathMoments(p, b);
    const recs = recordingScripts(p, b);
    const objs = objectRows(p, b);
    const tests = liveTestTable(p, b);
    const rails = guardrails(p, b);
    const open = unresolved(p);
    const pages: BriefPage[] = [];
    const momentParts = chunk(moments, 5);
    const blockerHead = blockers.slice(0, 3);
    const blockerRest = blockers.slice(3);
    pages.push({
        kicker: '01  ·  Path',
        title: p.name.trim() || 'Implementation spec',
        lede: (p.lock && p.lock.checksum === id.checksum ? 'LOCKED ' : 'DRAFT — do not build. ') + 'Must match owner ' + id.planId + ' · r' + id.revision + ' · ' + id.checksum + '. Nothing here is provisioned.',
        blocks: [
            { kind: 'stats', items: provisionStats(p) },
            { kind: 'note', text: loc + (tz ? ' · ' + tz : '') + '. Transfer data is always “<ext> XML ' + b.domain + '”.' },
            ...(blockerHead.length
                ? [{ kind: 'kicker' as const, text: 'Do not provision until resolved' }, { kind: 'list' as const, items: blockerHead }]
                : []),
            { kind: 'kicker', text: 'Call path to build' },
            { kind: 'moments', items: momentParts[0] }
        ]
    });
    momentParts.slice(1).forEach((part, i) => {
        pages.push({
            kicker: kickerOf('01', 'Path', i + 1),
            title: 'Call path continued.',
            lede: 'Same identity. Tests on page 07 quote this table.',
            blocks: [{ kind: 'moments', items: part }]
        });
    });
    if (blockerRest.length)
        pages.push({
            kicker: kickerOf('01', 'Path', momentParts.length),
            title: 'Do not provision until resolved.',
            lede: 'Remaining fusion blockers. They are not dropped.',
            blocks: [{ kind: 'list', items: blockerRest }]
        });
    pages.push({
        kicker: '02  ·  Directory',
        title: 'What to create in Fusion.',
        lede: 'Suggested extensions are not reserved. Confirm each number is free on this domain_uuid.',
        blocks: [
            { kind: 'table', headers: dir.headers, rows: dir.rows, widths: dir.widths },
            { kind: 'note', text: addressNote(p, b) }
        ]
    });
    pages.push({
        kicker: '03  ·  Hours',
        title: 'Time Condition ' + (findObj(b, 'time_condition', /Time Condition/)?.extension || '8000') + '.',
        lede: 'Type these groups. Fusion minutes are inclusive. Posted close is stored as end minus one minute.',
        blocks: [
            { kind: 'table', headers: groups.headers, rows: groups.rows, widths: groups.widths },
            { kind: 'list', items: hourNotes(p, b) }
        ]
    });
    const recNote = recs.length
        ? (lunchDay(p) ? 'Do not reuse lunch-closed.wav on group 999. ' : 'Do not invent a lunch recording. ')
            + 'Assign greet_long / voicemail greeting_1.wav as listed.'
        : 'No practice recordings beyond a standard voicemail greeting.';
    chunk(recs, 5).forEach((part, i, parts) => {
        pages.push({
            kicker: kickerOf('04', 'Recordings', i),
            title: i === 0 ? 'Files to record and upload.' : 'Recordings continued.',
            lede: i === 0
                ? 'Apps → Recordings. Filename is the object. Wording is what to put in the file. Listen on a handset.'
                : 'Same identity. Every remaining file.',
            blocks: [
                { kind: 'scripts', items: part },
                ...(i === parts.length - 1 ? [{ kind: 'note' as const, text: recNote }] : [])
            ]
        });
    });
    const objLede = p.first.kind === 'menu'
        ? 'Open hours land on an IVR, not a ring group. Digit destinations are transfer targets. Internal computers are not members.'
        : p.first.kind === 'assistant'
            ? 'Open hours land on the Voice Receptionist bridge, not a ring group or IVR.'
            : p.policy.ring === 'order'
                ? 'Inbound is a sequence of ring groups. Later hops are not transfer-only. Internal computers are not members.'
                : 'Inbound is the first-answer ring group. Other ring groups are transfer or on-call. Internal computers are not members.';
    chunk(objs, 8).forEach((part, i, parts) => {
        pages.push({
            kicker: kickerOf('05', 'Objects', i),
            title: i === 0 ? 'Objects on this tenant.' : 'Objects continued.',
            lede: i === 0 ? objLede : 'Same identity. Every remaining object.',
            blocks: [
                { kind: 'rows', items: part },
                ...(i === parts.length - 1
                    ? [{ kind: 'note' as const, text: 'Mailbox = extension. Greeting path /var/lib/freeswitch/storage/voicemail/default/' + b.domain + '/<ext>/greeting_1.wav.' }]
                    : [])
            ]
        });
    });
    pages.push({
        kicker: '06  ·  Build',
        title: 'Order of operations.',
        lede: 'Do not skip to Destinations before recordings and Time Condition groups exist.',
        blocks: [
            { kind: 'list', items: buildOrder(p, b) },
            { kind: 'kicker', text: 'If you skip a step' },
            { kind: 'list', items: [
                lunchDay(p)
                    ? 'Recordings before Time Condition: lunch groups play lunch-closed.wav.'
                    : p.first.kind === 'menu'
                        ? 'Record IVR greetings before pointing Time Condition at the IVR.'
                        : 'Recordings before Destinations. An empty greeting is a live mistake.',
                'Time Condition groups before the DID flip: empty TC 8000 is a black hole.',
                'reloadxml after the last write. The planner simulator is not a DID test.'
            ] }
        ]
    });
    chunk(tests.rows, 8).forEach((part, i, parts) => {
        pages.push({
            kicker: kickerOf('07', 'Tests', i),
            title: i === 0 ? 'Prove it on the DID.' : 'Tests continued.',
            lede: i === 0
                ? 'reloadxml first. Owner page 06 is the same bar. If a test fails, do not hand this practice a live number. Empty Follow Me on digit 9 must fail.'
                : 'Same identity. Every remaining DID hop test.',
            blocks: [
                { kind: 'table', headers: tests.headers, rows: part, widths: tests.widths },
                ...(i === parts.length - 1
                    ? [{ kind: 'note' as const, text: 'Owner _____________________  Date __________\nEngineer _________________  Date __________\nDID test _________________  Date __________' }]
                    : [])
            ]
        });
    });
    const railParts = chunk(rails, 10);
    const openParts = open.length ? chunk(open, 5) : [];
    railParts.forEach((part, i) => {
        const lastRail = i === railParts.length - 1;
        pages.push({
            kicker: kickerOf('08', 'Guardrails', i),
            title: i === 0 ? 'Do not provision these.' : 'Guardrails continued.',
            lede: i === 0
                ? 'A quote or a Fusion default that contradicts this page is not this plan.'
                : 'Same identity. Remaining do-nots.',
            blocks: [
                { kind: 'list', items: part },
                ...(lastRail && !openParts.length
                    ? [{ kind: 'note' as const, text: 'No extra provider parameters. Live tests still happen on the DID.' }]
                    : lastRail && openParts.length
                        ? [{ kind: 'kicker' as const, text: 'Still open' }, { kind: 'rows' as const, items: openParts[0] }]
                        : [])
            ]
        });
    });
    openParts.slice(1).forEach((part, i) => {
        pages.push({
            kicker: kickerOf('08', 'Guardrails', railParts.length + i),
            title: 'Still open.',
            lede: 'Same identity. Remaining unresolved parameters.',
            blocks: [{ kind: 'rows', items: part }]
        });
    });
    return pages;
}

export function engineerBriefText(p: Plan) {
    return engineerBrief(p).flatMap(page => [
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
