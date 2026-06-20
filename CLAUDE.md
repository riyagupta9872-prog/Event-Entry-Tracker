# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Prerna Festival Management — a client-side PWA for tracking attendance, payments, and transportation at the "Prerna Festival" event. Firebase backend for authentication and data persistence. Deployed as a static site to GitHub Pages via `deploy.yml`. **No build step, no bundler, no server.**

To run locally: open `index.html` in a browser, or use any static file server (e.g., VS Code Live Server or `python -m http.server`).

## Deployment

- **GitHub Pages** via `deploy.yml` — pushes to `main` auto-deploy the entire repo root as a static site.
- No CI, no tests, no linting configured.
- After changing any cached asset (HTML/JS/CSS), **bump the version number** in `sw.js` (`CACHE_NAME = 'prerna-festival-v{N}'`). Without this, users get stale files from the service worker cache.

## Architecture

### Backend: Firebase
- **Firebase Auth** for email/password authentication with persistent sessions
- **Cloud Firestore** for all data storage
- Firebase SDK loaded via CDN (compat version, no build step needed)
- Firestore offline persistence enabled for PWA offline support

### Firestore Data Structure
```
users/{uid}                           — User profiles (name, email, role)
events/{eventId}                      — Event documents (name, date, chargePerPerson, financialYear)
events/{eventId}/participants/{docId} — Attendee/participant records
events/{eventId}/config/{key}         — Event-level config (areas JSON, eventDate, teamCategoryMap)
events/{eventId}/busRoutes/{docId}    — Bus route configurations (name, cost, busCount)
events/{eventId}/buses/{docId}        — Bus objects volunteers choose from at login (name, coordinator, area)
events/{eventId}/auditLog/{docId}     — Audit trail entries (append-only)
```

Data is **event-scoped** — all participant, config, and bus data lives under a specific event. The active event is tracked via `localStorage('prerna_active_event')` and `DB.setCurrentEvent()`.

### Module structure (all vanilla JS, IIFE pattern returning public API):

- **`firebase-config.js`** — Firebase initialization; exposes globals `auth` and `firestore`.
- **`db.js`** — `DB` module. Firestore wrapper. `DB.STORES` maps internal names (`attendees`, `users`, `config`, `busRoutes`, `buses`, `auditLog`) to Firestore collection paths. Generic CRUD: `getAll`, `getById`, `put`, `add`, `deleteRecord`, `bulkAdd`. Event management: `getEvents`, `getEvent`, `createEvent`, `updateEvent`. Config key-value store: `getConfig`, `setConfig`. `clearStore` uses Firestore batches capped at 500 docs. **Cross-event queries**: temporarily switch via `DB.setCurrentEvent(eid)` → query → `DB.setCurrentEvent(oldEvent)`.
- **`helper.js`** — `Helpers` module. Toast notifications, modal, currency formatting (INR), date formatting (`en-IN`), Levenshtein-based fuzzy name matching (`similarName`), duplicate detection (`detectDuplicates`), debounce, financial year utilities, HTML escaping.
- **`reports.js`** — `Reports` module. Computes report data (overview, payment, reference, transport, bus, summary) and renders report HTML. Exports styled Excel reports via ExcelJS. Contains hardcoded `CATEGORY_TEAMS` map (team → department).
- **`export.js`** — `Export` module. Exports attendee list to styled Excel (ExcelJS), CSV, and PDF (print-based). Includes Area/Zone column, color-coded rows by payment/attendance status.
- **`app.js`** — `App` module (~4700 lines). Everything else: Auth, events, navigation, session setup wizard, gate admission, walk-in, attendee CRUD, bulk import, bus/area management, dashboard, reports, settings, OCR.
- **`sw.js`** — Service worker for offline caching. Bypasses Firebase API requests. Cache-first for static assets and CDN libraries.

### IIFE Pattern — Critical Rules

`app.js` uses the IIFE module pattern: `const App = (() => { ... return { ... }; })();`

**Three rules that prevent runtime errors:**

1. **Functions called from HTML `onclick=` must be named functions in the IIFE body AND listed in the return export.** Example: `function _openWalkin() { ... }` in body + `_openWalkin,` in return statement. Then HTML uses `onclick="App._openWalkin()"`.

2. **Never assign to `App.*` inside the IIFE body** — `App` doesn't exist during IIFE execution. `App._repairBrokenArea = async function()` will crash with `Cannot access 'App' before initialization`. Use named functions + return export instead.

3. **`isAdmin` is NOT a module-level variable.** It is declared locally as `const isAdmin = currentUser?.role === 'admin'` inside each function that needs it. Using `isAdmin` in a function that doesn't declare it will throw `ReferenceError`.

### Key Module-Level State (app.js)

| Variable | Purpose |
|----------|---------|
| `currentUser` | Logged-in user object (`{ uid, email, name, role }`) |
| `allAttendees` | In-memory cache of all participants for the active event, updated by `onSnapshot` |
| `_dashStaticCache` | Dashboard config cache (buses, areas, event doc) with 30s TTL; cleared on event switch or bus/area changes |
| `_attFilter` | Active tab filter on the Gate page (`'all'`, `'unpaid'`, `'absent'`, `'present'`, `'walkin'`) |
| `attendanceInited` | Guard flag preventing duplicate listener attachment in `initAttendance()` |
| `normBus` | `s => (s || '').trim().toLowerCase()` — case-insensitive bus/area name comparisons |
| `_busesConfigured` | Boolean set by `initMyBusPicker()`; gates the "select bus before admitting" flow |

