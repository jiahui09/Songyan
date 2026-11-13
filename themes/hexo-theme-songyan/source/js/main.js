/**
 * 「松烟」主交互脚本 (main.js)
 * 严格遵从：
 * 1. 原生 JavaScript，无任何框架与 CDN 依赖
 * 2. DOMContentLoaded 后初始化
 * 3. 唯一定义的入场动效「落墨」：320ms，cubic-bezier(0.22, 1, 0.36, 1)
 * 4. 首页唯一印章盖下动效：400ms，仅一次
 * 5. 交互反馈：160ms
 * 6. 归档横轴（岁时笺纸）：滚轮仅在轴区内横移轴体，区域外交还页面滚动
 */

document.addEventListener('DOMContentLoaded', () => {
  // 1. 落墨动效：首页归流只整体入场，不再单独触发条目与条目标题
  initLuoMoAnimation();

  // 2. 归档页「岁时笺纸」横轴：滚轮横移（仅轴区内）+ 指针拖曳 + 进度朱点
  initChronoRail();

  // 3. 诗词竖排：定点后锁页，滚轮驱动整列自下而上升入，直至落款可见
  initCiColumnLock();
});

/**
 * 初始化「落墨」动效（IntersectionObserver 视口触发展开）
 */
function initLuoMoAnimation() {
  const elementsToAnimate = document.querySelectorAll(
    '.home-stream, .reading-page .post-title, .archive-item'
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
        threshold: 0,
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
 *    轴体可滚时横移，到端点将纵向滚动交还页面
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
  const chrono = rail.closest('.chrono');
  const curveLine = document.querySelector('.chrono__curve-line');
  const curveDot = document.querySelector('.chrono__curve-dot');
  const axisLine = document.querySelector('.chrono__axis-line');
  if (!track || !curveLine || !curveDot) return;

  const DOT_R = 3.5; // 朱点半径，与 .chrono__curve-dot 的 r 一致
  let pathLen = 0;

  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);

  // 读取指定长度 token 并换算为 px，保持 token 为唯一来源（曲率与轴位同源）
  function readTokenPx(name, fallback) {
    const raw = getComputedStyle(chrono)
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

  // 按实际像素宽重建弧路径；两端内缩一个朱点半径，圆点停在端点时圆缘恰与视口边界相切。
  // 朱线与赭线同在 .chrono__axis 覆盖层的一个 SVG 坐标系：端点 y = --chrono-top + --chrono-bottom，
  // 中点下沉一个 sag——与赭线弧（端点 --chrono-top、中点拱起同 sag）关于内容区中线精确镜像
  function buildCurve() {
    const width = curveLine.ownerSVGElement.getBoundingClientRect().width;
    if (!width) return;
    const pad = DOT_R;
    const y0 =
      readTokenPx('--chrono-top', 200) + readTokenPx('--chrono-bottom', 512);
    const sag = readSagPx();
    curveLine.setAttribute(
      'd',
      'M ' + pad + ',' + y0 + ' Q ' + width / 2 + ',' + (y0 + 2 * sag) + ' ' + (width - pad) + ',' + y0
    );
    pathLen = curveLine.getTotalLength();
  }

  // 拱弧轴线：端点对齐 --chrono-top，中点拱起一个 sag（同坐标系，见 buildCurve）
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
    const q = max > 0 ? clamp(rail.scrollLeft / max, 0, 1) : 1;
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
  // 向下滚＝向旧端（左移）；端点放行，避免横轴困住页面滚动。
  function wheelScroll(deltaY) {
    if (maxScroll() <= 1) return false;
    const settling = glideRaf || Math.abs(scrollTarget - rail.scrollLeft) > 1;
    const current = settling ? scrollTarget : rail.scrollLeft;
    const next = clamp(current - deltaY, 0, maxScroll());
    if (Math.abs(next - current) < 0.5) return false;
    glideTo(next);
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
  let dragged = false;
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return; // 触屏保留浏览器原生惯性与纵向手势
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    cancelAnimationFrame(glideRaf);
    glideRaf = 0;
    dragged = false;
    dragFrom = { x: e.clientX, scroll: rail.scrollLeft };
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragFrom) return;
    if (Math.abs(e.clientX - dragFrom.x) > 5) dragged = true;
    if (!dragged) return;
    scrollTarget = clamp(dragFrom.scroll - (e.clientX - dragFrom.x), 0, maxScroll());
    rail.scrollLeft = scrollTarget;
  });
  rail.addEventListener('click', (e) => {
    if (!dragged) return;
    e.preventDefault();
    dragged = false;
  }, true);
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
      cancelAnimationFrame(glideRaf);
      glideRaf = 0;
      legend.querySelectorAll('[data-cat-filter]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.catFilter === cat));
      });
      items.forEach((li) => {
        li.hidden = !!cat && li.dataset.cat !== cat;
      });
      years.forEach((group) => {
        group.hidden = !group.querySelector('.chrono__item:not([hidden])');
      });
      const visibleCount = rail.querySelectorAll('.chrono__item:not([hidden])').length;
      const count = document.querySelector('[data-archive-count]');
      const empty = document.querySelector('[data-archive-empty]');
      if (count) count.textContent = String(visibleCount);
      chrono.hidden = visibleCount === 0;
      if (empty) empty.hidden = visibleCount !== 0;
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
  document.fonts.ready.then(refresh);
}

