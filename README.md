# Localhost Apps

A Chrome extension that discovers and lists your running localhost dev servers at a glance.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![Version](https://img.shields.io/badge/version-0.1.0-yellow) ![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Auto-discovers running servers** — scans configurable port ranges on `localhost`
- **Smart naming** — shows the `name` from `package.json`, falls back to HTML `<title>`, then `localhost:PORT`
- **Filter** — quickly narrow down apps with the search box
- **Keyboard navigation** — arrow keys to move, Enter to open, `⌘`/`Ctrl`+click to open in a new tab
- **Configurable port ranges** — comma-separated ports or ranges (e.g. `3000-3010, 5173`)
- **Light & dark mode** — follows your system preference
- **Keyboard shortcut** — <kbd>Alt</kbd>+<kbd>L</kbd> opens the popup

### Default Port Ranges

```
3000-3010, 4173-4175, 5173-5183, 8080-8085
```

Covers Vite dev/preview servers, common Node.js ports, and more.

## Install

1. Clone this repository:
   ```sh
   git clone https://github.com/kizivat/localhost-apps-extension.git
   ```
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top-right toggle).
4. Click **Load unpacked** and select the cloned folder.

## Usage

1. Click the extension icon (or press <kbd>Alt</kbd>+<kbd>L</kbd>) to open the popup.
2. Running dev servers appear automatically.
3. Click **Open** to navigate the current tab, or hold <kbd>⌘</kbd>/<kbd>Ctrl</kbd> and click to open in a new tab.
4. Click **Settings** to customize which port ranges are scanned.

## Project Structure

```
├── manifest.json      # Extension manifest (MV3)
├── popup.html         # Popup UI
├── popup.css          # Styles (light/dark)
├── popup.js           # Popup logic, keyboard nav, settings
├── scanner.js         # Port scanning & title extraction
└── icons/             # Extension icons (16, 48, 128)
```

## Permissions

| Permission           | Reason                                     |
| -------------------- | ------------------------------------------ |
| `storage`            | Persist port range settings across devices |
| `http://localhost/*` | Probe local dev servers                    |
| `http://127.0.0.1/*` | Probe local dev servers                    |

## License

MIT
