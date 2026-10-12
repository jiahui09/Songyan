/**
 * 「松烟」主交互脚本 (main.js)
 * 严格遵从：
 * 1. 原生 JavaScript，无任何框架与 CDN 依赖
 * 2. DOMContentLoaded 后初始化
 * 3. 唯一定义的入场动效「落墨」：320ms，cubic-bezier(0.22, 1, 0.36, 1)
 * 4. 首页唯一印章盖下动效：400ms，仅一次
 * 5. 交互反馈：160ms
 * 6. 归档横轴（岁时笺纸）：滚轮仅在轴区内横移轴体，区域外交还页面滚动
 * 7. 长代码块默认折叠「展卷」：折角纸笺 + 题头「［附录：代码手稿 / 点击展卷］」
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. 落墨动效：作用于首页归流条目、文章正文一级标题、归档时间轴节点
  initLuoMoAnimation();

  // 2. 归档页「岁时笺纸」横轴：滚轮横移（仅轴区内）+ 指针拖曳 + 进度朱点
  initChronoRail();

  // 4. 长代码块默认折叠「展卷」（超过 --code-fold-max 高度的代码纸笺）
  initCodeFold();
});

/**
 * 初始化长代码块折叠「展卷」
 * 阈值取自 tokens.css 的 --code-fold-max（300px），避免 JS 与 CSS 魔数分叉
 * 折叠态：折角纸笺 + 题头「［附录：代码手稿 / 点击展卷］」；点击后展卷并可再次收卷
 */
