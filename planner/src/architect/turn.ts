import type { Plan } from '../config';
import { composeAcknowledgement } from './ack';
import { detectIntent, isCorrection, mergeInterpreterUpdates, updatesFromOwnerText } from './extract';
import { applyUpdates } from './merge';
import { nextQuestion } from './questions';
import { scrubAckNotice, scrubPii } from './scrub';
import type { Chip, Fact, InterpreterIntent, InterpreterResponse, NextQuestion } from './types';

export function interpretTurn(opts: {
    plan: Plan;
    facts: Record<string, Fact>;
    interpreter: InterpreterResponse;
    userText: string;
    question: NextQuestion | null;
    future?: string[];
    correcting?: boolean;
}) {
    const cleaned = scrubPii(opts.userText);
    const userText = cleaned.text || opts.userText;
    const hinted = updatesFromOwnerText(userText, opts.question, opts.facts);
    const intent: InterpreterIntent = opts.correcting ? 'correct_information' : detectIntent(userText, opts.interpreter.intent);
    const groqUpdates = opts.interpreter.updates.filter(u => u.operation !== 'set' || u.value != null);
    const updates = mergeInterpreterUpdates(groqUpdates, hinted, userText, opts.facts);
    const unmapped = [...(opts.interpreter.unmapped_facts || [])].map(s => scrubPii(s).text).filter(Boolean);
    const folded = userText.toLowerCase();
    if (/appointment/.test(folded))
        unmapped.push('appointment calls');
    if (/prescription/.test(folded))
        unmapped.push('prescription questions');
    if (/\bfax\b/.test(folded))
        unmapped.push('fax');
    if (/\balarm\b/.test(folded))
        unmapped.push('alarm');
    if (/thanksgiving/.test(folded))
        unmapped.push('Thanksgiving');
    if (/christmas/.test(folded))
        unmapped.push('Christmas');
    if (/snowstorm|snow/.test(folded))
        unmapped.push('snow');
    const merged = applyUpdates(opts.plan, opts.facts, updates, intent, unmapped, { correcting: isCorrection(opts.userText) || !!opts.correcting });
    const nextPlan = merged.changed ? merged.plan : opts.plan;
    const follow = nextQuestion(nextPlan, merged.facts);
    let ack = composeAcknowledgement({
        groqAck: opts.interpreter.acknowledgement,
        accepted: merged.accepted,
        plan: nextPlan,
        facts: merged.facts,
        next: follow,
        unmapped,
        userText
    });
    if (cleaned.removed) {
        const notice = scrubAckNotice(cleaned.kinds);
        if (notice && !ack.includes(notice))
            ack = notice + ' ' + ack;
    }
    const future = [...new Set([...(opts.future || []), ...merged.futureConsiderations])];
    return { ...merged, plan: nextPlan, follow, ack, intent, future, unmapped };
}

export function chipTurn(opts: {
    plan: Plan;
    facts: Record<string, Fact>;
    chip: Chip;
    future?: string[];
    correcting?: boolean;
}) {
    const merged = applyUpdates(opts.plan, opts.facts, [{
        field_id: opts.chip.field_id,
        operation: opts.chip.operation,
        value: opts.chip.operation === 'set' ? opts.chip.value : null,
        evidence: opts.chip.label,
        needs_confirmation: false
    }], opts.correcting ? 'correct_information' : opts.chip.operation === 'skip' ? 'skip_current' : 'provide_information', [], { correcting: !!opts.correcting });
    const nextPlan = merged.changed ? merged.plan : opts.plan;
    const follow = nextQuestion(nextPlan, merged.facts);
    const ack = composeAcknowledgement({
        accepted: merged.accepted,
        plan: nextPlan,
        facts: merged.facts,
        next: follow,
        chip: opts.chip
    });
    return { ...merged, plan: nextPlan, follow, ack, future: opts.future || [] };
}
