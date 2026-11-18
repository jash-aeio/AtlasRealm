// Colour presets for the one placeholder avatar (ADR-0019: one preset, `default`, personalised
// by colour; ADR-0022). The colours come from the art-bible palette (ART_BIBLE §34.3.1) and are
// stored lowercase, as the settings contract requires.
export interface AvatarColourPreset {
  readonly colour: string;
  readonly label: string;
}

export const AVATAR_COLOURS: readonly AvatarColourPreset[] = [
  { colour: '#6bc6f2', label: 'Arcane blue' },
  { colour: '#f2c14e', label: 'Lantern gold' },
  { colour: '#8e3b2e', label: 'Clay red' },
  { colour: '#7fa55a', label: 'Meadow green' },
  { colour: '#a87a4a', label: 'Timber brown' },
  { colour: '#7d8794', label: 'Stone grey' },
];

/** The preset's label, or the raw value for a colour saved some other way. */
export function avatarColourLabel(colour: string): string {
  return AVATAR_COLOURS.find((preset) => preset.colour === colour)?.label ?? colour;
}
