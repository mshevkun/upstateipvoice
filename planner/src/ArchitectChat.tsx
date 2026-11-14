import { useEffect, useRef, useState } from 'react';
import { Review } from './Review';
import { Scene } from './ScenePanel';
import { Note } from './components';
import { buySummary, identity, isLocked, purchaseBands } from './advisor';
import { read, commit, initial, key, scenarios, simulate, valid, type Plan } from './config';
import { chapterIndex, chapters, dayIsStated, formatOpening, help, hoursSummary } from './flow';
import { stillOpen } from './readiness';
import { PRIVACY_COPY } from './privacy';
import {
    callerHear, canPreviewHear, chapterForQuestion, chipTurn, clearConversation, createRemoteSession, emptyFacts, headerChapter, interpretRemote, interpretTurn, lockRemoteSession, nextQuestion, questionById, updatesFromOwnerText,
    persistRemotePlan, readConversation, readRemoteSession, recordRemoteTurn, saveConversation, sceneFromPlan, scrubAckNotice, scrubPii
} from './architect/index';
import type { Chip, ConversationRecord, Fact, InterpreterResponse, NextQuestion } from './architect/index';

const EXAMPLE = "I'm opening a dental practice in New York next March. We're planning six operatories, two receptionists, a dentist, three assistants, and an office manager. I want patients to reach the front desk first, but we need help after hours. I don't know how many phones to buy.";
const GREETING = "Describe your practice in your own words. I will collect what I can and only ask what still changes the plan.";

function blueprintReady(p: Plan) {
    return !!p.name.trim() && p.hours.days.some(dayIsStated) && p.first.kind !== 'undecided';
}
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

function labMode() {
    return typeof location !== 'undefined' && new URLSearchParams(location.search).has('lab');
}

function sessionParam() {
    return typeof location !== 'undefined' ? new URLSearchParams(location.search).get('s') : '';
}

