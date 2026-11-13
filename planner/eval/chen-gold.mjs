/** Gold Chen conversation and expected Plan. Tests import this; the example script only imports CONVERSATION. */

export const CONVERSATION = [
  "I'm Dr. Maya Chen. I'm opening my own family dental practice in Kingston, New York — Chen Family Dental. I've been an associate in Poughkeepsie for fourteen years. We take possession of a Broadway build-out and I want to be seeing patients the week of March 15, 2027. Six operatories. Those are treatment rooms, not phones.",
  "Two receptionists at the front, already hired. My husband is the office manager — billing, insurance, payroll. Clinical side is me, an associate dentist joining in April, two hygienists, and two assistants. Patients should reach a person at the front desk first, not a menu.",
  "Phones: Monday through Thursday 8 AM to 5 PM. Friday 8 AM to 2 PM. Closed Saturday and Sunday. Lunch is 12:30 to 1:30 Monday through Thursday — the desk is empty, phones should close, not keep ringing. Friday is a short day, no lunch close.",
  "If both receptionists are with patients, take a message. They check the inbox first thing in the morning. They need two separate lines so they can take two callers at once. If the front is slammed, ring my husband's work mobile — a work phone, not his personal cell, and never put a personal number in a recording.",
  "After hours, next-business-day voicemail. Front desk owns those messages. If someone has swelling, trauma, or uncontrolled bleeding, try to reach the on-call dentist. That's only those urgent cases, not every call. If we miss it, still take a priority message. For a true emergency they should hang up and call 911. We rotate on-call between me and the associate. Do not put my cell in the greeting.",
  "One of the receptionists is bilingual. Spanish during open hours is enough — we cannot cover Spanish at 9 PM. English is the after-hours recording.",
  "Before we open, if someone finds the number, take a callback message. Do not advertise the number until that recording exists. New number, not porting. Internet and network still need a survey. We'll run Open Dental. Thanksgiving and Christmas we're closed. Snow days should follow the closed-hours recording — never forward the published number to a personal phone.",
  "Appointments stay with the front desk. Billing and insurance go to the office manager. Clinical questions can go to the clinical team after reception screens them. We still have two analog lines and a fax for insurance; keep the fax, don't mix it with the patient number."
];

/** Fields the owner already gave on that turn. Asking any of these next is a test failure. */
export const STATED_FIELDS = [
  ['mode', 'name', 'cityState', 'specialty', 'policy.rooms', 'opening.date', 'opening.precision', 'opening.construction'],
  ['teams.reception.count', 'teams.administration.count', 'teams.clinical.count', 'billing.performed_by', 'first.kind', 'first.team'],
  ['hours.Monday.start', 'hours.Friday.end', 'hours.Saturday.open', 'hours.lunch', 'hours.Monday.break_start'],
  ['busy.kind', 'messages.owner', 'devices.reception.sharing', 'devices.work_mobile'],
  ['after.kind', 'urgent.kind', 'urgent.scope', 'urgent.coverage', 'urgent.roster', 'urgent.backup'],
  ['languages.spanish', 'languages.decision'],
  ['beforeOpening', 'opening.numbers', 'opening.internet', 'opening.network', 'opening.pms', 'holidayPolicy'],
  ['reasons.appointments.team', 'reasons.billing.team', 'reasons.clinical-question.team', 'current.lines']
];

export const ACK_NEEDLES = [
  { must: ['Kingston'], mustNot: ['Poughkeepsie'] },
  { must: ['office manager', '2 at the front', '6 clinical'], mustNot: [] },
  { must: ['12:30', 'Friday', '2 PM'], mustNot: [] },
  { must: ['work mobile'], mustNot: [] },
  { must: ['swelling', 'on-call'], mustNot: [] },
  { must: ['Spanish'], mustNot: ["I'll record that"] },
  { must: ['callback'], mustNot: ['not-open-yet'] },
  { must: ['Appointments', 'fax'], mustNot: ["I'll record that"] }
];

/** Remaining questions the owner did not settle in speech. Anything else asked is a failure. */
export const CHIP_ANSWERS = {
  'devices.administration.place': { field_id: 'devices.administration.place', value: 'computer', label: 'Computer' },
  'devices.clinical.area': { field_id: 'devices.clinical.area', value: 'internal_computer', label: 'One internal computer' }
};

export const STILL_OPEN_GOLD = [
  'on-call work identity (Follow Me)',
  'E911 address on install',
  'internet & power site survey'
];

export const CHEN_GOLD = {
  name: 'Chen Family Dental',
  cityState: 'Kingston, NY',
  mode: 'opening',
  specialty: 'Dental',
  rooms: 6,
  opening: {
    date: '2027-03-15',
    precision: 'day',
    construction: 'build-out',
    numbers: 'new',
    internet: 'survey',
    network: 'survey',
    pms: 'Open Dental'
  },
  teams: { reception: 2, clinical: 6, administration: 1 },
  billingPerformedBy: 'administration',
  first: { kind: 'human', team: 'reception' },
  ring: 'together',
  hours: {
    monday: { open: true, start: '08:00', end: '17:00', breakStart: '12:30', breakEnd: '13:30' },
    friday: { open: true, start: '08:00', end: '14:00', breakStart: '', breakEnd: '' },
    saturday: { open: false },
    sunday: { open: false }
  },
  holidays: ['2027-11-25', '2027-12-25'],
  holidayPolicy: 'closed',
  busy: { kind: 'message', owner: 'reception' },
  after: { kind: 'message', owner: 'reception' },
  urgent: {
    kind: 'connect',
    scope: 'urgent_only',
    coverage: 'closed',
    roster: 'rotation',
    backup: 'message',
    team: 'clinical',
    owner: 'clinical',
    instructionsNeedles: ['swelling', 'trauma', 'bleeding', '911']
  },
  language: { name: 'Spanish', mechanism: 'staff', team: 'reception', availability: 'open' },
  beforeOpening: 'message',
  reasons: { appointments: 'reception', billing: 'admin', 'clinical-question': 'clinical' },
  currentLinesNeedles: ['2 analog', 'fax'],
  continuityNeedles: ['snow', 'personal'],
  placements: [
    { team: 'reception', device: 'desk', count: 2, sharing: 'separate', access: 'outside' },
    { team: 'admin', device: 'computer', count: 1, access: 'outside' },
    { team: 'admin', device: 'mobile', count: 1, access: 'outside' },
    { team: 'clinical', device: 'computer', count: 1, access: 'internal' }
  ],
  inventedForbidden: {
    power: 'ups',
    urgentAlert: 'email',
    bomTier: 'balanced'
  }
};
