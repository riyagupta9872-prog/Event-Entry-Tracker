# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prerna Festival Management — a client-side PWA for tracking attendance, payments, and transportation at the "Prerna Festival" event. Firebase backend for authentication and data persistence. Deployed as a static site to GitHub Pages via `deploy.yml`. **No build step, no bundler, no server.**

## Deployment

- **GitHub Pages** via `deploy.yml` — pushes to `main` auto-deploy the entire repo root as a static site.
- No CI, no tests, no linting configured.

## Architecture

### Backend: Firebase
- **Firebase Auth** for email/password authentication with persistent sessions
- **Cloud Firestore** for all data storage (replaces IndexedDB)
- Firebase SDK loaded via CDN (compat version, no build step needed)
- Firestore offline persistence enabled for PWA offline support

### Firestore Data Structure
```
users/{uid}                          — User profiles (name, email, role)
events/{eventId}                     — Event documents (name, date, chargePerPerson, totalExpense, financialYear)
events/{eventId}/participants/{docId} — Attendee/participant records
events/{eventId}/config/{key}        — Event-level config key-value pairs
events/{eventId}/busRoutes/{docId}   — Bus route configurations
events/{eventId}/auditLog/{docId}    — Audit trail entries
```

Data is **event-scoped** — all participant, config, and bus route data lives under a specific event. The active event is tracked via `localStorage('prerna_active_event')` and `DB.setCurrentEvent()`.

### Module structure (all vanilla JS, IIFE pattern returning public API):

- **`firebase-config.js`** — Firebase initialization with app config, auth, and Firestore globals (`auth`, `firestore`).
- **`db.js`** — `DB` module. Firestore wrapper maintaining the same API as the original IndexedDB layer. Event-scoped collections, generic CRUD (`getAll`, `put`, `add`, `deleteRecord`, `bulkAdd`), config key-value store, audit logging, and event management (`getEvents`, `createEvent`, `updateEvent`, `deleteEvent`).
- **`helper.js`** — `Helpers` module. UI utilities (toast, modal), formatting (currency in INR, dates in `en-IN`), fuzzy name matching (Levenshtein), duplicate detection, financial year utilities (`getFinancialYear`, `getFYRange`).
- **`reports.js`** — `Reports` module. Computes report data (overview, payment with paid/unpaid/free + cash/online breakdown, reference, transport, summary) and renders report HTML.
- **`export.js`** — `Export` module. Exports reports to Excel (via SheetJS/`XLSX`), CSV, and PDF (print-based via `window.open`).
- **`app.js`** — `App` module. Firebase Auth flow (login, register, forgot password, change password), event management (create/switch events), page navigation, admission/attendance, walk-in entry, attendee CRUD, financial year reporting, settings.
- **`sw.js`** — Service worker for offline caching. Skips Firebase API requests (auth/firestore).

### Key patterns

- **Auth**: Firebase email/password authentication. User profiles stored in Firestore `users` collection. Roles: `admin`/`volunteer`. `auth.onAuthStateChanged()` handles persistent sessions automatically.
- **All HTML is in `index.html`** — a single file with inline CSS and external script tags loading modules in dependency order: `firebase-config.js` -> `db.js` -> `helper.js` -> `reports.js` -> `export.js` -> `app.js`.
- **Firestore IDs are strings** — all `onclick` handlers quote IDs: `App.markAttendance('${a.id}')` not `App.markAttendance(${a.id})`.
- **External CDN deps**: Firebase SDK (compat v10.12.0), SheetJS (`xlsx.full.min.js`), JSZip, Google Fonts (DM Sans, DM Mono).
- **No framework** — DOM manipulation via `document.getElementById`, `innerHTML` assignment, and event listeners.

### Participant Data Model (Firestore `events/{id}/participants`)

Key fields: `attendeeId`, `name`, `mobile`, `team`, `category`, `reference`, `paymentStatus` (`paid`/`unpaid`/`free`), `paymentMode` (`cash`/`online`), `paymentAmount`, `paymentDate`, `remarks`, `attendance` (`present`/`absent`), `entryTime`, `markedBy`, `isWalkIn`, `isDuplicate`, `busRoute`.

### Financial Year

FY runs April 1 to March 31. FY string format: `"2025-26"`. Events are grouped by FY for profit/loss reporting. `Helpers.getFinancialYear(dateStr)` computes FY from any date.

## CSS

- White/green theme with CSS custom properties in `:root` (inline in `index.html`).
- Color scheme: white backgrounds, green accents (`--accent: #16a34a`), green shades for UI elements.
- Mobile-first responsive design — sidebar collapses on mobile, admission page optimized for counter use.

## Firebase Setup Requirements

Before the app works, the Firebase project needs:
1. **Authentication** — Enable Email/Password sign-in method in Firebase Console
2. **Firestore** — Create a Firestore database (start in test mode or configure security rules)
3. **Security Rules** — should restrict read/write to authenticated users
