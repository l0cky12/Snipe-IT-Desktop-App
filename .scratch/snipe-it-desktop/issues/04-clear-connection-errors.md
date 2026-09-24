# 04: Clear connection errors

**What to build:** When Snipe-IT rejects the key, can't be reached, or returns an error, the Operator sees a clear message that says which one, including Snipe-IT's own reason. No failure is silent. This must land before any writes.

**Blocked by:** 01

**Status:** done

Spec: `.scratch/snipe-it-desktop/spec.md`.

- [ ] HTTP 401 maps to a "key rejected" error telling the Operator to check or regenerate their personal API key
- [ ] Network failure maps to an "unreachable" error naming the configured Snipe-IT URL
- [ ] An HTTP 200 whose body has `"status": "error"` is treated as a failure carrying Snipe-IT's message
- [ ] Every SnipeIt function goes through the same error mapping
- [ ] The screen shows errors one consistent way, without losing the current detail sheet
- [ ] Tests: 401, network failure, 200-with-error for at least one read path
