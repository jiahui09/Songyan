/**
 * 「松烟」印章系统辅助脚本 (seal.js)
 * 提供印章变体类名与无障碍属性保障
 */

(function () {
  'use strict';

  window.SongyanSeal = {
    /**
     * 校验印章元素并确保可访问性
     */
    verifySeals: function () {
      const decorativeSeals = document.querySelectorAll('.seal[aria-hidden="true"]');
      decorativeSeals.forEach((seal) => {
        const svg = seal.querySelector('svg');
        if (svg) svg.setAttribute('aria-hidden', 'true');
      });

      const functionalSeals = document.querySelectorAll('.seal:not([aria-hidden="true"])');
      functionalSeals.forEach((seal) => {
        const svg = seal.querySelector('svg');
        if (svg && !svg.getAttribute('aria-label')) {
          svg.setAttribute('role', 'img');
          svg.setAttribute('aria-label', '春唇语冬印');
        }
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    window.SongyanSeal.verifySeals();
  });
})();
