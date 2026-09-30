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

Packages land in `dist/`: a Windows NSIS installer (`.exe`), a Linux AppImage, a `.deb` for Debian/Ubuntu, and a `.pacman` package for Arch (install it with `sudo pacman -U snipe-it-desktop-*.pacman`). In `package.json`, `deb.depends` is electron-builder's default list plus `libasound2`; `pacman.depends` replaces the default because Arch dropped `http-parser` and `libappindicator-gtk3`. The Arch package needs `bsdtar` on the build machine (`sudo apt-get install libarchive-tools` on Debian/Ubuntu). Building the Windows installer on Linux needs Wine and a UTF-8 locale; without Wine, build it in Docker:

```sh
docker run --rm -v "$PWD":/project -w /project electronuserland/builder:wine npx electron-builder --win
```

### Releases

Pushing a version tag builds all of them in GitHub Actions (`.github/workflows/release.yml`: Linux packages on Ubuntu, the Windows installer on Windows) and attaches them to a GitHub Release for that tag:

```sh
git tag v0.2.0 && git push origin v0.2.0
```

The tag sets the version in the file names, so `package.json` doesn't need bumping first. Running the workflow by hand (Actions → Release → Run workflow), or opening a pull request that changes the packaging, builds the same packages as a downloadable artifact without making a Release; the Linux build also installs the `.deb`, and the Windows build installs and uninstalls the app, to check the installers.

## Reports

The **Reports** icon in the left rail runs three reports and shows them as a table:

- **Activity Report**: every Checkout, Checkin, and edit in a date range, optionally narrowed to one record type (Assets, Licenses, Accessories, Consumables, Components, Users) and one action.
- **Overdue**: every Overdue Asset, most late first, optionally only those whose Expected Checkin falls in a date range.
- **Warranty expiring**: every Expiring Warranty (the next 90 days), soonest first, optionally within a date range.

**Export CSV…** saves the table as a CSV file where you choose. Exports include student information, so the app asks you to confirm first: under FERPA the file must stay with authorized district staff (don't email it outside the district, post it, or save it to shared or personal drives), and should be deleted when you're done.

## Settings

Open the gear at the bottom left. Enter your server URL and personal API token, test the connection, and save. New installations open Settings automatically.

Lists load on demand, so there is no refresh interval. Appearance retains the existing dark theme.

Credentials use Electron safeStorage: macOS Keychain, Windows DPAPI, or the Linux system password store. Only encrypted token bytes are written to `settings.json` in Electron's per-user app data directory. With no usable password store (including Linux's `basic_text` fallback), the token is saved unencrypted in `settings.json` with owner-only (0600) permissions, and Settings says so. The saved token is never returned to the renderer. Log out / clear token removes the encrypted token.

Legacy `config.json` is no longer read. Enter those credentials in Settings, then remove your old plaintext config file. Settings changes take effect without restarting and clear previous server data from the screen.

## Lists

Under Dashboard in the left rail: Assets, Users, Locations, Asset Models, and the Activity Report; **All records** (the boxes icon) lists every kind, adding Licenses, Accessories, Consumables, Components, Categories, Manufacturers, Suppliers, Departments, Companies and Status Labels. Each List pages through Snipe-IT 50 rows at a time, with a search box, simple filters, sortable column headers, and a **Columns** button to show or hide columns (remembered per computer). Asset rows have Quick Actions: Checkin, Checkout, Status, and Batch.

**New …** on the Assets, Users, Locations, Licenses, Accessories, Consumables and Components Lists creates one; **Edit** and **Delete…** on its page (or the Asset sheet) change or remove it, and Delete asks first. Snipe-IT checks every save, and its reasons show beside the field they're about. An Asset's form includes its Asset Model's custom fields.

Opening any other row shows every field Snipe-IT has for it; a related record (its Location, Department, Manager…) links to its own page, and buttons open what belongs to it, such as a User's checked-out Assets or a Location's Assets and Users. An Asset's sheet has the same under **All fields**, custom fields included.

The **Batch** page (in the rail, with a count badge) gathers Assets for one Checkout or Checkin of all of them. While it is open, scanning or picking an Asset adds it instead of opening it. The result of each Asset is shown in the row; failed ones can be retried and successful ones removed. The Batch is not saved between sessions.

The scan/search box still opens an exact Asset Tag straight away; anything else lists matching Assets, Users, Locations, Asset Models, Licenses, Accessories, Consumables, and Components in the rail, grouped by kind, with the field each matched on (custom fields and notes included).
