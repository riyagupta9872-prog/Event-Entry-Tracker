# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prerna Festival Management — a client-side PWA for tracking attendance, payments, and transportation at the "Prerna Festival" event. Firebase backend for authentication and data persistence. Deployed as a static site to GitHub Pages via `deploy.yml`. **No build step, no bundler, no server.**

To run locally: open `index.html` in a browser, or use any static file server (e.g., VS Code Live Server or `python -m http.server`).

## Deployment

- **GitHub Pages** via `deploy.yml` — pushes to `main` auto-deploy the entire repo root as a static site.
- No CI, no tests, no linting configured.
- After changing any cached asset (HTML/JS/CSS), **bump the version number** in `sw.js` (`CACHE_NAME = 'prerna-festival-v{N}'`) — currently at `v49`. Without this, users get stale files from the service worker cache.

## Architecture

### Backend: Firebase
- **Firebase Auth** for email/password authentication with persistent sessions
- **Cloud Firestore** for all data storage
- Firebase SDK loaded via CDN (compat version, no build step needed)
- Firestore offline persistence enabled for PWA offline support

### Firestore Data Structure
```
users/{uid}                           — User profiles (name, email, role)
events/{eventId}                      — Event documents (name, date, chargePerPerson, totalExpense, financialYear)
events/{eventId}/participants/{docId} — Attendee/participant records
events/{eventId}/config/{key}         — Event-level config key-value pairs
events/{eventId}/busRoutes/{docId}    — Bus route configurations (name, cost, busCount)
events/{eventId}/buses/{docId}        — Bus objects volunteers choose from at login (name, coordinator)
events/{eventId}/auditLog/{docId}     — Audit trail entries
```

Data is **event-scoped** — all participant, config, and bus data lives under a specific event. The active event is tracked via `localStorage('prerna_active_event')` and `DB.setCurrentEvent()`.

### Module structure (all vanilla JS, IIFE pattern returning public API):

- **`firebase-config.js`** — Firebase initialization; exposes globals `auth` and `firestore`.
- **`db.js`** — `DB` module. Firestore wrapper. `DB.STORES` maps internal names (`attendees`, `users`, `config`, `busRoutes`, `buses`, `auditLog`) to Firestore collection paths. Generic CRUD: `getAll`, `getById`, `put`, `add`, `deleteRecord`, `bulkAdd`. Event management: `getEvents`, `getEvent`, `createEvent`, `updateEvent`. Config key-value store: `getConfig`, `setConfig`. `clearStore` uses Firestore batches capped at 500 docs.
- **`helper.js`** — `Helpers` module. Toast notifications (`toast(msg, type, duration)`), modal (`modal(html, onClose)`, `closeModal()`), currency formatting in INR, date formatting in `en-IN` locale, Levenshtein-based fuzzy name matching (`similarName`), duplicate detection (`detectDuplicates`), and financial year utilities (`getFinancialYear`, `getFYRange`).
- **`reports.js`** — `Reports` module. Computes report data (overview, payment, reference, transport, bus, summary) and renders report HTML. Also exports styled Excel reports via ExcelJS. Contains hardcoded `CATEGORY_TEAMS` map (team name → department: IGF / IYF / ICF_Mtg / ICF_Prji / Balarama Team) used by both reports and `App.getCategoryForTeam()`.
- **`export.js`** — `Export` module. Exports attendee list to styled Excel (ExcelJS), CSV, and PDF (print-based via `window.open`). Excel uses color-coded rows by attendance/payment status.
- **`app.js`** — `App` module. Everything else: Firebase Auth flow, event management, page navigation, session setup modal, admission/walk-in entry, attendee CRUD, bulk Excel import, bus management, settings.
- **`sw.js`** — Service worker for offline caching. Bypasses Firebase API requests (auth/firestore). Cache-first for all static assets and CDN libraries.

### Key patterns

