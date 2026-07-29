import { PendingList } from './PendingList';

export const metadata = { title: 'Not yet sent · Shop Books' };

export default function SyncPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Not yet sent</h1>
        <p className="mt-1 text-[0.9375rem] text-[var(--text-muted)]">
          Everything recorded on this phone that has not reached the books yet, and
          anything the server could not accept.
        </p>
      </div>

      <PendingList />
    </div>
  );
}
