// 이모지 입력/표시 순수 함수 + 프로그램 유형별 기본 아이콘 (v7.21.0).
// 왜 필요한가: 프로그램 폼의 아이콘 입력이 `maxlength="2"`였는데 maxlength는 UTF-16 코드 유닛 개수다.
// 대부분의 이모지는 2유닛이라 통과하지만 🖥️(3유닛, 변형 선택자 포함)·🏳️‍🌈·👨‍💻(ZWJ 연결, 5유닛+)은 중간에서 잘려
// "깨진 글자/빈 칸"이 저장되고, 목록은 그 값을 그대로 그려 아무것도 보이지 않았다.
// 이제는 글자 수가 아니라 "화면에 보이는 한 글자(grapheme)" 단위로 자르고, 이모지가 아닌 값은 거른다.
// 일반 <script>로 로드되며 Node 테스트에서도 그대로 평가할 수 있다(DOM 의존 없음).
(function () {
  const PROGRAM_TYPE_ICON = { web: '🌐', mobile: '📱', widget: '🧩', web_mobile: '🖥️📱' };

  function graphemes(str) {
    const s = String(str ?? '');
    if (!s) return [];
    if (typeof Intl !== 'undefined' && Intl.Segmenter) {
      return Array.from(new Intl.Segmenter('und', { granularity: 'grapheme' }).segment(s), (x) => x.segment);
    }
    return Array.from(s); // 구형 환경 폴백(코드포인트 단위)
  }

  // 이모지(또는 이모지 같은 기호)를 포함하는 한 글자인지. 일반 문자/숫자/공백은 제외한다(# * 0-9는 이모지 키캡 후보라 제외).
  function isEmojiGrapheme(g) {
    if (!g || /^[\s‍️]+$/.test(g)) return false;
    try {
      return /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(g);
    } catch {
      return /[←-⯿\u{1F000}-\u{1FAFF}]/u.test(g);
    }
  }

  /** 입력 문자열에서 이모지 글자만 앞에서부터 max개 남긴다. 빈 값이면 ''. */
  function normalizeEmoji(str, max = 2) {
    return graphemes(str).filter(isEmojiGrapheme).slice(0, max).join('');
  }

  /** 프로그램의 표시 아이콘: 저장된 이모지 → 없으면 유형별 기본값 → 없으면 🔗. */
  function programIcon(program) {
    const own = normalizeEmoji(program && program.icon, 4);
    if (own) return own;
    return PROGRAM_TYPE_ICON[program && program.program_type] || PROGRAM_TYPE_ICON.web;
  }

  // 이모지 선택 격자(카테고리별 약 70개)
  const EMOJI_GROUPS = [
    { label: '앱·도구', items: ['🌐', '📱', '🧩', '🖥️', '💻', '⚙️', '🛠️', '🔧', '🧪', '🤖', '📦', '🔌', '🧰', '🗂️', '🔍', '🛰️'] },
    { label: '업무', items: ['📅', '📝', '📊', '📈', '📁', '📌', '📎', '✅', '🔔', '💼', '📚', '🧠', '📧', '🗓️', '🧾', '🏢'] },
    { label: '생활', items: ['🏠', '🚗', '💪', '🏃', '🍎', '☕', '🎵', '🎬', '🎮', '📷', '✈️', '💰', '🛒', '🩺', '💊', '🎧'] },
    { label: '자연·날씨', items: ['🌱', '🌳', '🍑', '☀️', '🌧️', '❄️', '🔥', '💧', '⭐', '🌙', '⚡', '🌈', '🌾', '🐝', '🌡️', '🏞️'] },
    { label: '기호', items: ['❤️', '💡', '🎯', '🚀', '🏆', '🔒', '🔑', '🧭', '🎨', '📣', '🎁', '✨', '🔗', '⏱️', '🧮', '♻️'] },
  ];

  window.PROGRAM_TYPE_ICON = PROGRAM_TYPE_ICON;
  window.EMOJI_GROUPS = EMOJI_GROUPS;
  window.emojiGraphemes = graphemes;
  window.normalizeEmoji = normalizeEmoji;
  window.programIcon = programIcon;
})();
