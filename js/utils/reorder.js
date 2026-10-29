// 공통 "끌어서 순서 변경"(v7.31.0). 목록마다 따로 만들지 않고 이 모듈 하나로 처리한다.
//  · 저장: 설정 동기화 키 'workspace:order' 하나에 {목록키: [id, …]} — DB 변경 없음, 기기 간 동기화.
//  · 조작: 항목 왼쪽의 ⠿ 손잡이를 마우스/터치로 끌거나, 손잡이에 포커스를 두고 ↑/↓ 키.
//  · 목록 그리기 전에 Reorder.sort(키, 행들)로 저장된 순서를 적용하고, 그린 뒤 Reorder.enable(컨테이너, 키)을 호출한다.
// 순수 함수(sortByOrder/moveId)는 Node 테스트 대상이다. 일반 <script>.
(function () {
  const KEY = 'workspace:order';
  const MAX_IDS = 500;

  // ---- 순수 로직 ----
  /** 저장된 id 순서대로 정렬한다. 저장 목록에 없는 새 항목은 원래 순서를 유지한 채 뒤에 붙는다. */
  function sortByOrder(rows, ids, idFn = (r) => r.id) {
    const list = Array.isArray(rows) ? rows : [];
    if (!Array.isArray(ids) || !ids.length) return list.slice();
    const pos = new Map(ids.map((id, i) => [String(id), i]));
    const known = []; const fresh = [];
    list.forEach((r, i) => { const p = pos.get(String(idFn(r))); (p === undefined ? fresh : known).push({ r, p, i }); });
    known.sort((a, b) => a.p - b.p || a.i - b.i);
    return [...known.map((x) => x.r), ...fresh.map((x) => x.r)];
  }
  /** ids에서 id를 targetId 앞/뒤로 옮긴 새 배열. 없는 id면 그대로. */
  function moveId(ids, id, targetId, after = false) {
    const a = ids.map(String); const from = a.indexOf(String(id));
    if (from < 0 || String(id) === String(targetId)) return a;
    a.splice(from, 1);
    const to = a.indexOf(String(targetId));
    if (to < 0) { a.splice(from, 0, String(id)); return a; }
    a.splice(after ? to + 1 : to, 0, String(id));
    return a;
  }

  // ---- 저장소 ----
  const store = () => window.settingsSync || null;
  function readAll() {
    try { const s = store(); const raw = s ? s.get(KEY) : localStorage.getItem(KEY); const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' ? o : {}; } catch { return {}; }
  }
  function writeAll(o) {
    const raw = JSON.stringify(o);
    try { const s = store(); if (s) s.set(KEY, raw); else localStorage.setItem(KEY, raw); } catch { /* 저장 실패는 화면 동작을 막지 않는다 */ }
  }
  const getOrder = (key) => { const v = readAll()[key]; return Array.isArray(v) ? v : []; };
  function setOrder(key, ids) { const all = readAll(); all[key] = ids.map(String).slice(0, MAX_IDS); writeAll(all); }
  function reset(key) { const all = readAll(); delete all[key]; writeAll(all); }
  const sort = (key, rows, idFn) => sortByOrder(rows, getOrder(key), idFn);

  // ---- 화면(DOM) ----
  const ITEM = ':scope > [data-rid]';
  function grip(label = '끌어서 순서 변경 (↑↓ 키로도 이동)') {
    const g = document.createElement('span');
    g.className = 'rd-grip'; g.textContent = '⠿'; g.title = label; g.tabIndex = 0;
    g.setAttribute('role', 'button'); g.setAttribute('aria-label', label);
    return g;
  }
  const idsOf = (container) => [...container.querySelectorAll(ITEM)].map((n) => n.dataset.rid);

  function enable(container, listKey, opts = {}) {
    if (!container || container.__rd) return;
    container.__rd = true;
    container.classList.add('rd-list');
    // opts.persist(ids): 이미 DB 순서(sort_order)가 있는 목록은 그 저장 함수를 그대로 쓴다(없으면 설정 동기화 키에 저장).
    const done = () => {
      const ids = idsOf(container);
      if (typeof opts.persist === 'function') { Promise.resolve(opts.persist(ids)).catch((err) => { if (window.toast) window.toast(`순서 저장 실패: ${err && err.message ? err.message : err}`, 'error'); }); }
      else setOrder(listKey, ids);
      if (opts.onChange) opts.onChange(ids);
    };

    // 손잡이를 누르거나 끈 뒤에 항목의 클릭 동작(선택/열기)이 같이 실행되지 않게 막는다.
    container.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.rd-grip')) { e.stopPropagation(); e.preventDefault(); } }, true);

    container.addEventListener('keydown', (e) => {
      const g = e.target.closest && e.target.closest('.rd-grip');
      if (!g || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown' && e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const item = g.closest('[data-rid]');
      if (!item || item.parentNode !== container) return;
      e.preventDefault();
      const prev = e.key === 'ArrowUp' || e.key === 'ArrowLeft';
      const sib = prev ? item.previousElementSibling : item.nextElementSibling;
      if (!sib || !sib.matches('[data-rid]')) return;
      container.insertBefore(item, prev ? sib : sib.nextSibling);
      const g2 = item.querySelector('.rd-grip'); if (g2) g2.focus();
      done();
    });

    container.addEventListener('pointerdown', (e) => {
      const g = e.target.closest && e.target.closest('.rd-grip');
      if (!g || (e.button !== undefined && e.button !== 0)) return;
      const item = g.closest('[data-rid]');
      if (!item || item.parentNode !== container) return;
      e.preventDefault();
      try { g.setPointerCapture(e.pointerId); } catch { /* 일부 환경 */ }
      let target = null; let after = false; let moved = false;
      const clear = () => container.querySelectorAll('.rd-bx,.rd-ax,.rd-by,.rd-ay').forEach((n) => n.classList.remove('rd-bx', 'rd-ax', 'rd-by', 'rd-ay'));
      item.classList.add('rd-dragging'); document.body.classList.add('rd-active');
      const move = (ev) => {
        moved = true;
        const el = document.elementFromPoint(ev.clientX, ev.clientY);
        const t = el && el.closest ? el.closest('[data-rid]') : null;
        clear();
        if (!t || t === item || t.parentNode !== container) { target = null; return; }
        const r = t.getBoundingClientRect();
        const horizontal = t.offsetWidth < container.offsetWidth * 0.8; // 카드 격자면 좌우, 줄 목록이면 위아래
        after = horizontal ? ev.clientX > r.left + r.width / 2 : ev.clientY > r.top + r.height / 2;
        target = t;
        t.classList.add(horizontal ? (after ? 'rd-ax' : 'rd-bx') : (after ? 'rd-ay' : 'rd-by'));
        // 화면 가장자리 근처면 자동 스크롤
        if (ev.clientY < 70) window.scrollBy(0, -18); else if (ev.clientY > window.innerHeight - 70) window.scrollBy(0, 18);
      };
      const finish = (ev) => {
        g.removeEventListener('pointermove', move); g.removeEventListener('pointerup', finish); g.removeEventListener('pointercancel', finish);
        try { g.releasePointerCapture(e.pointerId); } catch { /* 무시 */ }
        clear(); item.classList.remove('rd-dragging'); document.body.classList.remove('rd-active');
        if (ev.type !== 'pointercancel' && moved && target) { container.insertBefore(item, after ? target.nextSibling : target); done(); }
      };
      g.addEventListener('pointermove', move); g.addEventListener('pointerup', finish); g.addEventListener('pointercancel', finish);
    });
  }

  window.Reorder = { KEY, sortByOrder, moveId, getOrder, setOrder, reset, sort, grip, enable, idsOf };
})();
