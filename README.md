# 나만의 Work Space (v6.0.0)

HTML + CSS + Vanilla JavaScript로 만든 개인용 통합 대시보드입니다.
네오모피즘(Neumorphism) 디자인, 예측(Predictive) 로직, 자동 워크플로우(규칙 엔진), 로그인 시 브리핑 알림을 갖췄고,
개발계획서 v3.2의 전체 메뉴(일정·프로젝트·프로그램·챌린저·관심주제 브리핑·문화생활·차량관리·Health·Devlog·
Knowledge·Automation·Integrations·Analytics)를 구현했습니다. 앱 버전은 `js/config.js`의 `CONFIG.version`
한 곳에서 관리되며 로그인 화면·사이드바·설정 화면에 동일하게 표시됩니다.

v5에서 추가/보강된 내용:
- **Devlog 메뉴 신설** — 개발계획서 3장에는 있었지만 이전 라운드에서 누락됐던 메뉴. 프로젝트와 연결하고 태그로 분류합니다.
- **태그 시스템** — Schedule/Project/Devlog/Knowledge에 태그(text[])를 추가하고 필터·검색을 붙였습니다. 개발계획서
  원안은 별도 N:M 중간 테이블(schedule_tags 등)을 제안했지만, 이 앱이 처음부터 써온 단순화 패턴(playlist_items.content_type을
  FK 대신 text로 둔 것과 동일)에 맞춰 text[] 컬럼으로 구현했습니다.
- **날씨 다중 지역** — 기본 3개(서울·부산·제주), 최대 5개까지 설정 화면에서 등록/삭제 가능. 프로필 테이블 대신
  `localStorage`(테마 설정과 동일한 패턴)에 저장합니다.
- **로그인 보안 강화** — 개인정보(Health/차량/일정 등)를 다루므로 조작 없이 일정 시간(기본 30분)이 지나면
  자동 로그아웃되는 세션 가드를 추가했습니다(`js/services/sessionGuard.js`).
- **데이터 내보내기 확장** — 전체 JSON 백업에 모든 모듈을 포함시켰고, 항목별 CSV 내보내기를 추가했습니다.
  Health처럼 민감할 수 있는 데이터는 내보내기 전 한 번 더 확인합니다.
- **Projects 우선순위 필드 + Devlog 연동 버튼**, **Schedule 반복 등록(매일/매주/매월)**, **Analytics 태그 분포 차트**,
  **Briefing "스크랩 → Knowledge" 버튼**과 **소스 상태(정상/불안정/오류/미실행) 표시**를 추가했습니다.

(메일 계정별 수집은 실제 OAuth/Edge Function 연동이 필요해 별도 라운드로 보류했고, Integrations 화면에
연동 예정 상태만 표시해두었습니다.)

v5.1.0에서 추가된 내용:
- **홈 화면 카드 바로가기** — KPI 카드, 이번 주 활동 요약, 일정 밀집도, 마감 임박 프로젝트, 알림을 클릭하면
  관련 메뉴로 바로 이동합니다.
- **날씨 지역 우선순위 변경** — 설정 화면에서 등록된 지역의 순서를 ↑/↓ 버튼으로 바꿀 수 있고, 맨 위 지역이
  홈 화면·로그인 브리핑의 대표 지역으로 쓰입니다.
- **사이드바 숨김 + "나만의 Work Space" 클릭 시 홈 이동** — 어느 메뉴에 있든 좌측 상단 브랜드를 클릭하면
  홈으로 이동하고, 사이드바 접기(«) 버튼으로 좌측 메뉴를 숨겼다 펼 수 있습니다(설정은 브라우저에 저장).

v5.2.0에서 추가된 내용 — **QMS 스타일 로그인(아이디/비밀번호 + 회원가입 + 관리자 승인)**:
- 기존 "이메일만 입력하면 로그인"/매직 링크 방식을 걷어내고, **아이디(로컬 모드) 또는 이메일(Supabase 모드) +
  비밀번호**로 로그인하는 화면으로 교체했습니다(`js/modules/auth.js`, `css/modules/auth.css`).
- **회원가입 + 관리자 승인 흐름**: 처음 가입하는 사람은 앱을 승인해 줄 관리자가 없으므로 **자동으로 관리자(admin)
  권한을 받고 즉시 로그인**할 수 있습니다. 이후 가입하는 사람은 `상태:대기중(pending)`으로 등록되며, 관리자가
  설정 화면의 **"사용자 관리"** 카드에서 승인/거절해야 로그인할 수 있습니다.
- 로컬 모드: 비밀번호는 브라우저 안에서 SHA-256 + 사용자별 salt로 해시해 저장합니다(데모 수준 보안이며,
  실제 서비스 보안이 필요하면 Supabase 모드로 전환해 Supabase Auth의 서버측 해싱을 쓰세요).
