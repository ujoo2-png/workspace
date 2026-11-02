// 다이어그램 스튜디오 (v7.32.0) — /diagrams 화면, 메뉴별 📐 버튼 모달, 설정·프로필·가져오기·내보내기.
// 디자인 규칙은 cathrynlavery/diagram-design(MIT)을 따르되, 이 앱은 결정적(deterministic) 엔진으로 직접 그린다.
(function () {
  'use strict';
  const { el, toast, openModal, escapeHtml } = window;
  const DC = window.DiagramCore, AD = window.DiagramAdapters, IM = window.DiagramImport;
  const SKEY = 'workspace:diagram:settings', PKEY = 'workspace:diagram:profiles';
  const store = () => window.settingsSync;
  const readJson = (k, fb) => { try { const v = store().get(k); return v ? JSON.parse(v) : fb; } catch { return fb; } };
  const writeJson = (k, v) => { try { store().set(k, JSON.stringify(v)); } catch { /* 무시 */ } };
  const loadSettings = () => DC.norm(readJson(SKEY, {}));
  const saveSettings = (s) => writeJson(SKEY, s);
  const loadProfiles = () => { const p = readJson(PKEY, {}); return p && typeof p === 'object' && !Array.isArray(p) ? p : {}; };
  const appDark = () => { const t = document.documentElement.getAttribute('data-theme'); return t === 'dark' || (!t && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches); };
  const render = (type, data, S) => DC.render(type, data, S, { appDark: appDark() });

  // ── 내보내기 ─────────────────────────────────────────────────────────
  function download(name, blob) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 2000); }
  // 한글 파일명은 일부 브라우저에서 이름이 사라지므로 ASCII만 쓴다.
  const fname = (res, ext) => `diagram-${res.def.id}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}.${ext}`;
  function exportPng(type, data, S) {
    // 웹폰트는 <img>로 불러온 SVG 안에서 적용되지 않으므로 PNG는 시스템 폰트로 다시 그린다.
    const res = render(type, data, { ...S, fontSource: 'system', motion: 'none' }); const svg = DC.svgFile(res);
    const img = new Image(); const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
    img.onload = () => { const sc = S.pngScale || 2; const c = document.createElement('canvas'); c.width = Math.round(res.W * sc); c.height = Math.round(res.H * sc); const g = c.getContext('2d'); g.fillStyle = res.tok.paper; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); c.toBlob((b) => b ? download(fname(res, 'png'), b) : toast('PNG 변환에 실패했습니다.', 'error')); };
    img.onerror = () => { URL.revokeObjectURL(url); toast('PNG 변환에 실패했습니다. SVG로 내려받아 주세요.', 'error'); };
    img.src = url;
  }
  function doExport(kind, type, data, S) {
    const res = render(type, data, S);
    if (kind === 'svg') download(fname(res, 'svg'), new Blob([DC.svgFile(res)], { type: 'image/svg+xml' }));
    else if (kind === 'html') download(fname(res, 'html'), new Blob([DC.htmlDoc(res)], { type: 'text/html' }));
    else if (kind === 'json') download(fname(res, 'json'), new Blob([DC.sidecar(res)], { type: 'application/json' }));
    else if (kind === 'png') exportPng(type, data, S);
    else if (kind === 'copy') { navigator.clipboard && navigator.clipboard.writeText(DC.svgFile(res)).then(() => toast('SVG 코드를 복사했습니다.'), () => toast('복사하지 못했습니다.', 'error')); }
  }

  // ── 설정 패널 ────────────────────────────────────────────────────────
  const SKIN_LABEL = { auto: '앱 테마 따라가기', light: '라이트', dark: '다크', terminal: '터미널' };
  function settingsPanel(S, onChange, { compact } = {}) {
    const box = el('div', { class: 'dg-set' });
    const upd = (k, v) => { S[k] = v; saveSettings(S); onChange(); };
    const sel = (label, key, opts, hint) => el('label', { class: 'dg-set__f', title: hint || '' }, [el('span', {}, label), el('select', { class: 'nm-input', onchange: (e) => upd(key, e.target.value) }, opts.map(([v, t]) => el('option', { value: v, selected: String(S[key]) === String(v) || undefined }, t)))]);
    const chk = (label, key, hint) => el('label', { class: 'dg-set__f dg-set__f--chk', title: hint || '' }, [el('input', { type: 'checkbox', checked: S[key] || undefined, onchange: (e) => upd(key, e.target.checked) }), el('span', {}, label)]);
    box.append(
      sel('스킨', 'skin', [['auto', SKIN_LABEL.auto], ['light', SKIN_LABEL.light], ['dark', SKIN_LABEL.dark], ['terminal', SKIN_LABEL.terminal]], '종이/잉크 색 세트'),
      sel('레이아웃', 'layout', [['minimal', '미니멀(그림만)'], ['full', '풀(제목·요약 카드 포함)']]),
      sel('크기', 'size', Object.entries(DC.PRESETS).map(([k, v]) => [k, v.label]), '문서·슬라이드·SNS·인쇄용 프리셋'),
      sel('상세도', 'detail', Object.entries(DC.DETAIL).map(([k, v]) => [k, v.label]), '복잡도 예산(노드 수 경고 기준)'),
      sel('대상 독자', 'audience', Object.entries(DC.AUDIENCE), '엔지니어는 부제 표시, 경영진은 큰 글씨'),
      sel('방향', 'direction', [['auto', '자동'], ['LR', '가로(→)'], ['TB', '세로(↓)']], '그래프형 유형의 흐름 방향'),
      sel('글꼴', 'fontSource', [['web', '웹폰트(Google Fonts)'], ['system', '시스템 글꼴(오프라인)']], '웹폰트는 인터넷이 필요합니다. PNG는 항상 시스템 글꼴'),
      sel('움직임', 'motion', Object.entries(DC.MOTION), '인쇄·"동작 줄이기" 설정에서는 자동으로 정지'),
      sel('PNG 배율', 'pngScale', [[1, '1×'], [2, '2× (기본)'], [3, '3× 고해상도']]),
      chk('손그림 느낌(sketchy)', 'sketchy', '선을 살짝 흔들어 초안 느낌'), chk('범례 표시', 'legend'), chk('주석 표시', 'annotations'), chk('아이콘 표시', 'icons'), chk('표로 보기(접근성) 포함', 'tableView')
    );
    // 사용자 팔레트
    const pal = el('div', { class: 'dg-set__pal' }, [el('b', {}, '내 색상 팔레트(선택)')]);
    for (const [k, lab] of [['paper', '바탕'], ['ink', '글자'], ['accent', '강조'], ['muted', '보조'], ['link', '링크']]) {
      const cur = (S.palette && S.palette[k]) || DC.resolveTokens(S.skin === 'auto' ? 'light' : S.skin, {})[k];
      pal.append(el('label', { class: 'dg-set__f dg-set__f--c' }, [el('span', {}, lab), el('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(cur) ? cur : '#888888', onchange: (e) => { S.palette = { ...(S.palette || {}), [k]: e.target.value }; saveSettings(S); onChange(); } })]));
    }
    pal.append(el('button', { class: 'nm-btn nm-btn--sm', onclick: () => { S.palette = {}; saveSettings(S); onChange(); toast('팔레트를 기본으로 되돌렸습니다.'); } }, '팔레트 초기화'));
    box.append(pal);
    // 프로필
    const profiles = loadProfiles(); const names = Object.keys(profiles);
    const nameIn = el('input', { class: 'nm-input', placeholder: '프로필 이름(예: 발표용)', style: 'max-width:160px' });
    const psel = el('select', { class: 'nm-input' }, [el('option', { value: '' }, names.length ? '저장된 프로필…' : '(저장된 프로필 없음)'), ...names.map((n) => el('option', { value: n, selected: S.profile === n || undefined }, n))]);
    box.append(el('div', { class: 'dg-set__prof' }, [
      el('b', {}, '프로필(설정 묶음)'), psel,
      el('button', { class: 'nm-btn nm-btn--sm', onclick: () => { const n = psel.value; if (!n || !profiles[n]) return toast('프로필을 선택하세요.', 'error'); Object.assign(S, DC.norm({ ...profiles[n], profile: n })); saveSettings(S); onChange(true); toast(`'${n}' 프로필을 적용했습니다.`); } }, '적용'),
      el('button', { class: 'nm-btn nm-btn--sm nm-btn--danger', onclick: () => { const n = psel.value; if (!n) return; delete profiles[n]; writeJson(PKEY, profiles); onChange(true); } }, '삭제'),
      nameIn,
      el('button', { class: 'nm-btn nm-btn--sm', onclick: () => { const n = nameIn.value.trim(); if (!n) return toast('프로필 이름을 입력하세요.', 'error'); const { profile, ...rest } = S; profiles[n] = rest; S.profile = n; saveSettings(S); writeJson(PKEY, profiles); onChange(true); toast(`'${n}' 프로필로 저장했습니다.`); } }, '현재 설정 저장'),
      el('button', { class: 'nm-btn nm-btn--sm', onclick: () => { Object.assign(S, DC.norm({})); saveSettings(S); onChange(true); toast('모든 설정을 기본값으로 되돌렸습니다.'); } }, '전체 초기화'),
    ]));
    return box;
  }

  // ── 뷰어(미리보기 + 데이터 편집 + 내보내기) ──────────────────────────
  function viewer(opts) {
    // opts: { items:[{key,title,type,data,sample,why}], index, S, showSettings, onOpenStudio }
    const S = opts.S; let idx = opts.index || 0; const wrap = el('div', { class: 'dg-viewer' });
    const stage = el('div', { class: 'dg-stage' }); const meta = el('div', { class: 'dg-meta' }); const ed = el('textarea', { class: 'nm-input dg-edit', spellcheck: 'false', rows: 10 });
    const warn = el('div', { class: 'dg-warn' }); const tabs = el('div', { class: 'dg-tabs' }); const setHost = el('div', { class: 'dg-sethost' });
    const cur = () => opts.items[idx];
    function draw(resetEditor = true) {
      const it = cur(); if (!it) { stage.textContent = '표시할 다이어그램이 없습니다.'; return; }
      let res; try { res = render(it.type, it.data, S); } catch (e) { stage.textContent = `그리지 못했습니다: ${e.message}`; return; }
      stage.innerHTML = DC.fragment(res, res.settings); warn.innerHTML = '';
      if (it.sample) warn.append(el('div', { class: 'dg-note' }, '📌 아직 이 메뉴에 해당 자료가 충분하지 않아 샘플로 보여드립니다. 자료를 등록하면 내 데이터로 그려집니다.'));
      for (const w of res.warnings) warn.append(el('div', { class: 'dg-note dg-note--w' }, `⚠ ${w}`));
      const def = DC.BY_ID[it.type];
      meta.innerHTML = '';
      meta.append(el('h3', {}, `${def.ko} · ${def.en}`), el('p', {}, def.desc), el('p', { class: 'dg-meta__s' }, [el('b', {}, '언제 쓰나: '), def.when]), el('p', { class: 'dg-meta__s' }, [el('b', {}, '데이터 팁: '), def.tips]));
      if (it.why) meta.append(el('p', { class: 'dg-meta__s' }, [el('b', {}, '이 메뉴에서: '), it.why]));
      if (resetEditor) ed.value = JSON.stringify(it.data, null, 2);
      tabs.querySelectorAll('button').forEach((b, i) => b.classList.toggle('dg-tab--on', i === idx));
    }
    opts.items.forEach((it, i) => tabs.append(el('button', { class: 'nm-btn nm-btn--sm dg-tab', onclick: () => { idx = i; draw(); } }, `${it.title}${it.sample ? ' (샘플)' : ''}`)));
    const exp = el('div', { class: 'dg-exp' }, ['svg', 'png', 'html', 'json', 'copy'].map((k) => el('button', { class: 'nm-btn nm-btn--sm', title: { svg: '벡터 이미지', png: '래스터 이미지(시스템 글꼴)', html: '단독 HTML 파일', json: '블록 메타데이터(sidecar)', copy: 'SVG 코드 복사' }[k], onclick: () => doExport(k, cur().type, cur().data, S) }, { svg: '⬇ SVG', png: '⬇ PNG', html: '⬇ HTML', json: '⬇ JSON', copy: '📋 SVG 복사' }[k])));
    const apply = el('button', { class: 'nm-btn nm-btn--sm nm-btn--primary', onclick: () => { try { cur().data = JSON.parse(ed.value); cur().sample = false; draw(false); toast('적용했습니다.'); } catch (e) { toast(`JSON 오류: ${e.message}`, 'error'); } } }, '데이터 적용');
    const reset = el('button', { class: 'nm-btn nm-btn--sm', onclick: () => { cur().data = JSON.parse(JSON.stringify(DC.BY_ID[cur().type].sample)); cur().sample = true; draw(); } }, '샘플로 되돌리기');
    const refresh = (full) => { if (full) { Object.assign(S, loadSettings()); } setHost.innerHTML = ''; if (opts.showSettings) setHost.append(settingsPanel(S, refresh)); draw(false); };
    wrap.append(opts.items.length > 1 ? tabs : '', el('div', { class: 'dg-main' }, [el('div', { class: 'dg-left' }, [stage, warn, exp]), el('div', { class: 'dg-right' }, [meta, el('details', { class: 'dg-det' }, [el('summary', {}, '데이터(JSON) 직접 고치기'), ed, el('div', { class: 'row', style: 'gap:6px;margin-top:6px' }, [apply, reset])]), opts.onOpenStudio ? el('button', { class: 'nm-btn nm-btn--sm', onclick: opts.onOpenStudio }, '📐 스튜디오에서 45종·전체 설정 열기') : ''])]),
      opts.showSettings ? el('details', { class: 'dg-det', open: opts.openSettings || undefined }, [el('summary', {}, '⚙ 설정(스킨·크기·상세도·글꼴·움직임·팔레트·프로필)'), setHost]) : '');
    if (opts.showSettings) setHost.append(settingsPanel(S, refresh));
    wrap.setType = (type, data, title) => { opts.items = [{ key: 'x', title: title || DC.BY_ID[type].ko, type, data, sample: false }]; idx = 0; tabs.innerHTML = ''; draw(); };
    draw(); return wrap;
  }

  // ── 메뉴별 모달 ──────────────────────────────────────────────────────
  function openDiagramModal(path) {
    const p = path || (location.hash.replace(/^#/, '') || '/home'); const S = loadSettings();
    const items = AD.forMenu(p, window.appState).filter((x) => x.data);
    const nav = (window.NAV_ITEMS || []).find((n) => n.path === p);
    openModal({ title: `📐 ${nav ? nav.label : ''} 다이어그램`, width: '1100px', contentBuilder(body) {
      if (!items.length) { body.append(el('p', {}, '이 메뉴는 아직 자동 다이어그램이 없습니다. 스튜디오에서 45종을 직접 만들어 보세요.'), el('button', { class: 'nm-btn nm-btn--primary', onclick: () => { document.querySelector('.nm-modal__close')?.click(); window.navigate('/diagrams'); } }, '스튜디오 열기')); return; }
      body.append(viewer({ items, S, showSettings: true, onOpenStudio: () => { document.querySelector('.nm-modal__close')?.click(); window.navigate('/diagrams'); } }));
    } });
  }
  window.openDiagramModal = openDiagramModal;

  // 라우터가 화면을 그린 뒤 호출 — 각 메뉴 머리말에 📐 버튼을 한 번만 붙인다.
  let dgObserver = null;
  function addBtn(root, path) {
    if ((location.hash.replace(/^#/, '') || '/home') !== path || root.querySelector('.dg-studio')) return; // 화면 전환 직후 이전 화면용 관찰자가 늦게 실행되는 경우 방지
    const hdr = root.querySelector('.page-header'); if (!hdr || hdr.querySelector('[data-dg-btn]')) return;
    const btn = el('button', { class: 'nm-btn', 'data-dg-btn': '1', title: '이 메뉴의 자료를 다이어그램으로 (45종 중 맞는 유형 자동 추천)', onclick: () => openDiagramModal(path) }, '📐 다이어그램');
    (hdr.querySelector('.row') || hdr).append(btn);
  }
  window.injectDiagramButton = function (root, path) {
    try {
      if (dgObserver) { dgObserver.disconnect(); dgObserver = null; }
      if (path === '/diagrams' || !AD.MENUS.includes(path)) return;
      addBtn(root, path);
      // 일부 메뉴는 데이터가 바뀔 때마다 화면 전체를 다시 그리므로, 머리말이 새로 생기면 버튼을 다시 붙인다.
      if (typeof MutationObserver === 'function') { dgObserver = new MutationObserver(() => addBtn(root, path)); dgObserver.observe(root, { childList: true, subtree: true }); }
    } catch { /* 버튼은 부가 기능이라 실패해도 화면을 막지 않는다 */ }
  };

  // ── 스튜디오 화면 ───────────────────────────────────────────────────
  function renderDiagrams(rootEl) {
    const S = loadSettings(); let family = '전체'; let q = ''; const fams = ['전체', ...new Set(DC.TYPES.map((t) => t.family))];
    const host = el('div', { class: 'dg-studio' }); rootEl.append(host);
    const mine = (type) => { const order = [...AD.MENUS.filter((m) => !['/home', '/analytics', '/usage', '/settings'].includes(m)), '/home', '/analytics']; for (const m of order) { const f = AD.forMenu(m, window.appState).find((x) => x.type === type && !x.sample); if (f) return { ...f, menu: m }; } return null; };
    let view = null;
    function openType(type, data, title, it) {
      openModal({ title: `📐 ${DC.BY_ID[type].ko}`, width: '1100px', contentBuilder(body) { body.append(viewer({ items: [{ key: type, title: title || DC.BY_ID[type].ko, type, data: JSON.parse(JSON.stringify(data)), sample: !it, why: it ? `내 ${it.menu.slice(1)} 데이터로 만든 예` : '' }], S, showSettings: true, openSettings: false })); } });
    }
    function draw() {
      host.innerHTML = '';
      host.append(el('div', { class: 'page-header' }, [el('h1', {}, `📐 다이어그램 스튜디오 (${DC.TYPES.length}종)`), el('div', { class: 'row', style: 'gap:8px' }, [el('button', { class: 'nm-btn', onclick: openImport }, '⇪ Mermaid·draw.io·Excalidraw 가져오기')])]));
      host.append(el('p', { class: 'dg-intro' }, '카드를 눌러 [샘플 보기] 또는 [내 데이터로] 한 번에 그려 보세요. 모든 메뉴의 머리말에도 📐 버튼이 있어 그 메뉴 자료로 바로 그려 줍니다. 디자인 규칙은 MIT 라이선스의 diagram-design(cathrynlavery)을 따릅니다.'));
      host.append(el('details', { class: 'dg-det', open: true }, [el('summary', {}, '⚙ 전체 설정 (모든 다이어그램에 공통 적용 · 자동 저장/동기화)'), settingsPanel(S, (full) => { if (full) Object.assign(S, loadSettings()); draw(); })]));
      host.append(el('div', { class: 'dg-filter' }, [...fams.map((f) => el('button', { class: `nm-btn nm-btn--sm ${f === family ? 'nm-btn--primary' : ''}`, onclick: () => { family = f; draw(); } }, f)), el('input', { class: 'nm-input', placeholder: '검색(예: 흐름, 비교, 일정)', value: q, style: 'max-width:200px', oninput: (e) => { q = e.target.value; drawGrid(); } })]));
      const grid = el('div', { class: 'dg-grid', id: 'dg-grid' }); host.append(grid); drawGrid();
    }
    function drawGrid() {
      const grid = host.querySelector('#dg-grid'); if (!grid) return; grid.innerHTML = '';
      const list = DC.TYPES.filter((t) => (family === '전체' || t.family === family) && (!q || `${t.ko}${t.en}${t.short}${t.desc}${t.when}`.toLowerCase().includes(q.toLowerCase())));
      if (!list.length) grid.append(el('p', {}, '검색 결과가 없습니다.'));
      list.forEach((t) => { const my = mine(t.id); let thumb = ''; try { thumb = render(t.id, t.sample, { ...S, size: 'fit', layout: 'minimal', motion: 'none', tableView: false }).svg.replace('<svg ', '<svg style="width:100%;height:auto;max-height:150px" '); } catch { /* 무시 */ }
        const btns = el('div', { class: 'row', style: 'gap:6px;margin-top:6px;flex-wrap:wrap' }, [
          el('button', { class: 'nm-btn nm-btn--sm nm-btn--primary', onclick: () => openType(t.id, t.sample) }, '샘플 보기'),
          el('button', { class: 'nm-btn nm-btn--sm', disabled: my ? undefined : true, title: my ? '' : '이 유형으로 그릴 수 있는 내 자료가 아직 없습니다', onclick: () => my && openType(t.id, my.data, my.title, my) }, '내 데이터로'),
        ]);
        const info = el('details', {}, [el('summary', {}, '설명 보기'), el('p', {}, t.desc), el('p', {}, [el('b', {}, '언제: '), t.when]), el('p', {}, [el('b', {}, '팁: '), t.tips])]);
        grid.append(el('div', { class: 'dg-card2' }, [
          el('div', { class: 'dg-card2__thumb', html: thumb }),
          el('div', { class: 'dg-card2__b' }, [el('span', { class: 'dg-card2__fam' }, t.family), el('h4', {}, t.ko), el('small', {}, t.en), el('p', {}, t.short), info, btns]),
        ]));
      });
    }
    function openImport() {
      openModal({ title: '⇪ 다른 도구에서 가져오기', width: '900px', contentBuilder(body) {
        const ta = el('textarea', { class: 'nm-input', rows: 10, placeholder: 'Mermaid 코드(flowchart/graph, sequenceDiagram) · draw.io XML(.drawio 파일 내용) · Excalidraw JSON을 붙여 넣으세요', style: 'width:100%;font-family:monospace' });
        const kind = el('select', { class: 'nm-input' }, [['auto', '자동 감지'], ['mermaid', 'Mermaid'], ['drawio', 'draw.io'], ['excalidraw', 'Excalidraw']].map(([v, t]) => el('option', { value: v }, t)));
        const file = el('input', { type: 'file', accept: '.drawio,.xml,.json,.excalidraw,.mmd,.md,.txt', onchange: (e) => { const f = e.target.files[0]; if (f) f.text().then((t) => { ta.value = t; }); } });
        const out = el('div', {});
        body.append(el('p', {}, '가져온 도형은 이 앱의 엔진이 다시 배치합니다(원본 좌표·색·손그림 모양은 유지되지 않음). 무엇이 옮겨지고 사라졌는지 아래에 알려 드립니다.'), kind, file, ta, el('button', { class: 'nm-btn nm-btn--primary', style: 'margin:8px 0', onclick: () => { const r = IM.importAny(ta.value, kind.value); out.innerHTML = ''; out.append(...r.ledger.map((l) => el('div', { class: `dg-note ${l.level === 'lost' ? 'dg-note--w' : ''}` }, `${l.level === 'lost' ? '⚠' : '✓'} ${l.msg}`))); if (r.data && ((r.data.nodes || r.data.actors || []).length)) out.append(viewer({ items: [{ key: 'imp', title: '가져온 결과', type: r.type, data: r.data, sample: false }], S, showSettings: false })); } }, '그리기'), out);
      } });
    }
    draw();
    return () => {};
  }
  window.renderDiagrams = renderDiagrams;
  window.DiagramStudio = { viewer, settingsPanel, openDiagramModal, doExport, loadSettings, loadProfiles };
})();
