import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type Day, type Plan } from './config';
import { applyHoursPreset, formatTime } from './flow';
import { Cards, Field, Later } from './components';

const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const minuteSteps = ['00', '15', '30', '45'];

function pad(n: number) { return String(n).padStart(2, '0'); }
function iso(y: number, m: number, d: number) { return y + '-' + pad(m + 1) + '-' + pad(d); }
function parseIso(value: string) {
    const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(value);
    if (!m)
        return null;
    return { y: +m[1], m: +m[2] - 1, d: m[3] ? +m[3] : 1 };
}
function daysInMonth(y: number, m: number) { return new Date(y, m + 1, 0).getDate(); }
function nativeMobile() { return typeof window !== 'undefined' && matchMedia('(max-width: 850px)').matches; }

export function DatePicker({ label, value, precision, onChange, allowApproximate = true }: {
    label: string;
    value: string;
    precision: 'day' | 'month' | 'none';
    onChange: (value: string, precision: 'day' | 'month' | 'none') => void;
    allowApproximate?: boolean;
}) {
    const parsed = parseIso(value);
    const now = new Date();
    const [open, setOpen] = useState(false);
    const [view, setView] = useState({ y: parsed?.y || now.getFullYear(), m: parsed?.m ?? now.getMonth() });
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (!open)
            return;
        box.current?.querySelector('.calendar-pop')?.scrollIntoView({ block: 'nearest' });
        const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc); };
    }, [open]);
    const start = new Date(view.y, view.m, 1).getDay();
    const count = daysInMonth(view.y, view.m);
    const cells = [...Array(start).fill(0), ...Array.from({ length: count }, (_, i) => i + 1)];
    const years = Array.from({ length: 12 }, (_, i) => now.getFullYear() + i);
    const display = precision === 'none' || !value
        ? 'Not sure yet'
        : precision === 'month' && parsed
            ? months[parsed.m] + ' ' + parsed.y
            : parsed
                ? months[parsed.m] + ' ' + parsed.d + ', ' + parsed.y
                : 'Choose a date';
    return <div className="picker-field" ref={box}>
        <span className="picker-label">{label}</span>
        {allowApproximate && <div className="precision-row" role="group" aria-label="Date precision">
            {([['day', 'Exact date'], ['month', 'Month only'], ['none', 'Not sure yet']] as const).map(([id, title]) =>
                <button type="button" key={id} className={precision === id ? 'active' : ''} aria-pressed={precision === id} onClick={() => {
                    if (id === 'none')
                        onChange('', 'none');
                    else if (id === 'month') {
                        const p = parsed || { y: now.getFullYear(), m: now.getMonth(), d: 1 };
                        onChange(iso(p.y, p.m, 1), 'month');
                    }
                    else {
                        const p = parsed || { y: now.getFullYear(), m: now.getMonth(), d: now.getDate() };
                        onChange(iso(p.y, p.m, p.d), 'day');
                        setOpen(true);
                    }
                }}>{title}</button>)}
        </div>}
        {(precision !== 'none' || !allowApproximate) && <>
            {nativeMobile() && (precision === 'day' || !allowApproximate)
                ? <input type="date" value={value} aria-label={label} onChange={e => onChange(e.target.value, 'day')}/>
                : <button type="button" className="picker-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => { if (precision === 'none') onChange(iso(now.getFullYear(), now.getMonth(), now.getDate()), 'day'); setOpen(!open); }}>{value ? display : 'Choose a date'}</button>}
            {open && !nativeMobile() && <div className="calendar-pop" role="dialog" aria-label={label}>
                <div className="calendar-nav">
                    <button type="button" aria-label="Previous month" onClick={() => setView(v => v.m === 0 ? { y: v.y - 1, m: 11 } : { y: v.y, m: v.m - 1 })}>‹</button>
                    <select aria-label="Month" value={view.m} onChange={e => setView(v => ({ ...v, m: +e.target.value }))}>{months.map((name, i) => <option value={i} key={name}>{name.slice(0, 3)}</option>)}</select>
                    <select aria-label="Year" value={view.y} onChange={e => setView(v => ({ ...v, y: +e.target.value }))}>{years.map(y => <option key={y}>{y}</option>)}</select>
                    <button type="button" aria-label="Next month" onClick={() => setView(v => v.m === 11 ? { y: v.y + 1, m: 0 } : { y: v.y, m: v.m + 1 })}>›</button>
                </div>
                {precision === 'day' && <div className="calendar-grid" role="grid">
                    {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map(d => <span className="dow" key={d}>{d}</span>)}
                    {cells.map((d, i) => d
                        ? <button type="button" key={i} className={value === iso(view.y, view.m, d) ? 'selected' : ''} onClick={() => { onChange(iso(view.y, view.m, d), 'day'); setOpen(false); }}>{d}</button>
                        : <span key={i} />)}
                </div>}
                {precision === 'month' && <button type="button" className="primary" onClick={() => { onChange(iso(view.y, view.m, 1), 'month'); setOpen(false); }}>Use {months[view.m]} {view.y}</button>}
                <div className="calendar-foot">
                    <button type="button" className="text-button" onClick={() => { onChange('', 'none'); setOpen(false); }}>Clear</button>
                    {precision === 'day' && <button type="button" className="text-button" onClick={() => { onChange(iso(now.getFullYear(), now.getMonth(), now.getDate()), 'day'); setOpen(false); }}>Today</button>}
                </div>
            </div>}
        </>}
    </div>;
}

