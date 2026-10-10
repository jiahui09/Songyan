/**
 * 「松烟」代码块一键复制 (code-copy.js)
 * 功能：纯原生剪贴板 API，无任何外部库依赖，交互反馈 160ms
 */

document.addEventListener('DOMContentLoaded', () => {
  initCodeCopy();
});

function initCodeCopy() {
  const copyButtons = document.querySelectorAll('.copy-btn');

  copyButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const codeBlock = btn.closest('.code-block');
      if (!codeBlock) return;

      const codeElement = codeBlock.querySelector('pre code') || codeBlock.querySelector('pre');
      if (!codeElement) return;

      const codeText = codeElement.innerText;

      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(codeText);
        } else {
          // 降级兜底方案
          const textarea = document.createElement('textarea');
          textarea.value = codeText;
          textarea.style.position = 'fixed';
          textarea.style.left = '-9999px';
          document.body.appendChild(textarea);
          textarea.select();
          document.execCommand('copy');
          document.body.removeChild(textarea);
        }

        const originalText = btn.textContent;
        btn.textContent = '已复制';
        btn.classList.add('copy-btn--copied');

        // 1600ms 后恢复状态
        setTimeout(() => {
          btn.textContent = originalText;
          btn.classList.remove('copy-btn--copied');
        }, 1600);
      } catch (err) {
        console.error('复制代码失败:', err);
        btn.textContent = '复制失败';
        setTimeout(() => {
          btn.textContent = '复制';
        }, 1600);
      }
    });
  });
}
