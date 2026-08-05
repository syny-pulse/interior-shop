import { requireAttendant } from '@/lib/auth';
import { StockList } from './StockList';

export const metadata = { title: 'Stock · Shop Books' };

/**
 * The guard stays server-side; the data does not.
 *
 * Everything below the heading renders from the device's own copy, so this
 * page works with no connection — which is the normal case on a shop floor. It
 * therefore fetches nothing here: a query would only produce numbers that the
 * client immediately replaces, and would make the page fail when it is needed
 * most.
 */
export default async function ShopStockPage() {
  await requireAttendant();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">What is in stock</h1>
        <p className="mt-1 text-[0.9375rem] text-[var(--text-muted)]">
          Search for anything a customer asks for. The price shown is the lowest you should
          sell for.
        </p>
      </div>

      <StockList />
    </div>
  );
}
