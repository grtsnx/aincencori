import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { readableImage } from '@/middleware/commons/image.js';

const png = async (width: number, height: number) =>
  `data:image/png;base64,${(
    await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 255, g: 0, b: 0 },
      },
    })
      .png()
      .toBuffer()
  ).toString('base64')}`;
const size = async (dataUrl: string) => {
  const { width, height } = await sharp(
    Buffer.from(dataUrl.split(',')[1], 'base64'),
  ).metadata();
  return [width, height];
};

describe('readableImage', () => {
  it('enlarges a small picture and keeps its shape', async () => {
    expect(await size(await readableImage(await png(64, 64)))).toEqual([
      512, 512,
    ]);
    expect(await size(await readableImage(await png(100, 50)))).toEqual([
      1024, 512,
    ]);
  });

  it('never grows a side past 2048', async () => {
    expect(await size(await readableImage(await png(1000, 10)))).toEqual([
      2048, 20,
    ]);
  });

  it('leaves normal pictures and anything else untouched', async () => {
    const normal = await png(800, 600);
    expect(await readableImage(normal)).toBe(normal);
    for (const other of [
      'data:application/pdf;base64,AAAA',
      'data:image/png;base64,not-a-real-image',
      'data:image/svg+xml;base64,PHN2Zy8+',
    ]) {
      expect(await readableImage(other)).toBe(other);
    }
  });
});
