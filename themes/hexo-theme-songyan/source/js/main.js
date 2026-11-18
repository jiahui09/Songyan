/**
 * 「松烟」主交互脚本 (main.js)
 * 严格遵从：
 * 1. 原生 JavaScript，无任何框架与 CDN 依赖
 * 2. DOMContentLoaded 后初始化
 * 3. 唯一定义的入场动效「落墨」：320ms，cubic-bezier(0.22, 1, 0.36, 1)
 * 4. 首页唯一印章盖下动效：400ms，仅一次
 * 5. 交互反馈：160ms
 * 6. 归档圆柱时间轴使用独立视口控制器，仅在时间轴本体内消费横纵滚轮
 */

document.addEventListener('DOMContentLoaded', () => {
  initCylinderArchive();

  // 1. 落墨动效：首页归流只整体入场，不再单独触发条目与条目标题
  initLuoMoAnimation();

  // 3. 封面滚动：越过滚轮阈值后自动完成停靠或回到卷首
  const returnToCover = initCoverScroll();

  // 4. 诗词竖排：定点后锁页，滚轮驱动整列自下而上升入，直至落款可见
  initCiColumnLock(returnToCover);

  // 5. 静读模式：阅读页按 Q 收敛页眉页脚与工具
  initQuietReading();
});

