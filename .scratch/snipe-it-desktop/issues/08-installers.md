# 08: Installers

**What to build:** Operators can install the app like any other: a Windows installer and Linux AppImage + deb packages.

**Blocked by:** 05, 06, 07

**Status:** ready-for-agent

Spec: `.scratch/snipe-it-desktop/spec.md`. No macOS build (ADR 0001 / spec out of scope).

- [ ] electron-builder produces a Windows NSIS installer
- [ ] electron-builder produces a Linux AppImage and a deb
- [ ] One npm script builds the packages
- [ ] Installed app finds `config.json` in a documented location, and the missing-config message says where
- [ ] `config.json` is never bundled into a package
- [ ] Install + launch + one exact-tag lookup verified on Linux; Windows build verified to launch
