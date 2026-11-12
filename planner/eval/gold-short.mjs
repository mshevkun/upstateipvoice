/**
 * Unit-level conversational gold for Upstate Practice Architect.
 * Today for date normalization is 2026-11-09, so the next April, March, May, and spring are 2027.
 * Billing done by front-desk staff is billing.performed_by reception, not extra administration headcount.
 * Rooms, chairs, and operatories are policy.rooms. They are never phone counts.
 *
 * facts            required confirmed value (exact; numbers also match their decimal strings)
 * factsAllow       required; value must be one of these
 * factsAny         required; at least one of these { field: value } pairs is confirmed
 * factsContain     required; confirmed string contains the substring (case-insensitive)
 * factsAtLeast     required; confirmed number is >= this
 * optional         if confirmed, value must be one of these; missing is ok
 * optionalContain  if confirmed, string must contain the substring; missing is ok
 * never            confirmed value must not be this scalar or any entry of the array
 * leaveUnresolved  these fields must not be confirmed
 * rememberedContain / rememberedMustNotContain
 *                  case-insensitive substrings across confirmed values, unmapped facts, and notes
 * futureConsiderationsContain
 *                  case-insensitive substrings of futureConsiderations
 * destinations     roles that must be recorded; team id admin satisfies administration
 * expectAfterTurn  checks after that owner turn (0-based), before later turns
 * intent           last-turn intent, unless intentAnyTurn then any turn may carry it
 * start            confirmed before turn 0. startQuestion is the pending question id, or null.
 * Boolean flags are plan/ack constraints and are named below on the scenarios that need them.
 * Omit a key when it does not apply. never and optional do not fail when the field is absent.
 */
