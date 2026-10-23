/**
 * Minimal stand-in for @miden-sdk/miden-sdk in component tests that never touch WASM.
 *
 *   vi.mock("@miden-sdk/miden-sdk", () => import("@/__tests__/mocks/miden-sdk"));
 */
import { vi } from "vitest";

export class AccountId {
  constructor(private readonly hex: string) {}
  static fromHex = vi.fn((hex: string) => new AccountId(hex));
  static fromBech32 = vi.fn((bech: string) => new AccountId(`0x${bech}`));
  toString() {
    return this.hex;
  }
}

export class Address {
  constructor(private readonly id: AccountId) {}
  static fromBech32 = vi.fn((bech: string) => new Address(new AccountId(`0x${"ab".repeat(15)}:${bech}`)));
  accountId() {
    return this.id;
  }
}

export class NoteDetails {}
export class NoteFile {
  static fromNoteId = vi.fn();
  static fromInputNote = vi.fn();
  static fromExpectedNote = vi.fn();
}
export class NoteTag {
  constructor(public readonly tag: number) {}
}
export class Felt {
  constructor(public readonly value: bigint) {}
  asInt() {
    return this.value;
  }
}
export class FeltArray {
  constructor(public readonly felts: Felt[] = []) {}
}
export class Word {
  constructor(public readonly values: bigint[]) {}
  static newFromFelts = vi.fn((felts: Felt[]) => new Word(felts.map((f) => f.value)));
  static fromHex = vi.fn((hex: string) => new Word([BigInt(hex.length)]));
  toFelts() {
    return this.values.map((v) => new Felt(v));
  }
  toHex() {
    return `0x${this.values.map((v) => v.toString(16).padStart(16, "0")).join("")}`;
  }
}
export class Poseidon2 {
  static hashElements = vi.fn((array: FeltArray) => new Word(array.felts.map((f) => f.value)));
}
export class NoteScript {
  static deserialize = vi.fn(() => new NoteScript());
}
export class TransactionRequestBuilder {}
export class TransactionRequest {}

export class AccountStorageMode {
  static private = vi.fn(() => new AccountStorageMode());
  static public = vi.fn(() => new AccountStorageMode());
}
export const AuthScheme = { Falcon: "falcon", ECDSA: "ecdsa" } as const;
export enum NoteType {
  Private = 0,
  Public = 1,
}
export class TransactionFilter {
  static all = vi.fn(() => new TransactionFilter());
}
