//! Compiles the Fomo3D MASM scripts and exports the compiled note scripts for the browser.
//!
//! The frontend never compiles MASM. It deserializes the files written here, so the script
//! roots it sends are the roots the game account allowlists. Usage:
//!
//! `cargo run --bin fomo3d-masm-build [OUT_DIR]`
//!
//! `OUT_DIR` defaults to `frontend/public/fomo3d`.

use std::{fs, path::PathBuf};

use anyhow::{Context, Result};
use miden_protocol::Word;
use miden_protocol::utils::serde::Serializable;
use miden_standards::code_builder::CodeBuilder;

fn main() -> Result<()> {
    let out_dir = std::env::args()
        .nth(1)
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../frontend/public/fomo3d")
        });

    let code = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .compile_component_code("fomo3d::game", include_str!("../game.masm"))
        .context("compile MASM game component")?;
    let buy = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .with_dynamically_linked_package(code.as_ref())?
        .compile_note_script(include_str!("../buy.masm"))
        .context("compile MASM buy note")?;
    let settle = CodeBuilder::default()
        .with_warnings_as_errors(true)
        .with_dynamically_linked_package(code.as_ref())?
        .compile_note_script(include_str!("../settle.masm"))
        .context("compile MASM settle note")?;

    println!(
        "MASM game component compiled: {} procedures",
        code.as_ref().mast_forest().num_procedures()
    );
    println!("MASM buy note compiled: {}", buy.root());
    println!("MASM settle note compiled: {}", settle.root());

    fs::create_dir_all(&out_dir)
        .with_context(|| format!("create script output directory {}", out_dir.display()))?;
    fs::write(out_dir.join("buy.bin"), buy.to_bytes())?;
    fs::write(out_dir.join("settle.bin"), settle.to_bytes())?;
    let roots = serde_json::json!({
        "buy": Word::from(buy.root()).to_hex(),
        "settle": Word::from(settle.root()).to_hex(),
    });
    fs::write(out_dir.join("roots.json"), serde_json::to_string_pretty(&roots)? + "\n")?;
    println!("note scripts exported to {}", out_dir.display());
    Ok(())
}
