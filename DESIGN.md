# Fomo3D on Miden: local prototype design

## Status

The original strict private-winner requirement remains blocked. The MASM buy now publishes a secret commitment. Settlement creates a public bearer prize note. The commitment links that note to the winning buy. The public note recipient commits to its script, storage, and serial number. See [`recipient.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/recipient.rs). This prototype is for local testing only.

## v1 rules

The proposed account is a public network account. It holds USDCx, a deadline, a price, a key count, and a leader secret commitment. A public buy note carries USDCx, that commitment, and a refund recipient digest. Network account targeting follows the standard target check. See [`network_account_config.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-standards/asm/standards/notes/network_account_config.masm).

The price rule is a maximum spend. Consumption uses the current price. One key costs that price. A higher maximum returns change to a separate refund recipient. If the current price exceeds the maximum, the entire amount is refunded and the leader stays unchanged. The MASM prototype and MockChain test implement this rule. The new secret claim flow also completed on a local node.

The timer uses the reference block timestamp. Each key adds a configured number of seconds, capped at the current timestamp plus a configured maximum. The sequencer may choose an older reference block. See [`tx.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/asm/protocol/src/tx.masm).

Anyone can submit settlement after expiry. The game creates a public bearer prize note locked by the stored commitment. Output note creation supports a computed recipient digest. See [`output_note.masm` and `note.masm` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/asm/protocol/src/note.masm). The MASM prototype and MockChain test implement settlement and secret redemption. The local-node claim transaction committed.

V1 omits dividends, teams, referrals, and airdrops. The original has each feature. See [FoMo3Dlong verified source, `distributeInternal`, `distributeExternal`, and `airdrop`](https://etherscan.io/address/0xA62142888ABa8370742bE823c1782D17A0389Da1#code).

## Parameters and authority

The MASM prototype stores the asset ID, current price, price step, timer increment, timer cap, pot cap, key count, deadline, leader secret commitment, and settlement flag. One account represents one round. Start price is written into round state at account creation. It has no mutable admin key.

The claim script root is pinned in the MASM game code. The build helper and tests check that it matches the compiled claim script. A changed claim script requires a new game account. The runner never changes account code.

The local runner initializes a 10 USDCx pot cap and pays the full pot to the last buyer. The MockChain test checks both values as raw asset units. A 48% winner share is a future design option. It needs a defined destination for the other 52% and new tests.

No operator rake is planned. No mutable admin key is planned. A pause key could freeze a round. A price setter could change expected returns. A payout setter could steal the pot. An allowlist setter could block buys. Each would reduce trust. These are design judgments.

## Operator threat model

| Operator action | Outside observer can verify | Mitigation | Residual risk |
|---|---|---|---|
| Censor buy notes | Public notes and included transactions can be compared. See [`committed_block.rs` at node `77e9c717fb16217fad2ba8b6b9fa28dd73211f2c`](https://github.com/0xMiden/node/blob/77e9c717fb16217fad2ba8b6b9fa28dd73211f2c/bin/ntx-builder/src/committed_block.rs). | Pot cap. No rake. Optional winner reveal. | A censored last buy cannot be forced into a closed sequencer. |
| Reorder notes | Included order is visible. A public arrival order is **UNVERIFIED**. | Publish a deterministic order rule. | The v0.17 available-note query has no `ORDER BY`. See [`available_notes.sql` at node `77e9c717fb16217fad2ba8b6b9fa28dd73211f2c`](https://github.com/0xMiden/node/blob/77e9c717fb16217fad2ba8b6b9fa28dd73211f2c/bin/ntx-builder/src/db/queries/available_notes/available_notes.sql). The operator can choose which notes enter the queue. |
| Read private state | Public chain data cannot prove who read private state. | Use fresh recipients and optional reveal. | Under the supplied partner phase assumptions, validators can read private account state. |
| Roll back | Observers can compare published chain histories. | Wait for settlement depth. Cap the pot. | The supplied sequencer assumption allows rollback. |
| Insider play | Public buys and payouts can be inspected. | No rake. Lower winner share. Cap the pot. | An insider can buy after seeing pending notes and influence ordering. |

A lower last-buyer share reduces the size of an attack prize. It also weakens the countdown incentive. An optional reveal helps public celebration and audit. It gives up winner privacy when used. These are hypotheses about incentives, not verified network properties.

## v2 private dividend sketch

Hypothesis: aggregate each round's dividend share in a public commitment. Each buyer receives a private claim note with a nullifier. A claim proves key ownership and the per-key amount without exposing the buyer. Claim verification, note discovery, and preventing linkage to the public buy remain open. No code is planned for v2 yet.

## Privacy repair hypothesis

The first prototype published a P2ID payout recipient digest in the buy. The later payout reused it. This gave an exact recipient match. See [`note_details_commitment.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/note_details_commitment.rs).

The MASM prototype now uses `C = Poseidon2(secret, empty_word)`. Each buyer generates a fresh secret. The buy publishes `C` and no personal prize recipient. Settlement creates a public prize note locked to `C`. The claim script checks a secret supplied through the transaction advice map. A different account redeems the note in MockChain. This claim flow is a local prototype. A note recipient commits to its script, storage, and serial number. See [`recipient.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/recipient.rs). The account computes an output recipient from note storage and a fixed claim script root. See [`note.masm` at the same commit](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/asm/protocol/src/note.masm).

This is not yet a privacy solution. The prize note and the winning buy remain publicly associated with the round. The buy note also has a sender field. See [`metadata.rs` at protocol `cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14`](https://github.com/0xMiden/protocol/blob/cf839f0e36c670da6fbca6f85c5f78e2bbcf8b14/crates/miden-protocol/src/note/metadata.rs). Fresh funding accounts could reduce public identity links, but their unlinkability is **UNVERIFIED**. Payout account privacy is **UNVERIFIED**. The supplied partner assumption that validators can read private account state remains a separate limit.

Strict unlinkability between a unique round payout and its public winning buy is not attainable in this public last-buyer design. That is a logical consequence of its public winner selection. A shared shielded payout pool could obscure the eventual recipient if it has independent users, common denominations, and delayed withdrawals. Its v0.17 implementation and anonymity properties are **UNVERIFIED**. No public deployment should rely on this hypothesis before a full local adversarial test.

## Open questions

- Can a private-claim construction satisfy strict unlinkability on v0.17?
- How can failed public network notes refund a buyer without relying on the operator?
- Which v0.17 network account fee policy works with a zero-rake pot?
- Can queue ordering be proved from public commitments?
- What timestamp drift and finality policy apply on partner mainnet?
