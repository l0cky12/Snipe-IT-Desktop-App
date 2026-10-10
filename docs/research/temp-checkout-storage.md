# Research: where a Temp checkout's due time and marker can live in Snipe-IT

Question: [#52](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/52). Part of map [#50](https://github.com/l0cky12/Snipe-IT-Desktop-App/issues/50).

Sources: Snipe-IT source at release **v8.8.0** (2026-09-30, latest), compared with **v8.6.3** where behaviour changed; the official API reference at snipe-it.readme.io. Links to `S/` mean `https://github.com/grokability/snipe-it/blob/v8.8.0/`.

This report lists options. It does not pick one.

## Headline: it depends on the server version

**From v8.7.0 (2026-08-11), Expected Checkin is a date *and time*.** Before that it was a date only.

| | v8.6.3 and earlier | v8.7.0 and later |
|---|---|---|
| DB column `assets.expected_checkin` | `DATE` | `DATETIME` ([migration](https://github.com/grokability/snipe-it/blob/v8.8.0/database/migrations/2026_07_17_000002_change_expected_checkin_to_datetime.php), commit `932a545725`, 2026-07-17; file absent at v8.6.3, present at v8.7.0) |
| API returns `expected_checkin` as | `{date, formatted}` ([v8.6.3 transformer L121](https://github.com/grokability/snipe-it/blob/v8.6.3/app/Http/Transformers/AssetsTransformer.php#L121)) | `{datetime, formatted}`, **no `date` key** ([S/app/Http/Transformers/AssetsTransformer.php#L120](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L120), shape from [Helper::getFormattedDateObject L1374-1380](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Helpers/Helper.php#L1374-L1380)) |
| Overdue (`/hardware/checkins/overdue`) | `expected_checkin < today's date` ([v8.6.3 L1688-1691](https://github.com/grokability/snipe-it/blob/v8.6.3/app/Models/Asset.php#L1688-L1691)) | `expected_checkin < now`, time-aware ([S/app/Models/Asset.php#L1837-L1849](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L1837-L1849)) |
| Web UI checkout / edit / bulk edit input | date picker | `datetimepicker` ([checkout.blade.php L99-107](https://github.com/grokability/snipe-it/blob/v8.8.0/resources/views/hardware/checkout.blade.php#L99-L107), [edit.blade.php L214-221](https://github.com/grokability/snipe-it/blob/v8.8.0/resources/views/hardware/edit.blade.php#L214-L221)) |

The public API reference still documents `expected_checkin` on checkout as `format: date` ([hardware-checkout](https://snipe-it.readme.io/reference/hardware-checkout)). The source is newer than the docs.

**Side finding (affects the app today, independent of Temp checkout):** `src/main/snipeit.ts` reads `raw.expected_checkin?.date`. On v8.7.0+ that key does not exist, so every Asset would show no Expected Checkin and nothing would be Overdue. Reading `expected_checkin.datetime ?? expected_checkin.date` covers both versions.

## Facts per question

### 1. Does `expected_checkin` take a datetime?

- **Checkout** (`POST /hardware/{id}/checkout`): validation is `nullable|date` ([S/app/Http/Requests/AssetCheckoutRequest.php#L50-L53](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Requests/AssetCheckoutRequest.php#L50-L53)), so `2026-10-10 14:50:00` passes on any version. The controller passes it straight to `Asset::checkOut()` ([S/app/Http/Controllers/Api/AssetsController.php#L1431-L1461](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1431-L1461)).
- **Edit** (`PATCH /hardware/{id}`): `expected_checkin` is a model rule `nullable|date` ([S/app/Models/Asset.php#L162](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L162)) and filled from the validated payload ([AssetsController L1050](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1050)).
- **Storage, v8.7.0+**: the setter normalises any parseable value to `Y-m-d H:i:s` ([S/app/Models/Asset.php#L291-L300](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L291-L300)). A date-only value becomes midnight. The time is the server's app timezone (Carbon parse), so the app must send local school time matching the Snipe-IT server's timezone.
- **Storage, v8.6.3 and earlier**: the column is `DATE`, so a sent time is dropped by the database. There is no way to keep a time of day in `expected_checkin` on those versions.
- Checkin clears it (`$asset->expected_checkin = null`, [AssetsController L1494](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1494)).
- Checkout logs a change to `expected_checkin` in the log entry's `log_meta` ([S/app/Models/Traits/Loggable.php#L197](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Loggable.php#L197)).

### 2. `/hardware` filters on Expected Checkin, and `last_checkout`

- `GET /hardware/checkins/overdue`, `/checkins/due`, `/checkins/due-or-overdue` ([S/routes/api.php#L604-L611](https://github.com/grokability/snipe-it/blob/v8.8.0/routes/api.php#L604-L611), handled in `index` [L211-L221](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L211-L221)). All require `expected_checkin` set and the Asset assigned. "Due" is today through `due_checkin_days` (an admin setting) ahead, whole days ([L1811-L1826](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L1811-L1826)). Needs only the Asset view permission (`authorize('index', Asset::class)`, [L92](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L92)).
- `sort=expected_checkin` and `sort=last_checkout` are allowed ([L97-L107](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L97-L107)). There is **no range filter** (`expected_checkin_start/end` exists only on the web custom report, [CustomAssetReportRequest L40-41](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Requests/CustomAssetReportRequest.php#L40-L41)). `search` does a text LIKE over `expected_checkin` and `last_checkout` among other columns ([Asset::$searchableAttributes L224-240](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L224-L240)), which is a substring match, not a date comparison.
- `last_checkout` is a `datetime` returned as `{datetime, formatted}` ([transformer L118](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L118)). Set on every Checkout ([Asset::checkOut L637](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L637)). It tells when a checkout happened, not whether it was Temp.

Nothing on `/hardware` marks a checkout as Temp. A due time alone cannot tell a Temp checkout from an ordinary checkout that happens to be due the same day.

### 3. Asset Custom Fields

- **Not settable in the API checkout call.** The API `checkout` reads only target, `status_id`, `requestable`, `checkout_at`, `expected_checkin`, `note`, `name` ([L1364-L1461](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1364-L1461)). Custom fields flagged "display on checkout" are read only by the **web** checkout controller (`customFieldsForCheckinCheckout('display_checkout')`, [Assets/AssetCheckoutController.php#L164](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Assets/AssetCheckoutController.php#L164); method at [Asset.php#L712](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Asset.php#L712)).
- **Settable on `PATCH /hardware/{id}`** by `db_column` name (e.g. `_snipeit_temp_due_12`), only if the field is in the Asset's Asset Model Fieldset ([L1073-L1098](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1073-L1098)). Needs the Asset edit permission (`Gate::allows('update', …)`, [UpdateAssetRequest L21-24](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Requests/UpdateAssetRequest.php#L21-L24)).
- **PATCH can also check out** in the same call (`assigned_user` / `assigned_location`), with custom fields and `expected_checkin` together. It needs both edit and checkout permission, and the log note is fixed to "Checked out on asset update" (no Operator note) ([L1124-L1200](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1124-L1200)).
- **Filterable on `/hardware`**: exact match by query param `?_snipeit_x_12=value` ([L393-L397](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L393-L397)); or the JSON `filter` param, LIKE by default, with `is:value`, `is:not_null`, `is:null`, `!value` operators ([S/app/Models/Traits/Searchable.php#L215-L265](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L215-L265), custom fields at [L357-L372](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Traits/Searchable.php#L357-L372)). Sortable by `db_column` ([L400-L404](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L400-L404)). Readable with plain Asset view permission unless the field is encrypted ([transformer L145-157](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Transformers/AssetsTransformer.php#L145-L157)).
- A `DATETIME` field format exists (`date_format:Y-m-d H:i:s`, [S/app/Models/CustomField.php#L25-L39](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/CustomField.php#L25-L39)), so a custom field can hold a due time even on servers older than v8.7.0 (check the format list on the instance's own version).
- **Not cleared on Checkin.** The API checkin clears `expected_checkin` but no custom fields ([L1480-L1560](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/AssetsController.php#L1480-L1560)). The app must clear the marker itself, and a Checkin done in the web UI leaves it set.
- **One Fieldset per Asset Model** (multi-fieldset is only a design note, [MULTI_FIELDSET_DESIGN.md](https://github.com/grokability/snipe-it/blob/v8.8.0/MULTI_FIELDSET_DESIGN.md)). The field has to be added to every Fieldset used by an Asset Model that can be Temp checked out, and Asset Models with no Fieldset need one. Creating fields and Fieldsets needs `customfields.*` permissions ([config/permissions.php L343-355](https://github.com/grokability/snipe-it/blob/v8.8.0/config/permissions.php#L343-L355)), usually a Superuser, once.

### 4. Checkout note and the Activity Report

- `GET /reports/activity` filters exactly by `action_type`, `item_type`, `item_id`, `target_type`, `target_id`, `created_by`, `action_source` ([S/app/Http/Controllers/Api/ReportsController.php#L44-L115](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/ReportsController.php#L44-L115)).
- `search=` (or a JSON `filter` with `note`) does a LIKE over `note`, `log_meta` and others ([Actionlog::$searchableAttributes L72-84](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Models/Actionlog.php#L72-L84)). So `action_type=checkout&item_type=asset&search=[Temp]` finds Temp checkouts **ever made**, not the outstanding ones.
- Listing the whole log needs `reports.view` (or `admin`) ([S/app/Providers/AuthServiceProvider.php#L276-L277](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Providers/AuthServiceProvider.php#L276-L277)); without it, only per-item queries the key can view are allowed ([ReportsController L62-75](https://github.com/grokability/snipe-it/blob/v8.8.0/app/Http/Controllers/Api/ReportsController.php#L62-L75)).
- The note cannot be changed after the fact through the API, so it is robust to web UI edits; but it does not know whether the Asset has since been checked in.

## Options (no decision)

Cost is API calls per "show all outstanding Temp checkouts" lookup. N = matching Assets.

| # | Due time lives in | Temp marker lives in | Lookup | Writes per Temp checkout | Operator key needs | Web UI fragility | Server version |
|---|---|---|---|---|---|---|---|
| A | `expected_checkin` (datetime) | nothing: "due today/tomorrow at the end-of-day time" is taken to mean Temp | 1 paged call: `/hardware/checkins/due-or-overdue` (or `sort=expected_checkin`), filter client-side on the time | 1 (checkout) | Asset view + checkout | Low: web UI keeps the time. But any ordinary checkout due at exactly that time looks Temp, and editing the time in the web UI makes a Temp checkout look ordinary | **v8.7.0+ only** |
| B | `expected_checkin` (datetime) | Custom Field (e.g. a checkbox or text "Temp") | 1 paged call: `/hardware?_snipeit_temp_N=1&status=Deployed` | 2 (checkout, then PATCH marker) or 1 (PATCH-checkout, losing the Operator note); checkin + 1 PATCH to clear | Asset view, checkout, **edit** | Medium: web UI Checkin leaves the marker set, so the app must also require "still assigned"; a later normal checkout of that Asset inherits a stale marker unless cleared | v8.7.0+ for the time; Fieldset setup once per Asset Model |
| C | Custom Field (`DATETIME` format) | the same field being non-empty | 1 paged call: `filter={"_snipeit_temp_due_N":"is:not_null"}&status=Deployed`, sortable by the field | 2 (checkout + PATCH), or 1 via PATCH-checkout; + clear on checkin | Asset view, checkout, **edit** | Same as B. Snipe-IT's own Overdue doesn't see the time unless `expected_checkin` is also set | **Works before v8.7.0** |
| D | `expected_checkin` (datetime) | a tag in the checkout note (e.g. `[Temp]`) | `/reports/activity?action_type=checkout&item_type=asset&search=[Temp]` over a recent window, then 1 `/hardware/{id}` per hit (N calls) or one `/hardware?status=Deployed` pull to confirm still out and same checkout | 1 (checkout) | Asset view + checkout + **`reports.view`** | Low for the marker (note is immutable). A web UI checkin then re-checkout must be detected by comparing `last_checkout` to the log time | v8.7.0+ for the time; note search works on all |
| E | `expected_checkin` date only + a fixed end-of-day time in the app | any of B-D | as above | as above | as above | as above | Works before v8.7.0, but a Temp checkout made after the end-of-day time and one made the next morning look identical |

Notes that apply to all options:

- Snipe-IT's own Overdue (dashboard, `/checkins/overdue`, its emails) becomes time-aware on v8.7.0+ when the due time is in `expected_checkin`. With the time only in a custom field (C), Snipe-IT and the web UI won't treat a Temp checkout as late at 2:50 pm.
- The app's own Overdue counts whole days (`daysFrom`), and needs a time-aware rule for Temp checkouts in any option.
- Which Snipe-IT version NOMMA runs decides between A/B/D and C/E. It is not known from the repo.
