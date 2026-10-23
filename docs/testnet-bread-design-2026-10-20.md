> Design note from 2026-10-20, before the mainnet work. Paths are given in this repository's layout; `deploy_round` was `deploy_testnet` at the time.

# Fomo3D on Miden: testnet deployment and Bread wallet frontend

Date: 2026-10-20. Status: approved in chat (user: "Bread is already on 1.17.5 and it should work. Please go").

## Goal

Deploy one Fomo3D round on the public Miden testnet and let a person play a full round from the
browser with the Bread wallet extension (1.17.5): fund, buy keys, settle after the deadline, and
claim the prize with the buyer's secret. No mainnet. No real funds. The known limit stays: the
winning buy's public commitment links it to the prize note.

## Constraints and facts established during research

- Testnet node and faucet run 0.17.1. A Rust client pinned to 0.17.0 cannot consume a testnet faucet
  grant (team note `miden-client-0170-cannot-consume-testnet-faucet-notes`). The Rust crate therefore
  moves to protocol/standards/testing 0.17.1, client 0.17.4, sqlite store 0.17.3.
- Testnet services user-deployed network accounts within seconds with no enrollment, provided the
  fee policy manager names the chain fee faucet and the allowlist includes the three default note
  scripts (config, fee sponsorship, P2ID) besides buy and settle. Deploy by consuming a P2ID grant.
- The faucet API is GET-only with CORS `*`. Claim exactly `base_amount` from `/get_metadata`
  (100 USDCx). PoW: `u64_be(sha256(challenge || nonce_be))[0..8] < target`, target 2^43..2^45.
- Bread 1.17.5 uses SDK 0.17.4 and deserializes a dApp's `TransactionRequest` with it. The dApp
  must serialize with 0.17.4 too. Bread hands the dApp `<bech32>_<routing>`; cut at `_` before parsing.
- Bread executes a single-sig account's custom request verbatim (own output notes with custom
  scripts and attachments, advice map, expiration delta, input notes). The `address` must be the
  connected current account. `inputNoteIds` only marks notes as held; `importNotes` (serialized
  `NoteFile` or `Note` bytes) are imported before execution, so the claim passes an authenticated
  `NoteFile` fetched by the local client. `requestTransaction` returns Bread's internal row id;
  `waitForTransaction` resolves with the on-chain hash once the node accepted the transaction.
  Bread auto-consumes native-asset (USDCx) P2ID notes, so a faucet grant needs no dApp action.
  Delegated proving is on by default (testnet prover).
- Poseidon2 `merge([a, b])` equals `hash_elements(a ++ b)` for exactly eight elements (miden-crypto
  0.35 `algebraic_sponge/mod.rs`: both start from a zero state, absorb eight elements, permute once).
  The browser has only `Poseidon2.hashElements`; the Rust side verifies the equivalence in a test.
- Web SDK handles are moved by value: build fresh `Felt`/`Word`/`NoteScript` objects per call,
  read `note.id()` before handing a note to a builder, use `push` on arrays.

## Architecture

```
contracts   Rust: MASM scripts, MockChain test, build + deploy bins
  src/main.rs (fomo3d-masm-build)        compiles scripts, pins claim root, WRITES serialized
                                          NoteScripts + roots.json to frontend/public/fomo3d/
  contracts/src/bin/deploy_round.rs  deploys one round on testnet, writes frontend env
frontend                        React + Vite dashboard; Bread signs and submits
  public/fomo3d/{buy,settle,claim}.bin   precompiled scripts (byte-identical roots to the account allowlist)
```

The browser never compiles MASM. It deserializes the precompiled scripts, so the roots it sends
are the roots the game account allowlists. The in-browser `MidenProvider` client (local keystore
mode, no worker) is used only to read the game account and to build `TransactionRequest`s. Bread
executes, proves and submits every player transaction via `CustomTransaction`.

## Rust changes

1. Pins as above. Re-run `cargo test --test round`; the pinned claim root constant must be unchanged.
2. Add a test `secret_commitment_matches_browser_hash` asserting `Hasher::merge(&[s, EMPTY]) ==
   Hasher::hash_elements(&[s, 0,0,0,0])`.
3. `fomo3d-masm-build` gains an optional output directory argument (default
   `../frontend/public/fomo3d`). It writes `buy.bin`, `settle.bin`, `claim.bin`
   (`NoteScript::to_bytes`, settle carries the claim advice map) and `roots.json`
   `{ "buy": "0x..", "settle": "0x..", "claim": "0x.." }`.