function initCylinderArchive() {
  const viewport = document.querySelector('.archive-cylinder');
  if (!viewport) return;
  const stage = viewport.querySelector('.timeline-stage');
  const svg = viewport.querySelector('.rail-svg');
  const pathYear = svg.querySelector('.rail-year');
  const yearStage = viewport.querySelector('.year-stage');
  const pathUpper = svg.querySelector('.rail-path--upper');
  const pathLower = svg.querySelector('.rail-path--lower');
  const echoUpper = svg.querySelector('.rail-echo--upper');
  const echoLower = svg.querySelector('.rail-echo--lower');
  const tickUpper = svg.querySelector('.rail-center-tick--upper');
  const tickLower = svg.querySelector('.rail-center-tick--lower');
  const nodes = JSON.parse(decodeURIComponent(viewport.dataset.archiveNodes || '[]'));
  if (!nodes.length) return;

  const monthDay = dateValue => {
    const value = new Date(`${dateValue}T00:00:00`);
    const month = value.getMonth() + 1;
    const day = value.getDate();
    const han = number => number < 10 ? '〇一二三四五六七八九'[number] : number < 20 ? `十${number % 10 ? '〇一二三四五六七八九'[number % 10] : ''}` : `${'〇一二三四五六七八九'[Math.floor(number / 10)]}十${number % 10 ? '〇一二三四五六七八九'[number % 10] : ''}`;
    return { year: String(value.getFullYear()), month: han(month), day: han(day) };
  };
  nodes.forEach(item => Object.assign(item, monthDay(item.date)));
  const YEARS = [...new Set(nodes.map(item => item.year))];
  const yearViews = YEARS.map(year => {
    const label = document.createElement('span');
    label.className = 'year-node';
    label.textContent = year;
    yearStage.appendChild(label);
    return label;
  });
  const monthLabel = document.createElement('span');
  monthLabel.className = 'year-month';
  const wordSegmenter = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
  let displayedMonth = '';
  let pendingMonth = '';
  let pendingYearIdx = -1;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const metrics = { width: 1080, height: 560, radiusX: 540, radiusZ: 210, perspective: 1150, stepAngle: 0.245, waistHalfGap: 158, curveSag: 98, halfSpan: 540, dockGap: 16 };
  let scrollPos = Math.min(5, nodes.length - 1);
  let targetScrollPos = scrollPos;
  let yearScrollPos = YEARS.indexOf(nodes[Math.round(scrollPos)].year);
  let rafId = 0;
  let wheelSnapTimer = null;
  let wheelAnchor = null;
  let wheelDirection = 0;
  let lastWheelTime = 0;
  let isDragging = false;
  let pointerId = null;
  let pointerCaptured = false;
  let dragStartX = 0;
  let dragStartTarget = 0;
  let dragDistance = 0;
  let lastPointerX = 0;
  let lastPointerTime = 0;
  let dragVelocity = 0;

  const nodeViews = nodes.map((item, idx) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'timeline-node';
    btn.dataset.index = String(idx);
    btn.dataset.cat = item.category;
    btn.setAttribute('aria-label', `${item.year}年${item.month}月${item.day}日：${item.title}`);

    const upper = document.createElement('span');
    upper.className = 'node-upper';
    const dot = document.createElement('span');
    dot.className = 'ink-dot';
    dot.setAttribute('aria-hidden', 'true');
    const date = document.createElement('span');
    date.className = 'node-date';
    date.textContent = `${item.day}日${item.solarTerm ? ` · ${item.solarTerm}` : ''}`;
    upper.append(date);

    const lower = document.createElement('span');
    lower.className = 'node-lower';
    const title = document.createElement('span');
    title.className = 'node-title';
    title.classList.toggle('is-compact', Array.from(item.title).length > 10);
    title.textContent = item.title;
    lower.append(dot, title);
    btn.append(upper, lower);
    stage.appendChild(btn);
    btn.addEventListener('click', event => {
      if (draggedClick) {
        event.preventDefault();
        draggedClick = false;
        return;
      }
      const visibleIndex = getVisibleIndex(idx);
      if (visibleIndex < 0) return;
      if (Math.abs(visibleIndex - scrollPos) <= 0.08 && Math.abs(visibleIndex - targetScrollPos) <= 0.08) {
        window.location.assign(item.href);
        return;
      }
      focusNode(visibleIndex);
    });
    return { idx, item, btn, upper, lower, title, upperH: 82, lowerH: 150 };
  });

  let draggedClick = false;
  const clampScroll = value => {
    const visibleCount = nodeViews.filter(view => !activeCategory || view.item.category === activeCategory).length;
    return Math.max(0, Math.min(Math.max(0, visibleCount - 1), value));
  };
  function getVisibleIndex(nodeIndex) {
    const visible = nodeViews.filter(view => !activeCategory || view.item.category === activeCategory);
    return visible.findIndex(view => view.idx === nodeIndex);
  }
  function getCurveBounds(x) {
    const cy = metrics.height / 2;
    const nx = Math.max(-1, Math.min(1, x / metrics.halfSpan));
    const curveOffset = metrics.curveSag * (nx * nx);
    return {
      yTop: cy - metrics.waistHalfGap - curveOffset,
      yBottom: cy + metrics.waistHalfGap + curveOffset
    };
  }
  function buildRailPaths() {
    const { width, height } = metrics;
    let year = '';
    let top = '';
    let bottom = '';
    let topEcho = '';
    let bottomEcho = '';
    for (let step = 0; step <= 84; step++) {
      const px = step / 84 * width;
      const { yTop, yBottom } = getCurveBounds(px - width / 2);
      const command = step === 0 ? 'M' : 'L';
      year += `${command}${px.toFixed(1)},${(yTop - metrics.yearRailOffset).toFixed(1)} `;
      top += `${command}${px.toFixed(1)},${yTop.toFixed(1)} `;
      bottom += `${command}${px.toFixed(1)},${yBottom.toFixed(1)} `;
      topEcho += `${command}${px.toFixed(1)},${(yTop - 3.5).toFixed(1)} `;
      bottomEcho += `${command}${px.toFixed(1)},${(yBottom + 3.5).toFixed(1)} `;
    }
    pathYear.setAttribute('d', year);
    pathUpper.setAttribute('d', top);
    pathLower.setAttribute('d', bottom);
    echoUpper.setAttribute('d', topEcho);
    echoLower.setAttribute('d', bottomEcho);
    const center = getCurveBounds(0);
    [[tickUpper, center.yTop - 11, center.yTop - 3], [tickLower, center.yBottom + 3, center.yBottom + 11]].forEach(([line, y1, y2]) => {
      line.setAttribute('x1', (width / 2).toFixed(1));
      line.setAttribute('x2', (width / 2).toFixed(1));
      line.setAttribute('y1', y1.toFixed(1));
      line.setAttribute('y2', y2.toFixed(1));
    });
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  function layoutTitles(maxTitleH) {
    nodeViews.forEach(view => {
      const { title, item } = view;
      const col = document.createElement('span');
      col.className = 'title-col';
      title.replaceChildren(col);
      title.classList.add('is-measuring');
      const fits = text => {
        col.textContent = text;
        return col.scrollHeight <= maxTitleH;
      };
      if (!fits(item.title)) {
        // 按词分段，英文单词和中文词组作为原子；不可容纳的单个长词整体省略。
        const tokens = wordSegmenter ? Array.from(wordSegmenter.segment(item.title), part => part.segment) : item.title.match(/\s+|[·：:—,，、。；;!?！？]+|[^\s·：:—,，、。；;!?！？]+/gu) || [];
        let end = 0;
        while (end < tokens.length && fits(tokens.slice(0, end + 1).join('').trim())) end++;
        let split = end;
        for (let i = end; i > 0; i--) {
          if (/[·：:—\s]$/u.test(tokens[i - 1]) && fits(tokens.slice(i).join('').trim())) {
            split = i;
            break;
          }
        }
        let first = tokens.slice(0, split).join('').trim();
        const rest = tokens.slice(split);
        let second = rest.join('').trim();
        if (!fits(second)) {
          let count = 0;
          while (count < rest.length && fits(`${rest.slice(0, count + 1).join('').trim()}…`)) count++;
          second = `${rest.slice(0, count).join('').trim()}…`;
        }
        if (!first) {
          first = '…';
          second = '';
        }
        col.textContent = first;
        if (second) {
          const nextCol = document.createElement('span');
          nextCol.className = 'title-col';
          nextCol.textContent = second;
          title.appendChild(nextCol);
        }
      }
      title.classList.remove('is-measuring');
    });
  }
  function measureNodeSizes() {
    nodeViews.forEach(view => {
      const upperH = parseFloat(getComputedStyle(view.upper).height);
      const lowerH = parseFloat(getComputedStyle(view.lower).height);
      if (upperH > 0) view.upperH = upperH;
      if (lowerH > 0) view.lowerH = lowerH;
    });
  }
  function updateMetrics() {
    const rect = viewport.getBoundingClientRect();
    const width = Math.max(320, Math.round(rect.width));
    const height = Math.max(400, Math.round(rect.height));
    metrics.width = width;
    metrics.height = height;
    metrics.halfSpan = width * 0.5;
    metrics.radiusX = Math.max(240, width * 0.51);
    metrics.radiusZ = Math.max(115, width * 0.195);
    metrics.stepAngle = width < 600 ? 0.30 : 0.245;
    const styles = getComputedStyle(viewport);
    metrics.yearRailOffset = parseFloat(styles.getPropertyValue('--year-rail-offset'));
    metrics.yearNodePitch = parseFloat(styles.getPropertyValue('--year-node-pitch'));
    metrics.safePad = parseFloat(styles.getPropertyValue('--rail-safe-pad'));
    metrics.dockGap = parseFloat(styles.getPropertyValue('--dock-gap'));
    measureNodeSizes();
    const maxUpperH = Math.max(...nodeViews.map(view => view.upperH));
    const targetTitleH = parseFloat(styles.getPropertyValue('--title-target-h'));
    // 扩大腰部净高，保留原有抛物曲率；短窗口由视口最小高度承接。
    const baseWaist = Math.min(158, Math.max(138, height * 0.30));
    metrics.curveSag = Math.max(0, Math.min(112, height / 2 - baseWaist - metrics.yearRailOffset - metrics.safePad));
    metrics.waistHalfGap = Math.max(baseWaist, (targetTitleH + maxUpperH + metrics.dockGap + metrics.safePad * 2) / 2);
    const maxTitleH = Math.floor(metrics.waistHalfGap * 2 - maxUpperH - metrics.dockGap - metrics.safePad * 2);
    viewport.style.setProperty('--max-title-h', `${maxTitleH}px`);
    layoutTitles(maxTitleH);
    measureNodeSizes();
    buildRailPaths();
    renderTimeline();
    renderYearRail();
  }
  function renderTimeline() {
    const centerY = metrics.height / 2;
    const visibleNodes = nodeViews.filter(view => !activeCategory || view.item.category === activeCategory);
    const filteredPosition = new Map(visibleNodes.map((view, index) => [view.idx, index]));
    nodeViews.forEach(view => {
      const filtered = !filteredPosition.has(view.idx);
      const logicalIndex = filtered ? view.idx : filteredPosition.get(view.idx);
      const u = logicalIndex - scrollPos;
      const absU = Math.abs(u);
      const theta = u * metrics.stepAngle;
      if (Math.abs(theta) > 1.38) {
        view.btn.style.opacity = '0';
        view.btn.style.pointerEvents = 'none';
        view.btn.dataset.centered = 'false';
        return;
      }
      const x = metrics.radiusX * Math.sin(theta);
      const z = -metrics.radiusZ * (1 - Math.cos(theta));
      const scale = metrics.perspective / (metrics.perspective - z);
      const tiltZDeg = -theta * 11.2 || 0;
      const yawYDeg = theta * 25.0;
      const dock = Math.exp(-(u * u) / 0.34);
      const { yTop, yBottom } = getCurveBounds(x);
      const mergedHeight = view.upperH + metrics.dockGap + view.lowerH;
      const dockedUpperTop = Math.max(yTop + metrics.safePad, Math.min(centerY - mergedHeight / 2, yBottom - metrics.safePad - mergedHeight));
      const dockedLowerTop = dockedUpperTop + view.upperH + metrics.dockGap;
      const railPad = metrics.safePad;
      const pieceScale = scale + (1 - scale) * dock;
      // 两端与停靠位置都先留足字高与安全边距，再插值，确保整个过渡留在夹缝内。
      const upperTop = yTop + railPad + (dockedUpperTop - yTop - railPad) * dock;
      const lowerRailTop = yBottom - railPad - view.lowerH * pieceScale;
      const lowerTop = lowerRailTop + (dockedLowerTop - lowerRailTop) * dock;
      const edgeFade = Math.max(0, 1 - Math.pow(absU / 4.2, 2.2));
      const opacity = (0.42 + 0.58 * Math.exp(-absU * 0.35)) * edgeFade * (filtered ? 0 : 1);
      view.btn.style.opacity = opacity.toFixed(3);
      view.btn.style.pointerEvents = opacity > 0.08 && !filtered ? 'auto' : 'none';
      view.btn.style.zIndex = String(Math.round(100 - absU * 10));
      view.btn.style.transform = `translate3d(${x.toFixed(2)}px, 0, ${z.toFixed(2)}px) rotateY(${yawYDeg.toFixed(3)}deg) rotateZ(${tiltZDeg.toFixed(3)}deg)`;
      view.upper.style.transform = `translate3d(-50%, ${upperTop.toFixed(2)}px, 0) scale(${pieceScale.toFixed(4)})`;
      view.lower.style.transform = `translate3d(-50%, ${lowerTop.toFixed(2)}px, 0) scale(${pieceScale.toFixed(4)})`;
      view.btn.classList.toggle('is-centered', absU < 0.14);
      view.btn.dataset.centered = absU < 0.14 ? 'true' : 'false';
      view.btn.dataset.tiltZ = tiltZDeg.toFixed(3);
      view.btn.dataset.dock = dock.toFixed(3);
    });
    viewport.dataset.activeIndex = String(Math.round(scrollPos));
  }
  function renderYearRail() {
    yearViews.forEach((label, index) => {
      const x = (index - yearScrollPos) * metrics.yearNodePitch;
      const { yTop } = getCurveBounds(x);
      const slope = -2 * metrics.curveSag * Math.max(-metrics.halfSpan, Math.min(metrics.halfSpan, x)) / (metrics.halfSpan * metrics.halfSpan);
      const tilt = Math.atan(slope) * 180 / Math.PI * 0.35;
      label.style.transform = `translate(-50%, -50%) translate(${x.toFixed(2)}px, ${(yTop - metrics.yearRailOffset).toFixed(2)}px) rotate(${tilt.toFixed(3)}deg)`;
      label.classList.toggle('is-centered', Math.abs(index - yearScrollPos) < 0.01);
    });
  }
  function updateMonthLabel(activePost) {
    const yearIdx = YEARS.indexOf(activePost.year);
    const month = `${activePost.month}月`;
    if (yearIdx === pendingYearIdx && month === pendingMonth) return;
    pendingYearIdx = yearIdx;
    pendingMonth = month;
    if (!displayedMonth || reduceMotion) {
      commitMonthLabel();
    } else {
      monthLabel.classList.add('is-fading');
    }
  }
  function commitMonthLabel() {
    displayedMonth = pendingMonth;
    monthLabel.textContent = displayedMonth;
    if (monthLabel.parentElement !== yearViews[pendingYearIdx]) {
      yearViews[pendingYearIdx].appendChild(monthLabel);
      // 跨年换父节点后先落实透明态，再启动淡入。
      getComputedStyle(monthLabel).opacity;
    }
    monthLabel.classList.remove('is-fading');
  }
  monthLabel.addEventListener('transitionend', event => {
    if (event.propertyName === 'opacity' && monthLabel.classList.contains('is-fading')) commitMonthLabel();
  });
  function focusNode(index) {
    clearTimeout(wheelSnapTimer);
    wheelAnchor = null;
    targetScrollPos = clampScroll(index);
    if (reduceMotion) {
      scrollPos = targetScrollPos;
      renderTimeline();
    }
  }
  let activeCategory = '';
  const filterGroup = document.querySelector('.archive-legend');
  function applyCategoryFilter(category) {
    activeCategory = category;
    if (filterGroup) filterGroup.querySelectorAll('[data-cat-filter]').forEach(button => {
      button.setAttribute('aria-pressed', String(button.dataset.catFilter === activeCategory));
    });
    nodeViews.forEach(view => {
      const filtered = !!activeCategory && view.item.category !== activeCategory;
      view.btn.classList.toggle('is-filtered', filtered);
      view.btn.setAttribute('aria-hidden', String(filtered));
      view.btn.tabIndex = filtered ? -1 : 0;
    });
    document.querySelectorAll('[data-archive-list] .archive-list__item').forEach(item => {
      item.classList.toggle('is-dimmed', !!activeCategory && item.dataset.cat !== activeCategory);
    });
    const count = document.querySelector('[data-archive-count]');
    const visible = nodes.reduce((total, item) => total + (!activeCategory || item.category === activeCategory ? 1 : 0), 0);
    if (count) count.textContent = String(visible);
    const empty = document.querySelector('[data-archive-empty]');
    if (empty) empty.hidden = visible > 0;
    viewport.classList.toggle('is-empty', visible === 0);
    viewport.hidden = visible === 0;
    const archiveMain = document.querySelector('.site-main--archive');
    if (archiveMain) archiveMain.classList.toggle('is-archive-empty', visible === 0);
    const listPanel = document.querySelector('[data-archive-list]');
    if (listPanel) listPanel.hidden = visible === 0;
    const firstVisible = nodeViews.find(view => !activeCategory || view.item.category === activeCategory);
    if (firstVisible) focusNode(0);
  }
  if (filterGroup) filterGroup.querySelectorAll('[data-cat-filter]').forEach(button => {
    button.addEventListener('click', () => {
      applyCategoryFilter(button.getAttribute('aria-pressed') === 'true' ? '' : button.dataset.catFilter);
    });
  });

  function tick() {
    const difference = targetScrollPos - scrollPos;
    if (Math.abs(difference) > 0.0005) {
      scrollPos += difference * (isDragging ? 0.28 : 0.11);
      renderTimeline();
    } else if (scrollPos !== targetScrollPos) {
      scrollPos = targetScrollPos;
      renderTimeline();
    }
    const visibleNodes = nodeViews.filter(view => !activeCategory || view.item.category === activeCategory);
    const activePost = visibleNodes[Math.max(0, Math.min(visibleNodes.length - 1, Math.round(scrollPos)))]?.item;
    if (activePost) {
      updateMonthLabel(activePost);
      const targetYearIdx = YEARS.indexOf(activePost.year);
      const yearDifference = targetYearIdx - yearScrollPos;
      if (Math.abs(yearDifference) > 0.0005) {
        yearScrollPos = reduceMotion ? targetYearIdx : yearScrollPos + yearDifference * 0.1;
        renderYearRail();
      } else if (yearScrollPos !== targetYearIdx) {
        yearScrollPos = targetYearIdx;
        renderYearRail();
      }
    }
    rafId = requestAnimationFrame(tick);
  }
  viewport.addEventListener('wheel', event => {
    event.preventDefault();
    const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? metrics.height : 1;
    const delta = rawDelta * unit;
    if (!Number.isFinite(delta) || delta === 0) return;
    const now = performance.now();
    const direction = Math.sign(delta);
    if (wheelAnchor === null || now - lastWheelTime > 180 || direction !== wheelDirection) {
      wheelAnchor = clampScroll(Math.round(targetScrollPos));
      wheelDirection = direction;
    }
    lastWheelTime = now;
    // 一次连续手势只推进到相邻文章，吸附后继续消耗惯性尾帧。
    const nextStop = clampScroll(wheelAnchor + direction);
    const nextTarget = targetScrollPos + delta * 0.0032;
    targetScrollPos = clampScroll(direction > 0 ? Math.min(nextStop, nextTarget) : Math.max(nextStop, nextTarget));
    if (reduceMotion) {
      scrollPos = Math.round(targetScrollPos);
      targetScrollPos = scrollPos;
      renderTimeline();
      return;
    }
    clearTimeout(wheelSnapTimer);
    wheelSnapTimer = setTimeout(() => { targetScrollPos = clampScroll(Math.round(targetScrollPos)); }, 150);
  }, { passive: false });
  viewport.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    isDragging = true;
    pointerId = event.pointerId;
    pointerCaptured = false;
    dragStartX = event.clientX;
    lastPointerX = event.clientX;
    lastPointerTime = performance.now();
    dragStartTarget = targetScrollPos;
    wheelAnchor = null;
    dragDistance = 0;
    dragVelocity = 0;
    clearTimeout(wheelSnapTimer);
    viewport.classList.add('is-dragging');
  });
  viewport.addEventListener('pointermove', event => {
    if (!isDragging || event.pointerId !== pointerId) return;
    const now = performance.now();
    const dx = event.clientX - dragStartX;
    dragDistance = Math.max(dragDistance, Math.abs(dx));
    if (!pointerCaptured && dragDistance > 4 && pointerId !== null) {
      viewport.setPointerCapture(pointerId);
      pointerCaptured = true;
    }
    if (!pointerCaptured) return;
    const pixelsPerNode = Math.max(120, metrics.radiusX * metrics.stepAngle);
    targetScrollPos = clampScroll(dragStartTarget - dx / pixelsPerNode);
    const elapsed = Math.max(8, now - lastPointerTime);
    dragVelocity = -(event.clientX - lastPointerX) / pixelsPerNode / (elapsed / 16.67);
    lastPointerX = event.clientX;
    lastPointerTime = now;
  });
  function finishDrag(event) {
    if (!isDragging) return;
    isDragging = false;
    viewport.classList.remove('is-dragging');
    if (pointerCaptured && event.pointerId !== undefined && viewport.hasPointerCapture(event.pointerId)) viewport.releasePointerCapture(event.pointerId);
    if (dragDistance > 4) {
      draggedClick = true;
      const coast = Math.max(-1.8, Math.min(1.8, dragVelocity * 5.5));
      targetScrollPos = clampScroll(Math.round(targetScrollPos + coast));
    }
    pointerId = null;
    pointerCaptured = false;
  }
  viewport.addEventListener('pointerup', finishDrag);
  viewport.addEventListener('pointercancel', finishDrag);
  window.addEventListener('blur', () => finishDrag({}));
  window.addEventListener('keydown', event => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    if (event.key === 'ArrowLeft') { event.preventDefault(); focusNode(Math.round(targetScrollPos) - 1); }
    else if (event.key === 'ArrowRight') { event.preventDefault(); focusNode(Math.round(targetScrollPos) + 1); }
  });
  const resizeObserver = new ResizeObserver(updateMetrics);
  resizeObserver.observe(viewport);
  nodeViews.forEach(view => {
    resizeObserver.observe(view.upper);
    resizeObserver.observe(view.lower);
  });
  document.fonts.ready.then(updateMetrics);
  updateMetrics();
  rafId = requestAnimationFrame(tick);
}

