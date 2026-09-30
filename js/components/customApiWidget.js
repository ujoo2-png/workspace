// 특정 메뉴(라우트 경로)에 연결된 커스텀 API들을 그 화면 하단에 카드로 렌더링한다.
// js/router.js가 화면을 렌더링한 직후 호출해준다(각 메뉴 모듈을 일일이 수정할 필요가 없도록).
// 일반 <script>로 로드되며 js/services/customApiService.js, js/utils/dom.js가 먼저 로드되어야 한다.
(function () {
  const { el, escapeHtml } = window;

  // JSON 값을 아주 단순한 카드 목록으로 렌더링한다(정해진 필드가 없으므로 "그럴듯하게" 보여줄 뿐).
  // 배열이면 각 항목을 한 줄(대표 필드 1~2개)로, 객체면 key: value 목록으로, 그 외엔 그대로 문자열로.
  function renderJsonPreview(data) {
    if (Array.isArray(data)) {
      if (!data.length) return el('div', { class: 'text-muted', style: 'font-size:12px' }, '빈 배열입니다.');
      const list = el('div', { class: 'item-list' });
      data.slice(0, 10).forEach((item) => {
        if (item && typeof item === 'object') {
          const entries = Object.entries(item).slice(0, 4);
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, entries.map(([k, v]) =>
                el('div', { class: 'text-muted', style: 'font-size:12px' }, `${escapeHtml(k)}: ${escapeHtml(String(v))}`)
              )),
            ])
          );
        } else {
          list.append(el('div', { class: 'item-row' }, el('div', { class: 'item-row__main' }, escapeHtml(String(item)))));
        }
      });
      if (data.length > 10) list.append(el('div', { class: 'text-muted', style: 'font-size:11px' }, `… 외 ${data.length - 10}건`));
      return list;
    }
    if (data && typeof data === 'object') {
      const entries = Object.entries(data).slice(0, 20);
      return el('div', { class: 'item-list' }, entries.map(([k, v]) =>
        el('div', { class: 'item-row' }, [
          el('div', { class: 'item-row__main' }, [
            el('div', { style: 'font-size:12px; font-weight:600' }, escapeHtml(k)),
            el('div', { class: 'text-muted', style: 'font-size:12px' }, escapeHtml(typeof v === 'object' ? JSON.stringify(v) : String(v))),
          ]),
        ])
      ));
    }
    return el('pre', { style: 'white-space:pre-wrap; font-size:12px; max-height:240px; overflow:auto' }, escapeHtml(String(data)));
  }

  function apiCard(api) {
    const card = el('div', { class: 'nm-card', style: 'margin-top:16px' });
    const body = el('div', { style: 'margin-top:8px' }, [el('div', { class: 'text-muted' }, '불러오는 중…')]);
    const refreshBtn = el('button', { class: 'nm-btn nm-btn--icon', title: '새로고침' }, '🔄');
    card.append(
      el('div', { class: 'row row--between' }, [
        el('strong', { style: 'font-size:13px' }, `🔌 ${escapeHtml(api.name)}`),
        refreshBtn,
      ]),
      body
    );

    async function load(force) {
      body.innerHTML = '';
      body.append(el('div', { class: 'text-muted' }, '불러오는 중…'));
      try {
        const result = await window.fetchCustomApi(api, { force });
        body.innerHTML = '';
        body.append(
          result.kind === 'json' ? renderJsonPreview(result.data) : el('pre', { style: 'white-space:pre-wrap; font-size:12px; max-height:240px; overflow:auto' }, escapeHtml(String(result.data).slice(0, 4000)))
        );
        body.append(el('div', { class: 'text-muted', style: 'font-size:10px; margin-top:6px' }, `마지막 갱신: ${new Date(result.fetchedAt).toLocaleString('ko-KR')}${result.viaProxy ? '' : ' · 직접 호출'}`));
      } catch (e) {
        body.innerHTML = '';
        body.append(el('div', { class: 'text-muted', style: 'color:#ef4444; font-size:12px' }, `불러오지 못했습니다: ${e.message}`));
      }
    }

    refreshBtn.addEventListener('click', () => load(true));
    load(false);
    return card;
  }

  // router.js가 각 화면 렌더링 직후 호출한다. root: 그 화면의 view-root 엘리먼트, path: 현재 라우트.
  function renderCustomApiWidgetsForRoute(root, path) {
    if (!window.customApisForMenu) return;
    const apis = window.customApisForMenu(path);
    if (!apis.length) return;
    for (const api of apis) root.append(apiCard(api));
  }

  window.renderCustomApiWidgetsForRoute = renderCustomApiWidgetsForRoute;
})();
