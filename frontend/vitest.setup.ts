import "@testing-library/jest-dom/vitest";

// Node 22+ defines its own `localStorage` global (backed by --localstorage-file) which shadows
// jsdom's and has no methods when that flag is unset, so `localStorage.clear()` throws under
// vitest on such a Node. Give tests a plain in-memory Storage instead.
if (typeof globalThis.localStorage?.clear !== "function") {
  const data = new Map<string, string>();
  const storage = {
    get length() {
      return data.size;
    },
    clear: () => data.clear(),
    getItem: (key: string) => data.get(key) ?? null,
    key: (index: number) => [...data.keys()][index] ?? null,
    removeItem: (key: string) => void data.delete(key),
    setItem: (key: string, value: string) => void data.set(key, String(value)),
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", { value: storage, configurable: true, writable: true });
  if (typeof window !== "undefined") Object.defineProperty(window, "localStorage", { value: storage, configurable: true, writable: true });
}
