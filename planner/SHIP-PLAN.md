# Practice Planner — Ship Plan

> **Current work order: [FINAL-FIX-PLAN.md](FINAL-FIX-PLAN.md)** (2026-11-13). It supersedes §5–§6 below.

Audience: Cursor (implementer) + Upstate. Written 2026-11-13 from reading the code, not from the roadmap.
Every claim below was reproduced by running the code. Line numbers are against the working tree on `master` @ 283860a + uncommitted changes.

---

## 0. What this product is (the contract)

A free tool for a dentist or optometrist who is **about to open** (or fixing / adding a location). They talk the way they already talk. The site turns that into **one Plan** (`upstate.practice-plan.v2`, identity `planId · rN · checksum`). Two PDFs fall out of that Plan: a **6-page owner brief** and an **8+-page Fusion implementation spec**. Nothing is installed, nothing is priced, `deployable` stays `false` until an engineer passes the DID tests.

Three users, in order: **owner** (rooms, lunch, "my husband does billing") → **Upstate planner** (opens the *same* Plan at the meeting) → **Fusion engineer** (types objects, tests the real DID). The patient never sees the site; they only hear what the Plan promised.

Groq extracts facts. Everything else — Plan, scripts, scene, both PDFs, Fusion map — is deterministic.

**The one sentence that defines "done":** the gold Chen conversation, typed by a real owner on the live site, produces the Chen Plan **without `enrich()`**, the chat says back the facts the owner actually said, and the PDFs the owner downloads are the PDFs the engineer builds from.

Today that is not true. Below is exactly why, and exactly what to change.

---

## 1. Where it stands (measured, not guessed)

| Check | Result |
|---|---|
| `npm test` | 95/95 pass |
| `npm run planner:eval -- --no-groq` | 99/100 (F31 fails: clinical count should stay unresolved, got 1) |
| `examples/chen-family-dental-*.pdf` | Owner 6 pp, engineer 8 pp, identity `UP-CHEN-KINGSTON · r1 · 1b0da125` — **only because `enrich()` in `planner/scripts/example-chen-dental.mjs:77-205` overwrites the extracted plan** |
| Chen conversation through the real engine, no `enrich()` | **21 facts wrong or missing.** Full dump below |
| Live site `/planner/` | Serves `dev-B6DktFaB.js` = last commit. `owner-brief.ts` / `engineer-brief.ts` (the new 6/8-page compilers) are **untracked and not live** |
| Handoff | Doesn't exist. `GET /sessions/:id` exists on the API but the browser never calls it. "Book a time" links to `/review/` with no plan reference |

### Chen, 8 turns, no `enrich()` (this is what a real owner gets)

| Owner said | Engine recorded | Root cause |
|---|---|---|
| "opening … in Kingston, New York … associate in Poughkeepsie" | `cityState = Poughkeepsie`, Kingston pushed to notes | `pickCities` takes the **last** `in <city>` (`extract.ts:263-264`) |
| "— Chen Family Dental" | `name = ''` → PDFs say "the practice" | Name only matched after `called/named/call it` (`extract.ts:186`) |
| "me, an associate dentist, two hygienists, and two assistants" | `clinical = 4` | Roster sums only numbered nouns; "me" + "an associate" dropped (`extract.ts:361-374`) |
| "My husband is the office manager — billing, insurance, payroll" | `admin = 0, unanswered`, billing `undecided`; chat asks "how many office managers?" **seven turns in a row** | Regex needs `(\d+\|one\|an) office manager` (`extract.ts:300`) |
| "Mon–Thu 8 AM to 5 PM. Friday 8 AM to 2 PM" | Mon–**Fri** 08:00–17:00 | Only a weekday-wide `8 am.{0,8}5` match; no per-day spans (`extract.ts:498`) |
| "Lunch is 12:30 to 1:30 Mon–Thu … Friday no lunch close" | Lunch 12:00–13:00 **Mon–Fri** | No minutes in lunch regex (`extract.ts:519`); `hours.lunch=closed` fills a 12–13 default (`fields.ts:648`) |
| "They check the inbox" / "Front desk owns those messages" | `busy.owner = ''`, `after.owner = ''` | Owner regex only knows "the girls check" etc. (`extract.ts:441`) |
| "ring my husband's work mobile" | `work_mobile = app` with no team | No field for *whose* mobile |
| "swelling, trauma, uncontrolled bleeding … on-call dentist … rotate between me and the associate … still take a priority message" | coverage `always` (should be closed-hours), roster `undecided`, no cue text, `urgent.owner = ''` | No roster/cue fields; "rotate every week" is the only rotation phrase (`extract.ts:482`) |
| "One of the receptionists is bilingual. Spanish during open hours" | **nothing.** Ack: "I'll record that." | Only "speak spanish/spanish-speaking" matches (`extract.ts:199`); ack lies when nothing was accepted (`ack.ts:310`) |
| "Before we open … take a callback message. Do not advertise the number until that recording exists" | `beforeOpening = information` → caller hears "We open March 15" and **no message is taken** | The word "recording" wins over "callback" (`extract.ts:452`) — **this is a patient-losing bug** |
| "We'll run Open Dental" | `pms = ''` | Only Dentrix is recognized (`extract.ts:183`) |
| "Thanksgiving and Christmas we're closed" | policy `closed`, **no dates** | No holiday-date resolver |
| "Internet and network still need a survey" | network survey, internet `undecided` | `extract.ts:459` only sets network |
| "Appointments → front desk, billing → office manager, clinical → clinical after screening" | reasons unassigned; ack "I'll record that." | No `reasons.*.team` fields in the catalog |
| "two analog lines and a fax … keep the fax separate" | nothing | No `current.lines` field |
| "Snow days follow closed hours, never forward to a personal phone" | nothing | No continuity fields extracted |

Result on the owner's screen: Glance says **"Your practice · 19 owner decisions remaining"**, 16 `decisions()` that no question in the chat can ever answer, "What a caller hears" without press 9, and a before-opening recording that drops callers.

