# 松烟 (Songyan) · Hexo 主题 v1.0.0

> **外古内今 · 分卷而治**  
> 古意放在外壳、排版、留白与仪式感上；技术与项目保持现代阅读效率。词重仪式，技术重效率。

---

## 主题特色

1. **诗文双轨：**
   - **诗词页：** 桌面端竖排、分片淡栏、字列水平居中、上下片留白与题笺导出；作者可指定横排，窄屏与打印保留原文标点；
   - **文章页：** 随笔、技术和项目共用安静的正文阅读结构，支持代码复制、图片、表格和旁批；
   - **归档页：** 分类保留词卷、随笔、技术、项目四种标识，共用双曲线夹缝时间轴。
2. **唯一印章系统：**
   - 全站唯一一枚作者印章：「春唇语冬」2.5cm 方形元朱文（右上春、右下唇、左上语、左下冬），采用印泥红（`#B03A2E`），严禁纯红 `#FF0000`。
3. **动效纪律：**
   - 全站仅允许单一入场动词「落墨」（320ms），交互反馈 160ms，严禁超过 500ms 的过度动效。
4. **纯粹原生：**
   - 核心功能零前端框架、零 localStorage、零暗色模式切换；样式使用 CSS 变量。可选 Gitalk 评论启用后按需加载外部脚本。

山水画封面暂不接入；素材策略、封面与正文连续状态、分阶段验收已登记在 `THEME_DESIGN.md`「后续升级规划」中。

---

## 快速安装

```bash
git clone --branch v1.0.0 --depth 1 https://github.com/jiahui09/Songyan.git songyan-release
cp -R songyan-release/themes/hexo-theme-songyan your-hexo-site/themes/songyan
cd your-hexo-site
```

在站点根目录 `_config.yml` 中指定主题：

```yaml
theme: songyan
```

站点个性化配置放在根目录 `_config.songyan.yml`，避免升级主题时覆盖。已有站点先备份 `source/`、站点配置和旧主题目录，再执行 `hexo clean && hexo generate`。

## 诗词排版由作者指定

在诗词 Markdown 的 Front Matter 中选择模式，网页只展示构建结果，不提供排版切换按钮：

```yaml
---
title: 作品题目
type: ci
poetry_layout: horizontal
---
```

- `poetry_layout: horizontal`：所有屏幕横排，保留原文标点，不启用逐列入场锁页。
- `poetry_layout: vertical`：桌面（≥1024px）竖排，窄屏横排；片内淡栏与分片规则沿用当前设计。
- 不填写：沿用主题 `_config.yml` 中的 `ci.vertical_desktop`。单篇配置优先；其他值也回退主题默认。

作者可以按作品结构选择：短诗可用横排，强调列序与分片的作品可用竖排；不按诗名或字数强制决定。`stanza_break` 继续指定下片前的段落数量。

长词竖排从右侧首列开始，逐列入场会将当前列带入可视区，落款完整出现后释放页面滚动。正文列高与落款占位独立，短诗不会被日期撑高或截去印章。

---

## 归档页

归档页（`/archives/`，分类、标签、年/月归档共用）桌面采用双曲线夹缝时间轴：上方独立年轨只在跨年时缓动，月份在年份下方淡入淡出；夹缝展示日与可选的 `solar_term`，题目前为分类微点与居中墨圈。长标题按词边界拆为最多两列，英文采用 mixed 竖排。滚轮按相邻文章吸附、首尾限位；拖拽超过 4px 才捕获指针，点击居中、再次点击进入文章。窄屏按窗口比例降级为目录列表，分卷图例提供分类筛选。

- 文案与分卷映射在主题 `_config.yml` 的 `archive` 块：标题、计数文案、图例/目录标签、近期篇目数、分卷显示名、`category_names` 分类映射与 `fallback_category` 兜底。
- 归档页自行渲染全量篇目，建议在站点 `_config.yml` 关闭归档生成器分页，避免 `/archives/page/N/` 重复内容：

```yaml
archive_generator:
  per_page: 0
```

- 键盘：`←/→` 切换相邻文章。
- 迁移 Gitalk 时，将原路径对应的评论 ID 放入站点主题配置的 `comments.gitalk.legacy_path_ids`，可保留既有评论关联。

## 开源许可

MIT License © 2026 春唇语冬
