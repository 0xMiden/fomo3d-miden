# Fomo3D on Miden

This is a Fomo3D homage on Miden. The game account and note scripts are written in Miden Assembly. Rust builds and tests the scripts and deploys a round on testnet or mainnet. React renders a retro dashboard that plays the round through the Bread wallet extension. The winning buy is public (see below); on mainnet that is real money at your own risk.

The original contract used for analysis is FoMo3Dlong at `0xA62142888ABa8370742bE823c1782D17A0389Da1`. See [its verified Etherscan source](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code). The app omits the original dividends, teams, referrals, and airdrop. It implements a rising key price, a timer, and a last buyer payout.

**The winning buy is public, and so is the winner.** Buy notes are public network notes and their metadata names the sender, so the winning account is visible on chain whatever the prize looks like. The game therefore keeps it simple: the sender of the last accepted buy is the leader, and settlement pays the whole pot to that account as a public P2ID note. The winner's wallet consumes it on its own; there is no secret, nothing to claim, and nothing to lose. An earlier version locked the prize behind a secret commitment, which hid the claim but not the winning buy, and on mainnet forced every player through an invite-coded claim wallet. That design did not meet the original strict unlinkability goal either (a note recipient commits to its script, storage, and serial number, see [`recipient.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/recipient.rs)), so the limit is stated on screen instead.

**The game never ends.** Settlement pays the leader and immediately opens the next round in the same account: pot zero, price back to the start price, a fresh first window. One deployed account serves every round; with no key sold, settling after the deadline only restarts the clock.

## What works

- `contracts/game.masm` holds public round state. `buy.masm` and `settle.masm` are public network note scripts.
- One accepted buy purchases one key at the price when the note is consumed. A higher maximum returns change. A lower maximum returns in full. Each key extends the timer up to its cap.
- Change above the price, a buy below the price and a buy after the deadline all come back to the buyer as public P2ID notes the buyer's wallet consumes on its own. Settlement pays the pot to the leader the same way and reopens the round. The MockChain test (`contracts/tests/round.rs`) runs two rounds: accepted and refunded buys, the change note, the prize consumed by the winner's wallet, the reopened round, an early settle refused, and a zero-key restart.
- `contracts/src/bin/validate_local.rs` creates a game account and three private players on a local node, funds them from the local funding service, runs three buys, settlement, and the winner's consumption of the prize. An earlier version of this flow completed on a pinned v0.17.0 local node; the P2ID version is not yet run against a local node.
- `contracts/src/bin/deploy_round.rs` deploys one round on testnet or mainnet (`FOMO3D_NETWORK`). It funds the game account from the testnet faucet, or from any USDCx note sent to the printed address, and writes the network and game address into `frontend/.env.local`.
- `frontend/` is a v0.17.4 dashboard. It reads the public game account with a local client and plays through the Bread wallet extension (1.17.5): faucet funding on testnet, buy, settle. Buy and settle notes are built in the browser and executed, proven and submitted by Bread as custom transactions. Prizes and refunds reach the Bread account as P2ID notes, which Bread consumes without the page's help. Bread executes an unauthenticated custom request only when it is a bare own-output-notes request (no input notes, not even an expiration delta), which is exactly what buy and settle are.

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

The build binary writes `frontend/public/fomo3d/{buy,settle}.bin` and `roots.json`. The browser deserializes these instead of compiling MASM, so the roots it sends are the roots the account allowlists.

The deploy creates a fresh game account, claims the faucet's full grant for it (the grant pays the network transaction fees), consumes the grant as the deploying transaction, and writes `frontend/.env.local`. Each run lives in `contracts/target/fomo3d-<network>/<timestamp>/` with a `latest` symlink (`FOMO3D_DEPLOY_DIR` moves the root). Round parameters come from `FOMO3D_ROUND_SECONDS`, `FOMO3D_EXTEND_SECONDS`, `FOMO3D_CAP_SECONDS`, `FOMO3D_START_PRICE`, `FOMO3D_PRICE_STEP` and `FOMO3D_MAX_POT`; the defaults are a one hour first deadline, 60 seconds per key, a ten minute cap, 1 USDCx plus 0.1 per key, and a 1000 USDCx pot ceiling. The faucet answers 503 under load and its challenge expires after about 30 seconds; the deploy retries with a fresh challenge.

## Deploy a round on mainnet

Mainnet is the "cedar" deployment: RPC `rpc.cedar.miden.io`, prover `tx-prover.cedar.miden.io`, explorer `explorer.cedar.miden.io`, status at https://status.cedar.miden.io/. The 0.17 client's `Endpoint::mainnet()` names a host that does not resolve, so the deploy carries the cedar hosts itself. Mainnet creates only allowlisted accounts, but network accounts are exempt, so the game account needs no invite code. There is no faucet: the deploy prints the game's `mm1…` address and waits for a USDCx note.

```bash
SSL_CERT_FILE=/etc/ssl/cert.pem FOMO3D_NETWORK=mainnet FOMO3D_ROUND_SECONDS=86400 FOMO3D_FUND_WAIT_SECONDS=3600 cargo run --manifest-path contracts/Cargo.toml --bin deploy_round
```

When the address prints, send it USDCx from Bread (1 USDCx is plenty; the whole note stays in the game account and pays every network transaction fee of the round, and nothing withdraws it). Bread's send is a recallable P2IDE note, which the game allowlists next to plain P2ID; a game deployed without P2IDE in its allowlist can never consume such a note and the sender has to wait for its reclaim height (Bread sets about seven days). Public or private: the deploy client reads the mainnet note transport as well as the chain. The deploy consumes that note as the deploying transaction and writes `.env.local` with `VITE_MIDEN_NETWORK=mainnet` and the cedar URLs. Settle reopens the next round in the same account, so one deploy serves every round; the fee reserve shrinks a little per network transaction and anyone can top it up by sending USDCx to the game address (such notes go into the vault, never into the pot). Pick the economics with `FOMO3D_START_PRICE`, `FOMO3D_PRICE_STEP` and `FOMO3D_MAX_POT` (base units, 6 decimals); the defaults are real 1 USDCx keys.

Bread must be a mainnet wallet: the page asks for "mainnet" and Bread refuses a testnet wallet with a message the page shows. Players need no invite code beyond the one their Bread account already used; only account creation is gated on mainnet and the game creates none. There is no server to run: the dashboard is static, the network transaction builder on cedar executes the game account, and the deploy happens once.

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
3. Buy a key. The page asks Bread to publish a public buy note carrying the maximum spend; nothing else is in it. The network account consumes the note; the page polls until the key count moves and marks the buy LEADING when the on-chain leader is the connected account. Change above the price, or the whole amount when the buy came too late or too low, returns as a P2ID note that Bread picks up on its next sync.
4. When the clock runs out, anyone can settle. The page asks Bread to publish a zero-asset settle note. The pot goes to the leader as a P2ID note, Bread consumes it, and the next round is already open on the same page.

Buys are remembered in this browser's local storage only for the "my buys" list; nothing in it is needed to receive money.

## Limits and open questions

`ANALYSIS.md` covers the verified original mechanics and pinned v0.17 sources. `DESIGN.md` covers the operator threat model and a v2 dividend idea. Both list open questions. Unknown network details are marked **UNVERIFIED**. Strict unlinkability remains blocked; the winner is public by design now. The operator of the network transaction builder decides the order in which buy notes are consumed, which decides who wins a close finish. The P2ID design passes the MockChain round test; the earlier secret-claim design was played live on testnet on 2026-10-22 and on mainnet on 2026-10-23.
