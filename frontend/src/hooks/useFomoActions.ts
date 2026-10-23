import { useCallback, useEffect, useState } from "react";
import type { TransactionRequest } from "@miden-sdk/miden-sdk";
import { customTransaction, explorer, parseAccountId, shortHex } from "@/lib/fomo/bread";
import { buyWaitOutcome, forgetBuy, loadBuys, saveBuy, updateBuy, type BuyOutcome, type BuyRecord } from "@/lib/fomo/buys";
import { requestFaucetTokens } from "@/lib/fomo/faucet";
import { holdsLeader, roundPhase } from "@/lib/fomo/game";
import { buildNetworkNote } from "@/lib/fomo/notes";
import { ownOutputRequest } from "@/lib/fomo/requests";
import { loadScript } from "@/lib/fomo/scripts";
import { formatUsdc, noteAmountFits, type GameState } from "@/lib/fomo/types";
import type { Bread } from "./useBread";
import type { GameSnapshot } from "./useGameState";

export type LogKind = "info" | "ok" | "error";
export type LogEntry = { at: number; text: string; kind: LogKind; href?: string };
export type Busy = "faucet" | "buy" | "settle" | null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const WALLET_WAIT_MS = 5 * 60_000;
const nowSeconds = () => Math.floor(Date.now() / 1000);

export interface FomoActionsInput {
  gameHex: string | undefined;
  snapshot: GameSnapshot | null;
  refresh: () => Promise<GameSnapshot | null>;
  bread: Bread;
}

/**
 * Every player action: faucet, buy, settle, plus the wallet balance and the activity log. The
 * game pays prizes and refunds as public P2ID notes to the Bread account, which Bread consumes
 * on its own sync, so nothing here claims anything.
 */
