// 이모지 선택 컴포넌트(v7.21.0): [미리보기] [입력칸] [선택 ▾] [초기화].
//  · 입력칸에 직접 입력/붙여넣기(OS 이모지 키보드)도 가능 — 입력은 normalizeEmoji로 이모지만 남긴다(최대 2글자).
//  · "선택"을 누르면 카테고리 탭 + 격자(약 80개)가 열리고, 하나를 누르면 바로 반영된다.
//  · 비어 있으면 미리보기에 fallback(예: 프로그램 유형 기본 아이콘)을 흐리게 보여준다.
// 사용: const picker = createEmojiPicker({ value, name:'icon', getFallback: () => '🌐' }); picker.input(폼 값 읽기용 <input name>)
// 일반 <script>로 로드되며 js/utils/dom.js, js/utils/emoji.js가 먼저 로드되어야 한다.
(function () {
  const { el } = window;

  function createEmojiPicker({ value = '', name = 'icon', getFallback = () => '', max = 2, placeholder = '직접 입력' } = {}) {
    const input = el('input', { class: 'nm-input emoji-picker__input', name, value: window.normalizeEmoji(value, max), placeholder, autocomplete: 'off', 'aria-label': '아이콘(이모지)' });
    const preview = el('span', { class: 'emoji-picker__preview', 'aria-hidden': 'true' });
    const toggle = el('button', { type: 'button', class: 'nm-btn emoji-picker__toggle', 'aria-expanded': 'false' }, '😀 선택');
    const reset = el('button', { type: 'button', class: 'nm-btn emoji-picker__reset', title: '아이콘 비우기(기본 아이콘 사용)' }, '초기화');
    const panel = el('div', { class: 'emoji-picker__panel', hidden: true });
    const wrap = el('div', { class: 'emoji-picker' }, [
      el('div', { class: 'emoji-picker__row' }, [preview, input, toggle, reset]),
      panel,
    ]);

    function paintPreview() {
      const v = input.value;
      preview.textContent = v || getFallback() || '·';
      preview.classList.toggle('emoji-picker__preview--fallback', !v);
      preview.title = v ? '현재 아이콘' : '비워 두면 이 기본 아이콘이 표시됩니다';
    }
    function setValue(v, fire = true) {
      input.value = window.normalizeEmoji(v, max);
      paintPreview();
      if (fire) input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    input.addEventListener('input', () => {
      // 조합(IME) 중에는 건드리지 않는다. 확정되면 이모지만 남긴다.
      if (input.dataset.composing) return;
      const cleaned = window.normalizeEmoji(input.value, max);
      if (cleaned !== input.value) input.value = cleaned;
      paintPreview();
    });
    input.addEventListener('compositionstart', () => { input.dataset.composing = '1'; });
    input.addEventListener('compositionend', () => { delete input.dataset.composing; setValue(input.value, false); });
    reset.addEventListener('click', () => setValue('', true));

    let activeGroup = 0;
    function drawPanel() {
      panel.innerHTML = '';
      const tabs = el('div', { class: 'emoji-picker__tabs', role: 'tablist' }, window.EMOJI_GROUPS.map((g, i) =>
        el('button', { type: 'button', role: 'tab', class: `emoji-picker__tab ${i === activeGroup ? 'is-active' : ''}`, onclick: () => { activeGroup = i; drawPanel(); } }, g.label)));
      const grid = el('div', { class: 'emoji-picker__grid' }, window.EMOJI_GROUPS[activeGroup].items.map((e) =>
        el('button', { type: 'button', class: 'emoji-picker__cell', title: e, 'aria-label': e, onclick: () => { setValue(e); panel.hidden = true; toggle.setAttribute('aria-expanded', 'false'); } }, e)));
      panel.append(tabs, grid);
    }
    toggle.addEventListener('click', () => {
      panel.hidden = !panel.hidden;
      toggle.setAttribute('aria-expanded', String(!panel.hidden));
      if (!panel.hidden) drawPanel();
    });

    paintPreview();
    return { node: wrap, input, setValue, refresh: paintPreview };
  }

  window.createEmojiPicker = createEmojiPicker;
})();
