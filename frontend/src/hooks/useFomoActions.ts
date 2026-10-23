import { useCallback, useEffect, useState } from "react";
import { useMiden, useMidenClient } from "@miden-sdk/react";
import { AccountId, NoteDetails, NoteFile, NoteTag, type TransactionRequest } from "@miden-sdk/miden-sdk";
import { ConsumeTransaction } from "@miden-sdk/miden-wallet-adapter-base";
import { customTransaction, explorer, parseAccountId, shortHex } from "@/lib/fomo/bread";
import { balanceOf, ensureAllowed, ensureClaimant, forwardAmount, forwardRequest, submitLocally, waitForCommit } from "@/lib/fomo/claimant";
import { commitmentWord, randomSecret } from "@/lib/fomo/commitment";
import { requestFaucetTokens } from "@/lib/fomo/faucet";
import { buildNetworkNote, buildPrizeNote, buildRefundTemplate, buyStorage, rebuildRefundNote } from "@/lib/fomo/notes";
import { claimRequest, ownOutputRequest } from "@/lib/fomo/requests";
import { loadScript } from "@/lib/fomo/scripts";
import { base64ToBytes, bytesToBase64, loadKeys, saveKey, secretOf, updateKey, type KeyRecord } from "@/lib/fomo/secrets";
import { formatUsdc, type GameState } from "@/lib/fomo/types";
import type { Bread } from "./useBread";
import type { GameSnapshot } from "./useGameState";

export type LogKind = "info" | "ok" | "error";
export type LogEntry = { at: number; text: string; kind: LogKind; href?: string };
export type Busy = "faucet" | "buy" | "settle" | "claim" | "refund" | "balance" | null;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const WALLET_WAIT_MS = 5 * 60_000;

export interface FomoActionsInput {
  gameHex: string | undefined;
  snapshot: GameSnapshot | null;
  refresh: () => Promise<GameSnapshot | null>;
  bread: Bread;
}

