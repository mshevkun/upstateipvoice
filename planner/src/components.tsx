import type { ReactNode } from 'react';
import { hasTeam, type Plan } from './config';
export function Arrow() { return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M3 12h17m-7-7 7 7-7 7"/></svg>; }
export function Cards({ label, value, onChange, items, compact }: {
    label: string;
    value: string;
    onChange: (v: string) => void;
    items: [
        string,
        string,
        string
    ][];
    compact?: boolean;
}) { return <fieldset className={'cards' + (compact ? ' compact-cards' : '')}><legend className="sr-only">{label}</legend>{items.map(([id, title, description]) => <label className={'answer-card ' + (value === id ? 'selected' : '') + (id === 'undecided' || title.toLowerCase().includes('not sure') ? ' later-card' : '')} key={id}><input type="radio" name={label} value={id} checked={value === id} onChange={() => onChange(id)}/><span><strong>{title}</strong>{description && <small>{description}</small>}</span><span className="radio-dot" aria-hidden="true">{value === id ? '✓' : ''}</span></label>)}</fieldset>; }
export function Later({ children, onClick, pressed }: {
    children: string;
    onClick: () => void;
    pressed?: boolean;
}) { return <button type="button" className={'later-choice' + (pressed ? ' selected' : '')} aria-pressed={pressed} onClick={onClick}>{children}</button>; }
export function Field({ label, children, hint }: {
    label: string;
    children: ReactNode;
    hint?: string;
}) { return <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>; }
export function Count({ label, value, onChange, max = 999 }: {
    label: string;
    value: number;
    onChange: (v: number) => void;
    max?: number;
}) { return <div className="count"><span>{label}</span><div><button aria-label={'Decrease ' + label} disabled={value <= 0} onClick={() => onChange(value - 1)}>−</button><input aria-label={label} type="number" min="0" max={max} value={value} onChange={e => onChange(Math.max(0, Math.min(max, Math.floor(Number(e.target.value) || 0))))}/><button aria-label={'Increase ' + label} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button></div></div>; }
export function Destination({ p, label, value, onChange }: {
    p: Plan;
    label: string;
    value: string;
    onChange: (v: string) => void;
}) { return <Field label={label}><select value={value} onChange={e => onChange(e.target.value)}><option value="">Decide later</option>{value && !hasTeam(p, value) && <option value={value}>Unresolved · unavailable team</option>}{p.teams.filter(t => t.count > 0).map(t => <option key={t.id} value={t.id}>{t.name} · {t.count} {t.count === 1 ? 'person' : 'people'}</option>)}</select></Field>; }
export function Note({ children, tone = 'neutral' }: {
    children: ReactNode;
    tone?: 'neutral' | 'warning';
}) { return <div className={'note ' + tone}>{children}</div>; }
