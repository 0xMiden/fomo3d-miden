import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/miden-sdk", () => import("@/__tests__/mocks/miden-sdk"));
vi.mock("@/lib/fomo/bread", () => ({
  shortHex: (hex: string) => hex.slice(0, 10),
  explorer: { account: (h: string) => `/a/${h}`, tx: (h: string) => `/t/${h}`, note: (h: string) => `/n/${h}` },
}));

import { PlayPanel } from "../PlayPanel";
import type { Bread } from "@/hooks/useBread";
import type { FomoActions } from "@/hooks/useFomoActions";
import type { BuyRecord } from "@/lib/fomo/buys";
import type { GameState } from "@/lib/fomo/types";

/** `0x` + 30 hex digits, split by the SDK mock into prefix and suffix felts. */
const ME = `0x${"ab".repeat(15)}`;
const ME_LEADER = { prefix: BigInt(`0x${"ab".repeat(8)}`), suffix: BigInt(`0x${"ab".repeat(7)}`) };
const OTHER_LEADER = { prefix: BigInt(`0x${"cd".repeat(8)}`), suffix: BigInt(`0x${"cd".repeat(7)}`) };

const state: GameState = {
  pot: 2_100_000n,
  price: 1_200_000n,
  deadline: 1_800_000_000,
  keys: 2n,
  leader: OTHER_LEADER,
  priceStep: 100_000n,
  extendSeconds: 60,
  capSeconds: 600,
  maxPot: 1_000_000_000n,
  roundSeconds: 900,
  startPrice: 1_000_000n,
  round: 4,
};

const bread = (overrides: Partial<Bread> = {}): Bread =>
  ({
    installed: true,
    installUrl: "https://store",
    connected: true,
    connecting: false,
    address: "mtst1abc_q",
    accountHex: ME,
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    requestTransaction: vi.fn(),
    waitForTransaction: vi.fn(),
    requestAssets: vi.fn(),
    ...overrides,
  }) as unknown as Bread;

const actions = (overrides: Partial<FomoActions> = {}): FomoActions =>
  ({
    buys: [],
    busy: null,
    log: [],
    balance: 5_000_000n,
    refreshBalance: vi.fn(async () => {}),
    faucet: vi.fn(async () => {}),
    buy: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
    ...overrides,
  }) as unknown as FomoActions;

const buy = (overrides: Partial<BuyRecord>): BuyRecord => ({
  noteId: "0xnote",
  maxSpend: "1200000",
  priceAtBuy: "1100000",
  round: 4,
  at: 1,
  txHash: "0xtx",
  ...overrides,
});

