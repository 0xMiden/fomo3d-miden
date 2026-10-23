/**
 * Minimal stand-in for @miden-sdk/miden-sdk in tests that never touch WASM.
 *
 *   vi.mock("@miden-sdk/miden-sdk", () => import("@/__tests__/mocks/miden-sdk"));
 *
 * `AccountId.fromHex` splits a `0x` + 30 hex digit id into an 8-byte prefix and a 7-byte suffix,
 * so `holdsLeader` compares real-looking ids; anything else decodes to zero felts.
 */
import { vi } from "vitest";

export class Felt {
  constructor(public readonly value: bigint) {}
  asInt() {
    return this.value;
  }
}

const hexFelt = (digits: string) => new Felt(/^[0-9a-f]+$/i.test(digits) ? BigInt(`0x${digits}`) : 0n);

export class AccountId {
  constructor(private readonly hex: string) {}
  static fromHex = vi.fn((hex: string) => new AccountId(hex));
  static fromBech32 = vi.fn((bech: string) => new AccountId(`0x${bech}`));
  prefix() {
    return hexFelt(this.hex.slice(2, 18));
  }
  suffix() {
    return hexFelt(this.hex.slice(18, 32));
  }
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

export enum NoteType {
  Private = 0,
  Public = 1,
}
