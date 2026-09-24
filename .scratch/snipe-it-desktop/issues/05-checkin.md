# 05: Checkin

**What to build:** From the detail sheet, the Operator checks an Asset back in with one click, optionally changing its status (e.g. to a repair status) and adding a note like "cracked screen". The sheet refreshes and the search box is ready for the next scan.

**Blocked by:** 02, 04

**Status:** ready-for-agent

Spec: `.scratch/snipe-it-desktop/spec.md`.

- [ ] Checkin button enabled only when the Asset has an Assignee
- [ ] `statusLabels()` feeds a status dropdown that defaults to the Asset's current status
- [ ] Optional note
- [ ] `checkin(assetId, { statusId?, note? })` always sends a status (Snipe-IT requires it): the chosen one, else the current one
- [ ] On success the detail sheet refreshes (Assignee cleared, new History entry) and the search box is refocused
- [ ] A rejected Checkin shows Snipe-IT's reason and leaves the sheet unchanged
- [ ] Tests: request body sent (default and chosen status, note), not-allowed rule, rejection surfaced
