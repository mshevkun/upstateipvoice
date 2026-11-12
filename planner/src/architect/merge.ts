import { commit, valid, type Plan } from '../config';
import { inventory } from '../policy';
import { fieldById, isBlockedField, normalizeEnum } from './fields';
import { roleState } from '../team-state';
import type { Fact, InterpreterIntent, InterpreterUpdate, MergeResult, Scalar } from './types';

function sameValue(a: Scalar, b: Scalar) {
    if (a == null && b == null)
        return true;
    return a === b || String(a) === String(b);
}

function statusFor(operation: InterpreterUpdate['operation'], needsConfirmation: boolean): Fact['status'] {
    if (needsConfirmation)
        return 'conflicting';
    if (operation === 'skip')
        return 'skipped';
    if (operation === 'uncertain')
        return 'proposed';
    if (operation === 'clear')
        return 'unset';
    return 'confirmed';
}

function touchConfirmed(p: Plan, facts: Record<string, Fact>): Plan {
    const add: string[] = [];
    const remove: string[] = [];
    if (p.mode)
        add.push('start');
    if (p.specialty)
        add.push('kind');
    if (p.name || p.policy.cityState || p.policy.opening.date)
        add.push('practice');
    const roles = ['reception', 'clinical', 'administration'] as const;
    if (roles.every(role => roleState(p, role).status !== 'unanswered'))
        add.push('team');
    const hoursFact = facts['hours.preset'];
    const hoursTouched = hoursFact?.status === 'confirmed' || facts['hours.weekdays_start']?.status === 'confirmed' || facts['hours.Monday.start']?.status === 'confirmed';
    if (hoursFact?.status === 'skipped' || p.policy.hoursPreset === 'undecided')
        remove.push('hours');
    else if (hoursTouched)
        add.push('hours');
    if (p.first.kind !== 'undecided')
        add.push('first');
    if (p.busy.kind !== 'undecided')
        add.push('busy');
    if (p.after.kind !== 'undecided')
        add.push('after');
    if (facts['urgent.kind']?.status === 'skipped')
        remove.push('urgent');
    else if (p.policy.urgentKind !== 'undecided')
        add.push('urgent');
    if (p.policy.languageDecision !== 'undecided')
        add.push('languages');
    if (facts['followup']?.status === 'confirmed')
        add.push('followup');
    if (p.policy.placements.length)
        add.push('positions');
    let confirmed = p.confirmed.filter(id => !remove.includes(id));
    for (const id of add)
        if (!confirmed.includes(id))
            confirmed = [...confirmed, id];
    return confirmed === p.confirmed ? p : { ...p, confirmed };
}

function futureFromUnmapped(items: string[]) {
    return items.filter(text => /ai|virtual receptionist|later|when we grow|in the future/i.test(text));
}

export function emptyFacts(): Record<string, Fact> {
    return {};
}

