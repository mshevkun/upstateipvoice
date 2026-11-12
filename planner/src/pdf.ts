import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { type Plan } from './config';
import { engineerSections } from './plan-content';
import { directory } from './policy';
import { provisioningMap } from './provisioning';
import { fusionBuild } from './fusion';
import {
    callBranches, callMaps, glance, headlineInsights, identity, insights, openingRoadmap,
    ownerActions, providerRequirements, purchaseBands, testsBeforeOpen, workMobileNoted, type Insight
} from './advisor';
import { contractorHandoff } from './opening';
import { callerHear } from './architect/hear';
export { sections, ownerSections, engineerSections } from './plan-content';

type Part = 'owner' | 'engineer' | 'both';

const PAGE = { w: 612, h: 792 };
const M = { l: 54, r: 54, t: 58, b: 48 };
const CONTENT = PAGE.w - M.l - M.r;
const ink = rgb(19 / 255, 19 / 255, 19 / 255);
const mute = rgb(87 / 255, 87 / 255, 87 / 255);
const faint = rgb(120 / 255, 120 / 255, 120 / 255);
const hair = rgb(226 / 255, 226 / 255, 226 / 255);
const wash = rgb(248 / 255, 249 / 255, 251 / 255);
const white = rgb(1, 1, 1);

async function asset(path: string) {
    try {
        const r = await fetch(path);
        if (r.ok)
            return r.arrayBuffer();
    }
    catch { /* Node and offline fall through */ }
}