/**
 * 诗词竖排列锁页：
 * 1. 题头停靠到正文锚点后，锁住整页纵向滚动
 * 2. 滚轮改为逐列揭示（整列自下上升入），顺序右起
 * 3. 全部列与竖排落款入场后解锁，继续下滑到页脚
 * 4. prefers-reduced-motion / 窄屏 / 无竖排舞台时直接全显
 */
function initCiColumnLock() {
  const stage = document.querySelector('[data-ci-columns]');
  if (!stage) return;

  const body = stage.querySelector('.post-ci__body--vertical');
  const anchor = document.querySelector('.reading-body-anchor');
  if (!body || !anchor) return;

  const columns = Array.from(body.querySelectorAll(':scope > p, :scope > .post-signature--vertical'));
  if (!columns.length) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 1024px)');
  const STEP = 80; // 累计滚轮阈值：约一次刻度揭示一列
  let revealed = 0;
  let locked = false;
  let lockY = 0;
  let pending = 0;

  function revealAll() {
    columns.forEach((col) => col.classList.add('is-revealed'));
    revealed = columns.length;
    pending = 0;
    unlock();
  }

  function unlock() {
    if (!locked) return;
    locked = false;
    pending = 0;
    stage.classList.remove('is-locked');
    document.documentElement.classList.remove('ci-columns-locked');
  }

  function lockAtAnchor() {
    if (locked || revealed >= columns.length) return;
    const header = document.querySelector('.site-header');
    const mast = document.querySelector('.reading-mast');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const mastH = mast ? mast.getBoundingClientRect().height : 0;
    lockY = Math.max(0, Math.round(anchor.getBoundingClientRect().top + window.scrollY - headerH - mastH));
    locked = true;
    pending = 0;
    stage.classList.add('is-locked');
    document.documentElement.classList.add('ci-columns-locked');
    window.scrollTo({ top: lockY, behavior: 'instant' });
  }

  function syncLock() {
    if (reduceMotion.matches || !desktop.matches) {
      revealAll();
      return;
    }
    const header = document.querySelector('.site-header');
    const mast = document.querySelector('.reading-mast');
    const headerH = header ? header.getBoundingClientRect().height : 0;
    const mastH = mast ? mast.getBoundingClientRect().height : 0;
    const target = Math.max(0, Math.round(anchor.getBoundingClientRect().top + window.scrollY - headerH - mastH));
    const y = window.scrollY;
    if (y >= target - 2) {
      if (revealed < columns.length) lockAtAnchor();
      else unlock();
    } else if (locked && y < lockY - 8) {
      // 上滑离开定点：收回未完成的揭示，恢复封面行程
      unlock();
    }
  }

  function onWheel(event) {
    if (!locked || reduceMotion.matches || !desktop.matches) return;
    if (event.ctrlKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    pending += event.deltaY;
    event.preventDefault();

    while (pending >= STEP && revealed < columns.length) {
      columns[revealed].classList.add('is-revealed');
      revealed += 1;
      pending -= STEP;
    }
    while (pending <= -STEP && revealed > 0) {
      revealed -= 1;
      columns[revealed].classList.remove('is-revealed');
      pending += STEP;
    }

    if (revealed >= columns.length) unlock();
    else if (revealed === 0 && pending < -STEP) unlock();
  }

  function onScroll() {
    if (locked) {
      if (Math.abs(window.scrollY - lockY) > 1) {
        window.scrollTo({ top: lockY, behavior: 'instant' });
      }
      return;
    }
    syncLock();
  }

  window.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('scroll', onScroll, { passive: true });
  desktop.addEventListener('change', () => {
    if (!desktop.matches || reduceMotion.matches) revealAll();
    else syncLock();
  });
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) revealAll();
    else {
      columns.forEach((col) => col.classList.remove('is-revealed'));
      revealed = 0;
      syncLock();
    }
  });

  if (reduceMotion.matches || !desktop.matches) revealAll();
  else syncLock();
}
