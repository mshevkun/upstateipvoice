import { locationPlan } from './locations';
import { hasTeam, teamName, isOpen, type Plan, type Graph, type Node, type Scenario } from './config';
import { inSchedule, publicInstructions, canRing } from './policy';

/** How an urgent request can actually be detected. A keypad cannot hear speech. */
export function urgentMechanism(p: Plan): 'staff' | 'menu-digit' | 'assistant' | 'none' {
    if (!p.urgent.enabled || p.policy.urgentKind === 'none' || p.policy.urgentKind === 'undecided')
        return 'none';
    if (p.first.kind === 'human')
        return 'staff';
    if (p.first.kind === 'menu')
        return 'menu-digit';
    if (p.first.kind === 'assistant')
        return 'assistant';
    return 'none';
}

export type MenuDigit = {
    digit: string;
    label: string;
    team: string;
    kind: 'reason' | 'urgent';
};

/** IVR options derived from the same reason list and urgent mechanism the graph uses. */
export function menuDigits(p: Plan): MenuDigit[] {
    const digits: MenuDigit[] = p.reasons.map((r, i) => ({
        digit: String(i + 1),
        label: r.label,
        team: r.team === '@main' ? p.first.team : r.team,
        kind: 'reason'
    }));
    if (urgentMechanism(p) === 'menu-digit')
        digits.push({ digit: '9', label: 'an urgent practice matter', team: p.urgent.team, kind: 'urgent' });
    return digits;
}

/** Teams that overflow into a wait. Menu destinations stay separate unless they share a team. */
export function overflowTeams(p: Plan) {
    const ids: string[] = [];
    const add = (id: string) => { if (id && hasTeam(p, id) && !ids.includes(id)) ids.push(id); };
    if (p.first.kind === 'human')
        add(p.first.team);
    for (const r of p.reasons)
        add(r.team === '@main' ? p.first.team : r.team);
    return ids;
}

