use std::collections::BTreeSet;

use anyhow::Result;
use miden_protocol::account::component::AccountComponentMetadata;
use miden_protocol::account::{
    AccountBuilder, AccountComponent, AccountType, StorageSlot, StorageSlotName,
};
use miden_protocol::asset::{AssetId, FungibleAsset};
use miden_protocol::note::{NoteRecipient, NoteStorage};
use miden_protocol::transaction::RawOutputNote;
use miden_protocol::vm::AdviceMap;
use miden_protocol::{Felt, Hasher, Word};
use miden_standards::account::auth::{AuthNetworkAccount, SponsorshipPolicy};
use miden_standards::account::fees::{BasicConstantFeePolicy, FeePolicyManager};
use miden_standards::code_builder::CodeBuilder;
use miden_standards::note::{NetworkAccountTarget, NoteExecutionHint};
use miden_standards::testing::note::NoteBuilder;
use miden_testing::{AccountState, Auth, MockChain};

const ROUND: &str = "fomo3d::game::round";
const LEADER: &str = "fomo3d::game::leader";
const CONFIG: &str = "fomo3d::game::config";
const ASSET: &str = "fomo3d::game::asset_id";
const STATUS: &str = "fomo3d::game::status";

fn slot(name: &str, value: Word) -> Result<StorageSlot> {
    Ok(StorageSlot::with_value(StorageSlotName::new(name)?, value))
}

