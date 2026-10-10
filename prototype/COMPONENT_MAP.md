# 「松烟」(Songyan) Hexo 主题 · 组件与模板契约映射表 (COMPONENT_MAP.md)

> 版本：v0.1 Final  
> 说明：本文件详细规定了 `prototype/` 静态原型中所有 HTML DOM 区块与 Hexo 主题中目标 EJS 模板（`layout/*.ejs` 与 `layout/_partial/*.ejs`）的机械转换契约。本地 Agent 可直接依据本映射表执行模板切分。

---

## 1. 全局共用组件映射 (Global Partials)

| 静态原型位置 | Hexo 目标文件 | 传参/上下文要求 | 设计规格与实现说明 |
| :--- | :--- | :--- | :--- |
| **全站统一页头**<br>`<header class="site-header">` | `layout/_partial/header.ejs` | `config.title`, `theme.menu`, `theme.author` | 印前名后排版：左侧作者印章（brand 48px），右侧站名；站名下附 1px 赭石细线；右侧 4~5 个纯文字单行导航项。 |
| **全站统一页脚**<br>`<footer class="site-footer">` | `layout/_partial/footer.ejs` | `theme.author.name`, `config.title`, 版权年份 | 居中排版；内嵌 mini 作者印章（36px）；版权文字 `© 2026 春唇语冬`；附归档、关于等内部链接。 |
| **统一印章组件**<br>`<span class="seal seal--...">` | `layout/_partial/seal.ejs` | `{ variant: 'brand' \| 'signature' \| 'mini' \| 'watermark' \| 'single', size: number }` | 核心印章模板，支持 5 种变体（brand / signature / mini / watermark / single）。默认加载 SVG 模板，根据 `theme.author.seal_render` 切换字体版或路径版。 |
| **文章落款组件**<br>`<div class="post-signature">` | `layout/_partial/signature.ejs` | `page.date`, `theme.author.name` | 位于文章末尾右下角；由署名信息（「春唇语冬 记」、成文干支纪年）与 110px signature 印章组成。 |
| **代码块组件**<br>`<div class="code-block">` | `layout/_partial/code-block.ejs` | `{ lang: string, code: string }` | 独立暗黑作用域容器；包含头部语言标识与原生复制按钮（交互反馈 160ms）；正文采用 monospace 字体与行内滚动。 |
| **分页组件**<br>`<ul class="pagination">` | `layout/_partial/pagination.ejs` | `paginator` | 采用传统宣纸暖色方角按钮，支持上一页、页码高亮、下一页。 |

---

## 2. 页面级骨架与分卷分发 (Page Layouts)

| 静态原型位置 | Hexo 目标文件 | 包含与分发逻辑 |
| :--- | :--- | :--- |
| **全局 HTML 根骨架**<br>`<!DOCTYPE html>...` | `layout/layout.ejs` | 引入 `tokens.css`、`base.css`、`components.css`、`layouts.css`；引入 `main.js`；装载 `<%- body %>`。 |
| **文章路由分发入口**<br>`post-*.html` 容器 | `layout/post.ejs` | 核心分发契约：<br>`<% const validTypes = ['ci', 'essay', 'tech', 'project']; %><br><% const t = validTypes.includes(page.type) ? page.type : 'tech'; %><br><main class="site-main post-type-<%= t %>"><br>  <%- partial('_partial/post/' + t) %><br></main>` |
| **首页总装**<br>`prototype/index.html` | `layout/index.ejs` | 组装卷首标语印章、四卷导航入口、四卷精选流（每卷最新 3 篇）。 |
| **归档总装**<br>`prototype/archive.html` | `layout/archive.ejs` | 按年份聚合所有已发布文章，生成四卷四色时间轴。 |
| **分类总装**<br>`prototype/category.html` | `layout/category.ejs` | 聚合特定分类下的文章列表，挂载分页。 |
| **标签总装**<br>`prototype/tag.html` | `layout/tag.ejs` | 聚合特定标签下的文章列表，挂载分页。 |
| **自定义单页总装**<br>`prototype/page-about.html` | `layout/page.ejs` | 默认单页模板，承载关于页等静态 Markdown 文章。 |
| **404 错误页**<br>`prototype/404.html` | `layout/404.ejs` | 渲染「一纸空笺」极简页面。 |

---

## 3. 四卷专用 Partial 映射 (Post Partials)

