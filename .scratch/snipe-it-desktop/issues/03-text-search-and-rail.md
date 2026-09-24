# 03: Text search and the rail

**What to build:** When a query isn't an exact Asset Tag, the Operator sees matching Assets in the left rail and can click one to open it. The rail also keeps this session's recent scans, and fast scanning never shows the wrong Asset.

**Blocked by:** 01

**Status:** done

Spec: `.scratch/snipe-it-desktop/spec.md`. Layout reference: branch `prototype/main-screen`, variant B.

- [ ] `lookup` falls back to a text search across name, Asset Tag, and Serial when the exact-tag lookup misses, returning Asset summaries (not marked exact)
- [ ] Rail lists matches with Asset Tag, name, status chip, and Assignee; clicking one opens it in the detail sheet
- [ ] A text search keeps the query in the box; only an exact-tag hit clears it
- [ ] "No Asset matches" message when nothing is found
- [ ] Recent scans list for the session only (about 20, most recent first, no duplicates), never written to disk
- [ ] If a new lookup starts before the previous returns, the older result is discarded
- [ ] Tests: exact miss → search fallback, no matches, summaries shape
