import { Suspense } from 'react';
import { requireOwner } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { SalesPanel } from './SalesPanel';

export const metadata = { title: 'Sales · Shop Books' };

export default async function SalesPage() {
  await requireOwner();

  return (
    <div className="space-y-6">
      <PageHeader title="Sales" description="Record a sale and review what has sold." />

      {/* useSearchParams needs a Suspense boundary to keep the shell static. */}
      <Suspense fallback={<div className="surface h-40 animate-pulse" />}>
        <SalesPanel />
      </Suspense>
    </div>
  );
}
