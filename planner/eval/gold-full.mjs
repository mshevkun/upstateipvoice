/**
 * End-to-end conversational gold for Upstate Practice Architect.
 * Today for date normalization is 2026-11-09, so a bare April or March is 2027.
 * Rooms, chairs, and operatories are policy.rooms. They are never phone counts.
 * Front-desk people who also bill stay reception. billing.performed_by is reception.
 * Administration count is people, not job duties.
 * Skipping on-call is not urgent.kind none.
 * "AI later" must not set first.kind or after.kind to assistant.
 * A stated on-call wish is not a verified live transfer, and a Dentrix wish is not enabled booking.
 */
const bannedPdf = ['verified on-call transfer', 'E911 confirmed', 'Dentrix booking enabled'];

function plan(partial) {
    const decided = partial.devicesUndecided === false;
    return {
        facts: partial.facts || {},
        factsAllow: partial.factsAllow || {},
        never: partial.never || {},
        unresolved: partial.unresolved || [],
        devicesUndecided: !decided,
        roomsAreNotPhones: true,
        noVerifiedOnCall: true,
        noVerifiedBooking: true,
        noInventedPrices: true,
        generateDraft: partial.generateDraft !== false,
        pdf: {
            mustInclude: partial.include || [],
            mustNotInclude: bannedPdf.concat(partial.exclude || [])
        }
    };
}

const city = (town) => [town + ', New York', town + ', NY', town];