function BlueprintRail({
    p, sessionId, locked, hear, pdfBusy, onPdf, onBook, onCopy, onLock
}: {
    p: Plan;
    sessionId: string;
    locked: boolean;
    hear: HearRow[];
    pdfBusy: boolean;
    onPdf: (kind: 'owner' | 'engineer') => void;
    onBook: () => void;
    onCopy: () => void;
    onLock: () => void;
}) {
    const id = identity(p);
    const bands = purchaseBands(p);
    const buy = buySummary(p);
    const order = [
        buy.desk.qty ? buy.desk.qty + ' desk' : '',
        buy.mobile.qty ? buy.mobile.qty + ' work mobile' : '',
        buy.computer.qty ? buy.computer.qty + ' answering computer' : '',
        ...[...bands.required, ...bands.alsoRequired].map(r => r.qty + ' ' + r.item)
    ].filter(Boolean).slice(0, 6);
    const open = stillOpen(p);
    const hours = hoursSummary(p);
    const hoursKnown = p.hours.days.some(dayIsStated);
    return <aside className="blueprint-rail" aria-label="Blueprint">
        <p className="blueprint-kicker">Blueprint</p>
        <h2 className="blueprint-name">{p.name.trim() || 'Your practice'}</h2>
        <p className="blueprint-meta">{[p.policy.cityState, formatOpening(p)].filter(Boolean).join(' · ') || 'City and opening still open'}</p>
        <p className="blueprint-id">{locked ? 'LOCKED' : 'Draft'} {id.planId} · r{id.revision} · {id.checksum}</p>
        <p className="blueprint-hours">{hoursKnown ? hours : 'Hours not given yet'}</p>
        {order.length > 0 && blueprintReady(p) && <div className="blueprint-order">
            <p className="blueprint-label">What to order</p>
            <p>{order.join(' · ')}</p>
            <p className="blueprint-hint">Do not order a phone per room.</p>
        </div>}
        {hear.some(row => row.kind !== 'note') && <div className="blueprint-hear">
            <p className="blueprint-label">When someone calls</p>
            <ol>{hear.filter(row => row.kind !== 'note').map(row => <li key={row.when}><strong>{row.when}</strong> {row.hear}</li>)}</ol>
        </div>}
        {open.length > 0 && <div className="blueprint-open">
            <p className="blueprint-label">Still open — handled at install</p>
            <ul>{open.map(item => <li key={item}>{item}</li>)}</ul>
        </div>}
        <div className="blueprint-actions">
            <button type="button" className="primary" disabled={pdfBusy || !blueprintReady(p)} onClick={() => onPdf('owner')}>{pdfBusy ? 'Creating…' : 'Download owner blueprint'}</button>
            <button type="button" className="secondary" onClick={onBook}>Book a time with Upstate</button>
            <button type="button" className="text-button" disabled={pdfBusy || !blueprintReady(p)} onClick={() => onPdf('engineer')}>For your installer: technical spec</button>
            {sessionId && <button type="button" className="text-button" onClick={onCopy}>Copy my plan link</button>}
            {labMode() && sessionId && !locked && <button type="button" className="text-button" onClick={onLock}>Lock this revision</button>}
        </div>
        <p className="blueprint-privacy">{PRIVACY_COPY}</p>
    </aside>;
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
                id = setTimeout(tick, parts[i - 1].trim() ? 12 : 4);
        };
        id = setTimeout(tick, 16);
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
    const [sheetOpen, setSheetOpen] = useState(false);
    const [locked, setLocked] = useState(false);
    const [conflictRemote, setConflictRemote] = useState<{ planId: string; revision: number; checksum: string } | null>(null);
    const [restarting, setRestarting] = useState(false);
    const [correcting, setCorrecting] = useState<ChatMessage | null>(null);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [notice, setNotice] = useState('');
    const [pdfBusy, setPdfBusy] = useState(false);
    const [paused, setPaused] = useState(false), [assistantRequest, setAssistantRequest] = useState(''), [humanRequest, setHumanRequest] = useState(false);
    const [testPreset, setTestPreset] = useState('normal'), [customDate, setCustomDate] = useState(''), [customTime, setCustomTime] = useState('09:00');
    const [callerReason, setCallerReason] = useState(''), [callerLanguage, setCallerLanguage] = useState('');
    const [scenario, setScenario] = useState('normal'), [trace, setTrace] = useState<ReturnType<typeof simulate> | null>(null), [shown, setShown] = useState(0);
    const log = useRef<HTMLDivElement>(null), generation = useRef(0), epoch = useRef(0), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
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
        const sid = sessionParam();
        if (!sid)
            return;
        let cancelled = false;
        readRemoteSession(sid).then(remote => {
            if (cancelled || !remote.plan || !valid(remote.plan))
                return;
            const remotePlan = remote.plan as Plan;
            const localId = identity(p);
            const remoteId = identity(remotePlan);
            if (p.revision > 0 && localId.checksum && localId.checksum !== remoteId.checksum) {
                setConflictRemote({ planId: remoteId.planId, revision: remoteId.revision, checksum: remoteId.checksum });
                return;
            }
            writePlan(remotePlan);
            if (remote.facts)
                setFacts(remote.facts);
            if (Array.isArray(remote.messages) && remote.messages.length)
                setMessages(remote.messages);
            if (Array.isArray(remote.futureConsiderations))
                setFuture(remote.futureConsiderations);
            sessionIdRef.current = remote.id;
            remoteRevRef.current = remote.revision;
            setSessionId(remote.id);
            setRemoteRevision(remote.revision);
            setLocked(!!remote.lockedRevision && remote.lockedRevision === remote.revision);
            persistLocal({
                plan: remotePlan,
                facts: remote.facts,
                future: remote.futureConsiderations,
                messages: remote.messages,
                sessionId: remote.id,
                revision: remote.revision
            });
        }).catch(() => {
            if (!cancelled)
                setError('That private plan link could not be opened.');
        });
        return () => { cancelled = true; };
    }, []);

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
    useEffect(() => {
        if (!restarting)
            return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape')
                setRestarting(false);
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [restarting]);

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
            if (labMode())
                setReviewing(true);
            else
                setSheetOpen(true);
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

    function restart() {
        epoch.current += 1;
        generation.current += 1;
        if (timer.current)
            clearTimeout(timer.current);
        try {
            localStorage.removeItem(key);
            localStorage.removeItem('upstate.practice-plan.v1');
        }
        catch { /* private browsing */ }
        clearConversation();
        const fresh = initial();
        loaded.current = { plan: fresh, warning: '' };
        saved.current = null;
        sessionIdRef.current = '';
        remoteRevRef.current = 0;
        setP(fresh);
        setFacts(emptyFacts());
        setFuture([]);
        setMessages([{ id: 'greet', role: 'assistant', content: GREETING, questionId: null }]);
        setSessionId('');
        setRemoteRevision(0);
        setInput('');
        setBusy(false);
        setTyping(false);
        setPicked(null);
        setLeaving(false);
        setSuppressPrompt(false);
        setHeldQuestion(null);
        setFreshId(null);
        setError('');
        setWarning('');
        setReviewing(false);
        setRestarting(false);
        setCorrecting(null);
        setHighlightId(null);
        setNotice('');
        setPdfBusy(false);
        setPaused(false);
        setAssistantRequest('');
        setHumanRequest(false);
        setTestPreset('normal');
        setCustomDate('');
        setCustomTime('09:00');
        setCallerReason('');
        setCallerLanguage('');
        setScenario('normal');
        setTrace(null);
        setShown(0);
        skipAutoScroll.current = true;
        pendingScroll.current = null;
        requestAnimationFrame(() => {
            autoSize(inputRef.current);
            log.current?.scrollTo({ top: 0 });
            inputRef.current?.focus();
        });
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
            const code = (err as Error).message;
            if (code === 'conflict')
                setError('This plan was updated elsewhere. Reload the private link, or keep this device copy.');
            else
                setError('Could not sync this draft to the server. Your answers are still saved here. ' + PRIVACY_COPY);
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
        if (turned.intent === 'generate_draft' && labMode())
            setReviewing(true);
        if (interpreter.explanation_topic && help[interpreter.explanation_topic])
            setNotice(help[interpreter.explanation_topic]);
        return { plan: turned.plan, facts: turned.facts, future: turned.future };
    }

    async function send(text: string) {
        const trimmed = text.trim();
        if (!trimmed || interacting)
            return;
        const token = epoch.current;
        const targetQuestion = correctingQuestion || question;
        const scrubbed = scrubPii(trimmed);
        const outbound = scrubbed.text || trimmed;
        const userMsg: ChatMessage = { id: newId(), role: 'user', content: outbound, questionId: targetQuestion?.id || null };
        setHeldQuestion(targetQuestion);
        skipAutoScroll.current = false;
        setInput('');
        setError('');
        setFreshId(userMsg.id);
        setMessages(m => [...m, userMsg]);
        requestAnimationFrame(() => autoSize(inputRef.current));
        setLeaving(true);
        setBusy(true);
        await wait(80);
        if (epoch.current !== token)
            return;
        setSuppressPrompt(true);
        setLeaving(false);
        setTyping(true);
        try {
            const remote = await ensureSession(p);
            if (epoch.current !== token)
                return;
            const result = await interpretRemote({
                sessionId: remote.id,
                clientMessageId: newId(),
                text: outbound,
                currentQuestionId: targetQuestion?.id || null,
                currentQuestion: targetQuestion,
                confirmedState: confirmedState(facts),
                facts,
                history: [...messages, userMsg].filter(m => !isHearDump(m)),
                timezone: p.hours.timezone
            });
            if (epoch.current !== token)
                return;
            if (typeof result.revision === 'number')
                remoteRevRef.current = result.revision;
            if (scrubbed.removed)
                result.interpreter = { ...result.interpreter, acknowledgement: [scrubAckNotice(scrubbed.kinds), result.interpreter.acknowledgement].filter(Boolean).join(' ') };
            const applied = applyInterpreter(p, facts, result.interpreter, outbound, { question: targetQuestion, correcting: !!correcting });
            await syncPlan(applied.plan, applied.facts, applied.future, remote.id, remoteRevRef.current);
        }
        catch (err) {
            if (epoch.current !== token)
                return;
            let applied: ReturnType<typeof applyInterpreter> | null = null;
            if (trimmed === EXAMPLE)
                applied = applyInterpreter(p, facts, EXAMPLE_INTERPRETER, outbound, { question: targetQuestion, correcting: !!correcting });
            else {
                const hinted = updatesFromOwnerText(outbound, targetQuestion, facts);
                if (hinted.length)
                    applied = applyInterpreter(p, facts, {
                        acknowledgement: scrubbed.removed ? scrubAckNotice(scrubbed.kinds) : '',
                        intent: correcting ? 'correct_information' : 'provide_information',
                        updates: hinted,
                        unmapped_facts: [],
                        explanation_topic: null
                    }, outbound, { question: targetQuestion, correcting: !!correcting });
            }
            if (applied) {
                try {
                    const remote = sessionIdRef.current
                        ? { id: sessionIdRef.current, revision: remoteRevRef.current }
                        : await ensureSession(applied.plan);
                    if (epoch.current !== token)
                        return;
                    await syncPlan(applied.plan, applied.facts, applied.future, remote.id, remoteRevRef.current);
                }
                catch { /* local plan still saved */ }
                return;
            }
            const code = (err as Error).name === 'TimeoutError' || (err as Error).name === 'AbortError' ? 'groq' : (err as Error).message;
            const assistant: ChatMessage = { id: newId(), role: 'assistant', content: code === 'rate' ? 'Too many messages. Please wait a few minutes.' : 'The planning assistant is temporarily unavailable. Your plan is unchanged. You can still choose an option below.', questionId: targetQuestion?.id || null };
            setFreshId(assistant.id);
            setMessages(m => [...m, assistant]);
            setError(code === 'rate' ? 'Too many messages. Please wait a few minutes.' : 'The planning assistant is temporarily unavailable. You can still choose an option below or download a draft.');
        }
        finally {
            if (epoch.current !== token)
                return;
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
        const token = epoch.current;
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
        if (epoch.current !== token)
            return;
        setLeaving(true);
        await wait(280);
        if (epoch.current !== token)
            return;
        setFreshId(userMsg.id);
        setMessages(m => [...m, userMsg]);
        setPicked(null);
        setSuppressPrompt(true);
        setLeaving(false);
        setTyping(true);
        await wait(520);
        if (epoch.current !== token)
            return;
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
            if (epoch.current !== token)
                return;
            const recorded = await recordRemoteTurn(remote.id, newId(), chip.label, merged.ack, question?.id || null);
            if (epoch.current !== token)
                return;
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
            setNotice((kind === 'engineer' ? 'Implementation spec' : 'Owner blueprint') + ' downloaded. ' + PRIVACY_COPY);
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
        <header className={'header' + (restarting ? ' header-restarting' : '')}>
            <div className="header-brand">
                <a className="brand" href="/tools.html" aria-label="Back to Free Tools"><img src="/assets/upstate-logo.svg" alt="Upstate IP Voice"/></a>
                <button type="button" className="product-name" onClick={() => { setReviewing(false); setCorrecting(null); setRestarting(false); }}>Practice planner</button>
            </div>
            <nav aria-label="Planner chapters">
                <ol className="chapters">{chapters.map((c, i) => <li key={c} className={i <= reached ? 'reached' : ''}>
                    <button aria-current={i === currentChapter ? 'step' : undefined} onClick={() => goChapter(i)}><i />{c}</button>
                </li>)}</ol>
            </nav>
            <div className="header-actions">
                {restarting
                    ? <>
                        <p className="restart-copy" id="restart-copy">Start a new plan?</p>
                        <button type="button" autoFocus onClick={() => setRestarting(false)}>Keep this</button>
                        <button type="button" className="restart-confirm" aria-describedby="restart-copy" onClick={restart}>Start over</button>
                    </>
                    : <>
                        <button type="button" className="header-restart" onClick={() => { setRestarting(true); setCorrecting(null); }}>Start over</button>
                        <a className="free-label" href="/tools.html">Free planning tool</a>
                    </>}
            </div>
        </header>
        <main className="layout">
            <section className={'conversation architect-chat' + (welcome ? ' welcome' : '')} aria-label="Practice architect">
                {reviewing && labMode() ? <div className="form-scroll architect-review">
                    <button type="button" className="review-back" onClick={() => setReviewing(false)}>Back to conversation</button>
                    <Review p={p} pdfBusy={pdfBusy} notice={notice} onNotice={setNotice} onPdf={k => pdf(k)} onJump={id => goChapter(chapterIndex(id))} run={run} trace={trace} shown={shown} paused={paused} setPaused={setPaused} scenario={scenario} setScenario={setScenario} testPreset={testPreset} setTestPreset={setTestPreset} customDate={customDate} setCustomDate={setCustomDate} customTime={customTime} setCustomTime={setCustomTime} callerReason={callerReason} setCallerReason={setCallerReason} callerLanguage={callerLanguage} setCallerLanguage={setCallerLanguage} assistantRequest={assistantRequest} setAssistantRequest={setAssistantRequest} humanRequest={humanRequest} setHumanRequest={setHumanRequest}/>
                </div> : <>
                    <div className="form-scroll architect-log" ref={log}>
                        <div className="eyebrow"><span>Practice architect</span><span className="saved-pill">{sessionId ? 'Saved' : 'Not saved yet'}</span></div>
                        {welcome && <h1>Design your practice, naturally.</h1>}
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
                        {conflictRemote && <Note tone="warning">This device has {identity(p).planId} · r{identity(p).revision} · {identity(p).checksum}. The private link has {conflictRemote.planId} · r{conflictRemote.revision} · {conflictRemote.checksum}. Pick one — they were not merged.
                            <button type="button" className="text-button" onClick={() => { setConflictRemote(null); }}>Keep this device</button>
                        </Note>}
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
                            <h2 className="chat-question-text">That's everything I need to draw both files.</h2>
                            <p className="chat-question-detail">{PRIVACY_COPY} The implementation spec stays a planning document until an installer verifies it.{stillOpen(p).length ? ' Still open at install: ' + stillOpen(p).join('; ') + '.' : ''}</p>
                            {showHear && <HearPanel rows={hear}/>}
                            <div className="chat-choices">
                                <div className="chat-chips stack">
                                    <button type="button" className="chat-chip" disabled={pdfBusy || !blueprintReady(p)} onClick={() => pdf('owner')}>Download owner blueprint</button>
                                    <button type="button" className="chat-chip quiet" onClick={() => {
                                        const book = 'https://upstateipvoice.com/review/?plan=' + encodeURIComponent(p.planId) + (sessionId ? '&s=' + encodeURIComponent(sessionId) : '');
                                        window.open(book, '_blank', 'noopener');
                                    }}>Book a time with Upstate</button>
                                    {labMode() && <button type="button" className="chat-chip quiet" onClick={() => setReviewing(true)}>Open call simulator</button>}
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
            <div className={'scene-panel blueprint-column' + (sheetOpen ? ' sheet-open' : '')}>
                <p className="scene-illustration-caption">Illustration — rooms are not phones</p>
                <div className="blueprint-scene">
                    <Scene p={p} simulation={simulation} mode={view.mode} chapter={view.chapter} badge={view.badge} indexLabel={view.indexLabel} sceneClass={view.sceneClass} showTeamLegend={p.teams.some(t => t.status === 'known')} showSpecialtyCaption={!!p.specialty && view.chapter === 1}/>
                </div>
                {sheetOpen && <BlueprintRail
                    p={p}
                    sessionId={sessionId}
                    locked={locked || isLocked(p)}
                    hear={hear}
                    pdfBusy={pdfBusy}
                    onPdf={kind => pdf(kind)}
                    onBook={() => {
                        const book = 'https://upstateipvoice.com/review/?plan=' + encodeURIComponent(p.planId) + (sessionId ? '&s=' + encodeURIComponent(sessionId) : '');
                        window.open(book, '_blank', 'noopener');
                    }}
                    onCopy={() => {
                        const url = location.origin + '/planner/?s=' + encodeURIComponent(sessionId);
                        navigator.clipboard?.writeText(url);
                        setNotice('Private plan link copied.');
                    }}
                    onLock={async () => {
                        try {
                            const id = identity(p);
                            const lockedRemote = await lockRemoteSession(sessionId, remoteRevRef.current, id.checksum);
                            const next = {
                                ...p,
                                lock: {
                                    revision: lockedRemote.lockedRevision,
                                    checksum: lockedRemote.lockedChecksum,
                                    at: new Date().toISOString()
                                }
                            };
                            writePlan(next);
                            setLocked(true);
                            setNotice('Locked ' + id.planId + ' · r' + id.revision + ' · ' + id.checksum);
                        }
                        catch {
                            setError('Could not lock this revision. The checksum did not match the server copy.');
                        }
                    }}
                />}
                <button type="button" className="blueprint-sheet-toggle" aria-expanded={sheetOpen} onClick={() => setSheetOpen(v => !v)}>{sheetOpen ? 'Hide blueprint' : 'Blueprint'}{!sheetOpen && stillOpen(p).length ? ' · ' + stillOpen(p).length : ''}</button>
            </div>
        </main>
    </div>;
}
