import { notFound } from 'next/navigation';
import { requireOwner } from '@/lib/auth';
import { PageHeader } from '@/components/ui/PageHeader';
import { ProductFormPanel } from '../ProductFormPanel';

export const metadata = { title: 'Edit stock · Shop Books' };

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireOwner();

  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  return (
    <div className="mx-auto max-w-2xl">
      {/*
        The heading no longer names the batch. Reading it here would mean a
        database round trip on a page that otherwise renders from the device,
        which would make editing stock the one owner screen that breaks offline.
      */}
      <PageHeader title="Edit stock" description="Change what this batch is and costs." />

      <ProductFormPanel itemId={itemId} />
    </div>
  );
}
