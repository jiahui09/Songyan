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

  // 3. 封面滚动：越过滚轮阈值后自动完成停靠或回到卷首
  const returnToCover = initCoverScroll();

  // 4. 诗词竖排：定点后锁页，滚轮驱动整列自下而上升入，直至落款可见
  initCiColumnLock(returnToCover);
});

/**
 * 封面只在卷首与正文定点间自动过渡；正文区仍由浏览器原生滚动。
 * 保留 CSS 滚动时间轴，滚轮累计过阈值才启动整段行程，余势不带入正文。
 */
function initCoverScroll() {
  const root = document.documentElement;
  const mast = document.querySelector('.home-cover, .archive-head, .reading-mast');
  const anchor = document.querySelector('.home-dock-zone + .home-sheet, .archive-legend, .reading-body-anchor');
  if (!mast || !anchor || !CSS.supports('animation-timeline: scroll(root block)') ||
      !CSS.supports('animation-range: 0px 1px')) return;

  const media = window.matchMedia('(min-width: 900px) and (prefers-reduced-motion: no-preference)');
  const THRESHOLD = 80;
  const GESTURE_GAP = 180;
  let enabled = false;
  let frame = 0;
  let settleTimer = 0;
  let pending = 0;
  let lastWheel = -Infinity;
  let lastY = window.scrollY;
  let direction = 1;
  let destination = 0;
  let dockPosition = 0;
  let draining = false;
  let dragging = false;

  function dockY() {
    // 页眉占位固定，正文锚点无需再补偿页眉收拢造成的文档高度变化。
    return Math.max(0, anchor.getBoundingClientRect().top + window.scrollY -
      parseFloat(getComputedStyle(anchor).scrollMarginTop));
  }

  function cancel() {
    cancelAnimationFrame(frame);
    clearTimeout(settleTimer);
    frame = 0;
    pending = 0;
    root.classList.remove('cover-scroll-returning');
  }

  function animateTo(end) {
    if (!enabled) return;
    cancel();
    destination = end;
    root.classList.toggle('cover-scroll-returning', !end);
    const from = window.scrollY;
    const started = performance.now();
    const duration = parseFloat(getComputedStyle(root).getPropertyValue('--dur-dock'));
    function tick(now) {
      const progress = Math.min((now - started) / duration, 1);
      const target = destination ? dockY() : 0;
      window.scrollTo({ top: from + (target - from) * (1 - Math.pow(1 - progress, 4)), behavior: 'instant' });
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        lastY = window.scrollY;
        dockPosition = dockY();
        root.classList.remove('cover-scroll-returning');
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function settle() {
    clearTimeout(settleTimer);
    if (!enabled || frame || dragging || root.classList.contains('ci-columns-locked')) return;
    const y = window.scrollY;
    const end = dockY();
    if (y > 2 && y < end - 2) animateTo(direction > 0 ? end : 0);
  }

  function nestedScroll(target, delta) {
    for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
      if (el.scrollHeight <= el.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      if (delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    return false;
  }

  window.addEventListener('wheel', (event) => {
    if (!enabled || event.defaultPrevented || event.ctrlKey || !event.cancelable ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const now = performance.now();
    if (frame || (draining && now - lastWheel < GESTURE_GAP)) {
      event.preventDefault();
      lastWheel = now;
      return;
    }
    draining = false;
    if (root.classList.contains('ci-columns-locked') || nestedScroll(event.target, event.deltaY)) return;
    const end = dockY();
    const y = window.scrollY;
    if (y > end + 2 || (y >= end - 2 && event.deltaY > 0) || (y <= 2 && event.deltaY < 0)) return;
    event.preventDefault();
    clearTimeout(settleTimer);
    const delta = event.deltaY * (event.deltaMode === 1 ? parseFloat(getComputedStyle(root).fontSize) :
      event.deltaMode === 2 ? window.innerHeight : 1);
    if (now - lastWheel > GESTURE_GAP || Math.sign(delta) !== Math.sign(pending)) pending = 0;
    pending += delta;
    lastWheel = now;
    if (Math.abs(pending) >= THRESHOLD) {
      direction = Math.sign(pending);
      draining = true;
      animateTo(direction > 0 ? end : 0);
    }
  }, { passive: false, capture: true });

  window.addEventListener('keydown', (event) => {
    if (!enabled || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, textarea, select, button, a, [contenteditable]') ||
        root.classList.contains('ci-columns-locked')) return;
    const down = ['ArrowDown', 'PageDown', ' '].includes(event.key) && !event.shiftKey;
    const up = ['ArrowUp', 'PageUp'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (!down && !up) return;
    const end = dockY();
    if (window.scrollY > end + 2 || (down && window.scrollY >= end - 2) || (up && window.scrollY <= 2)) return;
    event.preventDefault();
    if (!frame) animateTo(down ? end : 0);
  });

  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y !== lastY) direction = Math.sign(y - lastY);
    lastY = y;
    clearTimeout(settleTimer);
    if (enabled && !frame && !dragging) settleTimer = setTimeout(settle, GESTURE_GAP);
  }, { passive: true });
  window.addEventListener('pointerdown', () => {
    if (!enabled) return;
    dragging = true;
    draining = false;
    cancel();
  }, { passive: true });
  function releasePointer() {
    dragging = false;
    if (enabled) settleTimer = setTimeout(settle, GESTURE_GAP);
  }
  window.addEventListener('pointerup', releasePointer, { passive: true });
  window.addEventListener('pointercancel', releasePointer, { passive: true });
  window.addEventListener('resize', () => {
    if (!enabled || frame) return;
    clearTimeout(settleTimer);
    const wasDocked = Math.abs(lastY - dockPosition) <= 2 && dockPosition > 0;
    dockPosition = dockY();
    if (wasDocked) {
      // 视口改变不等于上滑手势：停靠中的页面继续贴合新定点。
      window.scrollTo({ top: dockPosition, behavior: 'instant' });
      lastY = window.scrollY;
    } else settleTimer = setTimeout(settle, GESTURE_GAP);
  });
  function syncMode() {
    cancel();
    enabled = media.matches;
    draining = false;
    root.classList.toggle('cover-scroll-enabled', enabled);
    if (enabled) {
      dockPosition = dockY();
      settleTimer = setTimeout(settle, GESTURE_GAP);
    }
  }
  media.addEventListener('change', syncMode);
  syncMode();
  return () => animateTo(0);
}

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
 * 2. 指针拖曳（跨出轨道仍持续，松手后恢复原生链接点击）
 * 3. 进度朱点——弧路径按像素宽重建，端点内缩 ≥ 朱点半径防视口裁切；
 *    朱点按滚动进度映射弧长（右端＝最新，左端＝最旧）
 * 4. 平滑缓动——滚轮以目标位 + rAF 阻尼插值推进，阻尼放缓求丝滑（reduced-motion 直接落位）
 * 5. 分卷图例筛选——点按只留该分卷篇目，年份组无可见篇目整组隐去
 * 6. 拱弧骑列——轴线弧与朱线上下镜像，日列/年号按视口横位以 --curve-y 骑弧（平面，无透视）
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

  // 与 CSS 移动纵轴断点一致：窄屏只做分卷筛选，不做横滑/双弧
  const desktopRail = window.matchMedia('(min-width: 900px)');

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
    const entry = rail.querySelector('.chrono__year:not([hidden]) .chrono__entry');
    const y0 = readSagPx() + readTokenPx('--chrono-top', 200) + (entry ? entry.offsetHeight : 0);
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
    const y0 = readSagPx() + readTokenPx('--chrono-top', 200);
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
  // 滚动时逐帧更新，日列、年号、节点墨点与弧线同步抬落（平面纸卷，不做圆柱透视）
  const shiftTargets = rail.querySelectorAll('.chrono__item, .chrono__year-mark');
  function updateShift() {
    const railRect = rail.getBoundingClientRect();
    if (!railRect.width) return;
    const sag = readSagPx();
    shiftTargets.forEach((el) => {
      if (!el.getClientRects().length) return;
      const rect = el.getBoundingClientRect();
      const center = rect.left + rect.width / 2;
      const t = clamp((center - railRect.left) / railRect.width, 0, 1);
      el.style.setProperty('--curve-y', (-4 * sag * t * (1 - t)).toFixed(2) + 'px');
    });
  }

  function clearCurveMetrics() {
    shiftTargets.forEach((el) => el.style.removeProperty('--curve-y'));
    if (curveLine) curveLine.removeAttribute('d');
    if (axisLine) axisLine.removeAttribute('d');
  }

  // 版面重建：桌面重建双弧/骑弧；窄屏清空横轴度量
  function refresh() {
    if (!desktopRail.matches) {
      clearCurveMetrics();
      return;
    }
    buildCurve();
    buildAxis();
    updateDot();
    updateShift();
  }

  // —— 平滑缓动：目标位 + rAF 阻尼插值；reduced-motion 直接落位 ——
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  let scrollTarget = 0;
  let glideRaf = 0;
  let lastFrame = 0;
  let glidePosition = 0;
  let knownMax = 0;
  let readingProgress = 1;

  function stopGlide() {
    cancelAnimationFrame(glideRaf);
    glideRaf = 0;
    lastFrame = 0;
    scrollTarget = rail.scrollLeft;
  }

  function maxScroll() {
    return Math.max(rail.scrollWidth - rail.clientWidth, 0);
  }

  function glide(now) {
    const elapsed = Math.min(now - lastFrame, 64);
    lastFrame = now;
    const diff = scrollTarget - glidePosition;
    if (Math.abs(diff) < 0.5) {
      rail.scrollLeft = scrollTarget;
      glideRaf = 0;
      return;
    }
    // 按经过时间衰减，60Hz / 120Hz 显示器保持相同阻尼。
    glidePosition += diff * (1 - Math.exp(-elapsed / 180));
    rail.scrollLeft = glidePosition;
    glideRaf = requestAnimationFrame(glide);
  }

  function glideTo(next) {
    scrollTarget = clamp(next, 0, maxScroll());
    if (reduceMotion.matches) {
      const target = scrollTarget;
      stopGlide();
      rail.scrollLeft = scrollTarget = target;
      return;
    }
    if (!glideRaf) {
      lastFrame = performance.now();
      glidePosition = rail.scrollLeft;
      glideRaf = requestAnimationFrame(glide);
    }
  }

  // 滚轮横移：ltr 坐标（scrollLeft 0 在左＝最旧端，max 在右＝最新端）；
  // 向下滚＝向旧端（左移）；端点放行，避免横轴困住页面滚动。
  function wheelScroll(deltaY) {
    if (maxScroll() <= 1) return false;
    const settling = glideRaf || Math.abs(scrollTarget - rail.scrollLeft) > 1;
    const current = settling ? scrollTarget : rail.scrollLeft;
    const next = clamp(current - deltaY, 0, maxScroll());
    if (Math.abs(next - current) < 0.5) {
      // 目标先到边缘时，先收完余程再把纵向滚动交还页面。
      return !!glideRaf;
    }
    glideTo(next);
    return true;
  }

  rail.addEventListener(
    'wheel',
    (e) => {
      if (!desktopRail.matches) return; // 窄屏纵轴：滚轮交还页面
      if (e.defaultPrevented || e.ctrlKey) return; // 封面过渡与浏览器缩放手势放行
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        stopGlide(); // 原生横向手势接管时取消纵向滚轮缓动
        return;
      }
      const unit = e.deltaMode === 1 ? parseFloat(getComputedStyle(rail).lineHeight) :
        e.deltaMode === 2 ? rail.clientWidth : 1;
      if (wheelScroll(e.deltaY * unit)) e.preventDefault();
    },
    { passive: false }
  );

  // 指针拖曳：内容随手势而动（拖曳跟手，接管时先打断缓动）
  let dragFrom = null;
  let dragged = false;
  rail.addEventListener('pointerdown', (e) => {
    if (!desktopRail.matches) return;
    stopGlide();
    if (e.pointerType !== 'mouse') return; // 触屏保留浏览器原生惯性与纵向手势
    if (e.button !== 0) return;
    dragged = false;
    dragFrom = { x: e.clientX, scroll: rail.scrollLeft, id: e.pointerId };
  });
  rail.addEventListener('pointermove', (e) => {
    if (!dragFrom || e.pointerId !== dragFrom.id) return;
    if (!dragged && Math.abs(e.clientX - dragFrom.x) > 5 && maxScroll() > 1) {
      dragged = true;
      rail.classList.add('is-dragging');
      rail.setPointerCapture(e.pointerId);
    }
    if (!dragged) return;
    e.preventDefault();
    scrollTarget = clamp(dragFrom.scroll - (e.clientX - dragFrom.x), 0, maxScroll());
    rail.scrollLeft = scrollTarget;
  });
  rail.addEventListener('click', (e) => {
    if (!dragged) return;
    e.preventDefault();
    dragged = false;
  }, true);
  function endDrag() {
    const id = dragFrom?.id;
    dragFrom = null;
    rail.classList.remove('is-dragging');
    if (id !== undefined && rail.hasPointerCapture(id)) rail.releasePointerCapture(id);
  }
  ['pointerup', 'pointercancel', 'blur'].forEach(evt => window.addEventListener(evt, endDrag));
  rail.addEventListener('lostpointercapture', endDrag);
  rail.addEventListener('dragstart', event => event.preventDefault());

  rail.addEventListener('keydown', (event) => {
    if (!desktopRail.matches) return;
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    let next;
    if (event.key === 'ArrowLeft') next = rail.scrollLeft - rail.clientWidth / 4;
    else if (event.key === 'ArrowRight') next = rail.scrollLeft + rail.clientWidth / 4;
    else if (event.key === 'Home') next = maxScroll();
    else if (event.key === 'End') next = 0;
    else return;
    event.preventDefault();
    glideTo(next);
  });
  rail.addEventListener('focusin', (event) => {
    if (!desktopRail.matches) return;
    const entry = event.target.closest('.chrono__entry');
    if (!entry) return;
    stopGlide();
    const bounds = rail.getBoundingClientRect();
    const rect = entry.getBoundingClientRect();
    const inset = bounds.width * 0.03 + readTokenPx('--space-4', 16);
    if (rect.left < bounds.left + inset) rail.scrollLeft += rect.left - bounds.left - inset;
    else if (rect.right > bounds.right - inset) rail.scrollLeft += rect.right - bounds.right + inset;
    scrollTarget = rail.scrollLeft;
  });

  // 滚动事件本身已按帧节流，直接同步朱点；
  // 非缓动、非拖曳期的外部滚动（触屏惯性）同步目标位，防后续滚轮跳位
  rail.addEventListener(
    'scroll',
    () => {
      if (!desktopRail.matches) return;
      if (!glideRaf && !dragFrom) scrollTarget = rail.scrollLeft;
      if (knownMax === maxScroll()) readingProgress = knownMax > 1 ? rail.scrollLeft / knownMax : 1;
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
      stopGlide();
      endDrag();
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
      // 版面变了：桌面回停最新端并重建弧线；窄屏仅刷新筛选态
      if (desktopRail.matches) {
        rail.scrollLeft = rail.scrollWidth;
        scrollTarget = rail.scrollLeft;
        knownMax = maxScroll();
        readingProgress = 1;
      }
      refresh();
    };
    legend.querySelectorAll('[data-cat-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyFilter(btn.getAttribute('aria-pressed') === 'true' ? '' : btn.dataset.catFilter);
      });
    });
  }

  function refreshLayout() {
    stopGlide();
    endDrag();
    if (!desktopRail.matches) {
      rail.scrollLeft = 0;
      scrollTarget = 0;
      knownMax = 0;
      refresh();
      return;
    }
    knownMax = maxScroll();
    rail.scrollLeft = scrollTarget = clamp(readingProgress, 0, 1) * knownMax;
    refresh();
  }
  if ('ResizeObserver' in window) {
    const observer = new ResizeObserver(refreshLayout);
    observer.observe(rail);
    observer.observe(track);
  } else window.addEventListener('resize', refreshLayout);
  reduceMotion.addEventListener('change', () => {
    const target = scrollTarget;
    stopGlide();
    if (reduceMotion.matches) rail.scrollLeft = scrollTarget = target;
    refresh();
  });
  desktopRail.addEventListener('change', refreshLayout);

  // 初始：桌面停驻最新端；窄屏纵轴不横滚。字体与视口变化后保留阅读进度。
  if (desktopRail.matches) {
    knownMax = maxScroll();
    rail.scrollLeft = scrollTarget = knownMax;
  } else {
    rail.scrollLeft = scrollTarget = 0;
  }
  refresh();
  document.fonts.ready.then(refreshLayout);
}

