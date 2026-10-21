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
    let pricesLoaded = false;
    let loadingPrices = false;

    async function loadPrices(force = false) {
      if (loadingPrices) return;
      const holdings = appState.stockHoldings.filter((h) => !h.deleted_at);
      if (!holdings.length) { prices = {}; pricesLoaded = true; return; }
      if (!window.hasQuoteProvider()) { prices = {}; pricesLoaded = true; return; }
      loadingPrices = true;
      draw();
      try {
        const { prices: p, errors } = await window.fetchPrices(holdings, { force });
        prices = p;
        if (errors.length && errors[0].symbol !== '*') {
          toast(`일부 종목 시세를 받지 못했습니다: ${errors.slice(0, 2).map((e) => e.symbol).join(', ')}${errors.length > 2 ? ' 외' : ''}`, 'error');
        }
      } catch (e) {
        toast(`시세 조회 실패: ${e.message || e}`, 'error');
      } finally {
        loadingPrices = false;
        pricesLoaded = true;
        draw();
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

      if (!window.hasQuoteProvider()) {
        const label = window.stockProviderLabel ? window.stockProviderLabel() : '증권 API';
        container.append(el('div', { class: 'nm-banner nm-banner--warning' }, [
          el('span', {}, `실시간 시세를 쓰려면 ${label} 설정을 등록하세요(설정 → 증권 시세 API). 지금은 보유 정보만 관리됩니다. `),
          el('a', { href: '#/settings' }, '설정으로 이동'),
        ]));
      }

      const holdings = appState.stockHoldings.filter((h) => !h.deleted_at);
      const accounts = appState.brokerageAccounts.filter((a) => !a.deleted_at);
      if (!holdings.length && !accounts.length) {
        // v7.25.0: 종목이 없어도 오늘의 시황·환율은 볼 수 있게 먼저 보여준다.
        container.append(buildMarketCard());
        container.append(el('div', { class: 'empty-state' }, '등록된 계좌나 보유 종목이 없습니다. "+ 계좌 등록"으로 시작하세요.'));
        return;
      }

      // 전체 포트폴리오 요약
      const total = evaluatePortfolio(holdings, prices);
      // v7.24.0(아이디어 4): 실현손익·수수료·배당 누적도 함께 보여준다.
      const allTrades = appState.stockTrades || [];
      const realized = evaluateRealized(allTrades);
      const divSum = sumDividends(appState.stockDividends || []);
      const divTotal = divSum.byCurrency.KRW || 0;
      container.append(
        el('div', { class: 'nm-card stock-summary' }, [
          summaryTile('총 매입금액', formatMoney(total.totalCost), ''),
          summaryTile('총 평가금액', total.totalValue === null ? '—' : formatMoney(total.totalValue), ''),
          summaryTile('평가손익', total.totalValue === null ? '—' : formatPnl(total.totalPnl), pnlClass(total.totalPnl)),
          summaryTile('수익률', formatPnlRate(total.totalPnlRate), pnlClass(total.totalPnl)),
        ])
      );
      if (allTrades.length || divSum.count) {
        container.append(
          el('div', { class: 'nm-card stock-summary' }, [
            summaryTile('실현손익', allTrades.length ? formatPnl(realized.realizedPnl) : '—', allTrades.length ? pnlClass(realized.realizedPnl) : ''),
            summaryTile('누적 수수료', formatMoney(realized.totalFee), ''),
            summaryTile('배당 합계', divSum.count ? formatMoney(divTotal) : '—', divSum.count ? 'gain' : ''),
            summaryTile('총 수익(실현+배당)', formatPnl(realized.realizedPnl + divTotal), pnlClass(realized.realizedPnl + divTotal)),
          ])
        );
      }
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

      // v7.25.0: 오늘의 시황 + 환율 카드.
      container.append(buildMarketCard());

      // 계좌별 그룹
      const stack = el('div', { class: 'stack' });
      const noAccount = holdings.filter((h) => !h.account_id);
      if (noAccount.length) stack.append(accountSection(null, noAccount));
      for (const acc of accounts) {
        const list = appState.stockHoldings.filter((h) => !h.deleted_at && h.account_id === acc.id);
        stack.append(accountSection(acc, list));
      }
      container.append(stack);
    }

    // v7.25.0: 오늘의 시황(지수) + 환율 카드. 값이 없으면 지어내지 않고 안내만 한다.
    let marketData = null;      // { indices:[], fx:{majors,rest} }
    let marketLoading = false;
    let marketTried = false;
    function buildMarketCard() {
      const card = el('div', { class: 'nm-card market-card' });
      const body = el('div', { class: 'market-card__body' });
      const head = el('div', { class: 'row row--between', style: 'align-items:center' }, [
        el('strong', { style: 'font-size:14px' }, '📈 오늘의 시황 · 환율'),
        el('button', { class: 'nm-btn nm-btn--icon', title: '새로고침', disabled: marketLoading || undefined, onclick: () => loadMarket(true) }, marketLoading ? '⏳' : '🔄'),
      ]);
      card.append(head, body);
      function paint() {
        body.replaceChildren();
        if (!marketData) {
          body.append(el('div', { class: 'text-muted', style: 'font-size:12px; padding:6px 2px' }, '시황·환율을 불러오는 중입니다…'));
          return;
        }
        // 지수
        const idx = marketData.indices || [];
        body.append(el('div', { class: 'market-sec' }, [
          el('div', { class: 'market-sec__label' }, '지수'),
          idx.length
            ? el('div', { class: 'market-chips' }, idx.map((r) => el('div', { class: 'market-chip' }, [
                el('span', { class: 'market-chip__name' }, r.label),
                el('strong', { class: 'market-chip__val' }, num(r.value)),
                el('span', { class: `market-chip__chg ${pnlClass(r.changeRate)}` }, r.changeRate === null || r.changeRate === undefined ? '' : `${r.changeRate > 0 ? '▲' : r.changeRate < 0 ? '▼' : ''}${Math.abs(r.changeRate).toFixed(2)}%`),
              ])))
            : el('span', { class: 'text-muted', style: 'font-size:12px' }, marketData.indexNote || '지수 정보를 불러오지 못했습니다.'),
        ]));
        // 환율
        const fx = marketData.fx;
        body.append(el('div', { class: 'market-sec' }, [
          el('div', { class: 'market-sec__label' }, '환율(매매기준율)'),
          fx && fx.majors && fx.majors.length
            ? el('div', { class: 'market-chips' }, fx.majors.map((r) => el('div', { class: 'market-chip' }, [
                el('span', { class: 'market-chip__name' }, r.name || r.unit),
                el('strong', { class: 'market-chip__val' }, num(r.rate)),
              ])))
            : el('span', { class: 'text-muted', style: 'font-size:12px' }, marketData.fxNote || '환율 정보를 불러오지 못했습니다.'),
        ]));
      }
      paint();
      if (!marketTried) { marketTried = true; loadMarket(false); }
      return card;
    }

    async function loadMarket(force) {
      if (marketLoading) return;
      marketLoading = true;
      if (force) { marketData = null; draw(); }
      const indices = [];
      let indexNote = '';
      let fx = null;
      let fxNote = '';
      try { indices.push(...await window.fetchIndices()); }
      catch (e) { indexNote = e.message; }
      if (window.getFxEnabled()) {
        try { const rows = await window.fetchExchangeRates(); fx = window.orderMajorFx(rows); }
        catch (e) { fxNote = e.message; }
      } else { fxNote = '환율 표시가 꺼져 있습니다(설정에서 켤 수 있습니다).'; }
      marketData = { indices, indexNote, fx, fxNote };
      marketLoading = false;
      draw();
    }

    function accountSection(acc, holdings) {
      const summary = evaluatePortfolio(holdings, prices);
      const header = acc
        ? el('div', { class: 'row row--between wrap', style: 'align-items:center' }, [
            el('div', {}, [
              el('div', { class: 'stock-account__title' }, `${escapeHtml(acc.broker)}${acc.nickname ? ' · ' + escapeHtml(acc.nickname) : ''}`),
              el('div', { class: 'text-muted', style: 'font-size:12px' }, `${acc.account_no ? escapeHtml(maskAccount(acc.account_no)) + ' · ' : ''}${acc.currency === 'USD' ? '해외(USD)' : '국내(KRW)'}`),
            ]),
            el('div', { class: 'row', style: 'gap:6px; align-items:center' }, [
              el('span', { class: `stock-pnl stock-pnl--${pnlClass(summary.totalPnl)}` }, summary.totalValue === null ? '—' : `${formatPnl(summary.totalPnl)} (${formatPnlRate(summary.totalPnlRate)})`),
              el('button', { class: 'nm-btn nm-btn--icon', title: '계좌 수정', onclick: () => openAccountForm(acc) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '계좌 삭제', onclick: () => removeAccount(acc) }, '🗑'),
            ]),
          ])
        : el('div', { class: 'stock-account__title' }, '계좌 미지정');

      const body = holdings.length
        ? el('div', { class: 'stock-holdings' }, [holdingHeader(), ...holdings.map(holdingRow)])
        : el('div', { class: 'text-muted', style: 'font-size:13px; padding:6px 2px' }, '보유 종목이 없습니다.');

      return el('div', { class: 'nm-card' }, [header, el('div', { style: 'margin-top:10px' }, body)]);
    }

    function holdingHeader() {
      return el('div', { class: 'stock-holdings__head' }, ['종목', '수량', '평단', '현재가', '평가금액', '손익', ''].map((t) => el('div', {}, t)));
    }

    function holdingRow(h) {
      const key = `${h.market || 'KRX'}:${h.symbol}`;
      const ev = evaluateHolding(h, Object.prototype.hasOwnProperty.call(prices, key) ? prices[key] : null);
      const cur = prices[key];
      // v7.24.0(아이디어 3): 이 종목이 목표가/손절가에 도달했으면 이름 옆에 배지로 표시한다.
      const alert = priceAlerts([h], Object.prototype.hasOwnProperty.call(prices, key) ? prices : {})[0];
      return el('div', { class: 'stock-holdings__row' }, [
        el('div', {}, [
          el('div', { class: 'stock-holdings__name' }, [
            `${escapeHtml(h.name || h.symbol)}`,
            alert ? el('span', { class: `nm-badge ${alert.kind === 'target' ? 'nm-badge--success' : 'nm-badge--critical'}`, style: 'margin-left:6px' }, alert.kind === 'target' ? '🎯 목표가' : '🛑 손절가') : null,
          ]),
          el('div', { class: 'text-muted', style: 'font-size:11px' }, `${MARKET_LABEL[h.market] || h.market} ${escapeHtml(h.symbol)}${h.target_price ? ` · 목표 ${formatMoney(h.target_price, h.currency)}` : ''}${h.stop_price ? ` · 손절 ${formatMoney(h.stop_price, h.currency)}` : ''}`),
        ]),
        el('div', {}, num(h.quantity)),
        el('div', {}, formatMoney(h.avg_price, h.currency)),
        el('div', {}, cur === undefined ? '—' : formatMoney(cur, h.currency)),
        el('div', {}, ev.marketValue === null ? '—' : formatMoney(ev.marketValue, h.currency)),
        el('div', { class: `stock-pnl stock-pnl--${pnlClass(ev.pnl)}` }, ev.pnl === null ? '—' : `${formatPnl(ev.pnl)} (${formatPnlRate(ev.pnlRate)})`),
        el('div', { class: 'row', style: 'gap:4px' }, [
          el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openHoldingForm(h) }, '✎'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '매매 기록', onclick: () => openTradeList(h) }, '📄'),
          el('button', { class: 'nm-btn nm-btn--icon', title: '배당 기록', onclick: () => openDividendList(h) }, '💰'),
          el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeHolding(h) }, '🗑'),
        ]),
      ]);
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
                  el('div', { class: 'text-muted', style: 'font-size:12px' }, `${d.paid_at || ''}${d.memo ? ` · ${escapeHtml(d.memo)}` : ''}`),
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
    appState.addEventListener('change', draw);
    // 첫 진입 시 시세를 한 번 받아 둔다(키가 있을 때만).
    loadPrices(false);
    return () => appState.removeEventListener('change', draw);
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
