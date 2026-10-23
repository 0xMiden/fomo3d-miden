import {
  AccountId,
  Felt,
  FeltArray,
  FungibleAsset,
  NetworkAccountTarget,
  Note,
  NoteAssets,
  NoteAttachment,
  NoteExecutionHint,
  NoteMetadata,
  NoteRecipient,
  NoteScript,
  NoteStorage,
  NoteTag,
  NoteType,
  Word,
} from "@miden-sdk/miden-sdk";

// Every SDK constructor below takes its handles by value. Each call site mints fresh
// `AccountId` / `Felt` / `Word` objects instead of reusing one, or the second use throws
// "null pointer passed to rust".

const id = (hex: string) => AccountId.fromHex(hex);
const felts = (values: bigint[]) => new FeltArray(values.map((value) => new Felt(value)));

export interface NetworkNoteSpec {
  /** Hex account id of the Bread account that creates the note. */
  sender: string;
  /** Hex account id of the game (a public network account). */
  game: string;
  /** Fresh script handle (`loadScript`). Consumed. */
  script: NoteScript;
  /** Note storage felts the script reads. */
  storage: bigint[];
  /** Single fungible asset to lock in, or none for a settle note. */
  asset?: { faucet: string; amount: bigint };
}

/** A public note tagged and attached for the game's network builder to consume. */
export function buildNetworkNote(spec: NetworkNoteSpec): Note {
  const target = new NetworkAccountTarget(id(spec.game), NoteExecutionHint.always());
  const assets = new NoteAssets();
  if (spec.asset) assets.push(new FungibleAsset(id(spec.asset.faucet), spec.asset.amount));
  const metadata = new NoteMetadata(id(spec.sender), NoteType.Public, NoteTag.withAccountTarget(id(spec.game)));
  const recipient = NoteRecipient.fromScript(spec.script, new NoteStorage(felts(spec.storage)));
  return Note.withAttachments(assets, metadata, recipient, [target.toAttachment()]);
}

/** Storage layout `buy.masm` expects: the secret commitment word, then the refund recipient digest. */
export const buyStorage = (commitment: Word, refundRecipient: Word): bigint[] => [
  ...commitment.toFelts().map((f) => f.asInt()),
  ...refundRecipient.toFelts().map((f) => f.asInt()),
];

/**
 * A P2ID note back to the buyer. The game only reuses its recipient digest: a rejected or
 * overpaid buy produces a PRIVATE note with this recipient and the refunded amount. Keep the
 * serialized note so the refund can be rebuilt (same recipient, actual amount) and claimed.
 */
export function buildRefundTemplate(sender: string, faucet: string): Note {
  const assets = new NoteAssets([new FungibleAsset(id(faucet), 1n)]);
  return Note.createP2IDNote(id(sender), id(sender), assets, NoteType.Private, new NoteAttachment());
}

/** The private refund note the game would have created for `amount` from a template's recipient. */
export function rebuildRefundNote(templateBytes: Uint8Array, game: string, faucet: string, amount: bigint): Note {
  const template = Note.deserialize(templateBytes);
  const assets = new NoteAssets([new FungibleAsset(id(faucet), amount)]);
  const metadata = new NoteMetadata(id(game), NoteType.Private, new NoteTag(0));
  return new Note(assets, metadata, template.recipient());
}

/**
 * The public bearer prize note `settle.masm` creates: serial number and storage are both the
 * leader commitment word, the script is `claim`, the asset is the whole pot.
 */
export function buildPrizeNote(game: string, faucet: string, pot: bigint, leaderHex: string, claim: NoteScript): Note {
  const storage = new NoteStorage(felts(Word.fromHex(leaderHex).toFelts().map((f) => f.asInt())));
  const recipient = new NoteRecipient(Word.fromHex(leaderHex), claim, storage);
  const metadata = new NoteMetadata(id(game), NoteType.Public, new NoteTag(0));
  return new Note(new NoteAssets([new FungibleAsset(id(faucet), pot)]), metadata, recipient);
}
