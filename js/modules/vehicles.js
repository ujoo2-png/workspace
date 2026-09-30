// 차량관리 화면. 차량 등록 + 정비/주유 기록 + 다음 정비 예측(주행거리·기간 중 먼저 도달하는 쪽) +
// 보험/등록 만료 D-day + 연비 추이. 개발계획서 8장 참고.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO, diffDays, addDays, predictNextMaintenance, calcFuelEfficiency } = window;

  const FUEL_TYPE_LABEL = { gasoline: '휘발유', diesel: '경유(디젤)', hybrid: '하이브리드', ev: '전기', lpg: 'LPG' };

  // 제조사별 정확한 정비 매뉴얼 대신, 국내에서 통용되는 일반적인 권장 주기(요약)로 제안한다.
  // 실제 차량은 제조사 매뉴얼을 우선하고, 이 값은 참고용 가이드로 안내한다.
  const MAINTENANCE_RULES = {
    gasoline: [
      { key: 'engine_oil', label: '엔진오일 교체', keywords: ['엔진오일', '오일교체', '오일'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'tire_rotation', label: '타이어 위치교환(로테이션)', keywords: ['로테이션', '위치교환'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'tire_replace', label: '타이어 교체', keywords: ['타이어교체', '타이어 교체'], intervalKm: 40000, intervalMonths: 48 },
      { key: 'brake_pad', label: '브레이크 패드 점검', keywords: ['브레이크'], intervalKm: 30000, intervalMonths: 36 },
    ],
    diesel: [
      { key: 'engine_oil', label: '엔진오일 교체(디젤)', keywords: ['엔진오일', '오일교체', '오일'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'tire_rotation', label: '타이어 위치교환(로테이션)', keywords: ['로테이션', '위치교환'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'tire_replace', label: '타이어 교체', keywords: ['타이어교체', '타이어 교체'], intervalKm: 40000, intervalMonths: 48 },
      { key: 'brake_pad', label: '브레이크 패드 점검', keywords: ['브레이크'], intervalKm: 30000, intervalMonths: 36 },
      { key: 'urea', label: '요소수(AdBlue) 보충', keywords: ['요소수', 'adblue', '애드블루'], intervalKm: 8000, intervalMonths: 6 },
    ],
    hybrid: [
      { key: 'engine_oil', label: '엔진오일 교체', keywords: ['엔진오일', '오일교체', '오일'], intervalKm: 15000, intervalMonths: 12 },
      { key: 'tire_rotation', label: '타이어 위치교환(로테이션)', keywords: ['로테이션', '위치교환'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'tire_replace', label: '타이어 교체', keywords: ['타이어교체', '타이어 교체'], intervalKm: 40000, intervalMonths: 48 },
      { key: 'hybrid_battery_check', label: '하이브리드 배터리 점검', keywords: ['배터리 점검', '하이브리드 배터리'], intervalKm: 40000, intervalMonths: 24 },
    ],
    ev: [
      { key: 'tire_rotation', label: '타이어 위치교환(로테이션)', keywords: ['로테이션', '위치교환'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'tire_replace', label: '타이어 교체', keywords: ['타이어교체', '타이어 교체'], intervalKm: 40000, intervalMonths: 48 },
      { key: 'coolant_check', label: '냉각수/감속기 오일 점검', keywords: ['냉각수', '감속기'], intervalKm: 40000, intervalMonths: 24 },
    ],
    lpg: [
      { key: 'engine_oil', label: '엔진오일 교체', keywords: ['엔진오일', '오일교체', '오일'], intervalKm: 8000, intervalMonths: 12 },
      { key: 'tire_rotation', label: '타이어 위치교환(로테이션)', keywords: ['로테이션', '위치교환'], intervalKm: 10000, intervalMonths: 12 },
      { key: 'lpg_filter', label: 'LPG 연료필터 점검', keywords: ['연료필터', 'lpg필터'], intervalKm: 20000, intervalMonths: 24 },
    ],
  };

  function getMaintenanceRules(fuelType) {
    return MAINTENANCE_RULES[fuelType] || MAINTENANCE_RULES.gasoline;
  }

  // 주유·정비·주행거리 기록을 모두 합쳐 "가장 최근에 확인된 주행거리 + 그 시점"과
  // 일평균 주행거리(dailyKm) 추세를 함께 구한다. predict.js의 predictNextMaintenance가 쓰는
  // 방식과 동일한 아이디어(최근 두 지점 사이 거리/일수)를 재사용한다.
  function combineOdometerSeries(fuels, maints, odoLogs) {
    const points = [
      ...(fuels || []).filter((f) => typeof f.odometer === 'number').map((f) => ({ date: f.logged_at, odometer: f.odometer })),
      ...(maints || []).filter((m) => typeof m.odometer === 'number').map((m) => ({ date: m.service_date, odometer: m.odometer })),
      ...(odoLogs || []).filter((o) => typeof o.odometer === 'number').map((o) => ({ date: o.logged_at, odometer: o.odometer })),
    ]
      .filter((p) => p.date)
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    return points;
  }

  function estimateDailyKm(series) {
    if (series.length < 2) return null;
    const first = series[0];
    const last = series[series.length - 1];
    const days = diffDays(first.date, last.date);
    if (days <= 0 || last.odometer <= first.odometer) return null;
    return (last.odometer - first.odometer) / days;
  }

  // 정비 항목별 다음 예상 시기를 계산한다. 최근 같은 항목 기록이 있으면 그 주행거리/날짜를
  // 기준으로, 없으면 "권장 주기" 참고 정보만 안내한다.
  function buildMaintenanceSuggestions(vehicle, maints, odometerSeries, dailyKm, today) {
    const rules = getMaintenanceRules(vehicle.fuel_type);
    const currentOdo = odometerSeries.length ? odometerSeries[odometerSeries.length - 1].odometer : null;
    return rules.map((rule) => {
      const matches = (maints || [])
        .filter((m) => rule.keywords.some((k) => (m.item || '').toLowerCase().includes(k.toLowerCase())))
        .slice()
        .sort((a, b) => (a.service_date || '').localeCompare(b.service_date || ''));
      const last = matches[matches.length - 1];

      if (!last) {
        return { ...rule, status: 'unknown', text: `기록 없음 · 일반 권장 주기 ${rule.intervalKm.toLocaleString()}km 또는 ${rule.intervalMonths}개월` };
      }

      let predictedDate = null;
      let remainingKm = null;
      if (typeof last.odometer === 'number' && currentOdo !== null && dailyKm) {
        const dueOdo = last.odometer + rule.intervalKm;
        remainingKm = dueOdo - currentOdo;
        predictedDate = remainingKm <= 0 ? today : addDays(today, Math.ceil(remainingKm / dailyKm));
      } else if (last.service_date) {
        predictedDate = addDays(last.service_date, rule.intervalMonths * 30);
      }

      if (!predictedDate) {
        return { ...rule, status: 'unknown', text: `마지막 ${last.service_date || '?'} · 주행거리 기록을 추가하면 예측할 수 있어요` };
      }
      const dDay = diffDays(today, predictedDate);
      const status = dDay < 0 ? 'overdue' : dDay <= 14 ? 'soon' : 'ok';
      const kmText = remainingKm !== null ? ` · 약 ${Math.max(0, Math.round(remainingKm)).toLocaleString()}km 남음` : '';
      return { ...rule, status, dDay, predictedDate, text: `${predictedDate} 예상 (D${dDay >= 0 ? '-' + dDay : '+' + -dDay})${kmText}` };
    });
  }

  // 유지비 총합(정비+주유) — "마이클" 등 일반적인 차량관리 앱들이 공통으로 제공하는
  // "이 차에 올해 얼마나 썼나" 요약을 재사용 가능한 함수로 분리했다.
  function costSummary(maints, fuels) {
    const thisYear = todayISO().slice(0, 4);
    const sum = (rows, dateKey, costKey) =>
      rows.filter((r) => (r[dateKey] || '').startsWith(thisYear)).reduce((s, r) => s + (Number(r[costKey]) || 0), 0);
    const maintCost = sum(maints, 'service_date', 'cost');
    const fuelCost = sum(fuels, 'logged_at', 'cost');
    const total = maintCost + fuelCost;
    if (!total) return null;
    return { maintCost, fuelCost, total, year: thisYear };
  }

  function renderVehicles(root) {
    const container = el('div', {});
    root.append(container);

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '차량관리'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openVehicleForm() }, '+ 차량 등록'),
        ])
      );

      const rows = appState.vehicles.filter((v) => !v.deleted_at);
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 차량이 없습니다.'));
        return;
      }

      const today = todayISO();
      const stack = el('div', { class: 'stack' });
      for (const v of rows) {
        const maints = (appState.maintenanceByVehicle[v.id] || []).slice().sort((a, b) => (b.service_date || '').localeCompare(a.service_date || ''));
        const fuels = (appState.fuelLogsByVehicle[v.id] || []).slice().sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''));
        const odoLogs = (appState.odometerLogsByVehicle[v.id] || []).slice();
        const lastMaint = maints.find((m) => m.next_due_date || m.next_due_odometer);
        const prediction = predictNextMaintenance(lastMaint, fuels, today);
        const predDDay = prediction.predictedDate ? diffDays(today, prediction.predictedDate) : null;
        const efficiency = calcFuelEfficiency(fuels);
        const insuranceDDay = v.insurance_expiry ? diffDays(today, v.insurance_expiry) : null;
        const registrationDDay = v.registration_expiry ? diffDays(today, v.registration_expiry) : null;

        const odometerSeries = combineOdometerSeries(fuels, maints, odoLogs);
        const dailyKm = estimateDailyKm(odometerSeries);
        const currentOdo = odometerSeries.length ? odometerSeries[odometerSeries.length - 1].odometer : null;
        const aiSuggestions = buildMaintenanceSuggestions(v, maints, odometerSeries, dailyKm, today);

        stack.append(
          el('div', { class: 'nm-card' }, [
            el('div', { class: 'row row--between wrap' }, [
              el('div', {}, [
                el('div', { class: 'row wrap' }, [
                  el('strong', { style: 'font-size:15px' }, escapeHtml(v.name)),
                  v.plate_number ? el('span', { class: 'nm-badge' }, escapeHtml(v.plate_number)) : null,
                  el('span', { class: 'nm-badge' }, FUEL_TYPE_LABEL[v.fuel_type] || FUEL_TYPE_LABEL.gasoline),
                  insuranceDDay !== null
                    ? el('span', { class: `nm-badge ${insuranceDDay <= 30 ? (insuranceDDay <= 7 ? 'nm-badge--critical' : 'nm-badge--warning') : ''}` }, `보험 D${insuranceDDay >= 0 ? '-' + insuranceDDay : '+' + -insuranceDDay}`)
                    : null,
                  registrationDDay !== null
                    ? el('span', { class: `nm-badge ${registrationDDay <= 30 ? (registrationDDay <= 7 ? 'nm-badge--critical' : 'nm-badge--warning') : ''}` }, `등록 D${registrationDDay >= 0 ? '-' + registrationDDay : '+' + -registrationDDay}`)
                    : null,
                ]),
                el('div', { class: 'text-muted', style: 'margin-top:4px; font-size:12px' }, `${v.model ? escapeHtml(v.model) + ' · ' : ''}${v.year || ''}${currentOdo !== null ? ` · 현재 ${currentOdo.toLocaleString()}km` : ''}`),
              ]),
              el('div', { class: 'icon-row' }, [
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openVehicleForm(v) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(v) }, '🗑'),
              ]),
            ]),
            prediction.predictedDate
              ? el('div', { style: 'margin-top:10px' }, [
                  el('span', { class: `nm-badge ${predDDay < 0 ? 'nm-badge--critical' : predDDay <= 14 ? 'nm-badge--warning' : ''}` }, `다음 정비 예상 D${predDDay >= 0 ? '-' + predDDay : '+' + -predDDay} (${prediction.predictedDate}${lastMaint?.item ? ', ' + escapeHtml(lastMaint.item) : ''})`),
                  el('span', { class: 'text-muted', style: 'font-size:11px; margin-left:8px' }, prediction.basis === 'odometer' ? `주행거리 추세 기준(일 ${prediction.dailyKm?.toFixed(1)}km)` : '등록된 예정일 기준'),
                  el('button', { class: 'nm-btn nm-btn--icon', title: '일정에 추가', onclick: () => addMaintenanceToSchedule(v, prediction, lastMaint) }, '🗓️'),
                ])
              : el('div', { class: 'text-muted', style: 'margin-top:10px; font-size:12px' }, '예정된 정비 없음(정비 기록에 다음 예정일/주행거리를 입력하면 예측됩니다)'),
            efficiency ? el('div', { class: 'text-muted', style: 'margin-top:6px; font-size:12px' }, `최근 평균 연비: ${efficiency} km/L(또는 kWh)`) : null,
            (() => {
              const cs = costSummary(maints, fuels);
              if (!cs) return null;
              return el('div', { class: 'text-muted', style: 'margin-top:4px; font-size:12px' },
                `${cs.year}년 누적 유지비: 정비 ${cs.maintCost.toLocaleString()}원 + 주유/충전 ${cs.fuelCost.toLocaleString()}원 = 총 ${cs.total.toLocaleString()}원`);
            })(),
            (insuranceDDay !== null && insuranceDDay <= 30) || (registrationDDay !== null && registrationDDay <= 30)
              ? el('div', { class: 'row', style: 'margin-top:6px; gap:6px' }, [
                  insuranceDDay !== null && insuranceDDay <= 30
                    ? el('button', { class: 'nm-btn nm-btn--icon', title: '보험 갱신일 일정 추가', onclick: () => addExpiryToSchedule(v, '보험 갱신', v.insurance_expiry) }, '🛡️ 보험 D-알림')
                    : null,
                  registrationDDay !== null && registrationDDay <= 30
                    ? el('button', { class: 'nm-btn nm-btn--icon', title: '검사/등록 갱신일 일정 추가', onclick: () => addExpiryToSchedule(v, '자동차검사/등록 갱신', v.registration_expiry) }, '📋 등록 D-알림')
                    : null,
                ])
              : null,

            el('div', { class: 'ai-suggest-box' }, [
              el('div', { class: 'row row--between', style: 'align-items:center' }, [
                el('strong', { style: 'font-size:13px' }, '🤖 AI 정비 주기 제안'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '현재 주행거리 입력', onclick: () => openOdometerForm(v) }, '🛣️'),
              ]),
              el(
                'div',
                { class: 'ai-suggest-list' },
                aiSuggestions.map((s) =>
                  el('div', { class: 'ai-suggest-row' }, [
                    el('span', { class: `nm-badge ${s.status === 'overdue' ? 'nm-badge--critical' : s.status === 'soon' ? 'nm-badge--warning' : ''}` }, s.label),
                    el('span', { class: 'text-muted', style: 'font-size:12px' }, s.text),
                  ])
                )
              ),
            ]),

            odometerSeries.length >= 2 || fuels.length >= 2
              ? el('div', { class: 'row wrap', style: 'margin-top:12px; gap:16px' }, [
                  odometerSeries.length >= 2 ? chartBlock('주행거리 추이(km)', window.simpleLineChart(odometerSeries.map((p) => p.date.slice(5)), odometerSeries.map((p) => p.odometer))) : null,
                  fuelEfficiencyChart(fuels),
                  unitPriceChart(fuels),
                ].filter(Boolean))
              : null,

            el('div', { class: 'row', style: 'margin-top:12px; gap:8px' }, [
              el('button', { class: 'nm-btn', onclick: () => openMaintenanceForm(v) }, '+ 정비 기록'),
              el('button', { class: 'nm-btn', onclick: () => openFuelForm(v) }, '+ 주유 기록'),
              el('button', { class: 'nm-btn', onclick: () => openHistory(v, maints, fuels) }, '기록 보기'),
              window.getPublicDataEnabled().fuelPrice
                ? el('button', { class: 'nm-btn', onclick: () => compareFuelPrice(fuels) }, '⛽ 전국 평균 유가 비교')
                : null,
            ]),
          ])
        );
      }
      container.append(stack);
    }

    function chartBlock(title, svgNode) {
      return el('div', { style: 'min-width:260px; flex:1' }, [el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:4px' }, title), svgNode]);
    }

    // 연비는 서로 다른 단위(거리 vs km/L)라 하나의 이중축 차트로 합치지 않고, 별도 막대 차트로
    // 구간별(주유~주유) 연비를 보여준다.
    function fuelEfficiencyChart(fuels) {
      const clean = (fuels || [])
        .filter((f) => typeof f.odometer === 'number')
        .slice()
        .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
      if (clean.length < 2) return null;
      const labels = [];
      const values = [];
      for (let i = 1; i < clean.length; i++) {
        const km = clean[i].odometer - clean[i - 1].odometer;
        const amount = clean[i].amount;
        if (km > 0 && typeof amount === 'number' && amount > 0) {
          labels.push((clean[i].logged_at || '').slice(5));
          values.push(Number((km / amount).toFixed(1)));
        }
      }
      if (!values.length) return null;
      return chartBlock('구간별 연비(km/L·kWh)', window.simpleBarChart(labels, values, '#22c55e'));
    }

    // 리터(또는 kWh)당 단가 추이 — 유가 변동을 간접적으로 보여준다(실시간 유가 API 대신
    // 본인이 실제로 지불한 단가 기록을 기준으로 한다).
    function unitPriceChart(fuels) {
      const clean = (fuels || [])
        .filter((f) => typeof f.amount === 'number' && f.amount > 0 && typeof f.cost === 'number' && f.cost > 0)
        .slice()
        .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
      if (clean.length < 2) return null;
      const labels = clean.map((f) => (f.logged_at || '').slice(5));
      const values = clean.map((f) => Math.round(f.cost / f.amount));
      return chartBlock('리터(kWh)당 단가 추이(원)', window.simpleLineChart(labels, values, '#f59e0b'));
    }

    // 오피넷 전국 평균 유가와 내 최근 주유 단가를 비교해 보여준다.
    async function compareFuelPrice(fuels) {
      if (!window.getOpinetKey()) {
        toast('설정 화면에서 오피넷 API 키를 먼저 등록해 주세요.', 'error');
        return;
      }
      try {
        const rows = await window.fetchFuelPrice();
        const clean = (fuels || [])
          .filter((f) => typeof f.amount === 'number' && f.amount > 0 && typeof f.cost === 'number' && f.cost > 0)
          .slice()
          .sort((a, b) => (a.logged_at < b.logged_at ? -1 : 1));
        const myLast = clean.length ? Math.round(clean[clean.length - 1].cost / clean[clean.length - 1].amount) : null;
        openModal({
          title: '전국 평균 유가 비교(오피넷)',
          contentBuilder(body) {
            const list = el('div', { class: 'item-list' });
            rows.forEach((r) => {
              const diffText = myLast ? `내 최근 단가 대비 ${myLast - r.price >= 0 ? '+' : ''}${(myLast - r.price).toLocaleString()}원` : null;
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, r.productName),
                    diffText ? el('div', { class: 'text-muted', style: 'font-size:12px' }, diffText) : null,
                  ]),
                  el('div', { style: 'text-align:right' }, [
                    el('div', { style: 'font-weight:700' }, `${r.price.toLocaleString()}원`),
                    el('div', { class: 'text-muted', style: 'font-size:11px' }, `${r.diff >= 0 ? '▲' : '▼'} ${Math.abs(r.diff)}원 (전일 대비)`),
                  ]),
                ])
              );
            });
            body.append(list);
            body.append(el('p', { class: 'text-muted', style: 'font-size:11px; margin-top:8px' }, '자료: 한국석유공사 오피넷(전국 주유소 평균, 최대 6시간 단위 캐시)'));
          },
        });
      } catch (e) {
        toast('유가정보를 가져오지 못했습니다: ' + e.message, 'error');
      }
    }

    function openOdometerForm(v) {
      openModal({
        title: `${v.name} — 주행거리 기록`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'logged_at', required: true, value: todayISO() })),
            field('현재 계기판 주행거리(km)', el('input', { class: 'nm-input', type: 'number', name: 'odometer', required: true }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            try {
              await appState.addOdometerLog(v.id, { logged_at: fd.get('logged_at'), odometer: Number(fd.get('odometer')) });
              toast('주행거리를 기록했습니다.', 'success');
              close();
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
    }

    async function addMaintenanceToSchedule(v, prediction, lastMaint) {
      await appState.addSchedule({
        title: `${v.name} 정비 예정${lastMaint?.item ? ' (' + lastMaint.item + ')' : ''}`,
        date: prediction.predictedDate,
        memo: '차량관리에서 자동 제안된 일정입니다.',
      });
      toast('일정에 추가했습니다.', 'success');
    }

    async function addExpiryToSchedule(v, label, dateIso) {
      try {
        await appState.addSchedule({ title: `${v.name} ${label}`, date: dateIso, memo: '차량관리에서 자동 제안된 일정입니다.' });
        toast('일정에 추가했습니다.', 'success');
      } catch (err) {
        toast(`일정 추가에 실패했습니다: ${err.message || err}`, 'error');
      }
    }

    async function remove(v) {
      if (!confirmDialog(`"${v.name}" 차량을 삭제할까요?`)) return;
      await appState.deleteVehicle(v.id);
      toast('삭제했습니다.', 'success');
    }

    function openHistory(v, maints, fuels) {
      openModal({
        title: `${v.name} — 기록`,
        width: '520px',
        contentBuilder(body) {
          let shopFilter = 'all';
          const header = el('div', { class: 'row row--between wrap', style: 'margin-bottom:8px' }, [el('h3', { style: 'margin:0' }, '정비 이력')]);
          const shops = Array.from(new Set(maints.map((m) => m.shop_name).filter(Boolean)));
          if (shops.length) {
            const sel = el('select', { class: 'nm-select' }, [
              el('option', { value: 'all' }, '전체 정비소'),
              ...shops.map((s) => el('option', { value: s }, s)),
            ]);
            sel.addEventListener('change', () => { shopFilter = sel.value; renderMaintList(); });
            header.append(sel);
          }
          body.append(header);
          const maintListHost = el('div', {});
          body.append(maintListHost);
          function renderMaintList() {
            maintListHost.innerHTML = '';
            const rows = shopFilter === 'all' ? maints : maints.filter((m) => m.shop_name === shopFilter);
            if (!rows.length) {
              maintListHost.append(el('div', { class: 'empty-state' }, '정비 기록이 없습니다.'));
              return;
            }
            const list = el('div', { class: 'item-list' });
            for (const m of rows) {
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'row wrap', style: 'gap:6px; align-items:center' }, [
                      el('div', { class: 'item-row__title' }, escapeHtml(m.item)),
                      m.shop_name ? el('span', { class: 'nm-badge' }, escapeHtml(m.shop_name)) : null,
                    ]),
                    el('div', { class: 'item-row__meta' }, `${m.service_date}${m.odometer ? ' · ' + m.odometer + 'km' : ''}${m.cost ? ' · ' + Number(m.cost).toLocaleString() + '원' : ''}${m.next_due_date ? ' · 다음 ' + m.next_due_date : ''}`),
                  ]),
                  el('button', { class: 'nm-btn nm-btn--icon', title: '첨부파일', onclick: () => window.openAttachmentsModal('vehicle_maintenance', m.id, m.item) }, '📎'),
                  el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: async () => { await appState.deleteMaintenance(m.id); openHistory(v, appState.maintenanceByVehicle[v.id] || [], fuels); } }, '🗑'),
                ])
              );
            }
            maintListHost.append(list);
          }
          renderMaintList();
          body.append(el('h3', { style: 'margin:16px 0 8px' }, '주유/충전 이력'));
          if (!fuels.length) {
            body.append(el('div', { class: 'empty-state' }, '주유 기록이 없습니다.'));
          } else {
            const list2 = el('div', { class: 'item-list' });
            for (const f of fuels) {
              list2.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, `${f.logged_at}`),
                    el('div', { class: 'item-row__meta' }, `${f.amount ? f.amount + 'L/kWh · ' : ''}${f.cost ? Number(f.cost).toLocaleString() + '원' : ''}${f.odometer ? ' · ' + f.odometer + 'km' : ''}`),
                  ]),
                  el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: async () => { await appState.deleteFuelLog(f.id); openHistory(v, maints, appState.fuelLogsByVehicle[v.id] || []); } }, '🗑'),
                ])
              );
            }
            body.append(list2);
          }
        },
      });
    }

    function openVehicleForm(existing) {
      openModal({
        title: existing ? '차량 수정' : '차량 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('차량 이름', el('input', { class: 'nm-input', name: 'name', required: true, placeholder: '예: 아반떼 2021', value: existing?.name || '' })),
            field('차량번호(선택)', el('input', { class: 'nm-input', name: 'plate_number', value: existing?.plate_number || '' })),
            field('모델(선택)', el('input', { class: 'nm-input', name: 'model', value: existing?.model || '', placeholder: '예: 티구안 2.0' })),
            field('연식(선택)', el('input', { class: 'nm-input', type: 'number', name: 'year', value: existing?.year || '' })),
            field('연료 종류(AI 정비 제안에 사용)', fuelTypeSelect(existing?.fuel_type)),
            field('보험 만료일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'insurance_expiry', value: existing?.insurance_expiry || '' })),
            field('등록/검사 만료일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'registration_expiry', value: existing?.registration_expiry || '' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              name: fd.get('name'),
              plate_number: fd.get('plate_number') || null,
              model: fd.get('model') || null,
              year: fd.get('year') ? Number(fd.get('year')) : null,
              fuel_type: fd.get('fuel_type') || 'gasoline',
              insurance_expiry: fd.get('insurance_expiry') || null,
              registration_expiry: fd.get('registration_expiry') || null,
            };
            try {
              if (existing) await appState.updateVehicle(existing.id, data);
              else await appState.addVehicle(data);
              toast('저장했습니다.', 'success');
              close();
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
    }

    function openMaintenanceForm(v) {
      openModal({
        title: `${v.name} — 정비 기록`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('정비 항목', el('input', { class: 'nm-input', name: 'item', required: true, placeholder: '예: 엔진오일 교체', value: '' })),
            field('정비소(선택, 예: OO카센터)', el('input', { class: 'nm-input', name: 'shop_name', list: 'shop-name-presets', placeholder: '정비소 이름' })),
            el('datalist', { id: 'shop-name-presets' }, Array.from(new Set((appState.maintenanceByVehicle[v.id] || []).map((m) => m.shop_name).filter(Boolean))).map((s) => el('option', { value: s }))),
            field('정비일', el('input', { class: 'nm-input', type: 'date', name: 'service_date', required: true, value: todayISO() })),
            field('주행거리(km, 선택)', el('input', { class: 'nm-input', type: 'number', name: 'odometer' })),
            field('비용(원, 선택)', el('input', { class: 'nm-input', type: 'number', name: 'cost' })),
            field('다음 정비 예정일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'next_due_date' })),
            field('다음 정비 예정 주행거리(km, 선택)', el('input', { class: 'nm-input', type: 'number', name: 'next_due_odometer' })),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            try {
              await appState.addMaintenance(v.id, {
                item: fd.get('item'),
                shop_name: fd.get('shop_name') || null,
                service_date: fd.get('service_date'),
                odometer: fd.get('odometer') ? Number(fd.get('odometer')) : null,
                cost: fd.get('cost') ? Number(fd.get('cost')) : null,
                next_due_date: fd.get('next_due_date') || null,
                next_due_odometer: fd.get('next_due_odometer') ? Number(fd.get('next_due_odometer')) : null,
                memo: fd.get('memo') || null,
              });
              toast('정비 기록을 저장했습니다.', 'success');
              close();
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
    }

    function openFuelForm(v) {
      openModal({
        title: `${v.name} — 주유/충전 기록`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'logged_at', required: true, value: todayISO() })),
            field('주유/충전량(선택)', el('input', { class: 'nm-input', type: 'number', step: '0.1', name: 'amount' })),
            field('비용(원, 선택)', el('input', { class: 'nm-input', type: 'number', name: 'cost' })),
            field('주행거리(km, 선택)', el('input', { class: 'nm-input', type: 'number', name: 'odometer' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            try {
              await appState.addFuelLog(v.id, {
                logged_at: fd.get('logged_at'),
                amount: fd.get('amount') ? Number(fd.get('amount')) : null,
                cost: fd.get('cost') ? Number(fd.get('cost')) : null,
                odometer: fd.get('odometer') ? Number(fd.get('odometer')) : null,
              });
              toast('주유 기록을 저장했습니다.', 'success');
              close();
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
    }

    function fuelTypeSelect(selected = 'gasoline') {
      const select = el('select', { class: 'nm-select', name: 'fuel_type' });
      for (const [value, label] of Object.entries(FUEL_TYPE_LABEL)) {
        select.append(el('option', { value, selected: value === selected || undefined }, label));
      }
      return select;
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderVehicles = renderVehicles;
})();
