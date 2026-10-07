// 홈 대시보드 연출 도구(v7.21.0) — 라이브러리 없이 순수 JS/CSS.
//  · 설정 "애니메이션 효과"(workspace:animations, 기본 켬, settingsSync로 기기 간 동기화) + prefers-reduced-motion 존중
//  · countUp(숫자 올라가기), sparkline/ring/bar(KPI 미니 차트), flip(드래그 재정렬 FLIP), 프레젠테이션 모드(전체 화면 자동 순환)
// 순수 계산(countsByDay, sparkPoints, easeOutCubic)은 Node 테스트에서 그대로 평가한다. 일반 <script>로 로드.
(function () {
  const FX_KEY = 'workspace:animations';
  const SVG_NS = 'http://www.w3.org/2000/svg';

  // ---------- 설정 ----------
  function animationsEnabled() {
    try { return window.settingsSync.get(FX_KEY) !== '0'; } catch { return true; }
  }
  function prefersReduced() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; }
  }
  /** 실제로 움직여도 되는가(설정 켬 + OS 모션 줄이기 아님). */
  function motionOn() { return animationsEnabled() && !prefersReduced(); }
  function applyFxClass() {
    if (typeof document !== 'undefined') document.documentElement.classList.toggle('fx-off', !animationsEnabled());
  }
  function setAnimationsEnabled(on) {
    window.settingsSync.set(FX_KEY, on ? '1' : '0');
    applyFxClass();
  }

  // ---------- 순수 계산 ----------
  const easeOutCubic = (t) => 1 - (1 - Math.min(1, Math.max(0, t))) ** 3;
  /** rows에서 field(YYYY-MM-DD 또는 ISO 시각의 앞 10자)가 days 각각과 같은 행 수. */
  function countsByDay(rows, field, days) {
    const map = new Map(days.map((d) => [d, 0]));
    for (const r of rows || []) {
      const d = String(r[field] || '').slice(0, 10);
      if (map.has(d)) map.set(d, map.get(d) + 1);
    }
    return days.map((d) => map.get(d));
  }
  /** 스파크라인 좌표(0~w, 0~h; 값이 클수록 위). 값이 모두 같으면 가운데 수평선. */
  function sparkPoints(values, w = 100, h = 26, pad = 3) {
    const n = values.length;
    if (!n) return [];
    const min = Math.min(...values); const max = Math.max(...values);
    return values.map((v, i) => ({
      x: n === 1 ? w / 2 : (i / (n - 1)) * w,
      y: max === min ? h / 2 : pad + (1 - (v - min) / (max - min)) * (h - pad * 2),
    }));
  }

  // ---------- DOM 도구 ----------
  function countUp(node, to, { from = 0, duration = 900, format = (n) => String(Math.round(n)) } = {}) {
    if (!motionOn() || from === to || typeof requestAnimationFrame !== 'function') { node.textContent = format(to); return; }
    const t0 = performance.now();
    node.textContent = format(from);
    function frame(now) {
      if (!node.isConnected || document.hidden) { node.textContent = format(to); return; }
      const t = (now - t0) / duration;
      node.textContent = format(from + (to - from) * easeOutCubic(t));
      if (t < 1) requestAnimationFrame(frame); else node.textContent = format(to);
    }
    requestAnimationFrame(frame);
  }

  function sparkline(values, { w = 100, h = 26 } = {}) {
    const pts = sparkPoints(values, w, h);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('preserveAspectRatio', 'none');
    svg.setAttribute('class', 'spark');
    svg.setAttribute('aria-hidden', 'true');
    const flat = values.length > 0 && Math.min(...values) === Math.max(...values);
    if (pts.length) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
      const area = document.createElementNS(SVG_NS, 'path');
      area.setAttribute('class', 'spark__area');
      area.setAttribute('d', `${d} L${pts[pts.length - 1].x.toFixed(1)} ${h} L${pts[0].x.toFixed(1)} ${h} Z`);
      const line = document.createElementNS(SVG_NS, 'path');
      line.setAttribute('d', d);
      line.setAttribute('pathLength', '1');
      if (flat) svg.append(line); else svg.append(area, line); // 변화가 없으면 영역 채움 없이 선만
    }
    return svg;
  }

  /** 진행 링(0~100). 채움은 로드 직후 한 프레임 뒤 stroke-dashoffset 전환으로 차오른다. */
  function ring(pct, valueNode, animate = true) {
    const C = 2 * Math.PI * 24;
    const wrap = document.createElement('div');
    wrap.className = 'kpi-card__ring';
    wrap.innerHTML = `<svg viewBox="0 0 56 56" aria-hidden="true"><circle class="ring__bg" cx="28" cy="28" r="24"/><circle class="ring__fg" cx="28" cy="28" r="24" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${motionOn() && animate ? C.toFixed(1) : (C * (1 - pct / 100)).toFixed(1)}"/></svg>`;
    if (valueNode) wrap.append(valueNode);
    if (motionOn() && animate) {
      const fg = wrap.querySelector('.ring__fg');
      requestAnimationFrame(() => requestAnimationFrame(() => fg.setAttribute('stroke-dashoffset', (C * (1 - pct / 100)).toFixed(1))));
    }
    return wrap;
  }

  /** 얇은 막대(0~1). 전환은 transform: scaleX라 레이아웃을 건드리지 않는다. */
  function bar(frac, animate = true) {
    const i = document.createElement('i');
    const wrap = document.createElement('div');
    wrap.className = 'fxbar';
    wrap.append(i);
    const v = Math.min(1, Math.max(0, frac));
    if (motionOn() && animate) { i.style.setProperty('--v', '0'); requestAnimationFrame(() => requestAnimationFrame(() => i.style.setProperty('--v', String(v)))); }
    else i.style.setProperty('--v', String(v));
    return wrap;
  }

  /** FLIP: mutate() 전후 각 항목(data-flip-key)의 위치 차이를 transform 애니메이션으로 메운다. */
  function flip(container, mutate) {
    const sel = '[data-flip-key]';
    const before = new Map();
    container.querySelectorAll(sel).forEach((n) => before.set(n.dataset.flipKey, n.getBoundingClientRect()));
    mutate();
    if (!motionOn()) return;
    container.querySelectorAll(sel).forEach((n) => {
      const a = before.get(n.dataset.flipKey);
      if (!a || !n.animate) return;
      const b = n.getBoundingClientRect();
      const dx = a.left - b.left; const dy = a.top - b.top;
      if (!dx && !dy) return;
      n.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'none' }], { duration: 360, easing: 'cubic-bezier(.2,.7,.2,1)' });
    });
  }

  // ---------- 프레젠테이션 모드 ----------
  // slides: [{ id, title, render(slideNode), tick?(slideNode) }]  — 슬라이드는 보일 때마다 render()로 새로 그려 최신 데이터를 보여 준다.
  function startPresentation({ slides, intervalMs = 9000, onExit }) {
    if (!slides || !slides.length) return null;
    const root = document.createElement('div');
    root.className = 'pres';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', '프레젠테이션 모드');
    const stage = document.createElement('div'); stage.className = 'pres__stage';
    const nodes = slides.map((s) => { const n = document.createElement('section'); n.className = 'pres__slide'; n.dataset.slide = s.id; stage.append(n); return n; });
    const dots = document.createElement('div'); dots.className = 'pres__dots';
    slides.forEach(() => dots.append(document.createElement('i')));
    const hint = document.createElement('span');
    const bar = document.createElement('div'); bar.className = 'pres__bar';
    const progress = document.createElement('div'); progress.className = 'pres__progress';
    const progressFill = document.createElement('i'); progress.append(progressFill);
    bar.append(dots, hint);
    root.append(stage, bar, progress);
    document.body.append(root);

    let idx = -1; let timer = null; let paused = false; let tickTimer = null; let anim = null; let cursorTimer = null; let closed = false;
    function setHint() { hint.textContent = `${paused ? '⏸ 일시정지 · ' : ''}←/→ 이동 · 스페이스 일시정지 · Esc 종료`; }
    function show(n) {
      idx = (n + slides.length) % slides.length;
      nodes.forEach((node, i) => {
        node.classList.toggle('is-active', i === idx);
        if (i === idx) { node.innerHTML = ''; slides[i].render(node); }
      });
      [...dots.children].forEach((d, i) => d.classList.toggle('is-active', i === idx));
      restartProgress();
    }
    function restartProgress() {
      if (anim) anim.cancel();
      anim = null;
      if (paused || !motionOn() || !progressFill.animate) { progressFill.style.transform = 'scaleX(0)'; return; }
      anim = progressFill.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], { duration: intervalMs, easing: 'linear', fill: 'forwards' });
    }
    function schedule() {
      clearInterval(timer);
      if (!paused && !document.hidden) timer = setInterval(() => show(idx + 1), intervalMs);
    }
    function next(d = 1) { show(idx + d); schedule(); }
    function togglePause() { paused = !paused; setHint(); schedule(); restartProgress(); }
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); exit(); }
      else if (e.key === 'ArrowRight') next(1);
      else if (e.key === 'ArrowLeft') next(-1);
      else if (e.key === ' ') { e.preventDefault(); togglePause(); }
    }
    function onVis() { schedule(); if (!document.hidden) restartProgress(); }
    function onMove() { root.classList.add('pres--cursor'); clearTimeout(cursorTimer); cursorTimer = setTimeout(() => root.classList.remove('pres--cursor'), 2200); }
    function onFs() { if (!document.fullscreenElement && !closed) exit(true); }
    function exit(fromFs) {
      if (closed) return; closed = true;
      clearInterval(timer); clearInterval(tickTimer); clearTimeout(cursorTimer);
      if (anim) anim.cancel();
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('visibilitychange', onVis);
      document.removeEventListener('fullscreenchange', onFs);
      root.remove();
      if (!fromFs && document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(() => {});
      if (onExit) onExit();
    }
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('visibilitychange', onVis);
    document.addEventListener('fullscreenchange', onFs);
    root.addEventListener('click', () => next(1));
    root.addEventListener('mousemove', onMove);
    tickTimer = setInterval(() => { const s = slides[idx]; if (s && s.tick) s.tick(nodes[idx]); }, 1000);
    setHint();
    show(0);
    schedule();
    // 전체 화면은 best-effort(거부/미지원이어도 오버레이만으로 동작)
    try { if (root.requestFullscreen) root.requestFullscreen().catch(() => {}); } catch { /* 무시 */ }
    return { exit, next, togglePause, root };
  }

  window.HomeFx = { animationsEnabled, prefersReduced, motionOn, applyFxClass, setAnimationsEnabled, countUp, sparkline, ring, bar, flip, startPresentation, countsByDay, sparkPoints, easeOutCubic };
  if (typeof document !== 'undefined') applyFxClass();
})();
