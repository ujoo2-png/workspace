// 문화생활(TMDB) 연동 — 설정 화면에서 입력한 API 키로 이번 주 인기 영화를 가져온다.
// 키는 서버 없이 브라우저에만 저장하며(로컬/Supabase 모드 공통), 대시보드 상단 상태 배지가
// 참조할 수 있도록 연결 상태도 함께 저장한다.
// 일반 <script>로 로드되며 다른 화면(js/modules/*)보다 먼저 로드되어야 한다.
(function () {
  const KEY_STORAGE = 'workspace:tmdbApiKey';
  const STATUS_STORAGE = 'workspace:tmdbStatus'; // 'connected' | 'error' | 'unset'

  function getTmdbApiKey() {
    return window.settingsSync.get(KEY_STORAGE) || '';
  }
  function setTmdbApiKey(key) {
    window.settingsSync.set(KEY_STORAGE, key || '');
  }
  function getTmdbStatus() {
    if (!getTmdbApiKey()) return 'unset';
    return localStorage.getItem(STATUS_STORAGE) || 'unset';
  }
  function setTmdbStatus(status) {
    localStorage.setItem(STATUS_STORAGE, status);
  }

  // 키가 유효한지 가볍게 확인한다(설정 화면 "연결 테스트" 버튼).
  async function testTmdbConnection(key) {
    try {
      const res = await fetch(`https://api.themoviedb.org/3/authentication?api_key=${encodeURIComponent(key)}`);
      const ok = res.ok;
      setTmdbStatus(ok ? 'connected' : 'error');
      return ok;
    } catch {
      setTmdbStatus('error');
      return false;
    }
  }

  // 이번 주 인기(트렌딩) 영화. 실패하면 상태를 'error'로 갱신하고 빈 배열을 반환한다
  // (문화생활 화면이 이 값을 보고 "연동 실패" 안내를 보여준다).
  async function fetchTrendingMovies() {
    const key = getTmdbApiKey();
    if (!key) return [];
    try {
      const res = await fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${encodeURIComponent(key)}&language=ko-KR`);
      if (!res.ok) throw new Error('요청 실패');
      const data = await res.json();
      setTmdbStatus('connected');
      return (data.results || []).slice(0, 12).map((m) => ({
        id: m.id,
        title: m.title,
        overview: m.overview,
        release_date: m.release_date,
        rating: m.vote_average,
        poster_url: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
      }));
    } catch {
      setTmdbStatus('error');
      return [];
    }
  }

  window.getTmdbApiKey = getTmdbApiKey;
  window.setTmdbApiKey = setTmdbApiKey;
  window.getTmdbStatus = getTmdbStatus;
  window.testTmdbConnection = testTmdbConnection;
  window.fetchTrendingMovies = fetchTrendingMovies;
})();
