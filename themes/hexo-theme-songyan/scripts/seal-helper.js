'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/**
 * 纯矢量金石印章生成器 (Crisp Vector Seal Generator)
 * 构建期（Node 端）算出纯 SVG 字符串内联输出：
 *  - 印文取自开源小篆字库「开元小篆」（lib/KaiyuanSeal.ttf.gz，SIL OFL 1.1，
 *    授权全文见 lib/KaiyuanSeal-OFL.txt），经内置零依赖 TTF 解析器逐字转为
 *    <path> 轮廓内联进 SVG：网页零字体加载、各端渲染一致；缺字逐字回退
 *    --font-seal 楷体链（<text>）。现代汉字 → 篆书区码位对照表
 *    lib/seal-codepoints.json（源自 Unicode 18.0 SealSources.txt，Unicode License v3）。
 *  - 金石崩刃（边框 Polygon 缺口）、飞白断触（细线断笔）、矿物砂眼（微孔）
 *    全部经 <mask> 黑白剪切实现——纯矢量锐利，无栅格化、无模糊滤镜；
 *  - 随机性走 Mulberry32 PRNG + 种子（theme.seal.seed），重建产物逐字节一致；
 *  - 对外两条入口：
 *      Helper  render_seal(text, style, size, extraClass)  ← 模板内调用
 *      Tag     {% seal 春唇语冬 yang 36 %}                 ← Markdown 正文落款
 *  - 印色/纸色经 CSS 变量（--seal-color / --paper-bg）注入，不在 JS 里硬编码；
 *  - 印文排布按古法直读：右上[0] → 右下[1] → 左上[2] → 左下[3]。
 */

