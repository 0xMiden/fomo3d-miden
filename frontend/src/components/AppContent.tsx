import { useEffect, useState } from "react";
import { useMiden } from "@miden-sdk/react";
import { GAME_ADDRESS, NETWORK_LABEL } from "@/config";
import { useBread } from "@/hooks/useBread";
import { useFomoActions } from "@/hooks/useFomoActions";
import { useGameState } from "@/hooks/useGameState";
import { holdsLeader } from "@/lib/fomo/game";
import { previewState } from "@/lib/fomo/preview";
import { FomoDashboard } from "./FomoDashboard";
import { PlayPanel } from "./PlayPanel";

function useClock() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

export function AppContent() {
  const { isReady, error } = useMiden();
  const now = useClock();
  if (!isReady) {
    return <FomoDashboard state={previewState()} now={now} mode="preview" accountId={GAME_ADDRESS} network={NETWORK_LABEL} error={error?.message} />;
  }
  return <LiveRound now={now} />;
}

function LiveRound({ now }: { now: number }) {
  const game = useGameState(GAME_ADDRESS);
  const bread = useBread();
  const actions = useFomoActions({ gameHex: GAME_ADDRESS, snapshot: game.snapshot, refresh: game.refresh, bread });
  const state = game.state;
  const isLeader = !!state && holdsLeader(state, actions.keys.map((key) => key.commitment));
  return (
    <FomoDashboard
      state={state ?? previewState()}
      now={now}
      mode={state ? "live" : "preview"}
      accountId={GAME_ADDRESS}
      network={NETWORK_LABEL}
      error={game.error}
      isLeader={isLeader}
      onRefresh={GAME_ADDRESS ? () => void game.refresh() : undefined}
      play={GAME_ADDRESS ? <PlayPanel state={state} now={now} bread={bread} actions={actions} /> : undefined}
    />
  );
}
