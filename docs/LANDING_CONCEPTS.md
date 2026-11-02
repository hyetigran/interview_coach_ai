# Landing studies — October 5, 2026

Three new low-fidelity directions, using the existing Green/Mist tokens and shadcn buttons, cards, and tabs. The comparison bar belongs to the design review, not the eventual product page.

| Concept | Route | Direction |
| --- | --- | --- |
| 01 — Replay | `/concepts/1` (also `/`) | Centered, oversized headline above a wide recording and answer workspace. Interview moments make the game-tape metaphor tangible. |
| 02 — Notes | `/concepts/2` | An editorial spread. The answer itself is the hero, with a margin note and a switch between the original and the next take. |
| 03 — Next round | `/concepts/3` | A quiet preparation page. A short practice plan carries the benefit, with a simple replay/refine/prepare sequence. |

All three open the existing sample dashboard. Home returns to the current concept. Replay moment selection and answer disclosure work; Notes changes answer versions; Next round supports checking off practice priorities. Recording imagery is a schematic placeholder, not a working video player. The three concepts do not autoplay.

The previous portrait landing remains available at `/concepts/previous`. No new dependencies or images were needed.

## Verification

- `pnpm lint` passed.
- `pnpm exec next build --webpack` passed, including TypeScript and static generation of all concept routes.
- All three checked at 320 × 740, the normal 976 × 984 browser size, and 1280 × 900. No horizontal page overflow at the checked widths.
- Notes and Next round also checked at 804 × 984, where they switch to a single column.
- Replay moment selection changes the question, timestamp, coaching note, and selected waveform section. The next-take disclosure opens.
- Notes switches between Original and Next take. Keyboard arrow navigation and Enter activation checked.
- Next round checkboxes update the progress count. Mouse and Space checked.
- The sample dashboard opens and Home returns to the selected concept.
- Temporary viewport overrides reset after checking. The preview is left on Notes.
- RTL, 200% browser zoom, full screen-reader coverage, and runtime reduced-motion settings: not verified. There are no autoplay animations in the concepts; existing global reduced-motion styles remain in place.

## Previews

- Replay: [desktop](../test-results/landing-01-replay-desktop.png), [mobile](../test-results/landing-01-replay-mobile.png).
- Notes: [desktop](../test-results/landing-02-notes-desktop.png), [mobile](../test-results/landing-02-notes-mobile.png).
- Next round: [desktop](../test-results/landing-03-next-round-desktop.png), [mobile](../test-results/landing-03-next-round-mobile.png).
- [Current browser view](../test-results/landing-studies-current.png).
