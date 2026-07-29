import { Pool, neonConfig } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-serverless';
import ws from 'ws';
import * as schema from './schema';

/**
 * We use Neon's WebSocket pool driver rather than the (faster) HTTP driver
 * because recordSale/deleteSale need *interactive* transactions: reading a
 * result mid-transaction and branching on it. The HTTP driver cannot do that.
 * At this shop's traffic the extra latency is irrelevant; losing a stock
 * decrement is not.
 */
neonConfig.webSocketConstructor = ws;

type Database = ReturnType<typeof drizzle<typeof schema>>;

// Module scope so warm serverless invocations reuse the pool.
const globalForDb = globalThis as unknown as { pool?: Pool; db?: Database };

function connect(): Database {
  if (globalForDb.db) return globalForDb.db;

  if (!process.env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Copy .env.example to .env.local and fill it in, ' +
        'or add Neon from the Vercel dashboard Storage tab.',
    );
  }

  const pool =
    globalForDb.pool ?? new Pool({ connectionString: process.env.DATABASE_URL });
  const instance = drizzle(pool, { schema });

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.pool = pool;
    globalForDb.db = instance;
  }

  return instance;
}

/**
 * Connects on first query rather than on import.
 *
 * `next build` loads every module to trace routes, so throwing at module scope
 * would make the build require a live DATABASE_URL. Deferring it keeps builds
 * env-free while still failing loudly, with a message that says what to do,
 * the first time a query actually runs without one.
 */
export const db = new Proxy({} as Database, {
  get(_target, property, receiver) {
    const real = connect();
    const value = Reflect.get(real, property, real);
    // Bind so drizzle's methods keep their own `this`, not the proxy.
    return typeof value === 'function' ? value.bind(real) : value;
  },
});

export { schema };