function prettyDate(iso: string, precision?: 'day' | 'month' | 'none') {
    if (precision === 'none' || !iso)
        return 'Not set';
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(iso);
    if (!m)
        return iso;
    const d = new Date(+m[1], +m[2] - 1, precision === 'month' ? 1 : +(m[3] || 1));
    return precision === 'month'
        ? d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
        : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

function deviceWord(d: string) {
    return d === 'desk' ? 'desk phone' : d === 'computer' ? 'computer' : d === 'mobile' ? 'mobile' : d;
}

function sharingWord(s: string) {
    return s === 'separate' ? 'separate extensions' : s === 'shared' ? 'shared identity' : s;
}

export function stamp(p: Plan) {
    const id = identity(p);
    return id.planId + ' · r' + id.revision + ' · ' + id.checksum;
}

export function assertSameIdentity(a: Plan, b: Plan) {
    const ia = identity(a), ib = identity(b);
    if (ia.planId !== ib.planId || ia.revision !== ib.revision || ia.checksum !== ib.checksum)
        throw new Error('Owner and engineer artifacts must share plan ID, revision, and checksum.');
}

export async function createPDF(p: Plan, fontBytes?: ArrayBuffer, part: Part = 'both', assets?: { logo?: ArrayBuffer }) {
    const id = identity(p);
    const doc = await PDFDocument.create();
    doc.registerFontkit(fontkit);
    let fallback = false;
    let font: PDFFont;
    try {
        const bytes = fontBytes || await asset('/assets/InstrumentSans.ttf');
    font = await doc.embedFont(bytes!, { subset: true });
}
catch {
    font = await doc.embedFont(StandardFonts.Helvetica);
    fallback = true;
    }
    let logo: PDFImage | undefined;
    try {
        const bytes = assets?.logo || await asset('/assets/upstate-logo.png');
        if (bytes)
            logo = await doc.embedPng(bytes);
    }
    catch { /* wordmark fallback */ }
    const safe = (text: string) => fallback ? text.normalize('NFKD').replace(/[^\x20-\x7E\n]/g, ' ') : text;
    let page: PDFPage, y = 0, kind: 'owner' | 'engineer' = 'owner';
    const tracked = (value: string, x: number, at: number, size: number, tracking: number, color: ReturnType<typeof rgb>) => {
        let cx = x;
        for (const ch of safe(value)) {
            page.drawText(ch, { x: cx, y: at, size, font, color });
            cx += font.widthOfTextAtSize(ch, size) + tracking;
        }
    };
    const add = (header = true) => {
        page = doc.addPage([PAGE.w, PAGE.h]);
        page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: white });
        if (header) {
            drawLogo(page, M.l, PAGE.h - 42, 118, logo);
            const label = kind === 'owner' ? 'OWNER BLUEPRINT' : 'IMPLEMENTATION SPEC';
            const lw = font.widthOfTextAtSize(label, 7.5);
            page.drawText(label, { x: PAGE.w - M.r - lw, y: PAGE.h - 34, size: 7.5, font, color: mute });
            page.drawLine({ start: { x: M.l, y: PAGE.h - 52 }, end: { x: PAGE.w - M.r, y: PAGE.h - 52 }, thickness: 0.4, color: hair });
            y = PAGE.h - 78;
        }
        else
            y = PAGE.h - M.t;
    };
    const need = (h: number) => {
        if (y - h < M.b + 10)
            add();
    };
    const wrap = (text: string, size: number, width = CONTENT) => {
        text = safe(text);
        const lines: string[] = [];
        for (const block of text.split('\n')) {
            let line = '';
    for (const word of block.split(/\s+/)) {
                const next = line ? line + ' ' + word : word;
                if (font.widthOfTextAtSize(next, size) <= width) {
                    line = next;
            continue;
                }
                if (line)
                    lines.push(line);
                line = '';
                for (const ch of word) {
                    if (font.widthOfTextAtSize(line + ch, size) > width) {
                        lines.push(line);
                        line = '';
                    }
                    line += ch;
                }
            }
            if (line)
                lines.push(line);
        }
        return lines.length ? lines : [''];
    };
    const text = (value: string, size: number, color = ink, x = M.l, width = CONTENT, leading = 1.38) => {
        const lines = wrap(value, size, width);
        need(lines.length * size * leading + 2);
        for (const line of lines) {
            page.drawText(line, { x, y, size, font, color });
            y -= size * leading;
        }
    };
    const gap = (n: number) => { y -= n; };
    const rule = () => {
        need(14);
        page.drawLine({ start: { x: M.l, y: y + 6 }, end: { x: PAGE.w - M.r, y: y + 6 }, thickness: 0.4, color: hair });
        y -= 10;
    };
    const kicker = (value: string) => {
        need(28);
        tracked(value.toUpperCase(), M.l, y, 8, 1.05, mute);
        y -= 24;
    };
    const title = (value: string, size = 22) => {
        const lines = wrap(value, size, CONTENT - 8);
        need(lines.length * size * 1.12 + 8);
        for (const line of lines) {
            page.drawText(line, { x: M.l, y, size, font, color: ink });
            y -= size * 1.12;
        }
        gap(4);
    };
    const row = (label: string, value: string) => {
        const labelW = 150;
        const valueW = CONTENT - labelW - 10;
        const labels = wrap(label, 9, labelW - 6);
        const values = wrap(value, 10, valueW);
        const h = Math.max(labels.length * 12, values.length * 13, 14);
        need(h + 12);
        labels.forEach((line, i) => page.drawText(line, { x: M.l, y: y - i * 12, size: 9, font, color: mute }));
        values.forEach((line, i) => page.drawText(line, { x: M.l + labelW, y: y - i * 13, size: 10, font, color: ink }));
        y -= h + 8;
        page.drawLine({ start: { x: M.l, y: y + 10 }, end: { x: PAGE.w - M.r, y: y + 10 }, thickness: 0.3, color: hair });
    };
    const bullets = (lines: string[]) => {
        for (const line of lines) {
            const wrapped = wrap(line, 10, CONTENT - 18);
            need(wrapped.length * 13.5 + 4);
            page.drawCircle({ x: M.l + 2.5, y: y + 3, size: 1.2, color: ink });
            let ly = y;
            for (const w of wrapped) {
                page.drawText(w, { x: M.l + 14, y: ly, size: 10, font, color: ink });
                ly -= 13.5;
            }
            y = ly - 2;
        }
    };
    const table = (headers: string[], rows: string[][], widths: number[]) => {
        const headH = 18;
        need(headH + 24);
        page.drawRectangle({ x: M.l - 2, y: y - 6, width: CONTENT + 4, height: headH, color: wash });
        let x = M.l;
        headers.forEach((h, i) => {
            page.drawText(safe(h).toUpperCase(), { x, y, size: 7.5, font, color: mute });
            x += widths[i];
        });
        y -= 16;
        page.drawLine({ start: { x: M.l, y: y + 8 }, end: { x: PAGE.w - M.r, y: y + 8 }, thickness: 0.4, color: hair });
        for (const r of rows) {
            const wrapped = r.map((cell, i) => wrap(cell, 9, Math.max(24, widths[i] - 8)));
            const h = Math.max(16, ...wrapped.map(w => w.length * 12));
            need(h + 8);
            x = M.l;
            wrapped.forEach((lines, i) => {
                lines.forEach((line, n) => page.drawText(line, { x, y: y - n * 12, size: 9, font, color: ink }));
                x += widths[i];
            });
            y -= h + 6;
            page.drawLine({ start: { x: M.l, y: y + 10 }, end: { x: PAGE.w - M.r, y: y + 10 }, thickness: 0.3, color: hair });
        }
        gap(8);
    };
    const box = (x: number, at: number, w: number, h: number, heading: string, sub: string, filled = false) => {
        page.drawRectangle({ x, y: at - h, width: w, height: h, color: filled ? wash : white, borderColor: ink, borderWidth: 0.7 });
        const head = wrap(heading, 9, w - 16);
        page.drawText(head[0] || '', { x: x + 8, y: at - 16, size: 9, font, color: ink });
        if (sub) {
            const lines = wrap(sub, 8, w - 16).slice(0, 3);
            lines.forEach((line, i) => page.drawText(line, { x: x + 8, y: at - 30 - i * 10, size: 8, font, color: mute }));
        }
    };
    const arrow = (x1: number, y1: number, x2: number, y2: number) => {
        page.drawLine({ start: { x: x1, y: y1 }, end: { x: x2, y: y2 }, thickness: 0.8, color: ink });
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy) || 1;
        const ux = dx / len, uy = dy / len;
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - ux * 6 + uy * 3.5, y: y2 - uy * 6 - ux * 3.5 }, thickness: 0.8, color: ink });
        page.drawLine({ start: { x: x2, y: y2 }, end: { x: x2 - ux * 6 - uy * 3.5, y: y2 - uy * 6 + ux * 3.5 }, thickness: 0.8, color: ink });
    };
    const insightBlock = (item: Insight) => {
        const mark = item.severity === 'critical' ? 'CRITICAL' : item.severity === 'high' ? 'CHECK' : 'NOTED';
        const detail = wrap(item.detail, 9.5, CONTENT - 88);
        const h = 22 + detail.length * 12.5;
        need(h + 10);
        page.drawRectangle({ x: M.l, y: y - h + 12, width: CONTENT, height: h, color: wash });
        tracked(mark, M.l + 10, y, 7, 0.8, mute);
        page.drawText(safe(item.title), { x: M.l + 86, y, size: 11, font, color: ink });
        let ly = y - 16;
        for (const line of detail) {
            page.drawText(line, { x: M.l + 86, y: ly, size: 9.5, font, color: mute });
            ly -= 12.5;
        }
        y -= h + 8;
    };
    const actionList = (items: { label: string; detail: string }[], empty: string) => {
        if (!items.length) {
            text(empty, 10, mute);
            return;
        }
        for (const item of items) {
            const detail = wrap(item.detail, 8.5, CONTENT - 18).slice(0, 2);
            need(16 + detail.length * 11);
            page.drawCircle({ x: M.l + 2.5, y: y + 3, size: 1.2, color: ink });
            page.drawText(safe(item.label), { x: M.l + 14, y, size: 10, font, color: ink });
            y -= 13;
            for (const line of detail) {
                page.drawText(line, { x: M.l + 14, y, size: 8.5, font, color: mute });
                y -= 11;
            }
            y -= 3;
        }
    };
    const drawGlance = () => {
        add();
        const g = glance(p);
        kicker('Page 01  ·  Owner blueprint');
        title(g.practice, 26);
        text((p.mode === 'opening' ? 'Opening-day communications plan for a ' : 'Communications plan. ') + g.dek, 11, mute);
        gap(12);
        const col = (CONTENT - 16) / 3;
        const cardH = 64;
        g.metrics.forEach((m, i) => {
            const x = M.l + i * (col + 8);
            page.drawRectangle({ x, y: y - cardH + 16, width: col, height: cardH, color: wash });
            page.drawText(m.value + (i === 2 && /^\d+$/.test(m.value) ? 's' : ''), { x: x + 12, y, size: 24, font, color: ink });
            wrap(m.label, 8, col - 22).slice(0, 2).forEach((line, n) => {
                page.drawText(line, { x: x + 12, y: y - 18 - n * 11, size: 8, font, color: mute });
            });
        });
        y -= cardH + 6;
        text(g.waitNote, 8.5, faint);
        gap(6);
        rule();
        kicker('Decisions that still change the install');
        const heads = headlineInsights(p);
        if (heads.length)
            heads.forEach(insightBlock);
        else
            text('No critical findings on this configuration. Still verify the live tests on page 06 before opening.', 10.5, mute);
        gap(8);
        kicker('How to use this document');
        bullets([
            'Take these pages to any phone provider. They should quote the required quantities on page 04 — not a phone per room.',
            'The implementation spec must show the same plan ID, revision, and checksum printed in this footer.',
            'Checking a box here does not install phones, file E911, or execute a BAA.'
        ]);
    };
    const drawCalls = () => {
        add();
        kicker('Page 02  ·  Every patient call');
        title('How a call actually moves.', 20);
        text('Each branch is drawn from the validated routing graph. Answered paths stop. Unanswered paths continue with that destination’s own staff.', 10, mute);
        gap(8);
        const map = callMaps(p);
        const branches = callBranches(p);
        const top = y;
        const cx = M.l + CONTENT / 2;
        const inW = CONTENT * 0.62;
        const inH = 40;
        box(cx - inW / 2, top, inW, inH, map.incoming, 'Published practice number');
        arrow(cx, top - inH, cx, top - inH - 10);
        const menuTop = top - inH - 14;
        const menuH = 40;
        box(M.l, menuTop, CONTENT, menuH, map.entry, map.digits.join('    ') || 'No keypad');
        const railY = menuTop - menuH - 8;
        page.drawLine({ start: { x: cx, y: menuTop - menuH }, end: { x: cx, y: railY }, thickness: 0.8, color: ink });
        y = railY - 10;
        if (branches.length) {
            const n = branches.length;
            const gapX = 8;
            const w = (CONTENT - gapX * (n - 1)) / n;
            const firstCx = M.l + w / 2;
            const lastCx = M.l + (n - 1) * (w + gapX) + w / 2;
            page.drawLine({ start: { x: firstCx, y: railY }, end: { x: lastCx, y: railY }, thickness: 0.8, color: ink });
            const colTop = y;
            const colH = 158;
            branches.forEach((b, i) => {
                const x = M.l + i * (w + gapX);
                const mid = x + w / 2;
                page.drawLine({ start: { x: mid, y: railY }, end: { x: mid, y: colTop }, thickness: 0.8, color: ink });
                page.drawRectangle({ x, y: colTop - colH, width: w, height: colH, color: white, borderColor: ink, borderWidth: 0.7 });
                let ly = colTop - 13;
                const inner = w - 14;
                page.drawText(b.digit ? 'Press ' + b.digit : 'Answer', { x: x + 7, y: ly, size: 8, font, color: mute });
                ly -= 14;
                wrap(b.label, 9, inner).slice(0, 2).forEach(line => {
                    page.drawText(line, { x: x + 7, y: ly, size: 9, font, color: ink });
                    ly -= 11;
                });
                wrap(b.team + ' · ' + b.ring, 8, inner).slice(0, 2).forEach(line => {
                    page.drawText(line, { x: x + 7, y: ly, size: 8, font, color: mute });
                    ly -= 10;
                });
                const steps = [
                    { title: 'Answered', body: b.answered, fill: true },
                    { title: 'If not', body: b.missed, fill: false },
                    { title: 'Then', body: b.then, fill: false }
                ];
                steps.forEach((step, si) => {
                    const body = wrap(step.body, 7.5, inner - 4).slice(0, 2);
                    const h = 16 + body.length * 9;
                    if (si)
                        page.drawLine({ start: { x: mid, y: ly + 6 }, end: { x: mid, y: ly - 2 }, thickness: 0.6, color: ink });
                    ly -= 4;
                    page.drawRectangle({ x: x + 6, y: ly - h + 10, width: w - 12, height: h, color: step.fill ? wash : white, borderColor: ink, borderWidth: 0.5 });
                    page.drawText(step.title, { x: x + 10, y: ly, size: 6.5, font, color: mute });
                    body.forEach((line, n) => page.drawText(line, { x: x + 10, y: ly - 10 - n * 9, size: 7.5, font, color: ink }));
                    ly -= h + 2;
                });
            });
            y = colTop - colH - 10;
        }
        const low = y;
        const third = (CONTENT - 16) / 3;
        box(M.l, low, third, 58, 'After hours', map.closed);
        box(M.l + third + 8, low, third, 58, 'Urgent path', map.urgent);
        box(M.l + 2 * (third + 8), low, third, 58, 'Before opening', map.before || 'Live hours apply — this is not an opening plan.');
        y = low - 70;
        if (map.mechanism === 'menu-digit')
            text('Digit 9 is announced on both the long and short greetings, from the same menu options as the IVR. A keypad cannot hear a spoken emergency. Life-threatening emergencies: hang up and call 911.', 9, mute);
        else if (map.mechanism === 'staff')
            text('Urgent detection happens after a person answers. The published number does not jump to on-call by itself.', 9, mute);
        else if (map.mechanism === 'assistant')
            text('Urgent classification by the virtual receptionist stays proposed until a vendor verifies it on a live call.', 9, mute);
        text('Hours: ' + (map.hours || p.hours.timezone) + '.', 8.5, faint);
        if (map.lunch)
            text(map.lunch, 8.5, faint);
        const scripts = callerHear(p).filter(row => /nobody answers|After hours|Before opening/.test(row.when)).slice(0, 3);
        if (scripts.length && y > 120) {
            gap(8);
            kicker('What a caller hears — preview, not a live call');
            scripts.forEach(row => {
                const lines = wrap(row.when + ': ' + row.hear, 8, CONTENT).slice(0, 2);
                need(lines.length * 11 + 4);
                lines.forEach(line => {
                    page.drawText(line, { x: M.l, y, size: 8, font, color: mute });
                    y -= 11;
                });
                y -= 2;
            });
        }
    };
    const drawSystem = () => {
        add();
        kicker('Page 03  ·  The system you need');
        title('People, phones, and identities are not the same number.', 18);
        const map = provisioningMap(p);
        const people = p.teams.reduce((n, t) => n + t.count, 0);
        text(people + (people === 1 ? ' employee' : ' employees') + ' on staff. That does not set how many phones to buy.', 10.5, mute);
        gap(8);
        const rows = map.groups.map(g => [
            g.label,
            String(g.deviceCount) + ' ' + deviceWord(g.device) + (g.deviceCount === 1 ? '' : 's'),
            g.sharing === 'separate' ? g.deviceCount + ' independent identities' : g.sharing === 'shared' ? '1 identity · ' + g.concurrent + ' concurrent' : 'Sharing undecided',
            g.note
        ]);
        const recShare = p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided');
        const recN = p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
        if (recShare?.sharing === 'separate' && recN > 1 && !map.groups.some(g => g.team === 'reception'))
            rows.unshift([
                'Front desk',
                'Models not chosen',
                recN + ' independent identities required',
                'Both people can pick up at once. Not a phone per room.'
            ]);
        if (p.policy.roomsSpecified && p.policy.rooms > 0)
            rows.push([
                p.policy.rooms + ' clinical rooms',
                'Placement decision needed',
                'Not automatic phones',
                p.policy.rooms + ' rooms do not automatically require ' + p.policy.rooms + ' phones. Ask whether each room needs a direct line, intercom, emergency communication, or nothing.'
            ]);
        table(
            ['Location or role', 'Devices', 'Answering identity', 'Why'],
            rows.length ? rows : [['No answering positions yet', '—', '—', 'Record devices before ordering.']],
            [110, 100, 110, 184]
        );
        gap(4);
        kicker('What this means for purchasing');
        bullets([
            'Independent answering positions are required only where two people must take different callers at the same time.',
            'Shared identity means two devices, one concurrent call — even if both screens light up.',
            'Do not order a phone per clinical room unless the workflow needs one.'
        ]);
        gap(10);
        const planned = recShare?.sharing === 'separate' && recN > 1 ? recN : 0;
        const frontNow = map.groups.filter(g => g.team === 'reception').reduce((n, g) => n + g.concurrent, 0);
        const allNow = map.groups.reduce((n, g) => n + g.concurrent, 0);
        const cards = [
            { value: String(frontNow || planned || '—'), label: 'Front-desk concurrent answers' },
            { value: p.policy.roomsSpecified ? '0 / ' + p.policy.rooms : '—', label: 'Room phones selected / rooms' },
            { value: String(allNow || planned || '—'), label: 'Independent answering positions' }
        ];
        const cardW = (CONTENT - 16) / 3;
        cards.forEach((c, i) => {
            const x = M.l + i * (cardW + 8);
            page.drawRectangle({ x, y: y - 48, width: cardW, height: 58, color: wash });
            page.drawText(c.value, { x: x + 12, y: y - 8, size: 20, font, color: ink });
            wrap(c.label, 8, cardW - 22).slice(0, 2).forEach((line, n) => {
                page.drawText(line, { x: x + 12, y: y - 26 - n * 11, size: 8, font, color: mute });
            });
        });
        y -= 62;
    };
    const drawBuy = () => {
        add();
        kicker('Page 04  ·  What to buy & compare');
        title('What you need. What you don’t. What it should cost.', 18);
        text('Quantities are requirements, not a vendor quote. Totals use only figures you enter. Missing quote lines stay blank — they are never invented.', 10, mute);
        gap(6);
        const bands = purchaseBands(p);
        const rows = [
            ...bands.required.map(r => ['Required', r.qty, r.item, r.purpose]),
            ...bands.alsoRequired.map(r => ['Required', r.qty, r.item, r.purpose]),
            ...bands.optional.map(r => ['Optional', r.qty, r.item, r.purpose]),
            ...bands.notYet.map(r => ['Not yet', r.qty, r.item, r.purpose])
        ];
        table(['Band', 'Qty', 'Item', 'Why it is here'], rows.length ? rows : [['—', '—', 'Nothing recorded', 'Finish answering positions first.']], [70, 48, 130, 256]);
        kicker('Quote worksheet — fill from the vendor, not from this planner');
        const reqPhones = bands.required.map(r => r.qty + ' ' + r.item).join('; ');
        const phoneCheck = (reqPhones || 'No physical phones recorded yet') + '. Room phones = ' + (bands.notYet.find(r => /room/i.test(r.item))?.qty || '0 selected') + '.';
        const month = bands.entered?.monthly;
        const money = (n?: number) => n ? '$' + n.toLocaleString('en-US') : 'Enter from quote';
        table(
            ['Category', 'Planner check', 'Use the quote for'],
            [
                ['Physical phones', phoneCheck, 'Does the quoted quantity match these positions?'],
                ['Software licenses', 'Included vs extra seats is a quote line, not a guess.', 'Which capabilities require additional licensing?'],
                ['Installation', 'One-time work. Not in monthly service.', 'Compare one-time costs as written.'],
                ['Monthly services', month ? money(month) + ' / mo as entered' : 'No monthly amount entered.', 'Compare recurring costs as written.'],
                ['12-month total', money(month ? month * 12 : undefined), 'Monthly × 12. Taxes and fees extra.'],
                ['24-month total', money(month ? month * 24 : undefined), 'Monthly × 24 at the entered rate.'],
                ['36-month total', money(month ? month * 36 : undefined), 'Monthly × 36 at the entered rate.'],
                ['Hidden charges', 'Not inferred.', 'Porting, hardware financing, cancellation, omitted fees.'],
                ['Missing capabilities', bands.missing[0] || 'Comparison off until you enable it.', 'Flag requirements the quote does not establish.']
            ],
            [110, 170, 224]
        );
        if (bands.entered?.notes)
            text(bands.entered.notes, 9, mute);
        if (bands.warnings.length) {
            kicker('Things worth checking before you sign');
            bullets(bands.warnings);
        }
    };
    const drawRoadmap = () => {
        add();
        kicker(p.mode === 'opening' ? 'Page 05  ·  Your opening roadmap' : 'Page 05  ·  Before you sign');
        title(p.mode === 'opening' ? 'What can start today. What is still blocked.' : 'Things worth checking before you sign.', 18);
        if (p.mode === 'opening') {
            text('Target opening: ' + prettyDate(p.policy.opening.date, p.policy.opening.precision) + '. Construction: ' + p.policy.opening.construction + '. Number porting and physical installation depend on vendors and site readiness — these dates are not guarantees. Do not cancel existing phone service before a port starts.', 10, mute);
            gap(8);
            const marks = openingRoadmap(p);
            table(
                ['Milestone', 'Window', 'Status', 'Note'],
                marks.map(m => [m.label, m.window, m.status, m.note]),
                [130, 120, 64, 190]
            );
            kicker('Hand this to the contractor');
            bullets(contractorHandoff(p).slice(1, 5));
        }
        else {
            const flags = insights(p).filter(i => i.severity !== 'note');
            if (flags.length)
                flags.forEach(insightBlock);
            else
                text('No configuration-specific overbuy or coverage gaps jumped out. Still compare any quote to the required list on page 04.', 10.5, mute);
            gap(8);
            kicker('Business continuity — planning only');
            row('Internet outage', p.policy.continuity.internet);
            row('Power failure', p.policy.continuity.power);
            row('Backup routing', p.policy.continuity.backupRouting);
            if (workMobileNoted(p))
                row('Work mobile', 'App / Follow Me. Personal number not published.');
        }
    };
    const drawDecisions = () => {
        add();
        kicker('Page 06  ·  Decisions & approvals');
        title('Owner. Provider. Live test.', 18);
        text('Answering the questionnaire does not make the practice operational. Sign after the matching tests exist on installed phones.', 10, mute);
        gap(8);
        const cols = [
            { title: 'You decide', items: ownerActions(p), empty: 'No owner policy decisions are still open.' },
            { title: 'Provider installs', items: providerRequirements(p), empty: 'No additional provider confirmations listed.' },
            { title: 'You test', items: testsBeforeOpen(p), empty: 'Still walk a real DID before first patient day.' }
        ];
        const gapX = 10;
        const colW = (CONTENT - 2 * gapX) / 3;
        const top = y;
        let bottom = y;
        cols.forEach((col, i) => {
            const x = M.l + i * (colW + gapX);
            let ly = top;
            tracked(col.title.toUpperCase(), x, ly, 7, 0.7, mute);
            ly -= 16;
            page.drawLine({ start: { x, y: ly + 8 }, end: { x: x + colW, y: ly + 8 }, thickness: 0.4, color: hair });
            const shown = col.items.slice(0, 8);
            if (!shown.length) {
                wrap(col.empty, 8, colW).forEach(line => {
                    page.drawText(line, { x, y: ly, size: 8, font, color: mute });
                    ly -= 11;
                });
            }
            shown.forEach(item => {
                const lines = wrap(item.label, 8, colW - 10).slice(0, 3);
                page.drawCircle({ x: x + 2, y: ly + 3, size: 1.1, color: ink });
                lines.forEach(line => {
                    page.drawText(line, { x: x + 10, y: ly, size: 8.5, font, color: ink });
                    ly -= 11;
                });
                ly -= 6;
            });
            if (col.items.length > shown.length) {
                page.drawText('+' + (col.items.length - shown.length) + ' more in the implementation spec', { x, y: ly, size: 7.5, font, color: mute });
                ly -= 12;
            }
            bottom = Math.min(bottom, ly);
        });
        y = bottom - 18;
        kicker('Sign-off — matching checksum ' + identity(p).checksum);
        text('Owner _______________  Date __________  Call handling and quantities.', 9, mute);
        text('Provider _______________  Date __________  Install matches this plan.', 9, mute);
        text('Acceptance test _______________  Date __________  Live DID, two-call, on-call if selected.', 9, mute);
        gap(8);
        text('Plan ' + stamp(p) + '  ·  upstateipvoice.com/review', 8.5, faint);
        text('Hand this blueprint to any provider. The implementation spec must show this same checksum.', 8.5, faint);
    };
    const paintBlocks = (blocks: [string, string[]][]) => {
        for (const [heading, lines] of blocks) {
            if (y < 160)
                add();
            kicker(heading);
            const defs = lines.filter(l => /^[^:]{2,42}: /.test(l));
            const rest = lines.filter(l => !defs.includes(l));
            for (const line of defs) {
                const i = line.indexOf(': ');
                row(line.slice(0, i), line.slice(i + 2));
            }
            if (rest.length)
                bullets(rest.slice(0, 40));
            gap(10);
        }
    };
    const drawEngineer = () => {
        add();
        kicker('Technical implementation specification');
        title('Build, test, verify.', 24);
        text('Optional Upstate FusionPBX reference. It must match owner ' + id.planId + ' revision ' + id.revision + ' checksum ' + id.checksum + '.', 10.5, mute);
        gap(8);
        const build = fusionBuild(p);
        if (build.parity.length) {
            kicker('Parity failures — do not provision');
            bullets(build.parity);
            gap(8);
        }
        if (build.blockers.length) {
            kicker('Do not provision until resolved');
            bullets(build.blockers);
            gap(8);
        }
        kicker('Install checklist');
        bullets(build.checklist);
        gap(10);
        kicker('Extension directory');
        const dir = directory(p);
        const recShare = p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided');
        const recN = p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
        const dirRows = dir.map(d => [
            d.label,
            `${d.count} ${deviceWord(d.device)} · ${d.access}`,
            sharingWord(d.sharing) + (d.suggested ? ' · suggested' : ''),
            d.extension,
            String(d.concurrent)
        ]);
        if (recShare?.sharing === 'separate' && recN > 1 && !dir.some(d => d.team === 'reception'))
            dirRows.unshift([
                'Front desk',
                'Models not chosen',
                'Separate identities',
                String(p.policy.extensionBase),
                String(recN)
            ]);
        table(
            ['Place', 'Positions', 'Sharing', 'Ext', 'Concurrent'],
            dirRows.length ? dirRows : [['No assignments', '—', '—', '—', '—']],
            [130, 140, 118, 50, 70]
        );
        const skip = new Set(['Technical implementation specification', 'Extension directory (implementation)', 'Fusion implementation checklist']);
        paintBlocks(engineerSections(p).filter(([heading]) => !skip.has(heading)));
        gap(8);
        kicker('Unresolved implementation parameters');
        actionList(providerRequirements(p), 'No unresolved provider parameters listed. Live tests remain on the owner blueprint.');
        gap(6);
        text('Draft until every required implementation parameter is resolved. This file does not invent defaults for unspecified policy.', 9, faint);
    };
    if (part !== 'engineer') {
        kind = 'owner';
        drawGlance();
        drawCalls();
        drawSystem();
        drawBuy();
        drawRoadmap();
        drawDecisions();
    }
    if (part !== 'owner') {
        kind = 'engineer';
        drawEngineer();
    }
    const pages = doc.getPages();
    pages.forEach((pg, i) => {
        pg.drawLine({ start: { x: M.l, y: 36 }, end: { x: PAGE.w - M.r, y: 36 }, thickness: 0.4, color: hair });
        const mark = stamp(p);
        pg.drawText(mark, { x: M.l, y: 22, size: 7.5, font, color: faint });
        const nums = `${i + 1}  /  ${pages.length}`;
        pg.drawText(nums, { x: PAGE.w - M.r - font.widthOfTextAtSize(nums, 8), y: 22, size: 8, font, color: faint });
    });
    doc.setTitle((p.name || 'Practice') + (part === 'engineer' ? ' · implementation spec' : ' · owner blueprint'));
    doc.setAuthor('Upstate IP Voice');
    doc.setSubject('Plan ' + id.planId + ' revision ' + id.revision + ' checksum ' + id.checksum);
    doc.setKeywords(['Upstate IP Voice', 'practice communications', id.planId, id.checksum]);
    return doc.save();
}

