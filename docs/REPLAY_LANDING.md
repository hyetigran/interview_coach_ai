# Replay landing — October 9, 2026

The selected Replay direction is now the main landing page at `/`. The low-fidelity studies remain at `/concepts/1`, `/concepts/2`, and `/concepts/3`; the earlier portrait page remains at `/concepts/previous`.

The landing keeps the selected “Watch it back. Go in better.” headline and game-tape positioning, a single large CTA, and one interview review frame. Green/Mist tokens, Inter, and shadcn buttons, cards, and tabs carry the visual system. The concept switcher and repeated footer copy are absent from the main landing.

The existing quiet-confidence portrait replaces the schematic figure inside the frame. It is an illustrative still, not a playable recording. Selecting a timeline moment updates the question, timestamp, original answer, next take, and coaching note. The CTA opens the selected question in the existing dashboard. Current edited revisions flow back into the landing preview.

The page stacks the photo and review below 840px. Timers and question counters use tabular numerals. Buttons provide visible selected/focus states; the page has no autoplay animations and respects the existing reduced-motion rules.

The October 10 update removes the entire sample-interview header row. Overlapping, invisible text copies reserve space for the longest heading, answer, and coaching note at the current width. This keeps the frame and controls steady across moments and answer versions without clipping longer text. These sizing copies are excluded from the accessibility tree.

## Verification

- `pnpm lint` and `pnpm exec next build --webpack` pass. `git diff --check` passes.
- Browser checks cover 320px and 390px phones, both sides of the 840px stacking breakpoint, and the default desktop viewport. No horizontal overflow; the portrait keeps the face clear.
- Timeline selection changes the question, timestamp, and answers. Keyboard arrows move between answer tabs and Enter selects a tab. The CTA opens the selected question in the dashboard; Home returns to Replay.
- Preview screenshots are saved in `test-results/replay-landing-current.png`, `test-results/replay-landing-desktop.png`, and `test-results/replay-landing-mobile.png`.
- Full screen-reader, RTL, and zoom audits were not run. Reduced-motion behavior was checked in the source rather than through an OS preference change.
- October 10: all six moment/answer combinations have identical frame, timeline, tab, and coaching-note positions at the default 980px desktop viewport and at 320px and 390px phone widths. No horizontal overflow. The updated preview is saved in `test-results/replay-landing-stable.png`.
