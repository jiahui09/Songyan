/**
 * 「松烟」Hexo 文章类型映射插件 (type-mapping.js)
 * 两轨制：type ∈ {ci, post}（诗词页 / 文章页）
 * 优先级：Front-matter 显式 type > type_mapping 路径规则 > 默认 post
 * 兜底原则：严格白名单机制，任何未知或异常类型均降级为 post（文章页）；
 *          旧分卷归属（随笔/技术/项目）不再参与渲染，降级为 front-matter
 *          categories 元信息文字。
 */

/* global hexo */
'use strict';

hexo.extend.filter.register('before_post_render', function (data) {
  const themeConfig = hexo.theme ? hexo.theme.config : {};
  const map = (themeConfig && themeConfig.type_mapping) || {};
  const src = (data.source || '').replace(/\\/g, '/');

  // 只在用户未显式声明 type 时用路径兜底映射
  if (!data.type) {
    for (const [pattern, type] of Object.entries(map)) {
      // 提取目录前缀（去除通配符 ** 与 *）
      const prefix = pattern.replace(/\*\*.*$/, '').replace(/\*.*$/, '');
      if (prefix && (src.startsWith(prefix) || src.startsWith('_posts/' + prefix))) {
        data.type = type;
        break;
      }
    }
  }

  // 白名单校验，确保类型安全受控（两轨：ci / post）
  const validTypes = ['ci', 'post'];
  if (!validTypes.includes(data.type)) {
    data.type = 'post';
  }

  return data;
});
