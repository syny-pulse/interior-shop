import { Suspense } from 'react';
import { requireOwner } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { ExpensesPanel } from './ExpensesPanel';

export const metadata = { title: 'Expenses · Shop Books' };

export default async function ExpensesPage() {
  await requireOwner();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Expenses"
        description="Rent, transport, wages and anything else you spend money on."
      />

      {/* useSearchParams needs a Suspense boundary to keep the shell static. */}
      <Suspense fallback={<div className="surface h-40 animate-pulse" />}>
        <ExpensesPanel />
      </Suspense>
    </div>
  );
}