### Real-time Sync

The Gate page uses a Firestore `onSnapshot` listener (`startLiveSync()` / `stopLiveSync()`). When participants change from any device, `allAttendees` is updated and the page re-renders via `_debouncedPageRefresh()` (200ms debounce). Always call `stopLiveSync()` before navigating away or logging out.

### Area / Zone System

Areas are stored in Firestore config as a JSON string (`DB.getConfig('areas')` / `DB.setConfig('areas', ...)`). Each area is an object:

```js
{ id, name, perBusCost, perPersonCharge, coordinator, capacity }
```

Older events may store areas as plain strings — `_loadAreas()` auto-migrates them to objects. **Always extract `.name` when building UI text/values** — passing the full object to `escapeHtml()` or a select option produces `[object Object]`.

Buses are assigned to areas via their `area` field. Volunteers are assigned to one area at session start; they only see buses and participants in their area.

### Bus Cost / Financial Year Expense

Bus cost is **always computed from configuration**, never from manual input:
```
busCost = Σ (buses_in_area × area.perBusCost)  for each area
```
This is the same formula used on both the dashboard and the FY report table.

### Walk-in Flow

Walk-in admission at the gate has no payment status dropdown. Status is auto-derived:
- Amount > 0 → `paymentStatus: 'paid'`
- Amount = 0 or blank → `paymentStatus: 'unpaid'`

The walk-in panel auto-opens for admin role on first Gate tab load.

### Volunteer Bus Assignment

Each volunteer sets their bus once per browser session via the "Start of Shift" modal. Stored in `localStorage` as `prerna_my_bus_{eventId}`. Every admission stamps the participant's `boardedBus` field with this value. Admins see all buses; volunteers only see their area's buses.

### Participant Data Model (Firestore `events/{id}/participants`)

Key fields: `name`, `mobile`, `team`, `category`, `reference`, `area`, `paymentStatus` (`paid`/`unpaid`/`free`), `paymentMode` (`cash`/`online`), `paymentAmount`, `paymentDate`, `paidAtEvent` (boolean — collected at gate vs before event), `remarks`, `attendance` (`present`/`absent`), `entryTime`, `markedBy`, `collectedBy`, `isWalkIn`, `isDuplicate`, `busRoute` (registered preference), `boardedBus` (actual bus), `pickupLocation`.

### Auth & Roles

Firebase email/password. Roles: `admin` / `volunteer`. First user registered becomes `admin` (empty `users` collection check); all others default to `volunteer`. Role-gated UI: elements with class `admin-only` are hidden for volunteers; `VOLUNTEER_PAGES` array controls which pages volunteers can access.

### Excel Libraries

| Library | Purpose |
|---------|---------|
| **ExcelJS** (`ExcelJS.Workbook`) | All *export* flows — styled Excel with colored headers, row fills |
| **SheetJS** (`XLSX.*`) | Excel *import* only — reading uploaded `.xlsx` files in bulk upload |

### Financial Year

FY runs April 1 to March 31. Format: `"2025-26"`. Events grouped by FY for profit/loss reporting. `Helpers.getFinancialYear(dateStr)` computes FY from any date.

### Department / Team Mapping

`CATEGORY_TEAMS` in `reports.js` is the authoritative map of team names to departments. `App.getCategoryForTeam(teamName)` delegates to `Reports.getTeamDept()`. When a team is not in the hardcoded list, a fallback `teamCategoryMap` from Firestore config is used (populated during Excel import).

## CSS & Responsive Design

- **All CSS is inline in `index.html`'s `<style>` block** (`main.css` exists but is not linked).
- White/green theme with CSS custom properties in `:root` (`--accent: #16a34a`).
- **Mobile-first**: three responsive breakpoints:
  - `≤768px` — single-column layouts, hidden topbar title, 44px touch targets, 1-column walk-in form
  - `≤640px` — modal becomes bottom-sheet (rounded top corners, full width)
  - `≤480px` — setup fields fully single-column, toast full-width, stacked modal buttons
- Walk-in/payment panels use `env(safe-area-inset-bottom)` for iPhone home indicator.
- `format-detection: telephone=no` prevents unwanted phone number auto-linking.

## PWA

- Manifest at `manifest.json` with SVG icons in `icons/` directory (both `any` and `maskable` purpose).
- Apple touch icon linked in HTML head.
- `apple-mobile-web-app-status-bar-style: black-translucent` for seamless green header.
- SW caches all core assets + CDN libraries on install; bypasses all Firebase/auth API requests.

## When Adding Features

1. **All new code goes in `app.js`** — define as a named function, add to the return export if called from HTML.
2. **New pages** need: a `page-{name}` div in `index.html`, a case in `navigate()`, and optionally a bottom-nav tab in `PAGE_TO_TAB`.
3. **Bump SW version** after any change to HTML/JS/CSS files.
4. **No npm, no build step** — add external libraries via CDN `<script>` tags in HTML.
5. **Derive data, don't ask for it** — if the system already has the information (e.g., bus cost from config), compute it. Never add a manual input for what can be computed.
6. **Area objects vs strings** — always use `typeof a === 'string' ? a : (a.name || '')` when displaying area values; never pass the full object to string contexts.

## Firebase Security Rules

Roles: `admin` (full access) / `volunteer` (read events + participants, create walk-ins, update attendance/payment; no event/config/bus management; no audit log reads; no deletes). Audit log is append-only — update and delete are permanently denied.
