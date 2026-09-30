// 이 파일 하나만 바꾸면 로컬 모드 ↔ Supabase 모드가 전환됩니다.
// mode: 'local'    → 브라우저 localStorage만 사용 (설정 없이 즉시 실행 가능)
// mode: 'supabase' → 실제 Supabase 프로젝트에 연결 (아래 두 값을 채워야 함)
//
// 일반 <script> 태그로 로드되므로(ES 모듈 아님) globalThis.CONFIG로 전역 등록한다.
// file:// 로 index.html을 그냥 더블클릭해서 열어도 동작하도록 하기 위한 구조.
// globalThis를 쓰면 브라우저(window)와 Node(단위 테스트) 양쪽에서 동일하게 동작한다.
globalThis.CONFIG = {
  mode: 'supabase',

  // 앱 버전. 로그인 화면·사이드바·설정 화면이 모두 이 값을 참조하므로,
  // 배포 패키지(zip) 버전을 바꿀 때는 여기 한 곳만 수정하면 된다.
  version: 'v7.0.0',

  // Supabase 프로젝트 설정 (mode: 'supabase'일 때만 사용)
  // anon/publishable key는 RLS로 보호되는 값이라 클라이언트에 두어도 안전합니다.
  // service_role key, DB 비밀번호, 외부 API 키는 절대 여기 넣지 마세요.
  supabaseUrl: 'https://fuimlgxgpflciiflvahr.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1aW1sZ3hncGZsY2lpZmx2YWhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTA3MjAyNjQsImV4cCI6MjEwNjI5NjI2NH0.xo-JYej8bEMmfvXdjSH-O2BsRa-RPp7154fDT3lGY8M',

  // 세션 만료(자동 로그아웃) 정책 — 개인정보(Health/차량/일정 등)를 다루므로
  // 일정 시간 조작이 없으면 자동 로그아웃한다. 0이면 비활성화.
  sessionIdleTimeoutMinutes: 30,

  // 날씨: 기본 3개 지역, 최대 5개까지 등록 가능. 사용자가 설정 화면에서 바꾸면
  // localStorage(workspace:weatherCities)에 저장되고 이 기본값은 최초 1회만 쓰인다.
  weather: {
    minCities: 1,
    defaultMaxCities: 3,
    maxCities: 5,
  },
  defaultCities: [
    { name: '서울', lat: 37.5665, lon: 126.978 },
    { name: '부산', lat: 35.1796, lon: 129.0756 },
    { name: '제주', lat: 33.4996, lon: 126.5312 },
  ],
  // 지역 추가 시 고를 수 있는 프리셋 목록(위경도 조회 API 없이도 바로 등록 가능하게).
  cityPresets: [
    { name: '서울', lat: 37.5665, lon: 126.978 },
    { name: '부산', lat: 35.1796, lon: 129.0756 },
    { name: '제주', lat: 33.4996, lon: 126.5312 },
    { name: '인천', lat: 37.4563, lon: 126.7052 },
    { name: '대전', lat: 36.3504, lon: 127.3845 },
    { name: '대구', lat: 35.8714, lon: 128.6014 },
    { name: '광주', lat: 35.1595, lon: 126.8526 },
    { name: '울산', lat: 35.5384, lon: 129.3114 },
    { name: '수원', lat: 37.2636, lon: 127.0286 },
    { name: '춘천', lat: 37.8813, lon: 127.7298 },
    { name: '도쿄', lat: 35.6762, lon: 139.6503 },
    { name: '뉴욕', lat: 40.7128, lon: -74.006 },
    { name: '런던', lat: 51.5074, lon: -0.1278 },
    { name: '파리', lat: 48.8566, lon: 2.3522 },
    { name: '싱가포르', lat: 1.3521, lon: 103.8198 },
  ],

  // 예측 로직 파라미터
  predict: {
    projectMinRecords: 2,       // 완료 예측을 계산하기 위한 최소 진행률 기록 수
    scheduleLookbackWeeks: 4,   // 요일별 평균 계산에 사용할 과거 주 수
  },

  // 자동화 규칙 파라미터
  automation: {
    deadlineWarningDays: 7,     // 프로젝트 마감 D-n 알림
    scheduleReminderDays: 3,    // 일정 마감 임박 알림
  },
};
