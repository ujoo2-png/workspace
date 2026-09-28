// 프로그램(나만의 프로그램 나열/바로가기) 화면. 일반 <script>로 로드된다.
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal } = window;

  function renderPrograms(root) {
    const container = el('div', {});
    root.append(container);

    function draw() {
      container.innerHTML = '';
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '프로그램'),
          el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openForm() }, '+ 프로그램 등록'),
        ])
      );

      const rows = appState.programs.slice().sort((a, b) => (b.run_count || 0) - (a.run_count || 0));
      if (!rows.length) {
        container.append(el('div', { class: 'empty-state' }, '자주 쓰는 프로그램·웹서비스 링크를 등록해보세요.'));
        return;
      }

      const grid = el('div', { class: 'grid-3' });
      for (const p of rows) {
        grid.append(
          el('div', { class: 'nm-card', style: 'text-align:center' }, [
            el('div', { style: 'font-size:28px; margin-bottom:8px' }, p.icon || '🔗'),
            el('div', { style: 'font-weight:700; margin-bottom:2px' }, escapeHtml(p.name)),
            el('div', { class: 'text-muted', style: 'font-size:11px; margin-bottom:10px' }, `실행 ${p.run_count || 0}회`),
            el('div', { class: 'row', style: 'justify-content:center; gap:8px' }, [
              el('button', { class: 'nm-btn nm-btn--primary', onclick: () => appState.runProgram(p.id) }, '열기'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openForm(p) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => remove(p) }, '🗑'),
            ]),
          ])
        );
      }
      container.append(grid);
    }

    async function remove(p) {
      if (!confirmDialog(`"${p.name}"을(를) 목록에서 삭제할까요?`)) return;
      await appState.deleteProgram(p.id);
      toast('삭제했습니다.', 'success');
    }

    function openForm(existing) {
      openModal({
        title: existing ? '프로그램 수정' : '프로그램 등록',
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          form.append(
            field('이름', el('input', { class: 'nm-input', name: 'name', required: true, value: existing?.name || '' })),
            field('URL', el('input', { class: 'nm-input', type: 'url', name: 'url', required: true, placeholder: 'https://…', value: existing?.url || '' })),
            field('아이콘(이모지, 선택)', el('input', { class: 'nm-input', name: 'icon', maxlength: '2', value: existing?.icon || '' })),
            field('설명(선택)', el('textarea', { class: 'nm-textarea', name: 'description' }, existing?.description || ''))
          );
          form.append(el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장'));
          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const fd = new FormData(form);
            const data = { name: fd.get('name'), url: fd.get('url'), icon: fd.get('icon') || null, description: fd.get('description') || null };
            if (existing) await appState.updateProgram(existing.id, data);
            else await appState.addProgram(data);
            toast('저장했습니다.', 'success');
            close();
          });
          body.append(form);
        },
      });
    }

    function field(label, node) {
      return el('div', { class: 'nm-field' }, [el('label', {}, label), node]);
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderPrograms = renderPrograms;
})();
