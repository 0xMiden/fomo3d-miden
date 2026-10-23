import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/fomo/bread", () => ({
  shortHex: (hex: string) => hex.slice(0, 10),
  explorer: { account: (h: string) => `/a/${h}`, tx: (h: string) => `/t/${h}`, note: (h: string) => `/n/${h}` },
}));

import { PlayPanel } from "../PlayPanel";
import type { Bread } from "@/hooks/useBread";
import type { FomoActions } from "@/hooks/useFomoActions";
import type { GameState } from "@/lib/fomo/types";

const state: GameState = {
  pot: 2_100_000n,
  price: 1_200_000n,
  deadline: 1_800_000_000,
  keys: 2n,
  settled: false,
  leader: "0xleader",
  priceStep: 100_000n,
  extendSeconds: 60,
  capSeconds: 600,
  maxPot: 1_000_000_000n,
};

const bread = (overrides: Partial<Bread> = {}): Bread =>
  ({
    installed: true,
    installUrl: "https://store",
    connected: true,
    connecting: false,
    address: "mtst1abc_q",
    accountHex: "0x" + "ab".repeat(15),
    connect: vi.fn(async () => {}),
    disconnect: vi.fn(async () => {}),
    requestTransaction: vi.fn(),
    waitForTransaction: vi.fn(),
    requestAssets: vi.fn(),
    ...overrides,
  }) as unknown as Bread;

const actions = (overrides: Partial<FomoActions> = {}): FomoActions =>
  ({
    keys: [],
    busy: null,
    log: [],
    balance: 5_000_000n,
    inviteNeeded: false,
    refreshBalance: vi.fn(async () => {}),
    faucet: vi.fn(async () => {}),
    buy: vi.fn(async () => {}),
    settle: vi.fn(async () => {}),
    claim: vi.fn(async () => {}),
    recoverRefund: vi.fn(async () => {}),
    ...overrides,
  }) as unknown as FomoActions;

describe("PlayPanel", () => {
  it("asks for a mainnet access code when the claim wallet is not allowlisted", () => {
    const record = { commitment: "0xleader", secret: ["1"], refundTemplate: "", maxSpend: "1200000", priceAtBuy: "1200000", txHash: "0xtx", at: 1 };
    const a = actions({ inviteNeeded: true, keys: [record] });
    render(<PlayPanel state={{ ...state, settled: true }} now={1} bread={bread()} actions={a} />);
    fireEvent.change(screen.getByLabelText(/ACCESS CODE/), { target: { value: " ABCD1234EFGH " } });
    fireEvent.click(screen.getByRole("button", { name: "REGISTER & CLAIM" }));
    expect(a.claim).toHaveBeenCalledWith(expect.objectContaining({ commitment: "0xleader" }), "ABCD1234EFGH");
  });

  it("asks to install Bread when the extension is missing", () => {
    render(<PlayPanel state={state} now={1} bread={bread({ installed: false, connected: false })} actions={actions()} />);
    expect(screen.getByText(/NOT DETECTED/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /INSTALL BREAD/ })).toHaveAttribute("href", "https://store");
  });

  it("offers connect when installed but disconnected, and disables buying", () => {
    const b = bread({ connected: false });
    render(<PlayPanel state={state} now={1} bread={b} actions={actions()} />);
    fireEvent.click(screen.getByRole("button", { name: "CONNECT BREAD" }));
    expect(b.connect).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeDisabled();
  });

  it("buys with the current price by default and shows the balance", () => {
    const a = actions();
    render(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    expect(screen.getByText("5.00 USDCX")).toBeInTheDocument();
    expect(screen.getByRole("textbox")).toHaveValue("1.2");
    fireEvent.click(screen.getByRole("button", { name: "BUY KEY" }));
    expect(a.buy).toHaveBeenCalledWith(1_200_000n);
    expect(a.refreshBalance).toHaveBeenCalled();
  });

  it("rejects a max spend below the price", () => {
    const a = actions();
    render(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "0.5" } });
    expect(screen.getByRole("button", { name: "BUY KEY" })).toBeDisabled();
    expect(screen.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  });

  it("shows settle once the clock ran out and keys exist", () => {
    const a = actions();
    render(<PlayPanel state={state} now={1_800_000_001} bread={bread()} actions={a} />);
    expect(screen.getByRole("button", { name: "TIME IS UP" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "SETTLE ROUND" }));
    expect(a.settle).toHaveBeenCalled();
  });

  it("labels my keys and offers the claim to the winner after settlement", () => {
    const a = actions({
      keys: [
        { commitment: "0xLEADER", secret: ["1", "2", "3", "4"], refundTemplate: "", maxSpend: "1200000", priceAtBuy: "1200000", at: 1, txHash: "0xt1" },
        { commitment: "0xloser", secret: ["1", "2", "3", "4"], refundTemplate: "", maxSpend: "1000000", priceAtBuy: "1000000", at: 0, txHash: "0xt0" },
      ],
    });
    render(<PlayPanel state={{ ...state, settled: true }} now={1_800_000_900} bread={bread()} actions={a} />);
    expect(screen.getByText("WINNER")).toBeInTheDocument();
    expect(screen.getByText("OUTBID")).toBeInTheDocument();
    expect(screen.getByText(/ROUND SETTLED. PRIZE: 2.10 USDCX/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "CLAIM PRIZE" }));
    expect(a.claim).toHaveBeenCalledWith(expect.objectContaining({ commitment: "0xLEADER" }), undefined);
    fireEvent.click(screen.getByRole("button", { name: "RECOVER REFUND" }));
    expect(a.recoverRefund).toHaveBeenCalledWith(expect.objectContaining({ commitment: "0xloser" }));
  });

  it("renders the activity log with explorer links", () => {
    const a = actions({ log: [{ at: 0, text: "Submitted transaction 0xabc", kind: "ok", href: "/t/0xabc" }] });
    render(<PlayPanel state={state} now={1} bread={bread()} actions={a} />);
    expect(screen.getByText(/Submitted transaction/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "↗" })).toHaveAttribute("href", "/t/0xabc");
  });
});
