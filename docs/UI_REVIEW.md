# UI review — October 1, 2026

Reviewed and improved the landing page, four example cards, sample review dashboard, transcript tab, follow-up, saved answers, preparation priorities, and both dialogs. This is a review of the current interface, not a backend or product-readiness assessment.

The implementation retains Next.js 16.3.4, React 19, Tailwind 4, shadcn/ui Nova components with Base UI, Green primary, Mist base, and Inter. The carousel keeps its tilted grey mask, upright cards, and 20px horizontal / 24px vertical inset.

Conventions inspected: `AGENTS.md`, the installed Next.js CSS/font guides, `CONTEXT.md`, `README.md`, and the product context and active context in `memory-bank/`. Copy now uses “hiring interview,” “recording,” “transcript,” and “proposed answer” consistently. Recording uploads and processing are outside this frontend preview.

## Coverage

| Domain | Evidence inspected | Result |
| --- | --- | --- |
| Accessibility | Accessible names and headings; keyboard carousel, question selection, tabs, dialogs and skip link; validation; focus after saving and screen changes | Fixed focus, navigation semantics and validation behavior |
| Layout | Desktop, 768px tablet, 320px mobile, and 640 × 450 reflow; both answer cards; dialogs and priorities | Fixed narrow navigation overflow; simplified question selection; preserved readable content |
| Writing | Landing, example suggestions, all six revision explanations, empty state, action labels and preview disclosure | Removed repetition and unsupported input prompts |
| Typography | Rendered font, type sizes, casing and line heights; long preparation notes | Loaded Inter; larger body copy; sentence case labels; wrapping notes |
| Colors | Rendered foreground/background tokens, alpha compositing, primary hover and keyboard outline | Corrected failing text and focus contrast pairs |
| UI | Component consistency, action hierarchy, carousel loop and mask geometry; motion rules | Fewer controls; consistent touch targets; reduced-motion guard |

## Findings and fixes

All rows below were addressed. Locations point to the resulting implementation; “Before” describes the interface inspected before the fix.

| Severity | Domain | Location | Before | After | Why |
| --- | --- | --- | --- | --- | --- |
| HIGH | Colors | `app/globals.css:62` | Mist muted text measured 4.49:1 on the landing background and 4.45:1 on the original-answer tint | Darkened the same Mist hue; the pairs now measure 5.32:1 and 5.26:1 | Small text must meet 4.5:1; pale labels were difficult to read |
| HIGH | Colors | `components/ui/button.tsx:10` | Primary hover used 80% opacity; pale text measured 3.37:1 on the landing surface | Opaque, slightly darker hover; measured 5.45:1 | Hover must preserve the readable action label |
| HIGH | Colors | `app/globals.css:85` | The shared half-opacity focus halo measured 1.51:1 against white | Added a solid 2px Green outline; 4.94:1 against white | Keyboard focus needs a clear visual boundary |
| MEDIUM | Writing | `components/interview-coach.tsx:93`, `components/example-carousel.tsx:71`, `lib/sample-interview.ts:2` | Preview banners, several slogans, a three-step explanation, long captions and repeated reassurance competed with the task | One headline, one short description, one CTA, and specific example/revision advice | Each remaining sentence explains the task or the evidence |
| MEDIUM | UI | `components/interview-coach.tsx:104`, `components/interview-coach.tsx:216` | Two interview entries only produced a toast; a fictional profile and unused import fields added apparent functionality | Three working workspace sections; an explicit recording-preview limitation; direct sample entry | Controls should lead to the outcome their labels promise |
| MEDIUM | Accessibility | `components/interview-coach.tsx:113`, `components/interview-coach.tsx:149` | Workspace selection had no current-state semantics; question buttons announced a toggle state | Current-page/current-step semantics and visible checkmarks | The selected context is understandable without relying on tint |
| MEDIUM | Layout | `components/interview-coach.tsx:134`, `components/interview-coach.tsx:164` | A wide horizontal question row on narrower screens; original/proposed cards stacked at common laptop widths | A named question selector on narrower screens and answer columns based on available container width | All questions stay discoverable, and comparison requires less scrolling |
| MEDIUM | Typography | `components/interview-coach.tsx:159`, `components/example-carousel.tsx:71` | Many 10–11px uppercase labels and 14px answer paragraphs | Mostly 14px sentence case labels and 16px answer text with 28px line height | Hierarchy comes from size and spacing, rather than a field of tiny labels |
| MEDIUM | Layout | `components/interview-coach.tsx:205` | Long priorities were cut off in single-line inputs at 320px | Autosizing textareas with a 44px minimum height | Notes can be scanned and edited in full |
| LOW | Typography | `app/layout.tsx:2` | CSS requested Inter while the layout loaded unused Geist fonts; the tab title was “Create Next App” | Load the installed Inter package and use “Interview Coach” metadata | The actual font now matches the chosen UI preset |
| LOW | UI | `components/example-carousel.tsx:82` | Previous/next plus four separate dot buttons duplicated carousel navigation | Two 44px arrow controls, a simple count and an accessible live announcement | Fewer controls preserve the four examples and keyboard navigation |

