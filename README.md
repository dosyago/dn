# 🌳 TDF — Tree Document Format, by DOSAYGO

> [!IMPORTANT]
> **DownloadNet (dn) has grown into something new.** The CDP-based archiver
> that lived in this repo was the seed of **TDF**: a new client, a new
> archive format (`.tdf`), and a new capture architecture. The web is captured
> by **Tree Grower** and replayed by **Tree Player** — two native apps that
> grow dn's in-browser interception into a multi-browser architecture. dn v4.5
> remains available, unchanged, in the [Legacy](#-legacy-downloadnet-dn)
> section below. This repo is no longer an open-source codebase; it is the
> public home of the TDF product line and the permanent archive of dn.

**Website & downloads:** <https://trees.dosaygo.com> · **Contact:** <trees@dosaygo.com>

## What is TDF?

TDF captures live browsing sessions into portable **Tree Document (`.tdf`)
archives** and replays them locally, offline, byte-for-byte — no proxy, no
cloud, no re-fetching.

| App | What it does | License |
|---|---|---|
| **Tree Grower** 🌱 | Captures web resources into `.tdf` archives while you browse. | Paid — one-time purchase, offline device-bound activation. |
| **Tree Player** 🌳 | Opens and replays `.tdf` archives from disk. | Free to download and use. |

## Install

macOS / Linux:

```bash
curl -fsSL https://trees.dosaygo.com/install.sh | bash
```

Windows (PowerShell):

```powershell
irm https://trees.dosaygo.com/install.ps1 | iex
```

Downloads and checksums: <https://trees.dosaygo.com/downloads.html>

## From dn to TDF

dn intercepted responses inside Chrome's own fetch cycle over the Chrome
DevTools Protocol (CDP) — Chrome-only. That interception model is the seed
TDF grew from:

- **Multi-browser.** Grower drives your installed browser (Chrome, Firefox,
  and the Chromium family) over **WebDriver BiDi / CDP**. The browser stays
  the source of truth; nothing is re-fetched out-of-band.
- **Active, blocking capture.** Each response is paused in the browser, its
  body read through the automation protocol, stored, then released —
  deterministic capture instead of best-effort caching.
- **One file per collection.** A `.tdf` archive is a compressed (and
  optionally AES-256-GCM encrypted) SQLite database with indexed, deduplicated
  bodies — built for instant replay and easy sharing.
- **Native apps.** Grower and Player are Rust binaries with a GUI. No Node,
  no npm, no server on `localhost:22120`.
- **Free reading.** Anyone can open a `.tdf` with the free Player. Only
  creating archives (Grower) is paid.

Safari support is on the roadmap, pending Apple shipping the WebDriver BiDi
`network` module in safaridriver.

## Licensing

The TDF apps are **closed-source, proprietary software** — see
[LICENSE](LICENSE). Grower is a paid product ($39 one-time at launch, 3-year
license term, up to 3 devices) with offline, device-bound activation; Player
is free. Full details: <https://trees.dosaygo.com/license.html> and
<https://trees.dosaygo.com/terms.html>.

## 📼 Legacy: DownloadNet (dn)

The original dn — the offline full-text-search web archive that lived here
since the 22120 days — is preserved, unmodified, in the
[`legacy/`](legacy/) directory ([old README](legacy/README.md)). The final
release is [v4.5](https://github.com/DO-SAY-GO/dn/releases/tag/v4.5.2), and
`npm i -g downloadnet` still works. dn is no longer developed or supported;
it remains under its existing [PolyForm Strict license](legacy/LICENSE)
(see [NOTICE](legacy/NOTICE)).

---

© 2026 DOSAYGO Corporation. Questions? <trees@dosaygo.com>
