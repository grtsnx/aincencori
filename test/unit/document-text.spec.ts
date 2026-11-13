import { describe, expect, it } from 'vitest';
import {
  documentType,
  readDocumentText,
  splitText,
  UnreadableDocumentError,
} from '@/middleware';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('document text', () => {
  it('knows which files it can read, by type or by file ending', () => {
    expect(documentType('application/pdf', 'a.pdf')).toBe('application/pdf');
    expect(documentType('text/plain;charset=utf-8', 'a.txt')).toBe(
      'text/plain',
    );
    expect(documentType('application/octet-stream', 'notes.md')).toBe(
      'text/markdown',
    );
    expect(documentType('', 'Report.DOCX')).toBe(
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    );
    expect(documentType('image/png', 'photo.png')).toBeNull();
  });

  it('reads text and web pages, without characters a database refuses', async () => {
    await expect(
      readDocumentText(bytes('Hello\u0000 world\r\n\r\n\r\nBye'), 'text/plain'),
    ).resolves.toBe('Hello world\n\nBye');
    await expect(
      readDocumentText(
        bytes(
          '<html><style>p{}</style><p>Fish &amp; chips</p><script>x()</script></html>',
        ),
        'text/html',
      ),
    ).resolves.toBe('Fish & chips');
  });

  it('says why when there is no text, or the file is damaged', async () => {
    await expect(readDocumentText(bytes('   '), 'text/plain')).rejects.toThrow(
      UnreadableDocumentError,
    );
    await expect(
      readDocumentText(bytes('not a pdf'), 'application/pdf'),
    ).rejects.toThrow('could not be read');
  });

  it('splits text at paragraphs, then sentences, never over the size', () => {
    const paragraphs = ['A'.repeat(30), 'B'.repeat(30), 'C'.repeat(30)];
    expect(splitText(paragraphs.join('\n\n'), 70)).toEqual([
      `${'A'.repeat(30)}\n\n${'B'.repeat(30)}`,
      'C'.repeat(30),
    ]);

    const long = 'One sentence here. '.repeat(20).trim();
    const pieces = splitText(long, 60);
    expect(pieces.every((piece) => piece.length <= 60)).toBe(true);
    expect(pieces.join(' ')).toBe(long);

    // A word longer than the size is cut, not lost.
    expect(splitText('x'.repeat(25), 10)).toEqual([
      'x'.repeat(10),
      'x'.repeat(10),
      'x'.repeat(5),
    ]);
  });
});
