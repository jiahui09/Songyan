/* PLAYWRIGHT_PACKAGE=/path/to/playwright/package.json node tests/migration.test.cjs */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || __filename)('playwright');
const root = path.resolve(process.env.SONGYAN_PUBLIC_DIR || path.join(__dirname, '../dev-site/public'));
const prefix = (process.env.SONGYAN_ROOT || '/').replace(/\/$/, '');
const output = process.env.SONGYAN_QA_DIR || '/tmp/opencode/songyan-migration';
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
const pages = [
  ['index', '/'], ['archive', '/archives/'], ['about', '/about/'], ['404', '/404.html'],
  ['post-ci', '/2026/10/12/qiushi-huaiyuan/'], ['post-essay', '/2026/10/11/qiantang-guanchao/'],
  ['markdown', '/2026/10/10/test/'], ['category', '/categories/技术/'], ['tag', '/tags/秋思/']
];
(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      let pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (prefix) {
        if (!pathname.startsWith(prefix + '/')) throw new Error('outside deployment root');
        pathname = pathname.slice(prefix.length);
      }
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(root, '.' + pathname);
      assert.ok(file.startsWith(root + path.sep));
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(await fs.readFile(file));
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  let checks = 0;
  try {
    for (const width of [360, 390, 768, 1280]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const [name, route] of pages) {
        const response = await page.goto(origin + prefix + route);
        assert.equal(response.status(), 200);
        await page.evaluate(() => document.fonts.ready);
        assert.equal(await page.locator('main').count(), 1, `${name}: one main`);
        assert.equal(await page.locator('[class*="placeholder"]').count(), 0, `${name}: no placeholders`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}@${width}: page overflow`);
        assert.equal(await page.locator('.rhyme-dot').count(), 0);
        const uniqueIds = await page.locator('[id]').evaluateAll(nodes => nodes.length === new Set(nodes.map(node => node.id)).size);
        assert.ok(uniqueIds, `${name}: unique SVG and content IDs`);
        if (['post-ci', 'post-essay', 'markdown', 'about'].includes(name)) {
          assert.ok(await page.locator('body.reading-page').count(), `${name}: reading stylesheet scope`);
          assert.equal(await page.locator('.post-signature').count(), 1);
          assert.equal(await page.locator('.post-signature').evaluate(el => getComputedStyle(el).flexDirection), 'row');
        }
        if (['archive', 'category', 'tag'].includes(name)) assert.ok(await page.locator('.chrono__entry').count() > 0);
        if (name === 'index' && width < 900) {
          assert.equal(await page.locator('.home-cover').evaluate(el => getComputedStyle(el).position), 'static', 'narrow screens drop the pin');
          assert.ok(await page.locator('.home-cover').evaluate(el => el.getBoundingClientRect().height < innerHeight * 0.75), 'short cover leaves room for reading');
        }
        const urls = await page.locator('a[href], link[rel="stylesheet"], script[src], img[src]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href') || node.getAttribute('src')).filter(value => value && !/^(https?:|data:|mailto:|#)/.test(value)));
        for (const url of urls) assert.equal((await page.request.get(new URL(url, page.url()).href)).status(), 200, `${name}: broken local URL ${url}`);
        if (width === 390 || width === 1280) {
          await page.evaluate(async () => {
            document.querySelectorAll('img').forEach(img => { img.loading = 'eager'; });
            await Promise.all(Array.from(document.images).map(img => img.decode().catch(() => {})));
          });
          await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
        }
        console.log(`PASS ${name}@${width}: generated content, links/assets, layout and signature`); checks++;
      }
      assert.deepEqual(errors, [], 'browser JS exceptions');
      await context.close();
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    await page.goto(origin + prefix + '/2026/10/10/test/');
    assert.equal(await page.locator('.reading-code').count(), 2);
    assert.equal(await page.locator('.reading-table table').count(), 1);
    assert.ok(await page.locator('.reading-line-number').count() > 14);
    await page.locator('[data-reading-toggle]:not([hidden])').click();
    assert.equal(await page.locator('[data-reading-toggle]:not([hidden])').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-reading-copy]').last().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copied.startsWith('// 阅读样张') && !copied.startsWith('1'));
    for (const img of await page.locator('main img').all()) {
      await img.scrollIntoViewIfNeeded(); await img.evaluate(el => el.decode());
      assert.ok(await img.evaluate(el => el.clientWidth <= el.naturalWidth + 1 && el.clientWidth <= el.parentElement.clientWidth + 1));
    }
    console.log('PASS actual Markdown: highlight conversion, line numbers, copy, expansion, table and images'); checks++;
    await page.goto(origin + prefix + '/2026/10/12/qiushi-huaiyuan/');
    assert.equal(await page.locator('.post-ci__body-horizontal p[data-stanza-start]').count(), 1);
    await page.locator('[data-poem-slip-open]').click();
    await page.locator('.poem-slip__cipai').waitFor({ state: 'visible' });
    const exportProbe = await page.evaluate(async () => {
      try { const data = collectPoemSlipData(); const canvas = await drawPoemSlip(data); return { width: canvas.width, data }; }
      catch (error) { return { error: error.message, data: collectPoemSlipData() }; }
    });
    assert.ok(!exportProbe.error, JSON.stringify(exportProbe));
    const downloadPromise = page.waitForEvent('download').catch(async error => { console.error('POEM STATUS:', await page.locator('[data-poem-slip-status]').textContent()); throw error; });
    await page.locator('[data-poem-slip-save]').click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'poem.png'));
    const png = await fs.readFile(path.join(output, 'poem.png'));
    assert.equal(png.readUInt32BE(16), 720); assert.equal(png.readUInt32BE(20), 1296);
    await page.keyboard.press('Escape');
    assert.ok(await page.locator('[data-poem-slip-open]').evaluate(el => el === document.activeElement));
    console.log('PASS real poetry content: explicit stanza break, generated author seal, preview and PNG export'); checks++;
    await page.goto(origin + prefix + '/archives/');
    assert.equal(await page.locator('.chrono__item').count(), 4);
    for (const time of await page.locator('.chrono__date').all()) {
      const iso = await time.getAttribute('datetime');
      assert.equal(await time.locator('.chrono__mo').textContent(), iso.slice(5, 7));
      assert.equal(await time.locator('.chrono__slash').textContent(), '/');
      assert.equal(await time.locator('.chrono__day').textContent(), iso.slice(8, 10));
      assert.equal(await time.evaluate(el => getComputedStyle(el).flexDirection), 'column');
      assert.ok(await time.evaluate(el => Math.abs(new DOMMatrix(getComputedStyle(el).transform).b + 0.5) < 0.001));
    }
    await page.locator('[data-cat-filter="ci"]').click();
    assert.equal(await page.locator('.chrono__item:not([hidden])').count(), 1);
    assert.equal(await page.locator('[data-archive-count]').textContent(), '1');
    await page.locator('[data-cat-filter="ci"]').click();
    assert.equal(await page.locator('.chrono__item:not([hidden])').count(), 4);
    await page.locator('[data-cat-filter="project"]').click();
    assert.equal(await page.locator('[data-archive-count]').textContent(), '0');
    assert.ok(await page.locator('[data-archive-empty]').isVisible());
    assert.ok(await page.locator('.chrono').isHidden());
    await page.locator('[data-cat-filter="project"]').click();
    assert.equal(await page.locator('[data-archive-count]').textContent(), '4');
    assert.ok(await page.locator('.chrono').isVisible());
    assert.ok(await page.locator('[data-archive-empty]').isHidden());
    console.log('PASS archive data binding and category filtering'); checks++;
    const wheelProbe = await page.locator('[data-chrono-rail]').evaluate(rail => {
      rail.scrollLeft = 0;
      rail.dispatchEvent(new Event('scroll'));
      const atEdge = rail.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
      const towardContent = rail.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, cancelable: true }));
      return { atEdge, towardContent, hasOverflow: rail.scrollWidth > rail.clientWidth };
    });
    assert.deepEqual(wheelProbe, { atEdge: true, towardContent: false, hasOverflow: true });
    console.log('PASS archive wheel boundary releases page scrolling and consumes interior scrolling'); checks++;
    await context.close();
    const desktopContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const desktopPage = await desktopContext.newPage();
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const titleHandle = await desktopPage.locator('.home-epigraph__text').elementHandle();
    const coverProbe = await desktopPage.evaluate(() => {
      const cover = document.querySelector('.home-cover');
      const sheet = document.querySelector('.home-sheet');
      const skip = document.querySelector('.skip-link');
      const title = document.querySelector('.home-epigraph__text');
      const rect = title.getBoundingClientRect();
      return {
        coverPosition: getComputedStyle(cover).position,
        coverHeight: cover.getBoundingClientRect().height + document.querySelector('.home-cover-space').getBoundingClientRect().height,
        sheetZ: Number(getComputedStyle(sheet).zIndex),
        coverZ: Number(getComputedStyle(cover).zIndex),
        titleOpacity: getComputedStyle(title).opacity,
        titleCenter: (rect.top + rect.bottom) / 2,
        skipHref: skip && skip.getAttribute('href'),
        enterHref: document.querySelector('.home-cover__enter').getAttribute('href'),
        targetExists: Boolean(document.querySelector('#' + sheet.id)),
        scrollSnap: getComputedStyle(document.documentElement).scrollSnapType,
        sameTexture: getComputedStyle(cover).backgroundImage === getComputedStyle(sheet).backgroundImage
      };
    });
    assert.equal(coverProbe.coverPosition, 'sticky');
    assert.ok(coverProbe.coverHeight >= 880, `cover fills the viewport: ${coverProbe.coverHeight}`);
    assert.ok(coverProbe.sheetZ < coverProbe.coverZ, 'the title remains above the content, never covered by it');
    assert.equal(coverProbe.titleOpacity, '1');
    assert.ok(coverProbe.titleCenter > 270 && coverProbe.titleCenter < 630, 'initial title sits near the viewport center');
    assert.equal(coverProbe.skipHref, '#home-stream');
    assert.equal(coverProbe.enterHref, '#home-stream');
    assert.ok(coverProbe.targetExists);
    assert.equal(coverProbe.scrollSnap, 'none');
    assert.ok(coverProbe.sameTexture, 'the two paper layers use the same texture');
    await desktopPage.evaluate(async () => {
      const sheet = document.querySelector('.home-sheet');
      const dock = document.querySelector('.home-cover');
      scrollTo({ top: sheet.getBoundingClientRect().top + scrollY - dock.getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const docked = await desktopPage.evaluate(() => {
      const title = document.querySelector('.home-epigraph__text');
      const rect = title.getBoundingClientRect();
      const dockHeight = document.querySelector('.home-cover').getBoundingClientRect().height;
      const titleHit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      return {
        top: rect.top, bottom: rect.bottom, dockHeight,
        titleVisible: Boolean(titleHit && title.contains(titleHit)),
        contentBelow: document.querySelector('.home-sheet').getBoundingClientRect().top >= dockHeight - 1
      };
    });
    assert.ok(docked.top >= 0 && docked.bottom <= docked.dockHeight, JSON.stringify(docked));
    assert.ok(docked.titleVisible && docked.contentBelow, 'title docks above the naturally flowing content');
    assert.ok(await titleHandle.evaluate(el => el === document.querySelector('.home-epigraph__text')), 'the title is the same DOM element, not a copy');
    assert.equal(await desktopPage.locator('.home-cover h1').count(), 1);
    console.log('PASS home title: same element docks above content; initial full cover and narrow short-cover fallback'); checks++;
    await desktopPage.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));

    await desktopPage.emulateMedia({ reducedMotion: 'no-preference' });
    const coverMotion = await desktopPage.evaluate(async () => {
      const title = document.querySelector('.home-epigraph__text');
      const sheet = document.querySelector('.home-sheet');
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sample = () => {
        const anim = document.getAnimations().find(a => a.animationName === 'title-dock');
        const transform = new DOMMatrix(getComputedStyle(title).transform);
        return {
          timeline: anim && anim.timeline.constructor.name,
          progress: anim && anim.effect.getComputedTiming().progress,
          opacity: Number(getComputedStyle(title).opacity),
          scale: transform.a, translateY: transform.f
        };
      };
      const start = sample();
      scrollTo({ top: document.querySelector('.home-cover-space').getBoundingClientRect().height / 2, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const middle = sample();
      scrollTo({ top: sheet.getBoundingClientRect().top + scrollY, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const end = sample();
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return { start, middle, end, restored: sample() };
    });
    assert.equal(coverMotion.start.timeline, 'ScrollTimeline');
    assert.ok(coverMotion.start.progress < 0.02, JSON.stringify(coverMotion));
    assert.ok(Math.abs(coverMotion.start.scale - 1) < 0.001, 'cover starts at its natural size');
    assert.ok(coverMotion.end.progress > 0.95, 'title reaches its final size before the content reaches the dock');
    assert.equal(coverMotion.start.opacity, 1);
    assert.equal(coverMotion.middle.opacity, 1, 'title stays visible during the transition, not just at its endpoints');
    assert.equal(coverMotion.end.opacity, 1, 'title never fades or retires');
    assert.ok(coverMotion.start.scale > coverMotion.middle.scale && coverMotion.middle.scale > coverMotion.end.scale, 'title continuously shrinks instead of switching states');
    assert.ok(coverMotion.start.translateY > coverMotion.end.translateY, 'title moves upward');
    assert.ok(Math.abs(coverMotion.end.scale - 0.5) < 0.001, 'title becomes a half-sized masthead');
    assert.ok(Math.abs(coverMotion.restored.scale - 1) < 0.001, 'scrolling back restores the same title');
    assert.equal(await desktopPage.locator('.home-stream .enter').count(), 0, 'post items and titles do not animate separately');
    const shortPageDock = await desktopPage.evaluate(async () => {
      document.querySelectorAll('.post-item').forEach((item, i) => { if (i) item.remove(); });
      const dock = document.querySelector('.home-cover');
      const sheet = document.querySelector('.home-sheet');
      scrollTo({ top: sheet.getBoundingClientRect().top + scrollY - dock.getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const rect = document.querySelector('.home-epigraph__text').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= dock.getBoundingClientRect().height;
    });
    assert.ok(shortPageDock, 'a single short post still provides sufficient title-docking travel');
    await desktopPage.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await desktopPage.locator('.home-epigraph__text').evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced motion keeps the title static');
    assert.equal(await desktopPage.locator('.home-cover').evaluate(el => getComputedStyle(el).position), 'static');
    console.log('PASS home title motion: native scroll timeline, scale/translation without fade, reduced-motion fallback'); checks++;

    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.keyboard.press('Tab');
    assert.ok(await desktopPage.locator('.skip-link').evaluate(el => el === document.activeElement));
    await desktopPage.keyboard.press('Enter');
    await desktopPage.waitForFunction(() => document.activeElement?.id === 'home-stream');
    assert.equal(await desktopPage.locator('#home-stream').count(), 1);
    assert.ok(await desktopPage.locator('#home-stream').evaluate(el => Math.abs(el.getBoundingClientRect().top) <= 2));
    await desktopPage.emulateMedia({ media: 'print' });
    assert.equal(await desktopPage.locator('.home-cover').evaluate(el => getComputedStyle(el).position), 'static');
    assert.equal(await desktopPage.locator('.home-cover').evaluate(el => getComputedStyle(el).minHeight), '0px');
    await desktopPage.emulateMedia({ media: 'screen' });
    console.log('PASS home cover keyboard skip link transfers focus; printing removes the full-screen cover height'); checks++;

    await desktopPage.goto(origin + prefix + '/2026/10/12/qiushi-huaiyuan/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const poemOverflow = await desktopPage.locator('.post-ci__body-horizontal').evaluate(body => {
      for (let i = 0; i < 20; i++) body.appendChild(body.querySelector('p').cloneNode(true));
      const stage = body.closest('.post-ci__stage');
      return { contained: stage.scrollWidth > stage.clientWidth, pageFits: document.documentElement.scrollWidth <= innerWidth + 1 };
    });
    assert.deepEqual(poemOverflow, { contained: true, pageFits: true });
    await desktopPage.goto(origin + prefix + '/archives/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const archiveCenterOffset = await desktopPage.locator('.chrono__year').evaluate(year => {
      const group = year.getBoundingClientRect();
      const rail = year.closest('.chrono__rail').getBoundingClientRect();
      return Math.abs((group.left + group.right - rail.left - rail.right) / 2);
    });
    assert.ok(archiveCenterOffset < 2, 'a short archive is centered in its rail');
    assert.equal(await desktopPage.locator('.chrono__entry').first().evaluate(el => getComputedStyle(el).textOrientation), 'mixed');
    assert.equal(await desktopPage.locator('.chrono__item').first().evaluate(el => getComputedStyle(el).animationName.includes('chrono-curve')), false);
    console.log('PASS long poem stays in its scroll region and archive titles avoid 3D distortion'); checks++;
    await desktopContext.close();
    const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 900 }, reducedMotion: 'reduce' });
    const staticPage = await staticContext.newPage();
    for (const [name, route] of pages) {
      await staticPage.goto(origin + prefix + route);
      assert.ok(await staticPage.locator('main').isVisible());
      assert.ok(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no-JS layout`);
      if (name === 'index') {
        assert.equal(await staticPage.locator('.post-item').count(), 4, 'all content is in the initial HTML');
        assert.equal(await staticPage.locator('.home-stream').evaluate(el => getComputedStyle(el).opacity), '1');
        await staticPage.locator('.home-cover__enter').click();
        assert.ok(await staticPage.locator('#home-stream').evaluate(el => Math.abs(el.getBoundingClientRect().top) <= 2), 'no-JS entry anchor reaches the content');
      }
    }
    await staticPage.setViewportSize({ width: 1280, height: 900 });
    await staticPage.emulateMedia({ reducedMotion: 'no-preference' });
    await staticPage.goto(origin + prefix + '/');
    await staticPage.evaluate(() => document.fonts.ready);
    const staticTitle = await staticPage.locator('.home-epigraph__text').elementHandle();
    await staticPage.locator('.home-cover__enter').click();
    // 禁用页面 JS 时不能等待页面内的 rAF 回调；截图请求由浏览器完成渲染同步。
    await staticPage.screenshot({ path: path.join(output, 'nojs-title-dock.png') });
    const noJsDock = await staticPage.locator('.home-epigraph__text').evaluate(title => {
      const rect = title.getBoundingClientRect();
      const dock = document.querySelector('.home-cover').getBoundingClientRect();
      return rect.top >= 0 && rect.bottom <= dock.height && document.querySelector('#home-stream').getBoundingClientRect().top >= dock.height - 1;
    });
    assert.ok(noJsDock, 'native anchor scrolling docks the title without any JavaScript');
    assert.ok(await staticTitle.evaluate(el => el === document.querySelector('.home-epigraph__text')));
    await staticContext.close();
    console.log('PASS no-JavaScript fallback on all generated page types'); checks++;
    console.log(`RESULT: ${checks} migration check groups passed. Evidence: ${output}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
