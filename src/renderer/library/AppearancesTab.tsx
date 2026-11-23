// The library's Building Appearances tab (M2-9 #74): the building art bundled with the app,
// read from the asset manifest. Every new building gets the default appearance (ADR-0025);
// choosing another one is planned for M3, and the tab says so. Placeholder art is labelled
// as placeholder art, in text (PRODUCT_RULES: label mocks and placeholders).
import { DEFAULT_BUILDING_APPEARANCE } from '../../common/world/building-appearance';
import { buildingAppearances } from '../world/world-assets';
import { PLANNED_LABEL } from './library-tabs';

export function AppearancesTab() {
  const appearances = buildingAppearances();
  return (
    <>
      <p className="not-built" data-testid="library-planned">
        Choosing an appearance: {PLANNED_LABEL}
      </p>
      <p className="muted">
        The building art bundled with Atlas Realm. It works offline. Every new building uses the
        default appearance for now.
      </p>
      <ul className="appearance-list" aria-label="Bundled building appearances">
        {appearances.map(({ sprite, placeholder }) => (
          <li
            key={sprite.id}
            className="appearance-item"
            aria-labelledby={`appearance-${sprite.id}`}
          >
            <img src={sprite.url} alt="" width={sprite.width / 2} height={sprite.height / 2} />
            <div>
              <h4 id={`appearance-${sprite.id}`}>{sprite.id}</h4>
              <p className="muted">
                Footprint: {sprite.footprint.columns} × {sprite.footprint.rows} tiles
              </p>
              <p>
                {placeholder && (
                  <span className="tag" data-testid="appearance-placeholder">
                    Placeholder art
                  </span>
                )}{' '}
                {sprite.id === DEFAULT_BUILDING_APPEARANCE && (
                  <span className="badge" data-testid="appearance-default">
                    Default
                  </span>
                )}
              </p>
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}
