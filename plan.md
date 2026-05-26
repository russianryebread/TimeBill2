# TimeBill — Plan

## Context

A unified billing/tracking app for hourly contractors that handles **time tracking, expenses, invoicing, payment tracking, and tax estimation** in one place. Today these workflows are split across Toggl + a spreadsheet + QuickBooks + a PDF generator, and reconciling them at tax time is painful. TimeBill makes the contractor's whole money-in/money-out picture queryable from one data model.

**v1 ships as a single-user, cloud-synced app** (web + Mac desktop), but the schema and access rules are designed from day one to extend cleanly into **teams**, a **mobile companion**, and **AI features** without a rewrite.

### Decisions locked in

| Area | Choice |
| --- | --- |
| Clients | SvelteKit web app + Tauri Mac desktop app (shared Svelte components) |
| Backend | PocketBase (Go binary, SQLite, auth/realtime/files built in); JS hooks for server-side logic. **Also serves the SvelteKit static build from `pb_public/`** — one binary, one origin. |
| Dev tooling | Node 20+ (or Bun — interchangeable) for SvelteKit build. No JS runtime required in production; PocketBase runs server-side JS in its embedded Goja engine. |
| Auth | PocketBase email/password; single-user but schema is multi-tenant-ready |
| Currency | USD only |
| Tax scope | US quarterly self-employment estimate helper + Schedule C category CSV export |
| Integrations | None in v1 (manual entry); design data model so Stripe/Plaid/QBO drop in later |
| Time entry | Live start/stop timer + Mac menu bar timer |
| Expenses | Manual entry + receipt upload + mileage + recurring |
| Invoicing | PDF + email + public client view link + recurring/retainer + per-client/project rates |
| AI | Not in v1, but leave room (e.g., description embeddings table stub, deterministic core logic) |

