import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { FomoDashboard } from "../FomoDashboard";

const state = { pot: 3_300_000n, price: 1_300_000n, deadline: 2_000_000_000, keys: 3n, settled: false, leader: "0x1234567890abcdef" };

describe("FomoDashboard", () => {
  it("shows the pot, price, timer and honest privacy warning", () => {
    render(<FomoDashboard state={state} now={1_999_999_940} mode="live" />);
    expect(screen.getByText("3.30")).toBeInTheDocument();
    expect(screen.getByText("1.30")).toBeInTheDocument();
    expect(screen.getByText("00:01:00")).toBeInTheDocument();
    expect(screen.getByText("WINNING BUY IS PUBLIC")).toBeInTheDocument();
    expect(screen.getByText(/never leaves your browser/)).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
  });

  it("flags time up, the leader and renders the play slot", () => {
    render(<FomoDashboard state={state} now={2_000_000_001} mode="live" isLeader play={<div>PLAY HERE</div>} network="LOCAL NODE" />);
    expect(screen.getByText("TIME UP")).toBeInTheDocument();
    expect(screen.getByText(/YOU HOLD THE LEADING KEY/)).toBeInTheDocument();
    expect(screen.getByText("PLAY HERE")).toBeInTheDocument();
    expect(screen.queryByText(/PREVIEW MODE/)).toBeNull();
    expect(screen.getByText("LOCAL NODE")).toBeInTheDocument();
  });
});
