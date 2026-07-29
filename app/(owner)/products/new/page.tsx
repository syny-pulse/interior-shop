import { requireOwner } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProductFormPanel } from '../ProductFormPanel';

export const metadata = { title: 'Add stock · Shop Books' };

export default async function NewProductPage() {
  await requireOwner();

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Add stock"
        description="Record what you bought on a shopping day. The estimated profit updates as you type."
      />
      <div className="surface p-5">
        <ProductFormPanel />
      </div>
    </div>
  );
}