function initCodeFold() {
  const codeBlocks = document.querySelectorAll('.code-block');
  if (!codeBlocks.length) return;

  const foldHeight = parseFloat(
    getComputedStyle(document.documentElement).getPropertyValue('--code-fold-max')
  ) || 300;

  codeBlocks.forEach((block) => {
    const pre = block.querySelector('.code-block__pre');
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
      // aria-expanded 反映展卷后的可见态：收卷(false) → 展卷(true)
      bar.setAttribute('aria-expanded', String(!folded));
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
    '.post-item, .post-card, .post-title, .archive-item'
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
 * 归档页「岁时笺纸」横轴交互：
 * 1. 滚轮横移——监听只挂在轴体（.chrono__rail）上，指针在轴区内才接管；
 *    纵向滚轮一律只作用于轴体，不外传页面滚动（到端点即停，不链动页面）
 * 2. 指针拖曳（原生滚动条已隐藏，桌面必需）
 * 3. 进度朱点——弧路径按像素宽重建，端点内缩 ≥ 朱点半径防视口裁切；
 *    朱点按滚动进度映射弧长（右端＝最新，左端＝最旧）
 * 4. 平滑缓动——滚轮以目标位 + rAF 阻尼插值推进，阻尼放缓求丝滑（reduced-motion 直接落位）
 * 5. 分卷图例筛选——点按只留该分卷篇目，年份组无可见篇目整组隐去
 * 6. 拱弧骑列——轴线弧与朱线上下镜像，日列/年号按视口横位以 --curve-y 骑弧
 */
function initChronoRail() {
  const rail = document.querySelector('[data-chrono-rail]');
  if (!rail) return;

  const track = rail.querySelector('.chrono__track');
  const curveLine = document.querySelector('.chrono__curve-line');
  const curveDot = document.querySelector('.chrono__curve-dot');
  const axisLine = document.querySelector('.chrono__axis-line');
  if (!track || !curveLine || !curveDot) return;

  const DOT_R = 3.5; // 朱点半径，与 .chrono__curve-dot 的 r 一致
  let pathLen = 0;

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // 读取指定长度 token 并换算为 px，保持 token 为唯一来源（曲率与轴位同源）
  function readTokenPx(name, fallback) {
    const raw = getComputedStyle(document.documentElement)
      .getPropertyValue(name)
      .trim();
    const num = parseFloat(raw);
    if (Number.isNaN(num)) return fallback;
    return raw.includes('rem')
      ? num * parseFloat(getComputedStyle(document.documentElement).fontSize)
      : num;
  }

  function readSagPx() {
    return readTokenPx('--chrono-sag', DOT_R * 4);
  }

  // 按实际像素宽重建弧路径；两端内缩一个朱点半径，圆点停在端点时圆缘恰与视口边界相切
  function buildCurve() {
    const width = curveLine.ownerSVGElement.getBoundingClientRect().width;
    if (!width) return;
    const pad = DOT_R;
    const y0 = DOT_R + 2; // 顶缘余量：半径 + 线宽
    const sag = readSagPx();
    curveLine.setAttribute(
      'd',
      'M ' + pad + ',' + y0 + ' Q ' + width / 2 + ',' + (y0 + 2 * sag) + ' ' + (width - pad) + ',' + y0
    );
    pathLen = curveLine.getTotalLength();
  }

  // 拱弧轴线：端点对齐 --chrono-top，中点拱起一个 sag，与朱线弧（下坠）上下镜像
  function buildAxis() {
    if (!axisLine) return;
    const width = axisLine.ownerSVGElement.getBoundingClientRect().width;
    if (!width) return;
    const y0 = readTokenPx('--chrono-top', 200);
    const sag = readSagPx();
    axisLine.setAttribute(
      'd',
      'M 0,' + y0 + ' Q ' + width / 2 + ',' + (y0 - 2 * sag) + ' ' + width + ',' + y0
    );
  }

  // 朱点定位：按滚动进度映射弧长（右端＝最新，左端＝最旧；朱点右＝最新）
  function updateDot() {
    if (!pathLen) return;
    const max = rail.scrollWidth - rail.clientWidth;
    const q = max > 0 ? clamp(rail.scrollLeft / max, 0, 1) : 0;
    const pt = curveLine.getPointAtLength(q * pathLen);
    curveDot.setAttribute('cx', pt.x);
    curveDot.setAttribute('cy', pt.y);
  }

  // 骑弧：按视口横位取拱弧高（二次贝塞尔 y 偏移 ≤ 0），写入各列 --curve-y；
  // 滚动时逐帧更新，日列、年号、节点墨点与弧线同步抬落
  const shiftTargets = rail.querySelectorAll('.chrono__item, .chrono__year-mark');
  function updateShift() {
    const railRect = rail.getBoundingClientRect();
    if (!railRect.width) return;
    const sag = readSagPx();
    shiftTargets.forEach((el) => {
      const rect = el.getBoundingClientRect();
      const t = clamp((rect.left + rect.width / 2 - railRect.left) / railRect.width, 0, 1);
      el.style.setProperty('--curve-y', (-4 * sag * t * (1 - t)).toFixed(2) + 'px');
    });
  }

  // 版面重建：两弧路径 + 朱点 + 骑弧高度一并求值
  function refresh() {
    buildCurve();
    buildAxis();
    updateDot();
    updateShift();
  }

  // —— 平滑缓动：目标位 + rAF 阻尼插值；reduced-motion 直接落位 ——
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let scrollTarget = 0;
  let glideRaf = 0;

  function maxScroll() {
    return Math.max(rail.scrollWidth - rail.clientWidth, 0);
  }

  function glide() {
    const diff = scrollTarget - rail.scrollLeft;
    if (Math.abs(diff) < 0.5) {
      rail.scrollLeft = scrollTarget;
      glideRaf = 0;
      return;
    }
    rail.scrollLeft = rail.scrollLeft + diff * 0.085;
    glideRaf = requestAnimationFrame(glide);
  }

  function glideTo(next) {
    scrollTarget = clamp(next, 0, maxScroll());
    if (reduceMotion.matches) {
      rail.scrollLeft = scrollTarget;
      return;
    }
    // 先落一阶步进（即时反馈），余程由 rAF 阻尼缓动收敛
    rail.scrollLeft += (scrollTarget - rail.scrollLeft) * 0.25;
    if (!glideRaf) glideRaf = requestAnimationFrame(glide);
  }

  // 滚轮横移：ltr 坐标（scrollLeft 0 在左＝最旧端，max 在右＝最新端）；
  // 向下滚＝向旧端（左移）。轴区内的纵向滚轮始终只推动轴体：
  // 目标位被钳制于两端，不外传页面纵向滚动
  function wheelScroll(deltaY) {
    if (maxScroll() <= 1) return false;
    const settling = glideRaf || Math.abs(scrollTarget - rail.scrollLeft) > 1;
    glideTo((settling ? scrollTarget : rail.scrollLeft) - deltaY);
    return true;
  }

  rail.addEventListener(
    'wheel',
    (e) => {
      if (e.ctrlKey) return; // 浏览器缩放手势放行
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return; // 原生横向手势不拦截
      if (wheelScroll(e.deltaY)) e.preventDefault();
    },
    { passive: false }
  );

  // 指针拖曳：内容随手势而动（拖曳跟手，接管时先打断缓动）
  let dragFrom = null;
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(glideRaf);
    glideRaf = 0;
    dragFrom = { x: e.clientX, scroll: rail.scrollLeft };
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragFrom) return;
    scrollTarget = clamp(dragFrom.scroll - (e.clientX - dragFrom.x), 0, maxScroll());
    rail.scrollLeft = scrollTarget;
  });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((evt) =>
    rail.addEventListener(evt, () => {
      dragFrom = null;
    })
  );

  // 滚动事件本身已按帧节流，直接同步朱点；
  // 非缓动、非拖曳期的外部滚动（触屏惯性）同步目标位，防后续滚轮跳位
  rail.addEventListener(
    'scroll',
    () => {
      if (!glideRaf && !dragFrom) scrollTarget = rail.scrollLeft;
      updateDot();
      updateShift();
    },
    { passive: true }
  );

  // —— 分卷图例筛选：点按只留该分卷（再点还原）；年份组无可见篇目整组隐去 ——
  const legend = document.querySelector('.archive-legend');
  if (legend) {
    const items = rail.querySelectorAll('.chrono__item');
    const years = rail.querySelectorAll('.chrono__year');
    const applyFilter = (cat) => {
      legend.querySelectorAll('[data-cat-filter]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.catFilter === cat));
      });
      items.forEach((li) => {
        li.hidden = !!cat && li.dataset.cat !== cat;
      });
      years.forEach((group) => {
        group.hidden = !group.querySelector('.chrono__item:not([hidden])');
      });
      // 版面变了：弧线按新宽重建，回停最新端
      rail.scrollLeft = rail.scrollWidth;
      scrollTarget = rail.scrollLeft;
      refresh();
    };
    legend.querySelectorAll('[data-cat-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyFilter(btn.getAttribute('aria-pressed') === 'true' ? '' : btn.dataset.catFilter);
      });
    });
  }

  window.addEventListener('resize', () => {
    refresh();
  });

  // 初始停驻最新端（物理右）；无 JS 时静态降级停在最旧端
  rail.scrollLeft = rail.scrollWidth;
  scrollTarget = rail.scrollLeft;
  refresh();
}
