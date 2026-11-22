// The sidebar entrances (UI_SPEC §6.1). Clicking one opens its panel; clicking the open one
// again keeps it open (close it with "Back to world" or Escape).
import { ENTRANCES, type EntranceId, type PanelId } from './entrances';

interface SidebarProps {
  readonly open: PanelId | null;
  readonly onOpen: (id: EntranceId) => void;
}

export function Sidebar({ open, onOpen }: SidebarProps) {
  return (
    <nav className="sidebar" aria-label="Entrances">
      <ul>
        {ENTRANCES.map((entrance) => (
          <li key={entrance.id}>
            <button
              type="button"
              data-entrance={entrance.id}
              aria-current={open === entrance.id ? 'true' : undefined}
              onClick={() => {
                onOpen(entrance.id);
              }}
            >
              {entrance.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
