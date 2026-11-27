// Plain wording for a list that was cut at its limit (#61). A restored, imported or hand-edited
// profile can hold more profiles or worlds than the app lists; the main process returns the
// first ones plus a count, and these lines say so without alarming anyone: nothing was deleted.

export type LimitedList = 'profile' | 'world';

const WHERE: Readonly<Record<LimitedList, string>> = {
  profile: 'on this computer',
  world: 'in this profile',
};

/**
 * "Showing 50 of 51 profiles. The other one is kept on this computer; nothing was deleted."
 * Returns null when nothing was left out.
 */
export function omittedNotice(kind: LimitedList, shown: number, omitted: number): string | null {
  if (omitted <= 0) return null;
  const total = shown + omitted;
  const rest = omitted === 1 ? 'The other one is kept' : `The other ${String(omitted)} are kept`;
  return `Showing ${String(shown)} of ${String(total)} ${kind}s. ${rest} ${WHERE[kind]}; nothing was deleted.`;
}