- Supabase 모드: Supabase Auth(이메일/비밀번호)를 그대로 쓰고, `profiles` 테이블에 `role`/`status` 컬럼을
  추가해 그 위에 승인 게이트를 얹었습니다(`supabase/migrations/0011_auth_signup_approval.sql`).
- 설정 → "사용자 관리" 카드(관리자에게만 표시)에서 승인 대기 목록 승인/거절, 전체 사용자 목록 확인, 이미
  승인된 사용자의 승인 취소(재거절)를 할 수 있습니다.

v5.3.0에서 추가된 내용 — **대기 중이던 기능 백로그 정리**:
- **비밀번호 변경/재설정**: 설정 화면에 "비밀번호 변경"(현재 비밀번호 확인 후 변경, 로컬/Supabase 공통)을
  추가했습니다. 로그인 화면에는 "비밀번호를 잊으셨나요?" 링크를 추가해, Supabase 모드에서는 재설정 이메일을
  보내고, 로컬 모드에서는 관리자에게 문의하도록 안내합니다. 관리자는 설정의 "사용자 관리"에서 로컬 계정의
  비밀번호를 직접 새로 지정해 줄 수 있습니다(Supabase 모드는 service_role 키가 필요한 관리자 API라 클라이언트
  에서는 지원하지 않으며, 본인이 재설정 이메일을 받아야 합니다).
- **Devlog ↔ GitHub 이슈 링크**: 개발 기록에 GitHub 이슈/PR URL을 적어두면 "owner/repo#번호" 배지로 표시되고
  클릭하면 바로 이동합니다. 실제 이슈 상태 자동 동기화(OAuth/Webhook)는 아직 포함하지 않았습니다.
- **PlayList 포스터 이미지 + 지도 링크**: 포스터 이미지 URL을 등록하면 카드 상단에 썸네일로 표시되고, 장소를
  적으면 "지도에서 보기" 링크(Google 지도 검색)가 함께 뜹니다. 문화생활 항목도 설정 화면에서 CSV로 내보낼
  수 있습니다. 실제 파일 업로드(Supabase Storage)는 아직 포함하지 않았습니다.

v6.0.0 — **UI/UX 전면 개편 + 일정/프로젝트/챌린저 대폭 강화**:
- **모던 플랫 디자인으로 전환**: 뉴모피즘 대신 흰색 카드 + 옅은 회색 배경 + 얇은 보더 + 미세한
  그림자를 쓰는 일반적인 SaaS 스타일로 `css/base.css`를 전면 개편했습니다(클래스 이름은 그대로 유지해
  다른 화면 코드는 건드리지 않았습니다). 배지/버튼/뱃지/토스트/사이드바 등 전 화면에 일관 적용됩니다.
- **일정 화면을 테이블 UI로 개편** — No, 🚩플래그(중요 표시), 우선순위(점 색상), D-day 자동 계산,
  컬럼 클릭 정렬(제목/날짜/우선순위/D-day), 검색 + 퀵탭(전체/오늘/이번 주/기한 초과/완료) 필터,
  "완료 일정 숨기기" 토글을 추가했습니다. 플래그된 일정은 정렬 결과에서도 항상 위로 올라옵니다.
- **프로젝트 화면에 간트차트 추가** — 좌측 프로젝트 목록 + 우측 상세(2단 레이아웃)로 바뀌었고,
  프로젝트를 "단계"로 쪼개 각 단계에 시작일/목표(target)일을 등록하면 우측에 간트 바로 표시됩니다.
  단계 진행률(완료 단계 수/전체)도 함께 보여줍니다.
- **챌린저에 오늘 기록 + 무드 이모지 + 네온 글로우** — 체크인할 때 오늘 무엇을 했는지 메모를 남길 수
  있고, 연속 달성일수에 따라 이모지가 변합니다(🙂→😄→🤩), 연속 미달성이면 😐→😠→😡로 바뀝니다.
  카드 테두리에는 보라색 계열의 회전하는 네온사인 느낌의 발광 테두리 효과를 추가했습니다.

v5.3.1 버그 수정:
- **"Cannot read properties of undefined (reading 'find')" 로그인 오류 수정** — v5.1.0 이전(로그인 기능 추가 전)
  버전을 써서 브라우저에 이미 데이터가 저장돼 있던 경우, 옛 데이터에는 `users` 목록이 없어서 회원가입/로그인
  시 이 오류가 났습니다. 이제 `js/store/localStore.js`가 옛 데이터를 불러올 때 누락된 필드를 자동으로
  채워 넣도록 고쳤습니다(기존 일정/프로젝트 등 데이터는 그대로 보존됩니다). 이미 오류를 겪었다면 이 버전으로
  교체 후 새로고침하면 정상적으로 회원가입/로그인할 수 있습니다.

