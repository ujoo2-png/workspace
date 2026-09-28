// 아주 단순한 모달 헬퍼. contentBuilder(container)가 내용을 채우고,
// 필요하면 close 함수를 리턴받아 저장 후 닫을 수 있다.
// 일반 <script>로 로드되며 js/utils/dom.js가 먼저 로드되어 window.el이 있어야 한다.
(function () {
  const { el } = window;

  function openModal({ title, contentBuilder, width }) {
    const backdrop = el('div', { class: 'nm-modal-backdrop' });
    const modal = el('div', { class: 'nm-modal' });
    if (width) modal.style.maxWidth = width;
    const closeBtn = el('button', { class: 'nm-btn nm-btn--icon nm-modal__close', 'aria-label': '닫기', onclick: close }, '×');
    const heading = title ? el('h2', {}, title) : null;
    const body = el('div', { class: 'nm-modal__body' });

    modal.append(closeBtn);
    if (heading) modal.append(heading);
    modal.append(body);
    backdrop.append(modal);
    document.body.append(backdrop);

    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
    }
    function onKey(e) {
      if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });

    contentBuilder(body, close);
    return close;
  }

  window.openModal = openModal;
})();
