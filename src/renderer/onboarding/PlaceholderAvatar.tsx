// An engineering placeholder for the user avatar: a simple cloaked figure in the chosen colour.
// The real avatar sprite comes with the art batch (ART_BIBLE §34.4); until then this is
// labelled as a placeholder wherever it appears.
interface PlaceholderAvatarProps {
  /** Cloak colour, or null for the "no avatar chosen" outline. */
  readonly colour: string | null;
  readonly size?: number;
}

const INK = '#1d1f26';
const PARCHMENT = '#efe2bf';

export function PlaceholderAvatar({ colour, size = 64 }: PlaceholderAvatarProps) {
  const label = colour === null ? 'No avatar chosen' : 'Placeholder avatar';
  return (
    <svg
      className="placeholder-avatar"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      role="img"
      aria-label={label}
    >
      <title>{label}</title>
      {colour === null ? (
        <g fill="none" stroke="#9a978e" strokeWidth="1.5" strokeDasharray="2 2">
          <circle cx="16" cy="10" r="5" />
          <path d="M7 29 Q8 17 16 17 Q24 17 25 29 Z" />
        </g>
      ) : (
        <g stroke={INK} strokeWidth="1.2">
          <path d="M7 29 Q8 17 16 17 Q24 17 25 29 Z" fill={colour} />
          <circle cx="16" cy="10" r="5" fill={PARCHMENT} />
          <path
            d="M10.5 10 Q11 3.5 16 3.5 Q21 3.5 21.5 10 Q19 7 16 7 Q13 7 10.5 10 Z"
            fill={colour}
          />
        </g>
      )}
    </svg>
  );
}
