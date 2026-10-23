import path from "node:path";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // The 0.17 adapter-base package publishes only `module`; vitest's resolver needs the ESM file.
      "@miden-sdk/miden-wallet-adapter-base": path.resolve(
        __dirname,
        "./node_modules/@miden-sdk/miden-wallet-adapter-base/dist/index.js",
      ),
    },
  },
  test: {
    environment: "jsdom",
    // Tests describe the unconfigured preview; a deploy's .env.local must not leak into them.
    env: {
      VITE_MIDEN_GAME_ADDRESS: "",
      VITE_MIDEN_NETWORK: "",
      VITE_MIDEN_RPC_URL: "",
      VITE_MIDEN_PROVER: "",
      VITE_MIDEN_EXPLORER_URL: "",
      VITE_MIDEN_FAUCET_URL: "",
    },
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
    passWithNoTests: true,
    server: {
      deps: {
        // Tests mock the wallet adapter at the module level, so externalizing is safe.
        external: [/@miden-sdk\/miden-wallet-adapter-react/],
      },
    },
  },
});
