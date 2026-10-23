# Private Fomo3D analysis

This document uses the verified FoMo3Dlong contract at
`0xA62142888ABa8370742bE823c1782D17A0389Da1`.
The [Etherscan contract page](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code) identifies the address.
The [Sourcify full match](https://repo.sourcify.dev/contracts/full_match/1/0xA62142888ABa8370742bE823c1782D17A0389Da1/metadata.json) supplies the verified source used here.

## Original mechanics

The original computes keys from a nonlinear `keys(eth)` function. `keysRec` takes the difference before and after a purchase. See [FoMo3Dlong source, `F3DKeysCalcLong`](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code).

The timer starts at one hour. Each whole key adds 30 seconds. The deadline is capped at 24 hours from the current time. See [FoMo3Dlong source, `rndInit_`, `rndInc_`, `rndMax_`, and `updateTimer`](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code).

The final buyer receives 48% of the pot. Other shares fund general dividends, P3D, community rewards, and the next round. Team choice changes parts of this split. See [FoMo3Dlong source, `endRound` and constructor team tables](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code).

Purchases also allocate general dividends through masks. Team choice changes purchase fees. Referrals take a share when a valid affiliate exists. An airdrop uses a tracker and an on-chain draw. See [FoMo3Dlong source, `distributeInternal`, `distributeExternal`, `updateMasks`, and `airdrop`](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code).

The rising price, countdown, last buyer, and pot payout form the game loop. Dividends, teams, referrals, and airdrops add incentives and social effects. This classification is a design judgment.

## Shared state and time on Miden v0.17

A public network account can consume public notes addressed to it. The standard target check verifies the active account against the note target. See [`notes/network_account_config.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-standards/asm/standards/notes/network_account_config.masm).

The v0.17 network transaction builder selects pending public notes. Its available-note query has no `ORDER BY`. A first seen ordering rule is not enforced by that query. See [`available_notes.sql` at node `77e9c717fb16217fad2ba8b6b9fa28dd73211f2c`](https://github.com/0xMiden/node/blob/77e9c717fb16217fad2ba8b6b9fa28dd73211f2c/bin/ntx-builder/src/db/queries/available_notes/available_notes.sql).

Creation to consumption latency is variable. A guaranteed upper bound is **UNVERIFIED**. The failed-note retry and reclaim behavior for this exact app is **UNVERIFIED**.

MASM exposes `tx::get_block_timestamp`. The source warns that an executor can choose an older reference block. A strict wall-clock countdown therefore depends on the sequencer's block choice. See [`tx.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/asm/protocol/src/tx.masm). Exact timestamp granularity and tolerated drift are **UNVERIFIED**.

## Assets and privacy

The standard basic wallet can move note assets into the account and move an account asset into an output note. See [`wallets/basic.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-standards/asm/standards/wallets/basic.masm).

An output note can be created with a caller-supplied recipient digest. See [`output_note.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/asm/protocol/src/output_note.masm).

That alone does not hide the winner. In the first prototype, the public buy exposed its payout recipient digest. The payout note's details commitment was derived from that digest and its assets. An observer could match them. See [`note_details_commitment.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/note_details_commitment.rs) and [`notes.rs` at the same commit](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/transaction/outputs/notes.rs). The new bearer prize uses a secret commitment instead. Its public commitment still links the winning buy and prize.

Issuing a separate key asset from the game account is **UNVERIFIED**. The first build records key counts in public storage.

## Language and storage

The v0.17 standards include MASM account procedures and note scripts. See [`wallets/basic.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-standards/asm/standards/wallets/basic.masm). The Rust compiler's suitability for this exact network account design is **UNVERIFIED**. MASM is selected by the user's later instruction.

The prototype stores the round amount, deadline, price, key count, leader secret commitment, asset ID, limits, and settlement status. A future payout fraction would also need storage. Storage limits for this exact account shape are **UNVERIFIED**. Code upgrade is unavailable under the supplied partner mainnet assumptions.

## Open questions

- Can a private claim prove leadership without publishing a matching payout commitment?
- What retry and reclaim path exists for a buy note that fails after a price change?
- What block timestamp drift does the partner sequencer permit?
- What exact network fee policy will pay for buy and settle transactions?
- Can an independently checkable note queue order be enforced by network account code?
