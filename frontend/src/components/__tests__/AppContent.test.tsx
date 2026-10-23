import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@miden-sdk/react", () => import("@/__tests__/mocks/miden-sdk-react"));
vi.mock("@miden-sdk/miden-wallet-adapter-react", () => import("@/__tests__/mocks/miden-wallet-adapter-react"));
vi.mock("@miden-sdk/miden-sdk", () => import("@/__tests__/mocks/miden-sdk"));
vi.mock("@miden-sdk/miden-wallet-adapter-base", () => ({
  WalletReadyState: { Installed: "Installed", Loadable: "Loadable" },
  Transaction: { createCustomTransaction: vi.fn() },
}));

import { AppContent } from "../AppContent";

describe("AppContent", () => {
  it("labels unconfigured round data as a preview and explains how to go live", () => {
    render(<AppContent />);
    expect(screen.getByText(/PREVIEW DATA/)).toBeInTheDocument();
    expect(screen.getAllByText(/VITE_MIDEN_GAME_ADDRESS/).length).toBeGreaterThan(0);
    expect(screen.getByText(/PREVIEW MODE/)).toBeInTheDocument();
    expect(screen.getByText("TESTNET")).toBeInTheDocument();
  });
});
