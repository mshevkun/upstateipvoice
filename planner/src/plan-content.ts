import { decisions, graph, journeySeconds, menuDigits, scenarios, simulate, teamName, type Plan, type Day } from './config';
import { identity, queueAgents } from './advisor';
import { directory, inventory, publicInstructions } from './policy';
import { fusionScenarioNote, fusionSections } from './fusion';
import { locationPlan } from './locations';
import { mappingPreview, provisioningMap } from './provisioning';
import { claims, statusLabel, terminals, unapprovedTerminals } from './status';
import { handoffBlock, readiness } from './readiness';
import { afterHoursComparison, billOfMaterials, sampleAssistantTurns, scopeAgainstQuote } from './bom';
import { contractorHandoff, openingChecklist, openingTimeline } from './opening';
type Section = [
    string,
    string[]
];
const schedule = (days: Day[]) => days.map(d => d.day + ': ' + (d.open ? d.start + '–' + d.end + (d.breakStart ? ' (break ' + d.breakStart + '–' + d.breakEnd + ')' : '') : 'Closed')).join('; ');
const unanswered = { id: 'unanswered', label: 'Open · nobody answers', open: true, answered: false as const };

function journeyLine(p: Plan) {
    const j = journeySeconds(p, unanswered);
    if (!j.total)
        return 'Configured wait is the ringing timeout of ' + p.busy.seconds + 's, then the busy path.';
    const parts = j.parts.map(x => x.seconds + 's ' + x.label).join(' + ');
    return `If nobody answers, a caller can wait ${j.total} seconds (${parts}) before ${j.terminal}. ${j.note}`;
}

