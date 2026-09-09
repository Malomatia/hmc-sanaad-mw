const ready = async () => {
  await document.fonts.ready;
  await Promise.all([...document.images].map(image => image.decode().catch(() => {})));
  const host = document.getElementById('document');
  const template = document.getElementById('source');
  const nodes = [...template.content.children];
  const chapters = nodes.filter(node => node.matches('h1'));
  let sheet;
  let body;
  let chapter = '';
  const newPage = () => {
    sheet = document.createElement('article');
    sheet.className = 'sheet content-sheet';
    sheet.dataset.chapter = chapter;
    sheet.innerHTML = `<header class="page-header"><img class="header-logo" src="${document.querySelector('.cover-logo').src}" alt="malomatia"><span class="header-label">Sanaad / ${chapter}</span></header><div class="page-body"></div><footer class="page-footer"><span>HMC Sanaad B2E · v1.0 · 30 August 2026</span><span>Internal · design reissue</span><span class="footer-page"></span></footer>`;
    host.appendChild(sheet);
    body = sheet.querySelector('.page-body');
  };
  const overflows = () => {
    const last = body.lastElementChild;
    return last && last.getBoundingClientRect().bottom > body.getBoundingClientRect().bottom + .5;
  };
  const append = node => {
    body.appendChild(node);
    if (overflows() && body.children.length > 1) {
      node.remove();
      newPage();
      body.appendChild(node);
    }
  };
  const splitTable = source => {
    const rows = [...source.querySelectorAll('tbody > tr')];
    const shell = () => {
      const table = source.cloneNode(false);
      table.appendChild(source.querySelector('thead').cloneNode(true));
      table.appendChild(document.createElement('tbody'));
      return table;
    };
    let table = shell();
    body.appendChild(table);
    for (const row of rows) {
      table.tBodies[0].appendChild(row.cloneNode(true));
      if (overflows()) {
        table.tBodies[0].lastElementChild.remove();
        if (!table.tBodies[0].children.length) table.remove();
        newPage();
        table = shell();
        body.appendChild(table);
        table.tBodies[0].appendChild(row.cloneNode(true));
      }
    }
  };
  const splitCode = source => {
    const lines = [...source.querySelectorAll('.code-line')];
    const shell = continued => {
      const figure = source.cloneNode(true);
      figure.querySelector('code').replaceChildren();
      if (continued) figure.querySelector('.code-caption').textContent += ' / continued';
      return figure;
    };
    let figure = shell(false);
    body.appendChild(figure);
    for (const line of lines) {
      figure.querySelector('code').appendChild(line.cloneNode(true));
      if (overflows()) {
        figure.querySelector('code').lastElementChild.remove();
        if (!figure.querySelector('code').children.length) figure.remove();
        newPage();
        figure = shell(true);
        body.appendChild(figure);
        figure.querySelector('code').appendChild(line.cloneNode(true));
      }
    }
  };
  const splitList = source => {
    let list = source.cloneNode(false);
    body.appendChild(list);
    for (const [index, item] of [...source.children].entries()) {
      list.appendChild(item.cloneNode(true));
      if (overflows()) {
        list.lastElementChild.remove();
        if (!list.children.length) list.remove();
        newPage();
        list = source.cloneNode(false);
        if (list.tagName === 'OL') list.start = Number(source.getAttribute('start') || 1) + index;
        body.appendChild(list);
        list.appendChild(item.cloneNode(true));
      }
    }
  };
  for (let index = 0; index < nodes.length; index++) {
    const source = nodes[index];
    if (source.matches('hr')) continue;
    if (source.matches('h1')) {
      chapter = source.dataset.title;
      newPage();
      body.appendChild(source.cloneNode(true));
      continue;
    }
    if (source.matches('h2,h3')) {
      const heading = source.cloneNode(true);
      body.appendChild(heading);
      const reserve = nodes[index + 1]?.matches('h2,h3') ? 155 : 100;
      if (heading.getBoundingClientRect().bottom + reserve > body.getBoundingClientRect().bottom && body.children.length > 1) {
        heading.remove();
        newPage();
        body.appendChild(heading);
      }
      continue;
    }
    if (source.matches('table')) splitTable(source);
    else if (source.matches('.code-block')) {
      const copy = source.cloneNode(true);
      body.appendChild(copy);
      if (overflows()) {
        copy.remove();
        const remaining = body.getBoundingClientRect().bottom - (body.lastElementChild?.getBoundingClientRect().bottom || body.getBoundingClientRect().top);
        if (remaining < 200) newPage();
        splitCode(source);
      }
    } else if (source.matches('ul,ol')) splitList(source);
    else append(source.cloneNode(true));
  }
  const sheets = [...host.querySelectorAll('.sheet')];
  sheets.forEach((page, index) => {
    page.id ||= `page-${index + 1}`;
    const footer = page.querySelector('.footer-page');
    if (footer) footer.textContent = `${String(index + 1).padStart(2, '0')} / ${sheets.length}`;
  });
  for (const title of chapters) {
    const target = document.getElementById(title.id);
    const page = sheets.indexOf(target.closest('.sheet')) + 1;
    const link = document.querySelector(`.toc-row[href="#${title.id}"]`);
    if (link) link.querySelector('.toc-page').textContent = String(page).padStart(2, '0');
  }
  document.getElementById('page-count').textContent = `${sheets.length} pages · 21 chapters`;
  document.documentElement.dataset.ready = 'true';
};
ready().catch(error => {
  document.getElementById('page-count').textContent = 'Layout failed — reload this document';
  console.error(error);
});