/**
 * 诗词竖排列锁页：
 * 1. 题头停靠到正文锚点后，锁住整页纵向滚动
 * 2. 滚轮改为逐列揭示（整列自下上升入），顺序右起
 * 3. 全部列与竖排落款入场后解锁，继续下滑到页脚
 * 4. prefers-reduced-motion / 窄屏 / 无竖排舞台时直接全显
 */
function initCiColumnLock(returnToCover) {
  const stage = document.querySelector('[data-ci-columns]');
  if (!stage) return;

  const body = stage.querySelector('.post-ci__body--vertical');
  const anchor = document.querySelector('.reading-body-anchor');
  if (!body || !anchor) return;

  const lines = Array.from(body.querySelectorAll(':scope > p'));
  const signature = body.querySelector(':scope > .post-signature--vertical');
  const steps = lines.length + (signature ? 2 : 0); // 列… → 落款字 → 末拍盖章
  if (!steps) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 1024px)');
  const STEP = 80; // 累计滚轮阈值：约一次刻度揭示一列
  let revealed = 0;
  let locked = false;
  let lockY = 0;
  let pending = 0;

  function applyStep(count) {
    lines.forEach((line, index) => {
      line.classList.toggle('is-revealed', index < count);
    });
    if (signature) {
      const showMeta = count > lines.length;
      const showSeal = count > lines.length + 1;
      signature.classList.toggle('is-revealed', showMeta);
      signature.classList.toggle('is-stamped', showSeal);
    }
  }

  function revealAll() {
    revealed = steps;
    applyStep(revealed);
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
    if (locked || revealed >= steps) return;
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
    if (document.documentElement.classList.contains('cover-scroll-returning')) return;
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
      if (revealed < steps) lockAtAnchor();
      else unlock();
    } else if (locked && y < lockY - 8) {
      // 上滑离开定点：收回未完成的揭示，恢复封面行程
      unlock();
    }
  }

  function onWheel(event) {
    if (!locked || event.defaultPrevented || reduceMotion.matches || !desktop.matches) return;
    if (event.ctrlKey) return;
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;

    pending += event.deltaY;
    event.preventDefault();

    while (pending >= STEP && revealed < steps) {
      revealed += 1;
      applyStep(revealed);
      pending -= STEP;
    }
    while (pending <= -STEP && revealed > 0) {
      revealed -= 1;
      applyStep(revealed);
      pending += STEP;
    }

    if (revealed >= steps) unlock();
    else if (revealed === 0 && pending <= -STEP) {
      unlock();
      if (returnToCover) returnToCover();
    }
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
      revealed = 0;
      applyStep(0);
      syncLock();
    }
  });

  if (reduceMotion.matches || !desktop.matches) revealAll();
  else syncLock();
}
