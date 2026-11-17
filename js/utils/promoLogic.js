// 홍보 영상(MoneyPrinterTurbo 연동) 순수 로직 (v7.37.0) — 화면/네트워크 없이 Node 테스트가 가능하다.
// MoneyPrinterTurbo(MIT) API 규격은 공식 저장소 소스에서 확인했다:
//   POST {api}/api/v1/videos  → {status:200, data:{task_id}}      (본문: VideoParams — video_subject 필수)
//   GET  {api}/api/v1/tasks/{id} → {status:200, data:{state, progress, videos:[url]}}  state: 1=완료, -1=실패, 4=진행 중
//   GET  {api}/ping → "pong"      인증키를 설정했다면 /api/v1 요청에 x-api-key 헤더가 필요하다.
//   브라우저가 다른 출처(이 앱)에서 호출하려면 서버를 CORS_ALLOWED_ORIGINS=<이 앱 주소> 로 실행해야 한다.
// 일반 <script>, window.PromoLogic.
(function () {
  const DEFAULTS = { api: 'http://127.0.0.1:8080', ui: 'http://127.0.0.1:8501' };
  const STATE = { COMPLETE: 1, FAILED: -1, PROCESSING: 4 };

  /** 주소 정리: 공백·끝의 / 제거, 스킴이 없으면 http://. 잘못된 값이면 '' . */
  function normalizeBase(u, fallback) {
    let v = String(u == null ? '' : u).trim().replace(/\/+$/, '');
    if (!v) return fallback || '';
    if (!/^https?:\/\//i.test(v)) v = `http://${v}`;
    try { const x = new URL(v); return `${x.protocol}//${x.host}`; } catch (e) { return fallback || ''; }
  }

  const clean = (s) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
  const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

  /**
   * 프로그램 정보 → 30~60초 홍보 대본 초안(규칙 기반, 편집 전제). 문장마다 줄바꿈 → 자막/음성 단위가 된다.
   * @param {{name:string, description?:string, url?:string}} p
   * @param {{audience?:string, features?:string[], cta?:string}} o
   */
  function buildScript(p, o = {}) {
    const name = clean(p && p.name) || '이 프로그램';
    const desc = clean(p && p.description);
    const feats = (o.features || []).map(clean).filter(Boolean).slice(0, 4);
    const aud = clean(o.audience);
    const lines = [];
    lines.push(aud ? `${aud}, 아직도 손으로 관리하고 계신가요?` : '흩어진 자료, 아직도 손으로 관리하고 계신가요?');
    lines.push(`${name}, 한 번에 해결해 드립니다.`); // 이름 끝 글자에 따라 조사(이/가)가 달라지므로 조사 없는 문장으로 쓴다
    if (desc) lines.push(`${cut(desc, 80).replace(/[.。]+$/, '')}.`);
    for (const f of feats) lines.push(`${f.replace(/[.。]+$/, '')}.`);
    lines.push(clean(o.cta) || '지금 바로 사용해 보세요.');
    return lines.join('\n');
  }

  /** 영상 검색 키워드(영문) 기본값 — 소재(Pexels)는 영어 키워드로 검색한다. */
  const DEFAULT_TERMS = 'technology, software, laptop, dashboard, smartphone, teamwork';

  /**
   * 화면 입력 → API 본문. video_terms를 직접 주므로 서버에 LLM 키가 없어도 대본·키워드로 바로 만들 수 있다.
   * @param {{subject:string, script:string, terms?:string, aspect?:string, voice?:string, clipSec?:number, subtitle?:boolean, count?:number, lang?:string}} f
   */
  function buildTaskBody(f) {
    const aspect = ['9:16', '16:9', '1:1'].includes(f.aspect) ? f.aspect : '9:16';
    const terms = clean(f.terms || DEFAULT_TERMS).split(/[,，]/).map(clean).filter(Boolean);
    const body = {
      video_subject: clean(f.subject) || '홍보 영상',
      video_script: String(f.script || '').trim(),
      video_terms: terms,
      video_aspect: aspect,
      video_clip_duration: Math.min(15, Math.max(1, Number(f.clipSec) || 5)),
      video_count: Math.min(5, Math.max(1, Number(f.count) || 1)),
      subtitle_enabled: f.subtitle !== false,
      video_source: 'pexels',
    };
    if (f.voice) body.voice_name = clean(f.voice);
    if (f.lang) body.video_language = clean(f.lang);
    return body;
  }

  /** 작업 조회 응답 → 화면용 상태. 알 수 없는 모양이면 안전하게 'unknown'. */
  function parseTask(json, apiBase) {
    const d = json && json.data ? json.data : null;
    if (!d || typeof d !== 'object') return { state: 'unknown', progress: 0, videos: [] };
    const st = Number(d.state);
    const state = st === STATE.COMPLETE ? 'done' : st === STATE.FAILED ? 'failed' : 'running';
    const vids = (Array.isArray(d.videos) ? d.videos : []).filter((x) => typeof x === 'string').map((x) => (/^https?:\/\//i.test(x) ? x : `${apiBase}${x.startsWith('/') ? '' : '/'}${x}`));
    return { state, progress: Math.max(0, Math.min(100, Math.round(Number(d.progress) || 0))), videos: vids };
  }

  /**
   * 연결 점검 결과 해석. cors: CORS 요청 결과({ok, status}|null), noCors: no-cors 요청이 돌아왔는가.
   *  ready=사용 가능 / cors=서버는 켜졌지만 이 앱 주소가 허용되지 않음 / auth=API 키 필요 / off=응답 없음
   */
  function classifyProbe({ cors, noCors }) {
    if (cors && cors.ok) return { state: 'ready', text: '연결됨 — 영상 만들기를 사용할 수 있습니다' };
    if (cors && (cors.status === 401 || cors.status === 403)) return { state: 'auth', text: 'API 키가 필요합니다(서버에 api_key를 설정했다면 아래에 같은 키를 입력)' };
    if (noCors) return { state: 'cors', text: '서버는 켜져 있지만 이 앱 주소가 허용되지 않았습니다 — 서버를 CORS_ALLOWED_ORIGINS=<이 앱 주소> 로 다시 실행하세요' };
    return { state: 'off', text: '응답이 없습니다 — MoneyPrinterTurbo가 실행 중인지, 주소·포트가 맞는지 확인하세요' };
  }

  window.PromoLogic = { DEFAULTS, STATE, DEFAULT_TERMS, normalizeBase, buildScript, buildTaskBody, parseTask, classifyProbe };
})();
