/**
 * 一次性脚本：用主题印章生成器重产 favicon（替换手绘占位假印章）
 * 用法：node gen-favicon.js   （从 .tmp-preview/ 运行，写回主题 images/）
 */
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const themeDir = path.resolve(__dirname, '../themes/hexo-theme-songyan');
const cfg = yaml.load(fs.readFileSync(path.join(themeDir, '_config.yml'), 'utf8'));
const src = fs.readFileSync(path.join(themeDir, 'scripts/seal-helper.js'), 'utf8');
const tokens = fs.readFileSync(path.join(themeDir, 'source/css/tokens.css'), 'utf8');

// token 单一来源：从 tokens.css 抽取（favicon 独立文档不继承页面变量，需镜像）
function tok(name) {
  const m = tokens.match(new RegExp('--' + name + ':\\s*([^;]+);'));
  if (!m) throw new Error('token not found: ' + name);
  return m[1].trim();
}
const tokenMirror = `:root{--seal-color:${tok('seal-color')};--paper-bg:${tok('paper-bg')};--font-seal:${tok('font-seal')};}`;

// stub hexo 扩展点后取回生成器函数（模块顶层会调用注册 API；注入 require/__dirname 供字库子系统解析）
const hexoStub = { extend: { helper: { register() {} }, tag: { register() {} } } };
const scriptsDir = path.join(themeDir, 'scripts');
const renderSealSvg = new Function('hexo', 'require', '__dirname', src + '\n;return renderSealSvg;')(hexoStub, require, scriptsDir);

// 阴刻白文「春」：红底反白字，与旧 favicon 概念一致；刀痕/砂眼/崩刃走生成器
const span = renderSealSvg({ text: '春', style: 'yin' }, cfg);
const seed = (function () {
  // 复算 activeSeed 仅用于注释展示：hashString('春_yin') + cfg.seed
  const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  return hash('春_yin') + (cfg.seal.seed || 42);
})();

let svg = span.replace(/^<span[^>]*>/, '').replace(/<\/span>$/, '')
  .replace(/ width="\d+" height="\d+"/, ''); // 独立图标不锁像素，交给浏览器缩放
svg = svg.replace('<svg ', '<svg role="img" aria-label="松烟 favicon 春" ');
svg = svg.replace(/^(<svg[^>]*>)/,
  '$1\n  <!-- 由主题印章生成器生成：scripts/seal-helper.js → renderSealSvg({text:"春",style:"yin",seed:' + seed + '})；下方 token 值镜像 source/css/tokens.css（XML 注释内禁用双连字符，故不写 CSS 变量前缀） -->\n  <style>' + tokenMirror + '</style>');

fs.writeFileSync(path.join(themeDir, 'source/images/seal-favicon.svg'), svg + '\n');
console.log('written, bytes=' + svg.length);
