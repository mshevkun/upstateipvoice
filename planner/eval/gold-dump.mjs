/** Paragraph dumps the way owners actually talk. One turn, many facts. */

const bannedPdf = ['verified on-call transfer', 'E911 confirmed', 'Dentrix booking enabled'];

function dump(partial) {
  return {
    facts: partial.facts || {},
    factsAllow: partial.factsAllow || {},
    never: partial.never || {},
    unresolved: partial.unresolved || [],
    devicesUndecided: partial.devicesUndecided !== false,
    roomsAreNotPhones: true,
    noVerifiedOnCall: true,
    noVerifiedBooking: true,
    noInventedPrices: true,
    generateDraft: true,
    pdf: {
      mustInclude: partial.include || [],
      mustNotInclude: bannedPdf.concat(partial.exclude || [])
    }
  };
}

export const dumpScenarios = [
  {
    id: 'D01-rhinebeck-history-city',
    group: 'dump',
    title: 'Rhinebeck opener who used to work in Poughkeepsie',
    persona: 'new dentist',
    turns: [
      { owner: 'I spent ten years as an associate in Poughkeepsie. Now I am opening Rhinebeck Family Dental in Rhinebeck, New York. Two receptionists, I am the dentist, one assistant. Front desk answers first. Weekdays 8 to 5. After hours take a message. Four operatories, those are rooms not phones. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        specialty: 'Dental',
        'teams.reception.count': 2,
        'teams.clinical.count': 2,
        'first.kind': 'human',
        'after.kind': 'message',
        'policy.rooms': 4
      },
      factsAllow: { cityState: ['Rhinebeck, NY', 'Rhinebeck, New York', 'Rhinebeck'] },
      never: { cityState: ['Poughkeepsie', 'Poughkeepsie, NY'] },
      include: ['Rhinebeck']
    })
  },
  {
    id: 'D02-buffalo-wife-books',
    group: 'dump',
    title: 'Buffalo existing office, wife does the books',
    persona: 'established',
    turns: [
      { owner: 'We have had this dental office in Buffalo, NY for twenty years. Phones are a mess. My wife does the books. One girl at the front. I am the dentist plus a hygienist. When we are open she answers. If she is busy take a voicemail. After hours voicemail. English is enough. That is enough, give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'improving',
        specialty: 'Dental',
        'teams.reception.count': 1,
        'teams.administration.count': 1,
        'billing.performed_by': 'administration',
        'first.kind': 'human',
        'busy.kind': 'message',
        'after.kind': 'message',
        'languages.decision': 'none'
      },
      factsAllow: { cityState: ['Buffalo, NY', 'Buffalo, New York', 'Buffalo'] },
      include: ['Buffalo']
    })
  },
  {
    id: 'D03-scranton-brother-in-law',
    group: 'dump',
    title: 'Scranton PA, brother-in-law does billing',
    persona: 'opening',
    turns: [
      { owner: 'Opening a dental practice in Scranton, Pennsylvania. My brother-in-law does the books. Two people at the front who can both pick up. Six chairs, not six phones. Front desk first. After hours take a message. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        specialty: 'Dental',
        'teams.reception.count': 2,
        'teams.administration.count': 1,
        'devices.reception.sharing': 'separate',
        'first.kind': 'human',
        'after.kind': 'message',
        'policy.rooms': 6
      },
      factsAllow: { cityState: ['Scranton, PA', 'Scranton, Pennsylvania', 'Scranton'] }
    })
  },
  {
    id: 'D04-burlington-half-hour-lunch',
    group: 'dump',
    title: 'Burlington VT with 12:30 lunch',
    persona: 'opening',
    turns: [
      { owner: 'We are opening in Burlington, Vermont. Monday through Thursday 8 AM to 5 PM, Friday 8 to 2. Lunch is 12:30 to 1:30 Monday through Thursday, Friday no lunch close. Closed weekends. Front desk answers. Two receptionists. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        'teams.reception.count': 2,
        'first.kind': 'human',
        'hours.lunch': 'closed',
        'hours.Monday.start': '08:00',
        'hours.Monday.end': '17:00',
        'hours.Monday.break_start': '12:30',
        'hours.Monday.break_end': '13:30',
        'hours.Friday.end': '14:00',
        'hours.Saturday.open': false
      },
      factsAllow: { cityState: ['Burlington, VT', 'Burlington, Vermont', 'Burlington'] }
    })
  },
  {
    id: 'D05-eye-compulink',
    group: 'dump',
    title: 'Eye care Compulink',
    persona: 'opening optometrist',
    turns: [
      { owner: 'I am opening an eye care office in Kingston, New York. We will run Compulink. One receptionist, I am the doctor. Front desk first. After hours take a message. If someone has a sudden change in vision or an eye injury after hours, try the on-call clinician, only those urgent cases. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        specialty: 'Eye care',
        'opening.pms': 'Compulink',
        'first.kind': 'human',
        'after.kind': 'message',
        'urgent.kind': 'connect',
        'urgent.scope': 'urgent_only'
      },
      factsAllow: { cityState: ['Kingston, NY', 'Kingston, New York', 'Kingston'] }
    })
  },
  {
    id: 'D06-eye-revolutionehr',
    group: 'dump',
    title: 'Eye care RevolutionEHR',
    persona: 'improving',
    turns: [
      { owner: 'Existing optometry in Newburgh. We use RevolutionEHR. Two at the front. After hours play information and hang up. No on-call. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'improving',
        specialty: 'Eye care',
        'opening.pms': 'RevolutionEHR',
        'teams.reception.count': 2,
        'after.kind': 'information',
        'urgent.kind': 'none'
      }
    })
  },
  {
    id: 'D07-eye-officemate',
    group: 'dump',
    title: 'Eye care OfficeMate',
    persona: 'opening',
    turns: [
      { owner: 'New vision office. OfficeMate is the software. One person at the front. English is enough. Weekdays nine to five. Take a message after hours. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        specialty: 'Eye care',
        'opening.pms': 'OfficeMate',
        'teams.reception.count': 1,
        'languages.decision': 'none',
        'after.kind': 'message'
      }
    })
  },
  {
    id: 'D08-24h-emergency',
    group: 'dump',
    title: '24-hour emergency dental',
    persona: 'existing',
    turns: [
      { owner: 'We are a 24-hour emergency dental clinic in Albany. Someone answers all day and night. No after-hours voicemail. Two receptionists who both pick up. I am the dentist, two assistants. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        specialty: 'Dental',
        'hours.preset': 'always',
        'teams.reception.count': 2,
        'devices.reception.sharing': 'separate',
        'first.kind': 'human'
      },
      never: { 'after.kind': 'message' },
      factsAllow: { cityState: ['Albany, NY', 'Albany, New York', 'Albany'] }
    })
  },
  {
    id: 'D09-open-dental-callback',
    group: 'dump',
    title: 'Open Dental and before-opening callback',
    persona: 'opening',
    turns: [
      { owner: 'Opening in Catskill next March. We will run Open Dental. Before we open, if someone finds the number, take a callback message. Do not advertise until that recording exists. New number. Front desk first. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        'opening.pms': 'Open Dental',
        beforeOpening: 'message',
        'opening.numbers': 'new',
        'first.kind': 'human'
      },
      never: { beforeOpening: 'information' },
      factsAllow: { cityState: ['Catskill, NY', 'Catskill'] }
    })
  },
  {
    id: 'D10-per-day-hours',
    group: 'dump',
    title: 'Different hours by day, half-hour lunch',
    persona: 'opening',
    turns: [
      { owner: 'Hudson Family Dental. Monday through Wednesday 9 to 5, Thursday 9 to 7, Friday 8 to 1. Lunch 12:30 to 1 on weekdays except Friday. Closed Saturday and Sunday. Two receptionists, person first. Give me the plan.' }
    ],
    expect: dump({
      facts: {
        mode: 'opening',
        specialty: 'Dental',
        'teams.reception.count': 2,
        'first.kind': 'human',
        'hours.Thursday.end': '19:00',
        'hours.Friday.end': '13:00',
        'hours.Saturday.open': false,
        'hours.lunch': 'closed'
      },
      factsAllow: { cityState: ['Hudson, NY', 'Hudson'], name: ['Hudson Family Dental'] }
    })
  }
];
