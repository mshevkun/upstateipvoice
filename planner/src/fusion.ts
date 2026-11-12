import { hasTeam, menuDigits, overflowTeams, scenarios, simulate, teamName, type Day, type Plan } from './config';
import { canRing, directory, publicInstructions } from './policy';
import { provisioningMap, ringMembers } from './provisioning';
import { queuePlan, queueAgents, urgentMechanism } from './advisor';

/** FusionPBX objects as they actually exist on the Upstate box (FreeSWITCH + Fusion GUI + v_* tables). */
export type FusionKind =
    | 'destination'
    | 'time_condition'
    | 'ivr'
    | 'ring_group'
    | 'extension'
    | 'voicemail'
    | 'recording'
    | 'call_center'
    | 'follow_me'
    | 'ai_bridge'
    | 'dialplan';

export type FusionObject = {
    kind: FusionKind;
    extension?: string;
    name: string;
    setup: string[];
};

export type FusionRecording = {
    name: string;
    filename: string;
    usedBy: string;
    script: string;
};

export type FusionBuild = {
    domain: string;
    objects: FusionObject[];
    recordings: FusionRecording[];
    analysis: string[];
    specialty: string[];
    numbering: string[];
    checklist: string[];
    blockers: string[];
    parity: string[];
};

const DOMAIN = '<tenant>.upstateipvoice.com';
const XML = (ext: string) => `${ext} XML ${DOMAIN}`;
const VM = (ext: string) => `*99${ext}`;
const FS_WDAY: Record<string, number> = { Sunday: 1, Monday: 2, Tuesday: 3, Wednesday: 4, Thursday: 5, Friday: 6, Saturday: 7 };

function slot(locIndex: number) {
    const i = Math.max(0, locIndex);
    return {
        i,
        tc: String(8000 + i),
        openIvr: String(9000 + i * 10),
        spanishIvr: String(9001 + i * 10),
        closedIvr: String(9002 + i * 10),
        weekendIvr: String(9004 + i * 10),
        langIvr: String(9100 + i),
        locIvr: '9200',
        mainRg: String(7000 + i * 10),
        backupRg: String(7001 + i * 10),
        reasonRg: (n: number) => String(7100 + i * 10 + n),
        urgentRg: String(7900 + i),
        queue: String(5000 + i * 10),
        queueAt: (k: number) => String(5000 + i * 10 + k),
        ai: String(6100 + i)
    };
}

function minute(hhmm: string) {
    const [h, m] = hhmm.split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
}

function clock(mins: number) {
    const n = Math.max(0, Math.min(1439, mins));
    const h = Math.floor(n / 60);
    const m = n % 60;
    const p = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${String(m).padStart(2, '0')} ${p}`;
}

/** Planner treats `end` as exclusive (`time < end`). Fusion minute-of-day is inclusive, so store end-1. */
function windows(day: Day) {
    if (!day.open)
        return [] as { start: number; end: number }[];
    const open = minute(day.start);
    const close = Math.max(open, minute(day.end) - 1);
    if (!day.breakStart || !day.breakEnd)
        return [{ start: open, end: close }];
    const br0 = minute(day.breakStart);
    const br1 = minute(day.breakEnd);
    const out: { start: number; end: number }[] = [];
    if (br0 > open)
        out.push({ start: open, end: br0 - 1 });
    if (close >= br1)
        out.push({ start: br1, end: close });
    return out;
}

function practiceName(p: Plan) {
    return p.name.trim() || 'the practice';
}

function teamLabel(p: Plan, id: string) {
    return hasTeam(p, id) ? teamName(p, id) : 'unassigned team';
}

function dir(p: Plan) {
    return directory(p);
}

function extForTeam(p: Plan, id: string, outside = false) {
    const rows = dir(p).filter(d => d.team === id && (!outside || d.access === 'outside'));
    return rows[0]?.extension || '';
}

function ownerExt(p: Plan, id: string) {
    return extForTeam(p, id, true) || extForTeam(p, id) || '';
}

function vmTarget(p: Plan, id: string) {
    const ext = ownerExt(p, id);
    return ext ? `${VM(ext)}  (voicemail box ${ext} → ${teamLabel(p, id)})` : `voicemail for ${teamLabel(p, id)} (assign an extension first)`;
}

function deviceNote(device: string, sharing: string, count: number, extensions: string[]) {
    const many = sharing === 'undecided' && count > 1
        ? 'BLOCKED: owner has not chosen shared identity vs separate extensions. Do not provision this group.'
        : sharing === 'shared' && count > 1
            ? `One extension (${extensions[0] || 'base'}), ${count} SIP registrations. This is one answering identity and one concurrent answer — not ${count} independently managed phones. Enable multiple registrations on the extension.`
            : sharing === 'separate' && count > 1
                ? `Provision separate SIP users ${extensions.join(', ')}. Each is an independently managed answering position and its own ring-group member.`
                : 'One SIP user for this position.';
    if (device === 'desk')
        return `${many} Desk phones REGISTER with TLS on ${DOMAIN}:5081 (Polycom/Yealink). Provisioning URL is https://${DOMAIN}/app/provision/ — fleet is currently hand-built if ZTP is off.`;
    if (device === 'computer')
        return `${many} Computer answering uses SIP.js over WSS wss://${DOMAIN}:7443. Store the same extension in the portal user_pbx_extensions row (username, pbx_host, pbx_wss_url).`;
    if (device === 'mobile')
        return `${many} Work-mobile answering is the Upstate app on the same extension, plus Follow Me if a cell should ring when the app is not registered. Do not put a personal cell in any recording.`;
    return many;
}

function isSpanish(name: string) {
    return /spanish|espa[nñ]ol/i.test(name);
}

function openHoursSummary(p: Plan) {
    return p.hours.days.filter(d => d.open).map(d => {
        const w = windows(d).map(x => `${clock(x.start)}–${clock(x.end)} (minute-of-day ${x.start}-${x.end})`).join(' and ');
        return `${d.day} (FreeSWITCH wday ${FS_WDAY[d.day]}): ${w || 'closed'}`;
    }).join('; ') || 'No open days — every inbound call uses the after-hours leaf.';
}

function greetingReasons(p: Plan) {
    return menuDigits(p).map(d => `Press ${d.digit} for ${d.label}`).join('. ');
}

function greetingEmergency(p: Plan) {
    return urgentMechanism(p) === 'menu-digit' ? ' If this is a life-threatening emergency, hang up and call 911.' : '';
}

function daytimeGroup(p: Plan, team: string, n: ReturnType<typeof slot>) {
    if (p.first.kind === 'human' && team === p.first.team)
        return n.mainRg;
    if (team === p.busy.backup)
        return n.backupRg;
    const teams = p.teams.filter(t => t.count > 0 && canRing(p, t.id, true));
    const i = teams.findIndex(t => t.id === team);
    return n.reasonRg(i < 0 ? 0 : i);
}

function queueExtFor(p: Plan, team: string, n: ReturnType<typeof slot>) {
    const i = overflowTeams(p).indexOf(team);
    return i < 0 ? '' : n.queueAt(i);
}

function busyTimeout(p: Plan, team: string, n: ReturnType<typeof slot>) {
    const q = p.policy;
    if (p.busy.kind === 'queue') {
        const ext = queueExtFor(p, team, n);
        if (ext)
            return XML(ext);
    }
    if (p.busy.kind === 'assistant')
        return XML(n.ai);
    if (p.busy.kind === 'backup' && (team === p.first.team || team === q.ringOrder[0]?.team))
        return XML(n.backupRg);
    return XML(VM(ownerExt(p, q.teamFallbacks[team]?.owner || p.busy.owner) || '<owner>'));
}

function specialtyNotes(p: Plan) {
    const name = practiceName(p);
    if (p.specialty === 'Dental')
        return [
            `Dental IVR copy should separate appointments, billing, and new patients. Do not put “speak to the doctor” on the open-hours menu unless a clinical destination actually rings.`,
            `After-hours dental emergencies are almost always approved instructions (“if this is a dental emergency, …”) plus a message — not a live clinician — unless an on-call path is explicitly enabled and tested.`,
            `New-patient vs existing-patient is a common second IVR digit. Only add it if ${name} can actually route those two ways.`,
            `HIPAA: enable call recording only with a recorded-call notice in the greeting and a BAA in place. Voice Receptionist production recording is off unless VOICE_RECEPTIONIST_RECORD_PRODUCTION is set.`
        ];
    if (p.specialty === 'Eye care')
        return [
            `If optical and medical share a number, the IVR should say so (“for glasses or contacts press …; for medical eye care press …”) and land on different ring groups.`,
            `After-hours eye injuries typically use approved instructions (ER / on-call ophthalmology) rather than a live connect, unless ${name} staffs an on-call clinician.`,
            `Do not invent clinical triage. Recordings may only play practice-approved wording.`
        ];
    if (p.specialty === 'Other healthcare practice')
        return [
            p.specialtyDetail ? `Treat this as a ${p.specialtyDetail} practice: keep the greeting and menu labels in that practice’s words, not generic “clinic” copy.` : 'Use the practice’s own words on every recording. Generic “press 1 for appointments” is fine only if that is how they actually split work.',
            'Clinical questions should ring a configured clinical destination or take a message. The planner never offers medical advice.'
        ];
    return ['Keep greetings in the practice’s own words. Do not invent clinical content.'];
}