/** Every player action: faucet, buy, settle, claim, refund recovery, plus the activity log. */
export function useFomoActions({ gameHex, snapshot, refresh, bread }: FomoActionsInput) {
  const { runExclusive, prover } = useMiden();
  const client = useMidenClient();
  const [keys, setKeys] = useState<KeyRecord[]>([]);
  const [busy, setBusy] = useState<Busy>(null);
  const [log, setLog] = useState<LogEntry[]>([]);
  const [balance, setBalance] = useState<bigint | null>(null);
  /** The network refused to create the claimant wallet; a claim needs an access code. */
  const [inviteNeeded, setInviteNeeded] = useState(false);

  useEffect(() => {
    setKeys(gameHex ? loadKeys(gameHex) : []);
  }, [gameHex]);

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

  /** Sends a request through Bread and waits until the wallet reports it submitted. */
  const sendThroughBread = useCallback(
    async (request: TransactionRequest, importNotes: Uint8Array[] = [], inputNoteIds: string[] = []) => {
      const ctx = requireContext();
      const tx = customTransaction(ctx.address, ctx.gameHex, request, inputNoteIds, importNotes);
      push("Waiting for approval in Bread...");
      const walletTxId = await ctx.requestTransaction(tx);
      push("Bread accepted the transaction. Proving and submitting...");
      const output = await ctx.waitForTransaction(walletTxId, WALLET_WAIT_MS);
      push(`Submitted transaction ${shortHex(output.txHash)}`, "ok", explorer.tx(output.txHash));
      return { walletTxId, txHash: output.txHash };
    },
    [push, requireContext],
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
        if (ctx.state.settled) throw new Error("The round is settled.");
        if (maxSpend < ctx.state.price) throw new Error("Maximum spend is below the current key price.");
        const secret = randomSecret();
        const commitment = commitmentWord(secret);
        const commitmentHex = commitment.toHex();
        const template = buildRefundTemplate(ctx.accountHex, ctx.feeFaucet);
        const templateBytes = template.serialize();
        const storage = buyStorage(commitment, template.recipient().digest());
        // Persist the secret before anything can fail: a wallet success with a lost id must not orphan it.
        setKeys(
          saveKey(ctx.gameHex, {
            commitment: commitmentHex,
            secret: secret.map((value) => value.toString()),
            refundTemplate: bytesToBase64(templateBytes),
            maxSpend: maxSpend.toString(),
            priceAtBuy: ctx.state.price.toString(),
            blockAtBuy: snapshot?.syncHeight ?? 0,
            at: Date.now(),
          }),
        );
        push(`Secret saved in this browser for commitment ${shortHex(commitmentHex)}.`);
        const note = buildNetworkNote({
          sender: ctx.accountHex,
          game: ctx.gameHex,
          script: await loadScript("buy"),
          storage,
          asset: { faucet: ctx.feeFaucet, amount: maxSpend },
        });
        const noteId = note.id().toString();
        const keysBefore = ctx.state.keys;
        const { walletTxId, txHash } = await sendThroughBread(ownOutputRequest(note));
        setKeys(updateKey(ctx.gameHex, commitmentHex, { walletTxId, txHash, noteId }));
        push("Waiting for the game to consume the buy note...");
        const next = await waitForChain(
          (state) => state.keys > keysBefore || state.leader.toLowerCase() === commitmentHex.toLowerCase(),
          "Key acceptance",
        );
        if (next.leader.toLowerCase() === commitmentHex.toLowerCase()) {
          push("Your key was accepted. You lead the round.", "ok");
        } else {
          push("The round moved on but your commitment is not the leader. The buy was probably refunded.", "error");
        }
        void refreshBalance();
      }),
    [push, refreshBalance, requireContext, sendThroughBread, snapshot?.syncHeight, waitForChain, withBusy],
  );

  const settle = useCallback(
    () =>
      withBusy("settle", async () => {
        const ctx = requireContext();
        if (ctx.state.settled) throw new Error("The round is already settled.");
        if (ctx.state.keys === 0n) throw new Error("No key was bought; nothing to settle.");
        const note = buildNetworkNote({
          sender: ctx.accountHex,
          game: ctx.gameHex,
          script: await loadScript("settle"),
          storage: [],
        });
        await sendThroughBread(ownOutputRequest(note));
        push("Waiting for the game to settle...");
        await waitForChain((state) => state.settled, "Settlement");
        push("Round settled. The prize note is on chain; the leader can claim it.", "ok");
      }),
    [push, requireContext, sendThroughBread, waitForChain, withBusy],
  );

  const claim = useCallback(
    (record: KeyRecord, inviteCode?: string) =>
      withBusy("claim", async () => {
        const ctx = requireContext();
        if (!ctx.state.settled) throw new Error("The round is not settled yet.");
        if (ctx.state.leader.toLowerCase() !== record.commitment.toLowerCase()) {
          throw new Error("This key is not the winning commitment.");
        }
        const { pot, leader } = ctx.state;
        const feeFaucet = AccountId.fromHex(ctx.feeFaucet);
        // The claim runs in this browser's local client: Bread executes only bare own-output
        // requests for its accounts (see lib/fomo/claimant.ts). The claimant wallet consumes the
        // public prize note with the secret, then forwards the pot to Bread as a public P2ID note.
        const claimant = await runExclusive(() => ensureClaimant(client));
        const claimantHex = claimant.toString();
        let claimedTxHash = record.claimedTxHash;
        if (!claimedTxHash) {
          // The claim creates the claimant on chain, which a mainnet allowlist gates.
          const allowed = await runExclusive(() => ensureAllowed(client, claimant, inviteCode));
          if (allowed === "needs-code") {
            setInviteNeeded(true);
            throw new Error(
              `This network creates only allowlisted accounts. Enter a mainnet access code to register the browser wallet ${shortHex(claimantHex)}, then claim again.`,
            );
          }
          setInviteNeeded(false);
          if (allowed === "registered") push(`Browser wallet ${shortHex(claimantHex)} registered on the allowlist.`, "ok");
          const idHex = await runExclusive(async () => {
            const prize = buildPrizeNote(ctx.gameHex, ctx.feeFaucet, pot, leader, await loadScript("claim"));
            const idHex = prize.id().toString();
            const existing = await client.getInputNote(idHex);
            if (!existing?.inclusionProof()) {
              await client.importNoteFile(NoteFile.fromNoteId(prize.id()));
              await client.syncState();
            }
            const stored = await client.getInputNote(idHex);
            if (!stored?.inclusionProof()) throw new Error("The prize note is not on chain yet. Try again in a few seconds.");
            return idHex;
          });
          push(`Prize note ${shortHex(idHex)} found on chain. Claiming with the browser wallet ${shortHex(claimantHex)}...`, "info", explorer.note(idHex));
          claimedTxHash = await runExclusive(async () => {
            const prize = buildPrizeNote(ctx.gameHex, ctx.feeFaucet, pot, leader, await loadScript("claim"));
            return submitLocally(client, prover, claimant, claimRequest(prize, leader, secretOf(record)));
          });
          setKeys(updateKey(ctx.gameHex, record.commitment, { claimedTxHash, claimant: claimantHex }));
          push(`Claim transaction ${shortHex(claimedTxHash)} submitted. Waiting for it to commit...`, "ok", explorer.tx(claimedTxHash));
          await runExclusive(() => waitForCommit(client, claimedTxHash!));
        }
        const balance = await runExclusive(() => balanceOf(client, claimant, feeFaucet));
        push(`Prize of ${formatUsdc(balance)} USDCx is held by the browser wallet. Forwarding it to Bread...`, "ok");
        // The claim fee is what the pot lost on the way in; a plain send costs less than that.
        let reserve = pot > balance ? pot - balance : 0n;
        if (reserve === 0n) reserve = 1_000n;
        const target = AccountId.fromHex(ctx.accountHex);
        let forwardedTxHash: string | undefined;
        let lastError: unknown;
        for (let attempt = 0; attempt < 4 && !forwardedTxHash; attempt += 1, reserve *= 2n) {
          const amount = forwardAmount(balance, reserve);
          if (amount === 0n) break;
          try {
            forwardedTxHash = await runExclusive(async () =>
              submitLocally(client, prover, claimant, await forwardRequest(client, claimant, target, feeFaucet, amount)),
            );
            setKeys(updateKey(ctx.gameHex, record.commitment, { forwardedTxHash }));
            push(`Sent ${formatUsdc(amount)} USDCx to your Bread account. Bread consumes the note once its sync sees it.`, "ok", explorer.tx(forwardedTxHash));
          } catch (caught) {
            lastError = caught;
            push(`Forwarding ${formatUsdc(amount)} USDCx failed (${caught instanceof Error ? caught.message : String(caught)}); retrying with a larger fee reserve.`);
          }
        }
        if (!forwardedTxHash) {
          throw new Error(
            `The prize stays in the browser wallet ${claimantHex}; forwarding failed${lastError instanceof Error ? `: ${lastError.message}` : ""}. Press "Send to Bread" to retry.`,
          );
        }
        void refreshBalance();
      }),
    [client, prover, push, refreshBalance, requireContext, runExclusive, withBusy],
  );

  const recoverRefund = useCallback(
    (record: KeyRecord) =>
      withBusy("refund", async () => {
        const ctx = requireContext();
        if (!bread.importPrivateNote || !bread.requestConsume) throw new Error("Bread does not expose private note import.");
        const amount = BigInt(record.maxSpend);
        const fetched = await runExclusive(async () => {
          const note = rebuildRefundNote(base64ToBytes(record.refundTemplate), ctx.gameHex, ctx.feeFaucet, amount);
          const idHex = note.id().toString();
          const existing = await client.getInputNote(idHex);
          if (!existing?.inclusionProof()) {
            const details = new NoteDetails(note.assets(), note.recipient());
            await client.importNoteFile(NoteFile.fromExpectedNote(details, new NoteTag(0), record.blockAtBuy ?? 0));
            await client.syncState();
          }
          const stored = await client.getInputNote(idHex);
          if (!stored?.inclusionProof()) {
            throw new Error("No refund note found for this key. An accepted buy has no refund.");
          }
          return { idHex, bytes: NoteFile.fromInputNote(stored.toInputNote()).serialize() };
        });
        // The refund is a private P2ID note to the Bread account. Bread's own consume flow signs
        // for its account; a custom consume request would be refused (see lib/fomo/claimant.ts).
        push(`Refund note ${shortHex(fetched.idHex)} found on chain. Importing it into Bread...`, "info", explorer.note(fetched.idHex));
        await bread.importPrivateNote(fetched.bytes);
        push("Waiting for approval in Bread...");
        const walletTxId = await bread.requestConsume(
          new ConsumeTransaction(ctx.feeFaucet, fetched.idHex, "private", Number(amount), fetched.bytes),
        );
        const output = await ctx.waitForTransaction(walletTxId, WALLET_WAIT_MS);
        setKeys(updateKey(ctx.gameHex, record.commitment, { refundTxHash: output.txHash }));
        push(`Refund of ${formatUsdc(amount)} USDCx claimed.`, "ok", explorer.tx(output.txHash));
        void refreshBalance();
      }),
    [bread, client, push, refreshBalance, requireContext, runExclusive, withBusy],
  );

  return { keys, busy, log, balance, inviteNeeded, refreshBalance, faucet, buy, settle, claim, recoverRefund };
}

export type FomoActions = ReturnType<typeof useFomoActions>;
