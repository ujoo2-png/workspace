# 관심주제 브리핑 개선 제안 5가지 (마크다운 사례 기반)

작성: v7.21.0 · 대상: `js/modules/briefing.js`, `js/services/briefingService.js`, `js/services/feedService.js`

## 현재 동작 (코드 확인 결과)
- **관심주제**(최대 10개): 이름 + 포함/제외 키워드. **피드 소스**: RSS 주소 또는 "마크다운 붙여넣기"(링크 있는 줄만 추출).
- "지금 가져오기" → 소스별 항목을 가져와 키워드로 주제에 배정 → `briefing_items`(제목, 링크, 요약, 게시일, 읽음, `item_hash`로 중복 방지).
- 화면은 **주제 구분 없는 평평한 목록**이며 항목마다 읽음/Knowledge 스크랩/삭제만 가능. 내보내기·"오늘 한눈에" 같은 요약 형태는 없었음.

> 아래 URL은 모두 이번 작업에서 실제로 열어 내용을 확인한 페이지만 적었습니다. 예시 마크다운은 그 페이지에서 설명한 **구조**를 이 앱의 관심주제 형식으로 옮긴 **가상 예시**이며, 각 사이트의 실제 출력이 아닙니다(기사 제목/링크는 예시용).

---

## 제안 1. "하루 한 파일" 다이제스트 내보내기 (Matcha 방식) — ✅ v7.21.0에 구현
- **출처**: Matcha — "a daily digest generator for your RSS feeds and interested topics/keywords". 하루에 마크다운 파일 1개, 아직 안 본 글만, 하루 동안 새 글이 생기면 이어 붙임. https://pkg.go.dev/github.com/goutham371/matcha
- **예시(이 앱 형식)**
```markdown
---
date: 2026-10-07
items: 3
topics: [AI 에이전트, 정밀농업]
type: briefing
---

# 관심주제 브리핑 · 2026-10-07

## AI 에이전트 (2)

- [에이전트 프레임워크 v2 공개](https://example.com/agents-v2) — GeekNews · 2026-10-06
  - 도구 호출 재시도와 상태 저장이 기본 제공됨
  - #AI_에이전트
```
- **구현에 필요한 것**: 순수 함수 `briefingToMarkdown`(js/utils/briefingMd.js) + 브리핑 목록의 "📋 마크다운 복사 / ⬇ .md 저장" 버튼. **구현 완료**(테스트 포함). Obsidian 등에 그대로 붙여넣기 가능.
- **노력/위험**: 낮음 / 거의 없음(읽기 전용, 스키마 변경 없음). "왜 중요한가" 줄은 AI 요약이 필요해 제외.

## 제안 2. 주제별 "헤드라인 + 1~2문장 + 출처" + 「오늘 볼 것」 (morning-intelligence 프롬프트)
- **출처**: PM Claude Skills의 morning-intelligence — "Organise by topic. Under each topic: 2–4 bullet points. Each bullet: headline + 1–2 sentence summary + source name", 마지막에 "What to watch today"(2~3문장), 5/10/15분 읽기 예산, "NEVER INCLUDE" 제외 목록. https://claudeskills.info/skills/mohitagw15856/pm-claude-skills/morning-intelligence/
- **예시**
```markdown
## 정밀농업
- **KMA, 과수 개화기 예측 갱신** — 올해 매화 개화가 평년보다 4일 빠를 전망. 저온 피해 시기와 겹치는지 확인 필요. _(기상청)_ #정밀농업
- **토양수분 센서 가격 하락** — 저가형 LoRa 센서 단가가 작년 대비 하락. _(AgFunder)_ #정밀농업

### 오늘 볼 것
서리 예보가 있는 날(10/9)과 일정의 "과수원 방문"이 겹칩니다. 읽는 데 약 5분.
```
- **구현에 필요한 것**: ① 주제별 최대 N개(2~4) 제한 + "읽기 시간 예산" 설정(항목 수로 환산) — 순수 로직, 반나절. ② 1~2문장 요약은 RSS `description` 앞부분(현재 `summary`)으로 대체 가능, 진짜 요약은 LLM 호출 필요(키 보관/비용 문제). ③ "오늘 볼 것"은 앱 안의 일정/D-day/날씨와 결합(데이터는 이미 있음). 제외 키워드는 이미 지원.
- **노력/위험**: 중간(N·예산은 낮음, LLM 요약은 중간~높음: API 키를 브라우저에 두면 노출 위험 → Edge Function 필요).

