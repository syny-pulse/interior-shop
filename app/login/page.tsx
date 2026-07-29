import { redirect } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { LoginForm } from './LoginForm';
import { Alert } from '@/components/ui/Alert';

export const metadata = { title: 'Sign in · Shop Books' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ revoked?: string }>;
}) {
  const session = await getSession();
  if (session?.role === 'owner') redirect('/dashboard');
  if (session?.role === 'attendant') redirect('/shop');

  const { revoked } = await searchParams;

  return (
    <main className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-5 py-12">
      <div className="mb-8">
        <p
          className="text-[0.8125rem] font-medium tracking-wide"
          style={{ color: 'var(--accent-text)' }}
        >
          Shop Books
        </p>
        <h1 className="mt-1 text-[1.75rem] font-semibold tracking-tight">
          Sign in to your shop
        </h1>
        <p className="mt-2 text-[0.9375rem] text-[var(--text-muted)]">
          Stock, sales and expenses in one place.
        </p>
      </div>

      {revoked && (
        <div className="mb-4">
          <Alert tone="warn">
            Your access link is no longer active. Ask the shop owner for a new one.
          </Alert>
        </div>
      )}

      <div className="surface p-5">
        <LoginForm />
      </div>

      <p className="mt-6 text-[0.8125rem] text-[var(--text-faint)]">
        Shop attendants do not sign in here. Open the link the owner sent you.
      </p>
    </main>
  );
}
