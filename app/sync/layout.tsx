import Link from 'next/link';
import { ArrowLeftIcon } from '@phosphor-icons/react/dist/ssr';
import { requireUser } from '@/lib/auth';
import { SyncProvider } from '@/components/offline/SyncProvider';

/**
 * Deliberately outside both route groups: the owner and every attendant reach
 * the same screen, because "what has this phone not managed to send" is the
 * same question whoever is holding it.
 *
 * It carries its own SyncProvider for that reason — it cannot inherit one from
 * a layout it does not sit under.
 */
export default async function SyncLayout({ children }: { children: React.ReactNode }) {
  const session = await requireUser();
  const identity = session.role === 'owner' ? 'owner' : `attendant:${session.linkId}`;
  const home = session.role === 'owner' ? '/dashboard' : '/shop';

  return (
    <SyncProvider identity={identity}>
      <div className="min-h-[100dvh]">
        <header
          className="sticky top-0 z-20 border-b backdrop-blur"
          style={{ background: 'color-mix(in srgb, var(--bg) 88%, transparent)' }}
        >
          <div className="mx-auto flex h-14 max-w-3xl items-center gap-3 px-4">
            <Link href={home} className="btn btn-ghost px-2 py-1.5">
              <ArrowLeftIcon size={16} />
              <span className="sr-only sm:not-sr-only">Back</span>
            </Link>
            <span className="text-[0.9375rem] font-semibold tracking-tight">
              Not yet sent
            </span>
          </div>
        </header>

        <main className="mx-auto max-w-3xl px-4 py-6 pb-16">{children}</main>
      </div>
    </SyncProvider>
  );
}
