import { CloudSlashIcon } from '@phosphor-icons/react/dist/ssr';

export const metadata = { title: 'No connection · Shop Books' };

/**
 * The service worker's last resort: shown only when a page is asked for that
 * has never been opened on this device, while offline.
 *
 * It touches no database and reads no session, because by definition neither
 * is reachable when this renders. Everything here is static.
 */
export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-[100dvh] max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <div
        className="flex size-12 items-center justify-center rounded-full"
        style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
      >
        <CloudSlashIcon size={22} weight="duotone" />
      </div>

      <h1 className="text-[1.5rem] font-semibold tracking-tight">No connection</h1>

      <p className="text-[0.9375rem] text-[var(--text-muted)]">
        This page has not been opened on this phone yet, so there is nothing saved to
        show. Pages you have already visited still work without a connection.
      </p>

      <p className="text-[0.875rem] text-[var(--text-muted)]">
        Anything you recorded while offline is safe. It will be sent on its own as soon
        as there is a signal.
      </p>

      <a href="/" className="btn btn-primary mt-2">
        Try again
      </a>
    </div>
  );
}
