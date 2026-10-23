//! Local-only v0.17 MASM game deployment and round validation.

use std::collections::BTreeSet;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{anyhow, Context, Result};
use miden_client::account::{
    Account, AccountBuilder, AccountComponent, AccountId, AccountType, StorageSlot, StorageSlotName,
};
use miden_client::auth::{AuthSecretKey, AuthSingleSig};
use miden_client::builder::ClientBuilder;
use miden_client::keystore::{FilesystemKeyStore, Keystore};
use miden_client::note::NoteFile;
use miden_client::rpc::{Endpoint, GrpcClient};
use miden_client::store::TransactionFilter;
use miden_client::transaction::{TransactionRequestBuilder, TransactionStatus};
use miden_client::Client;
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::account::component::AccountComponentMetadata;
use miden_protocol::asset::{AssetId, FungibleAsset};
use miden_protocol::note::{
    Note, NoteAssets, NoteRecipient, NoteScript, NoteStorage, NoteTag, NoteType,
    PartialNoteMetadata,
};
use miden_protocol::transaction::TransactionId;
use miden_protocol::utils::serde::Deserializable;
use miden_protocol::vm::AdviceMap;
use miden_protocol::{Felt, Hasher, Word};
use miden_standards::account::auth::AuthNetworkAccount;
use miden_standards::account::fees::{BasicConstantFeePolicy, FeePolicyManager};
use miden_standards::account::wallets::BasicWallet;
use miden_standards::code_builder::CodeBuilder;
use miden_standards::note::{
    FeeSponsorshipNote, NetworkAccountTarget, NoteExecutionHint, P2idNote, P2idNoteStorage,
};
use miden_standards::testing::note::NoteBuilder;
use miden_standards::tx_script::{ExpirationTransactionScript, SendWalletNotesTransactionScript};

const GAME: &str = include_str!("../../game.masm");
const BUY: &str = include_str!("../../buy.masm");
const SETTLE: &str = include_str!("../../settle.masm");
const CLAIM: &str = include_str!("../../claim.masm");

fn slot(name: &str, value: Word) -> Result<StorageSlot> {
    Ok(StorageSlot::with_value(StorageSlotName::new(name)?, value))
}

async fn request_funds(target: AccountId, amount: u64) -> Result<Note> {
    let response: serde_json::Value = reqwest::Client::new()
        .post("http://127.0.0.1:50401/request-funds")
        .json(&serde_json::json!({"account_id": target.to_hex(), "amount": amount}))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await?;
    let encoded = response
        .get("note")
        .and_then(|value| value.as_str())
        .ok_or_else(|| anyhow!("funding service omitted note"))?;
    Ok(Note::read_from_bytes(&hex::decode(encoded)?)?)
}

