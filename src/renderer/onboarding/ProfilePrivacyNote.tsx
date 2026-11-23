// Says plainly what a profile does and does not protect (#62, spec risk "Local profiles imply
// false security"). Profiles are separate folders, not locked ones: the Windows account is the
// real security boundary (SECURITY.md §13.5). Shown on the first-launch profile step and in
// Settings. Give the enclosing section `aria-describedby={id}` so screen readers announce it.

interface ProfilePrivacyNoteProps {
  readonly id: string;
}

export function ProfilePrivacyNote({ id }: ProfilePrivacyNoteProps) {
  return (
    <p id={id} role="note" className="muted profile-privacy-note" data-testid="profile-privacy">
      Profiles keep each person&apos;s worlds and settings apart, but they are not
      password-protected or encrypted. Anyone who can sign in to this Windows account, or an
      administrator of this computer, can read them.
    </p>
  );
}
