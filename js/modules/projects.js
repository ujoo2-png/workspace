// 프로젝트 관리 화면. 좌측에 프로젝트 목록, 우측에 선택한 프로젝트의 상세(진행률 예측 +
// 단계별 간트차트)를 보여주는 2단 레이아웃이다(프로젝트 진척 화면 참고 스크린샷 스타일).
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, predictProjectCompletion, todayISO, diffDays, addDays } = window;

  const STATUS_LABEL = { in_progress: '진행 중', done: '완료', on_hold: '보류' };
  // 벤치마크: Trello/Asana류의 우선순위 필드 — 마감일만으로는 부족한 "지금 뭐부터 해야 하나"를 보완한다.
  const PRIORITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
  const PRIORITY_BADGE = { high: 'nm-badge--critical', medium: 'nm-badge--warning', low: '' };

  // 계획일(planned) 대비 실제 완료일(actual)의 차이를 사람이 읽기 쉬운 배지 텍스트로 바꾼다.
  // 음수(실제가 계획보다 이름) = 조기 완료, 양수 = 지연.
  // 완료된 단계들의 실제 소요기간(시작일→실제 완료일, 없으면 목표일) 평균을 계산한다.
  // 다음 프로젝트의 단계를 등록할 때 "보통 이만큼 걸린다"를 참고할 수 있게 하기 위함이다.
  function computeAvgStageDuration() {
    const allStages = Object.values(appState.projectStagesByProject).flat();
    const durations = allStages
      .filter((s) => s.start_date && (s.actual_completion_date || (s.status === 'done' && s.target_date)))
      .map((s) => diffDays(s.start_date, s.actual_completion_date || s.target_date))
      .filter((d) => d > 0);
    if (!durations.length) return null;
    const avg = Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10;
    return { avg, count: durations.length };
  }

  function varianceBadge(plannedIso, actualIso) {
    if (!plannedIso || !actualIso) return null;
    const delta = diffDays(plannedIso, actualIso); // actual - planned (일수)
    if (delta === 0) return { text: '계획대로 완료 ✅', cls: 'nm-badge--success' };
    if (delta < 0) return { text: `계획보다 ${-delta}일 빠름 🎉`, cls: 'nm-badge--success' };
    return { text: `계획보다 ${delta}일 지연 ⚠️`, cls: 'nm-badge--warning' };
  }

  function renderProjects(root) {
    const container = el('div', {});
    root.append(container);
    let tagFilter = 'all';
    let selectedId = null;

    function scrollParentOf(node) {
      for (let q = node.parentElement; q; q = q.parentElement) {
        const oy = getComputedStyle(q).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && q.scrollHeight > q.clientHeight) return q;
      }
      return document.scrollingElement || document.documentElement;
    }
    let legacyChecked = false;
    function draw() {
      const scroller = scrollParentOf(container);
      const scrollTop = scroller ? scroller.scrollTop : 0;
      drawInner();
      if (scroller) scroller.scrollTop = scrollTop;
      // 예전 "중분류(group_name)" 단계가 남아 있으면 한 번만 트리(상위/하위)로 옮긴다(손실 없음 — group_name 원본은 그대로 둠).
      if (!legacyChecked && appState.projectStages.some((r) => (r.group_name || '').trim() && !r.parent_id && !r.legacy_group)) {
        legacyChecked = true;
        appState.migrateLegacyStages().then((n) => { if (n) toast(`예전 중분류 단계 ${n}개를 새 하위 구조(WBS)로 옮겼어요.`, 'success'); });
      }
    }
    function drawInner() {
      container.innerHTML = '';
      const CONFIG = window.CONFIG;
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '프로젝트'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openProjectForm() }, '+ 프로젝트 등록'),
        ])
      );

      let rows = appState.projects.filter((p) => !p.deleted_at);
      const allTags = Array.from(new Set(rows.flatMap((p) => p.tags || []))).sort();
      if (allTags.length) {
        container.append(
          el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:14px' }, [
            tagBtn('all', '태그 전체'),
            ...allTags.map((t) => tagBtn(t, `#${t}`)),
          ])
        );
      }
      if (tagFilter !== 'all') rows = rows.filter((p) => (p.tags || []).includes(tagFilter));
      rows = rows.slice().sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999'));

      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 프로젝트가 없습니다.'));
        return;
      }

      if (!selectedId || !rows.some((p) => p.id === selectedId)) selectedId = rows[0].id;
      const selected = rows.find((p) => p.id === selectedId);

      const layout = el('div', { class: 'project-layout' }, [
        listPane(rows),
        detailPane(selected, CONFIG),
      ]);
      container.append(layout);
    }

    function listPane(rows) {
      const today = todayISO();
      return el(
        'div',
        { class: 'project-list-pane' },
        rows.map((p) => {
          const latest = latestProgress(p.id);
          const dDay = p.deadline ? diffDays(today, p.deadline) : null;
          return el(
            'div',
            {
              class: `project-list-item ${p.id === selectedId ? 'project-list-item--active' : ''}`,
              onclick: () => { selectedId = p.id; draw(); },
            },
            [
              el('div', { class: 'row row--between' }, [
                el('span', { class: 'project-list-item__name' }, p.name),
                el('span', { class: 'nm-badge' }, STATUS_LABEL[p.status] || p.status),
              ]),
              el('div', { class: 'project-list-item__meta' }, [
                `진행률 ${latest}%`,
                p.deadline ? ` · 마감 ${p.deadline}${dDay !== null ? ` (D${dDay >= 0 ? '-' + dDay : '+' + -dDay})` : ''}` : '',
              ].join('')),
              el('div', { class: 'nm-progress', style: 'margin-top:8px; height:6px' }, [el('div', { class: 'nm-progress__bar', style: `width:${latest}%` })]),
            ]
          );
        })
      );
    }

    // 태그 기반 Knowledge 연동(1.2) — 이 프로젝트의 태그와 겹치는 Knowledge 자료가 있으면
    // 작은 링크 목록으로 보여준다. appState.knowledgeDocs는 js/modules/knowledge.js가 다루는
    // 독립 저장소지만, 태그가 겹치면 여기서도 바로 눈에 띄도록 가볍게 연결한다.
    function relatedKnowledgeLink(tags) {
      if (!tags || !tags.length || !appState.knowledgeDocs) return null;
      const matches = appState.knowledgeDocs.filter((d) => d.status !== 'archived' && (d.tags || []).some((t) => tags.includes(t)));
      if (!matches.length) return null;
      return el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:6px' }, [
        '📚 관련 Knowledge 자료: ',
        ...matches.slice(0, 3).map((d, i) => el('span', {}, [
          i > 0 ? ', ' : '',
          el('a', { href: '#/knowledge', onclick: (e) => { e.preventDefault(); window.navigate('/knowledge'); } }, d.title),
        ])),
        matches.length > 3 ? ` 외 ${matches.length - 3}건` : '',
      ]);
    }

    function detailPane(p, CONFIG) {
      if (!p) return el('div', {});
      const prediction = predictProjectCompletion(appState.progressByProject[p.id] || [], todayISO(), CONFIG.predict.projectMinRecords);
      const latest = latestProgress(p.id);
      const today = todayISO();
      const dDay = p.deadline ? diffDays(today, p.deadline) : null;
      const relatedDevlogs = appState.devlogs.filter((d) => d.project_id === p.id && !d.deleted_at);

      return el('div', { class: 'stack' }, [
        el('div', { class: 'nm-card' }, [
          el('div', { class: 'row row--between wrap' }, [
            el('div', {}, [
              el('div', { class: 'row wrap' }, [
                el('strong', { style: 'font-size:16px' }, p.name),
                el('span', { class: 'nm-badge' }, STATUS_LABEL[p.status] || p.status),
                p.priority ? el('span', { class: `nm-badge ${PRIORITY_BADGE[p.priority] || ''}` }, `우선순위 ${PRIORITY_LABEL[p.priority]}`) : null,
                p.deadline ? el('span', { class: `nm-badge ${dDay !== null && dDay < 0 ? 'nm-badge--critical' : dDay !== null && dDay <= 7 ? 'nm-badge--warning' : ''}` }, `계획 완료 ${p.deadline}${dDay !== null ? ` (D${dDay >= 0 ? '-' + dDay : '+' + -dDay})` : ''}`) : null,
                p.actual_completion_date ? el('span', { class: 'nm-badge' }, `실제 완료 ${p.actual_completion_date}`) : null,
                (() => { const v = varianceBadge(p.deadline, p.actual_completion_date); return v ? el('span', { class: `nm-badge ${v.cls}` }, v.text) : null; })(),
              ]),
              p.memo ? el('div', { class: 'text-muted', style: 'margin-top:4px' }, p.memo) : null,
              (p.tags || []).length
                ? el('div', { class: 'row wrap', style: 'gap:4px; margin-top:6px' }, p.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`)))
                : null,
              relatedKnowledgeLink(p.tags),
            ]),
            el('div', { class: 'icon-row' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '진행률 기록', onclick: () => openProgressForm(p) }, '📈'),
              el('button', { class: 'nm-btn nm-btn--icon', title: `관련 Devlog (${relatedDevlogs.length})`, onclick: () => openDevlogList(p, relatedDevlogs) }, '🛠️'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '복사해서 새 프로젝트 만들기', onclick: () => openCopyForm(p) }, '⧉'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openProjectForm(p) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(p) }, '🗑'),
            ]),
          ]),
          el('div', { style: 'margin-top:12px' }, [
            el('div', { class: 'nm-progress' }, [el('div', { class: 'nm-progress__bar', style: `width:${latest}%` })]),
            el('div', { class: 'row row--between', style: 'margin-top:6px' }, [
              el('span', { class: 'text-muted' }, `진행률 ${latest}%`),
              el(
                'span',
                { class: 'predict-chip' },
                prediction.predictedDate
                  ? `예상 완료 ${prediction.predictedDate} · 신뢰도 ${confLabel(prediction.confidence)}`
                  : prediction.reason === 'already_complete'
                  ? '완료됨'
                  : prediction.reason === 'no_valid_interval'
                  ? '예측하려면 다른 날짜에 진행률을 한 번 더 기록하세요'
                  : prediction.reason === 'no_progress_or_regressing'
                  ? '진행률이 늘지 않아 예측할 수 없어요'
                  : '예측하려면 진행률을 2회 이상 기록하세요'
              ),
            ]),
          ]),
        ]),
        window.wbsCard(p),
      ]);
    }

    function tagBtn(key, label) {
      const active = tagFilter === key;
      return el('button', { class: `nm-btn ${active ? 'nm-btn--primary' : ''}`, onclick: () => { tagFilter = key; draw(); } }, label);
    }

    function openDevlogList(p, logs) {
      openModal({
        title: `${p.name} — 관련 Devlog`,
        contentBuilder(body, close) {
          if (!logs.length) {
            body.append(el('div', { class: 'empty-state' }, '연결된 개발 기록이 없습니다.'));
          } else {
            const list = el('div', { class: 'item-list' });
            for (const d of logs.slice().sort((a, b) => (b.logged_at || '').localeCompare(a.logged_at || ''))) {
              list.append(
                el('div', { class: 'item-row' }, [
                  el('div', { class: 'item-row__main' }, [
                    el('div', { class: 'item-row__title' }, d.title),
                    el('div', { class: 'item-row__meta' }, d.logged_at || ''),
                  ]),
                ])
              );
            }
            body.append(list);
          }
          body.append(
            el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: () => { close(); window.navigate('/devlog'); } }, 'Devlog에서 기록 추가')
          );
        },
      });
    }

    function latestProgress(projectId) {
      const rows = appState.progressByProject[projectId] || [];
      if (!rows.length) return 0;
      return rows.slice().sort((a, b) => (a.recorded_at < b.recorded_at ? -1 : 1)).at(-1).progress;
    }

    async function remove(p) {
      if (!confirmDialog(`"${p.name}" 프로젝트를 삭제할까요? (진행률·일정 연결 기록은 보존됩니다)`)) return;
      await appState.deleteProject(p.id);
      toast('프로젝트를 삭제했습니다.', 'success');
      selectedId = null;
    }

    function openProgressForm(p) {
      openModal({
        title: `${p.name} — 진행률 기록`,
        contentBuilder(body, close) {
          const current = latestProgress(p.id);
          const form = el('form', { class: 'stack' });
          const rangeLabel = el('div', { class: 'row row--between' }, [el('span', {}, '진행률'), el('span', { id: 'progress-value' }, `${current}%`)]);
          const range = el('input', { class: 'nm-input', type: 'range', min: '0', max: '100', name: 'progress', value: String(current) });
          range.addEventListener('input', () => {
            rangeLabel.querySelector('#progress-value').textContent = `${range.value}%`;
          });
          form.append(rangeLabel, range, el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%; margin-top:12px' }, '기록 저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            await appState.recordProgress(p.id, Number(range.value));
            toast('진행률을 기록했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    // 프로젝트 복사: 이름·WBS 항목(1~15강 같은 하위 구조)·의존관계를 새 프로젝트로 복제한다. 진행 기록/첨부파일은 복사하지 않는다.
    function openCopyForm(p) {
      const stageRows = appState.projectStages.filter((r) => r.project_id === p.id);
      openModal({
        title: `"${p.name}" 복사`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const nameInput = el('input', { class: 'nm-input', name: 'name', required: true, value: `${p.name} (복사)`, autofocus: true });
          const incl = el('input', { type: 'checkbox', name: 'includeStages', checked: true });
          const reset = el('input', { type: 'checkbox', name: 'resetProgress', checked: true });
          const baseInput = el('input', { class: 'nm-input', type: 'date', name: 'shiftBase', value: todayISO() });
          const baseRow = el('div', { class: 'nm-field', style: 'display:none' }, [el('label', {}, '새 시작일(가장 이른 날짜가 이 날이 되도록 전체 일정을 이동)'), baseInput]);
          const dateSel = el('select', { class: 'nm-select', name: 'dateMode' }, [
            el('option', { value: 'clear', selected: true }, '날짜 비우기 (복사 후 새로 입력)'),
            el('option', { value: 'shift' }, '새 시작일 기준으로 이동 (간격 유지)'),
            el('option', { value: 'keep' }, '날짜 그대로 복사'),
          ]);
          dateSel.addEventListener('change', () => { baseRow.style.display = dateSel.value === 'shift' ? '' : 'none'; });
          const summary = el('div', { class: 'text-muted', style: 'font-size:12px' }, `항목 ${stageRows.length}개(대·중·소 구조와 순서, 의존관계 포함)를 복사합니다. 진행률 기록과 첨부파일은 복사되지 않아요.`);
          incl.addEventListener('change', () => { summary.style.opacity = incl.checked ? '1' : '0.5'; });
          const cb = (input, text) => el('label', { class: 'row', style: 'gap:8px; cursor:pointer' }, [input, el('span', {}, text)]);
          form.append(
            field('새 프로젝트 이름', nameInput),
            cb(incl, 'WBS 항목(강의·단계 등 하위 구조)도 함께 복사'),
            cb(reset, '항목 상태·진행률·실제 완료일 초기화 (새로 시작)'),
            field('날짜', dateSel),
            baseRow,
            summary,
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '복사해서 만들기')
          );
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = form.querySelector('button[type=submit]');
            btn.disabled = true; btn.textContent = '복사 중…';
            try {
              const res = await appState.copyProject(p.id, {
                name: nameInput.value,
                includeStages: incl.checked,
                resetProgress: reset.checked,
                dateMode: dateSel.value,
                shiftBase: baseInput.value || null,
              });
              selectedId = res.project.id;
              draw();
              toast(`"${res.project.name}" 프로젝트를 만들었어요. (항목 ${res.stageCount}개 복사)`, 'success');
              close();
            } catch (err) {
              btn.disabled = false; btn.textContent = '복사해서 만들기';
              toast(`복사하지 못했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
    }

    function openProjectForm(existing) {
      openModal({
        title: existing ? '프로젝트 수정' : '프로젝트 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('이름', el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '' })),
            field('계획(마감) 완료일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'deadline', value: existing?.deadline || '' })),
            field('실제 완료일(선택, 완료 후 입력하면 계획대비 실적이 표시됩니다)', el('input', { class: 'nm-input', type: 'date', name: 'actual_completion_date', value: existing?.actual_completion_date || '' })),
            field('상태', statusSelect(existing?.status)),
            field('우선순위', prioritySelect(existing?.priority)),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', value: (existing?.tags || []).join(', ') })),
            field('메모', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || ''))
          );
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록 직후 바로 첨부할 수 있도록(Knowledge/문화생활과 동일한 흐름), 저장되면
          // 폼 자리에 첨부 패널을 보여준다.
          const attachHost = el('div', {});
          body.append(form, attachHost);
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const tags = String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
            const data = {
              name: fd.get('name'),
              deadline: fd.get('deadline') || null,
              actual_completion_date: fd.get('actual_completion_date') || null,
              status: fd.get('status'),
              priority: fd.get('priority'),
              tags,
              memo: fd.get('memo') || null,
            };
            try {
              if (existing) {
                await appState.updateProject(existing.id, data);
                toast('프로젝트를 저장했습니다.', 'success');
                close();
              } else {
                const row = await appState.addProject(data);
                toast('프로젝트를 저장했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
                Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
                submitBtn.style.display = 'none';
                attachHost.append(
                  el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                  el('div', { id: 'new-project-attach-box' }),
                  el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
                );
                window.renderAttachmentsPanel(attachHost.querySelector('#new-project-attach-box'), 'projects', row.id);
              }
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
        },
      });
    }

    function statusSelect(selected = 'in_progress') {
      const select = el('select', { class: 'nm-select', name: 'status' });
      for (const [value, label] of Object.entries(STATUS_LABEL)) {
        select.append(el('option', { value, selected: value === selected || undefined }, label));
      }
      return select;
    }

    function prioritySelect(selected = 'medium') {
      const select = el('select', { class: 'nm-select', name: 'priority' });
      for (const [value, label] of Object.entries(PRIORITY_LABEL)) {
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

  function confLabel(c) {
    return { high: '높음', medium: '보통', low: '낮음', none: '-' }[c] || c;
  }

  window.renderProjects = renderProjects;
  window.varianceBadgeFor = varianceBadge;
  window.computeAvgStageDuration = computeAvgStageDuration;
})();
