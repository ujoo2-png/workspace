// 필수 입력 표시 공통 헬퍼 (v7.21.0)
// 규칙: 필수(required) 컨트롤이 들어 있는 필드의 라벨 "텍스트 바로 왼쪽"에 빨간 * 를 붙이고,
// 컨트롤에는 aria-required="true", 필수 입력이 있는 모달/폼 맨 위에는 "* 필수 입력" 안내 한 줄을 둔다.
//
// 모든 폼에 자동 적용된다 — 각 모듈이 따로 별 표시를 만들 필요 없이 `required: true`만 지정하면 되고,
// 나중에 required가 토글되는 경우(예: Health 혈압 ↔ 단일 값)에도 별이 따라서 켜지고 꺼진다.
//   · 자동 적용: MutationObserver가 DOM 추가/required 속성 변경을 감지해 syncRequiredMarkers()를 실행
//   · 수동 사용: window.nmField(label, control, { required: true, hint })  → <div.nm-field><label>*라벨</label>control</div>
// 일반 <script>로 로드되며 js/utils/dom.js(el) 다음에 로드한다.
(function () {
  const BOX_SEL = '.nm-field, .lfg';

  function reqStar(auto) {
    const s = document.createElement('span');
    s.className = 'req req-star';
    s.setAttribute('aria-hidden', 'true');
    if (auto) s.dataset.auto = '1';
    s.textContent = '*';
    return s;
  }

  // 라벨 + 컨트롤을 묶은 .nm-field를 만든다. required면 컨트롤에 required를 켜고 별을 라벨 왼쪽에 붙인다.
  function nmField(label, control, opts = {}) {
    const { required = false, hint = null, className = '' } = opts;
    if (required && control && 'required' in control) control.required = true;
    const lab = document.createElement('label');
    if (required) lab.append(reqStar(false));
    lab.append(document.createTextNode(label));
    const box = document.createElement('div');
    box.className = `nm-field ${className}`.trim();
    box.append(lab, control);
    if (hint) {
      const h = document.createElement('div');
      h.className = 'nm-field__hint text-muted';
      h.textContent = hint;
      box.append(h);
    }
    if (required) syncRequiredMarkers(box);
    return box;
  }

  function labelOf(box) {
    for (const c of box.children) if (c.tagName === 'LABEL') return c;
    return box.querySelector('label');
  }

  function syncRequiredMarkers(root = document) {
    const scope = root.querySelectorAll ? root : document;
    // 1) 필수 컨트롤: aria-required + 라벨 왼쪽 별
    scope.querySelectorAll('[required]').forEach((ctrl) => {
      if (ctrl.type === 'hidden') return;
      ctrl.setAttribute('aria-required', 'true');
      const box = ctrl.closest(BOX_SEL);
      if (!box) return;
      const lab = labelOf(box);
      if (!lab || lab.contains(ctrl)) return;
      if (!lab.querySelector(':scope > .req')) lab.prepend(reqStar(true));
    });
    // 2) required가 꺼진 컨트롤의 aria-required, 더 이상 필수가 아닌 필드의 자동 별 제거
    scope.querySelectorAll('[aria-required="true"]:not([required])').forEach((c) => c.removeAttribute('aria-required'));
    scope.querySelectorAll('label > .req[data-auto]').forEach((s) => {
      const box = s.closest(BOX_SEL);
      if (!box || !box.querySelector('[required]')) s.remove();
    });
    // 3) 필수 입력이 있는 모달/로그인 폼에 범례 한 줄
    scope.querySelectorAll('.nm-modal form, form.lo-panel').forEach((form) => {
      const has = !!form.querySelector('[required]');
      const legend = form.querySelector(':scope > .req-legend');
      if (has && !legend) {
        const p = document.createElement('div');
        p.className = 'req-legend';
        p.append(reqStar(false), document.createTextNode(' 필수 입력'));
        form.prepend(p);
      } else if (!has && legend) legend.remove();
    });
  }

  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => { scheduled = false; syncRequiredMarkers(document); });
  }
  function start() {
    if (!document.body || start.done) return;
    start.done = true;
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['required'] });
    schedule();
  }
  if (typeof document !== 'undefined') {
    if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  }

  window.reqStar = reqStar;
  window.nmField = nmField;
  window.syncRequiredMarkers = syncRequiredMarkers;
})();