### 아직 반영하지 못한 부분 (다음 라운드 후보)
- 태그의 완전한 N:M 정규화(중간 테이블) — 현재는 text[] 단순화(의도된 설계 방향이라 우선순위 낮음)
- 관심주제 브리핑의 Claude API 기반 요약·점수화·마감일 추출, 주제×소스 연결 매트릭스 UI — Claude API 키
  설정이 필요해 보류 중
- PlayList 파일 업로드(Supabase Storage 버킷) — 현재는 외부 이미지 URL만 지원
- 홈 대시보드의 단일 RPC/뷰 통합 조회(현재는 여러 쿼리를 병렬 실행)
- Devlog의 GitHub 이슈 상태 자동 동기화(OAuth/Webhook) — 현재는 링크만 저장
- MFA(2단계 인증) — 비밀번호 변경/재설정은 이번 라운드에 추가됨
- 메일 계정별 수집(Gmail/IMAP OAuth 연동) — Integrations 화면에 연동 예정 상태로만 표시

일반 `<script>` 태그 + `window.X` 전역 등록 방식으로 작성되어 있어(ES 모듈 아님), `index.html`을
그냥 더블클릭해서 `file://`로 열어도, 웹서버로 열어도 동일하게 동작합니다.

## 1. 바로 실행해보기 (설정 없이, 로컬 모드)

`index.html`을 더블클릭하거나, 아래처럼 간단한 서버로 열어도 됩니다.

```bash
cd workspace-app
python3 -m http.server 8080
# 브라우저에서 http://localhost:8080 접속
```

- 로그인 화면에서 "회원가입" 탭으로 아이디/비밀번호를 등록하세요. **가장 처음 가입하는 계정은 자동으로
  관리자(admin)가 되어 즉시 로그인**할 수 있습니다. 이후 새 계정은 관리자가 설정 화면의 "사용자 관리"에서
  승인해야 로그인할 수 있습니다.
- 로그인하는 순간 **로그인 브리핑**(오늘 일정, 마감 임박 프로젝트, 자동 알림)이 뜹니다.
- 모든 데이터는 이 브라우저에만 저장됩니다(계정 간 서버 동기화 없음). 비밀번호는 평문이 아니라
  SHA-256 해시로 저장되지만, 어디까지나 브라우저 안 데모 수준 보안입니다.

## 2. Supabase로 전환하기

1. Supabase 프로젝트를 만들고 `supabase/migrations/*.sql`을 번호 순서대로 실행합니다(SQL Editor에 붙여넣거나 `supabase db push` 사용).
2. `js/config.js`를 열어 다음과 같이 바꿉니다.

```js
window.CONFIG = {
  mode: 'supabase',                  // 'local' → 'supabase'
  supabaseUrl: 'https://xxxx.supabase.co',
  supabaseAnonKey: 'eyJ...',         // anon/publishable key만 사용
  // ...
};
```

3. `supabase/migrations/0006_cron.sql`은 Supabase 대시보드에서 `pg_cron` 확장을 켠 뒤 실행하세요.
4. GitHub에 올리고 Vercel에 연결하면 `main` push마다 자동 배포됩니다. `service_role` 키나 DB 비밀번호는 절대 `config.js`나 커밋에 넣지 마세요.

## 3. 폴더 구조

```
workspace-app/
├─ index.html            # 스크립트 로드 순서(의존성 순)를 그대로 유지해야 함
├─ css/                  # 네오모피즘 디자인 시스템 + 로그인 화면(QMS 스타일) 전용 css/modules/auth.css
├─ js/
│  ├─ config.js          # local ↔ supabase 전환 스위치 (window.CONFIG)
│  ├─ store/             # 데이터 어댑터 (local / supabase 동일 인터페이스)
│  ├─ predict.js         # 예측 로직 (프로젝트 완료일, 일정 밀집도)
│  ├─ rules.js           # 자동 워크플로우 규칙 엔진
│  ├─ services/          # automationService, briefingService(로그인 브리핑), feedService(RSS 수집)
│  ├─ router.js, app.js, state.js
│  └─ modules/           # home, schedule, projects, challenges, briefing, playlist, vehicles, health, programs, settings, auth
├─ supabase/migrations/  # 스키마, RLS, 트리거, pg_cron (0001~0008)
└─ tests/                # node --test 단위 테스트 (predict, rules, auth, migration)
```

