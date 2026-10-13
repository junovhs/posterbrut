# INK/NOISE

**A grain-obsessed brutalist poster studio.** A browser-only, multi-layer Canvas 2D editor built for acidic two-tone artwork, rough photocopy treatment, harsh thresholding, ink speckles, collage, and torn-paper-style cutouts.

## Run

No backend or account. The TypeScript effect engine has a small build step.

```bash
pnpm install
pnpm dev
```

Open http://127.0.0.1:8046/. Deploy the generated `dist/` directory as a static site. Internet access is needed only for Google Fonts; the renderer, compositing, and exports are local.

## Print engine

- **Threshold:** per-channel luminance, contrast, exposure, gamma, inversion, and an adaptive, local-mean threshold.
- **Grain lab:** deterministic multi-octave noise, fine scan grit, spatially correlated grain patches, flecks, ink erosion, and independently seeded paper stock.
- **Ink density:** a separate, post-threshold dropout pass. Reduced density **removes complete ink pixels**; remaining pixels have fully opaque alpha. This is different from regular layer opacity.
- **Raster print modes:** threshold, ordered Bayer dithering, screened halftone with adjustable angle and screen size, and duotone with a second ink.
- **Compositing:** moveable/scalable/rotatable image layers, configurable opacity and native Canvas blending modes, non-destructive image masks, raster type distress, vector shapes, and layer stacking.
- **Cutouts:** instant jagged-ellipse rough cut, freehand lasso drawn directly over the canvas, and paint-to-erase / paint-to-restore brushes. Masks are editable and saved with the project.
- **Typography:** eight Google Fonts, multi-line copy, letter-by-letter tracking, horizontal stretch, leading, fill, outline, weight, and distress.
- **Output:** 1x/2x/3x export as PNG using the same procedural renderer at export resolution; save/open editable `.inknoise.json` projects; local autosave where browser storage permits.

## Shortcuts

`V` select · `H` pan · `T` text · `R` rectangle · `E` ellipse · `L` freehand lasso · `B` erase mask · `G` restore mask · `Delete` remove layer · `Ctrl/Cmd + Z` undo · `Ctrl/Cmd + Shift + Z` redo · `Ctrl/Cmd + S` save.

Use the **Layers** panel to select which image a cutout applies to. With an image selected, press **L**, trace the outline of the subject in a single pointer gesture, and release to complete it. Refine with **B** / **G**.

## Architecture

- `index.html`: accessible, responsive editor shell and controls.
- `styles.css`: brutalist darkroom interface, artboard stage, layer panels, typography inspector.
- `app.js`: state/history, Canvas 2D print renderer, texture generation, masks, text layout, interaction, uploads and export.
- `assets/messalina-scene.webp`: sample visual based on the supplied poster reference.

No server-side image processing or external image uploads. Image data remains in the local browser (other than any project file you explicitly choose to download/share).

## Notes

A built-in browser's `file://` restrictions can interfere with loading modules and local image assets; use the dev server above. Imported large raster images saved in local autosave can exceed browser storage quotas; use **SAVE** to download the complete project JSON. Native export uses the browser's PNG encoder, with RGB output over the selected paper color.

## Tiptop library

Open **LIBRARY** in the tool rail for five paper stocks and twenty ink distress stamps.
Paper is added beneath the artwork in its original tones. Ink stamps are tinted,
transparent layers with selectable light/dark source polarity. In the inspector,
switch a stamp to **Original overlay** to use its original image with Multiply,
Screen, Soft light, and the other existing blend modes. All library layers support
position, size, rotation, opacity, duplication, stacking, history, project files,
and PNG export. The library uses the owner's optimized WebP shortlist, small browse
thumbnails, on-demand source loading, and cached stamp rendering.

The optional renderer checks run with `node --test tests/library-render.test.mjs`
when `@napi-rs/canvas` is installed for development. Set `INKNOISE_CANVAS_MODULE`
to its module path if it is installed outside this repo; the browser app needs no packages.

With an image layer selected, use **REPLACE IMAGE** at the top of the inspector to
swap its source while keeping its position, dimensions, masks, print settings,
opacity, and blend mode. Replacement supports undo/redo and leaves the existing
image intact if the new file cannot be decoded.

## Image print engine

The new engine lives in strict TypeScript under `src/threshold/`. The existing
editor shell is JavaScript. A module worker owns source analysis and pixel loops;
the UI transports settings and paints finished bitmaps. Paper grain, text distress,
and tinted stamp pixel passes also run in that worker. Sources have a bounded
worker cache, previews are capped at 1024 pixels on the long edge, queued previews
coalesce per layer, stale results are ignored, and export jobs have independent
slots and render at the requested output size. Controls remain usable while the
worker computes; there is no UI-thread pixel-processing fallback.

### Development and deployment

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm dev
```

The dev server serves the compiled `dist/` at `http://127.0.0.1:8046/`.
Use `PORT` to change the port. `pnpm build` generates the static output; Vercel
uses that build command and the `dist` output directory from `vercel.json`.
No runtime packages are added. `@napi-rs/canvas` is only a development test adapter.
Ishoo's durable issue store remains synced separately from source on `refs/ishoo/store`.

### Ink feel

Select an image and drag the Ink feel pad: left/right changes how much ink prints; down adds worn grain and erosion. New images fit automatically. Auto fit recenters the pad; Hold original compares with the source. Arrow keys adjust the focused pad (Shift for larger moves). Print style and color live in one optional disclosure. The tone display describes the original selected source, using square-root scaling so smaller tone populations remain visible. Existing projects keep their exact older effect until you use the pad.

The worker normalizes the source using alpha-aware 2nd/98th tone percentiles and maps ink amount to a tone percentile, so exposure varies without making the control unusable. Texture coordinates drive detail, grain, erosion and density together. Both coordinates are saved non-destructively in the project.
