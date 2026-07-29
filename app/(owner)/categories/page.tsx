import { requireOwner } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { CategoriesPanel } from './CategoriesPanel';

export const metadata = { title: 'Categories · Shop Books' };

export default async function CategoriesPage() {
  await requireOwner();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Categories"
        description="The groups you sort your stock into, such as carpets, curtains, bedsheets or blankets."
      />

      <CategoriesPanel />
    </div>
  );
}
