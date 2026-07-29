-- Offline sync support.
--
-- The column and index statements below were produced by `drizzle-kit generate`
-- and match drizzle/meta/0001_snapshot.json. The TRIGGER block at the end was
-- added by hand: Drizzle Kit cannot express triggers, and updated_at is useless
-- without them.
--
-- APPLY THIS FILE, not `npm run db:push`. db:push reconciles columns and
-- indexes only, so it would leave updated_at frozen at insert time — which
-- fails silently, in the worst possible way: devices simply never learn that
-- anything changed.
--
-- Three things are being added, and each is load-bearing:
--
--   client_id   A UUID minted on the device before the row reaches this
--               database, with a unique index. Retries become idempotent (a
--               connection that drops after the write but before the response
--               would otherwise record the sale twice and decrement stock
--               twice), and a sale recorded offline can reference an item that
--               was also created offline. Postgres allows any number of NULLs
--               in a unique index, so existing rows need no backfill.
--
--   updated_at  What every sync scans: `WHERE updated_at > $cursor`.
--
--   deleted_at  Deletion becomes soft. A hard DELETE is invisible to an
--               incremental pull — the row just stops being returned, which a
--               device cannot tell apart from "unchanged", so it would keep the
--               deleted row for ever. Every query reading categories, sales or
--               expenses must now filter deleted_at IS NULL; see lib/queries.ts.

DROP INDEX "categories_name_unique";--> statement-breakpoint
ALTER TABLE "attendant_links" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "client_id" text;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "sales" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "attendant_links_updated_at_idx" ON "attendant_links" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_client_id_unique" ON "categories" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "categories_updated_at_idx" ON "categories" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_client_id_unique" ON "expenses" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "expenses_updated_at_idx" ON "expenses" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "items_client_id_unique" ON "items" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "items_updated_at_idx" ON "items" USING btree ("updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sales_client_id_unique" ON "sales" USING btree ("client_id");--> statement-breakpoint
CREATE INDEX "sales_updated_at_idx" ON "sales" USING btree ("updated_at");--> statement-breakpoint
-- Partial on purpose. The old plain unique index would keep a deleted
-- category's name reserved for ever, so "curtains" could never be re-created
-- after a mistaken delete.
CREATE UNIQUE INDEX "categories_name_unique" ON "categories" USING btree ("name") WHERE deleted_at IS NULL;--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- HAND-WRITTEN FROM HERE. Not represented in the Drizzle snapshot.
--
-- updated_at is maintained by the database, deliberately not by the mutation
-- code. A column that every writer has to remember to set is a column that is
-- eventually wrong, and this one decides whether a phone ever learns about an
-- edit. One missed assignment in one code path and a device silently keeps
-- stale stock for ever.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint

DROP TRIGGER IF EXISTS categories_touch_updated_at ON "categories";--> statement-breakpoint
CREATE TRIGGER categories_touch_updated_at BEFORE UPDATE ON "categories"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS items_touch_updated_at ON "items";--> statement-breakpoint
CREATE TRIGGER items_touch_updated_at BEFORE UPDATE ON "items"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS sales_touch_updated_at ON "sales";--> statement-breakpoint
CREATE TRIGGER sales_touch_updated_at BEFORE UPDATE ON "sales"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS expenses_touch_updated_at ON "expenses";--> statement-breakpoint
CREATE TRIGGER expenses_touch_updated_at BEFORE UPDATE ON "expenses"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();--> statement-breakpoint

DROP TRIGGER IF EXISTS attendant_links_touch_updated_at ON "attendant_links";--> statement-breakpoint
CREATE TRIGGER attendant_links_touch_updated_at BEFORE UPDATE ON "attendant_links"
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