#[tokio::test]
async fn one_buy_moves_funds_and_updates_round() -> Result<()> {
    let claim_script = CodeBuilder::default().compile_note_script(include_str!("../claim.masm"))?;
    assert_eq!(
        Word::from(claim_script.root()),
        Word::from(
            [
                13670824056742442059u64,
                8519043806234772049,
                11701870701898986077,
                9902604766490393369
            ]
            .map(Felt::new_unchecked)
        ),
        "MASM game claim root must match the script"
    );
    let mut claim_advice = AdviceMap::default();
    claim_advice.insert(Word::from(claim_script.root()), claim_script.to_elements());
    let game_code = CodeBuilder::default()
        .compile_component_code("fomo3d::game", include_str!("../game.masm"))?
        .with_advice_map(claim_advice.clone());
    let buy_script = CodeBuilder::default()
        .with_dynamically_linked_package(game_code.as_ref())?
        .compile_note_script(include_str!("../buy.masm"))?;
    let buy_root = buy_script.root();
    let settle_script = CodeBuilder::default()
        .with_dynamically_linked_package(game_code.as_ref())?
        .compile_note_script(include_str!("../settle.masm"))?
        .with_advice_map(claim_advice);
    let settle_root = settle_script.root();

    let mut builder = MockChain::builder();
    let sender = builder.add_existing_wallet(Auth::default())?;
    let claimant = builder.add_existing_wallet(Auth::default())?;
    let faucet = builder.add_existing_basic_faucet(Auth::default(), "TST", 1_000_000_000, None)?;
    let asset_id = AssetId::new_fungible(faucet.id());

    let game_component = AccountComponent::new(
        game_code,
        vec![
            slot(ROUND, Word::from([0u32, 100, 1_700_000_195, 0]))?,
            slot(LEADER, Word::from([0u32; 4]))?,
            slot(CONFIG, Word::from([10u32, 30, 200, 1_000_000]))?,
            slot(ASSET, asset_id.to_word())?,
            slot(STATUS, Word::from([0u32; 4]))?,
        ],
        AccountComponentMetadata::mock("fomo3d::game"),
    )?;

    let mut fee_policy = BasicConstantFeePolicy::new()
        .with_fee(buy_root, 0u64.try_into()?)
        .with_fee(settle_root, 0u64.try_into()?);
    for root in AuthNetworkAccount::default_allowed_note_scripts() {
        fee_policy = fee_policy.with_fee(root, 0u64.try_into()?);
    }
    let fee_manager = FeePolicyManager::builder()
        .fee_faucet_id(faucet.id())
        .active_fee_policy(fee_policy.into())
        .build();
    let game = builder.add_account_from_builder(
        Auth::NetworkAccount {
            allowed_script_roots: BTreeSet::from([buy_root, settle_root]),
            allowed_tx_script_roots: BTreeSet::new(),
            fee_policy_manager: fee_manager,
            sponsorship_policy: SponsorshipPolicy::default(),
        },
        AccountBuilder::new([42u8; 32])
            .account_type(AccountType::Public)
            .with_component(game_component),
        AccountState::Exists,
    )?;

    let make_buy = |amount: u64, marker: u32| -> Result<_> {
        let secret = Word::from([marker, 22, 33, 44]);
        let payout = Hasher::merge(&[secret, Word::empty()]);
        let refund = Word::from([marker + 100, 66, 77, 88]);
        let storage = payout
            .iter()
            .chain(refund.iter())
            .copied()
            .collect::<Vec<Felt>>();
        Ok(NoteBuilder::new(sender.id(), rand::rng())
            .script(buy_script.clone())
            .note_storage(storage)?
            .add_assets([FungibleAsset::new(faucet.id(), amount)?.into()])
            .attachment(NetworkAccountTarget::new(
                game.id(),
                NoteExecutionHint::Always,
            )?)
            .build()?)
    };
    let note = make_buy(100, 11)?;
    let underpriced = make_buy(100, 12)?;
    let overpaid = make_buy(130, 13)?;
    let late = make_buy(120, 14)?;
    let settle_note = NoteBuilder::new(sender.id(), rand::rng())
        .script(settle_script)
        .attachment(NetworkAccountTarget::new(
            game.id(),
            NoteExecutionHint::Always,
        )?)
        .build()?;
    for n in [&note, &underpriced, &overpaid, &late, &settle_note] {
        builder.add_output_note(RawOutputNote::Full(n.clone()));
    }
    let mut chain = builder.build()?;
    let tx = chain
        .build_transaction(game.id())
        .authenticated_input_note(note.id())
        .build()?;
    let executed = tx.execute().await?;
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;

    let round = chain
        .committed_account(game.id())?
        .storage()
        .get(&StorageSlotName::new(ROUND)?)
        .unwrap()
        .value();
    assert_eq!(round[0].as_canonical_u64(), 100);
    assert_eq!(round[1].as_canonical_u64(), 110);
    assert_eq!(round[2].as_canonical_u64(), 1_700_000_200);
    assert_eq!(round[3].as_canonical_u64(), 1);

    let tx = chain
        .build_transaction(game.id())
        .authenticated_input_note(underpriced.id())
        .build()?;
    let executed = tx.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 1);
    assert_eq!(
        executed
            .output_notes()
            .get_note(0)
            .assets()
            .iter_fungible()
            .next()
            .unwrap()
            .amount()
            .as_u64(),
        100
    );
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = chain
        .committed_account(game.id())?
        .storage()
        .get(&StorageSlotName::new(ROUND)?)
        .unwrap()
        .value();
    assert_eq!(round[3].as_canonical_u64(), 1);

    let tx = chain
        .build_transaction(game.id())
        .authenticated_input_note(overpaid.id())
        .build()?;
    let executed = tx.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 1);
    assert_eq!(
        executed
            .output_notes()
            .get_note(0)
            .assets()
            .iter_fungible()
            .next()
            .unwrap()
            .amount()
            .as_u64(),
        20
    );
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = chain
        .committed_account(game.id())?
        .storage()
        .get(&StorageSlotName::new(ROUND)?)
        .unwrap()
        .value();
    assert_eq!(round[0].as_canonical_u64(), 210);
    assert_eq!(round[1].as_canonical_u64(), 120);
    assert_eq!(round[3].as_canonical_u64(), 2);
    assert!(round[2].as_canonical_u64() <= 1_700_000_220);
    assert_eq!(
        chain
            .committed_account(game.id())?
            .vault()
            .get_balance(asset_id)?
            .as_u64(),
        210
    );

    chain.prove_next_block_at(1_700_000_301)?;
    let tx = chain
        .build_transaction(game.id())
        .authenticated_input_note(late.id())
        .build()?;
    let executed = tx.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 1);
    assert_eq!(
        executed
            .output_notes()
            .get_note(0)
            .assets()
            .iter_fungible()
            .next()
            .unwrap()
            .amount()
            .as_u64(),
        120
    );
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = chain
        .committed_account(game.id())?
        .storage()
        .get(&StorageSlotName::new(ROUND)?)
        .unwrap()
        .value();
    assert_eq!(round[3].as_canonical_u64(), 2);

    let tx = chain
        .build_transaction(game.id())
        .authenticated_input_note(settle_note.id())
        .add_advice_map_entry(Word::from(claim_script.root()), claim_script.to_elements())
        .build()?;
    let executed = tx.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 1);
    let winner_secret = Word::from([13u32, 22, 33, 44]);
    let winner_commitment = Hasher::merge(&[winner_secret, Word::empty()]);
    assert_eq!(
        chain
            .committed_account(game.id())?
            .storage()
            .get(&StorageSlotName::new(LEADER)?)
            .unwrap()
            .value(),
        winner_commitment
    );
    let claim_recipient = NoteRecipient::new(
        winner_commitment,
        claim_script.clone(),
        NoteStorage::new(winner_commitment.iter().copied().collect())?,
    );
    assert_eq!(
        executed.output_notes().get_note(0).recipient_digest(),
        claim_recipient.digest()
    );
    assert_ne!(
        executed.output_notes().get_note(0).recipient_digest(),
        winner_commitment
    );
    assert_eq!(
        executed
            .output_notes()
            .get_note(0)
            .assets()
            .iter_fungible()
            .next()
            .unwrap()
            .amount()
            .as_u64(),
        210
    );
    let prize = match executed.output_notes().get_note(0) {
        RawOutputNote::Full(note) => note.clone(),
        RawOutputNote::Partial(_) => anyhow::bail!("public prize note was not fully materialized"),
    };
    assert_eq!(
        &overpaid.recipient().storage().items()[..4],
        prize.recipient().storage().items(),
        "the public winning buy remains linked to the public prize"
    );
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    assert_eq!(
        chain
            .committed_account(game.id())?
            .vault()
            .get_balance(asset_id)?
            .as_u64(),
        0
    );

    let wrong_secret = Word::from([999u32, 22, 33, 44]);
    let wrong = chain
        .build_transaction(claimant.id())
        .authenticated_input_note(prize.id())
        .add_advice_map_entry(winner_commitment, wrong_secret.iter().copied().collect())
        .build()?;
    assert!(
        wrong.execute().await.is_err(),
        "wrong secret claimed the prize"
    );

    let claim = chain
        .build_transaction(claimant.id())
        .authenticated_input_note(prize.id())
        .add_advice_map_entry(winner_commitment, winner_secret.iter().copied().collect())
        .build()?;
    let claimed = claim.execute().await?;
    chain.add_pending_executed_transaction(&claimed)?;
    chain.prove_next_block()?;
    assert_eq!(
        chain
            .committed_account(claimant.id())?
            .vault()
            .get_balance(asset_id)?
            .as_u64(),
        210
    );
    Ok(())
}
