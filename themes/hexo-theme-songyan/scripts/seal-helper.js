'use strict';

/**
 * 纯矢量金石印章生成器 (Crisp Vector Seal Generator)
 * 构建期（Node 端）算出纯 SVG 字符串内联输出：
 *  - 金石崩刃（边框 Polygon 缺口）、飞白断触（细线断笔）、矿物砂眼（微孔）
 *    全部经 <mask> 黑白剪切实现——纯矢量锐利，无栅格化、无模糊滤镜；
 *  - 随机性走 Mulberry32 PRNG + 种子（theme.seal.seed），重建产物逐字节一致；
 *  - 对外两条入口：
 *      Helper  render_seal(text, style, size, extraClass)  ← 模板内调用
 *      Tag     {% seal 春唇语冬 yang 36 %}                 ← Markdown 正文落款
 *  - 印色/纸色经 CSS 变量（--seal-color / --paper-bg）注入，不在 JS 里硬编码；
 *  - 四字印遵循古法逆时针回文：右上[0] → 右下[1] → 左上[2] → 左下[3]。
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

  // 1. 边框崩刀折角（四边各 2~3 处，位置/宽度/深度皆随机）
  const sides = ['top', 'bottom', 'left', 'right'];
  sides.forEach((side) => {
    const count = 2 + Math.floor(rnd() * 2);
    for (let k = 0; k < count; k++) {
      const pos = 18 + rnd() * 64;
      const w = 2.0 + rnd() * 2.8;
      const depth = 1.8 + rnd() * 2.4;
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

  // 2. 飞白发丝与刀口细微断笔（阴刻更密，盖印受力更重）
  const slashCount = Math.floor((style === 'yin' ? 12 : 8) * density);
  for (let i = 0; i < slashCount; i++) {
    const cx = 12 + rnd() * 76;
    const cy = 12 + rnd() * 76;
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

  // 3. 矿物砂眼清晰微孔
  const poreCount = Math.floor((style === 'yin' ? 32 : 20) * density);
  for (let i = 0; i < poreCount; i++) {
    pores.push({
      cx: (9 + rnd() * 82).toFixed(1),
      cy: (9 + rnd() * 82).toFixed(1),
      r: (0.4 + rnd() * 0.45).toFixed(1)
    });
  }

  return { notches, slashes, pores };
}

/** 金石篆刻字形映射：常用简体印文转繁体（印谱以繁体为正） */
const TRAD_MAP = { '春': '春', '唇': '唇', '语': '語', '冬': '冬', '词': '詞', '韵': '韻' };

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
  const isFour = chars.length >= 4;

  // 四字规制：右上[0] 右下[1] 左上[2] 左下[3]（逆时针回文古法）
  const cTR = isFour ? chars[0] : (chars[0] || '春');
  const cBR = isFour ? chars[1] : (chars[1] || '唇');
  const cTL = isFour ? chars[2] : (chars[2] || '語');
  const cBL = isFour ? chars[3] : (chars[3] || '冬');

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

  // 界格（田字格）：印面分朱布白的十字界线，阳刻虚线、阴刻实线
  const gridYin = `<line x1="50" y1="10" x2="50" y2="44" stroke="${cinnabar}" stroke-width="1.6" />`
    + `<line x1="50" y1="56" x2="50" y2="90" stroke="${cinnabar}" stroke-width="1.6" />`
    + `<line x1="10" y1="50" x2="44" y2="50" stroke="${cinnabar}" stroke-width="1.6" />`
    + `<line x1="56" y1="50" x2="90" y2="50" stroke="${cinnabar}" stroke-width="1.6" />`;
  const gridYang = `<line x1="50" y1="12" x2="50" y2="44" stroke="${cinnabar}" stroke-width="1.4" opacity="0.6" stroke-dasharray="5 2" />`
    + `<line x1="50" y1="56" x2="50" y2="88" stroke="${cinnabar}" stroke-width="1.4" opacity="0.6" stroke-dasharray="5 2" />`
    + `<line x1="12" y1="50" x2="44" y2="50" stroke="${cinnabar}" stroke-width="1.4" opacity="0.6" stroke-dasharray="5 2" />`
    + `<line x1="56" y1="50" x2="88" y2="50" stroke="${cinnabar}" stroke-width="1.4" opacity="0.6" stroke-dasharray="5 2" />`;

  // 印文（金石篆意：粗宋/黑体 fallback 链与主题 --font-seal 一致）
  const textFont = `font-family="var(--font-seal), 'Noto Serif TC', 'Source Han Serif SC', 'Songti SC', serif" font-weight="900" text-anchor="middle" dominant-baseline="central"`;
  const textFour = `<g fill="${isYin ? paper : cinnabar}" ${textFont} font-size="37">`
    + `<text x="73" y="28">${cTR}</text>`
    + `<text x="73" y="73">${cBR}</text>`
    + `<text x="27" y="28">${cTL}</text>`
    + `<text x="27" y="73">${cBL}</text>`
    + `</g>`;
  const textOneLine = `<text x="50" y="52" fill="${isYin ? paper : cinnabar}" ${textFont} font-size="${chars.length === 1 ? '56' : '38'}">${chars.join('')}</text>`;
  const textBlock = isFour ? textFour : textOneLine;

  // 印面：阴刻（白文）朱砂底反白字 / 阳刻（朱文）铁线边栏红字
  let body = '';
  if (isYin) {
    body = `<path d="M 6.5,12 C 6,7.5 7.5,6 12,5.5 L 48,5.2 L 87.5,5.5 C 92,6 94,8 94.5,12.5 L 94.8,51 L 94.2,87.5 C 93.8,92 91.5,94 87.5,94.5 L 53,94.8 L 12.5,94.2 C 8,93.8 6,91.5 5.5,87.5 L 5.2,49 Z" fill="${cinnabar}" />`
      + textBlock
      + gridYin;
  } else {
    body = `<rect x="6" y="6" width="88" height="88" rx="2.5" fill="${cinnabar}" fill-opacity="0.04" />`
      + `<path d="M 8.5,13 C 8.5,8.5 10.5,7 14.5,6.8 L 56,6.8 M 62,6.8 L 86,7 C 90,7.5 92.5,9.5 93,13.5 L 93.2,52" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`
      + `<path d="M 93.2,58 L 93,86 C 92.5,90.5 90,92.5 85.5,93 L 42,93.2 M 35,93.2 L 14.5,93 C 10,92.5 8,90 7.5,85.5 L 7.2,48" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`
      + `<path d="M 7.2,41 L 7.5,16 C 7.8,13 8.8,11 11,9.5" fill="none" stroke="${cinnabar}" stroke-width="5.2" stroke-linecap="round" stroke-linejoin="round" />`
      + textBlock
      + gridYang;
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