export const shortScenarios = [
    {
        id: 'S01-kingston-opening',
        group: 1,
        title: 'Kingston dental opening',
        turns: [
            { owner: "I'm starting a dental practice in Kingston. Four rooms, maybe five employees. I don't know anything about phones." },
            { owner: 'Yeah, one girl at first, maybe two later.' }
        ],
        expect: {
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'policy.rooms': 4,
                'teams.reception.count': 1
            },
            factsContain: { cityState: 'Kingston' },
            never: { 'teams.reception.count': [2, 5], mode: ['improving', 'adding'] },
            devicesUndecided: true,
            roomsAreNotPhones: true
        }
    },
    {
        id: 'S02-rambling-optometry',
        group: 1,
        title: 'Rambling optometry opening',
        turns: [
            { owner: "So we're opening an eye place, you know, eye exams and glasses. My wife works the front, I'll see patients, and this other lady handles insurance, but she's only there a couple days. We're probably opening in the spring." },
            { owner: "Yeah, unless she's with somebody at the desk." }
        ],
        expect: {
            facts: {
                mode: 'opening',
                specialty: 'Eye care',
                'teams.reception.count': 1,
                'teams.administration.count': 1,
                'opening.precision': 'month',
                'billing.performed_by': 'administration'
            },
            factsAllow: {
                'opening.date': ['2027-03-01', '2027-04-01', '2027-05-01']
            },
            factsAtLeast: { 'teams.clinical.count': 1 },
            never: {
                'billing.performed_by': 'reception',
                'teams.reception.count': [2, 3]
            }
        }
    },
    {
        id: 'S03-thirty-year-office',
        group: 1,
        title: 'Thirty-year office with bad phones',
        turns: [
            { owner: "Son, I've had this office for thirty years. I'm not trying to reinvent the wheel. Our phones are just terrible." },
            { owner: 'People say they call and nobody answers, but my receptionist swears the phone never rang.' }
        ],
        expect: {
            facts: { mode: 'improving' },
            never: { mode: ['opening', 'adding'] },
            leaveUnresolved: ['busy.kind', 'first.kind', 'specialty'],
            noInventedCause: true
        }
    },
    {
        id: 'S04-second-location',
        group: 1,
        title: 'Second dental location',
        turns: [
            { owner: 'We already have one dental office in Middletown. Opening another in Newburgh. I want to keep everything under one roof.' },
            { owner: "Both. Newburgh should answer first, but if they're busy, Middletown can help." }
        ],
        expect: {
            facts: { mode: 'adding', specialty: 'Dental' },
            optional: { 'busy.kind': ['backup'] },
            leaveUnresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end'],
            doNotMergeHours: true
        }
    },
    {
        id: 'S05-wants-recommendation',
        group: 1,
        title: 'Wants a recommendation',
        turns: [
            { owner: "I don't know whether I need AI, a receptionist, or some answering company. What's best?" },
            { owner: 'Yes, but not evenings.' }
        ],
        expect: {
            optional: { 'first.kind': ['human'] },
            never: {
                'first.kind': 'assistant',
                'after.kind': ['assistant', 'message', 'service', 'information']
            },
            ackMustNotBeGeneric: true
        }
    },
    {
        id: 'S06-screenshot-staffing',
        group: 2,
        title: 'Owner, two front desk, billing is their job',
        turns: [
            { owner: "I'm the owner, I manage the practice and do office administration. Two girls work the front. They also handle billing." },
            { owner: 'Yes, exactly.' }
        ],
        expect: {
            facts: {
                'teams.administration.count': 1,
                'teams.reception.count': 2,
                'billing.performed_by': 'reception'
            },
            never: { 'teams.administration.count': 3, 'billing.performed_by': 'administration' }
        }
    },
    {
        id: 'S07-reception-correction',
        group: 2,
        title: 'Reception count corrected to assistants',
        turns: [
            { owner: "We'll have four people at reception." },
            { owner: 'No, wait, only two. The others are dental assistants.' }
        ],
        expect: {
            facts: {
                'teams.reception.count': 2,
                'teams.clinical.count': 2
            },
            never: { 'teams.reception.count': 4 }
        }
    },
    {
        id: 'S08-overlapping-shifts',
        group: 2,
        title: 'Three receptionists on overlapping shifts',
        turns: [
            { owner: "I've got three receptionists." },
            { owner: "Two in the morning and one later. There's an overlap for an hour." }
        ],
        expect: {
            facts: { 'teams.reception.count': 3 },
            devicesUndecided: true
        }
    },
    {
        id: 'S09-owner-overflow',
        group: 2,
        title: 'Owner is overflow, not a second receptionist',
        turns: [
            { owner: 'I pay the bills and run the place, but when Lisa gets overwhelmed, I pick up the phone.' },
            { owner: "Let them ring mine if hers isn't answered." }
        ],
        expect: {
            facts: {
                'teams.reception.count': 1,
                'teams.administration.count': 1
            },
            optional: { 'busy.kind': ['backup'] },
            never: { 'teams.reception.count': 2 }
        }
    },
    {
        id: 'S10-front-desk-roles',
        group: 2,
        title: 'Check-in, checkout, and the phone',
        turns: [
            { owner: "I've got three people up front. One checks patients in, one does checkout, and one is on the phone." },
            { owner: "Checkout can. Check-in shouldn't." }
        ],
        expect: {
            facts: { 'teams.reception.count': 3 },
            factsAllow: { 'teams.reception.count': [3] },
            answeringNotEntireTeam: true
        }
    },
    {
        id: 'S11-hate-menus',
        group: 3,
        title: 'A person, then a message',
        turns: [
            { owner: 'When people call my dentist office, I want a person picking up. None of that press one, press two nonsense.' },
            { owner: 'Take a message.' }
        ],
        expect: {
            facts: {
                'first.kind': 'human',
                'busy.kind': 'message',
                specialty: 'Dental'
            },
            never: { 'first.kind': 'menu' }
        }
    },
    {
        id: 'S12-simple-menu',
        group: 3,
        title: 'Press one for appointments, two for billing',
        turns: [
            { owner: "I want people to press one for appointments and two for billing. That's it." },
            { owner: 'Same girls at reception handle both.' }
        ],
        expect: {
            facts: { 'first.kind': 'menu' },
            never: { 'first.kind': ['human', 'assistant'] }
        }
    },
    {
        id: 'S13-greeting-not-menu',
        group: 3,
        title: 'Spoken greeting, then the staff',
        turns: [
            { owner: 'I want the phone to say thanks for calling Smith Dental, then the girls pick up.' },
            { owner: 'Yeah, whoever gets it.' }
        ],
        expect: {
            facts: { 'first.kind': 'human' },
            optional: { name: ['Smith Dental'], 'policy.ring': ['together'] },
            never: { 'first.kind': 'menu' }
        }
    },
    {
        id: 'S14-medical-to-doctor',
        group: 3,
        title: 'Reception answers; the doctor is not first',
        turns: [
            { owner: 'Appointments should go up front. Medical stuff goes to the doctor.' },
            { owner: "Reception first. The doctor can't be interrupted all day." }
        ],
        expect: {
            facts: { 'first.kind': 'human', 'first.team': 'reception' },
            never: { 'first.team': 'clinical' }
        }
    },
    {
        id: 'S15-no-long-greeting',
        group: 3,
        title: 'No long greeting',
        turns: [
            { owner: "I don't want a greeting that takes forever. People are busy. Just answer the phone." },
            { owner: 'Ring immediately.' }
        ],
        expect: {
            facts: { 'first.kind': 'human' },
            never: { 'first.kind': 'menu' },
            noPbxGreeting: true
        }
    },
    {
        id: 'S16-wait-forty-five',
        group: 4,
        title: 'Forty-five seconds, not five minutes',
        turns: [
            { owner: "Sometimes a patient sits on the line for five minutes. That's unacceptable." },
            { owner: 'Maybe forty-five seconds.' }
        ],
        expect: {
            factsAny: [
                { 'busy.wait': 45 },
                { 'busy.kind': 'queue' }
            ],
            never: { 'busy.wait': [300, 70, 90] }
        }
    },
    {
        id: 'S17-queue-then-voicemail',
        group: 4,
        title: 'Wait a minute, then voicemail',
        turns: [
            { owner: 'If both receptionists are on the phone, I want the next caller to wait for somebody.' },
            { owner: 'A minute. Then voicemail.' }
        ],
        expect: {
            facts: {
                'busy.kind': 'queue',
                'busy.wait': 60,
                'teams.reception.count': 2
            },
            optional: { 'policy.queueExit': ['message'] },
            never: { 'busy.wait': 85, 'after.kind': 'message' }
        }
    },
    {
        id: 'S18-albany-troy',
        group: 4,
        title: 'Albany overflows to Troy',
        turns: [
            { owner: 'If our Albany office is slammed, send calls to our Troy office.' },
            { owner: 'Albany first, Troy after thirty seconds.' }
        ],
        expect: {
            facts: { 'busy.kind': 'backup' },
            optional: { mode: ['adding', 'improving'], 'busy.wait': [30], 'busy.seconds': [30] },
            never: { mode: 'opening' },
            leaveUnresolved: ['after.kind', 'urgent.kind']
        }
    },
    {
        id: 'S19-message-owners',
        group: 4,
        title: 'Different people own different messages',
        turns: [
            { owner: "If it's money, my billing lady gets the message. If it's about somebody's tooth, the clinical people should know." },
            { owner: 'Those go to the front desk.' }
        ],
        expect: {
            optional: { specialty: ['Dental'] },
            never: { 'busy.owner': ['reception', 'clinical', 'administration', 'admin'] },
            splitVoicemail: true
        }
    },
    {
        id: 'S20-never-voicemail',
        group: 4,
        title: 'Always a person is a goal, not a plan',
        turns: [
            { owner: 'I never want a voicemail. A real person should always answer.' },
            { owner: "I haven't figured that out." }
        ],
        expect: {
            never: { 'after.kind': 'message', 'busy.kind': 'message' },
            leaveUnresolved: ['after.kind'],
            liveAnswerUnproven: true,
            ackMustNotBeGeneric: true
        }
    },
    {
        id: 'S21-april-opening',
        group: 5,
        title: 'April, month only',
        turns: [
            { owner: "We're aiming for April. Don't know the exact day." },
            { owner: 'Yes, unless construction runs late.' }
        ],
        expect: {
            facts: {
                'opening.date': '2027-04-01',
                'opening.precision': 'month'
            },
            never: { 'opening.precision': 'day', 'opening.date': ['2026-04-01', '2026-04-15'] }
        }
    },
    {
        id: 'S22-pre-opening',
        group: 5,
        title: 'Advertise in January, open in March',
        turns: [
            { owner: "We're advertising the phone number in January, but we don't open until March." },
            { owner: 'Let them leave their information.' }
        ],
        expect: {
            facts: {
                mode: 'opening',
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                beforeOpening: 'message'
            },
            never: {
                'opening.date': ['2027-01-01', '2026-03-01', '2026-01-01'],
                'opening.precision': 'day',
                'after.kind': 'message'
            },
            leaveUnresolved: ['hours.preset', 'hours.weekdays_start', 'hours.weekdays_end'],
            preOpeningNotOfficeHours: true
        }
    },
    {
        id: 'S23-reception-shorter-than-office',
        group: 5,
        title: 'Patients 8 to 6, phones 9 to 5',
        turns: [
            { owner: 'Patients come in at eight, but reception only works nine to five. We close at six.' },
            { owner: 'Voicemail is fine for now.' }
        ],
        expect: {
            facts: {
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00'
            },
            optional: { 'after.kind': ['message'], 'busy.kind': ['message'] },
            never: { 'hours.weekdays_start': '08:00', 'hours.weekdays_end': ['18:00', '20:00'] }
        }
    },
    {
        id: 'S24-lunch',
        group: 5,
        title: 'Lunch does not close the phones',
        turns: [
            { owner: 'The girls usually eat lunch around one, but it changes depending on patients.' },
            { owner: 'Usually one of them is there.' }
        ],
        expect: {
            breakStartEmpty: true
        }
    },
    {
        id: 'S25-holidays',
        group: 5,
        title: 'Holidays closed, snow is temporary',
        turns: [
            { owner: "We're closed on Thanksgiving and Christmas. And sometimes when there's a bad snowstorm." },
            { owner: "Yes. But don't tell people we're opening tomorrow if we don't know." }
        ],
        expect: {
            facts: { holidayPolicy: 'closed' },
            rememberedContain: ['Thanksgiving', 'Christmas', 'snow'],
            noReopeningTime: true
        }
    },
    {
        id: 'S26-emergency-dentist',
        group: 6,
        title: 'Emergencies to the dentist',
        turns: [
            { owner: 'If somebody has an emergency, I want it to go straight to the dentist.' },
            { owner: 'Yes, we rotate every week.' }
        ],
        expect: {
            facts: {
                'urgent.kind': 'connect',
                'urgent.team': 'clinical',
                'urgent.scope': 'urgent_only'
            },
            optional: { specialty: ['Dental'] },
            noVerifiedOnCall: true
        }
    },
    {
        id: 'S27-ambiguous-clinician',
        group: 6,
        title: 'Open-hours doctor wording is ambiguous',
        turns: [
            { owner: 'During open hours calls go to the doctor, after hours the on-call person.' },
            { owner: 'No, only emergencies. Regular calls go to reception.' }
        ],
        expectAfterTurn: [
            {
                turn: 0,
                nextQuestionIn: ['urgent.scope'],
                never: { 'first.team': 'clinical' }
            }
        ],
        expect: {
            facts: {
                'urgent.scope': 'urgent_only',
                'first.kind': 'human',
                'first.team': 'reception',
                'urgent.kind': 'connect'
            },
            never: { 'first.team': 'clinical', 'urgent.scope': 'all_calls' },
            noVerifiedOnCall: true
        }
    },
    {
        id: 'S28-no-on-call',
        group: 6,
        title: 'No nighttime on-call',
        turns: [
            { owner: "We're a small dentist office. I don't have somebody answering emergencies at night." },
            { owner: 'We tell them to seek emergency care when necessary and call us the next day.' }
        ],
        expect: {
            facts: { 'urgent.kind': 'none', specialty: 'Dental' },
            never: {
                'urgent.kind': ['connect', 'priority', 'instructions'],
                'urgent.team': ['clinical', 'reception', 'administration', 'admin']
            },
            noVerifiedOnCall: true
        }
    },
    {
        id: 'S29-ai-diagnose',
        group: 6,
        title: 'AI must not diagnose',
        turns: [
            { owner: "The AI should know when someone's eye problem is serious and tell them exactly what to do." },
            { owner: 'Yes, the doctor can take urgent calls.' }
        ],
        expect: {
            optional: { specialty: ['Eye care'], 'urgent.kind': ['connect'] },
            never: { 'first.kind': 'assistant' },
            noVerifiedOnCall: true,
            noAiDiagnosis: true,
            ackMustNotInclude: ['diagnos'],
            ackMustNotBeGeneric: true
        }
    },
    {
        id: 'S30-manager-backup',
        group: 6,
        title: 'Office manager gets a message, not clinical duty',
        turns: [
            { owner: "If the on-call doctor doesn't answer, ring the office manager." },
            { owner: "Only a message. She's not a nurse." }
        ],
        expect: {
            facts: { 'urgent.kind': 'connect', 'urgent.team': 'clinical' },
            optional: {
                'urgent.backup': ['message'],
                'teams.administration.count': [1]
            },
            never: { 'urgent.team': ['administration', 'admin'], 'urgent.backup': 'team' },
            managerNotClinical: true,
            noVerifiedOnCall: true
        }
    },
    {
        id: 'S31-ai-dentrix',
        group: 7,
        title: 'AI scheduling into Dentrix',
        turns: [
            { owner: 'I want that AI thing where patients call and it puts them right on the schedule.' },
            { owner: 'Dentrix.' }
        ],
        expect: {
            optional: { 'opening.pms': ['Dentrix', 'dentrix'], 'first.kind': ['assistant', 'human', 'undecided'] },
            rememberedContain: ['Dentrix'],
            noVerifiedBooking: true,
            assistantNotConfigured: true
        }
    },
    {
        id: 'S32-unknown-software',
        group: 7,
        title: 'Practice software name unknown',
        turns: [
            { owner: "I don't remember the name. Something my office manager set up." },
            { owner: "Yes, that's enough." }
        ],
        expect: {
            optional: { 'opening.pms': ['', 'undecided'] },
            never: { 'opening.pms': ['Dentrix', 'dentrix', 'Eaglesoft', 'Open Dental', 'OpenDental'] },
            rememberedMustNotContain: ['Dentrix']
        }
    },
    {
        id: 'S33-ai-overflow',
        group: 7,
        title: 'Staff first, AI when slammed',
        turns: [
            { owner: "I don't want a robot picking up every call. My staff should answer. But when they're slammed, let the robot help." },
            { owner: 'Twenty seconds.' }
        ],
        expect: {
            facts: { 'first.kind': 'human', 'busy.kind': 'assistant' },
            factsAny: [
                { 'busy.wait': 20 },
                { 'busy.seconds': 20 }
            ],
            never: { 'first.kind': 'assistant', 'busy.wait': [45, 40] }
        }
    },
    {
        id: 'S34-spanish-two-days',
        group: 7,
        title: 'Spanish on Tuesday and Thursday only',
        turns: [
            { owner: "Half our patients speak Spanish. Maria speaks Spanish, but she's only here Tuesdays and Thursdays." },
            { owner: 'Can AI handle Spanish?' }
        ],
        expect: {
            factsAny: [
                { 'languages.spanish': true },
                { 'languages.decision': 'selected' }
            ],
            never: { 'first.kind': 'assistant' },
            noDailySpanish: true,
            noGuaranteedAiSpanish: true
        }
    },
    {
        id: 'S35-no-ai',
        group: 7,
        title: 'No computer taking patient information',
        turns: [
            { owner: "I'm not comfortable with a computer taking patient information. What if it says something stupid?" },
            { owner: 'Just voicemail.' }
        ],
        expect: {
            facts: { 'after.kind': 'message' },
            optional: { 'first.kind': ['human'] },
            never: { 'first.kind': 'assistant' }
        }
    },
    {
        id: 'S36-six-rooms',
        group: 8,
        title: 'Six chairs are not six phones',
        turns: [
            { owner: "I've got six dental chairs. So I guess I need six phones plus reception?" },
            { owner: 'No, the front desk handles calls.' }
        ],
        expect: {
            facts: { 'policy.rooms': 6, specialty: 'Dental' },
            optional: { 'first.kind': ['human'], 'first.team': ['reception'] },
            never: { 'devices.reception.desk_count': [6, 7] },
            devicesUndecided: true,
            roomsAreNotPhones: true
        }
    },
    {
        id: 'S37-three-phones-one-number',
        group: 8,
        title: 'Three phones, one public number',
        turns: [
            { owner: 'Can I have three phones that all ring from the same number?' },
            { owner: 'Of course. All three can be on different calls.' }
        ],
        expect: {
            optional: { 'devices.reception.desk_count': [3], 'policy.ring': ['together'] },
            singlePublicNumber: true
        }
    },
    {
        id: 'S38-what-is-an-extension',
        group: 8,
        title: 'What is an extension',
        turns: [
            { owner: "What's an extension? Why are you asking me that?" },
            { owner: 'Just my front desk and office manager.' }
        ],
        expect: {
            destinations: ['reception', 'administration'],
            extensionsNotRequired: true,
            ackMustNotBeGeneric: true
        }
    },
    {
        id: 'S39-internet-outage',
        group: 8,
        title: 'Internet dies, forward to the work cell',
        turns: [
            { owner: "Our internet goes out every couple weeks. I can't have the phone die every time." },
            { owner: 'To the work cell.' }
        ],
        expect: {
            factsAllow: { 'continuity.backupRouting': ['forward', 'cellular'] },
            never: { 'continuity.internet': ['failover', 'known'] },
            failoverUnverified: true,
            ackMustNotBeGeneric: true
        }
    },
    {
        id: 'S40-price',
        group: 8,
        title: 'Current bill and a three-year term',
        turns: [
            { owner: 'My phone company wants $600 a month. Sounds ridiculous for four phones.' },
            { owner: 'Just a monthly payment and a three-year agreement.' }
        ],
        expect: {
            optionalContain: { 'current.monthly': '600' },
            optional: {
                'policy.contract': ['36', '36 months', '3 years', 'three years', 'three-year', '3-year', 36],
                contract: ['36', '36 months', '3 years', 'three years', 'three-year', '3-year', 36]
            },
            never: { 'policy.comparison': true },
            noMarketComparison: true
        }
    },
    {
        id: 'S41-keep-number',
        group: 9,
        title: 'Keep the published number',
        turns: [
            { owner: "We're moving across town. That phone number is on everything. I cannot lose it." },
            { owner: "Yes, we can't have even one day without calls." }
        ],
        expect: {
            facts: { 'opening.numbers': 'porting' },
            factsAllow: { mode: ['improving', 'adding'] },
            noSeamlessPort: true,
            noVerifiedE911: true,
            noVerifiedOnCall: true
        }
    },
    {
        id: 'S42-acquisition',
        group: 9,
        title: 'Bought an office, phones already there',
        turns: [
            { owner: "I bought an older dentist's office. The phones are there already. Can I just use them?" },
            { owner: 'Yes, and most of the employees.' }
        ],
        expect: {
            facts: { mode: 'improving', specialty: 'Dental' },
            devicesUndecided: true,
            equipmentReuseUnverified: true
        }
    },
    {
        id: 'S43-central-reception',
        group: 9,
        title: 'Two offices, one receptionist',
        turns: [
            { owner: "My two dental offices both call into one main receptionist. She's in the first office." },
            { owner: "Absolutely. Otherwise she gets confused about which doctors are there." }
        ],
        expect: {
            facts: {
                mode: 'adding',
                specialty: 'Dental',
                'first.kind': 'human',
                'teams.reception.count': 1
            },
            never: { 'teams.reception.count': 2 },
            locationEntryMustNotMerge: true
        }
    },
    {
        id: 'S44-ninth-office',
        group: 9,
        title: 'Ninth office, do not invent the template',
        turns: [
            { owner: "We have eight offices already. I'm opening a ninth. Just make it work the same way." },
            { owner: 'Same thing, except it closes at four instead of six.' }
        ],
        expect: {
            facts: { mode: 'adding', 'hours.weekdays_end': '16:00' },
            never: {
                'hours.weekdays_end': '18:00',
                'first.kind': ['human', 'menu', 'assistant'],
                'busy.kind': ['message', 'queue', 'backup', 'assistant'],
                'after.kind': ['message', 'service', 'assistant', 'information']
            },
            leaveUnresolved: ['first.kind', 'busy.kind', 'after.kind', 'urgent.kind', 'hours.weekdays_start'],
            doNotInventTemplate: true
        }
    },
    {
        id: 'S45-fax-alarm',
        group: 9,
        title: 'Fax, alarm, and old desk phones',
        turns: [
            { owner: "I've got my old fax, the alarm system, and these desk phones. I don't want to replace everything." },
            { owner: 'I have no idea.' }
        ],
        expect: {
            rememberedContain: ['fax', 'alarm'],
            devicesUndecided: true,
            analogNotOnVoip: true
        }
    },
    {
        id: 'S46-poughkeepsie-dump',
        group: 10,
        title: 'One-breath opening dump',
        turns: [
            { owner: "Okay listen. We're opening in March in Poughkeepsie. Five exam rooms. Two girls answer the phone nine to five Monday through Friday. We close Saturdays. I want the girls to answer, not a menu. After five, voicemail. If it's an emergency, the doctor takes the call. We have one desk phone already, need another, and we'll probably get a new number." },
            { owner: "We haven't figured that part out." }
        ],
        expect: {
            facts: {
                mode: 'opening',
                'opening.date': '2027-03-01',
                'opening.precision': 'month',
                'policy.rooms': 5,
                'teams.reception.count': 2,
                'first.kind': 'human',
                'after.kind': 'message',
                'hours.weekdays_start': '09:00',
                'hours.weekdays_end': '17:00',
                'hours.Saturday.open': false,
                'opening.numbers': 'new'
            },
            factsContain: { cityState: 'Poughkeepsie' },
            optional: {
                specialty: ['Dental'],
                'devices.reception.desk_count': [2],
                'urgent.scope': ['urgent_only']
            },
            never: {
                'opening.precision': 'day',
                'urgent.kind': 'connect',
                'devices.reception.desk_count': 5,
                'first.kind': 'menu'
            },
            roomsAreNotPhones: true,
            noVerifiedOnCall: true
        }
    },
    {
        id: 'S47-ring-together',
        group: 10,
        title: 'Ring together, then wait',
        start: { 'first.kind': 'human', 'teams.reception.count': 2 },
        startQuestion: null,
        turns: [
            { owner: 'Both receptionists should ring at the same time.' },
            { owner: 'Wait.' }
        ],
        expectAfterTurn: [
            { turn: 0, facts: { 'policy.ring': 'together' } },
            { turn: 1, facts: { 'busy.kind': 'queue' } }
        ],
        expect: {
            facts: {
                'first.kind': 'human',
                'teams.reception.count': 2,
                'policy.ring': 'together',
                'busy.kind': 'queue'
            }
        }
    },
    {
        id: 'S48-corrections',
        group: 10,
        title: 'May, one receptionist, AI later',
        start: {
            'opening.date': '2027-04-01',
            'opening.precision': 'month',
            'teams.reception.count': 2,
            'first.kind': 'assistant'
        },
        turns: [
            { owner: "Actually, change a few things. We're opening in May, not April. Only one receptionist, not two. And I don't want the AI answering first anymore." },
            { owner: 'Directly. But keep AI as something we might add later.' }
        ],
        expect: {
            facts: {
                'opening.date': '2027-05-01',
                'opening.precision': 'month',
                'teams.reception.count': 1,
                'first.kind': 'human'
            },
            never: {
                'teams.reception.count': 2,
                'first.kind': 'assistant',
                'opening.date': '2027-04-01',
                'opening.precision': 'day'
            },
            futureConsiderationsContain: ['ai']
        }
    },
    {
        id: 'S49-phi',
        group: 10,
        title: 'Do not store patient names or birth dates',
        turns: [
            { owner: 'I can give you the names and dates of birth of our patients so you understand what the office deals with.' },
            { owner: 'Mostly appointments and prescription questions.' }
        ],
        expect: {
            rememberedContain: ['appointment', 'prescription'],
            rememberedMustNotContain: ['date of birth', 'dates of birth', 'dob'],
            noPhiStored: true,
            ackMustNotBeGeneric: true
        }
    },
    {
        id: 'S50-give-me-the-plan',
        group: 10,
        title: 'Draft from what is already known',
        start: {
            mode: 'opening',
            specialty: 'Dental',
            'teams.reception.count': 1,
            'first.kind': 'human'
        },
        turns: [
            { owner: "That's enough. I don't have time for this. Just give me what you have." },
            { owner: "And I don't want to call anyone just to download it." }
        ],
        expect: {
            intent: 'generate_draft',
            intentAnyTurn: true,
            facts: {
                mode: 'opening',
                specialty: 'Dental',
                'teams.reception.count': 1,
                'first.kind': 'human'
            },
            never: { 'after.kind': ['message', 'service', 'assistant', 'information'] },
            leaveUnresolved: ['after.kind', 'busy.kind', 'urgent.kind', 'hours.preset', 'opening.date', 'opening.numbers', 'policy.rooms']
        }
    }
];

