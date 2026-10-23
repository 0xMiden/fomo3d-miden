import { useMemo } from "react";
import { useMidenFiWallet } from "@miden-sdk/miden-wallet-adapter-react";
import { WalletReadyState } from "@miden-sdk/miden-wallet-adapter-base";
import { accountHexOf } from "@/lib/fomo/bread";

/** The Bread wallet connection, with the connected account resolved to a hex id. */
export function useBread() {
  const wallet = useMidenFiWallet();
  const readyState = wallet.wallet?.readyState;
  const installed = readyState === WalletReadyState.Installed || readyState === WalletReadyState.Loadable;
  const accountHex = useMemo(() => {
    if (!wallet.address) return null;
    try {
      return accountHexOf(wallet.address);
    } catch {
      return null;
    }
  }, [wallet.address]);

  return {
    installed,
    installUrl: wallet.wallet?.adapter.url ?? "https://chromewebstore.google.com/search/bread%20wallet",
    connected: wallet.connected && accountHex !== null,
    connecting: wallet.connecting,
    address: wallet.address,
    accountHex,
    connect: wallet.connect,
    disconnect: wallet.disconnect,
    requestTransaction: wallet.requestTransaction,
    waitForTransaction: wallet.waitForTransaction,
    requestAssets: wallet.requestAssets,
    importPrivateNote: wallet.importPrivateNote,
    requestConsume: wallet.requestConsume,
  };
}

export type Bread = ReturnType<typeof useBread>;
