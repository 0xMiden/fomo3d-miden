import type { RoundView } from "@/components/FomoDashboard";

/** The round the dashboard shows before a game address is configured or read. */
export const previewState = (): RoundView => ({
  pot: 3_300_000n,
  price: 1_300_000n,
  deadline: Math.floor(Date.now() / 1000) + 8 * 60 + 42,
  keys: 3n,
  round: 1,
});
