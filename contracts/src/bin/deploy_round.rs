//! Deploys one empty Fomo3D round on a public network: testnet (default) or mainnet.
//!
//! The game account is a network account, which the mainnet allowlist exempts, so no invite
//! code is needed. The round is funded by the testnet faucet, or by any USDCx note sent to the
//! printed address (the only way on mainnet). Built on the v0.17 client; accepts 0.17 and 0.18
//! nodes.
//!
//! Parameters (env, all optional):
//! - `FOMO3D_NETWORK`        `testnet` or `mainnet`             (default testnet)
//! - `FOMO3D_ROUND_SECONDS`  initial deadline from now        (default 3600)
//! - `FOMO3D_EXTEND_SECONDS` seconds each accepted key adds    (default 60)
//! - `FOMO3D_CAP_SECONDS`    deadline never exceeds now + cap  (default 600)
//! - `FOMO3D_START_PRICE`    first key price, base units       (default 1_000_000 = 1 USDCx)
//! - `FOMO3D_PRICE_STEP`     price increase per key            (default 100_000)
//! - `FOMO3D_MAX_POT`        pot ceiling, base units           (default 1_000_000_000)
//! - `FOMO3D_DEPLOY_DIR`     deployment root                   (default target/fomo3d-<network>)
//! - `FOMO3D_SKIP_VERSION_CHECK` set to continue against a node that is not v0.17.x or v0.18.x
//! - `FOMO3D_FAUCET_URL`     faucet API; empty disables        (default: testnet faucet, none on mainnet)
//! - `FOMO3D_FUND_WAIT_SECONDS` how long to wait for funding   (default 1800)
//! - `FOMO3D_ENV_FILE`       frontend env file to write        (default frontend/.env.local)

use std::{
    collections::BTreeSet,
    fs,
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, ensure, Context, Result};
use miden_client::{
    account::{
        AccountBuilder, AccountComponent, AccountId, AccountType, StorageSlot, StorageSlotName,
    },
    builder::ClientBuilder,
    keystore::FilesystemKeyStore,
    note::NoteFile,
    note_transport::grpc::GrpcNoteTransportClient,
    rpc::{Endpoint, GrpcClient},
    store::TransactionFilter,
    transaction::{InputNote, TransactionRequestBuilder, TransactionStatus},
    Client, Word,
};
use miden_client_sqlite_store::ClientBuilderSqliteExt;
use miden_protocol::{
    account::component::AccountComponentMetadata,
    address::{Address, NetworkId},
    asset::AssetId,
    note::{Note, NoteId},
};
use miden_standards::{
    account::{
        auth::AuthNetworkAccount,
        fees::{BasicConstantFeePolicy, FeePolicyManager},
        wallets::BasicWallet,
    },
    code_builder::CodeBuilder,
    note::{config::NetworkAccountConfigNote, FeeSponsorshipNote, P2idNote, P2ideNote},
    tx_script::{ExpirationTransactionScript, SendWalletNotesTransactionScript},
};
use sha2::{Digest, Sha256};

const GAME: &str = include_str!("../../game.masm");
const BUY: &str = include_str!("../../buy.masm");
const SETTLE: &str = include_str!("../../settle.masm");
const MANIFEST_DIR: &str = env!("CARGO_MANIFEST_DIR");

struct RoundParams {
    round_seconds: u32,
    extend_seconds: u32,
    cap_seconds: u32,
    start_price: u32,
    price_step: u32,
    max_pot: u32,
}

fn env_u32(name: &str, default: u32) -> Result<u32> {
    match std::env::var(name) {
        Ok(value) => value
            .trim()
            .parse::<u32>()
            .with_context(|| format!("{name} must be a u32, got {value:?}")),
        Err(_) => Ok(default),
    }
}

fn env_string(name: &str, default: impl Into<String>) -> String {
    std::env::var(name).unwrap_or_else(|_| default.into())
}

/// Everything that differs between the public networks. `Endpoint::mainnet()` in client 0.17
/// names a host that does not resolve; the live mainnet deployment is "cedar".
struct Network {
    name: &'static str,
    endpoint: Endpoint,
    network_id: NetworkId,
    /// `VITE_MIDEN_RPC_URL` for the dashboard: an SDK shorthand or a full URL.
    rpc_url: &'static str,
    /// `VITE_MIDEN_PROVER` for the dashboard.
    prover_url: &'static str,
    explorer: &'static str,
    note_transport: &'static str,
    faucet: Option<&'static str>,
}