function ownerLocal(p: Plan): Section[] {
    const q = p.policy, inv = inventory(p), team = (id: string) => teamName(p, id);
    const map = provisioningMap(p);
    const assistantRoles = [p.first.kind === 'assistant' ? 'first answer' : '', p.busy.kind === 'assistant' ? 'busy overflow' : '', p.busy.kind === 'queue' && q.queueExit === 'assistant' ? 'queue exit' : '', p.after.kind === 'assistant' ? 'after hours' : ''].filter(Boolean);
    const ready = readiness(p);
    const bom = billOfMaterials(p);
    const roomsLine = q.roomsSpecified
        ? `${q.rooms} clinical rooms specified. The office illustration is representative, not an architectural drawing. Phone placement still needs a floor plan or site survey.`
        : 'No clinical room count specified. Staff count does not set room phones. Treat the illustration as representative and identify quantities that need a floor plan or site survey.';
    return [
        ['Team & answering positions', [...p.teams.map(t => `${t.name}: ${t.status==='deferred'?'Decide later':t.status==='unanswered'?'Not answered':t.count+' people'} (${t.role}).`), `Desk phones: ${inv.desk}; computers: ${inv.computer}; mobile: ${inv.mobile}.`, 'People, physical phones, SIP identities and concurrent answering capacity are separate decisions.', ...mappingPreview(p), inv.undecided ? 'Some endpoint or sharing assignments remain undecided.' : 'Sharing choices are recorded below.']],
        ['Device and identity mapping', map.groups.length ? map.groups.map(g => `${g.label}: ${g.deviceCount} ${g.device} → ${g.extensions.join(', ') || 'unassigned'} (${g.sharing}). Concurrent answers: ${g.concurrent}. ${g.note}`) : ['No identities yet. Rooms and people do not automatically receive extensions.']],
        ['Office layout (illustrative)', [...p.teams.map(t => `${t.name} (${t.role}) — ${t.status==='deferred'?'Decide later':t.status==='unanswered'?'Not answered':t.count+' people'}. Endpoints: ${q.placements.filter(x => x.team === t.id).map(x => x.device === 'none' ? 'no direct calls' : x.count + ' ' + x.device + ' (' + x.sharing + ', ' + x.access + ')').join('; ') || 'undecided'}.`), ...q.placements.filter(x => !x.team).map(x => `${x.label}: ${x.count} ${x.device}, ${x.sharing}, ${x.access}.`), roomsLine]],
        ['Phone hours & timezone', ['Timezone: ' + p.hours.timezone, schedule(p.hours.days), 'Holiday policy: ' + p.hours.holidayPolicy + '. Dates: ' + (p.hours.holidays.join(', ') || 'None listed'), 'Temporary closures: ' + (q.closures.join(', ') || 'None listed'), 'Exceptions confirmed: ' + (q.hoursExceptionsConfirmed ? 'Yes' : 'Not yet'), ...Object.entries(q.teamAvailability).map(([id, days]) => team(id) + ' availability (' + p.hours.timezone + '): ' + schedule(days))]],
        ['How calls move', ['First answer: ' + p.first.kind + (p.first.kind === 'human' ? ' → ' + team(p.first.team) : ''), ...(p.first.kind === 'human' ? ['Ringing strategy: ' + q.ring + (q.ring === 'order' ? '. Order: ' + q.ringOrder.map(r => team(r.team) + ' ' + r.seconds + 's').join(' → ') : '')] : []), ...(p.first.kind === 'menu' ? menuDigits(p).map(d => 'Menu ' + d.digit + ': ' + d.label + ' → ' + (team(d.team) || d.label) + '.') : p.reasons.map(r => r.label + ' → ' + (r.team === '@main' ? 'The answering team' : team(r.team)) + '.')), ...(p.first.kind === 'menu'||q.locationEntry==='menu' ? [`Invalid input: ${p.menu.invalid}; no input: ${p.menu.noInput}; retries: ${q.menuRetries}; fallback team: ${team(p.menu.team)}.`] : []), `Ringing timeout: ${p.busy.seconds}s. Busy fallback: ${p.busy.kind}. Message owner: ${team(p.busy.owner)}.`, ...(p.busy.kind === 'queue' ? [`Queue wait (after ringing): ${p.busy.wait}s. Queue exit: ${q.queueExit}${q.queueExit === 'backup' ? ' → ' + team(p.busy.backup) : ''}. ` + queueAgents(p).note] : []), journeyLine(p), ...Object.entries(q.teamFallbacks).map(([id, f]) => `${team(id)} unanswered exception: ${f.kind === 'backup' ? 'try ' + team(f.team) + ', then ' : ''}message owner ${team(f.owner)}.`), ...terminals(p).map(t => `${t.label}: owner ${team(t.owner)}${q.terminalApprovals[t.id] ? ' (owner confirmed)' : unapprovedTerminals(p).some(u => u.id === t.id) ? ' — CONFIRM this destination' : ''}.`)]],
        ['Language coverage', p.languages.length ? p.languages.map(l => { const f = q.languageFallbacks[l.name]; const st = claims(p).find(c => c.id === 'language-' + l.name); return `${l.name}: ${l.mechanism} identification; provider ${q.languageProviders[l.name] || 'team'}${(q.languageProviders[l.name] || 'team') === 'team' ? ' → ' + team(l.team) : ' (coverage requires confirmation)'}. Availability: ${l.availability}${l.availability === 'limited' ? ' (' + p.hours.timezone + '): ' + schedule(q.languageSchedules[l.name] || []) : ''}${l.note ? ' / ' + l.note : ''}. Unavailable → ${f?.kind || 'callback'}${f?.kind === 'team' ? ' to ' + team(f.team) : f?.kind === 'instructions' ? ': ' + (f.approved ? 'Approved: ' : 'NOT APPROVED: ') + publicInstructions(f.text) : ''}. Callback owner: ${team(l.fallback)}. Status: ${st ? statusLabel(st.status) : 'unresolved'}.`; }) : [q.languageDecision === 'none' ? 'No additional language option selected.' : 'Additional language coverage undecided.']],
        ['Closed & urgent calls', [`After hours: ${p.after.kind}.${p.after.kind !== 'information' ? ' Message owner: ' + team(p.after.owner) + '.' : ''}`, publicInstructions(p.after.instructions) || 'No closed-hours wording or service limits supplied.', ...afterHoursComparison().map(row => `${row.title}: ${row.covers} Gap: ${row.gaps} ${row.cost}`), ...(p.urgent.enabled ? [`Urgent workflow: ${q.urgentKind}.`, ...(q.urgentKind === 'connect' ? [`Coverage: ${q.urgentCoverage}${q.urgentCoverage === 'selected' ? ' (' + p.hours.timezone + '): ' + schedule(q.urgentDays) : ''}. Assignment: ${q.urgentRoster}.`, `Ring ${team(p.urgent.team)} for ${p.urgent.seconds}s; fallback ${q.urgentBackup}${q.urgentBackup === 'team' ? ' → ' + team(p.urgent.backup) : ''}. Acceptance required: ${q.acceptance ? 'Yes' : 'Not confirmed'}.`, 'Verified on-call route: ' + (q.onCallRouteVerified ? 'Owner says a route exists (number not stored).' : 'Not yet. This plan describes the intended arrangement only.'), 'Handoff test: ' + (q.handoffTested ? 'Recorded as done — still not an installation certificate.' : 'Not recorded. Simulated acceptance is not a real test.')] : []), ...(q.urgentKind === 'priority' ? ['Priority-message alert: ' + q.urgentAlert + ' (delivery mechanism must be verified).'] : []), ...(q.urgentKind === 'instructions' || q.urgentBackup === 'instructions' ? [(p.urgent.approved ? 'Approved wording: ' : 'NOT APPROVED: ') + publicInstructions(p.urgent.instructions || 'No wording supplied.')] : []), `Unanswered priority-message owner: ${team(p.urgent.owner)}.`] : ['No urgent/on-call path selected.']), 'A priority message does not mean successful clinician contact. No guaranteed emergency handling. Private clinician numbers are not collected or included.']],
        ['Virtual receptionist scope', assistantRoles.length ? ['Status: ' + statusLabel('proposed'), 'Selected role(s): ' + assistantRoles.join(', '), 'Permitted tasks: ' + (q.assistant.tasks.join(', ') || 'Undecided'), 'Human access: ' + q.assistant.humanWhen + (q.assistant.humanWhen === 'selected' ? ' (' + (q.assistant.handoffTasks || []).join(', ') + ')' : '') + ' → ' + team(q.assistant.team), 'Unfinished requests: ' + team(q.assistant.owner), 'Sample conversation:', ...sampleAssistantTurns(p), 'Unsupported requests go to the human fallback when “unfinished” is selected; otherwise they become an owned unfinished request.', 'Proposed, needs technical verification. No direct booking, language recognition or integration is verified.'] : ['No virtual receptionist selected.']],
        ['Messages & follow-up', ['Message notification requirement: ' + q.notification + '. Delivery is not implemented by this planner.', `Follow-up scope: ${q.followup}.`, ...(q.followup === 'yes' ? [`Default task owner: ${team(p.followup.owner)}. Response target: ${p.followup.target || 'Unresolved'}.`, ...Object.entries(q.followupOwners).map(([label, id]) => label + ': ' + (id ? team(id) : team(p.followup.owner) + ' (default)')), 'Optional channels: ' + (p.followup.channels.join(', ') || 'None') + '. Availability and consent must be verified.', 'Scheduling/practice system: ' + (q.system || q.opening.pms || 'Not configured') + '. Integration: proposed, needs confirmation.'] : ['Additional follow-up tools are not selected. Previously entered optional channels or system details are excluded.'])]],
        ['What happens on a call', scenarios(p).map(s => { const r = simulate(p, s); const j = journeySeconds(p, s); const wait = j.total ? ` Wait ${j.total}s (${j.parts.map(x => x.seconds + 's').join('+')}).` : ''; return s.label + ': ' + r.trace.map(n => n.label).join(' → ') + '.' + wait + ' ' + r.trace.at(-1)?.detail; })],
        ...(p.mode === 'opening' ? [['Opening-day readiness', [...openingTimeline(p), 'Example planning checklist only. Checking an item here does not verify a real installation or compliance.', ...openingChecklist(p).map(c => `${c.done ? '[x]' : '[ ]'} ${c.label}. ${c.note}`), q.beforeOpening === 'information' ? 'Before opening: ' + publicInstructions(q.beforeOpeningText || 'Not supplied') : q.beforeOpening === 'message' ? 'Before-opening callback owner: ' + team(q.beforeOpeningOwner || '') : 'Before-opening behavior undecided.']], ['Contractor handoff', contractorHandoff(p)]] as Section[] : []),
        ['Equipment and cost scenarios', ['Recommended package to discuss: ' + (q.bomTier === 'undecided' ? 'not chosen — compare all three' : q.bomTier) + '.', 'Essential — lean desk and computer phones, routing, voicemail, basic after-hours.', ...bom.essential.map(r => `${r.item}: ${r.qty}. ${r.purpose}${r.quote ? ' Quote required.' : ''}`), 'Balanced — more answering positions, messaging, overflow, stronger fallbacks.', ...bom.balanced.map(r => `${r.item}: ${r.qty}. ${r.purpose}${r.quote ? ' Quote required.' : ''}`), 'Automation-ready — AI where appropriate, staff handoff, PMS integration requirements.', ...bom.automation.map(r => `${r.item}: ${r.qty}. ${r.purpose}${r.quote ? ' Quote required.' : ''}`), 'This plan’s recorded inventory:', ...bom.current.map(r => `${r.item}: ${r.qty}. ${r.purpose}`), ...bom.assumptions, ...bom.warnings, ...scopeAgainstQuote(p)]],
        ['Business continuity', ['Internet outage: ' + q.continuity.internet + '.', 'Power failure: ' + q.continuity.power + '.', 'Backup routing: ' + q.continuity.backupRouting + '.', q.continuity.notes || 'No extra continuity notes.', 'These are planning requirements, not provisioned failover objects.']],
        ['Decision status', claims(p).map(c => `${c.label} — ${statusLabel(c.status)}. ${c.detail}`)],
        ['Implementation readiness', [ready.label, ...ready.blockers.map(b => 'Blocker: ' + b), 'A completed questionnaire is not an installed phone system. The free planner never marks a setup ready merely because every field has an answer.']]
    ];
}

