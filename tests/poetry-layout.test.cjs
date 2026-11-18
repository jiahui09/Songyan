/* Content-length matrix. All fixtures/builds/screenshots live outside the repository. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createServer } = require('node:http');
const Hexo = createRequire(path.resolve(__dirname, '../dev-site/package.json'))('hexo');
const base = path.resolve(__dirname, '../dev-site');
const evidence = path.resolve(process.env.SONGYAN_POETRY_QA_DIR || '/tmp/songyan-poetry-matrix');
const viewports = [390, 768, 900, 1023, 1024, 1280, 1440];
const fixtures = [
  { id: 'wuyan-jueju', title: '静夜思', kind: '五言绝句', lines: ['床前明月光，', '疑是地上霜。', '举头望明月，', '低头思故乡。'] },
  { id: 'qiyan-jueju', title: '山行', kind: '七言绝句', lines: ['远上寒山石径斜，', '白云生处有人家。', '停车坐爱枫林晚，', '霜叶红于二月花。'] },
  { id: 'wuyan-lvshi', title: '春望', kind: '五言律诗', lines: ['国破山河在，', '城春草木深。', '感时花溅泪，', '恨别鸟惊心。', '烽火连三月，', '家书抵万金。', '白头搔更短，', '浑欲不胜簪。'] },
  { id: 'long-ci', title: '摸鱼儿·更能消几番风雨', kind: '长词', split: 6, lines: [
    '更能消、几番风雨，匆匆春又归去。', '惜春长怕花开早，何况落红无数。', '春且住。',
    '见说道、天涯芳草无归路。', '怨春不语。', '算只有殷勤，画檐蛛网，尽日惹飞絮。',
    '长门事，准拟佳期又误。', '蛾眉曾有人妒。', '千金纵买相如赋，脉脉此情谁诉？', '君莫舞。',
    '君不见、玉环飞燕皆尘土！', '闲愁最苦。', '休去倚危栏，斜阳正在，烟柳断肠处。'
  ] }
];
const report = { cases: [], errors: [], viewports };

function check(row, condition, message) {
  if (!condition) row.failures.push(message);
}

async function measure(page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-ci-body]');
    const stage = document.querySelector('.post-ci__stage');
    const verses = body.querySelector('.post-ci__verses');
    const lines = [...verses.querySelectorAll(':scope > p')];
    const signature = body.querySelector('.post-signature');
    const rect = node => { const r = node.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height }; };
    const glyphs = node => {
      const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
      const ranges = [];
      while (walker.nextNode()) {
        const text = walker.currentNode;
        if (getComputedStyle(text.parentElement).display === 'none' || !text.textContent.trim()) continue;
        const range = document.createRange(); range.selectNodeContents(text);
        ranges.push(...[...range.getClientRects()].filter(r => r.width && r.height));
      }
      return ranges.length ? { top: Math.min(...ranges.map(r => r.top)), bottom: Math.max(...ranges.map(r => r.bottom)) } : { top: 0, bottom: 0 };
    };
    const paragraphs = lines.map(line => {
      const style = getComputedStyle(line), after = getComputedStyle(line, '::after');
      const first = document.createRange(); first.setStart(line.firstChild, 0); first.setEnd(line.firstChild, 1);
      const r = rect(line), c = first.getBoundingClientRect();
      return { ...r, text: line.textContent, glyphs: glyphs(line), split: line.hasAttribute('data-stanza-start'),
        centerError: Math.abs((c.left + c.right - r.left - r.right) / 2), size: style.fontSize, weight: style.fontWeight,
        before: getComputedStyle(line, '::before').content,
        rail: { content: after.content, top: parseFloat(after.top), bottom: parseFloat(after.bottom), width: parseFloat(after.width) } };
    });
    const author = rect(signature.querySelector('.post-signature__author'));
    const date = rect(signature.querySelector('time'));
    const seal = rect(signature.querySelector('.seal--signature'));
    const slip = signature.querySelector('[data-poem-slip-open]');
    return { body: rect(body), verses: rect(verses), stage: rect(stage), paragraphs, signature: rect(signature), author, date, seal,
      signatureGap: parseFloat(getComputedStyle(signature).gap), slipSize: parseFloat(getComputedStyle(slip).fontSize),
      visibleText: lines.map(p => p.innerText), punctuation: [...body.querySelectorAll('.ci-punctuation')].map(p => getComputedStyle(p).display),
      opacity: getComputedStyle(body).getPropertyValue('--silk-rail').trim(),
      removedUI: document.querySelectorAll('.poem-gloss,.poem-annotations,.poem-punctuation').length,
      pageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
      stageOverflow: stage.scrollWidth > stage.clientWidth + 1, scrollWidth: stage.scrollWidth, clientWidth: stage.clientWidth,
      stageScrollHeight: stage.scrollHeight, stageClientHeight: stage.clientHeight, stageOverflowY: getComputedStyle(stage).overflowY };
  });
}

function verify(fixture, width, metrics, row) {
  const p = metrics.paragraphs;
  check(row, JSON.stringify(p.map(c => c.text)) === JSON.stringify(fixture.lines), 'Original paragraphs/punctuation changed');
  check(row, !metrics.pageOverflow, 'Horizontal overflow escapes onto the page');
  check(row, !metrics.removedUI, 'Removed annotation UI reappears');
  check(row, new Set(p.map(c => c.size)).size === 1 && new Set(p.map(c => c.weight)).size === 1, 'Verse font sizes/weights differ');
  check(row, p.filter(c => c.split).length === (fixture.split ? 1 : 0), 'Unexpected stanza count');
  if (width < 1024 || fixture.layout === 'horizontal') {
    check(row, metrics.punctuation.every(display => display === 'inline'), 'Horizontal punctuation is hidden');
    check(row, p.every(c => c.rail.content === 'none' && c.before === 'none'), 'Horizontal text has vertical rails');
    if (fixture.split) check(row, p[fixture.split].top - p[fixture.split - 1].bottom >= 40, 'Horizontal stanza gap lost');
    return;
  }
  const pitch = p[0].width;
  check(row, p.every(c => Math.abs(c.width - pitch) <= 1 && c.centerError <= 2), 'Column pitch/centering inconsistent');
  check(row, p.every(c => Math.abs(c.top - p[0].top) <= 2), 'Verse starts are not aligned');
  for (let i = 0; i < p.length; i++) {
    const end = i === p.length - 1 || i + 1 === fixture.split;
    check(row, p[i].rail.content === (end ? 'none' : '""') && p[i].before === 'none', `Column ${i + 1}: rail outside stanza or missing within stanza`);
    if (!end) check(row, p[i].rail.top === 16 && p[i].rail.bottom === 16 && p[i].rail.width === 1, `Column ${i + 1}: rail endpoint/weight changed`);
    if (i) check(row, Math.abs(p[i - 1].left - p[i].right - (i === fixture.split ? pitch / 2 : 0)) <= 1, `Column ${i + 1}: unexpected spacing`);
    check(row, p[i].glyphs.bottom <= p[i].bottom + 3, `Column ${i + 1}: glyphs clipped`);
  }
  const longest = Math.max(...p.map(c => c.glyphs.bottom - p[0].top));
  check(row, Math.abs(metrics.verses.height - longest) <= 4, `Verses/rails controlled by metadata instead of longest verse (${metrics.verses.height.toFixed(1)} vs ${longest.toFixed(1)}px)`);
  check(row, p.every(c => Math.abs(c.height - p[0].height) <= 1), 'Rail endpoints are not uniform');
  check(row, metrics.punctuation.every(display => display === 'none'), 'Desktop punctuation visible');
  check(row, metrics.opacity === 'rgba(140, 130, 117, 0.12)', 'Ink opacity changed');
  check(row, Math.abs(p.at(-1).left - metrics.signature.right - 32) <= 1, 'Signature gutter lost');
  check(row, metrics.signatureGap === 20 && metrics.slipSize === 12, 'Signature spacing/type changed');
  check(row, Math.abs(metrics.author.top - p[0].top) <= 2 && Math.abs(metrics.date.top - p[0].top) <= 2, 'Signature top alignment lost');
  check(row, Math.abs(metrics.seal.width - 60) <= 1 && Math.abs(metrics.seal.top - metrics.date.bottom - 32) <= 1, 'Seal size/spacing changed');
  check(row, metrics.stageScrollHeight <= metrics.stageClientHeight + 1, 'Signature/seal needs nested vertical scrolling inside verse stage');
  check(row, metrics.seal.bottom <= metrics.stage.bottom + 1, 'Seal extends below the visible verse stage');
  row.whitespace = { verseHeight: longest, bodyHeight: metrics.body.height, blankBelowShortest: metrics.verses.height - Math.min(...p.map(c => c.glyphs.bottom - c.top)) };
}

(async () => {
  assert.ok(process.env.PLAYWRIGHT_PACKAGE, 'Set PLAYWRIGHT_PACKAGE to an installed playwright/package.json; no dependencies are installed by this test.');
  const { chromium } = createRequire(process.env.PLAYWRIGHT_PACKAGE)('playwright');
  const baseline = await fs.readFile(path.join(base, 'source/_posts/qiushi-huaiyuan.md'), 'utf8');
  const [, frontmatter, content] = baseline.split('---');
  fixtures.unshift({ id: 'baseline', title: '秋夜怀远', kind: '基准词作', split: Number(frontmatter.match(/stanza_break:\s*(\d+)/)[1]), lines: content.trim().split(/\n\s*\n/).map(p => p.trim()) });
  fixtures.push(
    { ...fixtures[1], id: 'author-horizontal', kind: '作者指定横排', layout: 'horizontal' },
    { ...fixtures[1], id: 'author-vertical', kind: '作者指定竖排', layout: 'vertical' },
    { ...fixtures[4], id: 'long-ci-horizontal', kind: '长词指定横排', layout: 'horizontal' }
  );
  const temp = await fs.mkdtemp('/tmp/songyan-poetry-fixtures-');
  const source = path.join(temp, 'source'), publicDir = path.join(temp, 'public');
  await fs.mkdir(path.join(source, '_posts'), { recursive: true });
  await fs.mkdir(evidence, { recursive: true });
  for (const fixture of fixtures) {
    const metadata = `---\ntitle: ${fixture.title}\ndate: 2026-10-12 21:30:00\ntype: ci\npermalink: poetry/${fixture.id}/\n${fixture.split ? `stanza_break: ${fixture.split}\n` : ''}${fixture.layout ? `poetry_layout: ${fixture.layout}\n` : ''}---\n`;
    await fs.writeFile(path.join(source, '_posts', `${fixture.id}.html`), metadata + fixture.lines.map(line => `<p>${line}</p>`).join('\n'));
  }
  const config = path.join(temp, 'override.json');
  await fs.writeFile(config, JSON.stringify({ source_dir: source, public_dir: publicDir }));
  const hexo = new Hexo(base, { config: [path.join(base, '_config.yml'), config].join(','), output: temp, silent: true });
  try { await hexo.init(); await hexo.call('generate', {}); } finally { await hexo.exit(); }
  const horizontalConfig = path.join(temp, 'horizontal-default.json');
  const horizontalPublic = path.join(temp, 'horizontal-public');
  await fs.writeFile(horizontalConfig, JSON.stringify({ source_dir: source, public_dir: horizontalPublic, theme_config: { ci: { vertical_desktop: false } } }));
  const horizontalHexo = new Hexo(base, { config: [path.join(base, '_config.yml'), horizontalConfig].join(','), output: path.join(temp, 'horizontal-build'), silent: true });
  try {
    await horizontalHexo.init(); await horizontalHexo.call('generate', {});
    for (const fixture of fixtures) {
      const html = await fs.readFile(path.join(horizontalPublic, 'poetry', fixture.id, 'index.html'), 'utf8');
      assert.equal(html.includes(' data-ci-columns'), fixture.layout === 'vertical', `${fixture.id}: per-post mode must override theme default`);
      assert.ok(!html.includes('data-ci-layout-controls'), 'No client layout switch is rendered');
    }
    console.log('PASS Front Matter precedence: explicit vertical overrides horizontal theme default; omitted/horizontal stay horizontal');
  } finally { await horizontalHexo.exit(); }
  const server = createServer(async (req, res) => {
    try {
      let name = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
      if (name.endsWith('/')) name += 'index.html';
      const file = path.resolve(publicDir, '.' + name);
      assert.ok(file.startsWith(publicDir + path.sep));
      const data = await fs.readFile(file);
      res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' })[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    } catch { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    for (const fixture of fixtures) for (const width of viewports) {
      const row = { id: fixture.id, kind: fixture.kind, width, failures: [] };
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
      page.on('pageerror', error => row.failures.push(error.message));
      try {
        assert.equal((await page.goto(`${origin}/poetry/${fixture.id}/`)).status(), 200);
        await page.evaluate(() => document.fonts.ready);
        row.metrics = await measure(page);
        check(row, await page.locator('[data-ci-layout-controls],[data-ci-layout]').count() === 0, 'Unexpected reader layout controls');
        check(row, await page.locator('[data-ci-columns]').count() === (fixture.layout === 'horizontal' ? 0 : 1), 'Front Matter mode was not rendered at build time');
        verify(fixture, width, row.metrics, row);
        await page.locator('.post-ci__stage').screenshot({ path: path.join(evidence, `${fixture.id}-${width}-body.png`) });
        if (row.metrics.stageOverflow) {
          const ends = await page.locator('.post-ci__stage').evaluate(stage => {
            stage.scrollLeft = 0; const a = stage.scrollLeft;
            stage.scrollLeft = -stage.scrollWidth; const b = stage.scrollLeft;
            stage.scrollLeft = stage.scrollWidth; const c = stage.scrollLeft;
            const frame = stage.getBoundingClientRect();
            const first = stage.querySelector('.post-ci__verses > p');
            const seal = stage.querySelector('.seal--signature');
            const visible = node => { const r = node.getBoundingClientRect(); return r.left >= frame.left - 1 && r.right <= frame.right + 1; };
            const firstReachable = visible(first), sealAtLast = visible(seal);
            stage.scrollLeft = 0; const firstAtStart = visible(first), sealAtStart = visible(seal);
            stage.scrollLeft = -stage.scrollWidth; const firstAtNegative = visible(first), sealAtNegative = visible(seal);
            return { travel: Math.max(a, b, c) - Math.min(a, b, c), required: stage.scrollWidth - stage.clientWidth,
              firstReachable: firstReachable || firstAtStart || firstAtNegative, sealReachable: sealAtLast || sealAtStart || sealAtNegative };
          });
          check(row, Math.abs(ends.travel - ends.required) <= 2 && ends.firstReachable && ends.sealReachable, 'Long composition cannot reach both horizontal ends');
          row.scroll = ends;
          await page.locator('.post-ci__stage').screenshot({ path: path.join(evidence, `${fixture.id}-${width}-scrolled.png`) });
        }
        if (width === 1280) {
          await page.emulateMedia({ media: 'print' });
          check(row, await page.locator('.ci-punctuation').evaluateAll(nodes => nodes.every(n => getComputedStyle(n).display === 'inline')), 'Print punctuation lost');
        }
      } catch (error) { row.failures.push(error.message); }
      finally { await page.close(); }
      report.cases.push(row);
      console.log(`${row.failures.length ? 'FAIL' : 'PASS'} ${fixture.kind} ${width}: ${row.failures.join('; ') || 'layout/spacing/content'}`);
    }
    const nojs = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    for (const fixture of fixtures) {
      const page = await nojs.newPage();
      try {
        await page.goto(`${origin}/poetry/${fixture.id}/`);
        assert.equal(await page.locator('.post-ci__verses > p').count(), fixture.lines.length);
        assert.ok(await page.locator('.post-ci__verses > p').first().isVisible());
        assert.equal(await page.locator('[data-ci-layout-controls],[data-ci-layout]').count(), 0);
      } catch (error) { report.errors.push(`${fixture.id} no-JS: ${error.message}`); }
      finally { await page.close(); }
    }
    await nojs.close();
    for (const fixture of fixtures) {
      const row = { id: fixture.id, kind: fixture.kind, width: 1280, mode: 'normal-motion', failures: [] };
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'no-preference' });
      page.on('pageerror', error => row.failures.push(error.message));
      try {
        await page.goto(`${origin}/poetry/${fixture.id}/`);
        await page.evaluate(() => document.fonts.ready);
        if (fixture.layout !== 'horizontal') {
          check(row, await page.locator('.post-ci__stage.is-column-enhanced').count() === 1, 'Column animation must be prepared before leaving cover');
          check(row, await page.locator('.post-ci__verses > p').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === '0')), 'Unrevealed text is visible before cover transition');
          await page.evaluate(() => {
            window.poetryTransitionFlashes = [];
            const start = performance.now();
            function sample() {
              for (const line of document.querySelectorAll('.post-ci__verses > p:not(.is-revealed)')) {
                const r = line.getBoundingClientRect();
                if (r.top < innerHeight && r.bottom > 0 && Number(getComputedStyle(line).opacity) > 0.01) {
                  window.poetryTransitionFlashes.push({ y: scrollY, opacity: getComputedStyle(line).opacity });
                }
              }
              if (performance.now() - start < 850) requestAnimationFrame(sample);
            }
            requestAnimationFrame(sample);
          });
        }
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await page.mouse.move(20, 200);
        await page.mouse.wheel(0, 120);
        await page.waitForTimeout(1250);
        if (fixture.layout !== 'horizontal') {
          row.transitionFlashes = await page.evaluate(() => window.poetryTransitionFlashes);
          check(row, row.transitionFlashes.length === 0, 'Unrevealed poetry flashes during cover-to-body transition');
        }
        const locked = await page.locator('html.ci-columns-locked').count();
        if (fixture.layout === 'horizontal') {
          check(row, !locked, 'Author-selected horizontal layout must never lock column scrolling');
          check(row, await page.locator('.post-ci__verses > p').evaluateAll(nodes => nodes.every(node => getComputedStyle(node).opacity === '1')), 'Horizontal paragraphs must be visible');
          report.cases.push(row);
          console.log(`${row.failures.length ? 'FAIL' : 'PASS'} ${fixture.kind} normal-motion: no column lock or hidden text`);
          continue;
        }
        check(row, !!locked, 'Column reveal did not start at the body anchor');
        for (let i = 0; i < fixture.lines.length + 2; i++) {
          await page.mouse.wheel(0, 80);
          await page.waitForTimeout(350);
          if (i < fixture.lines.length) {
            const firstVisible = await page.locator('.post-ci__verses > p').nth(i).evaluate(line => {
              const range = document.createRange(); range.selectNodeContents(line);
              const text = range.getBoundingClientRect(), frame = line.closest('.post-ci__stage').getBoundingClientRect();
              return text.left >= frame.left - 1 && text.right <= frame.right + 1;
            });
            check(row, firstVisible, `Revealed verse ${i + 1} is outside the locked stage viewport`);
          }
        }
        await page.waitForTimeout(400);
        check(row, !await page.locator('html.ci-columns-locked').count(), 'Column reveal never releases scrolling');
        check(row, await page.locator('.post-signature.is-stamped').count() === 1, 'Final signature/seal reveal missing');
        await page.screenshot({ path: path.join(evidence, `${fixture.id}-1280-motion.png`), fullPage: true });
      } catch (error) { row.failures.push(error.message); }
      finally { await page.close(); }
      report.cases.push(row);
      console.log(`${row.failures.length ? 'FAIL' : 'PASS'} ${fixture.kind} normal-motion: ${row.failures.join('; ') || 'reveal/scroll/signature'}`);
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  const failures = report.cases.filter(row => row.failures.length);
  report.summary = { total: report.cases.length, passed: report.cases.length - failures.length, failed: failures.length, fallbackErrors: report.errors.length };
  report.fixtureDirectory = temp;
  await fs.writeFile(path.join(evidence, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`RESULT: ${JSON.stringify(report.summary)}; evidence: ${evidence}`);
  if (failures.length || report.errors.length) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
