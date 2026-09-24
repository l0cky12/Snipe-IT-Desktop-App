# 06: Checkout to a User or Location

**What to build:** From the detail sheet, the Operator checks an Asset out to a User (e.g. a student) or a Location (e.g. Room 204) by searching for them, optionally setting an Expected Checkin date and a note. The sheet refreshes and the search box is ready for the next scan.

**Blocked by:** 02, 04

**Status:** ready-for-agent

Spec: `.scratch/snipe-it-desktop/spec.md`.

- [ ] Checkout button enabled only when the Asset has no Assignee and its status is deployable
- [ ] Target picker: choose User or Location, then search by name via `searchUsers` / `searchLocations`
- [ ] Optional Expected Checkin date and note
- [ ] `checkout(assetId, { targetType, targetId, expectedCheckin?, note? })` sends the Asset's current status (Snipe-IT requires one), the target type, and the matching assigned user or location
- [ ] Checkout to another Asset is not offered
- [ ] On success the detail sheet refreshes (new Assignee, Expected Checkin, History entry) and the search box is refocused
- [ ] A rejected Checkout shows Snipe-IT's reason
- [ ] Tests: request body for User and for Location targets, with and without Expected Checkin; not-allowed rules; rejection surfaced
