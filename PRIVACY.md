# Privacy Policy — Localhost Apps

**Last updated:** March 30, 2026

## Overview

Localhost Apps is a Chrome extension that discovers running development servers on your local machine. It is designed with privacy in mind — it does not collect, transmit, or share any personal data.

## Data Collection

**This extension collects no personal data whatsoever.**

- No analytics or telemetry.
- No tracking scripts.
- No cookies.
- No user accounts or sign-ins.

## Network Activity

All network requests are made **exclusively to your own machine** (`localhost` / `127.0.0.1`) to detect running development servers. The extension never contacts any external server, API, or third-party service.

## Storage

The extension uses Chrome's `storage.sync` API solely to persist your port-range configuration across devices. No other data is stored.

## Permissions

| Permission           | Purpose                                                       |
| -------------------- | ------------------------------------------------------------- |
| `storage`            | Save your port-range settings so they persist across sessions |
| `http://localhost/*` | Probe local development servers on your machine               |
| `http://127.0.0.1/*` | Probe local development servers on your machine               |

## Third-Party Services

This extension uses **no** third-party services, SDKs, or libraries.

## Changes to This Policy

If this policy is updated, the changes will be reflected in this file with an updated date above.

## Contact

If you have questions about this privacy policy, please open an issue at:
https://github.com/kizivat/localhost-apps-extension/issues
