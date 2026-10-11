/**
 * 「松烟」主交互脚本 (main.js)
 * 严格遵从：
 * 1. 原生 JavaScript，无任何框架与 CDN 依赖
 * 2. DOMContentLoaded 后初始化
 * 3. 唯一定义的入场动效「落墨」：320ms，cubic-bezier(0.22, 1, 0.36, 1)
 * 4. 首页唯一印章盖下动效：400ms，仅一次
 * 5. 交互反馈：160ms
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. 落墨动效：作用于首页分卷卡片、文章正文一级标题、归档时间轴节点
  initLuoMoAnimation();

  // 2. 首页印章「盖下」唯一动效 (400ms)
  initSealStampOnce();

  // 3. 长代码块默认折叠「展卷」（超过 --code-fold-max 高度的代码纸笺）
  initCodeFold();
});

/**
 * 初始化长代码块折叠「展卷」
 * 阈值取自 tokens.css 的 --code-fold-max（300px），避免 JS 与 CSS 魔数分叉
 * 折叠态：折角纸笺 + 题头「［附录：代码手稿 / 点击展卷］」；点击后展卷并可再次收卷
 */
function initCodeFold() {
  const codeBlocks = document.querySelectorAll('figure.highlight');
  if (!codeBlocks.length) return;

  const foldHeight = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--code-fold-max')
  ) || 300;

  codeBlocks.forEach((block) => {
    const pre = block.querySelector('td.code pre') || block.querySelector('pre');
    if (!pre) return;

    if (pre.scrollHeight <= foldHeight) return;

    block.classList.add('is-code-folded');

    const bar = document.createElement('button');
    bar.type = 'button';
    bar.className = 'code-fold__bar';
    bar.textContent = '［附录：代码手稿 / 点击展卷］';
    bar.setAttribute('aria-expanded', 'false');

    bar.addEventListener('click', () => {
      const folded = block.classList.toggle('is-code-folded');
      bar.setAttribute('aria-expanded', String(folded));
      bar.textContent = folded
        ? '［附录：代码手稿 / 点击展卷］'
        : '［附录：代码手稿 / 点击收卷］';
    });

    block.insertBefore(bar, block.firstChild);
  });
}

/**
 * 初始化「落墨」动效（IntersectionObserver 视口触发展开）
 */
function initLuoMoAnimation() {
  const elementsToAnimate = document.querySelectorAll(
    '.stream-item, .post-card, .post-title, .archive-item'
  );

  if (!elementsToAnimate.length) return;

  // 检查系统 prefers-reduced-motion 偏好
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    elementsToAnimate.forEach((el) => el.classList.remove('enter'));
    return;
  }

  // 利用轻量 IntersectionObserver 进行视口入场触发
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('enter');
            obs.unobserve(entry.target);
          }
        });
      },
      {
        threshold: 0.1,
        rootMargin: '0px 0px -20px 0px'
      }
    );

    elementsToAnimate.forEach((el) => {
      observer.observe(el);
    });
  } else {
    // 降级兜底直接添加类
    elementsToAnimate.forEach((el) => el.classList.add('enter'));
  }
}

/**
 * 首页卷首印章「盖下」动效 (400ms，仅一次，不重复)
 */
function initSealStampOnce() {
  const heroSeal = document.querySelector('.hero-scroll__seal-brand .seal');
  if (!heroSeal) return;

  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    return;
  }

  heroSeal.classList.add('seal-stamp-once');
}
