import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const source = process.argv[2] || 'C:/Users/melserag/Downloads/PROJECT_HANDOVER.pdf';
const output = process.argv[3] || 'source-pdf.txt';
const data = await fs.readFile(source);
const pdf = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
const pages = [];
for (let n = 1; n <= pdf.numPages; n++) {
  const page = await pdf.getPage(n);
  const content = await page.getTextContent();
  let text = '';
  for (const item of content.items) if ('str' in item) text += item.str + (item.hasEOL ? '\n' : ' ');
  pages.push(`===== PAGE ${n} =====\n${text}`);
}
await fs.writeFile(output, pages.join('\n\n'));
const hash = crypto.createHash('sha256').update(data).digest('hex');
const companion = await fs.readFile('../PROJECT_HANDOVER.pdf');
const companionHash = crypto.createHash('sha256').update(companion).digest('hex');
console.log(JSON.stringify({ pages: pdf.numPages, bytes: data.length, sha256: hash, identicalToWorkspacePdf: hash === companionHash, metadata: await pdf.getMetadata(), textOutput: path.resolve(output) }, null, 2));
await pdf.destroy();