function initQuietReading() {
  if (!document.querySelector('.site-main--reading')) return;
  window.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target;
    if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
    if (event.key !== 'q' && event.key !== 'Q') return;
    document.documentElement.classList.toggle('is-quiet-reading');
  });
}

/**
 * 封面只在卷首与正文定点间自动过渡；正文区仍由浏览器原生滚动。
 * 保留 CSS 滚动时间轴，滚轮累计过阈值才启动整段行程，余势不带入正文。
 */
function initCoverScroll() {
  const root = document.documentElement;
  const mast = document.querySelector('.home-cover, .archive-head, .reading-mast');
  const anchor = document.querySelector('.home-dock-zone + .home-sheet, .archive-toolbar, .reading-body-anchor');
  if (!mast || !anchor || !CSS.supports('animation-timeline: scroll(root block)') ||
      !CSS.supports('animation-range: 0px 1px')) return;

  const media = window.matchMedia('(min-width: 900px) and (prefers-reduced-motion: no-preference)');
  const main = document.querySelector('body > .site-main');
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
  let navigating = false;

  function dockY() {
    // 页眉占位固定，正文锚点无需再补偿页眉收拢造成的文档高度变化。
    return Math.max(0, anchor.getBoundingClientRect().top + window.scrollY -
      parseFloat(getComputedStyle(anchor).scrollMarginTop));
  }

  function updateScene() {
    const reading = enabled && window.scrollY > dockY() + mast.getBoundingClientRect().height;
    root.classList.toggle('story-content', reading);
  }

  function cancel() {
    cancelAnimationFrame(frame);
    clearTimeout(settleTimer);
    frame = 0;
    pending = 0;
    root.classList.remove('cover-scroll-returning', 'story-transitioning');
  }

  function animateTo(end) {
    if (!enabled) return;
    cancel();
    destination = end;
    root.classList.toggle('cover-scroll-returning', !end);
    root.classList.add('story-transitioning');
    const from = window.scrollY;
    const started = performance.now();
    const duration = parseFloat(getComputedStyle(root).getPropertyValue('--dur-dock'));
    function tick(now) {
      const progress = Math.min((now - started) / duration, 1);
      const target = destination ? dockY() : 0;
      // 五次平滑插值让起止速度与加速度都归零，避免启程猛冲、落定骤停。
      const eased = progress * progress * progress * (progress * (progress * 6 - 15) + 10);
      window.scrollTo({ top: from + (target - from) * eased, behavior: 'instant' });
      if (progress < 1) frame = requestAnimationFrame(tick);
      else {
        frame = 0;
        lastY = window.scrollY;
        dockPosition = dockY();
        root.classList.remove('cover-scroll-returning', 'story-transitioning');
        updateScene();
      }
    }
    frame = requestAnimationFrame(tick);
  }

  function settle() {
    clearTimeout(settleTimer);
    if (!enabled || frame || dragging || navigating || root.classList.contains('ci-columns-locked')) return;
    const y = window.scrollY;
    const end = dockY();
    if (y > 2 && y < end - 2) animateTo(direction > 0 ? end : 0);
  }

  function nestedScroll(target, delta) {
    for (let el = target instanceof Element ? target : null; el && el !== document.body; el = el.parentElement) {
      if (el.matches('[data-chrono-rail]') && el.scrollWidth > el.clientWidth + 1) {
        const end = el.scrollWidth - el.clientWidth;
        if (delta > 0 ? el.scrollLeft > 1 : el.scrollLeft < end - 1) return true;
      }
      if (el.scrollHeight <= el.clientHeight + 1 || !/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
      if (delta > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
    }
    return false;
  }

  window.addEventListener('wheel', (event) => {
    if (!enabled || event.defaultPrevented || event.ctrlKey || !event.cancelable ||
        Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    const now = performance.now();
    if (nestedScroll(event.target, event.deltaY)) return;
    if (frame || (draining && now - lastWheel < GESTURE_GAP)) {
      event.preventDefault();
      if (Math.sign(event.deltaY) !== direction && Math.abs(event.deltaY) >= THRESHOLD) {
        direction = Math.sign(event.deltaY);
        animateTo(direction > 0 ? dockY() : 0);
      }
      lastWheel = now;
      return;
    }
    draining = false;
    if (root.classList.contains('ci-columns-locked')) return;
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
    const y = window.scrollY;
    if (y > end + 2 || (down && y >= end - 2) || (up && y <= 2)) return;
    event.preventDefault();
    if (!frame) animateTo(down ? end : 0);
  });

  let sceneRaf = 0;
  function scheduleScene() {
    if (sceneRaf) return;
    sceneRaf = requestAnimationFrame(() => { sceneRaf = 0; updateScene(); });
  }
  window.addEventListener('scroll', () => {
    const y = window.scrollY;
    if (y !== lastY) direction = Math.sign(y - lastY);
    lastY = y;
    scheduleScene();
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
    if (root.classList.contains('story-flow') || window.innerHeight < 480) syncMode();
    if (!enabled || frame) return;
    clearTimeout(settleTimer);
    const wasDocked = Math.abs(lastY - dockPosition) <= 2 && dockPosition > 0;
    dockPosition = dockY();
    if (wasDocked) {
      // 视口改变不等于上滑手势：停靠中的页面继续贴合新定点。
      window.scrollTo({ top: dockPosition, behavior: 'instant' });
      lastY = window.scrollY;
    }
    updateScene();
  });
  window.addEventListener('hashchange', () => { navigating = true; cancel(); });
  window.addEventListener('popstate', () => { navigating = true; cancel(); });
  document.addEventListener('click', event => {
    if (event.target.closest('a[href^="#"]')) { navigating = true; cancel(); }
  });
  window.addEventListener('wheel', () => { navigating = false; }, { passive: true });
  window.addEventListener('touchstart', () => { navigating = false; }, { passive: true });
  window.addEventListener('keydown', () => { navigating = false; });
  function syncMode() {
    cancel();
    const title = document.querySelector('.reading-mast .post-title, .reading-mast .page-about__name');
    const flow = !!title && (window.innerHeight < 480 || title.getBoundingClientRect().height > Math.min(mast.getBoundingClientRect().height - 8, window.innerHeight * 0.4));
    root.classList.toggle('story-flow', flow);
    enabled = media.matches && !flow;
    draining = false;
    root.classList.toggle('cover-scroll-enabled', enabled);
    if (enabled) {
      dockPosition = dockY();
    }
    updateScene();
  }
  if (main && 'ResizeObserver' in window) {
    new ResizeObserver(() => {
      if (!enabled || frame || dragging) return;
      const wasDocked = Math.abs(lastY - dockPosition) <= 2 && dockPosition > 0;
      dockPosition = dockY();
      if (wasDocked && !root.classList.contains('ci-columns-locked')) {
        window.scrollTo({ top: dockPosition, behavior: 'instant' });
        lastY = window.scrollY;
      }
      updateScene();
    }).observe(main);
  }
  media.addEventListener('change', syncMode);
  document.fonts.ready.then(syncMode);
  syncMode();
  return () => animateTo(0);
}

/**
 * 初始化「落墨」动效（IntersectionObserver 视口触发展开）
 */
function initLuoMoAnimation() {
  const elementsToAnimate = document.querySelectorAll(
    '.home-stream, .reading-page .post-title'
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
 * 归档双弧曲面：用同一二次曲线计算轴线与节点，朱点按下弧弧长表示进度。
 * 中央节点字号与间距舒展、两侧收远；CSSOM 定位保持字形正面清晰，不写行内样式。
 * 原生滚动承载滚轮、拖曳和键盘，竖屏保留信笺目录。
 */
function initChronoRail() {
  const rail = document.querySelector('[data-chrono-rail]');
  if (!rail) return;

  const track = rail.querySelector('.chrono__track');
  const chrono = rail.closest('.chrono');
  const axisLine = chrono.querySelector('.chrono__axis-line');
  const curveLine = chrono.querySelector('.chrono__curve-line');
  const curveDot = chrono.querySelector('.chrono__curve-dot');
  if (!track || !chrono || !axisLine || !curveLine || !curveDot) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
  let pathLen = 0;
  let stationaryProgress = 0.5;

  const geometrySheet = new CSSStyleSheet();
  document.adoptedStyleSheets = [...document.adoptedStyleSheets, geometrySheet];
  const nodes = Array.from(track.querySelectorAll('.chrono__node'), (element, index) => {
    element.dataset.chronoNode = index;
    const rule = geometrySheet.insertRule(`#archive-chrono [data-chrono-node="${index}"] {}`);
    return { element, style: geometrySheet.cssRules[rule].style, origin: 0, width: 0 };
  });
  let metrics = null;

  function readLength(style, name) {
    const value = style.getPropertyValue(name).trim();
    return parseFloat(value) * (value.endsWith('rem') ? parseFloat(getComputedStyle(document.documentElement).fontSize) : 1);
  }

  function maxScroll() {
    return Math.max(rail.scrollWidth - rail.clientWidth, 0);
  }

  function progressOf() {
    const max = maxScroll();
    return max > 1 ? clamp(rail.scrollLeft / max, 0, 1) : stationaryProgress;
  }

  function buildSurface() {
    const { width, inset, top, bottom, sag } = metrics;
    const end = width - inset;
    const middle = width / 2;
    const arc = (centerY, amplitude) => `M ${inset},${centerY + amplitude} Q ${middle},${centerY - amplitude} ${end},${centerY + amplitude}`;
    axisLine.setAttribute('d', arc(top, sag));
    curveLine.setAttribute('d', arc(top + bottom, sag * metrics.progressDepth));
    pathLen = curveLine.getTotalLength();
  }

  // 朱点与下轨共用 SVG 坐标，按实际滚动弧长定位；短归档居中并跟随键盘焦点。
  function updateDot() {
    if (!pathLen) return;
    const pt = curveLine.getPointAtLength(progressOf() * pathLen);
    curveDot.setAttribute('cx', pt.x);
    curveDot.setAttribute('cy', pt.y);
  }

  // 单调投影：中部间距较大，边缘压缩；屏外沿切线延伸，不反转节点顺序。
  function project(value) {
    const { spread } = metrics;
    if (Math.abs(value) <= 1) return value * (1 + spread - spread * value * value);
    return Math.sign(value) * (1 + (Math.abs(value) - 1) * (1 - spread * 2));
  }

  function paintSurface() {
    if (!metrics) return;
    const { width, inset, sag, bottom } = metrics;
    const svgBounds = axisLine.ownerSVGElement.getBoundingClientRect();
    const railBounds = rail.getBoundingClientRect();
    const half = width / 2 - inset;
    const scroll = rail.scrollLeft;
    const style = getComputedStyle(chrono);
    const floor = parseFloat(style.getPropertyValue('--chrono-perspective-floor'));
    const opacityFloor = parseFloat(style.getPropertyValue('--chrono-ink-floor'));
    const opacityPower = parseFloat(style.getPropertyValue('--chrono-ink-power'));
    nodes.forEach(node => {
      const raw = node.origin - scroll - svgBounds.left + railBounds.left;
      const position = project((raw - width / 2) / half);
      const x = inset + (width - inset * 2) * (position + 1) / 2;
      const arcPosition = (x - inset) / (width - inset * 2);
      const distance = 1 - 4 * arcPosition * (1 - arcPosition);
      const theta = clamp(Math.abs(raw - width / 2) / half, 0, 1) * Math.PI / 2;
      const cosine = Math.cos(theta);
      const scale = floor + (1 - floor) * cosine;
      const inkOpacity = opacityFloor + (1 - opacityFloor) * cosine ** opacityPower;
      const semanticWeight = node.element.classList.contains('chrono__year-mark')
        ? parseFloat(style.getPropertyValue('--chrono-weight-year'))
        : node.element.classList.contains('chrono__month-mark')
          ? parseFloat(style.getPropertyValue('--chrono-weight-month'))
          : parseFloat(style.getPropertyValue('--chrono-weight-title'));
      const fontScale = scale * semanticWeight;
      const offsetX = x - raw;
      const chord = width - inset * 2;
      const tangent = Math.atan2(4 * sag * (1 - 2 * arcPosition), chord);
      const skew = tangent * 180 / Math.PI;
      node.style.setProperty('--chrono-column', `${node.width}px`);
      node.style.setProperty('--chrono-x', `${offsetX.toFixed(2)}px`);
      node.style.setProperty('--chrono-y', `${(sag * distance).toFixed(2)}px`);
      node.style.setProperty('--chrono-scale', scale.toFixed(4));
      node.style.setProperty('--chrono-font-scale', fontScale.toFixed(4));
      node.style.setProperty('--chrono-skew', `${skew.toFixed(2)}deg`);
      node.style.setProperty('--chrono-room', `${(bottom * scale).toFixed(2)}px`);
      node.style.setProperty('--chrono-note-opacity', inkOpacity.toFixed(4));
    });
    updateDot();
  }

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

  function glide(now) {
    const elapsed = Math.min(now - lastFrame, 64);
    lastFrame = now;
    const diff = scrollTarget - glidePosition;
    if (Math.abs(diff) < 0.5) {
      rail.scrollLeft = scrollTarget;
      glideRaf = 0;
      return;
    }
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

  function wheelScroll(deltaY) {
    if (maxScroll() <= 1) return false;
    const settling = glideRaf || Math.abs(scrollTarget - rail.scrollLeft) > 1;
    const current = settling ? scrollTarget : rail.scrollLeft;
    const next = clamp(current - deltaY, 0, maxScroll());
    if (Math.abs(next - current) < 0.5) return !!glideRaf;
    glideTo(next);
    return true;
  }

  rail.addEventListener(
    'wheel',
    (e) => {
      if (e.defaultPrevented || e.ctrlKey) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        stopGlide();
        return;
      }
      const unit = e.deltaMode === 1 ? parseFloat(getComputedStyle(rail).lineHeight) :
        e.deltaMode === 2 ? rail.clientWidth : 1;
      if (wheelScroll(e.deltaY * unit)) e.preventDefault();
    },
    { passive: false }
  );

  let dragFrom = null;
  let dragged = false;
  rail.addEventListener('pointerdown', (e) => {
    stopGlide();
    if (e.pointerType !== 'mouse') return;
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
    updateDot();
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
  ['pointerup', 'pointercancel', 'blur'].forEach((evt) => window.addEventListener(evt, endDrag));
  rail.addEventListener('lostpointercapture', endDrag);
  rail.addEventListener('dragstart', (event) => event.preventDefault());

  rail.addEventListener('keydown', (event) => {
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
    const entry = event.target.closest('.chrono__entry');
    if (!entry) return;
    if (maxScroll() <= 1) {
      const entries = Array.from(track.querySelectorAll('.chrono__item:not(.is-dimmed) .chrono__entry')).reverse();
      const index = entries.indexOf(entry);
      if (index >= 0) stationaryProgress = entries.length > 1 ? index / (entries.length - 1) : 0.5;
    }
    stopGlide();
    // 原生聚焦可能先改变 scrollLeft；先同步投影，再判断真实可见范围。
    paintSurface();
    const bounds = rail.getBoundingClientRect();
    const rect = entry.getBoundingClientRect();
    const inset = metrics ? metrics.inset : 0;
    if (rect.left < bounds.left + inset || rect.right > bounds.right - inset) {
      const node = nodes.find(candidate => candidate.element.contains(entry));
      if (node) rail.scrollLeft = clamp(node.origin - bounds.width / 2, 0, maxScroll());
      paintSurface();
    }
    scrollTarget = rail.scrollLeft;
  });

  // 滚动值即时同步（廉价读取），几何与朱点合帧求值（glide 与原生滚动共用）。
  let paintRaf = 0;
  function paintScroll() {
    paintRaf = 0;
    paintSurface();
  }
  rail.addEventListener(
    'scroll',
    () => {
      if (!glideRaf && !dragFrom) scrollTarget = rail.scrollLeft;
      if (knownMax === maxScroll()) readingProgress = knownMax > 1 ? rail.scrollLeft / knownMax : 1;
      if (!paintRaf) paintRaf = requestAnimationFrame(paintScroll);
    },
    { passive: true }
  );

  // —— 分卷褪墨 + 横轴/竖目随窗口比例自适应（不设手动切换） ——
  const legend = document.querySelector('.archive-legend');
  const mainArchive = document.querySelector('.site-main--archive');
  const listPanel = document.querySelector('[data-archive-list]');
  const wideArchive = window.matchMedia('(min-aspect-ratio: 1/1)');
  let activeCat = '';
  let activeView = wideArchive.matches ? 'axis' : 'list';

  function visibleAxisCount() {
    return rail.querySelectorAll('.chrono__item:not(.is-dimmed)').length;
  }

  function applyFilter(cat) {
    stopGlide();
    endDrag();
    activeCat = cat || '';
    if (legend) {
      legend.querySelectorAll('[data-cat-filter]').forEach((btn) => {
        btn.setAttribute('aria-pressed', String(btn.dataset.catFilter === activeCat));
      });
    }
    rail.querySelectorAll('.chrono__item').forEach((li) => {
      li.classList.toggle('is-dimmed', !!activeCat && li.dataset.cat !== activeCat);
    });
    rail.querySelectorAll('.chrono__year').forEach((group) => {
      const hasBright = !!group.querySelector('.chrono__item:not(.is-dimmed)');
      group.classList.toggle('is-dimmed', !!activeCat && !hasBright);
    });
    rail.querySelectorAll('.chrono__month').forEach((group) => {
      const hasBright = !!group.querySelector('.chrono__item:not(.is-dimmed)');
      group.classList.toggle('is-dimmed', !!activeCat && !hasBright);
    });
    if (listPanel) {
      listPanel.querySelectorAll('.archive-list__item').forEach((li) => {
        li.classList.toggle('is-dimmed', !!activeCat && li.dataset.cat !== activeCat);
      });
    }
    // 褪墨条目的链接同步退出 Tab 序与朗读树，视觉过滤与可访问状态保持一致。
    document.querySelectorAll('.chrono__item, .archive-list__item').forEach((li) => {
      const dimmed = li.classList.contains('is-dimmed');
      li.querySelectorAll('a').forEach((link) => {
        if (dimmed) {
          link.setAttribute('tabindex', '-1');
          link.setAttribute('aria-hidden', 'true');
        } else {
          link.removeAttribute('tabindex');
          link.removeAttribute('aria-hidden');
        }
      });
    });
    const visibleCount = visibleAxisCount();
    const count = document.querySelector('[data-archive-count]');
    const empty = document.querySelector('[data-archive-empty]');
    if (count) count.textContent = String(visibleCount);
    if (empty) empty.hidden = visibleCount !== 0;
    applyView(activeView);
    if (activeView === 'axis') {
      rail.scrollLeft = rail.scrollWidth;
      scrollTarget = rail.scrollLeft;
      knownMax = maxScroll();
      readingProgress = 1;
    }
    refreshLayout();
  }

  function applyView(view) {
    activeView = view === 'list' ? 'list' : 'axis';
    const hasVisible = visibleAxisCount() > 0;
    if (mainArchive) {
      mainArchive.dataset.archiveMode = activeView;
      mainArchive.classList.toggle('is-list-view', activeView === 'list');
      mainArchive.classList.toggle('is-archive-empty', !hasVisible);
    }
    const empty = document.querySelector('[data-archive-empty]');
    if (empty) empty.hidden = hasVisible;
  }

  if (legend) {
    legend.querySelectorAll('[data-cat-filter]').forEach((btn) => {
      btn.addEventListener('click', () => {
        applyFilter(btn.getAttribute('aria-pressed') === 'true' ? '' : btn.dataset.catFilter);
      });
    });
  }
  wideArchive.addEventListener('change', () => {
    applyView(wideArchive.matches ? 'axis' : 'list');
    refreshLayout();
  });
  applyView(activeView);

  function refreshLayout() {
    if (!rail.clientWidth) return;
    stopGlide();
    endDrag();
    const progress = readingProgress;
    chrono.classList.remove('is-projected');
    nodes.forEach(node => { node.style.cssText = ''; });
    const style = getComputedStyle(chrono);
    const bounds = rail.getBoundingClientRect();
    metrics = {
      width: bounds.width,
      inset: readLength(style, '--space-4'),
      top: track.querySelector('.chrono__head').offsetHeight,
      bottom: track.querySelector('.chrono__entry').offsetHeight,
      sag: readLength(style, '--chrono-sag'),
      depth: parseFloat(style.getPropertyValue('--chrono-depth')),
      spread: parseFloat(style.getPropertyValue('--chrono-spread')),
      progressDepth: parseFloat(style.getPropertyValue('--chrono-progress-depth'))
    };
    const scroll = rail.scrollLeft;
    nodes.forEach(node => {
      const dot = node.element.querySelector('.chrono__dot').getBoundingClientRect();
      node.origin = dot.left - bounds.left + scroll + dot.width / 2;
      node.width = node.element.getBoundingClientRect().width;
    });
    chrono.classList.add('is-projected');
    nodes.forEach(node => { node.style.setProperty('--chrono-column', `${node.width}px`); });
    nodes.forEach(node => {
      const dot = node.element.querySelector('.chrono__dot').getBoundingClientRect();
      node.origin = dot.left - bounds.left + scroll + dot.width / 2;
    });
    paintSurface();
    knownMax = maxScroll();
    rail.scrollLeft = scrollTarget = clamp(progress, 0, 1) * knownMax;
    buildSurface();
    paintSurface();
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
    paintSurface();
  });

  // 最新端在物理右侧；无脚本时保留原生横向阅读。
  refreshLayout();
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

  const body = stage.querySelector('[data-ci-body]');
  const anchor = document.querySelector('.reading-body-anchor');
  if (!body || !anchor) return;

  const lines = Array.from(body.querySelectorAll('.post-ci__verses > p'));
  const signature = body.querySelector(':scope > .post-signature--vertical');
  const steps = lines.length + (signature ? 2 : 0); // 列… → 落款字 → 末拍盖章
  if (!steps) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const desktop = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
  const STEP = 80; // 累计滚轮阈值：约一次刻度揭示一列
  let revealed = 0;
  let locked = false;
  let lockY = 0;
  let pending = 0;

  function keepVisible(node) {
    if (!node || !desktop.matches) return;
    const frame = stage.getBoundingClientRect();
    const target = node.getBoundingClientRect();
    if (target.right > frame.right) stage.scrollLeft += target.right - frame.right;
    else if (target.left < frame.left) stage.scrollLeft += target.left - frame.left;
  }

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
    if (locked) keepVisible(count > lines.length ? signature : lines[Math.max(0, count - 1)]);
  }

  function revealAll() {
    stage.classList.remove('is-column-enhanced');
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
    stage.classList.add('is-column-enhanced');
    pending = 0;
    stage.classList.add('is-locked');
    document.documentElement.classList.add('ci-columns-locked');
    window.scrollTo({ top: lockY, behavior: 'instant' });
    keepVisible(revealed > lines.length ? signature : lines[Math.max(0, revealed - 1)]);
  }

  function syncLock() {
    if (document.documentElement.classList.contains('cover-scroll-returning')) return;
    if (reduceMotion.matches || !desktop.matches || document.documentElement.classList.contains('story-flow')) {
      revealAll();
      return;
    }
    // 在正文进入视口前准备隐藏态，不能等到锁页才隐藏已展示的全文。
    stage.classList.toggle('is-column-enhanced', revealed < steps);
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
  window.addEventListener('keydown', event => {
    if (!locked || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey ||
        event.target.closest('input, textarea, select, button, a, [contenteditable]')) return;
    if (['Home', 'End', 'Escape'].includes(event.key)) { revealAll(); return; }
    const next = ['ArrowDown', 'PageDown', 'ArrowRight'].includes(event.key) || (event.key === ' ' && !event.shiftKey);
    const previous = ['ArrowUp', 'PageUp', 'ArrowLeft'].includes(event.key) || (event.key === ' ' && event.shiftKey);
    if (!next && !previous) return;
    event.preventDefault();
    onWheel({ deltaY: next ? STEP : -STEP, deltaX: 0, preventDefault() {} });
  });
  window.addEventListener('hashchange', revealAll);
  window.addEventListener('popstate', revealAll);
  window.addEventListener('scroll', onScroll, { passive: true });
  desktop.addEventListener('change', () => {
    if (!desktop.matches || reduceMotion.matches) revealAll();
    else { keepVisible(lines[0]); syncLock(); }
  });
  reduceMotion.addEventListener('change', () => {
    if (reduceMotion.matches) revealAll();
    else { revealed = 0; applyStep(0); syncLock(); }
  });
  window.addEventListener('resize', () => {
    if (locked) keepVisible(revealed > lines.length ? signature : lines[Math.max(0, revealed - 1)]);
  });
  document.fonts.ready.then(() => {
    if (revealed === 0 || reduceMotion.matches) keepVisible(lines[0]);
  });
  keepVisible(lines[0]);
  if (reduceMotion.matches || !desktop.matches) revealAll();
  else syncLock();
}
