# 07: Dashboard

**What to build:** The Operator opens a dashboard showing every Overdue Asset, every Expiring Warranty in the next 90 days, and Asset counts by status. Clicking any Asset opens it in the detail sheet.

**Blocked by:** 02

**Status:** done

Spec: `.scratch/snipe-it-desktop/spec.md`.

- [ ] `dashboard()` pages through all Assets (up to 500 per page) and returns the Overdue list, the Expiring Warranty list, and counts by status, using the same rules as the Asset card chips
- [ ] Overdue list shows Asset Tag, name, Assignee, and days late, most late first
- [ ] Expiring Warranty list shows days left, soonest first; expired warranties are not listed
- [ ] Counts by status
- [ ] Clicking an Asset opens it in the detail sheet
- [ ] Loads when opened and on a refresh button; no background polling; shows when it was last loaded
- [ ] Tests (fixed "today"): paging across multiple pages, counts, list membership and ordering
