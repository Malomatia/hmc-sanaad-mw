import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createCanvas } from '@napi-rs/canvas';
import { chromium } from 'playwright-core';

const output = path.resolve('..');
const name = process.argv[2] || 'PROJECT_HANDOVER_MALOMATIA';
const excludedContent = [
  ['logging', /\b(?:logs|logging|logged|audit|observability)\b|\blog\b(?!\s+in\b)|ApiLogInterceptor|OracleLogStore|LOG_LEVEL|MASK_MESSAGE_LOG/i],
  ['diagnostic tools', /diagnos\w*|dev[-_ ]console|sql[-_ ]consoles?|\boracle-object\b|object describe|CorrelationIdMiddleware|x-correlation-id/i],
  ['Swagger tools', /swagger|localhost:\d+\/docs|\/docs(?=[\s),`]|$)/i],
  ['Windows command wrappers', /np[mx]\s*\.\s*cmd|execution\s+policy|Windows note|npm\.ps1/i],
  ['appointments', /cerner|appointments?/i],
  ['operational endpoints', /Operational endpoints|\/health(?!check)\b/i]
];
const exclusions = text => excludedContent.flatMap(([category, pattern]) => {
  const match = pattern.exec(text);
  return match ? [{ category, match: match[0] }] : [];
});
const buffer = await fs.readFile(path.join(output, `${name}.pdf`));
const pdf = await getDocument({ data: new Uint8Array(buffer), useSystemFonts: true }).promise;
const pdfPages = [];
const fullPdfText = [];
const boundsErrors = [];
const sizes = new Set();
let links = 0;
const contacts = [];
const normalize = text => text.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
for (let index = 0; index < pdf.numPages; index++) {
  const page = await pdf.getPage(index + 1);
  const viewport = page.getViewport({ scale: 1 });
  const content = await page.getTextContent();
  const items = content.items.filter(item => 'str' in item);
  fullPdfText.push(items.map(item => item.str).join(' '));
  sizes.add(`${Math.round(viewport.width)}x${Math.round(viewport.height)}`);
  const insideBody = items.filter(item => {
    const top = viewport.height - item.transform[5];
    return top > 90 && top < 790;
  });
  pdfPages.push(insideBody.map(item => item.str).join(' '));
  for (const item of items) {
    if (!item.str.trim()) continue;
    const x = item.transform[4];
    const y = item.transform[5];
    if (x < -1 || x + item.width > viewport.width + 1 || y < 0 || y > viewport.height + 1) boundsErrors.push({ page: index + 1, text: item.str });
  }
  links += (await page.getAnnotations()).filter(annotation => annotation.subtype === 'Link').length;
  const group = Math.floor(index / 16);
  if (!contacts[group]) {
    const canvas = createCanvas(1040, 1536);
    const context = canvas.getContext('2d');
    context.fillStyle = '#e5e5e5';
    context.fillRect(0, 0, canvas.width, canvas.height);
    contacts[group] = canvas;
  }
  const canvas = createCanvas(Math.ceil(viewport.width * .4), Math.ceil(viewport.height * .4));
  await page.render({ canvasContext: canvas.getContext('2d'), viewport: page.getViewport({ scale: .4 }) }).promise;
  const context = contacts[group].getContext('2d');
  const x = 11 + (index % 4) * 260;
  const y = 22 + Math.floor((index % 16) / 4) * 384;
  context.fillStyle = '#000000';
  context.font = '12px Arial';
  context.fillText(`PAGE ${index + 1}`, x, y - 6);
  context.drawImage(canvas, x, y);
  if ([14, 15, 25, 33].includes(index + 1)) {
    const detail = createCanvas(Math.ceil(viewport.width * 1.5), Math.ceil(viewport.height * 1.5));
    await page.render({ canvasContext: detail.getContext('2d'), viewport: page.getViewport({ scale: 1.5 }) }).promise;
    await fs.writeFile(`pdf-detail-${index + 1}.png`, detail.toBuffer('image/png'));
  }
}
for (const [index, canvas] of contacts.entries()) await fs.writeFile(`pdf-contact-${index + 1}.png`, canvas.toBuffer('image/png'));
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
let audit;
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 } });
  await page.route('http://**/*', route => route.abort());
  await page.route('https://**/*', route => route.abort());
  await page.goto(pathToFileURL(path.join(output, `${name}.html`)).href);
  await page.waitForSelector('html[data-ready="true"]');
  audit = await page.evaluate(() => {
    const source = document.getElementById('source').content;
    const normalize = root => {
      const clone = root.cloneNode(true);
      clone.querySelectorAll('thead,.code-caption').forEach(element => element.remove());
      return clone.textContent.replace(/\s+/g, '');
    };
    const result = document.createElement('div');
    document.querySelectorAll('.content-sheet .page-body').forEach(body => result.appendChild(body.cloneNode(true)));
    const clipped = [...document.querySelectorAll('.page-body *')].filter(element => element.clientWidth && element.scrollWidth > element.clientWidth + 2).map(element => ({ tag: element.tagName, text: element.textContent.slice(0, 100) }));
    const paragraphs = [...source.querySelectorAll('p,li,tbody > tr,.code-line')].map(element => element.textContent);
    const wrappedCode = [...document.querySelectorAll('.content-sheet .code-line')].filter(line => line.getBoundingClientRect().height > parseFloat(getComputedStyle(line).lineHeight) * 1.7).map(line => line.textContent);
    const chapterPages = [...document.querySelectorAll('.chapter-title')].map(heading => ({ title: heading.dataset.title, page: [...document.querySelectorAll('#document > .sheet')].indexOf(heading.closest('.sheet')) + 1 }));
    const assetsEmbedded = [...document.querySelectorAll('img')].every(image => image.src.startsWith('data:') && image.naturalWidth > 0);
    const tocTargets = [...document.querySelectorAll('.toc-row')].map(link => ({ href: link.getAttribute('href'), page: Number(link.querySelector('.toc-page').textContent) }));
    const tocPagesCorrect = tocTargets.every(link => [...document.querySelectorAll('#document > .sheet')].indexOf(document.getElementById(link.href.slice(1))?.closest('.sheet')) + 1 === link.page);
    const sectionNumbers = [...source.querySelectorAll('h2')].map(heading => heading.textContent.match(/^(\d+)\.(\d+)\s/)?.slice(1).map(Number)).filter(Boolean);
    const subsectionNumberingCorrect = sectionNumbers.every(([chapter, number], index) => number === (sectionNumbers[index - 1]?.[0] === chapter ? sectionNumbers[index - 1][1] + 1 : 1));
    return { fullContentPreserved: normalize(source) === normalize(result), htmlPages: document.querySelectorAll('#document > .sheet').length, visibleText: document.querySelector('#document').innerText, clipped, paragraphs, wrappedCode, assetsEmbedded, chapterPages, tocPagesCorrect, subsectionNumberingCorrect };
  });
  await page.locator('.toolbar a').click();
  audit.contentsNavigationWorks = await page.evaluate(() => location.hash === '#contents');
  await page.locator('.toc-row').nth(11).click();
  audit.chapterNavigationWorks = await page.evaluate(() => location.hash === '#12-configuration--environment-variables');
} finally {
  await browser.close();
}
const finalText = normalize(pdfPages.slice(2).join(' '));
const missingText = audit.paragraphs.filter(text => normalize(text).length > 5 && !finalText.includes(normalize(text)));
const markdown = await fs.readFile(path.join(output, 'PROJECT_HANDOVER.md'), 'utf8');
const report = {
  pdfPages: pdf.numPages,
  htmlPages: audit.htmlPages,
  pageSizes: [...sizes],
  links,
  fullContentPreservedInHtml: audit.fullContentPreserved,
  checkedTextUnits: audit.paragraphs.length,
  missingPdfTextUnits: missingText,
  pdfBoundsErrors: boundsErrors,
  clippedHtmlElements: audit.clipped,
  wrappedCodeLines: audit.wrappedCode,
  assetsEmbedded: audit.assetsEmbedded,
  contentsNavigationWorks: audit.contentsNavigationWorks,
  chapterNavigationWorks: audit.chapterNavigationWorks,
  tocPagesCorrect: audit.tocPagesCorrect,
  subsectionNumberingCorrect: audit.subsectionNumberingCorrect,
  excludedContentInMarkdown: exclusions(markdown),
  excludedContentInHtml: exclusions(audit.visibleText),
  excludedContentInPdf: exclusions(fullPdfText.join(' ')),
  htmlBytes: (await fs.stat(path.join(output, `${name}.html`))).size,
  pdfBytes: buffer.length
};
await fs.writeFile('verification.json', JSON.stringify(report, null, 2));
await fs.writeFile('revised-pdf.txt', fullPdfText.map((text, index) => `PAGE ${index + 1}\n${text}`).join('\n\n'));
console.log(JSON.stringify(report, null, 2));
await pdf.destroy();
if (!report.fullContentPreservedInHtml || report.missingPdfTextUnits.length || report.pdfBoundsErrors.length || report.clippedHtmlElements.length || report.pdfPages !== report.htmlPages || !report.assetsEmbedded || !report.contentsNavigationWorks || !report.chapterNavigationWorks || !report.tocPagesCorrect || !report.subsectionNumberingCorrect || report.excludedContentInMarkdown.length || report.excludedContentInHtml.length || report.excludedContentInPdf.length) process.exitCode = 1;
