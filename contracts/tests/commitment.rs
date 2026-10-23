//! The browser derives the buy commitment with `Poseidon2.hashElements` over eight felts
//! because the web SDK exposes no `merge`. The MASM claim script and the Rust runner use
//! `merge([secret, EMPTY_WORD])`. Both must agree or a browser buyer can never claim.

use miden_protocol::{Felt, Hasher, Word};

fn assert_equivalent(secret: Word) {
    let merged = Hasher::merge(&[secret, Word::empty()]);
    let elements: Vec<Felt> = secret
        .iter()
        .copied()
        .chain(Word::empty().iter().copied())
        .collect();
    assert_eq!(merged, Hasher::hash_elements(&elements), "merge != hash_elements for {secret}");
}

#[test]
fn secret_commitment_matches_browser_hash() {
    assert_equivalent(Word::from([1u64, 2, 3, 4].map(Felt::new_unchecked)));
    for _ in 0..8 {
        let felts: [u64; 4] = rand::random::<[u64; 4]>().map(|v| v & 0x7fff_ffff_ffff_ffff);
        assert_equivalent(Word::from(felts.map(Felt::new_unchecked)));
    }
}
