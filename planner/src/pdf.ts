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
const mute = rgb(92 / 255, 99 / 255, 93 / 255);
const faint = rgb(138 / 255, 132 / 255, 124 / 255);
const hair = rgb(228 / 255, 223 / 255, 216 / 255);
const wash = rgb(248 / 255, 249 / 255, 251 / 255);
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
    let page: PDFPage, y = 0, kind: 'owner' | 'engineer' = 'owner', freeze = false;
    const tracked = (value: string, x: number, at: number, size: number, tracking: number, color: ReturnType<typeof rgb>) => {
        let cx = x;
        for (const ch of safe(value)) {
            page.drawText(ch, { x: cx, y: at, size, font, color });
            cx += font.widthOfTextAtSize(ch, size) + tracking;
        }
    };
    const add = (header = true) => {
        page = doc.addPage([PAGE.w, PAGE.h]);
        page.drawRectangle({ x: 0, y: 0, width: PAGE.w, height: PAGE.h, color: paper });
        page.drawRectangle({ x: 0, y: PAGE.h - 4, width: PAGE.w, height: 4, color: teal });
        if (header) {
            drawLogo(page, M.l, PAGE.h - 42, 118, logo);
            const label = kind === 'owner' ? 'OWNER BLUEPRINT' : 'IMPLEMENTATION SPEC';
            const lw = font.widthOfTextAtSize(label, 7.5);
            page.drawText(label, { x: PAGE.w - M.r - lw, y: PAGE.h - 34, size: 7.5, font, color: teal });
            page.drawLine({ start: { x: M.l, y: PAGE.h - 52 }, end: { x: PAGE.w - M.r, y: PAGE.h - 52 }, thickness: 0.4, color: hair });
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
        if (sum > 0 && sum <= 120)
            return widths.map(w => Math.round((w / sum) * CONTENT));
        return widths;
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
        gap(4);
    };
    const table = (headers: string[], rows: string[][], widths: number[]) => {
        const cols = pointWidths(widths);
        const drawHead = () => {
            const headH = 18;
            if (freeze) {
                if (y - headH < M.b + 8)
                    throw new Error('PDF table header would print below the footer');
            }
            else if (y - headH < M.b + 28)
                add();
            page.drawRectangle({ x: M.l - 2, y: y - 6, width: CONTENT + 4, height: headH, color: wash });
            let x = M.l;
            headers.forEach((h, i) => {
                page.drawText(safe(h).toUpperCase(), { x, y, size: 7.5, font, color: mute });
                x += cols[i];
            });
            y -= 16;
            page.drawLine({ start: { x: M.l, y: y + 8 }, end: { x: PAGE.w - M.r, y: y + 8 }, thickness: 0.4, color: hair });
        };
        drawHead();
        for (const r of rows) {
            const wrapped = r.map((cell, i) => wrap(cell, 9, Math.max(24, cols[i] - 8)));
            const h = Math.max(16, ...wrapped.map(w => w.length * 12));
            if (freeze) {
                if (y - (h + 8) < M.b + 8)
                    throw new Error('PDF table row would print below the footer');
            }
            else if (y - (h + 8) < M.b + 10) {
                add();
                drawHead();
            }
            let x = M.l;
            wrapped.forEach((lines, i) => {
                lines.forEach((line, n) => page.drawText(line, { x, y: y - n * 12, size: 9, font, color: ink }));
                x += cols[i];
            });
            y -= h + 6;
            page.drawLine({ start: { x: M.l, y: y + 10 }, end: { x: PAGE.w - M.r, y: y + 10 }, thickness: 0.3, color: hair });
        }
        gap(8);
    };
    const drawBlock = (block: BriefBlock) => {
        if (block.kind === 'prose') {
            text(block.text, 11, ink);
            gap(10);
            return;
        }
        if (block.kind === 'kicker') {
            if (!need(22))
                return;
            gap(6);
            tracked(block.text.toUpperCase(), M.l, y, 7.5, 0.3, teal);
            y -= 18;
            return;
        }
        if (block.kind === 'note') {
            text(block.text, 9.5, faint);
            gap(8);
            return;
        }
        if (block.kind === 'stats') {
            const n = Math.max(1, block.items.length);
            const gutter = n === 1 ? 0 : n === 2 ? 64 : 36;
            const col = (CONTENT - gutter * (n - 1)) / n;
            const numSize = 40;
            const cardH = 92;
            if (!need(cardH + 24))
                return;
            block.items.forEach((m, i) => {
                const x = M.l + i * (col + gutter);
                page.drawText(safe(m.value), { x, y, size: numSize, font, color: ink });
                wrap(m.label, 9.5, col - 12).slice(0, 1).forEach(line => {
                    page.drawText(line, { x, y: y - 40, size: 9.5, font, color: ink });
                });
                wrap(m.note, 8.5, col - 12).slice(0, 2).forEach((line, n) => {
                    page.drawText(line, { x, y: y - 56 - n * 12, size: 8.5, font, color: mute });
                });
                if (i < block.items.length - 1) {
                    const divX = x + col + gutter / 2;
                    page.drawLine({ start: { x: divX, y: y - 60 }, end: { x: divX, y: y + 24 }, thickness: 0.4, color: hair });
                }
            });
            y -= cardH + 6;
            page.drawLine({ start: { x: M.l, y: y + 14 }, end: { x: PAGE.w - M.r, y: y + 14 }, thickness: 0.4, color: hair });
            y -= 16;
            return;
        }
        if (block.kind === 'hours') {
            for (const row of block.items) {
                if (!need(18))
                    return;
                page.drawText(safe(row.label), { x: M.l, y, size: 10, font, color: mute });
                page.drawText(safe(row.value), { x: M.l + 96, y, size: 10.5, font, color: ink });
                y -= 17;
            }
            gap(8);
            return;
        }
        if (block.kind === 'moments') {
            for (const item of block.items) {
                const body = wrap(item.happen, 10.5, CONTENT);
                if (!need(18 + body.length * 14.5 + 10))
                    return;
                tracked(item.when.toUpperCase(), M.l, y, 7.5, 0.25, teal);
                y -= 16;
                for (const line of body) {
                    page.drawText(line, { x: M.l, y, size: 10.5, font, color: ink });
                    y -= 14.5;
                }
                gap(4);
                page.drawLine({ start: { x: M.l, y: y + 8 }, end: { x: PAGE.w - M.r, y: y + 8 }, thickness: 0.4, color: hair });
                y -= 8;
            }
            gap(6);
            return;
        }
        if (block.kind === 'scripts') {
            for (const item of block.items) {
                const hear = wrap(item.hear, 10, CONTENT - 22).slice(0, 4);
                const h = 28 + hear.length * 13.5;
                if (!need(h + 12))
                    return;
                page.drawRectangle({ x: M.l, y: y - h + 16, width: 2.2, height: h - 4, color: teal });
                tracked(item.when.toUpperCase(), M.l + 16, y, 7.5, 0.25, teal);
                y -= 15;
                for (const line of hear) {
                    page.drawText(line, { x: M.l + 16, y, size: 10, font, color: ink });
                    y -= 13.5;
                }
                y -= 14;
            }
            gap(4);
            return;
        }
        if (block.kind === 'rows') {
            for (const item of block.items) {
                const labels = wrap(item.label, 9, 130);
                const values = wrap(item.value, 10.5, CONTENT - 150);
                const h = Math.max(labels.length * 12, values.length * 14);
                if (!need(h + 12))
                    return;
                labels.forEach((line, i) => page.drawText(line, { x: M.l, y: y - i * 12, size: 9, font, color: mute }));
                values.forEach((line, i) => page.drawText(line, { x: M.l + 146, y: y - i * 14, size: 10.5, font, color: ink }));
                y -= h + 8;
                page.drawLine({ start: { x: M.l, y: y + 10 }, end: { x: PAGE.w - M.r, y: y + 10 }, thickness: 0.3, color: hair });
            }
            gap(8);
            return;
        }
        if (block.kind === 'steps') {
            for (const item of block.items) {
                const note = wrap(item.note, 9.5, CONTENT - 18).slice(0, 3);
                if (!need(28 + note.length * 12.5))
                    return;
                page.drawCircle({ x: M.l + 2.5, y: y + 3, size: 2, color: teal });
                page.drawText(safe(item.label), { x: M.l + 14, y, size: 11, font, color: ink });
                y -= 14;
                page.drawText(safe(item.window), { x: M.l + 14, y, size: 8.5, font, color: teal });
                y -= 13;
                for (const line of note) {
                    page.drawText(line, { x: M.l + 14, y, size: 9.5, font, color: mute });
                    y -= 12.5;
                }
                y -= 8;
            }
            return;
        }
        if (block.kind === 'table') {
            table(block.headers, block.rows, block.widths);
            return;
        }
        if (block.kind === 'checks' || block.kind === 'list') {
            for (const item of block.items) {
                const lines = wrap(item, 10.5, CONTENT - 18);
                if (!need(lines.length * 14 + 6))
                    return;
                if (block.kind === 'checks')
                    page.drawRectangle({ x: M.l, y: y + 1, width: 7, height: 7, borderColor: teal, borderWidth: 0.8, color: paper });
                else
                    page.drawCircle({ x: M.l + 2.5, y: y + 3, size: 2, color: teal });
                let ly = y;
                for (const line of lines) {
                    page.drawText(line, { x: M.l + 16, y: ly, size: 10.5, font, color: ink });
                    ly -= 14;
                }
                y = ly - 4;
            }
            gap(6);
        }
    };
    const drawBrief = (pages: BriefPage[]) => {
        for (const pg of pages) {
            add();
            kicker(pg.kicker);
            title(pg.title, pg.kicker.includes('01') ? 26 : 22);
            if (pg.lede) {
                text(pg.lede, 11, mute);
                const next = pg.blocks[0]?.kind;
                gap(next === 'stats' ? 28 : (pg.kicker.includes('01') ? 18 : 12));
            }
            for (const block of pg.blocks)
                drawBlock(block);
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
        pg.drawLine({ start: { x: M.l, y: 36 }, end: { x: PAGE.w - M.r, y: 36 }, thickness: 0.4, color: hair });
        const mark = (p.lock && p.lock.checksum === id.checksum ? 'LOCKED ' : kind === 'engineer' ? 'DRAFT — do not build · ' : 'Draft ') + stamp(p);
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