function languageIvrAdvice(p: Plan) {
    const langs = p.languages.filter(l => l.mechanism !== 'undecided');
    if (!langs.length)
        return [] as string[];
    const spanish = langs.find(l => isSpanish(l.name));
    const lines: string[] = [];
    if (p.first.kind === 'human')
        lines.push('Language is identified after a person answers — do not add a language IVR or play_and_get_digits menu. Staff asks. If coverage is unavailable, transfer to the configured callback voicemail, not a second ring group guessed from the caller ID.');
    if (p.first.kind === 'menu') {
        lines.push('Build a short language IVR in Apps → IVR Menu before the reason menu. Do not run two long spoken menus back-to-back if one greeting can hold both.');
        if (spanish)
            lines.push(`Spanish on a keypad uses digit 2, matching live Upstate Voice Receptionist: “For English, press 1. Para español, oprima el 2.” Timeout and invalid digit default to English. Digit 1 transfers to the English reason IVR; digit 2 transfers to a Spanish-language copy of the same options.`);
        else
            lines.push(`Assign keypad digits in the language IVR (English = 1, then 2, 3, …). Each digit transfers to that language’s reason IVR. Timeout → English reason IVR.`);
        lines.push('ivr_menu_option_action is menu-exec-app; option_param is `transfer <ext> XML ' + DOMAIN + '`. After saving, reloadxml.');
    }
    if (p.first.kind === 'assistant' || p.after.kind === 'assistant') {
        lines.push('Virtual-receptionist language is not an Apps → IVR Menu. The after-hours (or first-answer AI) bridge dialplan answers, waits 2 seconds, then play_and_get_digits on /usr/share/freeswitch/sounds/custom/upstate-language-menu.wav. The chosen digit is stamped sip_h_X-Upstate-Lang (en/es). Re-run the tenant enable script after saving Languages.');
        lines.push('English-only: VOICE_RECEPTIONIST_LANGUAGES=en. Spanish on timeout: VOICE_RECEPTIONIST_DEFAULT_LANGUAGE=es.');
    }
    for (const l of langs) {
        if (l.availability === 'always' && !(l.mechanism === 'assistant' && p.after.kind === 'assistant' || l.mechanism === 'staff' && p.after.kind === 'service'))
            lines.push(`${l.name} is marked all-hours, but closed-hours identification only works with an answered after-hours service or virtual receptionist. Until that is confirmed, closed ${l.name} calls take the unavailable-language callback.`);
        if (l.availability === 'limited')
            lines.push(`${l.name} limited hours are not a second Time Condition on the DID. They are a staff/service coverage window. Outside that window the language fallback owns the call — do not keep ringing a team that is not scheduled.`);
        if (l.mechanism === 'staff' && p.first.kind !== 'human')
            lines.push(`${l.name} cannot be identified by staff until first answer is a person.`);
        if (l.mechanism === 'menu' && p.first.kind !== 'menu')
            lines.push(`${l.name} menu identification needs a phone menu as first answer.`);
        if (l.mechanism === 'assistant' && p.first.kind !== 'assistant')
            lines.push(`${l.name} assistant identification needs the virtual receptionist as first answer (open hours).`);
    }
    return lines;
}

function urgentAdvice(p: Plan) {
    const q = p.policy;
    if (!p.urgent.enabled || q.urgentKind === 'none')
        return ['No separate urgent path. Closed callers follow the after-hours leaf only. Do not add a “press 9 for emergencies” prompt unless the practice approves it.'];
    const lines: string[] = [];
    if (q.urgentKind === 'instructions') {
        lines.push('Urgent = a recording, not a connect. Put the approved wording in Apps → Recordings and play it from the closed IVR (or as greet_long). Timeout hangs up or takes the ordinary after-hours message. Private clinician numbers stay out of the WAV.');
        if (!p.urgent.approved || !p.urgent.instructions.trim())
            lines.push('Blocked: wording is not approved. Do not provision an urgent prompt.');
    }
    if (q.urgentKind === 'priority') {
        lines.push(`Urgent = owned priority voicemail (${vmTarget(p, p.urgent.owner)}), not a live clinician. Fusion timeout_app transfers to that box. Portal notification: ${q.urgentAlert === 'email' ? 'email on the voicemail box plus the practice inbox' : q.urgentAlert === 'service' ? 'the answering-service alert, which must be a real contract' : 'choose inbox / email / service before go-live'}. A saved message is not successful clinician contact.`);
    }
    if (q.urgentKind === 'connect') {
        lines.push(`On-call connect uses a dedicated ring group (not the daytime reception group). Members are the on-call role’s outside devices, with Follow Me onto the work mobile. Ring ${p.urgent.seconds}s. Require the far end to answer — Fusion cannot prove “acceptance” by itself; test the handoff before launch.`);
        if (q.urgentRoster === 'rotation')
            lines.push('Fusion does not rotate on-call. Use one on-call extension whose Follow Me / cell is updated when the roster changes, or a Call Center agent status. The rotation must be assigned before implementation.');
        if (q.urgentBackup === 'team')
            lines.push(`Unanswered on-call rolls to ${teamLabel(p, p.urgent.backup)} for ${p.urgent.seconds}s, then ${vmTarget(p, p.urgent.owner)}.`);
        else if (q.urgentBackup === 'instructions')
            lines.push('Unanswered on-call plays the approved urgent recording, then ends. Do not then hunt another clinician.');
        else
            lines.push(`Unanswered on-call goes straight to ${vmTarget(p, p.urgent.owner)}.`);
        if (p.after.kind === 'assistant')
            lines.push('Because after-hours is the virtual receptionist, prefer the Voice Receptionist escalate tool (originate PSTN to the on-call, then uuid_bridge) instead of a second “press 9” IVR in front of the AI. Keep one closed-hours experience.');
        else if (urgentMechanism(p) === 'menu-digit')
            lines.push('Closed-hours entry is an IVR: ordinary after-hours path on timeout / digit 1, on-call ring group on digit 9. Open-hours reason IVR must also offer digit 9 → the on-call ring group. A keypad cannot classify spoken urgency — do not invent a hidden intent hop after the menu.');
        else if (urgentMechanism(p) === 'assistant')
            lines.push('Closed-hours entry follows the virtual receptionist. Urgent classification is proposed until verified. Do not treat the simulator as proof of detection.');
        else
            lines.push('Closed-hours entry is an IVR: ordinary after-hours path on timeout / digit 1, on-call ring group on digit 9. Open hours: staff identifies urgency after they answer; the DID does not jump to on-call automatically.');
        if (q.urgentCoverage === 'closed')
            lines.push('On-call coverage is outside phone hours only. The open-hours Time Condition must not transfer to the on-call group.');
        if (q.urgentCoverage === 'open')
            lines.push('On-call coverage is during phone hours only. Closed callers should not be offered a live connect unless you change this.');
        if (q.urgentCoverage === 'selected')
            lines.push('Selected on-call hours are extra Time Condition groups (or a second TC) — not a note on the recording. Outside those windows, digit 9 takes a priority message.');
        if (!q.acceptance)
            lines.push('Do not report an on-call handoff as connected until transfer acceptance is confirmed.');
    }
    return lines;
}

