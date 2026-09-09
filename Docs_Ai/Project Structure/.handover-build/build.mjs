import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { marked } from 'marked';
import { chromium } from 'playwright-core';

const root = 'C:/projects/hmc/development';
const output = path.join(root, 'Docs_Ai/Project Structure');
const design = path.join(root, 'malomatia-design');
const name = process.argv[2] || 'PROJECT_HANDOVER_MALOMATIA';
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const normalizeMarkers = value => value.replace(/\u{1f513}/gu, 'Public').replace(/\u{1f510}/gu, 'JWT').replace(/\u26a0\ufe0f?/gu, 'Caution:').replace(/\u2b50/gu, 'KEY:');
const markdown = normalizeMarkers(await fs.readFile(path.join(output, 'PROJECT_HANDOVER.md'), 'utf8'));
const chapterLinks = [...markdown.matchAll(/^\d+\. \[([^\]]+)\]\(#([^)]+)\)/gm)].map(match => ({ title: match[1], id: match[2] }));
const tokens = marked.lexer(markdown.slice(markdown.indexOf('# 1. Project Overview')));
let chapterIndex = 0;
const renderer = new marked.Renderer();
renderer.heading = function(token) {
  const text = this.parser.parseInline(token.tokens);
  if (token.depth === 1) {
    const chapter = chapterLinks[chapterIndex++];
    return `<h1 class="chapter-title" id="${chapter.id}" data-title="${escape(chapter.title)}"><span class="chapter-number">Chapter ${String(chapterIndex).padStart(2, '0')} / 21</span>${this.parser.parseInline(marked.lexer(token.text.replace(/^\d+\.\s*/, ''))[0].tokens)}</h1>`;
  }
  return `<h${token.depth}>${text}</h${token.depth}>`;
};
renderer.code = function(token) {
  const diagram = token.lang === 'text';
  const caption = diagram ? 'Architecture / reference' : `${token.lang || 'code'} / reference`;
  return `<figure class="code-block${diagram ? ' diagram' : ''}"><figcaption class="code-caption">${caption}</figcaption><pre><code>${token.text.split('\n').map(line => `<span class="code-line">${escape(line) || '&#8203;'}</span>`).join('')}</code></pre></figure>`;
};
const standardTable = renderer.table;
renderer.table = function(token) {
  let kind = '';
  const first = token.header[0].text;
  if (first === 'Method') kind = 'endpoints';
  if (first === 'Variable') kind = 'config';
  if (first === '#') kind = 'transfer';
  if (first === 'Technology') kind = 'stack';
  return standardTable.call(this, token).replace('<table>', `<table data-kind="${kind}">`);
};
const content = marked.parser(tokens, { renderer });
const data = async (file, mime) => `data:${mime};base64,${(await fs.readFile(path.join(design, file))).toString('base64')}`;
const [logo, photo, fontBook, fontLight, tokenFile, css, script] = await Promise.all([
  data('assets/logos/malomatia-logo.png', 'image/png'),
  data('assets/imagery/qatar-skyline-arches.jpg', 'image/jpeg'),
  data('fonts/Equestrienne_Book.ttf', 'font/ttf'),
  data('fonts/Equestrienne_Light.ttf', 'font/ttf'),
  fs.readFile(path.join(design, 'colors_and_type.css'), 'utf8'),
  fs.readFile('handover.css', 'utf8'),
  fs.readFile('paginate.js', 'utf8')
]);
const variables = [...tokenFile.matchAll(/^\s*(--[\w-]+):\s*([^;]+);/gm)].map(match => `${match[1]}: ${match[2]};`).join('\n');
const toc = (from, to) => chapterLinks.slice(from, to).map((link, index) => `<a class="toc-row" href="#${link.id}"><span class="toc-number">${String(from + index + 1).padStart(2, '0')}</span><span class="toc-text">${escape(link.title)}</span><span class="toc-page"></span></a>`).join('\n');
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="HMC Sanaad B2E project handover and developer onboarding. malomatia design reissue of version 1.0, 30 August 2026.">
<title>HMC Sanaad — Project Handover | malomatia</title>
<style>
@font-face { font-family: 'Equestrienne'; src: url('${fontBook}') format('truetype'); font-weight: 400; font-display: block; }
@font-face { font-family: 'Equestrienne'; src: url('${fontLight}') format('truetype'); font-weight: 300; font-display: block; }
:root { ${variables} }
${css}
</style>
</head>
<body>
<div class="toolbar"><div class="toolbar-title">Sanaad / project handover <small id="page-count">Preparing pages</small></div><div class="toolbar-actions"><a href="#contents">Contents</a><button type="button" onclick="window.print()">Print / save PDF</button></div></div>
<main id="document" aria-label="Project handover document">
<article class="sheet cover" aria-label="Cover">
<div class="cover-top"><img class="cover-logo" src="${logo}" alt="malomatia"><div class="cover-index">HMC / Sanaad B2E<br>Developer onboarding</div><div class="eyebrow">Knowledge transfer / application development</div><h1 class="cover-title">project<br><span>handover</span></h1><p class="cover-subtitle">HMC Sanaad B2E Platform</p><p class="cover-description">Project Handover &amp; Developer Onboarding<br>HMC_BackEnd (Sanaad API) · HMC_Gateway (Public Gateway)<br>NestJS 11 · Node.js 20 · Oracle · SQL Server</p></div>
<div class="cover-rule"></div><div class="cover-image"><img src="${photo}" alt="Doha skyline framed by the Museum of Islamic Art arches"><span class="cover-image-label">HMC / employee self-service platform</span></div>
<div class="cover-meta"><div><label>Content version</label><strong>1.0 / 30 August 2026</strong></div><div><label>Scope</label><strong>02 applications</strong></div><div><label>Handover</label><strong>21 chapters</strong></div></div>
<div class="cover-bottom"><span>Internal document — contains no credentials.</span><span>malomatia design reissue · 08 September 2026</span></div>
</article>
<article class="sheet" id="contents" aria-label="Contents and reading guide">
<header class="page-header"><img class="header-logo" src="${logo}" alt="malomatia"><span class="header-label">Sanaad / reading guide</span></header>
<div class="page-body"><div class="eyebrow">Navigate the handover</div><h1 class="contents-title">inside this handover</h1>
<div class="contents-intro"><p><strong>Audience:</strong> a developer who is new to this project and has little or no experience with Node.js, TypeScript, or NestJS.</p><p><strong>Goal:</strong> after reading this document you should be able to run, understand, debug, maintain, and extend the system with minimal help from the previous developer.</p></div>
<div class="edition-note"><strong>Source snapshot:</strong> version 1.0, dated 2026-08-30. This revised edition applies the requested content scope and standard command notation; it does not revalidate the remaining technical guidance. Verify current implementation against the repositories and <code>AGENTS.md</code>.</div>
<nav class="contents-grid" aria-label="Table of contents"><div>${toc(0, 11)}</div><div>${toc(11, 21)}</div></nav>
<div class="route-note"><p><strong>Start locally</strong> / Chapters 1–7 establish the platform, tools, setup, and application structure.</p><p><strong>Understand operations</strong> / Chapters 8–14 cover modules, authentication, data, configuration, and error handling.</p><p><strong>Take ownership</strong> / Chapters 15–21 cover delivery, testing, troubleshooting, learning, and team knowledge transfer.</p></div>
</div><footer class="page-footer"><span>HMC Sanaad B2E · v1.0 · 30 August 2026</span><span>Internal · design reissue</span><span class="footer-page"></span></footer>
</article>
</main>
<template id="source">
${content}
</template>
<script>${script}</script>
</body>
</html>`;
const htmlPath = path.join(output, `${name}.html`);
await fs.writeFile(htmlPath, html);
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 1100 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://**/*', route => route.abort());
  await page.route('https://**/*', route => route.abort());
  await page.goto(pathToFileURL(htmlPath).href);
  await page.waitForSelector('html[data-ready="true"]', { timeout: 30000 });
  await page.emulateMedia({ media: 'print' });
  const audit = await page.evaluate(() => {
    const sheets = [...document.querySelectorAll('#document > .sheet')];
    const original = document.getElementById('source').content;
    const chapters = [...document.querySelectorAll('#document .chapter-title')];
    const overflow = [...document.querySelectorAll('.page-body')].flatMap(body => {
      const boundary = body.getBoundingClientRect();
      return [...body.children].filter(child => child.getBoundingClientRect().bottom > boundary.bottom + 1 || child.getBoundingClientRect().right > boundary.right + 1).map(child => ({ page: sheets.indexOf(body.closest('.sheet')) + 1, tag: child.tagName, text: child.textContent.slice(0, 100) }));
    });
    const orphanHeadings = [...document.querySelectorAll('.content-sheet .page-body')].filter(body => body.lastElementChild?.matches('h1,h2,h3')).map(body => sheets.indexOf(body.closest('.sheet')) + 1);
    const rowText = root => [...root.querySelectorAll('tbody > tr')].map(row => row.textContent.replace(/\s+/g, ' ').trim());
    const codeText = root => [...root.querySelectorAll('.code-line')].map(line => line.textContent);
    const unresolvedLinks = [...document.querySelectorAll('#document a[href^="#"]')].map(a => a.getAttribute('href')).filter(href => !document.getElementById(href.slice(1)));
    return { pages: sheets.length, chapters: chapters.length, sourceTables: original.querySelectorAll('table').length, sourceCodeBlocks: original.querySelectorAll('.code-block').length, tableRowsPreserved: JSON.stringify(rowText(original)) === JSON.stringify(rowText(document.querySelector('#document'))), codeLinesPreserved: JSON.stringify(codeText(original)) === JSON.stringify(codeText(document.querySelector('#document'))), overflow, orphanHeadings, unresolvedLinks, toc: chapters.map(title => ({ title: title.dataset.title, page: sheets.indexOf(title.closest('.sheet')) + 1 })) };
  });
  audit.consoleErrors = errors;
  await fs.writeFile('layout-audit.json', JSON.stringify(audit, null, 2));
  await page.pdf({ path: path.join(output, `${name}.pdf`), printBackground: true, preferCSSPageSize: true, tagged: true, outline: true });
  for (const index of [0, 1, 2, audit.toc[7].page - 1, audit.toc[11].page - 1, audit.pages - 1]) {
    await page.locator('#document > .sheet').nth(index).screenshot({ path: `preview-${String(index + 1).padStart(2, '0')}.png` });
  }
  console.log(JSON.stringify({ html: htmlPath, pdf: path.join(output, `${name}.pdf`), ...audit }, null, 2));
  if (errors.length || audit.overflow.length || audit.orphanHeadings.length || !audit.tableRowsPreserved || !audit.codeLinesPreserved || audit.unresolvedLinks.length) process.exitCode = 1;
} finally {
  await browser.close();
}
