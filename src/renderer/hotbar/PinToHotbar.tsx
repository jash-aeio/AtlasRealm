// "Pin to hotbar" (M2-10 #75): a button and the dialog it opens, used by the project list, the
// library, the inspector and the service panels.
//
// The dialog lists the ten slots with what each holds. An empty slot is filled straight away.
// A filled slot is never replaced silently (§22.2 #2): the dialog first names the shortcut it
// holds and asks "Replace" / "Cancel". The same question appears when the main process answers
// `slot_occupied` because the slot filled up after it was shown. A target that is already
// pinned shows its slot and offers to unpin it instead (each target is pinned at most once).
//
// Built on <dialog> with showModal(), like ConfirmDialog: focus stays inside, Escape closes it,
// and focus returns to the button afterwards.
import { Fragment, useEffect, useId, useRef, useState } from 'react';

import { HOTBAR_SLOT_COUNT, type HotbarTarget } from '../../common/contracts/hotbar';
import type { ServiceKind } from '../../common/world/service-kinds';
import { useStore } from '../state/use-store';
import {
  entryOf,
  entryText,
  serviceName,
  slotKey,
  slotOfTarget,
  type Hotbar,
  type HotbarEntry,
} from './hotbar-store';
import { hotbarProblem, pinnedText, REPLACE_COPY, unpinnedText } from './hotbar-messages';

export interface PinMessage {
  readonly ok: boolean;
  readonly text: string;
}

interface PinToHotbarProps {
  readonly hotbar: Hotbar;
  readonly target: HotbarTarget;
  /** The project's or service's name, for the dialog and the messages. */
  readonly name: string;
  /** Where the result is reported (the row, card or panel that holds this button). */
  readonly onMessage: (message: PinMessage) => void;
  /**
   * False for a target that cannot be pinned now (a trashed project, ADR-0026). The button
   * still shows while it is pinned, so the old pin can be unpinned.
   */
  readonly canPin?: boolean;
}

const SLOTS = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, slot) => slot);

export function PinToHotbar({ hotbar, target, name, onMessage, canPin = true }: PinToHotbarProps) {
  const state = useStore(hotbar.store);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const pinned = slotOfTarget(state, target.id);
  if (!canPin && pinned === undefined && !open) return null;
  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={state.status === 'loading'}
        data-testid="pin-to-hotbar"
        onClick={() => {
          setOpen(true);
        }}
      >
        {pinned === undefined ? 'Pin to hotbar' : `On hotbar (slot ${slotKey(pinned.slot)})`}
      </button>
      {open && (
        <PinDialog
          hotbar={hotbar}
          target={target}
          name={name}
          onMessage={onMessage}
          onClose={() => {
            setOpen(false);
          }}
          fallbackFocus={() => button.current?.focus()}
        />
      )}
    </>
  );
}

interface PinDialogProps extends PinToHotbarProps {
  readonly onClose: () => void;
  readonly fallbackFocus: () => void;
}