function busyAdvice(p: Plan) {
    const q = p.policy;
    const timeout = p.busy.seconds;
    if (p.busy.kind === 'undecided')
        return ['Busy/unanswered behavior is undecided. Do not set ring_group_timeout_app until this is chosen — a missing timeout in Fusion loops or dumps to hangup.'];
    if (p.busy.kind === 'message')
        return [`When nobody answers, the ring group (or Call Center) timeout is ${timeout}s, then transfer ${XML(VM(ownerExt(p, p.busy.owner) || '<owner-ext>'))}. Record a voicemail greeting on that box. Notification requirement: ${q.notification === 'inbox' ? 'portal shared inbox (Fusion voicemail webhook → portal)' : q.notification === 'email' ? 'Fusion voicemail email plus portal copy' : q.notification === 'practice' ? 'practice-wide notification, configured on the box and in the portal' : 'choose a notification path before go-live'}. A voicemail is not a booked appointment.`];
    if (p.busy.kind === 'backup')
        return [`Primary ring group timeout_app transfers to the backup team’s ring group (${teamLabel(p, p.busy.backup)}), same ${timeout}s, then ${vmTarget(p, p.busy.owner)}. Do not put both teams in one simultaneous group — that is “together,” not backup.`];
    if (p.busy.kind === 'queue') {
        const exit = q.queueExit === 'backup'
            ? `try ${teamLabel(p, p.busy.backup)}, then ${vmTarget(p, p.busy.owner)}`
            : q.queueExit === 'assistant'
                ? 'transfer to the Voice Receptionist bridge, with unfinished requests owned by the configured owner'
                : q.queueExit === 'undecided'
                    ? 'queue exit is still undecided — do not provision the queue yet'
                    : vmTarget(p, p.busy.owner);
        return [
            `“Let callers wait” is a Fusion Call Center queue (Apps → Call Centers), not a longer ring group. Music on hold, max wait ${p.busy.wait}s, then ${exit}.`,
            queueAgents(p).note,
            'Live Upstate tenants mostly use ring groups. Only build a Call Center when this plan explicitly chose a wait. If nobody joins during the wait, the simulator (and the live queue) must still exit — never ring forever.'
        ];
    }
    return [
        `After ${timeout}s unanswered, transfer to the Voice Receptionist bridge (same pattern as after-hours AI: a small bridge extension that bridges sofia/external/<project>@sip.api.openai.com;transport=tls and POSTs /webhooks/fusionpbx/voice-ai-bridge). Daytime AI overflow is not the closed Time Condition leaf — it is the ring-group timeout.`,
        'If the receptionist is unavailable, unfinished-request voicemail still belongs to the configured owner.'
    ];
}

function afterAdvice(p: Plan) {
    if (p.after.kind === 'undecided')
        return ['After-hours is undecided. Time Condition group 999 cannot be pointed at a destination yet. Inbound after hours would hit an incomplete dialplan.'];
    if (p.after.kind === 'information') {
        const text = publicInstructions(p.after.instructions.trim() || '');
        return [
            'Closed leaf (group 999, plus weekend groups if Saturday/Sunday are closed) plays a recording and hangs up. Use action playback on the WAV, then hangup — or a tiny IVR whose greet_long is the recording and whose exit is hangup. This is not voicemail and not a connect.',
            text ? `Approved wording to record: “${text}”` : 'Blocked: no approved closed-hours wording. Do not provision the playback yet.',
            'Do not collect a callback on this path unless you change after-hours to “take a message.”'
        ];
    }
    if (p.after.kind === 'message')
        return [`Closed leaf transfers to ${vmTarget(p, p.after.owner)}. Record greeting_1.wav on that box with next-business-day expectations. Portal voicemail webhook + transcription follow the existing Fusion path (RECORD_STOP → pbx-push-bridge → /webhooks/fusionpbx/voicemail).`];
    if (p.after.kind === 'service')
        return [
            'Closed leaf transfers to the contracted answering service — either an external number via the Telnyx gateway (`bridge sofia/gateway/<uuid>/<number>`) or a dedicated extension the service registers. Permitted actions live in the contract, not in Fusion.',
            p.after.instructions.trim() ? `Service limits to print on the runbook: ${publicInstructions(p.after.instructions)}` : 'Record the agreed scope before pointing the closed leaf at the service.',
            'If the service does not answer, timeout to the after-hours message owner. Language identification after hours is allowed only because a person (the service) answered.'
        ];
    return [
        'Closed Time Condition leaves transfer to a per-DID Voice Receptionist bridge extension (live NE Braces pattern: Newburgh 6100, Wappingers 6101). Do not point group 999 at the daytime IVR.',
        'Bridge dialplan: set sip_h_X-Upstate-DID, optional language menu, bridge OpenAI SIP TLS, mod_curl POST voice-ai-bridge with the FreeSWITCH UUID. Tenant needs voice_receptionist entitlement and a location DID in tenant_calling_numbers.',
        'Rollback is pointing the closed leaves back at the previous voicemail / IVR. Daytime open-hour transfers stay untouched.'
    ];
}

function identityAdvice(p: Plan) {
    const recN = p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
    const share = p.policy.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing;
    const groups = provisioningMap(p).groups;
    const notes = (p.policy.notes || '') + ' ' + (p.policy.continuity.notes || '');
    const lines: string[] = [];
    if (share === 'separate' && recN > 1 && !groups.some(g => g.team === 'reception'))
        lines.push(`Owner requires ${recN} independent reception identities so both can pick up at once. Suggest extensions ${p.policy.extensionBase} and ${p.policy.extensionBase + 1} as ring-group ${slot(0).mainRg} members once models exist. Do not create one shared SIP user. This is not a phone-per-room order.`);
    else if (share === 'shared' && recN > 1)
        lines.push('Front desk shares one identity. Two people at the desk are still one concurrent call until a second identity is added.');
    if (/work mobile answering|work app \/ follow me/i.test(notes))
        lines.push('Work-mobile answering: enable the Upstate app and Follow Me on the owner/clinician extension. Do not store a personal cell in Fusion, in Follow Me, or in any recording.');
    return lines;
}

function firstAdvice(p: Plan) {
    const q = p.policy;
    if (p.first.kind === 'undecided')
        return ['First answer is undecided. The open-hours Time Condition has nowhere to send the call.'];
    if (p.first.kind === 'human' && q.ring === 'together')
        return [
            `Open hours transfer to a simultaneous ring group for ${teamLabel(p, p.first.team)}. ring_group_strategy = simultaneous, ring_group_call_timeout = ${p.busy.seconds}. Members are every outside-call extension for that team (desk, computer, mobile).`,
            'Callers hear ringing, not a menu. Language and reason are unknown until someone answers. Do not play an IVR greeting on this path.',
            q.ring === 'together' && !canRing(p, p.first.team, true)
                ? (p.policy.placements.some(x => x.team === p.first.team && x.sharing === 'separate')
                    ? 'Ring-group members are not assigned yet. Reserve independent identities so both can pick up. Do not share one SIP user. Device models are not chosen.'
                    : 'Blocked: the first-answer team has no outside-call device.')
                : ''
        ].filter(Boolean);
    if (p.first.kind === 'human' && q.ring === 'order') {
        const order = q.ringOrder.map((r, i) => `${i + 1}. ${teamLabel(p, r.team)} for ${r.seconds}s`).join(' → ') || '(no order yet)';
        return [
            `Ordered ringing is chained ring groups, not one simultaneous group. ${order}. Each group’s timeout_app transfers to the next group; the last group uses the busy fallback.`,
            'Putting every extension in one sequence ring group is only correct when the order is person-by-person inside one team. Team-by-team order needs one ring group per team.',
            !q.ringOrder.length ? 'Blocked: add the ordered ringing destinations.' : ''
        ].filter(Boolean);
    }
    if (p.first.kind === 'human')
        return ['Ringing strategy is undecided. Do not create the open-hours ring group until together vs in-order is chosen.'];
    if (p.first.kind === 'menu')
        return [
            `Open hours transfer to an IVR (Apps → IVR Menu), not a ring group. greet_long is a recording in Apps → Recordings stored at /var/lib/freeswitch/recordings/${DOMAIN}/.`,
            `Menu digits: ${greetingReasons(p) || 'add at least one reason'}. Each option_param is transfer <ring-group-or-ext> XML ${DOMAIN}.`,
            `Timeout ${Math.max(3, p.policy.menuRetries === 0 ? 3 : 5)}s, ivr_menu_max_timeouts and ivr_menu_max_failures = ${p.policy.menuRetries}. Invalid / no-input then ${p.menu.invalid === 'team' || p.menu.noInput === 'team' ? 'ring ' + teamLabel(p, p.menu.team) : 'the busy-message voicemail'}. Direct dial can stay off so callers cannot guess extensions.`,
            'A menu is not staff identification. Do not also ring reception in parallel with the IVR.'
        ];
    return [
        'Open hours transfer to the Voice Receptionist bridge (same object as after-hours AI, different Time Condition group). This is unusual for daytime on live tenants — PCSR exposes AI as IVR digit 9 (ext 6001) rather than replacing the receptionist. Confirm that the practice wants AI as the first voice, not a press-9 option.',
        'Human fallback is a transfer/originate to the configured team, not an implicit reception ring. Unfinished requests own a voicemail box. Appointment “requests” are messages, never bookings, until a PMS integration is verified.'
    ];
}