/** 稳定 Mulberry32 PRNG：同一种子 → 同一版刀痕 */
function createPrng(seedVal) {
  let s = (Math.floor(seedVal) || 123456789) >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** FNV-1a：把印文指纹折进随机种子，字不同则刀痕不同 */
function hashString(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * 金石颗粒三件套：
 *  notches —— 边框崩刀折角（蒙版里挖掉的三角缺口）
 *  slashes —— 飞白发丝与刀口断笔
 *  pores   —— 矿物砂眼微孔（0.4~0.85 直径，肉眼可见的锐利小点）
 */
function generateSealGranulation(seed, style, density) {
  const rnd = createPrng(typeof seed === 'number' ? seed : hashString(String(seed)));
  const pores = [];
  const slashes = [];
  const notches = [];

  // 1. 边框崩刀折角：先定一条重灾边（钤盖受力面），其上缺口更密更深；
  //    位置六成聚向两端印角（印角受磕最重），其余均布——崩口成组、聚边聚角
  const sides = ['top', 'bottom', 'left', 'right'];
  const heavySide = sides[Math.floor(rnd() * 4)];
  sides.forEach((side) => {
    const count = 2 + Math.floor(rnd() * 2) + (side === heavySide ? 1 : 0);
    for (let k = 0; k < count; k++) {
      const atCorner = rnd() < 0.6;
      const pos = atCorner ? (rnd() < 0.5 ? 6 + rnd() * 14 : 80 + rnd() * 14) : 22 + rnd() * 56;
      const w = 2.0 + rnd() * 2.8 + (side === heavySide ? 1.1 : 0);
      const depth = 1.8 + rnd() * 2.4 + (side === heavySide ? 1.5 : 0);
      let pts = '';
      if (side === 'top') {
        pts = `${(pos - w / 2).toFixed(1)},4.5 ${(pos + w / 2).toFixed(1)},4.5 ${(pos + (rnd() - 0.5) * w).toFixed(1)},${(4.5 + depth).toFixed(1)}`;
      } else if (side === 'bottom') {
        pts = `${(pos - w / 2).toFixed(1)},95.5 ${(pos + w / 2).toFixed(1)},95.5 ${(pos + (rnd() - 0.5) * w).toFixed(1)},${(95.5 - depth).toFixed(1)}`;
      } else if (side === 'left') {
        pts = `4.5,${(pos - w / 2).toFixed(1)} 4.5,${(pos + w / 2).toFixed(1)} ${(4.5 + depth).toFixed(1)},${(pos + (rnd() - 0.5) * w).toFixed(1)}`;
      } else {
        pts = `95.5,${(pos - w / 2).toFixed(1)} 95.5,${(pos + w / 2).toFixed(1)} ${(95.5 - depth).toFixed(1)},${(pos + (rnd() - 0.5) * w).toFixed(1)}`;
      }
      notches.push(pts);
    }
  });

  // 2. 飞白发丝与刀口细微断笔（阴刻更密，盖印受力更重）；
  //    六成半落在边缘磨损带（磨蚀先及印缘），其余以平方根分布淡入内部
  const slashCount = Math.floor((style === 'yin' ? 12 : 8) * density);
  for (let i = 0; i < slashCount; i++) {
    const band = rnd() < 0.65 ? 26 + rnd() * 19 : Math.sqrt(rnd()) * 24;
    const ang = rnd() * Math.PI * 2;
    const cx = Math.min(92, Math.max(8, 50 + Math.cos(ang) * band * 1.15));
    const cy = Math.min(92, Math.max(8, 50 + Math.sin(ang) * band * 1.15));
    const angle = rnd() * Math.PI;
    const len = 2.5 + rnd() * 4.5;
    const dx = Math.cos(angle) * (len / 2);
    const dy = Math.sin(angle) * (len / 2);
    slashes.push({
      x1: (cx - dx).toFixed(1),
      y1: (cy - dy).toFixed(1),
      x2: (cx + dx).toFixed(1),
      y2: (cy + dy).toFixed(1),
      width: (0.8 + rnd() * 0.6).toFixed(1)
    });
  }

  // 3. 矿物砂眼清晰微孔：半数向印缘聚集（印泥堆积先及边缘）
  const poreCount = Math.floor((style === 'yin' ? 32 : 20) * density);
  for (let i = 0; i < poreCount; i++) {
    const band = rnd() < 0.5 ? 24 + rnd() * 22 : Math.sqrt(rnd()) * 24;
    const ang = rnd() * Math.PI * 2;
    pores.push({
      cx: Math.min(93, Math.max(7, 50 + Math.cos(ang) * band * 1.1)).toFixed(1),
      cy: Math.min(93, Math.max(7, 50 + Math.sin(ang) * band * 1.1)).toFixed(1),
      r: (0.4 + rnd() * 0.45).toFixed(1)
    });
  }

  return { notches, slashes, pores };
}

/** 金石篆刻字形映射：常用简体印文转繁体（印谱以繁体为正） */
const TRAD_MAP = { '春': '春', '唇': '唇', '语': '語', '冬': '冬', '词': '詞', '韵': '韻', '东': '東' };

// KaiyuanSeal 全字集墨面重心（字体坐标系，adv=upem=1000 时实测 16 字偏差 ±5 内）
const SEAL_INK_CX = 592;
const SEAL_INK_CY = 320;

/* ── 构建期篆书字库（零依赖 TTF 解析，随主题分发于 lib/）──────────────
 * 首次落印时才 inflate/解析（懒加载）；enable 关闭时零开销。
 * 字库不可得（文件缺失/损坏）时不报错，全站逐字回退楷体链。
 */
const SEAL_FONT_FILE = path.join(__dirname, '..', 'lib', 'KaiyuanSeal.ttf.gz');
const SEAL_CODEPOINT_FILE = path.join(__dirname, '..', 'lib', 'seal-codepoints.json');

let sealCodepointMap; // undefined=未加载  false=缺席  object=就绪
let sealFont;         // undefined=未加载  false=缺席  object=就绪

function loadSealCodepointMap() {
  if (sealCodepointMap === undefined) {
    try {
      sealCodepointMap = JSON.parse(fs.readFileSync(SEAL_CODEPOINT_FILE, 'utf8'));
    } catch (err) {
      sealCodepointMap = false;
    }
  }
  return sealCodepointMap;
}

/** 解析 TTF 表目录与所需度量：cmap(3,10)/loca/hmtx/head/hhea；失败返回 false */
function loadSealFont() {
  if (sealFont !== undefined) return sealFont;
  try {
    const raw = zlib.gunzipSync(fs.readFileSync(SEAL_FONT_FILE));
    const dv = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const u8 = (o) => dv.getUint8(o);
    const u16 = (o) => dv.getUint16(o);
    const s16 = (o) => dv.getInt16(o);
    const u32 = (o) => dv.getUint32(o);
    const tables = {};
    for (let i = 0, n = u16(4); i < n; i++) {
      const o = 12 + 16 * i;
      tables[String.fromCharCode(raw[o], raw[o + 1], raw[o + 2], raw[o + 3])] = u32(o + 8);
    }
    const upem = u16(tables.head + 18);
    const longLoca = s16(tables.head + 50) === 1;
    const numGlyphs = u16(tables.maxp + 4);
    // cmap：优先 (3,10) format 12 —— 字库全部码位挂在 Unicode 18.0 篆书区
    const cmap = new Map();
    const co = tables.cmap;
    for (let i = 0, n = u16(co + 2); i < n; i++) {
      const o = co + 4 + 8 * i;
      const sub = co + u32(o + 4);
      if (u16(o) === 3 && u16(o + 2) === 10 && u16(sub) === 12) {
        for (let j = 0, ng = u32(sub + 12); j < ng; j++) {
          const r = sub + 16 + 12 * j;
          const s = u32(r);
          for (let c = s, e = u32(r + 4), g = u32(r + 8); c <= e; c++) cmap.set(c, g + (c - s));
        }
      }
    }
    // loca 轮廓索引（长表全量读入）
    const loca = new Uint32Array(numGlyphs + 1);
    for (let i = 0; i <= numGlyphs; i++) loca[i] = longLoca ? u32(tables.loca + 4 * i) : u16(tables.loca + 2 * i) * 2;
    sealFont = { dv, u8, u16, s16, tables, cmap, loca, upem, cache: new Map() };
  } catch (err) {
    sealFont = false;
  }
  return sealFont;
}

/** 简单字形轮廓 → SVG path（y 轴翻转为 SVG 坐标、整数精度；复合字形防御性跳过） */
function simpleGlyphPath(font, glyphOffset, numContours) {
  const { u8, u16, s16 } = font;
  const ends = new Uint16Array(numContours);
  let p = glyphOffset + 10;
  for (let i = 0; i < numContours; i++, p += 2) ends[i] = u16(p);
  const numPoints = ends[numContours - 1] + 1;
  p += 2 + u16(p); // 跳过指令流
  // 标志位（含重复游程编码）
  const flags = new Uint8Array(numPoints);
  for (let i = 0; i < numPoints; i++) {
    const fl = u8(p++);
    flags[i] = fl;
    if (fl & 8) {
      let repeat = u8(p++);
      while (repeat-- > 0 && i + 1 < numPoints) flags[++i] = fl;
    }
  }
  // x / y 短向量还原绝对坐标
  const xs = new Int32Array(numPoints);
  let x = 0;
  for (let i = 0; i < numPoints; i++) {
    const fl = flags[i];
    if (fl & 2) { const d = u8(p++); x += (fl & 16) ? d : -d; }
    else if (!(fl & 16)) { x += s16(p); p += 2; }
    xs[i] = x;
  }
  const ys = new Int32Array(numPoints);
  let y = 0;
  for (let i = 0; i < numPoints; i++) {
    const fl = flags[i];
    if (fl & 4) { const d = u8(p++); y += (fl & 32) ? d : -d; }
    else if (!(fl & 32)) { y += s16(p); p += 2; }
    ys[i] = y;
  }
  // TrueType 二次贝塞尔：离曲线点为控制点，相邻两离点间隐含中点
  const parts = [];
  let idx = 0;
  for (let c = 0; c < numContours; c++) {
    const contour = [];
    for (; idx <= ends[c]; idx++) contour.push({ x: xs[idx], y: ys[idx], on: (flags[idx] & 1) !== 0 });
    let startI = contour.findIndex((q) => q.on);
    let sx, sy;
    if (startI === -1) { // 全离点轮廓：以首两点中点起笔
      if (contour.length < 2) continue;
      sx = (contour[0].x + contour[1].x) / 2;
      sy = (contour[0].y + contour[1].y) / 2;
      startI = 0;
    } else { sx = contour[startI].x; sy = contour[startI].y; }
    const seq = contour.slice(startI).concat(contour.slice(0, startI));
    let d = `M${Math.round(sx)} ${-Math.round(sy)}`;
    let i = 1;
    while (i < seq.length) {
      const q = seq[i];
      if (q.on) { d += `L${q.x} ${-q.y}`; i++; continue; }
      // 末点为离曲线点时环绕到起笔点（必为曲线点）
      const next = seq[i + 1] !== undefined ? seq[i + 1] : seq[0];
      const ex = next.on ? next.x : (q.x + next.x) / 2;
      const ey = next.on ? next.y : (q.y + next.y) / 2;
      d += `Q${q.x} ${-q.y} ${Math.round(ex)} ${-Math.round(ey)}`;
      i += next.on && seq[i + 1] !== undefined ? 2 : 1;
    }
    parts.push(d + 'Z');
  }
  return parts.join('');
}

/** 取单字篆书轮廓（经码位表换算到篆书区）；缺字返回 null */
function sealGlyphForChar(font, ch) {
  const map = loadSealCodepointMap();
  const cp = map ? map[ch] : undefined;
  if (!cp) return null;
  const gid = font.cmap.get(cp);
  if (gid === undefined) return null;
  if (font.cache.has(gid)) return font.cache.get(gid);
  let d = null;
  const start = font.loca[gid];
  const end = font.loca[gid + 1];
  if (end > start) {
    const offset = font.tables.glyf + start;
    const numContours = font.s16(offset);
    // 本字库已验证全部为简单字形；防御性跳过复合字形（走回退链）
    if (numContours >= 0) d = simpleGlyphPath(font, offset, numContours);
  }
  font.cache.set(gid, d);
  return d;
}

/** 印文落位：轮廓按 text-anchor=middle / dominant-baseline=central 的同款几何摆放 */
function glyphPlace(font, ch, em, cx, cy) {
  const d = sealGlyphForChar(font, ch);
  if (d === null) return null;
  const k = em / font.upem;
  // 该字库全字集字形墨面（非字框）重心恒为 (592, 320)（adv/upem=1000，hmtx lsb 不可信），
  // 按墨面居中而非按步进居中：印面四缘留气均等，且与缺字回退 <text> 的居中行为一致
  const x = cx - SEAL_INK_CX * k;
  const y = cy + SEAL_INK_CY * k;
  return `<path d="${d}" transform="translate(${x.toFixed(2)} ${y.toFixed(2)}) scale(${k.toFixed(5)})" />`;
}

/**
 * 核心渲染：生成纯矢量印章 SVG 字符串
 * options: { text, style, size, rotate, density, seed, className }
 * themeConfig: 主题配置（读取 theme.seal 默认值）
 */
function renderSealSvg(options, themeConfig) {
  const cfg = themeConfig.seal || {};
  const text = (options.text || cfg.text || '春唇语冬').trim();
  const style = options.style || cfg.style || 'yang';
  const size = options.size || cfg.size || 34;
  const rotate = options.rotate !== undefined ? options.rotate : (cfg.rotate !== undefined ? cfg.rotate : -1.2);
  const density = options.density || cfg.density || 1.0;
  const className = options.className || '';

  const chars = text.split('').map((c) => TRAD_MAP[c] || c);

  // 印色/纸色一律走 CSS 变量，JS 内不落硬编码色值
  const cinnabar = 'var(--seal-color)';
  const paper = 'var(--paper-bg)';
  const isYin = style === 'yin';

  // 种子 = 印文指纹 + 全局 seed：换字换刀痕，同字同刀痕
  const activeSeed = options.seed !== undefined
    ? options.seed
    : (hashString(`${text}_${style}`) + (cfg.seed || 42));
  const { notches, slashes, pores } = generateSealGranulation(activeSeed, style, density);
  const maskId = 'seal_mk_' + Math.abs(hashString(`${text}_${style}_${activeSeed}`)).toString(36);

  // 蒙版：白透黑挖。缺口/飞白/砂眼皆为纯几何剪切，杜绝滤镜
  const maskDef = `<mask id="${maskId}" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse">`
    + `<rect x="0" y="0" width="100" height="100" fill="#ffffff" />`
    + notches.map((pts) => `<polygon points="${pts}" fill="#000000" />`).join('')
    + slashes.map((s) => `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="#000000" stroke-width="${s.width}" stroke-linecap="round" />`).join('')
    + pores.map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="${p.r}" fill="#000000" />`).join('')
    + `</mask>`;

  // 界格（分制，仅白文）：1 字无格 / 2 字日字格（中竖） / 3 字右二左一（中竖+右横） /
  // 4 字田字格——白文格线为刻出的白线（阴刻故随印文用纸色）；
  // 朱文（阳）不加界格，铁线细朱向来不界
  const gridLine = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${paper}" stroke-width="${w}" />`;
  const gridTian = gridLine(50, 10, 50, 44, 1.6) + gridLine(50, 56, 50, 90, 1.6)
    + gridLine(10, 50, 44, 50, 1.6) + gridLine(56, 50, 90, 50, 1.6);
  const gridRi2 = gridLine(50, 10, 50, 90, 1.6);
  const gridRi3 = gridLine(50, 10, 50, 90, 1.6) + gridLine(54, 50, 90, 50, 1.2);

  // 印文落位（满白分制）：字入字格、按格取满；四字直读 右上[0] 右下[1] 左上[2] 左下[3]
  const font = loadSealFont();
  const slots = chars.length === 0 ? []
    : chars.length >= 4
      ? [[chars[0], 44, 73, 28], [chars[1], 44, 73, 73], [chars[2], 44, 27, 28], [chars[3], 44, 27, 73]]
      : chars.length === 3
        ? [[chars[0], 30, 73, 28], [chars[1], 30, 73, 73], [chars[2], 44, 27, 50]]
        : chars.length === 2
          ? [[chars[0], 44, 73, 50], [chars[1], 44, 27, 50]]
          : [[chars[0], 64, 50, 50]];
  const grid = chars.length >= 4 ? gridTian : chars.length === 3 ? gridRi3 : chars.length === 2 ? gridRi2 : '';

  // 印文：篆书轮廓由构建期字库逐字内联（<path>）；缺字逐字回退楷体链（<text>）
  const textFont = `font-family="var(--font-seal), 'Noto Serif TC', 'Source Han Serif SC', 'Songti SC', serif" font-weight="900" text-anchor="middle" dominant-baseline="central"`;
  const textBlock = `<g fill="${isYin ? paper : cinnabar}">`
    + slots.map(([ch, em, cx, cy]) => {
      const placed = font ? glyphPlace(font, ch, em, cx, cy) : null;
      return placed !== null
        ? placed
        : `<text x="${cx}" y="${cy}" ${textFont} font-size="${em}">${ch}</text>`;
    }).join('')
    + `</g>`;

  // 印面：阴刻（白文）朱砂底反白字 / 阳刻（朱文）铁线边栏红字
  let body = '';
  if (isYin) {
    body = `<path d="M 6.5,12 C 6,7.5 7.5,6 12,5.5 L 48,5.2 L 87.5,5.5 C 92,6 94,8 94.5,12.5 L 94.8,51 L 94.2,87.5 C 93.8,92 91.5,94 87.5,94.5 L 53,94.8 L 12.5,94.2 C 8,93.8 6,91.5 5.5,87.5 L 5.2,49 Z" fill="${cinnabar}" />`
      + textBlock
      + grid;
  } else {
    body = `<rect x="6" y="6" width="88" height="88" rx="2.5" fill="${cinnabar}" fill-opacity="0.04" />`
      + `<path d="M 8.5,13 C 8.5,8.5 10.5,7 14.5,6.8 L 56,6.8 M 62,6.8 L 86,7 C 90,7.5 92.5,9.5 93,13.5 L 93.2,52" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`
      + `<path d="M 93.2,58 L 93,86 C 92.5,90.5 90,92.5 85.5,93 L 42,93.2 M 35,93.2 L 14.5,93 C 10,92.5 8,90 7.5,85.5 L 7.2,48" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`
      + `<path d="M 7.2,41 L 7.5,16 C 7.8,13 8.8,11 11,9.5" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`
      + textBlock;
  }

  // 尺寸走 SVG width/height 属性；微旋包一层 <g transform>（不落内联 style，兼容各浏览器）
  return `<span class="seal seal-gen${className ? ' ' + className : ''}" role="img" aria-label="印章：${text}">`
    + `<svg viewBox="0 0 100 100" width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg" shape-rendering="geometricPrecision" text-rendering="geometricPrecision">`
    + `<defs>${maskDef}</defs>`
    + `<g transform="rotate(${rotate} 50 50)"><g mask="url(#${maskId})">${body}</g></g>`
    + `</svg>`
    + `</span>`;
}

/** 模板 Helper：模板内直接调用 render_seal(text, style, size, extraClass) */
hexo.extend.helper.register('render_seal', function (customText, style, size, extraClass) {
  const theme = this.theme || {};
  // enable 关闭时全站熄印：页头/页脚/卷首统一由本入口短路
  if (theme.seal && theme.seal.enable === false) return '';
  return renderSealSvg({
    text: customText,
    style: style,
    size: size,
    className: extraClass
  }, theme);
});

/** 正文 Tag：{% seal 春唇语冬 yang 36 %} 或 {% seal 词韵 yin %}；省参时回退本页 front-matter */
hexo.extend.tag.register('seal', function (args) {
  const theme = hexo.theme.config || {};
  // enable 关闭时静默不落印（不产出空占位）
  if (theme.seal && theme.seal.enable === false) return '';
  // 文章级独立覆盖：显式参数 > 本页 front-matter（seal: 对象或纯字符串）> 主题默认
  // tag 回调的 this 即 post 数据对象（hexo post.js → tag.render(content, data)），front-matter 直读
  const pageSeal = this && this.seal;
  const fmText = typeof pageSeal === 'string' ? pageSeal : pageSeal && pageSeal.text;
  const fmStyle = pageSeal && typeof pageSeal === 'object' ? pageSeal.style : undefined;
  const fmSize = pageSeal && typeof pageSeal === 'object' ? pageSeal.size : undefined;
  return renderSealSvg({
    text: args[0] || fmText,
    style: args[1] || fmStyle || undefined,
    size: args[2] ? parseInt(args[2], 10) : (fmSize ? parseInt(fmSize, 10) : undefined)
  }, theme);
}, { ends: false });