## 제안 3. 200단어 「오늘의 3가지」 아침 브리핑 (경영진 브리핑 템플릿)
- **출처**: The AI Career Lab(Alex Lowe)의 "200-word daily digest" — ① Today's three things(3문장) ② What changed overnight(2문장) ③ One thing to watch this week(1문장) ④ Personal layer(생일/기념일 등 1문장), "90초 안에 하루 우선순위 파악". https://theaicareerlab.com/blog/how-to-brief-a-ceo-in-200-words/raw
- **예시**
```markdown
# 2026-10-07 (수) 아침 브리핑
**오늘의 3가지**: ① 14:00 팀 회의 ② 챌린지 '러닝' 연속 6일째 ③ 약 복용 20:00
**밤사이 변화**: 새 브리핑 12건(AI 에이전트 7, 정밀농업 5). 인천 오후 비 70%.
**이번 주 볼 것**: 10/10 프로젝트 마감(진행률 82%).
**개인**: D-12 여행.
```
- **구현에 필요한 것**: 홈/로그인 브리핑 모달(`briefingModal.js`)에 이미 일정·알림·날씨 데이터가 있으므로 같은 데이터를 4블록 마크다운으로 렌더링 + 복사 버튼. 새 데이터 수집 없음.
- **노력/위험**: 낮음~중간(템플릿 렌더링 + 테스트) / 낮음.

## 제안 4. 가치 점수(S/A/B/C/D)와 피드 통계로 "읽을 순서" 정하기 (RSSidian 방식)
- **출처**: RSSidian — 기사를 S/A/B/C/D 5등급과 1~100점으로 평가하고, 등급·관련도별로 묶은 마크다운 요약 노트를 만들며 템플릿 변수(`{date_range}`, `{summary_items}`, `{value_analysis}`, `{feed_stats}`)와 피드 통계를 포함. https://mcpservers.org/pt-BR/servers/pedramamini/RSSidian
- **예시**
```markdown
## 오늘의 S등급 (점수 ≥ 85)
- [메모리 계층형 에이전트 논문](https://example.com/p/1) — 점수 91 · 키워드 일치 3/3 · 최신(6시간)
## A등급
- …
### 피드 통계
GeekNews 8건 · 기상청 3건 · 중복 제거 5건
```
- **구현에 필요한 것**: LLM 없이도 가능한 **규칙 점수**(포함 키워드 일치 수 × 가중치 + 최신성 + 소스 신뢰 가중치 + 읽음 이력)를 `briefingService`에 순수 함수로 추가하고 정렬/등급 배지 표시. LLM 점수는 선택 사항.
- **노력/위험**: 중간(점수식 튜닝 필요, 잘못된 점수가 좋은 글을 묻을 수 있어 "점수 숨김" 토글 권장). LLM 방식은 비용·키 노출 위험이 있어 이 앱(정적 사이트)에는 부적합 — 서버 함수 필요.

## 제안 5. 노트 템플릿 + 주간/월간 롤업 (Vault Feed Reader · Signal RSS · RefDaily)
- **출처**: Vault Feed Reader — 템플릿 변수(`{{title}}`, `{{feed}}`, `{{link}}`, `{{date}}`)로 저장, "저장한 노트의 수동 편집은 다음 저장에서 보존", 즐겨찾기/나중에 읽기 목록, 선택적 AI 요약·태그 https://community.obsidian.md/plugins/vault-feed-reader · Signal RSS — 파일명/프런트매터 템플릿, 자동 새로고침, **자체 다이제스트 기능은 없음(스스로 명시)** https://community.obsidian.md/plugins/signal-rss · RefDaily — 일간 다이제스트 + 주간 리뷰/월간 요약 노트를 YAML 프런트매터가 있는 일반 마크다운으로, DOI→ID 순 중복 매칭 https://community.obsidian.md/plugins/refdaily
- **예시(주간 롤업)**
```markdown
---
week: 2026-W41
read: 23
saved: 5
---
# 주간 브리핑 리뷰
## 가장 많이 읽은 주제: AI 에이전트 (14)
## 스크랩한 글 (Knowledge)
- [제목](https://example.com/x) #AI_에이전트
```
- **구현에 필요한 것**: ① 사용자 편집 가능한 템플릿 문자열(`{{title}}` 등) 설정을 `settingsSync`로 동기화 → 내보내기 형식 커스터마이즈. ② 주간 롤업은 `briefing_items`의 `is_read/read_at`과 Knowledge 스크랩 건수만 집계(스키마 변경 없음). ③ 이미 있는 "📌 Knowledge 스크랩"에 프런트매터 태그 자동 부여.
- **노력/위험**: 중간 / 낮음(읽기 집계). 템플릿 변수 치환은 이스케이프(마크다운 인젝션) 주의.

---

### 추천 순서
1(완료) → 3(데이터가 이미 있어 가장 가성비) → 2의 "주제별 N개 + 오늘 볼 것" → 5의 주간 롤업 → 4의 규칙 점수.
LLM 요약이 필요한 부분(2·4·5의 AI 옵션)은 **API 키를 브라우저에 두지 않도록** Supabase Edge Function을 거치는 것이 안전합니다(현재 앱은 정적 사이트).
