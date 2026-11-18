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
// 以路径上的实际横坐标采样，避免把弧长误当作横向距离。
async function inspectSurface(page) {
  return page.locator('.chrono').evaluate(el => {
    const rail = el.querySelector('.chrono__rail').getBoundingClientRect();
    const path = el.querySelector('.chrono__axis-line');
    const svg = path.ownerSVGElement.getBoundingClientRect();
    const length = path.getTotalLength();
    return [...el.querySelectorAll('.chrono__node')].map(node => {
      const dot = node.querySelector('.chrono__dot').getBoundingClientRect();
      const x = dot.left + dot.width / 2 - svg.left;
      let lo = 0;
      let hi = length;
      for (let index = 0; index < 24; index++) {
        const mid = (lo + hi) / 2;
        if (path.getPointAtLength(mid).x < x) lo = mid;
        else hi = mid;
      }
      const point = path.getPointAtLength((lo + hi) / 2);
      const text = node.querySelector('.chrono__entry,.chrono__year-greg,.chrono__month-name');
      const entry = node.querySelector('.chrono__entry');
      const css = getComputedStyle(text);
      return {
        visible: x >= 16 && x <= rail.width - 16,
        x, error: Math.abs(dot.top + dot.height / 2 - svg.top - point.y),
        scale: Number(getComputedStyle(node).getPropertyValue('--chrono-scale')),
        size: parseFloat(css.fontSize), opacity: parseFloat(getComputedStyle(node.querySelector('.chrono__date,.chrono__terms,.chrono__rubric') || text).opacity),
        color: css.color,
        dotColor: getComputedStyle(node.querySelector('.chrono__dot')).backgroundColor,
        tracking: node.querySelector('.chrono__entry')
          ? parseFloat(getComputedStyle(node.querySelector('.chrono__entry')).letterSpacing)
          : 0,
        transform: entry ? getComputedStyle(entry).transform : css.transform,
        tangentAngle: parseFloat(getComputedStyle(node).getPropertyValue('--chrono-skew')),
        filter: entry ? getComputedStyle(entry).filter : css.filter
      };
    }).filter(node => node.visible);
  });
}
async function progressGeometry(page) {
  return page.locator('.chrono').evaluate(el => {
    const rail = el.querySelector('.chrono__rail');
    const curve = el.querySelector('.chrono__curve-line');
    const dot = el.querySelector('.chrono__curve-dot');
    const total = rail.scrollWidth - rail.clientWidth;
    const progress = total > 1 ? rail.scrollLeft / total : 0.5;
    const point = curve.getPointAtLength(curve.getTotalLength() * progress);
    const matrix = curve.getScreenCTM();
    const actual = dot.getBoundingClientRect();
    const target = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return {
      progress,
      x: Number(dot.getAttribute('cx')),
      y: Number(dot.getAttribute('cy')),
      error: Math.hypot(actual.left + actual.width / 2 - target.x, actual.top + actual.height / 2 - target.y)
    };
  });
}
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
        assert.equal(await page.locator('.site-footer').count(), 1, `${name}: shared footer is present`);
        assert.equal(await page.locator('.site-footer a, .site-footer__links').count(), 0, `${name}: footer has no page entrances`);
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
          } else {
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
            const verses = body.querySelector('.post-ci__verses');
            const lines = [...verses.querySelectorAll(':scope > p')];
            const lower = lines.findIndex(line => line.hasAttribute('data-stanza-start'));
            const rects = lines.map(line => line.getBoundingClientRect());
            const signature = body.querySelector('.post-signature');
            const author = signature.querySelector('.post-signature__author').getBoundingClientRect();
            const date = signature.querySelector('time').getBoundingClientRect();
            const title = document.querySelector('.post-title').getBoundingClientRect();
            const bodyRect = body.getBoundingClientRect();
            const characterRect = (node, offset) => {
              const range = document.createRange();
              range.setStart(node, offset); range.setEnd(node, offset + 1);
              return range.getBoundingClientRect();
            };
            const firstCharacter = characterRect(lines[0].firstChild, 0);
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
              signatureTextGap: parseFloat(getComputedStyle(signature).gap),
              signatureSealGap: signature.querySelector('.seal--signature').getBoundingClientRect().top - date.bottom,
              signatureSealWidth: signature.querySelector('.seal--signature').getBoundingClientRect().width,
              signatureSlipSize: parseFloat(getComputedStyle(signature.querySelector('[data-poem-slip-open]')).fontSize),
              signatureSlipGap: parseFloat(getComputedStyle(signature.querySelector('.post-signature__slip')).gap),
              signatureSlipMargin: parseFloat(getComputedStyle(signature.querySelector('.post-signature__slip')).marginTop),
              stanzaSpace: rects[lower].top - rects[lower - 1].bottom,
              removedFormatting: document.querySelectorAll('.poem-punctuation, .poem-gloss, .poem-annotations').length,
              columnWidths: rects.map(rect => rect.width),
              columnHeights: rects.map(rect => rect.height),
              verseTextHeights: lines.map(line => {
                const range = document.createRange();
                range.selectNodeContents(line);
                return range.getBoundingClientRect().height;
              }),
              railEnds: lines.filter(line => getComputedStyle(line, '::after').content !== 'none').map(line => {
                const style = getComputedStyle(line, '::after');
                return { top: parseFloat(style.top), bottom: parseFloat(style.bottom), width: parseFloat(style.width) };
              }),
              stageHeight: verses.getBoundingClientRect().height,
              verseSizes: lines.map(line => getComputedStyle(line).fontSize),
              verseWeights: lines.map(line => getComputedStyle(line).fontWeight),
              boundaryStarts: lines.map(line => getComputedStyle(line, '::before').content),
              railOpacity: getComputedStyle(body).getPropertyValue('--silk-rail').trim(),
              stanzaGap: parseFloat(getComputedStyle(lines[lower]).marginRight),
              stanzaBoundary: getComputedStyle(lines[lower], '::before').content,
              punctuationDisplays: [...body.querySelectorAll('.ci-punctuation')].map(node => getComputedStyle(node).display),
              verseTracking: parseFloat(getComputedStyle(lines[0]).letterSpacing),
              columnCenterErrors: lines.map((line, index) => {
                const glyph = characterRect(line.firstChild, 0);
                return Math.abs((glyph.left + glyph.right - rects[index].left - rects[index].right) / 2);
              }),
              columnPitch: parseFloat(getComputedStyle(lines[0]).lineHeight),
              railContents: lines.map(line => getComputedStyle(line, '::after').content),
              firstBoundary: getComputedStyle(lines[0], '::before').content,
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
          assert.ok(composition.text.includes('露下碧梧冷，风引画檐铃。'), 'native punctuation preserves the original text');
          assert.equal(composition.removedFormatting, 0, 'poetry has no generated annotations or punctuation wrappers');
          if (width >= 1024) {
            assert.ok(composition.gaps.every((gap, index) => Math.abs(gap - (index === composition.lower - 1 ? composition.stanzaGap : 0)) <= 1), 'only the stanza boundary adds a gap');
            assert.ok(Math.abs(composition.stanzaGap - composition.columnPitch / 2) <= 1, 'upper and lower stanzas are separated by half a column');
            assert.equal(composition.stanzaBoundary, 'none', 'stanza gap has no enclosing rail');
            assert.ok(Math.abs(composition.columnPitch - 61 * 1.12) <= 1, 'ordinary column pitch increases by twelve percent');
            assert.ok(Math.abs(composition.verseTracking - composition.verseSize * 0.04) <= 0.1, 'vertical character tracking is compact');
            assert.ok(composition.punctuationDisplays.length > 0 && composition.punctuationDisplays.every(display => display === 'none'), 'desktop verse hides modern punctuation');
            assert.ok(composition.columnWidths.every(width => Math.abs(width - composition.columnPitch) <= 1), 'all rail intervals use the fixed column pitch');
            assert.ok(composition.columnCenterErrors.every(error => error <= 1), 'each text column is centered between its rail boundaries');
            assert.ok(composition.railContents.every((content, index) => content === (index === composition.lower - 1 || index === composition.railContents.length - 1 ? 'none' : '\"\"')), 'faint rails only separate adjacent verses inside each stanza');
            assert.ok(composition.boundaryStarts.every(content => content === 'none'), 'stanza outer edges have no enclosing rails');
            assert.ok(Math.max(...composition.verseTextHeights) - Math.min(...composition.verseTextHeights) > composition.verseSize, 'short and long verses retain distinct natural text endings');
            assert.ok(Math.max(...composition.columnHeights) - Math.min(...composition.columnHeights) <= 1, 'rail containers share the longest verse height');
            assert.ok(Math.abs(composition.stageHeight - Math.max(...composition.verseTextHeights)) <= 3, 'stage follows the longest verse instead of a fixed full-height frame');
            assert.ok(composition.railEnds.every(rail => rail.top === 16 && rail.bottom === 16 && rail.width === 1), 'fine rails leave breathing space at both ends');
            assert.equal(new Set(composition.verseSizes).size, 1, 'all verse columns use one font size');
            assert.equal(new Set(composition.verseWeights).size, 1, 'all verse columns use one font weight');
            assert.equal(composition.railOpacity, 'rgba(140, 130, 117, 0.12)', 'stanza rails use increased ink opacity');
            assert.ok(Math.abs(composition.signatureGap - 32) <= 1, 'signature keeps a wider gutter after the verse');
            assert.equal(composition.signatureTextGap, 20, 'author and date columns have more breathing room');
            assert.ok(Math.abs(composition.signatureSealGap - 32) <= 1, 'seal has more breathing room below the date');
            assert.equal(composition.signatureSlipGap, 12, 'slip label and petal have breathing room');
            assert.equal(composition.signatureSlipMargin, 12, 'slip label sits farther below the author');
            assert.ok(Math.abs(composition.signatureSealWidth - 60) <= 1, 'seal retains its original size');
            assert.equal(composition.signatureSlipSize, 12, 'slip entrance uses a smaller label');
            assert.ok(composition.authorTopError <= 2 && composition.dateTopError <= 2, 'both signature columns align to the verse top');
            assert.ok(composition.verseTopErrors.every(error => error <= 2), 'upper and lower stanza columns share the same top edge');
            assert.ok(composition.bodyCenterError <= 2, 'complete verse/signature composition is centered');
            assert.ok(composition.firstCharacterTopError <= 2 && composition.authorMatchesVerse, 'smaller author text retains first-character alignment with verse');
            assert.ok(composition.dateSize < composition.authorSize && composition.authorSize < composition.verseSize, 'signature author size stays between date and verse');
            assert.ok(composition.signatureColumnPitch <= composition.normalColumnPitch * 0.75, 'small author/date text uses compact column spacing');
            assert.ok(composition.dateColumnWidth < 30, 'date column does not reserve the seal width');
          } else {
            assert.ok(composition.railContents.every(content => content === 'none'), 'horizontal reading has no vertical rails');
            assert.ok(composition.punctuationDisplays.length > 0 && composition.punctuationDisplays.every(display => display === 'inline'), 'horizontal reading retains modern punctuation');
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
        if (['archive', 'category', 'tag'].includes(name)) {
          assert.ok(await page.locator('.archive-cylinder').count() > 0, `${name}: cylinder viewport is present`);
          assert.ok(await page.locator('.archive-cylinder .timeline-node').count() > 0, `${name}: article nodes are rendered`);
        }
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
    assert.equal(await page.locator('.archive-cylinder .timeline-node').count(), 4);
    assert.equal(await page.locator('.chrono__item').count(), 0, 'legacy archive axis is not rendered');
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(200);
    const cylinderCss = await fs.readFile(path.join(__dirname, '../themes/hexo-theme-songyan/source/css/layouts.css'), 'utf8');
    const cylinderContract = await page.locator('.archive-cylinder').evaluate(viewport => {
      const stage = viewport.querySelector('.timeline-stage');
      const node = stage.querySelector('.timeline-node');
      const computed = getComputedStyle(viewport);
      const params = Array.from(new URLSearchParams());
      return {
        viewportBackground: computed.backgroundColor,
        maskImage: computed.maskImage,
        webkitMaskImage: computed.webkitMaskImage,
        hasMaskDefinition: !!document.getElementById('scroll-edge-mask'),
        nodes: stage.querySelectorAll('.timeline-node').length,
        layers: node ? [...node.children].map(child => child.className) : [],
        articleHref: node?.dataset.href || null,
        articleUrl: JSON.parse(decodeURIComponent(viewport.dataset.archiveNodes))[0].href
      };
    });
    assert.equal(cylinderContract.viewportBackground, 'rgba(0, 0, 0, 0)', 'timeline viewport stays transparent');
    assert.ok(cylinderContract.maskImage.includes('linear-gradient') && cylinderContract.webkitMaskImage.includes('linear-gradient'), 'viewport keeps transparent CSS feather mask');
    assert.ok(cylinderCss.includes('mask: url("#scroll-edge-mask")') && cylinderContract.hasMaskDefinition, '3D stage keeps the SVG edge-mask reference and definition');
    assert.equal(cylinderContract.nodes, 4);
    assert.deepEqual(cylinderContract.layers, ['node-upper', 'node-lower']);
    assert.equal(cylinderContract.articleUrl, '/2026/10/12/qiushi-huaiyuan/');
    assert.equal(await page.locator('.archive-cylinder').evaluate(el => getComputedStyle(el).backgroundImage), 'none', 'timeline imports no paper texture');
    assert.equal(await page.locator('.chrono__vista, .chrono__scrubber, .chrono__frontispiece, .chrono__excerpt').count(), 0, 'three-distance timeline furniture is gone');
    await page.setViewportSize({ width: 390, height: 900 });
    await page.waitForTimeout(200);
    const filterInk = await page.locator('[data-cat-filter="essay"]').evaluate(button => {
      const dot = button.querySelector('.archive-legend__dot');
      return {
        textDecoration: getComputedStyle(button).textDecorationLine,
        idleColor: getComputedStyle(button).color,
        idleDot: getComputedStyle(dot).backgroundColor,
        idleOpacity: getComputedStyle(dot).opacity
      };
    });
    await page.locator('[data-cat-filter="essay"]').click();
    await page.waitForTimeout(250);
    const selectedInk = await page.locator('[data-cat-filter="essay"]').evaluate(button => ({
      textDecoration: getComputedStyle(button).textDecorationLine,
      color: getComputedStyle(button).color,
      dot: getComputedStyle(button.querySelector('.archive-legend__dot')).backgroundColor,
      opacity: getComputedStyle(button.querySelector('.archive-legend__dot')).opacity
    }));
    assert.equal(selectedInk.textDecoration, 'none', 'selected filter has no underline');
    assert.notEqual(selectedInk.color, filterInk.idleColor, 'selected filter text takes its category ink');
    assert.equal(selectedInk.dot, filterInk.idleDot, 'filter ink preserves its category color');
    assert.equal(selectedInk.opacity, '1', 'selected filter dot fills to full ink');
    await page.locator('[data-cat-filter="essay"]').click();
    await page.locator('[data-cat-filter="ci"]').click();
    assert.equal(await page.locator('.archive-cylinder .timeline-node:not(.is-filtered)').count(), 1);
    assert.equal(await page.locator('.archive-cylinder .timeline-node.is-filtered[aria-hidden="true"]').count(), 3, 'filtered cylinder nodes leave the accessibility tree');
    assert.equal(await page.locator('[data-archive-count]').textContent(), '1');
    await page.locator('[data-cat-filter="ci"]').click();
    assert.equal(await page.locator('.archive-cylinder .timeline-node:not(.is-filtered)').count(), 4);
    assert.equal(await page.locator('.archive-list__item:not(.is-dimmed)').count(), 4, 'list panel mirrors the filter');
    await page.locator('[data-cat-filter="project"]').click();
    assert.equal(await page.locator('[data-archive-count]').textContent(), '0');
    assert.ok(await page.locator('[data-archive-empty]').isVisible());
    assert.equal(await page.locator('.archive-cylinder').evaluate(el => getComputedStyle(el).display), 'none', 'empty result hides the cylinder');
    assert.ok(await page.locator('[data-archive-list]').isHidden(), 'empty result hides both panels');
    await page.locator('[data-cat-filter="project"]').click();
    assert.equal(await page.locator('[data-archive-count]').textContent(), '4');
    assert.ok(await page.locator('[data-archive-empty]').isHidden());
    assert.equal(await page.locator('.archive-view, button[data-archive-view]').count(), 0, 'archive has no manual view switch');
    assert.ok(await page.locator('[data-archive-list]').isVisible(), 'portrait windows show the vertical list');
    assert.equal(await page.locator('.archive-cylinder').evaluate(el => getComputedStyle(el).display), 'none', 'portrait windows hide the cylinder');
    await page.setViewportSize({ width: 900, height: 600 });
    await page.waitForTimeout(250);
    assert.ok(await page.locator('.archive-cylinder').isVisible(), 'landscape windows switch back to the cylinder viewport');
    assert.ok(await page.locator('[data-archive-list]').isHidden());
    console.log('PASS archive data binding, fade filter and ratio-driven view'); checks++;
    const cylinderSource = await fs.readFile(path.join(__dirname, '../themes/hexo-theme-songyan/source/js/main.js'), 'utf8');
    for (const expression of [
      'metrics.radiusX * Math.sin(theta)',
      '-metrics.radiusZ * (1 - Math.cos(theta))',
      'metrics.perspective / (metrics.perspective - z)',
      '-theta * 11.2 || 0',
      'theta * 25.0',
      'Math.exp(-(u * u) / 0.34)',
      'dragDistance > 4',
      'window.location.assign(item.href)'
    ]) assert.ok(cylinderSource.includes(expression), `cylinder physics/input contract remains: ${expression}`);
    assert.ok(cylinderSource.includes('targetScrollPos = clampScroll(Math.round(targetScrollPos)); }, 150'), 'wheel settles after 150ms');
    await page.setViewportSize({ width: 1280, height: 900 });
    const stage = page.locator('.archive-cylinder .timeline-stage');
    await stage.locator('.timeline-node').nth(1).click();
    await page.waitForFunction(() => Number(document.querySelector('.archive-cylinder').dataset.activeIndex) === 1);
    assert.equal(await stage.locator('.timeline-node').nth(1).getAttribute('data-centered'), 'true', 'clicking a non-centered node glides it to the center');
    const targetUrl = await stage.locator('.timeline-node').nth(1).evaluate(node => JSON.parse(decodeURIComponent(document.querySelector('.archive-cylinder').dataset.archiveNodes))[1].href);
    await stage.locator('.timeline-node').nth(1).click();
    await page.waitForURL(url => url.pathname === targetUrl);
    assert.equal(new URL(page.url()).pathname, targetUrl, 'clicking the centered node navigates to its Hexo article URL');
    console.log('PASS archive cylinder data, masks, node layers, projection constants, Lerp centering and article navigation'); checks++;
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
        snapType: getComputedStyle(document.documentElement).scrollSnapType,
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
    assert.equal(coverProbe.snapType, 'y', 'cover keeps proximity snap anchored at the dock point');
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
        const fontSize = parseFloat(getComputedStyle(title).fontSize);
        return {
          timeline: shrink && shrink.timeline.constructor.name,
          progress: shrink && shrink.effect.getComputedTiming().progress,
          opacity: Number(getComputedStyle(title).opacity),
          sourceOpacity: Number(getComputedStyle(document.querySelector('.home-epigraph__source')).opacity),
          headerPaddingTop: parseFloat(getComputedStyle(document.querySelector('.site-header__inner')).paddingTop),
          headerLift: parseFloat(getComputedStyle(document.querySelector('.site-header__inner')).top),
          headerTitleSize: getComputedStyle(document.querySelector('.site-header__title')).fontSize,
          sealWidth: document.querySelector('.site-header__seal-gen').getBoundingClientRect().width,
          scale: fontSize / natural,
          epigraphLift: parseFloat(getComputedStyle(epigraph).top),
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
    assert.ok(coverMotion.start.epigraphLift > coverMotion.end.epigraphLift, 'title group moves upward through layout position');
    assert.ok(Math.abs(coverMotion.end.fontSize - 28) < 0.1, 'docked title retains a strong 28px hierarchy');
    assert.ok(Math.abs(coverMotion.restored.scale - 1) < 0.02, 'scrolling back restores the same title');
    assert.equal(coverMotion.start.headerPaddingTop, coverMotion.end.headerPaddingTop, 'header padding remains fixed');
    assert.equal(coverMotion.start.headerTitleSize, coverMotion.end.headerTitleSize, 'header title never scales');
    assert.equal(coverMotion.start.sealWidth, 36, 'navbar seal stays large enough to read');
    assert.equal(coverMotion.start.sealWidth, coverMotion.end.sealWidth, 'seal never scales');
    assert.ok(coverMotion.start.headerLift > coverMotion.end.headerLift, 'header compacts through layout position');
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
        recentGap: recentRect.top - countRect.bottom,
        mastCenter: (mast.getBoundingClientRect().top + mast.getBoundingClientRect().bottom) / 2,
        viewportCenter: innerHeight / 2,
        railZ: Number(getComputedStyle(document.querySelector('.timeline-stage')).zIndex),
        axisZ: Number(getComputedStyle(document.querySelector('.rail-svg')).zIndex),
        recentCount: recent ? recent.querySelectorAll('.archive-recent__item').length : 0,
        recentOpacity: recent ? Number(getComputedStyle(recent).opacity) : 0,
        recentTitleAnimation: recent ? getComputedStyle(recent.querySelector('.archive-recent__link')).animationName : 'none',
        recentDateAnimation: recent ? getComputedStyle(recent.querySelector('.archive-recent__date')).animationName : 'none',
        snapType: getComputedStyle(document.documentElement).scrollSnapType,
        toolbarSnap: getComputedStyle(document.querySelector('.archive-toolbar')).scrollSnapAlign,
        toolbarSnapStop: getComputedStyle(document.querySelector('.archive-toolbar')).scrollSnapStop,
        activeNav: [...document.querySelectorAll('.site-header__nav-link--active')].map(el => el.textContent.trim())
      };
    });
    assert.equal(archiveIntro.headPos, 'sticky');
    assert.equal(archiveIntro.headerPos, 'sticky');
    assert.ok(archiveIntro.titleAnim.includes('archive-title-dock'), 'archive title compactifies while the mast docks');
    assert.ok(archiveIntro.mastAnim.includes('archive-mast-dock'), JSON.stringify(archiveIntro));
    assert.ok(archiveIntro.legendAfterIntro, 'category legend sits with the timeline focus area under the title');
    assert.ok(archiveIntro.titleCenter > 140 && archiveIntro.titleCenter < 440, 'archive title sits above the viewport center');
    assert.ok(archiveIntro.mastCenter < archiveIntro.viewportCenter - 20, 'archive mast balances above the page center');
    assert.ok(archiveIntro.countBelowTitle, 'count sits directly under the title');
    assert.ok(archiveIntro.recentBelowCount && archiveIntro.recentGap >= 32, 'recent list sits comfortably below the count');
    assert.ok(archiveIntro.railZ > archiveIntro.axisZ, 'ink dots on the rail stack above the axis line');
    assert.ok(archiveIntro.recentCount >= 1 && archiveIntro.recentCount <= 3, JSON.stringify(archiveIntro));
    assert.ok(archiveIntro.recentOpacity > 0.8, 'recent posts are visible on the archive intro');
    assert.equal(archiveIntro.snapType, 'y', JSON.stringify(archiveIntro));
    assert.equal(archiveIntro.toolbarSnap, 'start');
    assert.equal(archiveIntro.toolbarSnapStop, 'always');
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
      const chrono = document.querySelector('.archive-cylinder').getBoundingClientRect();
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
        titleTop: title.getBoundingClientRect().top,
        titleBottom: title.getBoundingClientRect().bottom,
        titleSize: parseFloat(getComputedStyle(title).fontSize),
        recentOpacity: recent ? Number(getComputedStyle(recent).opacity) : 0,
        recentVisibility: recent ? getComputedStyle(recent).visibility : 'hidden',
        recentTitleAnimation: recent ? getComputedStyle(recent.querySelector('.archive-recent__link')).animationName : 'none',
        recentDateAnimation: recent ? getComputedStyle(recent.querySelector('.archive-recent__date')).animationName : 'none',
        recentRowTransform: recent ? getComputedStyle(recent.querySelector('.archive-recent__item')).transform : 'none',
        viewport: innerHeight,
        chronoTopToken: getComputedStyle(document.documentElement).getPropertyValue('--chrono-top').trim(),
        legendTimelineGap: chrono.top - legend.bottom,
        overlap: legend.bottom > chrono.top + 1
      };
    });
    assert.ok(archiveDocked.headerTop >= -1 && archiveDocked.headerTop <= 1, JSON.stringify(archiveDocked));
    assert.ok(archiveDocked.titleTop >= archiveDocked.headerBottom - 2 && archiveDocked.titleBottom <= archiveDocked.legendTop + 2, 'archive title docks below the pinned header without overlapping the legend');
    assert.ok(archiveDocked.legendTop >= archiveDocked.headBottom - 2, 'legend sits under the docked title');
    assert.ok(archiveDocked.chronoTop >= archiveDocked.legendBottom - 2, 'timeline follows the legend without overlap');
    assert.ok(parseFloat(archiveDocked.chronoTopToken) >= 6.5, 'docked timeline reserves clear space above the upper rail');
    assert.ok(archiveDocked.legendTimelineGap >= 12, `compact filter controls retain a safe gap above the timeline: ${JSON.stringify(archiveDocked)}`);
    assert.equal(archiveDocked.overlap, false, 'legend and timeline do not overlap');
    assert.ok(archiveDocked.countOpacity < 0.05, 'count fades as the title docks');
    assert.ok(archiveDocked.recentOpacity < 0.05, 'recent posts hide after scrolling into the timeline');
    assert.equal(archiveDocked.recentVisibility, 'hidden');
    assert.equal(archiveDocked.recentTitleAnimation, 'archive-recent-left');
    assert.equal(archiveDocked.recentDateAnimation, 'archive-recent-right');
    assert.equal(archiveDocked.recentRowTransform, 'none', 'recent rows stay in place while title and date separate');
    assert.ok(Math.abs(archiveDocked.titleSize - 28) < 1, 'archive title compactifies');
    assert.ok(archiveDocked.chronoBottom <= archiveDocked.viewport + 2, `timeline fits under header+title in one screen: ${JSON.stringify(archiveDocked)}`);
    assert.ok(parseFloat(archiveDocked.chronoTopToken) >= 6.5, 'docked archive reserves space above the upper rail');

    // 归档恢复统一页脚，时间轴与页脚之间不留整屏离场空白。
    const archiveEnd = await desktopPage.evaluate(async () => {
      const exit = document.querySelector('.archive-exit-space');
      scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' });
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return {
        chronoBottom: document.querySelector('.archive-cylinder').getBoundingClientRect().bottom,
        chronoTop: document.querySelector('.archive-cylinder').getBoundingClientRect().top,
        mainTop: document.querySelector('main').getBoundingClientRect().top,
        mainBottom: document.querySelector('main').getBoundingClientRect().bottom,
        mainPadding: parseFloat(getComputedStyle(document.querySelector('main')).paddingBottom),
        headerTop: document.querySelector('.site-header').getBoundingClientRect().top,
        footerCount: document.querySelectorAll('.site-footer').length,
        footerBottom: document.querySelector('.site-footer').getBoundingClientRect().bottom,
        footerLinks: document.querySelectorAll('.site-footer a').length,
        viewport: innerHeight,
        exitDisplay: exit ? getComputedStyle(exit).display : 'none',
        exitHeight: exit ? exit.getBoundingClientRect().height : 0
      };
    });
    assert.equal(archiveEnd.footerCount, 1, 'archive restores the shared footer');
    assert.equal(archiveEnd.footerLinks, 0, 'archive footer has no page entrances');
    assert.ok(archiveEnd.footerBottom <= archiveEnd.viewport + 2, 'archive footer is reachable at the page end');
    assert.equal(archiveEnd.exitDisplay, 'none', 'archive exit runway is removed');
    assert.ok(archiveEnd.exitHeight < 1, 'no full-screen blank after timeline');
    assert.ok(archiveEnd.chronoBottom <= archiveEnd.mainBottom + 1 && archiveEnd.chronoTop >= archiveEnd.mainTop - 1, 'cylinder remains contained in the archive main region');
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
    assert.ok(!String(await desktopPage.locator('.reading-mast .post-title').evaluate(el => getComputedStyle(el).animationName)).includes('title-dock'), 'reading title keeps its page-title scale while the mast docks');
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
      const firstLine = document.querySelector('.post-ci__body--vertical > .post-ci__verses > p');
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
        snapType: getComputedStyle(document.documentElement).scrollSnapType,
        bodySnap: getComputedStyle(document.querySelector('.reading-body-anchor')).scrollSnapAlign,
        bodySnapStop: getComputedStyle(document.querySelector('.reading-body-anchor')).scrollSnapStop
      };
    });
    assert.ok(Math.abs(readingCiDocked.mastTop - readingCiDocked.headerBottom) <= 2, 'ci title docks under header');
    assert.ok(readingCiDocked.bodyTop >= readingCiDocked.mastTop + 40, 'ci body sits under docked mast');
    assert.ok(Math.abs(readingCiDocked.titleSize - 40) < 0.1, 'ci title keeps the page-title scale when docked');
    assert.ok(readingCiDocked.metaOpacity < 0.05, 'ci meta fades when docked');
    assert.equal(readingCiDocked.metaVisibility, 'hidden');
    assert.ok(readingCiDocked.lineOpacity < 0.05 || readingCiDocked.lineTransform !== 'none', 'ci columns wait off-screen before wheel reveal');
    assert.ok(readingCiDocked.dateOpacity < 0.05, 'signature date waits hidden with the body animation');
    assert.equal(readingCiDocked.hasVerticalSignature, true, 'ci signature follows vertical columns');
    assert.equal(readingCiDocked.endingSignature, false, 'ci does not duplicate horizontal ending signature');
    assert.equal(readingCiDocked.annotations, false, 'ci annotations are off by default');
    assert.equal(readingCiDocked.snapType, 'none', 'column lock yields native snap while reading');
    assert.equal(readingCiDocked.bodySnap, 'start');
    assert.equal(readingCiDocked.bodySnapStop, 'always', 'reading dock holds at the body start');

    // 定点后锁页：滚轮逐列淡入，落款字后再末拍盖章
    const readingCiColumns = await desktopPage.evaluate(async () => {
      const lines = [...document.querySelectorAll('.post-ci__body--vertical > .post-ci__verses > p')];
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
      const firstLine = document.querySelector('.post-ci__body--vertical > .post-ci__verses > p').getBoundingClientRect();
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
    assert.ok(Math.abs(readingEssayDocked.titleSize - 40) < 0.1, 'essay title keeps the page-title scale when docked');
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
    assert.ok(Math.abs(aboutDocked.titleSize - 40) < 0.1, 'about title keeps the page-title scale when docked');
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
        snapType: getComputedStyle(document.documentElement).scrollSnapType,
        sheetStop: getComputedStyle(document.querySelector('.home-sheet')).scrollSnapStop,
        footerBottomVisible: footer.bottom <= innerHeight + 2,
        scrollY
      };
    });
    assert.equal(homeFooter.snapType, 'y', 'home keeps proximity snap while still reaching the footer');
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
    const archiveViewport = desktopPage.locator('.archive-cylinder');
    await archiveViewport.scrollIntoViewIfNeeded();
    const centerButton = archiveViewport.locator('.timeline-node').nth(1);
    await centerButton.click();
    await desktopPage.waitForTimeout(450);
    assert.equal(await centerButton.getAttribute('data-centered'), 'true', 'non-centered article closes the cylinder seam');
    const centeredTitleStyle = await centerButton.locator('.node-title').evaluate(el => ({
      writingMode: getComputedStyle(el).writingMode,
      transform: getComputedStyle(el).transform
    }));
    assert.equal(centeredTitleStyle.writingMode, 'vertical-rl', 'cylinder lower title remains upright vertical text');
    assert.equal(centeredTitleStyle.transform, 'none', 'center article title is upright at the seam');
    assert.equal(await archiveViewport.locator('.timeline-node').count(), 4, 'archive cylinder renders each Hexo article');
    assert.equal(await desktopPage.locator('.chrono__item').count(), 0, 'legacy hand-built axis is removed');
    const archiveYearRoute = '/archives/2026/';
    await desktopPage.goto(origin + prefix + archiveYearRoute);
    await desktopPage.evaluate(() => document.fonts.ready);
    assert.equal(await desktopPage.locator('.archive-head__title').textContent(), '岁时笺纸 · 历年归档');
    assert.equal(await desktopPage.locator('.archive-cylinder .timeline-node').count(), 4, 'archive-year maps each post to a cylinder node');
    await desktopPage.goto(origin + prefix + '/archives/2026/10/');
    await desktopPage.evaluate(() => document.fonts.ready);
    assert.equal(await desktopPage.locator('.archive-head__title').textContent(), '岁时笺纸 · 历年归档');
    assert.equal(await desktopPage.locator('.archive-cylinder .timeline-node').count(), 4, 'archive-month maps each post to a cylinder node');
    console.log('PASS archive cylinder: Hexo routes, node layer geometry, seam docking and article links'); checks++;
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
          archive: document.body.classList.contains('archive-dock-page'),
            imageReady: image.complete && image.naturalWidth > 0, src: image.getAttribute('src'),
            signatureImages: document.querySelectorAll('.post-signature img[src*="stamp-1794661989454"]').length };
        });
        assert.ok(coverStart.archive
          ? coverStart.center < viewport.height / 2 - 20
          : Math.abs(coverStart.center - viewport.height / 2) < 1,
        `${name}: archive title sits above center while other page titles stay centered: ${JSON.stringify(coverStart)}`);
        assert.ok(coverStart.imageReady && coverStart.src.endsWith('/images/stamp-1794661989454.png'), `${name}: navbar uses the supplied PNG`);
        assert.equal(coverStart.signatureImages, 0, 'navbar image never replaces signature seal');
        await desktopPage.screenshot({ path: path.join(output, `${name}-${viewport.width}-cover-centered.png`) });
        const motion = await desktopPage.evaluate(() => {
          const duration = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dur-dock'));
          const ease = progress => progress ** 3 * (progress * (progress * 6 - 15) + 10);
          return { duration, early: ease(0.25), middle: ease(0.5), late: ease(0.75) };
        });
        assert.ok(motion.duration >= 900, `${name}: cover travel allows an unhurried transition`);
        assert.ok(motion.early < 0.11 && Math.abs(motion.middle - 0.5) < 0.001 && motion.late > 0.89,
          `${name}: cover travel eases in and out without a fast initial lurch`);
        await desktopPage.mouse.move(20, viewport.height / 2);
        await desktopPage.mouse.wheel(0, 30);
        await desktopPage.waitForTimeout(220);
        assert.ok(await desktopPage.evaluate(() => scrollY <= 1), `${name}: subthreshold wheel stays at cover`);
        for (let i = 0; i < 3; i++) await desktopPage.mouse.wheel(0, 30);
        await desktopPage.waitForTimeout(1250);
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
        if (['archive', 'archive-year', 'archive-month', 'category', 'tag'].includes(name)) {
          assert.ok(landed.mast.top <= landed.header.bottom + 2 && landed.mast.bottom <= landed.anchor.top + 2,
            `${name}: archive mast tucks under the header with the legend following`);
        } else {
          assert.ok(Math.abs(landed.mast.top - landed.header.bottom) <= 2, `${name}: mast aligns below header`);
          assert.ok(Math.abs(landed.anchor.top - landed.mast.bottom) <= 2, `${name}: anchor aligns below mast`);
        }
        assert.ok(landed.title.top >= landed.mast.top - 1 && landed.title.bottom <= landed.mast.bottom + 1,
          `${name}: complete title fits at dock: ${JSON.stringify(landed)}`);
        assert.ok(Math.abs(landed.titleSize - (['index', 'archive', 'archive-year', 'archive-month', 'category', 'tag'].includes(name) ? 28 : 40)) < 1, `${name}: dock title keeps its hierarchy above 18px prose and 20px verse`);
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
            if (now - start < 1250) requestAnimationFrame(record);
          }
          requestAnimationFrame(record);
        });
        await desktopPage.mouse.wheel(0, -120);
        await desktopPage.waitForTimeout(1250);
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
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.waitForTimeout(100);
    await desktopPage.keyboard.press('PageDown');
    await desktopPage.waitForTimeout(1250);
    assert.ok(Math.abs(await desktopPage.evaluate(() => scrollY) - heldY) <= 2, 'PageDown completes cover transition');
    await desktopPage.keyboard.press('PageUp');
    await desktopPage.waitForTimeout(1250);
    assert.ok(await desktopPage.evaluate(() => scrollY <= 1), 'PageUp returns to cover');
    await desktopPage.evaluate(() => scrollTo({ top: 500, behavior: 'instant' }));
    await desktopPage.waitForTimeout(1250);
    assert.ok(Math.abs(await desktopPage.evaluate(() => scrollY) - heldY) <= 2, 'manual partial travel settles forward beyond the snap threshold');
    await desktopPage.evaluate(() => scrollTo({ top: 400, behavior: 'instant' }));
    await desktopPage.waitForTimeout(1250);
    assert.ok(await desktopPage.evaluate(() => scrollY <= 1), 'manual reverse travel settles back to cover');
    await desktopPage.goto(origin + prefix + '/2026/10/10/test/#' + encodeURIComponent('图片与图注'));
    await desktopPage.evaluate(() => document.fonts.ready);
    await desktopPage.waitForTimeout(1250);
    assert.ok(await desktopPage.locator('.reading-body h2').last().evaluate(el =>
      el.getBoundingClientRect().top >= document.querySelector('.reading-mast').getBoundingClientRect().bottom),
    'direct body heading hash clears both sticky headers');
    await desktopPage.goto(origin + prefix + '/');
    await desktopPage.keyboard.press('Tab');
    await desktopPage.keyboard.press('Enter');
    await desktopPage.waitForTimeout(1250);
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
    // The cylinder integration contract above exercises projection constants, click-to-dock,
    // centered article navigation, archive filters, and the Hexo-generated node URLs.
    const timelineContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const timelinePage = await timelineContext.newPage();
    const timelineErrors = [];
    timelinePage.on('pageerror', error => timelineErrors.push(error.message));
    await timelinePage.goto(origin + prefix + '/archives/');
    await timelinePage.evaluate(() => document.fonts.ready);
    await timelinePage.waitForTimeout(250);
    const cylinderStage = timelinePage.locator('.archive-cylinder .timeline-stage');
    const cylinderNodes = cylinderStage.locator('.timeline-node');
    assert.equal(await cylinderNodes.count(), 4);
    assert.deepEqual(await cylinderNodes.first().evaluate(node => [...node.children].map(child => child.className)), ['node-upper', 'node-lower']);
    const yearRailContract = await timelinePage.locator('.archive-cylinder').evaluate(viewport => {
      const samples = selector => [...viewport.querySelector(selector).getAttribute('d').matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(match => [+match[1], +match[2]]);
      const upper = samples('.rail-path--upper');
      const years = samples('.rail-year');
      const posts = JSON.parse(decodeURIComponent(viewport.dataset.archiveNodes));
      return {
        expectedYears: [...new Set(posts.map(post => post.year))],
        years: [...viewport.querySelectorAll('.year-node')].map(label => label.firstChild.textContent),
        parallel: years.every((point, index) => point[0] === upper[index][0] && Math.abs(upper[index][1] - point[1] - 48) < 0.11),
        centered: viewport.querySelector('.year-node.is-centered')?.style.transform,
        dots: [...viewport.querySelectorAll('.timeline-node')].every(node => node.querySelectorAll('.ink-dot').length === 1 && node.querySelector('.ink-dot').parentElement.matches('.node-lower') && node.querySelector('.ink-dot').nextElementSibling.matches('.node-title') && !node.querySelector('.dock-joint')),
        upperYears: [...viewport.querySelectorAll('.node-date')].filter(date => /[年月]/u.test(date.textContent)).length,
        month: viewport.querySelector('.year-month')?.textContent,
        yearStyle: (() => { const style = getComputedStyle(viewport.querySelector('.year-node.is-centered')); return { size: parseFloat(style.fontSize), weight: style.fontWeight, color: style.color, background: style.backgroundColor, shadow: style.boxShadow, paper: getComputedStyle(document.body).backgroundColor }; })(),
        maxTitle: parseFloat(getComputedStyle(viewport).getPropertyValue('--max-title-h')),
        titleStyles: [...viewport.querySelectorAll('.node-title')].map(title => {
          const style = getComputedStyle(title);
          return { orientation: style.textOrientation, align: style.textAlign, overflow: style.overflow, width: title.offsetWidth, height: title.offsetHeight, maxHeight: parseFloat(style.maxHeight), cols: [...title.children].map(col => ({text: col.textContent, top: col.offsetTop, left: col.offsetLeft, height: col.scrollHeight, whiteSpace: getComputedStyle(col).whiteSpace})) };
        })
      };
    });
    assert.deepEqual(yearRailContract.years, yearRailContract.expectedYears, 'year rail lists ordered distinct post years');
    assert.ok(yearRailContract.parallel, 'year rail stays exactly 48px above the upper curve');
    assert.ok(yearRailContract.centered.endsWith('rotate(0deg)'), 'center year is horizontal');
    assert.ok(yearRailContract.dots, 'each title owns its only category dot, replacing the red joint');
    assert.equal(yearRailContract.upperYears, 0, 'upper dates contain day and optional solar term only');
    assert.equal(yearRailContract.month, '十月', 'the active month sits below the center year');
    assert.equal(yearRailContract.yearStyle.weight, '600');
    assert.equal(yearRailContract.yearStyle.color, 'rgb(36, 33, 28)');
    assert.equal(yearRailContract.yearStyle.background, yearRailContract.yearStyle.paper, 'year text masks its rail with the existing paper color');
    assert.notEqual(yearRailContract.yearStyle.shadow, 'none', 'paper clearance extends past the year text');
    assert.ok(yearRailContract.yearStyle.size >= 23.2 && yearRailContract.yearStyle.size <= 29.61);
    assert.ok(yearRailContract.maxTitle >= 220 && yearRailContract.maxTitle <= 240, 'waist reserves 220–240px for titles');
    for (const style of yearRailContract.titleStyles) {
      assert.equal(style.orientation, 'mixed');
      assert.equal(style.align, 'start');
      assert.equal(style.overflow, 'hidden');
      assert.ok(style.width <= 64 && style.height <= style.maxHeight + 1, 'titles stay within the two-column budget');
      assert.ok(style.cols.length >= 1 && style.cols.length <= 2, 'JS emits at most two explicit columns');
      for (const col of style.cols) {
        assert.equal(col.whiteSpace, 'nowrap', 'CSS never splits a word across columns');
        assert.equal(col.top, 0, 'all columns align at their top edge');
        assert.ok(col.height <= style.maxHeight, 'each measured column fits its height budget');
      }
      if (style.cols.length === 2) assert.ok(style.cols[0].left > style.cols[1].left, 'columns run from right to left');
    }
    await timelinePage.locator('[data-cat-filter="essay"]').click();
    await timelinePage.waitForTimeout(900);
    await timelinePage.locator('.archive-cylinder').evaluate(async viewport => {
      for (let frame = 0; frame < 12; frame++) {
        viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, cancelable: true, bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 16));
      }
    });
    await timelinePage.waitForTimeout(900);
    assert.equal(await timelinePage.locator('.timeline-node.is-centered').getAttribute('data-cat'), 'essay', 'filtered wheel remains on a visible article at the trailing edge');
    assert.equal(await timelinePage.locator('.archive-cylinder').getAttribute('data-active-index'), '1', 'filtered timeline clamps to its own final article');
    await timelinePage.locator('[data-cat-filter="essay"]').click();
    await timelinePage.waitForTimeout(900);
    await timelinePage.locator('.archive-cylinder').evaluate(async viewport => {
      for (let frame = 0; frame < 12; frame++) {
        viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: 600, cancelable: true, bubbles: true }));
        await new Promise(resolve => setTimeout(resolve, 16));
      }
    });
    await timelinePage.waitForTimeout(900);
    assert.equal(await timelinePage.locator('.archive-cylinder').getAttribute('data-active-index'), '1', 'continuous wheel inertia advances at most one article before snapping');
    const stationaryYearTransform = await timelinePage.locator('.year-node.is-centered').getAttribute('style');
    const viewportMetrics = await timelinePage.locator('.archive-cylinder').evaluate(el => ({
      bg: getComputedStyle(el).backgroundColor,
      mask: getComputedStyle(el).maskImage,
      maskWebkit: getComputedStyle(el).webkitMaskImage,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1
    }));
    assert.equal(viewportMetrics.bg, 'rgba(0, 0, 0, 0)');
    assert.ok(viewportMetrics.mask.includes('linear-gradient') && viewportMetrics.maskWebkit.includes('linear-gradient'));
    assert.equal(viewportMetrics.pageOverflow, false);
    const initialTitle = await cylinderNodes.nth(0).locator('.node-title').textContent();
    await cylinderNodes.nth(2).click();
    await cylinderNodes.nth(2).waitFor({ state: 'visible' });
    await timelinePage.waitForFunction(() => document.querySelectorAll('.timeline-node')[2]?.dataset.centered === 'true', null, { timeout: 5000 });
    assert.equal(await cylinderNodes.nth(2).getAttribute('data-centered'), 'true', 'clicking another node Lerp-docks it at center');
    assert.equal(await timelinePage.locator('.year-node.is-centered').getAttribute('style'), stationaryYearTransform, 'moving between articles in one year leaves the year rail stationary');
    const centeredHref = await cylinderNodes.nth(2).evaluate((node, title) => {
      const data = JSON.parse(decodeURIComponent(document.querySelector('.archive-cylinder').dataset.archiveNodes));
      return data.find(item => item.title === title).href;
    }, await cylinderNodes.nth(2).locator('.node-title').textContent());
    await cylinderNodes.nth(2).click();
    await timelinePage.waitForURL(url => url.pathname === centeredHref);
    assert.equal(new URL(timelinePage.url()).pathname, centeredHref, 'clicking centered article follows Hexo url_for path');
    assert.notEqual(initialTitle, '', 'archive article title is mapped into the node');
    assert.deepEqual(timelineErrors, [], 'cylinder archive has no runtime or ResizeObserver errors');
    await timelineContext.close();
    console.log('PASS archive cylinder runtime: transparent viewport, DOM layers, Lerp docking and Hexo article navigation'); checks++;
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
