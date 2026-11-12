/* PLAYWRIGHT_PACKAGE=/path/to/playwright/package.json node prototype/tests/reading.test.cjs [--baseline] */
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE || __filename)('playwright');
const root = path.resolve(__dirname, '..');
const output = process.env.SONGYAN_QA_DIR || '/tmp/opencode/songyan-refinement';
const baseline = process.argv.includes('--baseline');
const widths = [360, 390, 768, 1280];
const archiveFiles = ['archive.html', 'css/tokens.css', 'css/base.css', 'css/components.css', 'css/layouts.css', 'js/main.js', 'js/seal.js', 'assets/paper-texture.png'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.png': 'image/png', '.svg': 'image/svg+xml' };
async function renderedFonts(context, page, selector) {
  const session = await context.newCDPSession(page);
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root: documentRoot } = await session.send('DOM.getDocument');
    const { nodeId } = await session.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector });
    return (await session.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
  } finally { await session.detach(); }
}

(async () => {
  await fs.mkdir(output, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
      assert.ok(file.startsWith(root + path.sep));
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  let groups = 0;
  const fontAudit = [];
  try {
    const hashes = {};
    for (const file of archiveFiles) hashes[file] = digest(await fs.readFile(path.join(root, file)));
    if (baseline) await fs.writeFile(path.join(output, 'archive-files.json'), JSON.stringify(hashes, null, 2));
    else {
      const before = JSON.parse(await fs.readFile(path.join(output, 'archive-files.json'), 'utf8'));
      if (hashes['css/layouts.css'] !== before['css/layouts.css']) {
        const css = await fs.readFile(path.join(root, 'css/layouts.css'), 'utf8');
        const originalDirection = css.replace(/@keyframes chrono-curve \{[\s\S]*?\n\}/, block => block.replace(/rotateY\((-?44)deg\)/g, (_, degrees) => `rotateY(${-Number(degrees)}deg)`));
        assert.equal(digest(originalDirection), before['css/layouts.css'], 'archive CSS changes are limited to reversing the two curve rotation signs');
        hashes['css/layouts.css'] = before['css/layouts.css'];
      }
      assert.deepEqual(hashes, before, 'all other archive/shared resources remain byte-identical');
    }
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', err => errors.push(err.message));
      await page.goto(`${origin}/archive.html`);
      await page.evaluate(async () => { await document.fonts.ready; await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))); });
      const image = await page.screenshot({ fullPage: true });
      const archiveImage = path.join(output, `archive-before-${width}.png`);
      if (baseline) await fs.writeFile(archiveImage, image);
      else {
        assert.equal(digest(image), digest(await fs.readFile(archiveImage)), `archive screenshot unchanged at ${width}`);
        const archiveType = await page.evaluate(() => {
          const pick = selector => {
            const css = getComputedStyle(document.querySelector(selector));
            return { font: css.fontFamily, size: css.fontSize, weight: css.fontWeight, style: css.fontStyle, leading: css.lineHeight, color: css.color };
          };
          return { title: pick('.archive-head__title'), body: pick('.chrono__entry') };
        });
        assert.equal(archiveType.body.style, 'normal');
        assert.ok(parseFloat(archiveType.body.size) >= 16);
        fontAudit.push({ page: 'archive', width, ...archiveType });
        if (width === 1280) fontAudit[fontAudit.length - 1].renderedTitleFonts = await renderedFonts(context, page, '.archive-head__title');
        console.log(`PASS archive@${width}: only intended curve-sign fix; reduced-motion screenshot and all other resources unchanged`);
        groups++;
      }
      if (!baseline) {
        for (const name of ['index', 'post-essay', 'post-ci', 'page-about', '404']) {
          await page.goto(`${origin}/${name}.html`);
          await page.evaluate(() => document.fonts.ready);
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}@${width}: page overflow`);
          assert.equal(await page.locator('main').count(), 1);
          assert.equal(await page.locator('img:not([alt])').count(), 0);
          const typography = await page.evaluate(() => {
            const title = document.querySelector('main h1, .home-epigraph__text');
            const body = document.querySelector('.reading-body, .post-ci__body-horizontal, .home-stream, .empty-paper');
            const properties = element => {
              const css = getComputedStyle(element);
              return { font: css.fontFamily, size: css.fontSize, weight: css.fontWeight, style: css.fontStyle, leading: css.lineHeight, color: css.color };
            };
            return { title: properties(title), body: properties(body) };
          });
          assert.ok(parseFloat(typography.title.size) >= (name === 'index' ? 16 : 18), `${name}: readable title size`);
          assert.ok(parseFloat(typography.body.size) >= 16, `${name}: readable body size`);
          assert.equal(typography.title.style, 'normal', `${name}: no accidental italic page title`);
          assert.equal(typography.body.style, 'normal', `${name}: no accidental italic body`);
          fontAudit.push({ page: name, width, ...typography });
          if (width === 1280) {
            const fonts = await renderedFonts(context, page, name === 'index' ? '.home-epigraph__text' : 'main h1');
            assert.ok(fonts.some(font => font.glyphCount > 0), `${name}: page-title glyphs actually rendered`);
            fontAudit[fontAudit.length - 1].renderedTitleFonts = fonts;
          }
          if (['post-ci', 'post-essay', 'page-about'].includes(name)) {
            const signature = await page.locator('.post-signature').evaluate(el => {
              const meta = el.querySelector('.post-signature__meta');
              const date = meta.querySelector('time');
              const seal = el.querySelector('.seal--signature');
              const box = node => ({ x: node.getBoundingClientRect().x, right: node.getBoundingClientRect().right, bottom: node.getBoundingClientRect().bottom, width: node.getBoundingClientRect().width });
              return { direction: getComputedStyle(el).flexDirection, alignment: getComputedStyle(el).justifyContent, meta: box(meta), seal: box(seal), main: box(el.closest('main')), dateText: date.textContent, dateFont: getComputedStyle(date).fontFamily, dateSize: getComputedStyle(date).fontSize, dateLeading: getComputedStyle(date).lineHeight };
            });
            assert.equal(signature.direction, 'row');
            assert.ok(['flex-end', 'flow-end'].includes(signature.alignment));
            assert.ok(signature.seal.x >= signature.meta.right, 'seal is placed to the right of signature text');
            assert.ok(Math.abs(signature.seal.bottom - signature.meta.bottom) < 1, 'signature text and seal share bottom alignment');
            assert.equal(signature.dateText, '二〇二六年十月十日');
            assert.equal(signature.dateSize, '14px');
            fontAudit[fontAudit.length - 1].signature = signature;
          }
          if (name === 'post-ci') assert.equal(await page.locator('.rhyme-dot').count(), 0, 'no extraneous rhyme-dot markup');
          const links = await page.locator('a[href]').evaluateAll(nodes => nodes.map(el => el.getAttribute('href')).filter(href => href && !href.startsWith('#') && !/^(https?:|mailto:)/.test(href)));
          for (const href of links) assert.equal((await page.request.get(new URL(href, page.url()).href)).status(), 200, `${name}: ${href}`);
          if (width === 390 || width === 1280) {
            await page.evaluate(async () => {
              document.querySelectorAll('img[loading="lazy"]').forEach(image => { image.loading = 'eager'; });
              await Promise.all(Array.from(document.images).map(image => image.decode().catch(() => {})));
            });
            await page.screenshot({ path: path.join(output, `${name}-${width}.png`), fullPage: true });
          }
          console.log(`PASS ${name}@${width}: no viewport overflow; local links and images have valid structure`);
          groups++;
        }
      }
      assert.deepEqual(errors, [], 'no uncaught browser exceptions');
      await context.close();
    }
    if (baseline) { console.log(`BASELINE: archive hashes and four screenshots saved to ${output}`); return; }
    for (const width of widths) {
      const signatures = fontAudit.filter(row => row.width === width && row.signature).map(row => row.signature);
      assert.ok(signatures.every(row => Math.abs(row.seal.right - signatures[0].seal.right) < 1), `all signature right edges align at ${width}`);
      assert.ok(signatures.every(row => row.dateFont === signatures[0].dateFont && row.dateLeading === signatures[0].dateLeading), 'signature date typography matches');
    }
    await fs.writeFile(path.join(output, 'typography-audit.json'), JSON.stringify(fontAudit, null, 2));
    console.log('PASS full-page font audit: six page types, consistent reading/signature formats, no rhyme-dot markup'); groups++;
    const context = await browser.newContext({ viewport: { width: 390, height: 900 }, reducedMotion: 'reduce', permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('BROWSER:', error.message));
    await page.goto(`${origin}/post-essay.html`);
    assert.equal(await page.locator('.reading-table table').count(), 1);
    assert.equal(await page.locator('.reading-code').count(), 2);
    const toggle = page.locator('[data-reading-toggle]').last();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    await toggle.click();
    await page.locator('[data-reading-copy]').last().click();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(copied.startsWith('// 阅读样张') && !copied.startsWith('1'), 'copy excludes line numbers');
    assert.ok(await page.locator('.reading-line-number').count() > 12);
    assert.equal(await page.locator('.reading-body blockquote p').first().evaluate(el => getComputedStyle(el).textIndent), '0px');
    await page.locator('[data-image-error-sample] summary').click();
    assert.ok(await page.locator('.reading-image-error').isVisible());
    for (const img of await page.locator('main img:not([hidden])').all()) {
      await img.scrollIntoViewIfNeeded();
      await img.evaluate(el => el.decode());
      const size = await img.evaluate(el => ({ w: el.clientWidth, h: el.clientHeight, nw: el.naturalWidth, nh: el.naturalHeight, p: el.parentElement.clientWidth }));
      assert.ok(size.w <= size.p + 1 && size.w <= size.nw + 1, `image does not overflow/upscale: ${JSON.stringify(size)}`);
      assert.ok(Math.abs(size.w / size.h - size.nw / size.nh) < .03, 'image aspect ratio preserved');
    }
    console.log('PASS Markdown/image specimen: numbered code, copy, expand/collapse, tables, nested paragraphs, image ratios and error fallback'); groups++;
    await page.goto(`${origin}/post-ci.html`);
    const opener = page.locator('[data-poem-slip-open]');
    await opener.click();
    const modal = page.getByRole('dialog');
    await modal.waitFor({ state: 'visible' });
    assert.ok(await modal.isVisible());
    assert.equal(await page.locator('[data-poem-slip-cols]').getAttribute('data-overflow'), 'false', 'poem preview fits');
    await page.locator('.poem-slip__cipai').waitFor({ state: 'visible' });
    assert.ok(await page.locator('.poem-slip__line').first().isVisible(), 'poem text is visible, not only the paper shell');
    await page.screenshot({ path: path.join(output, 'poem-preview-390.png') });
    assert.ok(!(await page.locator('[data-poem-slip-cols]').innerText()).includes('sù'));
    const save = page.locator('[data-poem-slip-save]');
    const close = page.locator('[data-poem-slip-close]');
    await close.focus(); await page.keyboard.press('Tab');
    assert.ok(await save.evaluate(el => el === document.activeElement), 'Tab wraps inside modal');
    await save.focus(); await page.keyboard.press('Shift+Tab');
    assert.ok(await close.evaluate(el => el === document.activeElement), 'Shift+Tab wraps inside modal');
    const downloadPromise = page.waitForEvent('download');
    await save.click();
    const download = await downloadPromise;
    await download.saveAs(path.join(output, 'poem-export.png'));
    const png = await fs.readFile(path.join(output, 'poem-export.png'));
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.equal(png.readUInt32BE(16), 720); assert.equal(png.readUInt32BE(20), 1296);
    await page.keyboard.press('Escape');
    assert.ok(await opener.evaluate(el => el === document.activeElement), 'focus returns to opener');
    assert.ok(!(await page.locator('main').evaluate(el => el.inert)), 'background restored after modal closes');
    await page.locator('.poem-annotations summary').click();
    assert.ok(await page.locator('.poem-annotations p').isVisible());
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    console.log('PASS poetry: preview fit, no ruby contamination, focus trapping/return, annotations and 720×1296 PNG download'); groups++;
    await page.evaluate(() => {
      const body = document.querySelector('.post-ci__body-horizontal');
      const line = body.querySelector('.post-ci__line');
      for (let i = 0; i < 24; i++) body.append(line.cloneNode(true));
    });
    await opener.click();
    await page.waitForFunction(() => document.querySelector('[data-poem-slip-cols]').dataset.overflow === 'true');
    let unexpectedDownloads = 0;
    page.on('download', () => unexpectedDownloads++);
    await save.click();
    await page.waitForFunction(() => !document.querySelector('[data-poem-slip-save]').disabled);
    assert.equal(unexpectedDownloads, 0, 'oversized poem must not silently export clipped content');
    assert.ok((await page.locator('[data-poem-slip-status]').textContent()).includes('容量'));
    await page.keyboard.press('Escape');
    console.log('PASS oversized poem: scrollable preview and explicit export-capacity warning, no clipped PNG'); groups++;
    await context.close();
    for (const width of widths) {
      const normal = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: 'no-preference', hasTouch: width < 768 });
      const normalPage = await normal.newPage();
      await normalPage.goto(`${origin}/post-ci.html`);
      if (width < 768) await normalPage.locator('[data-poem-slip-open]').tap();
      else await normalPage.locator('[data-poem-slip-open]').click();
      await normalPage.locator('.poem-slip__cipai').waitFor({ state: 'visible' });
      assert.ok(await normalPage.locator('[data-poem-slip-cols]').evaluate(el => el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1), 'poem preview remains inside paper');
      await normalPage.locator('[data-poem-slip-close]').click();
      assert.ok(await normalPage.locator('[data-poem-slip-open]').evaluate(el => el === document.activeElement));
      await normalPage.goto(`${origin}/archive.html`);
      await normalPage.evaluate(async () => {
        await document.fonts.ready;
        const rail = document.querySelector('[data-chrono-rail]');
        rail.scrollLeft = (rail.scrollWidth - rail.clientWidth) / 2;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      });
      const curve = await normalPage.evaluate(() => {
        const rail = document.querySelector('[data-chrono-rail]').getBoundingClientRect();
        return Array.from(document.querySelectorAll('.chrono__item')).map(item => {
          const rect = item.getBoundingClientRect();
          const matrix = new DOMMatrixReadOnly(getComputedStyle(item).transform);
          return { position: (rect.x + rect.width / 2 - rail.x) / rail.width, angle: Math.atan2(matrix.m31, matrix.m11) * 180 / Math.PI };
        });
      });
      const left = curve.filter(item => item.position > .08 && item.position < .35 && Math.abs(item.angle) > .1);
      const right = curve.filter(item => item.position > .65 && item.position < .92 && Math.abs(item.angle) > .1);
      assert.ok(left.length && right.length, `curve has measurable side columns: ${JSON.stringify(curve)}`);
      assert.ok(left.every(item => item.angle < 0), `left curve slopes inward: ${JSON.stringify(left)}`);
      assert.ok(right.every(item => item.angle > 0), `right curve slopes inward: ${JSON.stringify(right)}`);
      const dateAngle = await normalPage.locator('.chrono__date').first().evaluate(el => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
      });
      assert.ok(Math.abs(dateAngle + 30) < .01, 'intentional -30-degree date treatment remains unchanged');
      await normalPage.screenshot({ path: path.join(output, `archive-direction-${width}.png`), fullPage: true });
      await normal.close();
      console.log(`PASS poetry@${width}: normal motion, ${width < 768 ? 'touch' : 'mouse'} open/close and paper fit`); groups++;
      console.log(`PASS archive@${width}: left/right curve signs corrected; date angle unchanged`); groups++;
    }
    const noJs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 360, height: 900 }, reducedMotion: 'reduce' });
    const staticPage = await noJs.newPage();
    for (const name of ['index', 'post-essay', 'post-ci', 'page-about', '404', 'archive']) {
      await staticPage.goto(`${origin}/${name}.html`);
      assert.ok(await staticPage.locator('main').isVisible());
      assert.ok(await staticPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${name}: no-JS overflow`);
    }
    await noJs.close();
    console.log('PASS all six pages: readable without JavaScript'); groups++;
    console.log(`RESULT: ${groups} groups passed. Evidence: ${output}`);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
