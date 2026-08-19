/** Create collision-resistant client-side IDs for persisted learning items. */
export function createItemId(prefix: string): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Read the current timestamp outside component render logic. */
export function currentTimeMs(): number {
  return Date.now();
}