fn network_from_env() -> Result<Network> {
    let name = env_string("FOMO3D_NETWORK", "testnet");
    match name.trim().to_ascii_lowercase().as_str() {
        "testnet" => Ok(Network {
            name: "testnet",
            endpoint: Endpoint::testnet(),
            network_id: NetworkId::Testnet,
            rpc_url: "testnet",
            prover_url: "testnet",
            explorer: "https://testnet.midenscan.com",
            note_transport: "https://transport.miden.io",
            faucet: Some("https://faucet-api.testnet.miden.io"),
        }),
        "mainnet" => Ok(Network {
            name: "mainnet",
            endpoint: Endpoint::new("https".into(), "rpc.cedar.miden.io".into(), None),
            network_id: NetworkId::Mainnet,
            rpc_url: "https://rpc.cedar.miden.io",
            prover_url: "https://tx-prover.cedar.miden.io",
            explorer: "https://explorer.cedar.miden.io",
            note_transport: "https://transport.cedar.miden.io",
            faucet: None,
        }),
        other => bail!("FOMO3D_NETWORK must be testnet or mainnet, got {other:?}"),
    }
}

fn slot(name: &str, value: Word) -> Result<StorageSlot> {
    Ok(StorageSlot::with_value(StorageSlotName::new(name)?, value))
}

/// Solves the faucet proof of work: `u64_be(sha256(challenge || nonce_be)[0..8]) < target`.
fn solve_pow(challenge: &[u8], target: u64) -> u64 {
    let mut nonce: u64 = rand::random();
    loop {
        let mut hasher = Sha256::new();
        hasher.update(challenge);
        hasher.update(nonce.to_be_bytes());
        let digest = hasher.finalize();
        let leading = u64::from_be_bytes(digest[..8].try_into().expect("8 bytes"));
        if leading < target {
            return nonce;
        }
        nonce = nonce.wrapping_add(1);
    }
}

/// One faucet attempt: metadata, a fresh challenge, solve, claim. Returns the grant note id.
async fn claim_faucet_once(base_url: &str, target: AccountId) -> Result<(NoteId, u64)> {
    let base = base_url.trim_end_matches('/');
    let http = reqwest::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()?;
    let metadata: serde_json::Value = http
        .get(format!("{base}/get_metadata"))
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
        .context("faucet metadata")?;
    let amount = metadata
        .get("base_amount")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("faucet metadata lacks base_amount: {metadata}"))?;
    let pow: serde_json::Value = http
        .get(format!("{base}/pow"))
        .query(&[("account_id", target.to_hex()), ("amount", amount.to_string())])
        .send()
        .await?
        .error_for_status()?
        .json()
        .await
        .context("faucet pow")?;
    let challenge_hex = pow
        .get("challenge")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("faucet pow lacks challenge: {pow}"))?;
    let pow_target = pow
        .get("target")
        .and_then(|v| v.as_u64())
        .ok_or_else(|| anyhow!("faucet pow lacks target: {pow}"))?;
    let challenge = hex::decode(challenge_hex.trim_start_matches("0x"))?;
    let nonce = solve_pow(&challenge, pow_target);
    let response = http
        .get(format!("{base}/get_tokens"))
        .query(&[
            ("account_id", target.to_hex()),
            ("asset_amount", amount.to_string()),
            ("challenge", challenge_hex.to_string()),
            ("nonce", nonce.to_string()),
        ])
        .send()
        .await?;
    let status = response.status();
    let body = response.text().await?;
    ensure!(status.is_success(), "faucet get_tokens failed: {status} {body}");
    let tokens: serde_json::Value = serde_json::from_str(&body).context("faucet get_tokens body")?;
    let note_id = tokens
        .get("note_id")
        .and_then(|v| v.as_str())
        .ok_or_else(|| anyhow!("faucet grant lacks note_id: {body}"))?;
    Ok((NoteId::try_from_hex(note_id)?, amount))
}

