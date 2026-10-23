import { useCallback, useEffect, useRef, useState } from "react";
import { useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { WalletReadyState } from "@miden-sdk/miden-wallet-adapter-base";
import { NETWORK_LABEL } from "@/config";
import { accountHexOf } from "@/lib/fomo/bread";

/** What Bread's refusal codes mean to a player. */
export function describeWalletError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  if (/NETWORK_NOT_GRANTED/.test(text)) return `Bread is on another network. Switch it to ${NETWORK_LABEL} and connect again.`;
  if (/USER_REJECTED|rejected|declined/i.test(text)) return "Connection declined in Bread.";
  return text;
}

/**
 * The Bread wallet connection, with the connected account resolved to a hex id.
 *
 * Reconnects once on load instead of the provider's `autoConnect`: that effect clears the
 * remembered wallet name on failure, the single-wallet effect sets it right back, and the two
 * loop forever when Bread refuses (adapter-react 0.17.4, seen with NETWORK_NOT_GRANTED).
 */
export function useBread() {
  const wallet = useMidenFiWallet();
  const readyState = wallet.wallet?.readyState;
  const installed = readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
  const [error, setError] = useState<string | null>(null);
  const attempted = useRef(false);

  const connect = useCallback(async () => {
    setError(null);
    try {
      await wallet.connect();
    } catch (caught) {
      setError(describeWalletError(caught));
    }
  }, [wallet]);

  useEffect(() => {
    if (attempted.current || !installed || wallet.connecting) return;
    attempted.current = true;
    if (!wallet.connected) void connect();
  }, [connect, installed, wallet.connected, wallet.connecting]);

  const accountHex = (() => {
    if (!wallet.address) return null;
    try {
      return accountHexOf(wallet.address);
    } catch {
      return null;
    }
  })();

  return {
    installed,
    installUrl: wallet.wallet?.adapter.url ?? "https://chromewebstore.google.com/search/bread%20wallet",
    connected: wallet.connected && accountHex !== null,
    connecting: wallet.connecting,
    error,
    address: wallet.address,
    accountHex,
    connect,
    disconnect: wallet.disconnect,
    requestTransaction: wallet.requestTransaction,
    waitForTransaction: wallet.waitForTransaction,
    requestAssets: wallet.requestAssets,
  };
}

export type Bread = ReturnType<typeof useBread>;
