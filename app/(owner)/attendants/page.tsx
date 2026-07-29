import { headers } from 'next/headers';
import { UsersThreeIcon } from '@phosphor-icons/react/dist/ssr';
import { requireOwner } from '@/lib/auth';
import { getAttendantLinks } from '@/lib/queries';
import { createLink } from '@/app/actions/attendants';
import { toNumber, formatNumber, pluralise } from '@/lib/format';
import { PageHeader } from '@/components/ui/PageHeader';
import { InlineForm } from '@/components/forms/InlineForm';
import { OnlineOnly } from '@/components/offline/OnlineOnly';
import { AttendantRow } from './AttendantRow';

export const metadata = { title: 'Attendants · Shop Books' };

/**
 * Builds the shareable link from the request itself, so it is correct on
 * localhost, on a Vercel preview, and on the real domain without any
 * environment variable to keep in sync.
 */
async function baseUrl(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') ?? h.get('host') ?? 'localhost:3000';
  const proto = h.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${proto}://${host}`;
}

export default async function AttendantsPage() {
  await requireOwner();

  const [links, origin] = await Promise.all([getAttendantLinks(), baseUrl()]);

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Attendants"
        description="Give each attendant their own link. They can see stock and record sales, but never your cost prices or profit."
      />

      {/*
        The only screen in the app that needs the network. Tokens are minted
        server-side and a revocation that the server has not heard about is not
        a revocation — see app/actions/attendants.ts.
      */}
      <OnlineOnly what="Managing attendants">
      <div className="surface mb-5 p-5">
        <InlineForm
          action={createLink}
          label="Attendant name"
          name="name"
          placeholder="Nakato"
          submitLabel="Create link"
          hint="Anyone with the link can record sales, so send it to one person only."
        />
      </div>

      {links.length === 0 ? (
        <div className="surface flex flex-col items-center gap-3 px-6 py-12 text-center">
          <div
            className="flex size-11 items-center justify-center rounded-full"
            style={{ background: 'var(--accent-soft)', color: 'var(--accent-text)' }}
          >
            <UsersThreeIcon size={20} weight="duotone" />
          </div>
          <div className="space-y-1">
            <p className="font-medium">No attendant links yet</p>
            <p className="mx-auto max-w-[38ch] text-[0.875rem] text-[var(--text-muted)]">
              Create one above, then send it to your attendant on WhatsApp. They just
              open it, with no password to remember.
            </p>
          </div>
        </div>
      ) : (
        <ul className="space-y-3">
          {links.map((link) => (
            <li key={link.id}>
              <AttendantRow
                id={link.id}
                name={link.name}
                url={`${origin}/a/${link.token}`}
                active={link.active}
                lastUsedAt={link.lastUsedAt ? link.lastUsedAt.toISOString() : null}
                salesLabel={`${formatNumber(toNumber(link.salesCount))} ${pluralise(toNumber(link.salesCount), 'sale')} recorded`}
              />
            </li>
          ))}
        </ul>
      )}
      </OnlineOnly>
    </div>
  );
}