export function useFomoActions({ gameHex, snapshot, refresh, bread }: FomoActionsInput) {
  const [buys, setBuys] = useState<BuyRecord[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);

  const accountHex = bread.accountHex;
  useEffect(() => {
    setBuys(gameHex && accountHex ? loadBuys(gameHex, accountHex) : []);
  }, [gameHex, accountHex]);

  const push = useCallback((text: string, kind: LogKind = "info", href?: string) => {
    setLog((entries) => [{ at: Date.now(), text, kind, href }, ...entries].slice(0, 60));
  }, []);

  const requireContext = useCallback(() => {
    if (!gameHex) throw new Error("No game address is configured.");
    if (!snapshot) throw new Error("Game state has not loaded yet.");
    if (!bread.connected || !bread.address || !bread.accountHex) throw new Error("Connect the Bread wallet first.");
    if (!bread.requestTransaction || !bread.waitForTransaction) throw new Error("Bread does not expose transaction requests.");
    return {
      gameHex,
      state: snapshot.state,
      feeFaucet: snapshot.feeFaucet,
      address: bread.address,
      accountHex: bread.accountHex,
      requestTransaction: bread.requestTransaction,
      waitForTransaction: bread.waitForTransaction,
    };
  }, [bread, gameHex, snapshot]);

  const withBusy = useCallback(
    async <T,>(kind: Busy, work: () => Promise<T>): Promise<T | undefined> => {
      if (busy) return undefined;
      setBusy(kind);
      try {
        return await work();
      } catch (caught) {
        push(caught instanceof Error ? caught.message : String(caught), "error");
        return undefined;
      } finally {
        setBusy(null);
      }
    },
    [busy, push],
  );

  /** Asks Bread to approve and start a request; resolves with the wallet's transaction id. */
  const requestThroughBread = useCallback(
    async (request: TransactionRequest) => {
      const ctx = requireContext();
      const tx = customTransaction(ctx.address, ctx.gameHex, request);
      push("Waiting for approval in Bread...");
      return ctx.requestTransaction(tx);
    },
    [push, requireContext],
  );

  /** Waits until the wallet reports a started transaction submitted. */
  const awaitSubmission = useCallback(
    async (walletTxId: string) => {
      const ctx = requireContext();
      push("Bread accepted the transaction. Proving and submitting...");
      const output = await ctx.waitForTransaction(walletTxId, WALLET_WAIT_MS);
      push(`Submitted transaction ${shortHex(output.txHash)}`, "ok", explorer.tx(output.txHash));
      return output.txHash;
    },
    [push, requireContext],
  );

  const sendThroughBread = useCallback(
    async (request: TransactionRequest) => {
      const walletTxId = await requestThroughBread(request);
      return { walletTxId, txHash: await awaitSubmission(walletTxId) };
    },
    [awaitSubmission, requestThroughBread],
  );

  /** Polls the game until `predicate` holds. */
  const waitForChain = useCallback(
    async (predicate: (state: GameState) => boolean, label: string, timeoutMs = 180_000) => {
      const until = Date.now() + timeoutMs;
      while (Date.now() < until) {
        const next = await refresh();
        if (next && predicate(next.state)) return next.state;
        await sleep(5_000);
      }
      throw new Error(`${label} was not observed within ${Math.round(timeoutMs / 1000)}s. Refresh later.`);
    },
    [refresh],
  );

  const refreshBalance = useCallback(async () => {
    if (!bread.connected || !bread.requestAssets || !snapshot) return;
    try {
      const assets = await bread.requestAssets();
      const match = assets.find((asset) => {
        try {
          return parseAccountId(asset.faucetId).toString() === snapshot.feeFaucet;
        } catch {
          return false;
        }
      });
      setBalance(match ? BigInt(match.amount) : 0n);
    } catch (caught) {
      push(`Could not read the wallet balance: ${caught instanceof Error ? caught.message : String(caught)}`, "error");
    }
  }, [bread, push, snapshot]);

  const faucet = useCallback(
    () =>
      withBusy("faucet", async () => {
        const ctx = requireContext();
        const grant = await requestFaucetTokens(ctx.accountHex, { onStatus: (text) => push(text) });
        push(
          `Faucet note ${shortHex(grant.noteId)} created for ${formatUsdc(grant.amount, 0)} USDCx. Bread claims it automatically once its sync sees it.`,
          "ok",
          explorer.note(grant.noteId),
        );
      }),
    [push, requireContext, withBusy],
  );

  const buy = useCallback(
    (maxSpend: bigint) =>
      withBusy("buy", async () => {
        const ctx = requireContext();
        if (roundPhase(ctx.state, nowSeconds()) === "expired") throw new Error("Time is up. Settle the round before buying.");
        if (maxSpend < ctx.state.price) throw new Error("Maximum spend is below the current key price.");
        if (!noteAmountFits(maxSpend)) throw new Error("Maximum spend does not fit in a u32.");
        // The buy note carries no storage: the game reads the sender from the note metadata and
        // refunds change, outbid and late buys as public P2ID notes to that account.
        const note = buildNetworkNote({
          sender: ctx.accountHex,
          game: ctx.gameHex,
          script: await loadScript("buy"),
          storage: [],
          asset: { faucet: ctx.feeFaucet, amount: maxSpend },
        });
        const record: BuyRecord = {
          noteId: note.id().toString(),
          maxSpend: maxSpend.toString(),
          priceAtBuy: ctx.state.price.toString(),
          round: ctx.state.round,
          at: Date.now(),
        };
        // Persist before anything can fail: a wallet success with a lost id must not orphan the buy.
        setBuys((held) => saveBuy(ctx.gameHex, ctx.accountHex, held, record));
        const { keys: keysBefore, round: roundBefore } = ctx.state;
        let walletTxId: string;
        try {
          walletTxId = await requestThroughBread(ownOutputRequest(note));
        } catch (caught) {
          // Bread never started it, so there is no buy to show.
          setBuys((held) => forgetBuy(ctx.gameHex, ctx.accountHex, held, record));
          throw caught;
        }
        setBuys((held) => updateBuy(ctx.gameHex, ctx.accountHex, held, record, { walletTxId }));
        const txHash = await awaitSubmission(walletTxId);
        setBuys((held) => updateBuy(ctx.gameHex, ctx.accountHex, held, record, { walletTxId, txHash }));
        push("Waiting for the game to consume the buy note...");
        const outcomeOf = (state: GameState) =>
          buyWaitOutcome(roundBefore, keysBefore, state.round, state.keys, holdsLeader(state, ctx.accountHex));
        let outcome: BuyOutcome;
        try {
          outcome = outcomeOf(await waitForChain((state) => outcomeOf(state) !== null, "Key acceptance"))!;
        } catch {
          outcome = "unconfirmed";
        }
        setBuys((held) => updateBuy(ctx.gameHex, ctx.accountHex, held, record, { outcome }));
        if (outcome === "led") push("Your key was accepted. You lead the round.", "ok");
        else if (outcome === "ended") push("The round moved on before your buy was confirmed.");
        else push("Your buy was not confirmed. It is still pending or was refunded to your Bread account; check Bread.", "error");
        void refreshBalance();
      }),
    [awaitSubmission, push, refreshBalance, requestThroughBread, requireContext, waitForChain, withBusy],
  );

  const settle = useCallback(
    () =>
      withBusy("settle", async () => {
        const ctx = requireContext();
        if (roundPhase(ctx.state, nowSeconds()) !== "expired") throw new Error("The clock has not run out yet.");
        const { keys, round: roundBefore, deadline: deadlineBefore } = ctx.state;
        const note = buildNetworkNote({
          sender: ctx.accountHex,
          game: ctx.gameHex,
          script: await loadScript("settle"),
          storage: [],
        });
        await sendThroughBread(ownOutputRequest(note));
        push(keys > 0n ? "Waiting for the game to settle..." : "Waiting for the game to restart the clock...");
        await waitForChain((state) => state.round > roundBefore || state.deadline !== deadlineBefore, "Settlement");
        push(
          keys > 0n
            ? `Round ${roundBefore} settled. The pot went to the leader as a P2ID note; Bread picks it up on its next sync.`
            : "Clock restarted.",
          "ok",
        );
        void refreshBalance();
      }),
    [push, refreshBalance, requireContext, sendThroughBread, waitForChain, withBusy],
  );

  return { buys, busy, log, balance, refreshBalance, faucet, buy, settle };
}

export type FomoActions = ReturnType<typeof useFomoActions>;
