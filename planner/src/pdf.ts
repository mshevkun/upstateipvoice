import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { type Plan } from './config';
import { identity } from './advisor';
import { ownerBrief, type BriefBlock, type BriefPage } from './owner-brief';
import { engineerBrief } from './engineer-brief';
export { sections, ownerSections, engineerSections } from './plan-content';

type Part = 'owner' | 'engineer' | 'both';

const PAGE = { w: 612, h: 792 };
const M = { l: 54, r: 54, t: 58, b: 48 };
const CONTENT = PAGE.w - M.l - M.r;
const ink = rgb(19 / 255, 19 / 255, 19 / 255);
const mute = rgb(68 / 255, 74 / 255, 70 / 255);
const faint = rgb(120 / 255, 116 / 255, 108 / 255);
const hair = rgb(228 / 255, 223 / 255, 216 / 255);
const wash = rgb(236 / 255, 242 / 255, 241 / 255);
const paper = rgb(248 / 255, 247 / 255, 243 / 255);
const teal = rgb(66 / 255, 110 / 255, 105 / 255);

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
    let page: PDFPage, y = 0, kind: 'owner' | 'engineer' = 'owner', freeze = false, cover = false;
    const pageKinds: Array<'owner' | 'engineer'> = [];
    const tracked = (value: string, x: number, at: number, size: number, tracking: number, color: ReturnType<typeof rgb>) => {
        let cx = x;
        for (const ch of safe(value)) {
            page.drawText(ch, { x: cx, y: at, size, font, color });
            cx += font.widthOfTextAtSize(ch, size) + tracking;
        }
    };
    const add = (header = true) => {
        page = doc.addPage([PAGE.w, PAGE.h]);
        pageKinds.push(kind);
        page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: paper });
        page.drawRectangle({ x: 0, y: PAGE.h - 4, width: PAGE.w, height: 4, color: teal });
        if (header) {
            drawLogo(page, M.l, PAGE.h - 42, 118, logo);
            const label = kind === 'owner' ? 'OWNER BLUEPRINT' : 'IMPLEMENTATION SPEC';
            const lw = font.widthOfTextAtSize(label, 7.5);
            page.drawText(label, { x: PAGE.w - M.r - lw, y: PAGE.h - 34, size: 7.5, font, color: teal });
            page.drawLine({ start: { x: M.l, y: PAGE.h - 52 }, end: { x: PAGE.w - M.r, y: PAGE.h - 52 }, thickness: 0.55, color: hair });
            y = PAGE.h - 78;
        }
        else
            y = PAGE.h - M.t;
    };
    const need = (h: number) => {
        if (freeze)
            return y - h >= M.b + 8;
        if (y - h < M.b + 10)
            add();
        return true;
    };
    const pointWidths = (widths: number[]) => {
        const sum = widths.reduce((n, w) => n + w, 0);
        if (sum <= 0)
            return widths;
        // Always fit the content width — raw pixel totals used to overflow and smash columns.
        return widths.map(w => Math.max(18, Math.round((w / sum) * CONTENT)));
    };
    const wrap = (text: string, size: number, width = CONTENT) => {
        text = safe(text);
        const lines: string[] = [];
        // Prefer keeping *.wav intact when it fits; otherwise break so table columns never smash.
        const tokens = (block: string) => {
            const out: string[] = [];
            const re = /\S+/g;
            let m: RegExpExecArray | null;
            while ((m = re.exec(block)))
                out.push(m[0]);
            return out;
        };
        for (const block of text.split('\n')) {
            let line = '';
            for (const word of tokens(block)) {
                const next = line ? line + ' ' + word : word;
                if (font.widthOfTextAtSize(next, size) <= width) {
                    line = next;
                    continue;
                }
                if (line)
                    lines.push(line);
                if (font.widthOfTextAtSize(word, size) <= width) {
                    line = word;
                    continue;
                }
                line = '';
                for (const ch of word) {
                    if (font.widthOfTextAtSize(line + ch, size) > width) {
                        if (line)
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
        if (!need(lines.length * size * leading + 2))
            return;
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
        if (!need(28))
            return;
        tracked(value.toUpperCase(), M.l, y, 8, 0.35, teal);
        y -= 24;
    };
    const title = (value: string, size = 22) => {
        const lines = wrap(value, size, CONTENT - 8);
        need(lines.length * size * 1.12 + 8);
        for (const line of lines) {
            page.drawText(line, { x: M.l, y, size, font, color: ink });
            y -= size * 1.12;
        }
        gap(kind === 'engineer' ? 8 : 6);
    };
    const table = (headers: string[], rows: string[][], widths: number[]) => {
        const cols = pointWidths(widths);
        const shop = kind === 'engineer';
        const drawHead = () => {
            const headH = shop ? 22 : 18;
            if (freeze) {
                if (y - headH < M.b + 8)
                    throw new Error('PDF table header would print below the footer');
            }
            else if (y - headH < M.b + 28)
                add();
            page.drawRectangle({ x: M.l - 2, y: y - (shop ? 8 : 6), width: CONTENT + 4, height: headH, color: shop ? teal : wash });
            let x = M.l;
            headers.forEach((h, i) => {
                page.drawText(safe(h).toUpperCase(), { x, y, size: shop ? 8 : 7.5, font, color: shop ? paper : mute });
                x += cols[i];
            });
            y -= shop ? 20 : 16;
            if (!shop)
                page.drawLine({ start: { x: M.l, y: y + 8 }, end: { x: PAGE.w - M.r, y: y + 8 }, thickness: 0.4, color: hair });
        };
        drawHead();
        // Directory Password/MAC write-ins need real row height; hours tables get air. Path/tests stay dense.
        const writeIn = shop && headers.some(h => /password|mac/i.test(h));
        const hoursLike = shop && headers.some(h => /clock|minutes/i.test(h));
        rows.forEach((r, rowIndex) => {
            const lineH = shop ? 13.5 : 12;
            const cellSize = shop ? 9.5 : 9;
            const wrapped = r.map((cell, i) => wrap(cell, cellSize, Math.max(24, cols[i] - 8)));
            const minRow = writeIn ? 38 : (hoursLike ? 26 : (shop ? 22 : 16));
            const h = Math.max(minRow, ...wrapped.map(w => w.length * lineH));
            const rowPad = writeIn ? 14 : (hoursLike ? 12 : (shop ? 10 : 6));
            if (freeze) {
                if (y - (h + 8) < M.b + 8)
                    throw new Error('PDF table row would print below the footer');
            }
            else if (y - (h + rowPad) < M.b + 10) {
                add();
                drawHead();
            }
            let x = M.l;
            wrapped.forEach((lines, i) => {
                lines.forEach((line, n) => page.drawText(line, { x, y: y - n * lineH, size: cellSize, font, color: ink }));
                x += cols[i];
            });
            y -= h + rowPad;
            if (rowIndex < rows.length - 1 && (shop || rowIndex % 2 === 1))
                page.drawLine({ start: { x: M.l, y: y + (shop ? 12 : 10) }, end: { x: PAGE.w - M.r, y: y + (shop ? 12 : 10) }, thickness: 0.25, color: hair });
        });
        gap(shop ? 12 : 8);
    };
    const drawBlock = (block: BriefBlock) => {
        if (block.kind === 'prose') {
            text(block.text, 11, ink);
            gap(10);
            return;
        }
        if (block.kind === 'kicker') {
            if (!need(28))
                return;
            // Engineer: more air before section kickers so sparse pages don't dump all empty space at the footer.
            gap(cover ? 22 : (kind === 'owner' ? 12 : 16));
            tracked(block.text.toUpperCase(), M.l, y, 7.5, 0.3, teal);
            y -= cover ? 22 : (kind === 'owner' ? 20 : 18);
            return;
        }
        if (block.kind === 'note') {
            const lines = block.text.split('\n');
            if (lines.length > 1 && /_{6,}/.test(block.text)) {
                for (const line of lines) {
                    if (!need(28))
                        return;
                    const parts = line.split(/_{6,}/);
                    if (parts.length === 1) {
                        text(line, 9.5, faint);
                        continue;
                    }
                    page.drawText(safe(parts[0].trimEnd()), { x: M.l, y, size: 10, font, color: mute });
                    const labelW = font.widthOfTextAtSize(safe(parts[0].trimEnd()), 10);
                    page.drawLine({
                        start: { x: M.l + labelW + 8, y: y - 1 },
                        end: { x: Math.min(PAGE.w - M.r, M.l + labelW + 210), y: y - 1 },
                        thickness: 0.7,
                        color: ink
                    });
                    const dateBit = parts[parts.length - 1].trim();
                    if (/date/i.test(dateBit) || parts.length > 2) {
                        const dateX = PAGE.w - M.r - 120;
                        page.drawText('Date', { x: dateX, y, size: 10, font, color: mute });
                        page.drawLine({ start: { x: dateX + 28, y: y - 1 }, end: { x: PAGE.w - M.r, y: y - 1 }, thickness: 0.7, color: ink });
                    }
                    y -= 26;
                }
                gap(6);
                return;
            }
            text(block.text, 9.5, faint);
            gap(cover ? 16 : (kind === 'engineer' ? 12 : 8));
            return;
        }
        if (block.kind === 'stats') {
            const n = Math.max(1, Math.min(2, block.items.length));
            const items = block.items.slice(0, n);
            const gutter = n === 1 ? 0 : (kind === 'engineer' ? 36 : 48);
            const col = (CONTENT - gutter * (n - 1)) / n;
            // Engineer path page: compact stats so the call-path table owns the page without a dead band under the numbers.
            const numSize = freeze ? 28 : (kind === 'engineer' ? 26 : 34);
            const cardH = freeze ? 70 : (kind === 'engineer' ? 54 : 84);
            const labelDrop = freeze ? 30 : (kind === 'engineer' ? 28 : 36);
            const noteDrop = freeze ? 46 : (kind === 'engineer' ? 42 : 52);
            if (!need(cardH + 18))
                return;
            items.forEach((m, i) => {
                const x = M.l + i * (col + gutter);
                page.drawText(safe(m.value), { x, y, size: numSize, font, color: ink });
                wrap(m.label, 10, col - 12).slice(0, 1).forEach(line => {
                    page.drawText(line, { x, y: y - labelDrop, size: 10, font, color: ink });
                });
                wrap(m.note, 8.5, col - 12).slice(0, 2).forEach((line, n) => {
                    page.drawText(line, { x, y: y - noteDrop - n * 12, size: 8.5, font, color: mute });
                });
            });
            y -= cardH;
            page.drawLine({ start: { x: M.l, y: y + 10 }, end: { x: PAGE.w - M.r, y: y + 10 }, thickness: 0.45, color: hair });
            y -= cover ? 22 : (kind === 'engineer' ? 12 : 14);
            return;
        }
        if (block.kind === 'hours') {
            for (const row of block.items) {
                if (!need(22))
                    return;
                page.drawText(safe(row.label), { x: M.l, y, size: 10, font, color: mute });
                page.drawText(safe(row.value), { x: M.l + 96, y, size: 10.5, font, color: ink });
                y -= cover ? 24 : (kind === 'owner' ? 20 : 17);
            }
            gap(cover ? 18 : (kind === 'owner' ? 12 : 8));
            return;
        }
        if (block.kind === 'moments') {
            for (const item of block.items) {
                const body = wrap(item.happen, 10.5, CONTENT);
                if (!need(18 + body.length * 14.5 + 10))
                    return;
                tracked(item.when.toUpperCase(), M.l, y, 7.5, 0.25, teal);
                y -= cover ? 18 : 16;
                for (const line of body) {
                    page.drawText(line, { x: M.l, y, size: 10.5, font, color: ink });
                    y -= cover ? 15.5 : 14.5;
                }
                y -= cover ? 20 : (kind === 'owner' ? 14 : 8);
            }
            gap(cover ? 10 : 6);
            return;
        }
        if (block.kind === 'scripts') {
            for (const item of block.items) {
                // Engineer recordings: filename-first card — usedBy + wording, not a dump.
                if (kind === 'engineer') {
                    const hear = wrap(item.hear, 9.5, CONTENT - 22).slice(0, 5);
                    const labelH = 14;
                    const padTop = 9;
                    const padBot = 11;
                    const lineH = 12.8;
                    const cardH = padTop + labelH + hear.length * lineH + padBot;
                    if (!need(cardH + 10))
                        return;
                    const top = y + 3;
                    page.drawRectangle({
                        x: M.l - 4,
                        y: top - cardH + 4,
                        width: CONTENT + 8,
                        height: cardH,
                        color: wash
                    });
                    page.drawRectangle({
                        x: M.l - 4,
                        y: top - cardH + 4,
                        width: 2.5,
                        height: cardH,
                        color: teal
                    });
                    page.drawText(safe(item.when), { x: M.l + 12, y, size: 10.5, font, color: ink });
                    y -= labelH;
                    for (const line of hear) {
                        page.drawText(line, { x: M.l + 12, y, size: 9.5, font, color: mute });
                        y -= lineH;
                    }
                    y = top - cardH - 10;
                    continue;
                }
                // Owner: one script card — wash + teal rule, room between moments (not a dump).
                let size = freeze ? 9.5 : 10.5;
                let lineH = freeze ? 12.5 : 14;
                let maxLines = freeze ? 5 : 6;
                let hear = wrap(item.hear, size, CONTENT - 22).slice(0, maxLines);
                if (freeze && hear.join(' ').replace(/\s+/g, ' ').length < Math.min(60, item.hear.length)) {
                    size = 9;
                    lineH = 11.5;
                    maxLines = 6;
                    hear = wrap(item.hear, size, CONTENT - 22).slice(0, maxLines);
                }
                const padTop = 10;
                const padBot = 12;
                const labelH = 14;
                let cardH = padTop + labelH + hear.length * lineH + padBot;
                if (!need(cardH + 10) && freeze) {
                    size = 9;
                    lineH = 11.5;
                    hear = wrap(item.hear, size, CONTENT - 22).slice(0, Math.max(2, Math.min(hear.length, 3)));
                    cardH = padTop + labelH + hear.length * lineH + padBot;
                }
                if (!need(cardH + 6)) {
                    if (!freeze)
                        return;
                    const one = wrap(item.hear, 9, CONTENT - 22).slice(0, 2);
                    if (!need(36))
                        continue;
                    page.drawRectangle({ x: M.l, y: y - 28, width: 2.5, height: 30, color: teal });
                    tracked(item.when.toUpperCase(), M.l + 12, y, 7, 0.2, teal);
                    y -= 13;
                    for (const line of one) {
                        page.drawText(line, { x: M.l + 12, y, size: 9, font, color: ink });
                        y -= 11.5;
                    }
                    y -= 10;
                    continue;
                }
                const top = y + 4;
                page.drawRectangle({
                    x: M.l - 4,
                    y: top - cardH + 6,
                    width: CONTENT + 8,
                    height: cardH,
                    color: wash
                });
                page.drawRectangle({
                    x: M.l - 4,
                    y: top - cardH + 6,
                    width: 2.5,
                    height: cardH,
                    color: teal
                });
                tracked(item.when.toUpperCase(), M.l + 12, y, freeze ? 7 : 7.5, 0.22, teal);
                y -= labelH;
                for (const line of hear) {
                    page.drawText(line, { x: M.l + 12, y, size, font, color: ink });
                    y -= lineH;
                }
                y = top - cardH - 8;
            }
            gap(8);
            return;
        }
        if (block.kind === 'rows') {
            // Keep a fixed gutter — labels like "8000 · time condition" must never collide with values.
            const labelCol = kind === 'engineer' ? 138 : 130;
            const valueX = kind === 'engineer' ? 152 : 146;
            const valueW = CONTENT - (kind === 'engineer' ? 156 : 150);
            const valueLead = kind === 'engineer' ? 14.5 : 14;
            block.items.forEach((item, index) => {
                const labels = wrap(item.label, 9.5, labelCol - 6);
                const values = wrap(item.value, 10.5, valueW);
                const h = Math.max(labels.length * 12, values.length * valueLead);
                const rowGap = kind === 'owner' ? 14 : 15;
                if (!need(h + rowGap + 4))
                    return;
                labels.forEach((line, i) => page.drawText(line, { x: M.l, y: y - i * 12, size: 9.5, font, color: mute }));
                values.forEach((line, i) => page.drawText(line, { x: valueX, y: y - i * valueLead, size: 10.5, font, color: ink }));
                y -= h + rowGap;
                if (index < block.items.length - 1)
                    page.drawLine({ start: { x: M.l, y: y + rowGap - 5 }, end: { x: PAGE.w - M.r, y: y + rowGap - 5 }, thickness: 0.25, color: hair });
            });
            gap(kind === 'owner' ? 12 : 10);
            return;
        }
        if (block.kind === 'steps') {
            for (const item of block.items) {
                const note = wrap(item.note, 9.5, CONTENT - 18).slice(0, 3);
                if (!need(32 + note.length * 12.5))
                    return;
                page.drawCircle({ x: M.l + 2.5, y: y + 3, size: 2, color: teal });
                page.drawText(safe(item.label), { x: M.l + 14, y, size: 11, font, color: ink });
                y -= 15;
                page.drawText(safe(item.window), { x: M.l + 14, y, size: 8.5, font, color: teal });
                y -= 14;
                for (const line of note) {
                    page.drawText(line, { x: M.l + 14, y, size: 9.5, font, color: mute });
                    y -= 12.5;
                }
                y -= kind === 'owner' ? 12 : 8;
            }
            return;
        }
        if (block.kind === 'table') {
            table(block.headers, block.rows, block.widths);
            return;
        }
        if (block.kind === 'checks' || block.kind === 'list') {
            const lead = kind === 'engineer' ? 14.5 : 14;
            const itemGap = kind === 'owner' ? 8 : (block.kind === 'checks' ? 14 : 12);
            for (const item of block.items) {
                const lines = wrap(item, 10.5, CONTENT - 22);
                if (!need(lines.length * lead + itemGap + 4))
                    return;
                if (block.kind === 'checks')
                    page.drawRectangle({
                        x: M.l,
                        y: y,
                        width: 10,
                        height: 10,
                        borderColor: teal,
                        borderWidth: 1,
                        color: paper
                    });
                else
                    page.drawCircle({ x: M.l + 2.5, y: y + 3, size: 2, color: teal });
                let ly = y;
                for (const line of lines) {
                    page.drawText(line, { x: M.l + 18, y: ly, size: 10.5, font, color: ink });
                    ly -= lead;
                }
                y = ly - itemGap;
            }
            gap(kind === 'owner' ? 8 : 8);
        }
    };
    const drawBrief = (pages: BriefPage[]) => {
        for (const pg of pages) {
            cover = kind === 'owner' && pg.kicker.includes('01');
            add();
            kicker(pg.kicker);
            title(pg.title, cover ? 28 : (kind === 'owner' ? 20 : (pg.kicker.includes('01') ? 24 : 20)));
            if (pg.lede) {
                text(pg.lede, 11, mute);
                const next = pg.blocks[0]?.kind;
                // Engineer: slightly more title→body air so Directory / Hours / Build don't feel glued under the lede.
                gap(next === 'stats'
                    ? (cover ? 28 : (kind === 'engineer' ? 18 : 22))
                    : (cover ? 18 : (kind === 'owner' ? 16 : 14)));
            }
            for (const block of pg.blocks)
                drawBlock(block);
            cover = false;
        }
    };
    if (part !== 'engineer') {
        kind = 'owner';
        freeze = true;
        drawBrief(ownerBrief(p));
        freeze = false;
    }
    if (part !== 'owner') {
        kind = 'engineer';
        freeze = false;
        drawBrief(engineerBrief(p));
    }
    const pages = doc.getPages();
    pages.forEach((pg, i) => {
        const pageKind = pageKinds[i] || kind;
        pg.drawLine({ start: { x: M.l, y: 36 }, end: { x: PAGE.w - M.r, y: 36 }, thickness: 0.45, color: hair });
        const locked = !!(p.lock && p.lock.checksum === id.checksum);
        const mark = (locked ? 'LOCKED ' : pageKind === 'engineer' ? 'DRAFT — do not build · ' : 'Draft ') + stamp(p);
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
