# TimeBill

Unified time tracking, expenses, invoicing, and tax estimation for hourly contractors.

## Stack

- **Web client:** SvelteKit (static SPA), TypeScript, Tailwind
- **Desktop client:** Tauri (Mac, with menu bar timer)
- **Backend:** PocketBase (single Go binary — SQLite, auth, file storage, JS hooks). Also serves the web app from `pb_public/`.
- **Build tooling:** Node 20+ (Bun works too)

## Repo layout

```
TimeBill/
├── apps/
│   ├── web/          # SvelteKit app (shared client UI)
│   └── desktop/      # Tauri Mac shell
├── packages/
│   ├── shared/       # Zod schemas + pure logic (tax math, invoice math, money formatting)
│   └── ui/           # Reusable Svelte components
└── pocketbase/
    ├── pb_migrations/  # Collection definitions (version-controlled)
    ├── pb_hooks/       # Server-side JS hooks
    ├── pb_public/      # Web app static build (gitignored, populated by build:web:to-pb)
    └── pocketbase      # Binary (gitignored)
```

## Dev setup

```sh
# Install dependencies
npm install

# Terminal 1 — PocketBase (API + serves web app from pb_public/)
npm run dev:pb

# Terminal 2 — SvelteKit dev server (HMR)
npm run dev:web

# Or, for the Mac desktop app:
npm run dev:desktop
```

## Prod Deployment

```sh
git pull
cd deploy/
sudo docker compose up -d --build
```

PocketBase admin UI: <http://127.0.0.1:8090/_/>
Web app (via Vite/HMR): <http://127.0.0.1:5173>
Web app (served by PocketBase, after `build:web:to-pb`): <http://127.0.0.1:8090>

## Build phases

See `~/.claude/plans/let-s-plan-out-a-noble-sprout.md` for the full plan.

0. **Foundation** — monorepo, SvelteKit + Tauri scaffolds, PocketBase + auth, workspace auto-create *(current)*
1. **Time tracking** — clients/projects/tasks, live timer, menu bar timer
2. **Expenses** — expenses, receipts, mileage, recurring
3. **Invoicing** — draft/send/paid flow, PDF, public client link
4. **Payments** — partial payments, status derivation
5. **Tax & reporting** — Schedule C, quarterly estimate, dashboard, CSV exports
6. **Recurring invoices**


## Color Palette
https://coolors.co/004e64-00a5cf-9fffcb-25a18e-7ae582
