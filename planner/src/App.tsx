import { TeamStep, type TeamHandle } from './TeamStep';
import { Workflow } from './Workflow';
import { Review } from './Review';
import { Architect } from './ArchitectChat';
import { Scene } from './ScenePanel';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { read, commit, key, steps, teamName, scenarios, simulate, journeySeconds, type Plan } from './config';
import { chapterIndex, chapterStart, chapters, help, restoreStep, sceneChapter, suggestedGreeting, waitChoices } from './flow';
import { Cards, Count, Field, Later, Note, Arrow, Destination } from './components';
import { ChipSelect, DatePicker, HolidayEditor, HoursEditor } from './pickers';
import { choices, type SceneMode } from './state';
import { suggestPlacements } from './policy';
import { teamSummary } from './team-state';
import { PRIVACY_COPY } from './privacy';

export function Wizard() {
    const loaded = useRef(read());
    const [p, setP] = useState(loaded.current.plan);
    const [step, setStep] = useState(restoreStep);
    const [warning, setWarning] = useState(loaded.current.warning), [showHelp, setShowHelp] = useState(false), [notice, setNotice] = useState(''), [pdfBusy, setPdfBusy] = useState(false);
    const [paused, setPaused] = useState(false), [assistantRequest, setAssistantRequest] = useState(''), [humanRequest, setHumanRequest] = useState(false);
    const [testPreset, setTestPreset] = useState('normal'), [customDate, setCustomDate] = useState(''), [customTime, setCustomTime] = useState('09:00');
    const [callerReason, setCallerReason] = useState(''), [callerLanguage, setCallerLanguage] = useState('');
    const [scenario, setScenario] = useState('normal'), [trace, setTrace] = useState<ReturnType<typeof simulate> | null>(null), [shown, setShown] = useState(0);
    const [focus, setFocus] = useState(false), [moreLocations, setMoreLocations] = useState(false), [menuAdvanced, setMenuAdvanced] = useState(false), [holidaysOpen, setHolidaysOpen] = useState(false);
    const teamForm = useRef<TeamHandle>(null);
    const heading = useRef<HTMLHeadingElement>(null), generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const id = step >= 0 ? steps[step][0] : 'welcome';
    const sharingBlocked = id === 'positions' && p.policy.placements.some(x => x.count > 1 && x.sharing === 'undecided' && !['none', 'undecided'].includes(x.device));
    const ch = step < 0 ? 0 : chapterIndex(id);
    const inChapter = steps.filter(s => s[1] === (step >= 0 ? steps[step][1] : chapters[0]));
    const local = Math.max(1, inChapter.findIndex(s => s[0] === id) + 1);
    function update(next: Plan) { generation.current++; if (timer.current)
        clearTimeout(timer.current); setTrace(null); setShown(0); setNotice(''); const v = commit(p, next); setP(v); try {
        localStorage.setItem(key, JSON.stringify(v));
        setWarning('');
    }
    catch {
        setWarning('Saved for this visit only. Download your PDF before leaving.');
    } }
    function patch<K extends keyof Plan>(k: K, v: Plan[K]) { update({ ...p, [k]: v }); }
    useEffect(() => { try {
        sessionStorage.setItem('upstate.step', id === 'welcome' ? '-1' : id);
    }
    catch { } heading.current?.focus({ preventScroll: true }); document.querySelector('.form-scroll')?.scrollTo(0, 0); setShowHelp(false); }, [step]);
    useEffect(() => {
        if (id === 'current' && p.mode === 'opening' && p.policy.beforeOpening === 'information' && !p.policy.beforeOpeningText?.trim())
            update({ ...p, policy: { ...p.policy, beforeOpeningText: suggestedGreeting(p) } });
    }, [id]);
    useEffect(() => () => { if (timer.current)
        clearTimeout(timer.current); }, []);
    function go(n: number) { generation.current++; if (timer.current)
        clearTimeout(timer.current); setTrace(null); setShown(0); setStep(n); }
    function goId(stepId: string) { const i = steps.findIndex(s => s[0] === stepId); if (i >= 0)
        go(i); }
    async function pdf(kind: 'owner' | 'engineer' | 'both' = 'owner') { setPdfBusy(true); const snapshot = structuredClone(p); try {
        const mod = await import('./pdf');
        if (kind === 'engineer')
            await mod.downloadEngineerPDF(snapshot);
        else if (kind === 'both')
            await mod.downloadBothPDF(snapshot);
        else
            await mod.downloadPDF(snapshot);
        setNotice((kind === 'engineer' ? 'Implementation spec' : 'Owner blueprint') + ' downloaded. ' + PRIVACY_COPY);
    }
    catch {
        setNotice('PDF export failed. Your plan is preserved. Retry, or copy the owner plan as text from technical requirements.');
    }
    finally {
        setPdfBusy(false);
    } }
    function run() { if (timer.current)
        clearTimeout(timer.current); const selected = scenarios(p).find(s => s.id === scenario) || scenarios(p)[0]; const at = testPreset === 'custom' && customDate && customTime ? customDate + 'T' + customTime + ':00' : undefined; const result = simulate(p, { ...selected, at, request: assistantRequest || undefined, humanRequested: humanRequest, reason: callerReason || undefined, language: selected.language || callerLanguage || undefined }); setPaused(false); const token = ++generation.current; setTrace(result); setShown(1); let i = 1; const next = () => { if (generation.current !== token)
        return; i++; setShown(i); if (i < result.trace.length)
        timer.current = setTimeout(next, 450); }; if (matchMedia('(prefers-reduced-motion: reduce)').matches)
        setShown(result.trace.length);
    else
        timer.current = setTimeout(next, 450); }
    const dest = (label: string, value: string, onChange: (v: string) => void) => <Destination p={p} label={label} value={value} onChange={onChange}/>;
    const unanswered = journeySeconds(p, { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false });
    let body: ReactNode = null;
    if (id === 'start')
        body = <><Cards label="What are you planning?" value={p.mode} onChange={v => patch('mode', v as Plan['mode'])} items={choices.map(c => [c.id, c.title, c.description])}/><Workflow id="start" p={p} onChange={update}/></>;
    if (id === 'kind')
        body = <><Cards label="Practice specialty" value={p.specialty} onChange={v => patch('specialty', v)} items={[['Dental', 'Dental', 'Dental and orthodontic teams'], ['Eye care', 'Eye care', 'Optometry and ophthalmology'], ['Other healthcare practice', 'Other healthcare practice', 'Tell us your specialty']]}/>{p.specialty === 'Other healthcare practice' && <Field label="Your specialty (optional)"><input value={p.specialtyDetail || ''} maxLength={120} placeholder="For example, family medicine" onChange={e => patch('specialtyDetail', e.target.value)}/></Field>}</>;
    if (id === 'practice')
        body = <><Field label="Practice name (optional)"><input value={p.name} maxLength={120} placeholder="Your practice name" onChange={e => patch('name', e.target.value)}/></Field><Field label="Location name"><input value={p.locations[0]?.name || ''} maxLength={100} placeholder="Main office" onChange={e => patch('locations', p.locations.map((x, i) => i === 0 ? { ...x, name: e.target.value } : x))}/></Field><Field label="City / state (optional)" hint="Helps with timezone and a future install."><input value={p.policy.cityState} maxLength={80} placeholder="For example, Albany, NY" onChange={e => update({ ...p, policy: { ...p.policy, cityState: e.target.value } })}/></Field>{p.mode === 'opening' && <DatePicker label="Expected opening" value={p.policy.opening.date} precision={p.policy.opening.precision || 'none'} onChange={(date, precision) => update({ ...p, policy: { ...p.policy, opening: { ...p.policy.opening, date, precision } } })}/>}
            <button type="button" className="text-button" onClick={() => setMoreLocations(!moreLocations)}>{moreLocations ? 'Hide additional locations' : 'Planning more than one location?'}</button>
            {moreLocations && <><div className="section-label">Locations <span>{p.locations.length}</span></div>{p.locations.map((l, i) => <div className="inline" key={l.id}><Field label={'Location ' + (i + 1)}><input value={l.name} maxLength={100} onChange={e => patch('locations', p.locations.map(x => x.id === l.id ? { ...x, name: e.target.value } : x))}/></Field>{p.locations.length > 1 && i > 0 && <button className="text-button" disabled={l.id === p.policy.activeLocation} onClick={() => { const profiles = { ...p.profiles }; delete profiles[l.id]; update({ ...p, profiles, locations: p.locations.filter(x => x.id !== l.id) }); }}>Remove</button>}</div>)}<button className="secondary" disabled={p.locations.length >= 50} onClick={() => patch('locations', [...p.locations, { id: crypto.randomUUID(), name: 'Additional location' }])}>+ Add location</button></>}
            <Workflow id="practice" p={p} onChange={update}/></>;
    if (id === 'team')
        body = <><TeamStep ref={teamForm} p={p} onChange={update}/>{p.teams.some(t => t.count > 0) && dest('Who normally takes incoming patient calls?', p.first.team, team => patch('first', { ...p.first, team }))}</>;
    if (id === 'hours')
        body = <><Field label="Timezone"><select value={p.hours.timezone} onChange={e => patch('hours', { ...p.hours, timezone: e.target.value })}>{Array.from(new Set([p.hours.timezone, 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'UTC', ...Intl.supportedValuesOf('timeZone')])).map(z => <option key={z}>{z}</option>)}</select></Field>
            <HoursEditor p={p} onChange={(hours, hoursPreset) => update({ ...p, hours, policy: { ...p.policy, hoursPreset } })}/>
            <button type="button" className="text-button" onClick={() => setHolidaysOpen(!holidaysOpen)}>{holidaysOpen ? 'Hide holidays and closures' : 'Customize holidays and closures'}</button>
            {holidaysOpen && <><HolidayEditor holidays={p.hours.holidays} closures={p.policy.closures} policy={p.hours.holidayPolicy} onChange={next => update({ ...p, hours: { ...p.hours, holidays: next.holidays, holidayPolicy: next.policy }, policy: { ...p.policy, closures: next.closures, hoursExceptionsConfirmed: false } })}/>{(p.hours.holidays.length > 0 || p.policy.closures.length > 0) && <label className="check"><input type="checkbox" checked={p.policy.hoursExceptionsConfirmed} onChange={e => update({ ...p, policy: { ...p.policy, hoursExceptionsConfirmed: e.target.checked } })}/>Holiday and closure handling is confirmed</label>}</>}
            <Workflow id="hours" p={p} onChange={update}/></>;
    if (id === 'first')
        body = <><Cards compact label="First answer" value={p.first.kind === 'undecided' ? '' : p.first.kind} onChange={kind => patch('first', { ...p.first, kind: kind as Plan['first']['kind'] })} items={[['human', 'Your reception team', 'Available staff ring directly. No menu.'], ['menu', 'A short phone menu', 'Patients choose appointments, billing, or another department.'], ['assistant', 'An AI receptionist', 'Use supported automation, with a human fallback.']]}/>
            <Later pressed={p.first.kind === 'undecided'} onClick={() => patch('first', { ...p.first, kind: 'undecided' })}>I'm not sure yet — you can change this later</Later>
            {p.first.kind === 'human' && dest('Which team rings first?', p.first.team, team => patch('first', { ...p.first, team }))}
            <details><summary>Help me choose</summary><Cards compact label="What matters most?" value={p.policy.recommendation} onChange={recommendation => update({ ...p, policy: { ...p.policy, recommendation } })} items={[['human', 'Speak to a person immediately', 'We suggest ringing your team'], ['menu', 'Reach a specific team directly', 'We suggest a short menu'], ['assistant', 'Handle routine requests automatically', 'We suggest exploring virtual assistance']]}/>{p.policy.recommendation && <button className="secondary" onClick={() => patch('first', { ...p.first, kind: p.policy.recommendation as Plan['first']['kind'] })}>Use this recommendation</button>}</details>
            <Workflow id="first" p={p} onChange={update}/></>;
    if (id === 'reasons')
        body = <><div className="reason-table">{p.reasons.map(r => <div className="reason-row" key={r.id}><div><span className="reason-label">{r.label}</span>{p.first.kind === 'menu' && menuAdvanced && <input value={r.label} maxLength={100} aria-label="Menu wording" onChange={e => patch('reasons', p.reasons.map(x => x.id === r.id ? { ...x, label: e.target.value } : x))}/>}</div><select aria-label={r.label + ' destination'} value={r.team} onChange={e => patch('reasons', p.reasons.map(x => x.id === r.id ? { ...x, team: e.target.value } : x))}><option value="">Decide later</option>{p.first.kind === 'human' && <option value="@main">Same team as the main answer</option>}{p.teams.filter(t => t.count > 0).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}</select><button type="button" className="text-button" onClick={() => patch('reasons', p.reasons.filter(x => x.id !== r.id))}>Remove</button></div>)}</div>
            <button type="button" className="text-button" disabled={p.reasons.length >= 9} onClick={() => patch('reasons', [...p.reasons, { id: crypto.randomUUID(), label: 'Another reason', team: '' }])}>+ Add a reason</button>
            {p.first.kind === 'menu' && <><p className="muted">Generated menu: {p.reasons.map((r, i) => (i + 1) + ' · ' + r.label).join(' · ')}</p><button type="button" className="text-button" onClick={() => setMenuAdvanced(!menuAdvanced)}>{menuAdvanced ? 'Hide wording and digits' : 'Customize wording and digits'}</button>{menuAdvanced && <div className="subsection"><Count label="Menu retries before fallback" value={p.policy.menuRetries} max={2} onChange={menuRetries => update({ ...p, policy: { ...p.policy, menuRetries } })}/>{(['invalid', 'noInput'] as const).map(k => <Field key={k} label={k === 'invalid' ? 'Invalid input' : 'No input'}><select value={p.menu[k]} onChange={e => patch('menu', { ...p.menu, [k]: e.target.value as Plan['menu']['invalid'] })}><option value="message">Take a message</option><option value="team">Try a fallback team</option></select></Field>)}{(p.menu.invalid === 'team' || p.menu.noInput === 'team') && dest('Menu fallback team', p.menu.team, team => patch('menu', { ...p.menu, team }))}</div>}</>}
            {p.first.kind === 'human' && <Note>These are staff-handoff policies. They do not create a phone menu.</Note>}
            {p.first.kind !== 'menu' && p.first.kind !== 'human' && <Note>Choose how calls are answered first. Destinations stay saved if you switch.</Note>}</>;
    if (id === 'busy')
        body = <><Cards compact label="If the first team is busy" value={p.busy.kind} onChange={kind => patch('busy', { ...p.busy, kind: kind as Plan['busy']['kind'] })} items={[['message', 'Take a message', 'Send it to a named owner'], ['queue', 'Let the patient wait briefly', 'Then follow the fallback you choose'], ['backup', 'Try another team', 'Then take an owned message'], ['assistant', 'Use a virtual receptionist', 'Only after the first ringing timeout']]}/>
            <Later pressed={p.busy.kind === 'undecided'} onClick={() => patch('busy', { ...p.busy, kind: 'undecided' })}>Decide later</Later>
            {p.busy.kind === 'queue' && <><ChipSelect label="Maximum wait after ringing" value={p.busy.wait} options={[...waitChoices]} onChange={wait => patch('busy', { ...p.busy, wait })}/><p className="muted">Ring {p.busy.seconds}s, then wait up to {p.busy.wait}s — {p.busy.seconds + p.busy.wait} seconds total before the fallback{unanswered.terminal ? ' (' + unanswered.terminal + ')' : ''}.</p><details><summary>Change ringing time</summary><ChipSelect label="Ring for" value={p.busy.seconds} options={[15, 25, 40]} onChange={seconds => patch('busy', { ...p.busy, seconds })}/></details></>}
            {p.busy.kind === 'backup' && dest('Backup team', p.busy.backup, backup => patch('busy', { ...p.busy, backup }))}
            {p.busy.kind !== 'undecided' && dest('Who owns the callback message?', p.busy.owner, owner => patch('busy', { ...p.busy, owner }))}
            <Workflow id="busy" p={p} onChange={update}/></>;
    if (id === 'after')
        body = <><Cards compact label="After hours" value={p.after.kind} onChange={kind => patch('after', { ...p.after, kind: kind as Plan['after']['kind'] })} items={[['information', 'Play information, then end', 'Hours, location, or your approved instructions'], ['message', 'Take a message', 'Next-business-day follow-up'], ['service', 'Use an answering service', 'Record the agreed scope'], ['assistant', 'Explore virtual assistance', 'Confirm availability and limits']]}/>
            <Later pressed={p.after.kind === 'undecided'} onClick={() => patch('after', { ...p.after, kind: 'undecided' })}>Decide later</Later>
            {p.after.kind && p.after.kind !== 'undecided' && <>{p.after.kind !== 'information' && dest('After-hours message owner', p.after.owner, owner => patch('after', { ...p.after, owner }))}<Field label="Approved information or service limits" hint="No private clinician numbers."><textarea rows={3} maxLength={1200} value={p.after.instructions} onChange={e => patch('after', { ...p.after, instructions: e.target.value })}/></Field></>}
            <Workflow id="after" p={p} onChange={update}/></>;
    if (id === 'urgent')
        body = <><Cards compact label="Urgent calls" value={p.policy.urgentKind} onChange={v => update({ ...p, urgent: { ...p.urgent, enabled: v !== 'none' }, policy: { ...p.policy, urgentKind: v as Plan['policy']['urgentKind'] } })} items={[['connect', 'Connect to on-call', 'A transfer attempt with a defined backup'], ['priority', 'Take a priority message', 'An owned message, not live contact'], ['instructions', 'Play approved instructions', 'No advice is invented here'], ['none', 'No separate urgent path', 'Use ordinary call handling']]}/>
            <Later pressed={p.policy.urgentKind === 'undecided'} onClick={() => update({ ...p, urgent: { ...p.urgent, enabled: false }, policy: { ...p.policy, urgentKind: 'undecided' } })}>We still need to decide</Later>
            {p.policy.urgentKind === 'connect' && <div className="urgent-stages">
                <div className="team-card"><h2>1 · Primary</h2>{dest('On-call role', p.urgent.team, team => patch('urgent', { ...p.urgent, team }))}</div>
                <div className="team-card"><h2>2 · If unanswered</h2>{dest('Backup role', p.urgent.backup, backup => { update({ ...p, urgent: { ...p.urgent, backup }, policy: { ...p.policy, urgentBackup: backup ? 'team' : 'message' } }); })}</div>
                <div className="team-card"><h2>3 · Final fallback</h2>{dest('Priority-message owner', p.urgent.owner, owner => patch('urgent', { ...p.urgent, owner }))}</div>
                <Note>Outside office hours, urgent callers may request the {teamName(p, p.urgent.team)}. If no one accepts, the call tries {teamName(p, p.urgent.backup)}. If no connection is made, it follows the urgent-message procedure.</Note>
            </div>}
            <Workflow id="urgent" p={p} onChange={update}/></>;
    if (id === 'languages')
        body = <><Cards compact label="Additional languages" value={p.languages.length === 1 && p.languages[0].name === 'Spanish' ? 'spanish' : p.languages.length ? 'other' : p.policy.languageDecision} onChange={v => { if (v === 'spanish')
            update({ ...p, languages: [...p.languages.filter(l => l.name !== 'Spanish'), { name: 'Spanish', mechanism: p.first.kind === 'menu' ? 'menu' : p.first.kind === 'assistant' ? 'assistant' : 'staff', team: '', availability: 'open', note: '', fallback: '' }], policy: { ...p.policy, languageDecision: 'selected' } });
        else if (v === 'other')
            update({ ...p, languages: [...p.languages, { name: 'Another language', mechanism: 'undecided', team: '', availability: 'open', note: '', fallback: '' }], policy: { ...p.policy, languageDecision: 'selected' } });
        else
            update({ ...p, languages: [], policy: { ...p.policy, languageDecision: v as 'none' } }); }} items={[['none', 'English is enough', 'Use the standard entry path'], ['spanish', 'Spanish', 'Confirm who can help, and the fallback'], ['other', 'Another language', 'Add a language you can actually cover']]}/>
            {p.languages.length > 0 && p.languages.map((l, i) => <div className="team-card" key={i}><Field label="Language"><input value={l.name} maxLength={60} onChange={e => patch('languages', p.languages.map((x, j) => j === i ? { ...x, name: e.target.value } : x))}/></Field>{dest('Who can help', l.team, team => patch('languages', p.languages.map((x, j) => j === i ? { ...x, team } : x)))}<Field label="When"><select value={l.availability} onChange={e => patch('languages', p.languages.map((x, j) => j === i ? { ...x, availability: e.target.value as typeof l.availability } : x))}><option value="open">During phone hours</option><option value="limited">Limited hours</option><option value="always">All hours (confirm staffing)</option></select></Field>{dest('If that coverage is unavailable', l.fallback, fallback => patch('languages', p.languages.map((x, j) => j === i ? { ...x, fallback } : x)))}<button type="button" className="text-button" onClick={() => patch('languages', p.languages.filter((_, j) => j !== i))}>Remove</button></div>)}
            {p.languages.length > 0 && <Workflow id="languages" p={p} onChange={update}/>}</>;
    if (id === 'followup')
        body = <><Cards compact label="Extra messaging" value={p.policy.followup} onChange={v => update({ ...p, policy: { ...p.policy, followup: v as Plan['policy']['followup'] } })} items={[['skip', 'Keep this to call messages', 'Owners from missed-call handling stay in place'], ['yes', 'Add SMS, reminders, or tasks', 'Optional. Requires consent and a service.'], ['calls', 'Phone callbacks only', 'No extra software']]}/>
            <Workflow id="followup" p={p} onChange={update}/></>;
    if (id === 'positions') {
        const suggestion = suggestPlacements({ ...p, policy: { ...p.policy, placements: [] } });
        body = <>{!p.policy.placements.length && suggestion.length > 0 && <div className="suggestion-card"><h2>Suggested answering places</h2><ul>{suggestion.map(s => <li key={s.id}>{s.count} {s.device} · {s.label} · {s.sharing === 'separate' ? 'independently usable' : 'shared identity'}</li>)}</ul><button type="button" className="secondary" onClick={() => update({ ...p, policy: { ...p.policy, placements: suggestion } })}>Use these suggestions</button></div>}
            <Workflow id="positions" p={p} onChange={update}/></>;
    }
    if (id === 'current')
        body = <Workflow id="current" p={p} onChange={update}/>;
    if (id === 'review')
        body = <Review p={p} pdfBusy={pdfBusy} notice={notice} onNotice={setNotice} onPdf={k => pdf(k)} onJump={goId} run={run} trace={trace} shown={shown} paused={paused} setPaused={setPaused} scenario={scenario} setScenario={setScenario} testPreset={testPreset} setTestPreset={setTestPreset} customDate={customDate} setCustomDate={setCustomDate} customTime={customTime} setCustomTime={setCustomTime} callerReason={callerReason} setCallerReason={setCallerReason} callerLanguage={callerLanguage} setCallerLanguage={setCallerLanguage} assistantRequest={assistantRequest} setAssistantRequest={setAssistantRequest} humanRequest={humanRequest} setHumanRequest={setHumanRequest}/>;
    const chapterLabel = step < 0 ? '' : steps[step][1];
    const sceneMode: SceneMode = step < 0 ? 'welcome' : p.locations.length > 1 || p.mode === 'adding' ? 'adding' : p.mode || 'welcome';
    const sceneChapterNum = sceneChapter(id, step);
    const specialtyBadge = p.specialty === 'Dental' ? 'Dental practice' : p.specialty === 'Eye care' ? 'Eye care practice' : 'Consultation space';
    const sceneBadge = step < 0 ? 'Built around your practice' : id === 'start' ? choices.find(c => c.id === sceneMode)?.scene || 'Your starting point' : id === 'kind' ? specialtyBadge : id === 'team' ? teamSummary(p).label : steps[step][1];
    const content = step < 0 ? <><div className="eyebrow">FREE PRACTICE PLANNER</div><h1 ref={heading} tabIndex={-1}>See what to buy and how calls will work.</h1><p className="supporting">Tell us how your practice wants patients to reach you. We turn that into equipment, opening checks, and a free plan you can take anywhere.</p><button className="primary start" onClick={() => go(0)}>Build my free plan <Arrow /></button><p className="assurance">No account needed. Download when you finish.</p><div className="welcome-points"><span>01 <strong>Describe the practice</strong></span><span>02 <strong>Decide the patient experience</strong></span><span>03 <strong>Leave with a blueprint</strong></span></div></> : <><div className="eyebrow"><span>{chapterLabel} · {local} of {inChapter.length}</span><span className="saved-pill">Saved</span><button className="help-button" onClick={() => setShowHelp(!showHelp)} aria-expanded={showHelp} aria-controls="question-help">{id === 'review' ? 'What is this?' : 'Why this matters'}</button></div>{id !== 'review' && <h1 ref={heading} tabIndex={-1}>{steps[step][2]}</h1>}{id !== 'review' && <p className="supporting">{steps[step][3]}</p>}{id === 'review' && <h1 ref={heading} className="sr-only" tabIndex={-1}>{steps[step][2]}</h1>}{showHelp && <div id="question-help" role="region" aria-label="Why this matters"><Note>{help[id]}</Note></div>}<div className="question-body">{body}</div></>;
    return <div className={'planner' + (focus ? ' focus-mode' : '')} data-step={id} data-revision={p.revision}><header className="header"><a className="brand" href="/tools.html" aria-label="Back to Free Tools"><img src="/assets/upstate-logo.svg" alt="Upstate IP Voice"/></a><button type="button" className="product-name" onClick={() => go(-1)}>Practice planner</button><nav aria-label="Planner chapters"><ol className="chapters">{chapters.map((c, i) => <li key={c} className={i <= ch ? 'reached' : ''}><button aria-current={i === ch ? 'step' : undefined} onClick={() => go(chapterStart(i))}><i />{c}</button></li>)}</ol></nav><a className="free-label" href="/tools.html">Free planning tool</a></header><main className="layout"><section className={'conversation ' + (step < 0 ? 'welcome' : '')} aria-label="Planner controls"><div className="form-scroll">{content}{sharingBlocked && <Note tone="warning">Choose shared identity or separate extensions for each group with more than one device before continuing.</Note>}{warning && <Note tone="warning">{warning}</Note>}{notice && id !== 'review' && <p className="notice" role="status">{notice}</p>}</div><div className="navigation">{step < 0 ? <span>Prepared with Upstate IP Voice</span> : <><button className="back" onClick={() => go(step - 1)}>← Back</button><button type="button" className="text-button focus-toggle" onClick={() => setFocus(!focus)}>{focus ? 'Show office preview' : 'Focus on questions'}</button>{step < steps.length - 1 ? <button className="primary" disabled={(step === 0 && !p.mode) || sharingBlocked} onClick={() => {
        let nextPlan = p;
        if (id === 'team') {
            const committed = teamForm.current?.commit();
            if (!committed)
                return;
            nextPlan = committed;
        }
        if (id === 'current' && p.mode === 'opening' && p.policy.beforeOpening === 'information' && !p.policy.beforeOpeningText?.trim())
            nextPlan = { ...nextPlan, policy: { ...nextPlan.policy, beforeOpeningText: suggestedGreeting(nextPlan) } };
        const skipConfirm = id === 'hours' && p.policy.hoursPreset === 'undecided';
        if (!skipConfirm && !nextPlan.confirmed.includes(id))
            nextPlan = { ...nextPlan, confirmed: [...new Set([...nextPlan.confirmed, id])] };
        if (nextPlan !== p)
            update(nextPlan);
        go(step + 1);
    }}>{id === 'current' ? 'See your blueprint' : 'Continue'} <Arrow /></button> : <button className="primary" disabled={pdfBusy} onClick={() => pdf('owner')}>{pdfBusy ? 'Creating…' : 'Download blueprint'} ↓</button>}</>}</div></section><Scene p={p} simulation={trace?.trace[Math.min(shown - 1, (trace?.trace.length || 1) - 1)]?.label || ''} mode={sceneMode} chapter={sceneChapterNum} badge={sceneBadge} indexLabel={step < 0 ? 'A PLAN THAT FITS' : String(step + 1).padStart(2, '0') + ' / ' + steps.length} sceneClass={id === 'kind' ? 'specialty-scene' : id === 'team' ? 'team-scene' : ''} showTeamLegend={id === 'team'} showSpecialtyCaption={id === 'kind'}/></main></div>;
}

export default function App() {
    const wizard = typeof location !== 'undefined' && new URLSearchParams(location.search).has('wizard');
    return wizard ? <Wizard /> : <Architect />;
}
