import { Suspense } from 'react';
import { requireAttendant } from '@/lib/auth';
import { SummaryPanel } from './SummaryPanel';

export const metadata = { title: 'Summary · Shop Books' };

export default async function AttendantSummaryPage() {
  const session = await requireAttendant();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Summary</h1>
      </div>

      {/* useSearchParams needs a Suspense boundary to keep the shell static. */}
      <Suspense fallback={<div className="surface h-40 animate-pulse" />}>
        <SummaryPanel attendantName={session.name} />
      </Suspense>
    </div>
  );
}
