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
 * 金石颗粒三件套 + 印泥漏印斑：
 *  notches —— 边框崩刀折角（蒙版里挖掉的三角缺口）
 *  slashes —— 飞白发丝与刀口断笔
 *  pores   —— 矿物砂眼微孔
 *  blobs   —— 低频大块漏印斑（印泥未及，2~3 处）
 * cells: 印文字格 [{cx,cy,half}]——供「聚笔」加权（印泥不匀先及笔画）
 * detail: 尺寸分档系数（≥96px 全量 / 48~96 ×0.6 / <48 ×0.35），杜绝亚像素噪点
 */
function generateSealGranulation(seed, style, density, cells, detail) {
  const rnd = createPrng(typeof seed === 'number' ? seed : hashString(String(seed)));
  const d = detail === undefined ? 1 : detail;
  const pores = [];
  const slashes = [];
  const notches = [];
  const blobs = [];

  // 聚笔权重：采样点到最近字格中心的距离 → 印泥不匀向笔画聚集（衰减权重）
  const strokeWeight = (x, y) => {
    if (!cells || cells.length === 0) return 0.5;
    let best = Infinity;
    for (let i = 0; i < cells.length; i++) {
      const c = cells[i];
      const dx = x - c.cx;
      const dy = y - c.cy;
      const dist = Math.sqrt(dx * dx + dy * dy) / c.half;
      if (dist < best) best = dist;
    }
    // 字格内最高（1.0），一格开外衰减趋零——聚笔而非撒胡椒面
    return Math.max(0, 1 - best * 0.55);
  };

  // 1. 边框崩刀折角：先定一条重灾边（钤盖受力面），其上缺口更密更深；
  //    位置六成聚向两端印角（印角受磕最重），其余均布——崩口成组、聚边聚角。
  //    小尺寸精简：只保留重灾边与各边最深一刀，避免边栏被啃成锯齿
  const sides = ['top', 'bottom', 'left', 'right'];
  const heavySide = sides[Math.floor(rnd() * 4)];
  sides.forEach((side) => {
    const isHeavy = side === heavySide;
    const count = 2 + Math.floor(rnd() * 2) + (isHeavy ? 1 : 0);
    for (let k = 0; k < count; k++) {
      if (d < 0.5 && !isHeavy && k > 0) continue;
      if (d < 0.5 && isHeavy && k > 1) continue;
      const atCorner = rnd() < 0.6;
      const pos = atCorner ? (rnd() < 0.5 ? 6 + rnd() * 14 : 80 + rnd() * 14) : 22 + rnd() * 56;
      const w = 2.0 + rnd() * 2.8 + (isHeavy ? 1.1 : 0);
      const depth = 1.8 + rnd() * 2.4 + (isHeavy ? 1.5 : 0);
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
  //    六成半落边缘磨损带，其余按「聚笔」权重淡入内部——磨蚀循着笔画走
  const slashCount = Math.floor((style === 'yin' ? 12 : 8) * density * d);
  for (let i = 0; i < slashCount; i++) {
    let cx, cy;
    if (rnd() < 0.65) {
      const band = 26 + rnd() * 19;
      const ang = rnd() * Math.PI * 2;
      cx = 50 + Math.cos(ang) * band * 1.15;
      cy = 50 + Math.sin(ang) * band * 1.15;
    } else {
      // 加权落点：按聚笔权重做 6 次拒绝采样，仍不中则均匀兜底
      let picked = false;
      for (let t = 0; t < 6; t++) {
        const px = 8 + rnd() * 84;
        const py = 8 + rnd() * 84;
        if (rnd() < strokeWeight(px, py)) { cx = px; cy = py; picked = true; break; }
      }
      if (!picked) {
        const band = Math.sqrt(rnd()) * 24;
        const ang = rnd() * Math.PI * 2;
        cx = 50 + Math.cos(ang) * band;
        cy = 50 + Math.sin(ang) * band;
      }
    }
    cx = Math.min(92, Math.max(8, cx));
    cy = Math.min(92, Math.max(8, cy));
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

  // 3. 矿物砂眼微孔：半数向印缘聚集（印泥堆积先及边缘），半数循聚笔权重；
  //    尺寸分档下限抬高——小印只留肉眼可辨的砂眼，杜绝针尖噪点
  const poreMinR = d >= 1 ? 0.4 : d >= 0.6 ? 0.55 : 0.7;
  const poreCount = Math.floor((style === 'yin' ? 32 : 20) * density * d);
  for (let i = 0; i < poreCount; i++) {
    let cx, cy;
    if (rnd() < 0.5) {
      const band = 24 + rnd() * 22;
      const ang = rnd() * Math.PI * 2;
      cx = 50 + Math.cos(ang) * band * 1.1;
      cy = 50 + Math.sin(ang) * band * 1.1;
    } else {
      cx = 7 + rnd() * 86;
      cy = 7 + rnd() * 86;
      if (rnd() > 0.35 + strokeWeight(cx, cy) * 0.65) {
        const band = Math.sqrt(rnd()) * 24;
        const ang = rnd() * Math.PI * 2;
        cx = 50 + Math.cos(ang) * band;
        cy = 50 + Math.sin(ang) * band;
      }
    }
    pores.push({
      cx: Math.min(93, Math.max(7, cx)).toFixed(1),
      cy: Math.min(93, Math.max(7, cy)).toFixed(1),
      r: (poreMinR + rnd() * 0.45).toFixed(1)
    });
  }

  // 4. 低频大块漏印斑：钤盖时印泥未及的留白（1~2 处，聚向重灾边一侧）。
  //    每斑由 3 枚偏心小圆叠成不规则云状——禁规则圆点（一眼假）
  const blobCount = rnd() < 0.55 ? 1 : 2;
  const heavyAngMap = { top: -Math.PI / 2, bottom: Math.PI / 2, left: Math.PI, right: 0 };
  for (let i = 0; i < blobCount; i++) {
    const nearHeavy = rnd() < 0.65;
    const base = nearHeavy ? heavyAngMap[heavySide] : rnd() * Math.PI * 2;
    const ang = base + (rnd() - 0.5) * 1.2;
    const dist = 30 + rnd() * 12;
    const bcx = 50 + Math.cos(ang) * dist;
    const bcy = 50 + Math.sin(ang) * dist;
    const coreR = 1.6 + rnd() * 1.4;
    const lobes = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < lobes; k++) {
      const off = coreR * (0.5 + rnd() * 0.6);
      const a2 = rnd() * Math.PI * 2;
      blobs.push({
        cx: (bcx + Math.cos(a2) * off).toFixed(1),
        cy: (bcy + Math.sin(a2) * off).toFixed(1),
        r: (coreR * (0.55 + rnd() * 0.5)).toFixed(1)
      });
    }
  }

  return { notches, slashes, pores, blobs };
}

/* ── 篆法正字/繁体回填表（缺字时才生效，不改已有字形语义）──────────────
 * lib/seal-alias.json：今字 → 說文正字/繁体对照，1316 条，取自「篆印 Zhuanyin」
 * ALIAS 表（github.com/AKSA0397/zhuanyin，数据源自 shuowen.org 的說文正字，
 * Apache License 2.0），并按「源字不在开元小篆字库 ∧ 替换目标在字库」过滤。
 * 例：语→語、词→詞、韵→韻、东→東、书→書、砚→硯；仅当源字缺字时回填。
 */
const SEAL_ALIAS_FILE = path.join(__dirname, '..', 'lib', 'seal-alias.json');

let sealAliasMap; // undefined=未加载  false=缺席  object=就绪

function loadSealAliasMap() {
  if (sealAliasMap === undefined) {
    try {
      sealAliasMap = JSON.parse(fs.readFileSync(SEAL_ALIAS_FILE, 'utf8'));
    } catch (err) {
      sealAliasMap = false;
    }
  }
  return sealAliasMap;
}

/**
 * 印文单字定字：字库直查 → 缺字时回填正字（且目标须在字库）→ 原样交回退链。
 * aliasEnabled=false 时跳过回填，全站逐字回退与字库直查行为同旧版。
 */
function resolveSealChar(font, ch, aliasEnabled) {
  if (!font || !aliasEnabled) return ch;
  if (sealGlyphForChar(font, ch) !== null) return ch;
  const alias = loadSealAliasMap();
  const target = alias ? alias[ch] : undefined;
  if (target !== undefined && sealGlyphForChar(font, target) !== null) return target;
  return ch;
}

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

/* ── 程序化印缘（全缘微毛糙）：沿周长采样折线 + 种子抖动───────────────
 * 替代固定贝塞尔轮廓：低频整段起伏 + 高频逐点毛刺，同一 activeSeed 同一印缘。
 * gaps: 阳刻边栏断口窗口（周长比例 [start,end)），窗口内不落笔。
 */
function edgeRuns(pts, n, gaps) {
  const inGap = (t) => gaps && gaps.some((g) => t >= g[0] && t < g[1]);
  const runs = [];
  let run = [];
  for (let i = 0; i <= n; i++) {
    if (i < n && inGap(i / n)) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push(pts[i]);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs;
}

function pathOf(pts, close) {
  return pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join('') + (close ? 'Z' : '');
}

/** 方/长方圆角矩形印缘；rect {x0,y0,x1,y1} */
function roughRectEdge(rnd, rect, amp) {
  const { x0, y0, x1, y1 } = rect;
  const w = x1 - x0;
  const h = y1 - y0;
  const per = 2 * (w + h);
  const n = Math.max(60, Math.round(per * 1.2));
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const ii = i % n;
    const s = (ii / n) * per;
    let x, y, nx, ny;
    if (s < w) { x = x0 + s; y = y0; nx = 0; ny = -1; }
    else if (s < w + h) { x = x1; y = y0 + (s - w); nx = 1; ny = 0; }
    else if (s < 2 * w + h) { x = x1 - (s - w - h); y = y1; nx = 0; ny = 1; }
    else { x = x0; y = y1 - (s - 2 * w - h); nx = -1; ny = 0; }
    const j = (rnd() - 0.5) * 2 * amp + Math.sin(ii * 0.9 + 1.3) * amp * 0.55;
    pts.push([x + nx * j, y + ny * j]);
  }
  return pts;
}

/** 圆印印缘 */
function roughCircleEdge(rnd, cx, cy, r, amp) {
  const n = 96;
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const ii = i % n;
    const a = (ii / n) * Math.PI * 2;
    const j = (rnd() - 0.5) * 2 * amp + Math.sin(ii * 1.1 + 0.7) * amp * 0.5;
    pts.push([cx + Math.cos(a) * (r + j), cy + Math.sin(a) * (r + j)]);
  }
  return pts;
}

/** 阳刻断口窗口：1~3 处，落在四边中段附近（随机漂移）——断口贵少而精，忌碎 */
function borderGaps(rnd) {
  const gaps = [];
  const centers = [0.125, 0.375, 0.625, 0.875];
  for (let i = 0; i < centers.length; i++) {
    if (rnd() < 0.45) continue;
    const c = centers[i] + (rnd() - 0.5) * 0.04;
    const half = 0.005 + rnd() * 0.008;
    gaps.push([Math.max(0.01, c - half), Math.min(0.99, c + half)]);
  }
  return gaps;
}

/* ── 形制注册表（P1-C）：square 默认方印 / round 圆印 / oblong 长方闲章 ──
 * 每个形制提供：edge（印缘几何）、centerline（阳刻边栏中心线矩形/圆）、
 * slots（分制落位表）、grid（白文界格）。
 */
const SEAL_SHAPES = {
  square: {
    face: { x0: 5.6, y0: 5.2, x1: 94.8, y1: 94.5 },
    centerline: { x0: 7.4, y0: 7.4, x1: 92.6, y1: 92.6 },
    edge: (rnd, amp) => roughRectEdge(rnd, { x0: 5.6, y0: 5.2, x1: 94.8, y1: 94.5 }, amp),
    slots(n, chars, order) {
      // 直读(zhi)：右上[0]→右下[1]→左上[2]→左下[3]；回文(hui)：右上→左上→左下→右下
      const pos = order === 'hui'
        ? [[73, 28], [27, 28], [27, 73], [73, 73]]
        : [[73, 28], [73, 73], [27, 28], [27, 73]];
      if (n >= 4) return chars.slice(0, 4).map((ch, i) => [ch, 44, pos[i][0], pos[i][1]]);
      if (n === 3) return [[chars[0], 30, 73, 28], [chars[1], 30, 73, 73], [chars[2], 44, 27, 50]];
      if (n === 2) return [[chars[0], 44, 73, 50], [chars[1], 44, 27, 50]];
      return n === 1 ? [[chars[0], 64, 50, 50]] : [];
    },
    grid(n, paper) {
      const gl = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${paper}" stroke-width="${w}" />`;
      if (n >= 4) return gl(50, 10, 50, 44, 1.6) + gl(50, 56, 50, 90, 1.6) + gl(10, 50, 44, 50, 1.6) + gl(56, 50, 90, 50, 1.6);
      if (n === 3) return gl(50, 10, 50, 90, 1.6) + gl(54, 50, 90, 50, 1.2);
      if (n === 2) return gl(50, 10, 50, 90, 1.6);
      return '';
    }
  },
  round: {
    face: { cx: 50, cy: 50, r: 44.5 },
    centerline: { cx: 50, cy: 50, r: 42.4 },
    edge: (rnd, amp) => roughCircleEdge(rnd, 50, 50, 44.5, amp),
    slots(n, chars, order) {
      const pos = order === 'hui'
        ? [[66, 34], [34, 34], [34, 66], [66, 66]]
        : [[66, 34], [66, 66], [34, 34], [34, 66]];
      if (n >= 4) return chars.slice(0, 4).map((ch, i) => [ch, 30, pos[i][0], pos[i][1]]);
      if (n === 3) return [[chars[0], 26, 66, 34], [chars[1], 26, 66, 66], [chars[2], 32, 32, 50]];
      if (n === 2) return [[chars[0], 34, 50, 32], [chars[1], 34, 50, 68]];
      return n === 1 ? [[chars[0], 52, 50, 50]] : [];
    },
    grid(n, paper) {
      const gl = (x1, y1, x2, y2, w) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${paper}" stroke-width="${w}" />`;
      if (n >= 4) return gl(50, 14, 50, 44, 1.5) + gl(50, 56, 50, 86, 1.5) + gl(14, 50, 44, 50, 1.5) + gl(56, 50, 86, 50, 1.5);
      if (n === 3) return gl(48, 16, 48, 84, 1.5) + gl(66, 50, 86, 50, 1.1);
      if (n === 2) return gl(14, 50, 86, 50, 1.5);
      return '';
    }
  },
  oblong: {
    face: { x0: 5.6, y0: 24, x1: 94.4, y1: 76 },
    centerline: { x0: 7.4, y0: 31.4, x1: 92.6, y1: 68.6 },
    edge: (rnd, amp) => roughRectEdge(rnd, { x0: 5.6, y0: 24, x1: 94.4, y1: 76 }, amp),
    slots(n, chars) {
      // 长方闲章：横列平铺，等分落位
      const count = Math.min(n, 4);
      const em = count === 1 ? 40 : count === 2 ? 36 : count === 3 ? 28 : 22;
      const step = 84 / count;
      return chars.slice(0, 4).map((ch, i) => [ch, em, 50 + 42 - step * (i + 0.5), 50]);
    },
    grid(n, paper) {
      const count = Math.min(n, 4);
      if (count < 2) return '';
      const step = 84 / count;
      let s = '';
      for (let i = 1; i < count; i++) {
        const x = (50 + 42 - step * i).toFixed(1);
        s += `<line x1="${x}" y1="30" x2="${x}" y2="70" stroke="${paper}" stroke-width="1.4" />`;
      }
      return s;
    }
  }
};

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
  const shapeName = SEAL_SHAPES[options.shape || cfg.shape] ? (options.shape || cfg.shape) : 'square';
  const shape = SEAL_SHAPES[shapeName];
  const order = cfg.order === 'hui' ? 'hui' : 'zhi';
  const inkTier = cfg.ink === 'zhubiao' || cfg.ink === 'shenha' ? cfg.ink : 'cinnabar';

  const font = loadSealFont();
  const aliasEnabled = cfg.alias !== false;
  const chars = text.split('').map((c) => resolveSealChar(font, c, aliasEnabled));

  // 印色/纸色一律走 CSS 变量，JS 内不落硬编码色值。
  // 色阶：朱磦/深红经 .seal-ink-* 覆盖类切换（P1-D），类挂在 <span> 上
  const cinnabar = 'var(--seal-color)';
  const paper = 'var(--paper-bg)';
  const isYin = style === 'yin';
  const isMixed = style === 'mixed';
  const inkClass = inkTier === 'cinnabar' ? '' : ` seal-ink-${inkTier}`;

  // 尺寸分档（P0-C）：≥96 全量细节 / 48~96 六成 / <48 三成半；杜绝亚像素噪点
  const detail = size >= 96 ? 1 : size >= 48 ? 0.6 : 0.35;
  // 特征尺寸像素钳制：viewBox 100 映射到 size px，一切特征 ≥ 0.8px
  const minUnit = (0.8 * 100) / size;

  // 种子 = 印文指纹 + 全局 seed + 形制：换字换刀痕，同字同刀痕
  const activeSeed = options.seed !== undefined
    ? options.seed
    : (hashString(`${text}_${style}_${shapeName}`) + (cfg.seed || 42));
  const maskId = 'seal_mk_' + Math.abs(hashString(`${text}_${style}_${shapeName}_${activeSeed}`)).toString(36);

  // 界格与落位（先于颗粒：字格供聚笔加权）；白文/朱白相间均界格，纯朱文不界
  const slots = shape.slots(chars.length, chars, order);
  const grid = style === 'yang' ? '' : shape.grid(chars.length, paper);
  const cells = slots.map(([, em, cx, cy]) => ({ cx, cy, half: em / 2 }));

  const { notches, slashes, pores, blobs } = generateSealGranulation(activeSeed, isYin ? 'yin' : 'yang', density, cells, detail);

  // 像素钳制：半径/线宽不足 minUnit 者抬到下限（崩口深度天然 ≥ 1.8，不受钳）
  const clampPx = (v) => Math.max(v, minUnit);
  const maskDef = `<mask id="${maskId}" x="0" y="0" width="100" height="100" maskUnits="userSpaceOnUse">`
    + `<rect x="0" y="0" width="100" height="100" fill="#ffffff" />`
    + notches.map((pts) => `<polygon points="${pts}" fill="#000000" />`).join('')
    + blobs.map((b) => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="#000000" />`).join('')
    + slashes.map((s) => `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="#000000" stroke-width="${clampPx(Number(s.width)).toFixed(1)}" stroke-linecap="round" />`).join('')
    + pores.map((p) => `<circle cx="${p.cx}" cy="${p.cy}" r="${clampPx(Number(p.r)).toFixed(1)}" fill="#000000" />`).join('')
    + `</mask>`;

  // 印缘：程序化全缘毛糙（P0-B），种子确定性；阳刻边栏取中心线折线 + 断口窗口
  const edgePts = shape.edge(createPrng(activeSeed ^ 0x5eed), 1.1);
  const faceD = pathOf(edgePts.slice(0, -1), true);

  // 印文：篆书轮廓由构建期字库逐字内联（<path>）；缺字逐字回退楷体链（<text>）。
  // 阴刻白文并笔（P0-B）：字面加同色描边（约字面 4%），交叉处粘连成满白气象
  const textFont = `font-family="var(--font-seal), 'Noto Serif TC', 'Source Han Serif SC', 'Songti SC', serif" font-weight="900" text-anchor="middle" dominant-baseline="central"`;
  const mergeStroke = (em) => isYin ? ` stroke="${paper}" stroke-width="${(em * 0.04).toFixed(2)}" stroke-linejoin="round"` : '';
  const cellFill = (slotIdx) => {
    if (!isMixed) return isYin ? paper : cinnabar;
    // 朱白相间（P1-B）：2 字上下相间，4 字对角相间——[0][3] 朱、[1][2] 白
    const zhu = chars.length >= 4 ? (slotIdx === 0 || slotIdx === 3) : slotIdx === 0;
    return zhu ? cinnabar : paper;
  };
  const textBlock = slots.map(([ch, em, cx, cy], i) => {
    const fill = cellFill(i);
    const placed = font ? glyphPlace(font, ch, em, cx, cy) : null;
    return placed !== null
      ? `<g fill="${fill}"${mergeStroke(em)}>${placed}</g>`
      : `<text x="${cx}" y="${cy}" ${textFont} font-size="${em}" fill="${fill}"${mergeStroke(em)}>${ch}</text>`;
  }).join('');

  // 印面：阴刻朱砂底反白字 / 阳刻铁线边栏红字 / 朱白相间（白文地 + 朱文字相间）
  let body = '';
  const yangBorder = () => {
    // 边栏中心线：印缘向内缩 ~1.8 的程序化折线，保持 2~4 处断口结构
    const borderSeed = activeSeed ^ 0xba1d;
    const gaps = borderGaps(createPrng(borderSeed));
    const inner = shape.centerline.r !== undefined
      ? roughCircleEdge(createPrng(borderSeed ^ 0x11), shape.centerline.cx, shape.centerline.cy, shape.centerline.r, 0.9)
      : roughRectEdge(createPrng(borderSeed ^ 0x11), shape.centerline, 0.9);
    return edgeRuns(inner, inner.length - 1, gaps)
      .map((run) => `<path d="${pathOf(run, false)}" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`)
      .join('');
  };
  if (isMixed) {
    // 朱白相间（P1-B）：先铺满朱砂地，再为每个「朱文格」挖纸色格（逐格分制）。
    // 象限/竖条矩形经 clipPath 收进印缘，圆印/长方印不溢轮廓；长方按竖条列切，
    // 字不跨纸/红交界（跨界则笔画断色）
    const clipId = maskId + '_c';
    let zhuCells;
    if (shapeName === 'oblong') {
      const count = Math.min(slots.length, 4);
      const step = 84 / count;
      zhuCells = slots.map(([, , cx], i) => ({ i, cx }))
        .filter((s) => (slots.length >= 4 ? (s.i === 0 || s.i === 3) : s.i === 0))
        .map((s) => `<rect x="${(s.cx - step / 2).toFixed(1)}" y="3" width="${step.toFixed(1)}" height="94" fill="${paper}" />`)
        .join('');
    } else {
      zhuCells = slots.map(([, , cx, cy], i) => ({ i, cx, cy }))
        .filter((s) => (slots.length >= 4 ? (s.i === 0 || s.i === 3) : s.i === 0))
        .map((s) => `<rect x="${s.cx > 50 ? 50 : 3}" y="${s.cy > 50 ? 50 : 3}" width="47" height="47" fill="${paper}" />`)
        .join('');
    }
    body = `<path d="${faceD}" fill="${cinnabar}" />`
      + `<defs><clipPath id="${clipId}"><path d="${faceD}" /></clipPath></defs>`
      + `<g clip-path="url(#${clipId})">${zhuCells}</g>`
      + textBlock
      + grid;
  } else if (isYin) {
    body = `<path d="${faceD}" fill="${cinnabar}" />`
      + textBlock
      + grid;
  } else {
    body = `<rect x="6" y="6" width="88" height="88" rx="2.5" fill="${cinnabar}" fill-opacity="0.04" />`
      + yangBorder()
      + textBlock;
  }

  // 尺寸走 SVG width/height 属性；微旋包一层 <g transform>（不落内联 style，兼容各浏览器）
  return `<span class="seal seal-gen${inkClass}${className ? ' ' + className : ''}" role="img" aria-label="印章：${text}">`
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
