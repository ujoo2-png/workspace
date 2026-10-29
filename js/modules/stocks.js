// 증권(Stocks) 화면 (v7.24.0). 보유 계좌와 주식을 관리하고 실시간 시세로 손익을 평가한다.
//   · 계좌: 증권사·계좌번호·통화(국내/해외)
//   · 보유 종목: 종목코드·수량·평균단가 (매수/매도 기록으로 자동 계산도 가능)
//   · 시세: 한국투자증권(KIS) API — 설정에서 앱키/시크릿을 등록해야 실시간 평가가 켜진다.
//     미등록이면 "평가금액/손익"은 비워 두고 보유 정보만 보여준다(수동 관리 모드).
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;
  const { evaluatePortfolio, evaluateHolding, formatPnl, formatPnlRate, pnlClass, recomputeFromTrades, priceAlerts, evaluateRealized, sumDividends } = window.StockCalc;

  const MARKET_LABEL = { KRX: '국내', US: '해외' };

  function renderStocks(root) {
    const container = el('div', {});
    root.append(container);
    // 시세는 화면에 들어올 때 한 번 받아 메모리에 둔다(수동 새로고침 전까지 유지).
    let prices = {};
    let quotes = {};          // v7.31.0: 전일대비 등 상세 시세 { 'KRX:005930': {price, change, changeRate, ...} }
    let pricesLoaded = false;
    let loadingPrices = false;
    let lastUpdated = null;   // 마지막 시세 갱신 시각
    let lastError = '';
    const AUTO_KEY = 'workspace:stocks:autoRefresh';
    const autoOn = () => { try { return localStorage.getItem(AUTO_KEY) === '1'; } catch { return false; } };
    let timer = null;
    // 장중(평일 09:00~15:40 KST)에만 자동 갱신 — 장 마감 후 불필요한 호출을 하지 않는다.
    const marketOpenNow = (d = new Date()) => {
      const k = new Date(d.getTime() + (d.getTimezoneOffset() + 540) * 60000);
      const day = k.getDay(), m = k.getHours() * 60 + k.getMinutes();
      return day >= 1 && day <= 5 && m >= 540 && m <= 940;
    };
    function schedule() {
      clearInterval(timer); timer = null;
      if (!autoOn()) return;
      timer = setInterval(() => {
        if (!container.isConnected) { clearInterval(timer); timer = null; return; }
        if (document.hidden || !marketOpenNow()) return;
        loadPrices(true);
      }, 60000);
    }

    const tried = new Set();
    function loadMissing() {
      if (loadingPrices || !window.hasQuoteProvider()) return;
      const k = (h) => `${h.market || 'KRX'}:${h.symbol}`;
      const fresh = appState.stockHoldings.filter((h) => !h.deleted_at && h.symbol && !tried.has(k(h)) && !(k(h) in prices));
      if (fresh.length) { fresh.forEach((h) => tried.add(k(h))); loadPrices(false); }
    }

    async function loadPrices(force = false) {
      if (loadingPrices) return;
      const holdings = appState.stockHoldings.filter((h) => !h.deleted_at);
      if (!holdings.length) { prices = {}; pricesLoaded = true; return; }
      if (!window.hasQuoteProvider()) { prices = {}; pricesLoaded = true; return; }
      loadingPrices = true;
      lastError = '';
      draw();
      try {
        const { prices: p, quotes: q, errors } = await window.fetchPrices(holdings, { force });
        prices = p;
        quotes = q || {};
        if (Object.keys(p).length) lastUpdated = new Date();
        lastError = errors.length ? errors[0].message : '';
        if (errors.length && errors[0].symbol !== '*') {
          toast(`일부 종목 시세를 받지 못했습니다: ${errors.slice(0, 2).map((e) => e.symbol).join(', ')}${errors.length > 2 ? ' 외' : ''}`, 'error');
        }
      } catch (e) {
        toast(`시세 조회 실패: ${e.message || e}`, 'error');
      } finally {
        loadingPrices = false;
        pricesLoaded = true;
        draw();
        loadMissing(); // 조회 중에 새로 등록된 종목이 있으면 이어서 조회
      }
    }

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '증권'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn', title: '시세 새로고침', disabled: loadingPrices || undefined, onclick: () => loadPrices(true) }, loadingPrices ? '⏳ 조회 중…' : '🔄 시세 새로고침'),
            el('button', { class: 'nm-btn', onclick: () => openAccountForm() }, '+ 계좌 등록'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openHoldingForm() }, '+ 종목 등록'),
          ]),
        ])
      );

      container.append(el('div', { class: 'stock-toolbar' }, [
        el('span', { class: 'stock-chip', title: '설정 → 증권 시세 API에서 바꿀 수 있습니다' }, `시세: ${window.stockProviderLabel()}`),
        lastUpdated
          ? el('span', { class: 'stock-chip stock-chip--ok' }, `갱신 ${lastUpdated.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`)
          : null,
        lastError && !loadingPrices ? el('span', { class: 'stock-chip stock-chip--warn', title: lastError }, '일부 시세 실패') : null,
        el('label', { style: 'display:inline-flex; gap:4px; align-items:center; cursor:pointer' }, [
          el('input', { type: 'checkbox', checked: autoOn() || undefined, onchange: (e) => { try { localStorage.setItem(AUTO_KEY, e.target.checked ? '1' : '0'); } catch { /* 무시 */ } schedule(); draw(); } }),
          '장중 1분 자동 갱신',
        ]),
        autoOn() && !marketOpenNow() ? el('span', {}, '(지금은 장외 시간이라 대기)') : null,
        el('span', {}, '종목을 클릭하면 시세·차트를 볼 수 있습니다.'),
      ]));

      if (!window.hasQuoteProvider()) {
        const label = window.stockProviderLabel ? window.stockProviderLabel() : '증권 API';
        container.append(el('div', { class: 'nm-banner nm-banner--warning' }, [
          el('span', {}, `실시간 시세를 쓰려면 ${label} 설정을 등록하세요(설정 → 증권 시세 API). 지금은 보유 정보만 관리됩니다. `),
          el('a', { href: '#/settings' }, '설정으로 이동'),
        ]));
      }

      const holdings = appState.stockHoldings.filter((h) => !h.deleted_at);
      const accounts = appState.brokerageAccounts.filter((a) => !a.deleted_at);

      // v7.26.0 카드 순서: ① 오늘의 시황·환율 → ② 총자산 카드 → ③ 증권사별 보유 현황
      container.append(buildMarketCard());

      if (!holdings.length && !accounts.length) {
        container.append(el('div', { class: 'empty-state' }, '등록된 계좌나 보유 종목이 없습니다. "+ 계좌 등록"으로 시작하세요.'));
        return;
      }

      // ② 총자산 카드 — 총 평가금액(총자산)을 크게 강조하고, 기존 지표(매입금액·평가손익·수익률·실현손익·배당)는 유지한다.
      const total = evaluatePortfolio(holdings, prices);
      const allTrades = appState.stockTrades || [];
      const realized = evaluateRealized(allTrades);
      const divSum = sumDividends(appState.stockDividends || []);
      const divTotal = divSum.byCurrency.KRW || 0;
      container.append(buildAssetCard(total, { allTrades, realized, divSum, divTotal }));
      if (total.evaluatedCount < total.count) {
        container.append(el('div', { class: 'text-muted', style: 'font-size:12px; margin:-4px 0 10px' }, `※ ${total.count - total.evaluatedCount}개 종목은 시세가 없어 평가에서 제외했습니다.`));
      }

      // v7.24.0(아이디어 3): 목표가/손절가에 도달한 종목을 맨 위에 배지로 강조한다.
      const alerts = priceAlerts(holdings, prices);
      if (alerts.length) {
        const banner = el('div', { class: 'nm-banner nm-banner--warning', style: 'margin-bottom:10px; align-items:flex-start' }, [
          el('div', {}, [
            el('strong', {}, `📣 도달 알림 ${alerts.length}건`),
            el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:2px' },
              alerts.map((a) => `${a.name} ${a.kind === 'target' ? '목표가' : '손절가'} ${formatMoney(a.threshold)} 도달(현재 ${formatMoney(a.price)})`).join(' · ')),
          ]),
        ]);
        container.append(banner);
      }

      // ③ 증권사별 보유 현황.
      container.append(el('div', { class: 'section-title', style: 'margin:2px 0 4px' }, '증권사별 보유 현황'));
      const stack = el('div', { class: 'stack' });
      const noAccount = holdings.filter((h) => !h.account_id);
      if (noAccount.length) stack.append(accountSection(null, noAccount));
      for (const acc of window.Reorder.sort('stock-accounts', accounts)) {
        const list = appState.stockHoldings.filter((h) => !h.deleted_at && h.account_id === acc.id);
        stack.append(accountSection(acc, list));
      }
      if (!stack.childElementCount) {
        stack.append(el('div', { class: 'nm-card text-muted', style: 'font-size:13px' }, '표시할 보유 종목이 없습니다.'));
      }
      container.append(stack);
      window.Reorder.enable(stack, 'stock-accounts'); // v7.31.0: 증권사 카드를 끌어 순서 변경
    }

    // ② 총자산 카드(v7.26.0) — 총 평가금액을 크게 강조 + 기존 지표 유지.
    function buildAssetCard(total, { allTrades, realized, divSum, divTotal }) {
      const hasEval = total.totalValue !== null;
      const evalCls = pnlClass(total.totalPnl);
      const head = el('div', { class: 'asset-card__head' }, [
        el('div', { class: 'asset-card__main' }, [
          el('div', { class: 'asset-card__label' }, '총자산(평가금액)'),
          el('div', { class: `asset-card__value ${hasEval ? 'stock-pnl--' + evalCls : ''}` }, hasEval ? formatMoney(total.totalValue) : '—'),
          el('div', { class: 'asset-card__sub' }, [
            el('span', { class: 'text-muted' }, '매입금액 '),
            el('span', {}, formatMoney(total.totalCost)),
            hasEval ? el('span', { class: 'text-muted', style: 'margin-left:10px' }, '평가손익 ') : null,
            hasEval ? el('span', { class: `stock-pnl stock-pnl--${evalCls}` }, `${formatPnl(total.totalPnl)} (${formatPnlRate(total.totalPnlRate)})`) : null,
          ]),
        ]),
      ]);
      const grid = el('div', { class: 'stock-summary', style: 'margin:12px 0 0' }, [
        summaryTile('총 매입금액', formatMoney(total.totalCost), ''),
        summaryTile('평가손익', hasEval ? formatPnl(total.totalPnl) : '—', hasEval ? evalCls : ''),
        summaryTile('수익률', hasEval ? formatPnlRate(total.totalPnlRate) : '—', hasEval ? evalCls : ''),
        summaryTile('실현손익', allTrades.length ? formatPnl(realized.realizedPnl) : '—', allTrades.length ? pnlClass(realized.realizedPnl) : ''),
        summaryTile('누적 수수료', formatMoney(realized.totalFee), ''),
        summaryTile('배당 합계', divSum.count ? formatMoney(divTotal) : '—', divSum.count ? 'gain' : ''),
        summaryTile('총 수익(실현+배당)', formatPnl(realized.realizedPnl + divTotal), pnlClass(realized.realizedPnl + divTotal)),
      ]);
      return el('div', { class: 'nm-card asset-card' }, [head, grid]);
    }

    // v7.31.0: 오늘의 시황(지수) + 환율 카드(기간별 차트). 값이 없으면 지어내지 않고 이유를 안내한다.
    let marketData = null;      // { indices:[], fx:{majors,rest}, rows:[] }
    let marketLoading = false;
    let marketTried = false;
    let fxCode = 'USD';
    let fxPeriod = '1m';
    const fxSeriesCache = {};   // `${code}:${period}` → rows
    function buildMarketCard() {
      const card = el('div', { class: 'nm-card market-card' });
      const body = el('div', { class: 'market-card__body' });
      const head = el('div', { class: 'row row--between', style: 'align-items:center' }, [
        el('strong', { style: 'font-size:14px' }, '📈 오늘의 시황 · 환율'),
        el('button', { class: 'nm-btn nm-btn--icon', title: '새로고침', disabled: marketLoading || undefined, onclick: () => loadMarket(true) }, marketLoading ? '⏳' : '🔄'),
      ]);
      card.append(head, body);
      const chartHost = el('div', {});
      function paintChart() {
        chartHost.replaceChildren(el('div', { class: 'text-muted', style: 'font-size:12px; padding:10px' }, '차트를 불러오는 중…'));
        const key = `${fxCode}:${fxPeriod}`;
        const done = (rows) => {
          const st = window.PriceChart.stats(rows);
          const cur = window.FxService.CURRENCIES.find((c) => c.code === fxCode);
          const f = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 });
          chartHost.replaceChildren(
            window.PriceChart.render(rows, { fmt: f, height: 200 }),
            el('div', { class: 'chart-stats' }, [
              el('div', {}, ['기간 변화', el('b', { class: `stock-pnl--${pnlClass(st.change)}` }, `${st.change > 0 ? '+' : ''}${f(st.change)} (${st.changeRate > 0 ? '+' : ''}${st.changeRate.toFixed(2)}%)`)]),
              el('div', {}, ['최고', el('b', {}, `${f(st.high.v)} · ${st.high.date.slice(5)}`)]),
              el('div', {}, ['최저', el('b', {}, `${f(st.low.v)} · ${st.low.date.slice(5)}`)]),
              el('div', {}, ['평균', el('b', {}, f(st.avg))]),
            ]),
            el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:6px' }, `${cur ? cur.label : fxCode} → 원(KRW). 출처: 유럽중앙은행(ECB) 참조환율 · 영업일 기준 하루 1회 고시, 은행 매매기준율과 다를 수 있습니다.`)
          );
        };
        if (fxSeriesCache[key]) { done(fxSeriesCache[key]); return; }
        window.FxService.fetchSeries(fxCode, fxPeriod).then((rows) => { fxSeriesCache[key] = rows; if (chartHost.isConnected || true) done(rows); })
          .catch((e) => chartHost.replaceChildren(el('div', { class: 'nm-banner nm-banner--warning' }, `환율 차트를 불러오지 못했습니다: ${e.message}`)));
      }
      function paint() {
        body.replaceChildren();
        if (!marketData) {
          body.append(el('div', { class: 'text-muted', style: 'font-size:12px; padding:6px 2px' }, '시황·환율을 불러오는 중입니다…'));
          return;
        }
        const idx = marketData.indices || [];
        body.append(el('div', { class: 'market-sec' }, [
          el('div', { class: 'market-sec__label' }, '지수'),
          idx.length
            ? el('div', { class: 'market-chips' }, idx.map((r) => el('div', { class: 'market-chip' }, [
                el('span', { class: 'market-chip__name' }, r.label),
                el('strong', { class: 'market-chip__val' }, num(r.value)),
                el('span', { class: `market-chip__chg stock-pnl--${pnlClass(r.changeRate)}` }, r.changeRate === null || r.changeRate === undefined ? '' : `${r.changeRate > 0 ? '▲' : r.changeRate < 0 ? '▼' : ''}${Math.abs(r.changeRate).toFixed(2)}%`),
              ])))
            : el('span', { class: 'text-muted', style: 'font-size:12px' }, marketData.indexNote || '지수 정보를 불러오지 못했습니다.'),
        ]));
        const rows = marketData.rows || [];
        const ecb = rows.length && rows[0].src === 'ecb';
        body.append(el('div', { class: 'market-sec__label' }, [
          '환율',
          el('span', { class: 'text-muted', style: 'font-weight:400; margin-left:6px; text-transform:none' }, ecb ? '출처: ECB 참조환율(Frankfurter)' : '출처: 매매기준율(공공데이터/커스텀)'),
        ]));
        if (!rows.length) {
          body.append(el('div', { class: 'nm-banner nm-banner--warning' }, marketData.fxNote || '환율 정보를 불러오지 못했습니다.'));
          return;
        }
        const tiles = (marketData.fx.majors.length ? marketData.fx.majors : rows).map((r) => {
          const code = String(r.unit).replace(/\(.*\)/, '');
          return el('button', { type: 'button', class: 'fx-tile', 'aria-pressed': code === fxCode ? 'true' : 'false', 'data-fx': code, onclick: () => { fxCode = code; paint(); } }, [
            el('span', { class: 'market-chip__name' }, r.name || r.unit),
            el('span', { class: 'fx-tile__rate' }, num(r.rate)),
            r.changeRate !== null && r.changeRate !== undefined
              ? el('span', { class: `market-chip__chg stock-pnl--${pnlClass(r.changeRate)}` }, `${r.changeRate > 0 ? '▲' : r.changeRate < 0 ? '▼' : ''}${Math.abs(r.changeRate).toFixed(2)}%`)
              : null,
          ]);
        });
        body.append(el('div', { class: 'fx-grid' }, tiles));
        body.append(el('div', { class: 'period-tabs' }, window.FxService.PERIODS.map((pd) =>
          el('button', { type: 'button', class: 'nm-btn', 'aria-pressed': pd.key === fxPeriod ? 'true' : 'false', 'data-period': pd.key, onclick: () => { fxPeriod = pd.key; paint(); } }, pd.label))));
        body.append(chartHost);
        paintChart();
      }
      paint();
      if (!marketTried) { marketTried = true; loadMarket(false); }
      return card;
    }

    async function loadMarket(force) {
      if (marketLoading) return;
      marketLoading = true;
      if (force) { marketData = null; for (const k of Object.keys(fxSeriesCache)) delete fxSeriesCache[k]; draw(); }
      const indices = [];
      let indexNote = '';
      let rows = [];
      let fxNote = '';
      try { indices.push(...await window.fetchIndices()); }
      catch (e) { indexNote = e.message; }
      if (window.getFxEnabled()) {
        try { rows = await window.fetchExchangeRates(); }
        catch (e) { fxNote = e.message; }
      } else { fxNote = '환율 표시가 꺼져 있습니다(설정에서 켤 수 있습니다).'; }
      marketData = { indices, indexNote, rows, fx: window.orderMajorFx(rows), fxNote };
      marketLoading = false;
      draw();
    }

    // v7.31.0: 보유 종목 클릭 → 시세 상세(현재가·전일대비·차트·내 평단/목표/손절선·손익).
    function openQuoteDetail(h) {
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      openModal({
        title: `${h.name || h.symbol} 시세`,
        width: '640px',
        contentBuilder(body) {
          const head = el('div', { class: 'quote-head' }, [el('span', { class: 'text-muted' }, '시세를 불러오는 중…')]);
          const grid = el('div', { class: 'quote-grid' });
          const tabs = el('div', { class: 'period-tabs' });
          const chartHost = el('div', {});
          const foot = el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:8px' });
          body.append(head, grid, tabs, chartHost, foot);
          let chartRows = null;
          let period = 90;
          const PERIODS = [[10, '10일'], [30, '1개월'], [90, '3개월'], [180, '6개월'], [365, '1년']];
          const money = (v) => formatMoney(v, h.currency);

          function paintChart() {
            tabs.replaceChildren(...PERIODS.map(([d, label]) => el('button', { type: 'button', class: 'nm-btn', 'aria-pressed': d === period ? 'true' : 'false', 'data-days': String(d), onclick: () => { period = d; paintChart(); } }, label)));
            if (!chartRows) return;
            const cut = new Date(Date.now() - period * 86400000).toISOString().slice(0, 10);
            const rows = chartRows.filter((r) => r.date >= cut);
            const st = window.PriceChart.stats(rows);
            const refs = [{ value: h.avg_price, label: '평단', cls: 'is-avg' }];
            if (h.target_price) refs.push({ value: Number(h.target_price), label: '목표', cls: 'is-target' });
            if (h.stop_price) refs.push({ value: Number(h.stop_price), label: '손절', cls: 'is-stop' });
            const f = (v) => (h.currency === 'USD' ? Number(v).toFixed(2) : Math.round(v).toLocaleString('ko-KR'));
            chartHost.replaceChildren(window.PriceChart.render(rows, { fmt: f, refLines: refs, height: 240 }));
            if (st) chartHost.append(el('div', { class: 'chart-stats' }, [
              el('div', {}, ['기간 수익률', el('b', { class: `stock-pnl--${pnlClass(st.change)}` }, `${st.changeRate > 0 ? '+' : ''}${st.changeRate.toFixed(2)}%`)]),
              el('div', {}, ['기간 최고', el('b', {}, money(st.high.v))]),
              el('div', {}, ['기간 최저', el('b', {}, money(st.low.v))]),
              el('div', {}, ['평균', el('b', {}, money(st.avg))]),
            ]));
          }
          paintChart();

          function paintQuote(q) {
            const ev = evaluateHolding(h, q.price);
            const cls = pnlClass(q.change ?? q.changeRate ?? 0);
            head.replaceChildren(
              el('span', { class: 'quote-head__price' }, money(q.price)),
              q.change !== null && q.change !== undefined
                ? el('span', { class: `quote-head__chg stock-pnl--${cls}` }, `${q.change > 0 ? '▲' : q.change < 0 ? '▼' : ''}${money(Math.abs(q.change))}${q.changeRate !== null && q.changeRate !== undefined ? ` (${q.changeRate > 0 ? '+' : ''}${q.changeRate.toFixed(2)}%)` : ''}`)
                : null,
              el('span', { class: 'text-muted' }, `${MARKET_LABEL[h.market] || h.market} ${h.symbol}`)
            );
            const cell = (label, value, c) => el('div', {}, [label, el('b', { class: c ? `stock-pnl--${c}` : '' }, value)]);
            grid.replaceChildren(
              cell('내 평단', money(h.avg_price)),
              cell('보유 수량', `${num(h.quantity)}주`),
              cell('평가금액', ev.marketValue === null ? '—' : money(ev.marketValue)),
              cell('평가손익', ev.pnl === null ? '—' : `${formatPnl(ev.pnl)} (${formatPnlRate(ev.pnlRate)})`, ev.pnl === null ? '' : pnlClass(ev.pnl)),
              q.prevClose ? cell('전일 종가', money(q.prevClose)) : null,
              q.high ? cell('고가', money(q.high)) : null,
              q.low ? cell('저가', money(q.low)) : null,
              h.target_price ? cell('목표가', money(h.target_price)) : null,
              h.stop_price ? cell('손절가', money(h.stop_price)) : null
            );
            const code = q.naverCode || h.symbol;
            const url = h.market === 'US' ? `https://m.stock.naver.com/worldstock/stock/${encodeURIComponent(code)}/total` : `https://m.stock.naver.com/domestic/stock/${encodeURIComponent(h.symbol)}/total`;
            foot.replaceChildren(`시세 공급: ${window.stockProviderLabel()} · 조회 전용(주문 기능 없음) · 지연/오차 가능 · `, el('a', { href: url, target: '_blank', rel: 'noopener' }, '네이버 증권에서 보기 ↗'));
          }

          const cached = quotes[key];
          if (cached) paintQuote(cached);
          if (!window.hasQuoteProvider()) { head.replaceChildren(el('span', { class: 'text-muted' }, '시세 공급자가 설정되지 않았습니다(설정 → 증권 시세 API).')); return; }
          window.fetchStockPrice(h.symbol, h.market || 'KRX')
            .then((q) => { quotes[key] = { ...q, at: Date.now() }; prices[key] = q.price; paintQuote(q); })
            .catch((e) => { if (!cached) head.replaceChildren(el('div', { class: 'nm-banner nm-banner--warning' }, `시세를 불러오지 못했습니다: ${e.message}`)); });
          window.fetchDailyChart(h.symbol, { market: h.market || 'KRX', days: 365 })
            .then((r) => { chartRows = r.rows; paintChart(); })
            .catch((e) => chartHost.replaceChildren(el('div', { class: 'text-muted', style: 'font-size:12px; padding:10px' }, `차트를 불러오지 못했습니다: ${e.message}`)));
        },
      });
    }

    // v7.26.0: 계좌별 보유 현황을 "list 형태"로 깔끔하게 개선.
    //   · 헤더: 증권사/별칭 + 요약(평가금액·손익) + 수정/삭제
    //   · 각 종목: 한 줄 리스트(이름·코드·수량·평단·현재가·평가금액·손익) — 좁은 화면에서는 자동 줄바꿈
    function accountSection(acc, holdings) {
      const summary = evaluatePortfolio(holdings, prices);
      const hasEval = summary.totalValue !== null;
      const header = acc
        ? el('div', { class: 'broker-head' }, [
            el('div', { class: 'broker-head__left' }, [
              el('div', { class: 'broker-head__name' }, [
                window.Reorder.grip(),
                el('span', { class: 'broker-head__dot' }),
                `${acc.broker}${acc.nickname ? ' · ' + acc.nickname : ''}`,
              ]),
              el('div', { class: 'broker-head__meta' }, [
                acc.account_no ? maskAccount(acc.account_no) : null,
                el('span', { class: `nm-badge ${acc.currency === 'USD' ? 'nm-badge--info' : ''}` }, acc.currency === 'USD' ? '해외 USD' : '국내 KRW'),
                el('span', { class: 'text-muted' }, `${holdings.length}종목`),
              ]),
            ]),
            el('div', { class: 'broker-head__right' }, [
              hasEval
                ? el('div', { class: 'broker-head__stat' }, [
                    el('div', { class: 'text-muted', style: 'font-size:11px' }, '평가금액'),
                    el('div', { class: 'broker-head__value' }, formatMoney(summary.totalValue)),
                  ])
                : null,
              summary.count
                ? el('div', { class: 'broker-head__stat' }, [
                    el('div', { class: 'text-muted', style: 'font-size:11px' }, '평가손익'),
                    el('div', { class: `broker-head__value stock-pnl--${pnlClass(summary.totalPnl)}` }, hasEval ? `${formatPnl(summary.totalPnl)} (${formatPnlRate(summary.totalPnlRate)})` : '—'),
                  ])
                : null,
              el('div', { class: 'broker-head__actions' }, [
                el('button', { class: 'nm-btn nm-btn--icon', title: '계좌 수정', onclick: () => openAccountForm(acc) }, '✎'),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '계좌 삭제', onclick: () => removeAccount(acc) }, '🗑'),
              ]),
            ]),
          ])
        : el('div', { class: 'broker-head' }, [
            el('div', { class: 'broker-head__left' }, [el('div', { class: 'broker-head__name' }, '계좌 미지정')]),
          ]);

      const listKey = `stockHoldings:${acc ? acc.id : 'none'}`;
      const body = holdings.length
        ? el('div', { class: 'holding-list' }, window.Reorder.sort(listKey, holdings).map(holdingRow))
        : el('div', { class: 'holding-list__empty' }, '보유 종목이 없습니다.');
      if (holdings.length) window.Reorder.enable(body, listKey);

      return el('div', { class: 'nm-card broker-card', ...(acc ? { 'data-rid': acc.id } : {}) }, [header, body]);
    }

    function holdingRow(h) {
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      const ev = evaluateHolding(h, Object.prototype.hasOwnProperty.call(prices, key) ? prices[key] : null);
      const cur = prices[key];
      // v7.24.0(아이디어 3): 이 종목이 목표가/손절가에 도달했으면 이름 옆에 배지로 표시한다.
      const alert = priceAlerts([h], Object.prototype.hasOwnProperty.call(prices, key) ? prices : {})[0];
      const pnlText = ev.pnl === null ? '—' : `${formatPnl(ev.pnl)} (${formatPnlRate(ev.pnlRate)})`;
      const q = quotes[key];
      const day = q && q.changeRate !== null && q.changeRate !== undefined
        ? el('span', { class: `holding-item__day stock-pnl--${pnlClass(q.changeRate)}` }, `오늘 ${q.changeRate > 0 ? '▲' : q.changeRate < 0 ? '▼' : ''}${Math.abs(q.changeRate).toFixed(2)}%`)
        : null;
      const row = el('div', { class: 'holding-item', 'data-rid': h.id, role: 'button', tabindex: '0', title: '클릭하면 시세·차트 상세' }, [
        el('div', { class: 'holding-item__main' }, [
          el('div', { class: 'holding-item__name' }, [
            window.Reorder.grip(),
            `${h.name || h.symbol}`,
            alert ? el('span', { class: `nm-badge ${alert.kind === 'target' ? 'nm-badge--success' : 'nm-badge--critical'}`, style: 'margin-left:6px' }, alert.kind === 'target' ? '🎯 목표가' : '🛑 손절가') : null,
          ]),
          el('div', { class: 'holding-item__sub' }, [
            el('span', { class: 'holding-item__sym' }, `${MARKET_LABEL[h.market] || h.market} ${h.symbol}`),
            el('span', {}, `${num(h.quantity)}주 · 평단 ${formatMoney(h.avg_price, h.currency)}`),
            el('span', {}, `현재가 ${cur === undefined ? '—' : formatMoney(cur, h.currency)}`),
            day,
            h.target_price ? el('span', { class: 'text-muted' }, `목표 ${formatMoney(h.target_price, h.currency)}`) : null,
            h.stop_price ? el('span', { class: 'text-muted' }, `손절 ${formatMoney(h.stop_price, h.currency)}`) : null,
          ]),
        ]),
        el('div', { class: 'holding-item__right' }, [
          el('div', { class: 'holding-item__value' }, ev.marketValue === null ? '—' : formatMoney(ev.marketValue, h.currency)),
          el('div', { class: `holding-item__pnl stock-pnl stock-pnl--${pnlClass(ev.pnl)}` }, pnlText),
        ]),
        el('div', { class: 'holding-item__actions' }, [
          el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openHoldingForm(h) }, '✎'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '매매 기록', onclick: () => openTradeList(h) }, '📄'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '배당 기록', onclick: () => openDividendList(h) }, '💰'),
          el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeHolding(h) }, '🗑'),
        ]),
      ]);
      // 행 클릭 → 시세 상세. 버튼·손잡이 클릭은 제외(손잡이 클릭은 Reorder가 별도로 막는다).
      const open = (e) => { if (e.target.closest('button, a, input, .rd-grip')) return; openQuoteDetail(h); };
      row.addEventListener('click', open);
      row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openQuoteDetail(h); } });
      return row;
    }

    // ---- 계좌 등록/수정 ----
    function openAccountForm(existing) {
      openModal({
        title: existing ? '계좌 수정' : '계좌 등록',
        width: '440px',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('증권사', el('input', { class: 'nm-input', name: 'broker', required: true, placeholder: '예: 한국투자증권', value: existing?.broker || '한국투자증권' })),
            field('계좌번호 (선택)', el('input', { class: 'nm-input', name: 'account_no', placeholder: '예: 12345678-01', value: existing?.account_no || '' })),
            field('별칭 (선택)', el('input', { class: 'nm-input', name: 'nickname', placeholder: '예: 연금저축', value: existing?.nickname || '' })),
            field('통화', (() => {
              const sel = el('select', { class: 'nm-select', name: 'currency' });
              sel.append(el('option', { value: 'KRW', selected: (existing?.currency || 'KRW') === 'KRW' || undefined }, '국내 (KRW 원)'));
              sel.append(el('option', { value: 'USD', selected: existing?.currency === 'USD' || undefined }, '해외 (USD 달러)'));
              return sel;
            })()),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장')
          );
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = { broker: fd.get('broker'), account_no: fd.get('account_no') || null, nickname: fd.get('nickname') || null, currency: fd.get('currency') };
            try {
              if (existing) await appState.updateBrokerageAccount(existing.id, data);
              else await appState.addBrokerageAccount(data);
              toast('저장했습니다.', 'success');
              close();
            } catch (err) { toast(`저장 실패: ${err.message || err}`, 'error'); }
          });
          body.append(form);
        },
      });
    }

    // ---- 종목 등록/수정 ----
    function openHoldingForm(existing) {
      const accounts = appState.brokerageAccounts.filter((a) => !a.deleted_at);
      openModal({
        title: existing ? '종목 수정' : '종목 등록',
        width: '460px',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const marketSel = el('select', { class: 'nm-select', name: 'market' });
          marketSel.append(el('option', { value: 'KRX', selected: (existing?.market || 'KRX') === 'KRX' || undefined }, '국내 (KRX)'));
          marketSel.append(el('option', { value: 'US', selected: existing?.market === 'US' || undefined }, '해외 (US)'));
          const accountSel = el('select', { class: 'nm-select', name: 'account_id' });
          accountSel.append(el('option', { value: '' }, '(계좌 미지정)'));
          for (const a of accounts) accountSel.append(el('option', { value: a.id, selected: existing?.account_id === a.id || undefined }, `${a.broker}${a.nickname ? ' · ' + a.nickname : ''}`));

          const symbolInput = el('input', { class: 'nm-input', name: 'symbol', required: true, placeholder: '국내: 005930 / 해외: AAPL', value: existing?.symbol || '' });
          const nameInput = el('input', { class: 'nm-input', name: 'name', placeholder: '종목명 (자동 조회 가능)', value: existing?.name || '' });
          // 시세 조회가 가능하면 종목코드로 이름을 자동으로 채워 준다.
          const nameBtn = el('button', { type: 'button', class: 'nm-btn', onclick: async () => {
            const sym = symbolInput.value.trim();
            if (!sym) { toast('종목코드를 먼저 입력하세요.', 'error'); return; }
            if (!window.hasQuoteProvider()) { toast('종목명 자동 조회는 시세 API 설정이 필요합니다(설정 → 증권 시세 API). 직접 입력해 주세요.', 'info'); return; }
            nameBtn.textContent = '조회 중…';
            const name = await window.lookupStockName(sym, marketSel.value);
            nameBtn.textContent = '🔍 이름 조회';
            if (name) { nameInput.value = name; toast(`종목명: ${name}`, 'success'); }
            else toast('종목명을 찾지 못했습니다. 직접 입력해 주세요.', 'error');
          } }, '🔍 이름 조회');

          form.append(
            field('계좌', accountSel),
            field('시장', marketSel),
            field('종목코드 / 티커', symbolInput),
            field('종목명', el('div', { class: 'row', style: 'gap:8px' }, [nameInput, nameBtn])),
            field('수량', el('input', { class: 'nm-input', name: 'quantity', type: 'number', step: 'any', required: true, value: existing?.quantity ?? '' })),
            field('평균 매입단가', el('input', { class: 'nm-input', name: 'avg_price', type: 'number', step: 'any', required: true, value: existing?.avg_price ?? '' })),
            // v7.24.0(아이디어 3): 도달하면 증권·홈 화면에 배지로 알려줄 목표가/손절가(주당).
            el('div', { class: 'row', style: 'gap:8px' }, [
              field('목표가 (선택)', el('input', { class: 'nm-input', name: 'target_price', type: 'number', step: 'any', placeholder: '도달 시 알림', value: existing?.target_price ?? '' })),
              field('손절가 (선택)', el('input', { class: 'nm-input', name: 'stop_price', type: 'number', step: 'any', placeholder: '도달 시 알림', value: existing?.stop_price ?? '' })),
            ]),
            field('통화', (() => {
              const sel = el('select', { class: 'nm-select', name: 'currency' });
              sel.append(el('option', { value: 'KRW', selected: (existing?.currency || 'KRW') === 'KRW' || undefined }, 'KRW'));
              sel.append(el('option', { value: 'USD', selected: existing?.currency === 'USD' || undefined }, 'USD'));
              return sel;
            })()),
            el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장')
          );
          // 시장을 바꾸면 통화 기본값을 맞춰 준다.
          marketSel.addEventListener('change', () => {
            const c = form.querySelector('[name=currency]');
            if (marketSel.value === 'US') c.value = 'USD'; else c.value = 'KRW';
          });
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = {
              account_id: fd.get('account_id') || null,
              market: fd.get('market'),
              symbol: String(fd.get('symbol')).trim(),
              name: String(fd.get('name') || '').trim() || null,
              quantity: Number(fd.get('quantity')) || 0,
              avg_price: Number(fd.get('avg_price')) || 0,
              target_price: fd.get('target_price') === '' || fd.get('target_price') === null ? null : Number(fd.get('target_price')),
              stop_price: fd.get('stop_price') === '' || fd.get('stop_price') === null ? null : Number(fd.get('stop_price')),
              currency: fd.get('currency'),
            };
            try {
              if (existing) await appState.updateStockHolding(existing.id, data);
              else await appState.addStockHolding(data);
              toast('저장했습니다.', 'success');
              close();
              loadPrices(true);
            } catch (err) { toast(`저장 실패: ${err.message || err}`, 'error'); }
          });
          body.append(form);
        },
      });
    }

    // ---- 매매 기록(선택) — 기록이 있으면 수량·평단을 자동 재계산할 수 있다 ----
    function openTradeList(h) {
      openModal({
        title: `${h.name || h.symbol} — 매매 기록`,
        width: '520px',
        contentBuilder(body, close) {
          const host = el('div', {});
          function drawTrades() {
            host.innerHTML = '';
            const trades = (appState.tradesByHolding[h.id] || []).slice().sort((a, b) => String(b.traded_at || '').localeCompare(String(a.traded_at || '')));
            if (!trades.length) host.append(el('div', { class: 'text-muted', style: 'font-size:13px' }, '등록된 매매 기록이 없습니다.'));
            for (const t of trades) {
              host.append(el('div', { class: 'row row--between', style: 'align-items:center; padding:6px 0; border-bottom:1px solid var(--border)' }, [
                el('div', {}, [
                  el('div', {}, `${t.side === 'sell' ? '매도' : '매수'} ${num(t.quantity)}주 @ ${formatMoney(t.price, h.currency)}`),
                  el('div', { class: 'text-muted', style: 'font-size:12px' }, `${t.traded_at || ''}${t.fee ? ` · 수수료 ${formatMoney(t.fee)}` : ''}`),
                ]),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: async () => { await appState.deleteStockTrade(t.id); drawTrades(); } }, '🗑'),
              ]));
            }
          }
          const sideSel = el('select', { class: 'nm-select', name: 'side' });
          sideSel.append(el('option', { value: 'buy' }, '매수'));
          sideSel.append(el('option', { value: 'sell' }, '매도'));
          const addForm = el('form', { class: 'stack', style: 'margin-top:12px; border-top:1px dashed var(--border); padding-top:12px' }, [
            el('div', { class: 'row', style: 'gap:8px' }, [
              field('구분', sideSel),
              field('수량', el('input', { class: 'nm-input', name: 'quantity', type: 'number', step: 'any', required: true })),
            ]),
            el('div', { class: 'row', style: 'gap:8px' }, [
              field('단가', el('input', { class: 'nm-input', name: 'price', type: 'number', step: 'any', required: true })),
              field('수수료', el('input', { class: 'nm-input', name: 'fee', type: 'number', step: 'any', value: '0' })),
            ]),
            field('체결일', el('input', { class: 'nm-input', name: 'traded_at', type: 'date', value: todayISO() })),
            el('button', { class: 'nm-btn', type: 'submit' }, '+ 기록 추가'),
          ]);
          addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(addForm);
            await appState.addStockTrade({
              holding_id: h.id, account_id: h.account_id, market: h.market, symbol: h.symbol, name: h.name,
              side: fd.get('side'), quantity: Number(fd.get('quantity')) || 0, price: Number(fd.get('price')) || 0,
              fee: Number(fd.get('fee')) || 0, traded_at: fd.get('traded_at') || todayISO(),
            });
            drawTrades();
            toast('기록을 추가했습니다.', 'success');
          });
          // 보유 수량·평단을 매매 기록으로 다시 계산하는 버튼.
          const recalcBtn = el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: async () => {
            const trades = appState.tradesByHolding[h.id] || [];
            if (!trades.length) { toast('매매 기록이 없습니다.', 'error'); return; }
            const { quantity, avg_price } = recomputeFromTrades(trades);
            await appState.updateStockHolding(h.id, { quantity, avg_price });
            toast(`수량 ${num(quantity)}주 · 평단 ${formatMoney(avg_price, h.currency)}로 재계산했습니다.`, 'success');
            close();
          } }, '🧮 기록으로 수량·평단 재계산');
          body.append(host, addForm, recalcBtn);
          drawTrades();
        },
      });
    }

    // ---- 배당 기록 (v7.24.0, 아이디어 4) — 종목별 배당금 수령 내역. 실현손익과 함께 총 수익을 이룬다. ----
    function openDividendList(h) {
      openModal({
        title: `${h.name || h.symbol} — 배당 기록`,
        width: '520px',
        contentBuilder(body, close) {
          const host = el('div', {});
          function drawDividends() {
            host.innerHTML = '';
            const rows = (appState.dividendsByHolding[h.id] || []).slice().sort((a, b) => String(b.paid_at || '').localeCompare(String(a.paid_at || '')));
            if (!rows.length) host.append(el('div', { class: 'text-muted', style: 'font-size:13px' }, '등록된 배당 기록이 없습니다.'));
            for (const d of rows) {
              host.append(el('div', { class: 'row row--between', style: 'align-items:center; padding:6px 0; border-bottom:1px solid var(--border)' }, [
                el('div', {}, [
                  el('div', {}, `${formatMoney(d.amount, d.currency || h.currency)}${d.tax ? ` (세금 ${formatMoney(d.tax, d.currency || h.currency)})` : ''}`),
                  el('div', { class: 'text-muted', style: 'font-size:12px' }, `${d.paid_at || ''}${d.memo ? ` · ${d.memo}` : ''}`),
                ]),
                el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: async () => { await appState.deleteStockDividend(d.id); drawDividends(); } }, '🗑'),
              ]));
            }
          }
          const addForm = el('form', { class: 'stack', style: 'margin-top:12px; border-top:1px dashed var(--border); padding-top:12px' }, [
            el('div', { class: 'row', style: 'gap:8px' }, [
              field('배당금(세후)', el('input', { class: 'nm-input', name: 'amount', type: 'number', step: 'any', required: true, placeholder: '예: 12500' })),
              field('세금(선택)', el('input', { class: 'nm-input', name: 'tax', type: 'number', step: 'any', value: '0' })),
            ]),
            el('div', { class: 'row', style: 'gap:8px' }, [
              field('지급일', el('input', { class: 'nm-input', name: 'paid_at', type: 'date', value: todayISO() })),
              field('메모 (선택)', el('input', { class: 'nm-input', name: 'memo', placeholder: '예: 분기배당' })),
            ]),
            el('button', { class: 'nm-btn', type: 'submit' }, '+ 배당 기록 추가'),
          ]);
          addForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(addForm);
            try {
              await appState.addStockDividend({
                holding_id: h.id, account_id: h.account_id, market: h.market, symbol: h.symbol, name: h.name,
                amount: Number(fd.get('amount')) || 0, tax: Number(fd.get('tax')) || 0,
                paid_at: fd.get('paid_at') || todayISO(), currency: h.currency, memo: fd.get('memo') || null,
              });
              drawDividends();
              toast('배당 기록을 추가했습니다.', 'success');
            } catch (err) { toast(`추가 실패: ${err.message || err} (0028 마이그레이션 필요)`, 'error'); }
          });
          body.append(host, addForm);
          drawDividends();
        },
      });
    }

    async function removeAccount(acc) {
      if (!confirmDialog(`"${acc.broker}${acc.nickname ? ' · ' + acc.nickname : ''}" 계좌를 삭제할까요? (보유 종목도 함께 숨겨집니다)`)) return;
      await appState.deleteBrokerageAccount(acc.id);
      toast('삭제했습니다.', 'success');
    }
    async function removeHolding(h) {
      if (!confirmDialog(`"${h.name || h.symbol}" 종목을 삭제할까요?`)) return;
      await appState.deleteStockHolding(h.id);
      toast('삭제했습니다.', 'success');
    }

    draw();
    const onChange = () => { draw(); loadMissing(); };
    appState.addEventListener('change', onChange);
    // 첫 진입 시 시세를 한 번 받아 둔다(키가 있을 때만).
    loadPrices(false);
    schedule();
    return () => { clearInterval(timer); appState.removeEventListener('change', onChange); };
  }

  // ---- 작은 헬퍼 ----
  function summaryTile(label, value, cls) {
    return el('div', { class: 'stock-summary__tile' }, [
      el('div', { class: 'text-muted', style: 'font-size:12px' }, label),
      el('div', { class: `stock-summary__value ${cls ? 'stock-pnl--' + cls : ''}` }, value),
    ]);
  }
  const num = (v) => Number(v || 0).toLocaleString('ko-KR', { maximumFractionDigits: 4 });
  function formatMoney(v, currency = 'KRW') {
    const n = Number(v || 0);
    const digits = currency === 'USD' ? 2 : 0;
    const s = n.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
    return currency === 'USD' ? `$${s}` : `${s}원`;
  }
  function maskAccount(no) {
    // 계좌번호는 민감정보라 뒤 4자리만 남기고 가린다.
    const s = String(no);
    return s.length <= 4 ? s : s.slice(0, -4).replace(/[0-9]/g, '*') + s.slice(-4);
  }
  function field(label, node) {
    return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
  }

  window.renderStocks = renderStocks;
})();
