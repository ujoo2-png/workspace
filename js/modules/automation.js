// Automation 화면. 규칙별 on/off·파라미터 조정, 수동 실행, 실행 이력 확인.
// 실제 규칙 계산은 js/rules.js(순수 함수), 저장/중복방지는 js/services/automationService.js가 담당하고
// 여기는 그 설정을 보여주고 바꾸는 화면일 뿐이다.
// 일반 <script>로 로드되며 js/rules.js가 먼저 로드되어 window.AUTOMATION_RULE_DEFS가 있어야 한다.
(function () {
  const { appState, el, escapeHtml, toast } = window;

  function renderAutomation(root) {
    const container = el('div', {});
    root.append(container);
    let running = false;

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, 'Automation'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: runNow, disabled: running || undefined }, running ? '실행 중…' : '▶ 지금 실행'),
        ])
      );

      const ruleCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', {}, '규칙 관리'),
        el('p', { class: 'text-muted' }, '자동화는 항상 "제안형"입니다 — 알림만 생성하고, 데이터를 직접 바꾸지 않습니다.'),
      ]);
      const list = el('div', { class: 'item-list' });
      for (const def of window.AUTOMATION_RULE_DEFS) {
        const stored = appState.automationRules.find((r) => r.rule_type === def.type);
        const enabled = stored ? stored.enabled !== false : true;
        const params = { ...def.defaultParams, ...(stored?.params || {}) };
        const paramKeys = Object.keys(def.defaultParams);

        list.append(
          el('div', { class: 'item-row' }, [
            el('label', { class: 'row', style: 'gap:8px; cursor:pointer' }, [
              el('input', {
                type: 'checkbox',
                checked: enabled || undefined,
                onchange: async (e) => {
                  await appState.setAutomationRule(def.type, { enabled: e.target.checked, params });
                  toast('저장했습니다.', 'success');
                },
              }),
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, def.label),
                paramKeys.length ? el('div', { class: 'item-row__meta' }, `기준: ${paramKeys.map((k) => `${k}=${params[k]}`).join(', ')}`) : null,
              ]),
            ]),
            paramKeys.length
              ? el('input', {
                  class: 'nm-input',
                  style: 'width:80px',
                  type: 'number',
                  min: '1',
                  value: params[paramKeys[0]],
                  onchange: async (e) => {
                    const newParams = { ...params, [paramKeys[0]]: Number(e.target.value) || params[paramKeys[0]] };
                    await appState.setAutomationRule(def.type, { enabled, params: newParams });
                    toast('저장했습니다.', 'success');
                  },
                })
              : null,
          ])
        );
      }
      ruleCard.append(list);
      container.append(ruleCard);

      const logCard = el('div', { class: 'nm-card' }, [el('h3', {}, '최근 실행 이력')]);
      const logs = appState.automationLogs.slice(0, 20);
      if (!logs.length) {
        logCard.append(el('div', { class: 'empty-state' }, '아직 실행 이력이 없습니다.'));
      } else {
        const logList = el('div', { class: 'item-list' });
        for (const log of logs) {
          logList.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, `${log.rule_type} → ${log.result}`),
                el('div', { class: 'item-row__meta' }, (log.created_at || '').replace('T', ' ').slice(0, 19)),
              ]),
            ])
          );
        }
        logCard.append(logList);
      }
      container.append(logCard);
    }

    async function runNow() {
      running = true;
      draw();
      try {
        const alerts = await appState.runAutomationNow();
        toast(`실행 완료 — 새 알림 ${alerts.length}건`, 'success');
      } catch (e) {
        toast(e.message || '실행 중 오류가 발생했습니다.', 'error');
      } finally {
        running = false;
        draw();
      }
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderAutomation = renderAutomation;
})();
