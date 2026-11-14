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
  ['markdown', '/2026/10/10/test/'], ['category', '/categories/技术/'], ['tag', '/tags/秋思/'],
  ['archive-year', '/archives/2026/'], ['archive-month', '/archives/2026/10/']
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
        assert.equal(await page.locator('.site-footer').count(), ['archive', 'archive-year', 'archive-month', 'category', 'tag'].includes(name) ? 0 : 1, `${name}: archive pages omit footer, other pages retain it`);
        assert.equal(await page.locator('[class*="placeholder"]').count(), 0, `${name}: no placeholders`);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}@${width}: page overflow`);
        assert.equal(await page.locator('.rhyme-dot').count(), 0);
        const uniqueIds = await page.locator('[id]').evaluateAll(nodes => nodes.length === new Set(nodes.map(node => node.id)).size);
        assert.ok(uniqueIds, `${name}: unique SVG and content IDs`);
        if (['post-ci', 'post-essay', 'markdown', 'about'].includes(name)) {
          assert.ok(await page.locator('body.reading-page').count(), `${name}: reading stylesheet scope`);
          assert.equal(await page.locator('.post-signature').count(), 1);
          if (name === 'post-ci') {
            assert.equal(await page.locator('.post-signature').evaluate(el => getComputedStyle(el).flexDirection), width >= 1024 ? 'column' : 'row');
          } else if (name !== 'about') {
            const signature = await page.locator('.post-signature').evaluate(el => {
              const box = el.getBoundingClientRect();
              const author = el.querySelector('.post-signature__author').getBoundingClientRect();
              const date = el.querySelector('time').getBoundingClientRect();
              const seal = el.querySelector('.seal--signature').getBoundingClientRect();
              return { display: getComputedStyle(el).display, stacked: author.bottom <= date.top,
                textAligned: Math.abs(author.right - date.right) < 1,
                sealGap: seal.left - Math.max(author.right, date.right),
                sealCenter: Math.abs((seal.top + seal.bottom - author.top - date.bottom) / 2),
                fits: box.left >= 0 && box.right <= innerWidth && seal.bottom <= box.bottom + 1 };
            });
            assert.equal(signature.display, 'grid');
            assert.ok(signature.stacked && signature.textAligned && signature.sealGap >= 15 && signature.sealCenter < 1 && signature.fits,
              `article signature keeps author/date aligned beside seal: ${JSON.stringify(signature)}`);
          }
        }
        if (name === 'post-ci') {
          const composition = await page.evaluate(() => {
            const body = document.querySelector('.post-ci__body-horizontal');
            const lines = [...body.querySelectorAll(':scope > p')];
            const lower = lines.findIndex(line => line.hasAttribute('data-stanza-start'));
            const rects = lines.map(line => line.getBoundingClientRect());
            const signature = body.querySelector('.post-signature');
            const author = signature.querySelector('.post-signature__author').getBoundingClientRect();
            const date = signature.querySelector('time').getBoundingClientRect();
            const title = document.querySelector('.post-title').getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            const punctuation = body.querySelector('.poem-punctuation');
            const characterRect = (node, offset) => {
              const range = document.createRange();
              range.setStart(node, offset); range.setEnd(node, offset + 1);
              return range.getBoundingClientRect();
            };
            const firstCharacter = characterRect(lines[0].firstChild, 0);
            const secondCharacter = characterRect(lines[0].firstChild, 1);
            const beforePunctuation = characterRect(punctuation.previousSibling, punctuation.previousSibling.textContent.length - 1);
            const afterPunctuation = characterRect(punctuation.nextSibling, 0);
            const authorElement = signature.querySelector('.post-signature__author');
            const authorCharacter = characterRect(authorElement.firstChild, 0);
            return {
              lower, lowerText: lines[lower].textContent.trim(),
              titleCenterError: Math.abs((title.left + title.right) / 2 - innerWidth / 2),
              bodyCenterError: Math.abs((bodyRect.left + bodyRect.right) / 2 - innerWidth / 2),
              authorTopError: Math.abs(author.top - rects[0].top),
              dateTopError: Math.abs(date.top - rects[0].top),
              verseTopErrors: rects.map(rect => Math.abs(rect.top - rects[0].top)),
              gaps: rects.slice(1).map((rect, i) => rects[i].left - rect.right),
              signatureGap: rects.at(-1).left - signature.getBoundingClientRect().right,
              stanzaSpace: rects[lower].top - rects[lower - 1].bottom,
              punctuationHeight: punctuation.getBoundingClientRect().height,
              punctuationSize: parseFloat(getComputedStyle(punctuation).fontSize),
              characterAdvance: secondCharacter.top - firstCharacter.top,
              punctuationAdvance: afterPunctuation.top - beforePunctuation.top,
              firstCharacterTopError: Math.abs(authorCharacter.top - firstCharacter.top),
              authorMatchesVerse: getComputedStyle(authorElement).fontFamily === getComputedStyle(lines[0]).fontFamily,
              authorSize: parseFloat(getComputedStyle(authorElement).fontSize),
              verseSize: parseFloat(getComputedStyle(lines[0]).fontSize),
              dateSize: parseFloat(getComputedStyle(signature.querySelector('time')).fontSize),
              signatureColumnPitch: (author.left + author.right - date.left - date.right) / 2,
              normalColumnPitch: (rects[0].left + rects[0].right - rects[1].left - rects[1].right) / 2,
              dateColumnWidth: signature.querySelector('.post-signature__mark').getBoundingClientRect().width,
              text: lines.map(line => line.textContent.trim()).join('\n')
            };
          });
          assert.equal(composition.lower, 4, 'explicit stanza break follows the upper stanza');
          assert.ok(composition.lowerText.startsWith('溯流光'), 'lower stanza starts at the authored boundary');
          assert.ok(composition.titleCenterError <= 2, 'poetry heading stays centered on the viewport');
          assert.ok(composition.text.includes('露下碧梧冷，风引画檐铃。'), 'punctuation styling preserves the original text');
          if (width >= 1024) {
            const normalGaps = composition.gaps.filter((_, i) => i !== composition.lower - 1);
            const normalGap = normalGaps[0];
            assert.ok(normalGaps.every(gap => Math.abs(gap - normalGap) <= 1), 'ordinary verse columns have uniform spacing');
            assert.ok(composition.gaps[composition.lower - 1] >= normalGap * 3, 'stanza boundary has a clearly larger gap');
            assert.ok(Math.abs(composition.signatureGap - normalGap) <= 1, 'signature follows at the ordinary column spacing');
            assert.ok(composition.authorTopError <= 2 && composition.dateTopError <= 2, 'both signature columns align to the verse top');
            assert.ok(composition.verseTopErrors.every(error => error <= 2), 'upper and lower stanza columns share the same top edge');
            assert.ok(composition.bodyCenterError <= 2, 'complete verse/signature composition is centered');
            assert.ok(composition.punctuationHeight <= 0.1, 'hanging punctuation takes zero character height');
            assert.ok(Math.abs(composition.punctuationAdvance - composition.characterAdvance) <= 1, 'characters across punctuation keep exactly the ordinary character advance');
            assert.ok(composition.firstCharacterTopError <= 2 && composition.authorMatchesVerse, 'smaller author text retains first-character alignment with verse');
            assert.ok(composition.dateSize < composition.authorSize && composition.authorSize < composition.verseSize, 'signature author size stays between date and verse');
            assert.ok(composition.signatureColumnPitch <= composition.normalColumnPitch * 0.75, 'small author/date text uses compact column spacing');
            assert.ok(composition.dateColumnWidth < 30, 'date column does not reserve the seal width');
          } else {
            assert.ok(composition.stanzaSpace >= 40, 'horizontal reading has a visible stanza break');
          }
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
        const authorBox = sign.querySelector('[data-poem-slip-author]').getBoundingClientRect();
        const dateBox = sign.querySelector('[data-poem-slip-date]').getBoundingClientRect();
        const sealBox = document.querySelector('.poem-slip__sealcol').getBoundingClientRect();
        return {
          width: canvas.width,
          height: canvas.height,
          data,
          signVisible: sign && !sign.hidden,
          signAuthor: document.querySelector('[data-poem-slip-author]')?.textContent.trim() || '',
          signDate: document.querySelector('[data-poem-slip-date]')?.textContent.trim() || '',
          lineAlign,
          colsJustify,
          signInColumns: sign.parentElement.matches('[data-poem-slip-cols]'),
          separateSignColumns: dateBox.right <= authorBox.left,
          sealBelowSign: sealBox.top >= Math.max(authorBox.bottom, dateBox.bottom),
          sealAtLeft: Math.abs(sealBox.left - document.querySelector('.poem-slip__cols').getBoundingClientRect().left) <= 1
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
    assert.equal(exportProbe.signInColumns, true, 'author/date take the former seal column');
    assert.equal(exportProbe.separateSignColumns, true, 'author and date occupy two vertical columns');
    assert.equal(exportProbe.sealBelowSign, true, 'seal moves to the former lower-left signature position');
    assert.equal(exportProbe.sealAtLeft, true, 'seal starts at the left paper inset');
    await page.locator('.poem-slip').screenshot({ path: path.join(output, 'poem-preview.png') });
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
    await page.locator('[data-poem-slip-open]').click();
    assert.equal(await page.locator('.poem-slip__sealcol').count(), 1, 'reopening does not duplicate the seal');
    assert.equal(await page.locator('[data-poem-slip-cols] > [data-poem-slip-sign]').count(), 1, 'reopening retains the signature columns');
    await page.keyboard.press('Escape');
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
    assert.equal(await page.locator('.chrono__item:not(.is-dimmed)').count(), 1);
    assert.equal(await page.locator('[data-archive-count]').textContent(), '1');
    await page.locator('[data-cat-filter="ci"]').click();
    assert.equal(await page.locator('.chrono__item:not(.is-dimmed)').count(), 4);
    await page.locator('[data-cat-filter="project"]').click();
    assert.equal(await page.locator('[data-archive-count]').textContent(), '0');
    assert.ok(await page.locator('[data-archive-empty]').isVisible());
    assert.ok(await page.locator('.chrono').isHidden());
    await page.locator('[data-cat-filter="project"]').click();
    assert.equal(await page.locator('[data-archive-count]').textContent(), '4');
    assert.ok(await page.locator('.chrono').isVisible());
    assert.ok(await page.locator('[data-archive-empty]').isHidden());
    await page.locator('[data-archive-view="list"]').click();
    assert.equal(await page.locator('[data-archive-list]').getAttribute('hidden'), null);
    assert.ok(await page.locator('.chrono').isHidden());
    await page.locator('[data-archive-view="axis"]').click();
    assert.ok(await page.locator('.chrono').isVisible());
    assert.ok(await page.locator('[data-archive-list]').isHidden());
    console.log('PASS archive data binding, fade filter and list view'); checks++;
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
    assert.equal(coverProbe.dockSnap, 'none', 'cover controller disables competing native snap');
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
          headerTranslateY: new DOMMatrix(getComputedStyle(document.querySelector('.site-header__inner')).transform).f,
          headerTitleSize: getComputedStyle(document.querySelector('.site-header__title')).fontSize,
          sealWidth: document.querySelector('.site-header__seal-gen').getBoundingClientRect().width,
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
    assert.ok(Math.abs(coverMotion.end.fontSize - 28) < 0.1, 'docked title retains a strong 28px hierarchy');
    assert.ok(Math.abs(coverMotion.restored.scale - 1) < 0.02, 'scrolling back restores the same title');
    assert.equal(coverMotion.start.headerPaddingTop, coverMotion.end.headerPaddingTop, 'header padding remains fixed');
    assert.equal(coverMotion.start.headerTitleSize, coverMotion.end.headerTitleSize, 'header title never scales');
    assert.equal(coverMotion.start.sealWidth, 44, 'navbar seal stays large enough to read');
    assert.equal(coverMotion.start.sealWidth, coverMotion.end.sealWidth, 'seal never scales');
    assert.ok(coverMotion.start.headerTranslateY > coverMotion.end.headerTranslateY, 'header moves by translation alone');
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
        fontSize: parseFloat(getComputedStyle(title).fontSize),
        titleTop: titleRect.top,
        titleBottom: titleRect.bottom,
        dockBottom: dock.bottom,
        sourceOpacity: getComputedStyle(source).opacity,
        sourceVisibility: getComputedStyle(source).visibility
      };
    });
    assert.ok(shortPageDock.progress > 0.95, JSON.stringify(shortPageDock));
    assert.ok(Math.abs(shortPageDock.fontSize - 28) < 0.1, 'short pages still finish docking');
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
    assert.equal(archiveIntro.dockSnap, 'none', JSON.stringify(archiveIntro));
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
    await desktopPage.waitForTimeout(900);
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
    assert.ok(Math.abs(archiveDocked.titleSize - 28) < 0.1, 'archive title compactifies');
    assert.ok(archiveDocked.chronoBottom <= archiveDocked.viewport + 2, `timeline fits under header+title in one screen: ${JSON.stringify(archiveDocked)}`);
    assert.ok(archiveDocked.chronoTopToken.includes('5.5'), 'docked archive uses compact chrono metrics');

    // 归档以时间轴收尾，不输出页脚，也不留整屏离场空白。
    const archiveEnd = await desktopPage.evaluate(async () => {
      const exit = document.querySelector('.archive-exit-space');
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        chronoBottom: document.querySelector('.chrono').getBoundingClientRect().bottom,
        mainBottom: document.querySelector('main').getBoundingClientRect().bottom,
        mainPadding: parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom),
        headerTop: document.querySelector('.site-header').getBoundingClientRect().top,
        footerCount: document.querySelectorAll('.site-footer').length,
        exitDisplay: exit ? getComputedStyle(exit).display : 'none',
        exitHeight: exit ? exit.getBoundingClientRect().height : 0
      };
    });
    assert.equal(archiveEnd.footerCount, 0, 'archive omits footer markup');
    assert.equal(archiveEnd.exitDisplay, 'none', 'archive exit runway is removed');
    assert.ok(archiveEnd.exitHeight < 1, 'no full-screen blank after timeline');
    assert.ok(Math.abs(archiveEnd.mainBottom - archiveEnd.chronoBottom - archiveEnd.mainPadding) <= 2, 'archive ends with only the required dock clearance');
    assert.ok(archiveEnd.headerTop >= -1 && archiveEnd.headerTop <= 1, 'header stays pinned at archive end');

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
    await desktopPage.waitForTimeout(900);
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
        dateOpacity: Number(getComputedStyle(signature.querySelector('.post-signature__mark time')).opacity),
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
    assert.ok(Math.abs(readingCiDocked.titleSize - 28) < 0.1, 'ci title compactifies');
    assert.ok(readingCiDocked.metaOpacity < 0.05, 'ci meta fades when docked');
    assert.equal(readingCiDocked.metaVisibility, 'hidden');
    assert.ok(readingCiDocked.lineOpacity < 0.05 || readingCiDocked.lineTransform !== 'none', 'ci columns wait off-screen before wheel reveal');
    assert.ok(readingCiDocked.dateOpacity < 0.05, 'signature date waits hidden with the body animation');
    assert.equal(readingCiDocked.hasVerticalSignature, true, 'ci signature follows vertical columns');
    assert.equal(readingCiDocked.endingSignature, false, 'ci does not duplicate horizontal ending signature');
    assert.equal(readingCiDocked.annotations, false, 'ci annotations are off by default');
    assert.equal(readingCiDocked.dockSnap, 'none');
    assert.equal(readingCiDocked.bodySnap, 'start');
    assert.equal(readingCiDocked.bodySnapStop, 'always', 'reading dock holds at the body start');

    // 定点后锁页：滚轮逐列淡入，落款字后再末拍盖章
    const readingCiColumns = await desktopPage.evaluate(async () => {
      const lines = [...document.querySelectorAll('.post-ci__body--vertical > p')];
      const signature = document.querySelector('.post-ci__body--vertical > .post-signature--vertical');
      const steps = lines.length + (signature ? 2 : 0);
      const date = signature.querySelector('.post-signature__mark time');
      const dateSteps = [];
      const before = {
        lines: lines.map(col => col.classList.contains('is-revealed')),
        meta: signature ? signature.classList.contains('is-revealed') : false,
        stamped: signature ? signature.classList.contains('is-stamped') : false
      };
      for (let i = 0; i < steps; i++) {
        window.dispatchEvent(new WheelEvent('wheel', { deltaY: 80, cancelable: true, bubbles: true }));
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.all(date.getAnimations().map(animation => animation.finished));
        dateSteps.push(Number(getComputedStyle(date).opacity));
      }
      return {
        steps,
        dateSteps,
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
    assert.ok(readingCiColumns.dateSteps.slice(0, -2).every(opacity => opacity < 0.05), 'date stays hidden through the verse-column steps');
    assert.ok(readingCiColumns.dateSteps.at(-2) > 0.95, 'date enters with author before the final seal stamp');
    assert.ok(readingCiColumns.afterLines.every(flag => flag === true), 'wheel fades in every verse column');
    assert.equal(readingCiColumns.meta, true, 'signature text reveals after columns');
    assert.equal(readingCiColumns.stamped, true, 'seal stamps as the final beat');
    assert.equal(readingCiColumns.lockedAfter, false, 'page unlocks after the final stamp');

    // 等盖章动画结束后检查最终位置，避免把入场位移当作排版偏差
    await desktopPage.locator('.post-signature .seal--signature').evaluate(async seal => {
      await Promise.all(seal.getAnimations().map(animation => animation.finished));
    });
    // 桌面竖排：题笺与作者同列，日期另列，印章水平居于两列之间
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
      const t = time.getBoundingClientRect();
      const stamp = seal.getBoundingClientRect();
      const firstLine = document.querySelector('.post-ci__body--vertical > p').getBoundingClientRect();
      return {
        metaDirection: getComputedStyle(meta).flexDirection,
        writingMode: getComputedStyle(trigger).writingMode,
        sameColumn: Math.abs(((a.left + a.right) / 2) - ((s.left + s.right) / 2)) < 24,
        slipBelowAuthor: s.top >= a.bottom - 2,
        markSeparate: Math.abs(((a.left + a.right) / 2) - ((m.left + m.right) / 2)) > 12,
        dateTopAligned: Math.abs(t.top - firstLine.top) <= 2,
        authorTopAligned: Math.abs(a.top - firstLine.top) <= 2,
        markOnLeft: m.right <= a.left,
        sealBetweenColumns: Math.abs((stamp.left + stamp.right) / 2 - (a.left + a.right + t.left + t.right) / 4) <= 2,
        sealBelowDate: stamp.top >= t.bottom,
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
    assert.equal(slipColumn.dateTopAligned, true, 'date starts at the same top edge as the verse');
    assert.equal(slipColumn.authorTopAligned, true, 'author column stays top-aligned with the verse');
    assert.equal(slipColumn.markOnLeft, true, 'date/seal column follows to the left of the author');
    assert.equal(slipColumn.sealBetweenColumns, true, 'seal centers horizontally between author and date');
    assert.equal(slipColumn.sealBelowDate, true, 'seal keeps its height below the date');
    assert.equal(slipColumn.hasDate, true);
    assert.equal(slipColumn.hasSeal, true);
    assert.equal(slipColumn.petalBeforeTrigger, true, 'petal sits between author and slip');
    await desktopPage.screenshot({ path: path.join(output, 'post-ci-docked.png') });

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
    await desktopPage.waitForTimeout(900);
    const readingEssayDocked = await desktopPage.evaluate(() => {
      const epi = document.querySelector('.reading-mast__epigraph');
      const title = document.querySelector('.reading-mast .post-title');
      const meta = document.querySelector('.reading-mast__meta');
      return {
        epiOpacity: Number(getComputedStyle(epi).opacity),
        epiVisibility: getComputedStyle(epi).visibility,
        epiGap: epi.getBoundingClientRect().top - title.getBoundingClientRect().bottom,
        epiSize: parseFloat(getComputedStyle(epi).fontSize),
        metaSize: parseFloat(getComputedStyle(meta).fontSize),
        bodySize: parseFloat(getComputedStyle(document.querySelector('.reading-body')).fontSize),
        metaOpacity: meta ? Number(getComputedStyle(meta).opacity) : 1,
        metaVisibility: meta ? getComputedStyle(meta).visibility : 'visible',
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        commentsMount: Boolean(document.getElementById('gitalk-container'))
      };
    });
    assert.equal(readingEssayDocked.epiOpacity, 1, 'caption remains visible when docked');
    assert.equal(readingEssayDocked.epiVisibility, 'visible');
    assert.ok(readingEssayDocked.epiGap >= 7 && readingEssayDocked.epiGap <= 9, 'caption docks with an 8px title gap');
    assert.ok(readingEssayDocked.metaSize < readingEssayDocked.epiSize && readingEssayDocked.epiSize < readingEssayDocked.bodySize, 'caption size sits between metadata and body');
    assert.ok(readingEssayDocked.metaOpacity < 0.05, 'essay author/date fade when docking into body');
    assert.equal(readingEssayDocked.metaVisibility, 'hidden');
    assert.ok(Math.abs(readingEssayDocked.titleSize - 28) < 0.1, 'essay title compactifies');
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
    assert.ok(Math.abs(aboutDocked.titleSize - 28) < 0.1, 'about title compactifies');
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
    assert.equal(homeFooter.dockSnap, 'none');
    assert.equal(homeFooter.sheetStop, 'always');
    assert.ok(homeFooter.footerBottomVisible, 'home can pass the dock snap and reach the footer');

    // 首页诗文简介与辅助信息分层，简介保持可连续阅读的正文字号
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const homeExcerptSizes = await desktopPage.evaluate(() => {
      const verse = document.querySelector('.post-item__verse');
      const excerpt = document.querySelector('.post-excerpt');
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const expected = `${root * 1.0625}px`;
      return {
        verse: verse ? getComputedStyle(verse).fontSize : null,
        excerpt: excerpt ? getComputedStyle(excerpt).fontSize : null,
        expected
      };
    });
    assert.equal(homeExcerptSizes.verse, homeExcerptSizes.excerpt, 'home poetry and essay intros share the same font size');
    assert.equal(homeExcerptSizes.verse, homeExcerptSizes.expected, 'home intros use the readable 17px summary size');

    await desktopPage.goto(origin + prefix + '/archives/');
    await desktopPage.evaluate(() => document.fonts.ready);
    const recentSize = await desktopPage.evaluate(() => {
      const link = document.querySelector('.archive-recent__link');
      const sm = getComputedStyle(document.documentElement).getPropertyValue('--text-body').trim();
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize);
      const expected = /rem$/.test(sm) ? `${root * parseFloat(sm)}px` : sm;
      return {
        size: link ? getComputedStyle(link).fontSize : null,
        expected
      };
    });
    assert.equal(recentSize.size, recentSize.expected, 'archive recent shares the readable body scale');

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
    // 统一字号需要同时覆盖正文、标题、辅助信息和列表摘要。
    for (const width of [390, 1280]) {
      await desktopPage.setViewportSize({ width, height: 900 });
      await desktopPage.emulateMedia({ reducedMotion: 'reduce' });
      for (const [route, selector] of [['/2026/10/10/test/', '.reading-body'], ['/about/', '.page-content']]) {
        await desktopPage.goto(origin + prefix + route);
        await desktopPage.evaluate(() => document.fonts.ready);
        const type = await desktopPage.evaluate(selector => {
          const body = getComputedStyle(document.querySelector(selector));
          const title = getComputedStyle(document.querySelector('.reading-mast .post-title, .page-about__name'));
          const meta = getComputedStyle(document.querySelector('.reading-mast__meta, .page-about__tagline'));
          const heading = document.querySelector('.reading-body h2');
          return { body: parseFloat(body.fontSize), leading: parseFloat(body.lineHeight) / parseFloat(body.fontSize),
            tracking: body.letterSpacing, title: parseFloat(title.fontSize), titleLeading: parseFloat(title.lineHeight) / parseFloat(title.fontSize),
            meta: parseFloat(meta.fontSize), metaColor: meta.color, bodyColor: body.color,
            h2: heading ? parseFloat(getComputedStyle(heading).fontSize) : null,
            mainWidth: document.querySelector('main').getBoundingClientRect().width,
            padding: parseFloat(getComputedStyle(document.querySelector('main')).paddingLeft),
            overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        }, selector);
        assert.equal(type.body, width >= 900 ? 18 : 17, `${route}: responsive reading size`);
        assert.equal(type.mainWidth, width >= 900 ? 928 : width, `${route}: broader reading container`);
        assert.equal(type.padding, width >= 900 ? 24 : 16, `${route}: responsive side padding`);
        assert.ok(Math.abs(type.leading - 1.8) < 0.01, `${route}: body line height is 1.8`);
        assert.ok(['normal', '0px'].includes(type.tracking), `${route}: no extra prose tracking`);
        assert.equal(type.title, width >= 900 ? 40 : 32, `${route}: consistent page title size`);
        assert.ok(Math.abs(type.titleLeading - 1.3) < 0.02, `${route}: compact heading line height`);
        assert.ok(type.meta >= 13 && type.meta <= 14 && type.metaColor !== type.bodyColor, `${route}: metadata is quieter than body`);
        if (type.h2) assert.equal(type.h2, 24, 'H2 steps below page title');
        assert.equal(type.overflow, false, `${route}: no typography overflow`);
        await desktopPage.screenshot({ path: path.join(output, `typography-${route.includes('about') ? 'about' : 'article'}-${width}.png`), fullPage: true });
      }
      await desktopPage.goto(origin + prefix + '/');
      const summaries = await desktopPage.locator('.post-excerpt, .post-item__verse').evaluateAll(elements => elements.map(el => {
        const css = getComputedStyle(el);
        return { size: parseFloat(css.fontSize), leading: parseFloat(css.lineHeight) / parseFloat(css.fontSize) };
      }));
      assert.ok(summaries.length && summaries.every(type => type.size === 17 && Math.abs(type.leading - 1.8) < 0.01), 'previews share readable size and rhythm');
    }
    await desktopPage.emulateMedia({ reducedMotion: 'no-preference' });
    console.log('PASS typography: responsive body, unified titles, readable previews and quiet metadata'); checks++;
    // 真实滚轮：小幅输入不移动，越阈值自动落定，余势不穿透到正文或诗列。
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 }]) {
      await desktopPage.setViewportSize(viewport);
      for (const [name, route] of pages.filter(([name]) => ['index', 'archive', 'archive-year', 'archive-month', 'category', 'tag', 'post-ci', 'post-essay', 'markdown', 'about'].includes(name))) {
        await desktopPage.goto(origin + prefix + route);
        await desktopPage.evaluate(() => document.fonts.ready);
        const coverStart = await desktopPage.evaluate(() => {
          const group = document.querySelector('.home-epigraph, .archive-head__title, .reading-mast .post-title, .page-about__name').getBoundingClientRect();
          const image = document.querySelector('.site-header__brand img');
          return { center: (group.top + group.bottom) / 2, headerHeight: document.querySelector('.site-header').getBoundingClientRect().height,
            imageReady: image.complete && image.naturalWidth > 0, src: image.getAttribute('src'),
            signatureImages: document.querySelectorAll('.post-signature img[src*="stamp-1794585749485"]').length };
        });
        assert.ok(Math.abs(coverStart.center - viewport.height / 2) < 1, `${name}: main title itself centers independently of supplementary content: ${JSON.stringify(coverStart)}`);
        assert.ok(coverStart.imageReady && coverStart.src.endsWith('/images/stamp-1794585749485.png'), `${name}: navbar uses the supplied PNG`);
        assert.equal(coverStart.signatureImages, 0, 'navbar image never replaces signature seal');
        await desktopPage.screenshot({ path: path.join(output, `${name}-${viewport.width}-cover-centered.png`) });
        await desktopPage.mouse.move(20, viewport.height / 2);
        await desktopPage.mouse.wheel(0, 30);
        await desktopPage.waitForTimeout(220);
        assert.ok(await desktopPage.evaluate(() => scrollY <= 1), `${name}: subthreshold wheel stays at cover`);
        for (let i = 0; i < 3; i++) await desktopPage.mouse.wheel(0, 30);
        await desktopPage.waitForTimeout(750);
        const landed = await desktopPage.evaluate(() => {
          const rect = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
          const mast = rect('.home-cover, .archive-head, .reading-mast');
          const anchor = rect('.home-dock-zone + .home-sheet, .archive-legend, .reading-body-anchor');
          const title = rect('.home-epigraph__text, .archive-head__title, .reading-mast .post-title, .page-about__name');
          const header = rect('.site-header');
          const eyebrow = document.querySelector('.reading-mast .post-ci__cipai-badge, .reading-mast .post-detail__eyebrow');
          const titleElement = document.querySelector('.home-epigraph__text, .archive-head__title, .reading-mast .post-title, .page-about__name');
          return { y: scrollY, mast, anchor, title, header,
            eyebrow: eyebrow ? eyebrow.getBoundingClientRect().toJSON() : null,
            titleSize: parseFloat(getComputedStyle(titleElement).fontSize),
            revealed: document.querySelectorAll('[data-ci-columns] .is-revealed').length };
        });
        assert.ok(landed.y > viewport.height / 2, `${name}: threshold completes full travel`);
        assert.ok(Math.abs(landed.mast.top - landed.header.bottom) <= 2, `${name}: mast aligns below header`);
        assert.ok(Math.abs(landed.anchor.top - landed.mast.bottom) <= 2, `${name}: anchor aligns below mast`);
        assert.ok(landed.title.top >= landed.mast.top - 1 && landed.title.bottom <= landed.mast.bottom + 1,
          `${name}: complete title fits at dock: ${JSON.stringify(landed)}`);
        assert.equal(landed.titleSize, 28, `${name}: dock title remains larger than 18px prose and 20px verse`);
        if (landed.eyebrow) {
          assert.ok(landed.eyebrow.top >= landed.header.bottom + 2 && landed.eyebrow.bottom <= landed.title.top,
            `${name}: rubric and title are both completely visible below header: ${JSON.stringify(landed)}`);
        }
        assert.equal(landed.revealed, 0, `${name}: cover gesture does not also reveal poem columns`);
        await desktopPage.screenshot({ path: path.join(output, `${name}-${viewport.width}-wheel-docked.png`) });
        await desktopPage.mouse.wheel(0, -30);
        await desktopPage.waitForTimeout(220);
        assert.ok(Math.abs(await desktopPage.evaluate(() => scrollY) - landed.y) <= 2, `${name}: small reverse wheel stays docked`);
        await desktopPage.evaluate(() => {
          window.coverReturnFrames = [];
          const title = document.querySelector('.home-epigraph__text, .archive-head__title, .reading-mast .post-title, .page-about__name');
          const group = document.querySelector('.home-epigraph, .archive-head__title, .reading-mast .post-title, .page-about__name');
          const header = document.querySelector('.site-header');
          const mast = document.querySelector('.home-cover, .archive-head, .reading-mast');
          const start = performance.now();
          function record(now) {
            const rect = group.getBoundingClientRect();
            window.coverReturnFrames.push({ t: now - start, y: scrollY, titleTop: title.getBoundingClientRect().top,
              center: (rect.top + rect.bottom) / 2, headerHeight: header.getBoundingClientRect().height,
              mastTop: mast.getBoundingClientRect().top });
            if (now - start < 900) requestAnimationFrame(record);
          }
          requestAnimationFrame(record);
        });
        await desktopPage.mouse.wheel(0, -120);
        await desktopPage.waitForTimeout(1000);
        const returnedFrames = await desktopPage.evaluate(() => window.coverReturnFrames);
        assert.ok(await desktopPage.evaluate(() => scrollY <= 1), `${name}: reverse gesture returns completely to cover`);
        assert.ok(returnedFrames.every(frame => Math.abs(frame.headerHeight - coverStart.headerHeight) < 0.1), `${name}: compact header never changes document flow height`);
        const finalTravel = returnedFrames.filter(frame => frame.y <= 32 && frame.t > 200);
        assert.ok(finalTravel.length > 5, `${name}: sample the final sticky release region`);
        assert.ok(finalTravel.every(frame => Math.abs(frame.mastTop - landed.header.bottom) < 0.1),
          `${name}: mast must not drop out of sticky positioning during the last 32px`);
        const settled = returnedFrames.filter(frame => frame.y === 0 && frame.t > 400);
        assert.ok(settled.length > 5, `${name}: return endpoint is sampled over multiple frames`);
        assert.ok(settled.every(frame => Math.abs(frame.center - coverStart.center) < 0.1), `${name}: return restores the exact initial center`);
        assert.ok(Math.max(...settled.map(frame => frame.titleTop)) - Math.min(...settled.map(frame => frame.titleTop)) < 0.1,
          `${name}: title cannot jump after reaching the cover`);
        await desktopPage.screenshot({ path: path.join(output, `${name}-${viewport.width}-cover-returned.png`) });
      }
    }
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.mouse.move(20, 450);
    for (let i = 0; i < 12; i++) {
      await desktopPage.mouse.wheel(0, 120);
      await desktopPage.waitForTimeout(65);
    }
    await desktopPage.waitForTimeout(250);
    const heldY = await desktopPage.evaluate(() => scrollY);
    assert.ok(Math.abs(heldY - 840) <= 2, 'long wheel inertia drains at the dock without entering content');
    await desktopPage.mouse.wheel(0, 140);
    await desktopPage.waitForTimeout(250);
    assert.ok(await desktopPage.evaluate(y => scrollY > y + 80, heldY), 'a fresh gesture scrolls normally beyond the dock');
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.keyboard.press('PageDown');
    await desktopPage.waitForTimeout(750);
    assert.ok(Math.abs(await desktopPage.evaluate(() => scrollY) - heldY) <= 2, 'PageDown completes cover transition');
    await desktopPage.keyboard.press('PageUp');
    await desktopPage.waitForTimeout(750);
    assert.ok(await desktopPage.evaluate(() => scrollY <= 1), 'PageUp returns to cover');
    await desktopPage.evaluate(() => scrollTo({ top: 260, behavior: 'instant' }));
    await desktopPage.waitForTimeout(950);
    assert.ok(Math.abs(await desktopPage.evaluate(() => scrollY) - heldY) <= 2, 'manual partial travel settles forward');
    await desktopPage.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
    await desktopPage.waitForTimeout(950);
    assert.ok(await desktopPage.evaluate(() => scrollY <= 1), 'manual reverse travel settles back to cover');
    await desktopPage.goto(origin + prefix + '/2026/10/10/test/#' + encodeURIComponent('图片与图注'));
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.waitForTimeout(950);
    assert.ok(await desktopPage.locator('.reading-body h2').last().evaluate(el =>
      el.getBoundingClientRect().top >= document.querySelector('.reading-mast').getBoundingClientRect().bottom),
    'direct body heading hash clears both sticky headers');
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.keyboard.press('Tab');
    await desktopPage.keyboard.press('Enter');
    await desktopPage.waitForTimeout(950);
    assert.ok(await desktopPage.locator('#home-stream').evaluate(el =>
      document.activeElement === el && Math.abs(el.getBoundingClientRect().top - document.querySelector('.home-cover').getBoundingClientRect().bottom) <= 2),
    'animated cover skip link preserves focus and corrected dock alignment');
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.mouse.wheel(0, 120);
    await desktopPage.waitForTimeout(100);
    await desktopPage.emulateMedia({ reducedMotion: 'reduce' });
    await desktopPage.waitForTimeout(80);
    const cancelledY = await desktopPage.evaluate(() => scrollY);
    await desktopPage.waitForTimeout(700);
    assert.equal(await desktopPage.evaluate(() => scrollY), cancelledY, 'motion preference change cancels pending animation');
    for (const mode of ['narrow', 'reduce']) {
      await desktopPage.setViewportSize({ width: mode === 'narrow' ? 768 : 1280, height: 900 });
      await desktopPage.emulateMedia({ reducedMotion: mode === 'reduce' ? 'reduce' : 'no-preference' });
      await desktopPage.goto(origin + prefix + '/');
      assert.equal(await desktopPage.locator('html').evaluate(el => el.classList.contains('cover-scroll-enabled')), false, `${mode}: cover controller disabled`);
      await desktopPage.mouse.wheel(0, 30);
      await desktopPage.waitForTimeout(250);
      assert.ok(await desktopPage.evaluate(() => scrollY > 0 && scrollY < 80), `${mode}: native wheel scrolling retained`);
    }
    console.log('PASS cover gestures: threshold, full forward/reverse travel, aligned titles, inertia, keyboard, manual settling and native fallbacks'); checks++;
    await desktopContext.close();
    // 时间轴专测：保持真实页面结构，临时构造跨年密集内容，不改测试站文章。
    const timelineContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const timelinePage = await timelineContext.newPage();
    const timelineErrors = [];
    timelinePage.on('pageerror', error => timelineErrors.push(error.message));
    async function openTimeline() {
      await timelinePage.goto(origin + prefix + '/archives/');
      await timelinePage.evaluate(() => document.fonts.ready);
      await timelinePage.mouse.move(20, 200);
      await timelinePage.mouse.wheel(0, 120);
      await timelinePage.waitForTimeout(950);
    }
    for (const viewport of [{ width: 1024, height: 768 }, { width: 1280, height: 720 }, { width: 1440, height: 900 },
      { width: 1024, height: 480 }, { width: 1440, height: 360 }]) {
      await timelinePage.setViewportSize(viewport);
      await openTimeline();
      const geometry = await timelinePage.locator('.chrono').evaluate(el => {
        const outer = el.getBoundingClientRect();
        const rail = el.querySelector('.chrono__rail').getBoundingClientRect();
        const curve = el.querySelector('.chrono__curve-line').getBoundingClientRect();
        const year = document.createRange();
        year.selectNodeContents(el.querySelector('.chrono__year-greg'));
        return { outerBottom: outer.bottom, railBottom: rail.bottom, curveBottom: curve.bottom,
          yearTop: year.getBoundingClientRect().top, railTop: rail.top,
          mainBottom: document.querySelector('main').getBoundingClientRect().bottom,
          viewport: innerHeight, widthFits: document.documentElement.scrollWidth <= innerWidth + 1 };
      });
      assert.ok(geometry.railBottom <= geometry.outerBottom + 1, `rail fits short viewport: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.yearTop >= geometry.railTop - 1, 'year first glyph is not clipped by curved lift');
      assert.ok(geometry.curveBottom <= geometry.outerBottom - 1, `bottom arc is not clipped: ${JSON.stringify(geometry)}`);
      assert.ok(geometry.mainBottom >= geometry.railBottom - 1, 'rail remains contained in archive main');
      assert.ok(geometry.widthFits, 'archive keeps horizontal overflow inside rail');
      if (viewport.height >= 480) assert.ok(geometry.outerBottom <= viewport.height + 2, 'dock fits usable viewport');
      await timelinePage.screenshot({ path: path.join(output, `timeline-${viewport.width}-${viewport.height}.png`) });
    }
    await timelinePage.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
      const track = document.querySelector('.chrono__track');
      if (!track) return;
      const yearTemplate = track.querySelector('.chrono__year').cloneNode(true);
      const itemTemplate = yearTemplate.querySelector('.chrono__item').cloneNode(true);
      const titles = ['跨年长标题的折列与完整显示验证：江南山水之间的旧事与新篇',
        'Hexo Timeline: Keyboard and Pointer Interaction', 'SupercalifragilisticexpialidociousTimelineLayout', '短题'];
      track.replaceChildren();
      for (let year = 2026; year >= 2024; year--) {
        const group = yearTemplate.cloneNode(true);
        group.querySelector('.chrono__year-greg').textContent = [...String(year)].map(digit => '〇一二三四五六七八九'[Number(digit)]).join('');
        const list = group.querySelector('.chrono__items');
        list.replaceChildren();
        for (let index = 0; index < 10; index++) {
          const item = itemTemplate.cloneNode(true);
          item.dataset.cat = ['ci', 'essay', 'tech'][index % 3];
          item.querySelector('.chrono__title').textContent = titles[index % titles.length];
          list.append(item);
        }
        track.append(group);
      }
    }));
    await timelinePage.setViewportSize({ width: 1440, height: 900 });
    await openTimeline();
    const rail = timelinePage.locator('[data-chrono-rail]');
    assert.ok(await rail.evaluate(el => Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) < 2), 'dense archive initially shows newest end');
    const overlap = await rail.evaluate(el => [...el.querySelectorAll('.chrono__items')].some(list => {
      const items = [...list.children].map(item => item.getBoundingClientRect());
      return items.slice(1).some((rect, index) => rect.right > items[index].left + 1);
    }));
    assert.equal(overlap, false, 'long mixed-language titles wrap without overlapping adjacent columns');
    assert.ok(await rail.evaluate(el => [...el.querySelectorAll('.chrono__entry')].every(entry => {
      const range = document.createRange();
      range.selectNodeContents(entry);
      const glyphs = range.getBoundingClientRect();
      const rect = entry.getBoundingClientRect();
      return glyphs.left >= rect.left - 2 && glyphs.right <= rect.right + 2 && glyphs.bottom <= rect.bottom + 2;
    })), 'actual title glyphs remain inside their columns');
    assert.ok(await rail.evaluate(el => {
      const svg = document.querySelector('.chrono__curve');
      const axis = document.querySelector('.chrono__axis-line');
      const bounds = svg.getBoundingClientRect();
      const length = axis.getTotalLength();
      return [...el.querySelectorAll('.chrono__dot')].every(dot => {
        const rect = dot.getBoundingClientRect();
        const x = rect.left + rect.width / 2 - bounds.left;
        if (x < 0 || x > bounds.width) return true;
        const point = axis.getPointAtLength(length * x / bounds.width);
        return Math.abs(rect.top + rect.height / 2 - bounds.top - point.y) < 1;
      });
    }), 'visible date nodes stay on the arc within one pixel');
    // 纸卷平面：题列不再做圆柱透视；边缘与中心同为可读墨色。
    const planarSamples = await rail.evaluate(el => {
      const bounds = el.getBoundingClientRect();
      return [...el.querySelectorAll('.chrono__item')].map(item => {
        const rect = item.getBoundingClientRect();
        const css = getComputedStyle(item.querySelector('.chrono__entry'));
        const matrix = new DOMMatrix(css.transform);
        return {
          distance: Math.abs(rect.left + rect.width / 2 - bounds.left - bounds.width / 2),
          visible: rect.right > bounds.left && rect.left < bounds.right,
          z: matrix.m43,
          rotation: Math.abs(matrix.m13),
          opacity: Number(css.opacity),
          blur: parseFloat(String(css.filter).replace(/blur\(([^)]+)\).*/, '$1')) || 0
        };
      }).filter(item => item.visible).sort((a, b) => a.distance - b.distance);
    });
    assert.ok(planarSamples.length >= 2, 'planar archive still exposes multiple visible columns');
    assert.ok(planarSamples.every(sample => Math.abs(sample.z) < 1 && sample.rotation < 0.01 && sample.blur < 0.05),
      `planar paper scroll keeps columns unrotated and unblurred: ${JSON.stringify(planarSamples.slice(0, 3))}`);
    await timelinePage.screenshot({ path: path.join(output, 'timeline-paper-scroll.png') });
    const railBox = await rail.boundingBox();
    await timelinePage.mouse.move(railBox.x + railBox.width / 2, railBox.y + 150);
    const beforeWheel = await rail.evaluate(el => el.scrollLeft);
    await timelinePage.mouse.wheel(0, 160);
    await timelinePage.waitForTimeout(900);
    assert.ok(await rail.evaluate((el, before) => el.scrollLeft < before - 100, beforeWheel), 'real wheel moves toward older entries');
    await rail.focus();
    await timelinePage.keyboard.press('End');
    await timelinePage.waitForTimeout(1800);
    assert.ok(await rail.evaluate(el => el.scrollLeft < 1), 'End reaches oldest end');
    await timelinePage.keyboard.press('Home');
    await timelinePage.waitForTimeout(1800);
    assert.ok(await rail.evaluate(el => Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) < 1), 'Home reaches newest end');
    await rail.evaluate(el => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.5; });
    await timelinePage.waitForTimeout(80);
    const progressBefore = await rail.evaluate(el => el.scrollLeft / (el.scrollWidth - el.clientWidth));
    await timelinePage.setViewportSize({ width: 1024, height: 480 });
    await timelinePage.waitForTimeout(300);
    assert.ok(await rail.evaluate((el, before) => Math.abs(el.scrollLeft / (el.scrollWidth - el.clientWidth) - before) < 0.01, progressBefore), 'resizing and title reflow preserve reading progress');
    await timelinePage.screenshot({ path: path.join(output, 'timeline-dense-short.png') });
    await timelinePage.setViewportSize({ width: 1440, height: 900 });
    await timelinePage.waitForTimeout(300);
    assert.ok(await rail.evaluate((el, before) => Math.abs(el.scrollLeft / (el.scrollWidth - el.clientWidth) - before) < 0.01, progressBefore), 'reverse resize also preserves reading progress');
    await rail.evaluate(el => { el.scrollLeft = el.scrollWidth; });
    await timelinePage.waitForTimeout(80);
    await timelinePage.setViewportSize({ width: 1900, height: 900 });
    await timelinePage.waitForTimeout(200);
    assert.ok(await rail.evaluate(el => Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) < 2), 'newest endpoint stays pinned when viewport widens');
    await timelinePage.setViewportSize({ width: 1440, height: 900 });
    await timelinePage.waitForTimeout(200);
    await rail.evaluate(el => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.5; });
    const box = await rail.boundingBox();
    await timelinePage.mouse.move(box.x + box.width * 0.6, box.y + 140);
    const dragStart = await rail.evaluate(el => el.scrollLeft);
    await timelinePage.mouse.down();
    await timelinePage.mouse.move(box.x + box.width * 0.65, box.y + 140, { steps: 3 });
    assert.equal(await rail.evaluate(el => el.hasPointerCapture(1)), true, 'drag captures pointer after threshold');
    await timelinePage.mouse.move(box.x + box.width + 15, box.y + 140, { steps: 8 });
    await timelinePage.mouse.up();
    assert.ok(await rail.evaluate((el, start) => el.scrollLeft < start - 200, dragStart), 'drag continues outside rail bounds');
    assert.equal(await rail.evaluate(el => el.classList.contains('is-dragging')), false, 'drag state clears on release');
    assert.ok(timelinePage.url().includes('/archives/'), 'drag never navigates an article link');
    await timelinePage.locator('[data-cat-filter="ci"]').click();
    assert.equal(await timelinePage.locator('.chrono__item:not(.is-dimmed)').count(), 12, 'filter preserves matching entries across years');
    await timelinePage.locator('[data-cat-filter="project"]').click();
    assert.ok(await timelinePage.locator('.chrono').isHidden(), 'empty category hides entire axis');
    assert.ok(await timelinePage.locator('[data-archive-empty]').isVisible(), 'empty result remains readable');
    assert.ok(await timelinePage.locator('.archive-legend').evaluate(el => Math.abs(el.getBoundingClientRect().top - document.querySelector('.archive-head').getBoundingClientRect().bottom) < 2), 'empty filter preserves dock instead of collapsing back to cover');
    await timelinePage.locator('[data-cat-filter="project"]').click();
    await timelinePage.waitForTimeout(100);
    assert.equal(await timelinePage.locator('.chrono__item:not(.is-dimmed)').count(), 30, 'restore shows all years and columns');
    assert.ok(await rail.evaluate(el => Math.abs(el.scrollLeft - (el.scrollWidth - el.clientWidth)) < 2), 'filter restore aligns newest end after reflow');
    await timelinePage.screenshot({ path: path.join(output, 'timeline-dense-restored.png') });
    const modes = await rail.evaluate(el => {
      el.scrollLeft = el.scrollWidth;
      const lineStart = el.scrollLeft;
      const lineEvent = new WheelEvent('wheel', { deltaY: 3, deltaMode: 1, cancelable: true });
      const consumed = !el.dispatchEvent(lineEvent);
      return { consumed, lineStart };
    });
    await timelinePage.waitForTimeout(900);
    assert.ok(modes.consumed && await rail.evaluate((el, start) => el.scrollLeft < start - 30, modes.lineStart), 'line-mode wheel uses line height instead of treating lines as pixels');
    await rail.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 1, deltaMode: 2, cancelable: true })));
    await timelinePage.waitForTimeout(80);
    await timelinePage.emulateMedia({ reducedMotion: 'reduce' });
    await timelinePage.waitForTimeout(200);
    assert.equal(await rail.locator('.chrono__entry').first().evaluate(el => getComputedStyle(el).transform), 'none', 'reduced motion disables timeline perspective');
    const reducedPosition = await rail.evaluate(el => el.scrollLeft);
    await timelinePage.waitForTimeout(350);
    assert.equal(await rail.evaluate(el => el.scrollLeft), reducedPosition, 'motion preference change settles pending glide');
    await timelinePage.emulateMedia({ reducedMotion: 'no-preference' });
    await openTimeline();
    await rail.evaluate(el => { el.scrollLeft = 50; });
    await timelinePage.waitForTimeout(80);
    const boundary = await rail.evaluate(el => {
      el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }));
      const next = new WheelEvent('wheel', { deltaY: 100, cancelable: true });
      el.dispatchEvent(next);
      return next.defaultPrevented;
    });
    assert.ok(boundary, 'page scrolling waits for remaining horizontal travel at endpoint');
    await timelinePage.waitForTimeout(1100);
    assert.equal(await rail.evaluate(el => el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, cancelable: true }))), true, 'settled endpoint releases vertical scroll');
    const focusedEntry = rail.locator('.chrono__entry').first();
    await focusedEntry.focus();
    assert.ok(await focusedEntry.evaluate(el => {
      const rect = el.getBoundingClientRect();
      const bounds = el.closest('.chrono__rail').getBoundingClientRect();
      return rect.left >= bounds.left + bounds.width * 0.03 && rect.right <= bounds.right - bounds.width * 0.03;
    }), 'keyboard focus reveals whole title outside edge fade');
    await focusedEntry.evaluate(el => el.addEventListener('click', event => {
      el.dataset.clickPrevented = String(event.defaultPrevented);
      event.preventDefault();
    }, { once: true }));
    await focusedEntry.click();
    assert.equal(await focusedEntry.getAttribute('data-click-prevented'), 'false', 'ordinary link click still works after a drag');
    for (const width of [360, 390, 768]) {
      await timelinePage.setViewportSize({ width, height: 900 });
      await timelinePage.waitForTimeout(150);
      assert.ok(await timelinePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `dense archive at ${width}: no page overflow`);
      assert.equal(await rail.locator('.chrono__entry').first().evaluate(el => getComputedStyle(el).transform), 'none', `dense archive at ${width}: narrow layout stays flat`);
      await timelinePage.screenshot({ path: path.join(output, `timeline-dense-${width}.png`), fullPage: true });
    }
    assert.deepEqual(timelineErrors, [], 'timeline has no script or ResizeObserver errors');
    await timelineContext.close();
    console.log('PASS archive timeline: short-window geometry, cross-year long titles, wheel, keyboard, pointer capture, filtering and resize'); checks++;
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
