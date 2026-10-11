/**
 * 「松烟」题笺分享 (poem-slip.js)
 * 严格遵从：
 * 1. 原生 JavaScript，无任何框架与 CDN 依赖
 * 2. DOMContentLoaded 后初始化；页面无题笺入口时静默退出
 * 3. 只取词页既有内容（词牌、题注、词句、印面、水印），不复制硬编码文本
 * 4. 句读不落任何黑点：词句间以留白相隔（自然断句）；阕间空出一列留白；
 *    全笺无「过片」与现代标点，四周无框，仅以乌丝栏淡线分列
 * 5. 360×648 竖排走势长笺：词牌题注居右竖写，词句列居中留天地，
 *    款印沉底压角（以印代署名），笺底以「松烟」二字为识
 * 6. 导出为原生 Canvas 2× 高清 PNG，与 .poem-slip 同一套比例系数与颜色令牌
 */

document.addEventListener('DOMContentLoaded', () => {
  initPoemSlip();
});

/**
 * 浮层开关：打开即取词成笺；Esc / 遮罩 / [ 阖卷 ] 皆可关闭
 * 入口为落款旁的 .share-trigger（span），兼容 Enter / Space 键盘触发
 */
function initPoemSlip() {
  const openers = document.querySelectorAll('[data-poem-slip-open]');
  const overlay = document.querySelector('[data-poem-slip]');

  if (!openers.length || !overlay) return;

  const cols = overlay.querySelector('[data-poem-slip-cols]');
  const status = overlay.querySelector('[data-poem-slip-status]');
  const saveBtn = overlay.querySelector('[data-poem-slip-save]');
  const closeBtn = overlay.querySelector('[data-poem-slip-close]');
  let lastFocused = null;

  function open() {
    lastFocused = document.activeElement;
    renderPoemSlip(cols);
    status.textContent = '';
    overlay.classList.add('is-open');
    document.body.classList.add('poem-slip-open');
    requestAnimationFrame(() => closeBtn.focus());
  }

  function close() {
    overlay.classList.remove('is-open');
    document.body.classList.remove('poem-slip-open');
    if (lastFocused && lastFocused.focus) lastFocused.focus();
  }

  Array.prototype.forEach.call(openers, (opener) => {
    opener.addEventListener('click', open);
    opener.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
        event.preventDefault();
        open();
      }
    });
  });
  closeBtn.addEventListener('click', close);

  overlay.addEventListener('click', (event) => {
    if (event.target === overlay) close();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && overlay.classList.contains('is-open')) close();
  });

  saveBtn.addEventListener('click', () => exportPoemSlip(status));
}

/**
 * 取词：词牌 / 题注 / 词句 / 印面 / 水印，皆来自词页既有内容
 * 落款文字不取——笺上以款印代署名，不再重复书写
 */
function collectPoemSlipData() {
  const badge = document.querySelector('.post-ci__cipai-badge');
  const title = document.querySelector('.post-title');
  const sealTexts = document.querySelectorAll('.post-signature .seal--signature text');
  const watermark = document.querySelector('.poem-slip__watermark');
  const lineEls = document.querySelectorAll('.post-ci__body-horizontal .post-ci__line');

  const titleText = title ? title.textContent.trim() : '';
  const sepIndex = titleText.indexOf('·');

  // 上阕 / 下阕之界：沿用词页已标注的 --lower-stanza 起句
  let lowerIndex = -1;
  Array.prototype.forEach.call(lineEls, (el, i) => {
    if (lowerIndex < 0 && el.classList.contains('post-ci__line--lower-stanza')) lowerIndex = i;
  });

  return {
    cipai: badge ? badge.textContent.replace(/^词牌\s*·\s*/, '').trim() : '',
    tizhu: sepIndex > -1 ? titleText.slice(sepIndex + 1).trim() : '',
    lines: Array.prototype.map.call(lineEls, (el) => cleanCiLine(el)),
    lowerIndex: lowerIndex,
    seal: Array.prototype.map.call(sealTexts, (t) => ({
      text: t.textContent,
      x: parseFloat(t.getAttribute('x')) || 50,
      y: parseFloat(t.getAttribute('y')) || 50
    })),
    watermark: watermark ? watermark.textContent.trim() : ''
  };
}

/**
 * 词句清洗：只取汉字文本，现代标点化为分句边界，返回词句数组（如「露下碧梧冷」「风引画檐铃」）
 */
function cleanCiLine(lineEl) {
  const text = lineEl.textContent.replace(/\s+/g, '');
  return text.split(/[，。、；：？！,.;:?!]+/).filter(Boolean);
}

/**
 * 竖排成笺：右起 词牌 → 题注（低一格）→ 词句（阕间空一列，长条上下留天地）
 * → 款印（沉底压角，以印代署名）
 */
