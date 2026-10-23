import {
  AccountId,
  Felt,
  FeltArray,
  FungibleAsset,
  NetworkAccountTarget,
  Note,
  NoteAssets,
  NoteExecutionHint,
  NoteMetadata,
  NoteRecipient,
  NoteScript,
  NoteStorage,
  NoteTag,
  NoteType,
} from "@miden-sdk/miden-sdk";

// Every SDK constructor below takes its handles by value. Each call site mints fresh
// `AccountId` / `Felt` objects instead of reusing one, or the second use throws
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
  /** Note storage felts the script reads; buy and settle both carry none. */
  storage: bigint[];
  /** Single fungible asset to lock in (the buy's maximum spend), or none for a settle note. */
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