async fn wait_for_note(client: &mut Client<FilesystemKeyStore>, note: &Note) -> Result<()> {
    for _ in 0..45 {
        client.sync_state().await?;
        if client.get_input_note(note.id()).await?.is_some() {
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }
    Err(anyhow!("funding note did not reach the local chain"))
}

async fn wait_for_tx(client: &mut Client<FilesystemKeyStore>, tx_id: TransactionId) -> Result<()> {
    for _ in 0..90 {
        client.sync_state().await?;
        let records = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        if let Some(record) = records.first() {
            match &record.status {
                TransactionStatus::Committed { .. } => return Ok(()),
                TransactionStatus::Discarded(cause) => {
                    return Err(anyhow!("transaction {tx_id} discarded: {cause}"))
                }
                TransactionStatus::Pending => {}
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err(anyhow!("transaction {tx_id} did not commit"))
}

fn game_slot(account: &Account, name: &str) -> Result<Word> {
    let name = StorageSlotName::new(name)?;
    Ok(account
        .storage()
        .get(&name)
        .ok_or_else(|| anyhow!("missing game storage slot"))?
        .value())
}

async fn wait_for_key_count(
    client: &mut Client<FilesystemKeyStore>,
    game_id: AccountId,
    expected: u64,
) -> Result<Account> {
    for _ in 0..60 {
        client.sync_state().await?;
        if let Some(account) = client.get_account(game_id).await? {
            if game_slot(&account, "fomo3d::game::round")?[3].as_canonical_u64() == expected {
                return Ok(account);
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err(anyhow!("network builder did not consume buy note"))
}

async fn create_private_player(
    client: &mut Client<FilesystemKeyStore>,
    keystore: &Arc<FilesystemKeyStore>,
) -> Result<Account> {
    let key = AuthSecretKey::new_falcon512_poseidon2_with_rng(client.rng());
    let account = AccountBuilder::new(rand::random())
        .account_type(AccountType::Private)
        .with_component(AuthSingleSig::from_public_key(key.public_key()))
        .with_component(BasicWallet)
        .build()?;
    client.add_account(&account, false).await?;
    keystore.add_key(&key, account.id()).await?;
    let funding_note = request_funds(account.id(), 3_000_000).await?;
    wait_for_note(client, &funding_note).await?;
    let request = TransactionRequestBuilder::new()
        .expiration_delta(1000)
        .input_notes([(funding_note, None)])
        .build()?;
    let tx = client
        .submit_new_transaction(account.id(), request)
        .await
        .context("fund private player")?;
    wait_for_tx(client, tx).await?;
    Ok(account)
}

async fn submit_buy(
    client: &mut Client<FilesystemKeyStore>,
    player: &Account,
    game_id: AccountId,
    faucet: AccountId,
    script: NoteScript,
    amount: u64,
) -> Result<(Word, Word)> {
    let secret = miden_client::rng::draw_word(client.rng());
    let commitment = Hasher::merge(&[secret, Word::empty()]);
    let refund_serial = miden_client::rng::draw_word(client.rng());
    let refund_salt = miden_client::rng::draw_word(client.rng());
    let refund = P2idNoteStorage::new(player.id())
        .with_salt([refund_salt[0], refund_salt[1]])
        .into_recipient(refund_serial);
    let storage = commitment
        .iter()
        .chain(refund.digest().iter())
        .copied()
        .collect::<Vec<Felt>>();
    let note = NoteBuilder::new(player.id(), client.rng())
        .script(script)
        .tag(NoteTag::with_account_target(game_id).as_u32())
        .note_storage(storage)?
        .add_assets([FungibleAsset::new(faucet, amount)?.into()])
        .attachment(NetworkAccountTarget::new(
            game_id,
            NoteExecutionHint::Always,
        )?)
        .build()?;
    let request = TransactionRequestBuilder::new()
        .expiration_delta(1000)
        .own_output_notes(vec![note])
        .build()?;
    let tx = client.submit_new_transaction(player.id(), request).await?;
    println!("buy published by {}: {}", player.id().to_hex(), tx.to_hex());
    Ok((commitment, secret))
}

#[tokio::main]
async fn main() -> Result<()> {
    let run_dir = PathBuf::from("/private/tmp").join(format!("fomo3d-v017-{}", std::process::id()));
    std::fs::create_dir_all(&run_dir)?;
    let keystore = Arc::new(FilesystemKeyStore::new(run_dir.join("keystore"))?);
    let endpoint = Endpoint::localhost();
    let rpc = Arc::new(GrpcClient::new(&endpoint, 10_000));
    let mut client = ClientBuilder::new()
        .rpc(rpc)
        .sqlite_store(run_dir.join("store.sqlite3"))
        .authenticator(keystore.clone())
        .build()
        .await?;
    client.sync_state().await.context("sync local v0.17 node")?;
    let first = create_private_player(&mut client, &keystore).await?;
    let second = create_private_player(&mut client, &keystore).await?;
    let third = create_private_player(&mut client, &keystore).await?;
    println!("three private player accounts funded on local node");
    let header = client.get_latest_block_header().await?;
    let config = client
        .get_protocol_config(header.protocol_config_commitment())
        .await?;
    let fee_faucet = config.fee_asset_id().faucet_id();
    let asset_id = AssetId::new_fungible(fee_faucet);

    let claim = CodeBuilder::default().compile_note_script(CLAIM)?;
    anyhow::ensure!(
        Word::from(claim.root())
            == Word::from(
                [
                    13670824056742442059u64,
                    8519043806234772049,
                    11701870701898986077,
                    9902604766490393369
                ]
                .map(Felt::new_unchecked)
            ),
        "claim script root differs from pinned MASM game constant"
    );
    let mut claim_advice = AdviceMap::default();
    claim_advice.insert(Word::from(claim.root()), claim.to_elements());
    let component_code = CodeBuilder::default()
        .compile_component_code("fomo3d::game", GAME)?
        .with_advice_map(claim_advice.clone());
    let buy = CodeBuilder::default()
        .with_dynamically_linked_package(component_code.as_ref())?
        .compile_note_script(BUY)?;
    let settle = CodeBuilder::default()
        .with_dynamically_linked_package(component_code.as_ref())?
        .compile_note_script(SETTLE)?
        .with_advice_map(claim_advice);

    let game_component = AccountComponent::new(
        component_code,
        vec![
            slot(
                "fomo3d::game::round",
                Word::from([0u32, 1_000_000, header.timestamp() + 300, 0]),
            )?,
            slot("fomo3d::game::leader", Word::empty())?,
            slot(
                "fomo3d::game::config",
                Word::from([100_000u32, 20, 300, 10_000_000]),
            )?,
            slot("fomo3d::game::asset_id", asset_id.to_word())?,
            slot("fomo3d::game::status", Word::empty())?,
        ],
        AccountComponentMetadata::new("fomo3d::game"),
    )?;
    let fee_schedule = [
        (buy.root(), 0u64.try_into()?),
        (settle.root(), 0u64.try_into()?),
        (P2idNote::script_root(), 0u64.try_into()?),
        (FeeSponsorshipNote::script_root(), 0u64.try_into()?),
    ];
    let allowed = BTreeSet::from(fee_schedule.map(|(root, _)| root));
    let fee_manager = FeePolicyManager::builder()
        .fee_faucet_id(fee_faucet)
        .active_fee_policy(BasicConstantFeePolicy::new().with_fees(fee_schedule).into())
        .build();
    let auth = AuthNetworkAccount::custom(allowed, fee_manager)?.with_allowed_tx_scripts([
        ExpirationTransactionScript::script_root(),
        SendWalletNotesTransactionScript::script_root(),
    ]);
    let game = AccountBuilder::new(rand::random())
        .account_type(AccountType::Public)
        .with_components(auth)
        .with_component(game_component)
        .with_component(BasicWallet)
        .build()?;
    client.add_account(&game, false).await?;
    println!("game account: {}", game.id().to_hex());

    let funding_note = request_funds(game.id(), 2_000_000).await?;
    wait_for_note(&mut client, &funding_note).await?;
    let request = TransactionRequestBuilder::new()
        .expiration_delta(1000)
        .input_notes([(funding_note, None)])
        .build()?;
    let tx = client
        .submit_new_transaction(game.id(), request)
        .await
        .context("create funded game account")?;
    println!("game creation transaction: {}", tx.to_hex());
    wait_for_tx(&mut client, tx).await?;

    let players = [&first, &second, &third];
    let mut leader_digest = Word::empty();
    let mut leader_secret = Word::empty();
    for (index, player) in players.into_iter().enumerate() {
        let game_state = client
            .get_account(game.id())
            .await?
            .ok_or_else(|| anyhow!("game account missing"))?;
        let price = game_slot(&game_state, "fomo3d::game::round")?[1].as_canonical_u64();
        (leader_digest, leader_secret) = submit_buy(
            &mut client,
            player,
            game.id(),
            fee_faucet,
            buy.clone(),
            price,
        )
        .await?;
        let state = wait_for_key_count(&mut client, game.id(), index as u64 + 1).await?;
        let round = game_slot(&state, "fomo3d::game::round")?;
        println!(
            "key {} accepted; pot {}; next price {}; end {}",
            index + 1,
            round[0],
            round[1],
            round[2]
        );
    }

    loop {
        client.sync_state().await?;
        let latest = client.get_latest_block_header().await?;
        let state = client
            .get_account(game.id())
            .await?
            .ok_or_else(|| anyhow!("game account missing"))?;
        let deadline = game_slot(&state, "fomo3d::game::round")?[2].as_canonical_u64();
        if u64::from(latest.timestamp()) > deadline {
            break;
        }
        tokio::time::sleep(Duration::from_secs(3)).await;
    }
    let settle_note = NoteBuilder::new(first.id(), client.rng())
        .script(settle)
        .tag(NoteTag::with_account_target(game.id()).as_u32())
        .attachment(NetworkAccountTarget::new(
            game.id(),
            NoteExecutionHint::Always,
        )?)
        .build()?;
    let settle_request = TransactionRequestBuilder::new()
        .expiration_delta(1000)
        .own_output_notes(vec![settle_note])
        .build()?;
    client
        .submit_new_transaction(first.id(), settle_request)
        .await?;
    for _ in 0..60 {
        client.sync_state().await?;
        let state = client
            .get_account(game.id())
            .await?
            .ok_or_else(|| anyhow!("game account missing"))?;
        if game_slot(&state, "fomo3d::game::status")?[0].as_canonical_u64() == 1 {
            let winner = game_slot(&state, "fomo3d::game::leader")?;
            anyhow::ensure!(
                winner == leader_digest,
                "leader digest changed before payout"
            );
            println!("round settled; winning secret commitment: {winner}");
            let pot = game_slot(&state, "fomo3d::game::round")?[0].as_canonical_u64();
            let prize = Note::new(
                NoteAssets::new(vec![FungibleAsset::new(fee_faucet, pot)?.into()])?,
                PartialNoteMetadata::new(game.id(), NoteType::Public),
                NoteRecipient::new(
                    winner,
                    claim,
                    NoteStorage::new(winner.iter().copied().collect())?,
                ),
            );
            client
                .import_notes(&[NoteFile::NoteId(prize.id())])
                .await
                .context("import public prize note")?;
            client.sync_state().await?;
            let request = TransactionRequestBuilder::new()
                .expiration_delta(1000)
                .input_notes([(prize, None)])
                .extend_advice_map([(winner, leader_secret.iter().copied().collect::<Vec<_>>())])
                .build()?;
            let claim_tx = client
                .submit_new_transaction(third.id(), request)
                .await
                .context("claim prize")?;
            wait_for_tx(&mut client, claim_tx).await?;
            println!(
                "prize claimed by private account; transaction: {}",
                claim_tx.to_hex()
            );
            return Ok(());
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    Err(anyhow!("network builder did not settle the round"))
}
