/**
 * Applies the SQL migration files in drizzle/, in order.
 *
 *   npm run db:migrate
 *
 * This exists because `db:push` is not sufficient any more. Push reconciles
 * columns and indexes by diffing the schema, which means it silently ignores
 * the triggers in 0001_offline_sync.sql — and updated_at without its trigger is
 * the worst kind of broken: nothing errors, the column just stops changing, and
 * devices quietly never learn that anything was edited.
 *
 * Statements are split on Drizzle's `--> statement-breakpoint` marker rather
 * than on semicolons, because a PL/pgSQL function body is full of semicolons
 * and splitting on them would tear it in half.
 *
 * Safe to re-run: "already exists" and "does not exist" are reported and
 * skipped, so applying a migration twice is boring rather than fatal.
 */
import 'dotenv/config';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, neonConfig } from '@neondatabase/serverless';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');

function statementsIn(file: string): string[] {
  return readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    // Drop chunks that are only comments — the files are heavily annotated.
    .filter((s) => s.length > 0 && s.split('\n').some((l) => l.trim() && !l.trim().startsWith('--')));
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env.local and fill it in.');
    process.exit(1);
  }

  const only = process.argv[2];
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !only || f.includes(only))
    .sort();

  if (files.length === 0) {
    console.error(only ? `No migration matching "${only}".` : 'No .sql files in drizzle/.');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  let applied = 0;
  let skipped = 0;

  try {
    for (const file of files) {
      const statements = statementsIn(file);
      console.log(`\n${file}  (${statements.length} statements)`);

      for (const statement of statements) {
        const label =
          statement
            .split('\n')
            .map((l) => l.trim())
            .find((l) => l && !l.startsWith('--'))
            ?.slice(0, 76) ?? '(statement)';

        try {
          await client.query(statement);
          applied++;
          console.log(`  ok    ${label}`);
        } catch (error) {
          const message = (error as { message?: string }).message ?? String(error);
          if (/already exists|does not exist/i.test(message)) {
            skipped++;
            console.log(`  skip  ${label}`);
          } else {
            console.error(`  FAIL  ${label}`);
            console.error(`        ${message.split('\n')[0]}`);
            process.exitCode = 1;
            return;
          }
        }
      }
    }

    console.log(`\n${applied} applied, ${skipped} already in place.`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