if (shortScenarios.length !== 50)
    throw new Error('shortScenarios must contain 50 cases, got ' + shortScenarios.length);

const ids = new Set();
const groups = {};
for (const scenario of shortScenarios) {
    if (!/^S\d{2}-/.test(scenario.id) || ids.has(scenario.id))
        throw new Error('Bad or duplicate id ' + scenario.id);
    ids.add(scenario.id);
    if (!scenario.title || !Array.isArray(scenario.turns) || scenario.turns.length < 1 || !scenario.expect)
        throw new Error('Incomplete scenario ' + scenario.id);
    for (const turn of scenario.turns)
        if (typeof turn.owner !== 'string' || !turn.owner.trim())
            throw new Error('Missing owner text in ' + scenario.id);
    groups[scenario.group] = (groups[scenario.group] || 0) + 1;
}
for (let group = 1; group <= 10; group++)
    if (groups[group] !== 5)
        throw new Error('Group ' + group + ' should have 5 scenarios');

const staffing = shortScenarios.find(scenario => scenario.id === 'S06-screenshot-staffing');
if (staffing.expect.facts['teams.administration.count'] !== 1)
    throw new Error('S06 administration count must be 1');
const neverAdmin = staffing.expect.never['teams.administration.count'];
if (neverAdmin !== 3 && !(Array.isArray(neverAdmin) && neverAdmin.includes(3)))
    throw new Error('S06 must forbid administration count 3');

const ambiguous = shortScenarios.find(scenario => scenario.id === 'S27-ambiguous-clinician');
const afterFirst = ambiguous.expectAfterTurn.find(check => check.turn === 0);
if (!afterFirst?.nextQuestionIn?.includes('urgent.scope'))
    throw new Error('S27 must allow urgent.scope after the first turn');
if (afterFirst.never?.['first.team'] !== 'clinical' && !(Array.isArray(afterFirst.never?.['first.team']) && afterFirst.never['first.team'].includes('clinical')))
    throw new Error('S27 must not confirm first.team clinical after the first turn');
