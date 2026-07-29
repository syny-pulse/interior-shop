'use client';

import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { ProductForm, type CategoryOption } from '@/components/forms/ProductForm';
import { Alert } from '@/components/ui/Alert';
import { formatNumber, pluralise } from '@/lib/format';

/**
 * Feeds ProductForm from the device's copy.
 *
 * The category list includes ones created offline and not yet sent, so a
 * shopping trip can be recorded end to end with no connection: add "carpets",
 * then add the batch to it, both queued, and the server resolves the reference
 * when they arrive together.
 */
export function ProductFormPanel({ itemId }: { itemId?: number }) {
  return (
    <MirrorGate>
      <ProductFormPanelInner itemId={itemId} />
    </MirrorGate>
  );
}

function ProductFormPanelInner({ itemId }: { itemId?: number }) {
  const { projection } = useSync();

  const categories: CategoryOption[] = projection.categories.map((c) => ({
    id: c.id,
    key: c.key,
    name: c.name,
    clientId: c.clientId,
  }));

  if (itemId === undefined) {
    return <ProductForm categories={categories} />;
  }

  const item = projection.items.find((i) => i.id === itemId);

  if (!item) {
    return (
      <Alert tone="error">
        That product batch is not on this device. It may have been removed, or this phone
        may not have synced since it was added.
      </Alert>
    );
  }

  const unitsSold = item.quantity - item.qtyRemaining;

  return (
    <>
      {unitsSold > 0 && (
        <div className="mb-4">
          <Alert tone="info">
            {formatNumber(unitsSold)} {pluralise(unitsSold, 'unit has', 'units have')}{' '}
            already sold from this batch. Changing the cost price will not alter the
            profit already recorded on those sales.
          </Alert>
        </div>
      )}

      <div className="surface p-5">
        <ProductForm
          categories={categories}
          item={{
            id: item.id,
            clientId: item.clientId,
            categoryId: item.categoryId,
            specifics: item.specifics,
            costPrice: item.costPrice ?? 0,
            minPrice: item.minPrice,
            quantity: item.quantity,
            purchaseDate: item.purchaseDate,
          }}
        />
      </div>
    </>
  );
}
