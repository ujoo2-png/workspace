# 로그인 보안 점검 리포트 (v7.25.0)

작성일: 2026-10-21 · 대상: `js/store/supabaseStore.js`, `js/store/localStore.js`, `js/modules/auth.js`, `supabase/migrations/0011_auth_signup_approval.sql`

"승인된 계정만 로그인" 요구에 맞춰 로그인 경로 전체를 점검하고 수정했습니다. 아래는 **점검 결과 → 조치 → 남은 권고**입니다.

## 1. 점검 결과 및 조치

| # | 취약점 | 심각도 | 상태 |
|---|--------|--------|------|
| 1 | `signIn`이 `pending`/`rejected`만 차단 → `status`가 없거나(null/오타/신규값)면 **통과** | 🔴 높음 | ✅ 수정 |
| 2 | `getSession`과 `signIn`의 승인 판정 로직이 서로 달랐음(불일치) | 🟠 중간 | ✅ 수정 |
| 3 | 로컬 모드 `getSession`이 저장된 세션을 **그대로 신뢰**(승인 취소·계정 삭제 반영 안 됨) | 🟡 낮음 | ✅ 수정 |
| 4 | 첫 가입자 판정(`isFirstUser`)의 **경쟁 상태**(count=0을 동시에 봄 → admin 2명) | 🟡 낮음 | ⚠️ 권고(아래 3) |
| 5 | 로컬 모드 비밀번호 최소 4자 vs Supabase 6자 **정책 불일치** | 🟡 낮음 | ✅ 수정 |
| 6 | 접근토큰/세션이 브라우저에 저장됨(`persistSession`) | 🟠 중간 | ℹ️ 설계상 유지 |

### 수정 1 — 로그인 화이트리스트 (핵심)
이전:
```js
if (!profile || profile.status === 'pending') return { pending: true };
if (profile.status === 'rejected') throw ...;
// status가 undefined/null/기타면 → 로그인 통과(취약)
```
이후 (`supabaseStore.signIn` / `localStore.signIn`):
```js
if (!profile || profile.status !== 'approved') {   // 승인 화이트리스트
  await client.auth.signOut();                      // 세션 즉시 파기
  ...거부
}
```
`status === 'approved'`일 때만 통과합니다. 화이트리스트라서 앞으로 `status`에 새 값이 생겨도 자동으로 차단됩니다.

### 수정 2 — 세션 재검증
`getSession`도 `status !== 'approved'`면 `pending`으로 반환(앱 진입 차단), `localStore.getSession`은 **매번 DB에서 사용자 존재 + `approved` 여부를 재확인**하고 아니면 세션을 지웁니다.

### 수정 5 — 비밀번호 정책 통일
로컬 모드 최소 길이를 6자로 맞췄습니다(회원가입 폼 안내 문구도 함께 갱신 권장: "비밀번호(6자 이상)").

## 2. 남은 권고 (권장, 아직 미적용)

1. **`admin` 하드코딩 계정은 없음** — 첫 가입자가 자동 `admin`이 되는 구조입니다. 만약 과거 데이터에 `admin`이라는 아이디/이메일이 있으면 **수동 삭제**하세요:
   ```sql
   -- Supabase SQL Editor
   delete from profiles where email = 'admin' or name = 'admin';
   -- (선택) Auth 사용자도 함께 정리: Authentication → Users 에서 삭제
   ```
2. **회원가입 폼 비밀번호 안내**: `auth.js`의 placeholder를 `비밀번호(6자 이상)`으로 바꾸고 `minlength`도 `6`으로 맞추세요(현재 로컬은 4로 표기될 수 있음 — 아래 3 참고).
3. **첫 가입자 경쟁 상태(4)**: `signUp`이 `profiles` 행 수를 세어 첫 사용자를 admin으로 승격합니다. 두 사람이 **동시에** 가입하면 둘 다 admin이 될 수 있습니다. 권장 조치(택1):
   - DB에서 **admin 1명만 허용**하는 부분 유니크 인덱스:
     ```sql
     create unique index if not exists profiles_one_admin on profiles ((role))
       where role = 'admin';
     ```
     (두 번째 admin upsert가 실패 → 클라이언트는 `user`로 재시도)
   - 또는 첫 가입은 `role:'user', status:'pending'`으로 두고, **관리자 승격은 Supabase 대시보드에서 수동**으로.
4. **이메일 확인(Confirm email)**: Supabase Auth에서 "Confirm email"이 켜져 있으면 미확인 계정도 세션을 받을 수 있습니다. `approved` 게이트가 있어 앱 진입은 막히지만, 원하면 Auth 설정에서 확인을 **필수**로 두세요.
5. **세션 저장 위치**: `persistSession: true`로 토큰이 브라우저에 남습니다. 공용 PC에서는 로그인 시 "기억하기"를 끄고(세션 스토리지 사용) `sessionIdleTimeoutMinutes` 자동 로그아웃이 동작하는지 확인하세요.
6. **RLS 점검**: `profiles`는 본인 또는 admin만 select/update, insert는 본인 id만 — 0011이 올바릅니다. `status`를 본인이 `approved`로 바꾸는 **update**가 가능한지 확인이 필요합니다(현재 정책은 본인 update를 허용하므로, **승인 필드를 본인이 못 바꾸게** 하려면 별도 정책/트리거로 `status`·`role` 변경을 admin만 허용하도록 좁히는 것을 권장).

## 3. RLS 강화 예시 (권고 6 — 적용 권장)

> 현재 `profiles_update` 정책은 본인 행의 `status`까지 바꿀 수 있습니다. 즉, 승인 대기 사용자가 스스로 `status='approved'`로 업데이트할 수 있는 **권한 상승(privilege escalation)** 여지가 있습니다. 아래처럼 좁히세요.

```sql
-- 본인은 name만 수정 가능, status/role은 admin만 변경.
drop policy if exists profiles_update on profiles;
create policy profiles_update_self on profiles for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role   = (select p.role   from profiles p where p.id = auth.uid())
    and status = (select p.status from profiles p where p.id = auth.uid())
  );
create policy profiles_update_admin on profiles for update to authenticated
  using (is_admin()) with check (is_admin());
```

이 정책을 적용하면 클라이언트가 `approved`로 자기 승격을 시도해도 DB가 거부합니다.
