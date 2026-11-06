// v7.33.1 공시 분석 도구 — korean-dart-mcp의 주요 기능을 OpenDART로 재구현해 앱 안에서 쓴다.
//  ① 종목 분석: 이름/코드 검색(보유 외 종목 포함) → 내부자 매매 · 공시 리스크 · 사업보고서 섹션 · 시세 상세
//  ② 공시 스크리닝: 최근 N일 자기주식 취득/유상증자/CB/합병 등 시장 전체 공시
//  ③ 재무 비교: 최대 5종목 5개 지표 순위
// 정직한 한계: AI 요약은 하지 않는다(원문 발췌만). 리스크 점수는 "공시 제목 패턴" 규칙이며 회계감사 결과가 아니다.
(function () {
  const { el, openModal } = window;
  const D = () => window.DartService;
  const fmtN = (v) => (v === null || v === undefined || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('ko-KR'));
  const pct = (v, d = 1) => (v === null || v === undefined || Number.isNaN(v) ? '—' : `${v.toFixed(d)}%`);
  const dt8 = (d) => (String(d).length === 8 ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : d);
  const note = (t) => el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:6px' }, t);
  const busy = (host, msg) => host.replaceChildren(el('div', { class: 'text-muted', style: 'font-size:13px; padding:10px 0' }, msg || '불러오는 중… (처음 한 번은 DART 종목표를 받느라 30초쯤 걸릴 수 있어요)'));
  const fail = (host, e) => host.replaceChildren(el('div', { class: 'nm-banner nm-banner--warning' }, `불러오지 못했습니다: ${(e && e.message) || e}`));
  const badge = (text, tone) => el('span', { class: `nm-badge nm-badge--${tone || 'info'}`, style: 'margin-left:6px' }, text);
  const link = (rcept, text) => el('a', { href: D().filingUrl(rcept), target: '_blank', rel: 'noopener' }, text);

  function holdingsKrx() { return (window.appState.stockHoldings || []).filter((h) => !h.deleted_at && D().isKrx(h)); }

  // ── ① 종목 분석 ──
  function tabAnalyze(host, pre) {
    let picked = pre || null; let timer = null;
    const input = el('input', { class: 'nm-input', placeholder: '종목명 또는 6자리 코드 (예: 삼성전자, 005930)', style: 'flex:1; min-width:200px' });
    const list = el('div', { style: 'margin:6px 0' }); const panel = el('div', {}); const out = el('div', {});
    const mine = holdingsKrx().map((h) => ({ stock_code: h.symbol, corp_name: h.name || h.symbol, mine: true }));
    function showList(items, title) {
      list.replaceChildren(...(title ? [el('div', { class: 'text-muted', style: 'font-size:11px' }, title)] : []),
        el('div', { class: 'row', style: 'flex-wrap:wrap; gap:6px; margin-top:4px' }, items.map((it) => el('button', { class: `nm-btn ${picked && picked.stock_code === it.stock_code ? 'nm-btn--primary' : ''}`, style: 'padding:3px 10px; font-size:12px', onclick: () => pick(it) }, `${it.mine ? '⭐ ' : ''}${it.corp_name} ${it.stock_code}`))));
    }
    async function search(q) {
      q = q.trim(); if (!q) { showList(mine, mine.length ? '내 보유 종목' : ''); return; }
      busy(list, '검색 중…');
      try { const r = await D().searchCorp(q); if (!r.results.length) { list.replaceChildren(el('div', { class: 'text-muted', style: 'font-size:12px' }, '검색 결과가 없습니다(상장사만 검색됩니다).')); return; } showList(r.results, `검색 결과 ${r.total}건${r.total > 20 ? ' (상위 20)' : ''}`); }
      catch (e) { fail(list, e); }
    }
    function pick(it) {
      picked = it; showList([it]);
      const run = (fn) => async () => { busy(out); try { await fn(out, it); } catch (e) { fail(out, e); } };
      panel.replaceChildren(el('div', { class: 'row', style: 'flex-wrap:wrap; gap:6px; margin:8px 0' }, [
        el('button', { class: 'nm-btn', onclick: () => window.openStockQuote && window.openStockQuote({ symbol: it.stock_code, market: 'KRX', name: it.corp_name, quantity: 0, avg_price: 0, currency: 'KRW', _lookup: true }) }, '📈 시세·차트'),
        el('button', { class: 'nm-btn', onclick: run(viewInsider) }, '🧑‍💼 내부자 매매'),
        el('button', { class: 'nm-btn', onclick: run(viewAnomaly) }, '🕵️ 공시 리스크'),
        el('button', { class: 'nm-btn', onclick: run(viewReport) }, '📘 사업보고서'),
        el('button', { class: 'nm-btn', onclick: run(viewRecent) }, '📑 최근 공시'),
      ]), note(`${it.corp_name}(${it.stock_code}) 선택됨 — 보유 종목이 아니어도 조회할 수 있습니다.`));
      out.replaceChildren();
    }
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => search(input.value), 350); });
    host.replaceChildren(el('div', { class: 'row', style: 'gap:6px' }, [input]), list, panel, out);
    showList(mine, mine.length ? '내 보유 종목' : ''); if (picked) pick(picked);
  }

  async function viewInsider(out, it) {
    const r = await D().insider(it.stock_code, 365);
    if (r.error) throw new Error(r.error);
    const tone = /buy/.test(r.verdict) ? 'success' : /sell/.test(r.verdict) ? 'danger' : 'info';
    out.replaceChildren(
      el('div', {}, [el('strong', {}, `${it.corp_name} 임원·주요주주 최근 1년`), badge(r.label, tone)]),
      el('div', { style: 'margin:6px 0; font-size:13px' }, `매수 보고 ${r.buy}건(+${fmtN(r.buyShares)}주) vs 매도 보고 ${r.sell}건(-${fmtN(r.sellShares)}주)`),
      ...(r.recent.length ? r.recent.map((x) => el('div', { class: 'row row--between', style: 'font-size:12px; padding:2px 0' }, [el('span', {}, `${dt8(x.date)} ${x.who || ''}${x.position ? `(${x.position})` : ''}`), el('b', { class: x.delta > 0 ? 'stock-pnl--up' : 'stock-pnl--down' }, `${x.delta > 0 ? '+' : ''}${fmtN(x.delta)}주`)])) : [el('div', { class: 'text-muted', style: 'font-size:12px' }, '최근 1년 변동 보고가 없습니다.')]),
      note('임원·주요주주 소유상황보고서의 증감 수량을 건수 기준으로 집계했습니다. 주식 보상·상속·증여 등도 섞일 수 있어 "신호"로만 참고하세요(투자 권유 아님).'));
  }
  async function viewAnomaly(out, it) {
    const r = await D().anomaly(it.stock_code);
    if (r.error) throw new Error(r.error);
    const tone = { clean: 'success', watch: 'info', warning: 'warning', red_flag: 'danger' }[r.verdict];
    out.replaceChildren(
      el('div', {}, [el('strong', {}, `${it.corp_name} 공시 리스크(최근 3년, 공시 ${r.total}건)`), badge(`${r.score}점 · ${r.label}`, tone)]),
      ...r.flags.map((f) => el('div', { class: 'row row--between', style: 'font-size:12px; padding:2px 0' }, [el('span', {}, f.label), el('span', {}, `${f.value}${f.pts ? ` · +${f.pts}점` : ''}`)])),
      note('공시 제목 패턴(정정 비율, 감사·불성실공시·관리종목·증자·소송)으로 계산한 점수입니다. 실제 회계감사 결과나 부정 여부를 뜻하지 않으며, 공시가 적은 기업은 점수가 부정확할 수 있습니다.'));
  }
  async function viewReport(out, it) {
    const box = el('div', {}); const body = el('div', {});
    const run = async (kw) => { busy(body, '사업보고서를 받는 중… (파일이 커서 10~40초 걸릴 수 있어요)'); try { const r = await D().report(it.stock_code, kw); if (r.error) throw new Error(r.error);
      body.replaceChildren(el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:6px' }, [`${r.title || '사업보고서'} · ${fmtN(r.chars)}자 · `, link(r.rcept_no, 'DART 원문')]),
        ...(r.sections.length ? r.sections.map((s) => el('details', { open: true, style: 'margin-bottom:8px' }, [el('summary', { style: 'cursor:pointer; font-weight:600; font-size:13px' }, s.title), el('div', { style: 'white-space:pre-wrap; font-size:12px; max-height:260px; overflow:auto; padding:6px 0' }, s.text + (s.truncated ? '\n…(이하 생략, 원문에서 확인)' : ''))])) : [el('div', { class: 'text-muted', style: 'font-size:12px' }, '일치하는 섹션이 없습니다. 아래 목차를 보고 다른 키워드를 넣어 보세요.')]),
        el('details', {}, [el('summary', { style: 'cursor:pointer; font-size:12px' }, `목차 (${r.outline.length})`), el('div', { style: 'font-size:11px; columns:2' }, r.outline.map((t) => el('div', {}, t)))]),
        note('AI 요약이 아니라 원문 발췌입니다. 요약이 필요하면 이 내용을 Claude 채팅에 붙여 넣어 요청하세요.')); } catch (e) { fail(body, e); } };
    const kwInput = el('input', { class: 'nm-input', placeholder: '키워드 (예: 환율, 소송, 원재료)', style: 'flex:1' });
    box.append(el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap; margin-bottom:6px' }, [
      ...['사업', '위험', '재무'].map((k) => el('button', { class: 'nm-btn', onclick: () => run(k) }, { 사업: '주요 사업', 위험: '위험요소', 재무: '재무' }[k])),
      kwInput, el('button', { class: 'nm-btn', onclick: () => kwInput.value.trim() && run(kwInput.value.trim()) }, '검색')]), body);
    out.replaceChildren(box); run('사업');
  }
  async function viewRecent(out, it) {
    const r = await D().fetchDisclosures([{ symbol: it.stock_code, market: 'KRX' }], { days: 90 });
    const x = r[0] || {}; if (x.error) throw new Error(x.error);
    out.replaceChildren(el('strong', {}, `${it.corp_name} 최근 90일 공시`), ...((x.items || []).length ? x.items.map((i) => el('div', { style: 'font-size:12px; padding:2px 0' }, [el('span', { class: 'text-muted' }, `${dt8(i.date)} `), link(i.rcept_no, i.title)])) : [el('div', { class: 'text-muted', style: 'font-size:12px' }, '공시가 없습니다.')]));
  }

  // ── ② 스크리닝 ──
  function tabScreen(host) {
    const out = el('div', {}); let days = 30; const mineSet = new Set(holdingsKrx().map((h) => h.symbol));
    const daySel = el('select', { class: 'nm-input', style: 'width:auto' }, [7, 14, 30, 60, 90].map((d) => el('option', { value: d, selected: d === 30 || undefined }, `최근 ${d}일`)));
    daySel.addEventListener('change', () => { days = Number(daySel.value); });
    const run = async (name) => {
      busy(out, '시장 전체 공시를 훑는 중… (10~30초)');
      try {
        const r = await D().preset(name, days); if (r.error) throw new Error(r.error);
        out.replaceChildren(
          el('div', {}, [el('strong', {}, `${r.label} · 최근 ${r.days}일`), badge(`${r.items.length}건`, 'info')]),
          r.hint ? note(r.hint) : null,
          ...(r.items.length ? r.items.slice(0, 80).map((i) => el('div', { class: 'row row--between', style: `font-size:12px; padding:3px 0; ${mineSet.has(i.stock_code) ? 'background:var(--bg-hover,rgba(80,120,255,.08));' : ''}` }, [
            el('span', {}, [el('span', { class: 'text-muted' }, `${dt8(i.date)} `), el('b', {}, `${mineSet.has(i.stock_code) ? '⭐ ' : ''}${i.corp_name}`), ' ', link(i.rcept_no, i.title)]),
            el('button', { class: 'nm-btn nm-btn--icon', title: '이 종목 분석', onclick: () => window.openDartTools({ stock_code: i.stock_code, corp_name: i.corp_name }) }, '🧭')])) : [el('div', { class: 'text-muted', style: 'font-size:12px; padding:8px 0' }, '해당 공시가 없습니다.')]),
          note(`공시 ${fmtN(r.scanned)}건을 확인했습니다${r.truncated ? '(일부만 — 기간을 줄여 보세요)' : ''}. ⭐는 내 보유 종목입니다. 출처: 금융감독원 전자공시.`));
      } catch (e) { fail(out, e); }
    };
    host.replaceChildren(el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap; align-items:center' }, [daySel, ...D().PRESET_LIST.map(([k, l]) => el('button', { class: 'nm-btn', style: 'padding:3px 10px; font-size:12px', onclick: () => run(k) }, l))]), out);
  }

  // ── ③ 재무 비교 ──
  function tabCompare(host) {
    const sel = new Map(); const chips = el('div', { class: 'row', style: 'flex-wrap:wrap; gap:6px; margin:6px 0' }); const out = el('div', {});
    const input = el('input', { class: 'nm-input', placeholder: '추가할 종목 검색 (최대 5개)', style: 'flex:1' }); const cand = el('div', { style: 'margin:4px 0' }); let timer = null;
    const drawChips = () => chips.replaceChildren(...[...sel.values()].map((s) => el('button', { class: 'nm-btn nm-btn--primary', style: 'padding:3px 10px; font-size:12px', title: '눌러서 제거', onclick: () => { sel.delete(s.stock_code); drawChips(); } }, `${s.corp_name} ✕`)));
    const add = (s) => { if (sel.size >= 5) return; sel.set(s.stock_code, s); drawChips(); };
    holdingsKrx().slice(0, 4).forEach((h) => add({ stock_code: h.symbol, corp_name: h.name || h.symbol }));
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(async () => { const q = input.value.trim(); if (!q) { cand.replaceChildren(); return; } try { const r = await D().searchCorp(q); cand.replaceChildren(el('div', { class: 'row', style: 'flex-wrap:wrap; gap:6px' }, r.results.slice(0, 8).map((s) => el('button', { class: 'nm-btn', style: 'padding:3px 10px; font-size:12px', onclick: () => add(s) }, `+ ${s.corp_name}`)))); } catch (e) { fail(cand, e); } }, 350); });
    const go = async () => {
      if (!sel.size) return; busy(out, '재무제표를 비교하는 중…');
      try {
        const r = (await D().quality([...sel.keys()])).results;
        const rows = [['평균 ROE', (m) => pct(m.avgRoe), 'avgRoe'], ['부채비율', (m) => pct(m.debtRatio, 0), 'debtRatio'], ['영업이익률', (m) => pct(m.opm), 'opm'], ['매출 성장(CAGR)', (m) => pct(m.cagr), 'cagr'], ['흑자 연수', (m) => `${m.profitYears}/${m.n}`, 'profitYears']];
        const ok = r.filter((x) => x.metrics);
        const th = (t) => el('th', { style: 'text-align:right; padding:4px 6px; font-size:12px' }, t);
        const table = el('table', { style: 'width:100%; border-collapse:collapse; font-size:12px' }, [
          el('tr', {}, [el('th', { style: 'text-align:left; padding:4px 6px' }, '지표'), ...ok.map((x) => th(x.corp_name))]),
          ...rows.map(([l, f, k], i) => el('tr', { style: 'border-top:1px solid var(--border)' }, [el('td', { style: 'padding:4px 6px' }, l), ...ok.map((x) => el('td', { style: 'text-align:right; padding:4px 6px' }, [f(x.metrics), el('span', { class: 'text-muted' }, ` (${x.ranks[k]}위)${x.checks[i] ? ' ✓' : ''}`)]))])),
          el('tr', { style: 'border-top:2px solid var(--border); font-weight:700' }, [el('td', { style: 'padding:4px 6px' }, '기준 통과'), ...ok.map((x) => el('td', { style: 'text-align:right; padding:4px 6px' }, `${x.passed}/5`))]),
        ]);
        out.replaceChildren(el('div', { style: 'overflow:auto' }, [table]), el('div', { style: 'margin-top:6px; font-size:13px' }, ok.length ? `종합 1위(지표 순위 합 기준): ${ok[0].corp_name}` : ''),
          ...r.filter((x) => x.error).map((x) => el('div', { class: 'text-muted', style: 'font-size:12px' }, `${x.corp_name || x.stock_code}: ${x.error}`)),
          note('최근 결산 5개년 연결재무 기준. ✓ 기준: ROE 평균 10%↑, 부채비율 100%↓, 영업이익률 10%↑, 매출 CAGR 5%↑, 전 기간 흑자. 업종이 다르면 비교가 왜곡될 수 있으며 투자 권유가 아닙니다.'));
      } catch (e) { fail(out, e); }
    };
    drawChips();
    host.replaceChildren(el('div', { class: 'text-muted', style: 'font-size:12px' }, '비교할 종목(최대 5) — 내 보유 종목이 먼저 채워집니다.'), chips, el('div', { class: 'row', style: 'gap:6px' }, [input, el('button', { class: 'nm-btn nm-btn--primary', onclick: go }, '비교')]), cand, out);
  }

  window.openDartTools = function (pre) {
    if (!D().hasDartKey()) { window.toast && window.toast('설정 → 증권 시세 API에서 OpenDART 키를 먼저 등록하세요.', 'error'); return; }
    return openModal({
      title: '🧭 공시 분석 · 종목 검색', width: '720px',
      contentBuilder(body) {
        const pane = el('div', {}); const tabs = el('div', { class: 'period-tabs', style: 'margin-bottom:8px' });
        const defs = [['종목 분석', () => tabAnalyze(pane, pre)], ['공시 스크리닝', () => tabScreen(pane)], ['재무 비교', () => tabCompare(pane)]];
        const show = (i) => { [...tabs.children].forEach((b, k) => b.setAttribute('aria-pressed', k === i ? 'true' : 'false')); defs[i][1](); };
        defs.forEach(([l], i) => tabs.append(el('button', { type: 'button', class: 'nm-btn', 'aria-pressed': 'false', onclick: () => show(i) }, l)));
        body.append(tabs, pane); show(0);
      },
    });
  };
})();