export function applyUpdates(
    plan: Plan,
    facts: Record<string, Fact>,
    updates: InterpreterUpdate[],
    intent: InterpreterIntent,
    unmapped: string[] = [],
    flags: { correcting?: boolean } = {}
): MergeResult {
    const nextFacts = { ...facts };
    const accepted: InterpreterUpdate[] = [];
    const rejected: MergeResult['rejected'] = [];
    const confirmationNeeded: InterpreterUpdate[] = [];
    let working = plan;
    let changed = false;
    const correcting = intent === 'correct_information' || !!flags.correcting;
    const futureConsiderations = futureFromUnmapped(unmapped);

    for (const incoming of updates) {
        let update = incoming;
        if (isBlockedField(update.field_id) || update.field_id.startsWith('e911') || /sip|extension|dialplan|verified/i.test(update.field_id)) {
            rejected.push({ update, reason: 'Field is not writable by the interpreter.' });
            continue;
        }
        const field = fieldById(update.field_id);
        if (update.field_id.startsWith('future.') || field?.id === 'future.ai_receptionist') {
            nextFacts[update.field_id] = {
                field_id: update.field_id,
                value: update.value,
                status: 'proposed',
                evidence: update.evidence
            };
            if (update.value != null)
                futureConsiderations.push(String(update.value));
            accepted.push(update);
            continue;
        }
        if (!field) {
            rejected.push({ update, reason: 'Unknown field_id.' });
            continue;
        }
        if (update.operation === 'set' && update.value == null) {
            rejected.push({ update, reason: 'set requires a value.' });
            continue;
        }
        if (field.type === 'enum' && update.operation === 'set' && update.value != null) {
            const normalized = normalizeEnum(update.field_id, update.value);
            update = { ...update, value: normalized };
            const allowed = field.enum || [];
            if (!allowed.some(v => v === normalized || v.toLowerCase() === normalized.toLowerCase())) {
                rejected.push({ update, reason: 'Value is not in the allowed list.' });
                continue;
            }
        }
        if (field.type === 'number' && update.operation === 'set') {
            const n = typeof update.value === 'number' ? update.value : Number(update.value);
            if (!Number.isFinite(n) || (field.min != null && n < field.min) || (field.max != null && n > field.max)) {
                rejected.push({ update, reason: 'Number is out of range.' });
                continue;
            }
        }
        const prior = nextFacts[update.field_id];
        const currentValue = field.read(working);
        const conflict = prior?.status === 'confirmed' && update.operation === 'set' && !sameValue(prior.value, update.value) && !correcting;
        if (conflict || (update.needs_confirmation && prior?.status === 'confirmed')) {
            confirmationNeeded.push(update);
            nextFacts[update.field_id] = {
                field_id: update.field_id,
                value: update.value,
                status: 'conflicting',
                evidence: update.evidence
            };
            continue;
        }
        if (update.operation === 'uncertain') {
            nextFacts[update.field_id] = {
                field_id: update.field_id,
                value: update.value,
                status: 'proposed',
                evidence: update.evidence
            };
            accepted.push(update);
            continue;
        }
        const applied = field.apply(working, update.operation, update.value);
        const candidate = { ...applied, endpoints: inventory(applied) };
        if (!valid(candidate)) {
            rejected.push({ update, reason: 'Update would make the plan invalid.' });
            continue;
        }
        working = candidate;
        changed = true;
        nextFacts[update.field_id] = {
            field_id: update.field_id,
            value: update.operation === 'set' ? (field.read(working) ?? update.value) : null,
            status: statusFor(update.operation, false),
            evidence: update.evidence
        };
        accepted.push(update);
        if (update.field_id === 'future.ai_receptionist' && update.value != null)
            futureConsiderations.push(String(update.value));
    }

    if (intent === 'skip_current') {
        /* skip is represented on the current field via updates; nothing extra */
    }

    if (changed) {
        working = touchConfirmed(working, nextFacts);
        const candidate = { ...working, endpoints: inventory(working) };
        if (valid(candidate)) {
            try {
                working = commit(plan, candidate);
            }
            catch {
                changed = false;
                working = plan;
            }
        }
        else {
            changed = false;
            working = plan;
        }
    }

    return {
        plan: working,
        facts: nextFacts,
        accepted,
        rejected,
        confirmationNeeded,
        futureConsiderations: [...new Set(futureConsiderations)],
        changed
    };
}

export function applyChip(plan: Plan, facts: Record<string, Fact>, chip: { field_id: string; value: Scalar; operation: 'set' | 'skip' | 'uncertain' | 'clear'; label: string }): MergeResult {
    return applyUpdates(plan, facts, [{
        field_id: chip.field_id,
        operation: chip.operation,
        value: chip.operation === 'set' ? chip.value : null,
        evidence: chip.label,
        needs_confirmation: false
    }], chip.operation === 'skip' ? 'skip_current' : 'provide_information');
}
