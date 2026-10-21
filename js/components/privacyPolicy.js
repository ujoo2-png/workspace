// 개인정보 처리방침 / 이용약관 (v7.25.0).
// 로그인 화면에서 "클릭하면 열리는" 표준 방식으로 제공한다. 일반 웹앱이 그러하듯
//   · 로그인 폼 아래에 동의 문구("가입 시 …에 동의한 것으로 봅니다")와 링크를 두고,
//   · 링크를 누르면 모달로 전체 문서를 보여준다(스크롤·닫기).
// 이 앱은 로컬/개인용 대시보드지만, 실제로 저장·전송되는 항목(이메일·브라우저 저장소·
// Supabase·외부 API 키 등)을 정직하게 나열한다(과장·누락 없이).
// 일반 <script>로 로드되며 window.openModal, window.el이 먼저 준비되어야 한다.
(function () {
  const { el, openModal } = window;

  // 최종 개정일. 내용을 바꾸면 이 날짜도 함께 바꾼다.
  const UPDATED_AT = '2026-10-21';

  // 섹션 구조로 두면 모달 렌더링과 (향후) 마크다운/인쇄 내보내기를 함께 쓸 수 있다.
  const POLICY_SECTIONS = [
    {
      title: '1. 총칙',
      body: [
        '본 방침은 "나만의 Work Space"(이하 "본 앱")가 이용자의 개인정보를 어떻게 수집·이용·보관·파기하는지 설명합니다.',
        '본 앱은 1인 사용을 전제로 한 개인용 워크스페이스 대시보드이며, 회원가입·로그인을 통해 이용자별 데이터를 분리 저장합니다.',
        '본 방침은 개인정보 보호법 등 관련 법령과 일반적인 웹 서비스 관행을 따릅니다.',
      ],
    },
    {
      title: '2. 수집하는 개인정보 항목',
      body: [
        '① 회원 식별 정보: 이메일 주소(아이디), 비밀번호(암호화되어 저장되며 원문은 보관하지 않음), 이름(선택).',
        '② 이용자가 직접 입력하는 서비스 데이터: 일정·프로젝트·프로그램·관심주제·문화생활·차량·증권·건강·경력·메모 등.',
        '③ 자동 수집 정보(브라우저 저장소): 테마·화면 설정·최근 본 항목·외부 API 키(아래 5항 참고) 등.',
        '④ 본 앱은 주민등록번호, 여권번호, 계좌 비밀번호 등 고유식별정보·민감정보를 요구하지 않습니다. 이용자가 메모 등에 자발적으로 입력한 경우에 한해 보관됩니다.',
      ],
    },
    {
      title: '3. 개인정보의 이용 목적',
      body: [
        '회원 식별 및 로그인, 이용자별 데이터 분리 저장, 서비스 제공 및 화면 표시, 이용자가 켠 자동화(알림·자동 수집)의 실행.',
        '수집한 정보를 광고·마케팅 목적으로 제3자에게 판매하거나 제공하지 않습니다.',
      ],
    },
    {
      title: '4. 보관 및 파기',
      body: [
        '데이터는 이용자가 삭제하거나 계정을 삭제할 때까지 보관됩니다. 대부분의 항목은 즉시 삭제 대신 "휴지통(소프트 삭제)" 방식으로 표시에서 제외한 뒤 완전 삭제할 수 있습니다.',
        '회원 탈퇴·계정 삭제 시 해당 계정의 데이터는 관계 법령에 따라 보존이 필요한 경우를 제외하고 지체 없이 파기합니다.',
      ],
    },
    {
      title: '5. 개인정보의 저장 위치 및 처리 위탁(외부 서비스)',
      body: [
        '본 앱은 "로컬 모드"와 "Supabase 모드" 두 가지로 동작하며, 설정에 따라 저장 위치가 달라집니다.',
        '· 로컬 모드: 모든 데이터가 이용자의 브라우저(localStorage)에만 저장되며 외부 서버로 전송되지 않습니다.',
        '· Supabase 모드: 데이터가 Supabase(클라우드 데이터베이스)에 이용자 계정별로 저장됩니다. 전송 구간은 HTTPS로 암호화되며, 행 수준 보안(RLS)으로 다른 이용자의 데이터에 접근할 수 없도록 분리합니다.',
        '· 시세 조회: 증권 기능을 쓸 때 입력한 한국투자증권(KIS) API 키는 서버에 저장하지 않고 이용자의 브라우저에만 보관하며, 시세 조회 요청을 중계(프록시)할 때에만 전송됩니다.',
        '· 날씨·문화행사 등 공공 데이터 조회: 이용자가 입력한 공공데이터포털 인증키를 브라우저에만 저장하고 조회 시에만 전송합니다.',
        '본 앱은 외부 서비스(호스팅·데이터베이스·공공 API)의 약관에도 함께 적용을 받습니다.',
      ],
    },
    {
      title: '6. 이용자의 권리',
      body: [
        '이용자는 언제든지 자신의 정보를 조회·수정·삭제할 수 있습니다. 설정 화면의 "데이터 내보내기"로 전체 백업(JSON)을 받을 수 있고, "사용자 관리"에서 계정을 관리할 수 있습니다.',
        '비밀번호는 설정 화면에서 변경할 수 있으며, 분실 시 재설정 링크(이메일)로 재설정할 수 있습니다.',
      ],
    },
    {
      title: '7. 안전성 확보 조치',
      body: [
        '비밀번호는 단방향 해시(로컬) 또는 인증 서비스(Supabase Auth)로 보관하며 원문을 저장하지 않습니다.',
        '회원가입 후 관리자 승인 전에는 로그인할 수 없도록 접근을 통제합니다.',
        '무활동 시 자동 로그아웃 등 세션 보호 기능을 제공합니다.',
      ],
    },
    {
      title: '8. 방침의 변경',
      body: [
        '본 방침이 변경되는 경우 앱 내 공지 또는 버전 표기로 알립니다. 변경된 방침은 로그인 화면의 같은 링크에서 확인할 수 있습니다.',
      ],
    },
    {
      title: '9. 문의',
      body: [
        '본 앱은 개인이 운영하는 비영리 개인 프로젝트로 별도의 고객센터가 없습니다. 개인정보 관련 문의는 운영자(저장소 관리자)에게 직접 전달해 주세요.',
      ],
    },
  ];

  /** 방침 문서 노드(모달 본문에 넣는다). */
  function buildPolicyBody() {
    const host = el('div', { class: 'privacy-doc' });
    host.append(
      el('p', { class: 'privacy-doc__meta' }, `시행일: ${UPDATED_AT} · 나만의 Work Space`),
      el('p', { class: 'privacy-doc__lead' }, '아래 내용은 본 앱이 실제로 저장·처리하는 정보를 기준으로 작성했습니다.')
    );
    for (const s of POLICY_SECTIONS) {
      host.append(el('h3', { class: 'privacy-doc__h' }, s.title));
      for (const p of s.body) host.append(el('p', { class: 'privacy-doc__p' }, p));
    }
    return host;
  }

  /** 개인정보 처리방침 모달을 연다. */
  function openPrivacyPolicy() {
    openModal({
      title: '개인정보 처리방침',
      width: '620px',
      contentBuilder(body, close) {
        body.classList.add('privacy-modal');
        body.append(buildPolicyBody());
        body.append(
          el('div', { class: 'row', style: 'justify-content:flex-end; gap:8px; margin-top:16px' }, [
            el('button', { class: 'nm-btn', onclick: () => printPolicy() }, '🖨 인쇄'),
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => close() }, '확인'),
          ])
        );
      },
    });
  }

  /** 방침 문서를 인쇄용 창으로 연다(표준 웹앱 방식). */
  function printPolicy() {
    const win = window.open('', '_blank');
    if (!win) { window.toast('팝업이 차단되었습니다. 브라우저에서 팝업을 허용해 주세요.', 'error'); return; }
    const sections = POLICY_SECTIONS.map((s) => `<h2>${s.title}</h2>${s.body.map((p) => `<p>${p}</p>`).join('')}`).join('');
    win.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>개인정보 처리방침</title>
      <style>body{font-family:'Pretendard','Apple SD Gothic Neo',sans-serif;line-height:1.7;color:#1e293b;max-width:720px;margin:40px auto;padding:0 20px}
      h1{font-size:20px}h2{font-size:15px;margin-top:22px;color:#1a4f8a}p{font-size:13px;margin:6px 0;color:#334155}.meta{color:#64748b;font-size:12px}</style></head>
      <body><h1>개인정보 처리방침</h1><p class="meta">시행일: ${UPDATED_AT} · 나만의 Work Space</p>${sections}</body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  Object.assign(window, { openPrivacyPolicy, POLICY_UPDATED_AT: UPDATED_AT });
})();
