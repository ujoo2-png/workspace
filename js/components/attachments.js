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


  // ---- v7.35.0: 캡처한 화면 붙여넣기 / 화면 캡처 (모든 메뉴 공통 — 이 컴포넌트를 쓰는 곳은 자동 적용) ----
  // 1) Ctrl+V: Win+Shift+S, PrtSc, 맥의 ⌘⇧4(Ctrl 추가) 등으로 클립보드에 복사한 이미지를 그대로 붙여넣는다.
  // 2) 📋 붙여넣기 버튼: 클립보드의 이미지를 읽는다(브라우저가 권한을 물을 수 있음).
  // 3) 🖥 화면 캡처 버튼: 브라우저의 화면 공유 선택창에서 탭/창/화면을 고르면 한 장을 찍어 담는다(PC 브라우저, https 필요).
  const livePanels = []; // 붙여넣기 대상 후보(가장 나중에 그려진 살아있는 패널이 받는다)
  let pasteBound = false;
  function isTextTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || t.isContentEditable === true;
  }
  function bindDocumentPaste() {
    if (pasteBound) return;
    pasteBound = true;
    document.addEventListener('paste', (e) => {
      const files = window.imageFilesFromItems(e.clipboardData && e.clipboardData.items);
      if (!files.length) return; // 텍스트 붙여넣기는 건드리지 않는다
      for (let i = livePanels.length - 1; i >= 0; i--) if (!livePanels[i].container.isConnected) livePanels.splice(i, 1);
      const target = livePanels[livePanels.length - 1];
      if (!target) return;
      // 글자 입력칸에 붙여넣는 중이면(이미지가 같이 있어도) 방해하지 않는다. 단, 첨부 영역 안에서는 항상 가로챈다.
      if (isTextTarget(e.target) && !target.container.contains(e.target)) return;
      e.preventDefault();
      target.onFiles(window.namedCaptureFiles(files, new Date()));
    });
  }
  async function readClipboardImages() {
    if (!navigator.clipboard || !navigator.clipboard.read) throw new Error('이 브라우저는 버튼으로 클립보드를 읽을 수 없습니다. 이미지를 복사한 뒤 이 영역을 클릭하고 Ctrl+V를 눌러 주세요.');
    const items = await navigator.clipboard.read();
    const blobs = [];
    for (const it of items) {
      const type = it.types.find((t) => /^image\//.test(t));
      if (type) blobs.push(await it.getType(type));
    }
    if (!blobs.length) throw new Error('클립보드에 이미지가 없습니다. 화면 캡처(Win+Shift+S 등)를 한 뒤 다시 눌러 주세요.');
    return window.namedCaptureFiles(blobs, new Date());
  }
  async function captureScreenFile() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) throw new Error('이 브라우저/기기에서는 화면 캡처를 지원하지 않습니다. 캡처 후 Ctrl+V로 붙여넣어 주세요.');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: false });
    try {
      const video = document.createElement('video');
      video.srcObject = stream; video.muted = true;
      await video.play();
      await new Promise((r) => setTimeout(r, 350)); // 첫 프레임이 그려질 때까지 잠깐 대기
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      canvas.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('캡처 이미지를 만들지 못했습니다.');
      return window.namedCaptureFiles([blob], new Date())[0];
    } finally {
      stream.getTracks().forEach((t) => t.stop());
    }
  }
  window.readClipboardImages = readClipboardImages; // v7.36.0: 문화생활 포스터 '스냅샷 추가'가 재사용
  window.captureScreenFile = captureScreenFile;
  /** 첨부 영역 하나에 붙여넣기/캡처 기능을 붙인다. onFiles(File[])로 결과를 넘긴다. 반환: 버튼들. */
  function attachCaptureTools(container, dropzone, onFiles) {
    bindDocumentPaste();
    livePanels.push({ container, onFiles });
    dropzone.setAttribute('tabindex', '0');
    dropzone.classList.add('attach-dropzone--paste');
    dropzone.addEventListener('paste', (e) => {
      const files = window.imageFilesFromItems(e.clipboardData && e.clipboardData.items);
      if (!files.length) return;
      e.preventDefault(); e.stopPropagation();
      onFiles(window.namedCaptureFiles(files, new Date()));
    });
    const wrap = (fn, busyText, btn) => async () => {
      const label = btn.textContent; btn.disabled = true; btn.textContent = busyText;
      try { const r = await fn(); onFiles(Array.isArray(r) ? r : [r]); }
      catch (err) { if (err && err.name === 'NotAllowedError') toast('권한이 거부되었습니다. 브라우저 주소창의 권한 설정을 확인하거나 Ctrl+V로 붙여넣어 주세요.', 'error'); else toast(err.message || '실패했습니다.', 'error'); }
      finally { btn.disabled = false; btn.textContent = label; }
    };
    const pasteBtn = el('button', { type: 'button', class: 'nm-btn attach-paste-btn', title: '복사해 둔 캡처 이미지를 붙여넣기 (Ctrl+V도 됩니다)' }, '📋 붙여넣기');
    pasteBtn.onclick = wrap(readClipboardImages, '⏳ 읽는 중…', pasteBtn);
    const btns = [pasteBtn];
    if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
      const capBtn = el('button', { type: 'button', class: 'nm-btn attach-capture-btn', title: '화면/창/탭을 골라 지금 모습을 한 장 찍어 첨부합니다' }, '🖥 화면 캡처');
      capBtn.onclick = wrap(captureScreenFile, '⏳ 캡처 중…', capBtn);
      btns.push(capBtn);
    }
    return btns;
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
      el('span', { class: 'text-muted', style: 'font-size:12px' }, `여기로 파일을 드래그하거나, 버튼으로 추가하세요. 캡처한 화면은 Ctrl+V로 바로 붙여넣을 수 있어요 (파일당 ${window.attachmentLimitLabel(ownerTable)})`),
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

    const captureBtns = attachCaptureTools(container, dropzone, handleFiles);
    container.append(
      el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap' }, [addBtn, ...captureBtns, limitNote, fileInput]),
      dropzone,
      list
    );
  }

  // v7.24.0: "저장 전 파일 첨부" 공통 헬퍼.
  // 레코드가 아직 저장되지 않았을 때(ownerId 없음) 파일을 메모리에 담아 두었다가,
  // 저장이 끝나 실제 id가 생기면 한꺼번에 addAttachment()로 옮긴다.
  // 저장 팝업(일정/Knowledge/문화생활/Career 등)에서 이 함수가 그리는 드래그 영역을
  // 폼 안에 두면, 사용자는 저장을 누르기 전에 파일을 끌어다 놓을 수 있다.
  //   const pending = window.createPendingAttachments(container, ownerTable);
  //   // 저장 성공 후:  await pending.flush(row.id);
  //   // 저장 실패/취소: pending.clear();  (선택)
  function createPendingAttachments(container, ownerTable) {
    let files = []; // { file, ok, message }
    container.innerHTML = '';
    container.className = 'attach-panel attach-panel--pending';

    const list = el('div', { class: 'attach-list' });
    function drawList() {
      list.innerHTML = '';
      if (!files.length) {
        list.append(el('div', { class: 'text-muted', style: 'font-size:12px' }, '아직 담긴 파일이 없습니다. 저장하면 아래 파일이 첨부됩니다.'));
        return;
      }
      files.forEach((entry, i) => {
        list.append(
          el('div', { class: 'attach-item' }, [
            el('span', { class: 'attach-item__name' }, `📎 ${entry.file.name}`),
            el('span', { class: 'attach-item__size' }, formatSize(entry.file.size)),
            el('button', {
              type: 'button', class: 'nm-btn nm-btn--icon nm-btn--danger', title: '목록에서 빼기',
              onclick: () => { files.splice(i, 1); drawList(); },
            }, '✕'),
          ])
        );
      });
    }

    function addFiles(incoming) {
      for (const file of Array.from(incoming || [])) {
        const chk = window.checkAttachmentSize(ownerTable, file.size, file.name);
        if (!chk.ok) { toast(chk.message, 'error'); continue; }
        // 같은 이름·크기 파일은 한 번만 담는다.
        if (files.some((f) => f.file.name === file.name && f.file.size === file.size)) continue;
        files.push({ file });
      }
      drawList();
    }

    const fileInput = el('input', { type: 'file', class: 'hidden', multiple: true });
    fileInput.addEventListener('change', () => { addFiles(fileInput.files); fileInput.value = ''; });
    const addBtn = el('button', { type: 'button', class: 'nm-btn', onclick: () => fileInput.click() }, '+ 파일 담기');
    const dropzone = el('div', { class: 'attach-dropzone' }, [
      el('span', { class: 'text-muted', style: 'font-size:12px' }, `저장 전에 여기로 파일을 드래그하거나 버튼으로 담으세요. 캡처한 화면은 Ctrl+V로 붙여넣을 수 있어요 (파일당 ${window.attachmentLimitLabel(ownerTable)})`),
    ]);
    let dragCounter = 0;
    dropzone.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; dropzone.classList.add('attach-dropzone--active'); });
    dropzone.addEventListener('dragover', (e) => { e.preventDefault(); if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'; });
    dropzone.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter = Math.max(0, dragCounter - 1); if (dragCounter === 0) dropzone.classList.remove('attach-dropzone--active'); });
    dropzone.addEventListener('drop', (e) => { e.preventDefault(); dragCounter = 0; dropzone.classList.remove('attach-dropzone--active'); addFiles(e.dataTransfer?.files); });

    const captureBtns = attachCaptureTools(container, dropzone, addFiles);
    container.append(
      el('div', { class: 'row', style: 'gap:8px; align-items:center; margin-bottom:8px; flex-wrap:wrap' }, [addBtn, ...captureBtns, fileInput]),
      dropzone,
      list
    );
    drawList();

    return {
      get count() { return files.length; },
      // 저장 후 호출: 담아둔 파일을 실제 레코드에 첨부한다. 성공 건수를 반환한다.
      async flush(ownerId) {
        if (!ownerId || !files.length) return 0;
        let ok = 0;
        for (const entry of files) {
          try { await appState.addAttachment(ownerTable, ownerId, entry.file); ok++; }
          catch (err) { toast(`"${entry.file.name}" 첨부 실패: ${err.message || err}`, 'error'); }
        }
        files = [];
        drawList();
        return ok;
      },
      clear() { files = []; drawList(); },
    };
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
  window.createPendingAttachments = createPendingAttachments;
})();
