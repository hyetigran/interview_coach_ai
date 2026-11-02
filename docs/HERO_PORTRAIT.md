# Hero portrait with laptop

Created October 2, 2026 with the built-in image generation tool.

- Asset: [interview-confidence-laptop.png](../public/interview-confidence-laptop.png)
- Direction: the selected quiet confidence portrait style, with a laptop visible.
- Reference: [BetterUp portrait](hero-photo-references/betterup.jpg), used for mood and photographic texture. The generated subject is original.
- Placement: a larger background portrait with the headline and CTA on the left and the dashboard review preview on the right. On desktop, the cards sit below the face.
- Headline: “Game tape for your interviews.” Supporting copy: “Review your answers and find what to improve.”
- Review preview: the dashboard's full Original answer, Proposed answer, and revision notes scroll vertically in their own column. Both screens use the same `AnswerReview` component and current revisions.
- Playback: a continuous vertical loop without a header, playback controls, or an internal scrollbar. Two identical sequences create a seamless repeat at 28px per second. Hover does not interrupt playback; animation pauses off screen, and reduced motion shows static cards.
- Responsive layout: from 800px, copy and cards sit side by side; below 800px, the cards stack beneath the copy. Below 1200px, the content starts 256–320px from the top, within the portrait's lower fade, and both columns align at the top. On desktop, the cards start near 43% of the viewport height, below the face. The hero retains a 720px minimum height on shorter desktop screens. Answer cards follow the dashboard's container breakpoint.
- Delivery: a static import through Next.js Image with `fill`, responsive image sizes, and a separate crop for narrow screens.

## Final prompt

Use case: photorealistic-natural.
Asset type: foreground hero photograph for a minimalist interview preparation website.
Input image 1 is a style reference for quiet confidence, editorial lighting, authentic skin texture and a plain backdrop. Create a fresh scene with an original adult professional; do not copy the reference person's identity.
Primary request: show that calm, assured portrait look with a laptop clearly visible.
Scene: one potential user seated at a simple desk behind an open, unbranded silver laptop. The person looks toward the camera with a composed expression and a subtle, closed-mouth smile, shoulders relaxed. Their head, upper torso, and the laptop are fully visible; the laptop occupies the lower quarter of the frame and never blocks the face. One hand rests naturally near the laptop; no elaborate gestures.
Photography: genuine editorial lifestyle photograph, camera at eye level, 50mm lens, soft window light from one side, restrained cinematic contrast. Visible pores and small freckles, natural asymmetry, realistic hair strands, fabric weave, and ordinary human proportions. Original subject with short wavy brown hair and a simple muted forest-green overshirt.
Composition: landscape 3:2, moderately close portrait, person slightly left of center, laptop in the lower right foreground, breathing room around the head and laptop. Background is a simple softly textured mist-grey wall with a subdued green undertone, gently out of focus. A very minimal desktop and no clutter. The face should be the visual focus, with an unmistakably real photographic finish.
Constraints: no text, lettering, logos, watermarks, decorative UI, badges, flags, trophies, confetti, extra people or props. No illustration, 3D rendering, airbrushed skin, plastic face, glamour retouching, exaggerated grin or staged celebration.

## Verification

- `pnpm lint` passed.
- `pnpm exec next build --webpack` passed, including TypeScript validation.
- Visually checked the raised placement at 320, 976, 1199, 1280, and 1920px widths. The portrait's face remains clear.
- At 976 × 984, the headline and cards both start at y=320. The preview ends at y=700, bringing the main content into the upper portion of the page.
- At 1920 × 1080, the preview starts at y=464 rather than anchoring to the bottom of the page. At 320 × 740, the headline starts at y=256 and the cards follow the CTA.
- Playback continues in the new column and after resizing. The previously verified infinite loop, hover behavior, and reduced-motion guard remain in the shared preview component.
- The preview has no header or playback buttons. Cards move by transform inside a clipped frame with no internal scrollbar.
- The accessibility tree exposes each of the six questions once; the duplicate sequence is hidden from assistive technology and contains no interactive elements.
- Original and Proposed cards continue to use the dashboard's shared responsive component and current revisions.
- The reduced-motion guard was checked in source. Runtime reduced-motion settings, a full screen-reader audit, RTL, and 200% browser zoom were not verified.
- Screenshots: [current hero](../test-results/hero-content-raised-current.png), [desktop hero](../test-results/hero-content-raised-desktop.png), and [mobile hero](../test-results/hero-content-raised-mobile.png).
