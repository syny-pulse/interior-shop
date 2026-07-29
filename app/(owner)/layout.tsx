import Link from 'next/link';
import { requireOwner } from '@/lib/auth';
import { AppNav } from '@/components/AppNav';
import { SyncProvider } from '@/components/offline/SyncProvider';
import { SyncStatusBadge } from '@/components/offline/SyncStatusBadge';
import { SignOutButton } from '@/components/offline/SignOutButton';

export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  /*
   * Guards the pages. Every write guards itself again inside lib/mutations.ts,
   * because a queued op is JSON on a device the shop does not control and this
   * layout never runs for it.
   *
   * Offline this does not run at all — the service worker replays a cached
   * document. That is correct rather than a hole: no data leaves the server
   * without it, and the mirror is wiped the moment a sync comes back 401.
   */
  await requireOwner();

  return (
    <SyncProvider identity="owner">
      <div className="min-h-[100dvh]">
        <header
          className="sticky top-0 z-20 border-b backdrop-blur"
          style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}
        >
          <div className="mx-auto max-w-6xl px-4">
            <div className="flex h-14 items-center justify-between gap-4">
              <Link href="/dashboard" className="flex items-baseline gap-2">
                <span className="text-[0.9375rem] font-semibold tracking-tight">
                  Shop Books
                </span>
                <span className="text-[0.75rem] text-[var(--text-faint)]">Owner</span>
              </Link>

              <div className="flex items-center gap-3">
                <SyncStatusBadge />
                <SignOutButton />
              </div>
            </div>
            <div className="pb-2">
              <AppNav variant="owner" />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-6xl px-4 py-6 pb-16">{children}</main>
      </div>
    </SyncProvider>
  );
}
