// 가벼운 가격 차트 (v7.31.0) — 환율·주가 공용. 외부 라이브러리 없음.
// PriceChart.stats(series) 순수 함수 + PriceChart.render(series, opts) SVG 선/면 차트(마우스·터치 십자선 툴팁).
// series: [{date:'YYYY-MM-DD', v:number}] 오름차순.
(function () {
  const NS = 'http://www.w3.org/2000/svg';

  function stats(series) {
    const s = (series || []).filter((r) => Number.isFinite(r.v));
    if (!s.length) return null;
    let hi = s[0], lo = s[0], sum = 0;
    for (const r of s) { if (r.v > hi.v) hi = r; if (r.v < lo.v) lo = r; sum += r.v; }
    const first = s[0], last = s[s.length - 1];
    return { first, last, high: hi, low: lo, avg: sum / s.length, change: last.v - first.v, changeRate: first.v ? ((last.v - first.v) / first.v) * 100 : null, count: s.length };
  }

  const svg = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

  function render(series, opts = {}) {
    const { height = 220, fmt = (v) => Number(v).toLocaleString('ko-KR', { maximumFractionDigits: 2 }), refLines = [], upIsRed = true } = opts;
    const wrap = document.createElement('div');
    wrap.className = 'pchart';
    const st = stats(series);
    if (!st || series.length < 2) { wrap.className = 'pchart pchart--empty text-muted'; wrap.textContent = '표시할 데이터가 부족합니다.'; return wrap; }

    const W = 640, H = height, padL = 8, padR = 56, padT = 12, padB = 22;
    const vals = series.map((r) => r.v).concat(refLines.map((r) => r.value).filter(Number.isFinite));
    let min = Math.min(...vals), max = Math.max(...vals);
    const gap = (max - min) || max * 0.01 || 1; min -= gap * 0.08; max += gap * 0.08;
    const x = (i) => padL + (i / (series.length - 1)) * (W - padL - padR);
    const y = (v) => padT + (1 - (v - min) / (max - min)) * (H - padT - padB);
    const up = st.change >= 0;
    const tone = up === upIsRed ? 'pchart--red' : 'pchart--blue';
    wrap.classList.add(tone);

    const root = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'pchart__svg', role: 'img', 'aria-label': '가격 추이 차트', preserveAspectRatio: 'none' });
    for (let k = 0; k <= 3; k++) { // 가로 눈금
      const v = min + ((max - min) * k) / 3, yy = y(v);
      root.append(svg('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: 'pchart__grid' }));
      const t = svg('text', { x: W - padR + 4, y: yy + 3, class: 'pchart__axis' }); t.textContent = fmt(v); root.append(t);
    }
    const pts = series.map((r, i) => `${x(i).toFixed(1)},${y(r.v).toFixed(1)}`);
    root.append(svg('polygon', { points: `${x(0)},${H - padB} ${pts.join(' ')} ${x(series.length - 1)},${H - padB}`, class: 'pchart__area' }));
    root.append(svg('polyline', { points: pts.join(' '), class: 'pchart__line', fill: 'none' }));
    for (const rl of refLines) {
      if (!Number.isFinite(rl.value)) continue;
      const yy = y(rl.value);
      root.append(svg('line', { x1: padL, x2: W - padR, y1: yy, y2: yy, class: `pchart__ref ${rl.cls || ''}` }));
      const t = svg('text', { x: padL + 2, y: yy - 3, class: `pchart__reflabel ${rl.cls || ''}` }); t.textContent = `${rl.label} ${fmt(rl.value)}`; root.append(t);
    }
    // 시작/끝 날짜
    const d0 = svg('text', { x: padL, y: H - 6, class: 'pchart__axis' }); d0.textContent = series[0].date; root.append(d0);
    const d1 = svg('text', { x: W - padR, y: H - 6, class: 'pchart__axis', 'text-anchor': 'end' }); d1.textContent = series[series.length - 1].date; root.append(d1);
    const cross = svg('line', { y1: padT, y2: H - padB, class: 'pchart__cross', visibility: 'hidden' });
    const dot = svg('circle', { r: 4, class: 'pchart__dot', visibility: 'hidden' });
    root.append(cross, dot);

    const tip = document.createElement('div'); tip.className = 'pchart__tip'; tip.hidden = true;
    wrap.append(root, tip);

    function at(ev) {
      const r = root.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.max(0, Math.min(series.length - 1, Math.round(((px - padL) / (W - padL - padR)) * (series.length - 1))));
      const row = series[i], xx = x(i), yy = y(row.v);
      cross.setAttribute('x1', xx); cross.setAttribute('x2', xx); cross.setAttribute('visibility', 'visible');
      dot.setAttribute('cx', xx); dot.setAttribute('cy', yy); dot.setAttribute('visibility', 'visible');
      tip.hidden = false; tip.textContent = `${row.date}  ${fmt(row.v)}`;
      const leftPct = (xx / W) * 100;
      tip.style.left = `${Math.min(80, Math.max(2, leftPct - 10))}%`;
    }
    const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); dot.setAttribute('visibility', 'hidden'); };
    root.addEventListener('pointermove', at);
    root.addEventListener('pointerdown', at);
    root.addEventListener('pointerleave', hide);
    return wrap;
  }

  window.PriceChart = { stats, render };
})();