function locationAdvice(p: Plan, locIndex: number) {
    const n = slot(locIndex);
    if (p.locations.length < 2)
        return [p.mode === 'opening'
            ? `Single location: before-opening and after-opening Destinations are separate objects. After cutover, the DID transfers to Time Condition ${n.tc}. Locations are portal overlays, not extra Fusion domains. One tenant = one SIP domain ${DOMAIN}.`
            : `Single location: one inbound Destination (DID) transfers to Time Condition ${n.tc}. Locations are portal overlays, not extra Fusion domains. One tenant = one SIP domain ${DOMAIN}.`];
    const q = p.policy;
    if (q.locationEntry === 'undecided')
        return ['Multi-location main-number entry is undecided. Do not point the published DID until shared vs menu vs separate numbers is chosen.'];
    if (q.locationEntry === 'shared') {
        const extra = p.first.kind !== 'human' ? 'Blocked with the current first-answer choice: shared reception can only ask the location after a person answers. Switch first answer to a person, or use a location menu / separate DIDs.' : 'Open hours ring the shared reception group. After answer, staff asks which location. Each location still has its own hours, teams, and on-call — that is a training/runbook item, not a second Time Condition on this DID.';
        return [extra];
    }
    if (q.locationEntry === 'menu')
        return [
            'Published DID transfers to a location IVR (extension 9200). Digits 1..N transfer to that location’s Time Condition (8000, 8001, …). Invalid/no-input follows the menu fallback, not a guess at a location.',
            'Each location still needs its own TC, open IVR/RG, and closed leaf. Unconfigured locations must not have a digit — missing local plans stay unresolved.'
        ];
    return [
        'Each location has its own DID in Destinations. Destination_data is `8000 XML domain` / `8001 XML domain` — never a shared IVR. Portal tenant_calling_numbers.location_id must match so Voice Receptionist and work-hours UI stay on the right TC.',
        p.mode === 'adding' && q.number === 'shared' ? 'A new location that shares an entry number is not “separate numbers.” Use the location menu or shared-reception pattern instead.' : `Number arrangement for a new location: ${q.number}.`
    ];
}

function modeAdvice(p: Plan, locIndex: number) {
    if (p.mode === 'opening') {
        const q = p.policy;
        if (q.beforeOpening === 'information')
            return ['Before opening day, point the DID at a dedicated announcement (playback of the approved opening recording, then hangup) — not the future Time Condition. Flip Destinations to the live TC on opening morning. No opening date is inferred from this plan.'];
        if (q.beforeOpening === 'message')
            return [`Before opening day, Destination transfers to ${vmTarget(p, q.beforeOpeningOwner || '')}. On opening morning, repoint the DID at Time Condition ${slot(locIndex).tc}.`];
        return ['BLOCKED: before-opening destination is unresolved. Do not publish the DID. Do not invent an announcement or callback. After-opening Time Condition routing is a separate configuration, applied at cutover.'];
    }
    if (p.mode === 'adding')
        return locationAdvice(p, locIndex);
    return [];
}

function combinationWarnings(p: Plan) {
    const a: string[] = [];
    if (p.locations.length > 1 && p.policy.locationEntry === 'shared' && p.first.kind !== 'human')
        a.push('Incompatible: shared reception + menu/AI first answer. Fusion cannot ask the location until a person is on the line.');
    if (p.first.kind === 'human' && p.languages.some(l => l.mechanism === 'menu'))
        a.push('Incompatible: language keypad requires a phone menu as first answer.');
    if (p.first.kind === 'menu' && p.languages.some(l => l.mechanism === 'staff'))
        a.push('Incompatible: staff cannot identify a language before they have the call. Use menu identification, or switch first answer to a person.');
    if (p.first.kind === 'assistant' && p.languages.some(l => l.mechanism === 'staff' || l.mechanism === 'menu'))
        a.push('With AI first, language identification is the Voice Receptionist keypad (en/es), not staff and not Apps → IVR.');
    if (p.busy.kind === 'queue' && p.policy.queueExit === 'undecided')
        a.push('Call Center queue has no exit. Do not enable the queue.');
    if (p.after.kind === 'information' && p.urgent.enabled && p.policy.urgentKind === 'connect')
        a.push('Closed path is currently “play information and end.” A live on-call connect needs a closed IVR (digit 9) or the virtual receptionist escalate tool — not a playback-then-hangup as the only leaf.');
    if (p.policy.placements.some(x => x.count > 1 && x.sharing === 'undecided' && !['none', 'undecided'].includes(x.device)))
        a.push('Sharing undecided: do not provision ring-group members until the owner chooses one shared identity or separate extensions.');
    return a;
}

function recordings(p: Plan, locIndex = 0): FusionRecording[] {
    const n = slot(locIndex);
    const name = practiceName(p);
    const out: FusionRecording[] = [];
    const add = (rec: FusionRecording) => out.push(rec);
    if (p.first.kind === 'menu') {
        const langs = p.languages.filter(l => l.mechanism === 'menu');
        add({
            name: 'Open-hours IVR greeting',
            filename: 'ivr-open-greeting.wav',
            usedBy: `IVR ${n.openIvr} greet_long`,
            script: `Thank you for calling ${name}. ${greetingReasons(p)}.${greetingEmergency(p)}`
        });
        add({
            name: 'Open-hours IVR short greeting',
            filename: 'ivr-open-short.wav',
            usedBy: `IVR ${n.openIvr} greet_short (replays after invalid/no input)`,
            script: (greetingReasons(p) || 'Please make a selection.') + greetingEmergency(p)
        });
        if (langs.length)
            add({
                name: 'Language menu',
                filename: 'ivr-language.wav',
                usedBy: `IVR ${n.langIvr} greet_long`,
                script: `Thank you for calling ${name}. For English, press 1. ${langs.map((l, i) => isSpanish(l.name) ? 'Para español, oprima el ' + (i + 2) : `For ${l.name}, press ${i + 2}`).join('. ')}.`
            });
    }
    if (p.locations.length > 1 && p.policy.locationEntry === 'menu')
        add({
            name: 'Location menu',
            filename: 'ivr-location.wav',
            usedBy: `IVR ${n.locIvr} greet_long`,
            script: `Thank you for calling ${name}. ${p.locations.map((l, i) => `For ${l.name}, press ${i + 1}`).join('. ')}.`
        });
    if (p.after.kind === 'information' && p.after.instructions.trim())
        add({
            name: 'After-hours information',
            filename: 'after-hours-info.wav',
            usedBy: `Time Condition group 999 playback (or closed IVR ${n.closedIvr})`,
            script: publicInstructions(p.after.instructions)
        });
    if (p.after.kind === 'message' && hasTeam(p, p.after.owner))
        add({
            name: 'After-hours voicemail greeting',
            filename: 'greeting_1.wav',
            usedBy: `Voicemail box ${ownerExt(p, p.after.owner) || '(owner extension)'}`,
            script: `You have reached ${name} after hours. Please leave your name, number, and reason for calling. ${publicInstructions(p.after.instructions) || 'We will return your call on the next business day.'}`
        });
    if (p.busy.kind !== 'undecided' && hasTeam(p, p.busy.owner))
        add({
            name: 'Busy / unanswered voicemail greeting',
            filename: 'busy-voicemail.wav',
            usedBy: `Timeout from the open-hours ring group / queue → box ${ownerExt(p, p.busy.owner) || '(owner)'}`,
            script: `Thank you for calling ${name}. We are not able to take your call right now. Please leave your name, number, and reason for calling, and we will call you back.`
        });
    if (p.urgent.enabled && (p.policy.urgentKind === 'instructions' || p.policy.urgentBackup === 'instructions') && p.urgent.approved && p.urgent.instructions.trim())
        add({
            name: 'Urgent instructions',
            filename: 'urgent-instructions.wav',
            usedBy: p.after.kind === 'assistant' ? 'Voice Receptionist approved prompt / escalate copy' : 'Closed IVR digit 9 fallback or instructions-only urgent path',
            script: publicInstructions(p.urgent.instructions)
        });
    if (p.urgent.enabled && p.policy.urgentKind === 'connect' && p.after.kind !== 'assistant')
        add({
            name: 'Closed-hours urgent option',
            filename: 'after-hours-urgent-option.wav',
            usedBy: `Closed IVR ${n.closedIvr} greet_long`,
            script: `You have reached ${name} after hours. For a practice-approved urgent matter, press 9. ${p.after.kind === 'message' ? 'To leave a message, press 1 or wait.' : p.after.kind === 'information' ? 'Otherwise, please listen for our office information.' : 'Otherwise, please hold for assistance.'}`
        });
    if (p.mode === 'opening' && p.policy.beforeOpening === 'information' && p.policy.beforeOpeningText?.trim())
        add({
            name: 'Before-opening announcement',
            filename: 'before-opening.wav',
            usedBy: 'Temporary Destination playback until opening day',
            script: publicInstructions(p.policy.beforeOpeningText)
        });
    if (p.mode === 'opening' && p.policy.beforeOpening === 'message')
        add({
            name: 'Before-opening callback greeting',
            filename: 'before-opening-callback.wav',
            usedBy: `Temporary Destination → box ${ownerExt(p, p.policy.beforeOpeningOwner || p.after.owner || p.busy.owner) || '(callback owner)'}`,
            script: `Thank you for calling ${name}. We are not yet open. Please leave your name, number, and a good time to reach you. We will call you back.`
        });
    for (const l of p.languages) {
        if (l.mechanism === 'menu' && isSpanish(l.name))
            add({
                name: 'Spanish reason menu',
                filename: 'ivr-open-es.wav',
                usedBy: `Spanish IVR ${n.spanishIvr} greet_long`,
                script: `Gracias por llamar a ${name}. ${menuDigits(p).map(d => d.kind === 'urgent' ? 'Para un asunto urgente del consultorio, oprima ' + d.digit : `Para ${d.label}, oprima ${d.digit}`).join('. ')}.${urgentMechanism(p) === 'menu-digit' ? ' Si es una emergencia que pone en riesgo la vida, cuelgue y llame al 911.' : ''}`
            });
        const f = p.policy.languageFallbacks[l.name];
        if (f?.kind === 'instructions' && f.approved && f.text.trim())
            add({
                name: `${l.name} unavailable instructions`,
                filename: `lang-${l.name.toLowerCase().replace(/\s+/g, '-')}-unavailable.wav`,
                usedBy: `${l.name} coverage miss`,
                script: publicInstructions(f.text)
            });
    }
    if ((p.first.kind === 'assistant' || p.after.kind === 'assistant' || p.busy.kind === 'assistant') && p.languages.some(l => isSpanish(l.name) || l.mechanism === 'assistant'))
        add({
            name: 'Voice Receptionist language keypad (already on the Fusion VM)',
            filename: 'upstate-language-menu.wav',
            usedBy: 'AI bridge dialplan play_and_get_digits — not v_recordings',
            script: 'For English, press 1. Para español, oprima el 2. Deployed to /usr/share/freeswitch/sounds/custom/upstate-language-menu.wav. Do not re-record this into Apps → Recordings unless replacing the system file.'
        });
    return out;
}