## Verification

Passed:

- `pnpm lint` — uses the already installed Oxlint and shadcn lint configuration. The previous script referenced missing ESLint files. Generated Next, OpenNext and Wrangler output is excluded.
- `pnpm exec tsc --noEmit` — passed after the production build generated current route types.
- `pnpm exec next build --webpack` — compiled and prerendered successfully.
- `git diff --check` — passed.
- Browser checks in the local app: all six questions, source transcript, follow-up expansion, empty and populated saved states, opening a saved answer, editing, cancelling, saving and priorities.
- Whitespace-only revisions show “Enter an answer before saving,” announce the error, and focus the field. A valid edited answer appears in saved answers; its original transcript remains unchanged.
- Save completion retains keyboard focus. Tab reaches Edit answer. Dialog Escape returns focus to the invoking control. Section changes focus the main landmark without moving the viewport away from the navigation.
- Keyboard: skip link, carousel arrows, question selection with Home/Enter, and transcript tabs with Enter. The carousel advances through all four examples and loops to the first.
- Reflow at 320px, 640 × 450 and 768px; desktop at the browser's default 1280 × 720. No horizontal overflow remained at 320px. The short-viewport edit dialog stayed within the viewport with its actions reachable.
- Rendered carousel mask: `rotate: -2deg`, counter-rotation `2deg`, `overflow: hidden`, horizontal padding `20px`, vertical padding `24px`. The card border remains visible and transitions use the same rounded tilted mask.
- Rendered color pairs were checked using their actual CSS color values and composited backgrounds: muted text 5.26–5.46:1; proposed-answer label 4.62:1; answer body 19.00:1 on the original tint; primary button 4.72:1 normally and 5.45:1 on hover; solid focus outline 4.94:1 on white.
- The final screenshots come from the production preview at `http://127.0.0.1:3100/`.

Not verified:

- `pnpm build` with Turbopack: the environment denies a local worker port while transforming CSS, including on the approved retry. The successful Webpack build and production preview provide the build verification for this pass.
- Actual browser 200% zoom: tested the equivalent 640 × 450 CSS viewport, not the browser's zoom setting.
- OS reduced-motion emulation: inspected the carousel's media-query listener and the global animation/transition override; did not switch the system preference.
- Full screen-reader testing, dark mode, and other browser engines. The exposed interface uses light mode.
- Upload, processing, authentication, durable storage, and processing/loading/error screens: these do not exist in this preview. Changes remain local to the page session, which the workspace states explicitly.

## Screenshots

![Landing page](../test-results/ui-review-landing.png)

![Dashboard](../test-results/ui-review-dashboard.png)

[Mobile landing screenshot](../test-results/ui-review-mobile.png)

## Verdict

Approve for the inspected light-mode sample flow. No HIGH interface findings remain in that scope. The build and accessibility verification boundaries above still apply.
