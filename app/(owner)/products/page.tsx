import { requireOwner } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProductsPanel } from './ProductsPanel';

export const metadata = { title: 'Stock · Shop Books' };

export default async function ProductsPage() {
  await requireOwner();

  return (
    <div>
      <PageHeader
        title="Stock"
        description="Everything you have bought, with what it cost you and what it should sell for."
        action={{ href: '/products/new', label: 'Add stock' }}
      />

      <ProductsPanel />
    </div>
  );
}
