# Spec: Snipe-IT Desktop v1

Status: ready-for-agent

## Problem Statement

IT staff at the school handle hardware all day: Chromebooks coming back to the helpdesk, projectors moving between rooms, laptops going out for repair. Every time, the Snipe-IT web UI makes them click through menus to find an Asset, check who has it, and record a Checkout or Checkin. At a busy counter with a line of students and a barcode scanner in hand, that's too slow. They also have no quick way to see which Assets are Overdue or which warranties are about to lapse.

## Solution

A dark, dense desktop console that talks to the school's existing Snipe-IT instance. An Operator scans an Asset Tag (or types a name, tag, or Serial) into one search box and sees the Asset right away: status, Assignee, model, location, warranty, and full History, all on one screen. From there they can Checkout or Checkin in a click or two. A dashboard shows Overdue Assets, Expiring Warranties, and Asset counts. Everything else in Snipe-IT is read-only from this app.

The main screen uses the **Rail + detail sheet** layout (variant B from the prototype on branch `prototype/main-screen`). It was picked because it's the densest and suits scanning sessions: the left rail keeps matches and recent scans on screen, so the Operator can jump back to any Asset scanned earlier without re-scanning.

## User Stories

### Setup and connection
1. As an Operator, I want the app to read my Snipe-IT URL and personal API key from a local config file, so that I never type credentials into the app and they're never hardcoded.
2. As an Operator, I want a clear message naming the missing or malformed field when my config file is missing or broken, so that I can fix it without guessing.
3. As an Operator, I want a clear message when my API key is rejected, so that I know to generate a new one rather than assuming the app is broken.
4. As an Operator, I want a clear message when the Snipe-IT server can't be reached, so that I can tell a network problem from an app problem.
5. As an Operator, I want History entries I create to be credited to me, so that my colleagues can see who handled each Checkout and Checkin.
6. As an Operator, I want the app to work with a key that only has view and checkout/checkin permission, so that a leaked config file can't be used to delete or edit inventory.

### Lookup
7. As an Operator, I want the search box focused as soon as the app opens, so that I can scan without touching the mouse.
8. As an Operator, I want scanning an Asset Tag to open that Asset immediately, so that one scan is one lookup.
9. As an Operator, I want the search box to clear and stay focused after a scan opens an Asset, so that the next scan works right away.
10. As an Operator, I want to type part of a name, tag, or Serial and see matching Assets, so that I can find an Asset when its label is missing or unreadable.
11. As an Operator, I want matches listed in the rail with Asset Tag, name, status chip, and Assignee, so that I can pick the right one at a glance.
12. As an Operator, I want to click a match to open it in the detail sheet, so that I can compare several results quickly.
13. As an Operator, I want a clear "no Asset matches" message when nothing is found, so that I know the scan worked but the Asset isn't in Snipe-IT.
14. As an Operator, I want recently opened Assets listed in the rail for this session, so that I can jump back to one without scanning it again.
15. As an Operator, I want a lookup that's still loading to be replaced by my next scan rather than overwrite it, so that fast scanning never shows me the wrong Asset.

### Asset card (detail sheet)
16. As an Operator, I want to see the Asset's Asset Tag, name, and model in the header, so that I can confirm I've got the right Asset.
17. As an Operator, I want the Asset's status shown as a colored chip, so that I can read it instantly.
18. As an Operator, I want an Overdue chip showing how many days late the Asset is, so that I can chase late returns on the spot.
19. As an Operator, I want an Expiring Warranty chip showing days remaining (and an "expired" chip once it lapses), so that I can plan repairs before coverage ends.
20. As an Operator, I want to see the Assignee and whether it's a User or a Location, so that I know who or where has it.
21. As an Operator, I want to see the Expected Checkin date, so that I know when it's due back.
22. As an Operator, I want to see location, category, Serial, purchase date, and warranty end date in a dense grid, so that I get everything on one screen without scrolling.
23. As an Operator, I want the Asset's full History as a table (when, action, Operator, detail), newest first, so that I can see what happened to it and who did it.
24. As an Operator, I want notes from past Checkouts and Checkins shown in History, so that damage reports aren't lost.

### Checkout
25. As an Operator, I want a Checkout button that's enabled only when the Asset can be checked out, so that I can't attempt something Snipe-IT will reject.
26. As an Operator, I want to check an Asset out to a User by searching their name, so that I can hand a Chromebook to a student quickly.
27. As an Operator, I want to check an Asset out to a Location by searching its name, so that I can assign a projector to a room.
28. As an Operator, I want to set an optional Expected Checkin date, so that late returns show up as Overdue.
29. As an Operator, I want to add an optional note to a Checkout, so that I can record the Asset's condition when it left.
30. As an Operator, I want the detail sheet to refresh with the new Assignee and History entry after a Checkout, so that I can see it worked.
31. As an Operator, I want a clear error if Snipe-IT rejects the Checkout, showing Snipe-IT's own reason, so that I know what to fix.

