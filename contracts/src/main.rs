//! Compiles the Fomo3D MASM scripts, checks the pinned claim root, and exports the compiled
//! note scripts for the browser.
//!
//! The frontend never compiles MASM. It deserializes the files written here, so the script
//! roots it sends are the roots the game account allowlists. Usage:
//!
//! `cargo run --bin fomo3d-masm-build [OUT_DIR]`
//!
//! `OUT_DIR` defaults to `frontend/public/fomo3d`.

use std::{collections::BTreeMap, fs, path::PathBuf};

use anyhow::{ensure, Context, Result};
use miden_protocol::utils::serde::Serializable;
use miden_protocol::vm::AdviceMap;
use miden_protocol::{Felt, Word};
use miden_standards::code_builder::CodeBuilder;

/// Root of `claim.masm`, pinned as `CLAIM_SCRIPT_ROOT_*` in `game.masm`.
pub const CLAIM_ROOT: [u64; 4] = [
    13670824056742442059,
    8519043806234772049,
    11701870701898986077,
    9902604766490393369,
];

fn main() -> Result<()> {
    let out_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/public/fomo3d")
        });

    let claim = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .compile_note_script(include_str!("../claim.masm"))
        .context("compile MASM claim note")?;
    ensure!(
        Word::from(claim.root()) == Word::from(CLAIM_ROOT.map(Felt::new_unchecked)),
        "claim script root changed; update the pinned MASM game constant before use"
    );
    // The settle procedure emits a note whose script is `claim`. The host that runs settle
    // needs the claim MAST in its advice map to build the full output note, so the game
    // component and the settle script both carry it.
    let claim_advice = AdviceMap::from(BTreeMap::from([(
        Word::from(claim.root()),
        claim.to_elements(),
    )]));
    let code = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .compile_component_code("fomo3d::game", include_str!("../game.masm"))
        .context("compile MASM game component")?
        .with_advice_map(claim_advice.clone());
    let buy = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .with_dynamically_linked_package(code.as_ref())?
        .compile_note_script(include_str!("../buy.masm"))
        .context("compile MASM buy note")?;
    let settle = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .with_dynamically_linked_package(code.as_ref())?
        .compile_note_script(include_str!("../settle.masm"))
        .context("compile MASM settle note")?
        .with_advice_map(claim_advice);

    println!(
        "MASM game component compiled: {} procedures",
        code.as_ref().mast_forest().num_procedures()
    );
    println!("MASM buy note compiled: {}", buy.root());
    println!("MASM settle note compiled: {}", settle.root());
    println!("MASM claim note compiled: {}", claim.root());

    fs::create_dir_all(&out_dir)
        .with_context(|| format!("create script output directory {}", out_dir.display()))?;
    fs::write(out_dir.join("buy.bin"), buy.to_bytes())?;
    fs::write(out_dir.join("settle.bin"), settle.to_bytes())?;
    fs::write(out_dir.join("claim.bin"), claim.to_bytes())?;
    let roots = serde_json::json!({
        "buy": Word::from(buy.root()).to_hex(),
        "settle": Word::from(settle.root()).to_hex(),
        "claim": Word::from(claim.root()).to_hex(),
    });
    fs::write(out_dir.join("roots.json"), serde_json::to_string_pretty(&roots)? + "\n")?;
    println!("note scripts exported to {}", out_dir.display());
    Ok(())
}
