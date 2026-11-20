// Every IPC command resolves to a result instead of throwing across the process boundary.
// Errors carry a stable machine code plus a user-safe message (no stack traces or internals).

export type IpcErrorCode =
  | 'forbidden_sender' // the request didn't come from our own UI
  | 'payload_too_large'
  | 'invalid_payload' // failed the command's input schema or the service's input rules
  | 'internal_error' // the handler failed; details stay in the main process
  // Domain errors (ADR-0019): the request was well-formed but can't be carried out.
  | 'not_found' // no such record in the active profile (another profile's IDs look the same)
  | 'already_exists' // e.g. a profile with that name
  | 'revision_conflict' // the record changed since the caller read it; see currentRevision
  | 'invalid_transition' // the record's state doesn't allow this change
  | 'limit_reached' // a bounded list (profiles, worlds) is full
  | 'placement_blocked' // the building can't stand there; see `placement` for why (ADR-0025)
  // Profile switching (M1-8 #35, ADR-0014).
  | 'profile_switching' // a switch is under way; commands are refused, not queued
  | 'profile_unavailable'; // the target profile could not be opened; the current one stays active

/** Why a building can't stand on the requested tiles (M2-3, the M2-1 rules' answer). */
export interface PlacementRefusal {
  readonly reason: 'out_of_bounds' | 'reserved' | 'overlaps';
  /** For `overlaps`: the buildings in the way, so the UI can highlight them. Else empty. */
  readonly blockingIds: readonly string[];
}

export interface IpcError {
  readonly code: IpcErrorCode;
  readonly message: string;
  /** Only for `revision_conflict`: the revision the record has now, so the UI can reload. */
  readonly currentRevision?: number;
  /** Only for `placement_blocked`. */
  readonly placement?: PlacementRefusal;
}

export type IpcResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: IpcError };