function objects(p: Plan, locIndex: number): FusionObject[] {
    const q = p.policy;
    const list: FusionObject[] = [];
    const n = slot(locIndex);
    const tcExt = n.tc;
    const openIvr = n.openIvr;
    const spanishIvr = n.spanishIvr;
    const closedIvr = n.closedIvr;
    const weekendIvr = n.weekendIvr;
    const langIvr = n.langIvr;
    const locIvr = n.locIvr;
    const mainRg = n.mainRg;
    const backupRg = n.backupRg;
    const urgentRg = n.urgentRg;
    const queueExt = n.queue;
    const aiExt = n.ai;
    const locName = p.locations.find(l => l.id === q.activeLocation)?.name || p.locations[0]?.name || 'Main practice';

    const afterOpeningDest = p.locations.length > 1 && q.locationEntry === 'menu'
        ? `Apps → Destinations: published number, destination_app = transfer, destination_data = ${XML(locIvr)}.`
        : `Apps → Destinations: this location’s DID, destination_app = transfer, destination_data = ${XML(tcExt)}. Match the number Telnyx sends (10-digit, 11-digit, or +1).`;
    if (p.mode === 'opening') {
        list.push({
            kind: 'destination',
            name: `Inbound DID · before opening · ${locName}`,
            setup: q.beforeOpening === 'undecided'
                ? [
                    'BLOCKED: before-opening destination is unresolved. Do not publish the DID.',
                    'Do not point Destinations at an announcement, a callback box, or the live Time Condition until the owner approves a pre-launch policy.',
                    'After-opening routing is a separate object, applied at cutover — not implied by this plan.'
                ]
                : q.beforeOpening === 'information'
                    ? [
                        'Temporary Destination: playback before-opening.wav then hangup. Not Time Condition ' + tcExt + '.',
                        'Cutover: on opening morning, change Destinations to the after-opening object. These are two configurations.'
                    ]
                    : [
                        `Temporary Destination: transfer to the approved callback box ${vmTarget(p, q.beforeOpeningOwner || '')}. Not Time Condition ${tcExt}.`,
                        'Cutover: on opening morning, change Destinations to the after-opening object. These are two configurations.'
                    ]
        });
        list.push({
            kind: 'destination',
            name: `Inbound DID · after opening · ${locName}`,
            setup: [
                afterOpeningDest + ' Apply this object at cutover, not while the practice is still pre-opening.',
                'Never point a DID at a user extension directly if hours, IVR, or after-hours matter — always Time Condition first.'
            ]
        });
    }
    else
        list.push({
            kind: 'destination',
            name: `Inbound DID → ${locName}`,
            setup: [
                afterOpeningDest,
                'Never point a DID at a user extension directly if hours, IVR, or after-hours matter — always Time Condition first.'
            ]
        });

    const openTarget = p.first.kind === 'human' && (q.ring === 'together' || q.ring === 'order')
        ? XML(mainRg)
        : p.first.kind === 'menu'
            ? XML(p.languages.some(l => l.mechanism === 'menu') ? langIvr : openIvr)
            : p.first.kind === 'assistant'
                ? XML(aiExt)
                : '(undecided)';

    const closedTarget = p.urgent.enabled && q.urgentKind === 'connect' && p.after.kind !== 'assistant'
        ? XML(closedIvr)
        : p.after.kind === 'information'
            ? XML(closedIvr)
            : p.after.kind === 'message'
                ? XML(VM(ownerExt(p, p.after.owner) || '<owner>'))
                : p.after.kind === 'service'
                    ? 'bridge sofia/gateway/<telnyx-gateway>/<service-number>  (or transfer to the service’s registered extension)'
                    : p.after.kind === 'assistant'
                        ? XML(aiExt)
                        : '(undecided)';

    const holidayGroups = p.hours.holidayPolicy === 'closed'
        ? [...p.hours.holidays, ...q.closures].filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d))
        : q.closures.filter(d => /^\d{4}-\d{2}-\d{2}$/.test(d));

    list.push({
        kind: 'time_condition',
        extension: tcExt,
        name: `Time Condition ${tcExt} (${locName})`,
        setup: [
            `Apps → Time Conditions (dialplan order 300, number ${tcExt}). Group rows in v_dialplan_details. FreeSWITCH wday Sunday=1 … Saturday=7. Use minute-of-day, not hour, so breaks and 5-minute opens are exact.`,
            `Open groups (one group per weekday window): ${openHoursSummary(p)}. Each open group action = transfer ${openTarget}.`,
            'Breaks are a gap between two groups on the same wday — not a third “break destination” unless you explicitly want lunch IVR.',
            `Group 999 (catch-all after hours) action = transfer ${closedTarget}. Closed weekend days simply fall through to 999; do not create empty Saturday groups.`,
            holidayGroups.length
                ? `Date-only groups (mon + mday, no wday) for ${holidayGroups.join(', ')} transfer to the closed target. In Fusion these groups evaluate as closed, matching holidayPolicy=closed.`
                : 'No holiday/closure date groups. Listed holidays with policy “regular hours” keep the weekday open groups.',
            `Timezone for the TC must be ${p.hours.timezone} (Fusion domain time settings). The planner’s isOpen() uses the same zone, breaks, and exclusive end time.`,
            'After writes: POST /commands/reload-xml (or GUI Apply). Portal work-hours UI can edit these groups when FUSION_TIME_CONDITION_WRITE is on.'
        ]
    });

    for (const g of provisioningMap(p).groups) {
        const extList = g.extensions.join(', ');
        list.push({
            kind: 'extension',
            extension: g.base,
            name: `Extension ${extList} · ${g.label}`,
            setup: [
                `Apps → Extensions: ${extList}. effective_caller_id_name = ${g.label}. user_context = ${DOMAIN}. Outbound CID is usually the main DID (leave effective_caller_id_number empty unless this position needs its own).`,
                deviceNote(g.device, g.sharing, g.deviceCount, g.extensions),
                g.note,
                g.access === 'internal' ? 'Internal only: do not add this extension to inbound ring groups. It can still be an IVR / transfer target for staff.' : 'Outside-call member: include each identity in the team ring group.',
                g.suggested ? `Number is suggested (${g.base}), not provisioned. Confirm it is free in v_extensions for this domain (extensions repeat across tenants — uniqueness is per domain_uuid).` : `Using the number entered in the plan (${g.base}).`
            ]
        });
        if (g.device === 'mobile')
            for (const ext of g.extensions)
                list.push({
                    kind: 'follow_me',
                    extension: ext,
                    name: `Follow Me · ${g.label} ${ext}`,
                    setup: [
                        'On the extension, enable Follow Me / call forward for the work mobile only when the practice wants the cell to ring if the app is unregistered.',
                        'Inbound push to the mobile app is separate: pbx-push-bridge fires on extension b-leg CHANNEL_CREATE, not while a call sits in an IVR. Abandoned IVR = no push.'
                    ]
                });
        for (const ext of g.extensions)
            list.push({
                kind: 'voicemail',
                extension: ext,
                name: `Voicemail box ${ext}`,
                setup: [
                    `Apps → Voicemail: voicemail_id ${ext} (keep mailbox = extension). Greeting files live in /var/lib/freeswitch/storage/voicemail/default/${DOMAIN}/${ext}/greeting_1.wav.`,
                    `To send a call to this box from anywhere: transfer ${XML(VM(ext))}.`
                ]
            });
    }

    const teamsWithOutside = p.teams.filter(t => t.count > 0 && canRing(p, t.id, true));
    teamsWithOutside.forEach((t, i) => {
        const members = ringMembers(p, t.id, true);
        const ext = t.id === p.first.team ? mainRg : t.id === p.busy.backup ? backupRg : n.reasonRg(i);
        const strategy = p.first.kind === 'human' && q.ring === 'order' && q.ringOrder.some(r => r.team === t.id) ? 'sequence' : 'simultaneous';
        const hop = q.ring === 'order' ? q.ringOrder.find(r => r.team === t.id)?.seconds : undefined;
        const groupTimeout = hop || p.busy.seconds;
        list.push({
            kind: 'ring_group',
            extension: ext,
            name: `Ring group ${ext} · ${t.name}`,
            setup: [
                `Apps → Ring Groups: extension ${ext}, strategy ${strategy}, call timeout ${groupTimeout}s. Member timeouts must match this group — do not mix the on-call ${p.urgent.seconds}s timeout into daytime groups.`,
                `Members (v_ring_group_destinations): ${members.map(m => `${m.extension} (${m.device}${m.registrations > 1 ? ', ' + m.registrations + ' registrations / 1 concurrent' : ''}, delay 0, timeout ${groupTimeout})`).join('; ') || 'none — assign outside devices first'}.`,
                `timeout_app = transfer; timeout_data = ${busyTimeout(p, t.id, n)}.`,
                'reloadxml after member changes. Portal Call Flow can write members when the write flag is on.'
            ]
        });
    });

    if (p.first.kind === 'human' && (q.ring === 'together' || q.ring === 'order') && !teamsWithOutside.some(t => t.id === p.first.team)) {
        const recN = p.teams.filter(t => t.role === 'reception' && t.status === 'known').reduce((n, t) => n + t.count, 0);
        const share = q.placements.find(x => x.team === 'reception' && x.sharing !== 'undecided')?.sharing;
        list.push({
            kind: 'ring_group',
            extension: mainRg,
            name: `Ring group ${mainRg} · ${teamLabel(p, p.first.team)} (members not assigned)`,
            setup: [
                `Apps → Ring Groups: extension ${mainRg}, strategy ${q.ring === 'order' ? 'sequence' : 'simultaneous'}, call timeout ${p.busy.seconds}s. Do not mix the on-call ${p.urgent.seconds}s timeout into this group.`,
                share === 'separate' && recN > 1
                    ? `Reserve ${recN} independent identities as members (suggested ${p.policy.extensionBase}, ${p.policy.extensionBase + 1}). Models are not chosen. Do not share one SIP user.`
                    : 'Members: none — assign outside-call devices before provisioning.',
                `timeout_app = transfer; timeout_data = ${busyTimeout(p, p.first.team, n)}.`
            ]
        });
    }

    if (p.first.kind === 'human' && q.ring === 'order' && q.ringOrder.length) {
        list.push({
            kind: 'dialplan',
            name: 'Ordered-ring chain',
            setup: q.ringOrder.map((r, i) => {
                const next = q.ringOrder[i + 1];
                const fail = next ? `next team ring group (${teamLabel(p, next.team)})` : 'busy fallback';
                return `Hop ${i + 1}: ring ${teamLabel(p, r.team)} for ${r.seconds}s → if no answer, ${fail}. Each hop is its own ring group; do not collapse them into delays on one group unless the hop is people inside one team.`;
            })
        });
    }

    if (p.busy.kind === 'queue') {
        const plan = queuePlan(p);
        for (const [i, queue] of plan.queues.entries()) {
            const ext = n.queueAt(i);
            list.push({
                kind: 'call_center',
                extension: ext,
                name: `Call Center queue ${ext} · ${queue.label}`,
                setup: [
                    `Apps → Call Centers: queue extension ${ext}, music on hold, max wait ${queue.wait}s. This wait is only for ${queue.label}.`,
                    queue.members.length
                        ? `Agents (must be provisioned, not inferred): ${queue.members.map(m => m.extension + ' ' + m.label).join(', ')}. Do not add other teams’ identities. Exit: ${q.queueExit === 'backup' ? XML(backupRg) : q.queueExit === 'assistant' ? XML(aiExt) : XML(VM(ownerExt(p, queue.owner) || '<owner>'))}.`
                        : 'BLOCKED: queue membership is unresolved. Do not enable this Call Center until this team has answering identities.',
                    plan.shared ? 'Single overflow queue — only one destination team is waiting.' : 'Separate from other reason queues. A caller who pressed a different digit does not land here.'
                ]
            });
        }
        if (!plan.queues.length)
            list.push({
                kind: 'call_center',
                extension: queueExt,
                name: `Call Center queue ${queueExt}`,
                setup: ['BLOCKED: queue membership is unresolved. Do not enable the Call Center until overflowing teams have answering identities.']
            });
    }

    if (p.first.kind === 'menu') {
        const options = menuDigits(p).map(d => {
            if (d.kind === 'urgent')
                return `Digit ${d.digit} → ${d.label} → transfer RG ${urgentRg}. A keypad cannot classify spoken urgency.`;
            const dest = canRing(p, d.team, true) || canRing(p, d.team) ? `RG ${daytimeGroup(p, d.team, n)} (${teamLabel(p, d.team)})` : `(unresolved ${d.label})`;
            return `Digit ${d.digit} → ${d.label} → transfer ${dest}`;
        });
        list.push({
            kind: 'ivr',
            extension: openIvr,
            name: `IVR ${openIvr} · ${locName} reason menu`,
            setup: [
                `Apps → IVR Menu: extension ${openIvr}, greet_long = ivr-open-greeting.wav, greet_short = ivr-open-short.wav, timeout ~5000 ms, max_timeouts ${q.menuRetries}, max_failures ${q.menuRetries}.`,
                ...options,
                `Exit / invalid / no-input after retries: ${p.menu.invalid === 'team' || p.menu.noInput === 'team' ? 'transfer to ' + teamLabel(p, p.menu.team) : vmTarget(p, p.busy.owner)}.`,
                'Options are rows in v_ivr_menu_options (action menu-exec-app, param `transfer <ext> XML domain`). Direct dial off unless the practice wants extension guessing.'
            ].filter(Boolean)
        });
        if (p.languages.some(l => l.mechanism === 'menu'))
            list.push({
                kind: 'ivr',
                extension: langIvr,
                name: `IVR ${langIvr} · language`,
                setup: [
                    `greet_long = ivr-language.wav. English = 1${p.languages.some(l => isSpanish(l.name)) ? ', Spanish = 2' : ', then additional languages 2, 3, …'}.`,
                    `Digit 1 transfers to ${openIvr}. Digit 2 transfers to Spanish reason IVR ${spanishIvr}. Timeout → ${openIvr}.`,
                    'Open Time Condition should transfer here, not directly to the reason IVR, when language is a keypad choice.'
                ]
            });
        if (p.languages.some(l => l.mechanism === 'menu' && isSpanish(l.name)))
            list.push({
                kind: 'ivr',
                extension: spanishIvr,
                name: `IVR ${spanishIvr} · Spanish reason menu`,
                setup: [
                    `Copy of the English reason IVR with greet_long = ivr-open-es.wav. Same digits and destinations as ${openIvr}. Same invalid/no-input exit.`
                ]
            });
    }

    if (p.locations.length > 1 && q.locationEntry === 'menu')
        list.push({
            kind: 'ivr',
            extension: locIvr,
            name: `IVR ${locIvr} · location`,
            setup: [
                `Published DID → ${locIvr}. ${p.locations.map((l, i) => `Digit ${i + 1} = ${l.name} → Time Condition ${8000 + i}`).join('. ')}.`,
                `Invalid/no-input retries ${q.menuRetries}, then ${p.menu.invalid === 'team' ? teamLabel(p, p.menu.team) : vmTarget(p, p.busy.owner)}.`
            ]
        });

    if (p.after.kind === 'information' || (p.urgent.enabled && q.urgentKind === 'connect' && p.after.kind !== 'assistant'))
        list.push({
            kind: 'ivr',
            extension: closedIvr,
            name: `IVR ${closedIvr} · after hours`,
            setup: [
                p.after.kind === 'information' && !(p.urgent.enabled && q.urgentKind === 'connect')
                    ? 'greet_long = after-hours-info.wav; exit = hangup. No options required.'
                    : `greet_long = after-hours-urgent-option.wav. Digit 9 → ring group ${urgentRg}. Digit 1 / timeout → ${p.after.kind === 'message' ? vmTarget(p, p.after.owner) : p.after.kind === 'information' ? 'playback after-hours-info.wav then hangup' : closedTarget}.`,
                `Weekend closed leaf can reuse this IVR (${weekendIvr} is only needed if weekend wording differs).`
            ]
        });

    if (p.urgent.enabled && q.urgentKind === 'connect' && hasTeam(p, p.urgent.team))
        list.push({
            kind: 'ring_group',
            extension: urgentRg,
            name: `Ring group ${urgentRg} · on-call`,
            setup: [
                `Members: ${teamLabel(p, p.urgent.team)} outside devices + Follow Me. Group and member timeout ${p.urgent.seconds}s — do not copy this timeout onto daytime ring groups.`,
                `timeout_data: ${q.urgentBackup === 'team' ? 'backup on-call ring group, then ' : ''}${q.urgentBackup === 'instructions' ? 'playback urgent-instructions.wav' : vmTarget(p, p.urgent.owner)}.`,
                q.urgentRoster === 'rotation' ? 'Update this group or the on-call extension’s Follow Me when the roster changes. Fusion will not rotate it.' : 'Fixed contact: keep membership stable.'
            ]
        });

    if (p.first.kind === 'assistant' || p.busy.kind === 'assistant' || q.queueExit === 'assistant' || p.after.kind === 'assistant')
        list.push({
            kind: 'ai_bridge',
            extension: aiExt,
            name: `Voice Receptionist bridge ${aiExt}`,
            setup: [
                `Small per-DID extension ${aiExt} (NE live: 6100 Newburgh / 6101 Wappingers). Not an IVR. Dialplan bridges sofia/external/<OPENAI_PROJECT>@sip.api.openai.com;transport=tls with sip_h_X-Upstate-DID and optional language menu.`,
                'mod_curl POST https://app.upstateipvoice.com/webhooks/fusionpbx/voice-ai-bridge with fsCallUuid so uuid_transfer can come back to Fusion.',
                p.after.kind === 'assistant' ? `Point Time Condition group 999 (and weekend closed groups) at ${aiExt}. Leave the open-hours target on the daytime IVR/RG.` : `This plan uses the bridge for ${[p.first.kind === 'assistant' && 'first answer', (p.busy.kind === 'assistant' || q.queueExit === 'assistant') && 'busy overflow'].filter(Boolean).join(', ') || 'overflow'}.`,
                'Confirm voice_receptionist entitlement, location DID, permitted tasks, and human fallback before enabling. Appointment requests stay requests.'
            ]
        });

    if (p.mode === 'opening' && q.beforeOpening === 'information')
        list.push({
            kind: 'recording',
            extension: '9300',
            name: 'Before-opening announcement',
            setup: ['Temporary Destination: playback before-opening.wav then hangup (or IVR 9300 with no options). On opening day, destination_data becomes the Time Condition.']
        });

    return list;
}

