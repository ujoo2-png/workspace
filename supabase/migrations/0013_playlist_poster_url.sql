-- 문화생활(PlayList) 포스터 표시. 실제 파일 업로드(Storage 버킷 + playlist_attachments 테이블)
-- 대신, 이 라운드에서는 외부 이미지 URL을 하나 저장해 카드 상단에 썸네일로 보여주는 가벼운 버전으로
-- 구현했다. 파일 업로드가 필요해지면 개발계획서 DB 스키마 탭의 playlist_attachments 설계를 참고해
-- 별도 테이블 + Storage 버킷으로 확장할 수 있다.
alter table playlist_items add column if not exists poster_url text;
