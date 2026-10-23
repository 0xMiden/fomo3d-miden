import type { ReactNode } from "react";
import "./FomoDashboard.css";
import { formatUsdc, type GameState } from "@/lib/fomo/types";

/** The subset of round state the dashboard renders; preview data supplies only this. */
export type RoundView = Pick<GameState, "pot" | "price" | "deadline" | "keys" | "settled" | "leader">;

function countdown(deadline: number, now: number) {
  const remaining = Math.max(0, deadline - now);
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const seconds = remaining % 60;
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join(":");
}

export function FomoDashboard({ state, now, mode, accountId, error, onRefresh, network = "TESTNET", isLeader = false, play }: {
  state: RoundView;
  now: number;
  mode: "live" | "preview";
  accountId?: string | null;
  error?: string | null;
  onRefresh?: () => void;
  network?: string;
  isLeader?: boolean;
  /** Interactive play panel; the preview shows setup instructions instead. */
  play?: ReactNode;
}) {
  const ended = state.settled || now > state.deadline;
  return (
    <div className="fomo-shell">
      <div className="noise" aria-hidden="true" />
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Fomo 3D home"><span className="brand-symbol">◈</span><span>FOMO<span className="brand-accent">3D</span></span><small>ON MIDEN</small></a>
        <div className="topbar-right"><span className="network-dot" /><span>{network}</span><span className="topbar-divider" /><span className="version">MASM // v0.17</span></div>
      </header>

      <main id="top">
        <section className="hero">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> THE LAST ONE STANDING GETS THE POT <span className="eyebrow-line" /></div>
            <h1>THE CLOCK<br /><em>IS TICKING<span className="period">.</span></em></h1>
            <p>Buy a key. Push back the clock. Be the last buyer when time runs out.</p>
            <div className="hero-tags"><span>01 / ONE ROUND</span><span>02 / RISING PRICE</span><span>03 / LAST BUYER WINS</span></div>
          </div>
          <div className="timer-frame">
            <div className="timer-top"><span>ROUND 001</span><span className={ended ? "status-ended" : "status-live"}><i />{state.settled ? "SETTLED" : ended ? "TIME UP" : "LIVE"}</span></div>
            <div className="timer-inner"><span className="timer-label">TIME REMAINING</span><strong>{countdown(state.deadline, now)}</strong><div className="timer-rule"><span /></div><p>{isLeader ? "YOU HOLD THE LEADING KEY." : "Every accepted key extends the countdown."}</p></div>
            <div className="timer-bottom"><span>⏱ TIMER CAP ACTIVE</span><span>◆ BLOCK TIME</span></div>
          </div>
        </section>

        <section className="stats" aria-label="Round statistics">
          <div className="stat stat-pot"><span className="stat-index">01 / THE PRIZE</span><span className="stat-title">CURRENT POT</span><div className="stat-value"><strong>{formatUsdc(state.pot)}</strong><span>USDCX</span></div><div className="stat-decoration">✦</div></div>
          <div className="stat"><span className="stat-index">02 / THE ENTRY</span><span className="stat-title">NEXT KEY PRICE</span><div className="stat-value"><strong>{formatUsdc(state.price)}</strong><span>USDCX</span></div><p>Price is checked when the note is consumed.</p></div>
          <div className="stat"><span className="stat-index">03 / THE HEAT</span><span className="stat-title">KEYS SOLD</span><div className="stat-value"><strong>{state.keys.toString().padStart(2, "0")}</strong><span>KEYS</span></div><p>One key per accepted buy.</p></div>
        </section>

        <section className="lower-grid">
          <div className="play-panel">
            <div className="section-kicker">// HOW IT WORKS</div>
            <h2>DON'T BLINK<span>.</span></h2>
            <div className="steps">
              <div><b>01</b><span><strong>SEND A BUY NOTE</strong><small>Connect Bread, choose a maximum spend. The note carries USDCx and a secret commitment.</small></span></div>
              <div><b>02</b><span><strong>WAIT FOR CONSUMPTION</strong><small>The network account consumes the note. The current price decides whether your key is accepted.</small></span></div>
              <div><b>03</b><span><strong>OUTLAST THE CLOCK</strong><small>When time is up, anyone settles. The last accepted buyer claims the pot with their secret.</small></span></div>
            </div>
            {play ?? (
              <div className="cli-callout"><span className="cli-icon">&gt;_</span><span><strong>PREVIEW MODE</strong><small>Set VITE_MIDEN_GAME_ADDRESS to a deployed round to play from the browser with the Bread wallet.</small></span></div>
            )}
          </div>
          <aside className="signal-panel"><div className="section-kicker">// TRANSPARENCY SIGNAL</div><div className="signal-icon">◎</div><h3>PUBLIC GAME.<br />SECRET CLAIM.</h3><p>The prize requires a secret that never leaves your browser. The public buy still identifies the winning action. Lose the secret and the prize is unclaimable.</p><div className="signal-line"><span>WINNING BUY IS PUBLIC</span><strong>KNOWN LIMIT</strong></div><div className="signal-line"><span>OPERATOR CAN REORDER</span><strong>KNOWN RISK</strong></div><div className="signal-line"><span>REAL FUNDS</span><strong>{network === "MAINNET" ? "AT YOUR OWN RISK" : "DO NOT USE"}</strong></div></aside>
        </section>

        <section className="round-footer"><div><span className="section-kicker">// ROUND TELEMETRY</span><p>{mode === "live" ? "LIVE ACCOUNT" : "PREVIEW DATA"} <span className="bullet">•</span> {accountId ?? "Set VITE_MIDEN_GAME_ADDRESS to read a deployed game"}</p>{error && <p className="read-error">{error}</p>}</div><div className="footer-actions"><span>LEADER COMMITMENT {state.leader.slice(0, 12)}…</span><button type="button" onClick={onRefresh} disabled={!onRefresh}>↻ REFRESH</button></div></section>
      </main>
      <footer className="site-footer"><span>FOMO3D // {network === "MAINNET" ? "MAINNET" : `${network} PROTOTYPE`}</span><span>{network === "MAINNET" ? "REAL FUNDS. THE WINNING BUY IS PUBLIC." : "NO REAL FUNDS."}</span><span>BUILT WITH MIDEN ASSEMBLY</span></footer>
    </div>
  );
}
