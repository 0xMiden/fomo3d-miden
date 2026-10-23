import { useEffect, useState } from "react";
import { FAUCET_URL, NETWORK_LABEL } from "@/config";
import type { Bread } from "@/hooks/useBread";
import type { FomoActions } from "@/hooks/useFomoActions";
import { explorer, shortHex } from "@/lib/fomo/bread";
import { roundPhase } from "@/lib/fomo/game";
import type { KeyRecord } from "@/lib/fomo/secrets";
import { formatUsdc, parseUsdc, type GameState } from "@/lib/fomo/types";

export interface PlayPanelProps {
  state: GameState | null;
  now: number;
  bread: Bread;
  actions: FomoActions;
}

function keyStatus(record: KeyRecord, state: GameState | null): { label: string; tone: "lead" | "won" | "idle" | "lost" } {
  const isLeader = !!state && state.leader.toLowerCase() === record.commitment.toLowerCase();
  if (record.forwardedTxHash) return { label: "PRIZE CLAIMED", tone: "won" };
  if (record.claimedTxHash) return { label: "PRIZE HELD", tone: "won" };
  if (record.refundTxHash) return { label: "REFUNDED", tone: "idle" };
  if (isLeader && state?.settled) return { label: "WINNER", tone: "won" };
  if (isLeader) return { label: "LEADING", tone: "lead" };
  if (!record.txHash) return { label: "PENDING", tone: "idle" };
  return { label: "OUTBID", tone: "lost" };
}

