// 파일 첨부 공통 컴포넌트 — 일정/프로젝트 단계/챌린저/차량관리/Devlog/문화생활 등
// 저장된 레코드(id가 있는)라면 어디서든 이 함수 하나로 "파일 삽입/수정(교체)/삭제" UI를 붙일 수 있다.
// 파일은 base64 Data URL로 appState.addAttachment()를 통해 저장된다(js/state.js 참고).
// 일반 <script>로 로드되며 js/utils/dom.js, js/state.js, js/components/modal.js가 먼저 로드되어야 한다.
(function () {
  const { el, escapeHtml, toast, confirmDialog, appState } = window;

  const formatSize = (bytes) => window.formatBytes(bytes);

  // v7.21.0: 첨부 본문(data)은 목록에 들어 있지 않고 필요할 때만 불러온다(최대 10MB라 전부 받으면 너무 무겁다).
  // 다운로드: 눌렀을 때 본문을 받아 Blob URL로 저장한다(큰 Data URL을 href에 직접 두지 않는다).
  async function downloadAttachment(a, btn) {
    const label = btn ? btn.textContent : '';
    if (btn) { btn.disabled = true; btn.textContent = '⏳ 불러오는 중…'; }
    try {
      const dataUrl = await appState.getAttachmentData(a.id);
      const url = URL.createObjectURL(window.dataUrlToBlob(dataUrl));
      const link = document.createElement('a');
      link.href = url; link.download = a.name; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      toast(e.message || '파일을 불러오지 못했습니다.', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = label; }
    }
  }
  function downloadButton(a, className, text) {
    const btn = el('button', { type: 'button', class: className, title: '다운로드', onclick: () => downloadAttachment(a, btn) }, text);
    return btn;
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
            downloadButton(a, 'attach-item__name attach-item__name--btn', `📎 ${a.name}`),
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
      let okCount = 0;
      for (const file of files) {
        // 용량 초과는 읽기 전에 여기서 먼저 거른다 — 어떤 파일이 왜 안 되는지 파일마다 토스트로 알린다.
        const chk = window.checkAttachmentSize(ownerTable, file.size, file.name);
        if (!chk.ok) { toast(chk.message, 'error'); continue; }
        try {
          await appState.addAttachment(ownerTable, ownerId, file);
          okCount++;
        } catch (err) {
          toast(err.message || '파일 첨부에 실패했습니다.', 'error');
        }
      }
      renderAttachmentsPanel(container, ownerTable, ownerId);
      if (okCount) toast(okCount > 1 ? `${okCount}개 파일을 첨부했습니다.` : '파일을 첨부했습니다.', 'success');
    }
    fileInput.addEventListener('change', async () => {
      await handleFiles(fileInput.files);
      fileInput.value = '';
    });
    const addBtn = el('button', { type: 'button', class: 'nm-btn', onclick: () => fileInput.click() }, '+ 파일 추가');
    const limitNote = el('span', { class: 'text-muted attach-limit-note', style: 'font-size:12px' }, `파일당 ${window.attachmentLimitLabel(ownerTable)}`);

    // 드래그 앤 드롭 업로드 — 이 컴포넌트 하나에만 구현해두면 renderAttachmentsPanel/
    // openAttachmentsModal을 쓰는 모든 메뉴에 공통으로 적용된다("공통 메뉴에 드래그가
    // 되도록 해 줘" 요청). 파일 탐색기에서 드래그해온 파일을 dropzone 위에 놓으면
    // 클릭 업로드와 동일하게 addAttachment()가 호출된다.
    const dropzone = el('div', { class: 'attach-dropzone' }, [
      el('span', { class: 'text-muted', style: 'font-size:12px' }, `여기로 파일을 드래그하거나, 버튼으로 추가하세요 (파일당 ${window.attachmentLimitLabel(ownerTable)})`),
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
      el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-bottom:8px' }, [addBtn, limitNote, fileInput]),
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
      const isImg = mime.startsWith('image/');
      const isPdf = mime === 'application/pdf';
      if (!isImg && !isPdf) {
        container.append(el('div', { class: 'item-row' }, [
          downloadButton(a, 'item-row__main attach-item__name--btn', `📎 ${a.name} (다운로드 · ${formatSize(a.size)})`),
        ]));
        continue;
      }
      // 이미지/PDF: 자리를 먼저 잡고, 본문은 이때 처음 불러온다("불러오는 중…" → 표시). 실패하면 다시 시도 버튼.
      const slot = el('div', { class: 'attach-preview', 'data-attachment-id': a.id }, [
        el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:4px' }, `${isImg ? '🖼️' : '📄'} ${a.name} · ${formatSize(a.size)}`),
      ]);
      const status = el('div', { class: 'text-muted attach-preview__status', style: 'font-size:12px' }, '⏳ 불러오는 중…');
      slot.append(status);
      container.append(slot);
      const load = () => {
        status.textContent = '⏳ 불러오는 중…';
        appState.getAttachmentData(a.id).then((dataUrl) => {
          const url = URL.createObjectURL(window.dataUrlToBlob(dataUrl));
          status.remove();
          if (isImg) {
            slot.append(el('img', { src: url, alt: a.name, style: 'max-width:100%; border-radius:8px; display:block' }));
          } else {
            // sandbox="": mime_type는 업로드 시 브라우저가 보고한 값을 그대로 믿으므로(서버 측 콘텐츠 검증 없음),
            // 확장자/타입을 속여 올린 파일이 섞여 있어도 스크립트 실행 등은 전혀 할 수 없도록 모든 권한을 제거한 채로만 렌더링한다.
            slot.append(
              el('iframe', { src: url, sandbox: '', title: a.name, style: 'width:100%; height:400px; border:1px solid var(--border); border-radius:8px' }),
              downloadButton(a, 'nm-btn attach-item__name--btn', '⬇ 다운로드')
            );
          }
        }).catch((e) => {
          status.textContent = '';
          status.append(`불러오지 못했습니다(${e.message || '오류'}) `, el('button', { type: 'button', class: 'nm-btn', onclick: load }, '다시 시도'));
        });
      };
      load();
    }
  }

  window.renderAttachmentsPanel = renderAttachmentsPanel;
  window.openAttachmentsModal = openAttachmentsModal;
  window.renderAttachmentPreviews = renderAttachmentPreviews;
})();
