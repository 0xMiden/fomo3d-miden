/**
 * Mock for @miden-sdk/miden-wallet-adapter-react.
 *
 *   vi.mock("@miden-sdk/miden-wallet-adapter-react", () => import("@/__tests__/mocks/miden-wallet-adapter-react"));
 *
 * Override per test: `vi.mocked(useMidenFiWallet).mockReturnValue({ ...walletState(), connected: true })`.
 */
import { vi } from "vitest";

export const BREAD_ADDRESS = "mtst1qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq_qr7qqq9wr6w";

export const walletState = (overrides: Record<string, unknown> = {}) => ({
  autoConnect: true,
  wallets: [],
  wallet: { adapter: { url: "https://chromewebstore.google.com/" }, readyState: "Installed" },
  address: null as string | null,
  publicKey: null,
  connected: false,
  connecting: false,
  disconnecting: false,
  select: vi.fn(),
  connect: vi.fn(async () => {}),
  disconnect: vi.fn(async () => {}),
  requestTransaction: vi.fn(async () => "wallet-tx-1"),
  waitForTransaction: vi.fn(async () => ({ txHash: "0xabc", outputNotes: [] })),
  requestAssets: vi.fn(async () => []),
  importPrivateNote: vi.fn(async () => "0xnote"),
  requestConsume: vi.fn(async () => "wallet-tx-2"),
  ...overrides,
});

export const useMidenFiWallet = vi.fn(() => walletState());

export const MidenFiSignerProvider = ({ children }: { children: unknown }) => children;
