// Original textures bypass the photo print engine. Stamp luminance becomes alpha.
export function renderTexture(image, width, height, settings) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', {willReadFrequently: settings.mode === 'stamp'});
  ctx.drawImage(image, 0, 0, width, height);
  if (settings.mode !== 'stamp') return canvas;
  const color = document.createElement('canvas').getContext('2d');
  color.fillStyle = settings.color;
  color.fillRect(0, 0, 1, 1);
  const rgb = color.getImageData(0, 0, 1, 1).data;
  const pixels = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const a = pixels.data;
    const luminance = (a[i] * .2126 + a[i + 1] * .7152 + a[i + 2] * .0722) / 255;
    a[i + 3] = Math.round(a[i + 3] * (settings.polarity === 'dark' ? 1 - luminance : luminance));
    a[i] = rgb[0]; a[i + 1] = rgb[1]; a[i + 2] = rgb[2];
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}
