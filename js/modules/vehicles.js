// 차량관리 화면. 차량 등록 + 정비/주유 기록 + 다음 정비 예측(주행거리·기간 중 먼저 도달하는 쪽) +
// 보험/등록 만료 D-day + 연비 추이. 개발계획서 8장 참고.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO, diffDays, predictNextMaintenance, calcFuelEfficiency } = window;

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
        const lastMaint = maints.find((m) => m.next_due_date || m.next_due_odometer);
        const prediction = predictNextMaintenance(lastMaint, fuels, today);
        const predDDay = prediction.predictedDate ? diffDays(today, prediction.predictedDate) : null;
        const efficiency = calcFuelEfficiency(fuels);
        const insuranceDDay = v.insurance_expiry ? diffDays(today, v.insurance_expiry) : null;
        const registrationDDay = v.registration_expiry ? diffDays(today, v.registration_expiry) : null;

        stack.append(
          el('div', { class: 'nm-card' }, [
            el('div', { class: 'row row--between wrap' }, [
              el('div', {}, [
                el('div', { class: 'row wrap' }, [
                  el('strong', { style: 'font-size:15px' }, escapeHtml(v.name)),
                  v.plate_number ? el('span', { class: 'nm-badge' }, escapeHtml(v.plate_number)) : null,
                  insuranceDDay !== null
                    ? el('span', { class: `nm-badge ${insuranceDDay <= 30 ? (insuranceDDay <= 7 ? 'nm-badge--critical' : 'nm-badge--warning') : ''}` }, `보험 D${insuranceDDay >= 0 ? '-' + insuranceDDay : '+' + -insuranceDDay}`)
                    : null,
                  registrationDDay !== null
                    ? el('span', { class: `nm-badge ${registrationDDay <= 30 ? (registrationDDay <= 7 ? 'nm-badge--critical' : 'nm-badge--warning') : ''}` }, `등록 D${registrationDDay >= 0 ? '-' + registrationDDay : '+' + -registrationDDay}`)
                    : null,
                ]),
                el('div', { class: 'text-muted', style: 'margin-top:4px; font-size:12px' }, `${v.model ? escapeHtml(v.model) + ' · ' : ''}${v.year || ''}`),
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
            el('div', { class: 'row', style: 'margin-top:12px; gap:8px' }, [
              el('button', { class: 'nm-btn', onclick: () => openMaintenanceForm(v) }, '+ 정비 기록'),
              el('button', { class: 'nm-btn', onclick: () => openFuelForm(v) }, '+ 주유 기록'),
              el('button', { class: 'nm-btn', onclick: () => openHistory(v, maints, fuels) }, '기록 보기'),
            ]),
          ])
        );
      }
      container.append(stack);
    }

    async function addMaintenanceToSchedule(v, prediction, lastMaint) {
      await appState.addSchedule({
        title: `${v.name} 정비 예정${lastMaint?.item ? ' (' + lastMaint.item + ')' : ''}`,
        date: prediction.predictedDate,
        memo: '차량관리에서 자동 제안된 일정입니다.',
      });
      toast('일정에 추가했습니다.', 'success');
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
          body.append(el('h3', { style: 'margin-bottom:8px' }, '정비 이력'));
          if (!maints.length) {
            body.append(el('div', { class: 'empty-state' }, '정비 기록이 없습니다.'));
          } else {
            const list = el('div', { class: 'item-list' });
            for (const m of maints) {
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, escapeHtml(m.item)),
                    el('div', { class: 'item-row__meta' }, `${m.service_date}${m.odometer ? ' · ' + m.odometer + 'km' : ''}${m.cost ? ' · ' + Number(m.cost).toLocaleString() + '원' : ''}${m.next_due_date ? ' · 다음 ' + m.next_due_date : ''}`),
                  ]),
                  el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: async () => { await appState.deleteMaintenance(m.id); openHistory(v, appState.maintenanceByVehicle[v.id] || [], fuels); } }, '🗑'),
                ])
              );
            }
            body.append(list);
          }
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
            field('모델(선택)', el('input', { class: 'nm-input', name: 'model', value: existing?.model || '' })),
            field('연식(선택)', el('input', { class: 'nm-input', type: 'number', name: 'year', value: existing?.year || '' })),
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
              insurance_expiry: fd.get('insurance_expiry') || null,
              registration_expiry: fd.get('registration_expiry') || null,
            };
            if (existing) await appState.updateVehicle(existing.id, data);
            else await appState.addVehicle(data);
            toast('저장했습니다.', 'success');
            close();
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
            await appState.addMaintenance(v.id, {
              item: fd.get('item'),
              service_date: fd.get('service_date'),
              odometer: fd.get('odometer') ? Number(fd.get('odometer')) : null,
              cost: fd.get('cost') ? Number(fd.get('cost')) : null,
              next_due_date: fd.get('next_due_date') || null,
              next_due_odometer: fd.get('next_due_odometer') ? Number(fd.get('next_due_odometer')) : null,
              memo: fd.get('memo') || null,
            });
            toast('정비 기록을 저장했습니다.', 'success');
            close();
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
            await appState.addFuelLog(v.id, {
              logged_at: fd.get('logged_at'),
              amount: fd.get('amount') ? Number(fd.get('amount')) : null,
              cost: fd.get('cost') ? Number(fd.get('cost')) : null,
              odometer: fd.get('odometer') ? Number(fd.get('odometer')) : null,
            });
            toast('주유 기록을 저장했습니다.', 'success');
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

  window.renderVehicles = renderVehicles;
})();
