/**
 * 「松烟」Hexo 分卷类型自动映射插件 (type-mapping.js)
 * 优先级：Front-matter 显式 type > type_mapping 路径规则 > 默认 tech
 * 兜底原则：严格白名单机制，任何未知或异常类型均降级为 tech
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

  // 白名单校验，确保类型安全受控
  const validTypes = ['ci', 'essay', 'tech', 'project'];
  if (!validTypes.includes(data.type)) {
    data.type = 'tech';
  }

  return data;
});
