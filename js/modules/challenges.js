// 챌린저 화면. 목표(챌린지)를 등록하고 매일/매회 체크인해 진행률을 추적한다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO, diffDays, computeChallengeStreak, computeMissStreak } = window;

  const STATUS_LABEL = { active: '진행 중', completed: '완료', paused: '일시중지' };
  const CATEGORY_OPTIONS = ['운동', '독서', '습관', '학습', '기타'];

  // 연속 달성/미달성에 따라 보여줄 이모지. 오늘 체크인했으면 연속 달성일 수에 따라 기쁨 정도가
  // 커지고, 아직 체크인 전이면 연속 미달성일(오늘 포함) 수에 따라 무덤덤 → 화남으로 바뀐다.
  function computeMood(checkins, todayIso) {
    const { streak, checkedToday } = computeChallengeStreak(checkins, todayIso);
    if (checkedToday) {
      if (streak >= 7) return { emoji: '🤩', label: `${streak}일 연속 달성!`, kind: 'happy' };
      if (streak >= 3) return { emoji: '😄', label: `${streak}일 연속 달성`, kind: 'happy' };
      return { emoji: '🙂', label: '오늘 달성', kind: 'happy' };
    }
    const missStreak = computeMissStreak(checkins, todayIso);
    if (missStreak >= 3) return { emoji: '😡', label: `${missStreak}일 연속 미달성`, kind: 'angry' };
    if (missStreak >= 2) return { emoji: '😠', label: `${missStreak}일 연속 미달성`, kind: 'angry' };
    return { emoji: '😐', label: '오늘 아직 체크인 전', kind: 'neutral' };
  }

  function renderChallenges(root) {
    const container = el('div', {});
    root.append(container);

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '챌린저'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openChallengeForm() }, '+ 챌린지 등록'),
        ])
      );

      const rows = appState.challenges.slice().sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '진행 중인 챌린지가 없습니다. 운동, 독서, 습관 만들기 등을 등록해보세요.'));
        return;
      }

      const grid = el('div', { class: 'grid-2' });
      const today = todayISO();
      for (const c of rows) {
        const checkins = appState.checkinsByChallenge[c.id] || [];
        const total = checkins.reduce((s, r) => s + (r.value || 0), 0);
        const target = c.target_value || 0;
        const pct = target > 0 ? Math.min(100, Math.round((total / target) * 100)) : 0;
        const checkedToday = checkins.some((r) => r.checkin_date === today);
        const todayEntry = checkins.find((r) => r.checkin_date === today);
        const dDay = c.end_date ? diffDays(today, c.end_date) : null;
        const streakInfo = computeChallengeStreak(checkins, today);
        const mood = computeMood(checkins, today);

        grid.append(
          el('div', { class: 'nm-card challenge-card' }, [
            el('div', { class: 'row row--between wrap' }, [
              el('div', {}, [
                el('div', { class: 'row' }, [
                  el('span', { class: `mood-emoji mood-emoji--${mood.kind}`, title: mood.label }, mood.emoji),
                  el('strong', { style: 'font-size:15px' }, escapeHtml(c.title)),
                  el('span', { class: 'nm-badge' }, c.category || '기타'),
                  el('span', { class: 'nm-badge' }, STATUS_LABEL[c.status] || c.status),
                  streakInfo.streak > 0
                    ? el('span', { class: `nm-badge ${streakInfo.atRisk ? 'nm-badge--warning' : 'nm-badge--success'}` }, `🔥 ${streakInfo.streak}일 연속${streakInfo.atRisk ? ' · 오늘 체크인 필요!' : ''}`)
                    : null,
                ]),
                el('div', { class: 'text-muted', style: 'margin-top:4px; font-size:12px' }, [
                  c.end_date ? `종료 ${c.end_date}${dDay !== null ? ` (D${dDay >= 0 ? '-' + dDay : '+' + -dDay})` : ''}` : '기간 제한 없음',
                ]),
              ]),
              el('div', { class: 'icon-row' }, [
                el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openChallengeForm(c) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(c) }, '🗑'),
              ]),
            ]),
            el('div', { style: 'margin-top:12px' }, [
              el('div', { class: 'nm-progress' }, [el('div', { class: 'nm-progress__bar', style: `width:${pct}%` })]),
              el('div', { class: 'row row--between', style: 'margin-top:6px' }, [
                el('span', { class: 'text-muted' }, `${total}${c.unit || ''} / ${target}${c.unit || ''} (${pct}%)`),
                el('span', { class: 'text-muted' }, `누적 ${checkins.length}회 체크인`),
              ]),
            ]),
            checkedToday && todayEntry?.memo
              ? el('div', { class: 'today-log' }, `오늘 한 일: ${escapeHtml(todayEntry.memo)}`)
              : !checkedToday
              ? el('div', { class: 'today-log today-log--miss' }, '아직 오늘 기록이 없어요. 체크인하면서 오늘 한 일을 남겨보세요.')
              : null,
            el('div', { class: 'row', style: 'margin-top:12px; gap:8px' }, [
              el(
                'button',
                { class: `nm-btn ${checkedToday ? '' : 'nm-btn--primary'}`, onclick: () => openCheckinForm(c, todayEntry) },
                checkedToday ? '오늘 기록 수정' : '오늘 체크인'
              ),
              el('button', { class: 'nm-btn', onclick: () => openHistory(c) }, '기록 보기'),
            ]),
          ])
        );
      }
      container.append(grid);
    }

    function openCheckinForm(c, existingEntry) {
      openModal({
        title: `${c.title} — 오늘 체크인`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('오늘 달성치', el('input', { class: 'nm-input', type: 'number', name: 'value', min: '0', step: 'any', value: existingEntry?.value ?? 1 })),
            field('오늘 한 일(선택)', el('textarea', { class: 'nm-textarea', name: 'memo', placeholder: '예: 30분 러닝 5km 완주' }, existingEntry?.memo || '')),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, existingEntry ? '기록 수정' : '오늘 체크인')
          );
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            await appState.checkinChallenge(c.id, todayISO(), Number(fd.get('value')) || 1, fd.get('memo') || null);
            toast(existingEntry ? '기록을 수정했습니다.' : '오늘 체크인했습니다! 🎉', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    async function remove(c) {
      if (!confirmDialog(`"${c.title}" 챌린지를 삭제할까요? (체크인 기록도 함께 사라집니다)`)) return;
      await appState.deleteChallenge(c.id);
      toast('삭제했습니다.', 'success');
    }

    function openHistory(c) {
      openModal({
        title: `${c.title} — 체크인 기록`,
        contentBuilder(body) {
          const checkins = (appState.checkinsByChallenge[c.id] || []).slice().sort((a, b) => (b.checkin_date || '').localeCompare(a.checkin_date || ''));
          if (!checkins.length) {
            body.append(el('div', { class: 'empty-state' }, '아직 체크인 기록이 없습니다.'));
            return;
          }
          const list = el('div', { class: 'item-list' });
          for (const r of checkins) {
            list.append(
              el('div', { class: 'item-row' }, [
                el('div', { class: 'item-row__main' }, [
                  el('div', { class: 'item-row__title' }, r.checkin_date),
                  r.memo ? el('div', { class: 'item-row__meta' }, escapeHtml(r.memo)) : null,
                ]),
                el('span', { class: 'nm-badge' }, `${r.value}${c.unit || ''}`),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: async () => { await appState.deleteCheckin(r.id); openHistory(c); } }, '🗑'),
              ])
            );
          }
          body.append(list);
        },
      });
    }

    function openChallengeForm(existing) {
      openModal({
        title: existing ? '챌린지 수정' : '챌린지 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' })),
            field('카테고리', categorySelect(existing?.category)),
            field('목표치', el('input', { class: 'nm-input', type: 'number', name: 'target_value', min: '1', required: true, value: existing?.target_value ?? 30 })),
            field('단위(예: 회, km, 페이지)', el('input', { class: 'nm-input', name: 'unit', value: existing?.unit || '회' })),
            field('시작일', el('input', { class: 'nm-input', type: 'date', name: 'start_date', value: existing?.start_date || todayISO() })),
            field('종료일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'end_date', value: existing?.end_date || '' })),
            field('상태', statusSelect(existing?.status))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              title: fd.get('title'),
              category: fd.get('category'),
              target_value: Number(fd.get('target_value')) || 1,
              unit: fd.get('unit') || '회',
              start_date: fd.get('start_date') || null,
              end_date: fd.get('end_date') || null,
              status: fd.get('status'),
            };
            if (existing) await appState.updateChallenge(existing.id, data);
            else await appState.addChallenge(data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    function categorySelect(selected) {
      const select = el('select', { class: 'nm-select', name: 'category' });
      for (const c of CATEGORY_OPTIONS) select.append(el('option', { value: c, selected: c === selected || undefined }, c));
      return select;
    }

    function statusSelect(selected = 'active') {
      const select = el('select', { class: 'nm-select', name: 'status' });
      for (const [value, label] of Object.entries(STATUS_LABEL)) {
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

  window.renderChallenges = renderChallenges;
})();
