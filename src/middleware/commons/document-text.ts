// Turns a file into plain text, and plain text into pieces small enough to
// search and to hand to an AI model.
import mammoth from 'mammoth';
import { extractText, getDocumentProxy } from 'unpdf';

const pdf = 'application/pdf';
const docx =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

// File types we can read, and the type each file ending stands for (used
// when a browser sends no clear type).
const byExtension: Record<string, string> = {
  pdf,
  docx,
  txt: 'text/plain',
  md: 'text/markdown',
  markdown: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  html: 'text/html',
  htm: 'text/html',
};
const readable = new Set(Object.values(byExtension));

// A file we can't read, with a message for the user.
export class UnreadableDocumentError extends Error {}

// The type we will read the file as, or null when we can't read it.
export function documentType(
  contentType: string,
  fileName: string,
): string | null {
  const type = contentType.split(';')[0].trim().toLowerCase();
  if (readable.has(type)) return type;
  const extension = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  return (extension && byExtension[extension]) || null;
}

// The text of a file. Throws UnreadableDocumentError when there is none.
export async function readDocumentText(
  bytes: Uint8Array,
  type: string,
): Promise<string> {
  let text: string;
  try {
    if (type === pdf) {
      const document = await getDocumentProxy(new Uint8Array(bytes));
      const result = await extractText(document, { mergePages: false });
      text = result.text.join('\n\n');
    } else if (type === docx) {
      text = (await mammoth.extractRawText({ buffer: Buffer.from(bytes) }))
        .value;
    } else {
      text = new TextDecoder().decode(bytes);
      if (type === 'text/html') text = htmlToText(text);
    }
  } catch {
    throw new UnreadableDocumentError(
      'This file could not be read. It may be damaged or locked.',
    );
  }
  const clean = cleanText(text);
  if (!clean) {
    throw new UnreadableDocumentError(
      'No text found. Is it a scanned PDF? Try a file with real text.',
    );
  }
  return clean;
}

// Splits text into pieces of about `size` characters, at paragraph ends
// when it can, then at sentence ends, so each piece reads on its own.
export function splitText(text: string, size: number): string[] {
  const pieces: string[] = [];
  let current = '';
  const push = () => {
    if (current.trim()) pieces.push(current.trim());
    current = '';
  };
  for (const paragraph of text.split(/\n{2,}/)) {
    for (const part of shorterThan(paragraph, size)) {
      if (current && current.length + part.length + 2 > size) push();
      current = current ? `${current}\n\n${part}` : part;
    }
  }
  push();
  return pieces;
}

// One paragraph as parts no longer than size: by sentence, then by force.
function shorterThan(paragraph: string, size: number): string[] {
  if (paragraph.length <= size) return [paragraph];
  const parts: string[] = [];
  let current = '';
  for (const sentence of paragraph.split(/(?<=[.!?])\s+/)) {
    for (let start = 0; start < sentence.length; start += size) {
      const bit = sentence.slice(start, start + size);
      if (current && current.length + bit.length + 1 > size) {
        parts.push(current);
        current = '';
      }
      current = current ? `${current} ${bit}` : bit;
    }
  }
  if (current) parts.push(current);
  return parts;
}

// Removes characters a database can't store and evens out spacing.
function cleanText(text: string): string {
  return (
    text
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, ' ')
      .replace(/\r\n?/g, '\n')
      .replace(/[ \t]+/g, ' ')
      .replace(/ *\n */g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

// Just the words of a web page.
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
