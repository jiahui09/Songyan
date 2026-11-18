/* Isolated compatibility builds; never edits the active dev-site config or content. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const Hexo = createRequire(path.resolve(__dirname, '../dev-site/package.json'))('hexo');
const base = path.resolve(__dirname, '../dev-site');
const output = '/tmp/opencode/songyan-build-variants';

async function build(name, overrides, source) {
  const folder = path.join(output, name);
  await fs.mkdir(folder, { recursive: true });
  const config = path.join(folder, 'override.json');
  await fs.writeFile(config, JSON.stringify({ public_dir: path.join(folder, 'public'), ...overrides, ...(source ? { source_dir: source } : {}) }));
  const hexo = new Hexo(base, { config: [path.join(base, '_config.yml'), config].join(','), output: folder, silent: true });
  await fs.rm(path.join(folder, 'db.json'), { force: true });
  try { await hexo.init(); await hexo.call('generate', {}); }
  finally { await hexo.exit(); }
  return path.join(folder, 'public');
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const subpath = await build('subpath', { root: '/journal/', url: 'https://example.invalid/journal/' });
  const article = await fs.readFile(path.join(subpath, '2026/10/10/test/index.html'), 'utf8');
  assert.ok(article.includes('href="/journal/archives/"'));
  assert.ok(article.includes('src="/journal/images/reading-portrait.svg"'));
  assert.ok(!article.includes('/journal/journal/'));
  console.log('PASS isolated /journal/ deployment: templates and Markdown links/images use configured root');

  const fixture = path.join(output, 'fixture-source');
  await fs.mkdir(path.join(fixture, '_posts'), { recursive: true });
  await fs.mkdir(path.join(fixture, 'about'), { recursive: true });
  await fs.mkdir(path.join(fixture, 'notes'), { recursive: true });
  await fs.writeFile(path.join(fixture, 'about/index.html'), '---\nlayout: about\ntitle: About fixture\ndate: 2026-11-12\n---\n<p>About content from author.</p>');
  await fs.writeFile(path.join(fixture, 'notes/index.html'), '---\nlayout: page\ntitle: Generic page fixture\ndate: 2026-11-12\n---\n<h2>Page content</h2><p>Generic page is rendered.</p>');
  await fs.writeFile(path.join(fixture, '404.html'), '---\nlayout: 404\npermalink: 404.html\n---');
  for (let i = 0; i < 13; i++) {
    await fs.writeFile(path.join(fixture, `_posts/entry-${i}.html`), `---\ntitle: Entry ${i}\ndate: 2026-10-${String(i + 1).padStart(2, '0')}\ntype: ${i === 0 ? 'invalid' : 'post'}\n${i === 1 ? 'seal: false\n' : ''}categories: [技术]\ntags: [验收]\n---\n<p>Post ${i}, minimal optional metadata.</p>`);
  }
  const paginated = await build('paginated', { index_generator: { path: '', per_page: 3, order_by: '-date' }, per_page: 3, archive_generator: { per_page: 0 } }, fixture);
  const index = await fs.readFile(path.join(paginated, 'index.html'), 'utf8');
  const page2 = await fs.readFile(path.join(paginated, 'page/2/index.html'), 'utf8');
  assert.equal((index.match(/class="post-item"/g) || []).length, 3);
  assert.equal((page2.match(/class="post-item"/g) || []).length, 3);
  assert.ok(index.includes('class="home-cover"'), 'first page has its cover');
  assert.ok(!page2.includes('class="home-cover"'), 'pagination never repeats the cover');
  assert.ok(index.includes('class="pagination"') && index.includes('/page/2/'));
  const archive = await fs.readFile(path.join(paginated, 'archives/index.html'), 'utf8');
  assert.equal((archive.match(/class="archive-list__item"/g) || []).length, 13, 'full archive includes every published post');
  assert.ok(!(await fs.readdir(path.join(paginated, 'archives'))).includes('page'), 'main archive never paginates duplicate content');
  assert.ok(!archive.includes('class="pagination"'), 'main archive omits the pagination partial');
  const unknown = await fs.readFile(path.join(paginated, '2026/10/01/entry-0/index.html'), 'utf8');
  assert.ok(unknown.includes('essay-body reading-body'), 'unknown type falls back to prose');
  const noSeal = await fs.readFile(path.join(paginated, '2026/10/02/entry-1/index.html'), 'utf8');
  assert.ok(!noSeal.includes('seal--signature'), 'per-post seal:false respected');
  const generic = await fs.readFile(path.join(paginated, 'notes/index.html'), 'utf8');
  assert.ok(generic.includes('Generic page is rendered.') && /class="[^"]*\breading-page\b/.test(generic), 'generic page uses reading stylesheet scope');
  assert.ok(/class="[^"]*\breading-dock-page\b/.test(generic) && generic.includes('reading-body-anchor'), 'standalone pages share the reading cover dock');
  const about = await fs.readFile(path.join(paginated, 'about/index.html'), 'utf8');
  assert.ok(about.includes('About content from author.'), 'author-provided about content replaces fallback');
  assert.ok(/class="[^"]*\breading-dock-page\b/.test(about) && about.includes('reading-mast'), 'about page uses the reading cover dock');
  console.log('PASS isolated 13-post fixture: pagination, complete archive, generic page, custom about, missing metadata, unknown type and per-post seal switch');

  const emptySource = path.join(output, 'empty-source');
  await fs.mkdir(emptySource, { recursive: true });
  const empty = await build('empty', {}, emptySource);
  const emptyFiles = await fs.readdir(empty);
  assert.ok(emptyFiles.includes('css') && emptyFiles.includes('index.html') === false, 'empty source generates assets without inventing a post index');
  console.log('PASS isolated empty site: successful generation without fabricated content');
  const coverOff = await build('cover-off', { theme_config: { home: { cover: false } } });
  const directIndex = await fs.readFile(path.join(coverOff, 'index.html'), 'utf8');
  assert.ok(!directIndex.includes('class="home-cover"'), 'home.cover:false disables the cover');
  assert.ok(directIndex.includes('id="home-stream"') && directIndex.includes('class="post-item"'), 'content remains present with the cover disabled');
  console.log('PASS isolated home.cover:false: direct reading without a cover or broken content target');
  if (process.env.PLAYWRIGHT_PACKAGE) {
    const { createServer } = require('node:http');
    const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE)('playwright');
    const evidence = '/tmp/songyan-other-pages-qa';
    await fs.mkdir(evidence, { recursive: true });
    const server = createServer(async (req, res) => {
      try {
        let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        if (name.endsWith('/')) name += 'index.html';
        const file = path.resolve(paginated, '.' + name);
        assert.ok(file.startsWith(paginated + path.sep));
        const data = await fs.readFile(file);
        res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      } catch { res.writeHead(404); res.end(); }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true });
    try {
      const page = await browser.newPage();
      for (const viewport of [{ width: 1024, height: 768 }, { width: 1440, height: 900 }]) {
        await page.setViewportSize(viewport);
        for (const route of ['/notes/', '/about/', '/2026/10/01/entry-0/']) {
          await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
          await page.evaluate(() => document.fonts.ready);
          const center = () => page.locator('.reading-mast .post-title, .reading-mast .page-about__name').evaluate(el => {
            const rect = el.getBoundingClientRect();
            return (rect.top + rect.bottom) / 2;
          });
          assert.ok(Math.abs(await center() - viewport.height / 2) < 1, `${route}: initial cover centers`);
          await page.mouse.move(20, 200);
          await page.mouse.wheel(0, 120);
          await page.waitForTimeout(800);
          assert.ok(await page.evaluate(() => {
            const mast = document.querySelector('.reading-mast').getBoundingClientRect();
            const anchor = document.querySelector('.reading-body-anchor').getBoundingClientRect();
            return Math.abs(mast.bottom - anchor.top) < 2;
          }), `${route}: body docks beneath title`);
          await page.mouse.wheel(0, -120);
          await page.waitForTimeout(800);
          const returned = await center();
          await page.waitForTimeout(200);
          assert.ok(Math.abs(returned - viewport.height / 2) < 1 && Math.abs(await center() - returned) < 0.1, `${route}: return centers without a late jump`);
          await page.screenshot({ path: path.join(evidence, `${route.split('/').filter(Boolean).pop()}-${viewport.width}.png`) });
        }
      }
      for (const route of ['/page/2/', '/404.html']) {
        await page.goto(`http://127.0.0.1:${server.address().port}${route}`);
        assert.equal(await page.locator('html.cover-scroll-enabled').count(), 0, `${route}: no cover controller without a cover`);
        assert.equal(await page.locator('.site-header').evaluate(el => getComputedStyle(el).position), 'relative', `${route}: normal header layout retained`);
      }
      console.log(`PASS isolated page animations: independent page, custom about, fallback post, pagination and 404. Evidence: ${evidence}`);
    } finally {
      await browser.close();
      await new Promise(resolve => server.close(resolve));
    }
  }
  console.log(`RESULT: 4 isolated build variants passed. Subpath output: ${subpath}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
