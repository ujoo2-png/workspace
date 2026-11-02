// 다이어그램 엔진 코어 (v7.32.0)
//
// cathrynlavery/diagram-design (MIT, https://github.com/cathrynlavery/diagram-design)의 디자인 규칙을 앱 안에서
// 코드로 그리도록 옮긴 것이다. 원본은 AI가 SVG를 직접 작성하는 스킬이고, 여기서는 같은 규칙(에디토리얼 팔레트·
// 초점색 1~2개·직각 연결선·라벨 마스크·접근성 title/desc·복잡도 예산)을 따르는 자체 렌더러가 데이터를 SVG로 바꾼다.
// 원본의 45종 모양을 그대로 복제한 것이 아니라 같은 목적의 간결한 구현이다(자세한 한계는 README).
// DOM이 없어도 동작하는 순수 문자열 생성기라 Node 테스트에서도 실행된다.
(function (root) {
  'use strict';

  // ── 문자열 도구 ───────────────────────────────────────────────────────
  const E = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
  const r1 = (n) => Math.round(n * 10) / 10;
  const up4 = (n) => Math.ceil(n / 4) * 4;
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const isWide = (cp) => (cp >= 0x1100 && cp <= 0x11ff) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) || (cp >= 0xfe30 && cp <= 0xfe6f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6) || (cp >= 0x1f300 && cp <= 0x1faff);
  /** 글자 폭 추정(원본 규칙): 전각·한글은 1em, 그 외 산세리프 0.60em / 모노 0.62em. */
  function tw(str, size = 12, mono = false, track = 0) {
    let w = 0;
    for (const ch of String(str === null || str === undefined ? '' : str)) {
      const cp = ch.codePointAt(0);
      if (cp >= 0x300 && cp <= 0x36f) continue;
      w += isWide(cp) ? 1 : (mono ? 0.62 : 0.6);
      w += track;
    }
    return w * size;
  }
  /** 폭 maxW 안에서 줄바꿈. 공백 우선, 없으면 글자 단위(한글). */
  function wrap(str, size, maxW, mono = false) {
    const words = String(str === null || str === undefined ? '' : str).split(/(\s+)/).filter((x) => x !== '');
    const lines = []; let cur = '';
    const push = () => { if (cur.trim()) lines.push(cur.trim()); cur = ''; };
    for (const wd of words) {
      if (tw(cur + wd, size, mono) <= maxW) { cur += wd; continue; }
      if (cur.trim()) push();
      if (tw(wd, size, mono) <= maxW) { cur = wd.trimStart(); continue; }
      for (const ch of wd) { if (tw(cur + ch, size, mono) > maxW) push(); cur += ch; }
    }
    push();
    return lines.length ? lines : [''];
  }
  const ellip = (str, size, maxW, mono = false) => {
    const s = String(str === null || str === undefined ? '' : str);
    if (tw(s, size, mono) <= maxW) return s;
    let out = '';
    for (const ch of s) { if (tw(out + ch + '…', size, mono) > maxW) break; out += ch; }
    return out + '…';
  };

  // ── 색 도구 ───────────────────────────────────────────────────────────
  function hex2rgb(h) {
    let s = String(h || '').trim().replace('#', '');
    if (s.length === 3) s = s.split('').map((c) => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return [parseInt(s.slice(0, 2), 16), parseInt(s.slice(2, 4), 16), parseInt(s.slice(4, 6), 16)];
  }
  const rgba = (h, a) => { const c = hex2rgb(h) || [0, 0, 0]; return `rgba(${c[0]},${c[1]},${c[2]},${a})`; };
  const lum = (h) => { const c = hex2rgb(h); if (!c) return 0; const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  /** WCAG 대비. 둘 중 하나가 hex가 아니면 null. */
  function contrast(a, b) { if (!hex2rgb(a) || !hex2rgb(b)) return null; const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
  const mix = (a, b, t) => { const x = hex2rgb(a), y = hex2rgb(b); if (!x || !y) return a; const m = (i) => Math.round(x[i] + (y[i] - x[i]) * t).toString(16).padStart(2, '0'); return `#${m(0)}${m(1)}${m(2)}`; };

  // ── 스킨(토큰) ────────────────────────────────────────────────────────
  const SKINS = {
    light: { paper: '#f5f5f5', paper2: '#ececec', ink: '#2d3142', muted: '#4f5d75', soft: '#5a6580', rule: 'rgba(45,49,66,0.12)', ruleSolid: '#bfc0c0', accent: '#bf4520', accentTint: 'rgba(191,69,32,0.08)', link: '#2e5aa8', series: ['#7c8f6f', '#5e7a9b', '#b8915a', '#9c6b50', '#6e6479'], terminal: false },
    dark: { paper: '#2d3142', paper2: '#393e53', ink: '#f5f5f5', muted: '#bfc0c0', soft: '#949eb2', rule: 'rgba(245,245,245,0.12)', ruleSolid: 'rgba(191,192,192,0.25)', accent: '#f08a59', accentTint: 'rgba(240,138,89,0.10)', link: '#739fdf', series: ['#9caf8f', '#82a0c0', '#d3ad7a', '#b88670', '#8d8298'], terminal: false },
    terminal: { paper: '#141414', paper2: '#1b1b1b', ink: '#f5f5f5', muted: '#9a9a9a', soft: '#8a8a8a', rule: '#2b2b2b', ruleSolid: '#2b2b2b', accent: '#ff5a36', accentTint: 'rgba(255,90,54,0.12)', link: '#ff5a36', series: ['#9a9a9a', '#7a7a7a', '#5c5c5c', '#bdbdbd', '#6a6a6a'], terminal: true, page: '#0a0a0a' },
  };
  /** 스킨 + 사용자 팔레트(붙여넣은 토큰)를 합쳐 최종 토큰을 만든다. 잘못된 hex는 무시한다. */
  function resolveTokens(skin, palette = {}) {
    const base = { ...(SKINS[skin] || SKINS.light) };
    const ok = (v) => (hex2rgb(v) ? (String(v).startsWith('#') ? v : `#${v}`) : null);
    for (const k of ['paper', 'ink', 'accent', 'muted', 'link']) { const v = ok(palette[k]); if (v) base[k] = v; }
    if (ok(palette.paper)) base.paper2 = mix(base.paper, base.ink, 0.06);
    if (ok(palette.ink)) { base.rule = rgba(base.ink, 0.12); base.ruleSolid = mix(base.paper, base.ink, 0.25); }
    if (ok(palette.muted)) base.soft = mix(base.muted, base.paper, 0.18);
    if (ok(palette.accent)) base.accentTint = rgba(base.accent, 0.09);
    return base;
  }
  /** 토큰 대비 점검(원본 계약: 글자 4.5:1, 선·화살표 3:1). 문제 목록을 돌려준다. */
  function checkContrast(tok) {
    const out = [];
    const t = (name, fg, min) => { const c = contrast(fg, tok.paper); if (c !== null && c < min) out.push({ name, ratio: Math.round(c * 100) / 100, min }); };
    t('ink(본문)', tok.ink, 4.5); t('muted(보조 글자)', tok.muted, 4.5); t('soft(부제)', tok.soft, 4.5);
    t('accent(강조)', tok.accent, 4.5); t('link(링크)', tok.link, 4.5);
    return out;
  }

  // ── 설정 ──────────────────────────────────────────────────────────────
  const PRESETS = {
    'doc-inline': { label: '문서 본문(960×600)', w: 960, h: 600, ramp: 1 },
    'doc-wide': { label: '문서 와이드(1280×720)', w: 1280, h: 720, ramp: 1 },
    'slide-16x9': { label: '슬라이드 16:9', w: 1280, h: 720, ramp: 1.15 },
    'slide-4x3': { label: '슬라이드 4:3', w: 1024, h: 768, ramp: 1.15 },
    'social-og': { label: '링크 카드(OG)', w: 1200, h: 632, ramp: 1.15 },
    'social-square': { label: '정사각 SNS', w: 1080, h: 1080, ramp: 1.15 },
    'print-a4-landscape': { label: 'A4 가로 인쇄', w: 1120, h: 792, ramp: 1.1 },
    'print-a3-landscape': { label: 'A3 가로 인쇄', w: 1584, h: 1120, ramp: 1.1 },
    'print-letter-landscape': { label: 'Letter 가로 인쇄', w: 1056, h: 816, ramp: 1.1 },
    fit: { label: '내용에 맞춤(벡터 전달용)', w: 0, h: 0, ramp: 1 },
  };
  const DETAIL = { simplified: { label: '간단(7개 이내)', max: 7 }, balanced: { label: '균형(12개 이내)', max: 12 }, faithful: { label: '충실(24개 이내)', max: 24 } };
  const AUDIENCE = { engineer: '엔지니어(부제·포트 표시)', mixed: '일반(기본)', executive: '경영진(부제 숨김·큰 글씨)' };
  const MOTION = { none: '없음(정적)', reveal: '순서대로 나타남', step: '단계별(이전/다음)', loop: '반복 강조' };
  const DEFAULTS = {
    skin: 'light', layout: 'minimal', size: 'doc-inline', detail: 'balanced', audience: 'mixed', fontSource: 'web',
    sketchy: false, motion: 'none', direction: 'auto', legend: true, annotations: true, icons: true, tableView: true,
    pngScale: 2, palette: {}, profile: '', lang: 'ko',
  };
  const norm = (s = {}) => {
    const o = { ...DEFAULTS, ...s };
    if (!SKINS[o.skin] && o.skin !== 'auto') o.skin = 'light';
    if (!['minimal', 'full'].includes(o.layout)) o.layout = 'minimal';
    if (!PRESETS[o.size]) o.size = 'doc-inline';
    if (!DETAIL[o.detail]) o.detail = 'balanced';
    if (!AUDIENCE[o.audience]) o.audience = 'mixed';
    if (!['web', 'system'].includes(o.fontSource)) o.fontSource = 'web';
    if (!MOTION[o.motion]) o.motion = 'none';
    if (!['auto', 'LR', 'TB'].includes(o.direction)) o.direction = 'auto';
    o.sketchy = !!o.sketchy;
    o.pngScale = [1, 2, 3].includes(Number(o.pngScale)) ? Number(o.pngScale) : 2;
    o.palette = o.palette && typeof o.palette === 'object' ? o.palette : {};
    return o;
  };

  const FONT_LINK = 'https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500;600&family=Noto+Sans+KR:wght@400;500;600&family=Noto+Serif+KR:wght@400&display=swap';
  const FONTS = {
    sans: "'Geist','Noto Sans KR','Apple SD Gothic Neo','Malgun Gothic',system-ui,sans-serif",
    serif: "'Instrument Serif','Noto Serif KR','Apple SD Gothic Neo','Malgun Gothic',serif",
    mono: "'Geist Mono',ui-monospace,SFMono-Regular,Menlo,monospace",
  };

  // ── 유형 등록부 ───────────────────────────────────────────────────────
  const TYPES = [];
  const BY_ID = {};
  function register(def) { TYPES.push(def); BY_ID[def.id] = def; return def; }

  // 유형별 복잡도 예산(원본 layout-budget 요약). nodes/edges/accent.
  const BUDGET = { default: { nodes: 9, edges: 12, accent: 2 } };

  // ── 렌더 컨텍스트 ─────────────────────────────────────────────────────
  function makeCtx(settings, slug) {
    const S = norm(settings);
    const skin = S.skin === 'auto' ? 'light' : S.skin;
    const tok = resolveTokens(skin, S.palette);
    const exec = S.audience === 'executive';
    const ramp = (PRESETS[S.size] || PRESETS['doc-inline']).ramp * (exec ? 1.12 : 1);
    const ctx = {
      S, tok, F: FONTS, id: slug || 'dg', ramp, exec, eng: S.audience === 'engineer',
      _step: new Map(), _steps: 0, counts: { nodes: 0, edges: 0, accent: 0 }, table: [], blocks: [], legend: [], notes: [],
    };
    /** 같은 key는 같은 애니메이션 단계로 묶는다. */
    ctx.step = (key) => { const k = key === undefined ? `__${ctx._step.size}` : String(key); if (!ctx._step.has(k)) ctx._step.set(k, ctx._step.size); return ctx._step.get(k); };
    ctx.anim = (key, inner) => (S.motion === 'none' ? inner : `<g class="d-i" data-step="${ctx.step(key)}" style="--i:${ctx.step(key)}">${inner}</g>`);
    ctx.size = (n) => Math.round(n * Math.min(ramp, 1.2) * 2) / 2;
    return ctx;
  }

  // ── SVG 조각 ──────────────────────────────────────────────────────────
  function txt(ctx, x, y, str, o = {}) {
    const { size = 12, weight = 400, anchor = 'start', fill = ctx.tok.ink, mono = false, serif = false, upper = false, italic = false, track = 0, base } = o;
    const fam = serif ? ctx.F.serif : mono ? ctx.F.mono : ctx.F.sans;
    const s = upper ? String(str).toUpperCase() : String(str);
    return `<text x="${r1(x)}" y="${r1(y)}" font-family="${fam}" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${fill}"${italic ? ' font-style="italic"' : ''}${track ? ` letter-spacing="${track}em"` : ''}${base ? ` dominant-baseline="${base}"` : ''}>${E(s)}</text>`;
  }
  /** 여러 줄 텍스트(가운데/왼쪽). 줄 높이 = size*1.25. */
  function txtLines(ctx, x, y, lines, o = {}) {
    const lh = (o.size || 12) * 1.25;
    return lines.map((l, i) => txt(ctx, x, y + i * lh, l, o)).join('');
  }
  /** 라벨 + 불투명 마스크(원본 규칙 2). 선과 6~10px 떨어진 곳에 둔다. */
  function maskedLabel(ctx, cx, cy, str, o = {}) {
    const size = o.size || 8;
    const mono = o.mono !== false;
    const wide = [...String(str)].some((c) => isWide(c.codePointAt(0)));
    const sz = wide ? 12 : size;
    const w = up4(tw(wide ? str : String(str).toUpperCase(), sz, !wide, wide ? 0 : 0.06) + 8);
    const h = wide ? 16 : 12;
    return `<rect x="${r1(cx - w / 2)}" y="${r1(cy - h / 2)}" width="${w}" height="${h}" fill="${ctx.tok.paper}"/>` +
      txt(ctx, cx, cy + sz * 0.34, str, { size: sz, anchor: 'middle', fill: o.fill || ctx.tok.soft, mono: !wide, upper: !wide, track: wide ? 0 : 0.06, weight: wide ? 500 : 400 });
  }
  /** 직각 꺾임(r=8) 경로 문자열. points: [[x,y],...] 직교 가정. */
  function roundedPath(points, r = 8) {
    const p = points.filter((q, i) => i === 0 || q[0] !== points[i - 1][0] || q[1] !== points[i - 1][1]);
    if (p.length < 2) return '';
    let d = `M${r1(p[0][0])},${r1(p[0][1])}`;
    for (let i = 1; i < p.length - 1; i++) {
      const a = p[i - 1], b = p[i], c = p[i + 1];
      const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
      const rr = Math.min(r, l1 / 2, l2 / 2);
      const s = [b[0] + ((a[0] - b[0]) / l1) * rr, b[1] + ((a[1] - b[1]) / l1) * rr];
      const e = [b[0] + ((c[0] - b[0]) / l2) * rr, b[1] + ((c[1] - b[1]) / l2) * rr];
      d += ` L${r1(s[0])},${r1(s[1])} Q${r1(b[0])},${r1(b[1])} ${r1(e[0])},${r1(e[1])}`;
    }
    const last = p[p.length - 1];
    return d + ` L${r1(last[0])},${r1(last[1])}`;
  }
  const markerId = (ctx, kind) => `${ctx.id}-m-${kind}`;
  /** 연결선: 기본 muted, accent=헤드라인 경로, link=API/외부, dashed=선택·반환·비동기. */
  function pathEl(ctx, points, o = {}) {
    const { kind = 'plain', dashed = false, arrow = true, r = 8, width = 1.25, marker, startMarker } = o;
    const col = kind === 'accent' ? ctx.tok.accent : kind === 'link' ? ctx.tok.link : ctx.tok.muted;
    const mname = marker || (kind === 'accent' ? 'accent' : kind === 'link' ? 'link' : 'plain');
    const mk = (arrow || marker ? ` marker-end="url(#${markerId(ctx, mname)})"` : '') + (startMarker ? ` marker-start="url(#${markerId(ctx, startMarker)})"` : '');
    return `<path d="${roundedPath(points, r)}" fill="none" stroke="${col}" stroke-width="${width}"${dashed ? ' stroke-dasharray="5,4"' : ''}${mk}/>`;
  }
  function defs(ctx) {
    const t = ctx.tok;
    const mk = (kind, col) => `<marker id="${markerId(ctx, kind)}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1,1 L9,5 L1,9" fill="none" stroke="${col}" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></marker>`;
    const tri = `<marker id="${markerId(ctx, 'tri')}" viewBox="0 0 12 12" refX="11" refY="6" markerWidth="9" markerHeight="9" orient="auto"><path d="M1,1 L11,6 L1,11 Z" fill="${t.paper}" stroke="${t.muted}" stroke-width="1.2" stroke-linejoin="round"/></marker>`;
    const dia = `<marker id="${markerId(ctx, 'dia')}" viewBox="0 0 14 10" refX="13" refY="5" markerWidth="11" markerHeight="8" orient="auto"><path d="M1,5 L7,1 L13,5 L7,9 Z" fill="${t.muted}" stroke="${t.muted}" stroke-width="1"/></marker>`;
    const sk = ctx.S.sketchy ? `<filter id="${ctx.id}-sk" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="7" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/></filter>` : '';
    const dots = `<pattern id="${ctx.id}-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="0.8" fill="${t.ruleSolid}" opacity="0.5"/></pattern>`;
    return `<defs>${mk('plain', t.muted)}${mk('accent', t.accent)}${mk('link', t.link)}${tri}${dia}${sk}${dots}</defs>`;
  }

  /** 노드 상자. kind: focal | store | external | input | optional | security | normal */
  function boxEl(ctx, o) {
    const t = ctx.tok;
    const { x, y, w, h, name, sub, tag, kind = 'normal', shape = 'rect', lines } = o;
    const focal = kind === 'focal';
    if (focal) ctx.counts.accent++;
    const stroke = focal ? t.accent : kind === 'external' ? t.soft : kind === 'security' ? t.accent : t.ink;
    const fill = focal ? t.accentTint : kind === 'store' ? t.paper2 : t.paper;
    const dash = kind === 'external' || kind === 'optional' ? ' stroke-dasharray="5,4"' : kind === 'security' ? ' stroke-dasharray="2,3"' : '';
    const sw = focal ? 1.5 : 1;
    let shapeEl;
    const mask = `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" fill="${t.paper}"/>`;
    if (shape === 'diamond') {
      const cx = x + w / 2, cy = y + h / 2;
      shapeEl = `<polygon points="${r1(cx)},${r1(y)} ${r1(x + w)},${r1(cy)} ${r1(cx)},${r1(y + h)} ${r1(x)},${r1(cy)}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    } else if (shape === 'pill') {
      shapeEl = `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="${h / 2}" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    } else if (shape === 'cyl') {
      const ry = 6;
      shapeEl = `<path d="M${r1(x)},${r1(y + ry)} a${w / 2},${ry} 0 0 1 ${w},0 v${h - 2 * ry} a${w / 2},${ry} 0 0 1 ${-w},0 Z" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/><path d="M${r1(x)},${r1(y + ry)} a${w / 2},${ry} 0 0 0 ${w},0" fill="none" stroke="${stroke}" stroke-width="${sw}"/>`;
    } else {
      shapeEl = `<rect x="${r1(x)}" y="${r1(y)}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}" stroke-width="${sw}"${dash}/>`;
    }
    const cx = x + w / 2;
    const nameLines = lines || [name];
    const nameSize = ctx.size(12);
    const showSub = sub && !ctx.exec;
    const total = nameLines.length * nameSize * 1.25 + (showSub ? 13 : 0);
    let ty = y + (h - total) / 2 + nameSize * 0.95;
    if (shape === 'cyl') ty += 3;
    let s = (shape === 'rect' ? mask : '') + shapeEl;
    if (tag && shape === 'rect' && !ctx.exec) {
      const tg = String(tag).toUpperCase();
      const tgw = up4(tw(tg, 7, true, 0.12) + 10);
      s += `<rect x="${r1(x + w - tgw - 6)}" y="${r1(y - 6)}" width="${tgw}" height="12" rx="2" fill="${t.paper}" stroke="${stroke}" stroke-width="0.8"/>` +
        txt(ctx, x + w - 6 - tgw / 2, y + 2.6, tg, { size: 7, anchor: 'middle', mono: true, fill: focal ? t.accent : t.soft, weight: 500, track: 0.12 });
    }
    s += txtLines(ctx, cx, ty, nameLines, { size: nameSize, weight: 600, anchor: 'middle' });
    if (showSub) s += txt(ctx, cx, ty + (nameLines.length - 1) * nameSize * 1.25 + 14, ellip(sub, 9, w - 12, true), { size: 9, anchor: 'middle', mono: true, fill: t.soft });
    return s;
  }
  /** 노드 크기 계산(4px 격자). */
  function nodeSize(ctx, n, o = {}) {
    const nameSize = ctx.size(12);
    const maxW = o.maxW || 168;
    const lines = wrap(n.label || n.name || n.id, nameSize, maxW - 24);
    const nameW = Math.max(...lines.map((l) => tw(l, nameSize)));
    const subW = n.sub && !ctx.exec ? Math.min(maxW - 8, tw(n.sub, 9, true)) : 0;
    const w = Math.max(o.minW || 96, up4(Math.max(nameW, subW) + 32));
    const h = Math.max(o.minH || 40, up4(lines.length * nameSize * 1.25 + (n.sub && !ctx.exec ? 13 : 0) + 20));
    return { w, h, lines };
  }

  // ── 범례 · 헤더 ───────────────────────────────────────────────────────
  function legendSvg(ctx, items, y, W) {
    if (!ctx.S.legend || !items.length) return '';
    const t = ctx.tok;
    let x = 24, s = `<line x1="24" x2="${W - 24}" y1="${y - 12}" y2="${y - 12}" stroke="${t.rule}" stroke-width="1"/>`;
    for (const it of items) {
      let sw;
      if (it.type === 'line') sw = `<line x1="${x}" x2="${x + 22}" y1="${y}" y2="${y}" stroke="${it.color || t.muted}" stroke-width="1.5"${it.dashed ? ' stroke-dasharray="5,4"' : ''}/>`;
      else sw = `<rect x="${x}" y="${y - 6}" width="22" height="12" rx="2" fill="${it.fill || t.paper}" stroke="${it.color || t.ink}" stroke-width="1"${it.dashed ? ' stroke-dasharray="4,3"' : ''}/>`;
      const lw = tw(it.label, 9, true, 0.04);
      if (x + 28 + lw > W - 24) break;
      s += sw + txt(ctx, x + 28, y + 3, it.label, { size: 9, mono: true, fill: t.soft, track: 0.04 });
      x += 28 + lw + 22;
    }
    return s;
  }

  // ── 조립: 렌더 결과 → SVG ─────────────────────────────────────────────
  const MARGIN = 24;
  function wrapSvg(ctx, res, meta) {
    const t = ctx.tok, S = ctx.S;
    const preset = PRESETS[S.size];
    const legendH = S.legend && res.legend && res.legend.length ? 44 : 0;
    const natW = Math.max(res.w + MARGIN * 2, 320), natH = res.h + MARGIN * 2 + legendH;
    let W, H, scale = 1, ox = MARGIN, oy = MARGIN;
    if (preset.w === 0) { W = up4(natW); H = up4(natH); }
    else {
      W = preset.w; H = preset.h;
      const availW = W - MARGIN * 2, availH = H - MARGIN * 2 - legendH;
      scale = Math.min(availW / res.w, availH / res.h, 1.5);
      // 내용이 프리셋보다 훨씬 크면 캔버스를 키운다(글자가 읽기 어려울 만큼 축소되는 것을 막음).
      if (scale < 0.72) { scale = 0.72; W = Math.max(W, up4(res.w * scale + MARGIN * 2)); H = Math.max(H, up4(res.h * scale + MARGIN * 2 + legendH)); }
      ox = (W - res.w * scale) / 2; oy = MARGIN + Math.max(0, (H - MARGIN * 2 - legendH - res.h * scale) / 2);
    }
    const slug = ctx.id;
    const title = meta.title || '다이어그램';
    const desc = meta.desc || `${meta.typeKo || ''} 다이어그램`;
    const bg = t.terminal
      ? `<rect width="${W}" height="${H}" fill="${t.paper}"/><rect width="${W}" height="26" fill="${t.paper2}"/><circle cx="16" cy="13" r="4" fill="${t.ruleSolid}"/><circle cx="30" cy="13" r="4" fill="${t.ruleSolid}"/><circle cx="44" cy="13" r="4" fill="${t.accent}"/>`
      : `<rect width="${W}" height="${H}" fill="${t.paper}"/><rect width="${W}" height="${H}" fill="url(#${slug}-dots)"/>`;
    const motionCls = S.motion !== 'none' ? ` dg-m dg-m-${S.motion}` : '';
    const body = `<g transform="translate(${r1(ox)},${r1(oy + (t.terminal ? 14 : 0))}) scale(${r1(scale * 1000) / 1000})"${S.sketchy ? ` filter="url(#${slug}-sk)"` : ''}>${res.body}</g>`;
    const legend = legendSvg(ctx, res.legend || [], H - 20, W);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-labelledby="${slug}-title ${slug}-desc" class="dg-svg${motionCls}" data-steps="${ctx._step.size}">` +
      `<title id="${slug}-title">${E(ellip(title, 12, 600))}</title><desc id="${slug}-desc">${E(desc)}</desc>` +
      defs(ctx) + bg + body + legend + `</svg>`;
    return { svg, W, H, scale };
  }

  /** 애니메이션 CSS (모션 없음이면 빈 문자열). 접근성: reduced-motion/인쇄에서는 완성된 정지 화면. */
  function motionCss(S) {
    if (S.motion === 'none') return '';
    const base = `.dg-m .d-i{opacity:1}`;
    const reveal = `.dg-m-reveal .d-i{opacity:0;animation:dgIn .5s ease forwards;animation-delay:calc(var(--i)*.28s)}@keyframes dgIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}`;
    const step = `.dg-m-step .d-i{opacity:0;transition:opacity .35s}.dg-m-step .d-i.on{opacity:1}`;
    const loop = `.dg-m-loop .d-i{opacity:.35;animation:dgLoop calc(var(--n,6)*.9s) ease-in-out infinite;animation-delay:calc(var(--i)*.9s)}@keyframes dgLoop{0%,16%{opacity:1}22%,100%{opacity:.35}}`;
    const stat = `@media (prefers-reduced-motion:reduce),print{.dg-m .d-i{opacity:1!important;animation:none!important;transition:none!important;transform:none!important}.dg-ctl{display:none!important}}`;
    return base + (S.motion === 'reveal' ? reveal : S.motion === 'step' ? step : loop) + stat;
  }
  /** 단계별(step) 모드 컨트롤러 — 앱 안/내보낸 HTML 모두에서 동작. */
  const STEP_SCRIPT = `(function(){document.querySelectorAll('.dg-wrap[data-motion="step"]').forEach(function(w){var s=w.querySelector('svg'),it=[].slice.call(s.querySelectorAll('.d-i')),n=Number(s.getAttribute('data-steps'))||1,k=0;function show(){it.forEach(function(g){g.classList.toggle('on',Number(g.getAttribute('data-step'))<k)});var l=w.querySelector('.dg-pos');if(l)l.textContent=k+' / '+n}w.querySelector('.dg-prev').onclick=function(){k=Math.max(0,k-1);show()};w.querySelector('.dg-next').onclick=function(){k=Math.min(n,k+1);show()};w.querySelector('.dg-all').onclick=function(){k=n;show()};k=n;show()})})();`;
  function controls(S) {
    if (S.motion !== 'step') return '';
    return `<div class="dg-ctl"><button type="button" class="dg-prev">◀ 이전</button><span class="dg-pos"></span><button type="button" class="dg-next">다음 ▶</button><button type="button" class="dg-all">전체</button></div>`;
  }

  // ── 복잡도 예산 ───────────────────────────────────────────────────────
  function budgetCheck(def, counts, S) {
    const b = { ...BUDGET.default, ...(def.budget || {}) };
    const lim = S.detail === 'faithful' ? { nodes: Math.max(b.nodes, 24), edges: Math.max(b.edges, 36), accent: 2 } : S.detail === 'simplified' ? { nodes: Math.min(b.nodes, 7), edges: Math.min(b.edges, 9), accent: 2 } : b;
    const w = [];
    if (counts.nodes > lim.nodes) w.push(`노드 ${counts.nodes}개 — 이 유형의 권장(${lim.nodes}개)을 넘었습니다. 개요/상세 두 장으로 나누면 더 읽기 쉽습니다.`);
    if (counts.edges > lim.edges) w.push(`연결 ${counts.edges}개 — 권장(${lim.edges}개) 초과. 꼭 필요한 선만 남겨 보세요.`);
    if (counts.accent > lim.accent) w.push(`강조색 ${counts.accent}곳 — 초점은 1~2곳만 두는 것이 원칙입니다.`);
    return w;
  }

  // ── 메인 진입점 ───────────────────────────────────────────────────────
  function slugOf(id, S) { return `${id}${S.skin === 'dark' ? '-dark' : S.layout === 'full' ? '-full' : ''}`.replace(/[^a-z0-9-]/gi, '-'); }
  /**
   * render(typeId, data, settings) → { svg, html, warnings, table, blocks, counts, meta }
   * html = 페이지 카드(제목+스크롤 래퍼+캡션), 앱 미리보기용.  htmlDoc()은 단독 파일용.
   */
  function render(typeId, data, settings = {}, extra = {}) {
    const def = BY_ID[typeId];
    if (!def) throw new Error(`알 수 없는 다이어그램 유형: ${typeId}`);
    const S0 = norm(settings);
    const S = S0.skin === 'auto' ? { ...S0, skin: extra.appDark ? 'dark' : 'light' } : S0;
    const ctx = makeCtx(S, slugOf(extra.slug || def.id, S));
    const d = data && typeof data === 'object' ? data : def.sample;
    const res = def.render(d, ctx);
    const meta = { title: d.title || def.ko, desc: d.desc || `${def.ko}: ${def.short}`, typeKo: def.ko, eyebrow: d.eyebrow || def.ko, caption: d.caption || '' };
    const wrapped = wrapSvg(ctx, res, meta);
    const warnings = budgetCheck(def, ctx.counts, S);
    for (const w of res.warnings || []) warnings.push(w);
    const cw = checkContrast(ctx.tok);
    if (cw.length && Object.keys(S.palette).length) warnings.push('색 대비 부족: ' + cw.map((c) => `${c.name} ${c.ratio}:1(최소 ${c.min}:1)`).join(', '));
    return {
      svg: wrapped.svg, W: wrapped.W, H: wrapped.H, warnings, table: ctx.table, blocks: ctx.blocks, counts: ctx.counts,
      meta, settings: S, tok: ctx.tok, steps: ctx._step.size, notes: ctx.notes, def: { id: def.id, ko: def.ko },
    };
  }
  const css = (S, tok) => `*{box-sizing:border-box}body{margin:0;background:${tok.terminal ? tok.page : tok.paper};color:${tok.ink};font-family:${FONTS.sans}}` +
    `.dg-page{max-width:1100px;margin:0 auto;padding:32px 20px}.dg-eyebrow{font:500 11px ${FONTS.mono};letter-spacing:.18em;text-transform:uppercase;color:${tok.soft}}` +
    `.dg-title{font:400 1.75rem/1.2 ${FONTS.serif};margin:6px 0 16px;color:${tok.ink}}.diagram-container{width:100%;overflow-x:auto}.dg-svg{display:block;height:auto}` +
    `.dg-cap{font:italic 400 14px ${FONTS.serif};color:${tok.muted};margin-top:12px}.dg-cards{display:grid;grid-template-columns:1.1fr 1fr .9fr;gap:12px;margin-top:16px}` +
    `.dg-card{border:1px solid ${tok.rule};border-radius:6px;padding:12px 14px;background:${tok.paper};font-size:13px}.dg-card b{display:block;font:500 10px ${FONTS.mono};letter-spacing:.14em;text-transform:uppercase;color:${tok.soft};margin-bottom:4px}` +
    `.dg-ctl{display:flex;gap:8px;align-items:center;margin:8px 0;font:12px ${FONTS.mono};color:${tok.soft}}.dg-ctl button{font:inherit;border:1px solid ${tok.ruleSolid};background:${tok.paper};color:${tok.ink};border-radius:4px;padding:3px 10px;cursor:pointer}` +
    `.dg-tbl{border-collapse:collapse;font-size:12px;margin-top:10px}.dg-tbl td,.dg-tbl th{border:1px solid ${tok.rule};padding:3px 8px;text-align:left}` + motionCss(S);
  function cardsHtml(res) {
    const c = res.counts;
    return `<div class="dg-cards"><div class="dg-card"><b>구성</b>노드 ${c.nodes} · 연결 ${c.edges}</div><div class="dg-card"><b>초점</b>강조 ${c.accent}곳 (최대 2곳 권장)</div><div class="dg-card"><b>유형</b>${E(res.def.ko)}${res.warnings.length ? ' · ⚠ ' + E(res.warnings[0]) : ''}</div></div>`;
  }
  function tableHtml(res) {
    if (!res.table.length) return '';
    const keys = Object.keys(res.table[0]);
    return `<details class="dg-tblbox"><summary>표로 보기(접근성)</summary><table class="dg-tbl"><thead><tr>${keys.map((k) => `<th>${E(k)}</th>`).join('')}</tr></thead><tbody>${res.table.map((r) => `<tr>${keys.map((k) => `<td>${E(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table></details>`;
  }
  /** 미리보기용 조각(스타일 포함). */
  function fragment(res, S = res.settings) {
    const tok = res.tok;
    const full = S.layout === 'full';
    const head = full ? `<div class="dg-eyebrow">${E(res.meta.eyebrow)}</div><h1 class="dg-title">${E(res.meta.title)}</h1>` : `<h1 class="dg-title">${E(res.meta.title)}</h1>`;
    return `<style>${css(S, tok)}</style><div class="dg-wrap" data-motion="${S.motion}">${head}${controls(S)}<div class="diagram-container">${res.svg.replace('<svg ', `<svg style="min-width:${res.W}px" `)}</div>` +
      `${res.meta.caption ? `<p class="dg-cap">${E(res.meta.caption)}</p>` : ''}${full ? cardsHtml(res) : ''}${S.tableView ? tableHtml(res) : ''}</div>`;
  }
  /** 단독 HTML 파일(외부 의존은 Google Fonts 한 줄뿐 — fontSource=system이면 네트워크 요청 없음). */
  function htmlDoc(res) {
    const S = res.settings;
    const link = S.fontSource === 'web' ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link href="${FONT_LINK}" rel="stylesheet">` : '';
    return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${E(res.meta.title)}</title>${link}</head><body><div class="dg-page">` +
      fragment(res, S) + `</div>${S.motion === 'step' ? `<script>${STEP_SCRIPT}</script>` : ''}</body></html>`;
  }
  /** SVG 파일(독립). 폰트 @import를 넣거나(web) 시스템 폰트(system). */
  function svgFile(res) {
    const S = res.settings;
    const imp = S.fontSource === 'web' ? `<style>@import url('${FONT_LINK}');</style>` : '';
    return res.svg.replace(/(<svg[^>]*>)/, `$1${imp}<style>${motionCss(S).replace(/\.dg-ctl\{[^}]*\}/g, '')}</style>`);
  }
  /** 블록 메타데이터 JSON(원본의 sidecar 개념). */
  function sidecar(res) {
    return JSON.stringify({ generator: 'workspace-app diagram engine (diagram-design rules)', type: res.def.id, title: res.meta.title, size: { width: res.W, height: res.H }, counts: res.counts, warnings: res.warnings, blocks: res.blocks, table: res.table }, null, 2);
  }

  const api = {
    E, num, r1, up4, clamp, tw, wrap, ellip, hex2rgb, rgba, mix, contrast, SKINS, resolveTokens, checkContrast, PRESETS, DETAIL, AUDIENCE, MOTION, DEFAULTS, norm,
    FONT_LINK, FONTS, TYPES, BY_ID, register, BUDGET, makeCtx, txt, txtLines, maskedLabel, roundedPath, pathEl, markerId, defs, boxEl, nodeSize,
    render, fragment, htmlDoc, svgFile, sidecar, STEP_SCRIPT, motionCss, isWide, MARGIN, cardsHtml, tableHtml,
  };
  root.DiagramCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
