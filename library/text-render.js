/** Position glyphs and preserve their complete ink bounds around the logical box. */
export function layoutText(ctx, layer, logicalWidth, logicalHeight) {
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  const stretch = (layer.stretch || 100) / 100;
  const leading = layer.fontSize * (layer.lineHeight || 100) / 100;
  const glyphs = [];
  let left = 0, top = 0, right = logicalWidth, bottom = logicalHeight;
  for (const [row, line] of layer.text.split('\n').entries()) {
    const metrics = [...line].map(char => ({char, metrics: ctx.measureText(char)}));
    const width = metrics.reduce((sum, glyph) => sum + glyph.metrics.width + (layer.tracking || 0), 0);
    let x = layer.align === 'center' ? (logicalWidth / stretch - width) / 2
      : layer.align === 'right' ? logicalWidth / stretch - width : 0;
    const y = row * leading;
    for (const glyph of metrics) {
      const m = glyph.metrics;
      glyphs.push({char: glyph.char, x, y});
      left = Math.min(left, (x - (m.actualBoundingBoxLeft ?? layer.fontSize)) * stretch);
      right = Math.max(right, (x + (m.actualBoundingBoxRight ?? m.width + layer.fontSize)) * stretch);
      top = Math.min(top, y - (m.actualBoundingBoxAscent ?? layer.fontSize));
      bottom = Math.max(bottom, y + (m.actualBoundingBoxDescent ?? layer.fontSize));
      x += m.width + (layer.tracking || 0);
    }
  }
  // Outline width is expressed before horizontal scaling. Keep a small AA guard.
  const guard = 2 + (layer.outline || 0) / Math.min(1, stretch);
  const x = Math.floor(left - guard), y = Math.floor(top - guard);
  return {glyphs, stretch, x, y, w: Math.ceil(right + guard) - x, h: Math.ceil(bottom + guard) - y};
}

/** Draw the layout at its original baseline, including tracking and outline. */
export function drawTextLayout(ctx, layer, layout) {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.scale(layout.stretch, 1);
  ctx.fillStyle = layer.color || '#000';
  ctx.strokeStyle = layer.color || '#000';
  ctx.lineWidth = (layer.outline || 0) / layout.stretch;
  for (const glyph of layout.glyphs) {
    if (layer.outline > 0) ctx.strokeText(glyph.char, glyph.x, glyph.y);
    else ctx.fillText(glyph.char, glyph.x, glyph.y);
  }
  ctx.restore();
}
