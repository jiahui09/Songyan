# 「松烟」(Songyan) Hexo 主题 · 数据契约与字段定义 (DATA_SHAPE.md)

> 版本：v0.1 Final  
> 说明：本文件详细规定了全站四卷、页面、主题配置的所有动态字段来源、类型以及缺失时的兜底行为。本地 Agent 请严格按照此规格实现数据取值。

---

## 1. 字段字典与降级行为矩阵

| 字段表达式 | 数据来源 | 类型 | 示例值 | 缺失时的兜底降级行为 |
| :--- | :--- | :--- | :--- | :--- |
| `page.title` | 文章 Front-matter / Hexo | `string` | "水调歌头·秋夜怀远" | 若缺失，降级为 `config.title` 或文件名 |
| `page.type` | Front-matter 或 `scripts/type-mapping.js` | `enum('ci', 'essay', 'tech', 'project')` | "tech" | 强制降级为 `"tech"`（白名单机制，防失控） |
| `page.date` | Hexo 内置时间对象 | `Date` / `moment` | "2026-10-10 10:00:00" | 若缺失，取文件创建时间或 `new Date()` |
| `page.content` | Hexo 编译后的 HTML 正文 | `string` (HTML) | `<p>正文内容...</p>` | 输出空白字符串，不报错 |
| `page.excerpt` | Hexo 摘要或 `<!-- more -->` | `string` | "露下碧梧冷，风引画檐铃..." | 若无则自动截取正文前 120 字纯文本 |
| **【词卷】`page.cipai`** | 词卷 Front-matter | `string` | "水调歌头" | 若缺失，不渲染顶部「词牌 · xxx」印记 |
| **【词卷】`page.rhyme`** | 词卷 Front-matter | `string` | "词林正韵第七部" | 若缺失，元数据栏不展示韵部标注 |
| **【词卷】`page.annotations`** | 词卷 Front-matter | `Array<{word: string, meaning: string}>` | `[{ word: "素娥", meaning: "..." }]` | 若缺失或空数组，整块「笺注」栏目静默隐藏 |
| **【随笔】`page.weather`** | 随笔 Front-matter | `string` | "晴" / "霖雨" | 若缺失，静默隐藏该项，不占位、不留空 |
| **【随笔】`page.location`** | 随笔 Front-matter | `string` | "杭州 · 六和塔畔" | 若缺失，静默隐藏该项，不占位、不留空 |
| **【随笔】`page.mood`** | 随笔 Front-matter | `string` | "澄澈" / "幽趣" | 若缺失，静默隐藏该项，不占位、不留空 |
| **【技术】`page.series`** | 技术文 Front-matter | `string` | "Hexo主题开发" | 若缺失，右侧札记栏不渲染「专栏系列」卡片 |
| **【技术】`page.level`** | 技术文 Front-matter | `string` | "进阶" / "通用" | 若缺失，右侧札记栏不渲染难度项 |
| **【技术】`page.read_time`**| Front-matter 或自动计算 | `number` (分钟) | `6` | 若未手填，调用下述 `countReadTime` 算法自动估算 |
| **【技术】`page.tags`** | Hexo 内置标签集合 | `Array<Tag>` | `["Hexo", "EJS"]` | 若缺失，札记栏不渲染「本文标签」卡片 |
| **【技术】`page.toc`** | Front-matter | `boolean` | `true` | **v0.1 决策：静默忽略，不渲染 TOC** |
| **【项目】`page.status`** | 项目 Front-matter | `enum('维护中', '已归档', '实验中')` | "维护中" | 缺失时默认按「维护中」处理并赋竹青色 |
| **【项目】`page.stack`** | 项目 Front-matter | `Array<string>` | `["Hexo", "Vanilla JS"]` | 若缺失，不展示技术栈胶囊标签 |
| **【项目】`page.repo`** | 项目 Front-matter | `string` (URL) | `"https://github.com/..."` | 若缺失，不展示「仓库 →」外链 |
| **【项目】`page.demo`** | 项目 Front-matter | `string` (URL) | `"https://example.com"` | 若缺失，不展示「演示 →」外链 |
| **【项目】`page.cover`** | 项目 Front-matter | `string` (URL) | `"/images/cover.png"` | 若缺失，使用主题默认宣纸色块占位 |
| **【主题】`theme.author.name`** | `_config.yml` | `string` | "春唇语冬" | 缺失时兜底为 `"春唇语冬"` |
| **【主题】`theme.author.seal_chars`** | `_config.yml` | `Array<string>` (长度 4) | `["春", "唇", "语", "冬"]` | 长度非 4 时降级为单行文字居中 |
| **【主题】`theme.author.seal_render`** | `_config.yml` | `enum('font', 'path')` | "font" | 缺失时默认为 `"font"` |
| **【主题】`theme.home.per_section`** | `_config.yml` | `number` | `3` | 缺失时默认每卷提取最新 3 篇 |

