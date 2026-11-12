import type { Plan } from '../config';
import { publicInstructions } from '../policy';
import { roleState } from '../team-state';

function clock(value: string) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value);
    if (!m)
        return value;
    let hour = Number(m[1]);
    const minutes = m[2];
    const suffix = hour >= 12 ? 'PM' : 'AM';
    hour = hour % 12 || 12;
    return minutes === '00' ? hour + ' ' + suffix : hour + ':' + minutes + ' ' + suffix;
}

function practiceName(p: Plan) {
    return p.name.trim() || 'the practice';
}

export type CallerHear = {
    when: string;
    hear: string;
    kind?: 'script' | 'note';
};

export function callerHear(p: Plan): CallerHear[] {
    const name = practiceName(p);
    const out: CallerHear[] = [];
    if (p.first.kind === 'human')
        out.push({
            when: 'During phone hours, if someone picks up',
            hear: 'The front desk rings. A person answers. There is no menu unless you add one later.'
        });
    else if (p.first.kind === 'menu')
        out.push({
            when: 'During phone hours',
            hear: 'A short menu asks why they are calling, then routes to the matching team.'
        });
    else if (p.first.kind === 'assistant')
        out.push({
            when: 'During phone hours',
            hear: 'A proposed AI receptionist answers first. That stays unverified until Upstate configures it.'
        });

    if (p.busy.kind === 'message')
        out.push({
            when: 'During phone hours, if nobody answers',
            hear: 'Thank you for calling ' + name + '. We are not able to take your call right now. Please leave your name, number, and reason for calling, and we will call you back.'
        });
    else if (p.busy.kind === 'queue')
        out.push({
            when: 'During phone hours, if nobody answers',
            hear: 'They wait briefly, then go to the next step you chose.'
        });

    const lunch = p.hours.days.find(d => d.breakStart && d.breakEnd);
    if (lunch)
        out.push({
            when: 'At lunch (' + clock(lunch.breakStart) + '–' + clock(lunch.breakEnd) + ')',
            hear: 'Phones follow the closed-hours path for that window. That is a scheduled close, not overnight voicemail, even if the recording is similar.'
        });

    if (p.after.kind === 'message')
        out.push({
            when: 'After hours',
            hear: 'You have reached ' + name + ' after hours. Please leave your name, number, and reason for calling. We will return your call on the next business day.'
        });
    else if (p.after.kind === 'service')
        out.push({
            when: 'After hours',
            hear: 'A live answering service picks up. That stays a proposal until the vendor is confirmed.'
        });
    else if (p.after.kind === 'information')
        out.push({
            when: 'After hours',
            hear: publicInstructions(p.after.instructions.trim()) || 'A recording plays, then the call ends. No message is taken unless you add one.'
        });
    else if (p.after.kind === 'assistant')
        out.push({
            when: 'After hours',
            hear: 'A proposed AI receptionist answers after hours. Not configured for launch unless you chose it as the launch path.'
        });

    if (p.mode === 'opening') {
        if (p.policy.beforeOpening === 'information')
            out.push({
                when: 'Before opening day',
                hear: publicInstructions(p.policy.beforeOpeningText?.trim() || '') || 'A short recording that you are not open yet. Do not advertise the number until that recording exists.'
            });
        else if (p.policy.beforeOpening === 'message')
            out.push({
                when: 'Before opening day',
                hear: 'Thank you for calling ' + name + '. We are not yet open. Please leave your name, number, and a good time to reach you. We will call you back.'
            });
        else
            out.push({
                when: 'Before opening day',
                hear: 'Not decided. Do not advertise the number until callers have somewhere to go.'
            });
    }

    const sharing = p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing;
    const rec = roleState(p, 'reception').count;
    if (sharing === 'separate' && rec > 1)
        out.push({
            when: 'If two people are at the front',
            hear: 'Each can pick up at the same time. That takes separate lines, not one shared identity.',
            kind: 'note'
        });
    else if (sharing === 'shared' && rec > 1)
        out.push({
            when: 'If two people are at the front',
            hear: 'They share one line. Only one conversation at a time, even if two people sit there.',
            kind: 'note'
        });

    const notes = (p.policy.notes + ' ' + p.policy.continuity.notes).toLowerCase();
    if (/work mobile answering|work app \/ follow me/.test(notes))
        out.push({
            when: 'If a work mobile also rings',
            hear: 'A work app or work mobile can ring. A personal cell number is not stored and will not be spoken in any recording.',
            kind: 'note'
        });

    return out;
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