function numbering(p: Plan, locIndex: number) {
    const n = slot(locIndex);
    return [
        `SIP domain (one per tenant, not per location): ${DOMAIN}. Extensions may repeat on other tenants; push routing must include domain_uuid.`,
        `User / device extensions: start at ${p.policy.extensionBase}, step 10 per answering group. Shared identity = one SIP user with multiple registrations. Separate positions = sequential +1 identities, each a ring-group member.`,
        `Time Conditions: ${n.tc} (Upstate convention 8xxx, next free TC is max(existing >= 8000)+1).`,
        `Ring groups: ${n.mainRg} daytime, ${n.urgentRg} on-call (7xxx).`,
        `IVRs: ${n.openIvr} open, ${n.closedIvr} closed${p.languages.some(l => l.mechanism === 'menu') ? ', ' + n.langIvr + ' language' : ''}${p.locations.length > 1 && p.policy.locationEntry === 'menu' ? ', ' + n.locIvr + ' location menu' : ''} (9xxx).`,
        `Call Center queues: ${p.busy.kind === 'queue' ? overflowTeams(p).map((team, i) => n.queueAt(i) + ' ' + teamLabel(p, team)).join(', ') : 'none — this plan did not choose a wait'} (5xxx).`,
        `Voice Receptionist bridges: ${n.ai} (61xx). PCSR lab doors 6001 / 6008 stay off this tenant unless you are testing.`,
        `Voicemail: *99<extension> in the same domain. Transfer data is always "<ext> XML ${DOMAIN}".`,
        'After any GUI or portal write: reloadxml. Confirm with a test DID call, not just the planner simulator.'
    ];
}

