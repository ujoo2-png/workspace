// 사용량 화면(v7.26.0): Supabase 무료 한도 대비 현재 사용량. 카드를 누르면 "어느 메뉴에서 썼는지" 분해를 보여 준다.
// 일반 <script>. js/services/usageService.js가 먼저 로드되어 있어야 한다.
(function () {
  const { el, toast } = window;
  const U = () => window.UsageService;
  const ORG_USAGE_URL = 'https://supabase.com/dashboard/org/dtmpnagmbgmvxllcghqt/usage';
  const projectRef = () => { try { return new URL(window.CONFIG.supabaseUrl).host.split('.')[0]; } catch { return ''; } };
  const LABEL = { ok: '여유', warn: '주의', danger: '위험', none: '한도 미설정' };

  function renderUsage(root) {
    const wrap = el('div', {});
    root.append(wrap);
    let stats = null; let error = null; let loading = true;
    const supa = window.CONFIG.mode === 'supabase';

    async function load() {
      loading = true; error = null; draw();
      try { stats = supa ? await window.getStore().usageStats() : null; } catch (e) { error = e.message || String(e); }
      loading = false; draw();
    }

    // 지표별 현재값 계산: { value, source, note }
    function current(m) {
      const man = U().getManual();
      const eg = U().summarize({ ym: U().dayKey().slice(0, 7) });
      const manual = man.values[m.id];
      let value = null; let source = m.source; let note = '';
      if (m.id === 'db') value = stats ? Number(stats.db_bytes) : null;
      else if (m.id === 'storage') value = stats ? Number(stats.storage_bytes) : null;
      else if (m.id === 'mau') value = stats ? Number(stats.users_active_30d) : null;
      else if (m.id === 'egress') { value = eg.bytes; note = `이 브라우저 추정 (${eg.requests.toLocaleString('ko-KR')}회 요청)`; }
      else if (m.id === 'edge') { value = eg.byKind.functions || 0; note = '이 브라우저 추정'; }
      if (manual && manual.value !== null && manual.value !== undefined) {
        value = manual.value; source = 'manual'; note = `직접 입력 (${manual.at || ''})`;
      }
      const limit = Object.prototype.hasOwnProperty.call(man.limits, m.id) && man.limits[m.id] !== null ? man.limits[m.id] : m.limit;
      return { value, source, note, limit };
    }

    function card(m) {
      const c = current(m);
      const pct = c.value !== null && c.limit ? (c.value / c.limit) * 100 : null;
      const lv = U().level(pct);
      const srcLabel = { auto: '서버 측정', estimate: '추정', manual: '직접 입력' }[c.source];
      const bar = el('div', { class: 'usage-bar', role: 'progressbar', 'aria-valuenow': pct === null ? undefined : String(Math.round(pct)), 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-label': `${m.label} 사용률` }, [
        el('div', { class: `usage-bar__fill usage-bar__fill--${lv}`, style: `width:${pct === null ? 0 : Math.min(100, pct)}%` }),
      ]);
      return el('div', { class: `nm-card usage-card usage-card--${lv}`, 'data-metric': m.id, tabindex: '0', role: 'button', title: '눌러서 어느 메뉴에서 썼는지 보기', onclick: (e) => { if (e.target.closest('button')) return; openDetail(m); }, onkeydown: (e) => { if (e.key === 'Enter' && !e.target.closest('button')) openDetail(m); } }, [
        el('div', { class: 'usage-card__top' }, [
          el('span', { class: 'usage-card__title' }, `${m.icon} ${m.label}`),
          el('button', { type: 'button', class: 'nm-btn nm-btn--icon usage-edit', title: '값/한도 직접 입력', 'aria-label': `${m.label} 직접 입력`, onclick: () => openEdit(m) }, '✎'),
        ]),
        el('div', { class: 'usage-card__value' }, [el('b', {}, U().fmtValue(c.value, m.unit)), el('span', { class: 'text-muted' }, ` / ${c.limit ? U().fmtValue(c.limit, m.unit) : '한도 미설정'}`)]),
        bar,
        el('div', { class: 'usage-card__meta' }, [
          el('span', { class: `usage-pill usage-pill--${lv}` }, pct === null ? LABEL.none : `${pct.toFixed(pct < 10 ? 1 : 0)}% · ${LABEL[lv]}`),
          el('span', { class: 'usage-src' }, srcLabel),
        ]),
        el('div', { class: 'text-muted usage-card__note' }, c.note || m.hint),
      ]);
    }

    // ---- 분해 모달 ----
    const barRows = (entries, total, unit = 'bytes', max = 14) => {
      const rows = entries.filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, max);
      if (!rows.length) return el('div', { class: 'text-muted' }, '기록이 아직 없어요.');
      const top = rows[0][1];
      return el('div', { class: 'usage-rows' }, rows.map(([name, v]) => el('div', { class: 'usage-row' }, [
        el('div', { class: 'usage-row__l' }, [el('span', {}, name), el('b', {}, `${U().fmtValue(v, unit)}${total ? ` · ${((v / total) * 100).toFixed(0)}%` : ''}`)]),
        el('div', { class: 'usage-row__t' }, el('div', { class: 'usage-row__f', style: `width:${Math.max(2, (v / top) * 100)}%` })),
      ])));
    };
    const sec = (title, node, sub) => el('div', { class: 'usage-sec' }, [el('h4', {}, title), sub ? el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:6px' }, sub) : null, node]);

    function openDetail(m) {
      window.openModal({
        title: `${m.icon} ${m.label} — 어디에서 썼나`,
        width: '680px',
        contentBuilder(body) {
          const c = current(m);
          const kids = [];
          if (m.id === 'db') {
            if (!stats) kids.push(el('div', { class: 'text-muted' }, supa ? '서버 통계를 불러오지 못했어요(위 안내 참고).' : '로컬 모드에는 서버 DB가 없어요.'));
            else {
              const byMenu = U().dbByMenu(stats);
              const tot = Object.values(byMenu).reduce((a, b) => a + b, 0);
              kids.push(sec('메뉴별', barRows(Object.entries(byMenu), tot), '테이블을 사용하는 화면 기준(첨부파일은 붙은 메뉴별로 나눔). 합계는 테이블 총량이며 시스템 영역은 제외돼 위 총 크기보다 작아요.'));
              kids.push(sec('테이블별 (상위)', barRows((stats.tables || []).map((t) => [`${t.name}  ·  ${t.my_rows ?? '-'}행`, Number(t.bytes)]), tot), '인덱스 포함 크기, 오른쪽은 내 행 수'));
              const att = (stats.attachments_by_owner || []).reduce((a, b) => a + Number(b.bytes || 0), 0);
              if (att > 0) kids.push(el('div', { class: 'usage-tip' }, `💡 첨부파일 ${U().fmtValue(att, 'bytes')}이 base64로 DB에 저장돼 있어요(원본보다 약 33% 커요). 큰 파일은 오래된 것부터 정리하거나 Storage로 옮기면 DB 한도를 아낄 수 있어요.`));
            }
          } else if (m.id === 'storage') {
            kids.push(stats && (stats.storage_buckets || []).length ? sec('버킷별', barRows(stats.storage_buckets.map((b) => [`${b.bucket} (${b.objects}개)`, Number(b.bytes)]), Number(stats.storage_bytes))) : el('div', { class: 'text-muted' }, '버킷에 올린 파일이 없어요. 이 앱은 첨부파일을 DB(attachments)에 저장하므로 "데이터베이스 크기"에 포함돼요.'));
          } else if (m.id === 'egress') {
            const month = U().summarize({ ym: U().dayKey().slice(0, 7) });
            const week = U().summarize({ days: 7 });
            const today = U().summarize({ days: 1 });
            kids.push(el('div', { class: 'usage-kv' }, [['오늘', today.bytes], ['최근 7일', week.bytes], ['이번 달', month.bytes]].map(([k, v]) => el('div', {}, [el('span', { class: 'text-muted' }, k), el('b', {}, U().fmtValue(v, 'bytes'))]))));
            const days = new Date().getDate();
            const proj = days ? (month.bytes / days) * 30 : 0;
            kids.push(el('div', { class: 'text-muted', style: 'font-size:12px' }, `이번 달 추세로 월말까지 약 ${U().fmtValue(proj, 'bytes')} (한도 ${U().fmtValue(m.limit, 'bytes')}) · 측정 시작일 ${U()._since()}`));
            kids.push(sec('메뉴별 (어느 테이블의 데이터를 받았나)', barRows(Object.entries(U().egressByTableMenu(month.byTable)), month.bytes)));
            kids.push(sec('테이블별', barRows(Object.entries(month.byTable), month.bytes)));
            kids.push(sec('화면(내가 보고 있던 메뉴)별', barRows(Object.entries(month.byMenu), month.bytes), '요청이 일어난 순간 열려 있던 화면 기준. 로그인 직후 전체 불러오기는 홈에 잡혀요.'));
            kids.push(sec('최근 14일', dayChart(month, U().summarize({ days: 14 }))));
            kids.push(el('div', { class: 'usage-tip' }, '⚠️ 이 값은 "이 브라우저"가 받은 양의 추정치예요. 다른 기기, 이미지(<img>) 직접 로드, 실시간 연결은 빠져요. 실제 값은 Supabase 대시보드 Usage에서 확인해 ✎로 입력하면 그 값이 우선 표시돼요.'));
            kids.push(el('button', { type: 'button', class: 'nm-btn', onclick: () => { if (window.confirmDialog('이 브라우저의 전송량 기록을 지울까요?')) { U().reset(); toast('기록을 지웠어요.', 'success'); draw(); } } }, '기록 지우기'));
          } else if (m.id === 'mau') {
            kids.push(el('div', {}, `가입자 ${stats ? stats.users_total : '-'}명 중 최근 30일 로그인 ${stats ? stats.users_active_30d : '-'}명(MAU 근사). 개인용 앱이라 한도(50,000)에 닿을 일은 거의 없어요.`));
          } else if (m.id === 'edge') {
            const month = U().summarize({ ym: U().dayKey().slice(0, 7) });
            kids.push(sec('함수별', barRows(Object.entries(month.byTable).filter(([k]) => k.startsWith('fn:')), 0, 'bytes'), '(받은 바이트 기준, 호출 횟수는 카드 값)'));
          } else {
            kids.push(el('div', {}, m.hint + '. 서버에 공개된 조회 수단이 없어 Supabase 대시보드 값을 직접 입력해야 해요.'));
          }
          kids.push(el('div', { class: 'row wrap', style: 'gap:8px; margin-top:12px' }, [
            el('a', { class: 'nm-btn', href: ORG_USAGE_URL, target: '_blank', rel: 'noopener noreferrer' }, '↗ Supabase Usage 열기'),
            projectRef() ? el('a', { class: 'nm-btn', href: `https://supabase.com/dashboard/project/${projectRef()}/reports/database`, target: '_blank', rel: 'noopener noreferrer' }, '↗ 프로젝트 리포트') : null,
            el('button', { type: 'button', class: 'nm-btn', onclick: () => openEdit(m) }, '✎ 값/한도 입력'),
          ]));
          void c;
          body.append(el('div', { class: 'stack' }, kids));
        },
      });
    }
    function dayChart(month, last14) {
      const map = new Map(last14.byDay);
      const days = []; const now = new Date();
      for (let i = 13; i >= 0; i--) { const d = new Date(now); d.setDate(d.getDate() - i); days.push(U().dayKey(d)); }
      const max = Math.max(1, ...days.map((d) => map.get(d) || 0));
      return el('div', { class: 'usage-days' }, days.map((d) => el('div', { class: 'usage-day', title: `${d}: ${U().fmtValue(map.get(d) || 0, 'bytes')}` }, [el('div', { class: 'usage-day__bar', style: `height:${Math.max(2, ((map.get(d) || 0) / max) * 64)}px` }), el('div', { class: 'usage-day__l' }, d.slice(8))])));
    }

    // ---- 직접 입력 ----
    function openEdit(m) {
      window.openModal({
        title: `${m.icon} ${m.label} — 직접 입력`,
        contentBuilder(body, close) {
          const man = U().getManual();
          const cur = man.values[m.id];
          const lim = Object.prototype.hasOwnProperty.call(man.limits, m.id) ? man.limits[m.id] : m.limit;
          const fmtIn = (v) => (v === null || v === undefined ? '' : m.unit === 'bytes' ? U().fmtValue(v, 'bytes').replace(' ', '') : String(v));
          const valIn = el('input', { class: 'nm-input', id: 'usage-val', placeholder: m.unit === 'bytes' ? '예: 1.2GB, 350MB' : '숫자', value: cur ? fmtIn(cur.value) : '' });
          const limIn = el('input', { class: 'nm-input', id: 'usage-lim', placeholder: m.unit === 'bytes' ? '예: 5GB' : '숫자', value: fmtIn(lim) });
          const parse = (t) => (String(t).trim() === '' ? null : m.unit === 'bytes' ? U().parseBytes(t, m.id === 'logIngestion' || m.id === 'logQuery' ? 'GB' : 'MB') : (Number.isFinite(Number(String(t).replace(/,/g, ''))) ? Number(String(t).replace(/,/g, '')) : NaN));
          const save = el('button', { type: 'button', class: 'nm-btn nm-btn--primary', id: 'usage-save', style: 'width:100%' }, '저장');
          save.addEventListener('click', () => {
            const v = parse(valIn.value); const l = parse(limIn.value);
            if (Number.isNaN(v) || v === undefined || (valIn.value.trim() && v === null)) { toast('현재 사용량을 읽을 수 없어요. 예: 1.2GB', 'error'); return; }
            if (limIn.value.trim() && (l === null || Number.isNaN(l))) { toast('한도를 읽을 수 없어요. 예: 5GB', 'error'); return; }
            const next = U().getManual();
            if (valIn.value.trim()) next.values[m.id] = { value: v, at: new Date().toISOString().slice(0, 10) }; else delete next.values[m.id];
            if (limIn.value.trim()) next.limits[m.id] = l; else delete next.limits[m.id];
            U().setManual(next); close(); toast('저장했어요.', 'success'); draw();
          });
          body.append(el('div', { class: 'stack' }, [
            el('div', { class: 'text-muted', style: 'font-size:12px' }, `${m.hint}. Supabase 대시보드 Usage 화면의 값을 그대로 적으면 이 값이 우선 표시돼요. 비워서 저장하면 자동/추정 값으로 돌아가요.`),
            el('div', { class: 'nm-field' }, [el('label', {}, '현재 사용량'), valIn]),
            el('div', { class: 'nm-field' }, [el('label', {}, `한도 (기본: ${m.limit ? U().fmtValue(m.limit, m.unit) : '없음'})`), limIn]),
            save,
          ]));
        },
      });
    }

    function draw() {
      wrap.innerHTML = '';
      wrap.append(el('div', { class: 'page-header row row--between wrap', style: 'gap:8px' }, [
        el('h1', {}, '📈 사용량 (Supabase 무료 한도)'),
        el('div', { class: 'row wrap', style: 'gap:6px' }, [
          el('button', { type: 'button', class: 'nm-btn', id: 'usage-refresh', onclick: load }, '↻ 새로고침'),
          el('a', { class: 'nm-btn', href: ORG_USAGE_URL, target: '_blank', rel: 'noopener noreferrer' }, '↗ Supabase Usage'),
        ]),
      ]));
      if (!supa) wrap.append(el('div', { class: 'nm-card usage-note' }, '로컬 모드에서는 Supabase 사용량이 없어요. 아래는 이 브라우저 저장소(localStorage) 사용량이에요.'));
      if (loading) wrap.append(el('div', { class: 'text-muted' }, '서버 통계를 불러오는 중…'));
      if (error) wrap.append(el('div', { class: 'nm-card usage-note usage-note--err', id: 'usage-error' }, `⚠️ ${error}`));
      if (!supa) { wrap.append(localCard()); return; }
      const hot = U().METRICS.map((m) => ({ m, c: current(m) })).filter(({ m, c }) => c.value !== null && c.limit && (c.value / c.limit) * 100 >= 70);
      if (hot.length) wrap.append(el('div', { class: 'nm-card usage-note usage-note--warn', id: 'usage-hot' }, `⚠️ 한도의 70%를 넘은 항목: ${hot.map(({ m, c }) => `${m.label} ${Math.round((c.value / c.limit) * 100)}%`).join(' · ')}`));
      const grid = el('div', { class: 'usage-grid' }, U().METRICS.map(card));
      wrap.append(grid);
      wrap.append(el('div', { class: 'text-muted usage-foot' }, [
        '무료 한도는 Supabase 공식 Billing 문서(Free: DB 500MB · Storage 1GB · Egress 5GB · MAU 50,000 · Edge Function 500,000회 · Realtime 메시지 200만/동시 200)를 따랐어요. ',
        '로그 수집/조회는 공개된 무료 한도를 확인하지 못해 비워 뒀어요(✎로 한도·값 입력). 이그레스는 이 브라우저 추정치이고, 청구 주기는 달력 기준 월로 계산해요.',
        stats ? ` · 서버 통계 ${new Date(stats.generated_at).toLocaleString('ko-KR')}` : '',
      ]));
    }
    function localCard() {
      let total = 0; const rows = [];
      try { for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); const b = (k.length + (localStorage.getItem(k) || '').length) * 2; total += b; rows.push([k.replace(/^workspace:/, ''), b]); } } catch { /* 무시 */ }
      return el('div', { class: 'nm-card' }, [el('div', {}, [el('b', {}, U().fmtValue(total, 'bytes')), el('span', { class: 'text-muted' }, ' / 약 5 MB (브라우저 한도)')]), barRows(rows, total, 'bytes', 12)]);
    }
    draw();
    load();
    return () => {};
  }
  window.renderUsage = renderUsage;
})();
