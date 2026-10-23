//! The note scripts the Fomo3D game account accepts. `deploy_round` and `validate_local` both
//! include this file, so the account they build can not drift apart.

use miden_protocol::note::NoteScriptRoot;
use miden_standards::note::{
    config::NetworkAccountConfigNote, FeeSponsorshipNote, P2idNote, P2ideNote,
};

/// Buy and settle, plus the defaults the network builder relies on (config, fee sponsorship, P2ID).
/// P2IDE is what a wallet's recallable send produces (Bread 1.17.5 on mainnet); without it the
/// funding note fails "input note script root is not in the note script allowlist".
pub fn allowlisted_roots(buy: NoteScriptRoot, settle: NoteScriptRoot) -> [NoteScriptRoot; 6] {
    [
        buy,
        settle,
        P2idNote::script_root(),
        P2ideNote::script_root(),
        FeeSponsorshipNote::script_root(),
        NetworkAccountConfigNote::script_root(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use miden_standards::code_builder::CodeBuilder;
    use std::collections::BTreeSet;

    #[test]
    fn allowlist_is_exactly_the_six_scripts_the_game_needs() {
        let script = |source: &str| CodeBuilder::default().compile_note_script(source).unwrap();
        let buy = script("@note_script\npub proc main()\n    push.1 drop\nend").root();
        let settle = script("@note_script\npub proc main()\n    push.2 drop\nend").root();
        let expected = BTreeSet::from([
            buy,
            settle,
            P2idNote::script_root(),
            P2ideNote::script_root(),
            FeeSponsorshipNote::script_root(),
            NetworkAccountConfigNote::script_root(),
        ]);
        assert_eq!(expected.len(), 6);
        assert_eq!(BTreeSet::from(allowlisted_roots(buy, settle)), expected);
    }
}
