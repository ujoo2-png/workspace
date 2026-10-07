// 챌린저 화면. 목표(챌린지)를 등록하고 매일/매회 체크인해 진행률을 추적한다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO, diffDays, computeChallengeStreak, computeMissStreak, weekPills, parseFreqDays, ddayInfo, sortDdays, MAX_DDAYS, formatKoreanDate } = window;

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

  // 최근 N주(오늘 기준 7일 단위로 거슬러 올라간 구간) 동안 며칠 체크인했는지를 "달성률(%)"로 환산한다.
  // 챌린지마다 단위(회/km/페이지 등)가 달라 절대량 비교가 어려우므로, 일수 기준 출석률로 통일했다.
  function weeklyAchievementSeries(checkins, todayIso, weeks = 8) {
    const dates = new Set(checkins.map((c) => c.checkin_date));
    const labels = [];
    const values = [];
    for (let w = weeks - 1; w >= 0; w--) {
      const end = window.addDays(todayIso, -7 * w);
      const start = window.addDays(end, -6);
      let count = 0;
      for (let d = start; diffDays(d, end) >= 0; d = window.addDays(d, 1)) {
        if (dates.has(d)) count++;
      }
      labels.push(`${start.slice(5)}~${end.slice(5)}`);
      values.push(Math.round((count / 7) * 100));
    }
    return { labels, values };
  }

  // 최근 N개월의 월별 출석률(%). 이번 달은 오늘까지의 경과일 기준으로 계산한다.
  function monthlyAchievementSeries(checkins, todayIso, months = 6) {
    const dates = new Set(checkins.map((c) => c.checkin_date));
    const labels = [];
    const values = [];
    const [ty, tm, td] = todayIso.split('-').map(Number);
    for (let m = months - 1; m >= 0; m--) {
      const base = new Date(ty, tm - 1 - m, 1);
      const year = base.getFullYear();
      const month = base.getMonth(); // 0-based
      const daysInMonth = new Date(year, month + 1, 0).getDate();
      const isCurrentMonth = m === 0;
      const countedDays = isCurrentMonth ? td : daysInMonth;
      let count = 0;
      for (let day = 1; day <= countedDays; day++) {
        const iso = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (dates.has(iso)) count++;
      }
      labels.push(`${month + 1}월`);
      values.push(Math.round((count / countedDays) * 100));
    }
    return { labels, values };
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

      container.append(ddayStrip());

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
                el('div', { class: 'row wrap', style: 'gap:6px' }, [
                  el('span', { class: `mood-emoji mood-emoji--${mood.kind}`, title: mood.label }, mood.emoji),
                  el('strong', { style: 'font-size:15px; word-break:keep-all' }, c.title),
                  el('span', { class: 'nm-badge' }, c.category || '기타'),
                  el('span', { class: 'nm-badge' }, STATUS_LABEL[c.status] || c.status),
                  freqBadge(c),
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
                el('button', { class: 'nm-btn nm-btn--icon', title: '첨부파일', onclick: () => window.openAttachmentsModal('challenges', c.id, c.title) }, '📎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(c) }, '🗑'),
              ]),
            ]),
            weekRow(c, checkins, today),
            el('div', { style: 'margin-top:12px' }, [
              el('div', { class: 'nm-progress' }, [el('div', { class: 'nm-progress__bar', style: `width:${pct}%` })]),
              el('div', { class: 'row row--between', style: 'margin-top:6px' }, [
                el('span', { class: 'text-muted' }, `${total}${c.unit || ''} / ${target}${c.unit || ''} (${pct}%)`),
                el('span', { class: 'text-muted' }, `누적 ${checkins.length}회 체크인`),
              ]),
            ]),
            checkedToday && todayEntry?.memo
              ? el('div', { class: 'today-log' }, `오늘 한 일: ${todayEntry.memo}`)
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
              el('button', { class: 'nm-btn', onclick: () => openReport(c) }, '📊 리포트'),
            ]),
          ])
        );
      }
      container.append(grid);
    }

    // ---- 이번 주(월~일) 달성 알약 7칸 + 주간 달성률 링 ----
    // done=밝은 초록 채움+✓ / missed=붉은 줄무늬+✕ / today=윤곽 강조 / future=흐린 중립 / rest=점선 "휴" / inactive=기간 밖.
    // 색에만 의존하지 않도록 모양(✓ ✕ 휴 ●)과 aria-label을 함께 쓴다. 클릭하면 그날 체크인을 켜고 끈다(오늘/지난 날만).
    const PILL_MARK = { done: '✓', missed: '✕', today: '●', future: '', rest: '휴', inactive: '–' };
    const PILL_TEXT = { done: '달성', missed: '미달성', today: '오늘(아직 안 함)', future: '아직 오지 않음', rest: '쉬는 날', inactive: '기간 밖' };
    function ring(pct, label) {
      const r = 15, c = 2 * Math.PI * r;
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 40 40');
      svg.setAttribute('width', '40');
      svg.setAttribute('height', '40');
      svg.setAttribute('role', 'img');
      svg.setAttribute('aria-label', label);
      svg.innerHTML = `<title>${label}</title><circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--border)" stroke-width="5"/>` +
        `<circle cx="20" cy="20" r="${r}" fill="none" stroke="var(--pill-done)" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(c * pct) / 100} ${c}" transform="rotate(-90 20 20)"/>` +
        `<text x="20" y="24" text-anchor="middle" font-size="11" font-weight="700" fill="currentColor">${pct}</text>`;
      return svg;
    }
    function weekRow(c, checkins, today) {
      const w = weekPills(c, checkins, today);
      const row = el('div', { class: 'week-row' });
      const pills = el('div', { class: 'week-pills', role: 'group', 'aria-label': `이번 주 달성 현황 ${w.weekStart.slice(5)} ~ ${w.weekEnd.slice(5)}` });
      for (const cell of w.cells) {
        const md = cell.date.slice(5).replace('-', '/');
        const label = `${cell.label}요일 ${md} ${PILL_TEXT[cell.state]}`;
        const btn = el('button', {
          type: 'button',
          class: `week-pill week-pill--${cell.state}${cell.isToday ? ' week-pill--is-today' : ''}`,
          'data-date': cell.date,
          'data-state': cell.state,
          title: cell.canToggle ? `${label} — 눌러서 ${cell.state === 'done' ? '체크인 취소' : '체크인'}` : label,
          'aria-label': label,
          'aria-pressed': cell.state === 'done' ? 'true' : 'false',
          disabled: cell.canToggle ? undefined : true,
          onclick: () => togglePill(c, cell, checkins),
        }, [el('span', { class: 'week-pill__day' }, cell.label), el('span', { class: 'week-pill__mark', 'aria-hidden': 'true' }, PILL_MARK[cell.state])]);
        pills.append(btn);
      }
      const summary = el('div', { class: 'week-summary', title: `이번 주 ${w.doneCount}/${w.targetCount}회 · ${w.pct}%` }, [
        ring(w.pct, `이번 주 달성률 ${w.pct}% (${w.doneCount}/${w.targetCount})`),
        el('div', { class: 'week-summary__text' }, [el('strong', {}, `${w.doneCount}/${w.targetCount}`), el('span', {}, '이번 주')]),
      ]);
      row.append(pills, summary);
      return row;
    }
    async function togglePill(c, cell, checkins) {
      const entry = checkins.find((r) => r.checkin_date === cell.date);
      if (entry && (entry.memo || (entry.value ?? 1) !== 1) && !confirmDialog(`${cell.date} 기록(${entry.value}${c.unit || ''}${entry.memo ? ', "' + entry.memo + '"' : ''})을 삭제할까요?`)) return;
      try {
        await appState.toggleCheckinDay(c.id, cell.date);
      } catch (err) {
        toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
      }
    }
    function freqBadge(c) {
      if (c.freq_type === 'weekdays') {
        const days = Array.from(parseFreqDays(c.freq_days)).sort();
        return el('span', { class: 'nm-badge', title: '체크인 요일' }, days.map((d) => ['월', '화', '수', '목', '금', '토', '일'][d - 1]).join('·') || '요일 지정');
      }
      if (c.freq_type === 'times_per_week') return el('span', { class: 'nm-badge', title: '주간 목표 횟수' }, `주 ${c.freq_times || 1}회`);
      return null;
    }

    // ---- D-day (최대 5개) ----
    const DDAY_COLORS = ['#2f6fed', '#e5484d', '#1fa971', '#d9822b', '#8b5cf6', '#0ea5b7'];
    const DDAY_EMOJIS = ['🎯', '📚', '✈️', '🎂', '💍', '🎓', '💼', '❤️'];
    function ddayStrip() {
      const today = todayISO();
      const list = sortDdays(appState.ddays, today);
      const full = list.length >= MAX_DDAYS;
      const strip = el('section', { class: 'dday-strip', 'aria-label': 'D-day' });
      strip.append(el('div', { class: 'row row--between', style: 'margin-bottom:8px' }, [
        el('div', { class: 'row', style: 'gap:8px' }, [el('h3', { style: 'margin:0' }, '📆 D-day'), el('span', { class: 'nm-badge', id: 'dday-count' }, `${list.length}/${MAX_DDAYS}`)]),
        el('button', {
          class: 'nm-btn', id: 'dday-add', disabled: full ? true : undefined,
          title: full ? `D-day는 최대 ${MAX_DDAYS}개까지 등록할 수 있어요. 하나를 지운 뒤 추가하세요.` : 'D-day 추가',
          onclick: () => openDdayForm(),
        }, full ? `최대 ${MAX_DDAYS}개` : '+ D-day 추가'),
      ]));
      if (!list.length) {
        strip.append(el('div', { class: 'empty-state', style: 'padding:14px' }, '아직 D-day가 없어요. 시험, 여행, 기념일을 추가해 보세요 (최대 5개).'));
        return strip;
      }
      const cards = el('div', { class: 'dday-cards' });
      for (const d of list) {
        const info = ddayInfo(d.target_date, today, !!d.repeat_yearly);
        const color = d.color || DDAY_COLORS[0];
        const card = el('div', {
          class: `dday-card${info.isToday ? ' dday-card--today' : ''}${info.isPast ? ' dday-card--past' : ''}`,
          style: `--dday-color:${color}`,
          'data-dday-id': d.id,
        }, [
          el('div', { class: 'dday-card__top' }, [
            el('span', { class: 'dday-card__emoji', 'aria-hidden': 'true' }, d.emoji || '🎯'),
            el('span', { class: 'dday-card__title', title: d.title }, d.title),
            el('span', { class: 'icon-row dday-card__actions' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', 'aria-label': `${d.title} 수정`, onclick: () => openDdayForm(d) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', 'aria-label': `${d.title} 삭제`, onclick: () => removeDday(d) }, '🗑'),
            ]),
          ]),
          el('div', { class: 'dday-card__num' }, info.text),
          el('div', { class: 'dday-card__date' }, [
            `${formatKoreanDate(info.date)}`,
            d.repeat_yearly ? el('span', { class: 'dday-card__tag', title: '매년 반복' }, info.anniversary ? `🔁 ${info.anniversary}주년` : '🔁 매년') : null,
            info.isPast ? el('span', { class: 'dday-card__tag' }, '지남') : null,
          ]),
          d.memo ? el('div', { class: 'dday-card__memo', title: d.memo }, d.memo) : null,
        ]);
        cards.append(card);
      }
      strip.append(cards);
      return strip;
    }
    async function removeDday(d) {
      if (!confirmDialog(`"${d.title}" D-day를 삭제할까요?`)) return;
      try { await appState.deleteDday(d.id); toast('삭제했습니다.', 'success'); } catch (e) { toast(`삭제하지 못했습니다: ${e.message || e}`, 'error'); }
    }
    function openDdayForm(existing) {
      if (!existing && appState.ddays.length >= MAX_DDAYS) { toast(`D-day는 최대 ${MAX_DDAYS}개까지 등록할 수 있어요.`, 'error'); return; }
      openModal({
        title: existing ? 'D-day 수정' : 'D-day 추가',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const emojiInput = el('input', { class: 'nm-input', name: 'emoji', maxlength: '4', value: existing?.emoji || '🎯', style: 'width:80px', 'aria-label': '이모지' });
          const emojiRow = el('div', { class: 'row wrap', style: 'gap:6px' }, [
            emojiInput,
            ...DDAY_EMOJIS.map((e) => el('button', { type: 'button', class: 'nm-btn nm-btn--icon', onclick: () => { emojiInput.value = e; } }, e)),
          ]);
          const colorWrap = el('div', { class: 'dday-colors', role: 'radiogroup', 'aria-label': '색상' });
          DDAY_COLORS.forEach((c, i) => {
            const checked = (existing?.color || DDAY_COLORS[0]) === c;
            colorWrap.append(el('label', { class: 'dday-color', style: `--c:${c}`, title: c }, [
              el('input', { type: 'radio', name: 'color', value: c, checked: checked || undefined }),
              el('span', { class: 'dday-color__dot' }),
            ]));
          });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, maxlength: '40', value: existing?.title || '', placeholder: '예: 정보처리기사 시험' }), true),
            field('목표 날짜', el('input', { class: 'nm-input', type: 'date', name: 'target_date', required: true, value: existing?.target_date || '' }), true),
            field('이모지(선택)', emojiRow),
            field('색상', colorWrap),
            field('메모(선택)', el('textarea', { class: 'nm-textarea', name: 'memo', rows: '2' }, existing?.memo || '')),
            el('label', { class: 'row', style: 'gap:8px; cursor:pointer' }, [
              el('input', { type: 'checkbox', name: 'repeat_yearly', checked: existing?.repeat_yearly || undefined }),
              el('span', {}, '매년 반복 (생일·결혼기념일 등 — 지나면 다음 해 날짜로 넘어가요)'),
            ]),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장')
          );
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              title: String(fd.get('title') || '').trim(),
              target_date: fd.get('target_date'),
              emoji: (fd.get('emoji') || '').trim() || null,
              color: fd.get('color') || DDAY_COLORS[0],
              memo: (fd.get('memo') || '').trim() || null,
              repeat_yearly: fd.get('repeat_yearly') === 'on',
            };
            if (!data.title || !data.target_date) return;
            try {
              if (existing) await appState.updateDday(existing.id, data);
              else await appState.addDday(data);
              toast('저장했습니다.', 'success');
              close();
            } catch (err) {
              toast(`저장하지 못했습니다: ${err.message || err}`, 'error');
            }
          });
          body.append(form);
        },
      });
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
            try {
              await appState.checkinChallenge(c.id, todayISO(), Number(fd.get('value')) || 1, fd.get('memo') || null);
              toast(existingEntry ? '기록을 수정했습니다.' : '오늘 체크인했습니다! 🎉', 'success');
              close();
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
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
                  r.memo ? el('div', { class: 'item-row__meta' }, r.memo) : null,
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

    // 주간/월간 달성률 추이 리포트. 단일 축·단일 색상 막대 차트로(이중축 없이) 보여준다.
    function openReport(c) {
      openModal({
        title: `${c.title} — 달성률 리포트`,
        contentBuilder(body) {
          const checkins = appState.checkinsByChallenge[c.id] || [];
          let range = 'weekly';
          const chartHost = el('div', {});
          const tabs = el('div', { class: 'row wrap', style: 'gap:8px; margin-bottom:12px' }, [
            tabBtnLocal('weekly', '주간(최근 8주)'),
            tabBtnLocal('monthly', '월간(최근 6개월)'),
          ]);
          function tabBtnLocal(key, label) {
            return el('button', { class: `nm-btn ${range === key ? 'nm-btn--primary' : ''}`, onclick: () => { range = key; renderChart(); rebuildTabs(); } }, label);
          }
          function rebuildTabs() {
            tabs.innerHTML = '';
            tabs.append(tabBtnLocal('weekly', '주간(최근 8주)'), tabBtnLocal('monthly', '월간(최근 6개월)'));
          }
          function renderChart() {
            chartHost.innerHTML = '';
            const today = todayISO();
            const { labels, values } = range === 'weekly' ? weeklyAchievementSeries(checkins, today, 8) : monthlyAchievementSeries(checkins, today, 6);
            if (!values.some((v) => v > 0)) {
              chartHost.append(el('div', { class: 'empty-state' }, '표시할 체크인 기록이 없습니다.'));
              return;
            }
            chartHost.append(
              el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:6px' }, range === 'weekly' ? '한 주(7일) 중 체크인한 날의 비율(%)' : '한 달 중 체크인한 날의 비율(%, 이번 달은 오늘까지 기준)'),
              window.simpleBarChart(labels, values, '#8b5cf6')
            );
          }
          renderChart();
          body.append(tabs, chartHost);
        },
      });
    }

    function openChallengeForm(existing) {
      openModal({
        title: existing ? '챌린지 수정' : '챌린지 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('제목', el('input', { class: 'nm-input', name: 'title', required: true, value: existing?.title || '' }), true),
            field('카테고리', categorySelect(existing?.category)),
            field('목표치', el('input', { class: 'nm-input', type: 'number', name: 'target_value', min: '1', required: true, value: existing?.target_value ?? 30 }), true),
            field('단위(예: 회, km, 페이지)', el('input', { class: 'nm-input', name: 'unit', value: existing?.unit || '회' })),
            field('시작일', el('input', { class: 'nm-input', type: 'date', name: 'start_date', value: existing?.start_date || todayISO() })),
            field('종료일(선택)', el('input', { class: 'nm-input', type: 'date', name: 'end_date', value: existing?.end_date || '' })),
            field('상태', statusSelect(existing?.status)),
            freqField(existing)
          );
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          const attachHost = el('div', {});
          body.append(form, attachHost);
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
              freq_type: fd.get('freq_type') || 'daily',
              freq_days: fd.get('freq_type') === 'weekdays' ? fd.getAll('freq_day').sort().join(',') : '',
              freq_times: fd.get('freq_type') === 'times_per_week' ? Math.min(7, Math.max(1, Number(fd.get('freq_times')) || 1)) : null,
            };
            if (data.freq_type === 'weekdays' && !data.freq_days) { toast('체크인할 요일을 하나 이상 고르세요.', 'error'); return; }
            try {
              appState.schemaWarning = null;
              if (existing) {
                await appState.updateChallenge(existing.id, data);
                toast(appState.schemaWarning ? `저장했습니다. (${appState.schemaWarning})` : '저장했습니다.', 'success');
                close();
              } else {
                const row = await appState.addChallenge(data);
                toast('저장했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
                Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
                submitBtn.style.display = 'none';
                attachHost.append(
                  el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                  el('div', { id: 'new-challenge-attach-box' }),
                  el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
                );
                window.renderAttachmentsPanel(attachHost.querySelector('#new-challenge-attach-box'), 'challenges', row.id);
              }
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
        },
      });
    }

    // 빈도: 매일 / 요일 지정 / 주 N회 — 주간 알약에서 "쉬는 날"을 빨강(미달성)으로 보이지 않게 하는 기준이다.
    function freqField(existing) {
      const type = existing?.freq_type || 'daily';
      const days = parseFreqDays(existing?.freq_days);
      const select = el('select', { class: 'nm-select', name: 'freq_type' }, [
        el('option', { value: 'daily', selected: type === 'daily' || undefined }, '매일'),
        el('option', { value: 'weekdays', selected: type === 'weekdays' || undefined }, '요일 지정'),
        el('option', { value: 'times_per_week', selected: type === 'times_per_week' || undefined }, '주 N회(요일 상관없이)'),
      ]);
      const dayBox = el('div', { class: 'row wrap', style: 'gap:6px' }, ['월', '화', '수', '목', '금', '토', '일'].map((d, i) => el('label', { class: 'freq-day' }, [
        el('input', { type: 'checkbox', name: 'freq_day', value: String(i + 1), checked: days.has(i + 1) || undefined }), el('span', {}, d),
      ])));
      const timesBox = el('div', { class: 'row', style: 'gap:6px; align-items:center' }, [
        el('input', { class: 'nm-input', type: 'number', name: 'freq_times', min: '1', max: '7', value: existing?.freq_times || 3, style: 'width:80px' }), el('span', { class: 'text-muted' }, '회 / 주'),
      ]);
      const sync = () => { dayBox.style.display = select.value === 'weekdays' ? '' : 'none'; timesBox.style.display = select.value === 'times_per_week' ? '' : 'none'; };
      select.addEventListener('change', sync);
      sync();
      return el('div', { class: 'nm-field' }, [el('label', {}, '체크인 빈도'), select, dayBox, timesBox, el('div', { class: 'text-muted', style: 'font-size:12px' }, '쉬는 날은 주간 칸에서 빨간색이 아니라 "휴"로 표시돼요.')]);
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

    function field(label, node, required = false) {
      return el('div', { class: 'nm-field' }, [el('label', {}, [required ? el('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null, label]), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderChallenges = renderChallenges;
})();
