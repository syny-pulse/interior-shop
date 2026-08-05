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
        description="What is on the shelf, what it is worth, and what is running out. Tap a row to see each shopping trip behind it, change the details, or buy more."
        action={{ href: '/products/new', label: 'Add stock' }}
      />

      <ProductsPanel />
    </div>
  );
}
