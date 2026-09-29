// 프로젝트 관리 화면. 좌측에 프로젝트 목록, 우측에 선택한 프로젝트의 상세(진행률 예측 +
// 단계별 간트차트)를 보여주는 2단 레이아웃이다(프로젝트 진척 화면 참고 스크린샷 스타일).
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, predictProjectCompletion, todayISO, diffDays, addDays } = window;

  const STATUS_LABEL = { in_progress: '진행 중', done: '완료', on_hold: '보류' };
  // 벤치마크: Trello/Asana류의 우선순위 필드 — 마감일만으로는 부족한 "지금 뭐부터 해야 하나"를 보완한다.
  const PRIORITY_LABEL = { high: '높음', medium: '보통', low: '낮음' };
  const PRIORITY_BADGE = { high: 'nm-badge--critical', medium: 'nm-badge--warning', low: '' };
  const STAGE_STATUS_LABEL = { todo: '대기', in_progress: '진행', done: '완료' };

  function renderProjects(root) {
    const container = el('div', {});
    root.append(container);
    let tagFilter = 'all';
    let selectedId = null;

    function draw() {
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
                el('span', { class: 'project-list-item__name' }, escapeHtml(p.name)),
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

    function detailPane(p, CONFIG) {
      if (!p) return el('div', {});
      const prediction = predictProjectCompletion(appState.progressByProject[p.id] || [], todayISO(), CONFIG.predict.projectMinRecords);
      const latest = latestProgress(p.id);
      const today = todayISO();
      const dDay = p.deadline ? diffDays(today, p.deadline) : null;
      const relatedDevlogs = appState.devlogs.filter((d) => d.project_id === p.id && !d.deleted_at);
      const stages = (appState.projectStagesByProject[p.id] || []).slice().sort((a, b) => (a.seq || 0) - (b.seq || 0));

      return el('div', { class: 'stack' }, [
        el('div', { class: 'nm-card' }, [
          el('div', { class: 'row row--between wrap' }, [
            el('div', {}, [
              el('div', { class: 'text-muted', style: 'font-size:11px; margin-bottom:2px' }, `대분류 · ${escapeHtml(p.name)}`),
              el('div', { class: 'row wrap' }, [
                el('strong', { style: 'font-size:16px' }, escapeHtml(p.name)),
                el('span', { class: 'nm-badge' }, STATUS_LABEL[p.status] || p.status),
                p.priority ? el('span', { class: `nm-badge ${PRIORITY_BADGE[p.priority] || ''}` }, `우선순위 ${PRIORITY_LABEL[p.priority]}`) : null,
                p.deadline ? el('span', { class: `nm-badge ${dDay !== null && dDay < 0 ? 'nm-badge--critical' : dDay !== null && dDay <= 7 ? 'nm-badge--warning' : ''}` }, `마감 ${p.deadline}${dDay !== null ? ` (D${dDay >= 0 ? '-' + dDay : '+' + -dDay})` : ''}`) : null,
              ]),
              p.memo ? el('div', { class: 'text-muted', style: 'margin-top:4px' }, escapeHtml(p.memo)) : null,
              (p.tags || []).length
                ? el('div', { class: 'row wrap', style: 'gap:4px; margin-top:6px' }, p.tags.map((t) => el('span', { class: 'nm-badge' }, `#${t}`)))
                : null,
            ]),
            el('div', { class: 'icon-row' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '진행률 기록', onclick: () => openProgressForm(p) }, '📈'),
              el('button', { class: 'nm-btn nm-btn--icon', title: `관련 Devlog (${relatedDevlogs.length})`, onclick: () => openDevlogList(p, relatedDevlogs) }, '🛠️'),
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
        ganttCard(p, stages),
      ]);
    }

    function ganttCard(p, stages) {
      const card = el('div', { class: 'nm-card' }, [
        el('div', { class: 'row row--between', style: 'margin-bottom:12px' }, [
          el('h3', { style: 'margin:0' }, '단계별 간트차트'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openStageForm(p) }, '+ 단계 추가'),
        ]),
      ]);

      if (!stages.length) {
        card.append(el('div', { class: 'empty-state' }, '등록된 단계가 없습니다. 각 단계에 목표(target) 날짜를 넣어야 간트차트와 진도 관리가 가능합니다.'));
        return card;
      }

      const doneCount = stages.filter((s) => s.status === 'done').length;
      card.append(
        el('div', { class: 'stage-progress-chip', style: 'margin-bottom:10px' }, `단계 진행률 ${doneCount}/${stages.length} 완료 (${Math.round((doneCount / stages.length) * 100)}%)`)
      );

      // 타임라인 범위: 단계들의 시작~목표일 전체 + 프로젝트 마감일까지 포함
      const allDates = stages.flatMap((s) => [s.start_date, s.target_date]).filter(Boolean);
      if (p.deadline) allDates.push(p.deadline);
      const today = todayISO();
      allDates.push(today);
      let minDate = allDates.reduce((a, b) => (a < b ? a : b));
      let maxDate = allDates.reduce((a, b) => (a > b ? a : b));
      if (minDate === maxDate) maxDate = addDays(maxDate, 7);
      const totalDays = Math.max(1, diffDays(minDate, maxDate));

      function pct(dateIso) {
        return Math.min(100, Math.max(0, (diffDays(minDate, dateIso) / totalDays) * 100));
      }

      const gantt = el('div', { class: 'gantt' });
      // 주 단위 눈금
      const ticks = el('div', { class: 'gantt-header__timeline' });
      for (let d = minDate; diffDays(d, maxDate) >= 0; d = addDays(d, 7)) {
        ticks.append(el('div', { class: 'gantt-tick', style: `left:${pct(d)}%` }, d.slice(5)));
      }
      ticks.append(el('div', { class: 'gantt-today-line', style: `left:${pct(today)}%`, title: `오늘 ${today}` }));
      gantt.append(el('div', { class: 'gantt-header' }, [el('div', { class: 'gantt-header__label' }, '단계'), ticks]));

      // 중분류(group_name)별로 묶어서 보여준다. 예: 대분류=프로젝트명, 중분류=학기/과목,
      // 소분류=강의(단계) — group_name이 없는 단계는 "(미분류)"로 묶는다.
      const groups = new Map();
      for (const s of stages) {
        const key = s.group_name || '(미분류)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(s);
      }

      for (const [groupName, groupStages] of groups) {
        if (groups.size > 1 || groupName !== '(미분류)') {
          gantt.append(el('div', { class: 'gantt-group-header' }, `중분류 · ${escapeHtml(groupName)}`));
        }
        for (const s of groupStages) {
          const start = s.start_date || s.target_date || today;
          const end = s.target_date || s.start_date || today;
          const left = pct(start);
          const width = Math.max(1.5, pct(end) - pct(start));
          const overdue = s.status !== 'done' && s.target_date && diffDays(today, s.target_date) < 0;
          const barClass = overdue ? 'gantt-bar--overdue' : `gantt-bar--${s.status}`;
          const track = el('div', { class: 'gantt-row__track' }, [
            el(
              'div',
              {
                class: `gantt-bar ${barClass}`,
                style: `left:${left}%; width:${width}%`,
                title: `${s.name} · ${s.start_date || '?'} ~ ${s.target_date || '?'}`,
                onclick: () => openStageForm(p, s),
              },
              s.name
            ),
          ]);
          gantt.append(
            el('div', { class: 'gantt-row' }, [
              el('div', { class: 'gantt-row__label' }, [
                el('span', {}, escapeHtml(s.name)),
                el('span', { class: 'nm-badge', style: 'font-size:10px' }, STAGE_STATUS_LABEL[s.status] || s.status),
              ]),
              track,
            ])
          );
        }
      }
      card.append(gantt);

      // 단계 목록(수정/삭제) — 간트 바 클릭으로도 수정 가능하지만 목록으로도 접근하게 한다.
      // 소분류 라벨은 "이름(시작~목표)" 형태로 보여준다(예: 1강(9/12~9/30)).
      const list = el('div', { class: 'item-list', style: 'margin-top:12px' });
      for (const [groupName, groupStages] of groups) {
        if (groups.size > 1 || groupName !== '(미분류)') {
          list.append(el('div', { class: 'gantt-group-header', style: 'margin-top:10px' }, `중분류 · ${escapeHtml(groupName)}`));
        }
        for (const s of groupStages) {
          const range = `${s.start_date ? s.start_date.slice(5).replace('-', '/') : '?'}~${s.target_date ? s.target_date.slice(5).replace('-', '/') : '?'}`;
          list.append(
            el('div', { class: 'item-row' }, [
              el('div', { class: 'item-row__main' }, [
                el('div', { class: 'item-row__title' }, `${escapeHtml(s.name)} (${range})`),
                el('div', { class: 'item-row__meta' }, `${s.start_date || '-'} ~ ${s.target_date || '(목표일 없음)'} · ${STAGE_STATUS_LABEL[s.status] || s.status}`),
              ]),
              el('div', { class: 'icon-row' }, [
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openStageForm(p, s) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon', title: '첨부파일', onclick: () => window.openAttachmentsModal('project_stages', s.id, s.name) }, '📎'),
                el('button', {
                  class: 'nm-btn nm-btn--icon nm-btn--danger',
                  title: '삭제',
                  onclick: async () => {
                    if (!confirmDialog(`"${s.name}" 단계를 삭제할까요?`)) return;
                    await appState.deleteProjectStage(s.id);
                    toast('삭제했습니다.', 'success');
                  },
                }, '🗑'),
              ]),
            ])
          );
        }
      }
      card.append(list);
      return card;
    }

    function openStageForm(p, existing) {
      openModal({
        title: existing ? '단계 수정' : `${p.name} — 단계 추가`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('중분류(선택, 예: 1학기-1과)', el('input', { class: 'nm-input', name: 'group_name', value: existing?.group_name || '', placeholder: '예: 1학기-1과:노인복지론' })),
            field('단계 이름(소분류, 예: 1강)', el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '' })),
            field('시작일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'start_date', value: existing?.start_date || todayISO() })),
            field('목표일(target, 진도 관리에 필요)', el('input', { class: 'nm-input', type: 'date', name: 'target_date', required: true, value: existing?.target_date || '' })),
            field('상태', stageStatusSelect(existing?.status))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              group_name: fd.get('group_name') || null,
              name: fd.get('name'),
              start_date: fd.get('start_date') || null,
              target_date: fd.get('target_date'),
              status: fd.get('status'),
            };
            if (existing) await appState.updateProjectStage(existing.id, data);
            else await appState.addProjectStage(p.id, data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
          if (existing) {
            body.append(el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'));
            const attachBox = el('div', {});
            body.append(attachBox);
            window.renderAttachmentsPanel(attachBox, 'project_stages', existing.id);
          }
        },
      });
    }

    function stageStatusSelect(selected = 'todo') {
      const select = el('select', { class: 'nm-select', name: 'status' });
      for (const [value, label] of Object.entries(STAGE_STATUS_LABEL)) {
        select.append(el('option', { value, selected: value === selected || undefined }, label));
      }
      return select;
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
                    el('div', { class: 'item-row__title' }, escapeHtml(d.title)),
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

    function openProjectForm(existing) {
      openModal({
        title: existing ? '프로젝트 수정' : '프로젝트 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('이름', el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '' })),
            field('마감일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'deadline', value: existing?.deadline || '' })),
            field('상태', statusSelect(existing?.status)),
            field('우선순위', prioritySelect(existing?.priority)),
            field('태그(쉼표로 구분, 선택)', el('input', { class: 'nm-input', name: 'tags', value: (existing?.tags || []).join(', ') })),
            field('메모', el('textarea', { class: 'nm-textarea', name: 'memo' }, existing?.memo || ''))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const tags = String(fd.get('tags') || '').split(',').map((t) => t.trim()).filter(Boolean);
            const data = {
              name: fd.get('name'),
              deadline: fd.get('deadline') || null,
              status: fd.get('status'),
              priority: fd.get('priority'),
              tags,
              memo: fd.get('memo') || null,
            };
            if (existing) await appState.updateProject(existing.id, data);
            else await appState.addProject(data);
            toast('프로젝트를 저장했습니다.', 'success');
            close();
          });
          body.append(form);
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
})();
