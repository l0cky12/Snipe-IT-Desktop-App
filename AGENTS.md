# Snipe-IT Desktop — agent rules

Standing rules for every AI agent in this repo: Claude builds, Codex reviews. Read before changing anything.

## The app

NOMMA IT's staff console for looking up Assets and checking them in and out of the school's Snipe-IT. Electron + React + Vite, TypeScript throughout: `src/main` (Node side: config, Snipe-IT client, mail, scheduler), `src/preload` (the IPC bridge), `src/renderer` (React UI). Runs on a handful of IT workstations, Linux and Windows. Why Electron: `docs/adr/0001-electron-react.md`. Setup and features: `README.md`. Domain words: `CONTEXT.md`.

- The API token and SMTP password are stored only encrypted through Electron `safeStorage`, in the app's `settings.json` under userData.
- Reports, exports and emails carry student information, so they fall under FERPA: they go only to authorized district staff.

## Before you open a PR

Run what CI runs and make it pass:

```sh
npm ci
npm run typecheck && npm test && npm run build
```

- New features and bug fixes come with a test.
- Commit no secrets, keys or tokens, and no real student data. Fixtures use obviously fake values; `scripts/mock-snipeit.mjs` holds fictional Users and Assets.
- The PR description says what changed and why. Codex reviews the code against it.
- Label the PR when you open it. `small`: docs, config, or roughly under 100 changed lines that add no IPC channel. `large`: everything else. Also add `security-sensitive` if it touches the API token or mail credentials, IPC handlers or the preload, `BrowserWindow` options, label printing, or code that exports or emails student data.

## The review loop (Claude)

Codex runs locally through the Codex CLI, signed in with the owner's ChatGPT plan; the Codex GitHub app is not used. Reviews use GPT-6.1 Sol at high reasoning effort, pinned on the command line so local Codex defaults don't change the reviewer. They go through the owner's default `teamclaude` provider (a local proxy); the `openai` provider can't get through this machine's HTTPS proxy. Codex reads this file, so the guidelines below apply. After pushing a PR, review it from the PR branch (`< /dev/null`, or Codex waits on stdin):

```sh
git fetch origin && codex review -c 'model="gpt-6.1-sol"' -c 'model_reasoning_effort="high"' --base origin/main < /dev/null
```

Post the result as a PR comment headed `### Codex review (round N)` naming the reviewed commit's SHA, then work in rounds. One round = fix or answer every finding, push once, and run the review again. Codex tags findings P0 (blocker) to P3 (nitpick). A failing CI check counts as a finding and uses the same rounds.

- Fix P0–P2. List P3s in the round's comment without changing code.
- If you think a finding is wrong, say why in the round's comment instead of changing code. It's settled if the next review doesn't raise it again.
- Round limit: 1 for PRs labelled `small`, 3 for `large`. When the limit is hit and findings or red checks remain, add the `needs-human-review` label, comment a short summary of what is still open, and stop.
- PRs labelled `security-sensitive` always end with a human merge. Finish the rounds, then stop.
- Merge with `gh pr merge <number> --squash` only when checks are green, every review thread is resolved, a Codex review comment names the PR's latest commit, and neither `needs-human-review` nor `security-sensitive` is set. `.claude/hooks/guard-merge.sh` enforces this for `gh pr merge`; don't route around it.

## Review guidelines

For Codex (and anyone else reviewing). Pay particular attention to:

- **Secrets**: the API token and SMTP password are never logged, rendered in the UI, put in error messages or exports, or stored anywhere but encrypted through `safeStorage`.
- **Student data (FERPA)**: student information goes nowhere new: no logs, temp files, new email recipients or telemetry. CSV export keeps its FERPA confirmation.
- **Electron boundary**: `contextIsolation`, `sandbox` and `nodeIntegration: false` stay as they are. New IPC handlers validate their arguments and expose only what the feature needs. No value from the renderer or the Snipe-IT server reaches `shell.openExternal`, `loadURL`, a file path or a spawned process unchecked.
- **Injection**: server data is escaped wherever it becomes HTML (label printing, emailed reports) or CSV, including formula injection in cells starting with `=`, `+`, `-` or `@`.
- **Matches the PR**: the code does what the PR description says, and nothing unrelated sneaks in.
- **Tests**: new behaviour and bug fixes are covered by a test that would fail without the change.
- **Domain words**: names and UI text use the terms in `CONTEXT.md` (Asset, Checkout, Assignee, …).

## Before opening or updating a PR (run every time, no exceptions)

```sh
git fetch origin main
git merge --no-edit origin/main
```

Resolve every conflict here in the worktree, keeping both changes' intent. Never silently drop a change from main. If the merge brought anything in, rerun the CI commands above. Then:

```sh
git push
```

## Agent skills

### Issue tracker

GitHub Issues on `l0cky12/Snipe-IT-Desktop-App`, via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`), applied as GitHub labels. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` at root, ADRs in `docs/adr/`. See `docs/agents/domain.md`.
