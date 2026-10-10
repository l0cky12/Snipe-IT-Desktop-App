# The Snipe-IT API calls behind each Workflow

Research for [#53](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/53), part of the map [#50](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/50). Terms (Workflow, Operator, User, Checkin, Damaged…) are as in `CONTEXT.md`.

**Sources.** Snipe-IT source at tag [`v8.8.0`][tag] (2026-09-30, the latest release; `master` two days later differs in none of the behaviour below), plus the official API reference at snipe-it.readme.io. Where the docs and the code disagree, the code wins and the gap is called out. Line links point at `v8.8.0`.

## Answer in brief

| Question | Answer |
|---|---|
| Does `/users?search=` match `employee_num`? | Yes. It does `LIKE %text%` on 17 User columns, `employee_num`, `email` and `username` among them, plus related names. |
| Exact filters? | Yes: `/users?employee_num=`, `?email=`, `?username=` (and `first_name`, `last_name`, `display_name`…) are each an exact `=` match. |
| Fastest while typing? | `GET /users/selectlist?search=`: 5 columns, no relation joins, no counts, 50 per page, and it needs only the Checkout/Checkin permission, not `users.view`. |
| Checkin + Status Label + note in one call? | Yes. `POST /hardware/{id}/checkin` with `status_id` and `note` gives one History entry carrying the note and the status change. |
| Status change with a note? | Not in one call. `PATCH /hardware/{id}` logs an "update" with no note. Add the note with `POST /notes/{asset}/store` (v8.3.0+). Both need `assets.edit`. |
| Does PATCH `/users/{id}` replace `notes`? | Yes, the whole field. It needs `users.edit`. Without it you get HTTP 403. The `notes` you read back is rendered Markdown, not the stored text, so a read-modify-write can damage it (see below). |
| Undoing a Checkout | A Checkin is the only way. History keeps both entries, the checkout and the "checkin from". The API can't delete History. |
| Operator's name | `GET /users/me` → `name` (first + last, in the site's name order), `display_name` (null unless set), `username`, `email`. |
| Status Label by name | `GET /statuslabels?name=Damaged`: exact, and names are unique. Needs `statuslabels.view`. `GET /statuslabels/selectlist?search=` needs only Checkout/Checkin. |
| Throttling | 120 requests per minute per Operator by default (`API_THROTTLE_PER_MINUTE`). Over that you get HTTP 429 with `Retry-After`. |

## 1. Finding a User by name, email or employee number

**`GET /api/v1/users?search=…`** ([UsersController::index][users-index])
- Needs `users.view` ([line 46][users-index]).
- `search` goes through the `Searchable` trait. It is split only on the literal `" AND "` ([`prepeareSearchTerms`][prep-terms]). Each term is matched as `column LIKE '%term%'` against every searchable attribute ([`searchAttributes`][search-attrs]).
- For a User, the searchable attributes are `address, city, country, display_name, email, employee_num, first_name, jobtitle, last_name, locale, mobile, notes, phone, state, username, website, zip` ([User::$searchableAttributes][user-searchable]). On top of those come related names: Location, Department, Groups, Companies, the manager, and who created the User ([`$searchableRelations`][user-relations]).
- "Jane Smith" works as one term because `advancedTextSearch` also matches `CONCAT(first_name, ' ', last_name)` ([User::advancedTextSearch][user-adv]).
- **So yes, `search` matches `employee_num`, but only as a substring.** "123" also matches "41234", and any phone number, zip or note containing 123.
- It is the heaviest query: about 23 columns or relations OR-ed together with leading-wildcard `LIKE` (no index can help), plus `withCount` over seven relations on every row ([line 93][users-withcount]).

**Exact filters on the same endpoint.** `email`, `username`, `first_name`, `last_name`, `display_name` and `employee_num` are each `where(column, '=', value)` ([lines 224–246][users-exact]). They are ANDed with `search` if both are sent. The official docs mention only `email` and `username` as exact, since v4.9.4 ([API reference: Users][docs-users]), but the code treats `employee_num` the same way. `username` has an index (migration `2022_06_28_234539_add_username_index_to_users`); no migration indexes `employee_num`.