function renderPoemSlip(cols) {
  const data = collectPoemSlipData();

  while (cols.firstChild) cols.removeChild(cols.firstChild);

  if (data.cipai) cols.appendChild(slipClauseColumn('poem-slip__cipai', [data.cipai]));
  if (data.tizhu) cols.appendChild(slipClauseColumn('poem-slip__tizhu', [data.tizhu]));

  Array.prototype.forEach.call(data.lines, (clauses, i) => {
    if (!clauses.length) return;
    if (i === data.lowerIndex && i > 0) cols.appendChild(slipBlank());
    cols.appendChild(slipClauseColumn('poem-slip__line', clauses));
  });

  const seal = buildSlipSeal();
  if (!seal) return;

  const sigCol = document.createElement('p');
  sigCol.className = 'poem-slip__sealcol';
  sigCol.appendChild(seal);
  cols.appendChild(sigCol);
}

/**
 * 单列：分句各成一节，节间只留呼吸，不落标点
 */
function slipClauseColumn(className, clauses) {
  const column = document.createElement('p');
  column.className = className;

  clauses.forEach((segment) => {
    if (!segment) return;
    const clause = document.createElement('span');
    clause.className = 'poem-slip__clause';
    clause.textContent = segment;
    column.appendChild(clause);
  });

  return column;
}

/**
 * 阕间空列：与词句列等宽的一片自然留白
 */
function slipBlank() {
  const blank = document.createElement('div');
  blank.className = 'poem-slip__blank';
  blank.setAttribute('aria-hidden', 'true');
  return blank;
}

/**
 * 印：克隆词页既有篆印（朱文双框与印文一并入笺）
 */
function buildSlipSeal() {
  const source = document.querySelector('.post-signature .seal--signature svg');
  if (!source) return null;

  const wrap = document.createElement('span');
  wrap.className = 'poem-slip__seal';
  wrap.setAttribute('aria-hidden', 'true');
  wrap.appendChild(source.cloneNode(true));
  return wrap;
}

/**
 * 导出：原生 Canvas 2× PNG 落盘；未能导出时留字提示
 */
function exportPoemSlip(status) {
  try {
    const data = collectPoemSlipData();
    const canvas = drawPoemSlip(data);

    if (typeof canvas.toBlob !== 'function') throw new Error('canvas.toBlob unavailable');

    canvas.toBlob((blob) => {
      if (!blob) {
        status.textContent = '此笺未能落盘，可长按或右键诗笺留存';
        return;
      }

      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = (data.cipai || '松烟') + '-诗笺.png';

      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setTimeout(() => URL.revokeObjectURL(url), 2000);

      status.textContent = '诗笺已落 · ' + link.download;
    }, 'image/png');
  } catch (err) {
    status.textContent = '此笺未能落盘，可长按或右键诗笺留存';
  }
}

/**
 * 画笺：360×648 竖排走势长笺设计基准 × 2 输出；各列系数与 .poem-slip 的 calc() 一一对应
 * 无框：仅纸色、乌丝栏淡线、天地留白；题居右首，词句列居中均分天地，
 * 阕间空一列，款印沉底压角，句读不落点
 */
