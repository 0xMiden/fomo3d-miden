import {
  AdviceMap,
  Felt,
  FeltArray,
  Note,
  NoteAndArgs,
  NoteAndArgsArray,
  NoteArray,
  TransactionRequest,
  TransactionRequestBuilder,
  Word,
} from "@miden-sdk/miden-sdk";
import { TX_EXPIRATION_BLOCKS } from "@/config";

// Bread 1.17.5 sends a request that carries its own auth argument verbatim. A request without
// one goes through the wallet's fee-aware builder, which only accepts bytes equal to a bare
// `withOwnOutputNotes(notes)` request (plus the network targets it derives from the attachments).
// Any extra field, an expiration delta included, fails with "Custom requests without
// authentication currently support only own output notes." Bread's fee manager bounds the expiry
// anyway, so own-output requests carry nothing else. Read note ids before calling.

/** A request whose only effect is publishing `note` from the executing account. */
export function ownOutputRequest(note: Note): TransactionRequest {
  const notes = new NoteArray();
  notes.push(note);
  return new TransactionRequestBuilder().withOwnOutputNotes(notes).build();
}

/**
 * Consumes the prize note. `claim.masm` reads the four secret felts from the advice map under
 * the commitment word it finds in note storage.
 */
export function claimRequest(
  prize: Note,
  leaderHex: string,
  secret: bigint[],
  expirationDelta = TX_EXPIRATION_BLOCKS,
): TransactionRequest {
  const advice = new AdviceMap();
  advice.insert(Word.fromHex(leaderHex), new FeltArray(secret.map((value) => new Felt(value))));
  const inputs = new NoteAndArgsArray();
  inputs.push(new NoteAndArgs(prize));
  return new TransactionRequestBuilder()
    .withInputNotes(inputs)
    .extendAdviceMap(advice)
    .withExpirationDelta(expirationDelta)
    .build();
}
