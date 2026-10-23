import { Note, NoteArray, TransactionRequest, TransactionRequestBuilder } from "@miden-sdk/miden-sdk";

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
