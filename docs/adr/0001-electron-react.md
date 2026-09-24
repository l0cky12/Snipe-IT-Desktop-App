# Electron + React + Vite for the desktop shell

We chose Electron + React + Vite over lighter options (Tauri, a plain web page, a native toolkit) because we wanted good-looking React components and one JavaScript toolchain. The cost is about 200MB of RAM per instance and a bundler to maintain. That's acceptable for a handful of IT workstations. Don't rewrite this in Tauri to save memory unless RAM becomes a measured problem.