### Why it gets worse with Groq on, not better

1. **`HINT_WINS` lets the regex beat Groq** (`extract.ts:13-27`, applied at `extract.ts:579`). `cityState` and `teams.clinical.count` are in it, so when Groq correctly says Kingston / 6, the local "Poughkeepsie" / 4 overwrites it. That is exactly the public bug.
2. **The API strips fields Groq is allowed to set in the browser.** `sms-portal/api/src/services/practiceArchitect/fields.js` (hand-kept "in sync") is missing `hours.lunch`, `hours.weekdays_break_start/end`, `devices.reception.sharing`, `devices.work_mobile`, `messages.owner`, `beforeOpening`, `opening.construction`, `urgent.*` extras. `sanitize.js:32` drops them. So Groq *cannot* fix lunch even when it reads 12:30 correctly.
3. **Two prompts.** `planner/src/architect/prompt.ts` (102 lines) is what the eval tests. `sms-portal/api/src/services/practiceArchitect/prompt.js` (135 lines) is what production runs. The eval does not test production.
4. **The eval cannot fail on a missing fact.** `planner/eval/run.mjs:174-185`: for `full` scenarios, `got === undefined` is skipped. 99/100 passes while Chen loses 21 facts. The gold scenarios are one-fact-per-sentence; real owners dump paragraphs, and the regexes are tuned to the gold sentences ("kingston was a mistake", "girls work the front", "maria").
5. **The city list is 12 Hudson Valley towns** (`extract.ts:8-11, 33`). A practice in Rhinebeck, Buffalo, or Scranton gets no city at all.

---

## 2. Work order

Eight PRs. Do them in order; each one has an acceptance test that must go green before the next. Tests are written **first** in each PR.

> Rules for every PR: no new pages, no prices, no Groq-written copy, no public wizard, no auto-provisioning. Owner PDF stays 6 pages. `deployable` stays `false`. Don't touch `fusion.ts` object numbering (2xx/8xxx/7xxx/9xxx/5xxx/61xx).

---

### PR 1 — Gold harness (tests that tell the truth)

Nothing else is trustworthy until these exist.

