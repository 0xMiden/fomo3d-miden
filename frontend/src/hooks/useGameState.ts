import { useCallback, useEffect, useRef, useState } from "react";
import { useMiden, useMidenClient } from "@miden-sdk/react";
import { AccountId } from "@miden-sdk/miden-sdk";
import { GAME_POLL_MS } from "@/config";
import { readGameState } from "@/lib/fomo/game";
import type { GameState } from "@/lib/fomo/types";

export type GameSnapshot = {
  state: GameState;
  /** Hex id of the chain fee faucet, which is also the game's asset. */
  feeFaucet: string;
  /** The local client's sync height when the snapshot was read. */
  syncHeight: number;
};

/** Polls the public game account through the local read-only client. */
export function useGameState(gameHex: string | undefined, pollMs = GAME_POLL_MS) {
  const { isReady, runExclusive, error: providerError } = useMiden();
  const client = useMidenClient();
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef<Promise<GameSnapshot | null> | null>(null);

  const refresh = useCallback(async (): Promise<GameSnapshot | null> => {
    if (!gameHex || !isReady) return null;
    if (inFlight.current) return inFlight.current;
    const run = (async () => {
      try {
        const next = await runExclusive(async () => {
          const state = await readGameState(client, AccountId.fromHex(gameHex));
          const feeFaucet = (await client.feeFaucetId()).toString();
          const syncHeight = await client.getSyncHeight();
          return { state, feeFaucet, syncHeight } satisfies GameSnapshot;
        });
        setSnapshot(next);
        setError(null);
        return next;
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        return null;
      } finally {
        inFlight.current = null;
      }
    })();
    inFlight.current = run;
    return run;
  }, [client, gameHex, isReady, runExclusive]);

  useEffect(() => {
    if (!gameHex || !isReady) return;
    void refresh();
    const timer = window.setInterval(() => void refresh(), pollMs);
    return () => window.clearInterval(timer);
  }, [gameHex, isReady, pollMs, refresh]);

  return {
    snapshot,
    state: snapshot?.state ?? null,
    feeFaucet: snapshot?.feeFaucet ?? null,
    syncHeight: snapshot?.syncHeight ?? 0,
    error: error ?? providerError?.message ?? null,
    refresh,
    isReady,
  };
}
