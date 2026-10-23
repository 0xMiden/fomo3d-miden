// Public testnet by default. Set VITE_MIDEN_GAME_ADDRESS (written by `deploy_round`) to go live.
import type { WalletAdapterNetwork } from "@miden-sdk/miden-wallet-adapter-base";

export const APP_NAME = "Fomo3D on Miden";

/** An env value, with an empty string treated as unset. */
const env = (name: string): string | undefined => {
  const value = (import.meta.env[name] as string | undefined)?.trim();
  return value ? value : undefined;
};

export type MidenNetwork = "testnet" | "mainnet" | "devnet" | "localhost";
const requested = env("VITE_MIDEN_NETWORK")?.toLowerCase();
export const MIDEN_NETWORK: MidenNetwork =
  requested === "mainnet" || requested === "devnet" || requested === "localhost" ? requested : "testnet";
export const IS_MAINNET = MIDEN_NETWORK === "mainnet";

// Mainnet ("cedar") is not an SDK shorthand; the deploy writes its URLs, these are the fallbacks.
export const MIDEN_RPC_URL = env("VITE_MIDEN_RPC_URL") ?? (IS_MAINNET ? "https://rpc.cedar.miden.io" : MIDEN_NETWORK);
export const MIDEN_PROVER: string =
  env("VITE_MIDEN_PROVER") ?? (IS_MAINNET ? "https://tx-prover.cedar.miden.io" : MIDEN_NETWORK === "localhost" ? "local" : MIDEN_NETWORK);
export const GAME_ADDRESS = env("VITE_MIDEN_GAME_ADDRESS");
/** Public faucet, or null where the network has none (mainnet). */
export const FAUCET_URL: string | null =
  env("VITE_MIDEN_FAUCET_URL") ?? (MIDEN_NETWORK === "testnet" ? "https://faucet-api.testnet.miden.io" : null);
export const EXPLORER_URL =
  env("VITE_MIDEN_EXPLORER_URL") ??
  (IS_MAINNET ? "https://explorer.cedar.miden.io" : MIDEN_NETWORK === "devnet" ? "https://devnet.midenscan.com" : "https://testnet.midenscan.com");
export const NETWORK_LABEL = IS_MAINNET ? "MAINNET" : MIDEN_NETWORK === "localhost" ? "LOCAL NODE" : MIDEN_NETWORK.toUpperCase();
/**
 * The network name handed to Bread. The 0.17 adapter enum stops at testnet, but Bread 1.17.5
 * accepts "mainnet" and then connects only a mainnet wallet; it calls a local node "localnet".
 */
export const WALLET_NETWORK = (MIDEN_NETWORK === "localhost" ? "localnet" : MIDEN_NETWORK) as WalletAdapterNetwork;
/** Precompiled note scripts written by `cargo run --bin fomo3d-masm-build`. */
export const SCRIPTS_BASE = "/fomo3d";
export const GAME_POLL_MS = 10_000;
/** Blocks a player transaction stays valid; blocks are a few seconds apart. */
export const TX_EXPIRATION_BLOCKS = 200;
