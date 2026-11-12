import { useEffect, useRef, useState } from 'react';
import { Review } from './Review';
import { Scene } from './ScenePanel';
import { Note } from './components';
import { read, commit, key, scenarios, simulate, type Plan } from './config';
import { chapterIndex, chapters, help } from './flow';
import {
    callerHear, canPreviewHear, chapterForQuestion, chipTurn, createRemoteSession, emptyFacts, headerChapter, interpretRemote, interpretTurn, nextQuestion, questionById, updatesFromOwnerText,
    persistRemotePlan, readConversation, recordRemoteTurn, saveConversation, sceneFromPlan
} from './architect/index';
import type { Chip, ConversationRecord, Fact, InterpreterResponse, NextQuestion } from './architect/index';

const EXAMPLE = "I'm opening a dental practice in New York next March. We're planning six operatories, two receptionists, a dentist, three assistants, and an office manager. I want patients to reach the front desk first, but we need help after hours. I don't know how many phones to buy.";
const GREETING = "Describe your practice in your own words. I will collect what I can and only ask what still changes the plan.";
const EXAMPLE_INTERPRETER: InterpreterResponse = {
    acknowledgement: 'Opening a dental practice in New York with six operatories and a front-desk-first plan. I left phones unset, and after-hours is still open.',
    intent: 'provide_information',
    updates: [
        { field_id: 'mode', operation: 'set', value: 'opening', evidence: 'opening a dental practice', needs_confirmation: false },
        { field_id: 'specialty', operation: 'set', value: 'Dental', evidence: 'dental practice', needs_confirmation: false },
        { field_id: 'cityState', operation: 'set', value: 'New York', evidence: 'in New York', needs_confirmation: false },
        { field_id: 'opening.date', operation: 'set', value: 'March', evidence: 'next March', needs_confirmation: false },
        { field_id: 'opening.precision', operation: 'set', value: 'month', evidence: 'next March', needs_confirmation: false },
        { field_id: 'policy.rooms', operation: 'set', value: 6, evidence: 'six operatories', needs_confirmation: false },
        { field_id: 'teams.reception.count', operation: 'set', value: 2, evidence: 'two receptionists', needs_confirmation: false },
        { field_id: 'teams.clinical.count', operation: 'set', value: 4, evidence: 'a dentist, three assistants', needs_confirmation: false },
        { field_id: 'teams.administration.count', operation: 'set', value: 1, evidence: 'an office manager', needs_confirmation: false },
        { field_id: 'first.kind', operation: 'set', value: 'human', evidence: 'reach the front desk first', needs_confirmation: false },
        { field_id: 'first.team', operation: 'set', value: 'reception', evidence: 'front desk', needs_confirmation: false }
    ],
    unmapped_facts: ['need help after hours', 'do not know how many phones to buy'],
    explanation_topic: null
};

type ChatMessage = ConversationRecord['messages'][number];
type HearRow = ReturnType<typeof callerHear>[number];

function isHearDump(message: ChatMessage) {
    return message.role === 'assistant' && message.content.startsWith('What a caller hears');
}

function HearPanel({ rows }: { rows: HearRow[] }) {
    const scripts = rows.filter(row => row.kind !== 'note');
    if (!scripts.length)
        return null;
    return <section className="hear-panel" aria-label="What a caller hears">
        <p className="hear-panel-kicker">What a caller hears</p>
        <p className="hear-panel-note">A preview of the path, not a live call.</p>
        <ol className="caller-hear">{scripts.map(row => <li key={row.when}><strong>{row.when}</strong><span>{row.hear}</span></li>)}</ol>
    </section>;
}

function newId() {
    return crypto.randomUUID();
}

