# Les Cocotiers — Internal Manager

Internal tool for Les Cocotiers to manage properties, tenants, leases, payments, and expenses — with login, reporting/alerts, and a bilingual (English/French) interface. Amounts are shown in F CFA (XOF).

Stack: Next.js (App Router) + TypeScript + Prisma + SQLite + Tailwind CSS. No external services required — the database is a local file.

## Prerequisites

- [Node.js](https://nodejs.org/) 20 or later (includes npm)

Check what you have installed:

```bash
node -v
npm -v
```

## First-time setup

```bash
cd realestate-manager
npm install
npm run db:push
npm run db:seed   # adds two login users plus sample properties, tenants, leases, payments, and expenses
npm run dev
```

Then open [http://localhost:3000](http://localhost:3000) — you'll be redirected to sign in.

**Seeded logins** (change these before real use — see [Settings](#settings--profile)):

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@example.com` | `admin123` |
| Manager | `manager@example.com` | `manager123` |

Both roles currently see and can do everything (record properties/tenants/leases/payments/expenses, and view Reports and Alerts). The role label is there for future use if you later want to split permissions.

## What's included

- **Login** — email/password, session cookie, sign out. No self-signup screen; accounts are created via `prisma/seed.ts` or Prisma Studio (`npm run db:studio`) for now.
- **Settings / profile** (`/settings`) — change your name and email, change your password (current password required), and switch the app's language between English and French. The language choice is saved per-user and applies across the whole app immediately.
- **Properties** — name, category (apartment / villa / warehouse / office / land / commercial / other), address, city, dimension, bedrooms/bathrooms, price, status (vacant / occupied / maintenance), notes. Full create/edit/delete, plus a search box (name/address/city). Each property is a single leasable listing — no sub-unit subdivision.
- **Tenants** — first/last name, email, phone, company, ID number, address, city, notes, and full lease history. Full create/edit/delete, plus a search box (name/email/phone/company).
- **Leases** — links a tenant to a property for a date range, a rent amount, and a **billing frequency** (monthly / quarterly / semiannual / annual), plus a deposit; status (active / pending / ended / terminated). Full create/edit/delete, plus one-click status changes. Creating a lease marks the property occupied; ending/deleting one marks it vacant again.
- **Payments — rent obligations + flexible payments.** A lease's billing terms (rent × frequency) define what's owed; the app generates the rent schedule automatically — no manually creating a "due" row per month. Recording a payment is just entering an amount, date, method, and optional notes; the app allocates it to the oldest unpaid period first (FIFO), same as a real ledger. A tenant can pay a single month, several months at once, or more than what's currently due — the excess sits as an **advance credit** against future rent instead of showing as overdue. Every lease page shows the computed rent schedule (each period's due amount, what's been allocated, and its balance) alongside the raw payment log. Full edit/delete on individual payments for corrections.
- **Expenses** — recorded per property, with category (maintenance / utilities / repairs / insurance / taxes / management fee / other), amount, date, description, and who recorded it. Full create/edit/delete.
- **Reports** (`/reports`) — four real financial views in one page:
  - *This month*: revenue earned (accrual — prorated by billing frequency, not just cash in), expenses, net income, cash collected.
  - *Right now*: total unpaid (accounts receivable), total advance rent held, and an aging summary (0–30 / 90+ days overdue).
  - *Unpaid / accounts receivable* — one row per tenant with a balance, showing how much and since when.
  - *Cash received* — the raw payment log, and expenses broken down by category.
- **Alerts** (`/alerts`) — leases with an unpaid rent period past its due date (computed from the ledger, not a manually-set flag), and leases expiring within 30 days. A red count badge on the "Alerts" nav link shows at a glance whether anything needs attention.
- **Dashboard** — property count, occupied/vacant split, occupancy rate, monthly rent roll (billing-frequency-aware — a quarterly lease counts as 1/3 its rent per month), leases expiring within 60 days, and late payments (shown as the actual balance owed, not the full period amount).

## Settings & profile

Click your name in the top-right nav bar to open Settings. From there:

- **Profile** — update your display name and email.
- **Change password** — requires your current password plus a new one (minimum 8 characters).
- **Language** — English or French. Every page, button, status label, and date/currency format follows this choice. The login screen itself is always in English since the app doesn't know your language until you're signed in.

There's no self-service "forgot password" flow yet — an admin would need to reset it via Prisma Studio (`npm run db:studio`) by writing a new bcrypt hash.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the local dev server |
| `npm run build` / `npm run start` | Production build and run |
| `npm run db:push` | Apply the Prisma schema to the SQLite database |
| `npm run db:seed` | Load sample data (users, properties, tenants, leases, payments, expenses) |
| `npm run db:studio` | Open Prisma Studio to browse/edit data directly |

## Data model

Defined in [`prisma/schema.prisma`](prisma/schema.prisma): `Property → Lease ← Tenant`, with `Payment` records (just cash received: amount, date, method, notes) attached to each `Lease`, and `Expense` records attached to each `Property`. `User` accounts hold sessions, a language preference, and are linked to the payments/expenses they recorded.

**How the ledger works** ([`src/lib/ledger.ts`](src/lib/ledger.ts)): nothing about what's "due" is stored — it's computed from the lease's `startDate`, `endDate`, `rentAmount`, and `billingFrequency`. `computeLeaseLedger()` walks the billing periods that have come due, sums all payments on the lease, and allocates that total across the periods oldest-first. Whatever's left unallocated after the elapsed periods either shows as an unpaid balance (positive) or an advance credit (negative). This one function backs the lease page's rent schedule, the dashboard's late-payments widget, Reports' income statement and AR table, and Alerts — so there's a single source of truth for "who owes what."

## Translations

UI text lives in [`src/lib/i18n/en.ts`](src/lib/i18n/en.ts) and [`src/lib/i18n/fr.ts`](src/lib/i18n/fr.ts) as plain JS objects with the same shape. Every server page calls `requireUserWithDictionary()` to get the signed-in user's dictionary (`t`) and locale string, then reads labels from `t.<section>.<key>` instead of hardcoding text — so adding a third language later means adding one more file with the same keys.

## Notes on the current scope

This covers the core rental workflow (properties → tenants → leases → payments → expenses) plus login, reporting, in-app alerts, and bilingual UI, for a small team where everyone who signs in can see and do everything. Not yet included, in case you need them later: per-role permission restrictions (e.g. limiting managers from certain pages), self-service password reset, email/SMS notifications (alerts are in-app only today), file/document attachments (leases, IDs), maintenance request tracking, and multi-office permissions. Ask and these can be added incrementally.