function checklist(p: Plan, locIndex = 0) {
    const recs = recordings(p, locIndex);
    const qa = queueAgents(p);
    const blocked = [
        ...(qa.needed && !qa.members.length ? ['Do not enable the Call Center: queue agents are unresolved.'] : []),
        ...(p.mode === 'opening' && p.policy.beforeOpening === 'undecided' ? ['Do not publish the DID: before-opening destination is undecided.'] : []),
        ...combinationWarnings(p)
    ];
    return [
        ...blocked.map(x => 'BLOCKED: ' + x),
        `Create or confirm Fusion domain ${DOMAIN} and portal tenant_fusion_domains row.`,
        p.mode === 'opening' && p.policy.beforeOpening === 'undecided'
            ? 'Do not add a public Destination until the before-opening policy is approved. After-opening Time Condition is a separate object.'
            : p.mode === 'opening'
                ? 'Before opening: Destination uses the approved announcement or callback. After opening: flip Destinations to Time Condition ' + slot(locIndex).tc + '. Two configurations, one cutover.'
                : 'Add Destinations for each published DID and point them at the Time Condition (or location IVR).',
        'Provision every extension in the directory; register one desk phone, one computer (WSS), and one mobile as applicable.',
        'Create ring groups and (if chosen) the Call Center queue. Set timeout_app on every group — never leave timeout empty.',
        recs.length ? `Record and upload WAVs in Apps → Recordings (${recs.map(r => r.filename).join(', ')}). Assign greet_long / voicemail greeting_1.wav. Listen to each file on a handset.` : 'No new recordings required beyond stock voicemail.',
        p.first.kind === 'menu' || p.policy.locationEntry === 'menu' ? 'Build IVR menus, digits, retries, and exit. Test invalid, no-input, and every digit.' : 'No reason/location IVR on this plan.',
        'Build Time Condition groups for open windows, breaks, weekends, holidays, and group 999. Set domain timezone to ' + p.hours.timezone + '.',
        p.after.kind === 'assistant' || p.first.kind === 'assistant' || p.busy.kind === 'assistant' ? 'Enable the Voice Receptionist bridge per DID; verify language menu, tools, and human fallback. Keep daytime routing unless first-answer is AI.' : 'No AI bridge on this plan.',
        p.policy.placements.some(x => x.team === 'reception' && x.sharing === 'separate') && p.teams.some(t => t.role === 'reception' && t.count > 1)
            ? 'Reserve independent reception identities so both can pick up. Do not share one SIP user. Device models are not chosen.'
            : 'Provision every answering identity from the directory — do not invent extras from room or staff count.',
        /work mobile answering|work app \/ follow me/i.test((p.policy.notes || '') + ' ' + (p.policy.continuity.notes || ''))
            ? 'Enable Follow Me / the Upstate app on the owner extension. Do not store or record a personal cell number.'
            : 'No work-mobile Follow Me on this plan unless the owner adds it.',
        p.urgent.enabled && p.policy.urgentKind === 'connect' ? 'Build the on-call ring group / Follow Me; complete a recorded acceptance test. Keep personal numbers out of recordings.' : 'No live on-call connect to build.',
        'Voicemail: greetings, email/portal notification (' + p.policy.notification + '), transcription path via pbx-push-bridge.',
        'Walk every planner scenario on the real DID: open answered, busy, closed, holiday, language miss, invalid menu, on-call miss.',
        'reloadxml after the last change. Review this plan with Upstate — opening the scheduling page does not install anything.'
    ];
}

