// Adversarial owner conversations, outside the eval set.
const s = (id, turns, expect = {}) => ({
  id: 'A-' + id,
  turns: turns.map(owner => ({ owner })),
  expect
});
export const adversarialScenarios = [
  s('chiro-odd-hours', [
    "I'm Dr. Patel, Saratoga Spine & Wellness in Saratoga Springs. Existing chiropractic office, been here 6 years. We're open Monday, Wednesday, Friday 7:30 to 6:30, Tuesday and Thursday 2 to 7, Saturday 8 to noon. Closed Sunday. No lunch close.",
    "One front desk person, Maria. Me and one other chiropractor, two massage therapists. We use ChiroTouch. Our number is with Spectrum, we want to keep it and port it.",
    "When Maria is on the other line, it should ring the back office phone. After hours just voicemail, Maria checks it in the morning. No on-call."
  ], {
    facts: {
      mode: 'improving',
      specialty: 'Other healthcare practice',
      specialtyDetail: 'Chiropractic',
      name: 'Saratoga Spine & Wellness',
      'teams.reception.count': 1,
      'hours.lunch': 'covered',
      'hours.Monday.start': '07:30',
      'hours.Tuesday.start': '14:00',
      'hours.Friday.start': '07:30',
      'hours.Saturday.start': '08:00',
      'hours.Sunday.open': false,
      'opening.pms': 'ChiroTouch',
      'after.kind': 'message',
      'urgent.kind': 'none'
    },
    never: { 'hours.Friday.start': '09:00' }
  }),
  s('ortho-two-locations', [
    "We are Bright Smiles Orthodontics with two offices, Albany and Clifton Park. Same number for both. Albany is open Monday to Thursday 8 to 5, Clifton Park is Tuesday and Thursday only 9 to 6.",
    "Three treatment coordinators who answer phones, they float between offices. Two orthodontists. We use Dolphin. After hours we use an answering service called AnswerConnect. Emergencies like broken wires go to the answering service, they page the doctor."
  ], {
    facts: {
      name: 'Bright Smiles Orthodontics',
      specialty: 'Dental',
      'teams.reception.count': 3,
      'teams.clinical.count': 2,
      'after.kind': 'service',
      'opening.pms': 'Dolphin',
      'locations.names': 'Albany, Clifton Park'
    },
    never: { name: 'AnswerConnect' }
  }),
  s('pediatric-ai', [
    "Little Teeth Pediatric Dentistry, opening in Glens Falls in June 2027. I want an AI receptionist to answer after hours and book appointments in Dentrix. During the day, two receptionists answer. Lunch 12 to 1. Hours 8 to 4:30 Monday through Friday.",
    "Parents call a lot about toothaches. If a kid has a knocked out tooth after hours, call my cell 518-555-0142. Spanish would be nice but we do not have anyone who speaks it."
  ], {
    facts: {
      name: 'Little Teeth Pediatric Dentistry',
      mode: 'opening',
      specialty: 'Dental',
      'teams.reception.count': 2,
      'after.kind': 'assistant',
      'hours.lunch': 'closed',
      'languages.decision': 'none'
    },
    never: { 'languages.spanish': true }
  }),
  s('pt-closed-wed', [
    "Hudson Valley Physical Therapy in Newburgh, existing. Open 7 to 7 Monday Tuesday Thursday, 7 to 3 Friday, closed Wednesday. Two front desk, three PTs, two aides. We use WebPT. Currently on RingCentral, unhappy. Keep our number.",
    "If both front desk are busy, put callers in a queue with hold music for up to 2 minutes, then voicemail. After hours voicemail."
  ], {
    facts: {
      specialty: 'Other healthcare practice',
      specialtyDetail: 'Physical therapy',
      mode: 'improving',
      'teams.reception.count': 2,
      'hours.Wednesday.open': false,
      'opening.pms': 'WebPT',
      'current.provider': 'Ringcentral',
      'busy.kind': 'queue',
      'after.kind': 'message'
    }
  }),
  s('derm-terse', [
    "dermatology, troy ny, 4 docs, 3 front desk, 8-5 m-f, after hours answering service, keep number"
  ], {
    facts: {
      specialty: 'Other healthcare practice',
      specialtyDetail: 'Dermatology',
      'teams.clinical.count': 4,
      'teams.reception.count': 3,
      'after.kind': 'service',
      mode: 'improving'
    }
  }),
  s('phi-leak', [
    "Kingston Eye Associates, existing optometry office. Yesterday patient John Smith DOB 04/12/1961 called about his glasses and nobody answered, my email is drkim@kingstoneye.com. Two opticians answer the phone. Hours 9 to 6 weekdays, Saturday 9 to 1.",
    "After hours voicemail. Messages go to the opticians."
  ], {
    facts: {
      name: 'Kingston Eye Associates',
      specialty: 'Eye care',
      mode: 'improving',
      'teams.reception.count': 2,
      'after.kind': 'message'
    },
    never: { name: 'AnswerConnect' }
  }),
  s('med-spanish-menu', [
    "Family medicine in Poughkeepsie, Valley Family Medicine, existing. We want a menu: press 1 for appointments, 2 for prescription refills, 3 for billing, and press 9 for Spanish. Three receptionists, one billing person, four providers. 8 to 5 weekdays.",
    "After hours an on-call provider through the answering service. Refill requests should go to the nurse voicemail."
  ], {
    facts: {
      name: 'Valley Family Medicine',
      specialty: 'Other healthcare practice',
      specialtyDetail: 'Family medicine',
      mode: 'improving',
      'first.kind': 'menu',
      'teams.reception.count': 3,
      'after.kind': 'service'
    }
  }),
  s('contradiction', [
    "Opening Rosendale Dental in Rosendale NY, May 2027. Two receptionists. We are open 8 to 5.",
    "Actually we are open 9 to 6, not 8 to 5. And it is three receptionists, I forgot Jen.",
    "No wait, Fridays we close at 1."
  ], {
    facts: {
      mode: 'opening',
      specialty: 'Dental',
      'teams.reception.count': 3,
      'hours.Friday.end': '13:00'
    }
  }),
  s('solo-no-staff', [
    "It's just me, a solo dentist starting out in Woodstock. No staff yet. I'll answer the phone myself between patients on my cell. Open Tuesday to Saturday 9 to 5."
  ], {
    facts: {
      specialty: 'Dental',
      'first.kind': 'human',
      'first.team': 'clinical',
      'hours.Tuesday.start': '09:00',
      'hours.Saturday.start': '09:00'
    }
  }),
  s('vague', [
    "honestly i dont know anything about phones, we just need it to work. small dental office. help"
  ], {
    facts: { specialty: 'Dental' }
  })
];
