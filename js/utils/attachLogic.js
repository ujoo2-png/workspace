// 첨부파일 순수 로직(v7.21.0): 소유 테이블별 용량 제한, 크기 표기, Data URL → Blob.
// 첨부는 base64 Data URL 텍스트로 attachments.data 컬럼에 저장되므로 실제 행 크기는 원본의 약 4/3배(10MB → 약 13.3MB)이다.
(function () {
  const MB = 1024 * 1024;
  // 소유 테이블별 상한. 목록에 없으면 default.
  //  · knowledge_docs: 10MB — 문서/PDF/이미지 자료용. 본문은 열람 모달에서만 "그때 불러온다"(lazy) → 목록/홈 로딩에 영향 없음.
  //  · career_documents: 10MB — 양식 문서의 템플릿 원본과 최종본(xlsx/docx; 증명사진이 들어가면 커질 수 있음). 본문은 필요할 때만 불러온다.
  //  · 그 밖: 4MB 유지 — 증명사진·문화생활 포스터처럼 목록에서 이미지를 바로 보여 주는 메뉴가 있어 큰 파일이 늘면 화면이 무거워지고,
  //    로컬 모드(localStorage ~5MB)에서도 저장 자체가 불가능해진다. 필요해지면 이 표 한 줄만 바꾸면 된다.
  const ATTACH_LIMITS = { default: 4 * MB, knowledge_docs: 10 * MB, career_documents: 10 * MB };

  function attachmentLimit(ownerTable) {
    return ATTACH_LIMITS[ownerTable] || ATTACH_LIMITS.default;
  }
  function formatBytes(bytes) {
    if (bytes === null || bytes === undefined || Number.isNaN(Number(bytes))) return '';
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < MB) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / MB).toFixed(1)}MB`;
  }
  function limitLabel(ownerTable) {
    return `최대 ${Math.round(attachmentLimit(ownerTable) / MB)}MB`;
  }
  /** @returns {{ok:boolean, message:string|null}} — 초과 시 파일 크기와 제한을 함께 알리는 문장. */
  function checkAttachmentSize(ownerTable, size, name = '') {
    const limit = attachmentLimit(ownerTable);
    if (size > limit) {
      return { ok: false, message: `${name ? `"${name}" ` : ''}파일이 너무 큽니다(${formatBytes(size)}). 이 메뉴는 파일당 ${limitLabel(ownerTable).replace('최대 ', '')}까지 첨부할 수 있습니다.` };
    }
    return { ok: true, message: null };
  }
  function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;,]*)(;base64)?,(.*)$/s.exec(dataUrl || '');
    if (!m) return new Blob([]);
    const mime = m[1] || 'application/octet-stream';
    if (!m[2]) return new Blob([decodeURIComponent(m[3])], { type: mime });
    const bin = atob(m[3]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }

  window.ATTACH_LIMITS = ATTACH_LIMITS;
  window.attachmentLimit = attachmentLimit;
  window.formatBytes = formatBytes;
  window.attachmentLimitLabel = limitLabel;
  window.checkAttachmentSize = checkAttachmentSize;
  window.dataUrlToBlob = dataUrlToBlob;
})();