function engineerLocal(p: Plan, locIndex = 0): Section[] {
    return [
        ['Extension directory (implementation)', directory(p).length ? directory(p).map(d => `${d.label}: ${d.count} ${d.device} positions; ${d.access}; ${d.sharing}; group base ${d.extension}${d.suggested ? ' (suggested, not provisioned)' : ''}; identities ${d.identities}; concurrent ${d.concurrent}. ${d.device === 'desk' ? 'Fusion: SIP TLS :5081.' : d.device === 'computer' ? 'Fusion: WSS :7443 (portal SIP.js).' : d.device === 'mobile' ? 'Fusion: app registration + optional Follow Me.' : ''} Voicemail *99${d.extension}.`) : ['No extension assignments confirmed.']],
        ...fusionSections(p, locIndex),
        ['Scenario notes for the installer', scenarios(p).map(s => { const fusion = fusionScenarioNote(p, s.id, locIndex); return s.label + ': ' + (fusion || 'See owner walkthrough.'); })],
        ['Routing graph reference', Object.values(graph(p).nodes).map(n => `${n.id}: ${n.label}. ${n.detail}${n.seconds ? ' [' + n.seconds + 's]' : ''}${n.edges.length ? ' Next: ' + n.edges.map(e => e.when + ' → ' + e.to).join('; ') : ' [End]'}`)]
    ];
}