function drawLogo(page: PDFPage, x: number, y: number, width: number, image?: PDFImage) {
    if (image) {
        const h = width * (image.height / image.width);
        page.drawImage(image, { x, y: y - h + 16, width, height: h });
        return;
    }
    const h = width * 0.22;
    page.drawRectangle({ x, y: y - h + 16, width: h, height: h, color: ink });
    page.drawText('UPSTATE', { x: x + h + 8, y: y + 2, size: Math.max(9, width * 0.09), color: ink });
    page.drawText('IP VOICE', { x: x + h + 8, y: y - 10, size: Math.max(9, width * 0.09), color: ink });
}

export async function createPairedPDFs(p: Plan, fontBytes?: ArrayBuffer, assets?: { logo?: ArrayBuffer }) {
    const snap = structuredClone(p);
    assertSameIdentity(snap, snap);
    const id = identity(snap);
    const owner = await createPDF(snap, fontBytes, 'owner', assets);
    const engineer = await createPDF(snap, fontBytes, 'engineer', assets);
    if (identity(snap).checksum !== id.checksum)
        throw new Error('Configuration changed during export. Owner and engineer artifacts would not match.');
    return { owner, engineer, identity: id };
}

async function download(p: Plan, part: Part, name: string) {
    const snap = structuredClone(p);
    const data = part === 'both'
        ? (await (async () => {
            const pair = await createPairedPDFs(snap);
            const merged = await PDFDocument.create();
            const o = await PDFDocument.load(pair.owner);
            const e = await PDFDocument.load(pair.engineer);
            const ownerPages = await merged.copyPages(o, o.getPageIndices());
            const engPages = await merged.copyPages(e, e.getPageIndices());
            ownerPages.forEach(pg => merged.addPage(pg));
            engPages.forEach(pg => merged.addPage(pg));
            merged.setSubject('Plan ' + pair.identity.planId + ' revision ' + pair.identity.revision + ' checksum ' + pair.identity.checksum);
            return merged.save();
        })())
        : await createPDF(snap, undefined, part);
    const url = URL.createObjectURL(new Blob([new Uint8Array(data)], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
}
export async function downloadPDF(p: Plan) { await download(p, 'owner', `upstate-blueprint-${p.planId}-r${p.revision}.pdf`); }
export async function downloadEngineerPDF(p: Plan) { await download(p, 'engineer', `upstate-implementation-${p.planId}-r${p.revision}.pdf`); }
export async function downloadBothPDF(p: Plan) { await download(p, 'both', `upstate-plan-${p.planId}-r${p.revision}.pdf`); }