const clockHours = [12, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];
function splitTime(value: string) {
    const m = /^(\d{2}):(\d{2})$/.exec(value);
    let h = m ? +m[1] : 9;
    let min = m ? m[2] : '00';
    if (h === 24)
        h = 0;
    const period: 'AM' | 'PM' = h >= 12 ? 'PM' : 'AM';
    let hour = h % 12;
    if (hour === 0)
        hour = 12;
    if (!minuteSteps.includes(min)) {
        const n = Math.round(+min / 15) * 15;
        min = pad(n === 60 ? 0 : n);
    }
    return { hour, minute: min, period };
}
function joinTime(hour: number, minute: string, period: 'AM' | 'PM') {
    let h = hour % 12;
    if (period === 'PM')
        h += 12;
    if (period === 'AM' && hour === 12)
        h = 0;
    return pad(h) + ':' + minute;
}

export function TimePicker({ label, value, onChange, compact }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    compact?: boolean;
}) {
    const [open, setOpen] = useState(false);
    const [pos, setPos] = useState({ top: 0, left: 0 });
    const box = useRef<HTMLDivElement>(null);
    const pop = useRef<HTMLDivElement>(null);
    const { hour, minute, period } = splitTime(value);
    useLayoutEffect(() => {
        if (!open)
            return;
        const place = () => {
            const trigger = box.current?.querySelector('.time-trigger');
            if (!trigger)
                return;
            const r = trigger.getBoundingClientRect();
            const popEl = pop.current;
            const width = popEl?.offsetWidth || 172;
            const height = popEl?.offsetHeight || 180;
            const gap = 4;
            const top = r.bottom + gap + height > window.innerHeight - 12 ? Math.max(12, r.top - height - gap) : r.bottom + gap;
            const left = r.left + width > window.innerWidth - 12 ? Math.max(12, r.right - width) : r.left;
            setPos({ top, left });
        };
        place();
        requestAnimationFrame(() => {
            pop.current?.querySelector('.time-col .selected')?.scrollIntoView({ block: 'center' });
            place();
        });
        const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node) && !pop.current?.contains(e.target as Node)) setOpen(false); };
        const esc = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        document.addEventListener('mousedown', close);
        document.addEventListener('keydown', esc);
        return () => {
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
            document.removeEventListener('mousedown', close);
            document.removeEventListener('keydown', esc);
        };
    }, [open]);
    function commit(next: { hour?: number; minute?: string; period?: 'AM' | 'PM' }) {
        onChange(joinTime(next.hour ?? hour, next.minute ?? minute, next.period ?? period));
    }
    if (nativeMobile())
        return <Field label={label}><input type="time" step={900} value={value === '24:00' ? '00:00' : value} aria-label={label} onChange={e => onChange(e.target.value)}/></Field>;
    return <div className={'picker-field' + (compact ? ' compact-time' : '')} ref={box}>
        <span className={compact ? 'sr-only' : 'picker-label'}>{label}</span>
        <button type="button" className="picker-trigger time-trigger" aria-haspopup="dialog" aria-expanded={open} aria-label={label} onClick={() => setOpen(!open)}>{formatTime(value)}</button>
        {open && createPortal(<div ref={pop} className="time-pop" role="dialog" aria-label={label} style={{ top: pos.top, left: pos.left }}>
            <div className="time-col" role="listbox" aria-label="Hour">{clockHours.map(h => <button type="button" key={h} className={h === hour ? 'selected' : ''} aria-selected={h === hour} onClick={() => commit({ hour: h })}>{h}</button>)}</div>
            <div className="time-col" role="listbox" aria-label="Minutes">{minuteSteps.map(m => <button type="button" key={m} className={m === minute ? 'selected' : ''} aria-selected={m === minute} onClick={() => commit({ minute: m })}>{m}</button>)}</div>
            <div className="time-col" role="listbox" aria-label="AM or PM">{(['AM', 'PM'] as const).map(p => <button type="button" key={p} className={p === period ? 'selected' : ''} aria-selected={p === period} onClick={() => commit({ period: p })}>{p}</button>)}</div>
        </div>, document.body)}
    </div>;
}

