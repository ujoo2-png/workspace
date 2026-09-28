// Health 화면. 체중·운동·수면 등 일반 웰니스 기록과 병원/검진 등 약속 일정을 관리한다.
// (진단명·복약 등 민감한 의료 정보는 다루지 않는다 — 체중/운동/수면/컨디션 같은 일반 웰니스 지표만.)
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO, predictWeeklyExerciseGoal } = window;

  const METRIC_TYPE_LABEL = { weight: '체중', exercise: '운동', sleep: '수면', steps: '걸음수', condition: '컨디션' };
  const METRIC_UNIT_DEFAULT = { weight: 'kg', exercise: '분', sleep: '시간', steps: '걸음', condition: '점(1-5)' };
  const CONFIDENCE_LABEL = { high: '높음', medium: '보통', low: '낮음', none: '데이터 부족' };

  function renderHealth(root) {
    const container = el('div', {});
    root.append(container);
    let weeklyGoal = Number(localStorage.getItem('workspace:health:weeklyGoal')) || 3;

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, 'Health'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', onclick: () => openAppointmentForm() }, '+ 일정 등록'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openMetricForm() }, '+ 기록 추가'),
          ]),
        ])
      );

      // 최근 지표 요약 카드
      const summaryGrid = el('div', { class: 'kpi-grid' });
      for (const type of Object.keys(METRIC_TYPE_LABEL)) {
        const rows = appState.healthMetrics.filter((m) => m.metric_type === type).sort((a, b) => (b.recorded_at || '').localeCompare(a.recorded_at || ''));
        const latest = rows[0];
        summaryGrid.append(
          el('div', { class: 'nm-card kpi-card' }, [
            el('div', { class: 'kpi-card__value' }, latest ? `${latest.value}${latest.unit || METRIC_UNIT_DEFAULT[type]}` : '-'),
            el('div', { class: 'kpi-card__label' }, METRIC_TYPE_LABEL[type]),
          ])
        );
      }
      container.append(summaryGrid);

      const today = todayISO();

      // 주간 운동 목표 예측
      const exerciseMetrics = appState.healthMetrics.filter((m) => m.metric_type === 'exercise');
      const goalPrediction = predictWeeklyExerciseGoal(exerciseMetrics, weeklyGoal, today);
      const weightRows = appState.healthMetrics
        .filter((m) => m.metric_type === 'weight')
        .slice()
        .sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''));
      const weightDelta = weightRows.length >= 2 ? Number((weightRows[weightRows.length - 1].value - weightRows[0].value).toFixed(1)) : null;

      const predictCard = el('div', { class: 'nm-card', style: 'margin-bottom:16px' }, [
        el('h3', {}, '예측 · 트렌드'),
        el('div', { class: 'row row--between wrap', style: 'gap:16px; margin-top:8px' }, [
          el('div', {}, [
            el('div', { class: 'row', style: 'gap:8px; align-items:center' }, [
              el('strong', {}, `주간 운동 목표 달성률: ${goalPrediction.probability}%`),
              el('span', { class: 'nm-badge' }, `신뢰도 ${CONFIDENCE_LABEL[goalPrediction.confidence]}`),
            ]),
            el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:4px' }, `최근 14일 기준 주당 ${goalPrediction.sessionsPerWeek}회 운동 (목표 ${weeklyGoal}회/주)`),
          ]),
          el('div', { class: 'row', style: 'gap:6px; align-items:center' }, [
            el('label', { class: 'text-muted', style: 'font-size:12px' }, '주간 목표(회)'),
            el('input', {
              class: 'nm-input',
              style: 'width:64px',
              type: 'number',
              min: '1',
              value: weeklyGoal,
              onchange: (e) => {
                weeklyGoal = Number(e.target.value) || 3;
                localStorage.setItem('workspace:health:weeklyGoal', String(weeklyGoal));
                draw();
              },
            }),
          ]),
        ]),
        weightDelta !== null
          ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:8px' }, `체중 변화(기록 전체 기간): ${weightDelta > 0 ? '+' : ''}${weightDelta}kg`)
          : null,
      ]);
      container.append(predictCard);

      // 다가오는 일정
      const upcoming = appState.healthAppointments.filter((a) => a.appointment_date >= today).sort((a, b) => a.appointment_date.localeCompare(b.appointment_date));
      const apptCard = el('div', { class: 'nm-card', style: 'margin: 16px 0' }, [el('h3', {}, '다가오는 병원/검진 일정')]);
      if (!upcoming.length) {
        apptCard.append(el('div', { class: 'empty-state' }, '예정된 일정이 없습니다.'));
      } else {
        const list = el('div', { class: 'item-list' });
        for (const a of upcoming) {
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, escapeHtml(a.title)),
                el('div', { class: 'item-row__meta' }, `${a.appointment_date}${a.appointment_time ? ' ' + a.appointment_time : ''}${a.location ? ' · ' + escapeHtml(a.location) : ''}`),
              ]),
              el('button', { class: 'nm-btn nm-btn--icon', title: '일정에 추가', onclick: () => addAppointmentToSchedule(a) }, '🗓️'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeAppointment(a) }, '🗑'),
            ])
          );
        }
        apptCard.append(list);
      }
      container.append(apptCard);

      // 최근 기록 목록
      const recentCard = el('div', { class: 'nm-card' }, [el('h3', {}, '최근 기록')]);
      const recentRows = appState.healthMetrics.slice(0, 15);
      if (!recentRows.length) {
        recentCard.append(el('div', { class: 'empty-state' }, '아직 기록이 없습니다.'));
      } else {
        const list = el('div', { class: 'item-list' });
        for (const m of recentRows) {
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, `${METRIC_TYPE_LABEL[m.metric_type] || m.metric_type}: ${m.value}${m.unit || ''}`),
                el('div', { class: 'item-row__meta' }, `${(m.recorded_at || '').slice(0, 10)}${m.note ? ' · ' + escapeHtml(m.note) : ''}`),
              ]),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeMetric(m) }, '🗑'),
            ])
          );
        }
        recentCard.append(list);
      }
      container.append(recentCard);
    }

    async function removeMetric(m) {
      if (!confirmDialog('이 기록을 삭제할까요?')) return;
      await appState.deleteHealthMetric(m.id);
      toast('삭제했습니다.', 'success');
    }
    async function removeAppointment(a) {
      if (!confirmDialog(`"${a.title}" 일정을 삭제할까요?`)) return;
      await appState.deleteHealthAppointment(a.id);
      toast('삭제했습니다.', 'success');
    }

    async function addAppointmentToSchedule(a) {
      await appState.addSchedule({
        title: `🏥 ${a.title}`,
        date: a.appointment_date,
        memo: `Health에서 자동 추가된 일정입니다.${a.location ? ' 장소: ' + a.location : ''}`,
      });
      toast('일정에 추가했습니다.', 'success');
    }

    // 운동 기록 저장 시, 오늘 이미 체크인하지 않은 "운동" 카테고리 챌린지가 있으면 체크인을 제안한다.
    async function suggestChallengeCheckin() {
      const todayIso = todayISO();
      const candidates = appState.challenges.filter((c) => {
        if (c.status !== 'active' || c.category !== '운동') return false;
        const checkins = appState.checkinsByChallenge[c.id] || [];
        return !checkins.some((r) => r.checkin_date === todayIso);
      });
      if (!candidates.length) return;
      for (const c of candidates) {
        if (confirmDialog(`오늘 운동 기록을 남기셨네요! "${c.title}" 챌린지도 오늘 체크인할까요?`)) {
          await appState.checkinChallenge(c.id, todayIso, 1);
          toast(`"${c.title}" 체크인 완료!`, 'success');
        }
      }
    }

    function openMetricForm() {
      openModal({
        title: '기록 추가',
        contentBuilder(body, close) {
          const typeSelect = el('select', { class: 'nm-select', name: 'metric_type' });
          for (const [value, label] of Object.entries(METRIC_TYPE_LABEL)) typeSelect.append(el('option', { value }, label));
          const unitInput = el('input', { class: 'nm-input', name: 'unit', value: METRIC_UNIT_DEFAULT.weight });
          typeSelect.addEventListener('change', () => { unitInput.value = METRIC_UNIT_DEFAULT[typeSelect.value] || ''; });

          const form = el('form', { class: 'stack' });
          form.append(
            field('종류', typeSelect),
            field('값', el('input', { class: 'nm-input', type: 'number', step: '0.1', name: 'value', required: true })),
            field('단위', unitInput),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'date', value: todayISO() })),
            field('메모(선택)', el('input', { class: 'nm-input', name: 'note' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const metricType = fd.get('metric_type');
            const metricDate = fd.get('date') || todayISO();
            await appState.addHealthMetric({
              metric_type: metricType,
              value: Number(fd.get('value')),
              unit: fd.get('unit') || null,
              note: fd.get('note') || null,
              recorded_at: new Date(`${metricDate}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
            });
            toast('기록을 저장했습니다.', 'success');
            close();
            if (metricType === 'exercise' && metricDate === todayISO()) {
              await suggestChallengeCheckin();
            }
          });
          body.append(form);
        },
      });
    }

    function openAppointmentForm() {
      openModal({
        title: '병원/검진 일정 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, placeholder: '예: 정기 검진', value: '' })),
            field('날짜', el('input', { class: 'nm-input', type: 'date', name: 'appointment_date', required: true, value: todayISO() })),
            field('시간(선택)', el('input', { class: 'nm-input', type: 'time', name: 'appointment_time' })),
            field('장소(선택)', el('input', { class: 'nm-input', name: 'location' })),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo' }))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            await appState.addHealthAppointment({
              title: fd.get('title'),
              appointment_date: fd.get('appointment_date'),
              appointment_time: fd.get('appointment_time') || null,
              location: fd.get('location') || null,
              memo: fd.get('memo') || null,
            });
            toast('일정을 저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderHealth = renderHealth;
})();
