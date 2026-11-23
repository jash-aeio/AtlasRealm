# Lesson 037: Deterministic graph layout and accessible graphs
**Milestone:** M2 · **Date:** 2026-11-23 · **Related:** `src/renderer/atlas/connections-layout.ts`, `ConnectionsTab.tsx`, `ConnectionsList.tsx`, ADR-0032, GRAPH_MODEL §30.6

## The concept (plain words)
A **deterministic layout** puts the same nodes in the same places every time: no randomness, no
simulation that keeps moving. The simplest one is a **ring**: spread `n` nodes evenly around a
circle using **polar coordinates** (an angle and a distance from the centre), then turn them into
x/y with `cos` and `sin`.

An **accessible graph** doesn't rely on one sense or one device. Colour alone fails for
colour-blind users, so meaning also comes from shape and words. A canvas fails for keyboard and
screen-reader users, so there's a plain list that offers the same information and actions.

## Why Atlas Realm needs it
§30.6 says layouts must be stable and must not move while the user reads, that shapes and labels
supplement colour, and that the graph needs a keyboard list. Layout is also cosmetic (§30.5):
dragging a node must never move a building.

## Where it lives in our code
```ts
// connections-layout.ts: n points on a circle, starting at the top, clockwise
const angle = -Math.PI / 2 + offset + (2 * Math.PI * i) / count;
return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
```
- Placed projects go on the outer ring and unplaced ones on an inner ring, turned half a step
  (`offset = π / outerCount`) so they sit *between* the outer nodes. A screenshot showed why: with
  no offset, a link across the ring ran straight through the inner nodes.
- The order comes from the server, never from names, so renaming a project can't reshuffle the
  picture.
- Link types differ by line shape as well as label (solid, dashed, dotted; `app.css`). Archived
  projects get a dashed border and "(archived)" in the label.
- `ConnectionsList.tsx` is the same data as a table with real buttons: Source, Relation, Target,
  Origin, Remove.
- Dragged positions live in `ConnectionsTab` state only (session-only display state, ADR-0032).
  They never reach the main process, so they can't touch placements.

## Common mistakes
- Using a force simulation "because it looks nice", then the graph keeps shifting while someone reads.
- Sorting by name: a rename then moves everything.
- "Red means archived" with no other cue.
- Saving cosmetic state in the database before anyone needs it to survive a restart.
- Trusting passing tests for a visual feature. Look at a screenshot.

## Try it (5–15 min exercise)
In `tests/domain/atlas-connections.test.ts`, add a test with 1 placed and 3 unplaced projects.
Check that no unplaced node lands within 50 units of the line from the placed node to the centre.
Then set the inner ring's offset to `0` in `ringLayout` and watch your test fail.

## Learn more
- [MDN: Math.cos / polar coordinates](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/cos)
- [WCAG 1.4.1 Use of Color](https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html)
- [React Flow accessibility](https://reactflow.dev/learn/advanced-use/accessibility)