/// A committed note for the game that carries the chain fee asset, from whoever sent it.
async fn find_fee_note(
    client: &mut Client<FilesystemKeyStore>,
    game_id: AccountId,
    fee_faucet: AccountId,
) -> Result<Option<Note>> {
    for (record, _) in client.get_consumable_notes(Some(game_id)).await? {
        let funded = record
            .assets()
            .iter()
            .any(|asset| asset.faucet_id() == fee_faucet);
        if funded && record.inclusion_proof().is_some() {
            let input: InputNote = record.try_into()?;
            return Ok(Some(input.note().clone()));
        }
    }
    Ok(None)
}

/// Funds the game account: keeps asking the faucet when there is one (fresh challenge each time,
/// since a challenge expires after ~30 s and the faucet answers 503/429 under load) while also
/// accepting any fee-asset note someone sends to the printed address by hand. The sync includes
/// the note transport, so a private note reaches the client as well as a public one.
/// Syncs, imports the faucet grant by id when the sync did not pick it up, and looks for a
/// committed fee-asset note on the game account.
async fn poll_funding(
    client: &mut Client<FilesystemKeyStore>,
    game_id: AccountId,
    fee_faucet: AccountId,
    faucet_note: Option<NoteId>,
) -> Result<Option<Note>> {
    client.sync_state().await.context("sync while waiting for funding")?;
    if let Some(id) = faucet_note {
        if client.get_input_note(id).await?.is_none() {
            let _ = client.import_notes(&[NoteFile::NoteId(id)]).await;
        }
    }
    find_fee_note(client, game_id, fee_faucet).await
}

/// Upper bound for one faucet attempt or one chain poll. The faucet and the node share a
/// gateway whose idle connections can hang past the per-request timeouts; a timed-out or
/// failed step (DNS outage, connection reset) is retried on the next loop iteration until the
/// funding window closes.
const STEP_TIMEOUT: Duration = Duration::from_secs(120);

async fn fund_game(
    client: &mut Client<FilesystemKeyStore>,
    faucet_url: Option<&str>,
    game_id: AccountId,
    fee_faucet: AccountId,
) -> Result<Note> {
    let wait = u64::from(env_u32("FOMO3D_FUND_WAIT_SECONDS", 1800)?);
    let interval = u64::from(env_u32("FOMO3D_FAUCET_RETRY_SECONDS", 30)?);
    let deadline = Instant::now() + Duration::from_secs(wait);
    let mut faucet_note: Option<NoteId> = None;
    let mut attempt = 0u32;
    loop {
        if let (None, Some(url)) = (faucet_note, faucet_url) {
            attempt += 1;
            match tokio::time::timeout(STEP_TIMEOUT, claim_faucet_once(url, game_id)).await {
                Ok(Ok((id, amount))) => {
                    println!("faucet grant note {id} ({amount} base units)");
                    faucet_note = Some(id);
                }
                Ok(Err(error)) => println!("faucet attempt {attempt}: {error:#}"),
                Err(_) => println!("faucet attempt {attempt}: timed out after {}s", STEP_TIMEOUT.as_secs()),
            }
        }
        match tokio::time::timeout(STEP_TIMEOUT, poll_funding(client, game_id, fee_faucet, faucet_note)).await {
            Ok(Ok(Some(note))) => return Ok(note),
            Ok(Ok(None)) => {}
            Ok(Err(error)) => println!("chain poll failed: {error:#}; retrying"),
            Err(_) => println!("chain poll timed out after {}s; retrying", STEP_TIMEOUT.as_secs()),
        }
        ensure!(
            Instant::now() < deadline,
            "no fee-asset note reached the game account within {wait}s; rerun, or send USDCx to it and rerun with FOMO3D_FUND_WAIT_SECONDS"
        );
        tokio::time::sleep(Duration::from_secs(interval)).await;
    }
}

async fn wait_for_commit(
    client: &mut Client<FilesystemKeyStore>,
    tx_id: miden_protocol::transaction::TransactionId,
) -> Result<()> {
    for _ in 0..90 {
        client.sync_state().await?;
        let records = client
            .get_transactions(TransactionFilter::Ids(vec![tx_id]))
            .await?;
        if let Some(record) = records.first() {
            match &record.status {
                TransactionStatus::Committed { .. } => return Ok(()),
                TransactionStatus::Discarded(cause) => {
                    bail!("initialization transaction discarded: {cause}")
                }
                TransactionStatus::Pending => {}
            }
        }
        tokio::time::sleep(Duration::from_secs(2)).await;
    }
    bail!("initialization transaction {tx_id} did not commit")
}

