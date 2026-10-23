import { type ReactNode } from "react";
import { MidenProvider } from "@miden-sdk/react";
import { MidenFiSignerProvider } from "@miden-sdk/miden-wallet-adapter-react";
import { APP_NAME, MIDEN_PROVER, MIDEN_RPC_URL, WALLET_NETWORK } from "@/config";

// MidenProvider stays OUTSIDE the signer provider. Nested the other way round it waits for the
// wallet to connect before creating the client, so the public game read would never run. The
// local client here only reads the game account and builds transaction requests; Bread executes,
// proves and submits every player transaction. `useWorker: false` keeps one in-memory forest, so
// the imported game account is visible to every call.
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <MidenProvider
      config={{ rpcUrl: MIDEN_RPC_URL, prover: MIDEN_PROVER, useWorker: false }}
      loadingComponent={<div className="loading">Loading Miden client...</div>}
    >
      <MidenFiSignerProvider appName={APP_NAME} network={WALLET_NETWORK} autoConnect={false}>
        {children}
      </MidenFiSignerProvider>
    </MidenProvider>
  );
}
