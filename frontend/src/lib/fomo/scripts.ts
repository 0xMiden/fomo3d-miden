import { NoteScript } from "@miden-sdk/miden-sdk";
import { SCRIPTS_BASE } from "@/config";

export type ScriptName = "buy" | "settle" | "claim";
export type ScriptRoots = Record<ScriptName, string>;

type Fetch = typeof fetch;

const bytesCache = new Map<string, Promise<Uint8Array>>();

/**
 * Loads a note script compiled by `cargo run --bin fomo3d-masm-build`. The browser never
 * compiles MASM: the bytes here carry the exact roots the game account allowlists.
 */
export async function scriptBytes(name: ScriptName, fetchImpl: Fetch = fetch, base = SCRIPTS_BASE): Promise<Uint8Array> {
  const url = `${base}/${name}.bin`;
  let pending = bytesCache.get(url);
  if (!pending) {
    pending = (async () => {
      const response = await fetchImpl(url, { cache: "no-store" });
      if (!response.ok) throw new Error(`Cannot load ${name} script (${response.status}). Run fomo3d-masm-build.`);
      return new Uint8Array(await response.arrayBuffer());
    })();
    bytesCache.set(url, pending);
    pending.catch(() => bytesCache.delete(url));
  }
  return pending;
}

/** A fresh `NoteScript` handle; the SDK consumes script handles passed by value. */
export async function loadScript(name: ScriptName, fetchImpl: Fetch = fetch, base = SCRIPTS_BASE): Promise<NoteScript> {
  return NoteScript.deserialize(await scriptBytes(name, fetchImpl, base));
}

export async function loadRoots(fetchImpl: Fetch = fetch, base = SCRIPTS_BASE): Promise<ScriptRoots> {
  const response = await fetchImpl(`${base}/roots.json`, { cache: "no-store" });
  if (!response.ok) throw new Error(`Cannot load script roots (${response.status}).`);
  const roots = (await response.json()) as Partial<ScriptRoots>;
  for (const name of ["buy", "settle", "claim"] as const) {
    if (typeof roots[name] !== "string") throw new Error(`roots.json lacks ${name}`);
  }
  return roots as ScriptRoots;
}

export const resetScriptCache = () => bytesCache.clear();
