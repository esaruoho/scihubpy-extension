# Sci-Hub PDF Downloader — Chrome Extension

A Chrome extension that detects DOIs on journal/paper pages and downloads PDFs directly from Sci-Hub. No copy-pasting DOIs, no navigating to Sci-Hub manually. Just click the button.

## How it works

1. When you visit a journal article page (Nature, Science, IEEE, Elsevier, Springer, etc.), the extension detects the DOI from meta tags, the URL, JSON-LD data, or visible text
2. A floating **Sci-Hub PDF** button appears in the bottom-right corner
3. Click it and the extension fetches the paper from Sci-Hub in the background — the PDF downloads directly to your Downloads folder
4. If one Sci-Hub mirror fails, it automatically tries the next one

The extension does NOT open a new tab or redirect you. The PDF downloads silently while you stay on the page.

## Supported DOI sources

The extension finds DOIs from (in priority order):

| Source | Example |
|--------|---------|
| `<meta>` tags | `<meta name="citation_doi" content="10.1038/nature12373">` |
| URL patterns | `https://doi.org/10.1038/nature12373` |
| JSON-LD | Schema.org structured data |
| Page text | DOI visible in article headers/metadata |

Works on virtually every academic publisher: Nature, Science, Cell, PNAS, IEEE, Elsevier, Springer, Wiley, ACS, Taylor & Francis, SAGE, Oxford, Cambridge, PubMed, and more.

## Install

This extension cannot be published to the Chrome Web Store. Install it as an unpacked extension:

### 1. Clone or download this repo

```bash
git clone https://github.com/esaruoho/scihubpy-extension.git
```

Or download as ZIP and extract.

### 2. Load in Chrome

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select the `scihubpy-extension` folder (the one containing `manifest.json`)
5. The extension icon appears in your toolbar

### 3. Use it

Navigate to any journal article page. If a DOI is detected, a **Sci-Hub PDF** button appears in the bottom-right corner. Click it. Done.

## Mirrors

The extension tries these Sci-Hub mirrors in order:

| Mirror | Method |
|--------|--------|
| `sci-hub.vg` | `<iframe>` with sci.bban.top CDN |
| `sci-hub.al` | `<embed>` with sci.bban.top CDN |
| `sci-hub.mk` | `<embed>` with sci.bban.top CDN |
| `sci-hub.ru` | `<object>` with self-hosted /storage/ |

If mirrors change, edit the `SCIHUB_MIRRORS` array in `background.js`.

## Files

```
manifest.json    — Chrome extension manifest (Manifest V3)
content.js       — DOI detection + button injection (runs on every page)
background.js    — Sci-Hub fetch + PDF parsing + download (service worker)
styles.css       — Button styling
icons/           — Extension icons
```

## How the PDF parsing works

The background service worker replicates the same logic as [scihub.py](https://github.com/esaruoho/scihub.py):

1. Fetch `https://sci-hub.vg/{DOI}`
2. Parse the HTML response for the PDF URL in this order:
   - `<iframe src="...">` (classic Sci-Hub)
   - `<embed type="application/pdf" src="...">` (newer mirrors)
   - `<object data="...">` (sci-hub.ru)
   - `<button onclick="location.href='...pdf'">` (download buttons)
   - Script tags with PDF URLs
3. Fetch the actual PDF binary
4. Validate PDF magic bytes (`%PDF-`)
5. Trigger `chrome.downloads` to save the file

## Permissions

| Permission | Why |
|-----------|-----|
| `activeTab` | Read the current page to detect DOIs |
| `downloads` | Save PDFs to disk |
| `host_permissions` for sci-hub.* | Fetch Sci-Hub pages and PDFs from the background |

## Notes

- Sci-Hub has not added new papers since 2021. Papers published after 2021 may not be available.
- CAPTCHAs may appear after many consecutive downloads. The extension handles this by rotating mirrors.
- This extension is for personal/educational use.

## Related

- [scihub.py](https://github.com/esaruoho/scihub.py) — Python CLI tool with the same Sci-Hub fetching logic

## License

MIT