describe("PlayPanel", () => {
  it("asks to install Bread when the extension is missing", () => {
    render(<PlayPanel state={state} now={1} bread={bread({ installed: false, connected: false })} actions={actions()} />);
    expect(screen.getByText(/NOT DETECTED/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /INSTALL BREAD/ })).toHaveAttribute("href", "https://store");
  });

  it("offers connect when installed but disconnected, shows Bread's refusal, and disables buying", () => {
    const b = bread({ connected: false, error: "Connection declined in Bread." });
    render(<PlayPanel state={state} now={1} bread={b} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "CONNECT BREAD" }));
    expect(b.connect).toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent("Connection declined in Bread.");
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeDisabled();
  });

  it("buys with the current price by default and shows the balance", () => {
    const a = actions();
    render(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    expect(screen.getByText("5.00 USDCX")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "GET TEST USDCX" })).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("1.2");
    fireEvent.click(screen.getByRole("button", { name: "BUY KEY" }));
    expect(a.buy).toHaveBeenCalledWith(1_200_000n);
    expect(a.refreshBalance).toHaveBeenCalled();
    expect(screen.getByText(/comes back to your Bread account/)).toBeInTheDocument();
  });

  it("rejects a max spend below the price", () => {
    const a = actions();
    render(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "0.5" } });
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a max spend that does not fit in a u32 and accepts the largest that does", () => {
    render(<PlayPanel state={state} now={1} bread={bread()} actions={actions()} />);
    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "4295" } });
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeDisabled();
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, { target: { value: "4294.967296" } });
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "4294.967295" } });
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeEnabled();
    expect(input).toHaveAttribute("aria-invalid", "false");
  });

  it("offers settle once the clock ran out and keys exist", () => {
    const a = actions();
    render(<PlayPanel state={state} now={1_800_000_001} bread={bread()} actions={a} />);
    expect(screen.getByRole("button", { name: "TIME IS UP" })).toBeDisabled();
    expect(screen.getByText(/ANYONE CAN SETTLE/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "SETTLE ROUND" }));
    expect(a.settle).toHaveBeenCalled();
  });

  it("offers a clock restart when the round expired without a key", () => {
    const a = actions();
    render(<PlayPanel state={{ ...state, keys: 0n, leader: null }} now={1_800_000_001} bread={bread()} actions={a} />);
    fireEvent.click(screen.getByRole("button", { name: "RESTART CLOCK" }));
    expect(a.settle).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "SETTLE ROUND" })).toBeNull();
  });

  it("disables settling while disconnected or the round is still open", () => {
    render(<PlayPanel state={state} now={1_800_000_001} bread={bread({ connected: false })} actions={actions()} />);
    expect(screen.getByRole("button", { name: "SETTLE ROUND" })).toBeDisabled();
    render(<PlayPanel state={state} now={1} bread={bread()} actions={actions()} />);
    expect(screen.getAllByRole("button", { name: "SETTLE ROUND" })).toHaveLength(1);
  });

  it("labels my buys against the live round", () => {
    const a = actions({
      buys: [
        buy({ at: 5, noteId: "0xpending", txHash: undefined }),
        buy({ at: 4, noteId: "0xwaiting", priceAtBuy: "1200000" }),
        buy({ at: 3, noteId: "0xlead" }),
        buy({ at: 2, noteId: "0xold", round: 3 }),
      ],
    });
    const { rerender } = render(<PlayPanel state={{ ...state, leader: ME_LEADER }} now={1} bread={bread()} actions={a} />);
    const labels = () => screen.getAllByText(/^(PENDING|LEADING|OUTBID|ENDED|UNCONFIRMED)$/).map((el) => el.textContent);
    expect(labels()).toEqual(["PENDING", "PENDING", "LEADING", "ENDED"]);
    expect(screen.getAllByRole("link", { name: "TX ↗" })).toHaveLength(3);
    rerender(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    expect(labels()).toEqual(["PENDING", "PENDING", "OUTBID", "ENDED"]);
    expect(screen.queryByRole("button", { name: /CLAIM|REFUND/ })).toBeNull();
  });

  it("labels a buy by the outcome its flow observed, not by the live price or leader", () => {
    const a = actions({
      buys: [
        buy({ at: 4, noteId: "0xunconf", priceAtBuy: "1200000", outcome: "unconfirmed" }),
        buy({ at: 3, noteId: "0xled", priceAtBuy: "1200000", outcome: "led" }),
        buy({ at: 2, noteId: "0xended", priceAtBuy: "1000000", outcome: "ended" }),
        buy({ at: 1, noteId: "0xled-old", round: 3, outcome: "led" }),
      ],
    });
    const labels = () => screen.getAllByText(/^(PENDING|LEADING|OUTBID|ENDED|UNCONFIRMED)$/).map((el) => el.textContent);
    const { rerender } = render(<PlayPanel state={{ ...state, leader: ME_LEADER }} now={1} bread={bread()} actions={a} />);
    expect(labels()).toEqual(["UNCONFIRMED", "LEADING", "ENDED", "ENDED"]);
    rerender(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    expect(labels()).toEqual(["UNCONFIRMED", "OUTBID", "ENDED", "ENDED"]);
  });

  it("renders the activity log with explorer links", () => {
    const a = actions({ log: [{ at: 0, text: "Submitted transaction 0xabc", kind: "ok", href: "/t/0xabc" }] });
    render(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    expect(screen.getByText(/Submitted transaction/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "↗" })).toHaveAttribute("href", "/t/0xabc");
  });
});
