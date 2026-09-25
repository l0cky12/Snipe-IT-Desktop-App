# Snipe-IT Desktop

Desktop console for looking up and checking Assets in and out of Snipe-IT. Staff-only; don't run it on shared or public computers.

## Run from source

```sh
npm install
npm run dev
```

## Try it with made-up data

```sh
node scripts/mock-snipeit.mjs 8765
```

Then in Settings use `http://127.0.0.1:8765` and any API token. The mock holds fictional Users and Assets only, so it's safe for screenshots and demos.

## Build the installers

```sh
npm run dist
```

Packages land in `dist/`: a Windows NSIS installer (`.exe`), a Linux AppImage, and a `.deb`. Building the Windows installer on Linux needs Wine and a UTF-8 locale; without Wine, build it in Docker:

```sh
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine npx electron-builder --win
```

## Settings

Open the gear at the bottom left. Enter your server URL and personal API token, test the connection, and save. New installations open Settings automatically.

Asset creation is not currently supported. Lists load on demand, so there is no refresh interval. Appearance retains the existing dark theme.

Credentials use Electron safeStorage: macOS Keychain, Windows DPAPI, or the Linux system password store. Only encrypted token bytes are written to `settings.json` in Electron's per-user app data directory. With no usable password store (including Linux's `basic_text` fallback), the token is saved unencrypted in `settings.json` with owner-only (0600) permissions, and Settings says so. The saved token is never returned to the renderer. Log out / clear token removes the encrypted token.

Legacy `config.json` is no longer read. Enter those credentials in Settings, then remove your old plaintext config file. Settings changes take effect without restarting and clear previous server data from the screen.

## Lists

Under Dashboard in the left rail: Assets, Users, Locations, Asset Models, and the Activity Report. Each List pages through Snipe-IT 50 rows at a time, with a search box, simple filters, sortable column headers, and a **Columns** button to show or hide columns (remembered per computer). Opening a User, Location, or Asset Model shows the Assets checked out to it or in it. Asset rows have Quick Actions: Checkin, Checkout, and Status.

The scan/search box still opens an exact Asset Tag straight away; anything else lists matching Assets, Users, Locations, and Asset Models in the rail.
