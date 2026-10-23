//! Read-only compatibility probe for the public testnet.

use std::sync::Arc;

use anyhow::Result;
use miden_client::builder::ClientBuilder;
use miden_client::keystore::FilesystemKeyStore;
use miden_client::rpc::{Endpoint, GrpcClient};
use miden_client_sqlite_store::ClientBuilderSqliteExt;

#[tokio::main]
async fn main() -> Result<()> {
    let dir = std::env::temp_dir().join(format!("fomo3d-testnet-probe-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let keystore = Arc::new(FilesystemKeyStore::new(dir.join("keystore"))?);
    let rpc = Arc::new(GrpcClient::new(&Endpoint::testnet(), 15_000));
    let status = rpc.get_status_unversioned().await?;
    println!(
        "testnet node version: {}; chain tip: {}",
        status.version, status.chain_tip
    );
    let mut client = ClientBuilder::new()
        .rpc(rpc)
        .sqlite_store(dir.join("store.sqlite3"))
        .authenticator(keystore)
        .build()
        .await?;
    client.sync_state().await?;
    let header = client.get_latest_block_header().await?;
    let config = client
        .get_protocol_config(header.protocol_config_commitment())
        .await?;
    println!(
        "v0.17 client sync passed; fee faucet: {}",
        config.fee_asset_id().faucet_id()
    );
    Ok(())
}
