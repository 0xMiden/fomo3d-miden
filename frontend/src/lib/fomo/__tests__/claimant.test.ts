import { describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => import("@/__tests__/mocks/miden-sdk"));

import { AccountId } from "@miden-sdk/miden-sdk";
import { ensureAllowed, ensureClaimant, forwardAmount } from "@/lib/fomo/claimant";
import type { KeyStore } from "@/lib/fomo/secrets";

const memoryStore = (): KeyStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

const fakeClient = (known: string[]) => ({
  getAccount: vi.fn(async (id: AccountId) => (known.includes(id.toString()) ? {} : undefined)),
  newWallet: vi.fn(async () => ({ id: () => AccountId.fromHex("0xnew") })),
});

describe("ensureClaimant", () => {
  it("reuses the remembered claimant when the client still tracks it", async () => {
    const store = memoryStore();
    store.setItem("fomo3d:claimant", "0xold");
    const client = fakeClient(["0xold"]);
    const id = await ensureClaimant(client as never, store);
    expect(id.toString()).toBe("0xold");
    expect(client.newWallet).not.toHaveBeenCalled();
  });

  it("creates a wallet when nothing is remembered or the store was wiped", async () => {
    const store = memoryStore();
    store.setItem("fomo3d:claimant", "0xgone");
    const client = fakeClient([]);
    const id = await ensureClaimant(client as never, store);
    expect(id.toString()).toBe("0xnew");
    expect(store.getItem("fomo3d:claimant")).toBe("0xnew");
    expect(client.newWallet).toHaveBeenCalledTimes(1);
  });
});

describe("ensureAllowed", () => {
  const id = AccountId.fromHex("0xclaimant");
  const client = (allowed: boolean) => ({
    isAccountAllowed: vi.fn(async () => allowed),
    registerAccount: vi.fn(async () => {}),
  });

  it("never sends a code where the node already allows the account", async () => {
    const c = client(true);
    expect(await ensureAllowed(c as never, id, "CODE")).toBe("allowed");
    expect(c.registerAccount).not.toHaveBeenCalled();
  });

  it("asks for a code on an allowlisted network and registers with it", async () => {
    const c = client(false);
    expect(await ensureAllowed(c as never, id)).toBe("needs-code");
    expect(await ensureAllowed(c as never, id, "  ")).toBe("needs-code");
    expect(c.registerAccount).not.toHaveBeenCalled();
    expect(await ensureAllowed(c as never, id, " ABCD1234EFGH ")).toBe("registered");
    expect(c.registerAccount).toHaveBeenCalledWith(id, "ABCD1234EFGH");
  });
});

describe("forwardAmount", () => {
  it("keeps the reserve behind and never goes negative", () => {
    expect(forwardAmount(1_000_000n, 2_500n)).toBe(997_500n);
    expect(forwardAmount(2_000n, 2_500n)).toBe(0n);
  });
});