- **Auth**: Firebase email/password. User profiles in Firestore `users` collection. Roles: `admin` / `volunteer`. First user registered becomes `admin`; all others default to `volunteer`. `auth.onAuthStateChanged()` handles persistent sessions.
- **All HTML is in `index.html`** — single file with all CSS in a `<style>` block and external `<script>` tags loading modules in dependency order: `firebase-config.js` → `db.js` → `helper.js` → `reports.js` → `export.js` → `app.js`. The file `main.css` exists in the repo but is **not linked** — all styling is in `index.html`'s `<style>` block.
- **Firestore IDs are strings** — all `onclick` handlers must quote IDs: `App.markAttendance('${a.id}')` not `App.markAttendance(${a.id})`.
- **External CDN deps**: Firebase SDK (compat v10.12.0), ExcelJS (v4.4.0) for styled Excel export, SheetJS/XLSX (v0.18.5) for Excel import in bulk-upload flow, JSZip, Tesseract.js (v5) for OCR, Google Fonts (DM Sans, DM Mono).
- **No framework** — DOM manipulation via `document.getElementById`, `innerHTML` assignment, and event listeners.

### Real-time sync

The attendance page uses a Firestore `onSnapshot` listener (`startLiveSync()` / `stopLiveSync()` in `app.js:322`). When participants change in Firestore from any device, the attendance list re-renders automatically. `liveUnsubscribe` holds the unsubscribe function; always call `stopLiveSync()` before navigating away from the event or logging out.

### Volunteer bus assignment

Each volunteer sets their bus once per browser session via the "Start of Shift" modal shown after login. This is stored in `localStorage` as `prerna_my_bus_{eventId}` (key scoped per event). Every admission — both registered attendee mark-present and walk-in — automatically stamps the participant's `boardedBus` field with this value. Admins can see all buses; volunteers only see their assigned bus in the "My Bus" view.

### Excel libraries

| Library | Purpose |
|---------|---------|
| **ExcelJS** (`ExcelJS.Workbook`) | All *export* flows — styled Excel with colored headers, row fills by payment/attendance status |
| **SheetJS** (`XLSX.*`) | Excel *import* only — reading uploaded `.xlsx` files in the bulk attendee upload flow (`app.js:1108`) |

### Participant Data Model (Firestore `events/{id}/participants`)

Key fields: `attendeeId` (short display ID), `name`, `mobile`, `team`, `category`, `reference`, `paymentStatus` (`paid`/`unpaid`/`free`), `paymentMode` (`cash`/`online`), `paymentAmount`, `paymentDate`, `paidAtEvent` (boolean — collected at gate vs. before event), `remarks`, `attendance` (`present`/`absent`), `entryTime`, `markedBy`, `isWalkIn`, `isDuplicate`, `busRoute` (registered bus preference), `boardedBus` (actual bus volunteer admitted them onto), `pickupLocation`.

### Financial Year

FY runs April 1 to March 31. FY string format: `"2025-26"`. Events are grouped by FY for profit/loss reporting. `Helpers.getFinancialYear(dateStr)` computes FY from any date.

### Department / team mapping

`CATEGORY_TEAMS` in `reports.js` is the authoritative map of team names to departments. `App.getCategoryForTeam(teamName)` delegates to `Reports.getTeamDept()`. When a team is not found in the hardcoded list, a fallback `teamCategoryMap` from Firestore config is used (populated during Excel import).

## CSS

- White/green theme with CSS custom properties in `:root` — all in `index.html`'s `<style>` block.
- Color scheme: white backgrounds, green accents (`--accent: #16a34a`), green shades.
- Mobile-first responsive design — sidebar collapses on mobile, admission page optimized for counter use.
- Color tokens used in export.js/reports.js Excel output mirror the UI color palette.

## Firebase Setup Requirements

Before the app works, the Firebase project needs:
1. **Authentication** — Enable Email/Password sign-in method in Firebase Console
2. **Firestore** — Create a Firestore database (start in test mode or configure security rules)
3. **Security Rules** — Restrict read/write to authenticated users
