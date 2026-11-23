// The bottom-bar hotbar (M2-10 #75, UI_SPEC §6.1–6.2): ten slots labelled 1–9, 0 with what
// each holds. Clicking a slot, or pressing its number key through the shortcut layer (never
// while typing in a field), activates it: a project is selected, a service opens its panel.
//
// A slot is only a shortcut (PRODUCT_RULES §3.1). Unpinning empties the slot and says so; the
// project or service it pointed at is not changed. Filling a slot happens through "Pin to
// hotbar" (PinToHotbar.tsx), which always asks before replacing.
import { useState } from 'react';

import { HOTBAR_SLOT_COUNT } from '../../common/contracts/hotbar';
import { useShortcut } from '../app/ShortcutLayer';
import { useStore } from '../state/use-store';
import {
  entryOf,
  entryText,
  slotKey,
  type Hotbar as HotbarStore,
  type HotbarEntry,
} from './hotbar-store';
import { hotbarProblem, unpinnedText } from './hotbar-messages';

interface HotbarProps {
  readonly hotbar: HotbarStore;
  /** Selects the project or opens the service panel of a filled slot. */
  readonly onActivate: (entry: HotbarEntry) => void;
}

interface Message {
  readonly ok: boolean;
  readonly text: string;
}

const SLOTS = Array.from({ length: HOTBAR_SLOT_COUNT }, (_, slot) => slot);

export function Hotbar({ hotbar, onActivate }: HotbarProps) {
  const state = useStore(hotbar.store);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  function activate(slot: number) {
    const entry = entryOf(state, slot);
    if (entry === undefined) {
      setMessage({
        ok: true,
        text: `Slot ${slotKey(slot)} is empty. Use “Pin to hotbar” on a project to fill it.`,
      });
      return;
    }
    setMessage(null);
    onActivate(entry);
  }

  async function unpin(entry: HotbarEntry) {
    setBusy(true);
    try {
      const outcome = await hotbar.unpin(entry.slot, entry.target.id);
      setMessage(
        outcome.ok
          ? { ok: true, text: unpinnedText(outcome.entry) }
          : { ok: false, text: hotbarProblem(outcome.error) },
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="hotbar" role="group" aria-label="Hotbar">
      <ol className="hotbar-slots" data-testid="hotbar-slots">
        {SLOTS.map((slot) => (
          <HotbarSlot
            key={slot}
            slot={slot}
            entry={entryOf(state, slot)}
            loading={state.status === 'loading'}
            busy={busy}
            onActivate={activate}
            onUnpin={(entry) => void unpin(entry)}
          />
        ))}
      </ol>
      {state.error !== null && (
        <p role="alert" className="error">
          Could not read the hotbar: {hotbarProblem(state.error)}
        </p>
      )}
      {message !== null && (
        <p
          role={message.ok ? 'status' : 'alert'}
          className={message.ok ? 'hotbar-message' : 'hotbar-message error'}
          data-testid="hotbar-message"
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

interface HotbarSlotProps {
  readonly slot: number;
  readonly entry: HotbarEntry | undefined;
  readonly loading: boolean;
  readonly busy: boolean;
  readonly onActivate: (slot: number) => void;
  readonly onUnpin: (entry: HotbarEntry) => void;
}

/** One slot. Its own component so each slot registers its number key with `useShortcut`. */
function HotbarSlot({ slot, entry, loading, busy, onActivate, onUnpin }: HotbarSlotProps) {
  const key = slotKey(slot);
  useShortcut(key, () => {
    onActivate(slot);
  });
  const text = loading ? 'Reading…' : entry === undefined ? 'Empty' : entryText(entry);
  return (
    <li
      className="hotbar-slot"
      data-slot={key}
      data-filled={entry !== undefined}
      data-status={entry?.projectStatus ?? undefined}
    >
      <button
        type="button"
        className="hotbar-activate"
        aria-keyshortcuts={key}
        aria-label={`Slot ${key}: ${text}`}
        onClick={() => {
          onActivate(slot);
        }}
      >
        <kbd>{key}</kbd> <span className="hotbar-name">{text}</span>
      </button>
      {entry !== undefined && (
        <button
          type="button"
          className="hotbar-unpin"
          disabled={busy}
          aria-label={`Unpin ${entryText(entry)} from slot ${key}`}
          title="Unpin (the project is not affected)"
          onClick={() => {
            onUnpin(entry);
          }}
        >
          ×
        </button>
      )}
    </li>
  );
}