**`GET /api/v1/users/selectlist?search=…`** ([UsersController::selectlist][users-selectlist]), the endpoint behind Snipe-IT's own checkout dropdown
- Needs only the `view.selectlists` gate. That passes for anyone who can create or update any record kind, or **check out or check in any item**, or audit, or view reports ([AuthServiceProvider][selectlist-gate]). So an Operator who has `assets.checkout` but not `users.view` can still find Users this way.
- It matches `first_name`, `last_name`, `display_name`, `first last`, `username`, `email` and `employee_num` with `LIKE %text%` ([lines 436–444][users-selectlist-search]). No relations, no counts, 50 per page, ordered by display name.
- It leaves out Users whose `show_in_list` flag is off.
- It returns `{results: [{id, text, image}], pagination: {more}, total_count…}`. `text` is `display_name (username) - #employee_num` ([lines 449–461][users-selectlist-text]). It does not return email, nor which field matched.

**Recommendation for Bulk checkout.** Look up exact first, then fall back to typing:
1. Anything that looks like a whole employee number or email (a scanned ID card, or text with `@`): try `GET /users?employee_num=X` or `?email=X&limit=2`. If exactly one row comes back, take it.
2. Otherwise, while the Operator types: debounce (about 250–300 ms), then `GET /users/selectlist?search=X`. It is lighter, and it works for Operators without `users.view`.
3. `GET /users?search=` stays the choice when the Operator needs to see why a User matched (the app's Lookup already does this).

Every keystroke request counts against the same 120/min as the scans (§7).

## 2. Checkin with a Status Label and a note

**`POST /api/v1/hardware/{id}/checkin`** ([AssetsController::checkin][checkin])
- Needs `assets.checkin` ([CheckoutablePermissionsPolicy::checkin][policy-checkin]).
- Body:
  - `status_id`: optional in code, applied only if `filled` ([line 1518][checkin-status]). The docs mark it required ([API reference: Checkin][docs-checkin]). Keep sending it.
  - `note`
  - `location_id` (+ `update_default_location`)
  - `checkin_at`
  - `name` / `clear_name`
- The status can be any label: the only check is the Asset's own rule `status_id: required|integer|exists:status_labels,id` ([Asset rules][asset-rules]). An undeployable "Damaged" label is fine.
- **One call does it all.** The checkin raises `CheckoutableCheckedIn`, which writes **one** History entry: action `checkin from`, with the `note`, and `log_meta` showing `status_id` (and `location_id`, `expected_checkin`) old → new ([Loggable::logCheckin][log-checkin]).
- The asset observer doesn't add a second "update" entry for a checkin ([AssetObserver::updating][asset-observer]).
- The API checkin does **not** enforce the "require checkin/checkout notes" setting. Only the web form's `AssetCheckinRequest` does. Checkout does enforce it ([AssetCheckoutRequest rules][checkout-rules]). So when that setting is on, a Checkout without a note fails with `{"status":"error","messages":{"note":[…]}}` (HTTP 200).
- Side effects of every checkin:
  - Location goes back to the Asset's default location unless `location_id` is sent.
  - `expected_checkin` is cleared and `last_checkin` is set.
  - License seats on the Asset are freed.
  - Pending acceptances are deleted.

**Status change on an Asset that isn't checked out (Incoming repair).**
- `POST …/checkin` refuses with "already checked in" (HTTP 200, `status: error`).
- `PATCH /api/v1/hardware/{id}` with `{status_id}` ([route][patch-route], [update][asset-update]) needs `assets.edit` ([UpdateAssetRequest::authorize][update-auth] → [SnipePermissionsPolicy::update][policy-update]). It writes an `update` History entry whose `log_meta` diff has **no note** ([AssetObserver][asset-observer]).
- Sending `notes` in that PATCH overwrites the Asset's own Notes field. That isn't a History note.
- To put a note in History, make a second call: **`POST /api/v1/notes/{asset}/store`** with `{note}`. It writes a `note added` entry credited to the Operator and needs `assets.edit` ([NotesController::store][notes-store]). It was added in **v8.3.0**: absent at v8.2.1, present at v8.3.0.
- So Incoming repair is two calls and two History entries.
- A repair vendor could also be recorded as a Maintenance (`POST /api/v1/maintenances`, `supplier_id`, `assets.edit`). That is a bigger model than "note that it returned from repair"; noted only as an option.

## 3. Appending to a User's notes

**`PATCH /api/v1/users/{id}`** ([UsersController::update][users-update])
- Needs `users.edit`. `UserPolicy` uses the base `update` → `hasAccess('users.edit')` ([SnipePermissionsPolicy::update][policy-update]). `admin` and Superuser pass everything ([`before`][policy-before]). With multiple companies on, the User must be in the Operator's company.
- PATCH validates only the fields sent ([SaveUserRequest PATCH][saveuser-patch]), so `{notes: "…"}` alone is accepted.
- `fill($request->except(…))` sets `notes` to exactly what was sent ([line 670][users-fill]). **It replaces the whole field. There is no append operation.** The column is `TEXT` (about 64 KB).
- Each save writes an `update` History entry on the User, with the **full old and new notes text** in `log_meta` ([UserObserver][user-observer]). That copy is permanent.
- **Without `users.edit`:** the policy throws `AuthorizationException`. Snipe-IT's handler doesn't catch it ([Handler][handler]), so Laravel renders HTTP **403** `{"message":"This action is unauthorized."}`. The app's `request()` turns that into "Snipe-IT returned HTTP 403: …", and `allowed()` already reads 403 as a refusal.
  - The same goes for reading: `GET /users/{id}` needs `users.view`. Without it, a User nested inside another record shows only `{id, type, name}` ([UsersTransformer][users-transformer-gate]).
  - The response shape is inferred from Laravel's default rendering. Confirm it on the live server.

**The read side is not raw.** `GET /users/{id}` returns `notes` as `Parsedown->line(strip_tags($notes))` in safe mode ([UsersTransformer][users-transformer-notes], [Helper::parseEscapedMarkedownInline][helper-md]). The stored text comes back rendered as HTML:
- `*x*` becomes `<em>x</em>`.
- Links become `<a>`.
- Any HTML typed into the notes is stripped.
- A line ending in two spaces gains `<br />`.
- `&`, `<` and `>` come back entity-escaped. The app's `decodeHtml` undoes this part.

**No API returns the raw `notes`**, and nothing guards against two writers at once (no version or ETag check).

**A safe read-modify-write:**
1. Before showing Repair intake, check that the key can do it: a `PATCH` with no changes isn't a clean probe. Instead, catch the 403 on the real write and fall back (step 6).
2. `GET /users/{id}` and decode the entities in `notes`.
3. If the decoded text contains anything Parsedown would have produced (`<em>`, `<strong>`, `<code>`, `<a `, `<br`, `<del>`, `<img`), **stop**: the stored text can't be rebuilt. Tell the Operator to add the line in Snipe-IT's web UI. Otherwise the text came back unchanged.
4. `PATCH /users/{id}` `{notes: old + (old ? "\n" : "") + newLine}`, where `newLine` is a dated, factual line, e.g. `2026-10-10 Repair intake: [Asset Tag] — cracked screen (J. Doe)`.
5. Re-`GET` and check that `notes` ends with `newLine` and still starts with `old`. If not, someone else wrote in between: report it, don't retry blindly.
6. On a 403 at any step, the Checkin (with its note) has already happened. Say that the User note was skipped and why, and leave the rest of the Workflow done.

Keep the line factual and free of anything about the student beyond what happened to the Asset, per the district's student-records rules.

## 4. Undoing a Checkout

- **A Checkin is the only way.** The API has no route that reverses a checkout or deletes History: the `activity` routes are read-only ([routes/api.php][routes]).
- `POST /hardware/{id}/checkin` with `status_id` set to the status it had before, `location_id` set to the location it had before, and `note` such as `Undo: checked out by mistake`. That leaves:
  - **two History entries**, `checkout` (to the User) then `checkin from` (with the undo note), both credited to the Operator;
  - `checkout_counter` and `checkin_counter` each +1, and `last_checkout` still showing the undone time;
  - `last_checkin` set to now, `expected_checkin` cleared;
  - pending acceptances for it deleted ([checkin][checkin]).
- Any email the Checkout triggered has already gone: acceptance, EULA, or the category's "email on checkin/checkout" setting ([CheckoutableListener][checkoutable-listener]). The Checkin may send a checkin email too.
- So undo is "check it back in, with a note", not erasure. The Workflow should record each Asset's status and location before checkout, so undo can restore them.

## 5. The Operator's name

`GET /api/v1/users/me` ([route][me-route], [getCurrentUserInfo][me]) returns the full `transformUser` for the caller. It never strips fields, because the caller is viewing itself ([UsersTransformer line 48][users-transformer-gate]). The name fields:
- `name`: `first last`, or `last first` when the site's name format is "last_first" ([User::getFullNameAttribute][user-fullname]).
- `display_name`: the stored value, or `null` when unset. The model's accessor falls back to the full name, but the API returns the raw value ([transformer line 69][users-transformer-name]).
- `first_name`, `last_name`, `username`, `email`, and `role` (`superadmin` / `admin` / `null`).

**Use `display_name ?? name`** for "checked out by …" text.

## 6. Finding a Status Label by name

- **`GET /api/v1/statuslabels?name=Damaged`**: an exact `where name = ?` ([StatuslabelsController::index line 50][sl-name]).
  - Names are `unique_undeleted` ([Statuslabel rules][sl-rules]), so it returns zero or one row.
  - Each row carries `type` (`deployable` / `pending` / `undeployable` / `archived`).
  - The comparison follows the database collation, which is case-insensitive with MySQL/MariaDB's usual `utf8mb4_unicode_ci`.
  - Needs `statuslabels.view`. The app's current `statusLabels()` (`/statuslabels?limit=500`) needs it too.
- **`GET /api/v1/statuslabels/selectlist?search=Damaged`**: a `LIKE %…%` match ([selectlist][sl-selectlist]), with optional `deployable` / `pending` / `archived` filters. Returns `{id, text}`. It needs only `view.selectlists`, which every Operator with Checkout or Checkin passes.
- A fresh install seeds only "Ready to Deploy", "Pending" and "Archived". **"Damaged" has to be created by an admin.**
  - Resolve both labels by name once per session and cache the ids.
  - If a label is missing, say "No Status Label named 'Damaged' in Snipe-IT" instead of failing on each scan.
  - Better still, let the Operator pick the Damaged / Ready-to-deploy labels in Settings, defaulting by name. Sites rename them.

## 7. Throttling

- Every `/api/v1` route runs through the `api-throttle:api` middleware ([routes/api.php line 18][routes-throttle]). That is `SetAPIResponseHeaders`, a `ThrottleRequests` subclass ([Kernel][kernel], [middleware][throttle-mw]).
- The `api` limiter is `Limit::perMinute(config('app.api_throttle_per_minute'))`, **keyed by the user id, falling back to IP** ([RouteServiceProvider][rate-limiter]). The default is **120/min**, set by `API_THROTTLE_PER_MINUTE` ([config/app.php][config-throttle]; [API reference: throttling][docs-throttle], which says the setting exists since v5.4.0).
- The limit is per Operator. Operators at two counters don't share it.
- Every response carries `X-RateLimit-Limit` and `X-RateLimit-Remaining`.
- Over the limit: HTTP **429**, headers `Retry-After`, `X-RateLimit-Reset` and `X-RateLimit-Reset-Timestamp`, and body `{"status":"error","messages":"Too many requests. Try again in N seconds.","retryAfter":N}`.
- Page size is capped at 500 (`MAX_RESULTS`) ([config/app.php line 125][config-maxresults]).

**What that means for scanning loops** (requests per scanned Asset, in the shape the app uses today):

| Workflow step | Calls | Count |
|---|---|---|
| Bulk checkout, per Asset | `GET /hardware/bytag/{tag}` → `GET /hardware/{id}` (`current()`) → `POST /hardware/{id}/checkout` | 3 → **~40 Assets/min** |
| Bulk return, per Asset | bytag → `current()` → `POST …/checkin` | 3 → ~40/min |
| Repair intake, per Asset | bytag → `current()` → `POST …/checkin` (Damaged + note) → `GET /users/{id}` → `PATCH /users/{id}` → re-`GET` | 6 → ~20/min |
| Incoming repair, per Asset | bytag → `PATCH /hardware/{id}` (status) → `POST /notes/{id}/store` | 3 → ~40/min |
| Finding a User | one request per debounced keystroke | shares the same budget |

**Ways to save requests:**
- The `current()` re-read after a bytag lookup is redundant. The bytag response already holds `assigned_to` and `status_label`, so drop it and save one request per Asset.
- Snipe-IT has **by-tag write endpoints**: `POST /hardware/bytag/{tag}/checkout` ([checkoutByTag][checkout-bytag]) and `POST /hardware/bytag/{tag}/checkin` ([checkinByTag][checkin-bytag], since v6.0). One request per scan, and the server enforces the rules:
  - Checkout re-checks availability under a row lock ([line 1449][checkout-lock]).
  - Checkin refuses one that isn't checked out.
  - The cost: the response is thin (asset tag and model only), so the session list would show less unless the app reads the Asset afterwards anyway.
  - `status_id` on checkout is `nullable` in v8.8.0 ([AssetCheckoutRequest][checkout-rules]), but the docs mark it required ([API reference: Checkout][docs-checkout]). Older servers may insist on it, which needs a read first.
- The API has **no bulk checkout or checkin**. Snipe-IT's bulk checkout exists only in the web UI. `PATCH /hardware/bulk` exists for field edits, not for assignment.
- Handle 429 by pausing the loop for `Retry-After` seconds and keeping the scanned queue, instead of failing the scan.

## 8. Temp checkout (one fact the Workflow needs)

`expected_checkin` became a **datetime** in **v8.7.0** (migration `2026_07_17_000002_change_expected_checkin_to_datetime`: absent at v8.6.3, present at v8.7.0). On v8.7.0+:
- `POST …/checkout` with `expected_checkin: "2026-10-10 14:50:00"` stores the time ([Asset::setExpectedCheckinAttribute][asset-expected]).
- The time is parsed in the server's app timezone. Send local time without an offset only if the server runs in the school's timezone.
- "Overdue" turns time-aware at the same moment: `expected_checkin < now()` ([scopeOverdueForCheckin][asset-overdue]).
- `GET /hardware/checkins/due-or-overdue` lists due and overdue Assets for every Operator ([route][list-upcoming]).

On older servers the time is dropped and only the date is stored. There is no Temp checkout flag. Telling one from an ordinary Checkout needs a marker, either a fixed note prefix or the end-of-day time itself. That design question belongs to the Temp checkout ticket.

## Per Workflow

| Workflow | Calls | Permissions |
|---|---|---|
| **Bulk checkout** | find User: `GET /users?employee_num=` / `?email=` exact, else `/users/selectlist?search=`; per Asset: `GET /hardware/bytag/{tag}`, `POST /hardware/{id}/checkout` (`checkout_to_type=user`, `assigned_user`, `status_id`, `note` if notes are required); undo = `POST /hardware/{id}/checkin` with the previous status and location | `assets.checkout`, `assets.checkin` (undo); `users.view` only for the exact filters |
| **Bulk return** | per Asset: bytag, `POST /hardware/{id}/checkin` (`status_id` = Ready to Deploy) | `assets.checkin`, plus `statuslabels.view` or the selectlist to find the label |
| **Repair intake** | bytag, `POST …/checkin` (`status_id` = Damaged, `note`), then the safe read-modify-write of the User's `notes` (§3) | `assets.checkin`; `users.view` + `users.edit` for the User note (optional, degrade on 403) |
| **Incoming repair** | bytag, `PATCH /hardware/{id}` `{status_id}` = Ready to Deploy, `POST /notes/{id}/store` `{note: "Returned from repair (vendor)"}` (v8.3.0+) | `assets.edit` |
| **Temp checkout** | as Bulk checkout, plus `expected_checkin` = end of the school day as a datetime (v8.7.0+); list with `GET /hardware/checkins/due-or-overdue` | `assets.checkout`, `assets.view` |

## Open questions

- Which Snipe-IT version the school runs. The `/notes` API (v8.3.0) and time-of-day `expected_checkin` (v8.7.0) depend on it. The app already reads `/version` in `testConnection()`.
- Whether Operators' Permission Groups include `users.edit`, `assets.edit` and `statuslabels.view`. They decide whether Repair intake can write User notes, and whether Incoming repair works at all.
- Whether the site has turned on "require checkin/checkout notes". If so, every Checkout needs a note.

[tag]: https://github.com/grokability/snipe-it/tree/v8.8.0
[docs-users]: https://snipe-it.readme.io/reference/users
[docs-checkin]: https://snipe-it.readme.io/reference/hardware-checkin
[docs-checkout]: https://snipe-it.readme.io/reference/hardware-checkout
[docs-throttle]: https://snipe-it.readme.io/reference/api-throttling
[users-index]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L44-L46
[users-withcount]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L93
[users-exact]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L224-L246
[users-selectlist]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L396-L412
[users-selectlist-search]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L436-L447
[users-selectlist-text]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L449-L461
[users-update]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L608-L610
[users-fill]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L670-L676
[me]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L1030-L1033
[me-route]: https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L1237-L1242
[user-searchable]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/User.php#L167-L185
[user-relations]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/User.php#L192-L199
[user-adv]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/User.php#L1805-L1817
[user-fullname]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/User.php#L1129-L1138
[prep-terms]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L185-L188
[search-attrs]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L825-L860
[selectlist-gate]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Providers/AuthServiceProvider.php#L340-L381
[checkin]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1480-L1564
[checkin-status]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1518-L1520
[checkin-bytag]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1573-L1626
[checkout-bytag]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1345-L1353
[checkout-lock]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1438-L1462
[asset-update]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L898-L903
[patch-route]: https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L691
[update-auth]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Requests/UpdateAssetRequest.php#L21-L24
[checkout-rules]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Requests/AssetCheckoutRequest.php#L32-L62
[saveuser-patch]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Requests/SaveUserRequest.php#L72-L75
[asset-rules]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L155
[asset-expected]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L287-L297
[asset-overdue]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L1837-L1848
[list-upcoming]: https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L604-L611
[log-checkin]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Loggable.php#L276-L349
[asset-observer]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Observers/AssetObserver.php#L20-L79
[user-observer]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Observers/UserObserver.php#L15-L125
[checkoutable-listener]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Listeners/CheckoutableListener.php
[notes-store]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/NotesController.php#L69-L92
[policy-before]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Policies/SnipePermissionsPolicy.php#L38-L52
[policy-update]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Policies/SnipePermissionsPolicy.php#L152-L155
[policy-checkin]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Policies/CheckoutablePermissionsPolicy.php#L15-L29
[handler]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Exceptions/Handler.php#L141-L180
[users-transformer-gate]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/UsersTransformer.php#L48-L54
[users-transformer-name]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/UsersTransformer.php#L66-L70
[users-transformer-notes]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/UsersTransformer.php#L103
[helper-md]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Helpers/Helper.php#L129-L137
[sl-name]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/StatuslabelsController.php#L50-L52
[sl-selectlist]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/StatuslabelsController.php#L353-L373
[sl-rules]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Statuslabel.php#L36
[routes]: https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php
[routes-throttle]: https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L18
[kernel]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Kernel.php#L120
[throttle-mw]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Middleware/SetAPIResponseHeaders.php
[rate-limiter]: https://github.com/grokability/snipe-it/blob/v8.8.0/app/Providers/RouteServiceProvider.php#L91-L101
[config-throttle]: https://github.com/grokability/snipe-it/blob/v8.8.0/config/app.php#L569
[config-maxresults]: https://github.com/grokability/snipe-it/blob/v8.8.0/config/app.php#L125