---

## 2. Front-matter 标准样例

### 2.1 词卷样例 (`source/_posts/ci/water-song.md`)
```yaml
---
title: 水调歌头·秋夜怀远
date: 2026-10-10 20:00:00
type: ci
cipai: 水调歌头
rhyme: 词林正韵第七部（仄韵）
annotations:
  - word: 素娥
    meaning: 月中嫦娥，古诗词常用借代明月或月中仙子。
  - word: 拂尘缨
    meaning: 抖去冠缨上的尘垢，语出《楚辞·渔父》「沧浪之水清兮，可以濯吾缨」，表超脱出尘之怀。
---
```

### 2.2 随笔卷样例 (`source/_posts/essay/qiantang.md`)
```yaml
---
title: 钱塘江观潮杂记
date: 2026-10-10 15:30:00
type: essay
weather: 晴
location: 杭州 · 六和塔畔
mood: 澄澈
---
```

### 2.3 技术卷样例 (`source/_posts/tech/songyan-arch.md`)
```yaml
---
title: Hexo 主题架构与从零发布指南
date: 2026-10-10 10:00:00
type: tech
categories: [前端工程]
tags: [Hexo, EJS, CSS-Tokens, 架构设计]
series: Hexo主题开发
level: 进阶
toc: true              # v0.1 保留字段但静默忽略，不渲染浮动 TOC
---
```

### 2.4 项目卷样例 (`source/_posts/projects/songyan.md`)
```yaml
---
title: 松烟 Hexo 主题
date: 2026-10-10 12:00:00
type: project
status: 维护中
stack: [Hexo, EJS, CSS3 Tokens, Vanilla JS]
repo: https://github.com/user/hexo-theme-songyan
demo: https://example.com
cover: /images/preview.png
changelog:
  - version: v0.1.0
    date: 2026-10-10
    notes: 完成原型三件套与 Hexo 骨架
---
```

---

## 3. read_time 估算算法实现

```javascript
/**
 * 技术文阅读时长估算（中文字数 / 300，英文单词 / 200，剔除代码块与 HTML 标签）
 * @param {string} content - Markdown 渲染后的 HTML 字符串
 * @returns {number} 预计阅读分钟数（至少 1 分钟）
 */
function countReadTime(content) {
  if (!content) return 1;
  const text = content
    .replace(/<pre[\s\S]*?<\/pre>/g, '')   // 去除代码块
    .replace(/<[^>]+>/g, '')                // 去除 HTML 标签
    .replace(/[\s\p{P}]/gu, '');            // 去除空白与标点符号
  const cjk = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
  const words = (text.match(/[a-zA-Z]+/g) || []).length;
  return Math.max(1, Math.round(cjk / 300 + words / 200));
}
```

---

## 4. 词牌独立数据文件结构规范 (`source/_data/cipai.yml`)

```yaml
# 词牌元数据规范，供模板根据 page.cipai 自动读取平仄与格律
shuidiaogetou:
  name: "水调歌头"
  rhythms: ["词林正韵第七部", "词林正韵第十一部"]
  meter: "双调九十五字，前段九句四平韵，后段十句六平韵"
  pattern: >
    仄仄仄平仄，平仄仄平平（韵）。中平平仄平仄，平仄仄平平（韵）。
    仄仄中平平仄，仄仄平平平仄，中仄仄平平（韵）。平仄仄平仄，仄仄仄平平（韵）。
    平中仄，中中仄，仄平平（韵）。中平平仄，平仄平仄仄平平（韵）。
    仄仄中平平仄，仄仄平平平仄，中仄仄平平（韵）。中仄仄平仄，平仄仄平平（韵）。

dingfengbo:
  name: "定风波"
  rhythms: ["词林正韵第一部"]
  meter: "双调六十二字，前段五句三平韵两仄韵，后段六句四仄韵两平韵"
```
