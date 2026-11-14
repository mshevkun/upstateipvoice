# Practice Planner — Final Fix Plan

2026-11-13. This supersedes SHIP-PLAN.md §5–§6 (most of §5 is done; what is left of §6 is folded in below). Work top to bottom. Nothing ships until **every gate in §4 is green**.

## 0. How this was measured

- **`npm run planner:audit`** (new, `planner/eval/audit.mjs`). It runs every eval scenario plus Chen plus 10 adversarial owners (`planner/eval/gold-adversarial.mjs`) through the real chat engine, answers the remaining questions with chips the way an owner would, builds both PDFs, runs `pdftotext`, and checks buildability: placeholders, shared mailboxes, empty ring groups, text off the page, broken filenames, hear↔owner parity, generic acks, repeated questions.
  - 221 runs, 0 crashes, **0 fully clean**.
- **Groq with the production request shape:** full 102-field generated registry, server allowlist, browser scrub.
- **Real UI:** local dev against the live API, at 1440 px and 375 px.
- **API PR [#1](https://github.com/carlostech3626/upstateipv/pull/1)** (`planner/ship-lock`), read line by line.

Already green: `npm test` 101/101, `planner:eval --no-groq` 110/110, Chen offline = Chen live, owner PDF 6 pages, engineer test table readable.

---

## 1. P0 — blocks publishing

### 1.1 Groq cannot carry a public launch
- **Evidence:**
  - The key in `sms-portal/api/.env` is on Groq's free `on_demand` tier: **200,000 tokens/day, 8,000 tokens/minute**.
  - One turn is about **4,100 tokens** (8.5 KB prompt + 6.5 KB context, mostly the 102-field registry). That is about 48 turns a day, roughly 5 owner conversations, for every visitor combined, and about 2 turns a minute.
  - In my run with the full registry, 9 of 10 first turns came back `400 json_validate_failed` (one `max completion tokens`), and then the daily quota ran out.
  - In the browser, the owner saw "Writing a reply" for about 45 s, then a 502, then the local fallback.
- **Fix:**
  1. Move the planner to its own Groq key (not shared with any other Upstate service), on Dev tier with a spend cap and a budget alert.
  2. Shrink the request to under 2k tokens:
     - Send only the registry rows relevant to the current question and to the fields still unsettled (ids + enums), not all 102.
     - Set `reasoning_effort: "low"` and `max_completion_tokens: 1200` in `groq.js` and in `sync-api.mjs`'s generated prompt module.
  3. Client: abort `interpretRemote` after **8 s** and use the local fallback. The fallback branch in `ArchitectChat.tsx` (≈ line 585) must still call `syncPlan`; today a fallback turn never reaches the server, so the `?s=` link and Lock see a stale plan.
  4. `planner/eval/run.mjs:85` uses a hand-made 24-field `compactRegistry`, not the production one. Import the generated registry so "eval with Groq" actually tests production.
- **Gate:** Groq run of `planner:audit` with the production request shape: ≥ 95% of turns return 200, median latency < 3 s, p95 tokens per turn < 2,500.

### 1.2 Hours are invented
- **Evidence:** 41 of 110 scenarios print opening hours the owner never gave. A fresh blueprint already shows "Mon–Fri 9:00 AM–5:00 PM". In Buffalo, the owner said "8 to 4 Monday to Thursday" and the rail shows **Fri 9:00 AM–5:00 PM**.
- **Cause:** `config.ts:108` `initial()` seeds Mon–Fri `open: true, start: '09:00'`. Because of that, `questions.ts:443` (`hours.preset` is ready only when `!days.some(d => d.start && d.open)`) never fires.
- **Fix:**
  - `initial()` days: `open: false, start: '', end: ''`, plus a `hours.stated` flag.
  - `hours.preset` is ready until any day is stated.
  - When the owner names some days, the other weekdays stay **unknown**, not 9–5. Ask a confirm chip: "Fri, Sat, Sun closed?"
  - Rail and PDFs print "Hours not given yet".
- **Test:** audit `INVENTED-HOURS` = 0 (add the detector from the audit's hours probe). Buffalo gold: Fri is closed or asked about, never 9–5.

### 1.3 One-receptionist practices get no front-desk phone
- **Evidence:** **131/221** finished chats end with `BLOCKED: inbound ring group has no members`. The owner PDF says "1 desk phone" while the engineer RG 7000 has no members. Chen only passes because "two separate lines" creates the placement.
- **Cause:**
  - `questions.ts:462` asks `devices.reception.sharing` only when reception count ≥ 2.
  - `questions.ts:463–468` asks `devices.reception.kind` only once a reception placement exists. With 1 receptionist, neither happens.
- **Fix:**
  - Create the reception placement whenever reception count ≥ 1 (count 1 → 1 extension; count ≥ 2 → sharing question decides).
  - `devices.reception.kind` is ready whenever `first.kind === 'human'` and reception count > 0.
  - Guard: `first.kind = human, team = reception` with reception count 0 must re-ask the count, not accept it (seen in the "solo" and "chiro" runs).
- **Invariant (gate):** `nextQuestion === null` ⇒ `fusionBuild(plan).blockers` contains only install items (Follow Me, E911, site survey).

### 1.4 Voicemail cannot be built (SHIP-PLAN §6 PR 11, still open)
- **Evidence:**
  - 33 runs have 2–3 greetings on one mailbox (Chen: box 201 holds `greeting_1`, `busy-voicemail`, `before-opening-callback`).
  - 45 runs print `Box (owner extension)`.
  - At 10 AM, a caller who overflows hears "…after **hours**".
  - Lunch "TC → wav → box" is not a single Time Condition action.
- **Fix:**
  - One voicemail-only box per greeting context (before-opening, busy, lunch, after-hours, priority). Each box forwards or notifies every extension of the owning team, so both receptionists see the light.
  - TC lunch → `*99<lunch box>`.
  - The build step names which file goes on which box, plus the cutover swap.
  - Overflow RG 7001 = work-mobile extension only (Chen never asked for the admin computer).
- **Test:** audit `SHARED-MAILBOX` = 0, `PLACEHOLDER` = 0. Chen gold: overflow members = [work-mobile ext].

### 1.5 Lock is broken by design
- **Evidence:**
  - `ArchitectChat.tsx:874` sends `p.revision` (the plan's own counter). The server's `lockSession` compares it with `planner_sessions.revision`, which counts PUTs. These differ whenever a turn fell back (1.1) or a chip didn't sync, so the result is a 409.
  - After a successful lock, the client adds `'locked'` to `p.confirmed`. `confirmed` is inside `fingerprint()`, so the "LOCKED" PDF prints a **different checksum** than the one the server locked.
- **Fix:**
  - Send `remoteRevRef.current`.
  - Keep lock state outside the fingerprinted plan (`p.lock = { revision, checksum, at }`, excluded from `fingerprint()` and from the generated API copy).
  - Print LOCKED only when the server's `lockedChecksum === identity(p).checksum`.
  - Reject PUT after lock (or fork to a new revision).
- **Test:** API test: create → 3 PUTs → lock with the client's tracked revision → 200. Then `identity(lockedPlan).checksum === lockedChecksum`, and the PDF footer shows that checksum.

### 1.6 The practice name is never asked
- **Evidence:**
  - 132/221 engineer specs record greetings as "You have reached **the practice** after hours".
  - 208/221 owner covers say "Your practice".
  - In the PHI run, the parser named the practice "about his glasses and nobody answered".
  - In the ortho run, the answering service "AnswerConnect" became the practice name.
- **Fix:**
  - Add a `name` question (priority right after `mode`).
  - Name parsing only from anchors ("we are / I'm opening / called / named / practice is"), rejecting fragments that contain verbs or that follow "answering service called".
  - Recordings are not printed and the DID is BLOCKED while the name is empty.
- **Test:** adversarial gold: ortho name ≠ AnswerConnect; PHI-run name = "Kingston Eye Associates".

### 1.7 Intake mishears what owners say
This is what owners get on every turn where Groq fails, which with 1.1 unfixed is most turns.

| Owner said | Planner recorded | Where |
|---|---|---|
| "No lunch close." | lunch 12–1 Mon–Fri | `parse.ts:290` treats "no lunch close" as Friday-only |
| "Spanish would be nice but we do not have anyone who speaks it" | Spanish coverage | `parse.ts:582–587` has no negation handling |
| "existing optometry office" | "A new eye care office" | mode parser |
| chiropractic / physical therapy / dermatology / family medicine | asks specialty; chips are Dental / Eye / Other | `questions.ts:58–70`, parse specialty |
| "One front desk person, Maria" · "Three treatment coordinators who answer phones" · "4 docs, 3 front desk" · "Two opticians answer the phone" | reception 0, clinical 0 | roster parser only knows receptionist / front desk + number words |
| "after hours answering service" / "answering service called AnswerConnect" | after = message | no `after.kind = service` parse |
| ChiroTouch, Dolphin, WebPT, Eaglesoft, Compulink, RevolutionEHR | — | PMS list |
| "Currently on RingCentral" | — | current provider |
| "two offices, Albany and Clifton Park" | 1 location (Albany) | locations |
| "When Maria is on the other line, ring the back office phone" | — | busy.backup |
| "AI receptionist after hours" | — | after.kind assistant |
| "keep number" / "port it" | number=porting but mode still asked | keep/port ⇒ mode improving |
| "Mon/Wed/Fri 7:30–6:30, Tue/Thu 2–7, Sat 8–noon" | Mon/Wed 9–5 kept, Sat closed | day-span parser drops mixed spans |
| "Open Tuesday to Saturday 9 to 5" (solo) | Mon–Fri 9–5 + Sat | span parser plus the 1.2 defaults |
| "No wait, Fridays we close at 1" | "I didn't turn that into a setting yet" | correction phrasing |

- **Fix:**
  - Extend `parse.ts` for each row.
  - Write each row as an expected fact in `gold-adversarial.mjs` (today it has turns only; add `expect` blocks in the same shape as `gold-dump.mjs`).
  - Specialty: either detect these specialties and map them to "Other healthcare practice" while keeping the label ("Chiropractic"), or say plainly on the page "Built for dental and eye care".
- **Gate:** offline (no Groq) adversarial pass ≥ 90%. With Groq (production request shape) ≥ 97%.

### 1.8 The chat loops and gives empty acknowledgements
- **Evidence:**
  - `reasons.routing` is asked **3 times in a row** in 88+ runs: one row per click, and the chip already applied is offered again.
  - "Billing to the office manager" is offered when there is no office manager.
  - 1,049 acks are a bare `Noted: <chip label>.` (`ack.ts:365`). Examples: "Noted: We rotate.", "Noted: Take a priority message.", "Noted: None — rooms are not phones."
- **Fix:**
  - `reasons.routing` gets one chip, "Use this split" (sets all three rows from teams that exist), plus "Change one".
  - Drop chips whose value is already set, and chips naming a team with count 0.
  - Every chip in `questions.ts` gets a subject ack ("On-call rotates between your dentists — a roster, not a verified transfer.").
  - Delete the `Noted:` fallback; a missing ack fails a unit test.
- **Gate:** audit `GENERIC-ACK` = 0, `REPEATED-QUESTION` = 0.

---

## 2. P1 — fix before announcing

- **Empty plan looks finished.** At r0 the rail shows hours, "1 After-hours coverage as specified" and a **Saved** badge, and "Download owner blueprint" works. Disable both downloads until name, hours and first answer exist. Badge: "Not saved yet".
- **Duplicate intro copy.** "Tell me how your office works…" and "Describe your practice in your own words…" say the same thing; keep one.
- **iPhone zoom.** The composer textarea is 15 px (`style.css:292`), so iOS zooms on focus. Make it 16 px.
- **Booking handoff is unproven.** `js/review.js` posts `plan_id` and `planner_session_id` to `book.upstateipvoice.com`. That service is not in either repo, so confirm it stores them and includes the `/planner/?s=<id>` link in Upstate's booking notification. Remove `business_name.placeholder = planId` (it shows `UP-mwf…` in the owner's name field).
- **Privacy copy is slightly wrong.** "A private link only you and Upstate can open" — it is anyone-with-the-link. Say: "Your plan saves to an unlisted link. Anyone with the link can open it. We don't store personal phone numbers."
- **Engineer wording.**
  - `no extension · extension 7000` (143 runs).
  - `BLOCKED · BLOCKED` (24 runs).
  - Duplicate "two calls at once" test rows.
  - Filenames broken mid-word in the File column.
  - Holiday rows mix 2027/2028.
  - "Answering positions" counts internal / not-inbound computers.
  - Owner p06 lost the "a person picks up" and "let it ring → work mobile → message" tests. (SHIP-PLAN §6 "Small" list.)
- **API hardening (PR #1):**
  - `putPlan` accepts any JSON and loops over every fact with one query each. Cap the plan at 128 KB and 200 facts, require `schema === 2`, and do a single multi-row upsert.
  - Server-side `scrubPii` on `facts[*].evidence` and plan note fields (today only message text is scrubbed server-side).
  - TTL deletes only messages. Also delete unlocked, unshared `planner_sessions` (plan_json + facts) after 90 days.
  - `scrub.js` `PATIENT` only catches "patient Firstname"; add "Mr./Mrs./Ms. Lastname called" and "<Name> DOB".

---

## 3. Release order (do not reorder)

1. Fix §1 and §2 in `upstateipvoice`. Run `planner:sync-api` (the prompt changed and is unsynced today: `api-source.hash` 521ebc… vs PR #1 f5c055…).
2. Commit the planner on a branch and open a PR. Commit the regenerated API files to `planner/ship-lock`, then run the API tests there.
3. Groq: new planner key, Dev tier, cap + alert (1.1).
4. API deploy **from a clean worktree** of `planner/ship-lock`, never from `~/Documents/upstateipv` (that checkout is on `receptionist/pass3` with 96 uncommitted files, and `deploy-fast.sh` uploads the working tree). First `gcloud run revisions list` to see what is live, and rebase onto it if it carries commits not on `main`. Migrations 317 + 333 run on boot.
5. `npm run planner:build` → `npm run deploy` → `npm run verify:live`.
6. Live smoke on production:
   - Chen, plus the 3 hardest adversarial owners (chiro hours, one receptionist, PHI), typed by hand.
   - Lock returns 200 and the PDF checksum matches the server.
   - `?s=` opens the same identity on a phone.
   - "Book a time" arrives at Upstate with the plan link.
7. Commit the live transcripts and PDFs to `examples/`.
8. DID proof (`examples/chen-did-proof/README.md`): every engineer p07 test passes from the PDF alone, and "MUST FAIL" fails. Then announce.

## 4. Gates (all in CI before step 4 above)

- [ ] `npm test` green, including the new lock, hours, one-receptionist and mailbox tests.
- [ ] `npm run planner:eval -- --no-groq` 100%.
- [ ] `npm run planner:audit:gate`: 0 crashes, 0 PLACEHOLDER, 0 SHARED-MAILBOX, 0 OVERFLOW, 0 FILENAME-BROKEN, 0 GENERIC-ACK, 0 REPEATED-QUESTION, 0 DUP-WORD, 0 invented hours, and every finished chat has only install-time blockers.
- [ ] Adversarial expected facts: offline ≥ 90%, Groq (production request shape) ≥ 97%.
- [ ] Groq budget: ≥ 95% HTTP 200 on the audit run, p95 < 2,500 tokens per turn.
- [ ] Playwright Chen walk + one-receptionist walk at 390 px and 1440 px, including Lock.
- [ ] API: `POST /lock` 200 on a 3-PUT session; PUT > 128 KB → 400; no phone or email in `planner_messages` or `planner_facts.evidence`.

## 5. What "best free tool" means here (the bar)

An owner types the way they talk and gets:
- every fact they said reflected back in plain words, and nothing they didn't say;
- one question at a time, each asked once;
- a stop line only when both files are buildable.

The phone company opens the engineer PDF and can type every object into Fusion without guessing a mailbox, a member, a file or a box. The only things left are Follow Me, E911 and the site survey, and the real-phone test proves it.