### 3.1 词卷 (`type: ci`)
- **原型文件：** `prototype/post-ci.html` 与 `prototype/post-ci-vertical.html`
- **目标文件：** `layout/_partial/post/ci.ejs`
- **内部模块拆分：**
  - **头部词牌区：** 读取 `page.cipai`，渲染朱砂词牌印记与标题；
  - **正文区：** 
    - 横排版（默认基准）：居中横排，`<ruby>` 静态注音，韵脚字附带 `<span class="rhyme-dot">`（2px 朱砂圆点）；
    - 竖排版（配置项开启）：桌面端 `writing-mode: vertical-rl`，提示 bar 显示「⇆ 滚动浏览」（1.2s 淡出）；
  - **笺注区：** `layout/_partial/post/ci-annotations.ejs`（若 `page.annotations` 存在则遍历输出，支持 hover 1.5s 淡入联动）；
  - **平仄折叠：** `layout/_partial/post/ci-meter.ejs`（`<details>` 折叠，展示词林正韵谱系）；
  - **落款区：** 引用 `layout/_partial/signature.ejs`。

### 3.2 随笔卷 (`type: essay`)
- **原型文件：** `prototype/post-essay.html`
- **目标文件：** `layout/_partial/post/essay.ejs`
- **内部模块拆分：**
  - **元数据栏：** `page.date` 大字、`page.location` 驻足地、`page.weather` 气候、`page.mood` 心境（无对应字段时静默隐藏，不留空白）；
  - **正文排版：** 首行缩进 2em，行高 1.85，大留白；
  - **图片水印：** 遇插图自动套用 `.watermark-wrap` 与内嵌 80px 朱砂水印章（透明度 0.18）；
  - **落款区：** 引用 `layout/_partial/signature.ejs`。

### 3.3 技术卷 (`type: tech`)
- **原型文件：** `prototype/post-tech.html`
- **目标文件：** `layout/_partial/post/tech.ejs`
- **内部模块拆分：**
  - **左侧正文：** `max-w-prose`（720px）阅读版心，标题下设 1px 细线；
  - **右侧札记栏：** `layout/_partial/post/tech-notes.ejs`
    - 系列卡片（若 `page.series` 存在）；
    - 札记指标（`page.level` 适用层级、`page.read_time` 估算用时）；
    - 标签列表（`page.tags`）；
    - 纯 CSS 三角实现右上折角，悬停展开 2px（200ms）；
  - **代码块：** 自动处理 `<pre><code>` 挂载一键复制；
  - **落款区：** 引用 `layout/_partial/signature.ejs`。

### 3.4 项目卷 (`type: project`)
- **原型文件：** `prototype/post-project.html`
- **目标文件：** `layout/_partial/post/project.ejs`
- **内部模块拆分：**
  - **头部状态：** 读取 `page.status` 渲染状态印章（维护中·竹青 / 已归档·赭石 / 实验中·黛青）；
  - **项目封面：** 若有 `page.cover` 则展示；无则以宣纸暖色与印记占位；
  - **结构化元数据：** 渲染技术栈 `page.stack`、源码仓库 `page.repo`、线上演示 `page.demo`；
  - **更新日志：** 渲染版本时间轴列表 `page.changelog`；
  - **落款区：** 引用 `layout/_partial/signature.ejs`。

---

## 4. 首页各分卷流卡片映射 (Index Feed Components)

- **卷首标语与盖下印章：** `layout/_partial/index/hero.ejs`
- **四卷导航入口卡片：** `layout/_partial/sections-nav.ejs`
- **最新词选卡片：** `layout/_partial/cards/card-ci.ejs`
- **随笔轻量列表：** `layout/_partial/cards/card-essay.ejs`
- **技术札记卡片：** `layout/_partial/cards/card-tech.ejs`
- **项目展柜卡片：** `layout/_partial/cards/card-project.ejs`

---

## 5. 机械替换指南（给本地 Agent）

1. 寻找静态原型中的 `<!-- @hexo: [expression] -->` 与 `<!-- @end -->`，直接将其包裹的内容替换为 `<%= [expression] %>` 或 `<%- [expression] %>`。
2. 寻找静态原型中的 `<!-- @hexo: for item in collection -->`，替换为 `<% collection.forEach(function(item) { %>`，将结尾的 `<!-- @end -->` 替换为 `<% }); %>`。
3. 寻找静态原型中的 `<!-- @hexo: if condition -->`，替换为 `<% if (condition) { %>`，将结尾的 `<!-- @end -->` 替换为 `<% } %>`。
4. 将所有标有 `<!-- 待转 url_for(...) -->` 的相对链接，机械包装为 `<%- url_for(...) %>`。
