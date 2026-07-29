import { requireAttendant } from '@/lib/auth';
import { ExpenseForm } from '@/components/forms/ExpenseForm';
import { TodaysExpenses } from './TodaysExpenses';

export const metadata = { title: 'Record an expense · Shop Books' };

export default async function AttendantExpensePage() {
  await requireAttendant();

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-[1.5rem] font-semibold tracking-tight">Record an expense</h1>
        <p className="mt-1 text-[0.9375rem] text-[var(--text-muted)]">
          Money spent for the shop, such as transport or lunch for the day.
        </p>
      </div>

      <div className="surface p-5">
        <ExpenseForm />
      </div>

      <section>
        <h2 className="mb-2 text-[0.9375rem] font-semibold">Spent today</h2>
        <TodaysExpenses />
      </section>
    </div>
  );
}
