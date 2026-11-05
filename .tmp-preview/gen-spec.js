/**
 * 规格表样张：1/2/3/4 字 × 阴阳 生成对照页（验收用草稿，不入库）
 * 用法：NODE_PATH=../dev-site/node_modules node gen-spec.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const themeDir = path.resolve(__dirname, '../themes/hexo-theme-songyan');
const cfg = yaml.load(fs.readFileSync(path.join(themeDir, '_config.yml'), 'utf8'));
const variant = (key, val) => { const c2 = JSON.parse(JSON.stringify(cfg)); c2.seal[key] = val; return c2; };
const cfgHui = variant('order', 'hui');
const cfgZhu = variant('ink', 'zhubiao');
const cfgShen = variant('ink', 'shenha');
const src = fs.readFileSync(path.join(themeDir, 'scripts/seal-helper.js'), 'utf8');
const hexoStub = { extend: { helper: { register() {} }, tag: { register() {} } } };
const renderSealSvg = new Function('hexo', 'require', '__dirname', src + '\n;return renderSealSvg;')(hexoStub, require, path.join(themeDir, 'scripts'));

const cases = [
  ['1字', '春', 132], ['1字', '玉', 132],
  ['2字', '词韵', 132], ['2字', '松烟', 132],
  ['3字', '不系舟', 132], ['3字', '洗砚池', 132],
  ['4字', '春唇语冬', 132], ['4字', '东坡居士', 132],
  ['混排缺字', '花落知多少', 132],
  ['页头', '春唇语冬', 34], ['页脚', '词韵', 36], ['卷首', '春唇语冬', 48]
];

let rows = '';
let report = [];
for (const [label, text, size] of cases) {
  let cells = '';
  for (const style of ['yin', 'yang']) {
    const html = renderSealSvg({ text, style, size }, cfg);
    const nText = (html.match(/<text/g) || []).length;
    const nGlyph = (html.match(/transform="translate\(/g) || []).length;
    if (style === 'yin') report.push(`${label} "${text}": glyphs=${nGlyph} fallback=${nText}`);
    cells += `<td>${html}</td>`;
  }
  rows += `<tr><th>${label}<br><small>${text}</small></th>${cells}</tr>`;
}

// 放大检视：满白字号、界格可见性、崩口聚边
let zoom = '';
for (const [label, text] of [['4字满白', '春唇语冬'], ['2字日字格', '词韵'], ['1字无格', '春']]) {
  zoom += `<tr><th>${label}</th><td>${renderSealSvg({ text, style: 'yin', size: 360 }, cfg)}</td>`
    + `<td>${renderSealSvg({ text, style: 'yang', size: 360 }, cfg)}</td></tr>`;
}

const page = `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<title>印章规格表</title>
<style>
:root{--seal-color:#C1352B;--paper-bg:#F7F2E7;--font-seal:"Songti SC","STKaiti","KaiTi","Kaiti SC",serif;}
body{background:var(--paper-bg);color:#2B2B2B;font-family:system-ui;padding:24px}
table{border-collapse:collapse}
td,th{border:1px solid #d8d0be;padding:16px;text-align:center;vertical-align:middle}
th{font-size:13px;font-weight:600}
small{color:#888;font-weight:400}
h2{font-size:15px;margin:18px 0 8px}
</style></head><body>
<h2>分制章法：1/2/3/4 字 × 阴阳（含缺字回退）</h2>
<table><tr><th>字数</th><th>阴刻 yin 白文</th><th>阳刻 yang 朱文</th></tr>${rows}</table>
<h2>放大检视（360px）</h2>
<table><tr><th>例</th><th>阴刻</th><th>阳刻</th></tr>${zoom}</table>
<h2>章序：直读 vs 回文（四字）</h2>
<table><tr><th>章序</th><th>白文</th><th>朱文</th></tr>
<tr><th>直读 zhi<br><small>右上→右下→左上→左下</small></th>
<td>${renderSealSvg({ text: '春唇语冬', style: 'yin', size: 160 }, cfg)}</td>
<td>${renderSealSvg({ text: '春唇语冬', style: 'yang', size: 160 }, cfg)}</td></tr>
<tr><th>回文 hui<br><small>右上→左上→左下→右下</small></th>
<td>${renderSealSvg({ text: '春唇语冬', style: 'yin', size: 160, seed: 7 }, cfgHui)}</td>
<td>${renderSealSvg({ text: '春唇语冬', style: 'yang', size: 160, seed: 7 }, cfgHui)}</td></tr></table>
<h2>朱白相间 mixed（2/4 字 × 形制）</h2>
<table><tr><th>例</th><th>方印</th><th>圆印</th><th>长方</th></tr>
<tr><th>4字 春唇语冬</th>
<td>${renderSealSvg({ text: '春唇语冬', style: 'mixed', size: 160 }, cfg)}</td>
<td>${renderSealSvg({ text: '春唇语冬', style: 'mixed', size: 160, shape: 'round' }, cfg)}</td>
<td>${renderSealSvg({ text: '春唇语冬', style: 'mixed', size: 160, shape: 'oblong' }, cfg)}</td></tr>
<tr><th>2字 词韵</th>
<td>${renderSealSvg({ text: '词韵', style: 'mixed', size: 160 }, cfg)}</td>
<td>${renderSealSvg({ text: '词韵', style: 'mixed', size: 160, shape: 'round' }, cfg)}</td>
<td>${renderSealSvg({ text: '词韵', style: 'mixed', size: 160, shape: 'oblong' }, cfg)}</td></tr></table>
<h2>形制：方 / 圆 / 长方 × 阴阳 × 字数</h2>
<table><tr><th>形制</th><th>1字</th><th>2字</th><th>3字</th><th>4字</th></tr>
${['square', 'round', 'oblong'].map((shape) => `<tr><th>${shape}</th>`
  + [['春'], ['词韵'], ['不系舟'], ['春唇语冬']].map((cs) => {
    const t = cs[0];
    return `<td>${renderSealSvg({ text: t, style: 'yin', size: 120, shape }, cfg)}${renderSealSvg({ text: t, style: 'yang', size: 120, shape }, cfg)}</td>`;
  }).join('') + '</tr>').join('')}
</table>
<h2>印泥色阶：鲜朱 / 朱磦 / 深赭</h2>
<table><tr><th>色阶</th><th>白文</th><th>朱文</th></tr>
<tr><th>cinnabar</th><td>${renderSealSvg({ text: '春唇语冬', style: 'yin', size: 132 }, cfg)}</td><td>${renderSealSvg({ text: '春唇语冬', style: 'yang', size: 132 }, cfg)}</td></tr>
<tr><th>zhubiao 朱磦</th><td>${renderSealSvg({ text: '春唇语冬', style: 'yin', size: 132 }, cfgZhu)}</td><td>${renderSealSvg({ text: '春唇语冬', style: 'yang', size: 132 }, cfgZhu)}</td></tr>
<tr><th>shenha 深赭</th><td>${renderSealSvg({ text: '春唇语冬', style: 'yin', size: 132 }, cfgShen)}</td><td>${renderSealSvg({ text: '春唇语冬', style: 'yang', size: 132 }, cfgShen)}</td></tr></table>
<h2>尺寸分档：16 / 34 / 48 / 96 / 120（细节随尺寸收缩）</h2>
<table><tr><th>尺寸</th><th>白文</th><th>朱文</th></tr>
${[16, 34, 48, 96, 120].map((s) => `<tr><th>${s}px</th><td>${renderSealSvg({ text: '春唇语冬', style: 'yin', size: s }, cfg)}</td><td>${renderSealSvg({ text: '春唇语冬', style: 'yang', size: s }, cfg)}</td></tr>`).join('')}
</table>
<h2>字法回填：alias 消缺样例（池/花 楷体回退，洗/砚/书 回填正字）</h2>
<table><tr><th>印文</th><th>白文</th><th>朱文</th></tr>
${['洗砚池', '诗书礼乐', '花落知多少', '东坡居士'].map((t) => `<tr><th>${t}</th><td>${renderSealSvg({ text: t, style: 'yin', size: 132 }, cfg)}</td><td>${renderSealSvg({ text: t, style: 'yang', size: 132 }, cfg)}</td></tr>`).join('')}
</table>
</body></html>`;

fs.writeFileSync(path.join(__dirname, 'spec-sheet.html'), page);
console.log('written spec-sheet.html');
console.log(report.join('\n'));
