# Hero image

- Asset: [interview-success.png](../public/interview-success.png)
- Generated with the built-in image generation tool.
- Source: 1536 × 1024 PNG with transparency.
- Placement: foreground below the landing page CTA, up to 360px wide.
- Delivery: Next.js Image serves responsive optimized images; dimensions are inferred from the static import.
- Static imagery keeps the landing page quiet and avoids continuous animation.

## Verification

- Desktop at 1280 × 720: the complete hero fits on one screen.
- Mobile at 320px and tablet at 768px: image loads, stays within the content width, and does not overlap the copy or CTA.
- CTA opens the sample workspace; carousel navigation still works.
- `pnpm lint` and `pnpm exec next build --webpack` pass, including TypeScript compilation.
- Screenshots: [desktop](../test-results/hero-success-desktop.png), [mobile](../test-results/hero-success-mobile.png).

## Generation prompt

Use case: stylized-concept.
Create a refined, minimalist editorial 3D illustration for the hero of an interview preparation website, depicting the quiet satisfaction of reaching a goal.
Subject: one young adult professional in a muted forest-green shirt and light neutral trousers standing confidently on the highest of three broad, softly rounded ascending steps. They hold a small plain green flag upright, with a natural pleased expression and relaxed posture. Full body visible, anatomically natural hands. The scene should clearly read as personal progress and success.
Style: sophisticated sculptural illustration, tactile matte ceramic and paper-like materials, soft ambient daylight, delicate shadows. Restrained palette of forest green, sage, mist grey and warm off-white. Gently elevated three-quarter viewpoint. Simple elegant shapes, adult proportions, no cartoon baby proportions.
Composition: compact landscape composition, figure and steps form one cohesive visual occupying most of the canvas with generous breathing room at all edges. All objects and their soft grounding shadows fully inside the image. Transparent background so the illustration can sit seamlessly on a near-white web page.
Constraints: no text, lettering, logos, watermark, confetti, trophies, charts, badges, surrounding scenery, UI elements or extra characters. Output one polished transparent hero illustration.
