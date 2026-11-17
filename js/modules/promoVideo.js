// 🎬 홍보 영상 (v7.37.0) — 프로그램 메뉴 안에서 MoneyPrinterTurbo(내 PC/서버에서 실행)를 호출해 짧은 홍보 영상을 만든다.
// 웹앱은 영상을 직접 렌더링할 수 없다(FFmpeg 필요). 그래서 이 화면은 "대본·설정 준비 → 내 서버에 작업 요청 → 진행률 확인 → 결과 영상 보기"만 맡는다.
// 서버 주소는 설정으로 저장(동기화), API 키는 이 기기(localStorage)에만 둔다. 일반 <script>, window.renderPromoVideo.
(function () {
  const { appState, el, toast, escapeHtml } = window;
  const PL = () => window.PromoLogic;
  const SERVER_KEY = 'workspace:promo:server';
  const HIST_KEY = 'workspace:promo:history';
  const APIKEY_LS = 'workspace:promo:apiKey';

  function loadServer() {
    try { const raw = window.settingsSync && window.settingsSync.get(SERVER_KEY); const o = raw ? JSON.parse(raw) : {}; return { api: PL().normalizeBase(o.api, PL().DEFAULTS.api), ui: PL().normalizeBase(o.ui, PL().DEFAULTS.ui) }; } catch (e) { return { ...PL().DEFAULTS }; }
  }
  function saveServer(s) { try { window.settingsSync.set(SERVER_KEY, JSON.stringify(s)); } catch (e) { /* 무시 */ } }
  function loadKey() { try { return localStorage.getItem(APIKEY_LS) || ''; } catch (e) { return ''; } }
  function saveKey(k) { try { if (k) localStorage.setItem(APIKEY_LS, k); else localStorage.removeItem(APIKEY_LS); } catch (e) { /* 무시 */ } }
  function loadHist() { try { const a = JSON.parse(window.settingsSync.get(HIST_KEY) || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveHist(a) { try { window.settingsSync.set(HIST_KEY, JSON.stringify(a.slice(0, 20))); } catch (e) { /* 무시 */ } }

  const headers = () => { const k = loadKey(); return k ? { 'x-api-key': k, 'content-type': 'application/json' } : { 'content-type': 'application/json' }; };

  async function probe(api) {
    let cors = null; let noCors = false;
    try { const r = await fetch(`${api}/ping`, { cache: 'no-store', signal: AbortSignal.timeout(5000) }); cors = { ok: r.ok, status: r.status }; } catch (e) { /* CORS 차단 또는 서버 꺼짐 */ }
    if (cors && cors.ok) {
      // /ping은 인증이 없으니, 키가 필요한 API도 실제로 열리는지 한 번 더 본다.
      try { const r2 = await fetch(`${api}/api/v1/tasks?page=1&page_size=1`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(5000) }); if (r2.status === 401 || r2.status === 403) cors = { ok: false, status: r2.status }; } catch (e) { cors = null; }
    }
    if (!cors) { try { await fetch(`${api}/ping`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(5000) }); noCors = true; } catch (e) { noCors = false; } }
    return PL().classifyProbe({ cors, noCors });
  }

  function renderPromoVideo() {
    const root = el('div', { class: 'stack promo', style: 'gap:14px' });
    const server = loadServer();
    let statusBox; let jobsBox; const jobs = []; // {taskId, subject, state, progress, videos, error, timer}

    // ---- 1) 서버 연결 ----
    const apiInput = el('input', { class: 'nm-input promo-api', value: server.api, placeholder: 'http://127.0.0.1:8080' });
    const uiInput = el('input', { class: 'nm-input promo-ui', value: server.ui, placeholder: 'http://127.0.0.1:8501' });
    const keyInput = el('input', { class: 'nm-input promo-key', type: 'password', value: loadKey(), placeholder: '서버에 api_key를 설정한 경우만', autocomplete: 'off' });
    statusBox = el('div', { class: 'promo-status text-muted', style: 'font-size:13px' }, '아직 확인하지 않았습니다.');
    const persist = () => { const s = { api: PL().normalizeBase(apiInput.value, PL().DEFAULTS.api), ui: PL().normalizeBase(uiInput.value, PL().DEFAULTS.ui) }; saveServer(s); saveKey(keyInput.value.trim()); return s; };
    const check = el('button', { class: 'nm-btn promo-check', type: 'button', onclick: async () => {
      const s = persist(); statusBox.textContent = '확인 중…';
      const r = await probe(s.api);
      statusBox.textContent = `${{ ready: '🟢', cors: '🟠', auth: '🟠', off: '🔴' }[r.state]} ${r.text}`; statusBox.dataset.state = r.state;
    } }, '🔌 연결 확인');
    const openUi = el('button', { class: 'nm-btn', type: 'button', title: 'MoneyPrinterTurbo 자체 화면을 새 탭으로 엽니다', onclick: () => { const s = persist(); window.open(s.ui, '_blank', 'noopener'); } }, '🌐 MoneyPrinterTurbo 열기');
    root.append(el('div', { class: 'nm-card' }, [
      el('h3', { style: 'margin-bottom:6px' }, '🎬 홍보 영상 만들기 (MoneyPrinterTurbo)'),
      el('div', { class: 'text-muted', style: 'font-size:12px; margin-bottom:10px' }, '영상은 내 PC(또는 서버)의 MoneyPrinterTurbo가 만듭니다. 이 화면은 대본과 설정을 준비해 작업을 요청하고 결과를 보여 줍니다. 서버가 꺼져 있으면 아래 대본 복사 + "열기"로 직접 만들 수 있습니다.'),
      el('div', { class: 'stack', style: 'gap:8px' }, [
        el('label', { class: 'nm-field' }, [el('span', {}, 'API 주소'), apiInput]),
        el('label', { class: 'nm-field' }, [el('span', {}, '웹 화면 주소'), uiInput]),
        el('label', { class: 'nm-field' }, [el('span', {}, 'API 키 (이 기기에만 저장, 동기화 안 됨)'), keyInput]),
        el('div', { class: 'row wrap', style: 'gap:8px; align-items:center' }, [check, openUi, statusBox]),
      ]),
      el('details', { style: 'margin-top:10px; font-size:12px' }, [
        el('summary', { style: 'cursor:pointer' }, '처음 설정하는 방법 / 연결이 안 될 때'),
        el('div', { class: 'stack text-muted', style: 'gap:4px; margin-top:6px' }, [
          el('div', {}, '1) 내 PC에 MoneyPrinterTurbo 설치(Windows는 릴리스의 원클릭 패키지, 그 외 Python 3.11+ · FFmpeg).'),
          el('div', {}, '2) 소재용 Pexels API 키를 MoneyPrinterTurbo 설정에 입력(무료 발급). 음성은 Edge TTS(무료, 키 불필요).'),
          el('div', {}, `3) 이 앱에서 직접 호출하려면 서버를 시작하기 전에 환경변수 CORS_ALLOWED_ORIGINS=${location.origin} 를 설정하세요. 설정하지 않으면 "열기"와 대본 복사로는 쓸 수 있지만 [영상 만들기]는 막힙니다.`),
          el('div', {}, '4) 서버를 외부에 열 계획이면 api_key를 반드시 설정하세요. 공개 인터넷에 인증 없이 열지 마세요.'),
          el('div', {}, '5) Chrome/Edge는 https 페이지에서 http://127.0.0.1 호출을 허용합니다(처음 한 번 "로컬 네트워크 접근" 허용 창이 뜰 수 있음). Safari는 막힐 수 있습니다.'),
        ]),
      ]),
    ]));

    // ---- 2) 영상 설정 ----
    const programs = (appState.programs || []).filter((p) => !p.deleted_at);
    const progSel = el('select', { class: 'nm-select promo-prog' }, [el('option', { value: '' }, '— 프로그램 선택(또는 직접 입력) —'), ...programs.map((p) => el('option', { value: p.id }, p.name))]);
    const subject = el('input', { class: 'nm-input promo-subject', placeholder: '영상 주제(프로그램 이름)' });
    const audience = el('input', { class: 'nm-input promo-aud', placeholder: '대상 예: 소규모 농장 운영자' });
    const features = el('input', { class: 'nm-input promo-feat', placeholder: '핵심 기능 2~4개를 쉼표로 (예: 일정 자동 정리, 센서 알림, 모바일 지원)' });
    const cta = el('input', { class: 'nm-input promo-cta', placeholder: '마지막 한마디 (예: 링크에서 바로 써 보세요)' });
    const script = el('textarea', { class: 'nm-textarea promo-script', rows: 7, placeholder: '대본(한 줄 = 한 장면). [대본 초안 만들기]로 시작해 자유롭게 고치세요.' });
    const terms = el('input', { class: 'nm-input promo-terms', value: PL().DEFAULT_TERMS, title: '소재(Pexels)는 영어로 검색합니다' });
    const aspect = el('select', { class: 'nm-select promo-aspect' }, [['9:16', '세로 9:16 (쇼츠·릴스)'], ['16:9', '가로 16:9'], ['1:1', '정사각 1:1']].map(([v, l]) => el('option', { value: v }, l)));
    const voice = el('select', { class: 'nm-select promo-voice' }, [['ko-KR-SunHiNeural-Female', '한국어 여성(SunHi)'], ['ko-KR-InJoonNeural-Male', '한국어 남성(InJoon)']].map(([v, l]) => el('option', { value: v }, l)));
    const subtitle = el('input', { type: 'checkbox', checked: true, class: 'promo-sub' });
    const parts = () => ({ name: subject.value, description: (programs.find((p) => p.id === progSel.value) || {}).description || '', url: (programs.find((p) => p.id === progSel.value) || {}).url || '' });
    progSel.addEventListener('change', () => { const p = programs.find((x) => x.id === progSel.value); if (p) subject.value = p.name; });
    const draftBtn = el('button', { class: 'nm-btn promo-draft', type: 'button', onclick: () => {
      script.value = PL().buildScript(parts(), { audience: audience.value, features: features.value.split(/[,，]/), cta: cta.value });
      toast('대본 초안을 만들었습니다. 내용을 확인하고 고쳐 주세요(규칙 기반 초안입니다).', 'success');
    } }, '✍ 대본 초안 만들기');
    const copyBtn = el('button', { class: 'nm-btn', type: 'button', onclick: async () => {
      const text = `주제: ${subject.value}\n\n${script.value}\n\n검색 키워드: ${terms.value}`;
      try { await navigator.clipboard.writeText(text); toast('대본을 복사했습니다. MoneyPrinterTurbo 화면에 붙여넣으세요.', 'success'); } catch (e) { toast('복사하지 못했습니다.', 'error'); }
    } }, '📋 대본 복사');
    const makeBtn = el('button', { class: 'nm-btn nm-btn--primary promo-make', type: 'button', onclick: createJob }, '🎬 영상 만들기');
    root.append(el('div', { class: 'nm-card' }, [
      el('h3', { style: 'margin-bottom:8px' }, '영상 설정'),
      el('div', { class: 'stack', style: 'gap:8px' }, [
        el('label', { class: 'nm-field' }, [el('span', {}, '프로그램'), progSel]),
        el('label', { class: 'nm-field' }, [el('span', {}, '영상 주제'), subject]),
        el('div', { class: 'row wrap', style: 'gap:8px' }, [el('label', { class: 'nm-field', style: 'flex:1 1 220px' }, [el('span', {}, '대상'), audience]), el('label', { class: 'nm-field', style: 'flex:2 1 300px' }, [el('span', {}, '핵심 기능'), features])]),
        el('label', { class: 'nm-field' }, [el('span', {}, '마무리 문구'), cta]),
        el('label', { class: 'nm-field' }, [el('span', {}, '대본'), script]),
        el('label', { class: 'nm-field' }, [el('span', {}, '소재 검색 키워드(영문, 쉼표 구분)'), terms]),
        el('div', { class: 'row wrap', style: 'gap:8px; align-items:center' }, [aspect, voice, el('label', { class: 'row', style: 'gap:4px; font-size:13px' }, [subtitle, '자막'])]),
        el('div', { class: 'row wrap', style: 'gap:8px' }, [draftBtn, copyBtn, makeBtn]),
        el('div', { class: 'text-muted', style: 'font-size:12px' }, '⚠ 스톡 영상·음악·음성은 각각 이용 약관이 있습니다. 상업 홍보에 쓰기 전에 확인하고, 내레이션 발음(고유명사·약어)은 꼭 들어 보세요. 프로그램 화면은 스톡에 없으므로 필요하면 MoneyPrinterTurbo에서 내 캡처 이미지를 소재로 추가하세요.'),
      ]),
    ]));

    // ---- 3) 작업 목록 ----
    jobsBox = el('div', { class: 'stack promo-jobs', style: 'gap:8px' });
    root.append(el('div', { class: 'nm-card' }, [el('h3', { style: 'margin-bottom:8px' }, '진행·완료'), jobsBox]));
    function drawJobs() {
      jobsBox.innerHTML = '';
      const hist = loadHist();
      if (!jobs.length && !hist.length) { jobsBox.append(el('div', { class: 'text-muted', style: 'font-size:13px' }, '아직 만든 영상이 없습니다.')); return; }
      for (const j of jobs) {
        jobsBox.append(el('div', { class: `promo-job promo-job--${j.state}`, style: 'border:1px solid var(--border); border-radius:10px; padding:8px 10px' }, [
          el('div', { class: 'row row--between' }, [el('strong', { style: 'font-size:13px' }, j.subject), el('span', { class: 'nm-badge' }, j.state === 'done' ? '완료' : j.state === 'failed' ? '실패' : `진행 ${j.progress}%`)]),
          j.state === 'running' ? el('progress', { max: '100', value: String(j.progress), style: 'width:100%' }) : null,
          j.error ? el('div', { class: 'text-muted', style: 'font-size:12px' }, `⚠ ${j.error}`) : null,
          ...j.videos.map((u) => el('div', { class: 'stack', style: 'gap:4px; margin-top:6px' }, [el('video', { src: u, controls: true, style: 'max-width:100%; max-height:360px' }), el('a', { href: u, target: '_blank', rel: 'noopener', style: 'font-size:12px' }, '새 탭에서 열기 / 저장')])),
        ]));
      }
      if (hist.length) {
        jobsBox.append(el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:6px' }, '최근 만든 영상(링크는 서버가 켜져 있을 때만 열립니다)'));
        for (const h of hist.slice(0, 8)) jobsBox.append(el('div', { class: 'row', style: 'gap:8px; font-size:12px' }, [el('span', {}, (h.at || '').slice(0, 16).replace('T', ' ')), el('span', { style: 'flex:1' }, h.subject || ''), h.url ? el('a', { href: h.url, target: '_blank', rel: 'noopener' }, '열기') : null]));
      }
    }

    async function createJob() {
      const s = persist();
      if (!script.value.trim()) { toast('대본을 먼저 입력하거나 [대본 초안 만들기]를 눌러 주세요.', 'error'); return; }
      const body = PL().buildTaskBody({ subject: subject.value, script: script.value, terms: terms.value, aspect: aspect.value, voice: voice.value, subtitle: subtitle.checked });
      makeBtn.disabled = true;
      try {
        const res = await fetch(`${s.api}/api/v1/videos`, { method: 'POST', headers: headers(), body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(json.message || `HTTP ${res.status}`);
        const id = json && json.data && json.data.task_id;
        if (!id) throw new Error('작업 번호를 받지 못했습니다.');
        const job = { taskId: id, subject: body.video_subject, state: 'running', progress: 0, videos: [], error: '' };
        jobs.unshift(job); drawJobs(); poll(job, s.api);
        toast('영상 제작을 요청했습니다. 보통 몇 분 걸립니다.', 'success');
      } catch (e) {
        const hint = e instanceof TypeError ? ' — 서버가 꺼져 있거나 이 앱 주소가 CORS에 허용되지 않았을 수 있습니다([🔌 연결 확인] 참고).' : '';
        toast(`요청하지 못했습니다: ${e.message || e}${hint}`, 'error');
      } finally { makeBtn.disabled = false; }
    }
    function poll(job, api) {
      const tick = async () => {
        if (!root.isConnected) return; // 화면을 떠나면 조회를 멈춘다
        try {
          const r = await fetch(`${api}/api/v1/tasks/${encodeURIComponent(job.taskId)}`, { headers: headers(), cache: 'no-store', signal: AbortSignal.timeout(10000) });
          const t = PL().parseTask(await r.json().catch(() => null), api);
          job.state = t.state === 'unknown' ? 'running' : t.state; job.progress = t.progress; job.videos = t.videos;
          if (t.state === 'failed') job.error = '서버에서 제작에 실패했습니다. MoneyPrinterTurbo 로그(키·소재·음성 설정)를 확인하세요.';
          drawJobs();
          if (t.state === 'done') { const h = loadHist(); h.unshift({ at: new Date().toISOString(), subject: job.subject, url: t.videos[0] || '' }); saveHist(h); toast('홍보 영상이 완성되었습니다.', 'success'); return; }
          if (t.state === 'failed') return;
        } catch (e) { job.error = '진행 상황을 읽지 못했습니다(서버 응답 없음). 다시 시도 중…'; drawJobs(); }
        job.timer = setTimeout(tick, 3000);
      };
      job.timer = setTimeout(tick, 2000);
    }
    drawJobs();
    return root;
  }
  window.renderPromoVideo = renderPromoVideo;
})();
