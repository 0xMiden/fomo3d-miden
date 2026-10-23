import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-wallet-adapter-react", () => import("@/__tests__/mocks/miden-wallet-adapter-react"));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({ WalletReadyState: { Installed: "Installed", Loadable: "Loadable" } }));
vi.mock("@/lib/fomo/bread", () => ({ accountHexOf: (a: string) => `0x${a}` }));

import { useMidenFiWallet, walletState } from "@/__tests__/mocks/miden-wallet-adapter-react";
import { useBread } from "@/hooks/useBread";

describe("useBread", () => {
  it("reconnects once on load and stops after Bread refuses", async () => {
    const connect = vi.fn(async () => {
      throw new Error("WalletConnectionError: NETWORK_NOT_GRANTED");
    });
    vi.mocked(useMidenFiWallet).mockReturnValue(walletState({ connect }) as never);
    const { result, rerender } = renderHook(() => useBread());
    await act(async () => {});
    rerender();
    await act(async () => {});
    expect(connect).toHaveBeenCalledTimes(1);
    expect(result.current.error).toMatch(/Switch it to TESTNET/);
    await act(async () => {
      await result.current.connect();
    });
    expect(connect).toHaveBeenCalledTimes(2);
  });
});
