/**
 * 「松烟」词卷笺注与竖排联动交互 (ci-annotations.js)
 * 功能：
 * 1. 鼠标悬停/点击韵脚字与词注时，文末「笺注」对应条目淡入高亮 1.5s
 * 2. 竖排容器鼠标移入时显示「⇆ 滚动」极淡提示，1.2s 后平滑淡出
 */

document.addEventListener('DOMContentLoaded', () => {
  initCiAnnotationHover();
  initVerticalScrollPrompt();
});

/**
 * 韵脚与笺注联动高亮
 */
function initCiAnnotationHover() {
  const rhymeDots = document.querySelectorAll('[data-annotation-target]');
  const annotationItems = document.querySelectorAll('.ci-annotation-item');

  if (!rhymeDots.length || !annotationItems.length) return;

  rhymeDots.forEach((trigger) => {
    const targetKey = trigger.getAttribute('data-annotation-target');

    function highlightTarget() {
      annotationItems.forEach((item) => {
        const itemKey = item.getAttribute('data-annotation-key');
        if (itemKey === targetKey) {
          item.classList.add('ci-annotation-item--highlight');

          // 清理之前残留的定时器
          if (item._highlightTimer) {
            clearTimeout(item._highlightTimer);
          }

          // 1.5s 后高亮淡出恢复
          item._highlightTimer = setTimeout(() => {
            item.classList.remove('ci-annotation-item--highlight');
            item._highlightTimer = null;
          }, 1500);
        }
      });
    }

    trigger.addEventListener('mouseenter', highlightTarget);
    trigger.addEventListener('click', highlightTarget);
  });
}

/**
 * 竖排容器滚动引导提示（仅在鼠标进入时提示一次，1.2s 后淡出）
 */
function initVerticalScrollPrompt() {
  const container = document.querySelector('.post-ci__vertical-container');
  const prompt = document.querySelector('.post-ci__vertical-scroll-prompt');

  if (!container || !prompt) return;

  let hasShown = false;

  container.addEventListener('mouseenter', () => {
    if (hasShown) return;
    hasShown = true;

    prompt.classList.remove('fade-out');

    setTimeout(() => {
      prompt.classList.add('fade-out');
    }, 1200);
  });
}
