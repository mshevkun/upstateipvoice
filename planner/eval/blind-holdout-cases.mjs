/**
 * Blind holdout eval cases — withheld from gold fixtures.
 */
export const BLIND_CASES = [
  {
    id: "BH01",
    turns: [
      "we are finally launching a dental loft in Kingston NY june 2027 two girls at the desk front first nights voicemail weekdays nine to five"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Kingston/i.test(plan.policy?.cityState || '') && plan.specialty === 'Dental' && plan.teams?.find((t) => t.role === 'reception')?.count === 2 && plan.after?.kind === 'message'
  },
  {
    id: "BH02",
    turns: [
      "Poughkeepsie vision hall opening — my wife runs front I do exams french brochures but NOT spanish staff after hours messages ok"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Poughkeepsie/i.test(plan.policy?.cityState || '') && /Eye/i.test(plan.specialty || '') && plan.after?.kind === 'message',
    mustNot: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism)
  },
  {
    id: "BH03",
    turns: [
      "existing Newburgh spine nook chiropractic six years Maria solo desk port spectrum line voicemail closed"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && /Newburgh/i.test(plan.policy?.cityState || '') && /chiro|Chiropractic|Other/i.test((plan.specialtyDetail || '') + plan.specialty) && plan.policy?.opening?.numbers === 'porting' && plan.after?.kind === 'message'
  },
  {
    id: "BH04",
    turns: [
      "opening Beacon glow injectables med spa july 2027 two hosts ring together vm after close"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Beacon/i.test(plan.policy?.cityState || '') && (plan.specialty === 'Other healthcare practice' || /spa|med|aesthetic/i.test((plan.specialtyDetail || '') + (plan.name || '')))
  },
  {
    id: "BH05",
    turns: [
      "Rhinebeck footpath podiatry bought the suite keep number one desk hate hold music vm if slammed"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && /Rhinebeck/i.test(plan.policy?.cityState || '') && /podiatr/i.test(plan.specialtyDetail || '') && plan.policy?.opening?.numbers === 'porting'
  },
  {
    id: "BH06",
    turns: [
      "Troy skin ward dermatology four physicians three front M-F eight to five AnswerConnect nights not our trade name"
    ],
    expect: ({ plan }) => /Troy/i.test(plan.policy?.cityState || '') && plan.mode === 'improving' && /derm/i.test((plan.specialtyDetail || '') + plan.specialty) && plan.after?.kind === 'service' && !/AnswerConnect/i.test(plan.name || '')
  },
  {
    id: "BH07",
    turns: [
      "Albany rehab grid PT open seven to seven mon tue thu fri til three CLOSED wed two desk WebPT queue then vm"
    ],
    expect: ({ plan }) => /Albany/i.test(plan.policy?.cityState || '') && /physical|therapy|PT|Other/i.test((plan.specialtyDetail || '') + plan.specialty) && plan.busy?.kind === 'queue' && plan.hours?.days?.some((d) => d.day === 'Wednesday' && d.open === false)
  },
  {
    id: "BH08",
    turns: [
      "opening little molars pediatric dental Kingston lunch twelve to one to vm two front fresh number not porting"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Kingston/i.test(plan.policy?.cityState || '') && /pediatric|kids|molars/i.test((plan.name || '') + (plan.specialtyDetail || '')) && plan.policy?.opening?.numbers !== 'porting'
  },
  {
    id: "BH09",
    turns: [
      "already run Poughkeepsie dental THIS PLAN is Newburgh satellite office adding"
    ],
    expect: ({ plan }) => plan.mode === 'adding' && /Newburgh/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH10",
    turns: [
      "taking over Beacon retina hall from retiring partner not a grand opening phones trash one optician"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && /Beacon/i.test(plan.policy?.cityState || '') && /Eye/i.test(plan.specialty || '')
  },
  {
    id: "BH11",
    turns: [
      "thirty years Albany molar workshop phones rotten not reinventing wheel"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && /Albany/i.test(plan.policy?.cityState || '') && plan.specialty === 'Dental'
  },
  {
    id: "BH12",
    turns: [
      "relocating Kingston spine nook to Rhinebeck same published number THIS PLAN Rhinebeck not second location"
    ],
    expect: ({ plan }) => /Rhinebeck/i.test(plan.policy?.cityState || '') && plan.policy?.opening?.numbers === 'porting' && plan.mode !== 'opening'
  },
  {
    id: "BH13",
    turns: [
      "own Rensselaer smile adding Troy annex THIS ONE IS TROY under same brand"
    ],
    expect: ({ plan }) => plan.mode === 'adding' && /Troy/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH14",
    turns: [
      "opening Newburgh harbor dental May 2027 stagger desk phones ten seconds apart two receptionists vm nights"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Newburgh/i.test(plan.policy?.cityState || '') && plan.policy?.ring === 'order'
  },
  {
    id: "BH15",
    turns: [
      "hunt the lines one then next existing Poughkeepsie retina hall two opticians vm"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy?.ring === 'order' && /Poughkeepsie/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH16",
    turns: [
      "blast all front phones at once opening Beacon harbor dental June 2027 two desk"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy?.ring === 'together' && /Beacon/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH17",
    turns: [
      "both coordinators pick separate lines same time Kingston wire lounge ortho existing"
    ],
    expect: ({ plan }) => plan.policy?.ring === 'together' && /Kingston/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH18",
    turns: [
      "senior desk first junior if miss then vm Troy wire lounge Dolphin"
    ],
    expect: ({ plan }) => plan.policy?.ring === 'order' && /Troy/i.test(plan.policy?.cityState || '') && /Dolphin/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH19",
    turns: [
      "both busy wait ninety seconds then voicemail Newburgh rehab grid PT two front"
    ],
    expect: ({ plan }) => plan.busy?.kind === 'queue' && plan.after?.kind === 'message' && /Newburgh/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH20",
    turns: [
      "front miss try office manager then vm improving Beacon molar workshop"
    ],
    expect: ({ plan }) => plan.busy?.kind === 'backup' && plan.policy?.ring !== 'order' && /Beacon/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH21",
    turns: [
      "nights live AnswerConnect operators Albany skin ward not voicemail"
    ],
    expect: ({ plan }) => plan.after?.kind === 'service' && /Albany/i.test(plan.policy?.cityState || '') && !/AnswerConnect/i.test(plan.name || '')
  },
  {
    id: "BH22",
    turns: [
      "after close basic hours info recording no mailbox Troy spine nook"
    ],
    expect: ({ plan }) => plan.after?.kind === 'information' && /Troy/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH23",
    turns: [
      "night voicemail fine Kingston harbor dental two front"
    ],
    expect: ({ plan }) => plan.after?.kind === 'message' && /Kingston/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH24",
    turns: [
      "overnight NO mailbox use live answering crew existing Newburgh glow med spa"
    ],
    expect: ({ plan }) => plan.after?.kind === 'service' && /Newburgh/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH25",
    turns: [
      "after hours let it ring no mailbox solo Kingston footpath one girl"
    ],
    expect: ({ plan }) => plan.after?.kind !== 'message' && /Kingston/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH26",
    turns: [
      "hate hold music if desk busy just vm Beacon retina hall"
    ],
    expect: ({ plan }) => /Beacon/i.test(plan.policy?.cityState || '') && (plan.busy?.kind !== 'queue' || plan.after?.kind === 'message')
  },
  {
    id: "BH27",
    turns: [
      "Eaglesoft NOT Dentrix anymore Albany molar workshop port number"
    ],
    expect: ({ plan }) => /Eaglesoft/i.test(plan.policy?.opening?.pms || ''),
    mustNot: ({ plan }) => !/Dentrix/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH28",
    turns: [
      "moved from Dentrix to Open Dental Poughkeepsie existing harbor dental"
    ],
    expect: ({ plan }) => /Open Dental/i.test(plan.policy?.opening?.pms || ''),
    mustNot: ({ plan }) => !/Dentrix/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH29",
    turns: [
      "on Curve Hero not Dentrix Beacon dental"
    ],
    expect: ({ plan }) => /curve|hero/i.test(plan.policy?.opening?.pms || ''),
    mustNot: ({ plan }) => !/Dentrix/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH30",
    turns: [
      "ChiroTouch on every desktop Rhinebeck spine nook improving"
    ],
    expect: ({ plan }) => /ChiroTouch/i.test(plan.policy?.opening?.pms || '') && /Rhinebeck/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH31",
    turns: [
      "WebPT scheduling Newburgh rehab grid keep RingCentral digits"
    ],
    expect: ({ plan }) => /WebPT/i.test(plan.policy?.opening?.pms || '') && plan.policy?.opening?.numbers === 'porting'
  },
  {
    id: "BH32",
    turns: [
      "French menu on site NOT Spanish in office Kingston glow med spa opening"
    ],
    expect: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism),
    mustNot: ({ plan, facts }) => facts?.['languages.spanish'] !== true
  },
  {
    id: "BH33",
    turns: [
      "english only no spanish line Troy harbor dental"
    ],
    expect: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism)
  },
  {
    id: "BH34",
    turns: [
      "polish and ukrainian staff not spanish Albany misc vein clinic"
    ],
    expect: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism)
  },
  {
    id: "BH35",
    turns: [
      "bilingual english arabic not spanish Newburgh retina hall"
    ],
    expect: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism)
  },
  {
    id: "BH36",
    turns: [
      "dont route spanish Poughkeepsie spine nook one desk"
    ],
    expect: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism)
  },
  {
    id: "BH37",
    turns: [
      "brand new 845 nobody knows us opening Beacon harbor dental"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy?.opening?.numbers !== 'porting'
  },
  {
    id: "BH38",
    turns: [
      "keep line everyone dials improving Kingston molar workshop"
    ],
    expect: ({ plan }) => plan.policy?.opening?.numbers === 'porting' && plan.mode === 'improving'
  },
  {
    id: "BH39",
    turns: [
      "do NOT port want fresh tf Troy opening September 2027"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy?.opening?.numbers !== 'porting'
  },
  {
    id: "BH40",
    turns: [
      "acquired charts number stays Newburgh footpath one front"
    ],
    expect: ({ plan }) => plan.policy?.opening?.numbers === 'porting' && plan.mode === 'improving'
  },
  {
    id: "BH41",
    turns: [
      "solo I grab between patients cell Rhinebeck skin ward"
    ],
    expect: ({ plan }) => plan.teams?.find((t) => t.role === 'reception')?.count === 1 && /Rhinebeck/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH42",
    turns: [
      "wife and I both answer front no hire opening Kingston spine nook"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Kingston/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH43",
    turns: [
      "aunt bills from laptop home NOT reception Beacon harbor dental two desk"
    ],
    expect: ({ plan }) => plan.teams?.find((t) => t.role === 'reception')?.count === 2 && /Beacon/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH44",
    turns: [
      "just me at desk Troy footpath existing"
    ],
    expect: ({ plan }) => plan.teams?.find((t) => t.role === 'reception')?.count === 1 && /Troy/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH45",
    turns: [
      "two receptionists only Poughkeepsie retina hall"
    ],
    expect: ({ plan }) => plan.teams?.find((t) => t.role === 'reception')?.count === 2 && /Poughkeepsie/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH46",
    turns: [
      "CLOSED wednesdays otherwise eight to six Newburgh harbor dental"
    ],
    expect: ({ plan }) => plan.hours?.days?.some((d) => d.day === 'Wednesday' && d.open === false)
  },
  {
    id: "BH47",
    turns: [
      "Friday short day out at one rest week nine to five Albany molar workshop"
    ],
    expect: ({ plan }) => { const f = plan.hours?.days?.find((d) => d.day === 'Friday'); return !!(f && (f.end === '13:00' || f.end === '13:30' || String(f.end || '').startsWith('13'))); }
  },
  {
    id: "BH48",
    turns: [
      "lunch noon one desk empty vm Kingston retina hall existing"
    ],
    expect: ({ plan }) => plan.hours?.days?.some((d) => d.breakStart && d.breakEnd) && plan.after?.kind === 'message'
  },
  {
    id: "BH49",
    turns: [
      "lunch 1230 to 130 mon thru thu not closed all week Beacon rehab grid"
    ],
    expect: ({ plan }) => plan.hours?.days?.some((d) => /12:30|12:00/.test(String(d.breakStart || '')))
  },
  {
    id: "BH50",
    turns: [
      "snow days we shut mention snow handling Troy harbor dental"
    ],
    expect: ({ plan }) => /snow/i.test(JSON.stringify(plan)) || plan.after?.kind === 'message'
  },
  {
    id: "BH51",
    turns: [
      "six treatment bays NOT six desk phones one handset opening Poughkeepsie harbor dental"
    ],
    expect: ({ plan }) => plan.policy?.rooms === 6 && plan.endpoints?.desk !== 6
  },
  {
    id: "BH52",
    turns: [
      "ignore patient Elena Marsh DOB 11/22/1975 she called Kingston dental vm"
    ],
    expect: ({ plan, ack }) => {
    const blob = JSON.stringify(plan) + (ack || '');
    return !/Elena Marsh|Marcus Vail|tanya@example\.net|11\/22\/1975|02\/14\/1988|DOB/i.test(blob);
  }
  },
  {
    id: "BH53",
    turns: [
      "wire lounge ortho Albany Dolphin three coordinators"
    ],
    expect: ({ plan }) => /Dolphin/i.test(plan.policy?.opening?.pms || '') && /Albany/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH54",
    turns: [
      "tiny teeth pediatric studio Kingston opening two front"
    ],
    expect: ({ plan }) => /pediatric|tiny teeth/i.test((plan.name || '') + (plan.specialtyDetail || ''))
  },
  {
    id: "BH55",
    turns: [
      "AnswerConnect overnight not our dba Rhinebeck retina hall"
    ],
    expect: ({ plan }) => plan.after?.kind === 'service' && !/AnswerConnect/i.test(plan.name || '')
  },
  {
    id: "BH56",
    turns: [
      "own Middletown smiles adding Newburgh wing THIS PLAN NEWBURGH"
    ],
    expect: ({ plan }) => plan.mode === 'adding' && /Newburgh/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH57",
    turns: [
      "existing Albany site plan I want Troy expansion adding"
    ],
    expect: ({ plan }) => plan.mode === 'adding' && /Troy/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH58",
    turns: [
      "thanksgiving week weird hours still vm Beacon spine nook"
    ],
    expect: ({ plan }) => /Beacon/i.test(plan.policy?.cityState || '') && plan.after?.kind === 'message'
  },
  {
    id: "BH59",
    turns: [
      "christmas eve half day use friday short logic Kingston chiro"
    ],
    expect: ({ plan }) => /Kingston/i.test(plan.policy?.cityState || '') && plan.hours?.days?.length > 0
  },
  {
    id: "BH60",
    turns: [
      "opening Rhinebeck glow med spa two front ring order vm"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Rhinebeck/i.test(plan.policy?.cityState || '') && plan.policy?.ring === 'order'
  },
  {
    id: "BH61",
    turns: [
      "improving Troy vein clinic misc port line one desk vm"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && /Troy/i.test(plan.policy?.cityState || '') && plan.policy?.opening?.numbers === 'porting'
  },
  {
    id: "BH62",
    turns: [
      "adding Kingston glow second suite THIS PLAN IS THE NEW SUITE"
    ],
    expect: ({ plan }) => plan.mode === 'adding' && /Kingston/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH63",
    turns: [
      "opening Poughkeepsie footpath podiatry May 2027 blast ring together"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy?.ring === 'together' && /Poughkeepsie/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH64",
    turns: [
      "improving Newburgh retina queue busy two opticians"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && plan.busy?.kind === 'queue' && /Newburgh/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH65",
    turns: [
      "opening Beacon rehab grid PT august 2027 closed wed vm"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Beacon/i.test(plan.policy?.cityState || '') && /PT|physical/i.test((plan.specialtyDetail || '') + plan.specialty)
  },
  {
    id: "BH66",
    turns: [
      "improving Albany wire lounge ortho keep number porting"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy?.opening?.numbers === 'porting' && /Albany/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH67",
    turns: [
      "opening Troy skin ward june 2027 information recording after hours not vm"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.after?.kind === 'information'
  },
  {
    id: "BH68",
    turns: [
      "improving Kingston glow med spa live service nights"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && plan.after?.kind === 'service'
  },
  {
    id: "BH69",
    turns: [
      "opening Newburgh harbor dental wife and I answer until we hire"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /Newburgh/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH70",
    turns: [
      "improving Poughkeepsie molar workshop NOT dentrix we use eaglesoft"
    ],
    expect: ({ plan }) => /Eaglesoft/i.test(plan.policy?.opening?.pms || ''),
    mustNot: ({ plan }) => !/Dentrix/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH71",
    turns: [
      "opening Albany retina spring 2027 new number not port"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.policy?.opening?.numbers !== 'porting'
  },
  {
    id: "BH72",
    turns: [
      "improving Rhinebeck footpath friday one pm close"
    ],
    expect: ({ plan }) => { const f = plan.hours?.days?.find((d) => d.day === 'Friday'); return !!(f && String(f.end || '').match(/^13/)); }
  },
  {
    id: "BH73",
    turns: [
      "opening Troy spine nook chiro two desk chiro touch new line"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /ChiroTouch/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH74",
    turns: [
      "improving Beacon harbor dental busy backup manager"
    ],
    expect: ({ plan }) => plan.busy?.kind === 'backup'
  },
  {
    id: "BH75",
    turns: [
      "adding Poughkeepsie glow med spa second door THIS PLAN THAT DOOR"
    ],
    expect: ({ plan }) => plan.mode === 'adding'
  },
  {
    id: "BH76",
    turns: [
      "opening Kingston vein clinic misc july 2027 solo reception"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && plan.teams?.find((t) => t.role === 'reception')?.count === 1
  },
  {
    id: "BH77",
    turns: [
      "improving Newburgh molar aunt laptop billing not front two girls"
    ],
    expect: ({ plan }) => plan.teams?.find((t) => t.role === 'reception')?.count === 2
  },
  {
    id: "BH78",
    turns: [
      "opening Albany footpath june 2027 pediatric focus kids feet"
    ],
    expect: ({ plan }) => /pediatric|kids/i.test((plan.specialtyDetail || '') + (plan.name || ''))
  },
  {
    id: "BH79",
    turns: [
      "improving Troy retina PHI leak test Marcus Vail tanya@example.net ignore"
    ],
    expect: ({ plan, ack }) => {
    const blob = JSON.stringify(plan) + (ack || '');
    return !/Elena Marsh|Marcus Vail|tanya@example\.net|11\/22\/1975|02\/14\/1988|DOB/i.test(blob);
  }
  },
  {
    id: "BH80",
    turns: [
      "opening Rhinebeck wire lounge ortho hunt order two coords"
    ],
    expect: ({ plan }) => plan.policy?.ring === 'order' && plan.mode === 'opening'
  },
  {
    id: "BH81",
    turns: [
      "improving Kingston rehab grid webpt closed wednesday"
    ],
    expect: ({ plan }) => plan.hours?.days?.some((d) => d.day === 'Wednesday' && d.open === false)
  },
  {
    id: "BH82",
    turns: [
      "opening Poughkeepsie glow french not spanish"
    ],
    expect: ({ plan }) =>
    plan.policy?.languageDecision === 'none' ||
    !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism),
    mustNot: ({ plan, facts }) => facts?.['languages.spanish'] !== true
  },
  {
    id: "BH83",
    turns: [
      "improving Newburgh spine no mailbox nights ring"
    ],
    expect: ({ plan }) => plan.after?.kind !== 'message'
  },
  {
    id: "BH84",
    turns: [
      "opening Beacon molar eight rooms one desk phone"
    ],
    expect: ({ plan }) => plan.policy?.rooms === 8 && plan.endpoints?.desk !== 8
  },
  {
    id: "BH85",
    turns: [
      "improving Albany retina answerconnect service"
    ],
    expect: ({ plan }) => plan.after?.kind === 'service' && !/AnswerConnect/i.test(plan.name || '')
  },
  {
    id: "BH86",
    turns: [
      "opening Troy harbor dental stagger hunt dont blast"
    ],
    expect: ({ plan }) => plan.policy?.ring === 'order'
  },
  {
    id: "BH87",
    turns: [
      "improving Kingston footpath improving phones port"
    ],
    expect: ({ plan }) => plan.mode === 'improving' && plan.policy?.opening?.numbers === 'porting'
  },
  {
    id: "BH88",
    turns: [
      "adding Troy smile lab second floor THIS PLAN TROY"
    ],
    expect: ({ plan }) => plan.mode === 'adding' && /Troy/i.test(plan.policy?.cityState || '')
  },
  {
    id: "BH89",
    turns: [
      "opening Newburgh skin ward derm four rooms two desk"
    ],
    expect: ({ plan }) => /derm/i.test(plan.specialtyDetail || '')
  },
  {
    id: "BH90",
    turns: [
      "improving Rhinebeck glow lunch 12-1 vm"
    ],
    expect: ({ plan }) => plan.hours?.days?.some((d) => d.breakStart)
  },
  {
    id: "BH91",
    turns: [
      "opening Albany chiro opening mode not improving"
    ],
    expect: ({ plan }) => plan.mode === 'opening' && /chiro/i.test((plan.specialtyDetail || '') + plan.specialty)
  },
  {
    id: "BH92",
    turns: [
      "improving Poughkeepsie PT hate queues use vm"
    ],
    expect: ({ plan }) => plan.busy?.kind !== 'queue' || plan.after?.kind === 'message'
  },
  {
    id: "BH93",
    turns: [
      "opening Kingston med spa other specialty blast together"
    ],
    expect: ({ plan }) => plan.policy?.ring === 'together'
  },
  {
    id: "BH94",
    turns: [
      "improving Newburgh eye care improving not opening ack"
    ],
    expect: ({ plan, ack }) => plan.mode === 'improving' && !/^A new /i.test(ack || '')
  },
  {
    id: "BH95",
    turns: [
      "opening Beacon pediatric dental little harbor june 2027"
    ],
    expect: ({ plan }) => /pediatric|harbor/i.test(plan.name || '')
  },
  {
    id: "BH96",
    turns: [
      "improving Troy dental moved open dental from dentrix"
    ],
    expect: ({ plan }) => /Open Dental/i.test(plan.policy?.opening?.pms || ''),
    mustNot: ({ plan }) => !/Dentrix/i.test(plan.policy?.opening?.pms || '')
  },
  {
    id: "BH97",
    turns: [
      "opening Poughkeepsie vein misc other healthcare"
    ],
    expect: ({ plan }) => plan.specialty === 'Other healthcare practice'
  },
  {
    id: "BH98",
    turns: [
      "improving Albany glow holidays thanksgiving note snow"
    ],
    expect: ({ plan }) => /holiday|thanksgiving|snow/i.test(JSON.stringify(plan)) && plan.mode === 'improving'
  },
  {
    id: "BH99",
    turns: [
      "opening Newburgh retina three turn dump",
      "yeah vm after five and ring senior first",
      "also not spanish"
    ],
    expect: ({ plan }) => plan.policy?.ring === 'order' && plan.after?.kind === 'message',
    mustNot: ({ plan, facts }) =>
      facts?.['languages.spanish'] !== true &&
      (plan.policy?.languageDecision === 'none' ||
        !plan.languages?.some((l) => /spanish/i.test(l.name || '') && l.mechanism))
  },
  {
    id: "BH100",
    turns: [
      "relocating not adding Kingston harbor to Poughkeepsie pier dental keep number THIS PLAN Poughkeepsie two desk vm",
      "we are on dentrix still NOT eaglesoft"
    ],
    expect: ({ plan }) => /Poughkeepsie/i.test(plan.policy?.cityState || '') && plan.policy?.opening?.numbers === 'porting',
    mustNot: ({ plan }) => !/Eaglesoft/i.test(plan.policy?.opening?.pms || '') && /Dentrix/i.test(plan.policy?.opening?.pms || '')
  }
];
