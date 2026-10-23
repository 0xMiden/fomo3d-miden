# Fomo3D on Miden

This is a Fomo3D homage on Miden. The game account and note scripts are written in Miden Assembly. Rust builds and tests the scripts and deploys a round on testnet or mainnet. React renders a retro dashboard that plays the round through the Bread wallet extension. The winning buy is public (see below); on mainnet that is real money at your own risk.

The original contract used for analysis is FoMo3Dlong at `0xA62142888ABa8370742bE823c1782D17A0389Da1`. See [its verified Etherscan source](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code). The app omits the original dividends, teams, referrals, and airdrop. It implements a rising key price, a timer, and a last buyer payout.

**The winning buy remains public.** The new buy carries a secret commitment instead of a payout recipient digest. Settlement creates a public prize note locked by that secret. A separate account can redeem it in MockChain. The public commitment still links the prize to the winning buy. This prototype does not meet the original strict unlinkability goal. A note recipient commits to its script, storage, and serial number. See [`recipient.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/recipient.rs).

The original task says to stop if the payout cannot be unlinkable. That condition is met. A testnet round is deployed anyway as a playable prototype, with that limit stated on screen.

## What works

- `contracts/game.masm` holds public round state. `buy.masm` and `settle.masm` are public network note scripts.
- One accepted buy purchases one key at the price when the note is consumed. A higher maximum returns change. A lower maximum returns in full. Each key extends the timer up to its cap.
- Settlement creates a public bearer prize note for the full pot. The MockChain test checks the round transitions, rejects a wrong secret, and redeems the note with a different account. It also shows the winning commitment remains public.
- `contracts/src/bin/validate_local.rs` creates a game account and three private players. It funds them with local test USDCx. It runs three buys, settlement, and a secret claim. This full flow completed on a pinned v0.17.0 local node. The claim transaction committed. The network builder recorded zero failed or deferred game notes.
- `contracts/src/bin/deploy_round.rs` deploys one round on testnet or mainnet (`FOMO3D_NETWORK`). It funds the game account from the testnet faucet, or from any USDCx note sent to the printed address, and writes the network and game address into `frontend/.env.local`.
- `frontend/` is a v0.17.4 dashboard. It reads the public game account with a local client and plays through the Bread wallet extension (1.17.5): faucet funding, buy, settle, prize claim with the secret, and refund recovery. Buy and settle notes are built in the browser and executed, proven and submitted by Bread as custom transactions. The claim runs in the browser's own local client (see step 5 below), because Bread executes an unauthenticated custom request only when it is a bare own-output-notes request.

## Test the MASM game

Install Rust. Then run:

```bash
cargo test --manifest-path contracts/Cargo.toml --test round
```

Build the scripts in memory and print their roots:

```bash
cargo run --manifest-path contracts/Cargo.toml --bin fomo3d-masm-build
```

## Run a local round

Start a v0.17.0 local node with the USDCx funding service. The [pinned node Compose file at `77e9c717fb16217fad2ba8b6b9fa28dd73211f2c`](https://github.com/0xMiden/node/blob/77e9c717fb16217fad2ba8b6b9fa28dd73211f2c/docker-compose.yml) defines the services. The [local development guide at the same commit](https://github.com/0xMiden/node/blob/77e9c717fb16217fad2ba8b6b9fa28dd73211f2c/docs/external/src/local-network-development.md) explains setup. The runner expects RPC at `127.0.0.1:57291` and funding at `127.0.0.1:50401`.

The node's default block interval is three seconds. The v0.17 fee manager limits transaction expiry to 20 blocks. Local proving exceeded that window on this machine. A ten second local block interval let the round complete. See [`DEFAULT_BLOCK_INTERVAL` in node `77e9c717fb16217fad2ba8b6b9fa28dd73211f2c`](https://github.com/0xMiden/node/blob/77e9c717fb16217fad2ba8b6b9fa28dd73211f2c/crates/block-producer/src/lib.rs) and [`DEFAULT_EXPIRATION_BLOCK_DELTA` in protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-standards/asm/standards/expiration.masm).

Run the local validator:

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem cargo run --manifest-path contracts/Cargo.toml --bin validate_local
```

`SSL_CERT_FILE` was needed on the test Mac. The script creates new local accounts on each run. It never targets mainnet.

To repeat the read-only public testnet compatibility probe, run `cargo run --manifest-path contracts/Cargo.toml --bin probe_testnet`. This does not create accounts or submit transactions.

## Deploy a round on testnet

The Rust crate pins protocol and standards 0.17.1 with client 0.17.4. A 0.17.0 client cannot consume a testnet faucet grant. Both public networks run node 0.18.0 (testnet since 2026-10-22); the 0.17.4 client and web SDK work against it and the deploy accepts 0.17 and 0.18 nodes. Export the compiled note scripts for the browser first, then deploy:

```bash
cargo run --manifest-path contracts/Cargo.toml --bin fomo3d-masm-build
SSL_CERT_FILE=/etc/ssl/cert.pem cargo run --manifest-path contracts/Cargo.toml --bin deploy_round
```

For a round people will join later, give the first deadline a long window (`FOMO3D_ROUND_SECONDS=86400`): the first accepted key collapses the deadline to block time plus the cap (ten minutes), so the long window costs nothing.

The build binary writes `frontend/public/fomo3d/{buy,settle,claim}.bin` and `roots.json`. The browser deserializes these instead of compiling MASM, so the roots it sends are the roots the account allowlists.

The deploy creates a fresh game account, claims the faucet's full grant for it (the grant pays the network transaction fees), consumes the grant as the deploying transaction, and writes `frontend/.env.local`. Each run lives in `contracts/target/fomo3d-<network>/<timestamp>/` with a `latest` symlink (`FOMO3D_DEPLOY_DIR` moves the root). Round parameters come from `FOMO3D_ROUND_SECONDS`, `FOMO3D_EXTEND_SECONDS`, `FOMO3D_CAP_SECONDS`, `FOMO3D_START_PRICE`, `FOMO3D_PRICE_STEP` and `FOMO3D_MAX_POT`; the defaults are a one hour first deadline, 60 seconds per key, a ten minute cap, 1 USDCx plus 0.1 per key, and a 1000 USDCx pot ceiling. The faucet answers 503 under load and its challenge expires after about 30 seconds; the deploy retries with a fresh challenge.

## Deploy a round on mainnet

Mainnet is the "cedar" deployment: RPC `rpc.cedar.miden.io`, prover `tx-prover.cedar.miden.io`, explorer `explorer.cedar.miden.io`, status at https://status.cedar.miden.io/. The 0.17 client's `Endpoint::mainnet()` names a host that does not resolve, so the deploy carries the cedar hosts itself. Mainnet creates only allowlisted accounts, but network accounts are exempt, so the game account needs no invite code. There is no faucet: the deploy prints the game's `mm1…` address and waits for a USDCx note.

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem FOMO3D_NETWORK=mainnet FOMO3D_ROUND_SECONDS=86400 FOMO3D_FUND_WAIT_SECONDS=3600 cargo run --manifest-path contracts/Cargo.toml --bin deploy_round
```

When the address prints, send it USDCx from Bread (1 USDCx is plenty; the whole note stays in the game account and pays every network transaction fee of the round, and nothing withdraws it). Bread's send is a recallable P2IDE note, which the game allowlists next to plain P2ID; a game deployed without P2IDE in its allowlist can never consume such a note and the sender has to wait for its reclaim height (Bread sets about seven days). Public or private: the deploy client reads the mainnet note transport as well as the chain. The deploy consumes that note as the deploying transaction and writes `.env.local` with `VITE_MIDEN_NETWORK=mainnet` and the cedar URLs. Each round is a new account; settle is final. Pick the economics with `FOMO3D_START_PRICE`, `FOMO3D_PRICE_STEP` and `FOMO3D_MAX_POT` (base units, 6 decimals); the defaults are real 1 USDCx keys.

Two mainnet facts the dashboard handles: Bread must be a mainnet wallet (the page asks for "mainnet" and Bread refuses a testnet wallet), and the browser's claim wallet is a new regular account, so its first claim asks for a mainnet access code once per browser. The node registers the wallet with it and its funding service pays the new account up to 1 USDCx. There is no server to run: the dashboard is static, the network transaction builder on cedar executes the game account, and the deploy is a one-off per round.

## Run the frontend

```bash
cd frontend
yarn install
yarn test
yarn build
yarn dev
```

Open the printed URL in Chrome with the Bread wallet extension installed and on the same network. The page needs `.env.local` from the deploy (`.env.example` documents every key):

```text
VITE_MIDEN_NETWORK=testnet
VITE_MIDEN_RPC_URL=testnet
VITE_MIDEN_PROVER=testnet
VITE_MIDEN_EXPLORER_URL=https://testnet.midenscan.com
VITE_MIDEN_FAUCET_URL=https://faucet-api.testnet.miden.io
VITE_MIDEN_GAME_ADDRESS=0x...
```

Without an address, the page labels its numbers as preview data and submits nothing.

Playing a round:

1. Connect Bread. The page shows the connected account and its USDCx balance.
2. Get test USDCx (testnet only; the button is absent where there is no faucet). The page solves the faucet proof of work in a worker and requests the grant for the Bread account. Bread consumes native-asset grants on its own within about a minute.
3. Buy a key. The page draws a secret, stores it in this browser's local storage, and asks Bread to publish a public buy note carrying the secret commitment, a private refund recipient and the maximum spend. The network account consumes the note; the page polls until the key count moves and marks the key LEADING when the on-chain leader equals its commitment.
4. When the clock runs out, anyone can settle. The page asks Bread to publish a zero-asset settle note.
5. The winner claims. The page rebuilds the public prize note, fetches it with its inclusion proof through the local client, and consumes it with the secret in the advice map from a private single-sig claimant wallet that lives in the browser's local client (created on first claim, id remembered in local storage). On mainnet the node creates only allowlisted accounts, so the first claim from a browser asks for a mainnet access code and registers the claimant with it before the claim. The prize funds that fee. The claimant then forwards the rest to the Bread account as a public P2ID note, which Bread consumes on its own. Bread cannot run the claim itself: a Bread account needs auth arguments the wallet derives only for bare own-output-notes requests, and its error reads "Custom requests without authentication currently support only own output notes". A custom request may not carry anything else either, not even an expiration delta, or the same error appears.

A buy that arrives below the current price, or after the deadline, is refunded as a private note to the buyer. The key shows OUTBID and offers RECOVER REFUND, which rebuilds the refund note from the stored template, imports it into Bread as a private note and asks Bread for its own consume transaction. This path is not yet exercised live.

## Limits and open questions

`ANALYSIS.md` covers the verified original mechanics and pinned v0.17 sources. `DESIGN.md` covers the operator threat model and a v2 dividend idea. Both list open questions. Unknown network details are marked **UNVERIFIED**. Strict unlinkability remains blocked. The secret claim passes MockChain and local-node validation; the testnet browser flow (Bread buy, Bread settle, local-client claim) was run live on testnet on 2026-10-22 (round `0x28e15492e36e379149df97fef9967b`). Secrets live in the browser's local storage only. Losing one makes a winning prize unclaimable. Anyone who reads it can claim the prize. Refund recovery assumes the game tags refund notes with 0, which the MASM does; a buy whose refund is never found is reported as such and nothing is submitted.
