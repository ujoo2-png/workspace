// Analytics 화면. 주요 지표를 간단한 막대/선 차트로 보여준다.
// 외부 차트 라이브러리 없이 인라인 SVG로 그린다(빌드 스텝 없는 vanilla 구조 유지).
// 단일 지표(수량)를 카테고리별로 보여주는 차트이므로 단색(single-hue) + 직접 라벨 방식을 쓰고,
// 축은 하나만 사용하며(이중 y축 금지), 얇은 막대/선 + 둥근 끝(4px) + 값 직접 표기로 그린다.
// 일반 <script>로 로드된다.
(function () {
  const { appState, el, todayISO, addDays } = window;

  const HUE = '#3b82f6'; // 단일 지표용 시퀀셜 기본 색상(카테고리 식별용 아님)
  const AXIS_COLOR = '#94a3b8';

  function renderAnalytics(root) {
    const container = el('div', {});
    root.append(container);

    function draw() {
      container.innerHTML = '';
      container.append(el('div', { class: 'page-header' }, [el('h1', {}, 'Analytics')]));

      const grid = el('div', { class: 'grid-2' });
      grid.append(scheduleCompletionCard());
      grid.append(projectStatusCard());
      grid.append(challengeCheckinCard());
      grid.append(notificationSeverityCard());
      grid.append(tagDistributionCard());
      container.append(grid);
    }

    function scheduleCompletionCard() {
      const today = todayISO();
      const days = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6));
      const values = days.map((d) => appState.schedules.filter((s) => s.date === d && s.done).length);
      const labels = days.map((d) => d.slice(5)); // MM-DD
      return chartCard('최근 7일 완료한 일정', barChart(labels, values));
    }

    function projectStatusCard() {
      const STATUS_LABEL = { planned: '계획', in_progress: '진행 중', completed: '완료', paused: '보류' };
      const keys = Object.keys(STATUS_LABEL);
      const values = keys.map((k) => appState.projects.filter((p) => p.status === k).length);
      const labels = keys.map((k) => STATUS_LABEL[k]);
      return chartCard('프로젝트 상태 분포', barChart(labels, values));
    }

    function challengeCheckinCard() {
      const today = todayISO();
      const weeks = Array.from({ length: 8 }, (_, i) => {
        const start = addDays(today, (i - 7) * 7);
        const end = addDays(start, 6);
        return { start, end };
      });
      const allCheckins = Object.values(appState.checkinsByChallenge).flat();
      const values = weeks.map((w) => allCheckins.filter((c) => c.checkin_date >= w.start && c.checkin_date <= w.end).length);
      const labels = weeks.map((w) => w.start.slice(5));
      return chartCard('최근 8주 챌린지 체크인 추이', lineChart(labels, values));
    }

    // 개발계획서 3장 Analytics "태그 분포" — Schedule/Project/Devlog/Knowledge에 흩어진 태그를 합산한다.
    function tagDistributionCard() {
      const all = [
        ...appState.schedules.flatMap((s) => s.tags || []),
        ...appState.projects.flatMap((p) => p.tags || []),
        ...appState.devlogs.flatMap((d) => d.tags || []),
        ...appState.knowledgeDocs.flatMap((k) => k.tags || []),
      ];
      const counts = {};
      for (const t of all) counts[t] = (counts[t] || 0) + 1;
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6);
      if (!top.length) {
        return el('div', { class: 'nm-card' }, [el('h3', {}, '태그 분포'), el('div', { class: 'empty-state' }, '아직 등록된 태그가 없습니다.')]);
      }
      return chartCard('태그 분포 (상위 6개)', barChart(top.map(([t]) => `#${t}`), top.map(([, c]) => c)));
    }

    function notificationSeverityCard() {
      const SEVERITY_LABEL = { info: '정보', warning: '경고', critical: '긴급' };
      const keys = Object.keys(SEVERITY_LABEL);
      const values = keys.map((k) => appState.notifications.filter((n) => n.severity === k).length);
      const labels = keys.map((k) => SEVERITY_LABEL[k]);
      return chartCard('알림 심각도 분포', barChart(labels, values));
    }

    function chartCard(title, svgNode) {
      return el('div', { class: 'nm-card' }, [el('h3', {}, title), svgNode]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  // 얇은 세로 막대 + 4px 둥근 상단 + 직접 라벨. 단일 지표이므로 범례 없음.
  function barChart(labels, values, hue = HUE) {
    const W = 320;
    const H = 160;
    const padL = 8;
    const padB = 22;
    const padT = 18;
    const max = Math.max(1, ...values);
    const n = values.length;
    const slot = (W - padL * 2) / n;
    const barW = Math.min(28, slot * 0.5);
    const svg = svgEl(W, H);

    // 축선(recessive)
    svg.append(lineEl(padL, H - padB, W - padL, H - padB, AXIS_COLOR, 1));

    values.forEach((v, i) => {
      const x = padL + slot * i + (slot - barW) / 2;
      const barH = max > 0 ? ((H - padB - padT) * v) / max : 0;
      const y = H - padB - barH;
      svg.append(rectEl(x, y, barW, Math.max(barH, 1), hue, 4));
      svg.append(textEl(x + barW / 2, y - 4, String(v), { fontSize: 11, fill: '#1e293b', anchor: 'middle' }));
      svg.append(textEl(x + barW / 2, H - padB + 14, labels[i], { fontSize: 10, fill: AXIS_COLOR, anchor: 'middle' }));
    });
    return svg;
  }

  // 얇은 선(2px) + 마커(>=8px 히트영역 대응은 생략, 값이 적어 직접 라벨만) + 축 하나.
  function lineChart(labels, values, hue = HUE) {
    const W = 320;
    const H = 160;
    const padL = 8;
    const padB = 22;
    const padT = 18;
    const max = Math.max(1, ...values);
    const n = values.length;
    const stepX = (W - padL * 2) / Math.max(1, n - 1);
    const svg = svgEl(W, H);
    svg.append(lineEl(padL, H - padB, W - padL, H - padB, AXIS_COLOR, 1));

    const points = values.map((v, i) => {
      const x = padL + stepX * i;
      const y = H - padB - (max > 0 ? ((H - padB - padT) * v) / max : 0);
      return [x, y];
    });
    const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', pathD);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', hue);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-linecap', 'round');
    path.setAttribute('stroke-linejoin', 'round');
    svg.append(path);

    points.forEach(([x, y], i) => {
      svg.append(circleEl(x, y, 3, hue));
      if (i === points.length - 1 || i === 0 || values[i] === max) {
        svg.append(textEl(x, y - 8, String(values[i]), { fontSize: 10, fill: '#1e293b', anchor: 'middle' }));
      }
      if (i % Math.ceil(n / 6 || 1) === 0) {
        svg.append(textEl(x, H - padB + 14, labels[i], { fontSize: 9, fill: AXIS_COLOR, anchor: 'middle' }));
      }
    });
    return svg;
  }

  function svgEl(w, h) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', String(h));
    svg.setAttribute('role', 'img');
    return svg;
  }
  function lineEl(x1, y1, x2, y2, stroke, width) {
    const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    l.setAttribute('x1', x1); l.setAttribute('y1', y1); l.setAttribute('x2', x2); l.setAttribute('y2', y2);
    l.setAttribute('stroke', stroke); l.setAttribute('stroke-width', width);
    return l;
  }
  function rectEl(x, y, w, h, fill, rx) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('x', x); r.setAttribute('y', y); r.setAttribute('width', w); r.setAttribute('height', h);
    r.setAttribute('fill', fill); r.setAttribute('rx', rx);
    return r;
  }
  function circleEl(cx, cy, r, fill) {
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', cx); c.setAttribute('cy', cy); c.setAttribute('r', r); c.setAttribute('fill', fill);
    return c;
  }
  function textEl(x, y, text, { fontSize = 10, fill = '#1e293b', anchor = 'start' } = {}) {
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('font-size', String(fontSize));
    t.setAttribute('fill', fill);
    t.setAttribute('text-anchor', anchor);
    t.textContent = text;
    return t;
  }

  window.renderAnalytics = renderAnalytics;
  // 다른 화면(차량관리의 주행거리·연비 추이 등)에서도 같은 인라인 SVG 차트를 재사용할 수 있게
  // 공개한다. 색상만 바꿔 쓸 수 있게 hue 인자를 추가로 받는다(기본은 이 화면과 동일한 파랑).
  window.simpleBarChart = function (labels, values, hue) { return barChart(labels, values, hue); };
  window.simpleLineChart = function (labels, values, hue) { return lineChart(labels, values, hue); };
})();