export const fullScenarios = [
    {
        id: 'F01-kingston-new-dental',
        group: 'new',
        title: 'First-time Kingston dentist, one receptionist',
        persona: 'nervous first-time owner',
        turns: [
            { owner: 'This is my first dental office. We are opening in Kingston, New York. I am nervous and I do not know phones. There are four treatment rooms.' },
            { owner: 'At launch it is me, the dentist, and one receptionist. I might add a second receptionist later, but not for opening.' },
            { owner: 'Please do not pick a phone count. I have not chosen desk phones, and the four rooms are not four phones.' },
            { owner: 'When we are open, the receptionist answers. If she is already on a call, take a voicemail and leave it for the receptionist.' },
            { owner: 'After we close, play a message and let them leave a voicemail. The receptionist checks that in the morning.' },
            { owner: 'I have not figured out on-call. Do not set up a doctor line or any urgent path yet.' },
            { owner: 'English is enough. We do not need Spanish.' },
            { owner: 'Answer the phones weekdays, nine to five. Closed Saturday and Sunday.' },
            { owner: 'We are opening in April. I do not have the exact day. Construction is still going, the internet is not in, and we need a new phone number.' },
            { owner: 'That is enough. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 4,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'unknown'
            },
            factsAllow: { cityState: city('Kingston'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.reception.count': [2, 4],
                'devices.reception.desk_count': 4,
                'opening.precision': 'day',
                'opening.date': ['2026-04-01', '2026-04-15'],
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': ['menu', 'assistant'],
                specialty: 'Eye care'
            },
            unresolved: ['urgent.kind', 'urgent.team', 'urgent.coverage', 'urgent.scope', 'devices.reception.desk_count', 'teams.administration.count', 'billing.performed_by', 'followup', 'future.ai_receptionist', 'opening.network', 'name', 'policy.ring'],
            include: ['Kingston', 'reception']
        })
    },
    {
        id: 'F02-poughkeepsie-eye-opening',
        group: 'new',
        title: 'Poughkeepsie optometry, wife at the front',
        persona: 'couple opening an eye practice',
        turns: [
            { owner: 'My wife and I are opening an eye care office in Poughkeepsie, New York. Exams and glasses. The name is Poughkeepsie Vision.' },
            { owner: 'We are aiming for March. No exact day yet.' },
            { owner: 'Three exam rooms. I have not bought phones, so do not turn rooms into phones.' },
            { owner: 'My wife works the front desk. Count one receptionist. I am the only optometrist, so one clinician.' },
            { owner: 'A separate woman handles insurance and billing. She is office administration, not a second receptionist. Count one administrator, and billing is done by administration.' },
            { owner: 'The front desk person answers first. If she misses the call, take a voicemail for her.' },
            { owner: 'After hours, voicemail is fine. She listens the next morning.' },
            { owner: 'Real emergencies after we are closed should ring me, the doctor. Regular calls do not. We do not have a tested on-call line.' },
            { owner: 'English only. Weekdays nine to five, closed Saturday and Sunday. New phone number. No text reminders.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Eye care',
                name: 'Poughkeepsie Vision',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 1,
                'billing.performed_by': 'administration',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 3,
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Poughkeepsie'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.reception.count': [2, 3],
                'teams.administration.count': [0, 2],
                'billing.performed_by': 'reception',
                'devices.reception.desk_count': 3,
                'urgent.scope': 'all_calls',
                'first.kind': ['menu', 'assistant'],
                'opening.precision': 'day'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'busy.wait'],
            include: ['Poughkeepsie', 'reception']
        })
    },
    {
        id: 'F03-newburgh-construction-staff',
        group: 'new',
        title: 'Newburgh build-out, receptionist count still open',
        persona: 'owner in a construction site',
        turns: [
            { owner: 'I am building a new dental office in Newburgh, New York. Drywall is still up. We are not open.' },
            { owner: 'Five treatment rooms are drawn. None of those rooms get a phone just because they exist.' },
            { owner: 'I will be the only dentist. I have not hired an office manager. Administration count is zero.' },
            { owner: 'I do not know if I will hire one receptionist or two. Do not lock a receptionist number.' },
            { owner: 'Whoever is at the front should answer. If nobody picks up, take a voicemail.' },
            { owner: 'After hours, a message is enough. English only.' },
            { owner: 'Leave on-call blank. I have not decided it, and that is not the same as saying we have nobody.' },
            { owner: 'The wiring is not done and there is no internet yet. We will need a site survey for the network. New phone number.' },
            { owner: 'Opening target is June. I do not know the day. Weekdays nine to five once we open, closed weekends.' },
            { owner: 'Just give me the plan with the staffing hole still open.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 5,
                'opening.date': '2027-06-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'unknown',
                'opening.network': 'survey'
            },
            factsAllow: { cityState: city('Newburgh'), 'hours.preset': ['weekdays', 'custom'], 'first.team': ['reception'] },
            never: {
                'teams.reception.count': [1, 2],
                'devices.reception.desk_count': 5,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'opening.precision': 'day',
                'first.kind': 'assistant'
            },
            unresolved: ['teams.reception.count', 'urgent.kind', 'urgent.team', 'urgent.coverage', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'followup', 'future.ai_receptionist', 'busy.owner', 'policy.ring'],
            include: ['Newburgh', 'reception']
        })
    },
    {
        id: 'F04-middletown-no-ai-eye',
        group: 'new',
        title: 'Middletown eye practice that refuses AI',
        persona: 'owner who does not trust robots',
        turns: [
            { owner: 'Opening an eye care practice in Middletown, New York. Two exam rooms. I have not picked phones.' },
            { owner: 'One receptionist at the front and I am the only doctor. No office manager.' },
            { owner: 'I do not want AI at all. I do not want a robot talking to patients, not at launch and not later.' },
            { owner: 'A person at the front answers. If she is busy, take a voicemail. No phone menu.' },
            { owner: 'After hours, voicemail. If something is urgent they can leave a priority message. Do not ring the doctor.' },
            { owner: 'English only. Weekdays nine to five. Closed Saturday and Sunday.' },
            { owner: 'We open in April. No exact day. New number. Internet is already in the suite.' },
            { owner: 'No texting program. Phone messages only.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Eye care',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'priority',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 2,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'known',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Middletown'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': ['assistant', 'menu'],
                'after.kind': 'assistant',
                'busy.kind': 'assistant',
                'urgent.kind': ['connect', 'none'],
                'devices.reception.desk_count': 2,
                'opening.precision': 'day'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'billing.performed_by', 'policy.ring', 'opening.network'],
            include: ['Middletown', 'reception']
        })
    },
    {
        id: 'F05-albany-hate-menus',
        group: 'new',
        title: 'Albany dentist who hates phone menus',
        persona: 'direct owner who wants a person',
        turns: [
            { owner: 'New dental practice in Albany, New York. Call it Albany Smile. We open January 12, 2027.' },
            { owner: 'Six treatment rooms. I do not want you ordering a phone for each room. I have not chosen phones.' },
            { owner: 'Two people at the front desk. Clinical team is me plus two hygienists, so three clinicians. No separate administrator.' },
            { owner: 'I hate menus. None of that press one, press two nonsense. A person picks up.' },
            { owner: 'If both front desk people are already talking, take a voicemail for the front desk.' },
            { owner: 'After close, voicemail again. Same front desk owns it.' },
            { owner: 'English only. Phones are answered Monday through Friday, eight to five. Closed Saturday and Sunday.' },
            { owner: 'We need a new number. I have not decided on-call, so leave urgent blank. No text follow-up.' },
            { owner: 'That is enough. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                name: 'Albany Smile',
                'teams.reception.count': 2,
                'teams.clinical.count': 3,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'languages.decision': 'none',
                'hours.preset': 'custom',
                'hours.weekdays_start': '08:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 6,
                'opening.date': '2027-01-12',
                'opening.precision': 'day',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany') },
            never: {
                'first.kind': 'menu',
                'devices.reception.desk_count': [6, 8],
                'hours.weekdays_start': '09:00',
                'hours.preset': 'weekdays',
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'opening.date': '2027-01-01',
                'opening.precision': 'month'
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring'],
            include: ['Albany', 'reception']
        })
    },
    {
        id: 'F06-beacon-owner-front-bills',
        group: 'new',
        title: 'Beacon owner plus two front-desk billers',
        persona: 'owner who also runs the office',
        turns: [
            { owner: 'I am opening a dental office in Beacon, New York. Four rooms. I have not picked phones and the rooms are not phones.' },
            { owner: 'I am the owner. I manage the practice and do the office administration. Count one administrator, me.' },
            { owner: 'Two girls work the front. They also handle billing. It is the same two people, not a separate billing team. Reception is two. Do not count billing as extra administrators.' },
            { owner: 'Two dentists will see patients. That is the clinical count, two.' },
            { owner: 'The two front desk people answer first, and both phones should ring at the same time once we have phones. I still do not know how many phones.' },
            { owner: 'If they do not pick up, take a voicemail for the front desk.' },
            { owner: 'After hours, voicemail for the front desk. English only. Weekdays nine to five, closed weekends.' },
            { owner: 'Only true emergencies ring a dentist, and only after we close. Everyday calls stay at the front. Nothing is tested.' },
            { owner: 'Opening in April, no exact day. New phone number. No text reminders.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.administration.count': 1,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'billing.performed_by': 'reception',
                'first.kind': 'human',
                'first.team': 'reception',
                'policy.ring': 'together',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 4,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Beacon'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.administration.count': 3,
                'billing.performed_by': 'administration',
                'teams.reception.count': [1, 3, 4],
                'devices.reception.desk_count': 4,
                'urgent.scope': 'all_calls',
                'first.kind': ['menu', 'assistant'],
                'opening.precision': 'day'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'busy.wait', 'name'],
            include: ['Beacon', 'reception']
        })
    },
    {
        id: 'F07-troy-ai-later',
        group: 'new',
        title: 'Troy dental, AI only after they grow',
        persona: 'cautious new owner',
        turns: [
            { owner: 'Opening a small dental office in Troy, New York. Three rooms. No phones chosen. Rooms are not phones.' },
            { owner: 'One receptionist. I am the only dentist. No office manager.' },
            { owner: 'I do want an AI receptionist later, when we are bigger. Not at launch. The human receptionist answers from day one.' },
            { owner: 'If she is on the other line, take a voicemail. After hours is a normal voicemail, not an AI.' },
            { owner: 'Leave on-call undecided. I have not figured that out.' },
            { owner: 'English only. Weekdays nine to five. Closed Saturday and Sunday.' },
            { owner: 'We open in March. No exact day. Please survey the site before anyone promises the internet will work. New phone number.' },
            { owner: 'No extra texting. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 3,
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'survey',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Troy'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': 'assistant',
                'after.kind': 'assistant',
                'busy.kind': 'assistant',
                'devices.reception.desk_count': 3,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'opening.precision': 'day'
            },
            unresolved: ['future.ai_receptionist', 'urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'opening.network', 'policy.ring', 'name'],
            include: ['Troy', 'reception'],
            exclude: ['AI receptionist answers first']
        })
    },
    {
        id: 'F08-new-paltz-no-oncall',
        group: 'new',
        title: 'New Paltz eye care with no on-call',
        persona: 'small practice, daytime only',
        turns: [
            { owner: 'We are opening an eye care office in New Paltz, New York, in September. I do not know the day.' },
            { owner: 'Two exam rooms. Do not order phones from the room count. I have not chosen phones.' },
            { owner: 'One receptionist. I am the optometrist, one clinician. One office manager who does the billing. Billing is administration, not the front desk.' },
            { owner: 'The receptionist answers first. Missed calls during the day go to voicemail for her.' },
            { owner: 'After hours, just play our hours and hang up. Do not take a long message at night.' },
            { owner: 'We do not have anyone on call. Tell people to seek emergency care if they need it and call us the next day. No doctor phone.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. New number. No texts.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Eye care',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 1,
                'billing.performed_by': 'administration',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'information',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 2,
                'opening.date': '2027-09-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('New Paltz'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.kind': ['connect', 'priority', 'instructions'],
                'urgent.team': ['clinical', 'reception', 'admin', 'administration'],
                'billing.performed_by': 'reception',
                'after.kind': ['message', 'assistant', 'service'],
                'devices.reception.desk_count': 2,
                'first.kind': 'assistant',
                'opening.precision': 'day'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'urgent.scope', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['New Paltz', 'reception']
        })
    },
    {
        id: 'F09-hudson-rooms-not-phones',
        group: 'new',
        title: 'Hudson dental, eight rooms and one front phone',
        persona: 'owner correcting a phone-per-room rumor',
        turns: [
            { owner: 'Opening a dental office in Hudson, New York. People keep telling me to buy a pile of phones. I am not doing that.' },
            { owner: 'There are eight treatment rooms. I want one desk phone at the front desk. The rooms do not get phones.' },
            { owner: 'One receptionist answers that phone. Clinical staff is me, two hygienists, and one assistant, so four clinicians. No administrator.' },
            { owner: 'The receptionist answers first. If she misses it, voicemail for her. After hours, voicemail for her.' },
            { owner: 'English only. Weekdays nine to five. Closed Saturday and Sunday.' },
            { owner: 'On-call is not decided. Leave it blank.' },
            { owner: 'We open in May 2027. I do not know the day. New number. No text program.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'policy.rooms': 8,
                'devices.reception.desk_count': 1,
                'teams.reception.count': 1,
                'teams.clinical.count': 4,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-05-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Hudson'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'devices.reception.desk_count': [8, 9],
                'teams.reception.count': 8,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant',
                'opening.precision': 'day'
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            devicesUndecided: false,
            include: ['Hudson', 'reception']
        })
    },
    {
        id: 'F10-catskill-emergencies-only',
        group: 'new',
        title: 'Catskill dental, doctor wording then emergencies only',
        persona: 'owner who clarifies a sloppy sentence',
        turns: [
            { owner: 'We are opening a dental office in Catskill, New York, in April. No exact day.' },
            { owner: 'Four treatment rooms. I do not know what phones to buy. Do not assume one phone per room.' },
            { owner: 'Two receptionists. I am the dentist and I have one associate, so two clinicians. One office manager does the books and does not answer phones.' },
            { owner: 'The receptionists should answer first. If they miss it, take a voicemail.' },
            { owner: 'After hours, a voicemail message is fine. English only. Weekdays nine to five, closed Saturday and Sunday.' },
            { owner: 'During open hours calls go to the doctor, and when we are closed they go to the on-call person.' },
            { owner: 'Sorry, I only mean emergencies. Regular calls go to the front desk, not the doctor.' },
            { owner: 'Emergencies can reach a doctor both while we are open and after we close. We rotate weeks. Do not mark any transfer as tested.' },
            { owner: 'New phone number. No text reminders. I do not know the internet situation yet.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'always',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Catskill'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.scope': 'all_calls',
                'first.team': 'clinical',
                'devices.reception.desk_count': 4,
                'first.kind': ['menu', 'assistant'],
                'opening.precision': 'day'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'busy.owner', 'name'],
            include: ['Catskill', 'reception']
        })
    },
    {
        id: 'F11-kingston-no-computer',
        group: 'new',
        title: 'Second Kingston office, no computer taking information',
        persona: 'owner worried about a computer talking',
        turns: [
            { owner: 'Another new office, this one eye care, in Kingston, New York. Three rooms. No phone model picked.' },
            { owner: 'One receptionist, one doctor, one office manager. The manager does billing.' },
            { owner: 'I am not comfortable with a computer taking patient information. No AI. A person answers.' },
            { owner: 'If the person misses the call, voicemail. After hours, voicemail too.' },
            { owner: 'We do not connect urgent calls to a doctor. Play instructions that say seek emergency care.' },
            { owner: 'English only. Weekdays nine to five, closed weekends.' },
            { owner: 'We open in December. I do not know the day. New phone number. No texts.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Eye care',
                'policy.rooms': 3,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 1,
                'billing.performed_by': 'administration',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'instructions',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2026-12-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Kingston'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': 'assistant',
                'after.kind': 'assistant',
                'urgent.kind': ['connect', 'none'],
                'devices.reception.desk_count': 3,
                'billing.performed_by': 'reception',
                'opening.precision': 'day',
                'opening.date': '2027-12-01'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['Kingston', 'reception']
        })
    },
    {
        id: 'F12-poughkeepsie-saturday-service',
        group: 'new',
        title: 'Poughkeepsie vision, Saturday morning and a night service',
        persona: 'owner with longer evenings',
        turns: [
            { owner: 'Opening Poughkeepsie Vision North, an eye care office in Poughkeepsie, New York. Four exam rooms. Phones not chosen.' },
            { owner: 'Two receptionists, two optometrists, one administrator who does not answer the phone.' },
            { owner: 'The receptionists answer first. If both are busy, let the caller wait sixty seconds, then voicemail.' },
            { owner: 'At night we use a live answering service, not a recording and not an AI.' },
            { owner: 'Emergencies only, and only after we close, should try the doctor. Regular daytime calls stay up front. The route is not verified.' },
            { owner: 'English only. Weekdays are nine to six. Saturday we answer nine to one. Closed Sunday.' },
            { owner: 'Opening in April. No exact day. New number. No text reminders yet.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Eye care',
                name: 'Poughkeepsie Vision North',
                'policy.rooms': 4,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'queue',
                'busy.wait': 60,
                'after.kind': 'service',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.preset': 'custom',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '18:00',
                'hours.Saturday.open': true,
                'hours.Saturday.start': '09:00',
                'hours.Saturday.end': '13:00',
                'hours.Sunday.open': false,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Poughkeepsie') },
            never: {
                'after.kind': ['message', 'assistant', 'information'],
                'hours.preset': 'weekdays',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'devices.reception.desk_count': 4,
                'urgent.scope': 'all_calls',
                'first.kind': 'assistant',
                'busy.wait': [45, 90],
                'opening.precision': 'day'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring'],
            include: ['Poughkeepsie', 'reception']
        })
    },
    {
        id: 'F13-albany-dentrix-wish',
        group: 'new',
        title: 'Albany dental wants AI scheduling in Dentrix',
        persona: 'owner who wants booking software that is not connected',
        turns: [
            { owner: 'Opening a dental office in Albany, New York. Five rooms. I have not ordered phones. Rooms are not phones.' },
            { owner: 'One receptionist will still be there, and I am the dentist. No office manager yet.' },
            { owner: 'I want that AI thing where patients call and it puts them right on the schedule. The software is Dentrix. The receptionist answers only if the AI cannot.' },
            { owner: 'Do not say Dentrix booking is turned on. Nobody has connected it. It is a wish.' },
            { owner: 'After hours, skip the AI and take a voicemail for the receptionist.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. On-call is not decided.' },
            { owner: 'We open in March. No exact day. New number. No extra texting until booking is real.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'policy.rooms': 5,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'assistant',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': ['human', 'menu'],
                'after.kind': 'assistant',
                'devices.reception.desk_count': 5,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'opening.precision': 'day'
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring'],
            include: ['Albany', 'Dentrix'],
            exclude: ['booking confirmed', 'appointment booked']
        })
    },
    {
        id: 'F14-middletown-assistants',
        group: 'new',
        title: 'Middletown dental assistants are clinical, not front desk',
        persona: 'owner separating assistants from reception',
        turns: [
            { owner: 'New dental practice in Middletown, New York. We open July 15, 2027. Five rooms. Phones are not chosen yet.' },
            { owner: 'One person checks patients in and answers the phone. That is reception, one person.' },
            { owner: 'I am the dentist. Two dental assistants and one hygienist work with me. All four of us are clinical. Do not put the assistants at reception.' },
            { owner: 'One office manager. If the front desk misses a call, try the office manager next, then voicemail if she misses it too.' },
            { owner: 'Daytime voicemail, if we get that far, belongs to the front desk. After hours, voicemail belongs to the front desk too.' },
            { owner: 'Urgent calls should leave a priority message. Do not ring the dentist at home.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Fiber is already in the suite and the network cabling is done. New number.' },
            { owner: 'Yes, include text follow-up so a missed caller can ask us to call back. Consent still has to be confirmed later. Do not claim texting is live.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'policy.rooms': 5,
                'teams.reception.count': 1,
                'teams.clinical.count': 4,
                'teams.administration.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'backup',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'priority',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-07-15',
                'opening.precision': 'day',
                'opening.numbers': 'new',
                'opening.internet': 'known',
                'opening.network': 'known',
                followup: 'yes'
            },
            factsAllow: { cityState: city('Middletown'), 'hours.preset': ['weekdays', 'custom'], 'busy.owner': ['admin', 'administration', 'reception'] },
            never: {
                'teams.reception.count': [3, 4],
                'teams.clinical.count': [2, 3],
                'devices.reception.desk_count': 5,
                'urgent.kind': 'connect',
                'first.kind': 'assistant',
                'opening.precision': 'month',
                'opening.date': '2027-07-01'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'policy.ring', 'name'],
            include: ['Middletown', 'reception'],
            exclude: ['SMS enabled', 'texting confirmed']
        })
    },
    {
        id: 'F15-newburgh-march-not-january',
        group: 'new',
        title: 'Newburgh number goes live before the March opening',
        persona: 'owner advertising early',
        turns: [
            { owner: 'We are opening a dental office in Newburgh, New York. Four rooms. I have not picked phones. The rooms are not phones.' },
            { owner: 'One receptionist at launch. I might hire another later. Do not count two. I am the only dentist. No administrator yet.' },
            { owner: 'We will start giving the phone number out in January, but we do not open until March. March is the opening. I do not know the day in March.' },
            { owner: 'Before we open, let callers leave their information. Do not pretend the office is already open in January.' },
            { owner: 'Once we are open, the receptionist answers. Busy calls go to voicemail. After hours, voicemail.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. New number. Construction internet is not in.' },
            { owner: 'I have not decided emergencies. Leave on-call unresolved. No texts.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'unknown',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Newburgh'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.reception.count': 2,
                'opening.date': ['2027-01-01', '2026-01-01', '2026-03-01'],
                'opening.precision': 'day',
                'devices.reception.desk_count': 4,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant'
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.network', 'policy.ring', 'name'],
            include: ['Newburgh', 'reception'],
            exclude: ['opening in January']
        })
    },
    {
        id: 'F16-hudson-seventy-year-old',
        group: 'established',
        title: 'Seventy-year-old Hudson dentist fixing bad phones',
        persona: '70-year-old owner of a long-running office',
        turns: [
            { owner: 'I am 70. I have had this dental office in Hudson, New York for forty years. I am not trying to reinvent the wheel. The phones are just terrible.' },
            { owner: 'People say they call and nobody answers. My receptionist swears the phone never rang. Do not invent a cause.' },
            { owner: 'One receptionist. Clinical is me and one hygienist, so two. My wife does the books. She is one administrator and she does the billing. She is not a receptionist.' },
            { owner: 'Keep a person answering. I do not want a menu and I do not want a robot.' },
            { owner: 'If we miss a call during the day, voicemail for the receptionist. After hours, voicemail for her too.' },
            { owner: 'I stopped taking call when I turned 70. We do not have anyone on call. No doctor line at night.' },
            { owner: 'English only. We answer Monday through Friday, eight to four. Closed Saturday and Sunday.' },
            { owner: 'The old desk phones are still on the counters. I do not know if we keep them, so do not write a phone count. The four rooms are not phones.' },
            { owner: 'No new number. No texts. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'billing.performed_by': 'administration',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'hours.preset': 'custom',
                'hours.weekdays_start': '08:00',
                'hours.weekdays_end': '16:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 4,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Hudson') },
            never: {
                mode: ['opening', 'adding'],
                'urgent.kind': ['connect', 'priority', 'instructions'],
                'first.kind': ['menu', 'assistant'],
                'billing.performed_by': 'reception',
                'hours.preset': 'weekdays',
                'hours.weekdays_end': '17:00',
                'devices.reception.desk_count': 4,
                'opening.numbers': 'new'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.date', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['Hudson', 'reception'],
            exclude: ['the line is broken']
        })
    },
    {
        id: 'F17-poughkeepsie-missed-calls',
        group: 'established',
        title: 'Poughkeepsie office replacing a vendor, same number',
        persona: 'owner tired of missed calls',
        turns: [
            { owner: 'This is my existing dental office in Poughkeepsie, New York. I want to leave the phone vendor. Patients say we miss calls.' },
            { owner: 'The receptionist says the phone never rang. Do not tell me the wire is bad. You do not know that.' },
            { owner: 'Two people work the front. I have not counted clinicians for you today, so leave clinical blank. No new administrator discussion.' },
            { owner: 'The published number has to stay. We are not getting a new number.' },
            { owner: 'A person at the front should answer. If they miss it, voicemail. After hours, voicemail.' },
            { owner: 'Six treatment rooms. Those are rooms, not phones. I do not know how many desk phones still work.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Leave on-call alone, I am not deciding it today.' },
            { owner: 'No texts. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'teams.reception.count': 2,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'opening.numbers': 'porting',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 6,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Poughkeepsie'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: 'opening',
                'opening.numbers': 'new',
                'devices.reception.desk_count': 6,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant'
            },
            unresolved: ['teams.clinical.count', 'teams.administration.count', 'urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'policy.ring', 'name'],
            include: ['Poughkeepsie', 'reception'],
            exclude: ['the line is broken', 'wire is bad']
        })
    },
    {
        id: 'F18-albany-front-desk-bills',
        group: 'established',
        title: 'Albany eye care, owner admin and two billing receptionists',
        persona: 'owner who is the only administrator',
        turns: [
            { owner: 'Existing eye care office in Albany, New York. I want the phones replaced. Four exam rooms, and the rooms are not phones.' },
            { owner: 'I am the owner and I run the office. I am the only administrator. Count administration as one.' },
            { owner: 'Two girls at the front also do all the billing. Same two people. Reception is two. Do not turn billing into two more administrators.' },
            { owner: 'Two optometrists. That is the clinical count.' },
            { owner: 'We already have two desk phones at the front. Both should ring at the same time.' },
            { owner: 'If both are busy, let the caller wait thirty seconds, then take a voicemail for the front desk.' },
            { owner: 'After hours, voicemail. English only. Weekdays nine to five, closed weekends.' },
            { owner: 'Only after we close, and only for a true emergency, try the doctor. Not every call. It is not a tested transfer.' },
            { owner: 'Keep our current number. No texts. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                'teams.administration.count': 1,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'billing.performed_by': 'reception',
                'devices.reception.desk_count': 2,
                'policy.ring': 'together',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'queue',
                'busy.wait': 30,
                'busy.owner': 'reception',
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 4,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.administration.count': 3,
                'billing.performed_by': 'administration',
                'teams.reception.count': [1, 4],
                'devices.reception.desk_count': 4,
                'urgent.scope': 'all_calls',
                'busy.wait': [45, 60],
                'first.kind': 'assistant',
                mode: 'opening'
            },
            unresolved: ['future.ai_receptionist', 'opening.date', 'opening.internet', 'opening.network', 'name', 'after.owner'],
            devicesUndecided: false,
            include: ['Albany', 'reception']
        })
    },
    {
        id: 'F19-kingston-doctor-wording',
        group: 'established',
        title: 'Kingston dentist clarifies emergencies versus every call',
        persona: 'owner with sloppy first wording',
        turns: [
            { owner: 'Existing dental office in Kingston, New York. Phones are old. Three rooms. I have not said how many phones, and rooms are not phones.' },
            { owner: 'One receptionist. I am the only dentist. No office manager.' },
            { owner: 'During the day the receptionist is supposed to answer. Missed calls are voicemail. After hours is voicemail too.' },
            { owner: 'During open hours calls go to the doctor, and when we are closed they go to the on-call person.' },
            { owner: 'No, only emergencies. Regular calls go to the front desk.' },
            { owner: 'Those emergencies can be during the day or after close. Do not mark the doctor transfer as verified.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Keep the number we have. No texts.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 3,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'always',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Kingston'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.scope': 'all_calls',
                'first.team': 'clinical',
                'devices.reception.desk_count': 3,
                'first.kind': ['menu', 'assistant'],
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'opening.internet', 'policy.ring', 'name'],
            include: ['Kingston', 'reception']
        })
    },
    {
        id: 'F20-newburgh-spanish-maria',
        group: 'established',
        title: 'Newburgh dental, Maria speaks Spanish Tuesday and Thursday',
        persona: 'owner with part-week language coverage',
        turns: [
            { owner: 'Existing dental office in Newburgh, New York. Five rooms. I do not know a phone count, and rooms are not phones.' },
            { owner: 'Two people at the front. One of them is Maria. Two clinicians. One office manager.' },
            { owner: 'Half our patients speak Spanish. Maria speaks Spanish, but she is only here Tuesdays and Thursdays. Other days the phone is English only. Do not promise Spanish every day.' },
            { owner: 'Do not hand Spanish to an AI. A person answers. Maria is not an AI.' },
            { owner: 'If the front desk misses a call, voicemail. After hours, voicemail.' },
            { owner: 'Urgent calls leave a priority message. Do not ring the doctor.' },
            { owner: 'Weekdays nine to five, closed Saturday and Sunday. Keep our number. No texts.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 5,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'languages.decision': 'selected',
                'languages.spanish': true,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'priority',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Newburgh'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': 'assistant',
                'languages.decision': 'none',
                'languages.spanish': false,
                'urgent.kind': 'connect',
                'devices.reception.desk_count': 5,
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.date', 'policy.ring', 'name'],
            include: ['Newburgh', 'Maria', 'Spanish', 'Tuesday'],
            exclude: ['Spanish every day', 'AI Spanish']
        })
    },
    {
        id: 'F21-troy-refuse-ai',
        group: 'established',
        title: 'Troy dental refuses AI and uses voicemail',
        persona: 'owner who wants voicemail only',
        turns: [
            { owner: 'Existing dental office in Troy, New York. Four rooms. No phone shopping today. Rooms are not phones.' },
            { owner: 'One receptionist. I am the dentist. No office manager.' },
            { owner: 'I do not want AI at all. No robot. If that is the pitch, skip it.' },
            { owner: 'A person answers. If we miss the call, voicemail. After hours, voicemail. The receptionist owns both.' },
            { owner: 'Urgent callers can leave a marked priority voicemail. Do not ring me at home. We are not connecting a live transfer.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Keep the current number. No texts.' },
            { owner: 'The person who answers first is the receptionist. No phone menu.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'priority',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Troy'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': 'assistant',
                'after.kind': 'assistant',
                'busy.kind': 'assistant',
                'urgent.kind': ['connect', 'none'],
                'devices.reception.desk_count': 4,
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'billing.performed_by', 'urgent.team', 'urgent.scope', 'opening.date', 'policy.ring', 'name'],
            include: ['Troy', 'reception']
        })
    },
    {
        id: 'F22-beacon-ai-overflow',
        group: 'established',
        title: 'Beacon dental, staff first and AI only when slammed',
        persona: 'owner who will accept overflow help',
        turns: [
            { owner: 'Existing dental office in Beacon, New York. Seven rooms. I am not buying seven phones. Phone count is undecided.' },
            { owner: 'Three receptionists. Four clinicians. I am not listing an administrator today.' },
            { owner: 'I do not want a robot picking up every call. My staff should answer first. When they are slammed, the AI can help after twenty seconds.' },
            { owner: 'After hours, ordinary voicemail. Not the AI.' },
            { owner: 'Emergencies only, after we close, try the dentist. Not verified.' },
            { owner: 'English only. Monday through Friday, eight in the morning until six at night. Saturday we answer. Sunday we are closed.' },
            { owner: 'Saturday is open, but I did not say the Saturday hours. Do not invent them.' },
            { owner: 'Keep the number. No text program. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 7,
                'teams.reception.count': 3,
                'teams.clinical.count': 4,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'assistant',
                'busy.wait': 20,
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.preset': 'custom',
                'hours.weekdays_start': '08:00',
                'hours.weekdays_end': '18:00',
                'hours.Saturday.open': true,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Beacon') },
            never: {
                'first.kind': 'assistant',
                'after.kind': 'assistant',
                'busy.wait': [45, 40, 60],
                'devices.reception.desk_count': 7,
                'hours.preset': 'weekdays',
                'urgent.scope': 'all_calls',
                mode: 'opening'
            },
            unresolved: ['teams.administration.count', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'policy.ring', 'name', 'hours.Saturday.start'],
            include: ['Beacon', 'reception']
        })
    },
    {
        id: 'F23-catskill-no-night-call',
        group: 'established',
        title: 'Catskill eye care with nobody on call',
        persona: 'daytime-only optometrist',
        turns: [
            { owner: 'Existing eye care office in Catskill, New York. Three rooms. Phones not counted. Rooms are not phones.' },
            { owner: 'One receptionist, one doctor, one office manager.' },
            { owner: 'The receptionist answers. Missed daytime calls are voicemail. After hours is voicemail too.' },
            { owner: 'We do not have an on-call doctor. There is no separate urgent path and no clinician phone.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Keep our number. No texts.' },
            { owner: 'Just give me the plan.' },
            { owner: 'And do not add a night doctor I did not ask for.' },
            { owner: 'That is enough. Give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                'policy.rooms': 3,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Catskill'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.kind': ['connect', 'priority', 'instructions'],
                'urgent.team': ['clinical', 'reception', 'admin', 'administration'],
                'devices.reception.desk_count': 3,
                'first.kind': 'assistant',
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.scope', 'opening.date', 'policy.ring', 'name'],
            include: ['Catskill', 'reception']
        })
    },
    {
        id: 'F24-middletown-ai-next-year',
        group: 'established',
        title: 'Middletown dental might add AI next year',
        persona: 'owner deferring automation',
        turns: [
            { owner: 'Existing dental office in Middletown, New York. Four rooms. Phone count unknown. Rooms are not phones.' },
            { owner: 'Two receptionists, two clinicians, one office manager.' },
            { owner: 'An AI receptionist can wait until next year. Do not turn it on with this project. The girls answer now.' },
            { owner: 'Missed calls are voicemail. After hours is voicemail. Not an AI.' },
            { owner: 'Skip on-call for now. I am not saying we have no on-call. I am skipping it.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Keep the number. No texts.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Leave the later AI idea off the launch setup. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Middletown'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'first.kind': 'assistant',
                'after.kind': 'assistant',
                'busy.kind': 'assistant',
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'devices.reception.desk_count': 4,
                mode: 'opening'
            },
            unresolved: ['future.ai_receptionist', 'urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'opening.date', 'policy.ring', 'name'],
            include: ['Middletown', 'reception'],
            exclude: ['AI receptionist answers first']
        })
    },
    {
        id: 'F25-albany-internet-cell',
        group: 'established',
        title: 'Albany dental internet dies, calls go to the work cell',
        persona: 'owner with unreliable internet',
        turns: [
            { owner: 'Existing dental office in Albany, New York. The internet goes out every couple of weeks. I cannot have the phone die every time.' },
            { owner: 'When the internet drops, send the calls to the work cell. Do not tell me a failover is confirmed. It is just what I want.' },
            { owner: 'Two receptionists and two clinicians. Four rooms. Those rooms are not phones. I do not know how many desk phones still work.' },
            { owner: 'A person at the front answers when the internet is up. Missed calls are voicemail. After hours, voicemail.' },
            { owner: 'English only. Weekdays nine to five, closed weekends.' },
            { owner: 'Leave on-call blank. I am not deciding emergencies today.' },
            { owner: 'Keep our number. No texts. Just give me the plan.' },
            { owner: 'And write the work cell as a wish, not as a finished backup. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'devices.reception.desk_count': 4,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant',
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'teams.administration.count', 'urgent.kind', 'urgent.scope', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'policy.ring', 'name'],
            include: ['Albany', 'work cell'],
            exclude: ['failover confirmed', 'backup verified']
        })
    },
    {
        id: 'F26-newburgh-middletown-overflow',
        group: 'expansion',
        title: 'Newburgh second dental office overflows to Middletown',
        persona: 'owner adding a site without merging hours',
        turns: [
            { owner: 'We already have a dental office in Middletown, New York. I am opening another in Newburgh, New York.' },
            { owner: 'This plan is the Newburgh addition. Do not replace Middletown.' },
            { owner: 'Newburgh has four treatment rooms. I have not chosen phones. The rooms are not phones.' },
            { owner: 'Newburgh gets one receptionist. Middletown already has two receptionists. For this Newburgh plan the reception count is one, not three.' },
            { owner: 'I am the dentist in Newburgh. Count one clinician there. No office manager at Newburgh, so administration is zero for this office.' },
            { owner: 'Newburgh calls should be answered first by the Newburgh receptionist.' },
            { owner: 'If that Newburgh receptionist is busy or does not pick up, Middletown can take the overflow.' },
            { owner: 'Do not mash the hours together. Newburgh answers eight to five. Middletown answers nine to six. They are different offices.' },
            { owner: 'Do not write one shared weekly schedule and do not copy Middletown closing time onto Newburgh.' },
            { owner: 'After hours, Newburgh callers can leave a voicemail that the Newburgh receptionist owns.' },
            { owner: 'English is enough at Newburgh.' },
            { owner: 'I want Newburgh open in April. No exact day. Newburgh needs its own new phone number. Middletown keeps the number it already has.' },
            { owner: 'I have not decided on-call for Newburgh. Leave urgent blank. Internet in the Newburgh build-out is not in yet.' },
            { owner: 'No text program.' },
            { owner: 'Confirming the Newburgh plan only: one receptionist, one dentist, no administrator, Middletown overflows when Newburgh is busy.' },
            { owner: 'That is enough for both offices. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'backup',
                'after.kind': 'message',
                'after.owner': 'reception',
                'languages.decision': 'none',
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'unknown',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Newburgh') },
            never: {
                mode: ['opening', 'improving'],
                'teams.reception.count': [2, 3],
                'hours.weekdays_start': ['08:00', '09:00'],
                'hours.weekdays_end': ['17:00', '18:00'],
                'hours.preset': ['weekdays', 'custom', 'always'],
                'devices.reception.desk_count': 4,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'opening.precision': 'day',
                'first.kind': 'assistant'
            },
            unresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'urgent.kind', 'urgent.team', 'urgent.coverage', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.network', 'policy.ring', 'name'],
            include: ['Newburgh', 'Middletown', 'reception']
        })
    },
    {
        id: 'F27-kingston-hudson-one-receptionist',
        group: 'expansion',
        title: 'Hudson addition answered by the Kingston receptionist',
        persona: 'owner sharing one front desk across two towns',
        turns: [
            { owner: 'I have a dental office in Kingston, New York, and I am adding one in Hudson, New York.' },
            { owner: 'Both offices ring one receptionist. She sits in Kingston. There is not a second receptionist in Hudson.' },
            { owner: 'For this Hudson addition, count three treatment rooms. Kingston has rooms too, but do not turn either room count into phones. I have not chosen phones.' },
            { owner: 'Count two dentists at Hudson. I do the administration for both offices. Count one administrator, me.' },
            { owner: 'The receptionist also does billing for both offices. Billing is her front-desk job. Administration stays one person.' },
            { owner: 'She has to hear which office the caller wants. Do not mash the two offices into one nameless queue.' },
            { owner: 'If she does not pick up, take a message. Do not send the call to a second front desk. There is not one.' },
            { owner: 'Hudson phones are answered by that same receptionist until four. Kingston patients call until six. Do not write one closing time for both.' },
            { owner: 'After hours, voicemail for that receptionist.' },
            { owner: 'Hudson emergencies, only after we close, should try that office dentist. Not every call. Not a tested route.' },
            { owner: 'English only.' },
            { owner: 'Hudson opens in April. No exact day. Hudson gets a new number. Kingston keeps its number.' },
            { owner: 'No texts.' },
            { owner: 'Reception count is one. Please do not make it two because there are two towns.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Dental',
                'policy.rooms': 3,
                'teams.reception.count': 1,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'billing.performed_by': 'reception',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Hudson').concat(['Kingston, New York', 'Kingston, NY', 'Kingston']) },
            never: {
                'teams.reception.count': 2,
                'teams.administration.count': [0, 2, 3],
                'policy.rooms': 4,
                'hours.weekdays_end': ['16:00', '18:00'],
                'hours.preset': ['weekdays', 'custom', 'always'],
                'busy.kind': 'backup',
                'urgent.scope': 'all_calls',
                'devices.reception.desk_count': [3, 4],
                'first.kind': 'assistant',
                mode: 'opening'
            },
            unresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'devices.reception.desk_count', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['Hudson', 'Kingston', 'reception']
        })
    },
    {
        id: 'F28-beacon-expansion-billing',
        group: 'expansion',
        title: 'Beacon addition, owner admin and two front-desk billers',
        persona: 'owner staffing a second dental office',
        turns: [
            { owner: 'I already practice dentistry in New Paltz, New York. I am adding a Beacon, New York office.' },
            { owner: 'This blueprint is Beacon. Do not copy New Paltz hours onto it.' },
            { owner: 'Beacon will have five treatment rooms. I have not picked phones. Rooms are not phones.' },
            { owner: 'I am the owner and the only administrator for Beacon. Count administration as one.' },
            { owner: 'At Beacon, two front-desk people will also do the billing. Same two people. Reception is two. Do not count three administrators.' },
            { owner: 'Two dentists at Beacon. Clinical count is two.' },
            { owner: 'The Beacon front desk answers Beacon calls first.' },
            { owner: 'If they miss the call, take a voicemail for them. Do not automatically dump it on New Paltz.' },
            { owner: 'After hours, voicemail for the Beacon front desk.' },
            { owner: 'Beacon phones are Monday to Friday, nine to five, closed Saturday and Sunday. New Paltz is different. Ignore New Paltz hours.' },
            { owner: 'Only true emergencies, and only after Beacon is closed, should try a Beacon dentist. Not every call. Not verified.' },
            { owner: 'English only at Beacon.' },
            { owner: 'Beacon opens in March. No exact day. Beacon needs a new number.' },
            { owner: 'No texts. Just give me the plan.' },
            { owner: 'Again, administration is one person and reception is two people who also bill. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Dental',
                'policy.rooms': 5,
                'teams.administration.count': 1,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'billing.performed_by': 'reception',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Beacon'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.administration.count': 3,
                'billing.performed_by': 'administration',
                'teams.reception.count': [1, 3],
                'devices.reception.desk_count': 5,
                'urgent.scope': 'all_calls',
                'first.kind': 'assistant',
                'opening.precision': 'day',
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'name', 'busy.owner'],
            include: ['Beacon', 'reception']
        })
    },
    {
        id: 'F29-albany-troy-different-hours',
        group: 'expansion',
        title: 'Troy eye clinic hours are not Albany hours',
        persona: 'owner protecting two schedules',
        turns: [
            { owner: 'We have an eye care office in Albany, New York. I am adding one in Troy, New York.' },
            { owner: 'The plan I want is the Troy office, with Albany mentioned only so you do not copy it.' },
            { owner: 'Troy has three exam rooms. No phones chosen. Rooms are not phones.' },
            { owner: 'Troy has one receptionist and one optometrist. Leave administration unknown.' },
            { owner: 'Troy front desk answers Troy calls first. If they miss it, voicemail. After hours, voicemail.' },
            { owner: 'Albany answers eight to six. Troy answers ten to four, Monday through Friday. Do not use one schedule for both.' },
            { owner: 'Do not pick Saturday for either office. I did not say it.' },
            { owner: 'English only in Troy.' },
            { owner: 'Leave on-call blank for Troy.' },
            { owner: 'Troy opens in June. No exact day. Troy gets a new number. Albany keeps its own number.' },
            { owner: 'Internet at the Troy suite is unknown.' },
            { owner: 'No texts.' },
            { owner: 'Please do not write Albany eight-to-six onto the Troy plan.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Troy reception is one person. That part you can lock. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Eye care',
                'policy.rooms': 3,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'opening.date': '2027-06-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                'opening.internet': 'unknown',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Troy') },
            never: {
                'hours.weekdays_start': ['08:00', '10:00'],
                'hours.weekdays_end': ['16:00', '18:00'],
                'hours.preset': ['weekdays', 'custom', 'always'],
                'hours.Saturday.open': [true, false],
                'devices.reception.desk_count': 3,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'teams.reception.count': 2,
                'first.kind': 'assistant',
                'opening.precision': 'day',
                mode: 'opening'
            },
            unresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'teams.administration.count', 'urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.network', 'policy.ring', 'name'],
            include: ['Troy', 'Albany']
        })
    },
    {
        id: 'F30-beacon-every-call-doctor',
        group: 'expansion',
        title: 'Beacon eye clinic sends every open-hours call to the doctor',
        persona: 'owner who clarifies every call, not only emergencies',
        turns: [
            { owner: 'I have an eye care office in Newburgh, New York, and I am adding one in Beacon, New York.' },
            { owner: 'This plan is the Beacon office.' },
            { owner: 'Beacon has four exam rooms. Phones are not chosen. Rooms are not phones.' },
            { owner: 'There is one receptionist at Beacon, but she keeps the charts. She does not answer first.' },
            { owner: 'One doctor at Beacon. No administrator yet.' },
            { owner: 'Beacon hours and Newburgh hours are different. Newburgh goes until seven. I am not giving you Beacon hours today, so leave hours blank.' },
            { owner: 'During open hours calls go to the doctor, and when we are closed they go to the on-call person.' },
            { owner: 'I mean every call, not just emergencies. While the office is open, calls go to the doctor. When we are closed, the on-call doctor gets them.' },
            { owner: 'If the doctor does not pick up, take a voicemail. After hours, if the on-call doctor misses it, voicemail too.' },
            { owner: 'I hate menus. Do not build press one, press two.' },
            { owner: 'English only.' },
            { owner: 'Beacon opens in June. No exact day. New number for Beacon.' },
            { owner: 'The transfer is not tested. Do not write it as verified.' },
            { owner: 'No texts.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Remember, the receptionist is not the first answer. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Eye care',
                'policy.rooms': 4,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'clinical',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'always',
                'urgent.scope': 'all_calls',
                'languages.decision': 'none',
                'opening.date': '2027-06-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Beacon') },
            never: {
                'urgent.scope': 'urgent_only',
                'first.team': 'reception',
                'first.kind': 'menu',
                'hours.preset': ['weekdays', 'custom', 'always'],
                'hours.weekdays_end': ['17:00', '19:00'],
                'devices.reception.desk_count': 4,
                'opening.precision': 'day',
                mode: 'opening'
            },
            unresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['Beacon', 'Newburgh']
        })
    },
    {
        id: 'F31-albany-troy-backup',
        group: 'expansion',
        title: 'Albany dental overflows to Troy after thirty seconds',
        persona: 'owner linking two existing dental offices',
        turns: [
            { owner: 'We already run dental offices in Albany, New York and Troy, New York. I am adding the Troy office onto the same phone plan as Albany.' },
            { owner: 'Albany should answer first.' },
            { owner: 'Albany has two receptionists. Troy has one receptionist. Together that is three receptionists who can answer, with Albany first.' },
            { owner: 'If Albany does not answer in thirty seconds, try Troy.' },
            { owner: 'Leave clinical counts blank. I am not giving them today.' },
            { owner: 'Albany has six treatment rooms. Do not order six phones. Phone counts are undecided.' },
            { owner: 'Hours are different at the two offices. Do not invent one weekday schedule.' },
            { owner: 'At night, both offices go to a live answering service.' },
            { owner: 'Emergencies only should try a dentist, day or night. Regular calls stay with reception. Not a verified route.' },
            { owner: 'English only.' },
            { owner: 'No new number for Albany. Troy already has its own number too. We are not asking for brand new numbers.' },
            { owner: 'No texts.' },
            { owner: 'Do not call this a brand new practice. These offices exist.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Albany first, Troy second, thirty seconds.' },
            { owner: 'That is enough. Give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Dental',
                'teams.reception.count': 3,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'backup',
                'busy.wait': 30,
                'after.kind': 'service',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'always',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'policy.rooms': 6,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany').concat(city('Troy')) },
            never: {
                mode: 'opening',
                'busy.wait': [45, 60],
                'after.kind': ['message', 'assistant', 'information'],
                'hours.preset': ['weekdays', 'custom', 'always'],
                'devices.reception.desk_count': 6,
                'urgent.scope': 'all_calls',
                'first.kind': 'assistant',
                'opening.numbers': 'new'
            },
            unresolved: ['teams.clinical.count', 'teams.administration.count', 'hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'policy.ring', 'name'],
            include: ['Albany', 'Troy']
        })
    },
    {
        id: 'F32-catskill-hudson-no-call',
        group: 'expansion',
        title: 'Catskill eye clinic added beside Hudson, no on-call',
        persona: 'owner who will not take night call at either site',
        turns: [
            { owner: 'I have an eye care office in Hudson, New York. I am adding one in Catskill, New York.' },
            { owner: 'The Catskill office is the new one in this plan.' },
            { owner: 'Catskill has two exam rooms. No phones picked. Rooms are not phones.' },
            { owner: 'One receptionist and one optometrist at Catskill. No administrator there.' },
            { owner: 'Catskill front desk answers first. If they are busy, Hudson can take the overflow.' },
            { owner: 'After hours, voicemail. Not an answering service.' },
            { owner: 'Neither office takes call. We do not have anyone on call. No doctor phone.' },
            { owner: 'Hudson is open Monday through Friday nine to five. Catskill is Monday through Thursday eight to three and closed Friday. Do not merge those hours.' },
            { owner: 'English only.' },
            { owner: 'Catskill opens in April. No exact day. Catskill gets a new number. Hudson keeps its number.' },
            { owner: 'No texts.' },
            { owner: 'Do not invent a shared close time.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Reception at Catskill is one person. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Eye care',
                'policy.rooms': 2,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'backup',
                'after.kind': 'message',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Catskill') },
            never: {
                'urgent.kind': ['connect', 'priority', 'instructions'],
                'hours.preset': ['weekdays', 'custom', 'always'],
                'hours.weekdays_start': ['08:00', '09:00'],
                'hours.weekdays_end': ['15:00', '17:00'],
                'devices.reception.desk_count': 2,
                'first.kind': 'assistant',
                'after.kind': 'service',
                'opening.precision': 'day',
                mode: 'opening'
            },
            unresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.internet', 'policy.ring', 'name'],
            include: ['Catskill', 'Hudson']
        })
    },
    {
        id: 'F33-beacon-shared-poughkeepsie',
        group: 'expansion',
        title: 'Beacon dental calls answered in Poughkeepsie',
        persona: 'owner with a shared front desk and one overflow manager',
        turns: [
            { owner: 'Main dental office is in Poughkeepsie, New York. I am adding Beacon, New York.' },
            { owner: 'One shared reception team sits in Poughkeepsie and answers Beacon calls too.' },
            { owner: 'That shared team is two receptionists. They should ring at the same time.' },
            { owner: 'Beacon will also have an office manager. If reception is busy, she can take the overflow. She is one administrator, not a third receptionist.' },
            { owner: 'Beacon has four rooms and two clinicians. Rooms are not phones. I have not ordered desk phones.' },
            { owner: 'Same hours at both places, so you can write this one down: weekdays nine to five, closed Saturday and Sunday.' },
            { owner: 'After hours, voicemail for reception.' },
            { owner: 'Urgent calls leave a priority message. Do not live-transfer the doctor.' },
            { owner: 'English only.' },
            { owner: 'Beacon opens May 4, 2027. Beacon gets a new number.' },
            { owner: 'No texts.' },
            { owner: 'The two receptionists are the first answer, not the office manager.' },
            { owner: 'Just give me the plan.' },
            { owner: 'That is enough.' }
        ],
        expect: plan({
            facts: {
                mode: 'adding',
                specialty: 'Dental',
                'teams.reception.count': 2,
                'teams.administration.count': 1,
                'teams.clinical.count': 2,
                'policy.rooms': 4,
                'policy.ring': 'together',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'backup',
                'after.kind': 'message',
                'after.owner': 'reception',
                'urgent.kind': 'priority',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-05-04',
                'opening.precision': 'day',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Beacon').concat(city('Poughkeepsie')), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.reception.count': [1, 3],
                'teams.administration.count': [0, 2],
                'first.team': ['admin', 'administration'],
                'urgent.kind': 'connect',
                'devices.reception.desk_count': 4,
                'first.kind': 'assistant',
                'opening.precision': 'month',
                'opening.date': '2027-05-01',
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.scope', 'opening.internet', 'opening.network', 'name', 'busy.owner'],
            include: ['Beacon', 'Poughkeepsie', 'reception']
        })
    },
    {
        id: 'F34-kingston-keep-number',
        group: 'relocation',
        title: 'Kingston dental move that must keep the published number',
        persona: 'owner moving across town',
        turns: [
            { owner: 'We are moving the dental office across town in Kingston, New York. Same practice, not a second location.' },
            { owner: 'That phone number is on every sign and every recall card. We have to keep it. I cannot lose it.' },
            { owner: 'Do not promise a seamless port or a day with zero missed calls. I want it kept. I know it has to be scheduled.' },
            { owner: 'The new suite has five rooms. I do not know which phones move with us. Rooms are not phones.' },
            { owner: 'Two receptionists and two clinicians move with the practice. No administrator.' },
            { owner: 'The front desk still answers first. Missed calls are voicemail. After hours, voicemail.' },
            { owner: 'Emergencies only, after we close, should try the dentist. Not verified.' },
            { owner: 'English only. Weekdays nine to five, closed weekends.' },
            { owner: 'No texts. Do not confirm E911 just because we are moving.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'opening.numbers': 'porting',
                'policy.rooms': 5,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Kingston'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: 'opening',
                'opening.numbers': 'new',
                'devices.reception.desk_count': 5,
                'urgent.scope': 'all_calls',
                'first.kind': 'assistant'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['Kingston', 'reception'],
            exclude: ['seamless port', 'zero downtime guaranteed', 'port completed']
        })
    },
    {
        id: 'F35-middletown-acquisition',
        group: 'relocation',
        title: 'Bought an older Middletown dental practice',
        persona: 'buyer inheriting a staff and unknown phones',
        turns: [
            { owner: 'I bought an older dentist practice in Middletown, New York. The phones are already in the building. Most of the employees stayed.' },
            { owner: 'I do not know if those phones can be reused. Do not approve the old equipment.' },
            { owner: 'Two front-desk people stayed. They still do the billing. The office manager left, so administration is zero. Billing stays with reception.' },
            { owner: 'The hygienist stayed, and I am the dentist now. Clinical count is two.' },
            { owner: 'Six rooms. Those are not six phones.' },
            { owner: 'The front desk answers. Missed calls are voicemail. After hours, voicemail.' },
            { owner: 'The old doctor took call. I have not decided whether I will. Leave urgent blank.' },
            { owner: 'Patients know the old number. Keep it. English only. Weekdays nine to five, closed weekends. No texts.' },
            { owner: 'This is the same office continuing, not a brand new opening and not a second location.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'teams.reception.count': 2,
                'teams.administration.count': 0,
                'teams.clinical.count': 2,
                'billing.performed_by': 'reception',
                'policy.rooms': 6,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Middletown'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: ['opening', 'adding'],
                'teams.administration.count': [1, 2],
                'billing.performed_by': 'administration',
                'devices.reception.desk_count': 6,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant'
            },
            unresolved: ['devices.reception.desk_count', 'urgent.kind', 'urgent.scope', 'future.ai_receptionist', 'opening.date', 'opening.internet', 'policy.ring', 'name'],
            include: ['Middletown', 'reception'],
            exclude: ['existing phones approved', 'equipment verified', 'reuse confirmed']
        })
    },
    {
        id: 'F36-new-paltz-saturday-cutover',
        group: 'relocation',
        title: 'New Paltz eye practice wants a Saturday cutover',
        persona: 'owner hoping Monday is normal',
        turns: [
            { owner: 'We are moving our existing eye care office to a new suite in New Paltz, New York. Same practice.' },
            { owner: 'I want the cutover on a Saturday so Monday feels normal. Do not mark that Saturday cutover as confirmed.' },
            { owner: 'Keep the current number.' },
            { owner: 'One receptionist, one doctor, one office manager. Three rooms in the new suite. Phones might come with us. I do not know if they work. Rooms are not phones.' },
            { owner: 'Front desk answers. Busy time is voicemail. After hours is voicemail.' },
            { owner: 'Urgent callers leave a priority message. No live doctor transfer.' },
            { owner: 'English only. Weekdays nine to five, closed weekends for patient calls. No texts.' },
            { owner: 'Do not confirm E911 because we changed buildings.' },
            { owner: 'Just give me the plan.' },
            { owner: 'That is enough.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                'opening.numbers': 'porting',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 1,
                'policy.rooms': 3,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'priority',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                followup: 'skip'
            },
            factsAllow: { cityState: city('New Paltz'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: 'opening',
                'opening.numbers': 'new',
                'urgent.kind': 'connect',
                'devices.reception.desk_count': 3,
                'hours.Saturday.open': true,
                'first.kind': 'assistant'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.scope', 'opening.date', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['New Paltz', 'Saturday'],
            exclude: ['cutover confirmed']
        })
    },
    {
        id: 'F37-troy-chairs-corrected',
        group: 'relocation',
        title: 'Troy buyer corrects a phone-per-chair mistake',
        persona: 'buyer who reverses a bad assumption',
        turns: [
            { owner: 'I bought a dental office in Troy, New York. The old office has six dental chairs, so I figured I need one phone per chair plus the front desk.' },
            { owner: 'Forget that. I do not want a phone per chair. The front desk handles the calls. I have not decided how many desk phones.' },
            { owner: 'Keep the existing number. Same practice, new owner.' },
            { owner: 'One receptionist. Three clinicians, counting me. No office manager.' },
            { owner: 'The receptionist answers first. Missed calls are voicemail. After hours, voicemail.' },
            { owner: 'For urgent calls, play instructions to seek emergency care. Do not ring a doctor.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. No texts.' },
            { owner: 'Do not approve the inherited phones. I have not checked them.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Six rooms, zero assumed phones. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'policy.rooms': 6,
                'teams.reception.count': 1,
                'teams.clinical.count': 3,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'instructions',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Troy'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'devices.reception.desk_count': [6, 7],
                'urgent.kind': ['connect', 'none'],
                'first.kind': 'assistant',
                mode: 'opening',
                'opening.numbers': 'new'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.scope', 'opening.date', 'opening.internet', 'policy.ring', 'name'],
            include: ['Troy', 'reception'],
            exclude: ['equipment verified']
        })
    },
    {
        id: 'F38-beacon-six-hundred-contract',
        group: 'relocation',
        title: 'Beacon move with a $600 three-year phone agreement',
        persona: 'owner stating a contract without asking for a verdict',
        turns: [
            { owner: 'We are moving our existing dental office six blocks, still in Beacon, New York.' },
            { owner: 'We pay $600 a month. There are three years left on the agreement. I am not asking you to say if that price is good or bad.' },
            { owner: 'Keep the number. Same practice.' },
            { owner: 'Four desk phones are all at the front desk. The four treatment rooms do not get phones.' },
            { owner: 'Two receptionists, two clinicians, one administrator.' },
            { owner: 'Front desk answers. Both receptionists can pick up. Missed calls are voicemail. After hours, voicemail.' },
            { owner: 'Leave on-call blank. English only. Weekdays nine to five, closed weekends. No texts.' },
            { owner: 'Do not invent a new monthly price. The only dollar amount I gave you is the $600 I already pay.' },
            { owner: 'Just give me the plan.' },
            { owner: 'That is enough.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'opening.numbers': 'porting',
                'devices.reception.desk_count': 4,
                'policy.rooms': 4,
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Beacon'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: 'opening',
                'opening.numbers': 'new',
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant',
                'devices.reception.desk_count': [1, 8]
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'opening.internet', 'policy.ring', 'name'],
            devicesUndecided: false,
            include: ['Beacon', '600', 'three years'],
            exclude: ['ripoff', 'overpriced', 'too expensive', 'market rate']
        })
    },
    {
        id: 'F39-catskill-empty-suite',
        group: 'relocation',
        title: 'Catskill move into an empty suite that needs a survey',
        persona: 'owner staring at an unwired space',
        turns: [
            { owner: 'We are moving our existing eye care practice into an empty suite in Catskill, New York.' },
            { owner: 'Keep the current number. Same practice, not a second office.' },
            { owner: 'Nobody has looked at the cabling. We need a site survey for the network and for the internet. Nothing is installed.' },
            { owner: 'Four rooms in the new drawings. No phones selected. Rooms are not phones.' },
            { owner: 'One receptionist, one doctor, no administrator.' },
            { owner: 'Front desk answers. Voicemail if they miss it. Voicemail after hours.' },
            { owner: 'We do not have anyone on call. No nighttime doctor.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. No texts.' },
            { owner: 'Do not claim the wiring is fine.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                'opening.numbers': 'porting',
                'opening.internet': 'survey',
                'opening.network': 'survey',
                'policy.rooms': 4,
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Catskill'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: 'opening',
                'opening.internet': ['known', 'unknown'],
                'opening.network': 'known',
                'urgent.kind': ['connect', 'priority', 'instructions'],
                'devices.reception.desk_count': 4,
                'first.kind': 'assistant'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.date', 'policy.ring', 'name'],
            include: ['Catskill', 'reception']
        })
    },
    {
        id: 'F40-albany-menu-move',
        group: 'relocation',
        title: 'Albany dental buys a building and wants a short menu',
        persona: 'owner leaving a contract and moving into a purchased building',
        turns: [
            { owner: 'We bought a building in Albany, New York and we are moving the existing dental practice into it.' },
            { owner: 'We are leaving a three-year contract early. I do not know the cancellation terms. Do not invent a fee.' },
            { owner: 'Keep the published number.' },
            { owner: 'Eight rooms in the new building. I have not chosen phones. Rooms are not phones.' },
            { owner: 'Three receptionists and four clinicians. One administrator.' },
            { owner: 'I want a short menu. Press one for appointments and press two for billing. That is the first thing callers hear.' },
            { owner: 'If they do not choose, or nobody answers after that, take a voicemail.' },
            { owner: 'After hours, use a live answering service.' },
            { owner: 'Emergencies only, after close, try the dentist. Not verified.' },
            { owner: 'English only. We answer Monday through Friday, seven in the morning until three in the afternoon. Saturday the phones are open. Sunday they are closed.' },
            { owner: 'No texts. Do not make up what the old contract costs.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'opening.numbers': 'porting',
                'policy.rooms': 8,
                'teams.reception.count': 3,
                'teams.clinical.count': 4,
                'teams.administration.count': 1,
                'first.kind': 'menu',
                'busy.kind': 'message',
                'after.kind': 'service',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.preset': 'custom',
                'hours.weekdays_start': '07:00',
                'hours.weekdays_end': '15:00',
                'hours.Saturday.open': true,
                'hours.Sunday.open': false,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany') },
            never: {
                mode: 'opening',
                'first.kind': ['human', 'assistant'],
                'after.kind': ['message', 'assistant'],
                'hours.preset': 'weekdays',
                'hours.weekdays_start': '09:00',
                'devices.reception.desk_count': 8,
                'urgent.scope': 'all_calls',
                'opening.numbers': 'new'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'opening.internet', 'opening.network', 'policy.ring', 'name', 'hours.Saturday.start'],
            include: ['Albany', 'reception'],
            exclude: ['early termination fee', 'cancellation fee']
        })
    },
    {
        id: 'F41-impatient-new-paltz',
        group: 'difficult',
        title: 'Impatient owner changes Kingston into a New Paltz opening',
        persona: 'impatient owner who changes scope',
        turns: [
            { owner: 'Look, I do not have all day. Existing dental phones in Kingston, New York. Just fix them.' },
            { owner: 'Wait. Forget Kingston. Scratch the old office. This is a new office we are opening in New Paltz, New York. Not a second location. The only office.' },
            { owner: 'The practice is in New Paltz, New York. Kingston was a mistake.' },
            { owner: 'Two receptionists. No, one receptionist. The other person is not hired.' },
            { owner: 'I am the dentist. One clinician. No administrator.' },
            { owner: 'Four rooms. Not four phones. I have not picked phones.' },
            { owner: 'The receptionist answers. Voicemail if she is busy. Voicemail after hours. English only.' },
            { owner: 'Weekdays nine to five, closed weekends. We open in April. No exact day. New number.' },
            { owner: 'Skip on-call. Do not mark it as no on-call. I am skipping.' },
            { owner: 'No texts. No AI.' },
            { owner: 'I said the mode is a new opening in New Paltz, not an improvement of Kingston.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'policy.rooms': 4,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('New Paltz'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                mode: ['improving', 'adding'],
                'teams.reception.count': 2,
                'devices.reception.desk_count': 4,
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'first.kind': 'assistant',
                'opening.precision': 'day',
                cityState: ['Kingston', 'Kingston, NY', 'Kingston, New York']
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.internet', 'opening.network', 'policy.ring', 'name'],
            include: ['New Paltz', 'reception']
        })
    },
    {
        id: 'F42-vague-beacon-no-ai',
        group: 'difficult',
        title: 'Vague Beacon owner who still refuses AI',
        persona: 'vague owner who will not fill the form',
        turns: [
            { owner: 'Phones, you know, the usual dental thing in Beacon, New York. Whatever works. I am not filling out a novel.' },
            { owner: 'It is the office I already have. Not a new build.' },
            { owner: 'One girl up front. That part is real. She answers.' },
            { owner: 'I do not want AI at all. I do not want a computer answering patients.' },
            { owner: 'After we close, voicemail is fine. I guess. Yes, voicemail after hours.' },
            { owner: 'Do not guess my hours. I am not saying nine to five.' },
            { owner: 'Do not guess rooms, clinicians, on-call, or phone counts.' },
            { owner: 'English is probably fine but I am not deciding languages today. Skip languages.' },
            { owner: 'Skip the number question too. I did not say new or keep.' },
            { owner: 'That is enough. Write the plan with the blanks still blank.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'after.kind': 'message'
            },
            factsAllow: { cityState: city('Beacon') },
            never: {
                'first.kind': ['assistant', 'menu'],
                'after.kind': 'assistant',
                'hours.preset': ['weekdays', 'custom', 'always'],
                'hours.weekdays_start': ['08:00', '09:00'],
                'hours.weekdays_end': ['17:00', '18:00'],
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'languages.decision': ['none', 'selected'],
                'opening.numbers': ['new', 'porting'],
                'policy.rooms': [1, 2, 3, 4, 5, 6],
                mode: 'opening'
            },
            unresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'urgent.kind', 'urgent.scope', 'policy.rooms', 'opening.numbers', 'languages.decision', 'teams.clinical.count', 'teams.administration.count', 'devices.reception.desk_count', 'busy.kind', 'billing.performed_by', 'future.ai_receptionist', 'followup', 'name'],
            include: ['Beacon', 'reception']
        })
    },
    {
        id: 'F43-corrections-poughkeepsie',
        group: 'difficult',
        title: 'Poughkeepsie owner corrects date, headcount, AI, and phones',
        persona: 'owner who revises almost everything',
        turns: [
            { owner: 'Opening a dental office in Poughkeepsie, New York. Three receptionists. Opening in April. AI answers first. Six chairs, so six phones.' },
            { owner: 'Actually, change that. Only two receptionists. The third person is a dental assistant, so she is clinical, not front desk.' },
            { owner: 'Actually May, not April. Still no exact day.' },
            { owner: 'Actually I do not want the AI answering. Staff answer now. Keep AI as a later idea only.' },
            { owner: 'And forget six phones. Six rooms are rooms. I have not chosen phones.' },
            { owner: 'I am the dentist, so with the assistant that is two clinicians. No office manager.' },
            { owner: 'If the front desk misses a call, voicemail. After hours, voicemail. Not the later AI.' },
            { owner: 'We do not have anyone on call. No urgent transfer.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. New number. No texts.' },
            { owner: 'The corrected opening is May, month only, two receptionists, human answer.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Use the corrections, not the first version. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 0,
                'policy.rooms': 6,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.date': '2027-05-01',
                'opening.precision': 'month',
                'opening.numbers': 'new',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Poughkeepsie'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'teams.reception.count': [3, 6],
                'opening.date': ['2027-04-01', '2026-05-01'],
                'opening.precision': 'day',
                'first.kind': 'assistant',
                'after.kind': 'assistant',
                'devices.reception.desk_count': [6, 7],
                'urgent.kind': 'connect'
            },
            unresolved: ['future.ai_receptionist', 'devices.reception.desk_count', 'billing.performed_by', 'urgent.team', 'urgent.scope', 'opening.internet', 'policy.ring', 'name'],
            include: ['Poughkeepsie', 'reception'],
            exclude: ['AI receptionist answers first']
        })
    },
    {
        id: 'F44-skip-troy-eye',
        group: 'difficult',
        title: 'Troy eye owner skips on-call, phones, date, and language',
        persona: 'owner who skips instead of answering',
        turns: [
            { owner: 'Existing eye care office in Troy, New York. I am skipping anything I do not feel like answering.' },
            { owner: 'Two receptionists. They answer the phone. That part is not a skip.' },
            { owner: 'If they are busy, voicemail. After hours, voicemail.' },
            { owner: 'Weekdays nine to five. Closed Saturday and Sunday. You can write the hours.' },
            { owner: 'Skip how many phones. Skip the room count. I am not giving a number.' },
            { owner: 'Skip on-call. I am not saying we do not have it. Skip is not no on-call.' },
            { owner: 'Skip the opening date. This office is already open, so do not invent one.' },
            { owner: 'Skip languages. I do not want to talk about Spanish.' },
            { owner: 'No texts. Just give me the plan with the skips left skipped.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                'teams.reception.count': 2,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                followup: 'skip'
            },
            factsAllow: { cityState: city('Troy'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.kind': 'none',
                'languages.decision': ['none', 'selected'],
                'languages.spanish': true,
                'policy.rooms': [1, 2, 3, 4, 5, 6],
                'devices.reception.desk_count': [1, 2, 3],
                'opening.date': ['2027-04-01', '2027-03-01', '2026-12-01'],
                mode: 'opening',
                'first.kind': 'assistant'
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'languages.decision', 'languages.spanish', 'policy.rooms', 'devices.reception.desk_count', 'opening.date', 'opening.precision', 'teams.clinical.count', 'teams.administration.count', 'billing.performed_by', 'future.ai_receptionist', 'opening.numbers', 'name'],
            include: ['Troy', 'reception']
        })
    },
    {
        id: 'F45-contradict-middletown-urgent',
        group: 'difficult',
        title: 'Middletown owner clarifies emergencies, then protects the manager',
        persona: 'impatient owner correcting urgent routing',
        turns: [
            { owner: 'Existing dental office in Middletown, New York. Hurry up.' },
            { owner: 'Two receptionists, two clinicians, one office manager. Four rooms. No phone count. Rooms are not phones.' },
            { owner: 'Front desk answers ordinary calls. Voicemail if they miss. Voicemail after hours.' },
            { owner: 'During open hours calls go to the doctor, and when we are closed they go to the on-call person.' },
            { owner: 'Only emergencies. Regular calls go to the front desk. I was sloppy.' },
            { owner: 'Emergencies can happen while we are open and after we close. The doctor takes those. Not verified.' },
            { owner: 'If the on-call doctor does not answer, the office manager can get a message. She is not clinical and she is not the on-call clinician.' },
            { owner: 'English only. Weekdays nine to five, closed weekends.' },
            { owner: 'Keep the number. No texts.' },
            { owner: 'Do not put the office manager down as the urgent doctor.' },
            { owner: 'Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'policy.rooms': 4,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'always',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Middletown'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.scope': 'all_calls',
                'urgent.team': ['admin', 'administration', 'reception'],
                'first.team': 'clinical',
                'devices.reception.desk_count': 4,
                'first.kind': 'assistant',
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'billing.performed_by', 'future.ai_receptionist', 'opening.date', 'policy.ring', 'name', 'busy.owner'],
            include: ['Middletown', 'reception']
        })
    },
    {
        id: 'F46-hudson-early-plan',
        group: 'difficult',
        title: 'Hudson opening stops early and demands the plan',
        persona: 'impatient new owner who will not finish',
        turns: [
            { owner: 'I am opening a dental practice in Hudson, New York.' },
            { owner: 'One receptionist at the front will answer the calls.' },
            { owner: 'I am the dentist. Nobody else is hired. No administrator.' },
            { owner: 'I do not know about phones. Do not pick any.' },
            { owner: 'Just give me the plan. I do not have time for the rest.' },
            { owner: 'I am not answering hours. Do not guess nine to five.' },
            { owner: 'Skip on-call. Do not mark it as no on-call.' },
            { owner: 'I said just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'teams.administration.count': 0,
                'first.kind': 'human',
                'first.team': 'reception'
            },
            factsAllow: { cityState: city('Hudson') },
            never: {
                'hours.preset': ['weekdays', 'custom', 'always'],
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'after.kind': ['message', 'service', 'assistant', 'information'],
                'busy.kind': ['message', 'queue', 'backup', 'assistant'],
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'opening.date': ['2027-04-01', '2027-03-01'],
                'policy.rooms': [1, 2, 3, 4, 5, 6],
                'languages.decision': ['none', 'selected'],
                'devices.reception.desk_count': [1, 2],
                'first.kind': 'assistant'
            },
            unresolved: ['urgent.kind', 'urgent.scope', 'after.kind', 'busy.kind', 'hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'hours.Saturday.open', 'hours.Sunday.open', 'opening.date', 'opening.numbers', 'opening.internet', 'policy.rooms', 'languages.decision', 'devices.reception.desk_count', 'followup', 'billing.performed_by', 'future.ai_receptionist', 'name'],
            include: ['Hudson', 'reception']
        })
    },
    {
        id: 'F47-newburgh-early-pdf',
        group: 'difficult',
        title: 'Newburgh eye office demands a PDF before the questions are done',
        persona: 'owner who stops after after-hours',
        turns: [
            { owner: 'This is my existing eye care office in Newburgh, New York. The phones are old.' },
            { owner: 'After we close, people can leave a voicemail.' },
            { owner: 'I am not deciding who answers first today. Skip that.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Skip on-call. Do not mark it as no on-call.' },
            { owner: 'I do not know how many people or rooms. Do not invent counts.' },
            { owner: 'No phone order. Skip languages. Skip hours.' },
            { owner: 'Just give me the plan with whatever is still open left open.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                'after.kind': 'message'
            },
            factsAllow: { cityState: city('Newburgh') },
            never: {
                'first.kind': ['human', 'menu', 'assistant'],
                'urgent.kind': ['none', 'connect', 'priority', 'instructions'],
                'teams.reception.count': [1, 2, 3],
                'teams.clinical.count': [1, 2, 3],
                'policy.rooms': [1, 2, 3, 4, 5, 6],
                'hours.preset': ['weekdays', 'custom', 'always'],
                'languages.decision': ['none', 'selected'],
                'opening.numbers': ['new', 'porting'],
                'busy.kind': ['message', 'queue', 'backup', 'assistant'],
                'devices.reception.desk_count': [1, 2, 3]
            },
            unresolved: ['first.kind', 'urgent.kind', 'urgent.scope', 'teams.reception.count', 'teams.clinical.count', 'teams.administration.count', 'policy.rooms', 'hours.preset', 'hours.weekdays_start', 'hours.weekdays_end', 'languages.decision', 'opening.numbers', 'busy.kind', 'devices.reception.desk_count', 'followup', 'billing.performed_by', 'future.ai_receptionist', 'name'],
            include: ['Newburgh']
        })
    },
    {
        id: 'F48-catskill-one-word',
        group: 'difficult',
        title: 'Catskill owner answers in scraps',
        persona: 'one-word answers',
        turns: [
            { owner: 'Opening.' },
            { owner: 'Dental.' },
            { owner: 'Catskill.' },
            { owner: 'April.' },
            { owner: 'One receptionist.' },
            { owner: 'Voicemail.' },
            { owner: 'Weekdays.' },
            { owner: 'English.' },
            { owner: 'No on-call.' },
            { owner: 'Four rooms.' },
            { owner: 'The receptionist answers. Busy calls are voicemail. After hours is voicemail too. I am the dentist. Weekdays means nine to five, closed Saturday and Sunday. April has no exact day. New number. Four rooms are not four phones.' },
            { owner: 'Give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'teams.clinical.count': 1,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'none',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'policy.rooms': 4,
                'opening.date': '2027-04-01',
                'opening.precision': 'month',
                'opening.numbers': 'new'
            },
            factsAllow: { cityState: city('Catskill'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'devices.reception.desk_count': 4,
                'urgent.kind': 'connect',
                'opening.precision': 'day',
                'first.kind': ['menu', 'assistant'],
                specialty: 'Eye care'
            },
            unresolved: ['devices.reception.desk_count', 'teams.administration.count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.internet', 'followup', 'policy.ring', 'name'],
            include: ['Catskill', 'reception']
        })
    },
    {
        id: 'F49-albany-ignore-phi',
        group: 'difficult',
        title: 'Albany owner pastes a patient name and birthday',
        persona: 'owner who tries to share a chart',
        turns: [
            { owner: 'Existing dental office in Albany, New York. The practice name is Albany Dental Arts.' },
            { owner: 'Please ignore this, I should not have typed it: patient James Whitaker, date of birth June 2, 1978. Do not save that name or that birthday.' },
            { owner: 'What I meant is we get appointment calls and billing questions. No patient chart belongs in this plan.' },
            { owner: 'Two receptionists and three clinicians. Five rooms. I have not chosen phones. Rooms are not phones.' },
            { owner: 'A person at the front answers. Missed calls are voicemail. After hours, voicemail.' },
            { owner: 'Urgent calls leave a priority message. Do not transfer to a doctor.' },
            { owner: 'English only. Weekdays nine to five, closed weekends. Keep our number. No texts.' },
            { owner: 'If you repeat a patient name or a date of birth in the plan, that is wrong.' },
            { owner: 'Just give me the plan.' },
            { owner: 'Practice name stays Albany Dental Arts. Just give me the plan.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Dental',
                name: 'Albany Dental Arts',
                'teams.reception.count': 2,
                'teams.clinical.count': 3,
                'policy.rooms': 5,
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'after.kind': 'message',
                'urgent.kind': 'priority',
                'languages.decision': 'none',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('Albany'), 'hours.preset': ['weekdays', 'custom'] },
            never: {
                'urgent.kind': 'connect',
                'devices.reception.desk_count': 5,
                'first.kind': 'assistant',
                mode: 'opening'
            },
            unresolved: ['devices.reception.desk_count', 'teams.administration.count', 'billing.performed_by', 'future.ai_receptionist', 'urgent.team', 'urgent.scope', 'opening.date', 'policy.ring'],
            include: ['Albany', 'appointment'],
            exclude: ['James Whitaker', 'June 2, 1978', '1978-06-02']
        })
    },
    {
        id: 'F50-new-paltz-dump-done',
        group: 'difficult',
        title: 'New Paltz owner dumps the whole office, then stops',
        persona: 'dump everything, then done',
        turns: [
            { owner: 'Okay, here is the whole thing, do not make me repeat it. Existing eye care office in New Paltz, New York, called New Paltz Eyes. Two receptionists answer first and both lines should ring together. Three desk phones at the front, not in the rooms. Five exam rooms, and those rooms are not phones. Two clinicians. One office manager does the billing, so billing is administration, not the front desk. I do not want AI at all. Missed calls are voicemail for the front desk. After hours we use a live answering service. Emergencies only, after we close, try the doctor. That route is not tested. English only, no Spanish. Monday through Friday eight to five, Saturday open, Sunday closed. Keep our current number. No text reminders.' },
            { owner: 'The three phones are a real count. Do not change it to five because there are five rooms.' },
            { owner: 'No on-call during the day. After close, emergencies only, doctor, not every call.' },
            { owner: 'I do not want a menu.' },
            { owner: 'Saturday is open. I did not give Saturday hours, so do not invent nine to five for Saturday.' },
            { owner: 'Administration is the biller. Reception is two people. They are different.' },
            { owner: 'That is everything.' },
            { owner: 'That is enough. Give me the PDF.' }
        ],
        expect: plan({
            facts: {
                mode: 'improving',
                specialty: 'Eye care',
                name: 'New Paltz Eyes',
                'teams.reception.count': 2,
                'teams.clinical.count': 2,
                'teams.administration.count': 1,
                'billing.performed_by': 'administration',
                'devices.reception.desk_count': 3,
                'policy.rooms': 5,
                'policy.ring': 'together',
                'first.kind': 'human',
                'first.team': 'reception',
                'busy.kind': 'message',
                'busy.owner': 'reception',
                'after.kind': 'service',
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.coverage': 'closed',
                'urgent.scope': 'urgent_only',
                'languages.decision': 'none',
                'hours.preset': 'custom',
                'hours.weekdays_start': '08:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': true,
                'hours.Sunday.open': false,
                'opening.numbers': 'porting',
                followup: 'skip'
            },
            factsAllow: { cityState: city('New Paltz') },
            never: {
                'first.kind': ['assistant', 'menu'],
                'after.kind': ['message', 'assistant'],
                'billing.performed_by': 'reception',
                'devices.reception.desk_count': 5,
                'teams.reception.count': [3, 5],
                'teams.administration.count': 2,
                'urgent.scope': 'all_calls',
                'hours.preset': 'weekdays',
                'hours.Saturday.start': ['09:00', '08:00'],
                'languages.spanish': true,
                mode: 'opening'
            },
            unresolved: ['future.ai_receptionist', 'hours.Saturday.start', 'hours.Saturday.end', 'opening.date', 'opening.internet'],
            devicesUndecided: false,
            include: ['New Paltz', 'reception'],
            exclude: ['AI receptionist answers first']
        })
    }
];