/** A finite DAG. All branches terminate in an accepted connection, owned request, approved information, or a visible unresolved decision. */
export function graph(p: Plan): Graph {
    const nodes: Record<string, Node> = {}, q = p.policy;
    const edge = (to: string, when = 'always') => ({ to, when });
    const add = (id: string, label: string, detail: string, kind: Node['kind'] = 'action', edges: Node['edges'] = [], seconds?: number) => { nodes[id] = { id, label, detail, kind, edges, ...(seconds ? { seconds } : {}) }; return id; };
    const unresolved = add('unresolved', 'Decision needed', 'This route is not confirmed. No implicit redirection to reception.', 'end');
    const message = (id: string, owner: string, label = 'Message') => add(id, hasTeam(p, owner) ? label + ' → ' + teamName(p, owner) : 'Unassigned ' + label.toLowerCase(), hasTeam(p, owner) ? 'Owner: ' + teamName(p, owner) + '. A request is not a booked appointment or a connected call.' : 'Assign an available owner before implementation.', 'end');
    const connect = (id: string, team: string, fail: string, condition = 'answered', seconds = p.busy.seconds, success?: string) => { if (!hasTeam(p, team)||(!id.startsWith('urgent-')&&!canRing(p,team)))
        return unresolved; const end = success || add(id + '-accepted', 'Connected to ' + teamName(p, team), 'The simulated recipient explicitly accepted the transfer. Acceptance detection needs implementation testing.', 'end'); return add(id, 'Ring ' + teamName(p, team), `Attempt for ${seconds} seconds. Ringing is not an accepted connection.`, 'decision', [edge(end, condition + ':' + team), edge(fail, 'otherwise')], seconds); };
    const msg = message('busy-message', p.busy.owner);
    const assistant = (id: string, fail: string, intent?: string) => {
        const owned = message(id + '-unfinished', q.assistant.owner, 'Unfinished request');
        const human = connect(id + '-human', q.assistant.team, owned);
        const edges: Node['edges'] = [edge(fail, 'assistantFailed'), edge(human, 'assistantHuman')];
        for (const task of q.assistant.tasks) {
            const target = task === 'Connect callers to a team' ? (intent || human) : task === 'General information' ? add(id + '-information', 'Proposed practice information', 'Service capability and practice-approved content need confirmation. No clinical advice or booking is provided.', 'end') : task === 'Appointment requests' ? message(id + '-appointment', q.assistant.owner, 'Appointment request') : owned;
            edges.push(edge(target, 'task:' + task));
        }
        edges.push(edge(q.assistant.humanWhen === 'unfinished' ? human : owned, 'otherwise'));
        return add(id, 'Virtual receptionist service', `Optional service. Permitted tasks: ${q.assistant.tasks.join(', ') || 'None selected'}. Human access: ${q.assistant.humanWhen}${q.assistant.humanWhen === 'selected' ? ' (' + (q.assistant.handoffTasks || []).join(', ') + ')' : ''}. Capabilities remain requirements until verified. Unsupported requests use the stated fallback.`, 'decision', edges);
    };
    let fallback = msg;
    const queues: Record<string, string> = {};
    const queueFor = (team: string) => {
        if (!hasTeam(p, team))
            return unresolved;
        if (queues[team])
            return queues[team];
        const owner = q.teamFallbacks[team]?.owner || p.busy.owner;
        const owned = owner === p.busy.owner ? msg : message('queue-message-' + team, owner);
        const exit = q.queueExit === 'backup' ? connect('queue-backup-' + team, p.busy.backup, owned, 'backupAnswered') : q.queueExit === 'assistant' ? assistant('queue-assistant-' + team, owned) : q.queueExit === 'undecided' ? unresolved : owned;
        queues[team] = add('queue-' + team, 'Wait with ' + teamName(p, team), `Maximum wait ${p.busy.wait} seconds after the ringing timeout. Agents are only ${teamName(p, team)} — other menu destinations do not answer this wait. Exit: ${q.queueExit}.`, 'action', [edge(exit)], p.busy.wait);
        return queues[team];
    };
    if (p.busy.kind === 'queue')
        fallback = p.first.kind === 'human' && p.first.team ? queueFor(p.first.team) : msg;
    else if (p.busy.kind === 'backup')
        fallback = connect('busy-backup', p.busy.backup, msg, 'backupAnswered');
    else if (p.busy.kind === 'assistant')
        fallback = assistant('overflow-assistant', msg);
    else if (p.busy.kind === 'undecided')
        fallback = unresolved;
    const teamFallback = (team: string) => {
        const f = q.teamFallbacks[team];
        if (p.busy.kind === 'queue' && !f)
            return queueFor(team);
        if (!f)
            return fallback;
        const m = message('team-message-' + team, f.owner);
        return f.kind === 'backup' ? connect('team-backup-' + team, f.team, m, 'backupAnswered') : m;
    };
    const aftermsg = message('closed-message', p.after.owner);
    let after = unresolved;
    if (p.after.kind === 'information')
        after = p.after.instructions.trim() ? add('closed-info', 'Play approved practice information', publicInstructions(p.after.instructions), 'end') : unresolved;
    else if (p.after.kind === 'message')
        after = aftermsg;
    else if (p.after.kind === 'assistant')
        after = assistant('closed-assistant', aftermsg);
    let urgent = unresolved;
    const um = message('urgent-message', p.urgent.owner, 'Priority message');
    const approved = () => p.urgent.approved && p.urgent.instructions.trim() ? add('urgent-instructions', 'Practice-approved urgent instructions', publicInstructions(p.urgent.instructions), 'end') : unresolved;
    if (p.urgent.enabled) {
        if (q.urgentKind === 'priority')
            urgent = um;
        else if (q.urgentKind === 'instructions')
            urgent = approved();
        else if (q.urgentKind === 'connect') {
            let exit = q.urgentBackup === 'instructions' ? approved() : um;
            if (q.urgentBackup === 'team')
                exit = connect('urgent-backup', p.urgent.backup, um, 'backupAnswered', p.urgent.seconds);
            const primary = connect('urgent-primary', p.urgent.team, exit, 'onCallAnswered', p.urgent.seconds);
            urgent = add('urgent-coverage', 'Is on-call coverage available?', `Coverage: ${q.urgentCoverage}; assignment: ${q.urgentRoster}. A transfer must be accepted before a connection is reported.`, 'decision', [edge(q.acceptance && q.urgentRoster !== 'undecided' ? primary : unresolved, 'onCallAvailable'), edge(um, 'otherwise')]);
        }
    }
    const reasonEdges = p.reasons.map(r => { let target: string; const team = r.team === '@main' ? p.first.team : r.team; if (p.first.kind === 'human' && (r.team === '@main' || p.policy.ring !== 'order' && team === p.first.team) && hasTeam(p, team))
        target = add('reason-' + r.id + '-accepted', r.team === '@main' && p.policy.ring === 'order' ? 'Continue with the answering team' : 'Continue with ' + teamName(p, team), 'The answering team already has the call. No unnecessary transfer or second ring.', 'end');
    else
        target = connect('reason-' + r.id, team, teamFallback(team)); return edge(target, r.id); });
    const reason = add('reasons', p.first.kind === 'human' ? 'Staff identifies the caller’s need' : p.first.kind === 'menu' ? 'Caller selects a reason' : 'Assistant identifies the stated request', 'The synthetic caller supplies the selected reason only after the configured entry mechanism.', 'decision', [...reasonEdges, edge(unresolved, 'otherwise')]);
    const languageEdges: Node['edges'] = [];
    for (const [i, l] of p.languages.entries()) {
        const lm = message('language-message-' + i, l.fallback, l.name + ' callback request');
        const f = q.languageFallbacks[l.name];
        let fail = lm;
        if (f?.kind === 'team')
            fail = connect('language-alternate-' + i, f.team, lm);
        if (f?.kind === 'instructions')
            fail = f.approved && f.text.trim() ? add('language-info-' + i, 'Approved ' + l.name + ' instructions', publicInstructions(f.text), 'end') : unresolved;
        if (f?.kind === 'undecided')
            fail = unresolved;
        const provider = q.languageProviders[l.name] || 'team';
        const ring = provider === 'team' ? (p.first.kind==='human'&&q.ring!=='order'&&l.team===p.first.team?add('language-team-'+i+'-accepted','Continue with '+teamName(p,l.team)+' in '+l.name,'The answering team already has the call and is within the configured language coverage.','end'):connect('language-team-' + i, l.team, fail)) : provider === 'service' ? add('language-service-' + i, 'Proposed ' + l.name + ' service', 'Coverage is not verified. This preview falls back to the configured owned route until service capability is confirmed.', 'action', [edge(fail)]) : unresolved;
        const valid = l.mechanism === 'staff' && p.first.kind === 'human' || l.mechanism === 'menu' && p.first.kind === 'menu' || l.mechanism === 'assistant' && p.first.kind === 'assistant';
        const lg = add('language-' + i, l.name + ' coverage', l.mechanism === 'staff' ? 'Staff asks after answering.' : l.mechanism === 'menu' ? 'The synthetic caller explicitly selects this language.' : 'Configured language recognition is a requirement, pending service verification.', 'decision', valid ? [edge(ring, 'languageAvailable'), edge(fail, 'otherwise')] : [edge(unresolved)]);
        languageEdges.push(edge(lg, l.name));
    }
    const language = add('language', 'Language coverage', 'Language is selected or asked, never inferred from ringing. Availability uses the configured local schedule.', 'decision', [...languageEdges, edge(reason, 'otherwise')]);
    const mechanism = urgentMechanism(p);
    let intent = language;
    if (mechanism === 'staff')
        intent = add('intent', 'Staff identifies an urgent request', 'A person who already answered can classify urgency. A published number cannot.', 'decision', [edge(urgent, 'urgent'), edge(language, 'otherwise')]);
    else if (mechanism === 'assistant')
        intent = add('intent', 'Virtual receptionist classifies urgency', 'Proposed until a vendor verifies it on a live call. The simulator is not proof.', 'decision', [edge(urgent, 'urgent'), edge(language, 'otherwise')]);
    if (p.locations.length > 1 && q.locationEntry === 'shared' && p.first.kind !== 'human')
        intent = unresolved;
    else if (p.locations.length > 1 && q.locationEntry === 'shared')
        intent = add('shared-location', 'Staff asks which location is needed', 'This occurs only after the shared reception team answers. The selected location then uses its own saved phone hours, teams and routing. Unconfigured locations remain unresolved.', 'decision', [edge(intent, 'selectedLocation'), edge(unresolved, 'otherwise')]);
    const menuFail = (kind: 'invalid' | 'noInput') => { let end = p.menu[kind] === 'team' ? connect('menu-' + kind, p.menu.team, msg) : msg; for (let i = q.menuRetries; i > 0; i--)
        end = add(`menu-${kind}-retry-${i}`, 'Repeat menu prompt', `Retry ${q.menuRetries - i + 1} of ${q.menuRetries}. This test caller still provides ${kind === 'invalid' ? 'invalid input' : 'no input'}.`, 'action', [edge(end)], 5); return end; };
    let entry = unresolved;
    if (p.first.kind === 'human') {
        if (q.ring === 'order') {
            let next = fallback;
            for (let i = q.ringOrder.length - 1; i >= 0; i--) {
                const r = q.ringOrder[i];
                next = canRing(p,r.team,true)?connect('human-order-' + i, r.team, next, 'answered', r.seconds, intent):unresolved;
            }
            entry = q.ringOrder.length ? next : unresolved;
        }
        else
            entry = hasTeam(p, p.first.team) && q.placements.some(x=>x.team===p.first.team&&x.access==='outside'&&!['none','undecided'].includes(x.device)&&x.count>0) ? add('human-first', 'Ring ' + teamName(p, p.first.team), `Human first; ${q.ring === 'together' ? 'selected positions ring together' : 'ringing strategy undecided'}. Timeout ${p.busy.seconds} seconds. Language and intent are unknown until answer.`, 'decision', [edge(fallback, 'busy'), edge(intent, 'answered:' + p.first.team), edge(fallback, 'otherwise')], p.busy.seconds) : unresolved;
    }
    else if (p.first.kind === 'menu')
        entry = add('menu', 'Practice menu', `${menuDigits(p).map(d => d.digit + ': ' + (d.kind === 'urgent' ? 'Urgent' : d.label)).join('; ')}${p.languages.length ? '; language choices: ' + p.languages.map(l => l.name).join(', ') : ''}. A keypad cannot classify spoken urgency. Synthetic input is chosen in the scenario.`, 'decision', [edge(menuFail('invalid'), 'invalid'), edge(menuFail('noInput'), 'noInput'), ...(mechanism === 'menu-digit' ? [edge(urgent, 'urgent')] : []), edge(intent, 'otherwise')]);
    else if (p.first.kind === 'assistant')
        entry = assistant('assistant-entry', message('assistant-failed', q.assistant.owner, 'Unfinished request'), intent);
    const closedLanguageEdges: Node['edges'] = [];
    for (const [i,l] of p.languages.entries()) {
        const m=message('closed-language-message-'+i,l.fallback,l.name+' callback request');
        const f=q.languageFallbacks[l.name];let fail=m;
        if(f?.kind==='team')fail=connect('closed-language-alternate-'+i,f.team,m);
        else if(f?.kind==='instructions')fail=f.approved&&f.text.trim()?add('closed-language-info-'+i,'Approved '+l.name+' instructions',publicInstructions(f.text),'end'):unresolved;
        else if(f?.kind==='undecided')fail=unresolved;
        const provider=q.languageProviders[l.name]||'team';
        const target=provider==='team'?connect('closed-language-team-'+i,l.team,fail):provider==='service'?add('closed-language-service-'+i,'Proposed '+l.name+' service','Coverage requires verification; this preview uses the configured fallback.','action',[edge(fail)]):unresolved;
        const mechanism=l.mechanism==='staff'&&p.after.kind==='service'||l.mechanism==='assistant'&&p.after.kind==='assistant';
        const route=add('closed-language-coverage-'+i,l.name+' closed-hours coverage','Uses this location’s selected coverage schedule and unavailable-language policy.','decision',mechanism?[edge(target,'languageAvailable'),edge(fail,'otherwise')]:[edge(fail)]);
        closedLanguageEdges.push(edge(route,l.name));
    }
    const closedLanguage = add('closed-language', 'Service asks about language', 'Only an answered service can identify the closed-hours language request. Unavailable coverage follows the configured language fallback.', 'decision', [...closedLanguageEdges, edge(aftermsg, 'otherwise')]);
    if (p.after.kind === 'assistant')
        after = assistant('closed-assistant', aftermsg, closedLanguage);
    if (p.after.kind === 'service')
        after = add('closed-service-answer', 'Attempt answering service', 'Contract and permitted actions must be verified. Failure exits to the message owner.', 'decision', [edge(closedLanguage, 'answered'), edge(aftermsg, 'otherwise')]);
    const closedEntry = p.urgent.enabled ? add('closed-entry', 'Closed-hours urgent option', 'Caller explicitly chooses the urgent path. Ordinary closed calls follow the selected after-hours policy.', 'decision', [edge(urgent, 'urgent'), edge(after, 'otherwise')]) : after;
    const hours = add('hours', 'Is phone coverage open?', 'Use ' + p.hours.timezone + ', breaks, holidays and temporary closures.', 'decision', [edge(entry, 'open'), edge(closedEntry, 'otherwise')]);
    let localRoot = hours;
    if (p.mode === 'opening') {
        const before = q.beforeOpening === 'information' && q.beforeOpeningText?.trim() ? add('before-opening-info', 'Approved opening information', publicInstructions(q.beforeOpeningText), 'end') : q.beforeOpening === 'message' ? message('before-opening-message', q.beforeOpeningOwner || '', 'Opening callback request') : unresolved;
        localRoot = add('opening-status', 'Has the practice opened?', 'Scenario explicitly selects before-opening behavior; no opening date is inferred.', 'decision', [edge(before, 'beforeOpening'), edge(hours, 'otherwise')]);
    }
    let root = localRoot;
    if (p.locations.length > 1 && q.locationEntry !== 'shared') {
        const local = p.locations.find(l => l.id === q.activeLocation);
        root = add('location-entry', q.locationEntry === 'menu' ? 'Caller selects a location' : q.locationEntry === 'separate' ? 'Called number identifies the location' : 'Location entry undecided', `This draft configures ${local?.name || 'one location'}. Other saved local plans are routed separately; unconfigured locations remain unresolved.`, 'decision', q.locationEntry === 'undecided' ? [edge(unresolved)] : [edge(localRoot, 'selectedLocation'), edge(unresolved, 'otherwise')]);
    }
    add('start', 'Incoming call', 'A simulation only. No real call, notification or message is sent.', 'action', [edge(root)]);
    if (p.locations.length > 1) {
        const gateway = nodes[q.locationEntry === 'shared' ? 'shared-location' : 'location-entry'];
        if (gateway && q.locationEntry !== 'undecided') {
            const own = gateway.edges.find(e => e.when === 'selectedLocation')?.to || unresolved;
            gateway.edges = [...(q.locationEntry==='menu'?[edge(menuFail('invalid'),'invalid'),edge(menuFail('noInput'),'noInput')]:[]),edge(own, 'location:' + q.activeLocation)];
            for (const location of p.locations.filter(l => l.id !== q.activeLocation)) {
                const lp = locationPlan(p, location.id);
                if (!lp)
                    continue;
                const other = graph(lp), prefix = 'location-' + location.id + '/';
                for (const n of Object.values(other.nodes))
                    nodes[prefix + n.id] = { ...n, id: prefix + n.id, label: location.name + ' · ' + n.label, edges: n.edges.map(e => ({ ...e, to: prefix + e.to })) };
                gateway.edges.push(edge(prefix + other.start, 'location:' + location.id));
            }
            gateway.edges.push(edge(unresolved, 'otherwise'));
        }
    }
    // Keep inspection/PDF limited to reachable nodes, including all possible active branches.
    const reachable = new Set<string>();
    const visit = (id: string) => { if (reachable.has(id))
        return; reachable.add(id); for (const e of nodes[id].edges)
        visit(e.to); };
    visit('start');
    for (const id of Object.keys(nodes))
        if (!reachable.has(id))
            delete nodes[id];
    return { revision: p.revision, start: 'start', nodes };
}
export function simulate(p: Plan, s: Scenario) {
    const g = graph(p), trace: Node[] = [], reasons: string[] = [];
    let id = g.start;
    const seen = new Set<string>();
    const local = s.location && s.location !== p.policy.activeLocation ? locationPlan(p, s.location) || p : p;
    const date = s.at ? new Date(s.at) : undefined;
    let context = p;
    const opened = () => date ? isOpen(context, date) : s.open;
    const match = (when: string) => { const open = opened(); const request = s.request || context.policy.assistant.tasks[0] || ''; if (when === 'assistantHuman') {
        const a = context.policy.assistant;
        return a.humanWhen === 'request' ? !!s.humanRequested : a.humanWhen === 'selected' ? (a.handoffTasks || []).includes(request) : false;
    } if (when.startsWith('task:'))
        return !s.humanRequested && request === when.slice(5); if (when === 'always' || when === 'otherwise')
        return true; if (when === 'open')
        return open; if (when.startsWith('location:'))
        return (s.location || p.policy.activeLocation) === when.slice(9); if (when === 'selectedLocation')
        return !s.location || s.location === p.policy.activeLocation; if (when === 'onCallAvailable') {
        if (s.onCallAvailable !== undefined)
            return s.onCallAvailable;
        const q = context.policy;
        return q.urgentCoverage === 'always' || q.urgentCoverage === 'open' && open || q.urgentCoverage === 'closed' && !open || q.urgentCoverage === 'selected' && !!date && inSchedule(q.urgentDays, context.hours.timezone, date);
    } if (when === 'languageAvailable') {
        if (s.languageAvailable !== undefined)
            return s.languageAvailable;
        const l = context.languages.find(l => l.name === s.language);
        return l?.availability === 'always' || l?.availability === 'open' && open || l?.availability === 'limited' && !!date && inSchedule(context.policy.languageSchedules[l.name] || [], context.hours.timezone, date);
    } if (when.includes(':')) {
        const [k, team] = when.split(':');
        const schedule = context.policy.teamAvailability[team];
        const available = !s.unavailableTeams?.includes(team) && (!schedule || !!date && inSchedule(schedule, context.hours.timezone, date));
        return available && (k === 'answered' ? s.answered !== false && !s.busy : Boolean(s[k as keyof Scenario]));
    } if (when === 'answered')
        return s.answered !== false && !s.busy; return Boolean(s[when as keyof Scenario]); };
    while (id && !seen.has(id) && trace.length < 100) {
        seen.add(id);
        const n = g.nodes[id];
        if (!n)
            throw Error('Missing graph node ' + id);
        context = n.id.startsWith('location-') ? local : p;
        trace.push(n);
        if (n.kind === 'end')
            break;
        const nodeId = n.id.split('/').at(-1);
        const e = nodeId === 'reasons' ? n.edges.find(e => e.when === (s.reason || context.reasons[0]?.id)) || n.edges.find(e => e.when === 'otherwise') : ['language', 'closed-language'].includes(nodeId || '') ? n.edges.find(e => e.when === s.language) || n.edges.find(e => e.when === 'otherwise') : n.edges.find(e => match(e.when));
        reasons.push(e?.when === 'otherwise' ? 'No preceding condition applies' : e?.when === 'always' ? 'Next configured step' : 'Matched: ' + e?.when);
        id = e?.to || '';
    }
    return { revision: p.revision, scenario: s.label, trace, reasons };
}
export function journeySeconds(p: Plan, s: Scenario) {
    const r = simulate(p, s);
    const parts = r.trace.filter(n => n.seconds).map(n => ({ label: n.label, seconds: n.seconds as number }));
    const total = parts.reduce((n, x) => n + x.seconds, 0);
    return { total, parts, terminal: r.trace.at(-1)?.label || '', note: 'Configured ringing, waiting and menu retries only. Greeting playback and network delay are extra.' };
}
export function scenarios(p:Plan):Scenario[]{return [
 ...(p.mode==='opening'?[{id:'before-opening',label:'Before opening day',open:false,beforeOpening:true}]:[]),
 {id:'normal',label:'Open · answered',open:true,answered:true},
 {id:'busy',label:'Open · all positions busy',open:true,busy:true,answered:false},
 {id:'unanswered',label:'Open · nobody answers',open:true,answered:false},
 {id:'closed',label:'Closed hours',open:false},
 ...(p.hours.holidays.length?[{id:'holiday',label:'Configured holiday · '+(p.hours.holidayPolicy==='closed'?'closed profile':'regular hours'),open:p.hours.holidayPolicy==='regular'}]:[]),
 ...p.languages.flatMap(l=>[{id:'language-'+l.name,label:l.name+' · coverage unavailable',open:true,language:l.name,languageAvailable:false},{id:'language-available-'+l.name,label:l.name+' · during selected coverage',open:true,language:l.name,languageAvailable:true},...(['service','assistant'].includes(p.after.kind)?[{id:'closed-language-'+l.name,label:l.name+' · closed-hours coverage unavailable',open:false,language:l.name,languageAvailable:false}]:[])]),
 ...(p.urgent.enabled?[{id:'urgent',label:'On-call · nobody accepts',open:false,urgent:true,onCallAvailable:true,onCallAnswered:false,backupAnswered:false},{id:'urgent-unavailable',label:'Outside on-call coverage',open:false,urgent:true,onCallAvailable:false},...(urgentMechanism(p)==='menu-digit'?[{id:'open-urgent',label:'Open hours · urgent menu option',open:true,urgent:true,onCallAvailable:p.policy.urgentCoverage==='always'||p.policy.urgentCoverage==='open',onCallAnswered:false,backupAnswered:false}]:[])]:[]),
 ...(p.first.kind==='menu'||p.locations.length>1&&p.policy.locationEntry==='menu'?[{id:'invalid',label:'Menu · repeated invalid input',open:true,invalid:true},{id:'no-input',label:'Menu · repeated no input',open:true,noInput:true}]:[]),
 ...(p.first.kind==='assistant'?[{id:'assistant-entry-failed',label:'First-answer virtual receptionist unavailable',open:true,assistantFailed:true}]:[]),
 ...(p.busy.kind==='assistant'||p.busy.kind==='queue'&&p.policy.queueExit==='assistant'?[{id:'assistant-overflow-failed',label:'Overflow virtual receptionist unavailable',open:true,busy:true,answered:false,assistantFailed:true}]:[]),
 ...(p.after.kind==='assistant'?[{id:'assistant-closed-failed',label:'Closed-hours virtual receptionist unavailable',open:false,assistantFailed:true}]:[]),
 ...(p.after.kind==='service'?[{id:'closed-service-failed',label:'Closed-hours answering service unavailable',open:false,answered:false}]:[])
 ];}
