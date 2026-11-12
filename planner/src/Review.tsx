import { useEffect, useState } from 'react';
import { engineerSections, ownerSections } from './plan-content';
import { identity, ownerActions } from './advisor';
import { Field } from './components';
import { hoursSummary, openingLabel } from './flow';
import { roleState } from './team-state';
import { DatePicker, TimePicker } from './pickers';
import { readiness } from './readiness';
import { decisions, graph, journeySeconds, simulate, teamName, type Plan } from './config';

const meeting = 'https://upstateipvoice.com/review/';

function heardFacts(p: Plan) {
    const rec = roleState(p, 'reception');
    const clin = roleState(p, 'clinical');
    const adm = roleState(p, 'administration');
    const bits: string[] = [];
    if (p.policy.cityState)
        bits.push(p.policy.cityState);
    if (rec.status === 'known')
        bits.push(rec.count + (rec.count === 1 ? ' at the front desk' : ' at the front desk'));
    if (clin.status === 'known')
        bits.push(clin.count + (clin.count === 1 ? ' clinician' : ' clinicians'));
    if (adm.status === 'known')
        bits.push(adm.count === 0 ? 'No separate administrator' : adm.count + ' administration');
    if (p.first.kind === 'human')
        bits.push('Person first' + (p.first.team ? ' · ' + teamName(p, p.first.team) : ''));
    if (p.busy.kind === 'message')
        bits.push('Voicemail if nobody answers' + (p.busy.owner ? ' · ' + teamName(p, p.busy.owner) : ''));
    else if (p.busy.kind === 'queue')
        bits.push('A short wait if staff are busy');
    if (p.after.kind === 'message')
        bits.push('Voicemail after hours' + (p.after.owner ? ' · ' + teamName(p, p.after.owner) : ''));
    else if (p.after.kind === 'service')
        bits.push('Answering service after hours');
    const hours = hoursSummary(p);
    if (hours && p.confirmed.includes('hours'))
        bits.push(hours);
    else if (p.hours.days.some(d => d.breakStart && d.breakEnd))
        bits.push('Lunch close ' + p.hours.days.find(d => d.breakStart)?.breakStart + '–' + p.hours.days.find(d => d.breakEnd)?.breakEnd);
    if (p.languages.some(l => l.name === 'Spanish') || (p.policy.languageDecision === 'selected' && p.languages.length))
        bits.push(p.languages.some(l => l.name === 'Spanish') ? 'Spanish coverage' : 'Additional language');
    else if (p.policy.languageDecision === 'none')
        bits.push('English only');
    if (p.policy.opening.numbers === 'new')
        bits.push('New number');
    else if (p.policy.opening.numbers === 'porting')
        bits.push('Keep the existing number');
    if (p.policy.roomsSpecified && p.policy.rooms)
        bits.push(p.policy.rooms + ' rooms, not a phone order');
    const sharing = p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing;
    if (sharing === 'separate')
        bits.push('Two front-desk lines can pick up at once');
    else if (sharing === 'shared' && rec.count > 1)
        bits.push('Front desk shares one line');
    if (/work mobile answering|work app \/ follow me/i.test(p.policy.notes + ' ' + p.policy.continuity.notes))
        bits.push('Work mobile can ring');
    if (p.mode === 'opening' && p.policy.beforeOpening === 'information')
        bits.push('Not-open-yet recording before day one');
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'message')
        bits.push('Callback messages before day one');
    else if (p.mode === 'opening' && p.policy.beforeOpening === 'undecided')
        bits.push('Before-opening path not decided');
    if (p.policy.urgentScope === 'urgent_only')
        bits.push('On-call only for urgent calls');
    else if (p.policy.urgentScope === 'all_calls')
        bits.push('Clinician for every incoming call');
    else if (p.policy.urgentKind === 'none')
        bits.push('No live on-call');
    else if (p.policy.urgentKind === 'undecided')
        bits.push('On-call not decided');
    else if (p.policy.urgentKind === 'connect')
        bits.push('Proposed on-call path');
    return bits;
}

function metric(undecided: boolean, value: number, open: string, set: string) {
    return { value: undecided ? '—' : String(value), label: undecided ? open : set };
}

