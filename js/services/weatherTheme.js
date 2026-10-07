// 시계 카드 날씨 테마 — 순수 함수 모음(v7.21.0). DOM/네트워크 의존 없음 → Node 테스트에서 그대로 평가한다.
//   weatherTheme(forecastDay, hour) → { condition, label, part, partLabel, pop, precip, gradient, textColor, caption, ... }
// forecastDay: { date, code?, pop?, precip?, hourly?: [{h, code?(WMO), pty?, sky?(기상청), pop?, precip?}] }
//   · hourly가 있으면 "지금 시간대(오전/오후/저녁/밤)"에 해당하는 슬롯만 보고 그 구간의 가장 심한 날씨를 고른다("오전 비").
//   · 없으면 하루 요약(code/pop)으로 판단한다.
(function () {
  const COND_LABEL = { clear: '맑음', partly: '구름조금', cloudy: '흐림', rain: '비', snow: '눈', thunder: '뇌우', fog: '안개' };
  // 심한 정도(높을수록 우선): 같은 시간대에 여러 상태가 있으면 가장 높은 것을 대표로 쓴다.
  const SEVERITY = { clear: 0, partly: 1, cloudy: 2, fog: 3, rain: 4, snow: 5, thunder: 6 };
  const PART_LABEL = { morning: '오전', afternoon: '오후', evening: '저녁', night: '밤' };
  const MAX_PARTICLES = 40;

  function conditionFromWmo(code) {
    if (code === null || code === undefined) return null;
    if (code === 0) return 'clear';
    if (code === 1 || code === 2) return 'partly';
    if (code === 3) return 'cloudy';
    if (code === 45 || code === 48) return 'fog';
    if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
    if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
    if (code >= 95) return 'thunder';
    return 'cloudy';
  }
  // 기상청 단기예보: PTY(강수형태) 1비 2비/눈 3눈 4소나기 5빗방울 6빗방울눈날림 7눈날림, SKY 1맑음 3구름많음 4흐림
  function conditionFromKma(pty, sky) {
    if (pty === 1 || pty === 4 || pty === 5) return 'rain';
    if (pty === 2 || pty === 3 || pty === 6 || pty === 7) return 'snow';
    if (sky === 4) return 'cloudy';
    if (sky === 3) return 'partly';
    if (sky === 1) return 'clear';
    return null;
  }

  /** 시(0-23) → 시간대. 5-11 오전, 12-16 오후, 17-18 저녁(노을), 19-4 밤. */
  function dayPartOf(hour) {
    const h = ((Math.floor(hour) % 24) + 24) % 24;
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 17) return 'afternoon';
    if (h >= 17 && h < 19) return 'evening';
    return 'night';
  }
  function hoursOfPart(part) {
    return { morning: [5, 6, 7, 8, 9, 10, 11], afternoon: [12, 13, 14, 15, 16], evening: [17, 18], night: [19, 20, 21, 22, 23, 0, 1, 2, 3, 4] }[part];
  }

  function slotCondition(slot) {
    return conditionFromKma(slot.pty, slot.sky) || conditionFromWmo(slot.code) || null;
  }

  // 구름 상태 + 강수확률 → 비(예보)로 승격: "흐림인데 강수확률 70%"는 비 예보로 보여 준다.
  function promoteByPop(cond, pop, precip) {
    if (['clear', 'partly', 'cloudy', 'fog'].includes(cond)) {
      if (pop >= 70 || (pop >= 60 && precip >= 0.5)) return 'rain';
    }
    return cond;
  }

  /**
   * 한 시간대의 대표 상태를 고른다.
   * hour 이후(포함, 직전 1시간부터)의 슬롯 중 해당 시간대 슬롯만 사용하고, 남은 슬롯이 없으면 시간대 전체를 본다.
   */
  function pickSlot(day, hour) {
    const part = dayPartOf(hour);
    const hrs = hoursOfPart(part);
    const all = (day.hourly || []).filter((s) => hrs.includes(s.h));
    const upcoming = all.filter((s) => (part === 'night' && s.h < 5 ? hour >= 19 || hour < 5 : true) && (s.h >= hour - 1 || (part === 'night' && s.h < 5 && hour >= 19)));
    const use = upcoming.length ? upcoming : all;
    if (!use.length) return { cond: null, pop: null, precip: null, n: 0 };
    let cond = null; let pop = 0; let precip = 0;
    for (const s of use) {
      const c = slotCondition(s);
      if (c && (cond === null || SEVERITY[c] > SEVERITY[cond])) cond = c;
      if (typeof s.pop === 'number') pop = Math.max(pop, s.pop);
      if (typeof s.precip === 'number') precip += s.precip;
    }
    return { cond, pop, precip: Math.round(precip * 10) / 10, n: use.length };
  }

  // ---- 색 팔레트(위→아래 3스톱) + 대비 계산 ----
  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function relLuminance(hex) {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const c = v / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  /** WCAG 대비비(1~21). */
  function contrastRatio(hexA, hexB) {
    const a = relLuminance(hexA); const b = relLuminance(hexB);
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
  }
  const TEXT_LIGHT = '#ffffff';
  const TEXT_DARK = '#0b1220';

  // 낮(오전/오후) · 저녁 · 밤 3벌. 조건별로 "흐린 날은 회청색, 비는 짙은 청회색, 맑음은 하늘색/노을, 밤은 남색, 눈은 옅은 하늘/백색".
  const PALETTES = {
    clear:   { morning: ['#59b4f5', '#8fd0ff', '#cfe9fb'], afternoon: ['#2f8fe0', '#63b5f2', '#a5d6f7'], evening: ['#4a2a5a', '#8f3f55', '#b0502c'], night: ['#0b1d4a', '#16295e', '#243a78'] },
    partly:  { morning: ['#6fa8d6', '#a5c8e4', '#d4e4ef'], afternoon: ['#4d8fc7', '#86b4d8', '#bcd6e8'], evening: ['#3f3556', '#74443f', '#a2552c'], night: ['#122448', '#1d2f58', '#2b3d68'] },
    cloudy:  { morning: ['#8795a3', '#a9b5c0', '#cdd5dc'], afternoon: ['#6f7f8f', '#93a1ae', '#b7c1ca'], evening: ['#45414f', '#5f5258', '#7a615d'], night: ['#222a38', '#2e3848', '#3b4659'] },
    rain:    { morning: ['#3b4c61', '#4d647c', '#5f7790'], afternoon: ['#364559', '#4a5f77', '#5e748c'], evening: ['#33323f', '#463f4d', '#5a4a52'], night: ['#151c29', '#1e2837', '#283548'] },
    snow:    { morning: ['#d6e6f5', '#e8f1fa', '#f8fbfe'], afternoon: ['#c9ddf0', '#e1edf8', '#f5f9fd'], evening: ['#a9a3c4', '#c9bfd0', '#e4d6d4'], night: ['#34415c', '#46577a', '#5b6f96'] },
    thunder: { morning: ['#2f354b', '#444260', '#58496f'], afternoon: ['#262b3f', '#393a58', '#4d4466'], evening: ['#23213a', '#352c4a', '#4b3a55'], night: ['#0f1220', '#191a30', '#25223e'] },
    fog:     { morning: ['#aeb8c1', '#c6ced4', '#e0e5e9'], afternoon: ['#a0abb5', '#bac3cb', '#d6dce1'], evening: ['#938f9a', '#aea5ab', '#cbbdbb'], night: ['#2a3140', '#363e4e', '#454e60'] },
  };

  /** 그라디언트의 모든 스톱에서 대비가 더 높은 글자색(흰색/짙은 남색)을 고른다. */
  function pickTextColor(stops) {
    const minOf = (txt) => Math.min(...stops.map((s) => contrastRatio(s, txt)));
    const light = minOf(TEXT_LIGHT); const dark = minOf(TEXT_DARK);
    return light >= dark ? { color: TEXT_LIGHT, ratio: light } : { color: TEXT_DARK, ratio: dark };
  }

  function particleSpec(cond, pop, precip) {
    if (cond === 'rain') return { type: 'rain', count: Math.min(MAX_PARTICLES, pop >= 80 || precip >= 5 ? 36 : pop >= 60 ? 28 : 20) };
    if (cond === 'thunder') return { type: 'rain', count: 34 };
    if (cond === 'snow') return { type: 'snow', count: Math.min(MAX_PARTICLES, pop >= 70 ? 30 : 22) };
    return { type: null, count: 0 };
  }

  /**
   * @param {object} day 예보 하루(또는 null)
   * @param {number} hour 도시 현지 시각(0-23)
   * @returns {object|null} day가 없으면 null
   */
  function weatherTheme(day, hour) {
    if (!day) return null;
    const part = dayPartOf(hour);
    const slot = pickSlot(day, hour);
    let cond = slot.cond || conditionFromKma(day.pty, day.sky) || conditionFromWmo(day.code);
    // 하루 요약에서 구름 정도를 모를 때(기상청 중기 등) detail 텍스트로 보조
    if (!cond && day.detail) {
      if (/뇌우|천둥/.test(day.detail)) cond = 'thunder';
      else if (/눈/.test(day.detail)) cond = 'snow';
      else if (/비|소나기/.test(day.detail)) cond = 'rain';
      else if (/흐림/.test(day.detail)) cond = 'cloudy';
      else if (/구름/.test(day.detail)) cond = 'partly';
      else if (/맑음/.test(day.detail)) cond = 'clear';
    }
    const pop = slot.n ? slot.pop : (typeof day.pop === 'number' ? day.pop : null);
    const precip = slot.n ? slot.precip : (typeof day.precip === 'number' ? day.precip : null);
    cond = promoteByPop(cond || 'cloudy', pop || 0, precip || 0);
    const gradient = PALETTES[cond][part];
    const text = pickTextColor(gradient);
    const partLabel = PART_LABEL[part];
    const label = COND_LABEL[cond];
    const showPop = pop !== null && pop !== undefined && (pop > 0 || ['rain', 'snow', 'thunder'].includes(cond));
    return {
      condition: cond, label, part, partLabel, pop, precip, gradient,
      textColor: text.color, textContrast: Math.round(text.ratio * 100) / 100,
      isNight: part === 'night', particles: particleSpec(cond, pop || 0, precip || 0),
      // 하루 중 위치(해/달의 가로 위치용): 낮 5~19시, 밤 19~5시를 0~1로
      orbProgress: part === 'night' ? ((hour >= 19 ? hour - 19 : hour + 5) / 10) : Math.min(1, Math.max(0, (hour - 5) / 14)),
      caption: `${partLabel} ${label}${showPop ? ` · 강수확률 ${Math.round(pop)}%` : ''}`,
      key: `${cond}:${part}`,
    };
  }

  // ---- 입자(빗방울/눈송이) 배치: 시드 기반 난수 → 같은 입력이면 같은 배치(테스트/깜빡임 방지) ----
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function makeParticles(type, count, seed = 1) {
    const n = Math.max(0, Math.min(MAX_PARTICLES, Math.floor(count)));
    const rnd = mulberry32(seed);
    const out = [];
    for (let i = 0; i < n; i++) {
      if (type === 'snow') {
        out.push({ left: +(rnd() * 100).toFixed(1), delay: +(-rnd() * 8).toFixed(2), dur: +(5 + rnd() * 5).toFixed(2), size: +(3 + rnd() * 4).toFixed(1), drift: Math.round((rnd() - 0.5) * 36), opacity: +(0.55 + rnd() * 0.45).toFixed(2) });
      } else {
        out.push({ left: +(rnd() * 100).toFixed(1), delay: +(-rnd() * 1.6).toFixed(2), dur: +(0.55 + rnd() * 0.5).toFixed(2), len: Math.round(10 + rnd() * 14), opacity: +(0.35 + rnd() * 0.45).toFixed(2) });
      }
    }
    return out;
  }

  // 도시 현지 시각(시)을 UTC 오프셋(초)으로 계산
  function cityLocalHour(nowMs, utcOffsetSeconds) {
    return new Date(nowMs + utcOffsetSeconds * 1000).getUTCHours();
  }
  function cityLocalDate(nowMs, utcOffsetSeconds) {
    return new Date(nowMs + utcOffsetSeconds * 1000).toISOString().slice(0, 10);
  }

  globalThis.weatherTheme = weatherTheme;
  globalThis.WEATHER_THEME = { COND_LABEL, PART_LABEL, PALETTES, MAX_PARTICLES, dayPartOf, conditionFromWmo, conditionFromKma, contrastRatio, pickTextColor, makeParticles, cityLocalHour, cityLocalDate, TEXT_LIGHT, TEXT_DARK };
})();