### Checkin
32. As an Operator, I want a Checkin button that's enabled only when the Asset has an Assignee, so that I don't try to check in something already in inventory.
33. As an Operator, I want to check in with one click and the status left as it was, so that routine returns are fast.
34. As an Operator, I want to optionally change the status on Checkin (for example to a repair status), so that I can flag a damaged return.
35. As an Operator, I want to add an optional note on Checkin, so that I can record damage like a cracked screen.
36. As an Operator, I want the detail sheet to refresh after Checkin, so that I can see the Asset is back in inventory.
37. As an Operator, I want a clear error if Snipe-IT rejects the Checkin, so that I know it didn't go through.
38. As an Operator, I want the search box refocused after a Checkout or Checkin, so that I can scan the next Asset straight away.

### Dashboard
39. As an Operator, I want a dashboard listing every Overdue Asset with its Assignee and days late, so that I can chase returns.
40. As an Operator, I want a dashboard listing every Expiring Warranty in the next 90 days, soonest first, so that I can plan ahead.
41. As an Operator, I want Asset counts by status, so that I know how much is deployed, ready, and pending.
42. As an Operator, I want to click any Asset on the dashboard to open it in the detail sheet, so that I can act on it immediately.
43. As an Operator, I want to refresh the dashboard on demand, so that I can see the latest numbers after a busy morning.
44. As an Operator, I want to see when the dashboard was last loaded, so that I know how fresh the numbers are.

### Distribution
45. As an Operator, I want to run the app from the project folder with one command, so that I can use v1 before installers exist.
46. As an Operator on Windows, I want an installer, so that I can set it up like any other app (after v1 is stable).
47. As an Operator on Linux, I want an AppImage or deb package, so that I can install it on Linux workstations (after v1 is stable).

## Implementation Decisions

**Stack (see ADR 0001).** Electron + React + Vite, in TypeScript. Types make the messy Snipe-IT response shapes safe to reshape. Run with `npm start` for v1. electron-builder installers (Windows NSIS, Linux AppImage + deb) are the last phase. No macOS build.

**Process split: all Snipe-IT traffic happens in the main process.** The screen (renderer) never sees the API key and never calls Snipe-IT directly. This keeps the key out of the renderer and avoids cross-origin blocking. The preload bridge exposes only the SnipeIt module's functions to the screen, nothing else. Renderer runs with context isolation on and node integration off.

**Modules:**

- **Config**: reads `config.json` from the project folder when run from source, or from the per-user app data folder when installed (see README), containing the Snipe-IT base URL and the Operator's personal API key. Validates both fields are present and the URL is well-formed. Returns a specific error naming what's wrong. `config.json` is gitignored and must never be committed.
- **SnipeIt** (the deep module; nearly all logic lives here). Created with the config and a fetch function (injected, so tests can fake HTTP). Its interface:
  - `lookup(query)`: trims the query. Tries an exact Asset Tag match first. On a hit, returns that single Asset marked as an exact match. Otherwise it falls back to a text search across name, tag, and Serial, returning a list of Asset summaries. The caller uses the exact-match mark to decide whether to clear the search box.
  - `getAsset(id)`: returns the full Asset plus its History, newest first.
  - `searchUsers(text)` and `searchLocations(text)`: for choosing the Checkout target.
  - `statusLabels()`: for the Checkin status dropdown.
  - `checkout(assetId, { targetType: 'user' | 'location', targetId, expectedCheckin?, note? })`
  - `checkin(assetId, { statusId?, note? })`
  - `dashboard()`: returns the Overdue list, the Expiring Warranty list, and counts by status.
- **Bridge**: the preload script. It forwards each SnipeIt function over IPC, one-to-one.
- **Screen**: the renderer. It holds the rail (search box, matches, recent scans), the detail sheet (header with chips and actions, 4-column fact grid, History table), the Checkout and Checkin forms, and the dashboard view. It stays thin: it displays what SnipeIt returns and holds only UI state (query, selected Asset, recent scans for this session, form inputs).

**Domain rules, all computed inside SnipeIt:**
- **Overdue**: the Asset has an Assignee, has an Expected Checkin date, and that date is before today. Days late = today minus that date. Assets without an Expected Checkin can never be Overdue. This is not the same thing as audit overdue, which is out of scope.
- **Expiring Warranty**: the warranty end date is between today and today + 90 days. If the end date is already past, the Asset is "Warranty expired", which shows as a chip but is not in the dashboard list. If Snipe-IT has no warranty date, no chip is shown.
- **Checkout allowed**: the Asset has no Assignee and its status is deployable. Snipe-IT requires a status on Checkout, so the app sends the Asset's current status.
- **Checkin allowed**: the Asset has an Assignee. Snipe-IT requires a status on Checkin; it defaults to the Asset's current status unless the Operator picks another.
- Checkout targets are Users and Locations only. Assets-to-Assets isn't supported in v1.

