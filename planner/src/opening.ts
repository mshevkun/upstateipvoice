import type { Plan } from './config';
import { formatOpening } from './flow';
import { inventory } from './policy';
import { mayHandlePhi } from './readiness';
import { provisioningMap } from './provisioning';

export type Check = { id: string; label: string; done: boolean; note: string };

export function openingChecklist(p: Plan): Check[] {
    const q = p.policy;
    const inv = inventory(p);
    const devices = !inv.undecided && inv.desk + inv.computer + inv.mobile > 0;
    return [
        { id: 'devices', label: 'Phone and device inventory', done: devices, note: devices ? 'Counts recorded. Sharing (shared identity vs separate extensions) must still be explicit.' : 'Assign answering positions.' },
        { id: 'staff', label: 'Staff answering groups', done: p.teams.some(t => t.count > 0), note: 'People are not phones.' },
        { id: 'internet', label: 'Internet and network assessment', done: q.opening.internet === 'known', note: q.opening.internet === 'survey' ? 'Site survey requested.' : q.opening.internet === 'unknown' ? 'Unknown — do not treat as ready.' : q.opening.internet === 'known' ? 'Owner reports internet is known. This is not a measured circuit test.' : 'Not answered.' },
        { id: 'network', label: 'LAN / Wi-Fi / PoE for phones', done: q.opening.network === 'known', note: q.opening.network === 'survey' ? 'Needs a site survey.' : 'Cabling and power are a contractor item.' },
        { id: 'numbers', label: 'Number and porting requirements', done: q.opening.numbers !== 'undecided', note: q.opening.numbers === 'porting' ? 'Porting is requested. Lead time is a carrier dependency.' : q.opening.numbers === 'new' ? 'New numbers.' : 'Undecided.' },
        { id: 'after', label: 'After-hours policy', done: p.after.kind !== 'undecided', note: 'Closed-hours handling is a policy choice, not an installed service.' },
        { id: 'e911', label: 'Emergency location and callback procedure', done: q.e911Confirmed, note: 'Confirm the registered emergency-calling address with the installer. Checking this box does not verify E911.' },
        { id: 'urgent', label: 'Urgent / on-call procedure', done: p.confirmed.includes('urgent'), note: p.urgent.enabled && p.policy.urgentKind === 'connect' && !q.handoffTested ? 'Intended on-call path is recorded; a live handoff test is still required.' : 'Recorded in the planner.' },
        { id: 'handoff', label: 'Real-call acceptance test', done: q.handoffTested, note: 'Must be performed on installed phones. This checkbox is a planning reminder, not a test certificate.' }
    ];
}

export function openingTimeline(p: Plan) {
    const date = p.policy.opening.date;
    const stage = p.policy.opening.construction;
    const lines = [
        formatOpening(p) ? 'Target opening: ' + formatOpening(p) + (p.policy.opening.precision === 'month' ? ' (month only).' : '.') + ' The planner does not infer that the practice is already open.' : 'Opening date not set.',
        'Construction stage: ' + (stage === 'undecided' ? 'not specified' : stage) + '.',
        'Before opening day, inbound calls follow the before-opening announcement or callback you chose — not the future live open-hours routing.'
    ];
    if (stage === 'planning' || stage === 'build-out')
        lines.push('While the space is under construction, freeze device counts only as planning figures. Cabling, PoE and network paths belong on the contractor handoff.');
    if (stage === 'near')
        lines.push('Near opening: confirm porting windows, internet, E911 address, and a real test call before the first patient day.');
    return lines;
}

export function contractorHandoff(p: Plan) {
    const inv = inventory(p);
    const map = provisioningMap(p);
    const rooms = p.policy.roomsSpecified ? p.policy.rooms : 0;
    const lines = [
        'Hand this section to an IT installer or construction contractor. It is a planning brief, not a completed job.',
        `Wired desk phones in this plan: ${inv.desk}. Each wired set needs a network drop and power (PoE or local). Shared identity vs separate extension is listed in the implementation spec.`,
        `Computer answering positions: ${inv.computer}. Confirm workstation network and headset path.`,
        `Work-mobile endpoints: ${inv.mobile}. Do not print personal cell numbers on wall cards or recordings.`,
        rooms ? `Clinical rooms specified: ${rooms}. Treat room phone placement as illustrative until a floor plan or site survey exists.` : 'No clinical room count specified. Do not pull room cabling from staff headcount.',
        `SIP identities after sharing choices: ${map.identities.map(i => i.extension).join(', ') || 'none yet'}.`,
        'Internet: ' + p.policy.opening.internet + '. Network: ' + p.policy.opening.network + '. Resilient internet (failover / cellular backup) is listed under business continuity — it is not assumed.',
        'Numbers: ' + p.policy.opening.numbers + '. Messaging / SMS is out of scope until the owner selects follow-up channels.',
        'Emergency calling: verify the registered callback address (E911) for this location before go-live. Owner confirmation in this planner is not a carrier filing.',
        p.policy.continuity.internet === 'failover' || p.policy.continuity.backupRouting === 'cellular'
            ? 'Owner requested backup connectivity. Confirm the actual failover path on site; the planner does not provision it.'
            : 'Backup routing is not established in this plan unless the continuity questions were answered.'
    ];
    if (mayHandlePhi(p))
        lines.push('This configuration may handle patient information (voicemail, answering service, virtual receptionist or follow-up tools). Covered entities should confirm access controls, retention, vendor responsibilities and whether a business associate agreement is required. This planner is not legal advice. HHS treats service providers handling PHI on a covered entity’s behalf as potential business associates.');
    return lines;
}