function PinDialog({ hotbar, target, name, onMessage, onClose, fallbackFocus }: PinDialogProps) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const state = useStore(hotbar.store);
  /** The filled slot the user picked: the dialog asks before replacing it. */
  const [replacing, setReplacing] = useState<HotbarEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const fallback = useRef(fallbackFocus);
  fallback.current = fallbackFocus;

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    element.showModal();
    return () => {
      if (element.open) element.close();
      if (opener?.isConnected === true) opener.focus();
      else fallback.current();
    };
  }, []);

  function close() {
    dialog.current?.close();
  }

  async function pin(slot: number, replaceId?: string) {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await hotbar.pin(slot, target, replaceId);
      if (outcome.kind === 'pinned') {
        onMessage({ ok: true, text: pinnedText(name, outcome.slot) });
        close();
      } else if (outcome.kind === 'occupied') {
        // Filled since it was shown, or replaced by something else meanwhile: ask again.
        setReplacing(outcome.occupant);
      } else {
        setProblem(hotbarProblem(outcome.error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function unpin(entry: HotbarEntry) {
    setBusy(true);
    setProblem(null);
    try {
      const outcome = await hotbar.unpin(entry.slot, entry.target.id);
      if (outcome.ok) {
        onMessage({ ok: true, text: unpinnedText(outcome.entry) });
        close();
      } else {
        setProblem(hotbarProblem(outcome.error));
      }
    } finally {
      setBusy(false);
    }
  }

  const pinned = slotOfTarget(state, target.id);
  return (
    <dialog
      ref={dialog}
      className="confirm-dialog pin-dialog"
      aria-labelledby={titleId}
      data-testid="pin-dialog"
      onClose={onClose}
      onCancel={(event) => {
        if (busy) event.preventDefault();
      }}
    >
      {/* Each step has its own key, so its buttons mount fresh and autoFocus applies. */}
      {replacing !== null ? (
        <Fragment key="replace">
          <h2 id={titleId}>{REPLACE_COPY.title(replacing.slot)}</h2>
          <p data-testid="pin-occupant">{REPLACE_COPY.holds(replacing)}</p>
          <p>{REPLACE_COPY.question(replacing, name)}</p>
          {problem !== null && (
            <p role="alert" className="error">
              {problem}
            </p>
          )}
          <div className="form-actions">
            {/* Cancel first and focused, so a stray Enter never replaces anything. */}
            <button
              type="button"
              autoFocus
              disabled={busy}
              onClick={() => {
                setReplacing(null);
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void pin(replacing.slot, replacing.target.id)}
            >
              {busy ? 'Working…' : REPLACE_COPY.confirm}
            </button>
          </div>
        </Fragment>
      ) : pinned !== undefined ? (
        <Fragment key="pinned">
          <h2 id={titleId}>“{name}” is on the hotbar</h2>
          <p>
            It is pinned to slot {slotKey(pinned.slot)}. To move it, unpin it first, then pin it to
            another slot.
          </p>
          {problem !== null && (
            <p role="alert" className="error">
              {problem}
            </p>
          )}
          <div className="form-actions">
            <button type="button" autoFocus disabled={busy} onClick={close}>
              Close
            </button>
            <button type="button" disabled={busy} onClick={() => void unpin(pinned)}>
              Unpin from slot {slotKey(pinned.slot)}
            </button>
          </div>
          <p className="muted">Unpinning only removes the shortcut. Nothing else changes.</p>
        </Fragment>
      ) : (
        <Fragment key="slots">
          <h2 id={titleId}>Pin “{name}” to the hotbar</h2>
          <p className="muted">Pick a slot. A slot in use is only replaced after you confirm.</p>
          <ol className="pin-slots">
            {SLOTS.map((slot) => {
              const entry = entryOf(state, slot);
              const text = entry === undefined ? 'Empty' : entryText(entry);
              return (
                <li key={slot}>
                  <button
                    type="button"
                    disabled={busy}
                    data-slot={slotKey(slot)}
                    onClick={() => {
                      if (entry === undefined) void pin(slot);
                      else setReplacing(entry);
                    }}
                  >
                    <kbd>{slotKey(slot)}</kbd> {text}
                  </button>
                </li>
              );
            })}
          </ol>
          {problem !== null && (
            <p role="alert" className="error">
              {problem}
            </p>
          )}
          <div className="form-actions">
            <button type="button" disabled={busy} onClick={close}>
              Cancel
            </button>
          </div>
        </Fragment>
      )}
    </dialog>
  );
}

/** "Pin to hotbar" for a service panel's header, with its result shown next to it. */
export function PinServiceToHotbar({
  hotbar,
  service,
}: {
  readonly hotbar: Hotbar;
  readonly service: ServiceKind;
}) {
  const [message, setMessage] = useState<PinMessage | null>(null);
  return (
    <span className="service-pin">
      <PinToHotbar
        hotbar={hotbar}
        target={{ type: 'service', id: service }}
        name={serviceName(service)}
        onMessage={setMessage}
      />
      {message !== null && (
        <span role={message.ok ? 'status' : 'alert'} className={message.ok ? 'ok' : 'error'}>
          {message.text}
        </span>
      )}
    </span>
  );
}