export function parityReport(p: Plan, locIndex = 0) {
    const issues: string[] = [];
    const recs = recordings(p, locIndex);
    const objs = objects(p, locIndex);
    const digits = menuDigits(p);
    if (p.first.kind === 'menu') {
        for (const rec of recs.filter(r => /^ivr-open/.test(r.filename))) {
            for (const d of digits) {
                if (!new RegExp('press ' + d.digit, 'i').test(rec.script) && !new RegExp('oprima ' + d.digit, 'i').test(rec.script))
                    issues.push(rec.filename + ' missing menu digit ' + d.digit);
            }
        }
        const ivr = objs.find(o => o.kind === 'ivr' && o.extension === slot(locIndex).openIvr);
        for (const d of digits) {
            if (ivr && !ivr.setup.some(s => s.includes('Digit ' + d.digit)))
                issues.push('Open IVR missing digit ' + d.digit);
        }
    }
    if (p.busy.kind === 'queue') {
        const n = slot(locIndex);
        const unanswered = scenarios(p).find(s => s.id === 'unanswered');
        if (unanswered && !simulate(p, unanswered).trace.some(node => node.id.startsWith('queue-')))
            issues.push('Simulated unanswered path never enters a queue node');
        for (const team of overflowTeams(p)) {
            const ext = queueExtFor(p, team, n);
            const rgExt = daytimeGroup(p, team, n);
            const rg = objs.find(o => o.kind === 'ring_group' && o.extension === rgExt);
            const timeout = rg?.setup.find(s => /timeout_data/.test(s)) || '';
            if (ext && !timeout.includes(ext))
                issues.push('Ring group ' + rgExt + ' (' + teamLabel(p, team) + ') timeout does not target queue ' + ext);
            if (/\*99/.test(timeout))
                issues.push('Ring group ' + rgExt + ' timeout_data still voicemail while this plan uses a wait queue');
        }
        const plan = queuePlan(p);
        for (const queue of plan.queues) {
            const others = plan.queues.filter(x => x.team !== queue.team).flatMap(x => x.members.map(m => m.extension));
            if (queue.members.some(m => others.includes(m.extension)))
                issues.push('Queue for ' + queue.label + ' mixes another team’s identities');
        }
        for (const r of p.reasons) {
            const team = r.team === '@main' ? p.first.team : r.team;
            if (!team || !unanswered)
                continue;
            const trace = simulate(p, { ...unanswered, reason: r.id }).trace.map(node => node.id);
            if (!trace.includes('queue-' + team))
                issues.push('Simulated ' + r.label + ' unanswered path does not enter queue-' + team);
        }
    }
    if (p.mode === 'opening' && p.policy.beforeOpening === 'undecided') {
        const note = fusionScenarioNote(p, 'before-opening', locIndex);
        if (!/BLOCKED/.test(note))
            issues.push('Before-opening scenario is unresolved but not blocked');
        if (/still on the before-opening announcement/i.test(note) || /DID remaining on/i.test(note))
            issues.push('Before-opening note invents an unapproved destination');
        const dest = objs.find(o => o.kind === 'destination' && /before opening/i.test(o.name));
        if (dest && !dest.setup.some(s => /BLOCKED/.test(s)))
            issues.push('Before-opening Destination object is not blocked');
    }
    return issues;
}

export function fusionBuild(p: Plan, locIndex = 0): FusionBuild {
    const blockers = combinationWarnings(p);
    return {
        domain: DOMAIN,
        objects: objects(p, locIndex),
        recordings: recordings(p, locIndex),
        analysis: [
            ...modeAdvice(p, locIndex),
            ...locationAdvice(p, locIndex),
            ...firstAdvice(p),
            ...identityAdvice(p),
            ...busyAdvice(p),
            ...afterAdvice(p),
            ...languageIvrAdvice(p),
            ...urgentAdvice(p),
            ...blockers
        ].filter(Boolean),
        specialty: specialtyNotes(p),
        numbering: numbering(p, locIndex),
        checklist: checklist(p, locIndex),
        blockers,
        parity: parityReport(p, locIndex)
    };
}

export function fusionSections(p: Plan, locIndex = 0): [string, string[]][] {
    const b = fusionBuild(p, locIndex);
    const objLines = b.objects.map(o => {
        const ext = o.extension ? ` · ext ${o.extension}` : '';
        return `${o.name}${ext}. ${o.setup.join(' ')}`;
    });
    const recLines = b.recordings.length
        ? b.recordings.map(r => `${r.name} (${r.filename}) — used by ${r.usedBy}. Record: “${r.script}”`)
        : ['No practice recordings to approve beyond a standard voicemail greeting.'];
    return [
        ['FusionPBX build (how we actually set this up)', [
            `This is the Upstate FusionPBX map for this plan — Destinations, Time Conditions (order 300, group 999 after hours), IVR menus, ring groups, recordings, voicemail *99ext, Follow Me, and the Voice Receptionist SIP bridge. Transfer data is always "<extension> XML ${DOMAIN}". Nothing here is provisioned until an engineer applies it.`,
            ...b.analysis
        ]],
        ['Fusion numbering & objects', [...b.numbering, ...objLines]],
        ['Recordings & announcements to approve', recLines],
        ['Specialty notes for this practice', b.specialty],
        ['Fusion implementation checklist', b.checklist],
        ...(b.parity.length ? [['Parity failures — do not provision', b.parity]] as [string, string[]][] : [])
    ];
}

export function fusionScenarioNote(p: Plan, scenarioId: string, locIndex = 0) {
    const n = slot(locIndex);
    const openObj = p.first.kind === 'human' ? `RG ${n.mainRg}` : p.first.kind === 'menu' ? `IVR ${n.openIvr}` : p.first.kind === 'assistant' ? `AI bridge ${n.ai}` : 'undecided open target';
    if (scenarioId === 'normal')
        return `Fusion: DID → TC ${n.tc} open group → ${openObj}.`;
    if (scenarioId === 'busy' || scenarioId === 'unanswered') {
        const team = p.first.kind === 'human' ? p.first.team : (p.reasons[0]?.team === '@main' ? p.first.team : p.reasons[0]?.team);
        const qExt = team ? queueExtFor(p, team, n) : '';
        const wait = p.busy.kind === 'queue' && qExt ? 'Call Center ' + qExt + ' (' + teamLabel(p, team) + ' only)' : p.busy.kind === 'queue' ? 'Call Center (unassigned team)' : p.busy.kind === 'backup' ? 'backup RG' : p.busy.kind === 'assistant' ? 'AI ' + n.ai : '*99 voicemail';
        return p.first.kind === 'menu'
            ? `Fusion: DID → TC ${n.tc} open → IVR ${n.openIvr} → reason RG ${team ? daytimeGroup(p, team, n) : '?'} timeout ${p.busy.seconds}s → ${wait}.`
            : `Fusion: DID → TC ${n.tc} open → ${openObj} timeout ${p.busy.seconds}s → ${wait}.`;
    }
    if (scenarioId === 'closed' || scenarioId === 'holiday')
        return `Fusion: DID → TC ${n.tc} group 999 (or date-only holiday group) → ${p.after.kind === 'assistant' ? 'AI ' + n.ai : p.after.kind === 'information' || (p.urgent.enabled && p.policy.urgentKind === 'connect') ? 'closed IVR ' + n.closedIvr : p.after.kind === 'message' ? '*99 after-hours box' : p.after.kind === 'service' ? 'answering-service bridge' : 'undecided'}.`;
    if (scenarioId.startsWith('language'))
        return p.first.kind === 'menu' ? `Fusion: language IVR ${n.langIvr} then reason IVR or fallback voicemail.` : p.first.kind === 'assistant' ? 'Fusion: AI language keypad (1 English / 2 Spanish) then tools.' : 'Fusion: no language IVR; staff asks after answer.';
    if (scenarioId === 'open-urgent')
        return p.policy.urgentKind === 'connect' ? `Fusion: open-hours IVR digit 9 → on-call RG ${n.urgentRg}. A keypad cannot classify spoken urgency.` : 'Fusion: urgent recording or priority voicemail — no live connect.';
    if (scenarioId.startsWith('urgent'))
        return p.policy.urgentKind === 'connect' ? `Fusion: closed IVR digit 9 or AI escalate → on-call RG ${n.urgentRg} → backup/voicemail.` : 'Fusion: urgent recording or priority voicemail — no live connect.';
    if (scenarioId === 'invalid' || scenarioId === 'no-input')
        return `Fusion: IVR max_timeouts/max_failures = ${p.policy.menuRetries}, then exit transfer.`;
    if (scenarioId.startsWith('assistant'))
        return `Fusion: Voice Receptionist bridge ${n.ai}; failure → unfinished-request voicemail.`;
    if (scenarioId === 'before-opening') {
        if (p.policy.beforeOpening === 'undecided')
            return `BLOCKED: before-opening destination is unresolved. Do not publish the DID. Do not point Destinations at an announcement or callback that has not been approved. After-opening routing (TC ${n.tc}) is a separate configuration.`;
        if (p.policy.beforeOpening === 'information')
            return `Fusion: Destination plays before-opening.wav then hangup — not TC ${n.tc}. Flip Destinations to the live TC on opening morning.`;
        return `Fusion: Destination transfers to the approved before-opening callback box, not TC ${n.tc}. Flip Destinations to the live TC on opening morning.`;
    }
    if (scenarioId === 'closed-service-failed')
        return 'Fusion: answering-service bridge timeout → after-hours voicemail owner.';
    return '';
}
