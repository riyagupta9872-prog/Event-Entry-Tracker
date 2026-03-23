# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prerna Festival Management — a client-side PWA for tracking attendance, payments, and transportation at the "Prerna Festival" event. There is **no build step, no bundler, no server** — it is a static site deployed directly to GitHub Pages.

## Deployment

- **GitHub Pages** via `deploy.yml` — pushes to `main` auto-deploy the entire repo root as a static site.
- No CI, no tests, no linting configured.

## Architecture

Single-page app with all state in **IndexedDB** (database name: `PrernaFestival`). No backend/API — everything runs in the browser.

### Module structure (all vanilla JS, IIFE pattern returning public API):

- **`db.js`** — `DB` module. IndexedDB wrapper with generic CRUD (`getAll`, `put`, `add`, `deleteRecord`, `bulkAdd`), config key-value store (`getConfig`/`setConfig`), and audit logging. Stores: `attendees`, `users`, `config`, `busRoutes`, `auditLog`, `offlineQueue`.
- **`helper.js`** — `Helpers` module. UI utilities (toast, modal), formatting (currency in INR `₹`, dates in `en-IN`), fuzzy name matching (Levenshtein), duplicate detection by mobile+name similarity, pagination, search filtering.
- **`reports.js`** — `Reports` module. Computes report data (overview, payment, reference, transport, summary) and renders report HTML with stat cards and tables.
- **`export.js`** — `Export` module. Exports reports to Excel (via SheetJS/`XLSX`), CSV, and PDF (print-based via `window.open`).
- **`app.js`** — `App` module. Main controller: auth (admin/volunteer roles), page navigation, dashboard, Excel import, QR-code attendance scanning, walk-in entry, attendee CRUD, settings, and data management.
- **`sw.js`** — Service worker for offline caching. Note: cached asset paths reference a `src/` subdirectory structure that doesn't match the flat repo layout.

### Key patterns

- **Auth**: client-side only, stored in IndexedDB `users` store. Default credentials: `admin`/`admin123`, `volunteer`/`vol123`. Admin vs volunteer role controls UI visibility (`.admin-only` class).
- **All HTML is in `index.html`** — a single large file containing inline CSS (duplicated in `main.css`), all page sections, and script tags loading the modules in dependency order: `db.js` → `helper.js` → `reports.js` → `export.js` → `app.js`.
- **External CDN deps** (loaded via `<script>` tags): SheetJS (`xlsx.full.min.js`), JSZip, Google Fonts (Cinzel, DM Sans, DM Mono).
- **No framework** — DOM manipulation via `document.getElementById`, `innerHTML` assignment, and event listeners.

### Data model (IndexedDB `attendees` store)

Key fields: `attendeeId`, `name`, `mobile`, `team`, `category`, `reference`, `paymentAmount`, `paymentDate`, `paymentTiming`, `busRoute`, `attendance` (`'present'`), `entryTime`, `markedBy`, `isWalkIn`, `isDuplicate`, `serviceDevotee`, `activeDevotee`.

## CSS

- Dark theme with CSS custom properties defined in `:root` (both inline in `index.html` and in `main.css` — these are duplicated).
- Color scheme: deep purple/dark backgrounds, gold accents (`--accent: #c9a227`), lotus pink highlights.
