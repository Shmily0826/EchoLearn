// Minimal browser-API stubs for running the app's persistence layer in a
// Node test environment. Only what src/utils/storage.ts touches at module
// level: `localStorage`. The `window.dispatchEvent` calls inside
// saveVocabulary / saveSentences are stubbed locally in storage.test.ts.

class LocalStorageMock {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    if (typeof key !== 'string' || typeof value !== 'string') {
      throw new TypeError('localStorage expects string keys/values');
    }
    this.store.set(key, value);
  }
}

(globalThis as unknown as { localStorage: Storage }).localStorage =
  new LocalStorageMock() as unknown as Storage;
