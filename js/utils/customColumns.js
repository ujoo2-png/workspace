// v7.34.0 이력/경력 사용자 컬럼 — 정의(설정 동기화) + 값(행의 extra jsonb) 순수 로직.
// 일반 <script> + CommonJS 겸용. 정의: { id, label, type:'text'|'date'|'number'|'select', options:[], list:bool, aliases:[], archived:bool }
(function () {
  const KEY = 'workspace:career:customCols';
  const MAX = 5; // 카테고리마다
  const TYPES = [['text', '텍스트'], ['select', '선택 목록'], ['date', '날짜'], ['number', '숫자']];
  const norm = (s) => String(s == null ? '' : s).toLowerCase().replace(/[\s 　:：*※★☆·ㆍ,.\-_/\\|~()（）[\]{}<>]/g, '');
  const fieldName = (id) => `x_${id}`;
  const isCustomName = (n) => typeof n === 'string' && /^x_[a-z0-9]{3,12}$/.test(n);
  const idOfName = (n) => n.slice(2);

  const PRESETS = {
    education: [['소재지', 'text'], ['학점', 'text'], ['학교구분', 'select', ['고등학교', '전문대', '대학교', '대학원']], ['학위구분', 'select', ['전문학사', '학사', '석사', '박사']]],
    certifications: [['등급', 'text'], ['자격구분', 'select', ['국가공인', '국가기술', '민간']], ['시행국가', 'text']],
    trainings: [['수료여부', 'select', ['수료', '미수료']], ['교육방식', 'select', ['온라인', '오프라인', '혼합']], ['교육비', 'number']],
    memberships: [['회원번호', 'text'], ['회원구분', 'text'], ['소재지', 'text']],
    awards: [['포상구분', 'text'], ['등급/순위', 'text'], ['포상번호', 'text']],
    experiences: [['직위', 'text'], ['직급', 'text'], ['근무지', 'text'], ['퇴직사유', 'text']],
    photos: [['규격', 'text'], ['용도', 'text'], ['촬영장소', 'text']],
  };

  function parse(raw) {
    try { const o = JSON.parse(raw || '{}'); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch { return {}; }
  }
  const sync = () => (typeof window !== 'undefined' && window.settingsSync) || null;
  function load() { const s = sync(); return parse(s ? s.get(KEY) : (typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : '')); }
  function save(map) { const s = sync(); const v = JSON.stringify(map); if (s) s.set(KEY, v); else if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, v); }
  const clean = (d) => ({ id: d.id, label: String(d.label || '').trim().slice(0, 20), type: TYPES.some((t) => t[0] === d.type) ? d.type : 'text', options: Array.isArray(d.options) ? d.options.map((x) => String(x).trim()).filter(Boolean).slice(0, 30) : [], list: d.list !== false, aliases: Array.isArray(d.aliases) ? d.aliases.map((x) => String(x).trim()).filter(Boolean).slice(0, 8) : [], archived: !!d.archived });
  function defs(cat, map = load()) { return (Array.isArray(map[cat]) ? map[cat] : []).filter((d) => d && /^[a-z0-9]{3,12}$/.test(d.id || '')).map(clean); }
  const active = (cat, map) => defs(cat, map).filter((d) => !d.archived);
  const archived = (cat, map) => defs(cat, map).filter((d) => d.archived);

  function newId(map) {
    const used = new Set(Object.values(map).flat().map((d) => d && d.id));
    for (let i = 0; i < 50; i++) { const id = 'c' + Math.random().toString(36).slice(2, 6).padEnd(4, 'x'); if (!used.has(id)) return id; } // 한 번 쓴 id는 재사용하지 않는다
    return 'c' + Date.now().toString(36).slice(-6);
  }

  /**
   * 새 컬럼 이름 검사. builtin: [{ term(정규화됨), label }] — 그 카테고리의 기존 필드 라벨 + 동의어.
   * level: 'ok' | 'warn'(비슷한 기존 필드 — 사용자가 확인하면 진행) | 'block'(같은 이름/중복 — 만들지 않음)
   */
  function checkLabel(cat, label, builtin, map = load(), { ignoreId } = {}) {
    const n = norm(label);
    if (!n) return { level: 'block', msg: '이름을 입력해 주세요.' };
    if (String(label).trim().length > 20) return { level: 'block', msg: '이름은 20자 이내로 입력해 주세요.' };
    const mine = defs(cat, map).filter((d) => d.id !== ignoreId);
    const same = mine.find((d) => norm(d.label) === n || d.aliases.some((a) => norm(a) === n));
    if (same) return { level: 'block', msg: same.archived ? `"${same.label}" 컬럼이 숨김 보관 중입니다. 복원해서 쓰세요.` : `이미 "${same.label}" 컬럼이 있습니다.`, existing: same };
    for (const b of builtin || []) if (b.term === n) return { level: 'block', msg: `이미 기존 필드 "${b.label}"(이)가 있습니다. 새로 만들지 않고 그 필드를 쓰세요.`, builtin: b };
    const part = (builtin || []).find((b) => b.term.length >= 2 && (n.includes(b.term) || (n.length >= 2 && b.term.includes(n) && b.fromLabel)));
    if (part) return { level: 'warn', msg: `기존 필드 "${part.label}"와(과) 겹칠 수 있습니다. 그 필드를 쓰는 편이 좋아요.`, builtin: part };
    return { level: 'ok' };
  }

  // ── 값 ──
  const rawValue = (rec, d) => { const v = rec && rec.extra && typeof rec.extra === 'object' ? rec.extra[d.id] : undefined; return v === undefined || v === null ? '' : v; };
  const display = (rec, d) => { const v = rawValue(rec, d); return v === '' ? '' : String(v); };
  /** 폼에서 모은 {id: 문자열} → 저장할 값(숫자/빈값 정리). 빈 값은 null(병합 때 삭제 의미). */
  function toExtra(defList, raw) {
    const out = {};
    for (const d of defList) {
      if (!(d.id in raw)) continue;
      let v = raw[d.id]; v = v === undefined || v === null ? '' : String(v).trim();
      if (v === '') { out[d.id] = null; continue; }
      if (d.type === 'number') { const n = Number(v.replace(/,/g, '')); out[d.id] = Number.isFinite(n) ? n : null; } else out[d.id] = v.slice(0, 500);
    }
    return out;
  }
  /** 기존 extra + 변경분 → 병합(null이면 삭제). jsonb는 통째로 교체되므로 반드시 병합해서 보낸다. */
  function mergeExtra(existing, patch) {
    const out = { ...(existing && typeof existing === 'object' ? existing : {}) };
    for (const [k, v] of Object.entries(patch || {})) { if (v === null || v === undefined || v === '') delete out[k]; else out[k] = v; }
    return out;
  }
  const withoutKey = (extra, id) => { const o = { ...(extra || {}) }; delete o[id]; return o; };

  /** 빈 값 점검: 어떤 컬럼들이 필요한데 비어 있는 레코드 */
  function missing(rows, defList) { const out = []; for (const r of rows || []) { if (r.deleted_at) continue; const miss = defList.filter((d) => rawValue(r, d) === ''); if (miss.length) out.push({ rec: r, cols: miss }); } return out; }

  const api = { KEY, MAX, TYPES, PRESETS, norm, fieldName, isCustomName, idOfName, load, save, defs, active, archived, newId, clean, checkLabel, rawValue, display, toExtra, mergeExtra, withoutKey, missing };
  if (typeof window !== 'undefined') window.CareerCols = api;
  if (typeof module !== 'undefined') module.exports = api;
})();
