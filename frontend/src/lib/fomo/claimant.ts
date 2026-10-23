import {
  AccountId,
  AccountStorageMode,
  AuthScheme,
  NoteType,
  TransactionFilter,
  type TransactionProver,
  type TransactionRequest,
  type WasmWebClient,
} from "@miden-sdk/miden-sdk";
import type { KeyStore } from "./secrets";

/**
 * The prize is claimed by a wallet that lives in this browser's local client, not by Bread.
 *
 * Bread 1.17.5 accepts an unauthenticated custom request only when it is a bare own-output-notes
 * request; a request that consumes a note (the claim, with its advice map) is rejected with
 * "Custom requests without authentication currently support only own output notes", and the auth
 * argument Bread wants cannot be derived for a private account the local client does not track.
 * The prize note is a public bearer note locked by the secret, so any account may consume it. A
 * private single-sig claimant does, pays its fee from the pot, and forwards the rest to Bread as
 * a public P2ID note, which Bread consumes on its own.
 */

const CLAIMANT_KEY = "fomo3d:claimant";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const defaultStore = (): KeyStore | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};

/** The id of the browser's claimant wallet, created on first use and remembered in `store`. */
export async function ensureClaimant(client: WasmWebClient, store: KeyStore | null = defaultStore()): Promise<AccountId> {
  const saved = store?.getItem(CLAIMANT_KEY);
  if (saved) {
    const id = AccountId.fromHex(saved);
    if (await client.getAccount(id)) return id;
  }
  const wallet = await client.newWallet(AccountStorageMode.private(), AuthScheme.Falcon);
  const id = wallet.id();
  store?.setItem(CLAIMANT_KEY, id.toString());
  return id;
}

/** Outcome of the allowlist check that precedes a claimant's first transaction. */
export type AllowlistOutcome = "allowed" | "registered" | "needs-code";

/**
 * Mainnet creates only allowlisted accounts, and the claim is the claimant's first transaction,
 * so the account is registered first. The node answers "allowed" where it enforces no allowlist
 * (testnet) and for a registered or existing account. A registration consumes the code, and the
 * node's funding service then pays the new account a little native asset on its own.
 */
export async function ensureAllowed(client: WasmWebClient, account: AccountId, inviteCode?: string): Promise<AllowlistOutcome> {
  if (await client.isAccountAllowed(account)) return "allowed";
  const code = inviteCode?.trim();
  if (!code) return "needs-code";
  await client.registerAccount(account, code);
  return "registered";
}

/** Executes, proves (delegated when a prover is configured) and submits from the local client. */
export async function submitLocally(
  client: WasmWebClient,
  prover: TransactionProver | null | undefined,
  account: AccountId,
  request: TransactionRequest,
): Promise<string> {
  const txId = prover
    ? await client.submitNewTransactionWithProver(account, request, prover)
    : await client.submitNewTransaction(account, request);
  return txId.toHex();
}

/** Polls the local client until the transaction is committed; throws when it is discarded. */
export async function waitForCommit(client: WasmWebClient, txIdHex: string, timeoutMs = 240_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await client.syncState();
    const records = await client.getTransactions(TransactionFilter.all());
    const record = records.find((entry) => entry.id().toHex() === txIdHex);
    const status = record?.transactionStatus();
    if (status?.isCommitted()) return;
    if (status?.isDiscarded()) throw new Error(`Transaction ${txIdHex} was discarded by the node.`);
    await sleep(5_000);
  }
  throw new Error(`Transaction ${txIdHex} was not committed within ${Math.round(timeoutMs / 1000)}s.`);
}

export async function balanceOf(client: WasmWebClient, account: AccountId, faucet: AccountId): Promise<bigint> {
  const record = await client.getAccount(account);
  return record ? record.vault().getBalance(faucet) : 0n;
}

/**
 * How much of `balance` to forward when `reserve` must stay behind for the fee. The claim fee is
 * the pot minus the balance it left; a plain send costs less, so that fee is the first reserve.
 */
export const forwardAmount = (balance: bigint, reserve: bigint): bigint => (balance > reserve ? balance - reserve : 0n);

/** A public P2ID note from the claimant to `target`; Bread consumes native-asset P2ID notes itself. */
export function forwardRequest(
  client: WasmWebClient,
  from: AccountId,
  target: AccountId,
  faucet: AccountId,
  amount: bigint,
): Promise<TransactionRequest> {
  return client.newSendTransactionRequest(from, target, faucet, NoteType.Public, amount);
}