function header(p: Plan): Section {
    const active = p.locations.find(l => l.id === p.policy.activeLocation);
    const id = identity(p);
    return ['Practice & locations', [p.name || 'Unnamed practice', 'Plan ID: ' + id.planId + ' · Revision ' + id.revision + ' · checksum ' + id.checksum, 'Starting point: ' + (p.mode || 'Undecided'), 'Specialty: ' + (p.specialty || 'Undecided') + (p.specialty === 'Other healthcare practice' && p.specialtyDetail ? ' · ' + p.specialtyDetail : ''), ...p.locations.map((l, i) => `Location ${i + 1}: ${l.name}`), 'Active local plan: ' + (active?.name || 'Unresolved') + (p.locations.length > 1 ? '. Main-number entry: ' + p.policy.locationEntry + '. Number arrangement: ' + p.policy.number + '.' : '.'), 'Each local plan has separate staff, endpoints, phone hours/timezone, routing and on-call decisions.', 'This is a planning document, not an installed or confirmed phone configuration.']];
}

function localize(p: Plan, fn: (local: Plan, i: number) => Section[]) {
    const result: Section[] = [];
    for (const [i, l] of p.locations.entries()) {
        const local = l.id === p.policy.activeLocation ? { ...p, locations: [l], profiles: {} } : locationPlan(p, l.id);
        if (local)
            result.push(...fn(local, i).map(([title, lines]): Section => [p.locations.length > 1 ? l.name + ' · ' + title : title, lines]));
        else
            result.push([l.name + ' · Unconfigured local plan', ['Confirm local staff, devices, hours/timezone, routing and on-call coverage. No policy is silently inherited.']]);
    }
    return result;
}

export function ownerSections(p: Plan): Section[] {
    const ready = readiness(p);
    return [header(p), ...localize(p, ownerLocal), ['Open decisions', decisions(p).length ? decisions(p) : ['No unresolved planner fields. Implementation readiness is separate: ' + ready.label]], ['Handoff for your meeting', [handoffBlock(p), 'This block is for the conversation with Upstate. The plan is not automatically shared.']]];
}

export function engineerSections(p: Plan): Section[] {
    const id = identity(p);
    return [['Technical implementation specification', ['Optional Upstate FusionPBX reference. Matches owner plan ID ' + id.planId + ' revision ' + id.revision + ' checksum ' + id.checksum + '.', 'Provider-specific. The owner blueprint is the document to approve. Export fails if these three values diverge.']], ...localize(p, engineerLocal)];
}

export function sections(p: Plan): Section[] {
    return [...ownerSections(p), ...engineerSections(p)];
}