각 `js/*.js` 파일은 ES 모듈이 아니라 일반 스크립트이며 파일 맨 아래에서
`window.함수이름 = 함수` 형태로 전역 등록합니다. 그래서 `index.html`에 나열된
`<script>` 순서(의존하는 파일이 먼저)를 반드시 지켜야 합니다.

## 4. 메뉴별 구현 위치

| 메뉴 | 구현 위치 | 비고 |
| --- | --- | --- |
| 일정관리 | `js/modules/schedule.js` | 테이블 UI(No·플래그·우선순위·D-day·정렬·퀵필터·완료 숨기기), 프로젝트와 FK 연동 |
| 프로젝트관리 | `js/modules/projects.js` | 목록+상세 2단 레이아웃, 진행률 기록 + 완료일 예측, 단계별 간트차트(`project_stages`) |
| 챌린저 | `js/modules/challenges.js` | 목표/체크인(오늘 한 일 기록), 연속 달성/미달성 무드 이모지, 네온 글로우 카드, unique(challenge_id, checkin_date) |
| 관심주제 브리핑 | `js/modules/briefing.js`, `js/services/feedService.js` | 주제/피드소스 CRUD + "지금 가져오기"(rss2json 경유 RSS 수집) |
| 문화생활(PlayList) | `js/modules/playlist.js` | 영화/음악/연극/음악회 등, 관람예정 → 일정 등록 연동 |
| 차량관리 | `js/modules/vehicles.js` | 차량 + 정비/주유 기록, 주행거리 추세/등록 예정일 기반 다음 정비일 예측, 보험·등록 만료 D-day, 연비, "예정일 → 일정에 추가" |
| Health | `js/modules/health.js` | 체중/운동/수면/걸음수/컨디션 등 웰니스 지표(진단·복약 등 의료정보는 다루지 않음) + 병원/검진 일정, 주간 운동 목표 달성률 예측, 체중 변화 추이, 운동 기록 → 챌린지 체크인 제안, 병원 일정 → 일정에 추가 |
| Devlog | `js/modules/devlog.js` | 개발/개선 기록, 프로젝트 연결, 태그·필터 (Projects 화면에서 관련 Devlog 바로 보기) |
| Knowledge | `js/modules/knowledge.js` | 링크/메모/문서 스크랩(제목·URL·태그·메모), 태그 필터·검색, 브리핑 항목 "스크랩" 연동 |
| Automation | `js/modules/automation.js` | 규칙별 on/off·파라미터 조정, 수동 실행("지금 실행"), 실행 이력 |
| Integrations | `js/modules/integrations.js` | 외부 서비스 연동 상태(현재는 상태 표시만, 실제 OAuth 연동은 보류) |
| Analytics | `js/modules/analytics.js` | 최근 7일 완료 일정, 프로젝트 상태 분포, 8주 챌린지 체크인 추이, 알림 심각도 분포 (인라인 SVG 차트) |
| 날씨 | `js/modules/home.js`의 날씨 카드, `js/services/briefingService.js` | Open-Meteo, 로그인 브리핑에도 표시 |
| 홈 "이번 주 활동 요약" | `js/modules/home.js`, `appState.getWeeklyActivitySummary()` | 완료 일정/운동 기록/챌린지 체크인/체중 변화를 한 카드에 통합 |
| 프로그램 나열/바로가기 | `js/modules/programs.js` | |
| 로그인/회원가입/승인 | `js/modules/auth.js`, `js/store/localStore.js`, `js/store/supabaseStore.js` | 아이디+비밀번호 로그인, 회원가입, 관리자 승인(설정 화면 "사용자 관리") |
| 로그인 시 알람 | `js/services/briefingService.js` + `js/components/briefingModal.js` | 로그인 직후 모달 |
| Auto Workflow / 예측 | `js/rules.js`, `js/predict.js` | 제안형 알림(8종 규칙), 프로젝트 완료일·일정 밀집도·차량 정비·Health 목표·챌린지 연속기록 예측 |

메일 계정별 수집은 실제 Gmail/IMAP OAuth 연동이 필요해 이번 라운드에는 포함하지 않았고, `Integrations` 화면에
연동 예정 상태로만 표시해두었습니다(고도화 단계에서 진행 예정).

## 5. 테스트

```bash
node --test "tests/*.test.mjs"
```

`predict.test.mjs`, `rules.test.mjs`가 예측 계산과 규칙 엔진 로직을, `auth.test.mjs`가 회원가입/로그인/관리자
승인/비밀번호 변경/관리자 비밀번호 재설정 흐름을, `migration.test.mjs`가 로그인 기능 추가 이전 버전의 옛
localStorage 데이터를 불러와도 깨지지 않는지를 검증합니다(총 38개, 전부 통과).
