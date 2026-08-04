# Deploy workflow

## Golden rule

**What you see at `npm run dev` is exactly what goes live** — same files, same paths, no copy step, no `dist/` folder.

Live site: https://www.upstateipvoice.com  
GitHub repo: https://github.com/mshevkun/upstateipvoice (`master` branch → GitHub Pages root)

## Edit → preview → deploy

1. Edit files in **this folder** (`upstateipvoice-master`).
2. Preview: `npm run dev` → http://localhost:3000
3. When it looks right: `npm run deploy -- "what changed"`
4. Deploy script will:
   - commit any changes
   - push to GitHub
   - wait for GitHub Pages build
   - **byte-compare localhost vs live** and fail if anything differs

Manual check anytime: `npm run verify:live` (requires `npm run dev` running).

## Why live ever looked different (root causes)

| Problem | What happened |
|--------|----------------|
| **Two folders** | Edits were in `upstateipvoice-master` (no git). Deploy used a separate `upstateipvoice-github` clone with manual copy — easy to miss files. |
| **Partial sync** | First push copied only index-related files; `about.html` and others stayed old on live until a second manual sync. |
| **No verification** | Nothing checked local vs live after push, so mismatches went unnoticed. |
| **Pages CDN lag** | GitHub Pages can take 1–2 minutes after build before edge cache updates. |
| **Misleading `dist/` build** | `build-production.js` outputs minified assets to `dist/`, but GitHub Pages serves the repo root — using `dist/` would deploy a different site. |

## Do not

- Edit or deploy from `upstateipvoice-github` (legacy duplicate folder).
- Manually robocopy files between folders.
- Deploy from `dist/` unless hosting changes.
- Consider deploy done until `npm run verify:live` passes.

## One folder only

This project folder is now the git repo connected to GitHub. All changes and deploys happen here.
