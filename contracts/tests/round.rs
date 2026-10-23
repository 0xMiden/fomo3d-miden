use std::collections::BTreeSet;

use anyhow::Result;
use miden_protocol::account::component::AccountComponentMetadata;
use miden_protocol::account::{
    AccountBuilder, AccountComponent, AccountId, AccountType, StorageSlot, StorageSlotName,
};
use miden_protocol::asset::{AssetId, FungibleAsset};
use miden_protocol::note::{Note, NoteTag};
use miden_protocol::transaction::RawOutputNote;
use miden_protocol::Word;
use miden_standards::account::auth::{AuthNetworkAccount, SponsorshipPolicy};
use miden_standards::account::fees::{BasicConstantFeePolicy, FeePolicyManager};
use miden_standards::code_builder::CodeBuilder;
use miden_standards::note::{NetworkAccountTarget, NoteExecutionHint, P2idNote};
use miden_standards::testing::note::NoteBuilder;
use miden_testing::{AccountState, Auth, MockChain};

const ROUND: &str = "fomo3d::game::round";
const LEADER: &str = "fomo3d::game::leader";
const CONFIG: &str = "fomo3d::game::config";
const ASSET: &str = "fomo3d::game::asset_id";
const WINDOW: &str = "fomo3d::game::window";

fn slot(name: &str, value: Word) -> Result<StorageSlot> {
    Ok(StorageSlot::with_value(StorageSlotName::new(name)?, value))
}

fn leader_word(id: AccountId) -> Word {
    Word::from([id.suffix(), id.prefix().as_felt(), 0u32.into(), 0u32.into()])
}

fn slot_value(chain: &MockChain, game: AccountId, name: &str) -> Result<Word> {
    Ok(chain
        .committed_account(game)?
        .storage()
        .get(&StorageSlotName::new(name)?)
        .unwrap()
        .value())
}

fn only_note(executed: &miden_protocol::transaction::ExecutedTransaction) -> Result<Note> {
    assert_eq!(executed.output_notes().num_notes(), 1);
    match executed.output_notes().get_note(0) {
        RawOutputNote::Full(note) => Ok(note.clone()),
        RawOutputNote::Partial(_) => anyhow::bail!("public output note was not fully materialized"),
    }
}

/// The note is a public P2ID to `target` carrying `amount`, tagged so the target's wallet finds it.
fn assert_p2id(note: &Note, target: AccountId, amount: u64) {
    assert_eq!(note.recipient().script().root(), P2idNote::script_root());
    assert_eq!(&note.recipient().storage().items()[..2], &leader_word(target).as_elements()[..2]);
    assert_eq!(note.metadata().tag(), NoteTag::with_account_target(target));
    assert_eq!(note.assets().iter_fungible().next().unwrap().amount().as_u64(), amount);
}