function prefersReducedMotion() {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function wait(ms: number) {
    if (prefersReducedMotion())
        return Promise.resolve();
    return new Promise<void>(resolve => setTimeout(resolve, ms));
}

function autoSize(el: HTMLTextAreaElement | null) {
    if (!el)
        return;
    el.style.height = '0px';
    el.style.height = Math.min(132, Math.max(24, el.scrollHeight)) + 'px';
}

function confirmedState(facts: Record<string, Fact>) {
    const out: Record<string, unknown> = {};
    for (const [id, fact] of Object.entries(facts))
        if (fact.status === 'confirmed')
            out[id] = fact.value;
    return out;
}

function presentQuestion(text: string, detail: string) {
    const split = text.match(/^(How |Who |What |Do |Does )(.{18,56}?), ([a-z].+)\?$/);
    if (split && text.length > 58) {
        const title = (split[1] + split[2]).trim() + '?';
        const lead = split[3].charAt(0).toUpperCase() + split[3].slice(1).replace(/\?$/, '') + '.';
        return { title, lead, detail };
    }
    return { title: text, lead: '', detail };
}

function choiceKind(chips: Chip[]) {
    if (!chips.length)
        return 'wrap' as const;
    if (chips.every(chip => chip.label.length <= 12))
        return 'compact' as const;
    if (chips.length <= 4 && chips.some(chip => chip.label.length > 16))
        return 'stack' as const;
    return 'wrap' as const;
}

function TypedText({ text, live }: { text: string; live: boolean }) {
    const reduce = prefersReducedMotion();
    const [shown, setShown] = useState(live && !reduce && text.length < 280 ? '' : text);
    useEffect(() => {
        if (!live || reduce || text.length >= 280) {
            setShown(text);
            return;
        }
        const parts = text.split(/(\s+)/);
        let i = 0;
        let id: ReturnType<typeof setTimeout>;
        const tick = () => {
            i++;
            setShown(parts.slice(0, i).join(''));
            if (i < parts.length)
                id = setTimeout(tick, parts[i - 1].trim() ? 26 : 10);
        };
        id = setTimeout(tick, 40);
        return () => clearTimeout(id);
    }, [text, live]);
    return <p>{shown}</p>;
}

export function Architect() {
    const loaded = useRef(read());
    const saved = useRef(readConversation());
    const [p, setP] = useState(loaded.current.plan);
    const [facts, setFacts] = useState<Record<string, Fact>>(saved.current?.facts || emptyFacts());
    const [future, setFuture] = useState<string[]>(saved.current?.futureConsiderations || []);
    const [messages, setMessages] = useState<ChatMessage[]>(saved.current?.messages?.length ? saved.current.messages : [{ id: 'greet', role: 'assistant', content: GREETING, questionId: null }]);
    const [sessionId, setSessionId] = useState(saved.current?.sessionId || '');
    const [remoteRevision, setRemoteRevision] = useState(saved.current?.revision || 0);
    const sessionIdRef = useRef(saved.current?.sessionId || '');
    const remoteRevRef = useRef(saved.current?.revision || 0);
    const [input, setInput] = useState('');
    const [busy, setBusy] = useState(false);
    const [typing, setTyping] = useState(false);
    const [picked, setPicked] = useState<string | null>(null);
    const [leaving, setLeaving] = useState(false);
    const [suppressPrompt, setSuppressPrompt] = useState(false);
    const [heldQuestion, setHeldQuestion] = useState<NextQuestion | null>(null);
    const [freshId, setFreshId] = useState<string | null>(null);
    const [error, setError] = useState('');
    const [warning, setWarning] = useState(loaded.current.warning);
    const [reviewing, setReviewing] = useState(false);
    const [correcting, setCorrecting] = useState<ChatMessage | null>(null);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);
    const [paused, setPaused] = useState(false), [assistantRequest, setAssistantRequest] = useState(''), [humanRequest, setHumanRequest] = useState(false);
    const [testPreset, setTestPreset] = useState('normal'), [customDate, setCustomDate] = useState(''), [customTime, setCustomTime] = useState('09:00');
    const [callerReason, setCallerReason] = useState(''), [callerLanguage, setCallerLanguage] = useState('');
    const [scenario, setScenario] = useState('normal'), [trace, setTrace] = useState<ReturnType<typeof simulate> | null>(null), [shown, setShown] = useState(0);
    const log = useRef<HTMLDivElement>(null), generation = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);
    const skipAutoScroll = useRef(false);
    const pendingScroll = useRef<string | 'prompt' | null>(null);
    const liveQuestion = nextQuestion(p, facts);
    const correctingQuestion = correcting?.questionId ? questionById(correcting.questionId, p, facts) : null;
    const question = correcting ? correctingQuestion : (heldQuestion || liveQuestion);
    const holdPrompt = busy || typing || !!picked || leaving || suppressPrompt || !!heldQuestion;
    const view = sceneFromPlan(p, reviewing);
    const filledChapter = headerChapter(p, reviewing);
    const currentChapter = reviewing || !liveQuestion ? 5 : (chapterForQuestion(liveQuestion.id) ?? filledChapter);
    const reached = Math.max(filledChapter, currentChapter);
    const interacting = holdPrompt;

    function persistLocal(next: { plan?: Plan; facts?: Record<string, Fact>; future?: string[]; messages?: ChatMessage[]; sessionId?: string; revision?: number; questionId?: string | null }) {
        const prev = readConversation();
        const record: ConversationRecord = {
            sessionId: next.sessionId ?? prev?.sessionId ?? sessionIdRef.current,
            revision: next.revision ?? prev?.revision ?? remoteRevRef.current,
            facts: next.facts ?? prev?.facts ?? facts,
            currentQuestionId: next.questionId ?? prev?.currentQuestionId ?? question?.id ?? null,
            futureConsiderations: next.future ?? prev?.futureConsiderations ?? future,
            messages: next.messages ?? prev?.messages ?? messages
        };
        saveConversation(record);
    }

    function writePlan(next: Plan) {
        try {
            const savedPlan = next.revision === p.revision ? commit(p, next) : next;
            setP(savedPlan);
            try {
                localStorage.setItem(key, JSON.stringify(savedPlan));
                setWarning('');
            }
            catch {
                setWarning('Saved for this visit only. Download your PDF before leaving.');
            }
            return savedPlan;
        }
        catch {
            setError('That change could not be saved into the plan. Nothing else was overwritten.');
            return p;
        }
    }

    useEffect(() => {
        if (skipAutoScroll.current) {
            skipAutoScroll.current = false;
            return;
        }
        const reduce = prefersReducedMotion();
        if (!question && !typing && !busy && !suppressPrompt) {
            const node = log.current?.querySelector('.chat-prompt-draft');
            if (node instanceof HTMLElement) {
                node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
                return;
            }
        }
        log.current?.scrollTo({ top: log.current.scrollHeight, behavior: reduce ? 'auto' : 'smooth' });
    }, [messages, typing, question?.id, busy, suppressPrompt]);
    useEffect(() => () => { if (timer.current)
        clearTimeout(timer.current); }, []);
    useEffect(() => {
        if (!highlightId)
            return;
        const t = setTimeout(() => setHighlightId(null), 2800);
        return () => clearTimeout(t);
    }, [highlightId]);
    useEffect(() => {
        if (!reviewing)
            return;
        const node = document.querySelector('.architect-review');
        if (node instanceof HTMLElement)
            node.scrollTo({ top: 0 });
    }, [reviewing]);
    useEffect(() => {
        if (reviewing || !pendingScroll.current)
            return;
        const target = pendingScroll.current;
        pendingScroll.current = null;
        const id = requestAnimationFrame(() => scrollChatTo(target));
        return () => cancelAnimationFrame(id);
    }, [reviewing, messages]);

    function scrollChatTo(target: string | 'prompt') {
        const reduce = prefersReducedMotion();
        const node = target === 'prompt'
            ? log.current?.querySelector('.chat-prompt-block')
            : document.getElementById('msg-' + target);
        if (node instanceof HTMLElement)
            node.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: target === 'prompt' ? 'end' : 'center' });
        else
            log.current?.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
    }

    function messageForChapter(chapter: number) {
        const users = messages.filter(m => m.role === 'user' && chapterForQuestion(m.questionId) === chapter);
        if (users.length)
            return users[users.length - 1];
        const any = messages.find(m => chapterForQuestion(m.questionId) === chapter);
        if (any)
            return any;
        if (chapter === 0)
            return messages.find(m => m.role === 'user' && !m.questionId) || messages.find(m => m.role === 'user') || null;
        return null;
    }

    function goChapter(chapter: number) {
        if (chapter === 5) {
            setReviewing(true);
            setCorrecting(null);
            return;
        }
        skipAutoScroll.current = true;
        setCorrecting(null);
        const hit = messageForChapter(chapter);
        const liveInChapter = !!(liveQuestion && chapterForQuestion(liveQuestion.id) === chapter);
        const target = liveInChapter ? 'prompt' : (hit?.id || 'prompt');
        setHighlightId(hit?.id || null);
        pendingScroll.current = target;
        if (reviewing)
            setReviewing(false);
        else
            requestAnimationFrame(() => {
                pendingScroll.current = null;
                scrollChatTo(target);
            });
    }

    function startCorrect(message: ChatMessage) {
        if (interacting)
            return;
        skipAutoScroll.current = true;
        setReviewing(false);
        setCorrecting(message);
        setHighlightId(message.id);
        pendingScroll.current = 'prompt';
        requestAnimationFrame(() => {
            pendingScroll.current = null;
            scrollChatTo('prompt');
            inputRef.current?.focus();
        });
    }

    function rememberRemote(id: string, revision: number) {
        sessionIdRef.current = id;
        remoteRevRef.current = revision;
        setSessionId(id);
        setRemoteRevision(revision);
    }

    async function ensureSession(plan: Plan) {
        if (sessionIdRef.current)
            return { id: sessionIdRef.current, revision: remoteRevRef.current };
        const created = await createRemoteSession(plan);
        rememberRemote(created.id, created.revision);
        persistLocal({ sessionId: created.id, revision: created.revision });
        return created;
    }

    async function syncPlan(plan: Plan, nextFacts: Record<string, Fact>, nextFuture: string[], sid: string, revision = remoteRevRef.current) {
        try {
            const savedRemote = await persistRemotePlan(sid, plan, revision, nextFacts, nextFuture);
            rememberRemote(sid, savedRemote.revision);
            persistLocal({ plan, facts: nextFacts, future: nextFuture, sessionId: sid, revision: savedRemote.revision });
        }
        catch (err) {
            if ((err as Error).message === 'conflict')
                setError('Could not sync this draft to the server. Your answers are still saved on this device.');
        }
    }

    function applyInterpreter(plan: Plan, currentFacts: Record<string, Fact>, interpreter: InterpreterResponse, userText: string, extras?: { question?: NextQuestion | null; correcting?: boolean }) {
        const turned = interpretTurn({ plan, facts: currentFacts, interpreter, userText, question: extras?.question ?? question, future, correcting: extras?.correcting });
        if (turned.changed)
            writePlan(turned.plan);
        setFacts(turned.facts);
        setFuture(turned.future);
        let ack = turned.ack;
        if (turned.confirmationNeeded.length)
            ack += ' I need you to confirm a change before I replace an earlier answer.';
        if (turned.futureConsiderations.length && !/later|future/i.test(ack))
            ack += ' I noted a future idea without putting it in the launch plan.';
        const assistant: ChatMessage = { id: newId(), role: 'assistant', content: ack, questionId: turned.follow?.id || null };
        setFreshId(assistant.id);
        setMessages(m => {
            const nextMessages = [...m, assistant];
            persistLocal({ facts: turned.facts, future: turned.future, messages: nextMessages, questionId: turned.follow?.id || null });
            return nextMessages;
        });
        if (turned.intent === 'generate_draft')
            setReviewing(true);
        if (interpreter.explanation_topic && help[interpreter.explanation_topic])
            setNotice(help[interpreter.explanation_topic]);
        return { plan: turned.plan, facts: turned.facts, future: turned.future };
    }

    async function send(text: string) {
        const trimmed = text.trim();
        if (!trimmed || interacting)
            return;
        const targetQuestion = correctingQuestion || question;
        const userMsg: ChatMessage = { id: newId(), role: 'user', content: trimmed, questionId: targetQuestion?.id || null };
        setHeldQuestion(targetQuestion);
        skipAutoScroll.current = false;
        setInput('');
        setError('');
        setFreshId(userMsg.id);
        setMessages(m => [...m, userMsg]);
        requestAnimationFrame(() => autoSize(inputRef.current));
        setLeaving(true);
        setBusy(true);
        await wait(220);
        setSuppressPrompt(true);
        setLeaving(false);
        setTyping(true);
        try {
            const remote = await ensureSession(p);
            const result = await interpretRemote({
                sessionId: remote.id,
                clientMessageId: newId(),
                text: trimmed,
                currentQuestionId: targetQuestion?.id || null,
                currentQuestion: targetQuestion,
                confirmedState: confirmedState(facts),
                facts,
                history: [...messages, userMsg].filter(m => !isHearDump(m)),
                timezone: p.hours.timezone
            });
            if (typeof result.revision === 'number')
                remoteRevRef.current = result.revision;
            const applied = applyInterpreter(p, facts, result.interpreter, trimmed, { question: targetQuestion, correcting: !!correcting });
            await syncPlan(applied.plan, applied.facts, applied.future, remote.id, remoteRevRef.current);
        }
        catch (err) {
            if (trimmed === EXAMPLE) {
                applyInterpreter(p, facts, EXAMPLE_INTERPRETER, trimmed, { question: targetQuestion, correcting: !!correcting });
                return;
            }
            const hinted = updatesFromOwnerText(trimmed, targetQuestion, facts);
            if (hinted.length) {
                applyInterpreter(p, facts, {
                    acknowledgement: '',
                    intent: correcting ? 'correct_information' : 'provide_information',
                    updates: hinted,
                    unmapped_facts: [],
                    explanation_topic: null
                }, trimmed, { question: targetQuestion, correcting: !!correcting });
                return;
            }
            const code = (err as Error).message;
            const assistant: ChatMessage = { id: newId(), role: 'assistant', content: code === 'rate' ? 'Too many messages. Please wait a few minutes.' : 'The planning assistant is temporarily unavailable. Your plan is unchanged. You can still choose an option below.', questionId: targetQuestion?.id || null };
            setFreshId(assistant.id);
            setMessages(m => [...m, assistant]);
            setError(code === 'rate' ? 'Too many messages. Please wait a few minutes.' : 'The planning assistant is temporarily unavailable. You can still choose an option below or download a draft.');
        }
        finally {
            setBusy(false);
            setTyping(false);
            setSuppressPrompt(false);
            setLeaving(false);
            setHeldQuestion(null);
            setCorrecting(null);
        }
    }

    async function choose(chip: Chip) {
        if (interacting)
            return;
        setError('');
        skipAutoScroll.current = false;
        setHeldQuestion(question);
        setPicked(chip.id);
        const merged = chipTurn({ plan: p, facts, chip, future, correcting: !!correcting });
        const nextPlan = merged.changed ? writePlan(merged.plan) : p;
        setFacts(merged.facts);
        const userMsg: ChatMessage = { id: newId(), role: 'user', content: chip.label, questionId: question?.id || null };
        const assistant: ChatMessage = { id: newId(), role: 'assistant', content: merged.ack, questionId: merged.follow?.id || null };
        await wait(200);
        setLeaving(true);
        await wait(280);
        setFreshId(userMsg.id);
        setMessages(m => [...m, userMsg]);
        setPicked(null);
        setSuppressPrompt(true);
        setLeaving(false);
        setTyping(true);
        await wait(520);
        setFreshId(assistant.id);
        setMessages(m => {
            const nextMessages = [...m, assistant];
            persistLocal({ facts: merged.facts, messages: nextMessages, questionId: merged.follow?.id || null });
            return nextMessages;
        });
        setTyping(false);
        setSuppressPrompt(false);
        setHeldQuestion(null);
        setCorrecting(null);
        try {
            const remote = await ensureSession(nextPlan);
            const recorded = await recordRemoteTurn(remote.id, newId(), chip.label, merged.ack, question?.id || null);
            if (typeof recorded === 'number')
                remoteRevRef.current = recorded;
            await syncPlan(nextPlan, merged.facts, future, remote.id, remoteRevRef.current);
        }
        catch { /* chips work without the API */ }
    }

    async function pdf(kind: 'owner' | 'engineer' | 'both' = 'owner') {
        setPdfBusy(true);
        const snapshot = structuredClone(p);
        try {
            const mod = await import('./pdf');
            if (kind === 'engineer')
                await mod.downloadEngineerPDF(snapshot);
            else if (kind === 'both')
                await mod.downloadBothPDF(snapshot);
            else
                await mod.downloadPDF(snapshot);
            setNotice((kind === 'engineer' ? 'Implementation spec' : 'Owner blueprint') + ' downloaded. It stays on this device.');
        }
        catch {
            setNotice('PDF export failed. Your plan is preserved.');
        }
        finally {
            setPdfBusy(false);
        }
    }

    function run() {
        if (timer.current)
            clearTimeout(timer.current);
        const selected = scenarios(p).find(s => s.id === scenario) || scenarios(p)[0];
        const at = testPreset === 'custom' && customDate && customTime ? customDate + 'T' + customTime + ':00' : undefined;
        const result = simulate(p, { ...selected, at, request: assistantRequest || undefined, humanRequested: humanRequest, reason: callerReason || undefined, language: selected.language || callerLanguage || undefined });
        setPaused(false);
        const token = ++generation.current;
        setTrace(result);
        setShown(1);
        let i = 1;
        const next = () => { if (generation.current !== token)
            return; i++; setShown(i); if (i < result.trace.length)
            timer.current = setTimeout(next, 450); };
        if (matchMedia('(prefers-reduced-motion: reduce)').matches)
            setShown(result.trace.length);
        else
            timer.current = setTimeout(next, 450);
    }

    const chips = question?.options || [];
    const simulation = trace?.trace[Math.min(shown - 1, (trace?.trace.length || 1) - 1)]?.label || '';
    const showExample = !p.mode && messages.length <= 1 && !interacting;
    const welcome = !p.mode && messages.length <= 2;
    let hear: ReturnType<typeof callerHear> = [];
    try {
        hear = callerHear(p);
    }
    catch {
        hear = [];
    }
    const draftReady = !question && !typing && !busy && !suppressPrompt && !correcting && !welcome;
    const showHear = draftReady && canPreviewHear(p) && hear.some(row => row.kind !== 'note');

    return <div className={'planner architect' + (reviewing ? ' reviewing' : '')} data-step="architect" data-revision={p.revision}>
        <header className="header">
            <a className="brand" href="/tools.html" aria-label="Back to Free Tools"><img src="/assets/upstate-logo.svg" alt="Upstate IP Voice"/></a>
            <button type="button" className="product-name" onClick={() => { setReviewing(false); setCorrecting(null); }}>Practice planner</button>
            <nav aria-label="Planner chapters">
                <ol className="chapters">{chapters.map((c, i) => <li key={c} className={i <= reached ? 'reached' : ''}>
                    <button aria-current={i === currentChapter ? 'step' : undefined} onClick={() => goChapter(i)}><i />{c}</button>
                </li>)}</ol>
            </nav>
            <a className="free-label" href="/tools.html">Free planning tool</a>
        </header>
        <main className="layout">
            <section className={'conversation architect-chat' + (welcome ? ' welcome' : '')} aria-label="Practice architect">
                {reviewing ? <div className="form-scroll architect-review">
                    <button type="button" className="review-back" onClick={() => setReviewing(false)}>Back to conversation</button>
                    <Review p={p} pdfBusy={pdfBusy} notice={notice} onNotice={setNotice} onPdf={k => pdf(k)} onJump={id => goChapter(chapterIndex(id))} run={run} trace={trace} shown={shown} paused={paused} setPaused={setPaused} scenario={scenario} setScenario={setScenario} testPreset={testPreset} setTestPreset={setTestPreset} customDate={customDate} setCustomDate={setCustomDate} customTime={customTime} setCustomTime={setCustomTime} callerReason={callerReason} setCallerReason={setCallerReason} callerLanguage={callerLanguage} setCallerLanguage={setCallerLanguage} assistantRequest={assistantRequest} setAssistantRequest={setAssistantRequest} humanRequest={humanRequest} setHumanRequest={setHumanRequest}/>
                </div> : <>
                    <div className="form-scroll architect-log" ref={log}>
                        <div className="eyebrow"><span>Practice architect</span><span className="saved-pill">Saved</span></div>
                        {welcome && <><h1>Design your practice, naturally.</h1><p className="supporting">Tell me how your office works. I will fill in what I can and ask only what still changes the plan.</p></>}
                        {p.mode && p.name.trim() && <p className="architect-live-title">{p.name.trim()}</p>}
                        <ol className="chat-log">
                            {messages.filter(m => !isHearDump(m) && (m.id !== 'greet' || !messages.some(x => x.role === 'user'))).map((m: ChatMessage) => <li key={m.id} id={'msg-' + m.id} className={'chat-turn ' + m.role + (m.id === freshId ? ' fresh' : '') + (m.id === highlightId || m.id === correcting?.id ? ' target' : '')}>
                                <div className={'chat-bubble ' + m.role + (m.id === freshId ? ' fresh' : '')}>
                                    {m.role === 'assistant' && m.id === freshId
                                        ? <TypedText text={m.content} live={m.content.length < 280}/>
                                        : <p>{m.content}</p>}
                                </div>
                                {m.role === 'user' && <button type="button" className="chat-correct" disabled={interacting && correcting?.id !== m.id} onClick={() => startCorrect(m)}>{correcting?.id === m.id ? 'Correcting' : 'Correct'}</button>}
                            </li>)}
                            {typing && <li className="chat-turn assistant">
                                <div className="chat-bubble assistant typing" aria-live="polite">
                                    <span className="sr-only">Writing a reply</span>
                                    <span className="typing-dots" aria-hidden="true"><i/><i/><i/></span>
                                </div>
                            </li>}
                        </ol>
                        {showExample && <button type="button" className="example-prompt" onClick={() => send(EXAMPLE)}>
                            <span>Try an example</span>
                            <p>{EXAMPLE}</p>
                        </button>}
                        {error && <Note tone="warning">{error}</Note>}
                        {warning && <Note tone="warning">{warning}</Note>}
                        {notice && <p className="notice" role="status">{notice}</p>}
                        {question && !suppressPrompt && (() => {
                            const copy = presentQuestion(question.text, question.detail);
                            const primary = chips.filter(chip => chip.operation === 'set');
                            const secondary = chips.filter(chip => chip.operation !== 'set');
                            const main = primary.length ? primary : secondary;
                            const aside = primary.length ? secondary : [];
                            const kind = choiceKind(main);
                            const kicker = correcting ? 'Correct an answer' : (chapters[chapterForQuestion(question.id) ?? currentChapter] || 'Your practice');
                            return <div className={'chat-prompt-block' + (leaving ? ' leaving' : '')} key={question.id}>
                                <p className="chat-question-kicker">{kicker}</p>
                                <h2 className="chat-question-text">{copy.title}</h2>
                                {copy.lead && <p className="chat-question-lead">{copy.lead}</p>}
                                {copy.detail && <p className="chat-question-detail">{copy.detail}</p>}
                                <div className="chat-choices">
                                    <div className={'chat-chips ' + kind}>
                                        {main.map((chip: Chip) => <button type="button" key={chip.id} className={'chat-chip' + (picked === chip.id ? ' picked' : '')} disabled={interacting && picked !== chip.id} onClick={() => choose(chip)}>{chip.label}</button>)}
                                    </div>
                                    {aside.length > 0 && <div className="chat-chips aside">
                                        {aside.map((chip: Chip) => <button type="button" key={chip.id} className={'chat-chip quiet' + (picked === chip.id ? ' picked' : '')} disabled={interacting && picked !== chip.id} onClick={() => choose(chip)}>{chip.label}</button>)}
                                    </div>}
                                </div>
                            </div>;
                        })()}
                        {draftReady && <div className="chat-prompt-block chat-prompt-draft">
                            <p className="chat-question-kicker">Your blueprint</p>
                            <h2 className="chat-question-text">A draft is ready from what we have.</h2>
                            <p className="chat-question-detail">You can still change answers. The implementation spec stays a planning document until an installer verifies it.</p>
                            {showHear && <HearPanel rows={hear}/>}
                            <div className="chat-choices">
                                <div className="chat-chips stack">
                                    <button type="button" className="chat-chip" onClick={() => setReviewing(true)}>Review blueprint</button>
                                </div>
                            </div>
                        </div>}
                    </div>
                    <div className="architect-dock">
                        {correcting && <div className="correct-bar">
                            <p>Correcting <strong>{correcting.content.length > 42 ? correcting.content.slice(0, 42) + '…' : correcting.content}</strong></p>
                            <button type="button" onClick={() => setCorrecting(null)}>Cancel</button>
                        </div>}
                        <form className="architect-composer" onSubmit={e => { e.preventDefault(); send(input); }}>
                            <label className="sr-only" htmlFor="architect-input">Describe your practice</label>
                            <div className={'composer-shell' + (input.trim() ? ' has-text' : '')}>
                                <textarea id="architect-input" ref={inputRef} rows={1} value={input} placeholder={correcting ? 'Type what this should be instead' : question ? 'Or type your answer' : 'Describe the practice in your own words'} disabled={interacting} onChange={e => { setInput(e.target.value); autoSize(e.target); }} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    send(input);
                                } }}/>
                                <button type="submit" className="composer-send" disabled={interacting || !input.trim()} aria-label="Send">
                                    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true"><path d="M10 15.5V4.5M5.2 9.2 10 4.5l4.8 4.7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                                </button>
                            </div>
                        </form>
                    </div>
                </>}
            </section>
            <Scene p={p} simulation={simulation} mode={view.mode} chapter={view.chapter} badge={view.badge} indexLabel={view.indexLabel} sceneClass={view.sceneClass} showTeamLegend={p.teams.some(t => t.status === 'known')} showSpecialtyCaption={!!p.specialty && view.chapter === 1} showEarlyFacts={view.chapter < 2}/>
        </main>
    </div>;
}
