// AI models misread very small pictures (left and right swapped on a 64px
// image, in our tests). Enlarging them first fixes that.
import sharp from 'sharp';

// Pictures whose shorter side is under this get enlarged to it.
const minSide = 512;
// Never grow a side past this (a 10x2000 strip stays reasonable).
const maxSide = 2048;

// A picture as a data URL in, the same picture out, enlarged when it is
// small. Anything we cannot read is returned untouched.
export async function readableImage(dataUrl: string): Promise<string> {
  const match = /^data:image\/(png|jpeg|webp|gif);base64,(.+)$/s.exec(dataUrl);
  if (!match) return dataUrl;
  try {
    const image = sharp(Buffer.from(match[2], 'base64'));
    const { width, height } = await image.metadata();
    if (!width || !height || Math.min(width, height) >= minSide) return dataUrl;
    const scale = Math.min(
      minSide / Math.min(width, height),
      maxSide / Math.max(width, height),
    );
    if (scale <= 1) return dataUrl;
    const bigger = await image
      .resize({
        width: Math.round(width * scale),
        height: Math.round(height * scale),
        // Keeps edges sharp: blurring a tiny picture loses what little
        // detail it has.
        kernel: 'nearest',
      })
      .png()
      .toBuffer();
    return `data:image/png;base64,${bigger.toString('base64')}`;
  } catch {
    return dataUrl;
  }
}
