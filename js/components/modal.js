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
    // 등록창을 고정된 자리가 아니라 마우스로 원하는 위치로 옮길 수 있게, 항상 드래그 손잡이를
    // 하나 둔다(제목이 없는 모달도 옮길 수 있어야 하므로 heading과는 별개로 둔다).
    const dragHandle = el('div', { class: 'nm-modal__draghandle', title: '드래그해서 창 위치 옮기기' });
    const heading = title ? el('h2', { class: 'nm-modal__title' }, title) : null;
    const body = el('div', { class: 'nm-modal__body' });

    modal.append(dragHandle, closeBtn);
    if (heading) modal.append(heading);
    modal.append(body);
    backdrop.append(modal);
    document.body.append(backdrop);

    // --- 드래그로 위치 옮기기 ---
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    function onDragStart(e) {
      dragging = true;
      const rect = modal.getBoundingClientRect();
      startX = e.clientX;
      startY = e.clientY;
      startLeft = rect.left;
      startTop = rect.top;
      // flex로 중앙정렬된 상태에서 position:fixed로 전환해 자유롭게 옮길 수 있게 한다.
      modal.style.position = 'fixed';
      modal.style.margin = '0';
      modal.style.left = `${rect.left}px`;
      modal.style.top = `${rect.top}px`;
      modal.classList.add('nm-modal--dragging');
      document.addEventListener('mousemove', onDragMove);
      document.addEventListener('mouseup', onDragEnd);
      e.preventDefault();
    }
    function onDragMove(e) {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const minVisible = 60; // 화면 밖으로 완전히 사라지지 않게 최소 60px는 보이도록
      const maxLeft = window.innerWidth - minVisible;
      const maxTop = window.innerHeight - minVisible;
      modal.style.left = `${Math.min(Math.max(startLeft + dx, minVisible - modal.offsetWidth), maxLeft)}px`;
      modal.style.top = `${Math.min(Math.max(startTop + dy, 0), maxTop)}px`;
    }
    function onDragEnd() {
      dragging = false;
      modal.classList.remove('nm-modal--dragging');
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
    }
    dragHandle.addEventListener('mousedown', onDragStart);
    if (heading) heading.addEventListener('mousedown', onDragStart);

    function close() {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousemove', onDragMove);
      document.removeEventListener('mouseup', onDragEnd);
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