#[tokio::test]
async fn rounds_pay_the_last_buyer_and_reopen() -> Result<()> {
    let game_code = CodeBuilder::default().compile_component_code("fomo3d::game", include_str!("../game.masm"))?;
    let buy_script = CodeBuilder::default()
        .with_dynamically_linked_package(game_code.as_ref())?
        .compile_note_script(include_str!("../buy.masm"))?;
    let buy_root = buy_script.root();
    let settle_script = CodeBuilder::default()
        .with_dynamically_linked_package(game_code.as_ref())?
        .compile_note_script(include_str!("../settle.masm"))?;
    let settle_root = settle_script.root();

    let mut builder = MockChain::builder();
    let alice = builder.add_existing_wallet(Auth::default())?;
    let bob = builder.add_existing_wallet(Auth::default())?;
    let faucet = builder.add_existing_basic_faucet(Auth::default(), "TST", 1_000_000_000, None)?;
    let asset_id = AssetId::new_fungible(faucet.id());

    let game_component = AccountComponent::new(
        game_code,
        vec![
            slot(ROUND, Word::from([0u32, 100, 1_700_000_195, 0]))?,
            slot(LEADER, Word::from([0u32; 4]))?,
            slot(CONFIG, Word::from([10u32, 30, 200, 1_000_000]))?,
            slot(ASSET, asset_id.to_word())?,
            slot(WINDOW, Word::from([1000u32, 100, 1, 0]))?,
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

    let make_buy = |sender: AccountId, amount: u64| -> Result<Note> {
        Ok(NoteBuilder::new(sender, rand::rng())
            .script(buy_script.clone())
            .add_assets([FungibleAsset::new(faucet.id(), amount)?.into()])
            .attachment(NetworkAccountTarget::new(game.id(), NoteExecutionHint::Always)?)
            .build()?)
    };
    let make_settle = |sender: AccountId| -> Result<Note> {
        Ok(NoteBuilder::new(sender, rand::rng())
            .script(settle_script.clone())
            .attachment(NetworkAccountTarget::new(game.id(), NoteExecutionHint::Always)?)
            .build()?)
    };
    let first = make_buy(alice.id(), 100)?;
    let underpriced = make_buy(bob.id(), 100)?;
    let overpaid = make_buy(bob.id(), 130)?;
    let late = make_buy(alice.id(), 120)?;
    let settle_one = make_settle(alice.id())?;
    let next_round_buy = make_buy(alice.id(), 100)?;
    let settle_two = make_settle(bob.id())?;
    let settle_empty = make_settle(bob.id())?;
    for n in [&first, &underpriced, &overpaid, &late, &settle_one, &next_round_buy, &settle_two, &settle_empty] {
        builder.add_output_note(RawOutputNote::Full(n.clone()));
    }
    let mut chain = builder.build()?;

    // Alice buys the first key at 100: pot 100, price 110, deadline +30 (capped by +200), one key.
    let executed = chain.build_transaction(game.id()).authenticated_input_note(first.id()).build()?.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 0);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = slot_value(&chain, game.id(), ROUND)?;
    assert_eq!(round[0].as_canonical_u64(), 100);
    assert_eq!(round[1].as_canonical_u64(), 110);
    assert_eq!(round[2].as_canonical_u64(), 1_700_000_200);
    assert_eq!(round[3].as_canonical_u64(), 1);
    assert_eq!(slot_value(&chain, game.id(), LEADER)?, leader_word(alice.id()));

    // Bob pays 100 below the price of 110: refunded in full to Bob, nothing changes.
    let executed = chain.build_transaction(game.id()).authenticated_input_note(underpriced.id()).build()?.execute().await?;
    assert_p2id(&only_note(&executed)?, bob.id(), 100);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    assert_eq!(slot_value(&chain, game.id(), ROUND)?[3].as_canonical_u64(), 1);
    assert_eq!(slot_value(&chain, game.id(), LEADER)?, leader_word(alice.id()));

    // Bob pays 130 for a 110 key: 20 change back to Bob, Bob leads, pot 210.
    let executed = chain.build_transaction(game.id()).authenticated_input_note(overpaid.id()).build()?.execute().await?;
    let change = only_note(&executed)?;
    assert_p2id(&change, bob.id(), 20);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = slot_value(&chain, game.id(), ROUND)?;
    assert_eq!(round[0].as_canonical_u64(), 210);
    assert_eq!(round[1].as_canonical_u64(), 120);
    assert_eq!(round[3].as_canonical_u64(), 2);
    assert!(round[2].as_canonical_u64() <= 1_700_000_230);
    assert_eq!(slot_value(&chain, game.id(), LEADER)?, leader_word(bob.id()));
    assert_eq!(chain.committed_account(game.id())?.vault().get_balance(asset_id)?.as_u64(), 210);

    // Bob's change note is a plain P2ID his wallet consumes.
    let consumed = chain.build_transaction(bob.id()).authenticated_input_note(change.id()).build()?.execute().await?;
    chain.add_pending_executed_transaction(&consumed)?;
    chain.prove_next_block()?;
    assert_eq!(chain.committed_account(bob.id())?.vault().get_balance(asset_id)?.as_u64(), 20);

    // Alice buys after the deadline: refunded in full.
    chain.prove_next_block_at(1_700_000_301)?;
    let executed = chain.build_transaction(game.id()).authenticated_input_note(late.id()).build()?.execute().await?;
    assert_p2id(&only_note(&executed)?, alice.id(), 120);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    assert_eq!(slot_value(&chain, game.id(), ROUND)?[3].as_canonical_u64(), 2);

    // Settle: the pot goes to Bob as a P2ID note and round 2 opens with the configured window.
    let executed = chain.build_transaction(game.id()).authenticated_input_note(settle_one.id()).build()?.execute().await?;
    let prize = only_note(&executed)?;
    assert_p2id(&prize, bob.id(), 210);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    assert_eq!(chain.committed_account(game.id())?.vault().get_balance(asset_id)?.as_u64(), 0);
    let round = slot_value(&chain, game.id(), ROUND)?;
    assert_eq!(round[0].as_canonical_u64(), 0);
    assert_eq!(round[1].as_canonical_u64(), 100);
    assert!(round[2].as_canonical_u64() >= 1_700_000_301 + 1000);
    assert_eq!(round[3].as_canonical_u64(), 0);
    assert_eq!(slot_value(&chain, game.id(), LEADER)?, Word::from([0u32; 4]));
    assert_eq!(slot_value(&chain, game.id(), WINDOW)?[2].as_canonical_u64(), 2);

    // Bob's wallet consumes the prize with nothing but the note.
    let claimed = chain.build_transaction(bob.id()).authenticated_input_note(prize.id()).build()?.execute().await?;
    chain.add_pending_executed_transaction(&claimed)?;
    chain.prove_next_block()?;
    assert_eq!(chain.committed_account(bob.id())?.vault().get_balance(asset_id)?.as_u64(), 230);

    // Round 2 accepts a key at the start price again.
    let executed = chain.build_transaction(game.id()).authenticated_input_note(next_round_buy.id()).build()?.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 0);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = slot_value(&chain, game.id(), ROUND)?;
    assert_eq!(round[0].as_canonical_u64(), 100);
    assert_eq!(round[3].as_canonical_u64(), 1);
    assert_eq!(slot_value(&chain, game.id(), LEADER)?, leader_word(alice.id()));

    // Settling before the deadline is refused.
    let early = chain.build_transaction(game.id()).authenticated_input_note(settle_two.id()).build()?;
    assert!(early.execute().await.is_err(), "settle before the deadline must fail");

    // Round 2 ends: Alice is paid; round 3 with no keys expires and settle only restarts the clock.
    chain.prove_next_block_at(1_700_002_000)?;
    let executed = chain.build_transaction(game.id()).authenticated_input_note(settle_two.id()).build()?.execute().await?;
    assert_p2id(&only_note(&executed)?, alice.id(), 100);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    assert_eq!(slot_value(&chain, game.id(), WINDOW)?[2].as_canonical_u64(), 3);
    chain.prove_next_block_at(1_700_004_000)?;
    let executed = chain.build_transaction(game.id()).authenticated_input_note(settle_empty.id()).build()?.execute().await?;
    assert_eq!(executed.output_notes().num_notes(), 0);
    chain.add_pending_executed_transaction(&executed)?;
    chain.prove_next_block()?;
    let round = slot_value(&chain, game.id(), ROUND)?;
    assert_eq!(round[3].as_canonical_u64(), 0);
    assert!(round[2].as_canonical_u64() >= 1_700_004_000 + 1000);
    assert_eq!(slot_value(&chain, game.id(), WINDOW)?[2].as_canonical_u64(), 4);
    Ok(())
}