export function HoursEditor({ p, onChange }: {
    p: Plan;
    onChange: (hours: Plan['hours'], preset: 'weekdays' | 'always' | 'custom' | 'undecided') => void;
}) {
    const preset = p.policy.hoursPreset || 'undecided';
    const [custom, setCustom] = useState(preset === 'custom');
    function setDays(days: Day[], next = 'custom' as const) {
        onChange({ ...p.hours, days }, next);
        setCustom(true);
    }
    return <>
        <Cards compact label="Typical week" value={preset === 'undecided' ? '' : preset} onChange={v => {
            const next = v as typeof preset;
            setCustom(next === 'custom');
            onChange({ ...p.hours, days: applyHoursPreset(p.hours.days, next) }, next);
        }} items={[
            ['weekdays', 'Monday–Friday · 9 AM–5 PM', 'The usual practice week'],
            ['custom', 'Different hours by day', 'Adjust any day, add a break, copy Monday'],
            ['always', '24-hour phone coverage', 'Every day, midnight to midnight']
        ]}/>
        <Later pressed={preset === 'undecided'} onClick={() => { setCustom(false); onChange({ ...p.hours, days: applyHoursPreset(p.hours.days, 'undecided') }, 'undecided'); }}>I'm not sure yet</Later>
        {preset !== 'undecided' && preset !== 'always' && <div className="hours-summary" aria-live="polite">
            <div><strong>Mon – Fri</strong><span>{preset === 'weekdays' || (p.hours.days[0].open && p.hours.days[4].open) ? formatTime(p.hours.days[0].start) + ' – ' + formatTime(p.hours.days[0].end) : 'See custom days'}</span></div>
            <div><strong>Sat – Sun</strong><span>{p.hours.days[5].open || p.hours.days[6].open ? 'Open' : 'Closed'}</span></div>
        </div>}
        {preset === 'weekdays' && !custom && <button type="button" className="text-button" onClick={() => setCustom(true)}>Customize schedule</button>}
        {(custom || preset === 'custom') && preset !== 'undecided' && <div className="week-editor">
            <div className="week-toolbar">
                <button type="button" className="text-button" onClick={() => setDays(p.hours.days.map((d, i) => i > 0 && i < 5 && p.hours.days[0].open ? { ...d, open: true, start: p.hours.days[0].start, end: p.hours.days[0].end, breakStart: p.hours.days[0].breakStart, breakEnd: p.hours.days[0].breakEnd } : d))}>Copy Monday to weekdays</button>
            </div>
            {p.hours.days.map((d, i) => <div className={'week-row' + (d.open ? '' : ' closed')} key={d.day}>
                <label className="week-toggle"><input type="checkbox" checked={d.open} onChange={e => setDays(p.hours.days.map((x, j) => j === i ? { ...x, open: e.target.checked } : x))}/>{d.day}</label>
                {d.open ? <div className="week-times">
                    <TimePicker compact label={d.day + ' from'} value={d.start} onChange={start => setDays(p.hours.days.map((x, j) => j === i ? { ...x, start } : x))}/>
                    <span className="week-to">to</span>
                    <TimePicker compact label={d.day + ' until'} value={d.end} onChange={end => setDays(p.hours.days.map((x, j) => j === i ? { ...x, end } : x))}/>
                    {d.breakStart
                        ? <div className="break-row"><TimePicker compact label="Break starts" value={d.breakStart} onChange={breakStart => setDays(p.hours.days.map((x, j) => j === i ? { ...x, breakStart } : x))}/><TimePicker compact label="Break ends" value={d.breakEnd} onChange={breakEnd => setDays(p.hours.days.map((x, j) => j === i ? { ...x, breakEnd } : x))}/><button type="button" className="text-button" onClick={() => setDays(p.hours.days.map((x, j) => j === i ? { ...x, breakStart: '', breakEnd: '' } : x))}>Remove break</button></div>
                        : <button type="button" className="text-button" onClick={() => setDays(p.hours.days.map((x, j) => j === i ? { ...x, breakStart: '12:00', breakEnd: '13:00' } : x))}>Add break</button>}
                </div> : <span className="week-closed">Not available</span>}
            </div>)}
        </div>}
    </>;
}

