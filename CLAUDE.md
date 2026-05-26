# TimeBill — working agreements with Claude

Anything in this file is a standing instruction that applies to every turn.
Newer entries are appended.

## Always

1. **Update the spec when you add features.** When a new feature, decision, or
   constraint is introduced, append it to the plan file at
   `~/.claude/plans/let-s-plan-out-a-noble-sprout.md` before (or alongside)
   implementing it. The plan is the canonical record — don't let it drift.

2. **Test new behavior in Chrome before signing off.** Use the Chrome MCP
   tooling to load the relevant page, exercise the new flow end-to-end, and
   verify it works visually. Don't claim a feature is done from typecheck +
   curl alone if there's UI involved.

3. **Commit after each milestone.** When a cohesive group of changes is
   verified working (one feature, one bug fix, one refactor — *not* "all of
   today's work"), make a git commit with a short, focused message. The
   commit history should read like a changelog. Don't pile multiple
   features into one commit. Commit only files relevant to the milestone;
   never `git add -A`.

4. **Mirror the spec to `plan.md` in the repo.** Whenever you touch
   `~/.claude/plans/let-s-plan-out-a-noble-sprout.md`, copy the same
   content into the repo's `plan.md`. The two files should always agree.

## Project facts

- **Stack:** SvelteKit (static SPA) · Tauri (Mac) · PocketBase (single Go
  binary serving API + the SPA from `pb_public/`).
- **Build + deploy locally:** `npm run build:web:to-pb` rebuilds the web app
  and copies it into `pocketbase/pb_public/`. PocketBase serves it at
  `http://127.0.0.1:8090/`.
- **Test login:** `test@example.com` / `password123`.
- **Palette:** brand-50…900 maps to the user's color list
  (`#004e64`, `#00a5cf`, `#9fffcb`, `#25a18e`, `#7ae582`).
  `bg-brand-800` is the deep teal primary; `bg-brand-500` is cyan.
- **Icons:** Iconify Phosphor Duotone via Tailwind v4. Class form:
  `icon-[ph--house-duotone]`. **Tailwind only scans literal class strings** —
  if you put an icon name in a variable, write the full
  `icon-[ph--name-duotone]` class verbatim in the source where Tailwind can
  find it.
- **Money lives in cents.** `formatUSD(cents)` / `parseUSDInput(str)` /
  `centsToDollars(cents)` from `@timebill/shared/money`.
- **Dates in PocketBase filters** must use a SPACE between date and time, not
  the ISO `T` — use the `toPbDate(d)` helper in `$lib/pb`. (PB compares
  date columns as strings lexicographically.)

## PocketBase hook gotchas

- **Each hook callback runs in its own isolated Goja context.** Top-level
  helper functions in the same file are NOT in scope inside hook callbacks.
  Inline the helper or duplicate it.
- **Goja doesn't support numeric separators** (`5_000_000`). Use plain
  digits.
- **PB stores unset date fields as `""`, not `null`.** Filter with
  `field = ""`, not `field = null`.
- **`required: true` on a number field treats `0` as missing.** If an entity
  starts at zero (like an empty draft invoice's totals), mark the field
  non-required and validate in app code.

## Where things live

- `apps/web/src/routes/` — SvelteKit pages
- `apps/web/src/lib/` — shared client code: `pb.ts`, `api.ts`, stores
  (`auth.svelte.ts`, `workspace.svelte.ts`, `timer.svelte.ts`), `pdf.ts`
- `apps/web/src/lib/components/` — Svelte components (`AppShell`,
  `DayGantt`, `TimeEntryEditor`)
- `packages/shared/src/` — pure logic (money, schemas, tax skeleton, invoice
  math)
- `pocketbase/pb_migrations/` — schema migrations (JS)
- `pocketbase/pb_hooks/` — server-side hooks
