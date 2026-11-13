import { useEffect, useState } from 'react';
import { engineerSections, ownerSections } from './plan-content';
import { buySummary, identity, reviewOpenActions, type BuyLine } from './advisor';
import { Field } from './components';
import { hoursSummary, openingLabel } from './flow';
import { DatePicker, TimePicker } from './pickers';
import { readiness } from './readiness';
import { decisions, graph, journeySeconds, simulate, type Plan } from './config';
import { PRIVACY_COPY } from './privacy';

const meeting = 'https://upstateipvoice.com/review/';

function reviewLine(p: Plan) {
    const bits: string[] = [];
    if (p.policy.cityState)
        bits.push(p.policy.cityState);
    if (p.first.kind === 'human')
        bits.push('Front desk answers first');
    else if (p.first.kind === 'menu')
        bits.push('Menu first');
    else if (p.first.kind === 'assistant')
        bits.push('Virtual receptionist first');
    const hours = hoursSummary(p);
    if (hours && (p.confirmed.includes('hours') || p.hours.days.some(d => d.breakStart)))
        bits.push(hours);
    if (p.after.kind === 'message')
        bits.push('Voicemail after hours');
    else if (p.after.kind === 'service')
        bits.push('Answering service after hours');
    else if (p.after.kind === 'assistant')
        bits.push('After-hours virtual receptionist');
    return bits.slice(0, 4).join(' · ');
}

function qty(line: BuyLine) {
    return line.qty == null ? '—' : String(line.qty);
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
    const pending = decisions(p), ready = readiness(p), buy = buySummary(p), open = reviewOpenActions(p);
    const line = reviewLine(p);
    const [panel, setPanel] = useState<'none' | 'test' | 'tech'>('none');
    const unanswered = journeySeconds(p, { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false });
    const kit: BuyLine[] = [buy.desk, buy.computer, buy.mobile];
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
            {line && <p className="blueprint-line">{line}</p>}
        </header>

        <section className="blueprint-buy" aria-label="What to order">
            <p className="decision-kicker">What to order</p>
            <div className="blueprint-metrics">
                {kit.map(item => <div key={item.label} className={item.qty != null ? 'is-known' : ''}><strong>{qty(item)}</strong><span>{item.label}</span><small>{item.note}</small></div>)}
            </div>
            {buy.roomsNote && <p className="blueprint-buy-note">{buy.roomsNote}</p>}
        </section>

        <div className="blueprint-actions">
            <a className="blueprint-book" href={meeting} target="_blank" rel="noopener noreferrer" onClick={() => onNotice('Scheduling opened in a new tab. ' + PRIVACY_COPY)}>Book a time</a>
            <button type="button" className="blueprint-download" disabled={pdfBusy} onClick={() => onPdf('owner')}>{pdfBusy ? 'Creating your PDF…' : (pending.length ? 'Download draft blueprint' : 'Download owner blueprint')}</button>
            <div className="blueprint-aside">
                <button type="button" className={panel === 'test' ? 'is-open' : ''} aria-pressed={panel === 'test'} onClick={() => toggle('test')}>Walk a call</button>
                <button type="button" className={panel === 'tech' ? 'is-open' : ''} aria-pressed={panel === 'tech'} onClick={() => toggle('tech')}>Technical spec</button>
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

        {open.total > 0 && <details className="blueprint-open">
            <summary>
                <p className="decision-kicker">Still open</p>
                <h3>{open.total} {open.total === 1 ? 'decision' : 'decisions'} to confirm later</h3>
            </summary>
            <ul className="decision-list">{open.items.map(a => <li key={a.id}><strong>{a.label}</strong></li>)}</ul>
            {open.more > 0 && <p className="blueprint-more">{open.more} more stay in the download.</p>}
        </details>}

        {notice && <p className="notice" role="status">{notice}</p>}
    </div>;
}
