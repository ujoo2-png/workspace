// 양식 문서 분석/매칭 순수 로직 (v7.22.0). 라이브러리(ExcelJS/JSZip)에 의존하지 않는다 — 이미 읽어 둔
// 통합 표 모델(model)만 받아서 "어디에 무엇을 넣을지"(필드/반복 표/사진 위치)를 계산한다. Node 테스트 대상.
//
// 분석 순서(앞 전략이 차지한 칸은 뒤 전략이 건드리지 않는다):
//   (a) 명시 자리표시자  {{이름}} / [[학력.1.학교]]  — 문단 안에서 여러 run으로 쪼개져 있어도 텍스트 기준으로 찾는다
//   (c) 반복 표  : 헤더 행에 알려진 라벨이 2개 이상(인접) → 그 아래 빈 행을 등록 데이터로 순서대로 채움
//   (b) 라벨 감지: "성 명", "생 년 월 일" 같은 라벨 칸 → 오른쪽(없으면 아래) 빈 칸이 입력 칸
//        + "성명: ______" 같은 문단 내 빈칸, "사진"/"증명사진" 칸(칸 자체가 사진 자리)
// 통합 표 모델: model = { kind:'xlsx'|'docx', tables:[{ti,name,rows,nrows,ncols,hint}], units:[텍스트 단위] }
//   rows[r][c] = { r, c, rs, cs, text, covered, mr, mc, formula?, virtual? }  (병합된 칸은 covered=true, 마스터 좌표 mr/mc)
(function () {
  const CL = globalThis.CareerLogic;
  const XT = globalThis.XmlTree;

  // ------------------------------------------------------------------
  // 1) 카테고리/원천 카탈로그
  // ------------------------------------------------------------------
  const CATS = {
    education: {
      label: '학력', table: 'career_education', titleField: 'school_name', dateKey: 'graduation_date', dateFallback: 'admission_date', openLabel: (r) => (r.status === '재학' || r.status === '휴학' ? '재학중' : ''),
      periodOf: ['admission_date', 'graduation_date'],
      fields: [['school_name', '학교명', 'text'], ['degree', '학위/전공', 'text'], ['admission_date', '입학일', 'date'], ['graduation_date', '졸업일', 'date'], ['status', '졸업구분', 'text'], ['period', '재학기간', 'period'], ['note', '비고', 'text', true]],
    },
    certifications: {
      label: '자격증', table: 'career_certifications', titleField: 'cert_name', dateKey: 'acquired_date', openLabel: () => '',
      fields: [['cert_name', '자격증명', 'text'], ['issuing_org', '발급기관', 'text'], ['acquired_date', '취득일', 'date'], ['cert_number', '자격증 번호', 'text'], ['expiry_date', '유효기간', 'date'], ['note', '비고', 'text', true]],
    },
    trainings: {
      label: '교육이수', table: 'career_trainings', titleField: 'training_name', dateKey: 'start_date', dateFallback: 'end_date', openLabel: () => '',
      periodOf: ['start_date', 'end_date'],
      fields: [['training_name', '교육/과정명', 'text'], ['institution', '교육기관', 'text'], ['start_date', '시작일', 'date'], ['end_date', '종료일', 'date'], ['period', '교육기간', 'period'], ['hours', '이수시간', 'text'], ['note', '비고', 'text', true]],
    },
    memberships: {
      label: '가입단체', table: 'career_memberships', titleField: 'org_name', dateKey: 'join_date', openLabel: () => '활동중',
      periodOf: ['join_date', 'leave_date'],
      fields: [['org_name', '단체명', 'text'], ['role', '직책/역할', 'text'], ['join_date', '가입일', 'date'], ['leave_date', '탈퇴일', 'date'], ['period', '활동기간', 'period'], ['note', '비고', 'text', true]],
    },
    awards: {
      label: '포상', table: 'career_awards', titleField: 'award_name', dateKey: 'award_date', openLabel: () => '',
      fields: [['award_name', '포상명', 'text'], ['awarding_body', '수여기관', 'text'], ['award_date', '수상일', 'date'], ['note', '비고', 'text', true]],
    },
    experiences: {
      label: '경력', table: 'career_experiences', titleField: 'company_name', dateKey: 'start_date', openLabel: () => '재직중',
      periodOf: ['start_date', 'end_date'],
      fields: [['company_name', '회사명', 'text'], ['department_position', '부서/직책', 'text'], ['employment_type', '고용형태', 'text'], ['start_date', '입사일', 'date'], ['end_date', '퇴사일', 'date'], ['period', '근무기간', 'period'], ['duration', '근속기간', 'duration'], ['note', '담당업무', 'text', true]],
    },
  };
  const CAT_KEYS = Object.keys(CATS);
  const fieldDef = (cat, f) => CATS[cat].fields.find((x) => x[0] === f);

  const BASIC_FIELDS = [
    ['name', '성명(한글)', 'text'], ['name_en', '영문 이름', 'text'], ['name_hanja', '한자 이름', 'text'], ['birth_date', '생년월일', 'date'],
    ['gender', '성별', 'text'], ['phone', '연락처', 'text'], ['email', '이메일', 'text'], ['address', '주소', 'text'], ['military', '병역', 'text'], ['nationality', '국적', 'text'],
  ];
  const SUMMARY_FIELDS = [['total_experience', '총 경력(겹침 제외)', 'text'], ['today', '작성일(오늘)', 'date'], ['narrative', '경력기술서(자동 문안)', 'text']];

  // ------------------------------------------------------------------
  // 2) 라벨 사전(동의어) — 키는 normKey()로 정규화한 문자열
  // ------------------------------------------------------------------
  const DICT_SRC = {
    'basic.name': ['성명', '이름', '성함', '한글이름', '한글성명', '이름한글', '성명한글', 'name', 'fullname', 'koreanname', '지원자', '지원자명', '신청자', '신청인', '신청자명'],
    'basic.name_en': ['영문이름', '영문성명', '영문명', '이름영문', '성명영문', 'englishname', 'nameenglish', 'nameinenglish'],
    'basic.name_hanja': ['한자이름', '한자성명', '한자명', '이름한자', '성명한자', 'chinesename', 'hanja'],
    'basic.birth_date': ['생년월일', '생일', '출생일', '출생년월일', '생년월일일', 'birth', 'birthday', 'birthdate', 'dateofbirth', 'dob'],
    'basic.gender': ['성별', 'gender', 'sex'],
    'basic.phone': ['연락처', '휴대폰', '휴대전화', '핸드폰', '전화번호', '전화', '휴대폰번호', '핸드폰번호', '휴대전화번호', '연락처휴대폰', 'tel', 'phone', 'mobile', 'contact', 'telephone', 'cellphone', 'hp'],
    'basic.email': ['이메일', '이메일주소', '전자우편', '메일', 'email', 'emailaddress', 'e메일', 'mail'],
    'basic.address': ['주소', '현주소', '거주지', '주거지', '자택주소', '현거주지', '주민등록상주소', 'address', 'homeaddress'],
    'basic.military': ['병역', '병역사항', '병역구분', '군필여부', '군별', '병역관계', 'military'],
    'basic.nationality': ['국적', 'nationality'],
    'summary.total_experience': ['총경력', '경력합계', '총경력기간', '총근무기간', '경력총기간', '총경력년수', '총근속기간', '경력총계'],
    'summary.today': ['작성일', '작성일자', '작성일시', '기준일', '제출일', '작성년월일', '작성날짜', 'dateofwriting'],
    'summary.narrative': ['경력기술서', '경력요약', '경력기술', '주요경력', '경력사항요약', '업무경력요약'],
    photo: ['사진', '증명사진', '사진부착', '사진부착란', '사진란', '사진3x4', '사진3×4', '사진3*4', 'photo', 'picture', '여권사진', '반명함판사진'],
    // 카테고리 명시 열(반복 표 열 + 단독 라벨 모두에 쓰임)
    'education.school_name': ['학교명', '학교', '학교이름', '출신학교', '최종학교', '최종학교명', '졸업학교', '학교명소재지', '학교소재지'],
    'education.degree': ['전공', '학과', '전공학과', '학위전공', '학위', '전공명', '학과명', '전공분야', '학과전공', '학위전공명', '전공계열'],
    'education.admission_date': ['입학일', '입학년월', '입학년월일', '입학', '입학일자', '입학연월'],
    'education.graduation_date': ['졸업일', '졸업년월', '졸업년월일', '졸업', '졸업일자', '졸업연월', '졸업예정일'],
    'education.status': ['졸업구분', '졸업여부', '졸업상태', '학적', '학적구분', '졸업유형'],
    'certifications.cert_name': ['자격증명', '자격증', '자격명', '자격종목', '자격면허', '자격면허명', '면허명', '자격증종류', '자격종류', '자격증면허', '자격증명칭', '자격면허종류'],
    'certifications.issuing_org': ['발급기관', '발급처', '발행기관', '시행기관', '발급기관명', '발행처', '자격발급기관', '인증기관'],
    'certifications.acquired_date': ['취득일', '취득일자', '취득년월', '취득년월일', '취득', '발급일', '합격일', '합격년월일', '취득연월', '자격취득일'],
    'certifications.cert_number': ['자격번호', '자격증번호', '면허번호', '등록번호', '증번호', '자격등록번호', '합격번호', '인증번호'],
    'certifications.expiry_date': ['유효기간', '유효기간만료일', '만료일', '갱신일', '유효기한', '유효기간까지', '갱신예정일'],
    'trainings.training_name': ['교육명', '과정명', '교육과정', '교육과정명', '연수명', '교육이수명', '이수과정', '교육명과정명', '교육프로그램', '연수과정', '교육내용', '훈련과정', '훈련과정명', '교육훈련명'],
    'trainings.institution': ['교육기관', '교육기관명', '연수기관', '주관기관', '주최기관', '교육주관', '훈련기관', '교육장소'],
    'trainings.end_date': ['교육종료일', '수료일', '이수일', '이수일자', '교육종료', '수료일자', '이수년월'],
    'trainings.start_date': ['교육시작일', '교육시작'],
    'trainings.period': ['교육기간', '이수기간', '연수기간', '훈련기간', '교육일정'],
    'trainings.hours': ['이수시간', '교육시간', '교육시간수', '이수시간수', '총교육시간'],
    'memberships.org_name': ['단체명', '가입단체', '소속단체', '단체', '협회명', '조직명', '활동단체', '가입단체명', '동호회명', '모임명', '단체협회명', '학회명', '가입협회'],
    'memberships.join_date': ['가입일', '가입일자', '가입년월', '가입년월일', '가입연월'],
    'memberships.leave_date': ['탈퇴일', '탈퇴일자', '탈퇴년월'],
    'memberships.period': ['활동기간', '가입기간', '소속기간'],
    'memberships.role': ['단체직책', '단체역할', '활동역할', '역할', '직책역할', '가입직책'],
    'awards.award_name': ['포상명', '수상명', '상벌명', '포상내역', '수상내역', '상벌내용', '포상', '수상', '표창명', '상명', '수상경력', '포상사항명', '상훈명', '상벌사항'],
    'awards.awarding_body': ['수여기관', '수여처', '시상기관', '시상처', '포상기관', '수상기관', '표창기관', '주관처', '수여자', '상벌기관'],
    'awards.award_date': ['수상일', '포상일', '수상일자', '포상일자', '수상년월일', '수상년월', '상벌일', '표창일', '시상일', '수상연월'],
    'experiences.company_name': ['회사명', '근무처', '근무회사', '직장명', '직장', '회사', '근무처명', '기업명', '업체명', '근무기관', '근무기관명', '회사기관명', '회사명근무처', '직장근무처', '직장명근무처', '소속기관', '근무지', '재직회사'],
    'experiences.department_position': ['부서직책', '부서직위', '직위부서', '직책부서', '직위직책', '부서직급', '직급직책', '소속부서직위', '부서명직위'],
    'experiences.employment_type': ['고용형태', '근무형태', '재직구분', '고용구분', '고용유형', '근로형태', '재직형태'],
    'experiences.start_date': ['입사일', '입사년월', '입사년월일', '입사일자', '입사', '입사연월'],
    'experiences.end_date': ['퇴사일', '퇴사년월', '퇴사년월일', '퇴사일자', '퇴사', '퇴직일', '퇴직년월일', '퇴직', '퇴사연월'],
    'experiences.period': ['근무기간', '재직기간', '근무기간년월', '재직기간년월', '근속기간', '경력기간', '근무년월', '재직년월', '근무연월'],
    'experiences.note': ['담당업무', '업무내용', '주요업무', '수행업무', '담당직무', '직무내용', '주요직무', '업무', '직무', '담당업무내용', '주요업무내용', '업무실적', '경력내용', '주요경력내용', '수행직무', '담당업무및성과'],
  };
  // 카테고리를 알 수 없을 때 헤더의 다른 열/제목 힌트로 정해지는 "역할" 라벨
  const ROLE_SRC = {
    period: ['기간', '기간년월', '기간년월일', '년월', '연월', '근무기간', '학업기간', '재학기간', '일정', '기간(년월~년월)'],
    date: ['일자', '일시', '날짜', '년월일', '일', '날'],
    start: ['시작', '시작일', '시작년월', '시작일자', '시작연월', 'from'],
    end: ['종료', '종료일', '종료년월', '종료일자', '종료연월', 'to', '끝'],
    name: ['명칭', '명', '종류', '항목', '이름', '제목'],
    org: ['기관', '기관명', '발행처', '장소', '소재지', '주관', '주최'],
    position: ['직위', '직책', '부서', '직급', '직무위', '부서직위', '담당', '직위직급'],
    note: ['비고', '내용', '설명', '특기사항', '기타', '참고', '비고내용', '세부내용', '상세내용', '주요내용', '사유'],
    type: ['구분', '상태', '형태', '유형'],
    hours: ['시간', '시간수'],
    seq: ['번호', '순번', 'no', 'no.', '연번', '순서', '일련번호', '#'],
  };
  const ROLE_MAP = {
    period: { education: 'period', trainings: 'period', memberships: 'period', experiences: 'period', certifications: 'acquired_date', awards: 'award_date' },
    date: { education: 'graduation_date', certifications: 'acquired_date', trainings: 'end_date', memberships: 'join_date', experiences: 'start_date', awards: 'award_date' },
    start: { education: 'admission_date', trainings: 'start_date', memberships: 'join_date', experiences: 'start_date', certifications: 'acquired_date', awards: 'award_date' },
    end: { education: 'graduation_date', trainings: 'end_date', memberships: 'leave_date', experiences: 'end_date', certifications: 'expiry_date', awards: 'award_date' },
    name: { education: 'school_name', certifications: 'cert_name', trainings: 'training_name', memberships: 'org_name', awards: 'award_name', experiences: 'company_name' },
    org: { education: 'school_name', certifications: 'issuing_org', trainings: 'institution', memberships: 'org_name', awards: 'awarding_body', experiences: 'company_name' },
    position: { experiences: 'department_position', memberships: 'role' },
    note: { education: 'note', certifications: 'note', trainings: 'note', memberships: 'note', awards: 'note', experiences: 'note' },
    type: { education: 'status', experiences: 'employment_type' },
    hours: { trainings: 'hours' },
    seq: {},
  };
  // 카테고리 제목 힌트(표 위 제목/섹션 행)
  const CAT_HINTS = [
    ['education', /학력|학업|학교|교육사항(?!.*이수)/],
    ['certifications', /자격|면허/],
    ['trainings', /교육|연수|훈련|이수/],
    ['memberships', /단체|동호회|협회|학회|사회활동|대외활동/],
    ['awards', /포상|수상|상벌|표창|상훈/],
    ['experiences', /경력|근무|직장|경험|이력사항|재직/],
  ];
  const FAMILY_RE = /가족|보호자|비상|추천인|보증인|배우자|부모|친족|동거|관계자|연대보증|신원보증/;

  function normKey(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[\s 　:：*※★☆·ㆍ,.\-_/\\|~()（）[\]{}<>]/g, '');
  }
  const DICT = new Map();
  function addDict(key, entry) { if (!DICT.has(key)) DICT.set(key, entry); }
  for (const [src, words] of Object.entries(DICT_SRC)) {
    let entry;
    if (src === 'photo') entry = { t: 'photo' };
    else if (src.startsWith('basic.') || src.startsWith('summary.')) { const [g, f] = src.split('.'); entry = { t: g, f }; } else { const [cat, f] = src.split('.'); entry = { t: 'cat', cat, f }; }
    for (const w of words) addDict(normKey(w), entry);
  }
  for (const [role, words] of Object.entries(ROLE_SRC)) {
    for (const w of words) addDict(normKey(w), role === 'seq' ? { t: 'seq' } : { t: 'role', role });
  }
  const DICT_KEYS_LONG = [...DICT.keys()].filter((k) => k.length >= 3).sort((a, b) => b.length - a.length);

  /** 라벨 한 칸 → 후보 변형(전체 / 괄호 제거 / 괄호 안 / 구분자로 나눈 부분) */
  function labelVariants(text) {
    const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const out = [];
    const push = (s, weight) => { const k = normKey(s); if (k && !out.some((o) => o.k === k)) out.push({ k, weight }); };
    push(raw, 1);
    const noParen = raw.replace(/[(（[][^)）\]]*[)）\]]/g, ' ');
    push(noParen, 1);
    const parens = [...raw.matchAll(/[(（[]([^)）\]]*)[)）\]]/g)].map((m) => m[1]);
    for (const p of parens) push(p, 0.85);
    for (const part of noParen.split(/[/,·ㆍ&]|\s및\s|\s*\n\s*/)) push(part, 0.9);
    return out;
  }
  /** 라벨 → 사전 항목 {entry, weight, exact} 또는 null. exact=false면 "포함" 매칭(낮은 신뢰). */
  function lookupLabel(text, { allowContains = true } = {}) {
    const raw = String(text == null ? '' : text);
    if (!raw.trim() || raw.length > 60) return null;
    for (const v of labelVariants(raw)) {
      const e = DICT.get(v.k);
      if (e) return { entry: e, weight: v.weight, exact: true };
    }
    if (allowContains && !FAMILY_RE.test(raw)) {
      const full = labelVariants(raw)[0];
      if (full && full.k.length <= 14) {
        for (const k of DICT_KEYS_LONG) {
          if (full.k.includes(k) && !(k.length < full.k.length - 6)) return { entry: DICT.get(k), weight: 0.7, exact: false };
        }
      }
    }
    return null;
  }

  /** 라벨 → 단독(스칼라) 원천 키. 카테고리 항목은 "가장 최근 1건"(latest)에 연결. */
  function scalarSourceOf(hit) {
    const e = hit.entry;
    if (e.t === 'basic') return `basic.${e.f}`;
    if (e.t === 'summary') return `summary.${e.f}`;
    if (e.t === 'cat') return `${e.cat}.latest.${e.f}`;
    if (e.t === 'photo') return 'photo';
    return null;
  }

  // ------------------------------------------------------------------
  // 3) 자리표시자 / 문단 내 빈칸
  // ------------------------------------------------------------------
  const TOKEN_RE = /\{\{([^{}]+?)\}\}|\[\[([^[\]]+?)\]\]/g;
  const CAT_ALIAS = {
    education: ['학력', 'education', '학교'],
    certifications: ['자격증', '자격', 'certifications', 'certification', 'cert', '면허'],
    trainings: ['교육이수', '교육', 'trainings', 'training', '연수'],
    memberships: ['가입단체', '단체', 'memberships', 'membership', '협회'],
    awards: ['포상', '수상', 'awards', 'award', '상벌'],
    experiences: ['경력', 'experiences', 'experience', 'career', '근무'],
  };
  const CAT_ALIAS_MAP = new Map();
  for (const [cat, list] of Object.entries(CAT_ALIAS)) for (const a of list) CAT_ALIAS_MAP.set(normKey(a), cat);

  function findTokens(text) {
    const out = [];
    const re = new RegExp(TOKEN_RE.source, 'g');
    let m;
    while ((m = re.exec(text))) out.push({ start: m.index, end: m.index + m[0].length, token: m[0], inner: (m[1] || m[2] || '').trim() });
    return out;
  }
  /** 토큰 안쪽 문자열 → { source, kind, label } (인식 못 하면 source:'manual') */
  function resolveToken(inner) {
    const parts = inner.split('.').map((p) => p.trim()).filter(Boolean);
    const first = parts[0] || '';
    if (parts.length >= 2 && CAT_ALIAS_MAP.has(normKey(first))) {
      const cat = CAT_ALIAS_MAP.get(normKey(first));
      let idx = 'latest';
      let fieldPart;
      const second = parts[1];
      if (/^\d+$/.test(second)) { idx = String(parseInt(second, 10)); fieldPart = parts[2]; } else if (/^(latest|최근|마지막|최신)$/i.test(second)) { fieldPart = parts[2]; } else fieldPart = parts[1];
      if (!fieldPart) fieldPart = CATS[cat].titleField;
      const hit = lookupLabel(fieldPart, { allowContains: false });
      let f = null;
      if (hit && hit.entry.t === 'cat' && hit.entry.cat === cat) f = hit.entry.f;
      else if (hit && hit.entry.t === 'role') f = ROLE_MAP[hit.entry.role][cat] || null;
      else if (CATS[cat].fields.some((x) => x[0] === fieldPart)) f = fieldPart;
      if (f) return { source: `${cat}.${idx}.${f}`, kind: 'scalar' };
      return { source: 'manual', kind: 'scalar' };
    }
    const hit = lookupLabel(inner, { allowContains: false });
    if (hit) {
      if (hit.entry.t === 'photo') return { source: 'photo', kind: 'photo' };
      const s = scalarSourceOf(hit);
      if (s) return { source: s, kind: 'scalar' };
    }
    if (/^(오늘|today)$/i.test(inner)) return { source: 'summary.today', kind: 'scalar' };
    return { source: 'manual', kind: 'scalar' };
  }

  /**
   * "성명: ______  생년월일: ______", "성명 :" 처럼 문단/칸 텍스트 안의 라벨+빈칸을 찾는다.
   * 반환: [{ label, hit, start, end, kind:'underscore'|'trailing' }] — start~end가 값으로 바뀔 구간.
   */
  function inlineBlanks(text, { allowTrailing = true } = {}) {
    const out = [];
    const s = String(text || '');
    let pos = 0;
    while (pos < s.length) {
      const k = s.slice(pos).search(/[:：]/);
      if (k === -1) break;
      const colon = pos + k;
      let chunk = s.slice(pos, colon).replace(/_+/g, ' ');
      chunk = chunk.replace(/^[\s,/|·]+/, '').trim();
      // 라벨 후보: 전체 → 마지막 1~3 단어
      const words = chunk.split(/\s+/);
      let hit = null;
      let label = '';
      for (let take = Math.min(words.length, 3); take >= 1 && !hit; take--) {
        const cand = words.slice(words.length - take).join(' ');
        const h = lookupLabel(cand, { allowContains: false });
        if (h && h.entry.t !== 'role' && h.entry.t !== 'seq') { hit = h; label = cand; }
      }
      const after = s.slice(colon + 1);
      const mUnd = /^[ \t]*(_{2,}|\.{3,}|…+|[ \t]{3,}(?=\S|$))/.exec(after);
      const mTrail = /^[ \t]*$/.exec(after);
      if (hit) {
        if (mUnd && /_{2,}|\.{3,}|…/.test(mUnd[1])) {
          const st = colon + 1 + mUnd[0].length - mUnd[1].length;
          out.push({ label, hit, start: st, end: st + mUnd[1].length, kind: 'underscore' });
          pos = st + mUnd[1].length;
          continue;
        }
        if (mTrail && allowTrailing) {
          out.push({ label, hit, start: s.length, end: s.length, kind: 'trailing' });
          break;
        }
      }
      pos = colon + 1;
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 4) 통합 모델 빌더
  // ------------------------------------------------------------------
  const isBlankText = (t) => /^[\s_·. ]*$/.test(t || '');
  const colLetter = (c) => { let n = c + 1; let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

  function blankCell(r, c, virtual) { return { r, c, rs: 1, cs: 1, text: '', covered: !!virtual, mr: r, mc: c, virtual: !!virtual }; }

  // ---- docx ----
  function wAttr(node, name) { return node ? XT.getAttr(node, name) : null; }
  function paraText(p) {
    let s = '';
    (function walk(n) {
      for (const c of n.children) {
        if (!XT.isEl(c)) continue;
        if (c.name === 'w:t') s += XT.textOf(c);
        else if (c.name === 'w:tab') s += '\t';
        else if (c.name === 'w:br' || c.name === 'w:cr') s += '\n';
        else if (c.name === 'w:del' || c.name === 'w:pPr' || c.name === 'mc:Fallback') continue;
        else walk(c);
      }
    })(p);
    return s;
  }
  /** parts: [{ name:'word/document.xml', root }] — root는 XmlTree.parse 결과 */
  function buildDocxModel(parts) {
    const tables = [];
    const units = []; // 문단 단위
    const paras = []; // 전역 문단 목록(문서 순서)
    const model = { kind: 'docx', parts, tables, units, paras };

    function addPara(p, part, cellCtx, hint) {
      const text = paraText(p);
      const unit = { pi: paras.length, el: p, text, part: part.name, cell: cellCtx || null, topLevel: !cellCtx };
      paras.push(unit);
      units.push(unit);
      if (cellCtx && cellCtx.cellObj) cellCtx.cellObj.paras.push(unit);
      return unit;
    }
    function walkContainer(node, part, cellCtx) {
      const recent = [];
      for (const ch of node.children) {
        if (!XT.isEl(ch)) continue;
        if (ch.name === 'w:p') {
          const u = addPara(ch, part, cellCtx);
          if (u.text.trim()) { recent.push(u.text.trim()); if (recent.length > 2) recent.shift(); }
        } else if (ch.name === 'w:tbl') addTable(ch, part, recent.join(' '));
        else if (ch.name === 'w:sdt') { const content = XT.firstChild(ch, 'w:sdtContent'); if (content) walkContainer(content, part, cellCtx); }
      }
    }
    function addTable(tbl, part, hint) {
      const t = { ti: tables.length, id: `t${tables.length}`, name: `표${tables.length + 1}`, rows: [], nrows: 0, ncols: 0, hint: hint || '', el: tbl, part: part.name };
      tables.push(t);
      const trs = XT.childEls(tbl, 'w:tr');
      t.trs = trs;
      trs.forEach((tr, r) => {
        const row = [];
        const trPr = XT.firstChild(tr, 'w:trPr');
        const gridBefore = trPr ? parseInt(wAttr(XT.firstChild(trPr, 'w:gridBefore'), 'w:val') || '0', 10) : 0;
        for (let k = 0; k < gridBefore; k++) row.push(blankCell(r, row.length, true));
        for (const tc of XT.childEls(tr, 'w:tc')) {
          const tcPr = XT.firstChild(tc, 'w:tcPr');
          const span = tcPr ? parseInt(wAttr(XT.firstChild(tcPr, 'w:gridSpan'), 'w:val') || '1', 10) || 1 : 1;
          const vm = tcPr ? XT.firstChild(tcPr, 'w:vMerge') : null;
          const vmKind = vm ? (wAttr(vm, 'w:val') === 'restart' ? 'restart' : 'cont') : null;
          const c0 = row.length;
          if (vmKind === 'cont' && r > 0 && t.rows[r - 1] && t.rows[r - 1][c0] && !t.rows[r - 1][c0].virtual) {
            const above = t.rows[r - 1][c0];
            const m = t.rows[above.mr][above.mc];
            m.rs += 1;
            for (let k = 0; k < span; k++) row.push({ r, c: c0 + k, rs: 1, cs: 1, text: '', covered: true, mr: m.r, mc: m.c });
            // 이어지는 칸의 문단도 모델에는 넣어 문서 순서 인덱스를 맞춘다(채우지는 않는다)
            walkContainer(tc, part, { ti: t.ti, r, c: c0, cellObj: { paras: [] } });
            continue;
          }
          const cell = { r, c: c0, rs: 1, cs: span, text: '', covered: false, mr: r, mc: c0, tc, tr, paras: [] };
          row.push(cell);
          for (let k = 1; k < span; k++) row.push({ r, c: c0 + k, rs: 1, cs: 1, text: '', covered: true, mr: r, mc: c0 });
          walkContainer(tc, part, { ti: t.ti, r, c: c0, cellObj: cell });
          cell.text = cell.paras.map((p) => p.text).join('\n').replace(/\s+$/g, '');
        }
        t.rows.push(row);
      });
      t.nrows = t.rows.length;
      t.ncols = t.rows.reduce((m, r) => Math.max(m, r.length), 0);
      for (let r = 0; r < t.nrows; r++) while (t.rows[r].length < t.ncols) t.rows[r].push(blankCell(r, t.rows[r].length, true));
    }
    for (const part of parts) {
      const rootEl = part.root.children.find((c) => XT.isEl(c));
      if (!rootEl) continue;
      const body = part.name === 'word/document.xml' ? (XT.firstChild(rootEl, 'w:body') || rootEl) : rootEl;
      walkContainer(body, part, null);
    }
    return model;
  }

  // ---- xlsx ----
  function cellPlain(v) {
    if (v === null || v === undefined) return { text: '' };
    if (typeof v === 'string') return { text: v };
    if (typeof v === 'number' || typeof v === 'boolean') return { text: String(v) };
    if (v instanceof Date) return { text: v.toISOString().slice(0, 10) };
    if (typeof v === 'object') {
      if (v.richText) return { text: v.richText.map((x) => x.text).join(''), rich: true };
      if ('formula' in v || 'sharedFormula' in v) return { text: v.result !== undefined && v.result !== null && typeof v.result !== 'object' ? String(v.result) : '(수식)', formula: true };
      if (v.text !== undefined) return { text: String(v.text) };
      if (v.error) return { text: '' };
    }
    return { text: '' };
  }
  function parseRange(a1) {
    const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(a1);
    if (!m) return null;
    const col = (s) => s.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    return { r0: +m[2] - 1, c0: col(m[1]), r1: +m[4] - 1, c1: col(m[3]) };
  }
  function buildXlsxModel(wb, limits = { rows: 600, cols: 80 }) {
    const tables = [];
    const units = [];
    wb.worksheets.forEach((ws, wsi) => {
      if (ws.state && ws.state !== 'visible') return;
      const nrows = Math.min(Math.max(ws.rowCount || 0, 1), limits.rows);
      const ncols = Math.min(Math.max(ws.columnCount || 0, 1), limits.cols);
      const rows = [];
      for (let r = 0; r < nrows; r++) { const row = []; for (let c = 0; c < ncols; c++) row.push(blankCell(r, c, false)); rows.push(row); }
      for (const a1 of (ws.model && ws.model.merges) || []) {
        const g = parseRange(a1);
        if (!g) continue;
        for (let r = g.r0; r <= Math.min(g.r1, nrows - 1); r++) {
          for (let c = g.c0; c <= Math.min(g.c1, ncols - 1); c++) {
            const cell = rows[r][c];
            if (r === g.r0 && c === g.c0) { cell.rs = g.r1 - g.r0 + 1; cell.cs = g.c1 - g.c0 + 1; } else { cell.covered = true; cell.mr = g.r0; cell.mc = g.c0; }
          }
        }
      }
      ws.eachRow({ includeEmpty: false }, (row, rn) => {
        if (rn > nrows) return;
        row.eachCell({ includeEmpty: true }, (cell, cn) => {
          if (cn > ncols) return;
          const g = rows[rn - 1][cn - 1];
          const b = cell.border;
          if (b && (b.top || b.left || b.bottom || b.right)) g.bordered = true;
          if (g.covered) return;
          const p = cellPlain(cell.value);
          g.text = p.text;
          if (p.formula) g.formula = true;
          if (p.rich) g.rich = true;
        });
      });
      const t = { ti: wsi, id: `s${wsi}`, name: ws.name, rows, nrows, ncols, hint: ws.name };
      tables.push(t);
      for (let r = 0; r < nrows; r++) for (let c = 0; c < ncols; c++) { const g = rows[r][c]; if (!g.covered && g.text && !g.formula) units.push({ ti: wsi, r, c, text: g.text, cell: g }); }
    });
    return { kind: 'xlsx', tables, units };
  }

  // ------------------------------------------------------------------
  // 5) 분석
  // ------------------------------------------------------------------
  const cellKey = (ti, r, c) => `${ti}:${r}:${c}`;
  const oneLine = (t) => String(t || '').replace(/\s+/g, ' ').trim().slice(0, 40);
  function tableName(model, t) { return model.kind === 'xlsx' ? t.name : `표${t.ti + 1}`; }
  function locOf(model, t, r, c) { return model.kind === 'xlsx' ? `${t.name}!${colLetter(c)}${r + 1}` : `표${t.ti + 1} ${r + 1}행 ${c + 1}열`; }
  const masterOf = (t, r, c) => { const x = t.rows[r] && t.rows[r][c]; if (!x || x.virtual) return null; return x.covered ? t.rows[x.mr][x.mc] : x; };
  const isEmptyCell = (cell) => !!cell && !cell.virtual && !cell.formula && isBlankText(cell.text);

  function hintCat(text) {
    let best = null;
    for (const [cat, re] of CAT_HINTS) { const m = re.exec(text || ''); if (m && (best === null || m.index > best.idx)) best = { cat, idx: m.index }; }
    return best ? best.cat : null;
  }
  /** 표 위쪽(최대 4행) 텍스트 + 표 앞 문단 + 왼쪽 세로 병합 라벨에서 카테고리 힌트 */
  function categoryHintFor(t, headerRow) {
    for (let r = headerRow - 1; r >= Math.max(0, headerRow - 4); r--) {
      const texts = [];
      for (const cell of t.rows[r]) if (!cell.covered && cell.text) texts.push(cell.text);
      const h = hintCat(texts.join(' '));
      if (h) return h;
    }
    // 왼쪽 첫 열의 세로 병합 라벨(예: "학 력")
    for (let c = 0; c < Math.min(2, t.ncols); c++) {
      const m = masterOf(t, headerRow, c);
      if (m && m.r < headerRow && m.text) { const h = hintCat(normKey(m.text)); if (h) return h; }
    }
    if (headerRow === 0 || true) { const h = hintCat(t.hint); if (h) return h; }
    return null;
  }

  function confLevel(c) { return c >= 0.85 ? 'high' : c >= 0.6 ? 'mid' : 'low'; }

  function analyze(model, opts = {}) {
    const fields = [];
    const repeats = [];
    const warnings = [];
    const claimed = new Set();
    const claim = (ti, r, c) => claimed.add(cellKey(ti, r, c));
    const isClaimed = (ti, r, c) => claimed.has(cellKey(ti, r, c));
    const usedLoc = new Set();
    const pushField = (f) => {
      f.id = f.id || `f${fields.length + 1}`;
      f.level = confLevel(f.confidence);
      fields.push(f);
      return f;
    };
    const docx = model.kind === 'docx';

    // ---------- (a) 자리표시자 ----------
    for (const u of model.units) {
      if (!u.text) continue;
      const toks = findTokens(u.text);
      if (!toks.length) continue;
      toks.forEach((tk, occ) => {
        const rt = resolveToken(tk.inner);
        let target;
        let loc;
        let t = null;
        if (docx) {
          target = { k: 'para', pi: u.pi, range: [tk.start, tk.end] };
          const partTag = u.part !== 'word/document.xml' ? ` (${/header/.test(u.part) ? '머리글' : '바닥글'})` : '';
          if (u.cell) { t = model.tables[u.cell.ti]; loc = `${locOf(model, t, u.cell.r, u.cell.c)} ${tk.token}${partTag}`; } else loc = `문단 ${u.pi + 1} ${tk.token}${partTag}`;
          if (u.cell) claim(u.cell.ti, u.cell.r, u.cell.c);
        } else {
          t = model.tables.find((x) => x.ti === u.ti);
          target = { k: 'cell', ti: u.ti, r: u.r, c: u.c, range: [tk.start, tk.end], rs: u.cell.rs, cs: u.cell.cs };
          loc = `${locOf(model, t, u.r, u.c)} ${tk.token}`;
          claim(u.ti, u.r, u.c);
        }
        pushField({
          id: docx ? `a:p${u.pi}:${occ}` : `a:${u.ti}:${u.r}:${u.c}:${occ}`,
          kind: rt.kind, how: 'placeholder', loc, label: tk.inner, source: rt.source, confidence: rt.source === 'manual' ? 0.5 : 1, target,
        });
      });
    }

    // ---------- (c) 반복 표 ----------
    for (const t of model.tables) {
      // 헤더 후보 행 탐색
      let r = 0;
      while (r < t.nrows) {
        const hdr = detectHeaderRow(t, r);
        if (!hdr) { r++; continue; }
        const cat = hdr.cat;
        // 본문 용량
        const colsC = hdr.cols.map((x) => x.c);
        let first = r + 1;
        let cap = 0;
        // xlsx: 첫 본문 행에 테두리가 있으면 테두리 없는 행(여백/서명란)에서 멈춘다
        const needBorder = model.kind === 'xlsx' && r + 1 < t.nrows && hdr.cols.some((col) => t.rows[r + 1][col.c] && t.rows[r + 1][col.c].bordered);
        for (let rr = r + 1; rr < t.nrows; rr++) {
          if (detectHeaderRow(t, rr)) break;
          if (needBorder && !hdr.cols.some((col) => t.rows[rr][col.c] && t.rows[rr][col.c].bordered)) break;
          let ok = true;
          for (const col of hdr.cols) {
            const cell = t.rows[rr][col.c];
            if (!cell || cell.virtual) { ok = false; break; }
            const m = cell.covered ? t.rows[cell.mr][cell.mc] : cell;
            if (cell.covered && m.r !== rr) continue; // 세로 병합으로 위 행에 속한 칸 — 건너뜀(비어 있다고 보지 않지만 막지도 않음)
            if (cell.covered && m.c !== col.c && m.r === rr) { if (!isEmptyCell(m) && !(col.source === 'seq')) { ok = false; break; } continue; }
            if (col.source === 'seq') { if (!/^\s*\d*\s*$/.test(m.text || '') || m.formula) { ok = false; break; } continue; }
            if (!isEmptyCell(m)) { ok = false; break; }
          }
          if (!ok) break;
          cap++;
          if (cap >= 40) break;
        }
        // 헤더/본문 칸 점유
        for (const cell of t.rows[r]) claim(t.ti, r, cell.c);
        for (let rr = r + 1; rr <= r + cap; rr++) for (const col of hdr.cols) claim(t.ti, rr, col.c);
        if (cap >= 1) {
          repeats.push({
            id: `r:${t.ti}:${r}`, kind: 'repeat', category: cat, title: CATS[cat].label, loc: `${tableName(model, t)}${model.kind === 'xlsx' ? '' : ''} ${r + 1}행 헤더`,
            confidence: hdr.confidence, level: confLevel(hdr.confidence), capacity: cap,
            cols: hdr.cols.map((x) => ({ c: x.c, label: x.label, source: x.source, confidence: x.confidence })),
            target: { k: 'rows', ti: t.ti, header: r, first, cap },
          });
          r += cap + 1;
        } else {
          warnings.push(`${CATS[cat].label} 표(${tableName(model, t)} ${r + 1}행)를 찾았지만 비어 있는 입력 행이 없어 채우지 않았습니다.`);
          r++;
        }
      }
    }

    // ---------- (b) 라벨(칸) ----------
    for (const t of model.tables) {
      for (let r = 0; r < t.nrows; r++) {
        for (let c = 0; c < t.ncols; c++) {
          const cell = t.rows[r][c];
          if (cell.covered || cell.virtual || !cell.text || cell.formula) continue;
          if (isClaimed(t.ti, r, c)) continue;
          if (cell.text.length > 60) continue;
          if (/_{2,}|\.{3,}|…/.test(cell.text)) continue; // "작성일: ____" 같은 칸 안 빈칸은 아래 인라인 단계에서 처리
          const hit = lookupLabel(cell.text);
          if (!hit || hit.entry.t === 'role' || hit.entry.t === 'seq') continue;
          if (hit.entry.t === 'photo') {
            claim(t.ti, r, c);
            const pt = { k: 'cell', ti: t.ti, r, c, rs: cell.rs, cs: cell.cs };
            pushField({ id: `p:${t.ti}:${r}:${c}`, kind: 'photo', how: 'label-self', loc: locOf(model, t, r, c), label: oneLine(cell.text), source: 'photo', confidence: hit.exact ? 0.8 : 0.55, target: pt });
            continue;
          }
          const src = scalarSourceOf(hit);
          // 입력 칸: 오른쪽 → 아래
          let target = null;
          let how = '';
          const rc = c + cell.cs;
          const right = rc < t.ncols ? masterOf(t, r, rc) : null;
          if (right && right.r === r && right.c === rc && isEmptyCell(right) && !isClaimed(t.ti, right.r, right.c)) { target = right; how = 'label-right'; } else {
            // 아래 칸은 "행 전체가 라벨 줄(헤더형 입력)"일 때만 — 모르는 표(가족 등)의 헤더에 내 정보를 넣지 않기 위해.
            const below = r + cell.rs < t.nrows ? masterOf(t, r + cell.rs, c) : null;
            if (below && below.c === c && isEmptyCell(below) && !isClaimed(t.ti, below.r, below.c) && labelRowRatio(t, r) >= 0.6) { target = below; how = 'label-below'; }
          }
          if (!target) continue;
          claim(t.ti, r, c);
          claim(t.ti, target.r, target.c);
          let conf = how === 'label-right' ? 0.9 : 0.75;
          conf *= hit.weight;
          const familyCtx = FAMILY_RE.test(t.hint || '') || FAMILY_RE.test(rowAboveText(t, r));
          let suggested;
          let source = src;
          if (familyCtx) { conf = Math.min(conf, 0.45); suggested = src; source = 'none'; }
          pushField({
            id: `l:${t.ti}:${r}:${c}`, kind: 'scalar', how, loc: locOf(model, t, target.r, target.c), label: oneLine(cell.text), source, suggested, confidence: Math.round(conf * 100) / 100,
            target: { k: 'cell', ti: t.ti, r: target.r, c: target.c },
            note: familyCtx ? '가족/추천인 등 다른 사람 정보 표로 보여 비워 두었습니다. 필요하면 소스를 직접 고르세요.' : undefined,
          });
        }
      }
    }

    // ---------- (b2) 문단/칸 안의 "라벨: ____" ----------
    for (const u of model.units) {
      if (!u.text || u.text.length > 200) continue;
      if (docx) {
        const cellClaimed = u.cell && isClaimed(u.cell.ti, u.cell.r, u.cell.c);
        if (cellClaimed) continue;
        const blanks = inlineBlanks(u.text, { allowTrailing: true });
        blanks.forEach((b, i) => {
          if (b.kind === 'trailing' && u.cell && !(u.text.trim().length <= 24)) return;
          const t = u.cell ? model.tables[u.cell.ti] : null;
          if (b.hit.entry.t === 'photo') return;
          const src = scalarSourceOf(b.hit);
          if (!src) return;
          if (u.cell) claim(u.cell.ti, u.cell.r, u.cell.c);
          pushField({
            id: `i:p${u.pi}:${i}`, kind: 'scalar', how: 'inline', loc: u.cell ? `${locOf(model, t, u.cell.r, u.cell.c)} "${oneLine(b.label)}:"` : `문단 ${u.pi + 1} "${oneLine(b.label)}:"`, label: oneLine(b.label), source: src,
            confidence: b.kind === 'underscore' ? 0.85 : 0.8, target: { k: 'para', pi: u.pi, range: [b.start, b.end] },
          });
        });
      } else {
        if (isClaimed(u.ti, u.r, u.c)) continue;
        const t = model.tables.find((x) => x.ti === u.ti);
        const blanks = inlineBlanks(u.text, { allowTrailing: false });
        blanks.forEach((b, i) => {
          const src = scalarSourceOf(b.hit);
          if (!src || b.hit.entry.t === 'photo') return;
          claim(u.ti, u.r, u.c);
          pushField({ id: `i:${u.ti}:${u.r}:${u.c}:${i}`, kind: 'scalar', how: 'inline', loc: `${locOf(model, t, u.r, u.c)} "${oneLine(b.label)}:"`, label: oneLine(b.label), source: src, confidence: 0.85, target: { k: 'cell', ti: u.ti, r: u.r, c: u.c, range: [b.start, b.end] } });
        });
      }
    }

    // 같은 입력 칸이 둘 이상의 필드에 잡히지 않았는지(방어) — 첫 번째만 유지
    const seen = new Set();
    const dedup = [];
    for (const f of fields) {
      const tg = f.target;
      const key = tg.k === 'para' ? `p${tg.pi}:${(tg.range || []).join('-')}` : `c${tg.ti}:${tg.r}:${tg.c}:${(tg.range || []).join('-')}`;
      if (seen.has(key)) continue;
      seen.add(key);
      dedup.push(f);
    }
    // 보기 좋게: 문서 위치 순(표 번호 → 행 → 열)
    return { fields: dedup, repeats, warnings, kind: model.kind };
  }

  function rowAboveText(t, r) {
    const out = [];
    for (let rr = Math.max(0, r - 1); rr <= r; rr++) for (const cell of t.rows[rr]) if (!cell.covered && cell.text && cell.text.length < 30) out.push(cell.text);
    return out.join(' ');
  }
  /** 행에서 라벨로 인식되는 칸의 비율(내용이 있는 마스터 칸 대비) */
  function labelRowRatio(t, r) {
    let nonEmpty = 0;
    let rec = 0;
    for (const cell of t.rows[r]) {
      if (cell.covered || cell.virtual || !cell.text.trim()) continue;
      nonEmpty++;
      const h = lookupLabel(cell.text);
      if (h && h.entry.t !== 'seq') rec++;
    }
    return nonEmpty ? rec / nonEmpty : 0;
  }

  /** r행이 반복 표의 헤더 행인지 판단. 맞으면 { cat, cols:[{c,label,source,confidence}], confidence } */
  function detectHeaderRow(t, r) {
    const row = t.rows[r];
    const masters = row.filter((x) => !x.covered && !x.virtual && x.text.trim());
    if (masters.length < 2) return null;
    const rec = [];
    for (const cell of masters) {
      if (cell.text.length > 40) continue;
      const hit = lookupLabel(cell.text);
      if (hit && hit.entry.t !== 'photo' && ['cat', 'role', 'seq'].includes(hit.entry.t)) rec.push({ cell, hit });
      else if (hit && (hit.entry.t === 'basic' || hit.entry.t === 'summary')) rec.push({ cell, hit, other: true });
    }
    const listRec = rec.filter((x) => !x.other);
    if (listRec.length < 2) return null;
    if (listRec.length < masters.length * 0.5) return null;
    // 인접 라벨 쌍이 있어야 함(라벨-빈칸 반복인 입력 폼과 구분)
    const recSet = new Set(listRec.map((x) => x.cell.c));
    const adjacent = listRec.some((x) => { const nc = x.cell.c + x.cell.cs; return recSet.has(nc); });
    if (!adjacent) return null;
    // 카테고리 결정: 명시 항목 다수결 → 힌트
    const votes = {};
    for (const x of listRec) if (x.hit.entry.t === 'cat') votes[x.hit.entry.cat] = (votes[x.hit.entry.cat] || 0) + 1;
    let cat = null;
    const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
    if (sorted.length) cat = sorted[0][0];
    const hint = categoryHintFor(t, r);
    if (!cat) cat = hint;
    else if (hint && sorted.length > 1 && sorted[0][1] === sorted[1][1]) cat = hint;
    if (!cat) return null;
    // 기본정보 라벨이 섞인 행(이름/연락처 등만 있는 표)은 반복 표가 아님
    const cols = [];
    let confSum = 0;
    for (const x of listRec) {
      const e = x.hit.entry;
      let source = null;
      let conf = 0;
      if (e.t === 'seq') { source = 'seq'; conf = 0.85; } else if (e.t === 'cat') {
        if (e.cat === cat) { source = e.f; conf = 0.9 * x.hit.weight; } else { source = null; }
      } else if (e.t === 'role') {
        const f = ROLE_MAP[e.role][cat];
        if (f) { source = f; conf = (hint === cat || votes[cat] ? 0.78 : 0.6) * x.hit.weight; }
      }
      if (!source) continue;
      cols.push({ c: x.cell.c, label: oneLine(x.cell.text), source, confidence: Math.round(conf * 100) / 100 });
      confSum += conf;
    }
    const realCols = cols.filter((x) => x.source !== 'seq');
    if (realCols.length < 2) return null;
    // 같은 소스가 둘 이상이면 앞의 것만(예: 기간 두 번)
    const seenSrc = new Set();
    const uniq = cols.filter((x) => { if (x.source === 'seq') return true; if (seenSrc.has(x.source)) return false; seenSrc.add(x.source); return true; });
    return { cat, cols: uniq, confidence: Math.round((confSum / cols.length) * 100) / 100 };
  }

  // ------------------------------------------------------------------
  // 6) 데이터셋/값 계산
  // ------------------------------------------------------------------
  /** career: appState.career 모양 { education:[...], ... }, basic: career_basic_info 행(또는 null), profile: profiles 행(선택) */
  function buildDataset({ career = {}, basic = null, profile = null, todayIso, order = 'asc' } = {}) {
    const b = {};
    for (const [k] of BASIC_FIELDS) b[k] = basic && basic[k] ? String(basic[k]) : '';
    if (!b.birth_date && profile && profile.birth_date) b.birth_date = String(profile.birth_date);
    if (!b.gender && profile && profile.gender) b.gender = { male: '남', female: '여', other: '기타' }[profile.gender] || '';
    const lists = {};
    const latest = {};
    for (const cat of CAT_KEYS) {
      const rows = (career[cat] || []).filter((r) => !r.deleted_at);
      lists[cat] = CL.sortByDate(rows, CATS[cat].dateKey, order, CATS[cat].dateFallback);
      const desc = CL.sortByDate(rows, CATS[cat].dateKey, 'desc', CATS[cat].dateFallback);
      latest[cat] = desc[0] || null;
    }
    const photos = (career.photos || []).filter((r) => !r.deleted_at);
    const totalExp = CL.totalExperience(career.experiences || [], todayIso);
    return { basic: b, lists, latest, photos, todayIso, totalExp };
  }

  function fieldKind(cat, f) { const d = fieldDef(cat, f); return d ? d[2] : 'text'; }
  function sourceKind(key) {
    if (!key) return 'text';
    const p = key.split('.');
    if (p[0] === 'basic') return (BASIC_FIELDS.find((x) => x[0] === p[1]) || [])[2] || 'text';
    if (p[0] === 'summary') return (SUMMARY_FIELDS.find((x) => x[0] === p[1]) || [])[2] || 'text';
    if (CATS[p[0]]) return fieldKind(p[0], p[2]);
    return 'text';
  }

  function recordField(cat, rec, f, fmt, todayIso) {
    if (!rec) return '';
    const def = fieldDef(cat, f);
    const kind = def ? def[2] : 'text';
    if (kind === 'date') return CL.formatDate(rec[f], fmt);
    if (kind === 'period') { const [a, b] = CATS[cat].periodOf; return CL.periodText(rec[a], rec[b], fmt, CATS[cat].openLabel(rec)); }
    if (kind === 'duration') return rec.start_date ? CL.itemDuration(rec, todayIso) : '';
    const v = rec[f];
    return v === null || v === undefined ? '' : String(v);
  }

  /** 소스 키 → 문자열. 존재하지 않거나 manual/none이면 ''. */
  function resolveSource(ds, key, fmt = CL.DEFAULT_DATE_FORMAT) {
    if (!key || key === 'manual' || key === 'none' || key === 'photo') return '';
    const p = key.split('.');
    if (p[0] === 'basic') {
      const v = ds.basic[p[1]] || '';
      return sourceKind(key) === 'date' ? CL.formatDate(v, fmt) || v : v;
    }
    if (p[0] === 'summary') {
      if (p[1] === 'today') return CL.formatDate(ds.todayIso, fmt);
      if (p[1] === 'total_experience') return ds.totalExp.count ? ds.totalExp.text : '';
      if (p[1] === 'narrative') return CL.careerNarrative(ds.lists.experiences, { order: 'asc', fmt: 'YYYY.MM', todayIso: ds.todayIso });
      return '';
    }
    if (CATS[p[0]] && p.length === 3) {
      const rec = p[1] === 'latest' ? ds.latest[p[0]] : ds.lists[p[0]][parseInt(p[1], 10) - 1];
      return recordField(p[0], rec, p[2], fmt, ds.todayIso);
    }
    return '';
  }

  function repeatRowFor(ds, rep, rec, idx, fmt) {
    return { src: rec.id, cells: rep.cols.map((col) => (col.source === 'seq' ? String(idx + 1) : col.source === 'none' || col.source === 'manual' ? '' : recordField(rep.category, rec, col.source, fmt, ds.todayIso))) };
  }
  function repeatRows(ds, rep, fmt) {
    return (ds.lists[rep.category] || []).map((rec, i) => repeatRowFor(ds, rep, rec, i, fmt));
  }

  /** 분석 결과 + 데이터셋 → 사용자가 편집하는 값 { scalars:{id:string}, repeats:{id:[{src,cells}]}, photo:{id:recordId|null} } */
  function buildInitialValues(analysis, ds, options) {
    const fmt = options.dateFormat || CL.DEFAULT_DATE_FORMAT;
    const scalars = {};
    const photo = {};
    for (const f of analysis.fields) {
      if (f.kind === 'photo') { photo[f.id] = f.source === 'photo' && ds.photos.length ? (options.photoId || ds.photos[ds.photos.length - 1].id) : null; continue; }
      scalars[f.id] = resolveSource(ds, f.source, fmt);
    }
    const reps = {};
    for (const rep of analysis.repeats) reps[rep.id] = repeatRows(ds, rep, fmt);
    return { scalars, repeats: reps, photo };
  }

  /** 서식을 바꿨을 때(날짜 형식/정렬 등) 사용자가 손대지 않은 값만 새로 계산. old/new options 비교. */
  function reapplyOptions(analysis, ds, prevOptions, nextOptions, values) {
    const out = { scalars: { ...values.scalars }, repeats: { ...values.repeats }, photo: { ...values.photo } };
    const pf = prevOptions.dateFormat;
    const nf = nextOptions.dateFormat;
    for (const f of analysis.fields) {
      if (f.kind === 'photo') continue;
      if (resolveSource(ds, f.source, pf) === values.scalars[f.id]) out.scalars[f.id] = resolveSource(ds, f.source, nf);
    }
    return out;
  }

  // ------------------------------------------------------------------
  // 7) 매칭되지 않은 항목
  // ------------------------------------------------------------------
  /** 양식에 들어가지 못한 등록 데이터 목록. [{ group, label, items:[{id,text,cat?}] }] */
  function unmatchedItems(analysis, ds, values) {
    const out = [];
    const usedSrc = new Set(analysis.fields.filter((f) => f.kind !== 'photo').map((f) => f.source));
    for (const [k, label] of BASIC_FIELDS) {
      const val = ds.basic[k];
      if (!val) continue;
      if (!usedSrc.has(`basic.${k}`)) out.push({ group: 'basic', label: '기본정보', items: [{ id: `basic.${k}`, text: `${label}: ${sourceKind(`basic.${k}`) === 'date' ? CL.formatDate(val) || val : val}` }] });
    }
    if (ds.totalExp.count && !usedSrc.has('summary.total_experience')) out.push({ group: 'summary', label: '요약', items: [{ id: 'summary.total_experience', text: `총 경력: ${ds.totalExp.text}` }] });
    for (const cat of CAT_KEYS) {
      const recs = ds.lists[cat];
      if (!recs.length) continue;
      const reps = analysis.repeats.filter((r) => r.category === cat);
      const placed = new Set();
      for (const rep of reps) for (const row of (values.repeats[rep.id] || [])) if (row.src) placed.add(row.src);
      for (const f of analysis.fields) {
        if (f.kind === 'photo') continue;
        const p = String(f.source).split('.');
        if (p[0] === cat) { const rec = p[1] === 'latest' ? ds.latest[cat] : recs[parseInt(p[1], 10) - 1]; if (rec) placed.add(rec.id); }
      }
      const missing = recs.filter((r) => !placed.has(r.id));
      if (missing.length) {
        out.push({ group: cat, label: CATS[cat].label, hasRepeat: reps.length > 0, items: missing.map((r) => ({ id: r.id, text: summarizeRecord(cat, r) })) });
      }
    }
    if (ds.photos.length && !analysis.fields.some((f) => f.kind === 'photo')) out.push({ group: 'photos', label: '증명사진', items: [{ id: 'photos', text: `증명사진 ${ds.photos.length}장 — 양식에서 사진 자리를 찾지 못했습니다` }] });
    return out;
  }
  function summarizeRecord(cat, r, fmt = 'YYYY.MM.DD') {
    const c = CATS[cat];
    const title = r[c.titleField] || '(이름 없음)';
    let extra = '';
    if (c.periodOf) extra = CL.periodText(r[c.periodOf[0]], r[c.periodOf[1]], fmt, c.openLabel(r));
    else if (r[c.dateKey]) extra = CL.formatDate(r[c.dateKey], fmt);
    return extra ? `${title} (${extra})` : title;
  }

  // ------------------------------------------------------------------
  // 8) 소스 선택지(UI 드롭다운용)
  // ------------------------------------------------------------------
  function sourceLabel(key, ds) {
    if (key === 'manual') return '직접 입력';
    if (key === 'none') return '비움';
    if (key === 'photo') return '증명사진';
    if (key === 'seq') return '번호(자동)';
    const p = key.split('.');
    if (p[0] === 'basic') return (BASIC_FIELDS.find((x) => x[0] === p[1]) || [null, p[1]])[1];
    if (p[0] === 'summary') return (SUMMARY_FIELDS.find((x) => x[0] === p[1]) || [null, p[1]])[1];
    if (CATS[p[0]]) {
      const def = fieldDef(p[0], p[2]);
      const lab = def ? def[1] : p[2];
      if (p[1] === 'latest') return `${CATS[p[0]].label} · 가장 최근 · ${lab}`;
      const rec = ds && ds.lists[p[0]][parseInt(p[1], 10) - 1];
      return `${CATS[p[0]].label} #${p[1]}${rec ? `(${String(rec[CATS[p[0]].titleField] || '').slice(0, 12)})` : ''} · ${lab}`;
    }
    return key;
  }
  /** [{ group, options:[{value,label}] }] — 개별 필드용 */
  function scalarSourceOptions(ds) {
    const groups = [
      { group: '기본정보', options: BASIC_FIELDS.map(([k, l]) => ({ value: `basic.${k}`, label: l })) },
      { group: '요약', options: SUMMARY_FIELDS.map(([k, l]) => ({ value: `summary.${k}`, label: l })) },
    ];
    for (const cat of CAT_KEYS) {
      const recs = ds.lists[cat];
      if (!recs.length) continue;
      const opts = [];
      for (const [f, l, , skipScalar] of CATS[cat].fields) { if (skipScalar) { /* note도 허용 */ } opts.push({ value: `${cat}.latest.${f}`, label: `가장 최근 · ${l}` }); }
      recs.slice(0, 12).forEach((r, i) => { for (const [f, l] of CATS[cat].fields) opts.push({ value: `${cat}.${i + 1}.${f}`, label: `#${i + 1} ${String(r[CATS[cat].titleField] || '').slice(0, 14)} · ${l}` }); });
      groups.push({ group: CATS[cat].label, options: opts });
    }
    groups.push({ group: '기타', options: [{ value: 'manual', label: '직접 입력' }, { value: 'none', label: '비움' }] });
    return groups;
  }
  function repeatSourceOptions(cat) {
    return [{ value: 'seq', label: '번호(자동)' }, ...CATS[cat].fields.map(([f, l]) => ({ value: f, label: l })), { value: 'none', label: '비움' }];
  }

  const api = {
    CATS, CAT_KEYS, BASIC_FIELDS, SUMMARY_FIELDS, normKey, lookupLabel, labelVariants, findTokens, resolveToken, inlineBlanks, scalarSourceOf,
    buildDocxModel, buildXlsxModel, paraText, analyze, detectHeaderRow, buildDataset, resolveSource, recordField, sourceKind, repeatRows, repeatRowFor, buildInitialValues,
    reapplyOptions, unmatchedItems, summarizeRecord, sourceLabel, scalarSourceOptions, repeatSourceOptions, isBlankText, colLetter, locOf, confLevel, fieldDef,
  };
  globalThis.FormTemplate = api;
  if (typeof window !== 'undefined') window.FormTemplate = api;
})();
