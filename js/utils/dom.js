// DOM 헬퍼 모음. 일반 <script>로 로드되므로 window.* 전역 함수로 등록한다.
(function () {
  // XSS 방지를 위한 최소 escape. 사용자가 입력한 문자열을 innerHTML에 꽂을 때 항상 통과시킨다.
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function qs(sel, root = document) {
    return root.querySelector(sel);
  }
  function qsa(sel, root = document) {
    return Array.from(root.querySelectorAll(sel));
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k === 'dataset') Object.assign(node.dataset, v);
      else if (k === 'html') node.innerHTML = v; // 호출부에서 escapeHtml을 거친 값만 넘겨야 함
      else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
      else if (v !== false && v !== null && v !== undefined) node.setAttribute(k, v);
    }
    for (const child of [].concat(children)) {
      if (child === null || child === undefined) continue;
      node.append(child.nodeType ? child : document.createTextNode(String(child)));
    }
    return node;
  }

  let toastHost = null;
  function toast(message, kind = 'info') {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toast-host';
      document.body.append(toastHost);
    }
    const node = el('div', { class: `toast toast--${kind}` }, message);
    toastHost.append(node);
    requestAnimationFrame(() => node.classList.add('toast--show'));
    setTimeout(() => {
      node.classList.remove('toast--show');
      setTimeout(() => node.remove(), 250);
    }, 3200);
  }

  function confirmDialog(message) {
    // MVP: 네이티브 confirm 사용(추후 네오모피즘 모달로 교체 가능한 지점을 함수로 분리해둠)
    return window.confirm(message);
  }

  window.escapeHtml = escapeHtml;
  window.qs = qs;
  window.qsa = qsa;
  window.el = el;
  window.toast = toast;
  window.confirmDialog = confirmDialog;
})();
