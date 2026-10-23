import { Felt, FeltArray, Poseidon2, Word } from "@miden-sdk/miden-sdk";

const GOLDILOCKS_MASK = 0x7fff_ffff_ffff_ffffn;

/** A random 63-bit value, always below the Goldilocks modulus. */
export function random63(): bigint {
  const values = new BigUint64Array(1);
  crypto.getRandomValues(values);
  return values[0] & GOLDILOCKS_MASK;
}

/** Four random felts. Keep them as bigints; mint fresh `Felt` handles at every SDK call. */
export function randomSecret(): bigint[] {
  return Array.from({ length: 4 }, random63);
}

/**
 * C = Poseidon2(secret, EMPTY_WORD), exactly what `claim.masm` checks with `poseidon2::merge`.
 * The web SDK has no `merge`; hashing the eight elements is equivalent for exactly two words
 * (both absorb one rate block from a zero state). The Rust test `commitment.rs` pins that.
 */
export function commitmentWord(secret: bigint[]): Word {
  if (secret.length !== 4) throw new Error("a secret has four felts");
  const felts = [...secret, 0n, 0n, 0n, 0n].map((value) => new Felt(value));
  return Poseidon2.hashElements(new FeltArray(felts));
}

export const commitmentHex = (secret: bigint[]) => commitmentWord(secret).toHex();

export const wordToBigints = (word: Word): bigint[] => word.toFelts().map((felt) => felt.asInt());

export const bigintsToWord = (values: bigint[]) => Word.newFromFelts(values.map((value) => new Felt(value)));
