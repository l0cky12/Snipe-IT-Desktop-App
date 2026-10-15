# Remote HTTP is warned about, not blocked

The October 2026 repo audit asked us to reject `http:` server URLs for anything but loopback, because the API token and the inventory and student data it returns cross the network unencrypted. We kept HTTP allowed and show a warning under the server URL in Settings instead. NOMMA's own Snipe-IT runs on the LAN at plain HTTP, so a hard block would break the one deployment this app serves.

The warning shows for every non-loopback `http:` URL, LAN addresses included: a school LAN carries student and guest devices, so it isn't a trusted network. Loopback (`localhost`, `127.0.0.0/8`, `::1`) stays quiet for the local mock. `credentials()` in `src/main/config.ts` still accepts both schemes.

Don't turn this into a block until the Snipe-IT server has HTTPS. Once it does, blocking remote HTTP (the audit's fix) is the better default.
