# Audit, health, licence and cost data from the Snipe-IT API

Research for #54 (child of map #50). Date: 2026-10-10.

**Sources.** The Snipe-IT source at tag
[`v8.8.0`](https://github.com/grokability/snipe-it/tree/v8.8.0) (the latest release, published 2026-09-30) is the main
authority. Older tags (`v7.1.17`, `v8.0.0` to `v8.7.2`) were checked wherever a feature's age matters. The
[official API reference](https://snipe-it.readme.io/reference/api-overview) was used too, but it lags the code: its
`/maintenances` page still documents `title` and `asset_maintenance_type`, which v8.6 replaced. Where the two disagree,
the code wins.

Links below use `S/` for `https://github.com/grokability/snipe-it/blob/v8.8.0/`.

## Cheap counting: `limit=1` and read `total`

Every list endpoint returns `{ total, rows }`. `limit` is capped at `MAX_RESULTS`, 500 by default
([SetPaginationDefaults](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Middleware/SetPaginationDefaults.php#L12-L17),
[config/app.php L125](https://github.com/grokability/snipe-it/blob/v8.8.0/config/app.php#L125)). `limit=0` doesn't mean
"none"; it falls back to the maximum. So **`?limit=1` and reading `total`** turns any filter into a one-request count.
The rest of this document leans on that.

The rate limit is 120 requests per minute per user, set by `API_THROTTLE_PER_MINUTE`
([config/app.php L569](https://github.com/grokability/snipe-it/blob/v8.8.0/config/app.php#L569),
[docs](https://snipe-it.readme.io/reference/api-throttling)). Past it the server answers **HTTP 429** with
`{status:"error", messages:"Too many requests…", retryAfter}` and a `Retry-After` header
([RouteServiceProvider L91-L101](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Providers/RouteServiceProvider.php#L91-L101)).

## Audits

- **Fields.** Every Asset row carries `last_audit_date` (a datetime object) and `next_audit_date` (a date object), in v7
  and v8 alike ([AssetsTransformer L112-L113](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L112-L113)).
  Both can be sorted (`sort=next_audit_date`) ([AssetsController L97-L116](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L97-L116)).
- **Endpoints.** `GET /hardware/audit/due`, `/hardware/audit/overdue` and `/hardware/audit/due-or-overdue` exist (`audits/…`
  works too) ([routes/api.php L604-L611](https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L604-L611)),
  unchanged since at least v7.1.17. They go to the ordinary `/hardware` index method, so **every `/hardware` filter
  applies on top**: `location_id`, `category_id`, `model_id`, `status_id`, `company_id`, `search`/`filter`, sorting and
  paging ([AssetsController L195-L209, L342-L348](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L195-L209)).
  - *due* = `next_audit_date` between today and today + `audit_warning_days` (inclusive). *overdue* = `next_audit_date`
    before today. Both exclude archived Assets ([Asset::scopeDueForAudit / scopeOverdueForAudit, L1726-L1758](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L1726-L1758)).
    These match the glossary's **Audit due** and **Audit late**. One difference: the glossary sets a 30-day window,
    while the server uses whatever the admin set as the warning days.
  - Count per Location: `GET /hardware/audit/overdue?location_id=12&limit=1` and read `total`.
  - Reading these needs only `assets.view`. Recording an Audit (`POST /hardware/{id}/audit`, or `/hardware/audit/bulk`
    since v8.8) needs `assets.audit` ([AssetPolicy L20-L23](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Policies/AssetPolicy.php#L20-L23)).
- **The settings can't be read through the API.** `audit_interval` (months) and `audit_warning_days` live in
  Settings. The API's `settings` resource is registered `except` `index` and `show`. Only update, store and a few
  superuser tools (LDAP test, backups, login attempts) remain
  ([routes/api.php L1049-L1118](https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L1049-L1118)).
  Nothing in any transformer echoes either value. The only indirect leaks:
  - Recording an Audit sets `next_audit_date = today + audit_interval` and sends it back, which reveals the interval
    but writes a log entry ([AssetsController L1752-L1764](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1752-L1764)).
    Not usable.
  - The difference between `/audit/due-or-overdue` and `/audit/overdue` shows which dates fall in the server's window,
    but not how wide the window is.
  - **Conclusion:** the app has to keep its own warning-days setting (default 30, as the glossary says). To match the
    server exactly, use `/hardware/audit/due` rather than computing the window from the dates.
- **No "next major audit".** Snipe-IT has no inventory-wide audit date or audit campaign. There is only one setting
  (`audit_interval`, which can't be read) and a `next_audit_date` on each Asset. The closest things to it:
  - the earliest upcoming date: `GET /hardware?sort=next_audit_date&order=asc&limit=1` (Assets without a date sort
    first in MySQL, so add `filter={"next_audit_date":"is:not_null"}` on v8.5 and later);
  - in v8.8 only, `GET /calendar/events?event_type=asset.audit_due&start=…&end=…` lists each Asset's `next_audit_date`
    as an event. The limit is 500 and there is no offset, but it returns `total` and `truncated`
    ([CalendarEventsController](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/CalendarEventsController.php),
    [Asset calendar sources L1898-L1925](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L1898-L1925)).
    This endpoint (and `/dashboard/*` and `/low-stock`) doesn't exist on v8.7.2 or earlier.
  - Anything more, such as "the school's annual audit is in June", is a date the app would have to store itself.

## Health

### Unreachable versus a bad key

| What the Operator sees | What the server does |
|---|---|
| Network error or timeout | The server can't be reached (the app already reports this) |
| **401** `{"error":"Unauthorized."}` | The key is unknown, revoked or expired ([Handler::unauthenticated L246-L253](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Exceptions/Handler.php#L246-L253)). **Also** the key's User has been deactivated: since v8.8 the API middleware answers a JSON 401 that deliberately reads the same as a bad key ([CheckUserIsActivated L47-L76](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Middleware/CheckUserIsActivated.php#L47-L76), [Kernel `api` group L86-L96](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Kernel.php#L86-L96)) |
| **403** | The key is valid but lacks the permission for that endpoint (a policy `authorize()`). Since v8.8 there are two more 403s that apply to every request: **2FA required but not enrolled** (`messages` = the "please enroll" text) ([EnforceApiTwoFactorEnrollment](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Middleware/EnforceApiTwoFactorEnrollment.php)), and **User-Agent blocked** (`payload.user_agent` echoed back). Blocking is off by default, the default list doesn't include Node's `node` UA, and an admin can add patterns ([EnforceApiUserAgent](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Middleware/EnforceApiUserAgent.php), [Setting::DEFAULT_BLOCKED_API_USER_AGENTS L94-L114](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Setting.php#L94-L114)) |
| **429** | Rate limited (see above) |
| 200 with `{"status":"error"}` | A validation error, or a model that wasn't found (Snipe-IT's usual style) |

- **Token expiry.** Personal access tokens are Passport tokens. They last `API_TOKEN_EXPIRATION_YEARS` (20 years by
  default in `config/passport.php`, and the sample `.env` sets 15)
  ([AuthServiceProvider L106-L109](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Providers/AuthServiceProvider.php#L106-L109),
  [config/passport.php L16](https://github.com/grokability/snipe-it/blob/v8.8.0/config/passport.php#L16)). The API has
  no endpoint that reports a token's expiry date. An expired token simply returns 401. A good test of the key is
  `GET /users/me`, which needs nothing beyond a valid key; that is what `testConnection()` already calls.
- **The running version.** `GET /version` returns `{version:"v8.8.0", build_version, hash_version, full_version}`
  ([routes/api.php L1504-L1513](https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L1504-L1513),
  [config/version.php](https://github.com/grokability/snipe-it/blob/v8.8.0/config/version.php)). It sits inside the
  authenticated `v1` group, so it needs a valid key, but no particular permission.
- **The latest release.** `GET https://api.github.com/repos/grokability/snipe-it/releases/latest` returns the newest
  release that isn't a draft or prerelease. Its `tag_name` (`"v8.8.0"`) uses the same `vX.Y.Z` format as `/version`'s
  `version`, so a semver comparison works. Unauthenticated, this is limited to **60 requests per hour per IP**
  (`x-ratelimit-limit: 60`, observed), so cache it, e.g. one check a day. Recent releases: v8.8.0 (2026-09-30), v8.7.2
  (2026-08-19), v8.7.1, v8.7.0 (2026-08-11), v8.6.3 (2026-06-15).

### Deactivated Users who still hold Assets

- Users carry `activated` (boolean) and the counts `assets_count`, `licenses_count`, `accessories_count` and others
  ([UsersTransformer L106-L111](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/UsersTransformer.php#L106-L111)).
  Filtering works with `?activated=0` ([UsersController L184-L186](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L184-L186);
  the same in v7.1.17).
- `?assets_count=N` is an **equality** test (`has('assets','=',N)`), so it can't express "more than 0"
  ([L304-L306](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/UsersController.php#L304-L306)).
  Instead use **`GET /users?activated=0&sort=assets_count&order=desc&limit=500`** (`assets_count` can be sorted on)
  and keep rows until `assets_count` reaches 0. That is usually a single request. Do the same with
  `licenses_count`/`accessories_count` to match the glossary's **Holding**.

### Assets missing a Serial, Asset Model or Location

- **v8.5 and later:** the structured `filter` parameter (JSON) accepts the values `is:null` and `is:not_null`
  ([Searchable::parseFilterValue L215-L265, applyNullFilter L680-L760](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L215-L265)).
  For text columns `is:null` also matches `''`. For a relation key it means "has no related record". The feature
  doesn't exist in v8.4.0 and was found in v8.5.0.
  - `GET /hardware?filter={"serial":"is:null"}&limit=1` gives Assets with no Serial (`serial` is a searchable column,
    [Asset L224-L240](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L224-L240)).
  - `filter={"location":"is:null"}` gives Assets with no Location. `filter={"model":"is:null"}` gives Assets whose
    Asset Model is missing. Asset Model is required on save, so in practice this means a deleted Asset Model, which
    the API shows as `model: null`. Both are relation keys
    ([Asset L247-L258](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L247-L258)).
    Snipe-IT's own tests exercise this on `supplier` and `asset_eol_date`
    ([SearchableTraitTest L797-L931](https://github.com/grokability/snipe-it/blob/v8.8.0/tests/Feature/Search/SearchableTraitTest.php#L797)).
  - Several keys in one `filter` are ANDed by default (`filter_operator=or` switches them to OR).
- **Before v8.5:** there is no null filter. Page through `/hardware`, which the dashboard already does with
  `allRows`, and test the fields in the app.

## Licenses: free seats

- Each License row has `seats`, `free_seats_count`, `remaining`, `percent_remaining`, `min_amt`, `expiration_date` and
  `termination_date` ([LicensesTransformer L40-L50](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/LicensesTransformer.php#L40-L50)).
  - In **v8.8**, `free_seats_count` = free seats **minus the free seats that can't be reassigned**, i.e. what can
    actually be handed out. `remaining` is the raw number of free seats.
  - In **v7.1.17**, `free_seats_count` is the raw count and there is no `remaining`. The app already reads
    `free_seats_count` (`QUANTITIES` in `src/main/snipeit.ts`), which works on both.
  - `free_seats_count` and `seats` can be sorted on
    ([LicensesController L181-L194](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/LicensesController.php#L181-L194)),
    so `GET /licenses?sort=free_seats_count&order=asc` puts the Licenses closest to running out first.
- **The threshold.** `min_amt` is the per-License "minimum quantity" an admin sets. Snipe-IT itself raises a License
  when `available < min_amt + alert_threshold` (`alert_threshold` is a setting the API can't read)
  ([Helper::checkLowInventory L848-L919](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Helpers/Helper.php#L848-L919)).
  - In v8.8, `GET /low-stock` returns that exact list across Licenses, Accessories, Consumables, Components and Asset
    Models ([LowStockController](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/LowStockController.php)).
  - On older servers, compare `free_seats_count` against `min_amt` (or an app-side number) in the app.
  - A License with no `min_amt` never raises an alert in Snipe-IT.

## Cost and Maintenances

- **`purchase_cost` is a formatted string**, not a number. It comes through `Helper::formatCurrencyOutput` as
  `"1,234.56"`, or `"1.234,56"` when the admin's digit separator is set that way
  ([AssetsTransformer L121, `book_value` L126](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L121),
  [Helper L150-L163](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Helpers/Helper.php#L150-L163)). It is
  `null` when no cost is set.
  - Licenses also send `purchase_cost_numeric`. Assets and Maintenances don't. To total costs, parse the string and
    allow for both separator styles.
  - `book_value` (the depreciated value) comes in the same format.
  - Asset `purchase_cost` can be sorted on, and searched through `filter`.
- **Maintenances API**, `/api/v1/maintenances` (the same path since v7)
  ([routes/api.php L728-L760](https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L728-L760)):
  - **Read** (`GET /maintenances`, `GET /maintenances/{id}`) needs `assets.view`. **Create, update, delete and
    complete** need `assets.edit` (`update` on Asset)
    ([MaintenancesController L43, L224, L296, L370, L406](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/MaintenancesController.php#L43)).
  - **List filters:** `asset_id`, `supplier_id`, `created_by`, `maintenance_type_id`, `responsible_party_id`,
    `completed=true|false`, `upcoming_status=due|overdue|due-or-overdue` (by expected completion), and
    `search`/`filter`. `cost` and `start_date` are among the sortable columns
    ([L54-L151](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/MaintenancesController.php#L54-L151)).
  - **Row fields:** `id`, `name` (and `title` as an alias), `asset {id,name,asset_tag,serial}`, `model`,
    `status_label`, `location`, `supplier`, `cost` (a formatted string, as above), `start_date`,
    `expected_completion_date`, `completion_date` (in v8.8 this is the same as the expected date), `completed_at`,
    `completed_by`, `is_warranty`, `url`, `notes`, `maintenance_type`/`maintenance_type_details`,
    `responsible_party`, `created_by`, and `asset_maintenance_time` (days)
    ([MaintenancesTransformer](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/MaintenancesTransformer.php)).
  - **Creating one: the required fields changed between versions.**

    | Version | Required |
    |---|---|
    | v7.1.17 | `asset_id`, `supplier_id`, `title`, `asset_maintenance_type` (string), `start_date` (Y-m-d) ([AssetMaintenance v7](https://github.com/grokability/snipe-it/blob/v7.1.17/app/Models/AssetMaintenance.php)) |
    | v8.3 | `asset_id`, `name`, `asset_maintenance_type`, `start_date`; `supplier_id` became optional |
    | **v8.6 and later** | `asset_id` (or `asset_ids[]` for a bulk create in v8.8), `name`, **`maintenance_type_id`** (must exist in the new `/maintenance-types`), `start_date` ([Maintenance rules L51-L69](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Maintenance.php#L51-L69)) |

    Optional fields: `cost` (numeric, ≥ 0), `is_warranty`, `expected_completion_date`, `notes`, `url`,
    `responsible_party_id`, `completed_at`. v8.6 and later also have `POST /maintenances/{id}/complete`, and
    `/maintenances/{id}/notes`.
  - So a Repair intake that logs a Maintenance has to check the version: send `maintenance_type_id` on v8.6 and
    later, `asset_maintenance_type` before that.
  - `PATCH /maintenances/{id}` updates a Maintenance and needs `assets.edit`.

## Checkouts over time (Activity Report)

- `GET /reports/activity` filters on `action_type` (exact, e.g. `checkout`, `checkin from`, `audit`), `created_by`,
  `action_source` and `remote_ip`. It filters on `item_type`/`target_type` **only together with** `item_id`/`target_id`.
  **There is no date-range parameter**
  ([ReportsController L69-L109](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/ReportsController.php#L69-L109)).
  This is true in v7.1.17 and v8.8 alike. It needs `reports.view` or admin (`activity.view`,
  [AuthServiceProvider L276-L280](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Providers/AuthServiceProvider.php#L276-L280)).
- **Workaround: count by month or day on v8.5 and later.** `created_at` and `action_date` are searchable columns on
  the log ([Actionlog L72-L84](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Actionlog.php#L72-L84)),
  and the report passes `filter` through to the structured search (v8.5 and later). A structured filter on a column
  is a `LIKE '%value%'` ([Searchable L309-L316](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L309-L316)), so
  `GET /reports/activity?action_type=checkout&filter={"created_at":"2026-09-"}&limit=1` gives
  `total` = the number of Checkouts in September 2026, in one request.
  - A 12-month line chart therefore costs **12 requests**, and a 30-day chart costs 30. Either way the size of the log
    doesn't matter.
  - The dates are the server's stored `created_at`, in the app timezone.
  - On v8.3 and v8.4, `search=2026-09-` also matches `created_at`, but it is noisier: a free-text term matches across
    all searchable columns, and dates only match when the term looks like a timestamp
    ([Searchable L826-L840](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L826-L840)).
  - This comes from reading the source. It hasn't been tried against a live server; verify it once before building
    on it.
- **The fallback, which is what `report()` does today:** page newest first with `sort=created_at&order=desc` at 500
  rows a page, and stop once past `from`. The cost is the number of entries in the range divided by 500 (plus one).
  `action_type=checkout` keeps only Checkouts, which shrinks that number. At 120 requests per minute, 60,000 entries
  in range take about 120 requests, roughly a minute of the rate budget.
- `/calendar/events?event_type=asset.checkout` (v8.8) is **not** a history: it reflects each Asset's `last_checkout`
  only.

## Warranty and end of life

- `warranty_months` (a string like `"36 months"`) and `warranty_expires` (a date object) are present only when
  `warranty_months > 0` ([AssetsTransformer L104-L105](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L104-L105)).
  - `warranty_expires` isn't stored. It is computed as `purchase_date + warranty_months`
    ([Asset L358-L363](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L358-L363)), so it
    **can't be filtered or sorted** on the server. "Warranty expiring" stays an app-side scan of `/hardware`, as now.
  - In v8.8 only, `/calendar/events?event_type=asset.warranty_expiration&start=…&end=…` lists warranty ends in a
    window. It is capped at 500.
- **End of life.**
  - `asset_eol_date` (a stored date column since v6.0.x): a date object, or null. It can be sorted and filtered.
  - `eol`: the months from `purchase_date` to `asset_eol_date`, as a string.
  - The Asset Model's `eol`: the model default, `"N months"` or `"None"`
    ([AssetsTransformer L46-L47](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L46-L47),
    [AssetModelsTransformer L76](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetModelsTransformer.php#L76)).
  - `GET /hardware?past_eol=1` lists Assets past their EOL date. This is v8.8 only; v8.7.2 doesn't have it
    ([AssetsController L226-L228](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L226-L228)).
    On older versions, sort by `asset_eol_date` and test the dates in the app.
  - `calendar/events?event_type=asset.eol` (v8.8) gives EOL dates in a window.

## Summary for the redesign

- Audit due, Audit late, deactivated Users with Holdings, Licenses running low, and the missing-field checks can each
  be **one request** (`limit=1` → `total`, or one sorted page). Most need v8.5 or later for `filter`, or v8.8 for
  `/low-stock`, `past_eol` and `/calendar/events`. On older servers, fall back to the app's existing `allRows`
  paging.
- The app has to keep its own audit warning days, because Settings can't be read.
- Check the version with `/version` against GitHub's `releases/latest`, cached once a day, and use the same version
  to choose the Maintenance create fields.
- A 401 means "key rejected or account deactivated" (the server deliberately doesn't say which). A 403 means "missing
  permission, 2FA not enrolled, or User-Agent blocked", and the body's `messages` tells them apart.
