import type { Plan } from '../config';
import { fusionBuild, onCallUnbuilt } from '../fusion';
import { formatTime, hoursSummary } from '../flow';

export type CallerHear = {
    when: string;
    hear: string;
    kind?: 'script' | 'note';
    filename?: string;
};

function lunchWhen(p: Plan) {
    const days = p.hours.days.filter(d => d.breakStart && d.breakEnd);
    if (!days.length)
        return '';
    const first = days[0];
    const same = days.every(d => d.breakStart === first.breakStart && d.breakEnd === first.breakEnd);
    const names = days.map(d => d.day.slice(0, 3)).join(', ');
    return 'At lunch (' + formatTime(first.breakStart) + '–' + formatTime(first.breakEnd) + (same ? '' : ' · ' + names) + ')';
}

function recordingWhen(p: Plan, filename: string, name: string): string {
    if (/busy-voicemail/.test(filename))
        return 'During phone hours, if nobody answers';
    if (/lunch-closed/.test(filename))
        return lunchWhen(p) || 'At lunch';
    if (/after-hours-urgent-option/.test(filename))
        return 'After hours';
    if (/priority-message/.test(filename))
        return 'If on-call is missed';
    if (/greeting_1|after-hours-info/.test(filename) && name.toLowerCase().includes('after'))
        return 'After hours';
    if (/before-opening/.test(filename))
        return 'Before opening day';
    if (/ivr-open-greeting/.test(filename))
        return 'During phone hours';
    if (/ivr-open-short/.test(filename))
        return 'During phone hours, if they do not choose';
    return name;
}

function hearRank(when: string) {
    const w = when.toLowerCase();
    if (/nobody answers|if nobody/.test(w))
        return 1;
    if (/during phone hours/.test(w))
        return 2;
    if (/lunch/.test(w))
        return 3;
    if (/^after hours$|after hours$/.test(w) && !/press 9/.test(w))
        return 4;
    if (/priority|on-call is missed/.test(w))
        return 5;
    if (/before opening/.test(w))
        return 6;
    if (/press 9|slammed/.test(w))
        return 7;
    return 8;
}

/** Patient-facing words come only from fusionBuild(p).recordings. */
export function callerHear(p: Plan): CallerHear[] {
    const b = fusionBuild(p);
    const out: CallerHear[] = [];
    const used = new Set<string>();
    const urgentClosed = b.recordings.find(r => /after-hours-urgent-option/.test(r.filename));
    for (const rec of b.recordings) {
        if (/greeting_1/.test(rec.filename) && urgentClosed)
            continue;
        const when = recordingWhen(p, rec.filename, rec.name);
        if (used.has(when) && /After hours/.test(when))
            continue;
        used.add(when);
        out.push({ when, hear: rec.script, filename: rec.filename });
    }
    if (urgentClosed && onCallUnbuilt(p))
        out.push({
            when: 'Press 9 after hours',
            hear: 'Press 9 is part of your plan. It turns on once you give us a work on-call phone — not your personal cell.',
            kind: 'note'
        });
    if (/work mobile answering|work app \/ follow me/i.test((p.policy.notes || '') + ' ' + (p.policy.continuity.notes || '')))
        out.push({
            when: 'If the desk is slammed',
            hear: 'A work mobile can ring. We will not put a personal number in a recording.',
            kind: 'note'
        });
    void hoursSummary;
    return out.sort((a, b) => hearRank(a.when) - hearRank(b.when) || a.when.localeCompare(b.when));
}

export function callerHearText(p: Plan) {
    const rows = callerHear(p);
    if (!rows.length)
        return '';
    return 'What a caller hears — this is a preview, not a live call.\n\n' + rows.map(row => row.when + ': ' + row.hear).join('\n\n');
}

export function canPreviewHear(p: Plan) {
    return p.first.kind !== 'undecided' || p.after.kind !== 'undecided' || p.busy.kind !== 'undecided';
}
