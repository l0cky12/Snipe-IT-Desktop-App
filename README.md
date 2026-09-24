# Snipe-IT Desktop

Desktop console for looking up and checking Assets in and out of Snipe-IT. Staff-only; don't run it on shared or public computers.

## Run from source

```sh
npm install
cp config.example.json config.json   # then fill in your Snipe-IT URL and personal API key
npm start
```

## Build the installers

```sh
npm run dist
```

Packages land in `dist/`: a Windows NSIS installer (`.exe`), a Linux AppImage, and a `.deb`. Building the Windows installer on Linux needs Wine and a UTF-8 locale; without Wine, build it in Docker:

```sh
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine npx electron-builder --win
```

## Where the installed app looks for `config.json`

| OS      | Path                                          |
|---------|-----------------------------------------------|
| Windows | `%APPDATA%\snipe-it-desktop\config.json`      |
| Linux   | `~/.config/snipe-it-desktop/config.json`      |

Same shape as `config.example.json`. If it's missing, the app shows the exact path it looked in. `config.json` is never bundled into a package, so each Operator creates their own with their own personal API key. Never share it or commit it.