#[tokio::main]
async fn main() -> Result<()> {
    let params = RoundParams {
        round_seconds: env_u32("FOMO3D_ROUND_SECONDS", 3600)?,
        extend_seconds: env_u32("FOMO3D_EXTEND_SECONDS", 60)?,
        cap_seconds: env_u32("FOMO3D_CAP_SECONDS", 600)?,
        start_price: env_u32("FOMO3D_START_PRICE", 1_000_000)?,
        price_step: env_u32("FOMO3D_PRICE_STEP", 100_000)?,
        max_pot: env_u32("FOMO3D_MAX_POT", 1_000_000_000)?,
    };
    let network = network_from_env()?;
    let root = std::env::var_os("FOMO3D_DEPLOY_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(MANIFEST_DIR).join(format!("target/fomo3d-{}", network.name)));
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH)?.as_secs();
    let dir = root.join(stamp.to_string());
    fs::create_dir_all(&dir)?;
    // An explicit empty value disables the faucet; unset falls back to the network's, if any.
    let faucet_url = match std::env::var("FOMO3D_FAUCET_URL") {
        Ok(value) if value.trim().is_empty() => None,
        Ok(value) => Some(value),
        Err(_) => network.faucet.map(String::from),
    };
    let env_file = std::env::var_os("FOMO3D_ENV_FILE")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(MANIFEST_DIR).join("../frontend/.env.local"));

    let keystore = Arc::new(FilesystemKeyStore::new(dir.join("keystore"))?);
    let rpc = Arc::new(GrpcClient::new(&network.endpoint, 20_000));
    let status = rpc
        .get_status_unversioned()
        .await
        .with_context(|| format!("connect to {}", network.name))?;
    if !(status.version.starts_with("0.17.") || status.version.starts_with("0.18.")) {
        if std::env::var_os("FOMO3D_SKIP_VERSION_CHECK").is_some() {
            println!(
                "warning: {} node reports {}, this client is built for v0.17.x; continuing because FOMO3D_SKIP_VERSION_CHECK is set",
                network.name, status.version
            );
        } else {
            bail!(
                "{} node reports {}, expected v0.17.x or v0.18.x; set FOMO3D_SKIP_VERSION_CHECK=1 to try anyway",
                network.name, status.version
            );
        }
    }
    println!("{} node {} at block {}", network.name, status.version, status.chain_tip);

    let mut client = ClientBuilder::new()
        .rpc(rpc)
        .note_transport(Arc::new(GrpcNoteTransportClient::new(network.note_transport.to_string(), 20_000)))
        .sqlite_store(dir.join("store.sqlite3"))
        .authenticator(keystore)
        .build()
        .await?;
    client.sync_state().await?;
    let header = client.get_latest_block_header().await?;
    let protocol = client
        .get_protocol_config(header.protocol_config_commitment())
        .await?;
    let fee_faucet = protocol.fee_asset_id().faucet_id();
    let fee_asset = AssetId::new_fungible(fee_faucet);
    println!("chain fee faucet: {}", fee_faucet.to_hex());

    let component_code = CodeBuilder::default().compile_component_code("fomo3d::game", GAME)?;
    let buy = CodeBuilder::default()
        .with_dynamically_linked_package(component_code.as_ref())?
        .compile_note_script(BUY)?;
    let settle = CodeBuilder::default()
        .with_dynamically_linked_package(component_code.as_ref())?
        .compile_note_script(SETTLE)?;
    println!("buy root {}", Word::from(buy.root()).to_hex());
    println!("settle root {}", Word::from(settle.root()).to_hex());

    let deadline = header
        .timestamp()
        .checked_add(params.round_seconds)
        .ok_or_else(|| anyhow!("deadline overflows u32"))?;
    let component = AccountComponent::new(
        component_code,
        vec![
            slot(
                "fomo3d::game::round",
                Word::from([0u32, params.start_price, deadline, 0]),
            )?,
            slot("fomo3d::game::leader", Word::empty())?,
            slot(
                "fomo3d::game::config",
                Word::from([
                    params.price_step,
                    params.extend_seconds,
                    params.cap_seconds,
                    params.max_pot,
                ]),
            )?,
            slot("fomo3d::game::asset_id", fee_asset.to_word())?,
            slot(
                "fomo3d::game::window",
                Word::from([params.round_seconds, params.start_price, 1, 0]),
            )?,
        ],
        AccountComponentMetadata::new("fomo3d::game"),
    )?;
    // Every allowlisted script needs a fee entry, including the three defaults the network
    // builder relies on (config, fee sponsorship, P2ID). All zero: the game pays its own fees.
    // P2IDE is what a wallet's recallable send produces (Bread 1.17.5 on mainnet); without it
    // the funding note fails "input note script root is not in the note script allowlist".
    let fees = [
        (buy.root(), 0u64.try_into()?),
        (settle.root(), 0u64.try_into()?),
        (P2idNote::script_root(), 0u64.try_into()?),
        (P2ideNote::script_root(), 0u64.try_into()?),
        (FeeSponsorshipNote::script_root(), 0u64.try_into()?),
        (NetworkAccountConfigNote::script_root(), 0u64.try_into()?),
    ];
    let allowed = BTreeSet::from(fees.map(|(root, _)| root));
    let fee_manager = FeePolicyManager::builder()
        .fee_faucet_id(fee_faucet)
        .active_fee_policy(BasicConstantFeePolicy::new().with_fees(fees).into())
        .build();
    let auth = AuthNetworkAccount::custom(allowed, fee_manager)?.with_allowed_tx_scripts([
        ExpirationTransactionScript::script_root(),
        SendWalletNotesTransactionScript::script_root(),
    ]);
    let game = AccountBuilder::new(rand::random())
        .account_type(AccountType::Public)
        .with_components(auth)
        .with_component(component)
        .with_component(BasicWallet)
        .build()?;
    client.add_account(&game, false).await?;
    let game_hex = game.id().to_hex();
    fs::write(dir.join("game-account.txt"), format!("{game_hex}\n"))?;
    println!("{} game account: {game_hex}", network.name);
    println!(
        "round: deadline {deadline} (+{}s), +{}s per key, cap {}s, price {} +{}, max pot {}",
        params.round_seconds,
        params.extend_seconds,
        params.cap_seconds,
        params.start_price,
        params.price_step,
        params.max_pot
    );

    let bech32 = Address::new(game.id()).encode(network.network_id);
    match &faucet_url {
        Some(_) => println!("fund it by faucet (automatic below) or by sending USDCx to {bech32}"),
        None => println!(
            "no faucet on {}: send USDCx to {bech32} now (the whole note pays the round's fees; 1 USDCx is plenty)",
            network.name
        ),
    }
    let grant_note = fund_game(&mut client, faucet_url.as_deref(), game.id(), fee_faucet).await?;
    println!("funding note {} is on chain", grant_note.id());

    // Consuming the grant is the deploying transaction: a network account needs an effect, and
    // the grant also funds the fees of every network transaction the round will run.
    client.sync_state().await?;
    let request = TransactionRequestBuilder::new().build_consume_notes(vec![grant_note])?;
    let tx_id = client
        .submit_new_transaction(game.id(), request)
        .await
        .context("submit the account initialization")?;
    println!("account initialization transaction: {}", tx_id.to_hex());
    wait_for_commit(&mut client, tx_id).await?;
    println!("{} round initialized and committed", network.name);

    let latest = root.join("latest");
    let _ = fs::remove_file(&latest);
    let _ = std::os::unix::fs::symlink(&dir, &latest);

    let env = format!(
        "VITE_MIDEN_NETWORK={}\nVITE_MIDEN_RPC_URL={}\nVITE_MIDEN_PROVER={}\nVITE_MIDEN_EXPLORER_URL={}\nVITE_MIDEN_FAUCET_URL={}\nVITE_MIDEN_GAME_ADDRESS={game_hex}\n",
        network.name,
        network.rpc_url,
        network.prover_url,
        network.explorer,
        faucet_url.as_deref().unwrap_or(""),
    );
    fs::write(&env_file, env).with_context(|| format!("write {}", env_file.display()))?;
    println!("frontend env written to {}", env_file.display());
    println!("explorer: {}/account/{game_hex}", network.explorer);
    println!("the pot is paid to the last accepted buyer as a public P2ID note; the winning buy is public");
    Ok(())
}