export function Review({ p, pdfBusy, notice, onNotice, onPdf, run, trace, shown, scenario: _scenario, setScenario, testPreset, setTestPreset, customDate, setCustomDate, customTime, setCustomTime, callerReason, setCallerReason, callerLanguage, setCallerLanguage, assistantRequest, setAssistantRequest, humanRequest, setHumanRequest }: {
    p: Plan;
    pdfBusy: boolean;
    notice: string;
    onNotice: (s: string) => void;
    onPdf: (kind: 'owner' | 'engineer') => void;
    onJump: (id: string) => void;
    run: () => void;
    trace: ReturnType<typeof simulate> | null;
    shown: number;
    paused: boolean;
    setPaused: (v: boolean) => void;
    scenario: string;
    setScenario: (v: string) => void;
    testPreset: string;
    setTestPreset: (v: string) => void;
    customDate: string;
    setCustomDate: (v: string) => void;
    customTime: string;
    setCustomTime: (v: string) => void;
    callerReason: string;
    setCallerReason: (v: string) => void;
    callerLanguage: string;
    setCallerLanguage: (v: string) => void;
    assistantRequest: string;
    setAssistantRequest: (v: string) => void;
    humanRequest: boolean;
    setHumanRequest: (v: boolean) => void;
}) {
    const pending = decisions(p), ready = readiness(p), actions = ownerActions(p).slice(0, 5);
    const facts = heardFacts(p);
    const [panel, setPanel] = useState<'none' | 'test' | 'tech'>('none');
    const unanswered = journeySeconds(p, { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false });
    const metrics = [
        metric(p.endpoints.undecided, p.endpoints.desk, 'Desk phones', 'Reception phones'),
        metric(p.endpoints.undecided, p.endpoints.computer, 'Computers', 'Computer positions'),
        metric(p.endpoints.undecided, p.endpoints.mobile, 'Mobiles', 'Mobile endpoints')
    ];
    const usesAssistant = [p.first.kind, p.busy.kind, p.after.kind].includes('assistant');

    function toggle(next: 'test' | 'tech') {
        setPanel(panel === next ? 'none' : next);
    }

    useEffect(() => {
        if (panel === 'none')
            return;
        const node = document.querySelector('.blueprint-panel');
        if (node instanceof HTMLElement)
            node.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    }, [panel]);

    return <div className="blueprint">
        <header className="blueprint-head">
            <p className="chat-question-kicker">Your blueprint</p>
            <h2 className="blueprint-name">{p.name.trim() || openingLabel(p).split(' · ')[0] || 'Your practice'}</h2>
            <p className="blueprint-dek">{p.name.trim() && openingLabel(p) ? openingLabel(p) : 'A plan for how patients reach you.'}</p>
            <p className="blueprint-status">{ready.label}. Nothing is installed yet.</p>
            {facts.length > 0 && <ul className="blueprint-facts">{facts.map(fact => <li key={fact}>{fact}</li>)}</ul>}
        </header>

        <section className="blueprint-metrics" aria-label="Phone positions">
            {metrics.map(item => <div key={item.label}><strong>{item.value}</strong><span>{item.label}</span></div>)}
        </section>

        <div className="blueprint-actions">
            <button type="button" className="blueprint-download" disabled={pdfBusy} onClick={() => onPdf('owner')}>{pdfBusy ? 'Creating your PDF…' : (pending.length ? 'Download draft blueprint' : 'Download owner blueprint')}</button>
            <div className="blueprint-aside">
                <button type="button" className={panel === 'test' ? 'is-open' : ''} aria-pressed={panel === 'test'} onClick={() => toggle('test')}>Walk a call</button>
                <button type="button" className={panel === 'tech' ? 'is-open' : ''} aria-pressed={panel === 'tech'} onClick={() => toggle('tech')}>Technical spec</button>
                <a href={meeting} target="_blank" rel="noopener noreferrer" onClick={() => onNotice('Scheduling opened in a new tab. Your plan stays on this device until you choose to share it.')}>Book a time</a>
            </div>
        </div>

        {panel === 'test' && <section className="blueprint-panel" aria-label="Walk a call">
            <p className="decision-kicker">Walk a call</p>
            <h3>What a patient would hear</h3>
            <p className="blueprint-panel-note">Accelerated playback. No calls are sent.</p>
            <div className="blueprint-presets" role="group" aria-label="When the call arrives">
                {[['normal', 'During office hours'], ['closed', 'After closing'], ['unanswered', 'Nobody answers'], ['custom', 'Choose another time']].map(([id, label]) =>
                    <button type="button" key={id} className={testPreset === id || (id === 'custom' && testPreset === 'holiday') ? 'active' : ''} onClick={() => { setTestPreset(id); setScenario(id === 'custom' ? 'normal' : id); }}>{label}</button>)}
            </div>
            {testPreset === 'custom' && <div className="inline"><DatePicker label="Date" value={customDate} precision={customDate ? 'day' : 'none'} allowApproximate={false} onChange={date => setCustomDate(date)}/><TimePicker label={'Time in ' + p.hours.timezone} value={customTime} onChange={setCustomTime}/></div>}
            <Field label="Why they are calling"><select value={callerReason} onChange={e => setCallerReason(e.target.value)}><option value="">First configured reason</option>{p.reasons.map(r => <option key={r.id} value={r.id}>{r.label}</option>)}</select></Field>
            {p.languages.length > 0 && <Field label="Language requested"><select value={callerLanguage} onChange={e => setCallerLanguage(e.target.value)}><option value="">No additional language</option>{p.languages.map(l => <option key={l.name}>{l.name}</option>)}</select></Field>}
            {usesAssistant && <><Field label="If an AI receptionist answers"><select value={assistantRequest} onChange={e => setAssistantRequest(e.target.value)}><option value="">First permitted task</option>{['General information', 'Capture a callback request', 'Appointment requests', 'Connect callers to a team', 'Unsupported request'].map(t => <option key={t}>{t}</option>)}</select></Field><label className="check"><input type="checkbox" checked={humanRequest} onChange={e => setHumanRequest(e.target.checked)}/>Caller asks for a person</label></>}
            <button type="button" className="blueprint-secondary" onClick={run}>{trace ? 'Replay this call' : 'Walk this call'}</button>
            {unanswered.total > 0 && <p className="blueprint-panel-note">If nobody answers during open hours, the wait is {unanswered.total}s before {unanswered.terminal}.</p>}
            {trace && <ol className="call-trace" aria-live="polite">{trace.trace.slice(0, shown).map((n, i) => <li key={i}><strong>{n.label}</strong><small>{n.detail}{n.seconds ? ' · ' + n.seconds + 's' : ''}</small>{trace.reasons[i] && <small className="branch-reason">{trace.reasons[i]}</small>}</li>)}</ol>}
        </section>}

        {panel === 'tech' && <section className="blueprint-panel" aria-label="Technical spec">
            <p className="decision-kicker">Technical spec</p>
            <h3>For the installer</h3>
            <p className="blueprint-panel-note">{identity(p).planId} · revision {identity(p).revision}. The installer spec must match this ID.</p>
            <button type="button" className="blueprint-secondary" disabled={pdfBusy} onClick={() => onPdf('engineer')}>Download implementation spec</button>
            <details className="blueprint-fold"><summary>Owner plan as text</summary>{ownerSections(p).map(([title, lines]) => <div key={title}><h3>{title}</h3>{lines.map((line, i) => <p key={i}>{line}</p>)}</div>)}</details>
            <details className="blueprint-fold impl-block"><summary>Implementation outline</summary><div className="impl-sections">{engineerSections(p).map(([title, lines]) => <section className="impl-section" key={title}><h3>{title}</h3><ul>{lines.map((line, i) => <li key={i}>{line}</li>)}</ul></section>)}</div></details>
            <details className="blueprint-fold"><summary>Routing graph</summary><ol className="graph-list">{Object.values(graph(p).nodes).map(n => <li key={n.id}><strong>{n.label}</strong><small>{n.detail}</small></li>)}</ol></details>
        </section>}

        {actions.length > 0 && <section className="blueprint-open">
            <p className="decision-kicker">Still open</p>
            <h3>Resolve these before installing</h3>
            <ul className="decision-list">{actions.map(a => <li key={a.id}><strong>{a.label}</strong>{a.detail && <small>{a.detail}</small>}</li>)}</ul>
            {pending.length > 5 && <p className="blueprint-more">{pending.length - 5} more stay in the download.</p>}
        </section>}

        {notice && <p className="notice" role="status">{notice}</p>}
    </div>;
}