function drawPoemSlip(data) {
  const W = 360;
  const H = 648;
  const SCALE = 2;

  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d unavailable');
  ctx.scale(SCALE, SCALE);

  const token = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const titleEl = document.querySelector('.post-title');
  const verseEl = document.querySelector('.post-ci__body-horizontal');
  const fontTitle = titleEl ? getComputedStyle(titleEl).fontFamily : token('--font-title');
  const fontSerif = verseEl ? getComputedStyle(verseEl).fontFamily : token('--font-serif');

  // 1. 笺纸（素笺无框）
  ctx.fillStyle = token('--slip-paper');
  ctx.fillRect(0, 0, W, H);

  // 2. 列位：天地同 inset，列区净高供词句居中
  const inset = W * 0.0778;
  const areaH = H - inset * 2;
  const metric = {
    cipai:   { size: W * 0.062, ls: 0.2,  lh: 1.25, weight: '400', font: fontTitle, color: token('--ink') },
    tizhu:   { size: W * 0.036, ls: 0.12, lh: 1.4,  weight: '400', font: fontTitle, color: token('--ink-light'), top: 0.05 },
    line:    { size: W * 0.041, ls: 0.15, lh: 1.25, weight: '400', font: fontSerif, color: token('--ink'), align: 'center' },
    sealcol: { size: W * 0.0944, align: 'end', padBottom: 0.13 },
    mark:    { size: W * 0.028, ls: 0.14, lh: 1.4,  weight: '400', font: fontTitle, color: token('--slip-watermark') }
  };

  // 3. 列阵：右缘起逐列向左推移；系数合计 .84393 ≈ 内容宽 .844，满铺不留偏侧
  let cursor = W - inset;   // 内容右缘，逐列向左
  const gap = W * 0.01458;
  const ruleXs = [];

  const placeBox = (width, top, draw) => {
    const half = width / 2;
    cursor -= half;
    const cx = cursor;
    ruleXs.push(cx + half + gap / 2);   // 乌丝栏：本列右缘与前一列之间的栏隙正中
    const bottom = draw(cx, top);
    cursor -= half + gap;
    return { cx: cx, bottom: bottom };
  };

  // 竖排文字列：列宽 = 字号×行距；align 'center' 时于列区居中（天头地脚均分）
  const place = (clauses, m) => {
    const top = inset + (m.top || 0) * W +
      (m.align === 'center' ? (areaH - ciTextHeight(clauses, m)) / 2 : 0);
    return placeBox(m.size * m.lh, top, (cx, y) => drawVerticalClauses(ctx, clauses, cx, y, m));
  };

  // 空列（阕间整列）：只推进列位并留栏线，不落一字
  const placeGap = (width) => {
    ruleXs.push(cursor + gap / 2);
    cursor -= width + gap;
  };

  if (data.cipai) place([data.cipai], metric.cipai);
  if (data.tizhu) place([data.tizhu], metric.tizhu);

  Array.prototype.forEach.call(data.lines, (clauses, i) => {
    if (!clauses.length) return;
    if (i === data.lowerIndex && i > 0) placeGap(W * 0.05125);
    place(clauses, metric.line);
  });

  // 款印：以印代署名，沉底压角（.poem-slip__sealcol 之 text-align:end + padding-bottom 0.13W）
  if (data.seal && data.seal.length) {
    const m = metric.sealcol;
    const top = inset + areaH - m.size - m.padBottom * W;
    placeBox(m.size, top, (cx, y) => {
      drawSlipSeal(ctx, data.seal, cx, y, m.size, token);
      return y + m.size;
    });
  }

  // 4. 乌丝栏：自天头至地脚的极淡竖栏线；首列右缘外无栏隙，与 DOM 一致自第二列起落线
  ctx.strokeStyle = token('--slip-rule');
  ctx.lineWidth = 1;
  ctx.beginPath();
  ruleXs.slice(1).forEach((x) => {
    ctx.moveTo(x, inset);
    ctx.lineTo(x, H - inset);
  });
  ctx.stroke();

  // 5. 笺底水印：左下角极小浅灰小字；基线按 DOM 行盒下沉量回算，与 .poem-slip__watermark 同位
  if (data.watermark) {
    const m = metric.mark;
    ctx.font = m.weight + ' ' + m.size + 'px ' + m.font;
    ctx.fillStyle = m.color;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    if ('letterSpacing' in ctx) ctx.letterSpacing = (m.ls * m.size).toFixed(2) + 'px';
    ctx.globalAlpha = 0.3;
    ctx.fillText(data.watermark, inset, H - W * 0.05 - m.size * 0.12);
    ctx.globalAlpha = 1;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  }

  return canvas;
}

/**
 * 预算一列文字高度（与 drawVerticalClauses 同式）：字距推进 × 字数 + 分句留白
 * 供画笺时把词句列于天地之间居中
 */
function ciTextHeight(clauses, metric) {
  const advance = metric.size * (1 + metric.ls);
  let height = 0;
  Array.prototype.forEach.call(clauses, (clause, ci) => {
    height += clause.length * advance;
    if (ci < clauses.length - 1) height += metric.size * 0.35;
  });
  return height;
}

/**
 * 画竖排单列（含分句）：字距沿 y 轴推进；句间只加留白，不落任何符号
 */
function drawVerticalClauses(ctx, clauses, cx, top, metric) {
  ctx.font = metric.weight + ' ' + metric.size + 'px ' + metric.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = metric.color;

  const advance = metric.size * (1 + metric.ls);
  const clauseGap = metric.size * 0.35;   // 与 .poem-slip__clause 的 margin-inline-end 对应
  let y = top + metric.size / 2;

  clauses.forEach((clause, ci) => {
    if (ci > 0) y += clauseGap;
    Array.from(clause).forEach((ch) => {
      ctx.fillText(ch, cx, y);
      y += advance;
    });
  });

  return y - advance + metric.size / 2;   // 末字下缘
}

/**
 * 画印：复刻词页朱文双框与印文，印文取自词页既有 SVG 的坐标与字
 */
function drawSlipSeal(ctx, glyphs, cx, top, size, token) {
  const unit = size / 100;   // 词页印面 viewBox 为 100

  ctx.save();
  ctx.translate(cx - size / 2, top);
  ctx.scale(unit, unit);

  ctx.strokeStyle = token('--seal-color');
  ctx.lineJoin = 'miter';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(6, 6, 88, 88);

  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.6;
  ctx.strokeRect(10, 10, 80, 80);
  ctx.globalAlpha = 1;

  ctx.fillStyle = token('--seal-color');
  ctx.font = 'bold 28px ' + token('--font-seal');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  glyphs.forEach((g) => ctx.fillText(g.text, g.x, g.y));

  ctx.restore();
}
