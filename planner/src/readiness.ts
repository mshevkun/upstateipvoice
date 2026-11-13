import { ownerQuestions } from './architect/questions';
import type { Plan } from './config';
import { unapprovedTerminals } from './status';

export type Readiness = {
    questionnaire: string[];
    owner: string[];
    provider: string[];
    tests: string[];
    blockers: string[];
    deployable: boolean;
    label: string;
};

export function stillOpen(p: Plan): string[] {
    const q = p.policy;
    const items: string[] = [];
    if (p.urgent.enabled && q.urgentKind === 'connect')
        items.push('on-call work identity (Follow Me)');
    if (!q.e911Confirmed)
        items.push('E911 address on install');
    if (q.opening.internet === 'survey' || q.opening.network === 'survey' || q.opening.internet === 'undecided' || q.continuity.internet === 'survey' || q.continuity.power === 'undecided' || q.continuity.power === 'survey')
        items.push('internet & power site survey');
    return items;
}

/** Inferred from other answers — never asked again as a chat question. */
export function derived(p: Plan): string[] {
    const items: string[] = [];
    if (p.first.kind === 'human' && p.first.team)
        items.push('Assign an outside-call answering position to the first-answer team');
    if (p.policy.placements.some(x => x.team === 'clinical' && x.count > 0) || p.policy.roomsSpecified)
        items.push('Choose devices for Clinical team');
    if (p.busy.owner || p.after.owner)
        items.push('Message notification follows the inbox owner');
    return items;
}

export function ownerQuestionCount(p: Plan) {
    return ownerQuestions(p).length;
}

export function readiness(p: Plan): Readiness {
    const questionnaire = ownerQuestions(p).map(q => q.text);
    const q = p.policy;
    const owner: string[] = [];
    const provider: string[] = [];
    const tests: string[] = [];
    if (questionnaire.length)
        owner.push('Finish the remaining planner decisions (' + questionnaire.length + ')');
    for (const t of unapprovedTerminals(p))
        owner.push('Approve the message owner for ' + t.label);
    if (p.mode === 'opening' && q.beforeOpening === 'undecided')
        owner.push('Approve what happens if a patient calls before opening day');
    if (p.mode === 'opening' && !q.opening.date)
        owner.push('Set a target opening date');
    if (p.mode === 'opening' && q.opening.numbers === 'undecided')
        owner.push('Choose new numbers or porting');
    if (p.urgent.enabled && q.urgentKind === 'connect') {
        if (!p.urgent.approved || !p.urgent.instructions.trim())
            owner.push('Approve the emergency / urgent procedure wording');
        if (!hasFallback(p))
            owner.push('Confirm the on-call fallback destination');
        if (!q.acceptance)
            owner.push('Require transfer acceptance before reporting a connected handoff');
        if (!q.onCallRouteVerified)
            provider.push('Supply a verified on-call contact route (this planner does not collect private numbers)');
        if (!q.handoffTested)
            tests.push('Record a successful on-call handoff test on the installed system');
    }
    if (p.mode === 'opening') {
        if (q.opening.internet === 'undecided' || q.opening.network === 'undecided')
            provider.push('Record internet and network readiness, or mark a site survey');
        if (!q.e911Confirmed)
            tests.push('Confirm emergency-calling address verification (E911) with the installer');
    }
    if (mayHandlePhi(p) && !q.baaAcknowledged)
        tests.push('Acknowledge that vendors handling patient information may need a BAA');
    const blockers = [...owner, ...provider, ...tests];
    const deployable = false;
    const label = questionnaire.length
        ? 'Draft · ' + questionnaire.length + ' owner decisions still open'
        : owner.length
            ? 'Plan recorded · not deployable until ' + owner[0]
            : provider.length
                ? 'Plan recorded · provider still needs to confirm: ' + provider[0]
                : tests.length
                    ? 'Design recorded · not operational until live tests pass'
                    : 'Design recorded · not an installed system';
    return { questionnaire, owner, provider, tests, blockers, deployable, label };
}

function hasFallback(p: Plan) {
    const q = p.policy;
    if (q.urgentBackup === 'team')
        return p.teams.some(t => t.id === p.urgent.backup && t.count > 0);
    if (q.urgentBackup === 'instructions')
        return p.urgent.approved && !!p.urgent.instructions.trim();
    return p.teams.some(t => t.id === p.urgent.owner && t.count > 0);
}

export function mayHandlePhi(p: Plan) {
    return p.after.kind === 'service' || p.after.kind === 'assistant' || p.first.kind === 'assistant' || p.busy.kind === 'assistant' || p.policy.followup === 'yes';
}

export function handoffBlock(p: Plan) {
    const q = p.policy;
    const ready = readiness(p);
    return [
        'Practice: ' + (p.name || 'Unnamed'),
        'Plan ID: ' + p.planId,
        'Revision: ' + p.revision,
        'Owner decisions: ' + (ready.owner.length ? ready.owner.length + ' open' : 'none listed'),
        'Provider requirements: ' + (ready.provider.length ? ready.provider.length + ' open' : 'none listed'),
        'Tests before opening: ' + (ready.tests.length ? ready.tests.length + ' open' : 'none listed'),
        'Specialty: ' + (p.specialty || 'Undecided'),
        'Starting point: ' + (p.mode || 'Undecided'),
        p.mode === 'opening' ? 'Opening date: ' + (q.opening.date || 'Not set') : '',
        'Recommended package: ' + (q.bomTier === 'undecided' ? 'Not chosen' : q.bomTier),
        'Questionnaire: ' + (ready.questionnaire.length ? ready.questionnaire.length + ' open' : 'complete'),
        'Deployable: no — this planner never certifies an installed system',
        'Unresolved safety: ' + (ready.blockers.join('; ') || 'None listed')
    ].filter(Boolean).join('\n');
}
