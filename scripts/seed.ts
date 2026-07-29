/**
 * Fills an empty database with a few days of plausible shop activity so the
 * dashboard has something to show while you check it works.
 *
 * Run with:  npm run db:seed
 *
 * Safe to run only on an empty database; it refuses if categories already exist
 * so it can never overwrite Sarah's real books.
 */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { categories, items, sales, expenses, attendantLinks } from '../db/schema';
import { todayInKampala, addDays } from '../lib/dates';

async function main() {
  const [{ count }] = await db
    .select({ count: sql<string>`COUNT(*)` })
    .from(categories);

  if (Number(count) > 0) {
    console.error('Database already has categories. Seeding would mix test data into real books.');
    console.error('Clear the tables first if you really want sample data.');
    process.exit(1);
  }

  const today = todayInKampala();

  const cats = await db
    .insert(categories)
    .values([
      { name: 'Bedsheets' },
      { name: 'Blankets' },
      { name: 'Carpets' },
      { name: 'Curtains' },
    ])
    .returning();

  const byName = Object.fromEntries(cats.map((c) => [c.name, c.id]));

  const batches = await db
    .insert(items)
    .values([
      {
        categoryId: byName['Bedsheets'],
        specifics: 'Cotton king size, floral',
        costPrice: 42000,
        minPrice: 65000,
        quantity: 20,
        qtyRemaining: 20,
        purchaseDate: addDays(today, -12),
      },
      {
        categoryId: byName['Bedsheets'],
        specifics: 'Polyester double, plain white',
        costPrice: 28000,
        minPrice: 45000,
        quantity: 15,
        qtyRemaining: 15,
        purchaseDate: addDays(today, -12),
      },
      {
        categoryId: byName['Blankets'],
        specifics: 'Fleece heavy, grey',
        costPrice: 55000,
        minPrice: 85000,
        quantity: 12,
        qtyRemaining: 12,
        purchaseDate: addDays(today, -9),
      },
      {
        categoryId: byName['Carpets'],
        specifics: 'Persian style 5x8, red',
        costPrice: 180000,
        minPrice: 260000,
        quantity: 4,
        qtyRemaining: 4,
        purchaseDate: addDays(today, -6),
      },
      {
        categoryId: byName['Curtains'],
        specifics: 'Sheer cream, 3m drop',
        costPrice: 35000,
        minPrice: 58000,
        quantity: 18,
        qtyRemaining: 18,
        purchaseDate: addDays(today, -3),
      },
    ])
    .returning();

  const [mary] = await db
    .insert(attendantLinks)
    .values({ name: 'Nakato', token: randomBytes(32).toString('base64url') })
    .returning();

  // A handful of sales spread over the last week, one deliberately below the minimum.
  const madeSales = [
    { batch: 0, day: -5, qty: 2, price: 65000, attendant: null },
    { batch: 0, day: -4, qty: 1, price: 60000, attendant: mary.id },
    { batch: 1, day: -4, qty: 3, price: 45000, attendant: mary.id },
    { batch: 2, day: -3, qty: 1, price: 85000, attendant: null },
    { batch: 4, day: -2, qty: 2, price: 58000, attendant: mary.id },
    { batch: 3, day: -1, qty: 1, price: 250000, attendant: null },
    { batch: 0, day: 0, qty: 1, price: 65000, attendant: mary.id },
    { batch: 2, day: 0, qty: 2, price: 85000, attendant: null },
  ];

  for (const s of madeSales) {
    const batch = batches[s.batch];
    await db.insert(sales).values({
      itemId: batch.id,
      saleDate: addDays(today, s.day),
      quantity: s.qty,
      unitPrice: s.price,
      unitCost: batch.costPrice,
      belowMin: s.price < batch.minPrice,
      attendantId: s.attendant,
    });
    await db
      .update(items)
      .set({ qtyRemaining: sql`${items.qtyRemaining} - ${s.qty}` })
      .where(eq(items.id, batch.id));
  }

  await db.insert(expenses).values([
    {
      expenseDate: addDays(today, -12),
      description: 'Truck hire from Kikuubo',
      amount: 80000,
      kind: 'stock_transport',
    },
    {
      expenseDate: addDays(today, -6),
      description: 'Shop rent for the month',
      amount: 450000,
      kind: 'rent',
    },
    {
      expenseDate: addDays(today, -2),
      description: 'Boda to deliver carpet',
      amount: 15000,
      kind: 'transport',
      attendantId: mary.id,
    },
    { expenseDate: today, description: 'Airtime and data', amount: 20000, kind: 'utilities' },
  ]);

  console.log('Seeded 4 categories, 5 stock batches, 8 sales, 4 expenses.');
  console.log(`Attendant link for Nakato: /a/${mary.token}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
