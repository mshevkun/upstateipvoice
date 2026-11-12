import type { Plan } from '../config';
import { hoursSummary } from '../flow';
import { roleState } from '../team-state';
import type { Chip, Fact, NextQuestion } from './types';

function skipped(facts: Record<string, Fact>, id: string) {
    return facts[id]?.status === 'skipped';
}

function confirmed(facts: Record<string, Fact>, id: string) {
    return facts[id]?.status === 'confirmed';
}

function settled(facts: Record<string, Fact>, id: string) {
    return ['skipped', 'confirmed', 'proposed'].includes(facts[id]?.status || '');
}

function chip(id: string, label: string, field_id: string, value: string | number | boolean | null, operation: Chip['operation'] = 'set'): Chip {
    return { id, label, field_id, value, operation };
}

const skipChip = (field_id: string): Chip => chip('skip', 'Skip for now', field_id, null, 'skip');
const unsureChip = (field_id: string): Chip => chip('unsure', "I'm not sure yet", field_id, null, 'uncertain');
const helpChip = (field_id: string): Chip => chip('help', 'Help me decide', field_id, null, 'uncertain');

function questionCatalog(p: Plan, facts: Record<string, Fact>): NextQuestion[] {
    return [
        {
            id: 'urgent.scope',
            text: 'Just to make sure I set that up correctly: is that only for urgent medical questions, or for every incoming call?',
            detail: 'Those produce different phone systems. I will not guess.',
            priority: 5,
            skipAllowed: true,
            affectedFields: ['urgent.scope'],
            options: [
                chip('urgent_only', 'Only urgent calls', 'urgent.scope', 'urgent_only'),
                chip('all_calls', 'Every call', 'urgent.scope', 'all_calls'),
                chip('explain', 'Let me explain', 'urgent.scope', null, 'uncertain'),
                skipChip('urgent.scope')
            ]
        },
        {
            id: 'mode',
            text: 'What are you setting up?',
            detail: 'This shapes later questions. You can change it.',
            priority: 10,
            skipAllowed: true,
            affectedFields: ['mode'],
            options: [
                chip('opening', 'Opening a new practice', 'mode', 'opening'),
                chip('improving', 'Improving an existing setup', 'mode', 'improving'),
                chip('adding', 'Adding a location', 'mode', 'adding'),
                unsureChip('mode'),
                skipChip('mode')
            ]
        },
        {
            id: 'specialty',
            text: 'What kind of practice is this?',
            detail: 'Dental and eye-care rooms look different. Other specialties stay a consultation space.',
            priority: 20,
            skipAllowed: true,
            affectedFields: ['specialty'],
            options: [
                chip('dental', 'Dental', 'specialty', 'Dental'),
                chip('eye', 'Eye care', 'specialty', 'Eye care'),
                chip('other', 'Other healthcare practice', 'specialty', 'Other healthcare practice'),
                skipChip('specialty')
            ]
        },
        {
            id: 'teams.reception.count',
            text: 'How many people usually work at the front desk?',
            detail: 'Approximate counts are fine. This is not a phone order.',
            priority: 30,
            skipAllowed: true,
            affectedFields: ['teams.reception.count'],
            options: [
                chip('0', 'None', 'teams.reception.count', 0),
                chip('1', '1', 'teams.reception.count', 1),
                chip('2', '2', 'teams.reception.count', 2),
                chip('3', '3', 'teams.reception.count', 3),
                chip('4', '4 or more', 'teams.reception.count', 4),
                chip('defer', 'Not sure yet', 'teams.reception.count', null, 'skip')
            ]
        },
        {
            id: 'teams.clinical.count',
            text: 'How many clinicians and clinical assistants work here?',
            detail: 'Dentists, hygienists, and assistants count together.',
            priority: 32,
            skipAllowed: true,
            affectedFields: ['teams.clinical.count'],
            options: [
                chip('0', 'None', 'teams.clinical.count', 0),
                chip('1', '1', 'teams.clinical.count', 1),
                chip('2', '2', 'teams.clinical.count', 2),
                chip('3', '3', 'teams.clinical.count', 3),
                chip('5', '4 or more', 'teams.clinical.count', 5),
                chip('defer', 'Not sure yet', 'teams.clinical.count', null, 'skip')
            ]
        },
        {
            id: 'teams.administration.count',
            text: 'How many people handle office management, besides anyone already counted at the front desk?',
            detail: 'Billing done by reception is a responsibility, not extra administration seats.',
            priority: 34,
            skipAllowed: true,
            affectedFields: ['teams.administration.count'],
            options: [
                chip('0', 'None', 'teams.administration.count', 0),
                chip('1', '1', 'teams.administration.count', 1),
                chip('2', '2', 'teams.administration.count', 2),
                chip('defer', 'Not sure yet', 'teams.administration.count', null, 'skip')
            ]
        },
        {
            id: 'hours.preset',
            text: 'When can your team answer calls during a normal week?',
            detail: confirmed(facts, 'hours.preset') && hoursSummary(p) ? 'Currently noted as ' + hoursSummary(p) + '.' : 'Start with a normal week. You can change individual days later.',
            priority: 40,
            skipAllowed: true,
            affectedFields: ['hours.preset'],
            options: [
                chip('weekdays', 'Monday–Friday · 9 AM–5 PM', 'hours.preset', 'weekdays'),
                chip('always', '24-hour phone coverage', 'hours.preset', 'always'),
                chip('custom', 'Different hours by day', 'hours.preset', 'custom'),
                unsureChip('hours.preset'),
                skipChip('hours.preset')
            ]
        },
        {
            id: 'hours.lunch',
            text: 'What happens to the phones at lunch?',
            detail: 'Lunch is the most common missed-call window. A lunch close is not the same as after-hours voicemail.',
            priority: 42,
            skipAllowed: true,
            affectedFields: ['hours.lunch'],
            options: [
                chip('covered', 'Someone stays on the desk', 'hours.lunch', 'covered'),
                chip('closed', 'Phones close around noon–1', 'hours.lunch', 'closed'),
                helpChip('hours.lunch'),
                skipChip('hours.lunch')
            ]
        },
        {
            id: 'first.kind',
            text: 'Who should answer first when the office is open?',
            detail: 'Choose what patients experience during your answering hours.',
            priority: 50,
            skipAllowed: true,
            affectedFields: ['first.kind'],
            options: [
                chip('human', 'Your reception team', 'first.kind', 'human'),
                chip('menu', 'A short phone menu', 'first.kind', 'menu'),
                chip('assistant', 'An AI receptionist', 'first.kind', 'assistant'),
                helpChip('first.kind'),
                skipChip('first.kind')
            ]
        },
        {
            id: 'busy.kind',
            text: 'What should happen if nobody answers during open hours?',
            detail: 'Ringing already has a timeout. This is the next step for the caller.',
            priority: 60,
            skipAllowed: true,
            affectedFields: ['busy.kind'],
            options: [
                chip('message', 'Take a message', 'busy.kind', 'message'),
                chip('queue', 'Let them wait briefly', 'busy.kind', 'queue'),
                chip('backup', 'Try another team', 'busy.kind', 'backup'),
                chip('assistant', 'Use a virtual receptionist', 'busy.kind', 'assistant'),
                skipChip('busy.kind')
            ]
        },
        {
            id: 'after.kind',
            text: 'What should patients experience when they call after hours?',
            detail: 'You can also explain this in your own words. A later AI idea will not be configured for opening day.',
            priority: 70,
            skipAllowed: true,
            affectedFields: ['after.kind'],
            options: [
                chip('message', 'Take a message', 'after.kind', 'message'),
                chip('service', 'Live answering service', 'after.kind', 'service'),
                chip('assistant', 'AI receptionist', 'after.kind', 'assistant'),
                chip('information', 'Play information, then end', 'after.kind', 'information'),
                helpChip('after.kind'),
                skipChip('after.kind')
            ]
        },
        {
            id: 'messages.owner',
            text: 'Who checks those messages in the morning?',
            detail: 'Voicemail lives on someone’s mailbox. A miss that nobody opens is not a working path.',
            priority: 72,
            skipAllowed: true,
            affectedFields: ['messages.owner'],
            options: [
                chip('reception', 'Front desk', 'messages.owner', 'reception'),
                chip('clinical', 'I do', 'messages.owner', 'clinical'),
                chip('admin', 'Office manager', 'messages.owner', 'admin'),
                helpChip('messages.owner'),
                skipChip('messages.owner')
            ]
        },
        {
            id: 'devices.reception.sharing',
            text: 'When two people are at the front, can both pick up at once?',
            detail: 'That is a line question, not a phone-per-room order. One shared identity is one conversation at a time.',
            priority: 74,
            skipAllowed: true,
            affectedFields: ['devices.reception.sharing'],
            options: [
                chip('separate', 'Yes — they need two lines', 'devices.reception.sharing', 'separate'),
                chip('shared', 'No — they share one phone', 'devices.reception.sharing', 'shared'),
                helpChip('devices.reception.sharing'),
                skipChip('devices.reception.sharing')
            ]
        },
        {
            id: 'devices.work_mobile',
            text: 'If the front desk cannot pick up, should a work mobile ring?',
            detail: 'A work app is fine. We will not put a personal cell number in a recording or on a wall card.',
            priority: 76,
            skipAllowed: true,
            affectedFields: ['devices.work_mobile'],
            options: [
                chip('none', 'Just the office phones', 'devices.work_mobile', 'none'),
                chip('app', 'Yes, a work phone or app', 'devices.work_mobile', 'app'),
                helpChip('devices.work_mobile'),
                skipChip('devices.work_mobile')
            ]
        },
        {
            id: 'urgent.kind',
            text: 'Do urgent calls need a separate path?',
            detail: 'Live connect is a transfer attempt with a backup. Skipping this does not mean you have no on-call coverage.',
            priority: 80,
            skipAllowed: true,
            affectedFields: ['urgent.kind'],
            options: [
                chip('connect', 'Connect to on-call', 'urgent.kind', 'connect'),
                chip('priority', 'Take a priority message', 'urgent.kind', 'priority'),
                chip('instructions', 'Play approved instructions', 'urgent.kind', 'instructions'),
                chip('none', 'No separate urgent path', 'urgent.kind', 'none'),
                skipChip('urgent.kind')
            ]
        },
        {
            id: 'opening.date',
            text: 'When do you expect to open?',
            detail: 'An approximate month is enough.',
            priority: 90,
            skipAllowed: true,
            affectedFields: ['opening.date'],
            options: [
                skipChip('opening.date'),
                unsureChip('opening.date')
            ]
        },
        {
            id: 'beforeOpening',
            text: 'If someone finds the number before you open, what should they hear?',
            detail: 'Do not advertise the number until this exists. This is not the after-hours path.',
            priority: 92,
            skipAllowed: true,
            affectedFields: ['beforeOpening'],
            options: [
                chip('information', 'A short recording — not open yet', 'beforeOpening', 'information'),
                chip('message', 'Take a callback message', 'beforeOpening', 'message'),
                helpChip('beforeOpening'),
                skipChip('beforeOpening')
            ]
        },
        {
            id: 'policy.rooms',
            text: 'How many treatment rooms are you planning?',
            detail: 'Room count does not order phones.',
            priority: 100,
            skipAllowed: true,
            affectedFields: ['policy.rooms'],
            options: [
                chip('2', '2', 'policy.rooms', 2),
                chip('4', '4', 'policy.rooms', 4),
                chip('6', '6', 'policy.rooms', 6),
                chip('8', '8', 'policy.rooms', 8),
                skipChip('policy.rooms')
            ]
        },
        {
            id: 'languages.decision',
            text: 'Do callers need another language besides English?',
            detail: 'Only add coverage your practice can actually provide.',
            priority: 110,
            skipAllowed: true,
            affectedFields: ['languages.decision'],
            options: [
                chip('none', 'English is enough', 'languages.decision', 'none'),
                chip('spanish', 'Spanish', 'languages.spanish', true),
                skipChip('languages.decision')
            ]
        }
    ];
}

