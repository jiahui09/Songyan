# 约束
- 仓库是 Hexo 主题。测试站点在 ~/Documents/blog-songyan-test（symlink 到本仓库）。
- 验收：cd ~/Documents/blog-songyan-test && hexo clean && hexo generate 必须通过。
- prototype/ 是 READ-ONLY 视觉参考，禁止修改，禁止引用。
- 只改任务指定的文件。禁止全量重写、顺手重构、新增依赖、创建 md。
- 模板 EJS；路径用 url_for；配置读 theme.*；颜色/间距用 CSS 变量。
- 禁止：内联 style、!important、硬编码颜色/文本、死代码、改基线截图。
- 功能与重构分开提交。重构不得改变视觉基线。
- 输出：git diff --stat + hexo generate 结果 + 是否影响基线。
