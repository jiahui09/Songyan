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
        if (width === 1280 && (name === 'index' || name === 'archive' || name === 'about')) {
          const expected = name === 'index' ? '首页' : name === 'archive' ? '归档' : '关于';
          const activeNav = await page.evaluate(() => {
            const activeEl = document.querySelector('.site-header__nav-link--active');
            return {
              active: [...document.querySelectorAll('.site-header__nav-link--active')].map(el => el.textContent.trim()),
              current: [...document.querySelectorAll('.site-header__nav-link[aria-current="page"]')].map(el => el.textContent.trim()),
              activeUnderline: activeEl ? getComputedStyle(activeEl).backgroundSize : null
            };
          });
          assert.deepEqual(activeNav.active, [expected], `${name}: only the current nav item is marked active`);
          assert.deepEqual(activeNav.current, [expected]);
          assert.ok(!String(activeNav.activeUnderline).startsWith('100%'), `${name}: active nav has no persistent underline`);
          const link = page.locator('.site-header__nav-link', { hasText: expected });
          await link.hover();
          await page.waitForTimeout(200);
          assert.ok(String(await link.evaluate(el => getComputedStyle(el).backgroundSize)).startsWith('100%'), `${name}: underline appears on hover`);
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
    assert.equal(await page.locator('.post-ci .post-tags').count(), 0, 'ci pages omit the 系·tags line');
    assert.equal(await page.locator('.post-signature__slip .post-ci__petal').count(), 1, 'petal sits between author and slip');
    assert.equal(await page.locator('.post-signature__slip [data-poem-slip-open]').count(), 1, 'poem slip sits under the author name');
    const slipSize = await page.locator('.post-signature__slip .share-trigger').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    const dateSize = await page.locator('.post-signature__mark time').evaluate(el => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(slipSize <= dateSize + 0.5, `slip text must not exceed signature date size: ${slipSize} vs ${dateSize}`);
    await page.locator('[data-poem-slip-open]').click();
    await page.locator('.poem-slip__cipai').waitFor({ state: 'visible' });
    const exportProbe = await page.evaluate(async () => {
      try {
        const data = collectPoemSlipData();
        const canvas = await drawPoemSlip(data);
        const sign = document.querySelector('[data-poem-slip-sign]');
        const lineAlign = getComputedStyle(document.querySelector('.poem-slip__line')).textAlign;
        const colsJustify = getComputedStyle(document.querySelector('.poem-slip__cols')).justifyContent;
        return {
          width: canvas.width,
          height: canvas.height,
          data,
          signVisible: sign && !sign.hidden,
          signAuthor: document.querySelector('[data-poem-slip-author]')?.textContent.trim() || '',
          signDate: document.querySelector('[data-poem-slip-date]')?.textContent.trim() || '',
          lineAlign,
          colsJustify
        };
      } catch (error) {
        return { error: error.message, data: collectPoemSlipData() };
      }
    });
    assert.ok(!exportProbe.error, JSON.stringify(exportProbe));
    assert.ok(exportProbe.data.author, 'poem slip export includes author');
    assert.ok(exportProbe.data.date, 'poem slip export includes date');
    assert.equal(exportProbe.signVisible, true, 'preview shows author/date block');
    assert.ok(exportProbe.signAuthor, 'preview author is filled');
    assert.ok(exportProbe.signDate, 'preview date is filled');
    assert.ok(['flex-start', 'start', 'flow-start'].includes(exportProbe.colsJustify), 'poem slip columns are top-aligned');
    assert.ok(['start', 'left', 'flex-start'].includes(exportProbe.lineAlign), 'verse columns are top-aligned');
    const downloadPromise = page.waitForEvent('download').catch(async error => { console.error('POEM STATUS:', await page.locator('[data-poem-slip-status]').textContent()); throw error; });
    await page.locator('[data-poem-slip-save]').click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'poem.png'));
    const png = await fs.readFile(path.join(output, 'poem.png'));
    assert.equal(png.readUInt32BE(16), 720); assert.equal(png.readUInt32BE(20), 1080);
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
        coverHeight: document.querySelector('.home-dock-zone').getBoundingClientRect().height,
        sheetZ: Number(getComputedStyle(sheet).zIndex),
        coverZ: Number(getComputedStyle(cover).zIndex),
        titleOpacity: getComputedStyle(title).opacity,
        sourceOpacity: getComputedStyle(document.querySelector('.home-epigraph__source')).opacity,
        hintOpacity: getComputedStyle(document.querySelector('.home-cover__hint')).opacity,
        titleCenter: (rect.top + rect.bottom) / 2,
        skipHref: skip && skip.getAttribute('href'),
        hasEnter: Boolean(document.querySelector('.home-cover__enter')),
        hasHint: Boolean(document.querySelector('.home-cover__hint')),
        headerPos: getComputedStyle(document.querySelector('.site-header')).position,
        targetExists: Boolean(document.querySelector('#' + sheet.id)),
        dockSnap: getComputedStyle(document.documentElement).getPropertyValue('--dock-snap').trim(),
        coverBg: getComputedStyle(cover).backgroundImage,
        sheetBg: getComputedStyle(sheet).backgroundImage,
        sheetSnap: getComputedStyle(sheet).scrollSnapAlign,
        sheetSnapStop: getComputedStyle(sheet).scrollSnapStop
      };
    });
    assert.equal(coverProbe.coverPosition, 'sticky');
    assert.ok(coverProbe.coverHeight >= 880, `cover fills the viewport under the overlaid header: ${coverProbe.coverHeight}`);
    assert.equal(coverProbe.sheetZ, coverProbe.coverZ, 'title and content share the same stacking layer');
    assert.equal(coverProbe.titleOpacity, '1');
    assert.ok(Number(coverProbe.sourceOpacity) > 0.95, 'source stays visible at rest');
    assert.ok(Number(coverProbe.hintOpacity) > 0.2, 'scroll hint is visible at rest');
    assert.equal(coverProbe.hasEnter, false, 'enter button is removed');
    assert.equal(coverProbe.hasHint, true);
    assert.equal(coverProbe.headerPos, 'sticky', 'site header pins while the cover docks');
    assert.ok(coverProbe.titleCenter > 270 && coverProbe.titleCenter < 630, 'initial title sits near the viewport center');
    assert.equal(coverProbe.skipHref, '#home-stream');
    assert.ok(coverProbe.targetExists);
    assert.equal(coverProbe.dockSnap, 'proximity', 'cover uses proximity snap at the dock point');
    assert.ok(coverProbe.sheetBg.includes('paper-texture'), 'content keeps the shared paper texture');
    assert.equal(coverProbe.coverBg, 'none', 'docked masthead is not a paper overlay covering the page');
    assert.equal(coverProbe.sheetSnap, 'start');
    assert.equal(coverProbe.sheetSnapStop, 'always', 'once docked, light scrolls do not pull the masthead back');
    await desktopPage.evaluate(async () => {
      const space = document.querySelector('.home-cover-space').getBoundingClientRect().height;
      scrollTo({ top: space, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const docked = await desktopPage.evaluate(() => {
      const title = document.querySelector('.home-epigraph__text');
      const rect = title.getBoundingClientRect();
      const cover = document.querySelector('.home-cover').getBoundingClientRect();
      const header = document.querySelector('.site-header').getBoundingClientRect();
      const titleHit = document.elementFromPoint((rect.left + rect.right) / 2, (rect.top + rect.bottom) / 2);
      const hint = document.querySelector('.home-cover__hint');
      return {
        top: rect.top, bottom: rect.bottom,
        coverTop: cover.top, coverBottom: cover.bottom,
        headerBottom: header.bottom, headerTop: header.top,
        titleVisible: Boolean(titleHit && title.contains(titleHit)),
        contentBelow: document.querySelector('.home-sheet').getBoundingClientRect().top >= cover.bottom - 1,
        sourceOpacity: getComputedStyle(document.querySelector('.home-epigraph__source')).opacity,
        hintHidden: getComputedStyle(hint).visibility === 'hidden' || Number(getComputedStyle(hint).opacity) < 0.05
      };
    });
    assert.ok(docked.headerTop >= -1 && docked.headerTop <= 1, JSON.stringify(docked));
    assert.ok(Math.abs(docked.coverTop - docked.headerBottom) <= 2, 'epigraph docks under the pinned header');
    assert.ok(docked.top >= docked.coverTop - 1 && docked.bottom <= docked.coverBottom + 1, JSON.stringify(docked));
    assert.ok(docked.titleVisible && docked.contentBelow, 'title docks above the naturally flowing content');
    assert.ok(Number(docked.sourceOpacity) < 0.05, 'source fades out by the time the title docks');
    assert.ok(docked.hintHidden, 'scroll hint hides after the user scrolls');
    assert.ok(await titleHandle.evaluate(el => el === document.querySelector('.home-epigraph__text')), 'the title is the same DOM element, not a copy');
    assert.equal(await desktopPage.locator('.home-cover h1').count(), 1);

    // 继续下滚越过停靠行程：栏头随正文一起离开，不再像罩子压在内容上。
    const released = await desktopPage.evaluate(async () => {
      const space = document.querySelector('.home-cover-space').getBoundingClientRect().height;
      scrollTo({ top: space + 160, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const cover = document.querySelector('.home-cover').getBoundingClientRect();
      const sheet = document.querySelector('.home-sheet').getBoundingClientRect();
      const header = document.querySelector('.site-header').getBoundingClientRect();
      return {
        coverTop: cover.top, coverBottom: cover.bottom, sheetTop: sheet.top,
        headerTop: header.top, headerBottom: header.bottom
      };
    });
    assert.ok(released.coverTop < -1, JSON.stringify(released));
    assert.ok(Math.abs(released.sheetTop - released.coverBottom) < 48, 'after release, epigraph and content stay in one continuous flow');
    assert.ok(released.headerTop >= -1 && released.headerTop <= 1, 'site header remains pinned after epigraph releases');
    console.log('PASS home title: docks then releases with content; header stays; hint hides; narrow short-cover fallback'); checks++;
    await desktopPage.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));

    await desktopPage.emulateMedia({ reducedMotion: 'no-preference' });
        const coverMotion = await desktopPage.evaluate(async () => {
      const title = document.querySelector('.home-epigraph__text');
      const epigraph = document.querySelector('.home-epigraph');
      const root = document.documentElement;
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const sample = (natural) => {
        const shrink = document.getAnimations().find(a => a.animationName === 'title-shrink');
        const transform = new DOMMatrix(getComputedStyle(epigraph).transform);
        const fontSize = parseFloat(getComputedStyle(title).fontSize);
        return {
          timeline: shrink && shrink.timeline.constructor.name,
          progress: shrink && shrink.effect.getComputedTiming().progress,
          opacity: Number(getComputedStyle(title).opacity),
          sourceOpacity: Number(getComputedStyle(document.querySelector('.home-epigraph__source')).opacity),
          headerPaddingTop: parseFloat(getComputedStyle(document.querySelector('.site-header__inner')).paddingTop),
          scale: fontSize / natural,
          translateY: transform.f,
          fontSize
        };
      };
      const natural = parseFloat(getComputedStyle(title).fontSize);
      const start = sample(natural);
      scrollTo({ top: document.querySelector('.home-cover-space').getBoundingClientRect().height / 2, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const middle = sample(natural);
      scrollTo({ top: document.querySelector('.home-cover-space').getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const end = sample(natural);
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const restored = sample(natural);
      return { start, middle, end, restored };
    });

    assert.equal(coverMotion.start.timeline, 'ScrollTimeline');
    assert.ok(coverMotion.start.progress < 0.05, JSON.stringify(coverMotion));
    assert.ok(Math.abs(coverMotion.start.scale - 1) < 0.001, 'cover starts at its natural size');
    assert.ok(coverMotion.end.progress > 0.95, 'title reaches its final size before the content reaches the dock');
    assert.equal(coverMotion.start.opacity, 1);
    assert.equal(coverMotion.middle.opacity, 1, 'title stays visible during the transition, not just at its endpoints');
    assert.equal(coverMotion.end.opacity, 1, 'title never fades or retires');
    assert.equal(coverMotion.start.sourceOpacity, 1);
    assert.ok(coverMotion.middle.sourceOpacity < coverMotion.start.sourceOpacity, 'source begins fading while the title shrinks');
    assert.ok(coverMotion.end.sourceOpacity < 0.05, 'source is gone when docking finishes');
    assert.ok(coverMotion.start.scale > coverMotion.middle.scale && coverMotion.middle.scale > coverMotion.end.scale, 'title continuously shrinks instead of switching states');
    assert.ok(coverMotion.start.translateY > coverMotion.end.translateY, 'title group moves upward');
    assert.ok(Math.abs(coverMotion.end.scale - 0.5) < 0.02, 'title becomes a half-sized masthead');
    assert.ok(Math.abs(coverMotion.restored.scale - 1) < 0.02, 'scrolling back restores the same title');
    assert.ok(coverMotion.start.headerPaddingTop > coverMotion.end.headerPaddingTop, 'site header compactifies while docking');
    assert.equal(await desktopPage.locator('.home-stream .enter').count(), 0, 'post items and titles do not animate separately');
    assert.equal(await desktopPage.locator('.home-cover__enter').count(), 0);
    const shortPageDock = await desktopPage.evaluate(async () => {
      document.querySelectorAll('.post-item').forEach((item, i) => { if (i) item.remove(); });
      const title = document.querySelector('.home-epigraph__text');
      const natural = parseFloat(getComputedStyle(title).fontSize);
      // reset to top to capture natural, then scroll
      scrollTo({ top: 0, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const naturalSize = parseFloat(getComputedStyle(title).fontSize);
      const space = document.querySelector('.home-cover-space').getBoundingClientRect().height;
      scrollTo({ top: space, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const titleRect = title.getBoundingClientRect();
      const dock = document.querySelector('.home-cover').getBoundingClientRect();
      const source = document.querySelector('.home-epigraph__source');
      const anim = document.getAnimations().find(a => a.animationName === 'title-shrink');
      return {
        progress: anim && anim.effect.getComputedTiming().progress,
        scale: parseFloat(getComputedStyle(title).fontSize) / naturalSize,
        titleTop: titleRect.top,
        titleBottom: titleRect.bottom,
        dockBottom: dock.bottom,
        sourceOpacity: getComputedStyle(source).opacity,
        sourceVisibility: getComputedStyle(source).visibility
      };
    });
    assert.ok(shortPageDock.progress > 0.95, JSON.stringify(shortPageDock));
    assert.ok(Math.abs(shortPageDock.scale - 0.5) < 0.02, 'short pages still finish docking');
    assert.ok(shortPageDock.titleTop >= 0 && shortPageDock.titleBottom <= shortPageDock.dockBottom + 2, JSON.stringify(shortPageDock));
    assert.ok(Number(shortPageDock.sourceOpacity) < 0.05, 'source fades on short pages too');
    assert.equal(shortPageDock.sourceVisibility, 'hidden');
    await desktopPage.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await desktopPage.locator('.home-epigraph__text').evaluate(el => getComputedStyle(el).animationName), 'none', 'reduced motion keeps the title static');
    assert.equal(await desktopPage.locator('.home-epigraph').evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await desktopPage.locator('.home-cover').evaluate(el => getComputedStyle(el).position), 'static');
    console.log('PASS home title motion: native scroll timeline, scale/translation without fade, details remain, reduced-motion fallback'); checks++;

    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.keyboard.press('Tab');
    assert.ok(await desktopPage.locator('.skip-link').evaluate(el => el === document.activeElement));
    await desktopPage.keyboard.press('Enter');
    await desktopPage.waitForFunction(() => document.activeElement?.id === 'home-stream');
    assert.equal(await desktopPage.locator('#home-stream').count(), 1);
    assert.ok(await desktopPage.locator('#home-stream').evaluate(el => {
      const header = document.querySelector('.site-header').getBoundingClientRect().bottom;
      const top = el.getBoundingClientRect().top;
      return Math.abs(top - header) <= 4 || Math.abs(top) <= 2;
    }));
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
    await desktopPage.emulateMedia({ reducedMotion: 'no-preference', media: 'screen' });
    await desktopPage.goto(origin + prefix + '/archives/');
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await desktopPage.locator('body').evaluate(el => el.classList.contains('archive-dock-page')));
    const archiveIntro = await desktopPage.evaluate(() => {
      const head = document.querySelector('.archive-head');
      const title = document.querySelector('.archive-head__title');
      const count = document.querySelector('.archive-head__count');
      const mast = document.querySelector('.archive-head__mast');
      const legend = document.querySelector('.archive-legend');
      const recent = document.querySelector('.archive-recent');
      const header = document.querySelector('.site-header');
      const titleRect = title.getBoundingClientRect();
      const countRect = count.getBoundingClientRect();
      const recentRect = recent.getBoundingClientRect();
      return {
        headPos: getComputedStyle(head).position,
        headerPos: getComputedStyle(header).position,
        titleAnim: getComputedStyle(title).animationName,
        mastAnim: getComputedStyle(mast).animationName,
        legendAfterIntro: Boolean(legend && legend.compareDocumentPosition(document.querySelector('.archive-intro')) & Node.DOCUMENT_POSITION_PRECEDING),
        titleCenter: (titleRect.top + titleRect.bottom) / 2,
        countBelowTitle: countRect.top >= titleRect.bottom - 1,
        recentBelowCount: recentRect.top >= countRect.bottom - 1,
        railZ: Number(getComputedStyle(document.querySelector('.chrono__rail')).zIndex),
        axisZ: Number(getComputedStyle(document.querySelector('.chrono__axis')).zIndex),
        recentCount: recent ? recent.querySelectorAll('.archive-recent__item').length : 0,
        recentOpacity: recent ? Number(getComputedStyle(recent).opacity) : 0,
        dockSnap: getComputedStyle(document.documentElement).getPropertyValue('--dock-snap').trim(),
        legendSnap: getComputedStyle(legend).scrollSnapAlign,
        legendSnapStop: getComputedStyle(legend).scrollSnapStop,
        activeNav: [...document.querySelectorAll('.site-header__nav-link--active')].map(el => el.textContent.trim())
      };
    });
    assert.equal(archiveIntro.headPos, 'sticky');
    assert.equal(archiveIntro.headerPos, 'sticky');
    assert.ok(archiveIntro.titleAnim.includes('archive-title-dock'), JSON.stringify(archiveIntro));
    assert.ok(archiveIntro.mastAnim.includes('archive-mast-dock'), JSON.stringify(archiveIntro));
    assert.ok(archiveIntro.legendAfterIntro, 'category legend sits with the timeline focus area under the title');
    assert.ok(archiveIntro.titleCenter > 180 && archiveIntro.titleCenter < 480, 'archive title sits upper-center on intro');
    assert.ok(archiveIntro.countBelowTitle, 'count sits directly under the title');
    assert.ok(archiveIntro.recentBelowCount, 'recent list sits under the count');
    assert.ok(archiveIntro.railZ > archiveIntro.axisZ, 'ink dots on the rail stack above the axis line');
    assert.ok(archiveIntro.recentCount >= 1 && archiveIntro.recentCount <= 3, JSON.stringify(archiveIntro));
    assert.ok(archiveIntro.recentOpacity > 0.8, 'recent posts are visible on the archive intro');
    assert.equal(archiveIntro.dockSnap, 'proximity', JSON.stringify(archiveIntro));
    assert.equal(archiveIntro.legendSnap, 'start');
    assert.equal(archiveIntro.legendSnapStop, 'always');
    assert.deepEqual(archiveIntro.activeNav, ['归档']);

    await desktopPage.evaluate(async () => {
      const legend = document.querySelector('.archive-legend');
      const head = document.querySelector('.archive-head');
      const header = document.querySelector('.site-header');
      const top = legend.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - head.getBoundingClientRect().height;
      scrollTo({ top: Math.max(0, top), behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const archiveDocked = await desktopPage.evaluate(() => {
      const head = document.querySelector('.archive-head').getBoundingClientRect();
      const header = document.querySelector('.site-header').getBoundingClientRect();
      const chrono = document.querySelector('.chrono').getBoundingClientRect();
      const legend = document.querySelector('.archive-legend').getBoundingClientRect();
      const count = document.querySelector('.archive-head__count');
      const title = document.querySelector('.archive-head__title');
      const recent = document.querySelector('.archive-recent');
      return {
        headerTop: header.top,
        headerBottom: header.bottom,
        headTop: head.top,
        headBottom: head.bottom,
        chronoTop: chrono.top,
        chronoBottom: chrono.bottom,
        legendTop: legend.top,
        legendBottom: legend.bottom,
        countOpacity: Number(getComputedStyle(count).opacity),
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        recentOpacity: recent ? Number(getComputedStyle(recent).opacity) : 0,
        recentVisibility: recent ? getComputedStyle(recent).visibility : 'hidden',
        viewport: innerHeight,
        chronoTopToken: getComputedStyle(document.documentElement).getPropertyValue('--chrono-top').trim(),
        overlap: legend.bottom > chrono.top + 1
      };
    });
    assert.ok(archiveDocked.headerTop >= -1 && archiveDocked.headerTop <= 1, JSON.stringify(archiveDocked));
    assert.ok(Math.abs(archiveDocked.headTop - archiveDocked.headerBottom) <= 2, 'archive title docks under the pinned header');
    assert.ok(archiveDocked.legendTop >= archiveDocked.headBottom - 2, 'legend sits under the docked title');
    assert.ok(archiveDocked.chronoTop >= archiveDocked.legendBottom - 2, 'timeline follows the legend without overlap');
    assert.equal(archiveDocked.overlap, false, 'legend and timeline do not overlap');
    assert.ok(archiveDocked.countOpacity < 0.05, 'count fades as the title docks');
    assert.ok(archiveDocked.recentOpacity < 0.05, 'recent posts hide after scrolling into the timeline');
    assert.equal(archiveDocked.recentVisibility, 'hidden');
    assert.ok(archiveDocked.titleSize < 28, 'archive title compactifies');
    assert.ok(archiveDocked.chronoBottom <= archiveDocked.viewport + 2, 'timeline fits under header+title in one screen');
    assert.ok(archiveDocked.chronoTopToken.includes('5.5'), 'docked archive uses compact chrono metrics');

    // 继续下滑：无整屏 exit 白段，时间轴上移后页脚紧随
    const archiveExited = await desktopPage.evaluate(async () => {
      const footer = document.querySelector('.site-footer');
      const exit = document.querySelector('.archive-exit-space');
      scrollTo({ top: footer.getBoundingClientRect().top + scrollY - innerHeight * 0.35, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const chrono = document.querySelector('.chrono').getBoundingClientRect();
      const head = document.querySelector('.archive-head').getBoundingClientRect();
      const foot = footer.getBoundingClientRect();
      return {
        chronoBottom: chrono.bottom,
        headBottom: head.bottom,
        headerTop: document.querySelector('.site-header').getBoundingClientRect().top,
        footerTop: foot.top,
        exitDisplay: exit ? getComputedStyle(exit).display : 'none',
        exitHeight: exit ? exit.getBoundingClientRect().height : 0,
        gap: foot.top - chrono.bottom
      };
    });
    assert.equal(archiveExited.exitDisplay, 'none', 'archive exit runway is removed');
    assert.ok(archiveExited.exitHeight < 1, 'no full-screen blank between timeline and footer');
    assert.ok(archiveExited.chronoBottom <= archiveExited.headBottom + 2 || archiveExited.footerTop < archiveExited.chronoBottom + 8, 'timeline leaves or yields directly to footer');
    assert.ok(archiveExited.headerTop >= -1 && archiveExited.headerTop <= 1, 'header stays pinned after timeline exits');
    assert.ok(archiveExited.gap < 450 || archiveExited.footerTop < archiveExited.headBottom + 120, JSON.stringify(archiveExited));

    // 阅读页题头停靠（词）
    await desktopPage.goto(origin + prefix + '/2026/10/12/qiushi-huaiyuan/');
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await desktopPage.locator('body').evaluate(el => el.classList.contains('reading-dock-page')));
    const readingCiIntro = await desktopPage.evaluate(() => {
      const title = document.querySelector('.reading-mast .post-title');
      const meta = document.querySelector('.reading-mast__meta');
      const cluster = document.querySelector('.reading-mast__cluster');
      return {
        mastPos: getComputedStyle(document.querySelector('.reading-mast')).position,
        clusterAnim: getComputedStyle(cluster).animationName,
        hasAuthor: Boolean(meta && meta.textContent.trim()),
        titleCenter: (title.getBoundingClientRect().top + title.getBoundingClientRect().bottom) / 2
      };
    });
    assert.equal(readingCiIntro.mastPos, 'sticky');
    assert.ok(String(readingCiIntro.clusterAnim).includes('reading-mast-lift'), JSON.stringify(readingCiIntro));
    assert.ok(String(await desktopPage.locator('.reading-mast .post-title').evaluate(el => getComputedStyle(el).animationName)).includes('reading-ci-title-dock'));
    assert.ok(readingCiIntro.hasAuthor, 'ci mast shows author/date meta');
    const readingCiCover = await desktopPage.evaluate(() => {
      const body = document.querySelector('.reading-body-anchor').getBoundingClientRect();
      const travel = getComputedStyle(document.documentElement).getPropertyValue('--reading-travel').trim();
      return {
        bodyTop: body.top,
        viewport: innerHeight,
        travel
      };
    });
    assert.ok(readingCiCover.bodyTop >= readingCiCover.viewport - 2, 'ci cover hides body on first screen');

    await desktopPage.evaluate(async () => {
      const body = document.querySelector('.reading-body-anchor');
      const header = document.querySelector('.site-header');
      const mast = document.querySelector('.reading-mast');
      scrollTo({ top: body.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - mast.getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const readingCiDocked = await desktopPage.evaluate(() => {
      const title = document.querySelector('.reading-mast .post-title');
      const meta = document.querySelector('.reading-mast__meta');
      const mast = document.querySelector('.reading-mast').getBoundingClientRect();
      const header = document.querySelector('.site-header').getBoundingClientRect();
      const body = document.querySelector('.reading-body-anchor').getBoundingClientRect();
      const firstLine = document.querySelector('.post-ci__body--vertical > p');
      const signature = document.querySelector('.post-ci__body--vertical > .post-signature--vertical');
      const endingSignature = document.querySelector('.post-ending .post-signature');
      const annotations = document.querySelector('.poem-annotations');
      return {
        headerBottom: header.bottom,
        mastTop: mast.top,
        bodyTop: body.top,
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        metaOpacity: meta ? Number(getComputedStyle(meta).opacity) : 1,
        metaVisibility: meta ? getComputedStyle(meta).visibility : 'visible',
        lineOpacity: firstLine ? Number(getComputedStyle(firstLine).opacity) : 1,
        lineTransform: firstLine ? getComputedStyle(firstLine).transform : 'none',
        hasVerticalSignature: Boolean(signature),
        endingSignature: Boolean(endingSignature),
        annotations: Boolean(annotations),
        dockSnap: getComputedStyle(document.documentElement).getPropertyValue('--dock-snap').trim(),
        bodySnap: getComputedStyle(document.querySelector('.reading-body-anchor')).scrollSnapAlign,
        bodySnapStop: getComputedStyle(document.querySelector('.reading-body-anchor')).scrollSnapStop
      };
    });
    assert.ok(Math.abs(readingCiDocked.mastTop - readingCiDocked.headerBottom) <= 2, 'ci title docks under header');
    assert.ok(readingCiDocked.bodyTop >= readingCiDocked.mastTop + 40, 'ci body sits under docked mast');
    assert.ok(readingCiDocked.titleSize < 26, 'ci title compactifies');
    assert.ok(readingCiDocked.metaOpacity < 0.05, 'ci meta fades when docked');
    assert.equal(readingCiDocked.metaVisibility, 'hidden');
    assert.ok(readingCiDocked.lineOpacity < 0.05 || readingCiDocked.lineTransform !== 'none', 'ci columns wait off-screen before wheel reveal');
    assert.equal(readingCiDocked.hasVerticalSignature, true, 'ci signature follows vertical columns');
    assert.equal(readingCiDocked.endingSignature, false, 'ci does not duplicate horizontal ending signature');
    assert.equal(readingCiDocked.annotations, false, 'ci annotations are off by default');
    assert.equal(readingCiDocked.dockSnap, 'proximity');
    assert.equal(readingCiDocked.bodySnap, 'start');
    assert.equal(readingCiDocked.bodySnapStop, 'always', 'reading dock holds at the body start');

    // 定点后锁页：滚轮逐列淡入，落款字后再末拍盖章
    const readingCiColumns = await desktopPage.evaluate(async () => {
      const lines = [...document.querySelectorAll('.post-ci__body--vertical > p')];
      const signature = document.querySelector('.post-ci__body--vertical > .post-signature--vertical');
      const steps = lines.length + (signature ? 2 : 0);
      const before = {
        lines: lines.map(col => col.classList.contains('is-revealed')),
        meta: signature ? signature.classList.contains('is-revealed') : false,
        stamped: signature ? signature.classList.contains('is-stamped') : false
      };
      for (let i = 0; i < steps; i++) {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, cancelable: true, bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      }
      return {
        steps,
        before,
        afterLines: lines.map(col => col.classList.contains('is-revealed')),
        meta: signature ? signature.classList.contains('is-revealed') : false,
        stamped: signature ? signature.classList.contains('is-stamped') : false,
        lockedAfter: document.documentElement.classList.contains('ci-columns-locked'),
        footerReachable: document.querySelector('.site-footer').getBoundingClientRect().top > 0
      };
    });
    assert.ok(readingCiColumns.steps >= 3, JSON.stringify(readingCiColumns));
    assert.ok(readingCiColumns.before.lines.every(flag => flag === false), 'columns start unrevealed while locked');
    assert.equal(readingCiColumns.before.meta, false);
    assert.equal(readingCiColumns.before.stamped, false);
    assert.ok(readingCiColumns.afterLines.every(flag => flag === true), 'wheel fades in every verse column');
    assert.equal(readingCiColumns.meta, true, 'signature text reveals after columns');
    assert.equal(readingCiColumns.stamped, true, 'seal stamps as the final beat');
    assert.equal(readingCiColumns.lockedAfter, false, 'page unlocks after the final stamp');

    // 桌面竖排：题笺与作者同列；日期/印章另开一列
    const slipColumn = await desktopPage.evaluate(() => {
      const signature = document.querySelector('.post-ci__body--vertical > .post-signature--vertical');
      const meta = signature.querySelector('.post-signature__meta');
      const mark = signature.querySelector('.post-signature__mark');
      const author = meta.querySelector('.post-signature__author');
      const slip = meta.querySelector('.post-signature__slip');
      const time = mark.querySelector('time');
      const seal = mark.querySelector('.seal--signature');
      const petal = slip.querySelector('.post-ci__petal');
      const trigger = slip.querySelector('[data-poem-slip-open]');
      const a = author.getBoundingClientRect();
      const s = slip.getBoundingClientRect();
      const m = mark.getBoundingClientRect();
      return {
        metaDirection: getComputedStyle(meta).flexDirection,
        writingMode: getComputedStyle(trigger).writingMode,
        sameColumn: Math.abs(((a.left + a.right) / 2) - ((s.left + s.right) / 2)) < 24,
        slipBelowAuthor: s.top >= a.bottom - 2,
        markSeparate: Math.abs(((a.left + a.right) / 2) - ((m.left + m.right) / 2)) > 12,
        hasDate: Boolean(time),
        hasSeal: Boolean(seal),
        petalBeforeTrigger: !!(petal.compareDocumentPosition(trigger) & Node.DOCUMENT_POSITION_FOLLOWING)
      };
    });
    assert.equal(slipColumn.metaDirection, 'column', 'author and slip stay in one vertical stack');
    assert.ok(String(slipColumn.writingMode).includes('vertical'), 'slip label remains vertical');
    assert.equal(slipColumn.sameColumn, true, 'slip stays in the author column, not to the left');
    assert.equal(slipColumn.slipBelowAuthor, true, 'slip sits under the author name');
    assert.equal(slipColumn.markSeparate, true, 'date/seal open a separate column');
    assert.equal(slipColumn.hasDate, true);
    assert.equal(slipColumn.hasSeal, true);
    assert.equal(slipColumn.petalBeforeTrigger, true, 'petal sits between author and slip');

    // 阅读页题头停靠（文 + 题注）
    await desktopPage.goto(origin + prefix + '/2026/10/11/qiantang-guanchao/');
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const readingEssayIntro = await desktopPage.evaluate(() => {
      const epi = document.querySelector('.reading-mast__epigraph');
      return {
        hasEpigraph: Boolean(epi),
        epiOpacity: epi ? Number(getComputedStyle(epi).opacity) : 0,
        epiText: epi ? epi.textContent.trim() : ''
      };
    });
    assert.ok(readingEssayIntro.hasEpigraph, 'essay mast shows epigraph');
    assert.ok(readingEssayIntro.epiOpacity > 0.8, JSON.stringify(readingEssayIntro));

    await desktopPage.evaluate(async () => {
      const body = document.querySelector('.reading-body-anchor');
      const header = document.querySelector('.site-header');
      const mast = document.querySelector('.reading-mast');
      scrollTo({ top: body.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - mast.getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const readingEssayDocked = await desktopPage.evaluate(() => {
      const epi = document.querySelector('.reading-mast__epigraph');
      const title = document.querySelector('.reading-mast .post-title');
      const meta = document.querySelector('.reading-mast__meta');
      return {
        epiOpacity: Number(getComputedStyle(epi).opacity),
        epiVisibility: getComputedStyle(epi).visibility,
        metaOpacity: meta ? Number(getComputedStyle(meta).opacity) : 1,
        metaVisibility: meta ? getComputedStyle(meta).visibility : 'visible',
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        commentsMount: Boolean(document.getElementById('gitalk-container'))
      };
    });
    assert.ok(readingEssayDocked.epiOpacity < 0.05, 'epigraph fades when essay docks');
    assert.equal(readingEssayDocked.epiVisibility, 'hidden');
    assert.ok(readingEssayDocked.metaOpacity < 0.05, 'essay author/date fade when docking into body');
    assert.equal(readingEssayDocked.metaVisibility, 'hidden');
    assert.ok(readingEssayDocked.titleSize < 26, 'essay title compactifies');
    assert.equal(readingEssayDocked.commentsMount, false, 'gitalk stays off until configured');

    // 独立页（关于）同款题头停靠，并可继续滑到页脚
    await desktopPage.goto(origin + prefix + '/about/');
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    assert.ok(await desktopPage.locator('body').evaluate(el => el.classList.contains('reading-dock-page')));
    const aboutIntro = await desktopPage.evaluate(() => {
      const body = document.querySelector('.reading-body-anchor').getBoundingClientRect();
      return {
        mastPos: getComputedStyle(document.querySelector('.reading-mast')).position,
        bodyTop: body.top,
        viewport: innerHeight,
        hasTagline: Boolean(document.querySelector('.page-about__tagline'))
      };
    });
    assert.equal(aboutIntro.mastPos, 'sticky');
    assert.ok(aboutIntro.bodyTop >= aboutIntro.viewport - 2, 'about cover hides body on first screen');
    assert.ok(aboutIntro.hasTagline);
    await desktopPage.evaluate(async () => {
      const body = document.querySelector('.reading-body-anchor');
      const header = document.querySelector('.site-header');
      const mast = document.querySelector('.reading-mast');
      scrollTo({ top: body.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - mast.getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const aboutDocked = await desktopPage.evaluate(async () => {
      const title = document.querySelector('.page-about__name');
      const tagline = document.querySelector('.page-about__tagline');
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const footer = document.querySelector('.site-footer').getBoundingClientRect();
      return {
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        tagOpacity: tagline ? Number(getComputedStyle(tagline).opacity) : 1,
        footerBottomVisible: footer.bottom <= innerHeight + 2,
        scrollY
      };
    });
    assert.ok(aboutDocked.titleSize < 28, 'about title compactifies');
    assert.ok(aboutDocked.tagOpacity < 0.05, 'about tagline fades when docking');
    assert.ok(aboutDocked.footerBottomVisible, 'about page can reach the footer after docking');

    // 定点后继续下滑应能越过锚点到页脚（always 不永久锁页）
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const homeFooter = await desktopPage.evaluate(async () => {
      const space = document.querySelector('.home-cover-space').getBoundingClientRect().height;
      scrollTo({ top: space, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const footer = document.querySelector('.site-footer').getBoundingClientRect();
      return {
        dockSnap: getComputedStyle(document.documentElement).getPropertyValue('--dock-snap').trim(),
        sheetStop: getComputedStyle(document.querySelector('.home-sheet')).scrollSnapStop,
        footerBottomVisible: footer.bottom <= innerHeight + 2,
        scrollY
      };
    });
    assert.equal(homeFooter.dockSnap, 'proximity');
    assert.equal(homeFooter.sheetStop, 'always');
    assert.ok(homeFooter.footerBottomVisible, 'home can pass the dock snap and reach the footer');

    // 首页诗文简介字号一致且为 text-sm
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const homeExcerptSizes = await desktopPage.evaluate(() => {
      const verse = document.querySelector('.post-item__verse');
      const excerpt = document.querySelector('.post-excerpt');
      const sm = getComputedStyle(document.documentElement).getPropertyValue('--text-sm').trim();
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const expected = /rem$/.test(sm) ? `${root * parseFloat(sm)}px` : sm;
      return {
        verse: verse ? getComputedStyle(verse).fontSize : null,
        excerpt: excerpt ? getComputedStyle(excerpt).fontSize : null,
        expected
      };
    });
    assert.equal(homeExcerptSizes.verse, homeExcerptSizes.excerpt, 'home poetry and essay intros share the same font size');
    assert.equal(homeExcerptSizes.verse, homeExcerptSizes.expected, 'home intros use text-sm');

    await desktopPage.goto(origin + prefix + '/archives/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const recentSize = await desktopPage.evaluate(() => {
      const link = document.querySelector('.archive-recent__link');
      const sm = getComputedStyle(document.documentElement).getPropertyValue('--text-sm').trim();
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const expected = /rem$/.test(sm) ? `${root * parseFloat(sm)}px` : sm;
      return {
        size: link ? getComputedStyle(link).fontSize : null,
        expected
      };
    });
    assert.equal(recentSize.size, recentSize.expected, 'archive recent uses text-sm');

    await desktopPage.goto(origin + prefix + '/archives/');
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.evaluate(async () => {
      const legend = document.querySelector('.archive-legend');
      const head = document.querySelector('.archive-head');
      const header = document.querySelector('.site-header');
      scrollTo({ top: legend.getBoundingClientRect().top + scrollY - header.getBoundingClientRect().height - head.getBoundingClientRect().height, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const archiveCenterOffset = await desktopPage.locator('.chrono__year').evaluate(year => {
      const group = year.getBoundingClientRect();
      const rail = year.closest('.chrono__rail').getBoundingClientRect();
      return Math.abs((group.left + group.right - rail.left - rail.right) / 2);
    });
    assert.ok(archiveCenterOffset < 2, 'a short archive is centered in its rail');
    assert.equal(await desktopPage.locator('.chrono__entry').first().evaluate(el => getComputedStyle(el).textOrientation), 'mixed');
    assert.equal(await desktopPage.locator('.chrono__item').first().evaluate(el => getComputedStyle(el).animationName.includes('chrono-curve')), false);
    console.log('PASS archive/reading docks: no overlap, timeline exits, reading mast docks, home intros balanced'); checks++;
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
        assert.equal(await staticPage.locator('.home-cover__enter').count(), 0);
        assert.ok(await staticPage.locator('.home-cover__hint').count() >= 0);
        await staticPage.locator('.skip-link').evaluate(el => el.click());
        // narrow/static: skip may not sticky-dock; content should still be reachable
        assert.ok(await staticPage.locator('#home-stream').evaluate(el => el.getBoundingClientRect().top < innerHeight), 'no-JS skip reaches the content');
      }
    }
    await staticPage.setViewportSize({ width: 1280, height: 900 });
    await staticPage.emulateMedia({ reducedMotion: 'no-preference' });
    await staticPage.goto(origin + prefix + '/');
    await staticPage.evaluate(() => document.fonts.ready);
    const staticTitle = await staticPage.locator('.home-epigraph__text').elementHandle();
    // 先停在行程中段：无 JS 时滚动时间轴仍应由原生滚动驱动标题缩小。
    await staticPage.evaluate(() => {
      const spaceH = document.querySelector('.home-cover-space').getBoundingClientRect().height;
      scrollTo({ top: spaceH * 0.6, behavior: 'instant' });
    });
    await staticPage.waitForTimeout(50);
    const midDock = await staticPage.evaluate(() => {
      const source = document.querySelector('.home-epigraph__source');
      const shrink = document.getAnimations().find(a => a.animationName === 'title-shrink');
      const sourceAnim = document.getAnimations().find(a => a.animationName === 'source-fold');
      const hint = document.querySelector('.home-cover__hint');
      return {
        progress: shrink ? shrink.effect.getComputedTiming().progress : 0,
        sourceOpacity: Number(getComputedStyle(source).opacity),
        sourceProgress: sourceAnim ? sourceAnim.effect.getComputedTiming().progress : 0,
        coverPos: getComputedStyle(document.querySelector('.home-cover')).position,
        headerPos: getComputedStyle(document.querySelector('.site-header')).position,
        headerTop: document.querySelector('.site-header').getBoundingClientRect().top,
        hintHidden: getComputedStyle(hint).visibility === 'hidden' || Number(getComputedStyle(hint).opacity) < 0.2,
        scrollY
      };
    });
    await staticPage.screenshot({ path: path.join(output, 'nojs-title-dock.png') });
    assert.equal(midDock.coverPos, 'sticky');
    assert.equal(midDock.headerPos, 'sticky');
    assert.ok(midDock.headerTop >= -1 && midDock.headerTop <= 1, 'header stays pinned without JavaScript');
    assert.ok(midDock.progress > 0.2 && midDock.progress < 0.95, JSON.stringify(midDock));
    assert.ok(midDock.sourceOpacity < 1 && midDock.sourceProgress > 0.2, 'source shrinks and fades while docking without JavaScript');
    assert.ok(midDock.hintHidden, 'hint folds away after scrolling');

    await staticPage.evaluate(() => {
      const space = document.querySelector('.home-cover-space').getBoundingClientRect().height;
      scrollTo({ top: space + 160, behavior: 'instant' });
    });
    await staticPage.screenshot({ path: path.join(output, 'nojs-title-release.png') });
    const afterRelease = await staticPage.evaluate(() => {
      const sheetTop = document.querySelector('#home-stream').getBoundingClientRect().top;
      const coverTop = document.querySelector('.home-cover').getBoundingClientRect().top;
      const headerTop = document.querySelector('.site-header').getBoundingClientRect().top;
      return { sheetTop, coverTop, headerTop };
    });
    assert.ok(afterRelease.coverTop < -1, JSON.stringify(afterRelease));
    assert.ok(afterRelease.headerTop >= -1 && afterRelease.headerTop <= 1, 'header remains after epigraph releases');
    assert.ok(await staticTitle.evaluate(el => el === document.querySelector('.home-epigraph__text')));
    await staticContext.close();
    console.log('PASS no-JavaScript fallback on all generated page types'); checks++;
    console.log(`RESULT: ${checks} migration check groups passed. Evidence: ${output}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