export function nextQuestion(p: Plan, facts: Record<string, Fact>): NextQuestion | null {
    for (const question of questionCatalog(p, facts)) {
        if (question.affectedFields.every(id => settled(facts, id)))
            continue;
        if (!ready(question.id, p, facts))
            continue;
        return question;
    }
    return null;
}

function ready(id: string, p: Plan, facts: Record<string, Fact>) {
    if (id === 'urgent.scope')
        return !!p.policy.pendingClinicianRoute && !confirmed(facts, 'urgent.scope') && !skipped(facts, 'urgent.scope');
    if (id === 'mode')
        return !p.mode && !skipped(facts, 'mode');
    if (id === 'specialty')
        return !!p.mode && !p.specialty && !skipped(facts, 'specialty');
    if (id === 'teams.reception.count')
        return roleState(p, 'reception').status === 'unanswered' && !skipped(facts, 'teams.reception.count');
    if (id === 'teams.clinical.count')
        return roleState(p, 'reception').status !== 'unanswered' && roleState(p, 'clinical').status === 'unanswered' && !skipped(facts, 'teams.clinical.count');
    if (id === 'teams.administration.count')
        return roleState(p, 'clinical').status !== 'unanswered' && roleState(p, 'administration').status === 'unanswered' && !skipped(facts, 'teams.administration.count') && !confirmed(facts, 'billing.performed_by');
    if (id === 'hours.preset')
        return !p.confirmed.includes('hours') && !skipped(facts, 'hours.preset') && !confirmed(facts, 'hours.preset');
    if (id === 'hours.lunch')
        return (confirmed(facts, 'hours.preset') || confirmed(facts, 'hours.weekdays_start') || p.confirmed.includes('hours')) && !settled(facts, 'hours.lunch') && !skipped(facts, 'hours.preset');
    if (id === 'first.kind')
        return p.first.kind === 'undecided' && !skipped(facts, 'first.kind') && !p.policy.pendingClinicianRoute;
    if (id === 'busy.kind')
        return p.first.kind !== 'undecided' && p.busy.kind === 'undecided' && !skipped(facts, 'busy.kind');
    if (id === 'after.kind')
        return p.after.kind === 'undecided' && !skipped(facts, 'after.kind');
    if (id === 'messages.owner') {
        const needBusy = p.busy.kind === 'message' && !p.busy.owner;
        const needAfter = p.after.kind === 'message' && !p.after.owner;
        return (needBusy || needAfter) && !skipped(facts, 'messages.owner');
    }
    if (id === 'devices.reception.sharing')
        return roleState(p, 'reception').count >= 2 && p.first.kind === 'human' && !settled(facts, 'devices.reception.sharing');
    if (id === 'devices.work_mobile')
        return p.first.kind !== 'undecided' && !settled(facts, 'devices.work_mobile');
    if (id === 'urgent.kind')
        return !p.policy.pendingClinicianRoute && p.policy.urgentKind === 'undecided' && !skipped(facts, 'urgent.kind') && !skipped(facts, 'urgent.scope') && !p.confirmed.includes('urgent');
    if (id === 'opening.date')
        return p.mode === 'opening' && !p.policy.opening.date && !skipped(facts, 'opening.date');
    if (id === 'beforeOpening')
        return p.mode === 'opening' && p.policy.beforeOpening === 'undecided' && !skipped(facts, 'beforeOpening');
    if (id === 'policy.rooms')
        return !p.policy.roomsSpecified && !skipped(facts, 'policy.rooms');
    if (id === 'languages.decision')
        return p.policy.languageDecision === 'undecided' && !skipped(facts, 'languages.decision');
    return false;
}

export function questionById(id: string, p: Plan, facts: Record<string, Fact>) {
    return questionCatalog(p, facts).find(question => question.id === id) || null;
}

export { composeAcknowledgement } from './ack';
export function acknowledgementFor(p: Plan, text: string, future: string[]) {
    void p;
    void future;
    return text;
}