**1a. `tests/planner-chen-gold.test.js` (new)**
- Import `CONVERSATION` from `planner/scripts/example-chen-dental.mjs` (move the array to `planner/eval/chen-gold.mjs` and export it; the example script imports it from there so running the test doesn't regenerate PDFs).
- Play the 8 turns through `interpretTurn` with the blank interpreter (offline path), then answer the remaining questions **by chip only** using a scripted answer map:
  - office-manager answering place → `computer` (+ the work mobile already said)
  - clinical rooms → `one internal computer in the doctors' office, no room phones`
  - anything else asked → the test fails (it means we asked something already said).
- Assert the Plan against `CHEN_GOLD` (put it in `planner/eval/chen-gold.mjs`; derive from `enrich()` **minus the things the owner never said**):

  | Field | Gold |
  |---|---|
  | `name` | `Chen Family Dental` |
  | `policy.cityState` | `Kingston, NY` |
  | `mode / specialty / rooms` | `opening / Dental / 6` |
  | `opening` | date `2027-03-15` precision `day`, construction `build-out`, numbers `new`, internet `survey`, network `survey`, pms `Open Dental` |
  | teams | reception 2, clinical **6**, administration **1** (all `known`) |
  | `billingPerformedBy` | `administration` |
  | first / ring / sharing | `human`/`reception`, `together`, reception `separate` ×2 desk |
  | hours Mon–Thu | `08:00–17:00`, break `12:30–13:30` |
  | hours Fri | `08:00–14:00`, **no break** |
  | Sat/Sun | closed |
  | holidays | `2027-11-25`, `2027-12-25`, policy `closed` |
  | busy | `message`, owner `reception`, backup `admin` (office-manager work mobile rings before the message) |
  | after | `message`, owner `reception` |
  | urgent | kind `connect`, scope `urgent_only`, coverage **`closed`**, roster `rotation`, backup `message`, team `clinical`, owner `clinical`, instructions contain `swelling`, `trauma`, `bleeding`, `911` |
  | languages | Spanish, `staff`, team `reception`, availability `open` |
  | before opening | `message`, owner `reception` |
  | reasons | appointments→reception, billing→admin, clinical-question→clinical |
  | current | lines mention `2 analog` + `fax`; notes: fax stays off the patient number |
  | continuity notes | snow days follow closed hours; never forward to a personal phone |
  | placements | reception desk×2 separate outside; admin computer×1 outside; admin mobile×1 outside; clinical computer×1 **internal** |

  **Remove from gold (enrich invented them; the owner never said them):** `continuity.power = 'ups'`, `urgentAlert = 'email'`, `bomTier = 'balanced'`. These must show as *still open* (site survey / install), not as answers.
- Assert per-turn acknowledgements (see §PR 2e for the exact strings) — must contain Kingston / never Poughkeepsie; `12:30`; `Friday` + `2 PM`; `6 clinical`; `office manager`; `callback` (never "not-open-yet recording").
- Assert: **no question is ever asked whose field the owner already gave** (track fields stated per turn; fail if `follow.affectedFields` intersects).
- Assert: final `nextQuestion(plan, facts) === null`.
- Assert: `ownerDecisions(plan)` (see PR 3) is empty; `stillOpen(plan)` equals exactly `['on-call work identity (Follow Me)', 'E911 address on install', 'internet & power site survey']`.
- Assert: `createPairedPDFs(plan)` → owner 6 pages, engineer ≥ 8, identical identity, and engineer page 01 says digit 9 BLOCKED.

**1b. Same test with Groq, from a recorded fixture.** Run Chen once through the real API path with Groq, save the 8 raw Groq responses to `planner/eval/fixtures/chen-groq.json`, and replay them in CI. Same assertions. This is the test that catches `HINT_WINS`.

**1c. Make the eval strict.** `planner/eval/run.mjs:174-185`: delete `missingOk`. A fact listed in `expect.facts` that is missing is a failure. Expect the pass rate to drop — that is the real number. Add `--groq` CI job that runs the cached fixtures.

**1d. Add 10 "dump" scenarios** to `gold-full.mjs` written the way owners actually talk: one paragraph, 6-12 facts, mixed with history ("I worked in X for 10 years"), relatives ("my wife", "my brother-in-law does the books"), per-day hours, half-hour lunches, non-Hudson cities (Rhinebeck, Buffalo, Scranton PA, Burlington VT), eye-care with a PMS (Compulink, RevolutionEHR, OfficeMate), and one 24h emergency practice. Each with full expected facts.

**Done when:** these tests exist and fail for the reasons in §1.

---

### PR 2 — Intake that cannot lie

Target: PR 1a and 1b green without `enrich()`.

**2a. Replace `HINT_WINS` with grounded arbitration** (`planner/src/architect/extract.ts:13-27, 565-634`).
- Every local parser returns `{ field_id, value, span, precision: 'exact' | 'heuristic' }`. `exact` = a structured parse over a full span (time range, day span, date, number next to its noun, `in <City>, <ST>`). `heuristic` = keyword guesses.
- Every Groq update is **grounded** before it is used: its value (or a normalized form — digits ↔ words, `12:30` ↔ `12:30 pm`, city name) must occur in the user text. Ungrounded Groq values are dropped. (Groq cannot invent Poughkeepsie; the regex can't override Kingston.)
- Arbitration per field:
  - local `exact` vs grounded Groq agree → set.
  - local `exact` vs grounded Groq disagree → **don't pick.** Mark `conflicting` and ask one confirm chip: "Kingston or Poughkeepsie for this office?" Asking is honest; guessing is not.
  - local `heuristic` vs grounded Groq → Groq wins.
  - only one source → use it.
- Delete the per-field special cases at `extract.ts:585-628` that exist only to protect `HINT_WINS`; keep the ones that encode product law (AI-later is not launch config, skip requires the word skip, after.kind is not set by before-opening talk).

**2b. Write real parsers** (new file `planner/src/architect/parse.ts`, pure functions, unit-tested one by one):
- `parseTimeRanges(text)` — `8 AM to 5 PM`, `8–5`, `8am-5pm`, `12:30 to 1:30`, `noon to 1`, `9 to 1:30`. Business-hour inference when no suffix: `1–6` → PM, `7–11` → AM, `12` → noon. Returns minutes, not hours.
- `parseDaySpans(text)` — "Monday through Thursday", "Mon–Thu", "weekdays", "Friday", "Tuesdays and Thursdays", "closed Saturday and Sunday", "closed weekends", and binds each to the nearest time range in the same sentence. Emit `hours.<Day>.start/end/open` per day — never `weekdays_*` when days were named.
- `parseLunch(text, daySpans)` — break range **and** its days ("Mon–Thu"), and negatives ("Friday no lunch close", "someone covers lunch"). `hours.lunch = closed` must never write a 12:00–13:00 default when a time was said; if no time was said, ask the lunch question with chips `12–1 / 12:30–1:30 / 1–2 / Other`, don't default silently (`fields.ts:648`).
- `parseCity(text)` — first-person anchors win: `opening (my|our|a) … in X`, `practice in X`, `office in X`, `located in X`, `X office`. History anchors are excluded: `associate in`, `worked in`, `used to`, `for N years in`, `grew up in`, `trained in`. Accept any `Capitalized Words, (NY|New York|[A-Z]{2}|<state name>)`; the 12-town list becomes a hint list only. Store `City, ST`.
- `parsePracticeName(text)` — `called|named X`, `— X` / `, X.` where X ends in `Dental|Dentistry|Family Dental|Smiles|Orthodontics|Eye Care|Eyecare|Vision|Optometry|Eye Associates|Eye Center`, or `X is the name`.
- `parseRoster(text)` — role counts by noun with determiners and self: `me` / `I` (when the speaker is a clinician: "I'm the dentist", "Dr."), `an associate`, `a hygienist`, `two assistants`, `my husband/wife/partner/brother/… is the office manager`, `the office manager`, `our biller`. Billing responsibility from "office manager — billing, insurance" or "X does billing" → `billing.performed_by` (responsibility, not a new person; law: billing at the front desk is not a third admin).
- `parseOwnership(text)` — "they/front desk check the inbox", "front desk owns those messages", "I listen to them" → `messages.owner`, `busy.owner`, `after.owner`.
- `parseUrgent(text)` — cue words (dental: swelling, trauma, bleeding, knocked-out tooth; eye: vision loss, flashes, injury, chemical) → `urgent.instructions`; "only those urgent cases, not every call" → scope; "after hours"/"on-call" context → coverage `closed`; "rotate between me and the associate", "we take turns", "weekly rotation" → new field `urgent.roster = rotation`; "if we miss it, take a priority message" → `urgent.backup = message`.
- `parseLanguages(text)` — "bilingual", "speaks Spanish", "Spanish during open hours", "can't cover Spanish at night" → Spanish `staff`, team reception, availability `open`. Same for any named language, not only Spanish.
- `parseBeforeOpening(text)` — **callback/message beats recording.** If the sentence contains `callback|call back|take a message|leave (a message|their info)`, it is `message`, regardless of "recording". `information` only when the owner says the recording just announces the date and ends.
- `parsePMS(text)` — dental: Open Dental, Dentrix, Eaglesoft, Curve, Denticon, Dentrix Ascend, Carestream/CS, Practice-Web, Fuse. Eye: Compulink, RevolutionEHR, OfficeMate, Crystal PM, MaximEyes, Eyefinity. Free-text fallback `We'll run X`/`we use X`.
- `parseHolidays(text, openingYear)` — Thanksgiving (4th Thu Nov), Christmas, New Year's, July 4, Memorial Day, Labor Day, Christmas Eve → ISO dates for the opening year, `holidayPolicy = closed`.
- `parseContinuity(text)` — "internet (and network) need a survey" → both `survey`; "snow days follow closed hours" and "never forward to a personal phone" → continuity notes (they're laws the engineer reads).
- `parseReasons(text)` — "Appointments stay with the front desk", "Billing and insurance go to the office manager", "Clinical questions to the clinical team after reception screens" → `reasons.<id>.team`.
- `parseCurrentLines(text)` — "two analog lines and a fax", "we have Spectrum", "$300 a month" → `current.lines`, `current.provider`, `current.monthly`; fax keep-separate → note.

**2c. Field catalog additions** (`planner/src/architect/fields.ts`): `urgent.roster`, `urgent.backup`, `urgent.instructions`, `urgent.owner`, `reasons.appointments.team`, `reasons.billing.team`, `reasons.clinical-question.team`, `current.lines`, `current.provider`, `continuity.notes`, `hours.holidays`, `languages.<name>` (generic), `devices.work_mobile.team`, `hours.<Day>.break_start/end` (per-day lunch). Each with a `read`/`apply` and a unit test.

**2d. One allowlist, one prompt, generated.** Add `npm run planner:sync-api` → writes `sms-portal/api/src/services/practiceArchitect/fields.generated.js` (ALLOWED/BLOCKED from `fields.ts` catalog) and `prompt.generated.js` (from `prompt.ts`). The API imports the generated files; delete the hand-kept copies. Add a test in each repo that fails if the generated file is stale (hash compare). Production now runs the prompt the eval tests.

**2e. Ack says back what was said, and admits what wasn't** (`planner/src/architect/ack.ts`).
- Build the ack from **accepted updates rendered through the same formatters the PDF uses** (`hoursSummary`, `formatOpening`, team labels). Never echo raw regex output like `march 15 2027`.
- If nothing was accepted, **never** "I'll record that." (`ack.ts:310`). Say: "I didn't turn that into a setting yet — " + the unmapped topic + the chip question. If facts went only to notes, say "Noted for the installer: …".
- Gold acks (PR 1a asserts these contain the bold facts):
  1. "A new dental office in **Kingston, NY** — **Chen Family Dental**, **6 treatment rooms** (not phones), still a build-out, aiming for **the week of March 15, 2027**."
  2. "**2 at the front desk**, both answer. **6 clinical**. Your **office manager** handles **billing and insurance**. A person answers first, no menu."
  3. "**Mon–Thu 8 AM–5 PM**, **Fri 8 AM–2 PM**, closed weekends. Phones close for lunch **12:30–1:30 Mon–Thu**; Friday has no lunch close."
  4. "If both are busy: **message, front desk checks the inbox**. **Two separate lines**. If slammed, your **office manager's work mobile** rings first — never a personal number."
  5. "After hours: **voicemail, front desk owns it**. **Press 9 after hours** for swelling, trauma, or bleeding tries the **on-call dentist (rotation)**; if missed, a **priority message**. 911 for emergencies."
  6. "**Spanish during open hours** by your bilingual receptionist. After hours is English."
  7. "Before opening: **take a callback**, don't advertise the number until that recording exists. **New number**. **Site survey** for internet and network. **Open Dental**. Closed **Thanksgiving and Christmas**. **Snow days follow closed hours**."
  8. "**Appointments → front desk, billing → office manager, clinical → clinical after screening.** The **fax stays off the patient number**."

**2f. Privacy at the intake** (this is a healthcare-adjacent public tool; fix before publishing):
- Before sending text to the API, scrub phone numbers, emails, DOBs, and `patient <Name>` patterns in the browser (`[number removed]`). Ack: "I don't store personal numbers. We'll use a work on-call phone." Law already says a personal cell is never stored — today it is stored verbatim in `planner_messages.content` (`service.js:66-71`) and sent to Groq.
- Same scrub on the server before insert (defense in depth). Add a 30-day TTL job for `planner_messages` on sessions that were never shared/locked.
- F49 (patient name + DOB) must assert the stored row has no name/DOB.

**Done when:** PR 1a + 1b green, strict eval ≥ 95% on old + new dump scenarios, F31 green, `enrich()` deleted from `example-chen-dental.mjs` and the example PDFs regenerate from conversation + chips alone with the same page counts.

---

### PR 3 — Finish the conversation

Today `decisions()` (`config.ts`) lists 16 open items for Chen. The chat has only 19 questions (`questions.ts`), and most of those 16 items (reason routing, on-call roster, clinical devices, notification, internet) have **no question at all**, so the owner can never finish and Glance says "19 owner decisions remaining".

- Split `decisions(p)` into three typed lists in one function `readiness(p)`:
  - `ownerQuestions` — things only the owner can answer; **every item must map to a question id in `questions.ts`** (test: for every combination-walk plan, each `ownerQuestions` item has a question that is `ready`).
  - `stillOpen` — legitimately unknown until install: on-call work identity / Follow Me, E911 address, site survey (internet, power), handoff test, BAA. Labelled "Still open — handled at install", never shown as a question.
  - `derived` — things the engine should infer and stop asking: "Assign an outside-call answering position to the first-answer team" (front desk desks exist → derived), "Choose devices for Clinical team" (asked once as the clinical-rooms question), "message notification" (inbox said → derived).
- Add the missing questions with chips: reasons routing (one question, three rows), urgent roster (fixed person / rotation / not yet), urgent miss (priority message / instructions), office-manager answering place, clinical-area phone (none / one internal computer / one desk / per room — default none), lunch time chips when a lunch close was said without a time.
- **Stop rule:** when `ownerQuestions` is empty → `nextQuestion` returns null, the chat says "That's everything I need to draw both files," shows the blueprint (PR 4), and lists `stillOpen` items in owner language. Skip stays skip (rendered "You skipped this — the plan uses <safe default>"), "AI later" stays a note.
- Glance metric "Owner decisions remaining" counts **only** `ownerQuestions`. Advisor/readiness/owner-brief all read `readiness(p)`; delete the parallel lists in `advisor.ts` `glance().ready.*`.

**Test:** `nextQuestion(p) === null ⇔ readiness(p).ownerQuestions.length === 0`, asserted on all 50 gold scenarios + Chen + the combination walk.

---

### PR 4 — One truth on every surface

There are three hand-written copies of the after-hours script: `architect/hear.ts:63-66`, `owner-brief.ts:564`, `fusion.ts:554`. `hear.ts` omits press 9; the other two include it.

- **`fusionBuild(p).callPath` + `recordings` is the only source of patient-facing words.** Rewrite `callerHear(p)` to map each `callPath` hop to its recording's `script`. Owner page 02, the 3D caption, Review insights, engineer page 01/04 all render the same hop list. Delete the duplicate strings in `hear.ts` and `owner-brief.ts`.
- When the closed-hours IVR offers digit 9 and Follow Me is empty, the hear row adds, in owner words: "Press 9 is part of your plan. It turns on once you give us a **work** on-call phone — not your personal cell." Engineer page keeps BLOCKED. Both are true and now look it.
- Fix the contradicting insight: `advisor.ts:51` `urgentMechanismNote` — when `urgentKind === 'connect'` and coverage includes closed hours, say "After hours, callers press 9 to try the on-call dentist. During open hours, the front desk spots urgent calls after they answer." Never "the published number does not route to on-call" on a plan whose closed recording has digit 9. Also `routing.ts:6-16` `urgentMechanism` must return a closed-hours mechanism, not just `staff` because daytime is human.
- Lunch hear row uses the per-day break and says "this afternoon"; Friday with no break has no lunch row.
- Before-opening hear row reads the `beforeOpening` recording (Chen: callback, **not** "We open March 15… dial 911").

**Test (`tests/planner-parity.test.js`):** for every plan in the combination walk + all gold plans: the set of `(when, script)` in `callerHear`, owner page 02, and `fusionBuild.recordings` are identical; identity printed in every surface is identical; no insight text contradicts a recording (table of forbidden pairs, e.g. recording contains "press 9" ⇒ no insight contains "does not route to on-call").

---

### PR 5 — One owner screen

The chat is the product (default route already is — `App.tsx:179-180`; keep `?wizard=1` as the lab). But today the owner only reaches Download / Book by clicking "Review blueprint", which opens Review — a second app with a scenario simulator (`ArchitectChat.tsx:636-638`, `Review.tsx`).

- Right rail = **Blueprint**, building live as facts land (replace the scene-first rail on desktop; scene becomes a header illustration of the same rail, captioned "Illustration — rooms are not phones"):
  - Name · City · Opening · `Draft` or `Locked rN · checksum`.
  - Posted hours incl. lunch per day.
  - "What to order": `2 desk · 1 work mobile · 1 answering computer · 1 internal computer` (from `purchaseBands`, no prices, "Do not order 6 room phones").
  - "When someone calls" — the PR 4 hear rows (this **is** "walk a call").
  - "Still open — handled at install" (PR 3 `stillOpen`).
  - Buttons: **Download owner blueprint** (primary), **Book a time with Upstate**, and a small "For your installer: technical spec" link.
- On phones: the blueprint is a bottom sheet with a count badge; chat stays full screen.
- Review: delete as a destination. Keep the call simulator only behind `?lab=1`. Chapter "5" in the header opens the blueprint, not Review.
- Draft-ready block (`ArchitectChat.tsx:690-700`) becomes the close: the blueprint summary + the two buttons inline in the chat.
- Fix every "It stays on this device" string (`ArchitectChat.tsx:566`, `App.tsx:63`, `Review.tsx:104`, `owner-brief.ts:976`). Today the plan is PUT to `app.upstateipvoice.com` on every turn (`ArchitectChat.tsx:385-395`) and message text is stored — that copy is false. See PR 6 for the honest model.

**Test:** Playwright (PR 7) asserts the rail shows Kingston, 12:30–1:30, Fri 8–2, "2 desk", and that Download produces a 6-page PDF without visiting any other screen.

---

### PR 6 — A real handoff (owner → Upstate → engineer, same identity)

The pieces exist (`planner_sessions`, `GET /sessions/:id`), nothing is wired.

**Privacy model (pick one and make all copy match it):** *Recommended:* the Plan is saved on the device and to an **unlisted session link** as soon as the owner starts. Copy: "Your plan saves to a private link only you and Upstate can open. We don't store personal phone numbers." This is what the code already does; it just has to say so and give the owner the link.

API (`sms-portal/api/src/routes/publicPlanner.js`, `service.js`, new migration `318_planner_lock.sql`):
- `GET /sessions/:id` already exists → also return `locked_revision`, `locked_checksum`, `locked_at`.
- `POST /sessions/:id/lock { revision, checksum }` → server recomputes the checksum from stored `plan_json` with the **same** `fingerprint()` (generated into the API by `planner:sync-api`) and stores it; 409 on mismatch. After lock, `PUT /plan` creates `r(N+1)` as a new draft; the locked revision is immutable.
- `POST /sessions/:id/share { email? }` (optional) → emails the owner their link; rate-limited.
- Staff view: `GET /api/admin/planner/sessions?planId=` behind existing admin auth in sms-portal (list + open). No new UI app — staff open the same `/planner/?s=<uuid>` link.

Browser (`planner/src/architect/client.ts`, `ArchitectChat.tsx`):
- `/planner/?s=<uuid>` → `readRemoteSession(uuid)` → load Plan, facts, messages → same `planId · rN · checksum` on screen. Local copy and remote copy conflict → show both identities and let the user pick; never silently merge.
- "Copy my plan link" in the blueprint rail. "Book a time" → `https://upstateipvoice.com/review/?plan=<planId>&s=<uuid>`; `/review/index.html` puts both into the booking submission so the meeting opens the exact Plan.
- **Lock** button (Upstate planner, at the meeting, after the owner agrees): calls `/lock`, PDFs then print `LOCKED r1 · 1b0da125` in the footer instead of `Draft`. Engineer PDF from an unlocked plan prints "DRAFT — do not build" on page 01.
- Remove the `conflict`-only error path (`ArchitectChat.tsx:392`): non-conflict sync failures are currently silent.

**Test:** API integration test (sms-portal `test/publicPlanner.test.js`): create → put → lock → put (becomes r2 draft) → get returns locked r1 checksum equal to the browser's `identity()` for the same plan. Browser test: open `?s=` on a fresh profile → identical identity string.

---

### PR 7 — Sparse pages, then release

**7a. Engineer directory & tests pages** (`engineer-brief.ts`): directory becomes the install sheet — one row per SIP user with ext, place, device, register transport (TLS :5081 / WSS :7443 / Follow Me), inbound DID member yes/no, concurrent calls, password-set checkbox, provisioned-MAC blank, tested-by initials. Tests page: one row per `callPath` hop with expected recording filename, expected ring members, pass/fail box, time tested, plus the fixed "inbound must not ring internal 2xx", "two calls at once", "E911 address verified". Fill the page with the table at full width; same type scale as page 01. Engineer still paginates only on overflow.

**7b. E2E (`tests/e2e/planner.spec.ts`, Playwright, new devDependency):**
- Mock the API with the PR 1b Groq fixture.
- Type the 8 Chen turns, click the scripted chips.
- Assert acks (PR 2e), rail content (PR 5), download owner + engineer, parse both with pdf-lib: page counts, identical identity, owner p02 contains "press 9", engineer p01 contains "BLOCKED".
- Run at 390px and 1440px.
- Run once against the **live** URL with the real API in a `--live` job (read-only smoke; creates one session tagged `e2e`).

**7c. Release order (do not skip):**
1. Commit `owner-brief.ts`, `engineer-brief.ts` (currently untracked) and everything above.
2. Deploy API first (sms-portal): migration 318, generated fields/prompt, scrubber, lock/share routes. Verify `GET /api/public/planner/sessions/<uuid>` on prod.
3. `npm run planner:build` then `npm run deploy -- "planner: intake truth, one screen, handoff"` (the repo's deploy script byte-compares local vs live).
4. `npm run verify:live` + the Playwright `--live` smoke.
5. Run the real Chen conversation by hand on the live site with Groq on. Save the transcript as `examples/chen-family-dental.txt` (it must match the PR 2e acks), download the PDFs from the live site, and replace `examples/*.pdf` with those. The examples are now evidence, not a fixture.

Note: `scripts/publish-planner.mjs` does `rm -rf <repo>/assets` and recopies planner assets. Root `/assets` is planner-only today; add a guard that refuses to run if `/assets` contains files not in `planner/public/assets`.

---

### PR 8 — Prove it on a DID once (outside this repo, but it gates "best")

1. Pick one real Fusion tenant. Lock Chen r1.
2. Engineer builds strictly from the engineer PDF, page 06 order. No tribal knowledge — every time they need something not in the PDF, that's a bug in `engineer-brief.ts`; file it with the page number.
3. Run page 07 on the real DID: before opening, open, lunch (Mon 12:45), Friday 2:15 PM (must be closed, no lunch path), after hours, two calls at once, press 9 with Follow Me empty (must fail by design), press 9 with a work on-call populated.
4. Owner signs p06, engineer signs p07, date the DID test. Commit the signed scans to `examples/chen-did-proof/` (redact numbers).
5. Any failed box → fix the spec, regenerate, re-run that box. Until this passes once, the engineer PDF is a document, not a spec.

---

## 3. Definition of done (publish checklist)

- [ ] `tests/planner-chen-gold.test.js` green offline **and** with the Groq fixture; `enrich()` deleted.
- [ ] Strict eval (no `missingOk`) ≥ 95% on 50 old + 10 dump scenarios, with Groq fixtures.
- [ ] `nextQuestion === null ⇔ ownerQuestions empty` on every gold plan; Chen ends with zero questions and exactly 3 still-open items.
- [ ] Parity test: hear = owner p02 = Fusion recordings, same identity everywhere, no contradicting insight.
- [ ] Browser and API allowlist + prompt generated from one source; stale-check test in both repos.
- [ ] No personal number, email, DOB, or patient name stored in `planner_messages` (F49 asserts the DB row).
- [ ] Every privacy sentence on screen and in the PDF matches what the code does.
- [ ] Blueprint rail with Download + Book; Review is not a destination; `?wizard=1` and `?lab=1` are the only labs.
- [ ] `/planner/?s=<uuid>` opens the same `planId · rN · checksum` on another device; Book a time carries the plan; Lock makes PDFs print `LOCKED`.
- [ ] Playwright green at 390px and 1440px, plus the live smoke.
- [ ] API deployed, planner deployed, `verify:live` green, live Chen transcript + live PDFs committed as the examples.
- [ ] One DID passes page 07 from the PDF alone.

## 4. Do not add

Auto-provisioning. Prices. More owner pages. A second chatbot. Groq-written copy in the Plan, PDFs, or scene. A public wizard. E911 / BAA / handoff-tested flags from chat. A personal cell anywhere. A phone per room.

## 5. Post-ship audit — 2026-11-13 (read this before calling it done)

Verified independently: `npm test` 101/101, `planner:eval --no-groq` 110/110, live bundle `dev-DDeeWlqK.js` = repo, offline Chen = live Chen conversation, `POST /lock` → 404. The **conversation** is right. The **files it produces are not buildable**, and no test looks at that. Fix PR 9 before PR 8 (the DID run would just discover these).

### PR 9 — the blueprint must be buildable (P0)

1. **The front desk has no extensions; open hours ring an empty group.**
   Engineer p05: `7000 · RG Reception (members not assigned) · members none · inbound`. Directory p02 lists only 201 (work mobile), 211 (admin), 221 (clinical). Two hired receptionists who need "two separate lines" get zero extensions, and nothing says BLOCKED.
   - Cause: `architect/fields.ts:1250` `setReceptionSharing` creates `reception-share` with `count: 0, device: 'undecided'`. Fusion then allocates no extension.
   - Fix: when sharing is `separate`, count = `teams.reception.count` (Chen: 2); when `shared`, count = 1. Fusion allocates extensions for `device: 'undecided'` placements too (REGISTER column `device TBD`), and RG 7000 members = those extensions.
   - Add `devices.reception.kind` (desk phone · computer + headset · both) to the question catalog, ready once sharing is set. The stop line cannot print while it is open.
   - Invariant in `fusion.ts` blocked list: an inbound RG with 0 members → `BLOCKED: inbound ring group has no members`.
2. **The owner cover tells Chen to order the wrong thing.** Cover: "1 · Answering computer", "Phones to order: 1 (0 desk + 1 work mobile)", "Reception answers on the answering computer." That one computer is the office manager's (211), which engineer p01 says is *not inbound*. Page 5: "Order … 1 answering computer."
   - Fix (`owner-brief.ts`): the hero number is the first-answer team's lines (Chen: 2 front-desk lines). "Phones to order" includes them, labelled "model not chosen" while the kind is open. Never call the admin computer "the answering computer".
3. **"If the front is slammed, ring my husband's work mobile" is dropped, and the two files disagree.** Plan `busy.backup: ''`. Owner p02 says "the work app can also ring". Engineer p09 says "Do not add 201 to inbound RG 7000 unless the owner confirms inbound overflow." The owner did confirm it.
   - Fix: parse "if the front is slammed/busy, ring <X>'s work mobile" → `busy.backup = 'admin'`. Because the same turn also says "if both are with patients, take a message", ask one confirm chip, `busy.order`, with two answers: "Ring office manager's work mobile, then message" / "Message only".
   - Fusion: RG 7000 timeout → RG 7100 (members 201 + 211; 201's Follow Me fires because the extension is dialed) → timeout → busy box. Owner p02 and the hear row come from that same callPath (PR 4 parity test must cover busy).
4. **Every voicemail box prints as `—`.** `DID → *99— (box —)`, `busy-voicemail.wav → box —`, `timeout_data = *99<owner>`. This follows from item 1, because the box owner (reception) has no extension.
   - Test: when `ownerQuestions` is empty, the engineer PDF text contains no `—)`, `*99—`, `box —`, `<owner>`, or `members none` outside a line that says BLOCKED.
5. **The tests page is unreadable and the critical test rows are missing.** Engineer p07 wraps the text one character at a time. "Nobody answers" spills under the footer. "Two calls at once" and "Press 9 empty Follow Me — MUST FAIL" do not appear at all, and that MUST FAIL test is the very one PR 8 depends on.
   - Cause: `engineer-brief.ts:786` `widths: [18, 16, 16, 42, 8]` are percentages, but `pdf.ts:163 table()` treats them as points.
   - Fix: give point widths that sum to `CONTENT` (e.g. `[78, 112, 70, 214, 24]`). `table()` must also break pages between rows and repeat the header, and throw if `y` drops below the bottom margin.
   - Test: `pdftotext` every engineer page and assert each test row's `Hop test` sentence is present in full, and no text sits below the footer line.

### PR 10 — exact details (P1)

6. **Holidays will not fire.** p03 lists `Dates Nov 25, 2027, Dec 25, 2027` *after* the weekday groups. Nov 25, 2027 is a Thursday, so if typed in table order, `Mon–Thu AM` matches first and Thanksgiving rings the desk.
   - Fix: put date groups first with the note "evaluate before weekday groups".
   - Dec 25, 2027 is a Saturday (already closed). Ask "Observe Fri Dec 24?" instead of printing a no-op date.
   - Dates are 2027 only: print "renew each year" or emit 2027 + 2028.
7. **Promises the owner never made.** The lunch recording says "we will call you back this afternoon" and p02 says "Reception calls back the same afternoon". Chen never said that. Use "we will call you back" unless a `hours.lunch.callback` answer exists. Owner p03 "computer inside the doctors' office" is an invented location; write "one clinical computer (internal)".
8. **Priority messages after a missed on-call call land in box 221**, the internal clinical computer. Chen said the front desk owns after-hours messages and wanted "a priority message", and `policy.notification` is still undecided.
   - Fix: send RG 7900 timeout to the after-hours box (reception) as priority. Put "Who gets alerted to a priority message, and how" in still-open (Chen) or make it an owner question.
9. **The fax and the two analog lines are captured but never used.** `current.lines = "2 analog + fax"` appears nowhere in the engineer spec. Add a still-open item: "Insurance fax: keep on its current line or move to a separate fax DID, never the patient DID. Two analog lines: cancel after cutover?"
10. **Insights repeat what the owner already settled.** Suppress "6 clinical rooms do not automatically need 6 phones" when `policy.roomsSpecified` is true (Chen said "treatment rooms, not phones"). The lunch insight prints `12:30–13:30`; use `formatTime`.
11. **Acknowledgements.**
    - Turn 4 says the work mobile "rings first", but it is overflow; say "rings if the front is slammed".
    - Chip acks "Noted: Computer." / "Noted: One internal computer." must name the subject: "Your office manager answers on a computer." / "The clinical team shares one internal computer, not on the published number."
12. **P2 wording.** Glance "25 · Modeled unanswered wait" needs a unit ("25 s"). The associate joins in April, after the March 15 opening, so the owner p04 note should say "On-call is Dr. Chen alone until the associate starts."

### Gold additions (in `tests/planner-chen-gold.test.js`, so this cannot regress)

- `fusionBuild(plan)`: inbound RG members are 2 reception extensions. The directory has 2 reception rows. No placeholder tokens (item 4). Busy path is RG 7000 → RG 7100 → box (or message-only if the chip says so).
- Owner PDF text: "2" front-desk lines on the cover and on p03. No "answering computer" for admin. No "this afternoon" without a lunch-callback fact.
- Engineer PDF text: every test row present, including "MUST FAIL"; holiday groups listed before weekday groups.
- Stop rule: `ownerQuestions` is not empty while `devices.reception.kind` or `busy.order` is open.
- Re-run the live Chen walk only after these pass, then recommit `examples/`.

### API deploy — do not run the command in the report as written

`~/Documents/upstateipv` is on branch `receptionist/pass3` with 96 uncommitted changes under `sms-portal/`. `deploy-fast.sh` runs `gcloud builds submit .`, which uploads **the working tree**. Run from there, it would ship receptionist work-in-progress to production and *not* PR #1 (`planner/ship-lock`). Migration 317 is also only in PR #1, yet the live API already serves sessions, so the live revision was built from a tree that is not `main`.

1. `gcloud run revisions list --service <svc>`: find which commit or image is live, and whether it carries receptionist changes that are not on `main`.
2. `git worktree add ../upstateipv-ship planner/ship-lock` (rebase it onto whatever is live if needed). Run the API tests there.
3. Confirm migrations 317 + 333 run on deploy (or apply them first), then `./scripts/deploy-fast.sh` **from that worktree**.
4. Then: `POST /lock` → 200, a locked session prints `LOCKED`, and `planner_messages` rows hold no phone/email.

## 6. Second audit — 2026-11-13, after PR 9/10 (uncommitted)

Re-verified: 101/101, 110/110 offline. Chen offline → stop line, 0 owner decisions. §5 items 1, 2, 4, 5, 7, 9, 10, 11, 12 are **fixed**. 3, 6, 8 are fixed with the caveats below. The engineer tests page is readable, and MUST FAIL is present.

### PR 11 — voicemail must be buildable (P0, blocks the DID proof)

1. **Four greetings, one mailbox.** `fusion.ts:597–659` points `greeting_1.wav` (after hours), `busy-voicemail.wav`, `lunch-closed.wav` and `before-opening-callback.wav` all at `ownerExt(reception)` = **box 201**. A Fusion mailbox plays one active greeting. So:
   - At 10 AM, RG 7001 timeout → `*99201` plays "You have reached Chen Family Dental **after hours**". `busy-voicemail.wav` is never played; owner p02 promises wording the caller never hears.
   - Lunch: "TC lunch groups → lunch-closed.wav → box 201". A Time Condition destination is one object; play-then-voicemail is not a TC action, so the engineer cannot type it.
   - Before opening: box 201's greeting must be before-opening-callback.wav, then swapped at cutover. No build step says swap.
   - Fix: one voicemail-only box per greeting context, owned by the message owner, e.g. 290 before-opening, 291 busy, 292 lunch, 293 after-hours. Each has its own greeting_1.wav and Forward Destinations / notify → the owner team's extensions. TC lunch → `*99292`; RG 7001 timeout → `*99291`; IVR 9002 digit 1 → `*99293`; DID before open → `*99290`; RG 7900 timeout → `*99293` (priority). Directory p02 lists these boxes; build step 3 assigns each file to its box.
   - Gold test: every recording in `fusionBuild(plan).recordings` maps to a distinct box, and no two greeting files share a box.
2. **Two receptionists, one inbox.** "Reception owns that inbox" = box 201 only; receptionist 202 never sees the messages. Use the per-context boxes with forward destinations 201 and 202 (or one shared team box). Owner p02 must say "both front-desk phones see the message light".
3. **Overflow rings a computer the owner never mentioned.** RG 7001 members are `211, 221` (work mobile **and** the admin computer). Chen said "ring my husband's work mobile". Engineer p07 says "Inbound DID must not ring 211, 221, 231", and owner p03 says that computer "is not inbound". Overflow members = the work-mobile extension only, unless the owner says otherwise.

### Small (fix in the same PR)

- **The owner's live tests lost the two core calls.** "Call during hours: a person picks up" and "Let it ring: office manager's work mobile rings, then a message" are gone from owner p06. Add them back; the overflow is new and untested on the owner page.
- **Engineer p07 has duplicate rows.** "Open hours: two simultaneous calls" (with File = busy-voicemail.wav, which is wrong) and "Two calls at once" are the same test. Keep one, with File `—`.
- **Holiday dates.** `Dec 25, 2028` is printed beside `Nov 25, 2027`, and Thanksgiving 2028 (Nov 23) is missing. Either print one year (2027) + "renew each year", or a full 2028 set.
- **Lunch hop text** `box 201. we will call you back.` starts a sentence with a lowercase letter. `7900 · RG members none · BLOCKED · BLOCKED` repeats a word.
- **File column breaks filenames** (`before-opening-callbac / k.wav`, `after-hours-urgent-opti / on.wav`). Widen the File column or never break inside a filename. An engineer types these.
- **Glance "5 · Independent answering positions"** counts the internal clinical computer and the not-inbound admin computer. Count only positions that can receive the published number (Chen: 2 desk + 1 work mobile = 3).
- **Owner p03 grammar.** "1 computer at the Administration" → "The office manager's computer is not on the published number." "one clinical computer (internal)" → a full sentence.

### Release blockers that are not code

- **Nothing is committed.** `prompt.ts` changed (`api-source.hash` f5c055… → 521ebc…), but `planner:sync-api` was not run, so PR #1 still carries the **old** prompt and allowlist. Groq cannot set `devices.reception.kind` or `busy.backup` on the server; only the local parsers catch Chen's phrasing. Run `npm run planner:sync-api`, commit to `planner/ship-lock`, and make the API test check the same hash.
- **Order:** PR 11 → commit → sync-api → API deploy (per §5, from a clean worktree) → `planner:build` + deploy → `verify:live` → live Chen walk → recommit `examples/` → DID proof (PR 8).
