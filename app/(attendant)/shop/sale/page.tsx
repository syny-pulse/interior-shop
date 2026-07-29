import { requireAttendant } from '@/lib/auth';
import { SalePanel } from '@/components/forms/SalePanel';

export const metadata = { title: 'Record a sale · Shop Books' };

export default async function AttendantSalePage() {
  await requireAttendant();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Record a sale</h1>
        <p className="mt-1 text-[0.9375rem] text-[var(--text-muted)]">
          Selling below the minimum is allowed. It is recorded so the owner can see it.
        </p>
      </div>

      <div className="surface p-5">
        {/* Reads the same projected stock the owner's sale form does. */}
        <SalePanel />
      </div>
    </div>
  );
}
