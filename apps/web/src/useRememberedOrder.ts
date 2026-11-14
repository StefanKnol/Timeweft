/**
 * The order a section's list is drawn in, newest first or oldest first, as the author last chose
 * it. Kept in the browser's own storage for each section, so the phone and the desktop remember
 * apart and a reload keeps it. Never in the address.
 */
import { useCallback, useState } from 'react';
import { listOrderFromStored, orderStorageKey, type ListOrder, type RunSection } from './shaping.ts';

function storedOrder(section: RunSection): ListOrder {
  try {
    return listOrderFromStored(window.localStorage.getItem(orderStorageKey(section)));
  } catch {
    // Storage may be turned off or full; the list is then simply newest first.
    return 'newest-first';
  }
}

export function useRememberedOrder(section: RunSection): [ListOrder, (order: ListOrder) => void] {
  const [order, setOrder] = useState<ListOrder>(() => storedOrder(section));
  const chooseOrder = useCallback((chosen: ListOrder) => {
    setOrder(chosen);
    try {
      window.localStorage.setItem(orderStorageKey(section), chosen);
    } catch {
      // Not kept past this visit; the list still turns.
    }
  }, [section]);
  return [order, chooseOrder];
}
