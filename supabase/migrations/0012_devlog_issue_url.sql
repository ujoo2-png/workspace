-- Devlog: GitHub 이슈/PR 링크(가벼운 연동). 실제 GitHub API/OAuth 동기화는 하지 않고,
-- 이슈/PR URL만 저장해두면 화면에서 "owner/repo#번호" 배지로 파싱해 보여주고 바로 이동할 수 있게 한다.
alter table devlogs add column if not exists issue_url text;
