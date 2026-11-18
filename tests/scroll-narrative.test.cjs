/* Isolated narrative geometry/input checks; screenshots are evidence, never baselines. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const Hexo = createRequire(path.resolve(__dirname, '../dev-site/package.json'))('hexo');
const base = path.resolve(__dirname, '../dev-site');
const output = process.env.SONGYAN_SCROLL_QA_DIR || '/tmp/songyan-scroll-narrative';
const cases = [
  { id: 'short', title: '短诗', type: 'ci', body: '<p>床前明月光，</p><p>疑是地上霜。</p><p>举头望明月，</p><p>低头思故乡。</p>' },
  { id: 'horizontal', title: '横排短诗', type: 'ci', mode: 'horizontal', body: '<p>国破山河在，城春草木深。</p><p>感时花溅泪，恨别鸟惊心。</p>' },
  { id: 'long-ci', title: '长词测试', type: 'ci', body: Array.from({ length: 14 }, (_, i) => `<p>${i % 2 ? '回首故山路，极目暮云平。' : '料得玉阶凝伫，应念青衫零落，清梦绕江城。'}</p>`).join('') },
  { id: 'essay', title: '长文阅读与末尾交接', type: 'post', body: Array.from({ length: 35 }, (_, i) => `<h2 id="section-${i}">第${i + 1}节</h2><p>${'山水有清音，文字有余韵。'.repeat(18)}</p>`).join('') },
  { id: 'long-title', title: '这是一个用于验证长标题完整显示以及短窗口换行和正文安全距离的诗词题目', type: 'post', body: '<p>标题应完整，正文不与页脚混杂。</p>' }
];
const results = [];
function verify(row, condition, message) { if (!condition) row.failures.push(message); }
async function geometry(page) {
  return page.evaluate(() => {
    const box = selector => { const el = document.querySelector(selector); if (!el) return null; const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height, visible: s.visibility !== 'hidden' && s.display !== 'none' }; };
    const anchor = document.querySelector('.reading-body-anchor,.home-dock-zone + .home-sheet,.archive-toolbar');
    const footer = document.querySelector('body > .site-footer');
    const header = document.querySelector('.site-header').getBoundingClientRect().height;
    const dock = anchor.getBoundingClientRect().top + scrollY - parseFloat(getComputedStyle(anchor).scrollMarginTop);
    const titleElement = document.querySelector('.home-epigraph__text,.post-title,.page-about__name,.archive-head__title');
    return { titleSize: getComputedStyle(titleElement).fontSize, titleTracking: getComputedStyle(titleElement).letterSpacing, y: scrollY, dock, ending: Math.max(dock, footer.getBoundingClientRect().top + scrollY - innerHeight), footerY: document.documentElement.scrollHeight - innerHeight,
      h: innerHeight, header, title: box('.home-epigraph__text,.post-title,.page-about__name,.archive-head__title'),
      mast: box('.home-cover,.reading-mast,.archive-head'), content: box('.reading-scene,.home-sheet,.archive-cylinder,.chrono'), toolbar: box('.archive-toolbar'),
      footer: box('.site-footer'), main: box('body > .site-main'), classes: document.documentElement.className,
      snap: getComputedStyle(document.documentElement).scrollSnapType, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
  });
}
(async () => {
  assert.ok(process.env.PLAYWRIGHT_PACKAGE, 'Set PLAYWRIGHT_PACKAGE to an existing playwright/package.json');
  const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE)('playwright');
  const temp = await fs.mkdtemp('/tmp/songyan-scroll-build-');
  const source = path.join(temp, 'source'), publicDir = path.join(temp, 'public');
  await fs.mkdir(path.join(source, '_posts'), { recursive: true });
  await fs.mkdir(path.join(source, 'about'), { recursive: true });
  await fs.mkdir(output, { recursive: true });
  for (const fixture of cases) await fs.writeFile(path.join(source, '_posts', `${fixture.id}.html`), `---\ntitle: ${fixture.title}\ndate: 2026-10-12\ntype: ${fixture.type}\npermalink: story/${fixture.id}/\n${fixture.mode ? `poetry_layout: ${fixture.mode}\n` : ''}---\n${fixture.body}`);
  await fs.writeFile(path.join(source, 'about/index.html'), '---\nlayout: about\n---\n<p>独立关于页验证。</p>');
  await fs.writeFile(path.join(source, '_posts/oversize.html'), `---\ntitle: ${'长题签仍须完整可读'.repeat(35)}\ndate: 2026-10-12\ntype: post\npermalink: story/oversize/\n---\n<p>长题签应回到普通文流。</p>`);
  const config = path.join(temp, 'override.json');
  await fs.writeFile(config, JSON.stringify({ source_dir: source, public_dir: publicDir }));
  const hexo = new Hexo(base, { config: [path.join(base, '_config.yml'), config].join(','), output: temp, silent: true });
  try { await hexo.init(); await hexo.call('generate', {}); } finally { await hexo.exit(); }
  const server = createServer(async (req, res) => {
    try {
      let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); if (name.endsWith('/')) name += 'index.html';
      const file = path.resolve(publicDir, '.' + name); assert.ok(file.startsWith(publicDir + path.sep));
      res.setHeader('Content-Type', ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream');
      res.end(await fs.readFile(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, browser = await chromium.launch({ headless: true });
  const routes = ['/', '/about/', '/archives/', ...cases.map(c => `/story/${c.id}/`)];
  try {
    for (const viewport of [{ width: 1280, height: 900 }, { width: 1024, height: 600 }]) for (const route of routes) {
      const row = { route, viewport, failures: [] };
      const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
      page.on('pageerror', error => row.failures.push(error.message));
      try {
        assert.equal((await page.goto(origin + route)).status(), 200); await page.evaluate(() => document.fonts.ready);
        row.cover = await geometry(page);
        verify(row, !row.cover.overflow, 'Cover has horizontal overflow');
        verify(row, row.cover.footer.top >= viewport.height - 2, 'Footer enters cover');
        verify(row, row.cover.title.top >= row.cover.header - 2 && row.cover.title.bottom <= viewport.height + 2, 'Cover title is clipped');
        const textLayers = await page.evaluate(() => [...document.querySelectorAll('.home-epigraph,.reading-mast__cluster,.archive-head__mast,.site-header__inner')].map(el => ({ transform: getComputedStyle(el).transform, filter: getComputedStyle(el).filter })));
        verify(row, textLayers.every(layer => layer.transform === 'none' && layer.filter === 'none'), 'Cover/header text is rasterized through a transformed layer');
        await page.screenshot({ path: path.join(output, `${viewport.width}-${viewport.height}-${route.replace(/\W+/g, '_')}-cover.png`) });
        await page.mouse.move(10, viewport.height / 2); await page.mouse.wheel(0, 120); await page.waitForTimeout(1250);
        row.entry = await geometry(page);
        verify(row, Math.abs(row.entry.y - row.entry.dock) <= 2, 'Entry does not reach shared anchor');
        if (route === '/' || route === '/archives/') {
          verify(row, Math.abs(parseFloat(row.entry.titleSize) - 28) < 1, 'Dock title does not reach its compact scale');
        } else {
          verify(row, row.entry.titleSize === row.cover.titleSize && row.entry.titleTracking === row.cover.titleTracking, 'Cover title changes size or tracking while scrolling');
        }
        verify(row, row.entry.title.top >= row.entry.header - 2 && row.entry.title.bottom <= row.entry.content.top + 2, 'Title is partly covered or overlaps content');
        verify(row, row.entry.footer.top >= viewport.height - 2, 'Footer enters reading entry');
        if (route === '/archives/') verify(row, row.entry.content.top >= row.entry.toolbar.bottom - 2 && (row.entry.content.bottom <= viewport.height + 2 || viewport.height < 700 && row.entry.content.height === 600), 'Archive toolbar/timeline overlaps instead of flowing in a short viewport');
        await page.screenshot({ path: path.join(output, `${viewport.width}-${viewport.height}-${route.replace(/\W+/g, '_')}-entry.png`) });
        if (await page.locator('html.ci-columns-locked').count()) {
          for (let i = 0; i < 18 && await page.locator('html.ci-columns-locked').count(); i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(180); }
          verify(row, !await page.locator('html.ci-columns-locked').count(), 'Poetry never releases root scroll');
        }
        if (!route.includes('short') && !route.includes('long-ci')) {
          await page.evaluate(y => scrollTo({ top: y + 60, behavior: 'instant' }), row.entry.y);
          await page.waitForTimeout(150);
          const together = await geometry(page);
          verify(row, Math.abs((together.title.top - row.entry.title.top) - (together.content.top - row.entry.content.top)) <= 2, 'Title and body separate after leaving cover');
        }
        if (route === '/story/essay/') {
          const g = await geometry(page); await page.evaluate(y => scrollTo({ top: (y.dock + y.ending) / 2, behavior: 'instant' }), g); await page.waitForTimeout(300);
          row.middle = await geometry(page); verify(row, row.middle.footer.top >= viewport.height - 2, 'Footer enters article middle');
          verify(row, row.middle.title.bottom <= row.middle.header + 2, 'Title does not leave naturally with content');
        }
        await page.evaluate(() => { const f = document.querySelector('.site-footer'); scrollTo({ top: f.getBoundingClientRect().top + scrollY - innerHeight, behavior: 'instant' }); });
        await page.waitForTimeout(350); row.ending = await geometry(page);
        verify(row, row.ending.footer.top >= viewport.height - 2, 'Footer enters ending reading state');
        await page.keyboard.press('PageDown'); await page.waitForTimeout(1250); row.footer = await geometry(page);
        verify(row, Math.abs(row.footer.y - row.footer.footerY) <= 2, 'Footer does not reach its anchor');
        verify(row, row.footer.footer.height < viewport.height / 2, 'Footer expands into a full-screen scene');
        verify(row, Math.abs(row.footer.footer.bottom - viewport.height) <= 2, 'Footer is not at the page bottom');
        await page.waitForTimeout(500);
        verify(row, Math.abs((await geometry(page)).y - row.footer.y) <= 2, 'Footer pulls scroll position after settling');
        await page.keyboard.press('PageUp'); await page.waitForTimeout(1250); row.reverse = await geometry(page);
        verify(row, row.reverse.y < row.footer.y - 2, 'Native PageUp cannot leave page bottom');
      } catch (error) { row.failures.push(error.message); }
      finally { await page.close(); }
      results.push(row); console.log(`${row.failures.length ? 'FAIL' : 'PASS'} ${viewport.width}x${viewport.height} ${route}: ${row.failures.join('; ') || 'cover/entry/ending/footer/reverse'}`);
    }
    {
      const row = { route: '/story/short/', input: 'keyboard/inertia/resize/hash', failures: [] };
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      page.on('pageerror', error => row.failures.push(error.message));
      try {
        await page.goto(origin + row.route); await page.evaluate(() => document.fonts.ready);
        await page.keyboard.press('PageDown'); await page.waitForTimeout(1250);
        verify(row, await page.locator('html.ci-columns-locked').count() === 1, 'Keyboard entry never starts column reading');
        await page.keyboard.press('ArrowDown'); await page.waitForTimeout(350);
        verify(row, await page.locator('.post-ci__verses > p.is-revealed').count() === 1, 'Keyboard cannot advance a column');
        await page.keyboard.press('End'); await page.waitForTimeout(700);
        verify(row, !await page.locator('html.ci-columns-locked').count(), 'End traps reader in column lock');
        const last = await geometry(page);
        verify(row, Math.abs(last.y - last.footerY) <= 2, 'End cannot reach footer');
        await page.setViewportSize({ width: 1180, height: 740 }); await page.waitForTimeout(700);
        const resized = await geometry(page);
        await page.keyboard.press('End'); await page.waitForTimeout(300);
        verify(row, Math.abs((await geometry(page)).y - resized.footerY) <= 2, 'Footer cannot be reached after resize');
        await page.keyboard.press('Home'); await page.waitForTimeout(700);
        await page.mouse.move(10, 300);
        for (let i = 0; i < 9; i++) { await page.mouse.wheel(0, 120); await page.waitForTimeout(70); }
        await page.waitForTimeout(500);
        const landing = await geometry(page);
        verify(row, Math.abs(landing.y - landing.dock) <= 2, 'Same wheel gesture overshoots reading entry');
        await page.goto(origin + '/story/essay/#section-20'); await page.waitForTimeout(800);
        verify(row, await page.locator('#section-20').evaluate(el => el.getBoundingClientRect().top >= 0 && el.getBoundingClientRect().top < innerHeight), 'Hash target is pulled into another scene');
      } catch (error) { row.failures.push(error.message); }
      finally { await page.close(); }
      results.push(row); console.log(`${row.failures.length ? 'FAIL' : 'PASS'} keyboard/inertia/resize/hash: ${row.failures.join('; ') || 'input ownership and navigation'}`);
    }
    {
      const row = { route: '/story/oversize/', input: 'oversize-title/low-viewport', failures: [] };
      for (const viewport of [{ width: 1280, height: 900 }, { width: 1024, height: 430 }]) {
        const page = await browser.newPage({ viewport });
        try {
          await page.goto(origin + row.route); await page.evaluate(() => document.fonts.ready);
          verify(row, await page.locator('html.story-flow').count() === 1, 'Oversize title does not fall back to document flow');
          verify(row, await page.locator('.post-title').evaluate(el => {
            const r = el.getBoundingClientRect(), m = el.closest('.reading-mast').getBoundingClientRect();
            return r.left >= 0 && r.right <= innerWidth && r.top >= m.top && r.bottom <= m.bottom;
          }), 'Oversize title clipped by mast');
          await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(300);
          verify(row, await page.locator('.site-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 2), 'Oversize title prevents footer access');
        } catch (error) { row.failures.push(error.message); } finally { await page.close(); }
      }
      results.push(row); console.log(`${row.failures.length ? 'FAIL' : 'PASS'} oversize title fallback: ${row.failures.join('; ') || 'complete flowing title and reachable footer'}`);
    }
    for (const options of [{ viewport: { width: 390, height: 844 }, reducedMotion: 'no-preference' }, { viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }, { viewport: { width: 1280, height: 900 }, javaScriptEnabled: false }, { viewport: { width: 1024, height: 768 }, hasTouch: true, isMobile: true }]) {
      const context = await browser.newContext(options);
      for (const route of ['/story/short/', '/story/long-title/', '/archives/']) {
        const row = { route, fallback: options, failures: [] }, page = await context.newPage();
        try {
          await page.goto(origin + route); await page.evaluate(() => document.fonts.ready);
          verify(row, !await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), 'Fallback horizontal overflow');
          if (route === '/story/short/' && (options.javaScriptEnabled === false || options.hasTouch || options.reducedMotion === 'reduce')) {
            verify(row, await page.locator('.post-ci__verses > p').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === '1')), 'Fallback leaves poetry hidden');
            verify(row, !await page.locator('html.ci-columns-locked').count(), 'Fallback poetry traps scrolling');
          }
          await page.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' })); await page.waitForTimeout(250);
          verify(row, await page.locator('.site-footer__copy').isVisible(), 'Fallback footer unavailable');
          verify(row, await page.locator('.site-footer').evaluate(el => el.getBoundingClientRect().bottom <= innerHeight + 2), 'Fallback footer cannot be reached');
        } catch (error) { row.failures.push(error.message); } finally { await page.close(); }
        results.push(row); console.log(`${row.failures.length ? 'FAIL' : 'PASS'} fallback ${route}: ${row.failures.join('; ') || 'native content/footer reachable'}`);
      }
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const failed = results.filter(row => row.failures.length);
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ total: results.length, failed: failed.length, results }, null, 2));
  console.log(`RESULT: ${results.length - failed.length}/${results.length} passed; evidence ${output}`);
  if (failed.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
