import { useEffect, useState } from "react";
import { FAUCET_URL, NETWORK_LABEL } from "@/config";
import type { Bread } from "@/hooks/useBread";
import type { FomoActions } from "@/hooks/useFomoActions";
import { explorer, shortHex } from "@/lib/fomo/bread";
import type { BuyRecord } from "@/lib/fomo/buys";
import { holdsLeader, roundPhase } from "@/lib/fomo/game";
import { formatUsdc, noteAmountFits, parseUsdc, type GameState } from "@/lib/fomo/types";

export interface PlayPanelProps {
  state: GameState | null;
  now: number;
  bread: Bread;
  actions: FomoActions;
}

type BuyStatus = { label: "PENDING" | "LEADING" | "OUTBID" | "ENDED" | "UNCONFIRMED"; tone: "lead" | "idle" | "lost" };

/**
 * A buy's label comes from the outcome its flow observed. A record without one (the page was
 * reloaded mid-flow) is PENDING: the live price and leader say nothing about this note, because
 * any other player's key moves them too.
 */
function buyStatus(record: BuyRecord, state: GameState | null, accountHex: string | null): BuyStatus {
  if (record.outcome === "unconfirmed") return { label: "UNCONFIRMED", tone: "idle" };
  if (record.outcome === "ended") return { label: "ENDED", tone: "idle" };
  // Without a hash the wallet may never have sent it, so a newer round says nothing about it.
  if (!record.txHash && !record.outcome) return { label: "PENDING", tone: "idle" };
  if (state && record.round < state.round) return { label: "ENDED", tone: "idle" };
  if (record.outcome !== "led" || !state) return { label: "PENDING", tone: "idle" };
  if (holdsLeader(state, accountHex)) return { label: "LEADING", tone: "lead" };
  return { label: "OUTBID", tone: "lost" };
}

export function PlayPanel({ state, now, bread, actions }: PlayPanelProps) {
  const phase = state ? roundPhase(state, now) : "open";
  const [spendText, setSpendText] = useState("");
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (!touched && state) setSpendText(formatUsdc(state.price, 6).replace(/0+$/, "").replace(/\.$/, ""));
  }, [state, touched]);
  const spend = parseUsdc(spendText);
  const spendValid = spend !== null && !!state && spend >= state.price && noteAmountFits(spend);
  const connected = bread.connected;
  const busy = actions.busy;
  const canBuy = connected && !busy && !!state && phase === "open" && spendValid;
  const canSettle = connected && !busy && !!state && phase === "expired";

  useEffect(() => {
    if (connected) void actions.refreshBalance();
    // Only re-read when the connection or the account changes, or the chain moved (a key, a refund or a payout).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, bread.accountHex, state?.keys, state?.round]);

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
            {bread.error && <em className="wallet-error" role="alert">{bread.error}</em>}
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
          {busy === "buy" ? "BUYING…" : phase === "open" ? "BUY KEY" : "TIME IS UP"}
        </button>
        <small>
          One key at the price when the note is consumed{state ? ` (now ${formatUsdc(state.price)} USDCX, +${state.extendSeconds}s on the clock)` : ""}. Change above the price comes back to your Bread account.
        </small>
      </section>

      {state && phase === "expired" && (
        <section className="settle-row" aria-label="Settle">
          <span>{state.keys > 0n ? "THE CLOCK RAN OUT. ANYONE CAN SETTLE." : "THE CLOCK RAN OUT WITH NO KEYS. ANYONE CAN RESTART IT."}</span>
          <button type="button" className="btn btn-primary" onClick={() => void actions.settle()} disabled={!canSettle}>
            {busy === "settle" ? "SETTLING…" : state.keys > 0n ? "SETTLE ROUND" : "RESTART CLOCK"}
          </button>
        </section>
      )}

      <section className="keys-list" aria-label="My buys">
        <div className="section-kicker">// MY BUYS</div>
        {actions.buys.length === 0 ? (
          <p className="muted">No buys from this browser yet.</p>
        ) : (
          <ul>
            {actions.buys.map((record) => {
              const status = buyStatus(record, state, bread.accountHex);
              return (
                <li key={`${record.at}:${record.noteId ?? ""}`}>
                  <span className={`key-status key-${status.tone}`}>{status.label}</span>
                  <span className="key-note" title={record.noteId}>
                    ROUND {String(record.round).padStart(3, "0")}{record.noteId ? ` · ${shortHex(record.noteId, 10, 6)}` : ""}
                  </span>
                  <span className="key-amount">{formatUsdc(BigInt(record.maxSpend))} USDCX</span>
                  <span className="key-actions">
                    {record.txHash && <a href={explorer.tx(record.txHash)} target="_blank" rel="noreferrer">TX ↗</a>}
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
