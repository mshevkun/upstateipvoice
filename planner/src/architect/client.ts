import type { Plan } from '../config';
import { INTERPRETER_SYSTEM_PROMPT } from './prompt';
import { interpreterResponseSchema } from './schema';
import type { ConversationRecord, Fact, InterpreterResponse, NextQuestion } from './types';

export const conversationKey = 'upstate.practice-architect.v1';
const SESSION_KEY = 'upstate.practice-architect.session';

export function plannerApiBase() {
    const explicit = (import.meta as ImportMeta & { env?: { VITE_PLANNER_API?: string } }).env?.VITE_PLANNER_API;
    if (explicit)
        return explicit.replace(/\/$/, '');
    if (typeof location !== 'undefined' && /upstateipvoice\.com$/i.test(location.hostname))
        return 'https://app.upstateipvoice.com';
    return '';
}

export function readConversation(): ConversationRecord | null {
    try {
        const raw = localStorage.getItem(conversationKey);
        if (!raw)
            return null;
        const value = JSON.parse(raw) as ConversationRecord;
        if (!value || typeof value !== 'object')
            return null;
        return {
            sessionId: typeof value.sessionId === 'string' ? value.sessionId : '',
            revision: Number(value.revision) || 0,
            facts: value.facts && typeof value.facts === 'object' ? value.facts : {},
            currentQuestionId: value.currentQuestionId || null,
            futureConsiderations: Array.isArray(value.futureConsiderations) ? value.futureConsiderations : [],
            messages: Array.isArray(value.messages) ? value.messages : []
        };
    }
    catch {
        return null;
    }
}

export function saveConversation(record: ConversationRecord) {
    try {
        localStorage.setItem(conversationKey, JSON.stringify(record));
        if (record.sessionId)
            sessionStorage.setItem(SESSION_KEY, record.sessionId);
    }
    catch { /* private browsing */ }
}

export function clearConversation() {
    try {
        localStorage.removeItem(conversationKey);
    }
    catch { /* private browsing */ }
    try {
        sessionStorage.removeItem(SESSION_KEY);
    }
    catch { /* private browsing */ }
}

export type InterpretRequest = {
    sessionId: string;
    clientMessageId: string;
    text: string;
    currentQuestionId: string | null;
    currentQuestion?: NextQuestion | null;
    confirmedState: Record<string, unknown>;
    facts: Record<string, Fact>;
    history: ConversationRecord['messages'];
    timezone?: string;
};

export type InterpretSuccess = {
    interpreter: InterpreterResponse;
    sessionId: string;
    revision: number;
};

export async function createRemoteSession(plan: Plan) {
    const res = await fetch(plannerApiBase() + '/api/public/planner/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: plan.planId, revision: plan.revision, plan })
    });
    if (!res.ok)
        throw new Error(res.status === 429 ? 'rate' : 'create');
    return await res.json() as { id: string; revision: number };
}

export async function interpretRemote(req: InterpretRequest): Promise<InterpretSuccess> {
    const res = await fetch(plannerApiBase() + '/api/public/planner/sessions/' + encodeURIComponent(req.sessionId) + '/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            clientMessageId: req.clientMessageId,
            text: req.text,
            currentQuestionId: req.currentQuestionId,
            currentQuestion: req.currentQuestion ? { id: req.currentQuestion.id, text: req.currentQuestion.text } : null,
            confirmedState: req.confirmedState,
            facts: req.facts,
            history: req.history.slice(-6),
            promptName: 'practice_interpreter_v1',
            timezone: req.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
            today: new Date().toISOString().slice(0, 10)
        }),
        // 8s: local brain is the publishable fallback — do not leave owners on a spinner.
        signal: AbortSignal.timeout(8000)
    });
    if (res.status === 429)
        throw new Error('rate');
    if (res.status === 502 || res.status === 503)
        throw new Error('groq');
    if (!res.ok)
        throw new Error('interpret');
    const body = await res.json() as { interpreter: InterpreterResponse; revision: number; id?: string };
    if (!body.interpreter || !Array.isArray(body.interpreter.updates))
        throw new Error('shape');
    return { interpreter: body.interpreter, sessionId: req.sessionId, revision: body.revision };
}

export async function persistRemotePlan(sessionId: string, plan: Plan, expectedRevision: number, facts: Record<string, Fact>, futureConsiderations: string[]) {
    const res = await fetch(plannerApiBase() + '/api/public/planner/sessions/' + encodeURIComponent(sessionId) + '/plan', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision: expectedRevision, plan, facts, futureConsiderations })
    });
    if (res.status === 409)
        throw new Error('conflict');
    if (!res.ok)
        throw new Error('persist');
    return await res.json() as { revision: number };
}

export async function readRemoteSession(sessionId: string) {
    const res = await fetch(plannerApiBase() + '/api/public/planner/sessions/' + encodeURIComponent(sessionId), { headers: { Accept: 'application/json' } });
    if (res.status === 404)
        throw new Error('not_found');
    if (!res.ok)
        throw new Error('session');
    return await res.json() as {
        id: string;
        planId?: string;
        revision: number;
        plan?: Plan;
        facts?: Record<string, Fact>;
        messages?: ConversationRecord['messages'];
        futureConsiderations?: string[];
        lockedRevision?: number | null;
        lockedChecksum?: string | null;
        lockedAt?: string | null;
    };
}

export async function lockRemoteSession(sessionId: string, revision: number, checksum: string) {
    const res = await fetch(plannerApiBase() + '/api/public/planner/sessions/' + encodeURIComponent(sessionId) + '/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revision, checksum })
    });
    if (res.status === 409)
        throw new Error('conflict');
    if (!res.ok)
        throw new Error('lock');
    return await res.json() as { lockedRevision: number; lockedChecksum: string };
}

export async function recordRemoteTurn(sessionId: string, clientMessageId: string, userText: string, assistantText: string, questionId: string | null) {
    try {
        const res = await fetch(plannerApiBase() + '/api/public/planner/sessions/' + encodeURIComponent(sessionId) + '/messages', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                clientMessageId,
                text: userText,
                mode: 'record',
                acknowledgement: assistantText,
                currentQuestionId: questionId
            })
        });
        if (!res.ok)
            return null;
        const body = await res.json().catch(() => null) as { revision?: number } | null;
        return typeof body?.revision === 'number' ? body.revision : null;
    }
    catch {
        return null;
    }
}

export { INTERPRETER_SYSTEM_PROMPT, interpreterResponseSchema };
