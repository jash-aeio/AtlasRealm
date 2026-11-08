// Every IPC command resolves to a result instead of throwing across the process boundary.
// Errors carry a stable machine code plus a user-safe message (no stack traces or internals).

export type IpcErrorCode =
  | 'forbidden_sender' // the request didn't come from our own UI
  | 'payload_too_large'
  | 'invalid_payload' // failed the command's input schema
  | 'internal_error'; // the handler failed; details stay in the main process

export interface IpcError {
  readonly code: IpcErrorCode;
  readonly message: string;
}

export type IpcResult<T> =
  { readonly ok: true; readonly data: T } | { readonly ok: false; readonly error: IpcError };