export function HolidayEditor({ holidays, closures, policy, onChange }: {
    holidays: string[];
    closures: string[];
    policy: 'closed' | 'regular';
    onChange: (next: { holidays: string[]; closures: string[]; policy: 'closed' | 'regular' }) => void;
}) {
    const [draft, setDraft] = useState({ start: '', end: '', kind: 'holiday' as 'holiday' | 'closure' });
    const items = [
        ...holidays.map(d => ({ d, kind: 'holiday' as const })),
        ...closures.map(d => ({ d, kind: 'closure' as const }))
    ].sort((a, b) => a.d.localeCompare(b.d));
    function range(start: string, end: string) {
        const a = parseIso(start), b = parseIso(end || start);
        if (!a || !b)
            return [];
        const out: string[] = [];
        const cur = new Date(a.y, a.m, a.d), last = new Date(b.y, b.m, b.d);
        while (cur <= last) {
            out.push(iso(cur.getFullYear(), cur.getMonth(), cur.getDate()));
            cur.setDate(cur.getDate() + 1);
            if (out.length > 60)
                break;
        }
        return out;
    }
    return <div className="holiday-editor">
        <Field label="On listed holidays">
            <select value={policy} onChange={e => onChange({ holidays, closures, policy: e.target.value as 'closed' | 'regular' })}>
                <option value="closed">Use after-hours routing</option>
                <option value="regular">Keep regular phone hours</option>
            </select>
        </Field>
        {items.length ? <ul className="holiday-list">{items.map(item => <li key={item.kind + item.d}><span>{item.d} · {item.kind === 'holiday' ? 'Holiday' : 'Closure'}</span><button type="button" className="text-button" onClick={() => onChange({
            holidays: item.kind === 'holiday' ? holidays.filter(x => x !== item.d) : holidays,
            closures: item.kind === 'closure' ? closures.filter(x => x !== item.d) : closures,
            policy
        })}>Remove</button></li>)}</ul> : <p className="muted">No holidays or closures listed.</p>}
        <div className="holiday-add">
            <DatePicker label="Date" value={draft.start} precision={draft.start ? 'day' : 'none'} allowApproximate={false} onChange={start => setDraft(d => ({ ...d, start }))}/>
            <DatePicker label="End date (optional)" value={draft.end} precision={draft.end ? 'day' : 'none'} allowApproximate={false} onChange={end => setDraft(d => ({ ...d, end }))}/>
            <label className="check"><input type="checkbox" checked={draft.kind === 'closure'} onChange={e => setDraft(d => ({ ...d, kind: e.target.checked ? 'closure' : 'holiday' }))}/>Temporary closure</label>
            <button type="button" className="secondary" disabled={!draft.start} onClick={() => {
                const add = range(draft.start, draft.end);
                onChange({
                    holidays: draft.kind === 'holiday' ? [...new Set([...holidays, ...add])] : holidays,
                    closures: draft.kind === 'closure' ? [...new Set([...closures, ...add])] : closures,
                    policy
                });
                setDraft({ start: '', end: '', kind: draft.kind });
            }}>Add holiday or closure</button>
        </div>
    </div>;
}

export function ChipSelect({ label, value, options, onChange, custom }: {
    label: string;
    value: number;
    options: number[];
    onChange: (v: number) => void;
    custom?: boolean;
}) {
    const id = useId();
    const preset = options.includes(value);
    return <fieldset className="chip-select"><legend>{label}</legend>{options.map(n => <label key={n} className={value === n ? 'selected' : ''}><input type="radio" name={id} checked={value === n} onChange={() => onChange(n)}/>{n} seconds</label>)}<label className={!preset ? 'selected' : ''}><input type="radio" name={id} checked={!preset} onChange={() => { if (preset) onChange(45); }}/>Custom</label>{(!preset || custom) && <Field label="Seconds"><input type="number" min={5} max={600} value={value} onChange={e => onChange(Math.max(5, Math.min(600, +e.target.value || 5)))}/></Field>}</fieldset>;
}
