# 01: Scan an Asset Tag → Asset card appears

**What to build:** An Operator starts the app with `npm start`, scans (or types) an exact Asset Tag into the focused search box, presses Enter, and sees that Asset's detail sheet. This is the thinnest end-to-end slice: scaffold → config → SnipeIt module → bridge → screen.

**Blocked by:** None (can start immediately)

**Status:** ready-for-agent

Spec: `.scratch/snipe-it-desktop/spec.md`. See ADR 0001 for the stack.

- [ ] Electron + React + Vite + TypeScript scaffold; `npm start` launches the app from the project folder
- [ ] Renderer runs with context isolation on and node integration off; the API key never reaches the renderer
- [ ] Config reads `config.json` (Snipe-IT base URL + the Operator's personal API key); a missing file, missing field, or malformed URL shows a clear on-screen message naming the problem
- [ ] SnipeIt module is created with config + an injected fetch; `lookup(query)` trims the query and returns the single Asset for an exact Asset Tag match, marked as exact
- [ ] `getAsset(id)` returns a flat Asset shape in CONTEXT.md vocabulary (Asset Tag, name, model, status, Assignee, location, category, Serial, purchase date, warranty end)
- [ ] Preload bridge exposes only SnipeIt functions to the screen, one-to-one over IPC
- [ ] Minimal detail sheet: header (Asset Tag, name, model), status chip, fact grid
- [ ] Search box is focused on launch, and cleared + refocused after an exact-tag hit
- [ ] Vitest set up; SnipeIt tests use a fake fetch with canned Snipe-IT JSON and assert only on interface results (exact-tag hit, trimming)
