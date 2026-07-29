import { Suspense } from 'react';
import { requireOwner } from '@/lib/auth';
import { DashboardPanel } from './DashboardPanel';

export const metadata = { title: 'Dashboard · Shop Books' };

export default async function DashboardPage() {
  await requireOwner();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Dashboard</h1>
      </div>

      {/* useSearchParams needs a Suspense boundary to keep the shell static. */}
      <Suspense fallback={<div className="surface h-64 animate-pulse" />}>
        <DashboardPanel />
      </Suspense>
    </div>
  );
}
