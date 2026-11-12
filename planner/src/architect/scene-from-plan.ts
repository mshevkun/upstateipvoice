import type { Plan } from '../config';
import { choices, type SceneMode } from '../state';
import { teamSummary } from '../team-state';

export const QUESTION_CHAPTER: Record<string, number> = {
    mode: 0,
    specialty: 0,
    'opening.date': 0,
    'policy.rooms': 0,
    'teams.reception.count': 1,
    'teams.clinical.count': 1,
    'teams.administration.count': 1,
    'hours.preset': 1,
    'hours.lunch': 1,
    'first.kind': 2,
    'busy.kind': 2,
    'messages.owner': 2,
    'after.kind': 3,
    'urgent.kind': 3,
    'urgent.scope': 3,
    'languages.decision': 3,
    'devices.reception.sharing': 4,
    'devices.work_mobile': 4,
    beforeOpening: 0
};

export function chapterForQuestion(id?: string | null) {
    if (!id)
        return null;
    return Object.prototype.hasOwnProperty.call(QUESTION_CHAPTER, id) ? QUESTION_CHAPTER[id] : null;
}

export function headerChapter(p: Plan, viewingBlueprint = false) {
    if (viewingBlueprint)
        return 5;
    if (p.policy.placements.length)
        return 4;
    if (p.after.kind !== 'undecided' || (p.policy.urgentKind !== 'undecided' && p.policy.urgentKind !== 'none'))
        return 3;
    if (p.first.kind !== 'undecided' || p.busy.kind !== 'undecided')
        return 2;
    if (p.teams.some(t => t.status === 'known' || t.status === 'deferred') || p.confirmed.includes('hours'))
        return 1;
    return 0;
}

export function sceneFromPlan(p: Plan, viewingBlueprint = false) {
    const mode: SceneMode = p.locations.length > 1 || p.mode === 'adding' ? 'adding' : p.mode || 'welcome';
    let chapter = 0;
    if (p.mode)
        chapter = 1;
    if (p.specialty || p.name)
        chapter = Math.max(chapter, 1);
    if (p.teams.some(t => t.status === 'known' || t.status === 'deferred'))
        chapter = Math.max(chapter, 2);
    if (p.policy.placements.length || viewingBlueprint)
        chapter = Math.max(chapter, 3);
    const specialtyBadge = p.specialty === 'Dental' ? 'Dental practice' : p.specialty === 'Eye care' ? 'Eye care practice' : p.specialty ? 'Consultation space' : '';
    const badge = !p.mode
        ? 'Built around your practice'
        : p.specialty && chapter === 1
            ? specialtyBadge
            : chapter >= 2
                ? teamSummary(p).label
                : choices.find(c => c.id === mode)?.scene || 'Your starting point';
    const indexLabel = viewingBlueprint ? 'YOUR BLUEPRINT' : chapter === 0 ? 'A PLAN THAT FITS' : 'CHAPTER ' + chapter;
    const sceneClass = p.specialty && chapter === 1 ? 'specialty-scene' : chapter === 2 ? 'team-scene' : '';
    return { mode, chapter, badge, indexLabel, sceneClass };
}