export function PlayPanel({ state, now, bread, actions }: PlayPanelProps) {
  const phase = state ? roundPhase(state, now) : "open";
  const [spendText, setSpendText] = useState("");
  const [touched, setTouched] = useState(false);
  const [inviteCode, setInviteCode] = useState("");
  useEffect(() => {
    if (!touched && state) setSpendText(formatUsdc(state.price, 6).replace(/0+$/, "").replace(/\.$/, ""));
  }, [state, touched]);
  const spend = parseUsdc(spendText);
  const spendValid = spend !== null && !!state && spend >= state.price;
  const connected = bread.connected;
  const busy = actions.busy;
  const canBuy = connected && !busy && !!state && phase === "open" && spendValid;
  const canSettle = connected && !busy && !!state && phase === "expired" && state.keys > 0n;

  useEffect(() => {
    if (connected) void actions.refreshBalance();
    // Only re-read when the connection or the fee asset changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, state?.leader, state?.keys]);

  return (
    <div className="play-stack">
      <section className="wallet-row" aria-label="Wallet">
        {!bread.installed ? (
          <>
            <span className="wallet-label">BREAD WALLET NOT DETECTED</span>
            <a className="btn" href={bread.installUrl} target="_blank" rel="noreferrer">INSTALL BREAD ↗</a>
          </>
        ) : !connected ? (
          <>
            <span className="wallet-label">CONNECT BREAD TO PLAY ({NETWORK_LABEL})</span>
            <button type="button" className="btn btn-primary" onClick={() => void bread.connect()} disabled={bread.connecting}>
              {bread.connecting ? "CONNECTING…" : "CONNECT BREAD"}
            </button>
          </>
        ) : (
          <>
            <span className="wallet-label">
              <a href={explorer.account(bread.accountHex!)} target="_blank" rel="noreferrer">{shortHex(bread.accountHex!, 10, 6)}</a>
              <em>{actions.balance === null ? "…" : `${formatUsdc(actions.balance)} USDCX`}</em>
            </span>
            <span className="wallet-buttons">
              {FAUCET_URL && (
                <button type="button" className="btn" onClick={() => void actions.faucet()} disabled={busy !== null}>
                  {busy === "faucet" ? "REQUESTING…" : "GET TEST USDCX"}
                </button>
              )}
              <button type="button" className="btn btn-ghost" onClick={() => void bread.disconnect()} disabled={busy !== null}>DISCONNECT</button>
            </span>
          </>
        )}
      </section>

      <section className="buy-row" aria-label="Buy a key">
        <label className="field">
          <span>MAX SPEND (USDCX)</span>
          <input
            inputMode="decimal"
            value={spendText}
            onChange={(event) => { setTouched(true); setSpendText(event.target.value); }}
            aria-invalid={!spendValid}
          />
        </label>
        <button type="button" className="btn btn-primary btn-big" onClick={() => spend !== null && void actions.buy(spend)} disabled={!canBuy}>
          {busy === "buy" ? "BUYING…" : phase === "open" ? "BUY KEY" : phase === "expired" ? "TIME IS UP" : "ROUND SETTLED"}
        </button>
        <small>
          One key at the price when the note is consumed{state ? ` (now ${formatUsdc(state.price)} USDCX, +${state.extendSeconds}s on the clock)` : ""}. Change above the price is refunded privately.
        </small>
      </section>

      {state && phase !== "open" && (
        <section className="settle-row" aria-label="Settle">
          {phase === "expired" ? (
            <>
              <span>THE CLOCK RAN OUT. ANYONE CAN SETTLE.</span>
              <button type="button" className="btn btn-primary" onClick={() => void actions.settle()} disabled={!canSettle}>
                {busy === "settle" ? "SETTLING…" : state.keys === 0n ? "NO KEYS SOLD" : "SETTLE ROUND"}
              </button>
            </>
          ) : (
            <span>ROUND SETTLED. PRIZE: {formatUsdc(state.pot)} USDCX FOR THE WINNING SECRET.</span>
          )}
        </section>
      )}

      <section className="keys-list" aria-label="My keys">
        <div className="section-kicker">// MY KEYS (SECRETS LIVE IN THIS BROWSER)</div>
        {actions.inviteNeeded && (
          <label className="field">
            <span>MAINNET ACCESS CODE (REGISTERS THIS BROWSER&apos;S CLAIM WALLET ONCE)</span>
            <input value={inviteCode} onChange={(event) => setInviteCode(event.target.value)} autoComplete="off" />
          </label>
        )}
        {actions.keys.length === 0 ? (
          <p className="muted">No keys bought from this browser yet.</p>
        ) : (
          <ul>
            {actions.keys.map((record) => {
              const status = keyStatus(record, state);
              const canClaim =
                connected && !busy && !!state && state.settled && (status.label === "WINNER" || status.label === "PRIZE HELD");
              return (
                <li key={record.commitment}>
                  <span className={`key-status key-${status.tone}`}>{status.label}</span>
                  <span className="key-commitment" title={record.commitment}>{shortHex(record.commitment, 10, 6)}</span>
                  <span className="key-amount">{formatUsdc(BigInt(record.maxSpend))} USDCX</span>
                  <span className="key-actions">
                    {record.txHash && <a href={explorer.tx(record.txHash)} target="_blank" rel="noreferrer">TX ↗</a>}
                    {canClaim && (
                      <button type="button" className="btn btn-primary" onClick={() => void actions.claim(record, inviteCode.trim() || undefined)}>
                        {busy === "claim" ? "CLAIMING…" : status.label === "PRIZE HELD" ? "SEND TO BREAD" : actions.inviteNeeded ? "REGISTER & CLAIM" : "CLAIM PRIZE"}
                      </button>
                    )}
                    {status.tone === "lost" && !record.refundTxHash && (
                      <button type="button" className="btn btn-ghost" onClick={() => void actions.recoverRefund(record)} disabled={!connected || busy !== null}>
                        {busy === "refund" ? "CHECKING…" : "RECOVER REFUND"}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {actions.log.length > 0 && (
        <section className="activity" aria-label="Activity">
          <div className="section-kicker">// ACTIVITY</div>
          <ul>
            {actions.log.slice(0, 8).map((entry) => (
              <li key={`${entry.at}-${entry.text}`} className={`log-${entry.kind}`}>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>
                <span>{entry.text}</span>
                {entry.href && <a href={entry.href} target="_blank" rel="noreferrer">↗</a>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
