// 파일 첨부 공통 컴포넌트 — 일정/프로젝트 단계/챌린저/차량관리/Devlog/문화생활 등
// 저장된 레코드(id가 있는)라면 어디서든 이 함수 하나로 "파일 삽입/수정(교체)/삭제" UI를 붙일 수 있다.
// 파일은 base64 Data URL로 appState.addAttachment()를 통해 저장된다(js/state.js 참고).
// 일반 <script>로 로드되며 js/utils/dom.js, js/state.js, js/components/modal.js가 먼저 로드되어야 한다.
(function () {
  const { el, escapeHtml, toast, confirmDialog, appState } = window;

  function formatSize(bytes) {
    if (!bytes && bytes !== 0) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  }

  // container 안에 첨부 목록 + 업로드 버튼을 그려넣는다. ownerTable/ownerId 레코드가 바뀌거나
  // appState가 change 이벤트를 낼 때마다 다시 그리도록 호출부에서 redraw()를 다시 불러도 된다.
  function renderAttachmentsPanel(container, ownerTable, ownerId) {
    container.innerHTML = '';
    container.className = 'attach-panel';

    const list = el('div', { class: 'attach-list' });
    const rows = appState.getAttachments(ownerTable, ownerId);
    if (!rows.length) {
      list.append(el('div', { class: 'text-muted', style: 'font-size:12px' }, '첨부된 파일이 없습니다.'));
    } else {
      for (const a of rows) {
        list.append(
          el('div', { class: 'attach-item' }, [
            el('a', { class: 'attach-item__name', href: a.data, download: a.name, title: '다운로드' }, `📎 ${escapeHtml(a.name)}`),
            el('span', { class: 'attach-item__size' }, formatSize(a.size)),
            el(
              'button',
              {
                type: 'button',
                class: 'nm-btn nm-btn--icon nm-btn--danger',
                title: '삭제',
                onclick: async () => {
                  if (!confirmDialog(`"${a.name}" 파일을 삭제할까요?`)) return;
                  await appState.deleteAttachment(a.id);
                  renderAttachmentsPanel(container, ownerTable, ownerId);
                  toast('파일을 삭제했습니다.', 'success');
                },
              },
              '🗑'
            ),
          ])
        );
      }
    }

    const fileInput = el('input', { type: 'file', class: 'hidden', multiple: true });
    fileInput.addEventListener('change', async () => {
      const files = Array.from(fileInput.files || []);
      if (!files.length) return;
      for (const file of files) {
        try {
          await appState.addAttachment(ownerTable, ownerId, file);
        } catch (err) {
          toast(err.message || '파일 첨부에 실패했습니다.', 'error');
        }
      }
      fileInput.value = '';
      renderAttachmentsPanel(container, ownerTable, ownerId);
      toast('파일을 첨부했습니다.', 'success');
    });
    const addBtn = el('button', { type: 'button', class: 'nm-btn', onclick: () => fileInput.click() }, '+ 파일 추가');

    container.append(el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-bottom:8px' }, [addBtn, fileInput]), list);
  }

  // 별도 모달로 열어서 쓰고 싶을 때(목록 화면의 📎 버튼 등)를 위한 헬퍼.
  function openAttachmentsModal(ownerTable, ownerId, title) {
    window.openModal({
      title: title ? `${title} — 첨부파일` : '첨부파일',
      width: '440px',
      contentBuilder(body) {
        const panel = el('div', {});
        body.append(panel);
        renderAttachmentsPanel(panel, ownerTable, ownerId);
      },
    });
  }

  window.renderAttachmentsPanel = renderAttachmentsPanel;
  window.openAttachmentsModal = openAttachmentsModal;
})();