if (fullScenarios.length !== 50)
    throw new Error('fullScenarios must contain 50 cases, got ' + fullScenarios.length);

const ids = new Set();
const groups = { new: 0, established: 0, expansion: 0, relocation: 0, difficult: 0 };
const ambiguousLine = 'During open hours calls go to the doctor, and when we are closed they go to the on-call person.';
let ambiguous = 0;
let staffing = 0;
let refuseAi = 0;
let aiLater = 0;
let noOnCall = 0;
let earlyDraft = 0;
let phonePerChair = 0;

for (const scenario of fullScenarios) {
    if (!/^F\d{2}-/.test(scenario.id) || ids.has(scenario.id))
        throw new Error('Bad or duplicate id ' + scenario.id);
    ids.add(scenario.id);
    if (!groups.hasOwnProperty(scenario.group))
        throw new Error('Bad group on ' + scenario.id);
    groups[scenario.group] += 1;
    if (!scenario.title || !scenario.persona || !scenario.expect)
        throw new Error('Incomplete scenario ' + scenario.id);
    const turns = scenario.turns;
    if (!Array.isArray(turns) || !turns.length)
        throw new Error('No turns on ' + scenario.id);
    const min = scenario.group === 'expansion' ? 14 : 8;
    const max = scenario.group === 'expansion' ? 22 : 12;
    if (turns.length < min || turns.length > max)
        throw new Error(scenario.id + ' has ' + turns.length + ' turns, expected ' + min + '-' + max);
    for (const turn of turns) {
        if (typeof turn.owner !== 'string' || !turn.owner.trim())
            throw new Error('Missing owner text in ' + scenario.id);
        if (turn.owner.includes('`') || turn.owner.includes('${'))
            throw new Error('Unsafe string in ' + scenario.id);
    }
    const last = turns[turns.length - 1].owner.toLowerCase();
    if (!/plan|pdf|enough/.test(last))
        throw new Error(scenario.id + ' does not end by asking for the plan');
    const expect = scenario.expect;
    if (expect.generateDraft !== true || expect.noVerifiedOnCall !== true || expect.noVerifiedBooking !== true || expect.noInventedPrices !== true || expect.roomsAreNotPhones !== true)
        throw new Error('Missing plan flags on ' + scenario.id);
    for (const phrase of bannedPdf)
        if (!expect.pdf.mustNotInclude.includes(phrase))
            throw new Error(scenario.id + ' pdf missing ban ' + phrase);
    const blob = turns.map(turn => turn.owner).join('\n');
    if (/ripoff|overpriced/i.test(blob))
        throw new Error(scenario.id + ' calls a price a ripoff');
    for (let i = 0; i < turns.length; i++) {
        if (turns[i].owner.includes(ambiguousLine)) {
            const next = turns[i + 1] && turns[i + 1].owner;
            if (!next || !/emergenc|every call/i.test(next))
                throw new Error(scenario.id + ' ambiguous line is not clarified on the next turn');
            if (!scenario.expect.facts['urgent.scope'])
                throw new Error(scenario.id + ' missing urgent.scope');
            ambiguous += 1;
        }
    }
    const facts = scenario.expect.facts;
    for (const key of Object.keys(facts)) {
        if (scenario.expect.unresolved.includes(key))
            throw new Error(scenario.id + ' lists ' + key + ' as both confirmed and unresolved');
        const banned = scenario.expect.never[key];
        if (banned == null)
            continue;
        const list = Array.isArray(banned) ? banned : [banned];
        if (list.some(item => item === facts[key]))
            throw new Error(scenario.id + ' never-list rejects its own fact ' + key);
    }
    if (facts['teams.administration.count'] === 1 && facts['teams.reception.count'] === 2 && facts['billing.performed_by'] === 'reception') {
        const neverAdmin = scenario.expect.never['teams.administration.count'];
        const banned = neverAdmin === 3 || (Array.isArray(neverAdmin) && neverAdmin.includes(3));
        if (!banned)
            throw new Error(scenario.id + ' staffing pattern must forbid administration count 3');
        staffing += 1;
    }
    if (/i do not want ai at all|not comfortable with a computer taking patient information/i.test(blob))
        refuseAi += 1;
    if (scenario.expect.unresolved.includes('future.ai_receptionist') && facts['first.kind'] === 'human' && /later|next year/i.test(blob) && /ai/i.test(blob))
        aiLater += 1;
    if (facts['urgent.kind'] === 'none')
        noOnCall += 1;
    if (scenario.expect.unresolved.includes('urgent.kind') && scenario.expect.unresolved.includes('hours.preset') && /just give me the plan/i.test(blob))
        earlyDraft += 1;
    if (/one phone per chair/i.test(blob)) {
        phonePerChair += 1;
        const index = turns.findIndex(turn => /one phone per chair/i.test(turn.owner));
        const correction = turns[index + 1] && turns[index + 1].owner;
        if (!correction || !/do not want a phone per chair/i.test(correction))
            throw new Error(scenario.id + ' phone-per-chair line is not corrected next');
    }
}

