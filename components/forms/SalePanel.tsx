'use client';

import { useSync } from '@/components/offline/SyncProvider';
import { MirrorGate } from '@/components/offline/MirrorGate';
import { sellableItems } from '@/lib/offline/mirror';
import { SaleForm } from './SaleForm';

/**
 * Feeds SaleForm from the device's copy.
 *
 * Used by BOTH sale screens so there is one definition of what is sellable,
 * exactly as getSellableItems() was the single query both used before. The
 * quantities are projected, so stock already sold from this phone and not yet
 * sent is subtracted before an attendant can sell it a second time.
 */
export function SalePanel() {
  return (
    <MirrorGate>
      <SalePanelInner />
    </MirrorGate>
  );
}

function SalePanelInner() {
  const { projection } = useSync();
  return <SaleForm items={sellableItems(projection)} />;
}
