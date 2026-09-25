# Snipe-IT Desktop

Desktop console for looking up and checking Assets in and out of Snipe-IT. Staff-only; don't run it on shared or public computers.

## Run from source

```sh
npm install
npm run dev
```

## Build the installers

```sh
npm run dist
```

Packages land in `dist/`: a Windows NSIS installer (`.exe`), a Linux AppImage, and a `.deb`. Building the Windows installer on Linux needs Wine and a UTF-8 locale; without Wine, build it in Docker:

```sh
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine npx electron-builder --win
```

## Settings

Open the gear at the bottom left. Enter your server URL and personal API token, test the connection, choose an optional default Location, and save. New installations open Settings automatically.

The default Location pre-fills Checkin and Checkout to a Location; each action can override it. Asset creation is not currently supported. Lists load on demand, so there is no refresh interval. Appearance retains the existing dark theme.

Credentials use Electron safeStorage: macOS Keychain, Windows DPAPI, or the Linux system password store. Only encrypted token bytes are written to `settings.json` in Electron's per-user app data directory. Linux's `basic_text` fallback is rejected; an unlocked supported password store is required. The saved token is never returned to the renderer. Log out / clear token removes the encrypted token.

Legacy `config.json` is no longer read. Enter those credentials in Settings, then remove your old plaintext config file. Settings changes take effect without restarting and clear previous server data from the screen.
