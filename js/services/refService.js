// 디자인 레퍼런스(v7.27.0) — Refero(유료) 대체. 모두 무료이고 API 키/토큰이 필요 없다.
//  - Openverse / Wikimedia Commons : 키 없이 브라우저에서 직접 이미지 검색(CORS 허용)
//  - Are.na 공개 채널 : 디자이너들이 모아 둔 UI 레퍼런스 채널을 URL로 불러오기
//  - 갤러리 바로가기 : Dribbble/Behance/Pinterest/Mobbin/Land-book 등 검색 링크(새 탭)
//  - 내 보드 : 마음에 든 이미지/사이트를 저장(URL·메모·태그만 저장, 이미지 파일은 저장하지 않음) → 기기 간 동기화
// 일반 <script>. window.RefService 로 노출. 외부 응답은 모두 문자열/URL 검증 후에만 사용한다.
(function () {
  const G = typeof window !== 'undefined' ? window : globalThis;
  const BOARD_KEY = 'workspace:refboard';
  const MAX_BOARD = 200;

  /** http(s) URL만 허용 (javascript:, data: 등 차단). 아니면 ''. */
  function safeUrl(u) {
    try { const x = new URL(String(u || '').trim()); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; } catch { return ''; }
  }
  const clip = (s, n) => String(s == null ? '' : s).replace(/<[^>]*>/g, '').trim().slice(0, n);

  async function getJson(url, ms = 15000) {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), ms);
    try {
      const res = await G.fetch(url, { signal: ctl.signal, headers: { Accept: 'application/json' }, referrerPolicy: 'no-referrer' });
      if (res.status === 429) throw new Error('요청이 너무 많아요. 잠시 후 다시 시도해 주세요.');
      if (res.status === 404) throw new Error('찾을 수 없어요(주소/채널 이름을 확인해 주세요).');
      if (!res.ok) throw new Error(`검색 서버 오류(${res.status})`);
      return await res.json();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('응답이 늦어요. 잠시 후 다시 시도해 주세요.');
      throw e;
    } finally { clearTimeout(t); }
  }

  function item(src, id, title, thumb, link, by, license) {
    const th = safeUrl(thumb); if (!th) return null;
    return { key: `${src}:${id}`, src, title: clip(title, 120) || '(제목 없음)', thumb: th, link: safeUrl(link) || th, by: clip(by, 80), license: clip(license, 40) };
  }

  /** Openverse — 키 없음. 사진/일러스트/그래픽 위주(UI 스크린샷은 적은 편). */
  async function searchOpenverse(q, page = 1) {
    const j = await getJson(`https://api.openverse.org/v1/images/?q=${encodeURIComponent(q)}&page_size=24&page=${Number(page) || 1}`);
    return (j.results || []).map((r) => item('openverse', r.id, r.title, r.thumbnail || r.url, r.foreign_landing_url || r.url, r.creator, r.license ? `CC ${String(r.license).toUpperCase()}` : '')).filter(Boolean);
  }

  /** Wikimedia Commons — 키 없음. */
  async function searchCommons(q, page = 1) {
    const off = ((Number(page) || 1) - 1) * 24;
    const url = 'https://commons.wikimedia.org/w/api.php?action=query&format=json&origin=*&generator=search&gsrnamespace=6&gsrlimit=24'
      + `&gsroffset=${off}&gsrsearch=${encodeURIComponent(`filetype:bitmap|drawing ${q}`)}&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=400`;
    const j = await getJson(url);
    const pages = Object.values((j.query && j.query.pages) || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    return pages.map((p) => {
      const ii = (p.imageinfo || [])[0]; if (!ii) return null;
      const m = ii.extmetadata || {};
      return item('commons', p.pageid, String(p.title || '').replace(/^File:/, ''), ii.thumburl || ii.url, ii.descriptionurl, m.Artist && m.Artist.value, m.LicenseShortName && m.LicenseShortName.value);
    }).filter(Boolean);
  }

  /** "https://www.are.na/user/slug" | "slug" → slug (영문/숫자/-/_ 만) */
  function parseArenaSlug(input) {
    let s = String(input || '').trim(); if (!s) return '';
    try { if (/^https?:\/\//i.test(s)) { const u = new URL(s); if (!/(^|\.)are\.na$/i.test(u.hostname)) return ''; s = u.pathname.split('/').filter(Boolean).pop() || ''; } } catch { return ''; }
    return /^[A-Za-z0-9_-]{1,120}$/.test(s) ? s : '';
  }
  /** Are.na 공개 채널의 이미지/링크 블록 */
  async function arenaChannel(input, page = 1) {
    const slug = parseArenaSlug(input); if (!slug) throw new Error('Are.na 채널 주소가 올바르지 않아요. (예: https://www.are.na/사용자/채널이름)');
    const j = await getJson(`https://api.are.na/v2/channels/${encodeURIComponent(slug)}/contents?per=48&page=${Number(page) || 1}`);
    const out = (j.contents || []).map((b) => {
      const im = b.image; if (!im) return null;
      const th = (im.display && im.display.url) || (im.thumb && im.thumb.url) || (im.original && im.original.url);
      return item('arena', b.id, b.title || b.generated_title, th, (b.source && b.source.url) || `https://www.are.na/block/${b.id}`, b.user && b.user.username, '');
    }).filter(Boolean);
    return { title: clip(j.title, 80) || slug, total: Number(j.length) || out.length, items: out };
  }

  /** 새 탭으로 여는 검색 링크. 직접 연동 API가 없는 갤러리는 사이트 지정 구글 검색으로 연결한다. */
  const GALLERIES = [
    { id: 'dribbble', name: 'Dribbble', note: 'UI·브랜딩 샷', url: (q) => `https://dribbble.com/search/${encodeURIComponent(q)}` },
    { id: 'behance', name: 'Behance', note: '케이스 스터디', url: (q) => `https://www.behance.net/search/projects?search=${encodeURIComponent(q)}` },
    { id: 'pinterest', name: 'Pinterest', note: '이미지 모음', url: (q) => `https://www.pinterest.com/search/pins/?q=${encodeURIComponent(q)}` },
    { id: 'mobbin', name: 'Mobbin', note: '앱 화면(일부 무료)', site: 'mobbin.com' },
    { id: 'landbook', name: 'Land-book', note: '랜딩페이지', site: 'land-book.com' },
    { id: 'lapa', name: 'Lapa Ninja', note: '랜딩페이지', site: 'lapa.ninja' },
    { id: 'godly', name: 'Godly', note: '웹 디자인', site: 'godly.website' },
    { id: 'awwwards', name: 'Awwwards', note: '수상작', site: 'awwwards.com' },
    { id: 'screenlane', name: 'Screenlane', note: '모바일 UI', site: 'screenlane.com' },
    { id: 'collectui', name: 'Collect UI', note: '컴포넌트별 UI', site: 'collectui.com' },
    { id: 'pageflows', name: 'Page Flows', note: '사용자 흐름', site: 'pageflows.com' },
    { id: 'siteinspire', name: 'SiteInspire', note: '웹사이트 갤러리', site: 'siteinspire.com' },
  ];
  function galleryLinks(q) {
    const text = String(q || '').trim(); if (!text) return [];
    return GALLERIES.map((g) => ({
      id: g.id, name: g.name, note: g.note,
      url: g.url ? g.url(text) : `https://www.google.com/search?q=${encodeURIComponent(`${text} site:${g.site}`)}`,
    }));
  }

  /** 사이트 URL → 스크린샷 미리보기(thum.io 무료 공개 서비스, 키 불필요). */
  function screenshotUrl(siteUrl) { const u = safeUrl(siteUrl); return u ? `https://image.thum.io/get/width/640/crop/420/${u}` : ''; }

  // ---- 내 보드 ----
  function getBoard() {
    try { const v = JSON.parse(G.settingsSync.get(BOARD_KEY) || '[]'); return Array.isArray(v) ? v.filter((x) => x && x.id && safeUrl(x.link || x.img)) : []; } catch { return []; }
  }
  function saveBoard(list) { G.settingsSync.set(BOARD_KEY, JSON.stringify(list.slice(0, MAX_BOARD))); }
  function parseTags(t) { return [...new Set(String(t || '').split(/[,#\s]+/).map((x) => x.trim().slice(0, 20)).filter(Boolean))].slice(0, 8); }
  /** {title, img, link, note, tags} 추가. 링크 또는 이미지 URL 중 하나는 필수. 같은 링크/이미지는 중복 추가하지 않는다. */
  function addToBoard(p) {
    const link = safeUrl(p.link), img = safeUrl(p.img);
    if (!link && !img) throw new Error('http(s) 주소만 저장할 수 있어요.');
    const list = getBoard();
    const dup = list.find((x) => (link && x.link === link) || (img && x.img && x.img === img));
    if (dup) return { added: false, item: dup };
    if (list.length >= MAX_BOARD) throw new Error(`보드는 최대 ${MAX_BOARD}개까지 저장할 수 있어요.`);
    const it = { id: `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, title: clip(p.title, 120) || link || img, img, link: link || img, note: clip(p.note, 300), tags: parseTags(Array.isArray(p.tags) ? p.tags.join(' ') : p.tags), at: new Date().toISOString() };
    saveBoard([it, ...list]);
    return { added: true, item: it };
  }
  function removeFromBoard(id) { saveBoard(getBoard().filter((x) => x.id !== id)); }
  function updateBoard(id, patch) {
    saveBoard(getBoard().map((x) => (x.id === id ? { ...x, note: patch.note !== undefined ? clip(patch.note, 300) : x.note, tags: patch.tags !== undefined ? parseTags(patch.tags) : x.tags } : x)));
  }

  G.RefService = { searchOpenverse, searchCommons, arenaChannel, parseArenaSlug, galleryLinks, GALLERIES, screenshotUrl, safeUrl, getBoard, addToBoard, removeFromBoard, updateBoard, parseTags, BOARD_KEY, MAX_BOARD };
})();