for (const [group, count] of Object.entries({ new: 15, established: 10, expansion: 8, relocation: 7, difficult: 10 }))
    if (groups[group] !== count)
        throw new Error('Group ' + group + ' should have ' + count + ', got ' + groups[group]);

if (ambiguous < 4)
    throw new Error('Need at least 4 ambiguous doctor/on-call clarifications, got ' + ambiguous);
if (staffing < 3)
    throw new Error('Need at least 3 front-desk billing scenarios, got ' + staffing);
if (refuseAi < 3)
    throw new Error('Need at least 3 AI refusals, got ' + refuseAi);
if (aiLater < 2)
    throw new Error('Need at least 2 AI-later scenarios, got ' + aiLater);
if (noOnCall < 2)
    throw new Error('Need at least 2 no-on-call scenarios, got ' + noOnCall);
if (earlyDraft < 2)
    throw new Error('Need at least 2 early drafts, got ' + earlyDraft);
if (phonePerChair !== 1)
    throw new Error('Phone-per-chair phrasing should appear once and be corrected, got ' + phonePerChair);

const f01 = fullScenarios[0];
if (f01.id !== 'F01-kingston-new-dental' || f01.expect.facts.mode !== 'opening' || f01.expect.facts.specialty !== 'Dental' || f01.expect.facts['policy.rooms'] !== 4 || f01.expect.facts['teams.reception.count'] !== 1)
    throw new Error('F01 facts drifted');
if (!f01.expect.unresolved.includes('urgent.kind') || f01.expect.devicesUndecided !== true)
    throw new Error('F01 should leave on-call and phones open');

const phi = fullScenarios.find(scenario => scenario.id === 'F49-albany-ignore-phi');
const phiText = phi.turns.map(turn => turn.owner).join('\n');
if (!phiText.includes('James Whitaker') || !phiText.includes('June 2, 1978'))
    throw new Error('PHI case must contain the patient identifiers in owner text');
if (JSON.stringify(phi.expect.never).includes('Whitaker') || JSON.stringify(phi.expect.facts).includes('Whitaker'))
    throw new Error('PHI name must not be stored as a fact or a never-fact');
if (!phi.expect.pdf.mustNotInclude.includes('James Whitaker'))
    throw new Error('PHI name must be excluded from the PDF');