4. `deploy_testnet`:
   - allowlist and fee schedule: buy, settle, P2ID, fee sponsorship, network account config (all 0);
   - faucet funding in Rust: `/get_metadata` → `/pow` → sha256 loop → `/get_tokens`, then wait for the
     grant, verify it carries the chain fee asset, consume it as the deploying transaction;
   - round parameters from env with defaults: `FOMO3D_ROUND_SECONDS=3600` (initial deadline),
     `FOMO3D_EXTEND_SECONDS=60`, `FOMO3D_CAP_SECONDS=600`, `FOMO3D_START_PRICE=1000000`,
     `FOMO3D_PRICE_STEP=100000`, `FOMO3D_MAX_POT=1000000000`;
   - one directory per deploy: `target/fomo3d-testnet/<unix-ts>/` with keystore, store, marker;
     `target/fomo3d-testnet/latest` symlink; the marker refusal goes away;
   - after commit, writes `frontend/.env.local` with `VITE_MIDEN_GAME_ADDRESS`,
     `VITE_MIDEN_RPC_URL=testnet`, `VITE_MIDEN_PROVER=testnet`, and prints explorer links.

## Frontend changes

Dependencies: `@miden-sdk/miden-sdk`, `@miden-sdk/react`, `@miden-sdk/vite-plugin`, `@miden-sdk/create`
0.17.4; `@miden-sdk/miden-wallet-adapter-react` and `-base` 0.17.4; `@noble/hashes` for the PoW worker.
Vitest aliases `@miden-sdk/miden-wallet-adapter-base` to its ESM entry (team note
`miden-wallet-adapter-base-0173-has-no-main-or-exports`).

Providers: `MidenProvider` outside (initializes without a wallet so the public read works),
`MidenFiSignerProvider` inside (testnet network, autoConnect true).

Modules (`src/lib/fomo/`):
- `scripts.ts`: fetch `/fomo3d/*.bin` once, cache bytes, `NoteScript.deserialize` per use; check roots.
- `commitment.ts`: `randomSecret(): bigint[4]` (63-bit values), `commitmentHex(secret)` via
  `Poseidon2.hashElements([s0..s3, 0,0,0,0])`.
- `notes.ts`: `buildBuyNote`, `buildSettleNote` (public, tag `withAccountTarget(game)`,
  `NetworkAccountTarget(game, always)` attachment), `buildRefundRecipient(sender, feeFaucet)` via
  `Note.createP2IDNote` (keeps the full note bytes so a refund can be recovered),
  `buildPrizeNote(game, feeFaucet, pot, leaderHex, claimScript)` (serial = leader word, storage = leader
  word, public, tag 0).
- `requests.ts`: `buyRequest`, `settleRequest` (own output note, expiration delta), `claimRequest`
  (input note + advice map `leader → secret`).
- `game.ts`: `readGameState(client, gameId)` returning pot, price, deadline, keys, settled, leader hex,
  asset faucet id (from `fomo3d::game::asset_id`), config.
- `secrets.ts`: localStorage keyed by game id: `{ commitment, secret[4], refundNote(b64), txId, at }`.
- `faucet.ts` + `pow.worker.ts`: faucet metadata, PoW in a worker with `@noble/hashes` sha256,
  `/get_tokens` for the connected Bread address.
- `bread.ts`: canonical address → `AccountId`, `CustomTransaction` helper, explorer links.

Hooks: `useGameState` (poll every 10 s + manual refresh), `useBread` (connect state, address, balance via
`requestAssets`), `useBuyKey`, `useSettleRound`, `useClaimPrize`, `useFaucet`.

Dashboard: existing retro layout plus a wallet panel (connect, address, USDCx balance, "Get test USDCx"),
a buy panel (price, max spend, Buy key), "my keys" with a LEADER badge when the on-chain leader equals one
of my commitments, Settle (enabled when deadline passed, keys > 0, not settled), Claim prize (enabled when
settled and I hold the leader secret), an activity log with explorer links, and the known-limit signal.

Flow details:
- Buy: price read from chain; max spend defaults to price; note storage = commitment (4 felts) +
  refund recipient digest (4 felts); asset = `(feeFaucet, maxSpend)`. The secret is persisted BEFORE
  `requestTransaction` is called so a wallet success with a lost tx id cannot orphan it.
- Settle: zero-asset settle note from the connected account.
- Claim: reconstruct the prize note from chain state, pass its bytes as `importNotes` and its id as
  `inputNoteIds` in the `CustomTransaction` along with a request that consumes it with the advice map.
  The prize funds the claimant's own fee.
- Polling after each action: wait for Bread's `waitForTransaction`, then poll game state until the
  expected transition (keys+1, settled=1, prize nullifier spent).

## Testing

- Rust: MockChain round test; commitment equivalence test; `cargo run --bin fomo3d-masm-build` writes files.
- Frontend (vitest, jsdom, SDK hooks mocked as in the existing patterns): commitment/storage layout,
  secrets store, PoW verifier, game state decoding, dashboard states (disconnected, connected, leader,
  settled+claimable, errors).
- Live: deploy a round; in Chrome with Bread 1.17.5: connect, faucet, buy twice, wait out the deadline,
  settle, claim; screenshots of each state and explorer links for each transaction.

## Out of scope

Dividends, teams, referrals, airdrops; multi-round scheduling; unlinkable payout; mobile layout polish;
hosting (run with `yarn dev`).
