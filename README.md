# Shop Books

Stock, sales and expenses for a beddings and clothings shop.

Two sides, one app:

- **Owner** signs in with a password. Creates categories, records what she bought on a
  shopping day, records sales and expenses, and sees a dashboard of sales, profit or
  loss, and stock value over any period.
- **Attendants** open a personal link. They see what is in stock and its proposed
  selling price, and can record sales and expenses. **Cost price and profit are never
  sent to this side.**

It is an installable app that **works with no connection**. Everything recorded offline
is sent on its own once there is a signal. See [Working offline](#working-offline).

---

## The three environment variables

Whichever way you run it, the app needs exactly these:

| Variable | What it is |
|---|---|
| `DATABASE_URL` | The Neon Postgres connection string |
| `OWNER_PASSWORD` | The password the owner types to sign in |
| `SESSION_SECRET` | A long random string used to sign session cookies |

Generate the session secret once and keep it. Changing it later signs everyone out,
including attendants holding a working link:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

---

## Deploying to Vercel

### 1. Put the code on GitHub

```bash
git init
git add .
git commit -m "Shop Books"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

### 2. Import the project

Go to [vercel.com/new](https://vercel.com/new), pick the repository, and click **Deploy**.

This first deployment will build successfully but the pages will error when opened, because
there is no database yet. That is expected. The next step fixes it.

### 3. Create the database

1. Open the project in the Vercel dashboard.
2. Go to the **Storage** tab.
3. Click **Create Database**.
4. Choose **Neon** (listed as Serverless Postgres, under the Marketplace providers).
5. Accept the provider terms and choose the **Free** plan.
6. Pick a **region**. Choose the one closest to the shop. For Uganda that is
   **Frankfurt (`eu-central-1`)**, with London (`eu-west-2`) as the next best. A distant
   region adds a delay to every page load.
7. Give the database a name, for example `shop-books`.
8. Click **Create**, then **Connect** it to the project when prompted, leaving all three
   environments (Production, Preview, Development) ticked.

Vercel now writes the connection details into the project's environment variables for you.

### 4. Check what the variable is actually called

This is the one step people skip and then get a build that cannot find the database.

Go to **Settings** then **Environment Variables** and look for `DATABASE_URL`.

- **If `DATABASE_URL` is there**, you are done with this step.
- **If instead you see `POSTGRES_URL` or `DATABASE_URL_UNPOOLED`**, the integration used
  different names. Copy the value of the **pooled** one, then add a new variable named
  `DATABASE_URL` with that value.

Use the **pooled** connection string, the one whose host contains `-pooler`. This app runs
on serverless functions that open a connection per request, and the pooler is what keeps
that from exhausting Neon's connection limit.

### 5. Add the two secrets

Still under **Settings** then **Environment Variables**, add:

| Name | Value |
|---|---|
| `OWNER_PASSWORD` | The password Sarah will type to sign in |
| `SESSION_SECRET` | The random string generated above |

Tick all three environments for each.

### 6. Create the tables

The database exists but is empty. Two ways to build the schema:

**Using the Neon SQL editor**, which needs nothing installed:

1. In Vercel, open the **Storage** tab and click through to the Neon dashboard.
2. Open the **SQL Editor**.
3. Paste the entire contents of [`drizzle/0000_init.sql`](drizzle/0000_init.sql) and run it.
4. Do the same with [`drizzle/0001_offline_sync.sql`](drizzle/0001_offline_sync.sql).

**Or from your machine**, which is easier to repeat later:

```bash
npm i -g vercel
vercel link            # connect this folder to the Vercel project
vercel env pull .env.local
npm install
npm run db:migrate
```

`vercel env pull` writes the real connection string into `.env.local`, so `db:migrate` acts
on the production database. `.env.local` is gitignored.

> **Use `db:migrate`, not `db:push`.** Push works by diffing the schema, so it creates
> columns and indexes but silently skips the triggers in `0001_offline_sync.sql`. Without
> them `updated_at` never changes, and without that, phones never learn that anything was
> edited — a failure with no error message attached to it.

> If a migration hangs or times out, swap `DATABASE_URL` in `.env.local` for the
> **unpooled** connection string, the one without `-pooler`. Schema changes want a direct
> connection. Leave the pooled one in Vercel for the app itself.

### 7. Redeploy

Environment variables are baked in at build time, so the deployment from step 2 still knows
nothing about them. Go to the **Deployments** tab, open the most recent one, and choose
**Redeploy**.

Open the site, sign in with `OWNER_PASSWORD`, and you should land on the dashboard.

### 8. First real setup

1. Go to **Categories** and add the ones the shop uses: carpets, curtains, bedsheets,
   blankets.
2. Go to **Stock** and record a batch from the last shopping trip.
3. Go to **Attendants**, create a link per attendant, and send each person their own.

---

## Running locally

```bash
cp .env.example .env.local
```

Fill in the three variables. For `DATABASE_URL`, either run `vercel env pull .env.local` to
reuse the deployed database, or create a separate free one at
[neon.tech](https://neon.tech) so development data stays out of the real books.

```bash
npm install
npm run db:migrate
npm run dev
```

Open <http://localhost:3000> and sign in with `OWNER_PASSWORD`.

To load a week of sample activity so the dashboard has something to show:

```bash
npm run db:seed
```

It refuses to run if the database already has categories, so it cannot overwrite real
books. It prints an attendant link at the end that you can open to check the attendant
side.

---

## Working offline

The shop's connection drops. That is not an edge case here, it is most afternoons, so
the app is built to keep working through it rather than to apologise.

### What actually happens

**The phone holds its own copy of the books.** An IndexedDB mirror of the five tables,
refreshed from the server whenever there is a signal. Every screen renders from that copy,
never from a live query, so a page opens just as fast with no bars as with four.

**Everything you record goes into an outbox first.** Online or not, no exceptions — there
is no faster path that skips the queue, because a connection that looks fine in a Kampala
shop is a connection that has not been tested yet. One code path means one behaviour to
reason about. When there is a signal, the entry leaves within a second and you never
notice the queue existed.

**Stock counts subtract what is still waiting.** Sell the last blanket with no connection
and the stock list immediately says zero, not one. Without that subtraction an attendant
would be invited to sell it twice.

**The badge in the header is the whole status UI.** "Offline · 3 waiting" while there is
no signal, "Saved" once everything has landed. Tap `3 to fix` if the server refused
something.

### When two people sell the same last blanket

An attendant records a sale offline. Meanwhile someone else sells the last of that batch.
When the phone reconnects, the server refuses the queued sale — the atomic
`WHERE qty_remaining >= n` guard has not been relaxed for offline entries.

The refused entry is **never dropped**. It lands on the **Not yet sent** screen (`/sync`)
with what was recorded, why it was refused, and how many units are actually left, offering:

- **Change to N and send** — the usual repair. Two were sold, one was left; record the one.
- **Try again as recorded** — for when stock has since been restocked.
- **Discard** — behind a confirm, because that queued entry is very possibly the only
  record that the sale happened at all. The goods left the shop; losing the entry loses
  the money from the books.

Refused entries are excluded from every total until someone resolves them, so a rejected
sale never quietly counts towards a figure the owner might act on.

### What does not work offline

**Signing in.** An expired session needs the server. A session that is still valid keeps
working offline for its full 30 days.

**Managing attendant links.** The token is a credential the server mints, and a revocation
the server has not heard about is not a revocation — an offline "revoke" would show a
reassuring tick while the link carried on working. The screen says so instead.

### Things worth knowing

**iPhones sync when the app is opened, not in the background.** Background Sync is a
Chrome and Samsung Internet feature; iOS Safari has none. On Android a sale recorded in
aeroplane mode is delivered without anyone reopening the app. On an iPhone it waits until
the app is next opened. Worth knowing before promising an attendant otherwise.

**Signing out wipes the local copy.** Otherwise every sale and cost price would sit in
IndexedDB for whoever picks up the phone next, which on a shared shop phone is the entire
threat model. It refuses to leave quietly if anything is still unsent.

**A revoked link clears the phone on its next sync.** The device keeps working until it
reaches the server, at which point the 401 wipes the mirror and the outbox. That is the
only mechanism that ever removes the shop's figures from a device whose access has been
withdrawn.

**The cost-price boundary extends to the device.** An attendant's copy is built from the
attendant branch of `getDelta()` and contains no cost price and no unit cost. This matters
more than it did for the RSC payload: that lived as long as the tab, whereas IndexedDB
survives on the phone. `npm run test:logic` covers the arithmetic; the payload itself is
worth re-checking by hand whenever `getDelta()` changes.

---

## How it is built

```
Next.js 15 App Router
  Server Components guard routes and render the shell
  IndexedDB mirror  ->  every screen renders from the device's own copy
  outbox  ->  POST /api/sync  ->  lib/mutations.ts  ->  Neon Postgres
  Tailwind v4 for styling
  Drizzle ORM  ->  Neon Postgres
```

```
  UI  ──reads──▶  IndexedDB mirror  ◀──delta──┐
   │                                          │
   └──writes──▶  outbox  ──ops──▶  POST /api/sync  ──▶  lib/mutations.ts  ──▶  Postgres
```

One endpoint does both directions in a single round trip: push the outbox, then pull what
changed. In that order deliberately, so the delta coming back already contains the
caller's own writes and a phone that has just synced never shows a moment where the sale
it recorded has vanished.

| File | What it is |
|---|---|
| `lib/mutations.ts` | Every write in the app. The only caller is `/api/sync`. |
| `lib/offline/sync.ts` | The engine: single-flight, backoff, and every trigger to retry. |
| `lib/offline/mirror.ts` | The local copy, and the projection that lays the outbox over it. |
| `lib/offline/aggregates.ts` | The dashboard maths, in TypeScript, for offline. |
| `public/sw.js` | Caching rules and the background drain. Hand-written, ~250 lines. |

Auth is two signed cookies and no users table. The owner's cookie comes from the
password; an attendant's comes from exchanging their link token once at `/a/<token>`.

### Things that are the way they are on purpose

**Money is stored as integer shillings.** UGX has no subunit in practice, so integers
avoid floating-point drift entirely. It becomes a string exactly once, in
`lib/format.ts`.

**`sales.unit_cost` is a snapshot, not a join.** The cost is copied onto the sale row at
the moment of sale. If a typo in a batch's cost price is corrected later, last month's
profit does not silently change.

**"Today" is always computed in Africa/Kampala.** The server runs in UTC and Kampala is
UTC+3, so a naive `toISOString()` files sales made before 03:00 under the previous day.
Everything goes through `todayInKampala()` in `lib/dates.ts`.

**The cost-price boundary lives in the SQL, not the templates.** Functions in
`lib/queries.ts` marked `ATTENDANT-SAFE` never put `costPrice`, `unitCost` or a profit
expression into a select list. A template that merely declines to render a field would
still ship it in the RSC payload, where it is readable from devtools. If you add a field
to one of those functions, re-check that rule.

**Every Server Action calls `requireOwner()` or `requireUser()` first.** Layout guards
protect pages, not actions. A Server Action is a POST endpoint that any signed-in client
can invoke directly, so hiding a button is not access control.

**Stock value is point-in-time.** It answers "what am I holding right now", so it
deliberately ignores the dashboard's date range and is labelled "as of today".

**Selling below the minimum warns but never blocks.** Haggling is normal in this trade.
The sale is flagged instead, and flagged sales are called out on the dashboard.

**Recording a sale is one atomic conditional UPDATE.** `WHERE qty_remaining >= n` is what
stops two attendants selling the same last blanket at once; a read-then-write would let
both through. It applies identically to a sale that arrives three hours late from a queue.

**There are no Server Actions left, apart from signing in and attendant links.** A Server
Action cannot be replayed: its POST body is an encoded RSC payload keyed by a
build-specific action id, so a sale recorded during an outage could not be stored on the
phone and re-sent later. The logic moved intact to `lib/mutations.ts` behind `/api/sync`,
which takes plain JSON a device can keep in a queue. The guards moved with it — every op
re-checks its role there, because a queued op is editable JSON on a device the shop does
not control.

**Every mutation carries a client-generated UUID.** A flaky connection means retries, and
a connection that drops after the write but before the response would otherwise record the
sale twice and decrement stock twice. The unique index on `client_id` is what makes a
retry boring. It also lets a sale recorded offline reference a batch created offline: the
sale names the batch's `client_id` and the server resolves it when they arrive together.

**`updated_at` is set by a Postgres trigger, not by the mutation code.** A column every
writer has to remember to set is a column that is eventually wrong, and this one decides
whether a phone ever learns about an edit. One missed assignment in one code path and a
device silently shows stale stock forever.

**Deletion is soft on every table a device mirrors.** A hard `DELETE` is invisible to an
incremental sync — the row simply stops being returned, which a device cannot tell apart
from "not changed" — so it would keep showing the deleted sale forever. Every query
reading `categories`, `sales` or `expenses` filters `deleted_at IS NULL`. The audit trail
is a side benefit a book of accounts should arguably have had anyway.

**The dashboard maths exists twice.** SQL in `lib/queries.ts` for the server, TypeScript in
`lib/offline/aggregates.ts` for the device. That is the price of a dashboard that works
offline and counts sales still in the outbox. `npm run test:logic` runs a fixture through
the TypeScript and asserts every figure, with the SQL expression quoted above each check,
so changing one and not the other fails loudly rather than producing two sets of books.

**A sale keeps the date it was recorded on, not the date it was sent.** A sale made at
23:50 and synced at 00:10 belongs to the earlier day; moving it would quietly falsify two
days' takings. The device also sends when it happened, which the server writes into
`created_at` after clamping it — a phone with a wrong clock must not be able to file a sale
in the future, or bury it in the past.

---

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Run locally |
| `npm run build` | Production build |
| `npm run typecheck` | Types only |
| `npm run test:logic` | Date, money and offline regression checks, no database needed |
| `npm run db:migrate` | Apply the SQL migrations, triggers included |
| `npm run icons` | Regenerate the app icons in `public/icons/` |
| `npm run db:seed` | Load sample data into an empty database |
| `npm run db:studio` | Browse the data in a GUI |
