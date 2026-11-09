// 양식 문서 도구 지연 로더 (v7.22.0).
// ExcelJS(약 0.9MB)·JSZip과 양식 문서 전용 스크립트는 "이력/경력 → 📄 양식 문서" 탭을 처음 열 때에만 불러온다.
// 그래서 평소 첫 화면 로딩에는 아무 영향이 없고, CDN 없이 이 사이트의 js/vendor/ 파일만 쓰므로 오프라인/사설 환경에서도 동작한다.
// 일반 <script>로 로드되며 window.loadFormTools()를 노출한다(여러 번 불러도 한 번만 실제 로딩).
(function () {
  const cache = {};
  function loadScript(src) {
    if (cache[src]) return cache[src];
    const p = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error(`${src} 를 불러오지 못했습니다. 네트워크/배포 파일을 확인해 주세요.`));
      document.head.append(s);
    });
    cache[src] = p;
    p.catch(() => { delete cache[src]; });
    return p;
  }

  let toolsPromise = null;
  function loadFormTools() {
    if (window.renderCareerDocuments && window.ExcelJS && window.JSZip) return Promise.resolve();
    if (!toolsPromise) {
      toolsPromise = (async () => {
        await Promise.all([loadScript('js/vendor/jszip.min.js'), loadScript('js/vendor/exceljs.min.js'), loadScript('js/utils/xmlTree.js')]);
        await loadScript('js/services/formTemplate.js');
        await loadScript('js/services/formEngine.js');
        await loadScript('js/services/hwpxBridge.js');
        await loadScript('js/modules/careerDocs.js');
      })();
      toolsPromise.catch(() => { toolsPromise = null; });
    }
    return toolsPromise;
  }
  // v7.34.0: 사용자 컬럼 이름 검사용 — 내장 동의어 사전만 필요하므로 가벼운 두 파일만 불러온다(1MB 라이브러리 불필요).
  let coreP = null;
  function loadFormCore() {
    if (window.FormTemplate) return Promise.resolve();
    if (!coreP) { coreP = loadScript('js/utils/xmlTree.js').then(() => loadScript('js/services/formTemplate.js')); coreP.catch(() => { coreP = null; }); }
    return coreP;
  }
  window.loadFormCore = loadFormCore;
  window.loadFormTools = loadFormTools;
})();
