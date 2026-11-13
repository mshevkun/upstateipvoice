# Chen DID proof (PR 8)

This folder is the gate that turns the engineer PDF from a document into a spec.

Until signed, redacted scans are committed here, the engineer PDF is **not** proven on a live DID.

## Procedure

1. Lock Chen r1 in the planner (`LOCKED` in the PDF footer).
2. Build **only** from the engineer PDF, page 06 order. Anything missing from the PDF is a bug in `planner/src/engineer-brief.ts` — file it with the page number. No tribal knowledge.
3. Run page 07 on a real Fusion DID:
   - Before opening
   - Open hours
   - Lunch (Monday 12:45)
   - Friday 2:15 PM (must be closed, no lunch path)
   - After hours
   - Two calls at once
   - Press 9 with Follow Me empty (**must fail**)
   - Press 9 with a work on-call populated (**must connect**)
4. Owner signs page 06. Engineer signs page 07. Date the DID test.
5. Commit redacted scans here. Failed boxes → fix the spec, regenerate, re-run that box.

## Files

Signed scans (redacted numbers) belong in this directory once the test is run:

- `page-06-owner-sign.png`
- `page-07-did-tests.png`
- `press-9-empty-fail.png`
- `press-9-follow-me-connect.png`
