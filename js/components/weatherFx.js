// 시계 카드 날씨 연출(v7.21.0): 배경 그라디언트(크로스페이드) + 애니메이션 SVG 아이콘 + 입자(빗방울/눈송이) + 번개/구름/해·달.
// 테마 계산은 js/services/weatherTheme.js(순수 함수)가 하고, 여기서는 DOM만 만든다. 모든 애니메이션은 CSS(transform/opacity) —
//  · prefers-reduced-motion / 설정의 "애니메이션 효과 끔" → CSS가 모든 애니메이션을 끈다(정지 상태로 아이콘·그라디언트만).
//  · 탭이 숨겨지면(visibilitychange) <html>에 wx-paused를 붙여 animation-play-state를 멈춘다.
//  · 입자 수는 WEATHER_THEME.MAX_PARTICLES(40)로 제한한다.
// 일반 <script>로 로드되며 js/services/weatherTheme.js, js/utils/dom.js가 먼저 로드되어야 한다.
(function () {
  const { el } = window;
  const NS = 'http://www.w3.org/2000/svg';

  // ---- 애니메이션 SVG 아이콘(48x48). 정적 문자열이라 innerHTML이 안전하다. ----
  // 아이콘 색은 배경 밝기(tone)에 맞춰 바꾼다: 어두운 배경(dark)엔 밝은 구름, 밝은 배경(light)엔 한 단계 진한 회청색 구름.
  const TONES = {
    dark: { cloud: '#f4f7fb', cloud2: '#d3dae3', rainCloud: '#c3ccd8', boltCloud: '#9aa5b8', fogCloud: '#dfe5ea', fogLine: '#e8edf1', drop: '#7fc4ff', flake: '#ffffff' },
    light: { cloud: '#8d9db3', cloud2: '#aab6c6', rainCloud: '#7d8da3', boltCloud: '#6c7a90', fogCloud: '#8d9db3', fogLine: '#7d8da3', drop: '#3b82d6', flake: '#4f8fe0' },
  };
  const SUN = '<g class="wxi-sun"><circle class="wxi-glow" cx="24" cy="24" r="15" fill="#ffd54a" opacity=".35"/><g class="wxi-rays" stroke="#ffd54a" stroke-width="3" stroke-linecap="round"><path d="M24 4v6M24 38v6M4 24h6M38 24h6M9.9 9.9l4.2 4.2M33.9 33.9l4.2 4.2M9.9 38.1l4.2-4.2M33.9 14.1l4.2-4.2"/></g><circle cx="24" cy="24" r="9" fill="#ffc933"/></g>';
  const MOON = '<g class="wxi-moon"><path d="M31 8a16 16 0 1 0 9 28A13 13 0 0 1 31 8z" fill="#f5f0c8"/><circle class="wxi-star" cx="38" cy="12" r="1.6" fill="#fff"/><circle class="wxi-star wxi-star--b" cx="42" cy="22" r="1.2" fill="#fff"/></g>';
  const CLOUD = (fill, extra = '') => `<g class="wxi-cloud" ${extra}><path d="M14 36a8 8 0 0 1-.8-15.96A11 11 0 0 1 34.4 17 9.5 9.5 0 0 1 35 36z" fill="${fill}"/></g>`;
  const ICONS = {
    clear: (night) => (night ? MOON : SUN),
    partly: (night, t) => `<g transform="translate(-6 -8) scale(.75)">${night ? MOON : SUN}</g>${CLOUD(t.cloud, 'transform="translate(2 4)"')}`,
    cloudy: (night, t) => `<g transform="translate(-8 -4) scale(.8)">${CLOUD(t.cloud2)}</g>${CLOUD(t.cloud, 'transform="translate(4 4)"')}`,
    rain: (night, t) => `${CLOUD(t.rainCloud)}<g class="wxi-drops" stroke="${t.drop}" stroke-width="3" stroke-linecap="round"><path class="wxi-drop" d="M17 40l-2 5"/><path class="wxi-drop wxi-drop--b" d="M25 40l-2 5"/><path class="wxi-drop wxi-drop--c" d="M33 40l-2 5"/></g>`,
    snow: (night, t) => `${CLOUD(t.rainCloud)}<g class="wxi-flakes" fill="${t.flake}"><circle class="wxi-flake" cx="17" cy="42" r="2.2"/><circle class="wxi-flake wxi-flake--b" cx="25" cy="44" r="2.2"/><circle class="wxi-flake wxi-flake--c" cx="33" cy="42" r="2.2"/></g>`,
    thunder: (night, t) => `${CLOUD(t.boltCloud)}<path class="wxi-bolt" d="M26 31l-6 10h5l-2 7 9-12h-5l3-5z" fill="#ffd21f" stroke="#c99a00" stroke-width=".6"/>`,
    fog: (night, t) => `${CLOUD(t.fogCloud)}<g stroke="${t.fogLine}" stroke-width="3" stroke-linecap="round"><path class="wxi-fog" d="M8 41h30"/><path class="wxi-fog wxi-fog--b" d="M12 46h28"/></g>`,
  };
  // tone: 'dark'(어두운 배경, 흰 글자) | 'light'(밝은 배경, 짙은 글자)
  function weatherIcon(cond, isNight, size = 28, tone = 'dark') {
    const make = ICONS[cond] || ICONS.cloudy;
    const span = el('span', { class: `wxi wxi--${cond}`, 'aria-hidden': 'true', style: `width:${size}px;height:${size}px` });
    span.innerHTML = `<svg viewBox="0 0 48 48" width="${size}" height="${size}" xmlns="${NS}" focusable="false">${make(isNight, TONES[tone] || TONES.dark)}</svg>`;
    return span;
  }

  function gradientCss(stops) {
    return `linear-gradient(160deg, ${stops[0]} 0%, ${stops[1]} 55%, ${stops[2]} 100%)`;
  }

  // ---- 입자 ----
  function buildParticles(theme, seed) {
    const spec = theme.particles;
    if (!spec || !spec.type) return null;
    const list = window.WEATHER_THEME.makeParticles(spec.type, spec.count, seed);
    const box = el('div', { class: `wx-particles wx-particles--${spec.type}` });
    for (const p of list) {
      const s = spec.type === 'snow'
        ? `left:${p.left}%;width:${p.size}px;height:${p.size}px;opacity:${p.opacity};animation-duration:${p.dur}s;animation-delay:${p.delay}s;--drift:${p.drift}px`
        : `left:${p.left}%;height:${p.len}px;opacity:${p.opacity};animation-duration:${p.dur}s;animation-delay:${p.delay}s`;
      box.append(el('i', { style: s }));
    }
    return box;
  }

  function seedOf(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  /** 배경 레이어(크로스페이드용 2장)와 연출 레이어를 가진 컨테이너 쌍을 만든다. cell 맨 앞에 넣는다. */
  function createLayers() {
    const bg = el('div', { class: 'wx-bg', 'aria-hidden': 'true' }, [
      el('div', { class: 'wx-bg__layer wx-bg__from' }),
      el('div', { class: 'wx-bg__layer wx-bg__to' }),
    ]);
    const fx = el('div', { class: 'wx-fx', 'aria-hidden': 'true' });
    return { bg, fx };
  }

  function buildFx(theme, seedKey) {
    const frag = document.createDocumentFragment();
    const c = theme.condition;
    const night = theme.isNight;
    // 해/달(하루 중 위치를 따라 가로로 이동) — 맑음/구름조금에서만
    if ((c === 'clear' || c === 'partly') && theme.part !== 'evening') {
      frag.append(el('div', { class: `wx-orb ${night ? 'wx-orb--moon' : 'wx-orb--sun'}`, style: `--orb-x:${Math.round(10 + theme.orbProgress * 70)}` }));
    } else if (c === 'clear' || c === 'partly') {
      frag.append(el('div', { class: 'wx-orb wx-orb--sunset', style: `--orb-x:${Math.round(10 + theme.orbProgress * 70)}` }));
    }
    if (night && (c === 'clear' || c === 'partly')) frag.append(el('div', { class: 'wx-stars' }));
    // 구름: 흐림/비/눈/뇌우/구름조금에서 흘러가는 구름
    if (['cloudy', 'rain', 'snow', 'thunder', 'partly', 'fog'].includes(c)) {
      const n = c === 'partly' ? 2 : 3;
      for (let i = 0; i < n; i++) frag.append(el('div', { class: `wx-cloud wx-cloud--${i + 1}` }));
    }
    const particles = buildParticles(theme, seedOf(seedKey + theme.key));
    if (particles) frag.append(particles);
    if (c === 'thunder') frag.append(el('div', { class: 'wx-lightning' }));
    return frag;
  }

  /**
   * 셀에 테마를 적용한다. prev가 다르면 이전 그라디언트에서 새 그라디언트로 부드럽게 크로스페이드한다.
   * @param {HTMLElement} cell  .wx-cell (createLayers()의 bg/fx가 이미 들어 있어야 한다)
   * @param {object|null} theme weatherTheme() 결과(null이면 테마 해제)
   * @param {object|null} prev  직전에 보였던 테마(크로스페이드 시작점)
   */
  function applyTheme(cell, theme, prev, seedKey = '') {
    const from = cell.querySelector('.wx-bg__from');
    const to = cell.querySelector('.wx-bg__to');
    const fx = cell.querySelector('.wx-fx');
    if (!theme) {
      cell.classList.remove('wx-cell--on');
      cell.removeAttribute('data-wx');
      cell.removeAttribute('data-wx-part');
      return;
    }
    cell.classList.add('wx-cell--on');
    cell.dataset.wx = theme.condition;
    cell.dataset.wxPart = theme.part;
    cell.style.setProperty('--wx-text', theme.textColor);
    cell.dataset.wxTone = theme.textColor === window.WEATHER_THEME.TEXT_DARK ? 'light' : 'dark'; // 배경 밝기(밝은 배경 = 짙은 글자)
    const next = gradientCss(theme.gradient);
    const changed = !prev || prev.key !== theme.key;
    if (changed && prev) {
      from.style.background = gradientCss(prev.gradient);
      from.style.opacity = '1';
      to.style.transition = 'none';
      to.style.opacity = '0';
      to.style.background = next;
      void to.offsetWidth; // 리플로우로 시작 상태 확정
      to.style.transition = '';
      to.style.opacity = '1';
    } else {
      to.style.background = next;
      from.style.opacity = '0';
      to.style.opacity = '1';
    }
    if (changed || !fx.childNodes.length) {
      fx.replaceChildren(buildFx(theme, seedKey));
    } else {
      const orb = fx.querySelector('.wx-orb');
      if (orb) orb.style.setProperty('--orb-x', String(Math.round(10 + theme.orbProgress * 70)));
    }
  }

  // 탭이 숨겨지면 모든 날씨 애니메이션을 멈춘다(배터리/CPU). 한 번만 등록한다.
  if (!window.__wxVisibilityBound && typeof document !== 'undefined') {
    window.__wxVisibilityBound = true;
    const sync = () => document.documentElement.classList.toggle('wx-paused', document.hidden);
    document.addEventListener('visibilitychange', sync);
    sync();
  }

  window.WeatherFx = { weatherIcon, toneOf: (theme) => (theme.textColor === window.WEATHER_THEME.TEXT_DARK ? 'light' : 'dark'), createLayers, applyTheme, gradientCss, buildParticles };
})();
