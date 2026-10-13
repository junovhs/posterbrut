# INK/NOISE

**A grain-obsessed brutalist poster studio.** A browser-only, multi-layer Canvas 2D editor built for acidic two-tone artwork, rough photocopy treatment, harsh thresholding, ink speckles, collage, and torn-paper-style cutouts.

## Run

No dependencies, backend, account, or build step.

```bash
cd inknoise-studio
python3 -m http.server 8000
```

Open http://localhost:8000. You can also deploy the directory as a static site to Vercel, Netlify, Cloudflare Pages, or GitHub Pages. Internet access is needed only for Google Fonts; the renderer, compositing, and exports are local.

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

A built-in browser's `file://` restrictions can interfere with loading modules and local image assets; run a local static server as above. Imported large raster images saved in local autosave can exceed browser storage quotas; use **SAVE** to download the complete project JSON. Native export uses the browser's PNG encoder, with RGB output over the selected paper color.
