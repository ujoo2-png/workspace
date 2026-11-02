// 차트 계열 유형 (v7.32.0): 막대 · 폭포 · 선 · 산점 · 히트맵 · 레이더 · 폴라 · 사분면 · 트리맵 · 피라미드 · 벤 · 생키
(function (root) {
  'use strict';
  const C = root.DiagramCore;
  const { r1, up4, tw, txt, txtLines, wrap, ellip, E, clamp, mix } = C;
  const reg = (d) => C.register(d);
  const FAM = { chart: '비교·차트', part: '구성·분포', anal: '분석·전략' };
  const N = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const fmtN = (v) => { const a = Math.abs(v); if (a >= 1e8) return `${r1(v / 1e8)}억`; if (a >= 1e4) return `${r1(v / 1e4)}만`; return (Math.round(v * 100) / 100).toLocaleString('ko-KR'); };
  function nice(min, max, n = 4) {
    if (min === max) { max = min + 1; }
    const span = max - min; const raw = span / n; const mag = Math.pow(10, Math.floor(Math.log10(raw))); const nr = raw / mag;
    const step = (nr <= 1 ? 1 : nr <= 2 ? 2 : nr <= 2.5 ? 2.5 : nr <= 5 ? 5 : 10) * mag;
    return { min: Math.floor(min / step) * step, max: Math.ceil(max / step) * step, step };
  }
  const seriesColor = (ctx, i, focal) => (focal ? ctx.tok.accent : ctx.tok.series[i % ctx.tok.series.length]);
  const chartLegend = (ctx, names, focalIdx) => (names.length > 1 ? names.map((n, i) => ({ label: n, fill: seriesColor(ctx, i, i === focalIdx), color: seriesColor(ctx, i, i === focalIdx) })) : []);

  // ── 막대 ──────────────────────────────────────────────────────────────
  reg({
    id: 'bar', ko: '막대 그래프', en: 'Bar chart', family: FAM.chart, short: '항목별 크기 비교(덤벨 변형 포함)',
    desc: '범주별 수치를 막대 길이로 비교합니다. 항목 이름이 길면 가로 막대가 읽기 좋고, 두 시점(전/후)을 한 줄에 점 두 개로 잇는 덤벨 변형도 지원합니다.',
    when: '월별 지출, 종목별 평가금액, 전/후 비교', tips: 'orientation: "h"|"v". mode:"dumbbell"이면 items[].from/to. focal 막대 1~2개만 강조.',
    sample: { title: '종목별 평가금액', unit: '원', orientation: 'h', items: [{ label: '삼성전자', value: 725000, focal: true }, { label: 'SK하이닉스', value: 900000 }, { label: 'NAVER', value: 410000 }, { label: '카카오', value: 230000 }] },
    budget: { nodes: 12, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const items = (d.items || []).slice(0, 16);
      if (d.mode === 'dumbbell') {
        const lab = Math.max(...items.map((i) => tw(i.label, 12))) + 20; const plot = 480; const vals = items.flatMap((i) => [N(i.from), N(i.to)]); const sc = nice(Math.min(0, ...vals), Math.max(...vals)); const X = (v) => lab + ((v - sc.min) / (sc.max - sc.min)) * plot; const rh = 34; let b = '';
        for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) b += `<line x1="${r1(X(v))}" x2="${r1(X(v))}" y1="0" y2="${items.length * rh}" stroke="${t.rule}"/>` + txt(ctx, X(v), items.length * rh + 16, fmtN(v), { size: 9, mono: true, anchor: 'middle', fill: t.soft });
        items.forEach((it, i) => { ctx.counts.nodes++; const y = i * rh + rh / 2; const foc = !!it.focal; if (foc) ctx.counts.accent++; ctx.table.push({ 항목: it.label, 이전: it.from, 이후: it.to }); ctx.blocks.push({ id: it.label, label: it.label });
          b += ctx.anim(`d${i}`, txt(ctx, 0, y + 4, ellip(it.label, 12, lab - 12), { size: 12 }) + `<line x1="${r1(X(N(it.from)))}" x2="${r1(X(N(it.to)))}" y1="${y}" y2="${y}" stroke="${foc ? t.accent : t.muted}" stroke-width="2"/><circle cx="${r1(X(N(it.from)))}" cy="${y}" r="5" fill="${t.paper}" stroke="${t.ink}" stroke-width="1.5"/><circle cx="${r1(X(N(it.to)))}" cy="${y}" r="5" fill="${foc ? t.accent : t.ink}"/>`); });
        return { w: lab + plot + 30, h: items.length * rh + 28, body: b, legend: [{ label: d.fromLabel || '이전', fill: t.paper, color: t.ink }, { label: d.toLabel || '이후', fill: t.ink, color: t.ink }] };
      }
      const horiz = d.orientation ? d.orientation === 'h' : items.some((i) => tw(i.label, 12) > 70);
      const vals = items.map((i) => N(i.value)); const sc = nice(Math.min(0, ...vals), Math.max(0, ...vals));
      let b = '';
      if (horiz) {
        const lab = Math.max(60, ...items.map((i) => tw(i.label, 12))) + 20; const plot = 480; const rh = 36; const X = (v) => lab + ((v - sc.min) / (sc.max - sc.min)) * plot; const z = X(0);
        for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) b += `<line x1="${r1(X(v))}" x2="${r1(X(v))}" y1="0" y2="${items.length * rh}" stroke="${t.rule}"/>` + txt(ctx, X(v), items.length * rh + 16, fmtN(v), { size: 9, mono: true, anchor: 'middle', fill: t.soft });
        items.forEach((it, i) => { ctx.counts.nodes++; const foc = !!it.focal; if (foc) ctx.counts.accent++; const v = N(it.value); const y = i * rh + 8; const x1 = Math.min(z, X(v)), w = Math.max(2, Math.abs(X(v) - z));
          ctx.table.push({ 항목: it.label, 값: `${fmtN(v)}${d.unit || ''}` }); ctx.blocks.push({ id: it.label, label: it.label, value: v });
          b += ctx.anim(`b${i}`, txt(ctx, 0, y + 17, ellip(it.label, 12, lab - 12), { size: 12, weight: foc ? 600 : 400 }) + `<rect x="${r1(x1)}" y="${y}" width="${r1(w)}" height="20" rx="3" fill="${foc ? t.accent : t.series[1]}" fill-opacity="${foc ? 1 : 0.85}"/>` + txt(ctx, x1 + w + 6, y + 15, `${fmtN(v)}${d.unit || ''}`, { size: 10, mono: true, fill: foc ? t.accent : t.soft, weight: foc ? 600 : 400 })); });
        b += `<line x1="${r1(z)}" x2="${r1(z)}" y1="0" y2="${items.length * rh}" stroke="${t.ruleSolid}"/>`;
        return { w: lab + plot + 80, h: items.length * rh + 28, body: b, legend: [] };
      }
      const colW = Math.max(56, Math.max(...items.map((i) => tw(i.label, 11))) + 16); const plotH = 240; const Y = (v) => plotH - ((v - sc.min) / (sc.max - sc.min)) * plotH; const z = Y(0); const W = 56 + items.length * colW;
      for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) b += `<line x1="48" x2="${W}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke="${t.rule}"/>` + txt(ctx, 42, Y(v) + 3, fmtN(v), { size: 9, mono: true, anchor: 'end', fill: t.soft });
      items.forEach((it, i) => { ctx.counts.nodes++; const foc = !!it.focal; if (foc) ctx.counts.accent++; const v = N(it.value); const x = 56 + i * colW + colW / 2 - 14; const y1 = Math.min(z, Y(v)), h = Math.max(2, Math.abs(Y(v) - z));
        ctx.table.push({ 항목: it.label, 값: `${fmtN(v)}${d.unit || ''}` }); ctx.blocks.push({ id: it.label, label: it.label, value: v });
        b += ctx.anim(`b${i}`, `<rect x="${r1(x)}" y="${r1(y1)}" width="28" height="${r1(h)}" rx="3" fill="${foc ? t.accent : t.series[1]}" fill-opacity="${foc ? 1 : 0.85}"/>` + txt(ctx, x + 14, y1 - 6, fmtN(v), { size: 10, mono: true, anchor: 'middle', fill: foc ? t.accent : t.soft, weight: foc ? 600 : 400 }) + txt(ctx, x + 14, plotH + 18, ellip(it.label, 11, colW - 6), { size: 11, anchor: 'middle' })); });
      b += `<line x1="48" x2="${W}" y1="${r1(z)}" y2="${r1(z)}" stroke="${t.ruleSolid}"/>`;
      return { w: W, h: plotH + 34, body: b, legend: [] };
    },
  });

  // ── 폭포 ──────────────────────────────────────────────────────────────
  reg({
    id: 'waterfall', ko: '워터폴(폭포)', en: 'Waterfall', family: FAM.chart, short: '시작값→끝값을 가감 요인으로 잇기',
    desc: '시작 합계에서 끝 합계까지, 늘린 요인과 줄인 요인이 얼마씩 기여했는지 징검다리처럼 보여줍니다. 예산 브리지, 손익 분해, 인원 증감에 맞습니다.',
    when: '월 수익 변화 설명, 비용 증감 분석', tips: 'start.value + steps[].delta = 끝값(자동 계산). 증가는 녹색 계열, 감소는 갈색 계열.',
    sample: { title: '월 자산 변동', unit: '만', start: { label: '9월 말', value: 1200 }, steps: [{ label: '매수', delta: 300 }, { label: '평가이익', delta: 180 }, { label: '배당', delta: 25 }, { label: '매도 실현', delta: -240 }], endLabel: '10월 말' },
    budget: { nodes: 9, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const steps = (d.steps || []).slice(0, 10); let run = N(d.start && d.start.value); const bars = [{ label: (d.start && d.start.label) || '시작', from: 0, to: run, total: true }];
      for (const s of steps) { const dl = N(s.delta); bars.push({ label: s.label, from: run, to: run + dl, delta: dl }); run += dl; }
      bars.push({ label: d.endLabel || '끝', from: 0, to: run, total: true });
      const all = bars.flatMap((b) => [b.from, b.to]); const sc = nice(Math.min(0, ...all), Math.max(...all)); const colW = 84; const plotH = 240; const Y = (v) => plotH - ((v - sc.min) / (sc.max - sc.min)) * plotH; const W = 56 + bars.length * colW; let b = '';
      for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) b += `<line x1="48" x2="${W}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke="${t.rule}"/>` + txt(ctx, 42, Y(v) + 3, fmtN(v), { size: 9, mono: true, anchor: 'end', fill: t.soft });
      bars.forEach((bar, i) => { ctx.counts.nodes++; const x = 56 + i * colW + 14; const top = Y(Math.max(bar.from, bar.to)), h = Math.max(2, Math.abs(Y(bar.from) - Y(bar.to)));
        const col = bar.total ? t.ink : bar.delta >= 0 ? t.series[0] : t.series[3]; const lbl = bar.total ? fmtN(bar.to) : `${bar.delta >= 0 ? '+' : ''}${fmtN(bar.delta)}`;
        ctx.table.push({ 항목: bar.label, 값: lbl + (d.unit || ''), 누계: fmtN(bar.to) }); ctx.blocks.push({ id: String(i), label: bar.label, value: bar.to });
        let g = `<rect x="${x}" y="${r1(top)}" width="${colW - 28}" height="${r1(h)}" rx="2" fill="${col}" fill-opacity="${bar.total ? 0.9 : 0.85}"/>` + txt(ctx, x + (colW - 28) / 2, top - 6, lbl, { size: 10, mono: true, anchor: 'middle', fill: t.ink, weight: 500 }) + txt(ctx, x + (colW - 28) / 2, plotH + 18, ellip(bar.label, 11, colW - 6), { size: 11, anchor: 'middle' });
        if (i < bars.length - 1) g += `<line x1="${x + colW - 28}" x2="${x + colW}" y1="${r1(Y(bar.to))}" y2="${r1(Y(bar.to))}" stroke="${t.ruleSolid}" stroke-dasharray="3,3"/>`;
        b += ctx.anim(`w${i}`, g); });
      return { w: W, h: plotH + 34, body: b, legend: [{ label: '합계', fill: t.ink, color: t.ink }, { label: '증가', fill: t.series[0], color: t.series[0] }, { label: '감소', fill: t.series[3], color: t.series[3] }] };
    },
  });

  // ── 선(+슬로프/범프) ──────────────────────────────────────────────────
  reg({
    id: 'line', ko: '선 그래프', en: 'Line chart', family: FAM.chart, short: '추세 · 슬로프 · 순위 변화(범프)',
    desc: '시간에 따른 연속적인 변화를 선으로 보여줍니다. 시점이 딱 두 개면 슬로프 그래프, 여러 시점의 순위 이동은 범프 차트(mode:"bump")로 바꿔 표현합니다.',
    when: '월별 추세, 전후 비교, 순위 변동', tips: 'x: 라벨 배열, series[].values 같은 길이. mode: "line"|"slope"|"bump". 선 끝에 직접 라벨이 붙습니다.',
    sample: { title: '월별 수익률(%)', x: ['6월', '7월', '8월', '9월', '10월'], series: [{ name: '내 포트폴리오', values: [1.2, 2.8, 2.1, 4.6, 5.3], focal: true }, { name: '코스피', values: [0.5, 1.9, 1.2, 2.4, 3.1] }] },
    budget: { nodes: 6, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const xs = d.x || []; const ser = (d.series || []).slice(0, 6); const mode = d.mode || (xs.length === 2 ? 'slope' : 'line');
      const plotW = 520, plotH = 240, left = 52; let b = '';
      const all = ser.flatMap((s) => (s.values || []).map(N)); if (!all.length) return { w: 300, h: 60, body: txt(ctx, 0, 30, '데이터가 없습니다.', { size: 12, fill: t.soft }), legend: [] };
      const bump = mode === 'bump'; const sc = bump ? { min: 0.5, max: Math.max(...all) + 0.5, step: 1 } : nice(Math.min(...all), Math.max(...all));
      const Y = (v) => (bump ? ((v - sc.min) / (sc.max - sc.min)) * plotH : plotH - ((v - sc.min) / (sc.max - sc.min)) * plotH);
      const X = (i) => left + (xs.length > 1 ? (i / (xs.length - 1)) * plotW : plotW / 2);
      if (!bump) for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) b += `<line x1="${left}" x2="${left + plotW}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke="${t.rule}"/>` + txt(ctx, left - 6, Y(v) + 3, fmtN(v), { size: 9, mono: true, anchor: 'end', fill: t.soft });
      xs.forEach((x, i) => { b += txt(ctx, X(i), plotH + 20, x, { size: 11, anchor: 'middle', fill: t.muted }); if (mode === 'slope' || bump) b += `<line x1="${r1(X(i))}" x2="${r1(X(i))}" y1="0" y2="${plotH}" stroke="${t.rule}"/>`; });
      ser.forEach((s, si) => { const foc = !!s.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++; const col = seriesColor(ctx, si, foc); const vs = (s.values || []).map(N);
        const pts = vs.map((v, i) => [X(i), Y(v)]);
        ctx.table.push({ 계열: s.name, ...Object.fromEntries(xs.map((x, i) => [x, vs[i]])) }); ctx.blocks.push({ id: s.name, label: s.name });
        let g = `<polyline points="${pts.map((p) => p.map(r1).join(',')).join(' ')}" fill="none" stroke="${col}" stroke-width="${foc ? 2.5 : 2}" stroke-linejoin="round"/>`;
        if (bump || mode === 'slope' || vs.length <= 8) pts.forEach((p, i) => { g += `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="${bump ? 7 : 4}" fill="${bump ? col : t.paper}" stroke="${col}" stroke-width="2"/>` + (bump ? txt(ctx, p[0], p[1] + 3.5, String(vs[i]), { size: 9, mono: true, anchor: 'middle', fill: t.paper, weight: 600 }) : ''); });
        if (mode === 'slope') { g += txt(ctx, pts[0][0] - 10, pts[0][1] + 4, `${s.name} ${fmtN(vs[0])}`, { size: 11, anchor: 'end', fill: t.ink }) + txt(ctx, pts[pts.length - 1][0] + 10, pts[pts.length - 1][1] + 4, `${fmtN(vs[vs.length - 1])} ${s.name}`, { size: 11, fill: t.ink }); }
        else { const lp = pts[pts.length - 1]; g += txt(ctx, lp[0] + 12, lp[1] + 4, s.name, { size: 11, fill: foc ? t.accent : t.ink, weight: foc ? 600 : 400 }); }
        b += ctx.anim(`s${si}`, g); });
      const pad = mode === 'slope' ? 160 : 140;
      return { w: left + plotW + pad, h: plotH + 32, body: mode === 'slope' ? `<g transform="translate(${pad - 90},0)">${b}</g>` : b, legend: chartLegend(ctx, ser.map((s) => s.name), ser.findIndex((s) => s.focal)) };
    },
  });

  // ── 산점(+버블/박스) ──────────────────────────────────────────────────
  reg({
    id: 'scatter', ko: '산점도', en: 'Scatter plot', family: FAM.chart, short: '두 변수의 관계(버블·박스플롯 변형)',
    desc: '두 수치의 상관관계를 점으로 보여줍니다. 점 크기로 세 번째 변수를 담는 버블, 그룹별 분포 요약(최소·사분위·중앙·최대)을 담는 박스플롯 변형이 있습니다.',
    when: '위험 대비 수익, 분포 비교, 이상치 찾기', tips: 'points[].x/y/size/label. mode:"box"면 groups[].min,q1,med,q3,max.',
    sample: { title: '비중 vs 수익률', xLabel: '포트폴리오 비중(%)', yLabel: '수익률(%)', mode: 'bubble', points: [{ label: '삼성전자', x: 30, y: 4.2, size: 30, focal: true }, { label: 'SK하이닉스', x: 25, y: 9.8, size: 25 }, { label: 'NAVER', x: 15, y: -3.1, size: 15 }, { label: '카카오', x: 8, y: -6.4, size: 8 }] },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const left = 56, plotW = 500, plotH = 280;
      if (d.mode === 'box') {
        const g = (d.groups || []).slice(0, 8); const all = g.flatMap((x) => [N(x.min), N(x.max)]); const sc = nice(Math.min(...all), Math.max(...all)); const Y = (v) => plotH - ((v - sc.min) / (sc.max - sc.min)) * plotH; const colW = plotW / Math.max(1, g.length); let b = '';
        for (let v = sc.min; v <= sc.max + 1e-9; v += sc.step) b += `<line x1="${left}" x2="${left + plotW}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke="${t.rule}"/>` + txt(ctx, left - 6, Y(v) + 3, fmtN(v), { size: 9, mono: true, anchor: 'end', fill: t.soft });
        g.forEach((x, i) => { ctx.counts.nodes++; const cx = left + i * colW + colW / 2; const foc = !!x.focal; if (foc) ctx.counts.accent++; const col = foc ? t.accent : t.ink; ctx.table.push({ 그룹: x.label, 최소: x.min, Q1: x.q1, 중앙: x.med, Q3: x.q3, 최대: x.max });
          b += ctx.anim(`x${i}`, `<line x1="${cx}" x2="${cx}" y1="${r1(Y(N(x.max)))}" y2="${r1(Y(N(x.min)))}" stroke="${col}"/><line x1="${cx - 8}" x2="${cx + 8}" y1="${r1(Y(N(x.max)))}" y2="${r1(Y(N(x.max)))}" stroke="${col}"/><line x1="${cx - 8}" x2="${cx + 8}" y1="${r1(Y(N(x.min)))}" y2="${r1(Y(N(x.min)))}" stroke="${col}"/><rect x="${cx - 16}" y="${r1(Y(N(x.q3)))}" width="32" height="${r1(Math.max(2, Y(N(x.q1)) - Y(N(x.q3))))}" fill="${foc ? t.accentTint : t.paper2}" stroke="${col}"/><line x1="${cx - 16}" x2="${cx + 16}" y1="${r1(Y(N(x.med)))}" y2="${r1(Y(N(x.med)))}" stroke="${col}" stroke-width="2"/>` + txt(ctx, cx, plotH + 18, x.label, { size: 11, anchor: 'middle' })); });
        return { w: left + plotW + 20, h: plotH + 30, body: b, legend: [] };
      }
      const pts = (d.points || []).slice(0, 20); const bubble = d.mode === 'bubble' || pts.some((p) => p.size != null);
      const sx = nice(Math.min(...pts.map((p) => N(p.x))), Math.max(...pts.map((p) => N(p.x)))), sy = nice(Math.min(...pts.map((p) => N(p.y))), Math.max(...pts.map((p) => N(p.y))));
      const X = (v) => left + ((v - sx.min) / (sx.max - sx.min)) * plotW, Y = (v) => plotH - ((v - sy.min) / (sy.max - sy.min)) * plotH; let b = '';
      for (let v = sy.min; v <= sy.max + 1e-9; v += sy.step) b += `<line x1="${left}" x2="${left + plotW}" y1="${r1(Y(v))}" y2="${r1(Y(v))}" stroke="${v === 0 ? t.ruleSolid : t.rule}"/>` + txt(ctx, left - 6, Y(v) + 3, fmtN(v), { size: 9, mono: true, anchor: 'end', fill: t.soft });
      for (let v = sx.min; v <= sx.max + 1e-9; v += sx.step) b += txt(ctx, X(v), plotH + 16, fmtN(v), { size: 9, mono: true, anchor: 'middle', fill: t.soft });
      if (d.xLabel) b += txt(ctx, left + plotW / 2, plotH + 36, d.xLabel, { size: 11, anchor: 'middle', fill: t.muted });
      if (d.yLabel) b += txt(ctx, left, -8, d.yLabel, { size: 11, fill: t.muted });
      const maxS = Math.max(1, ...pts.map((p) => N(p.size)));
      pts.forEach((p, i) => { ctx.counts.nodes++; const foc = !!p.focal; if (foc) ctx.counts.accent++; const rr = bubble ? 6 + (N(p.size) / maxS) * 18 : 5; const col = foc ? t.accent : t.series[1];
        ctx.table.push({ 항목: p.label || '', X: p.x, Y: p.y, 크기: p.size ?? '' }); ctx.blocks.push({ id: p.label || String(i), label: p.label || '' });
        b += ctx.anim(`p${i}`, `<circle cx="${r1(X(N(p.x)))}" cy="${r1(Y(N(p.y)))}" r="${r1(rr)}" fill="${col}" fill-opacity="${bubble ? 0.35 : 0.9}" stroke="${col}" stroke-width="1.5"/>` + (p.label ? txt(ctx, X(N(p.x)) + rr + 5, Y(N(p.y)) + 4, p.label, { size: 11, fill: foc ? t.accent : t.ink, weight: foc ? 600 : 400 }) : '')); });
      return { w: left + plotW + 90, h: plotH + 44, body: `<g transform="translate(0,14)">${b}</g>`, legend: [] };
    },
  });

  // ── 히트맵 ────────────────────────────────────────────────────────────
  reg({
    id: 'heatmap', ko: '히트맵', en: 'Heatmap', family: FAM.part, short: '교차표를 색 농도로',
    desc: '행×열 교차표의 값을 칸의 색 농도로 보여줍니다. 요일×시간, 월×항목처럼 패턴(몰리는 곳, 비는 곳)을 찾을 때 좋습니다.',
    when: '활동 패턴, 월별 지출 분포, 상관표', tips: 'values[행][열]. 가장 큰 칸이 강조됩니다. 단일 색조 농도만 사용합니다.',
    sample: { title: '요일별 활동', rows: ['월', '화', '수', '목', '금'], cols: ['오전', '오후', '저녁'], values: [[3, 5, 2], [4, 6, 1], [2, 7, 3], [5, 4, 2], [3, 8, 6]] },
    budget: { nodes: 40, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const rows = (d.rows || []).slice(0, 14), cols = (d.cols || []).slice(0, 16); const vals = rows.map((_, r) => cols.map((_, c) => N(((d.values || [])[r] || [])[c])));
      const flat = vals.flat(); const mn = Math.min(...flat, 0), mx = Math.max(...flat, 1); const lw = Math.max(40, ...rows.map((r) => tw(r, 11))) + 14; const cw = Math.max(52, ...cols.map((c) => tw(c, 11) + 12)); const ch = 32; let b = '';
      cols.forEach((c, j) => { b += txt(ctx, lw + j * cw + cw / 2, 12, c, { size: 11, anchor: 'middle', fill: t.muted }); });
      rows.forEach((r, i) => { b += txt(ctx, 0, 34 + i * ch + ch / 2 + 4, r, { size: 11, fill: t.muted });
        cols.forEach((c, j) => { const v = vals[i][j]; const k = (v - mn) / (mx - mn || 1); const foc = v === mx; ctx.counts.nodes += 0; ctx.table.push({ 행: r, 열: c, 값: v });
          b += ctx.anim(`h${i}`, `<rect x="${lw + j * cw + 2}" y="${24 + i * ch + 2}" width="${cw - 4}" height="${ch - 4}" rx="3" fill="${mix(t.paper2, t.accent, 0.12 + k * 0.78)}" stroke="${foc ? t.ink : 'none'}" stroke-width="1.5"/>` + (cw >= 44 ? txt(ctx, lw + j * cw + cw / 2, 24 + i * ch + ch / 2 + 4, String(v), { size: 10, mono: true, anchor: 'middle', fill: k > 0.55 ? t.paper : t.ink, weight: foc ? 600 : 400 }) : '')); }); });
      ctx.counts.nodes = rows.length * cols.length; ctx.counts.accent = 1;
      const lg = 24 + rows.length * ch + 16; b += txt(ctx, lw, lg + 8, fmtN(mn), { size: 9, mono: true, fill: t.soft });
      for (let i = 0; i < 8; i++) b += `<rect x="${lw + 30 + i * 18}" y="${lg}" width="18" height="10" fill="${mix(t.paper2, t.accent, 0.12 + (i / 7) * 0.78)}"/>`;
      b += txt(ctx, lw + 30 + 8 * 18 + 6, lg + 8, fmtN(mx), { size: 9, mono: true, fill: t.soft });
      return { w: lw + cols.length * cw, h: lg + 18, body: b, legend: [] };
    },
    budgetNote: 'cells',
  });

  // ── 레이더 ────────────────────────────────────────────────────────────
  reg({
    id: 'radar', ko: '레이더', en: 'Radar / spider', family: FAM.anal, short: '3~8개 기준에 걸친 점수 비교',
    desc: '여러 대상을 3~8개 기준으로 평가한 점수를 다각형으로 겹쳐 보여줍니다. 균형(모양)과 강약점을 한눈에 비교하는 용도입니다.',
    when: '옵션 비교, 역량 진단, 균형 점검', tips: 'axes + series[].values(0~max). 기준은 5~6개가 읽기 좋습니다. 강조 계열은 focal.',
    sample: { title: '이번 달 균형', max: 5, axes: ['운동', '학습', '재무', '관계', '휴식'], series: [{ name: '이번 달', values: [3, 5, 4, 2, 3], focal: true }, { name: '지난달', values: [4, 3, 3, 3, 4] }] },
    budget: { nodes: 8, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const ax = (d.axes || []).slice(0, 8); const n = Math.max(3, ax.length); const max = N(d.max) || Math.max(1, ...(d.series || []).flatMap((s) => (s.values || []).map(N))); const R = 120; const cx = 190, cy = 160;
      const P = (i, v) => { const a = -Math.PI / 2 + (i / n) * Math.PI * 2; return [cx + Math.cos(a) * R * (v / max), cy + Math.sin(a) * R * (v / max)]; };
      let b = '';
      for (let k = 1; k <= 4; k++) b += `<polygon points="${ax.map((_, i) => P(i, (max * k) / 4).map(r1).join(',')).join(' ')}" fill="none" stroke="${t.rule}"/>`;
      ax.forEach((a, i) => { const p = P(i, max); const lp = P(i, max * 1.16); b += `<line x1="${cx}" y1="${cy}" x2="${r1(p[0])}" y2="${r1(p[1])}" stroke="${t.rule}"/>` + txt(ctx, lp[0], lp[1] + 4, a, { size: 11, anchor: Math.abs(lp[0] - cx) < 6 ? 'middle' : lp[0] > cx ? 'start' : 'end', fill: t.muted }); });
      (d.series || []).slice(0, 5).forEach((s, si) => { const foc = !!s.focal; if (foc) ctx.counts.accent++; ctx.counts.nodes++; const col = seriesColor(ctx, si, foc); const pts = ax.map((_, i) => P(i, clamp(N((s.values || [])[i]), 0, max)));
        ctx.table.push({ 계열: s.name, ...Object.fromEntries(ax.map((a, i) => [a, (s.values || [])[i]])) }); ctx.blocks.push({ id: s.name, label: s.name });
        b += ctx.anim(`r${si}`, `<polygon points="${pts.map((p) => p.map(r1).join(',')).join(' ')}" fill="${col}" fill-opacity="${foc ? 0.22 : 0.14}" stroke="${col}" stroke-width="${foc ? 2.5 : 1.5}"/>` + pts.map((p) => `<circle cx="${r1(p[0])}" cy="${r1(p[1])}" r="3" fill="${col}"/>`).join('')); });
      return { w: 380, h: 330, body: b, legend: chartLegend(ctx, (d.series || []).map((s) => s.name), (d.series || []).findIndex((s) => s.focal)) };
    },
  });

  // ── 폴라(방사 롤리팝) ────────────────────────────────────────────────
  reg({
    id: 'polar', ko: '폴라 차트', en: 'Polar chart', family: FAM.chart, short: '순환하는 범주의 크기(각도=범주, 반지름=크기)',
    desc: '시계처럼 순환하는 범주(월·요일·시간)를 각도로, 크기를 중심에서 뻗는 막대(롤리팝) 길이로 보여줍니다. 계절성·주기성을 볼 때 좋습니다.',
    when: '월별 패턴, 시간대별 활동', tips: 'items[].label/value. 12개 이내가 보기 좋습니다.',
    sample: { title: '월별 수면 점수', items: ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'].map((m, i) => ({ label: `${m}월`, value: [6, 7, 5, 6, 8, 7, 4, 5, 8, 9, 7, 6][i], focal: m === '10' })) },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const it = (d.items || []).slice(0, 16); const n = Math.max(1, it.length); const max = Math.max(1, ...it.map((i) => N(i.value))); const R = 130; const r0 = 22; const cx = 190, cy = 170; let b = '';
      for (let k = 1; k <= 3; k++) b += `<circle cx="${cx}" cy="${cy}" r="${r1(r0 + ((R - r0) * k) / 3)}" fill="none" stroke="${t.rule}"/>`;
      it.forEach((x, i) => { ctx.counts.nodes++; const foc = !!x.focal; if (foc) ctx.counts.accent++; const a = -Math.PI / 2 + (i / n) * Math.PI * 2; const rr = r0 + (R - r0) * (N(x.value) / max); const col = foc ? t.accent : t.series[1];
        const x1 = cx + Math.cos(a) * r0, y1 = cy + Math.sin(a) * r0, x2 = cx + Math.cos(a) * rr, y2 = cy + Math.sin(a) * rr, lx = cx + Math.cos(a) * (R + 18), ly = cy + Math.sin(a) * (R + 18);
        ctx.table.push({ 항목: x.label, 값: x.value }); ctx.blocks.push({ id: x.label, label: x.label, value: x.value });
        b += ctx.anim(`p${i}`, `<line x1="${r1(x1)}" y1="${r1(y1)}" x2="${r1(x2)}" y2="${r1(y2)}" stroke="${col}" stroke-width="2"/><circle cx="${r1(x2)}" cy="${r1(y2)}" r="${foc ? 6 : 4}" fill="${col}"/>` + txt(ctx, lx, ly + 4, x.label, { size: 10, anchor: Math.abs(lx - cx) < 8 ? 'middle' : lx > cx ? 'start' : 'end', fill: foc ? t.accent : t.muted, weight: foc ? 600 : 400 })); });
      return { w: 380, h: 350, body: b, legend: [] };
    },
  });

  // ── 사분면 ────────────────────────────────────────────────────────────
  reg({
    id: 'quadrant', ko: '사분면', en: 'Quadrant', family: FAM.anal, short: '두 축으로 우선순위 정하기',
    desc: '두 기준(예: 영향도×노력)으로 항목을 네 구역에 놓아 무엇부터 할지 정합니다. 오른쪽 위 구역이 보통 "먼저 할 일"입니다.',
    when: '우선순위 매트릭스, 투자 분류', tips: 'x,y는 0~100. quads: [좌상,우상,좌하,우하] 이름.',
    sample: { title: '개선 과제 우선순위', xLabel: '노력 →', yLabel: '효과 ↑', quads: ['큰 효과·쉬움?', '지금 하기', '나중에', '재검토'], points: [{ label: '네이버 시세', x: 25, y: 85, focal: true }, { label: '드래그 순서', x: 40, y: 70 }, { label: '다이어그램', x: 80, y: 78 }, { label: 'D-day 정리', x: 20, y: 25 }] },
    budget: { nodes: 10, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const S = 360; const left = 30; let b = '';
      const q = d.quads || []; const pos = [[left, 0], [left + S / 2, 0], [left, S / 2], [left + S / 2, S / 2]];
      pos.forEach(([x, y], i) => { b += `<rect x="${x}" y="${y}" width="${S / 2}" height="${S / 2}" fill="${i === 1 ? t.accentTint : t.paper}" stroke="${t.ruleSolid}"/>` + txt(ctx, x + 10, y + 18, q[i] || '', { size: 9, mono: true, upper: true, fill: i === 1 ? t.accent : t.soft, track: 0.12, weight: 500 }); });
      b += txt(ctx, left + S / 2, S + 22, d.xLabel || '', { size: 11, anchor: 'middle', fill: t.muted }) + txt(ctx, left, -8, d.yLabel || '', { size: 11, fill: t.muted });
      const placed = [];
      (d.points || []).slice(0, 14).forEach((p, i) => { ctx.counts.nodes++; const foc = !!p.focal; if (foc) ctx.counts.accent++; let px = left + clamp(N(p.x), 2, 98) / 100 * S, py = S - clamp(N(p.y), 2, 98) / 100 * S;
        for (const o of placed) if (Math.abs(o[0] - px) < 18 && Math.abs(o[1] - py) < 18) py += 18; placed.push([px, py]); ctx.table.push({ 항목: p.label, X: p.x, Y: p.y }); ctx.blocks.push({ id: p.label, label: p.label });
        b += ctx.anim(`q${i}`, `<circle cx="${r1(px)}" cy="${r1(py)}" r="${foc ? 7 : 5}" fill="${foc ? t.accent : t.ink}" stroke="${t.paper}" stroke-width="2"/>` + txt(ctx, px + 11, py + 4, p.label, { size: 11, fill: foc ? t.accent : t.ink, weight: foc ? 600 : 400 })); });
      return { w: left + S + 130, h: S + 34, body: `<g transform="translate(0,14)">${b}</g>`, legend: [] };
    },
  });

  // ── 트리맵(+마리메코) ────────────────────────────────────────────────
  function squarify(items, x, y, w, h) {
    const total = items.reduce((s, i) => s + i.v, 0) || 1; const rects = []; let rest = items.slice().sort((a, b) => b.v - a.v); let rx = x, ry = y, rw = w, rh = h; let left = total;
    const worst = (row, side) => { const s = row.reduce((a, i) => a + i.v, 0); const a2 = (s / left) * rw * rh; const sd = side; const th = a2 / sd; let m = 0; for (const i of row) { const ia = (i.v / s) * a2; const iw = ia / th; m = Math.max(m, Math.max(iw / th, th / iw)); } return m; };
    while (rest.length) {
      const side = Math.min(rw, rh); const row = [rest[0]]; let k = 1;
      while (k < rest.length && worst(row.concat(rest[k]), side) <= worst(row, side)) { row.push(rest[k]); k++; }
      const s = row.reduce((a, i) => a + i.v, 0); const frac = s / left;
      if (rw >= rh) { const cw = rw * frac; let yy = ry; for (const i of row) { const hh = (i.v / s) * rh; rects.push({ ...i, x: rx, y: yy, w: cw, h: hh }); yy += hh; } rx += cw; rw -= cw; }
      else { const ch = rh * frac; let xx = rx; for (const i of row) { const ww = (i.v / s) * rw; rects.push({ ...i, x: xx, y: ry, w: ww, h: ch }); xx += ww; } ry += ch; rh -= ch; }
      left -= s; rest = rest.slice(row.length);
    }
    return rects;
  }
  reg({
    id: 'treemap', ko: '트리맵', en: 'Treemap', family: FAM.part, short: '전체에서 차지하는 비중(마리메코 변형)',
    desc: '전체를 사각형으로 쪼개 각 항목의 크기를 면적으로 보여줍니다. 보유 종목 비중처럼 "큰 것이 얼마나 큰가"가 핵심일 때 좋고, 2단 구성이면 마리메코(열 폭=합계) 변형을 씁니다.',
    when: '포트폴리오 비중, 지출 구성, 용량 사용', tips: 'items[].label/value. mode:"marimekko"면 columns[].segments.',
    sample: { title: '보유 종목 비중', unit: '원', items: [{ label: 'SK하이닉스', value: 900000 }, { label: '삼성전자', value: 725000, focal: true }, { label: 'NAVER', value: 410000 }, { label: '카카오', value: 230000 }, { label: '현대차', value: 180000 }] },
    budget: { nodes: 14, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const W = 620, H = 340;
      if (d.mode === 'marimekko') {
        const cols = (d.columns || []).slice(0, 6); const tot = cols.reduce((s, c) => s + (c.segments || []).reduce((a, x) => a + N(x.value), 0), 0) || 1; let x = 0; let b = '';
        cols.forEach((c, ci) => { const cs = (c.segments || []).reduce((a, s) => a + N(s.value), 0); const w = (cs / tot) * W; let y = 0;
          (c.segments || []).forEach((s, si) => { ctx.counts.nodes++; const h = (N(s.value) / (cs || 1)) * H; ctx.table.push({ 열: c.label, 항목: s.label, 값: s.value }); b += ctx.anim(`m${ci}`, `<rect x="${r1(x)}" y="${r1(y)}" width="${r1(w - 2)}" height="${r1(h - 2)}" fill="${mix(t.paper2, t.series[si % 5], 0.55)}" stroke="${t.paper}" stroke-width="2"/>` + (w > 60 && h > 22 ? txt(ctx, x + 8, y + 16, ellip(s.label, 11, w - 16), { size: 11 }) : '')); y += h; });
          b += txt(ctx, x + w / 2, H + 18, c.label, { size: 11, anchor: 'middle', fill: t.muted }); x += w; });
        return { w: W, h: H + 28, body: b, legend: [] };
      }
      const items = (d.items || []).slice(0, 24).map((i) => ({ ...i, v: Math.max(0, N(i.value)) })).filter((i) => i.v > 0); const total = items.reduce((s, i) => s + i.v, 0) || 1; const rects = squarify(items, 0, 0, W, H); let b = '';
      rects.forEach((r, i) => { ctx.counts.nodes++; const foc = !!r.focal; if (foc) ctx.counts.accent++; const pct = (r.v / total) * 100; ctx.table.push({ 항목: r.label, 값: `${fmtN(r.v)}${d.unit || ''}`, 비중: `${pct.toFixed(1)}%` }); ctx.blocks.push({ id: r.label, label: r.label, value: r.v });
        const fill = foc ? t.accentTint : mix(t.paper2, t.series[i % 5], 0.42);
        b += ctx.anim(`t${i}`, `<rect x="${r1(r.x + 1)}" y="${r1(r.y + 1)}" width="${r1(Math.max(0, r.w - 2))}" height="${r1(Math.max(0, r.h - 2))}" rx="4" fill="${fill}" stroke="${foc ? t.accent : t.paper}" stroke-width="${foc ? 1.5 : 2}"/>` + (r.w > 70 && r.h > 34 ? txt(ctx, r.x + 10, r.y + 20, ellip(r.label, 12, r.w - 20), { size: 12, weight: 600, fill: foc ? t.accent : t.ink }) + txt(ctx, r.x + 10, r.y + 36, `${pct.toFixed(1)}% · ${fmtN(r.v)}${d.unit || ''}`, { size: 9, mono: true, fill: t.soft }) : '')); });
      return { w: W, h: H, body: b, legend: [] };
    },
  });

  // ── 피라미드/퍼널 ────────────────────────────────────────────────────
  reg({
    id: 'pyramid', ko: '피라미드 / 퍼널', en: 'Pyramid / funnel', family: FAM.part, short: '위계 또는 단계별 이탈',
    desc: '위계(맨 위가 가장 좁음)를 피라미드로, 단계별 전환·이탈을 퍼널(mode:"funnel")로 보여줍니다. 퍼널은 값에 비례한 폭과 단계 간 전환율을 붙입니다.',
    when: '전환 깔때기, 욕구 위계, 우선순위 단계', tips: 'levels[].label/value(퍼널은 value 필수, 내림차순).',
    sample: { title: '관심주제 → 읽음 전환', mode: 'funnel', levels: [{ label: '수집', value: 120 }, { label: '키워드 통과', value: 64 }, { label: '화면 노출', value: 40 }, { label: '읽음', value: 18, focal: true }] },
    budget: { nodes: 7, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const lv = (d.levels || []).slice(0, 8); const W = 420; const rh = 52; const H = lv.length * rh; const funnel = d.mode === 'funnel'; const max = Math.max(1, ...lv.map((l) => N(l.value))); let b = '';
      lv.forEach((l, i) => { ctx.counts.nodes++; const foc = !!l.focal; if (foc) ctx.counts.accent++; let w1, w2;
        if (funnel) { w1 = (N(l.value) / max) * W; w2 = i < lv.length - 1 ? (N(lv[i + 1].value) / max) * W : w1 * 0.8; } else { w1 = ((i) / lv.length) * W + 24; w2 = ((i + 1) / lv.length) * W + 24; }
        const cx = W / 2; const y = i * rh; const col = foc ? t.accent : t.series[1];
        const conv = funnel && i > 0 && N(lv[i - 1].value) ? `${Math.round((N(l.value) / N(lv[i - 1].value)) * 100)}%` : '';
        ctx.table.push({ 단계: l.label, 값: l.value ?? '', 전환: conv }); ctx.blocks.push({ id: l.label, label: l.label });
        b += ctx.anim(`l${i}`, `<polygon points="${r1(cx - w1 / 2)},${y + 2} ${r1(cx + w1 / 2)},${y + 2} ${r1(cx + w2 / 2)},${y + rh - 2} ${r1(cx - w2 / 2)},${y + rh - 2}" fill="${foc ? t.accentTint : mix(t.paper2, col, 0.4)}" stroke="${foc ? t.accent : t.ink}" stroke-width="${foc ? 1.5 : 1}"/>` + txt(ctx, cx, y + rh / 2 + 4, `${l.label}${funnel && l.value != null ? ` · ${fmtN(N(l.value))}` : ''}`, { size: 12, weight: 600, anchor: 'middle', fill: foc ? t.accent : t.ink }) + (conv ? txt(ctx, W + 18, y + rh / 2 + 4, `← ${conv}`, { size: 10, mono: true, fill: t.soft }) : '')); });
      return { w: W + 80, h: H, body: b, legend: [] };
    },
  });

  // ── 벤 ────────────────────────────────────────────────────────────────
  reg({
    id: 'venn', ko: '벤 다이어그램', en: 'Venn', family: FAM.anal, short: '집합의 겹침',
    desc: '둘 또는 세 집합의 겹치는 부분을 보여줍니다. 교집합에 이름을 붙이면 "여기가 우리가 노릴 자리"를 설명하기 쉽습니다.',
    when: '역량·시장 교집합, 개념 정리', tips: 'sets: 2~3개. overlaps[].sets = 인덱스 배열, label.',
    sample: { title: '내가 만들 수 있고 필요한 것', sets: [{ label: '필요한 것' }, { label: '할 수 있는 것' }, { label: '즐거운 것' }], overlaps: [{ sets: [0, 1], label: '실용' }, { sets: [0, 1, 2], label: '지금 할 일', focal: true }] },
    budget: { nodes: 6, edges: 0 },
    render(d, ctx) {
      const t = ctx.tok; const sets = (d.sets || []).slice(0, 3); const R = 100; const cx = 220, cy = 170; const pos = sets.length === 2 ? [[cx - 60, cy], [cx + 60, cy]] : [[cx - 55, cy - 40], [cx + 55, cy - 40], [cx, cy + 55]]; let b = '';
      sets.forEach((s, i) => { ctx.counts.nodes++; ctx.table.push({ 집합: s.label }); ctx.blocks.push({ id: s.label, label: s.label }); const c = t.series[i % 5]; const lx = pos[i][0] + (pos[i][0] - cx) * 0.9, ly = pos[i][1] + (pos[i][1] - cy) * 0.9 + (sets.length === 3 && i === 2 ? 30 : 0);
        b += ctx.anim(`s${i}`, `<circle cx="${pos[i][0]}" cy="${pos[i][1]}" r="${R}" fill="${c}" fill-opacity="0.2" stroke="${c}" stroke-width="1.5"/>` + txt(ctx, lx + (i === 0 ? -10 : i === 1 ? 10 : 0), ly + (i === 2 ? 0 : -(R * 0.55)) + (sets.length === 2 ? R * 0.55 : 0) , s.label, { size: 12, weight: 600, anchor: 'middle' })); });
      for (const o of d.overlaps || []) { const ids = o.sets || []; const px = ids.reduce((s, i) => s + (pos[i] ? pos[i][0] : cx), 0) / (ids.length || 1), py = ids.reduce((s, i) => s + (pos[i] ? pos[i][1] : cy), 0) / (ids.length || 1); if (o.focal) ctx.counts.accent++; ctx.table.push({ 집합: ids.map((i) => (sets[i] || {}).label).join(' ∩ '), 의미: o.label });
        b += ctx.anim('o', txt(ctx, px, py + 4, o.label, { size: 11, weight: 600, anchor: 'middle', fill: o.focal ? t.accent : t.ink })); }
      return { w: 440, h: 330, body: b, legend: [] };
    },
  });

  // ── 생키 ──────────────────────────────────────────────────────────────
  reg({
    id: 'sankey', ko: '생키', en: 'Sankey', family: FAM.part, short: '흐름의 분기·합류와 양(띠 두께)',
    desc: '어떤 양이 여러 단계를 거치며 갈라지고 합쳐지는 모습을 띠의 두께로 보여줍니다. 자금 흐름, 트래픽 경로, 에너지 배분처럼 "어디로 얼마가 갔나"에 좋습니다.',
    when: '수입→지출 흐름, 계좌→종목 배분', tips: 'nodes[{id,label}], links[{from,to,value}]. 열은 자동 계산(최대 5단).',
    sample: { title: '자산 배분 흐름', unit: '만', nodes: [{ id: 'a', label: 'KB증권' }, { id: 'b', label: 'SK증권' }, { id: 'k', label: '국내 주식' }, { id: 'u', label: '해외 주식' }, { id: 's', label: '반도체', focal: true }, { id: 'o', label: '기타' }],
      links: [{ from: 'a', to: 'k', value: 600 }, { from: 'b', to: 'k', value: 300 }, { from: 'b', to: 'u', value: 200 }, { from: 'k', to: 's', value: 700, focal: true }, { from: 'k', to: 'o', value: 200 }, { from: 'u', to: 'o', value: 200 }] },
    budget: { nodes: 12, edges: 14 },
    render(d, ctx) {
      const t = ctx.tok; const nodes = (d.nodes || []).slice(0, 14); const links = (d.links || []).filter((l) => N(l.value) > 0); const ids = new Set(nodes.map((n) => n.id));
      const L = links.filter((l) => ids.has(l.from) && ids.has(l.to)); const rank = new Map(nodes.map((n) => [n.id, 0]));
      for (let k = 0; k < 6; k++) for (const l of L) rank.set(l.to, Math.max(rank.get(l.to), rank.get(l.from) + 1));
      const maxR = Math.max(0, ...rank.values()); const flowIn = new Map(), flowOut = new Map();
      for (const l of L) { flowOut.set(l.from, (flowOut.get(l.from) || 0) + N(l.value)); flowIn.set(l.to, (flowIn.get(l.to) || 0) + N(l.value)); }
      const val = (n) => Math.max(flowIn.get(n.id) || 0, flowOut.get(n.id) || 0, 1);
      const H = 300, colGap = 200, nw = 14, pad = 14; const cols = Array.from({ length: maxR + 1 }, () => []); for (const n of nodes) cols[rank.get(n.id)].push(n);
      const maxTotal = Math.max(...cols.map((c) => c.reduce((s, n) => s + val(n), 0) + pad * (c.length - 1)), 1); const k = (H - 0) / maxTotal; const pos = new Map();
      cols.forEach((c, ci) => { const tot = c.reduce((s, n) => s + val(n) * k, 0) + pad * (c.length - 1); let y = (H - tot) / 2; for (const n of c) { const h = Math.max(4, val(n) * k); pos.set(n.id, { x: 80 + ci * colGap, y, h, inOff: 0, outOff: 0 }); y += h + pad; } });
      let b = '';
      L.sort((a, c) => pos.get(a.to).y - pos.get(c.to).y).forEach((l, i) => { const a = pos.get(l.from), z = pos.get(l.to); const h = N(l.value) * k; const x1 = a.x + nw, x2 = z.x, y1 = a.y + a.outOff, y2 = z.y + z.inOff; a.outOff += h; z.inOff += h; const mx = (x1 + x2) / 2; ctx.counts.edges++; if (l.focal) ctx.counts.accent += 0;
        ctx.table.push({ 구분: '흐름', 이름: `${(nodes.find((n) => n.id === l.from) || {}).label} → ${(nodes.find((n) => n.id === l.to) || {}).label}`, 값: `${fmtN(N(l.value))}${d.unit || ''}` });
        b += ctx.anim(`f${rank.get(l.from)}`, `<path d="M${r1(x1)},${r1(y1)} C${r1(mx)},${r1(y1)} ${r1(mx)},${r1(y2)} ${r1(x2)},${r1(y2)} L${r1(x2)},${r1(y2 + h)} C${r1(mx)},${r1(y2 + h)} ${r1(mx)},${r1(y1 + h)} ${r1(x1)},${r1(y1 + h)} Z" fill="${l.focal ? t.accent : t.muted}" fill-opacity="${l.focal ? 0.4 : 0.22}" stroke="${l.focal ? t.accent : t.muted}" stroke-opacity="0.5" stroke-width="0.8"/>`); });
      nodes.forEach((n) => { const p = pos.get(n.id); ctx.counts.nodes++; if (n.focal) ctx.counts.accent++; ctx.blocks.push({ id: n.id, label: n.label, value: val(n) });
        const right = rank.get(n.id) === maxR && maxR > 0; b += ctx.anim(`n${rank.get(n.id)}`, `<rect x="${p.x}" y="${r1(p.y)}" width="${nw}" height="${r1(p.h)}" fill="${n.focal ? t.accent : t.ink}"/>` + txt(ctx, right ? p.x - 6 : p.x + nw + 6, p.y + p.h / 2 + 4, `${n.label} ${fmtN(val(n))}`, { size: 11, anchor: right ? 'end' : 'start', fill: n.focal ? t.accent : t.ink, weight: n.focal ? 600 : 400 })); });
      return { w: 80 + (maxR + 1) * colGap, h: H, body: b, legend: [{ type: 'line', label: '흐름의 양 = 띠 두께', color: t.muted }] };
    },
  });
})(typeof window !== 'undefined' ? window : globalThis);
