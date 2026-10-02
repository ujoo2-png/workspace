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
    async function handleFiles(files) {
      files = Array.from(files || []);
      if (!files.length) return;
      for (const file of files) {
        try {
          await appState.addAttachment(ownerTable, ownerId, file);
        } catch (err) {
          toast(err.message || '파일 첨부에 실패했습니다.', 'error');
        }
      }
      renderAttachmentsPanel(container, ownerTable, ownerId);
      toast('파일을 첨부했습니다.', 'success');
    }
    fileInput.addEventListener('change', async () => {
      await handleFiles(fileInput.files);
      fileInput.value = '';
    });
    const addBtn = el('button', { type: 'button', class: 'nm-btn', onclick: () => fileInput.click() }, '+ 파일 추가');

    // 드래그 앤 드롭 업로드 — 이 컴포넌트 하나에만 구현해두면 renderAttachmentsPanel/
    // openAttachmentsModal을 쓰는 모든 메뉴에 공통으로 적용된다("공통 메뉴에 드래그가
    // 되도록 해 줘" 요청). 파일 탐색기에서 드래그해온 파일을 dropzone 위에 놓으면
    // 클릭 업로드와 동일하게 addAttachment()가 호출된다.
    const dropzone = el('div', { class: 'attach-dropzone' }, [
      el('span', { class: 'text-muted', style: 'font-size:12px' }, '여기로 파일을 드래그하거나, 버튼으로 추가하세요'),
    ]);
    let dragCounter = 0;
    dropzone.addEventListener('dragenter', (e) => {
      e.preventDefault();
      dragCounter++;
      dropzone.classList.add('attach-dropzone--active');
    });
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    });
    dropzone.addEventListener('dragleave', (e) => {
      e.preventDefault();
      dragCounter = Math.max(0, dragCounter - 1);
      if (dragCounter === 0) dropzone.classList.remove('attach-dropzone--active');
    });
    dropzone.addEventListener('drop', async (e) => {
      e.preventDefault();
      dragCounter = 0;
      dropzone.classList.remove('attach-dropzone--active');
      const files = e.dataTransfer?.files;
      await handleFiles(files);
    });

    container.append(
      el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-bottom:8px' }, [addBtn, fileInput]),
      dropzone,
      list
    );
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

  // 첨부파일 "미리보기"(이미지는 <img>, PDF는 <iframe>, 그 외는 다운로드 링크)를 그려주는
  // 공통 헬퍼. Knowledge의 열람 모달에서 처음 구현한 로직을 다른 메뉴(Career 등)에서도
  // 재사용할 수 있도록 여기로 옮겨 공통화했다.
  function renderAttachmentPreviews(container, ownerTable, ownerId) {
    container.innerHTML = '';
    const rows = appState.getAttachments(ownerTable, ownerId);
    if (!rows.length) return;
    for (const a of rows) {
      const mime = a.mime_type || '';
      if (mime.startsWith('image/')) {
        container.append(
          el('div', {}, [
            el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:4px' }, `🖼️ ${escapeHtml(a.name)}`),
            el('img', { src: a.data, alt: a.name, style: 'max-width:100%; border-radius:8px; display:block' }),
          ])
        );
      } else if (mime === 'application/pdf') {
        container.append(
          el('div', {}, [
            el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:4px' }, `📄 ${escapeHtml(a.name)}`),
            // sandbox="": mime_type는 업로드 시 브라우저가 보고한 값을 그대로 믿으므로(서버 측
            // 콘텐츠 검증 없음), 확장자/타입을 속여 올린 파일이 섞여 있어도 스크립트 실행 등은
            // 전혀 할 수 없도록 모든 권한을 제거한 채로만 미리보기 렌더링한다(방어 심층화).
            el('iframe', { src: a.data, sandbox: '', style: 'width:100%; height:400px; border:1px solid var(--border); border-radius:8px' }),
          ])
        );
      } else {
        container.append(
          el('div', { class: 'item-row' }, [
            el('a', { class: 'item-row__main', href: a.data, download: a.name }, `📎 ${escapeHtml(a.name)} (다운로드)`),
          ])
        );
      }
    }
  }

  window.renderAttachmentsPanel = renderAttachmentsPanel;
  window.openAttachmentsModal = openAttachmentsModal;
  window.renderAttachmentPreviews = renderAttachmentPreviews;
})();
