# 02: Full Asset card — History, Overdue and warranty chips

**What to build:** The detail sheet shows everything an Operator needs on one screen: History, Assignee kind, Expected Checkin, and status chips for Overdue and warranty, in the final Rail + detail sheet layout.

**Blocked by:** 01

**Status:** ready-for-agent

Spec: `.scratch/snipe-it-desktop/spec.md`. Layout reference: branch `prototype/main-screen`, variant B (Rail + detail sheet). The prototype is throwaway; rebuild properly, don't copy.

- [ ] `getAsset` includes History (from Snipe-IT's activity report for the Asset), newest first: when, action, Operator, detail, and any note
- [ ] Assignee shown with its kind (User or Location); Expected Checkin date shown
- [ ] Overdue chip with days late: Asset has an Assignee and an Expected Checkin before today
- [ ] Expiring Warranty chip with days left when warranty ends within today..today+90; "Warranty expired" chip when past; no chip when Snipe-IT has no warranty date
- [ ] HTML-escaped text from Snipe-IT (e.g. `&quot;`) is decoded before display
- [ ] Detail sheet matches variant B: sticky header with chips + action area, 4-column fact grid, History table
- [ ] Tests (fixed "today"): Overdue by 1 day, not Overdue without Expected Checkin, warranty exactly-today, 90-day vs 91-day boundary, expired, HTML decoding, History ordering