### Open items
- Menu bar UI: a screenshot mockup was mentioned but not attached. Plan specifies a sensible default (quick-pick recent projects + running timer + today's hours); we'll match the screenshot once shared.

---

## Architecture

### Component layout

```
                ┌─────────────────────┐
                │    Browser (web)    │  ─┐
                └─────────────────────┘   │
                ┌─────────────────────┐   │  Same SvelteKit static build,
                │  Tauri Mac app      │  ─┤  loaded from PocketBase or bundled
                └─────────────────────┘   │
                                          │
                                ┌─────────▼──────────┐
                                │     PocketBase     │
                                │  - SQLite DB       │
                                │  - Auth            │
                                │  - File storage    │
                                │  - JS hooks (Goja) │
                                │  - Scheduled jobs  │
                                │  - Static server   │ ← serves the web app from pb_public/
                                └────────────────────┘
```

- **SvelteKit** built with `@sveltejs/adapter-static` to produce a pure static SPA. Output is copied into PocketBase's `pb_public/` directory so PocketBase serves the web app directly. No SSR — PocketBase is the auth/data source via its REST + realtime API.
- **PocketBase** is a single Go binary handling: API, SQLite, auth, file storage (receipts, invoice PDFs, logos), JS hooks (`pb_hooks/`), and static file serving for the web app. **No separate web host needed.** One process, one origin → no CORS configuration either.
- **Tauri** wraps the same Svelte build for the Mac app and adds native capabilities the web app can't have: menu bar timer, system notifications, global hotkeys, and menu bar icon state. The Mac app can either bundle the static assets locally (offline-capable shell) or point at the deployed PocketBase URL — we'll bundle locally and configure the PB base URL at runtime so the desktop app can connect to your PocketBase instance.
- **Build tooling:** Node or Bun (interchangeable) for `svelte-kit build` and Tauri's bundler. No JS runtime required in production — Goja runs server-side hooks inside PocketBase.

### Hosting

- **PocketBase + web app: one host.** A small VPS (Fly.io, Hetzner, or Railway) running the PocketBase binary. It serves the API at `/api/*` and the SvelteKit static build from `/`. Persistent volume for SQLite + uploaded files. Backups via Litestream to S3-compatible storage.
- TLS via a reverse proxy (Caddy with auto-Let's-Encrypt is the simplest) or the platform's built-in TLS termination.
- **Mac app:** signed/notarized `.dmg` distributed via GitHub Releases with Tauri's updater for auto-update. Static assets bundled in the app; PocketBase URL configurable in app settings.

### Repo layout

```
TimeBill/
├── apps/
│   ├── web/                 # SvelteKit app (the shared client UI). `build/` is copied into pocketbase/pb_public/
│   └── desktop/             # Tauri shell that bundles apps/web's build
├── packages/
│   ├── shared/              # Types, Zod schemas, pure logic (tax calc, invoice math, money formatting)
│   └── ui/                  # Reusable Svelte components used by both apps
├── pocketbase/
│   ├── pb_public/           # Web app static build lives here (gitignored; populated by `npm run build`)
│   ├── pb_migrations/       # Collection definitions as migrations (version-controlled)
│   ├── pb_hooks/            # JS hooks: invoice number generation, recurring invoices, tax calcs
│   └── pocketbase           # Binary (gitignored; pinned version in README)
└── package.json             # workspaces (npm or bun — works with either)
```

---

## Data model (PocketBase collections)

Every business collection gets a `workspace` relation field. v1 auto-creates one workspace per user; v2 lets a workspace have many `workspace_members`. This single field is what makes the "design for teams" goal cheap.

### Core collections

| Collection | Key fields | Notes |
| --- | --- | --- |
| `workspaces` | `name`, `owner` (rel → users), `default_currency` (USD), `tax_profile_json` | One per user in v1. |
| `workspace_members` *(v2 stub, define now)* | `workspace`, `user`, `role` (owner/admin/member) | Rules already check this collection so adding members later is zero-migration. |
| `clients` | `workspace`, `name`, `email`, `address`, `default_rate_cents`, `notes`, `archived` | |
| `projects` | `workspace`, `client`, `name`, `rate_cents` (nullable → fallback to client/task rate), `status`, `budget_hours`, `color` | |
| `tasks` | `workspace`, `name`, `rate_cents` (nullable), `billable_default` (bool) | E.g., "Development", "Meetings". Used for per-task rates. |
| `time_entries` | `workspace`, `project`, `task`, `started_at`, `ended_at` (nullable while running), `description`, `billable`, `rate_cents_snapshot`, `invoice` (nullable rel) | A running timer = `ended_at IS NULL`. Rate snapshotted at stop time so changing rates later doesn't rewrite history. |
| `expense_categories` | `workspace`, `name`, `schedule_c_line` (string, e.g. "Line 22: Supplies") | Seeded with standard Schedule C lines on workspace create. |
| `expenses` | `workspace`, `category`, `date`, `amount_cents`, `vendor`, `description`, `client` (nullable, for billable expenses), `project` (nullable), `billable` (bool), `reimbursable` (bool), `receipt` (file), `invoice` (nullable rel) | |
| `mileage_entries` | `workspace`, `date`, `miles`, `purpose`, `client` (nullable), `project` (nullable), `billable`, `rate_cents_snapshot` | Auto-populates rate from current IRS standard mileage rate stored in a `tax_settings` singleton. |
| `recurring_expenses` | `workspace`, `category`, `amount_cents`, `vendor`, `cadence` (monthly/yearly), `next_run`, `active` | A scheduled JS hook materializes due ones into `expenses` daily. |
| `invoices` | `workspace`, `client`, `number` (per-workspace sequence), `issue_date`, `due_date`, `status` (draft/sent/viewed/paid/overdue/void), `subtotal_cents`, `tax_cents`, `total_cents`, `notes`, `public_token` (UUID for client portal link), `pdf` (file) | |
| `invoice_line_items` | `invoice`, `description`, `quantity` (decimal — hours or units), `unit_price_cents`, `amount_cents`, `source` (time_entry/expense/mileage/manual), `source_id` (string) | |
| `recurring_invoices` | `workspace`, `client`, `template_line_items_json`, `cadence`, `next_run`, `active`, `auto_send` (bool) | Scheduled hook generates invoice + optionally emails. |
| `payments` | `workspace`, `invoice`, `date`, `amount_cents`, `method` (check/ACH/cash/card/other), `reference`, `notes` | Multiple payments per invoice supported (partial pay). |
| `tax_settings` | `workspace`, `filing_status`, `state`, `estimated_other_income_cents`, `mileage_rate_cents_per_mile`, `quarterly_safe_harbor_pct` | Singleton per workspace. |
| `events_outbox` *(AI/integrations stub)* | `workspace`, `kind`, `payload_json`, `processed_at` | Empty in v1, populated later by hooks. |

### Access rules pattern (PocketBase)

For every business collection:
```
listRule:   @request.auth.id != "" && workspace.members_can_read = true
                                    // expands to: caller is workspace owner OR a member
viewRule:   same
createRule: caller belongs to workspace
updateRule: same
deleteRule: same (with role check for sensitive ones)
```

Encode this as a helper expression referencing `workspace_members`. In v1 the owner is the only member; in v2 the same rules just start matching more rows. **No rule rewrites needed when teams ship.**

Public invoice view bypasses auth via a dedicated unauthenticated endpoint in `pb_hooks/` that takes `public_token` and returns the rendered invoice JSON.

---

## Feature design

### Time tracking
- **Live timer:** one running entry per user at a time (enforced by a hook). Starting a new one auto-stops the current one. The timer survives reload/restart because it lives in PocketBase, not local state.
- **Quick-pick:** menu bar dropdown shows last 5 project+task combos + a search box. One click starts a timer.
- **Edit history:** entries can be edited inline (start/end/description). Rate snapshot is preserved on edit unless explicitly recalculated.
- **Idle detection (desktop only):** Tauri watches system idle; if user has been idle >5 min while a timer runs, surface a "discard idle time / keep / split" prompt on return.
- **Calendar import (post-v1, schema-ready):** `time_entries` already accepts arbitrary `started_at`/`ended_at` so importing is a UI feature, not a schema change.

### Mac menu bar timer (Tauri)
- Menu bar icon shows clock symbol; turns colored when a timer runs.
- Dropdown (default spec — to be reconciled with your screenshot):
  - Top: current running timer (project · task · elapsed) + Stop button
  - Middle: quick-pick recent project/task list with search
  - Bottom: today's billable total + "Open app" link
- Global hotkey: ⌃⌥T to start/stop the most recent timer.

### Expenses
- Form: date / vendor / category / amount / billable + client/project / receipt upload / notes.
- Receipt upload uses PocketBase file fields — no S3 needed in v1.
- **Mileage entry:** separate quick form (date / miles / purpose / billable). Rate auto-pulled from `tax_settings`.
- **Recurring expenses:** a PocketBase scheduled hook (`pb_hooks/cron_recurring.js`) runs daily, materializes any `recurring_expenses` whose `next_run <= today` into `expenses`, and advances `next_run`.

### Invoicing
- **Draft → send → paid flow:** invoice starts as `draft`; user pulls in unbilled time entries / expenses / mileage from a side panel (auto-grouped by date or project). Each pulled item gets linked via `time_entries.invoice` / `expenses.invoice` / `mileage_entries.invoice` so it can't be double-billed.
- **PDF generation:** server-side hook generates a PDF on send. Use `@react-pdf/renderer`-equivalent for Svelte (e.g., `pdfmake` or `puppeteer-core` in a hook), stored in `invoices.pdf`. Pin the choice during build.
- **Email send:** PocketBase has built-in SMTP — configure with a transactional provider (Resend, Postmark, or SES). One template for "invoice sent" with a public view link.
- **Public client portal:** unauthenticated route `/i/:public_token` renders a read-only invoice page (no client login). v1 just shows the invoice; v2 adds a "Pay" button when Stripe is wired in.
- **Recurring/retainer:** `recurring_invoices` cron generates the next invoice from a template, optionally auto-sends. Useful for retainer clients.
- **Rate resolution order** (when adding a time entry to an invoice line):
  1. `time_entries.rate_cents_snapshot` if set
  2. else `task.rate_cents`
  3. else `project.rate_cents`
  4. else `client.default_rate_cents`
- **Invoice numbering:** per-workspace sequence in a hook; format configurable (`INV-{year}-{seq:04d}` default).

### Payment tracking
- `payments` collection allows multiple partial payments per invoice. Invoice `status` is derived: when `SUM(payments.amount_cents) >= total_cents` → `paid`; else if past `due_date` → `overdue`; else stays `sent` or `viewed`.
- A nightly hook updates `overdue` status.
- "Viewed" status is set the first time the public token URL is hit.

### Tax tracking
- **Schedule C category mapping:** every expense has a category, every category maps to a Schedule C line. The "Tax" view aggregates YTD by line.
- **Mileage deduction:** total miles × IRS standard rate (configurable; defaults to current-year rate, stored in `tax_settings`).
- **Quarterly estimate helper:**
  - Pure functions in `packages/shared/tax.ts`, easy to unit-test.
  - Inputs: YTD net SE income, filing status, state (flat-rate approximation only for v1), prior-year safe-harbor target.
  - Outputs: estimated SE tax (15.3% on 92.35% of net earnings, with SS wage-base cap), estimated federal income tax (bracket calc), suggested quarterly payment for the current quarter, "safe harbor" check.
  - Big banner: this is an estimate, not advice. Link to IRS Form 1040-ES.
- **CSV exports:** by year — `time_entries.csv`, `expenses.csv` (with Schedule C line), `mileage.csv`, `invoices.csv`, `payments.csv`. Drop into any accountant's workflow.

### Reporting (v1 dashboard)
- Today: hours logged, billable $, running timer
- This week / month: hours, billable $, expenses, net
- Outstanding A/R: total owed, oldest invoice, count overdue
- YTD: net SE income, est. quarterly payment due, deductible expense total

---

## Designing for the future (cheap hooks, not features)

These cost nothing now but save a rewrite later:
- **Teams:** `workspace_members` exists and access rules already check it. Adding teams = build invite UI + role enforcement, no schema migration.
- **Mobile:** PocketBase JS SDK works in React Native; the shared logic in `packages/shared/` is platform-agnostic. The whole API is the contract.
- **AI:** `events_outbox` table is in place. When AI ships, hooks fan out create/update events; an external worker (or `pb_hooks/`) can embed descriptions, categorize expenses, suggest invoice line text, etc. Description fields are already free-text. No data model changes.
- **Integrations (Stripe/Plaid/QBO):** `payments.method` and `payments.reference` already accommodate external IDs. Invoice `public_token` is the foundation for a Stripe "pay invoice" button.

---

## Build phases

| Phase | Scope | Why this order |
| --- | --- | --- |
| **0. Foundation** | Monorepo (Bun workspaces), SvelteKit app skeleton, Tauri shell, PocketBase binary + migrations runner, auth flow, `workspaces` auto-create on signup. | Nothing works without this. |
| **1. Time tracking** | Clients, projects, tasks, time entries, live timer, manual entries, Mac menu bar timer + global hotkey. | Highest-frequency workflow; drives invoice data. |
| **2. Expenses** | Expense categories (seeded), expenses + receipt upload, mileage entries, recurring expenses cron. | Needed before invoicing (billable expenses) and tax. |
| **3. Invoicing** | Invoice draft/send/paid flow, pull unbilled items, PDF generation, public view link, email send via SMTP. | The payoff feature for time + expense data. |
| **4. Payments** | Payments collection, partial payments, status derivation, overdue cron. | Closes the money loop. |
| **5. Tax & reporting** | Schedule C aggregation, quarterly estimate calculator, dashboard, CSV exports. | Year-end + quarterly use case. |
| **6. Recurring invoices** | Template + cadence + auto-send cron. | Nice-to-have built on the solid invoice foundation. |

---

## Verification

End-to-end smoke test (run after each phase, full pass before any "v1 done" claim):

1. **Auth & workspace.** Sign up → workspace auto-created → log out / log in works on both web and Mac.
2. **Time tracking.** Create client + project. Start timer from menu bar → close laptop → reopen → timer still running. Stop. Edit entry. Hours total matches dashboard.
3. **Expenses.** Add expense with receipt photo. Add mileage entry. Add recurring expense; manually trigger cron hook and verify materialization. Verify Schedule C totals update.
4. **Invoicing.** Create invoice. Pull unbilled time + a billable expense + mileage. Verify rate resolution picks the right rate per the order above. Send invoice → PDF generated, email received, public link opens without auth, `status` flips to `viewed`.
5. **Payment.** Record partial payment → status stays `sent`. Record remainder → status flips to `paid`. Wait past `due_date` on a different invoice → overdue cron flips status.
6. **Tax.** Open quarterly estimate view → totals match expected sums from steps 2–5. Export each CSV; open in Numbers/Excel; verify Schedule C lines are populated.
7. **Cross-client sync.** Make a change on web → see it appear on Mac app within 1s (PocketBase realtime).
8. **Unit tests.** `packages/shared/tax.ts` has tests for SE tax math (boundary: SS wage base, married filing jointly vs. single, edge case zero income) and invoice math (multiple rate fallbacks, billable expense passthrough). `bun test` is green.
9. **Tauri build.** `bun run tauri build` produces a signed `.dmg` that launches and connects to the same PocketBase backend as web.

---

## Critical files to create (representative, not exhaustive)

- `package.json` — Bun workspaces root
- `apps/web/svelte.config.js` — SvelteKit, static adapter
- `apps/web/src/lib/pb.ts` — PocketBase client singleton + auth store
- `apps/web/src/lib/timer.svelte.ts` — running-timer store with PB realtime subscription
- `apps/desktop/src-tauri/tauri.conf.json` — Tauri config (menu bar, tray icon, global shortcut, updater)
- `apps/desktop/src-tauri/src/menubar.rs` — menu bar timer (Rust side, calls into web via Tauri events)
- `packages/shared/src/tax.ts` — pure tax math (most-tested file in the repo)
- `packages/shared/src/invoice.ts` — line-item generation, rate resolution, totals
- `packages/shared/src/schemas.ts` — Zod schemas mirroring PB collections
- `pocketbase/pb_migrations/0001_init.js` — all collections + indexes + rules
- `pocketbase/pb_migrations/0002_seed_schedule_c_categories.js` — seed defaults on workspace create (via hook)
- `pocketbase/pb_hooks/timer.pb.js` — single-running-timer enforcement, rate snapshot on stop
- `pocketbase/pb_hooks/invoice.pb.js` — number sequence, status derivation, public token routes
- `pocketbase/pb_hooks/cron.pb.js` — daily jobs (recurring expenses, recurring invoices, overdue check)
- `pocketbase/pb_hooks/email.pb.js` — invoice send template

---

## Phase 4 (implemented) — visualization, icons, edit/lock

Added during the May 2026 working session:

- **Iconify Phosphor Duotone** via `@iconify/tailwind4`. Usage form
  `class="icon-[ph--house-duotone]"` (Tailwind only scans literal class
  strings, so dynamic icon names must be written verbatim).
- **Daily Gantt timeline** on `/time` — `lib/components/DayGantt.svelte`.
  SVG-free, plain divs positioned with `%`. Auto-fits to first start → last
  end with 30-min padding; ticks every whole hour; overlapping entries are
  stacked into rows. Clicking a bar opens the edit modal.
- **Time-entry edit modal** — `lib/components/TimeEntryEditor.svelte`. Opens
  via the pencil button on each row. Datetime-local start/end, project,
  activity, description, billable; Save / Cancel / Delete.
- **Locked-when-invoiced** state — when `time_entries.invoice != ""`, the
  row shows a lock icon, the pencil is hidden, and the server hook in
  `pb_hooks/timer.pb.js` rejects any field changes except clearing the
  invoice link (which the invoice-line-item delete does).
- **Reports page** at `/reports`:
  - Month + Year selectors.
  - Hours/Billable/Active-days summary cards for the month.
  - Calendar heatmap of hours per day (5-shade brand scale).
  - Project mix donut + table (hours + billable per project).
  - Client breakdown table with share bars.
  - 12-month year overview (clickable bars switch the month).
  - CSV exports for time, expenses, mileage, invoices, payments.

---

## Phase 5 (in progress) — hours-first edit, billing rounding, lock UX

Driven by user feedback on the editor and invoicing flow.

### 5.1 Hours-first time entry editor

The edit modal currently leads with two datetime-local pickers. New
behavior:

- **Primary input is "Hours"** (decimal). When the user edits it, the end
  time is automatically recomputed as `started_at + hoursMinutes`. This
  matches how contractors actually think about a session ("that meeting was
  about 1.5 hours").
- **Clock-time fine-tuning is secondary** — placed behind a disclosure
  ("Adjust clock times") that, when expanded, reveals the two
  datetime-local inputs. Editing them still works as before, and editing
  start/end keeps the hours input in sync.
- Both views write the same `started_at` / `ended_at` fields.

### 5.2 Billing rounding setting

Contractors typically round billed time up to a chosen granularity (most
common: nearest 15 min). Reports should still reflect actual time worked.

- **New workspace field:** `billing_rounding_minutes` (number, default
  `0` = no rounding). Allowed values: `0`, `5`, `15`, `30`, `60`. Stored on
  `workspaces` (because it's a billing preference, not a tax setting).
- **New settings page** at `/settings/billing` to choose the value. A
  segmented control with the five options. Persists to the workspace
  record.
- **Applied at invoice-line creation only.** When "Add selected to invoice"
  pulls a time entry, the line item's `quantity` (hours) is rounded *up* to
  the chosen granularity. The underlying `time_entries.rate_cents_snapshot`
  and actual duration are untouched, so:
  - **Invoices** show rounded hours.
  - **Reports** continue to show exact durations.
- Implementation lives in `packages/shared/invoice.ts`:
  `roundHours(hours, roundingMinutes)`. Pure function, easy to unit-test.

### 5.3 Clickable locked entries → invoice link

The lock icon currently signals "you can't edit this," but doesn't tell
the user *where* the entry was billed.

- Clicking a locked entry's row (or the lock icon) opens the editor in
  **read-only mode** (already supported by `TimeEntryEditor` when
  `entry.invoice` is set).
- The header shows a chip linking to `/invoices/{invoice}` — e.g.,
  "Linked to INV-2026-0001 →".
- All fields disabled; only Close + the invoice link are interactive.

### 5.4 Settings page restructure

Settings currently routes only to `/settings/tasks` (activity types). Now
needs at least one sibling (`/settings/billing`). Plan:

- Add a `/settings/+layout.svelte` with a sub-nav: Activity types ·
  Billing. Mirrors the `/expenses` tab pattern.
- Future settings (workspace name, mileage rate, tax filing status) all
  land here.

---

## Phase 6 (in progress) — quality of life + Harvest import

Big batch of polish and the first competitor-data import.

### 6.1 Visual consistency

- **Standardize all pages to `max-w-6xl px-8 py-8`** (1152px). Previously
  /clients, /projects, /time, /settings, /expenses-tabs used `max-w-3xl`
  or `max-w-5xl`, which made the layout jump as you clicked around.
- **Sidebar sticks to the viewport.** `AppShell` becomes `flex h-screen` at
  the outer level; sidebar is `h-screen sticky top-0`; main content has its
  own `overflow-y-auto`. The signout footer always sits at the bottom of
  the visible page, not the bottom of long scrollable content.
- **Sign out as icon button.** Replace the text link with a
  `ph--sign-out-duotone` icon button, with the user's email next to it.
- **Fix `-1:-1` display.** `formatHours` / `formatHMS` now clamp negative
  ms to 0. `timer.elapsedMs` likewise clamps. Defensive against corrupt
  entries where `ended_at < started_at`.

### 6.2 Workspace name as company name

- New `/settings/workspace` route to rename the workspace. `workspaces.name`
  is already what appears as "FROM" on the public invoice view and in the
  PDF — verifying the rename flows through.
- Future: optional company address / logo upload land here too (deferred).

### 6.3 Bulk invoice actions

- **"Add all unbilled"** button in the invoice editor's pull-unbilled side
  panel. Single click selects + adds every item in the active tab (Time /
  Expenses / Mileage) for the invoice's client. Existing checkbox flow
  remains for selective adds.
- **"Generate from month…"** button on `/invoices`. Modal: pick a client +
  month. Creates a draft invoice and pulls **every unbilled time entry,
  expense, and mileage entry** for that client in the chosen month range.
  Applies billing rounding. Navigates to the draft.

### 6.4 Harvest CSV import

- New `/settings/import` route.
- Accepts the standard Harvest **Reports → Detailed Time Entries** CSV.
  Columns: `Date, Client, Project, Project Code, Task, Notes, Hours, …,
  Billable?, Invoiced?, Billable Rate, …`.
- Import flow:
  1. User uploads CSV (parsed client-side).
  2. Preview screen: counts of new clients / projects / tasks / time
     entries to create, plus a sample of the first ~10 rows. Skipped
     duplicates (existing client/project/task name match) noted.
  3. Confirm → does the imports in batch:
     - For each unique client name → create `clients` if missing.
     - For each unique (client, project) → create `projects` if missing
       (uses the row's billable rate as the project rate).
     - For each unique task name → create `tasks` (activity types) if
       missing.
     - For each row → create a `time_entries` record:
       - `date` + `09:00` + accumulated-hours-that-day → `started_at`
       - `started_at + hours` → `ended_at`
       - `Notes` → description
       - `billable` flag
       - `rate_cents_snapshot` from Billable Rate (or project rate)
- v1 ships with Harvest only; the parser is structured so Toggl / others
  can drop in by adding a new mapper.

### 6.5 Process

- `CLAUDE.md` now contains two more standing instructions:
  - Commit after each milestone.
  - Mirror this spec to the repo's `plan.md`.

---

## Phase 7 (in progress) — email send

Closes the "draft → send → client receives" loop. Today the Send button
generates the PDF and flips status; clients still have to be sent the
link manually.

### 7.1 Sender identity on the workspace

- New `workspaces` fields:
  - `invoice_from_email` (text, optional) — overrides the SMTP sender
    when set.
  - `invoice_from_name` (text, optional) — friendly name in the From
    header (defaults to `workspaces.name`).
- Configured at `/settings/email`, which also links to the PocketBase
  admin UI for the actual SMTP host/port/credentials. We rely on PB's
  built-in `$app.newMailClient()`, which uses the SMTP configured in
  admin settings — when SMTP isn't configured, PB logs the email body
  instead of sending. Useful for local development.

### 7.2 Server endpoint

`POST /api/timebill/invoices/:id/send-email` — auth required.
- Loads invoice + client + workspace from the caller's workspaces.
- Requires the invoice to have a PDF already generated. If not, the
  client should regenerate first (the editor does this before calling).
- Builds a simple, brand-themed plain-text body:
  > Hi {client name},
  > Invoice {number} for {total} is ready. You can view it online or
  > download the PDF here: {public link}.
  > Due {due_date}.
  > — {workspace name}
- Attaches the PDF.
- Recipient defaults to `clients.email`; the client form may pass an
  override + optional `cc`.
- On success: if the invoice is still `draft`, flip status to `sent`.
- Returns `{ to, status }`.

### 7.3 Invoice editor changes

- Existing `Send` button is renamed `Mark sent` — keeps the legacy
  PDF-attach-only flow for situations where the user emails out of band.
- New primary `Send to client` button:
  1. Generates the PDF (same path as today).
  2. Uploads it.
  3. Opens a confirm modal pre-filled with the client's email; user can
     override and add a CC. Submit calls `/send-email`.
  4. Status banner reflects the response.

---

## Phase 8 (in progress) — Tauri menu-bar scaffold rebuild

The Tauri shell was regenerated to template state. Phase 8 reshapes
it into the menu-bar timer app we actually want, on top of the
existing SvelteKit static build. No native timer logic yet — this is
the chassis other phases will hang features off.

### 8.1 Two-window setup

`apps/desktop/src-tauri/tauri.conf.json` declares two windows that both
load the same frontend bundle (`apps/web/build` in production,
`http://127.0.0.1:5173` in dev):

- **`main`** — 1100x720, titled `TimeBill`, hidden at launch. Opened
  from the tray menu's "Open TimeBill" item.
- **`menubar`** — 380x520 at url `/menubar`. Decorations off,
  transparent, always on top, skip taskbar, hidden + unfocused at
  launch. The route exists at
  `apps/web/src/routes/menubar/+page.svelte`.

Bundle id `me.hoshor.timebill`, version `0.0.1`, targets
`["app", "dmg"]`, macOS min `11.0`, icons reuse the duck-clock logo
already in `src-tauri/icons/`.

### 8.2 Tray + global shortcut (Rust side)

`src-tauri/src/lib.rs`:

- `TrayIconBuilder` with the default window icon as a template image so
  macOS auto-tints it for light/dark menu bars.
- Right-click menu: `Open TimeBill` (shows + focuses `main`), `Quit`
  (Cmd+Q, `app.exit(0)`).
- Left-click on the tray icon toggles the `menubar` window's
  visibility — `is_visible()` → `hide()` else `show()` + `set_focus()`.
  Uses `show_menu_on_left_click(false)` so left-click doesn't open the
  right-click menu.
- `tauri-plugin-global-shortcut` registers `Cmd+Opt+T`. For now its
  handler reuses the same toggle. The intended long-term behavior is
  start/stop the most recent timer via a Rust→JS event — that lands
  with the bridge in 8.4.

`Cargo.toml` deps: `tauri` (features `tray-icon`, `image-png`),
`tauri-plugin-global-shortcut = "2"`, plus `serde` / `serde_json`.

### 8.3 Capabilities

`src-tauri/capabilities/default.json` applies to both windows and
allows the subset of `core:window` permissions the toggle/show logic
needs (`allow-show`, `allow-hide`, `allow-set-focus`,
`allow-is-visible`, `allow-set-position`, `allow-set-size`,
`allow-close`) plus `core:tray:default` and `core:webview:default`.

### 8.4 Deferred

- **Tauri↔Svelte bridge.** Once we have it, Cmd+Opt+T emits a
  `timer-toggle` event the Svelte side listens for; the menu bar
  window stops being the hotkey's job.
- **Idle detection.** macOS input idle watcher → prompt to discard /
  keep idle stretch mid-timer.
- **Notifications.**
- **Code signing + notarization** (Developer ID + notarytool).
- **GitHub Releases updater** via `tauri-plugin-updater`.

### 8.5 How to run it

From repo root: `npm run dev:desktop` runs `tauri dev`, which spawns
Vite on 5173 and opens the Mac app pointed at it. PocketBase still
needs to run separately (`npm run dev:pb`). `npm run build:desktop`
produces the `.app` + `.dmg` under
`apps/desktop/src-tauri/target/release/bundle/`.

---

## Phase 9 (in progress) — Toggl Track import

Second competitor importer, sharing the `/settings/import` UI shell with
the Harvest one. Same dedup-by-name semantics; parser is swapped based on
the CSV header. (Numbered 9 because Phase 8 is the Tauri scaffold above.)

### 9.1 Format auto-detection

- New helper `detectImportFormat(text)` in `apps/web/src/lib/toggl.ts`
  inspects the first CSV row.
  - `Start time` / `End time` (or `Start date` + `Duration`) → Toggl.
  - `Date` + `Hours` → Harvest.
  - Both or neither → `'unknown'`; the UI shows a Harvest/Toggl dropdown
    and re-parses on selection.
- The preview screen shows a chip "Detected: Harvest" or
  "Detected: Toggl Track" so the user can confirm the right parser ran.

### 9.2 Shared CSV helper

- The RFC-4180-ish row splitter that lived inside `harvest.ts` moved to
  `apps/web/src/lib/csv.ts` as `splitCsvRow(line)`. Both parsers import
  it, so we don't carry two copies.

### 9.3 Toggl Track parser (`apps/web/src/lib/toggl.ts`)

Handles Toggl's "Detailed report" CSV export. Columns we care about
(case-insensitive):

```
User, Email, Client, Project, Task, Description, Billable,
Start date, Start time, End date, End time, Duration,
Tags, Amount (USD), Rate
```

- `parseTogglCsv(text)` returns `{ rows, errors, headerMap }`. Row shape
  is the existing `HarvestRow` (so `buildPreview` works unchanged) plus
  required `startISO` / `endISO` strings — Toggl gives real timestamps,
  so we plumb them through instead of synthesizing.
- `Billable` is `Yes` / `No`.
- `Duration` is `HH:MM:SS` (with `HH:MM` and decimal fallbacks).
- Rate derivation order: explicit `Rate` column → `Amount (USD) / hours`
  if rate is missing but amount is present → `0`.
- **Client required.** Toggl allows projects without clients; TimeBill
  does not. Rows with empty `Client` are skipped and surfaced in the
  parse errors with: *"Row has no Client — TimeBill requires every
  project to have a client. Set one in Toggl and re-export."*

### 9.4 Insertion path

- **Toggl path:** uses each row's `startISO` / `endISO` verbatim when
  creating `time_entries`. No 09:00 synthesis.
- **Harvest path:** unchanged (groups by date, starts at 09:00, advances
  per row).
- New clients, projects (with rate seeded from the first row's
  rate/derived rate), and activity types are still deduped by name, same
  as Harvest.

### 9.5 Sharp edges noticed in Toggl's export

- Toggl allows clientless projects → skip + report, don't guess.
- `Duration` is the source of truth in Toggl's UI, but `Amount` is the
  *displayed* total; for derived rates we trust `Amount / hours`. Beware
  rounding when both are populated and disagree.
- `Start time` / `End time` are local-time strings with no timezone in
  the CSV — we insert them as naive ISO local strings and let the rest
  of the app treat them like every other local-time entry.

---

## Phase 10 (in progress) — Quarterly self-employment tax estimator

The plan called for this as "Phase 8," but Phases 8 (Tauri scaffold) and 9
(Toggl import) were already in flight, so this lands as Phase 10. Same
scope: turn the `tax.ts` skeleton into a working SE-tax estimator and
surface it as a top-level page.

### 10.1 Tax math (`packages/shared/src/tax.ts`)

Pure functions, all in cents:

- `selfEmploymentTax(netSEIncomeCents)` — 15.3% on 92.35% of net SE
  earnings, SS portion capped at the annual wage base
  (`SS_WAGE_BASE_CENTS_2026 = 17_700_000` placeholder). Medicare is
  uncapped; the 0.9% Medicare surtax on high earners is intentionally
  out of scope. Returns 0 for non-positive income.
- `federalIncomeTax(taxableIncomeCents, filingStatus)` — applies the
  2025-placeholder standard deduction for the chosen status, then
  bracketed marginal tax. Brackets live in a single `BRACKETS_2025`
  table covering all four `FilingStatus` values; update yearly. A
  legacy `estimatedFederalIncomeTax` shim still re-exports the same
  thing.
- `qbiDeduction(netSEIncomeCents, preQbiTaxableIncomeCents?)` — 20%
  of net SE income minus the employer-half of SE tax, optionally
  capped at 20% of pre-QBI taxable income. Simplification: no W-2
  wage limit, no SSTB phaseout. Documented in-source.
- `estimateAnnualTax({ netSEIncomeCents, filingStatus,
  otherIncomeCents?, estimatedDeductionsCents? })` →
  `{ seTax, federalIncomeTax, qbi, totalTax, effectiveRate }`. The
  headline number on the page.
- `quarterlyEstimate(annualTaxOwed, quarter)` — straight ÷ 4.
- `safeHarborTarget(priorYearTax, currentAGI)` — 100% of prior-year
  tax, or 110% if current AGI > $150,000.
- `quarterDueDate(year, quarter)` → `Date` for Apr 15 / Jun 15 /
  Sep 15 / Jan 15 (next year). UTC noon to dodge timezone slippage.

`packages/shared/src/tax.test.ts` covers all of the above with
`node --test`. Because the repo doesn't have `tsx`/`ts-node`, the
package's `test` script uses Node 22's
`--experimental-strip-types` flag and imports use explicit
`./tax.ts` extensions so strip-types can resolve them.

### 10.2 Tax page (`apps/web/src/routes/tax/+page.svelte`)

A top-level `/tax` page styled after `/reports` (max-w-6xl, rounded
cards, brand-800 mono numbers).

- **YTD aggregations** for the current year:
  - Billable revenue = sum of `duration * rate_cents_snapshot` for
    completed billable time entries.
  - Deductible total = all expenses + mileage (miles × snapshot rate).
  - Net SE income = revenue − deductions.
- **Filing settings row** at the top: filing status select +
  estimated other income input + Save button. Persists to
  `tax_settings` via `api.updateTaxSettings`.
- **Estimate card** showing SE tax, federal income tax, QBI,
  total tax, and effective rate from `estimateAnnualTax`.
- **Quarterly schedule table** with Q1 Apr 15, Q2 Jun 15,
  Q3 Sep 15, Q4 Jan 15 (next year). Each row shows the
  `quarterlyEstimate` payment; the next upcoming row is highlighted
  with a "Next up" pill and brand-50 background, past rows are
  muted.
- **Amber disclaimer banner** at the top: "Estimate only — not tax
  advice. Confirm with a CPA. Brackets reflect 2025 figures pending
  2026 update. State income tax is not included."

### 10.3 Sidebar nav

`AppShell` gains a `Tax` item between Reports and Settings with the
literal Tailwind class `icon-[ph--calculator-duotone]`.

### 10.4 Known approximations

- 2025 bracket and standard-deduction numbers are placeholders;
  swap in 2026 figures when the IRS publishes them.
- SS wage base of $177,000 is a forward-looking placeholder.
- QBI ignores W-2 limits and SSTB phaseouts.
- No state income tax — the `state` field on `tax_settings` is
  collected but not yet used in the math.
- Additional 0.9% Medicare surtax on high earners not modeled.

## Phase 11 — Menubar timer list + stop-bug fix

### 11.1 Stop-timer bug

Symptom: pressing **Stop** on a running timer did not always clear the
running banner. Root cause: the timer store cleared `running` only when
the PocketBase realtime subscription delivered an UPDATE event. If the
websocket lagged, reconnected, or the event was dropped, the local
state stayed pointed at the (now-stopped) entry forever.

Fix (`apps/web/src/lib/timer.svelte.ts`):

- `stop(entryId?)` now accepts an optional entry id (so callers can
  stop any specific row, not just `this.running`) and clears
  `this.running = null` **before** awaiting the network round trip.
- Tray title is force-refreshed synchronously after the optimistic
  clear so the menubar icon updates immediately.
- On a failed update the store calls `loadRunning()` to re-sync from
  the server and rethrows so the caller can show the error.
- `start()` also writes the created entry into `this.running`
  synchronously, with `expand: 'project,project.client,task'` so the
  active row has full context without waiting for the next realtime
  poll.

### 11.2 Menubar popover rework (`apps/web/src/routes/menubar/+page.svelte`)

- One unified list per day. The active timer is now just another row
  in the list (not a separate banner) and uses the same
  client / project / task layout as historic rows, with a
  `bg-brand-50` highlight and `text-brand-800` project name.
- An inline SVG clock replaces the project-color dot on the active
  row. The face (two concentric circles) stays still; only the two
  hand `<line>`s rotate (minute hand 3s, hour hand 36s — a calm beat,
  not a frantic one). Implemented with a scoped `clock-hand-spin`
  keyframe and `transform-origin: 12px 12px` on each hand so it
  pivots around the clock center.
- Each row has a circular play/pause toggle:
  - inactive rows → `ph--play-fill` on a bordered button; clicking
    starts a new timer on that row's project + task. Disabled while
    any other timer is running (avoids accidental swap).
  - active row → `ph--pause-fill` on a filled brand-500 button;
    clicking stops that specific entry via the new `timer.stop(id)`.
- The label "Stop" is gone from the popover — buttons are icon-only.
- Inline `Xh Ym` editor on every row. Editing minutes/hours commits on
  blur (or Enter; Escape cancels). For completed entries this adjusts
  `ended_at`; for the running entry it shifts `started_at` backwards
  so the elapsed clock matches the typed total.
- Day totals on the week strip tick in real time using `timer.now`.

### 11.3 Test cases (must pass when verifying the popover)

When changing anything in the menubar or timer store, exercise the
following flows in Chrome (loading `/menubar` against the
PB-served build):

1. **Quick start + stop.** Click a row's ▶︎; row gains highlight and
   pause icon. Click the ⏸︎; row reverts to a play icon and the active
   highlight goes away within ~1s.
2. **Stop persists.** After step 1, refresh the page. The row should
   show a play icon (no row highlighted) and the underlying entry has
   a non-empty `ended_at`.
3. **Edit minutes inline on a completed entry.** Triple-click the
   minutes input, type `15`, press Enter. The row redraws to `0h 15m`
   and the day total reflects the change. Refresh: value persists.
4. **Edit minutes on the *running* entry.** Same gesture: typing `15`
   shifts `started_at` 15 minutes into the past; row keeps ticking
   from there. Refresh: still running, still showing ≥15m.
5. **Long-run + refresh.** Start a timer, wait until the row shows
   `0h 01m` (~60s). Reload the page. The row should still be
   highlighted, still show `0h 01m` (or more), pause button intact.
6. **Switch projects.** Start row A → stop → start row B. Only one row
   highlighted at a time; the inactive row's play button re-enables
   as soon as B is stopped.
7. **Multiple historic rows.** With several rows on a day, the play
   button is enabled on all of them when nothing is running, and
   disabled on all *non-active* rows the moment a timer starts.
8. **Stop via `/time` page still works.** The /time page banner's
   Stop button uses the same `timer.stop()` path and must clear the
   banner without waiting for the realtime tick (regression guard
   for §11.1).

## Phase 12 — Full Chrome walkthrough + Tauri-safe confirm dialogs

### 12.1 In-app confirm dialog

`window.confirm()` is blocked in Tauri's WebView — the call returns
`undefined` so every `if (!confirm('Delete X?')) return` guard was
silently cancelling on the desktop build. The user's specific
report: "deleting a time entry doesn't work from the edit modal."

Fix: replace every `confirm()` callsite with `await confirmAction(...)`
from a tiny in-app modal store.

- `apps/web/src/lib/confirm.svelte.ts` — `ConfirmState` singleton with
  a `pending` rune and `ask()`/`resolve()` methods. Public API is
  `confirmAction(message | options)` returning `Promise<boolean>`.
- `apps/web/src/lib/components/ConfirmDialog.svelte` — renders the
  modal whenever `confirmStore.pending` is set. Cancel button,
  destructive (red) confirm button, click-outside cancels, `Esc`
  cancels, `Enter` confirms.
- Mounted once in `src/routes/+layout.svelte` next to
  `<IdleReturnModal />` so it surfaces on chromeless routes too
  (menubar, public invoice).

Migrated callsites:
- `lib/components/TimeEntryEditor.svelte` (delete time entry)
- `routes/settings/tasks/+page.svelte` (delete activity type)
- `routes/invoices/[id]/+page.svelte` (remove line, void invoice,
  delete payment)
- `routes/expenses/+page.svelte` (delete expense)
- `routes/expenses/recurring/+page.svelte` (delete recurring)
- `routes/expenses/mileage/+page.svelte` (delete mileage)

A grep for `confirm(` outside `confirm.svelte.ts` should return
zero hits — that's the regression guard.

### 12.2 Public invoice view shows Paid status

The `/i/[token]` page rendered "Total due" even for fully-paid
invoices because the public endpoint
(`pb_hooks/cron.pb.js` → `GET /api/timebill/public-invoice/:token`)
never queried the `payments` collection. Sum payments in the hook
and expose `paid_cents` + `balance_cents` on the response. The page
shows a PAID/Void/Overdue badge in the header and renders
`Total / Paid / Balance` rows in the summary panel when payments
exist. (Collection name is `payments` — not `invoice_payments`.)

### 12.3 `/settings` index redirect

The sidebar links to `/settings/workspace`, but typing `/settings`
directly used to land on the SvelteKit 404. Added a one-shot
redirect page at `routes/settings/+page.svelte` that calls
`goto('/settings/workspace', { replaceState: true })` on mount.

### 12.4 Chrome walkthrough — pages exercised

Walked every authenticated route plus public/login pages:
Dashboard, Time, Clients (+ New client create), Projects,
Expenses (+ delete confirm), Expenses/Mileage, Expenses/Recurring,
Invoices, Invoice detail (+ Void confirm), Reports, Tax,
Settings/Workspace, Settings/Activity types, Settings/Billing,
Settings/Email, Settings/Import, Menubar popover, Public invoice
(`/i/<token>`), Login. All render and the confirm dialog appears
on every Delete/Void action.

### 12.5 Known limitations not fixed in this phase

- The SPA can get visibly stuck on the 404 page if you client-side
  navigate away from it; a full page reload always recovers. Not
  reproducible reliably; rooted in SvelteKit's error boundary.
- Public invoice view doesn't render a list of recorded payments
  (intentional — keep client-visible page minimal). Only the
  totals row and the PAID badge surface payment state.

## Phase 13 — Menubar +New project picker + inline-edit fix

### 13.1 +New button project picker

The old `+New` would auto-start a timer on the last-used project, or
open the main app if a timer was already running. Two failure modes
fell out: (a) when a timer was running, clicking +New silently
"did nothing" from the popover's POV, and (b) the user had no way
to choose a *different* project before starting.

Replaced with an inline listbox popover that opens above the +New
button:

- Search input at the top filters by client OR project name as you
  type. Empty query shows everything.
- Projects are grouped by client (uppercase client label, then the
  projects under that client). Driven from
  `api.listProjects({ status: 'active' })`.
- The most-recently-used project is highlighted by default and
  marked with a small "last used" pill. Computed by querying
  `time_entries` sorted by `-started_at` for the workspace.
- Arrow Up/Down moves the highlight; Enter starts on the
  highlighted row; Esc or clicking outside closes the popover.
  A `fixed inset-0` invisible button serves as the click-shield.
- Clicking a row starts a timer immediately. If a timer is already
  running, the `time_entries` before-create hook auto-stops it —
  no special-case handling in the picker.
- The new timer reuses the most-recent `task` on that project when
  one exists, so a Resume-style click keeps its activity type.

### 13.2 Inline hours/minutes editor — preserve untouched field

Editing minutes alone silently reset hours to 0 (and vice versa)
because `setDraft()` fell back to `{ h: '0', m: '0' }` when no
draft existed yet. Fixed: seed the draft from the entry's current
displayed `{h, m}` the first time either input is touched.
Regression discovered while exercising the popover after building
the picker.

### 13.3 Test cases (extending §11.3)

9. **+New shows picker.** Click +New on the popover → an inline
   listbox appears above the button, anchored to the +New corner.
   The header is a search input and the body lists active projects
   grouped by client.
10. **Last-used pre-selected.** Open picker, observe the most
    recent project is highlighted and labeled "last used."
    Start a timer on a different project (e.g. Acme Corp);
    re-open the picker; the new project is now "last used."
11. **Search filter.** Type "bafs" → only the BAFS group remains;
    clear the query → full list returns.
12. **Keyboard nav.** Arrow keys move the highlight without
    losing the "last used" label on the unrelated row;
    Enter starts the highlighted project; Esc closes.
13. **Click outside closes** without starting anything.
14. **Start while running auto-stops.** Open picker with a running
    timer, click a different project → previous timer ends, new
    one starts; only one highlighted row remains.
15. **Edit minutes alone keeps hours.** Open a row showing
    `3h 15m`, triple-click the minutes input, type `30`, press
    Enter → row redraws to `3h 30m` (not `0h 30m`). Day total
    on the week strip moves accordingly. Symmetric: editing
    hours alone preserves minutes.

## Phase 14 — Mac-app polish on the menubar popover

Three small "this should feel like a native app" tweaks.

### 14.1 Tray "recording" indicator

A small solid red dot — ~half the diameter of an emoji, similar
to the macOS camera/mic activity indicator — appears alongside
the elapsed time whenever a timer is running. JS sends just the
elapsed string (`5m`, `1h 23m`); the Rust side handles the dot.

- `apps/desktop/src-tauri/src/lib.rs::make_recording_dot_icon`
  generates a 22×22 RGBA bitmap with a centered 9px filled
  circle (Apple `systemRed` = `#FF3B30`), with a one-pixel
  antialiased edge. Built at runtime as `Image::new_owned` — no
  asset file to ship.
- `set_tray_title` swaps the tray icon to this dot
  (`set_icon_as_template(false)` so macOS keeps the color) when
  the title is non-empty, and restores the default template icon
  when the title clears. The menu bar reads `[•] 5m`.

Non-animated by request. Web build's `pushTrayTitle` is still a
no-op outside the Tauri shell.

### 14.2 No text selection on labels

The popover should feel like an app, not a web page. Added
`user-select: none` (with `-webkit-user-select`) on `html`/`body`
in the `/menubar` route's `<style>`, then opted `input` and
`textarea` back in with `user-select: text`. Triple-click in the
minutes editor and typing in the picker's search box still work;
hovering over a row label no longer shows the I-beam cursor and
shift-clicking can't select text.

### 14.3 Pin the popover; only inner lists scroll

`html`/`body` now also carry `overflow: hidden`,
`overscroll-behavior: none`, `height: 100%`, and `margin: 0` so
the popover chrome is fixed and never rubber-bands. The two
inner scroll regions — the day's entries list and the picker's
project list — get the `menubar-scroll` class which sets
`overscroll-behavior: contain`, stopping wheel events from
propagating to the parent (or the OS) once you hit the top/bottom.

### 14.4 New test cases (extending §11.3)

16. **Tray badge.** Start any timer → the menu bar reads
    `[•] 0m` (small red dot then elapsed text), transitions to
    `[•] 1m` after a minute. Stop → dot disappears and the
    default template icon comes back. (Tauri build only; the
    web build's `pushTrayTitle` is a no-op.)
17. **No text selection on labels.** Hover the project name on
    any entry → cursor stays as the default arrow. Cmd-A on the
    popover doesn't blue-select the label text. The minutes
    input still accepts triple-click-to-replace, the picker
    search still accepts typing.
18. **No popover scroll / no overscroll bounce.** Wheel over the
    header band or the footer toolbar → nothing scrolls. Wheel
    over the entries list past the bottom → the list stops
    at the bottom with no rubber-band that exposes the desktop
    behind the popover.

## Phase 15 — Reports: GitHub-style year heatmap

The previous heatmap was a 6×7 monthly calendar grid where each cell
was `aspect-square` (~80–100 px wide on a desktop viewport), with
the day number and decimal-hours stamped inline. It dominated the
page and used the brand teal/cyan ramp which read oddly against
the rest of the dashboard.

Replaced with a GitHub-contributions-style year grid:

- 7 rows (Mon→Sun) × ~52 columns (one per week), 11 px cells with
  2 px gaps. Built off `yearEntries` (already loaded for CSV
  exports), so no extra query.
- Grid spans the Monday on/before Jan 1 through the Sunday on/after
  Dec 31; cells outside the selected year still render but at 30 %
  opacity so the grid stays a clean rectangle.
- Month abbreviations sit above the first column of each month;
  `Mon` / `Wed` / `Fri` labels sit in the left gutter.
- Color ramp is the familiar GitHub greens
  (`#ebedf0` empty → `#9be9a8` → `#40c463` → `#30a14e` → `#216e39`),
  picked from **fixed daily-hour thresholds** (0 / <2 / <4 / <6 / ≥6 h)
  so the same shade always means the same workload — not "as
  intense as the busiest day of the month."
- Hours are no longer printed inside the cell; each cell has a
  `title` attribute like `Thu, May 21, 2026 — 3:15 tracked` for
  native hover tooltips.
- The legend (`less ▢▢▢▢▢ more`) was updated to the new palette.

The "Active days" summary card still scopes to the selected month
via a derived `activeDaysInMonth` over the new heatmap data.
