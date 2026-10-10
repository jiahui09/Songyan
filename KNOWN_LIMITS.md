# 「松烟」(Songyan) Hexo 主题 · 已知限制与未决事项 (KNOWN_LIMITS.md)

> 版本：v0.1 Final  
> 原则：诚实比完整重要。禁止隐瞒未完工项，明确边界以利本地 Agent 接手施工。

---

## 1. 本版 (v0.1) 明确未做或延期的功能

1. **浮动文章目录 (TOC)：**
   - **现状：** `toc: true` Front-matter 字段保留但静默忽略。技术文右栏改为「折角纸笺」札记栏（展示系列、难度、估时、标签）。
   - **原因与计划：** 在宣纸古风大留白版式中，复杂 TOC 容易破坏右侧留白平衡，且与折角纸笺视觉冲突；计划在 v0.2 版本中设计为「折叠卷帙式」抽屉。
2. **首页精选推荐 (Featured Posts)：**
   - **现状：** 首版首页分卷流直接提取每卷最新发布的前 3 篇文章（`per_section: 3`），配置项 `home.featured: false`。
   - **计划：** v0.2 引入 `featured: true` 权重排序与顶置逻辑。
3. **中文字体子集化与 WebFont 打包：**
   - **现状：** 严格遵循「禁止 @import 外部字体」与「系统字体优先」，依赖用户系统预装的文楷、楷体、宋体。
   - **局限：** Windows 系统下若无霞鹜文楷或楷体，将回退至系统自带 `KaiTi` 或 `SimSun`，笔锋韵味略有减损。中文字体子集化压缩打包列为 v0.2 规划。
4. **留墨区（古风评论系统）：**
   - **现状：** 静态原型未引入第三方评论插件（Twikoo/Waline/Giscus），仅在文档与布局中预留插槽。
5. **本地搜索 (hexo-generator-searchdb)：**
   - **现状：** v0.1 仅在设计方案中规划，未编写弹窗或搜索页面，需本地 Agent 结合具体生成器实现。

---

## 2. 潜在环境兼容性与渲染风险

1. **Markdown 渲染器过滤属性风险：**
   - 词卷使用了自定义属性 `data-annotation-target` 和 `<ruby>` 标签。如果用户的 Hexo 站点使用了某些重度净化的 Markdown 渲染器（如启用了严格 HTML 过滤的 `markdown-it` 规则），可能会剥除 `<ruby>` 或 `data-*` 属性，导致笺注高亮联动失效。
   - **建议：** 本地 Agent 在主题文档中注明推荐配置 `hexo-renderer-markdown-it` 且 `html: true`。
2. **移动端竖排 `writing-mode: vertical-rl`：**
   - 虽然 CSS 中已设置 `@media (min-width: 1024px) and (hover: hover)` 仅在桌面端开启竖排，并在移动端自动降级为居中横排，但某些平板设备（如带有外接键盘的 iPad）可能同时触发桌面断点与触控行为，横向滚动体验可能因各浏览器惯性滚动差异而略有不同。
3. **代码高亮类名兼容性：**
   - 静态原型中代码块结构为 `.code-block pre code`。Hexo 原生 `highlight.enable` 会自动生成 `.highlight table tr td.code` 结构的 HTML。
   - **本地 Agent 施工须知：** 本地 Agent 在转译 `code-block.ejs` 时，需编写 CSS 适配 Hexo 原生 `figure.highlight` 容器，或在 `_config.yml` 中配置使用主题原生代码容器。

---

## 3. 需要本地 Agent 决策与拍板的事项

1. **印章渲染模式选择：**
   - 主题已同时交付字体版 `seal-author.svg` 与纯矢量路径版 `seal-author-path.svg`。
   - 本地 Agent 需在 `_config.yml` 的 `author.seal_render` 中决定默认值（建议发布版默认使用 `path` 版，避免客户端未安装篆体或楷体时印章字形走样）。
2. **词牌数据库位置：**
   - `cipai.yml` 建议放置在站点根目录 `source/_data/cipai.yml`，还是作为主题内置资源放置在 `themes/hexo-theme-songyan/_data/cipai.yml`。
3. **Hexo Helper 函数封装：**
   - 本次设计坚决未擅自发明任何未经官方验证的 Helper。建议本地 Agent 评估是否在 `scripts/` 中封装 `songyan_seal(variant, size)` 与 `songyan_read_time(content)` 两个标准 helper，以简化 EJS 模板调用。