**Snipe-IT API contract (REST API v1, bearer token, JSON), confirmed against the Snipe-IT API reference:**
- Exact tag: `GET /hardware/bytag/{tag}`
- Text search: `GET /hardware?search=` with `limit`/`offset`
- Asset: `GET /hardware/{id}`
- History: `GET /reports/activity` filtered by `item_type=asset` and `item_id`
- Checkout: `POST /hardware/{id}/checkout` with `status_id`, `checkout_to_type`, `assigned_user` or `assigned_location`, and optional `expected_checkin` and `note`
- Checkin: `POST /hardware/{id}/checkin` with `status_id` and optional `note`
- Checkout targets: `GET /users?search=` and `GET /locations?search=`. Status list: `GET /statuslabels`.
- Snipe-IT sometimes returns HTTP 200 with `"status": "error"` in the body. SnipeIt must treat that as a failure and pass Snipe-IT's message along. A 401 maps to a "key rejected" error. A network failure maps to an "unreachable" error.
- Snipe-IT HTML-escapes some text fields (e.g. `&quot;`). SnipeIt decodes them before returning.
- SnipeIt reshapes Snipe-IT's nested responses (status objects, date objects, assigned_to with a type) into flat app-level shapes that use the CONTEXT.md vocabulary. The screen never sees raw Snipe-IT JSON.

**Dashboard data.** `dashboard()` pages through every Asset (up to 500 per page, the usual server maximum) and computes all three sections in the app. This assumes a fleet under about 5k Assets. It loads when the dashboard is opened and on the refresh button; there's no background polling.

**Recent scans** live in memory for the session only (up to about 20). Nothing is saved to disk.

**Stale lookups.** If a new lookup starts before the previous one returns, the older result is discarded. This is handled in the screen, since it's UI state.

## Testing Decisions

- **One test seam: the SnipeIt module's interface.** Tests create SnipeIt with a fake fetch that returns canned Snipe-IT JSON (shaped like the API reference examples). Then they assert only on what the interface functions return or throw. No test checks internal helpers, URL-building details, or rendering.
- A good test reads like a user story: "scanning an exact Asset Tag returns one exact match"; "an Asset whose Expected Checkin was yesterday is Overdue by 1 day"; "a 200 response with status error is thrown as Snipe-IT's message"; "a warranty ending in 91 days is not Expiring".
- Covered through that seam:
  - Lookup: exact-tag-then-search fallback, trimming, no matches.
  - Reshaping and HTML decoding.
  - Overdue, Expiring Warranty, and expired edge cases, including exactly-today and the 90-day boundary.
  - Checkout/Checkin allowed rules and the request bodies sent. The fake fetch records calls, and tests assert on the request as Snipe-IT would receive it.
  - Error mapping: 401, 200-with-error, network failure.
  - Dashboard paging across multiple pages, and the counts.
- "Today" is passed in or injectable, so date rules are tested with a fixed date.
- Test runner: Vitest (it fits the Vite toolchain). No UI test framework in v1. The screen and Config are checked by hand by running the app.
- Prior art: none. This is a greenfield repo, so the SnipeIt tests set the pattern.

## Out of Scope

- Creating, editing, or deleting Users, components, licenses, accessories, or Assets (the only writes are Checkout and Checkin)
- Checkout to another Asset
- Audits and audit-overdue reporting
- Camera-based scanning (keyboard-wedge scanners only)
- Offline mode or any local caching of Snipe-IT data
- Multi-user features within one install (each Operator uses their own install and config)
- macOS builds
- Background polling or notifications
- Editing config from inside the app

## Further Notes

- **Student data handling.** Assignees are often students, so the detail sheet, History, and dashboard display student names and Snipe-IT records. Treat the app as a staff-only tool on district-managed machines. Don't run it on shared or public computers. Never copy `config.json` anywhere or commit it. The app stores no student data on disk; everything is fetched live and held in memory only. Don't add export, screenshots-to-file, or logging of Asset or User details without a privacy review.
- **Operator accounts.** Each Operator should use a Snipe-IT account limited to view + checkout/checkin permission, with its own personal API key. That way History credits the right person and a leaked key can't do much damage.
- **Phasing:** Lookup + Asset card → Checkout/Checkin → Dashboard → installers.
- **Layout reference:** branch `prototype/main-screen`, variant B. The prototype is throwaway; rebuild it properly rather than copying it.
- Snipe-IT's API has a rate limit (often 120 requests/minute by default). Normal scanning is far below it. A full dashboard load for 5k Assets is about 10 requests.
