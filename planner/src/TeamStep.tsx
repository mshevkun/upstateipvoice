import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import type { Plan } from './config';
import { roles, roleInfo, roleState, setRole, parseCount, MAX_PEOPLE, type Role } from './team-state';
export type TeamHandle = {
    commit: () => Plan | null;
};
export const TeamStep = forwardRef<TeamHandle, {
    p: Plan;
    onChange: (p: Plan) => void;
}>(function TeamStep({ p, onChange }, ref) {
    const [drafts, setDrafts] = useState<Partial<Record<Role, string>>>({}), [errors, setErrors] = useState<Partial<Record<Role, string>>>({});
    const inputs = useRef<Partial<Record<Role, HTMLInputElement | null>>>({});
    const latest = useRef(p);
    latest.current = p;
    function save(role: Role, text: string) { const n = parseCount(text); if (n === null) {
        setErrors(e => ({ ...e, [role]: 'Enter a whole number from 0 to 9,999.' }));
        return false;
    } const next = setRole(latest.current, role, 'known', n); latest.current = next; onChange(next); setDrafts(d => { const copy = { ...d }; delete copy[role]; return copy; }); setErrors(e => ({ ...e, [role]: '' })); return true; }
    useImperativeHandle(ref, () => ({ commit() { let next = latest.current; const problems: Partial<Record<Role, string>> = {}; for (const role of roles) {
            if (drafts[role] !== undefined) {
                const n = parseCount(drafts[role]!);
                if (n === null)
                    problems[role] = 'Enter a whole number from 0 to 9,999.';
                else
                    next = setRole(next, role, 'known', n);
            }
            if (roleState(next, role).status === 'unanswered' && !problems[role])
                problems[role] = 'Enter a number or choose Decide later.';
        } if (Object.keys(problems).length) {
            setErrors(problems);
            inputs.current[roles.find(r => problems[r])!]?.focus();
            return null;
        } latest.current = next; setDrafts({}); return next; } }));
    function adjust(role: Role, delta: number) { const v = roleState(latest.current, role), n = drafts[role] !== undefined ? parseCount(drafts[role]!) : v.status === 'known' ? v.count : 0; if (n === null) {
        setErrors(e => ({ ...e, [role]: 'Enter a whole number from 0 to 9,999.' }));
        return;
    } if (n + delta < 0 || n + delta > MAX_PEOPLE)
        return; save(role, String(n + delta)); }
    return <div className="team-step">{roles.map(role => { const v = roleState(p, role), info = roleInfo[role], draft = drafts[role], editable = draft === undefined ? (v.status === 'known' ? v.count : null) : parseCount(draft); return <section className="staff-card" key={role} aria-labelledby={'role-' + role}><div className="staff-copy"><h2 id={'role-' + role}>{info.title}</h2><p>{info.description}</p><button className="defer-link" onMouseDown={e => e.preventDefault()} onClick={() => { const next = setRole(latest.current, role, 'deferred'); latest.current = next; onChange(next); setDrafts(d => { const a = { ...d }; delete a[role]; return a; }); setErrors(e => ({ ...e, [role]: '' })); }}>Not sure</button></div><div className="staff-counter"><button aria-label={'Decrease ' + info.title} disabled={editable === null || editable === 0} onMouseDown={e => e.preventDefault()} onClick={() => adjust(role, -1)}>−</button>{v.status === 'deferred' && draft === undefined ? <button className="deferred-value" aria-label={'Enter a number for ' + info.title} onClick={() => { setDrafts(d => ({ ...d, [role]: '' })); requestAnimationFrame(() => inputs.current[role]?.focus()); }}>Not sure<small>Enter number</small></button> : <input ref={el => { inputs.current[role] = el; }} aria-label={info.title + ' count'} aria-describedby={errors[role] ? 'error-' + role : undefined} aria-invalid={!!errors[role]} inputMode="numeric" role="spinbutton" aria-valuemin={0} aria-valuemax={MAX_PEOPLE} aria-valuenow={editable ?? undefined} value={draft ?? (v.status === 'known' ? String(v.count) : '')} placeholder="0" onChange={e => setDrafts(d => ({ ...d, [role]: e.target.value }))} onBlur={() => { if (draft !== undefined)
        save(role, draft); }} onKeyDown={e => { if (e.key === 'Enter') {
        e.preventDefault();
        if (draft !== undefined)
            save(role, draft);
    } if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        adjust(role, e.key === 'ArrowUp' ? 1 : -1);
    } }}/>}<button aria-label={'Increase ' + info.title} disabled={editable !== null && editable >= MAX_PEOPLE} onMouseDown={e => e.preventDefault()} onClick={() => adjust(role, 1)}>+</button></div>{errors[role] && <p className="staff-error" id={'error-' + role} role="alert">{errors[role]}</p>}</section>; })}<p className="team-assurance">Zero is allowed. Phones are chosen after the call experience.</p></div>;
});
