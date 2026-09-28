// crypto.randomUUID가 없는 환경(구형 브라우저, 비-https 컨텍스트) 대비 폴백 포함
// globalThis.uid로 전역 등록 (일반 <script>, ES 모듈 아님 — QMS 프로젝트와 동일한 방식).
// globalThis를 쓰면 브라우저(window)와 Node(단위 테스트) 양쪽에서 동일하게 동작한다.
(function () {
  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    // RFC4122 v4 폴백
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  globalThis.uid = uid;
})();
