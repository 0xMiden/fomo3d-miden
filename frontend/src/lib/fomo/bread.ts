import { AccountId, Address, type TransactionRequest } from "@miden-sdk/miden-sdk";
import { Transaction, type MidenTransaction } from "@miden-sdk/miden-wallet-adapter-base";
import { EXPLORER_URL } from "@/config";

/** Bread hands dApps `<bech32>_<routing>`; `Address.fromBech32` throws on some suffixes. Cut first. */
export const canonicalAddress = (address: string) => address.split("_")[0];

/** Hex account id (`0x` + 30 hex digits) of a Bread address. */
export const accountHexOf = (address: string) =>
  Address.fromBech32(canonicalAddress(address)).accountId().toString();

export const shortHex = (hex: string, head = 8, tail = 4) =>
  hex.length <= head + tail + 2 ? hex : `${hex.slice(0, head + 2)}…${hex.slice(-tail)}`;

/**
 * Wraps a request for `requestTransaction`. `address` must be the connected account (Bread
 * refuses anything else). `importNotes` are serialized `NoteFile`s or bare `Note`s the wallet
 * imports before executing, which the claim and refund flows use for their input note.
 */
export function customTransaction(
  address: string,
  recipientHex: string,
  request: TransactionRequest,
  inputNoteIds: string[] = [],
  importNotes: Uint8Array[] = [],
): MidenTransaction {
  return Transaction.createCustomTransaction(canonicalAddress(address), recipientHex, request, inputNoteIds, importNotes);
}

export const isValidAccountHex = (hex: string) => /^0x[0-9a-f]{30}$/.test(hex);

export const parseAccountId = (value: string) =>
  value.startsWith("0x") ? AccountId.fromHex(value) : AccountId.fromBech32(canonicalAddress(value));

export const explorer = {
  account: (hex: string) => `${EXPLORER_URL}/account/${hex}`,
  tx: (hash: string) => `${EXPLORER_URL}/tx/${hash}`,
  note: (id: string) => `${EXPLORER_URL}/note/${id}`,
};
