// 이력/경력 관리(Career) 화면. 학력·자격증·교육이수·가입단체·포상·경력·증명사진의 7개
// 카테고리를 각각 독립된 테이블로 관리하되, 테이블 구조(사용자 소유 + sort_order + 소프트삭제)가
// 모두 같으므로 하나의 설정(CATEGORIES) + 공통 렌더링 함수로 처리한다.
// 목록 UI는 Knowledge/프로그램 화면의 공통 리스트(검색/정렬/컬럼폭/선택삭제) 패턴을 그대로 따르고,
// 첨부파일은 js/components/attachments.js의 공통 컴포넌트를 재사용한다(새 레코드는 저장 후
// 같은 모달 안에서 바로 첨부할 수 있다 — Knowledge/문화생활과 동일한 흐름).
(function () {
  const { appState, el, escapeHtml, toast, confirmDialog, openModal, todayISO } = window;

  // 카테고리 설정. fields: 등록/수정 폼에 쓰이는 필드 정의. columns: 목록 테이블에 보여줄 컬럼.
  const CATEGORIES = [
    {
      key: 'education',
      label: '학력',
      icon: '🎓',
      titleField: 'school_name',
      searchFields: ['school_name', 'degree', 'note'],
      fields: [
        { name: 'school_name', label: '학교명', type: 'text', required: true },
        { name: 'degree', label: '학위/전공', type: 'text' },
        { name: 'admission_date', label: '입학일', type: 'date' },
        { name: 'graduation_date', label: '졸업일', type: 'date' },
        { name: 'status', label: '상태', type: 'select', options: ['재학', '졸업', '휴학', '중퇴'], default: '졸업' },
        { name: 'note', label: '비고', type: 'textarea' },
      ],
      columns: [
        { key: 'school_name', label: '학교명' },
        { key: 'degree', label: '학위/전공' },
        { key: 'status', label: '상태' },
        { key: 'graduation_date', label: '졸업일' },
      ],
    },
    {
      key: 'certifications',
      label: '자격증 보유',
      icon: '📜',
      titleField: 'cert_name',
      searchFields: ['cert_name', 'issuing_org', 'note'],
      fields: [
        { name: 'cert_name', label: '자격증명', type: 'text', required: true },
        { name: 'issuing_org', label: '발급기관', type: 'text' },
        { name: 'acquired_date', label: '취득일', type: 'date' },
        { name: 'cert_number', label: '자격증 번호(선택)', type: 'text' },
        { name: 'expiry_date', label: '유효기간(선택)', type: 'date' },
        { name: 'note', label: '비고', type: 'textarea' },
      ],
      columns: [
        { key: 'cert_name', label: '자격증명' },
        { key: 'issuing_org', label: '발급기관' },
        { key: 'acquired_date', label: '취득일' },
        { key: 'expiry_date', label: '유효기간' },
      ],
    },
    {
      key: 'trainings',
      label: '교육이수',
      icon: '📚',
      titleField: 'training_name',
      searchFields: ['training_name', 'institution', 'note'],
      fields: [
        { name: 'training_name', label: '교육/과정명', type: 'text', required: true },
        { name: 'institution', label: '교육기관', type: 'text' },
        { name: 'start_date', label: '시작일', type: 'date' },
        { name: 'end_date', label: '종료일', type: 'date' },
        { name: 'hours', label: '이수시간(선택)', type: 'number' },
        { name: 'note', label: '비고', type: 'textarea' },
      ],
      columns: [
        { key: 'training_name', label: '교육/과정명' },
        { key: 'institution', label: '교육기관' },
        { key: 'start_date', label: '시작일' },
        { key: 'end_date', label: '종료일' },
      ],
    },
    {
      key: 'memberships',
      label: '가입단체',
      icon: '🤝',
      titleField: 'org_name',
      searchFields: ['org_name', 'role', 'note'],
      fields: [
        { name: 'org_name', label: '단체명', type: 'text', required: true },
        { name: 'role', label: '직책/역할(선택)', type: 'text' },
        { name: 'join_date', label: '가입일', type: 'date' },
        { name: 'leave_date', label: '탈퇴일(선택, 비우면 활동중)', type: 'date' },
        { name: 'note', label: '비고', type: 'textarea' },
      ],
      columns: [
        { key: 'org_name', label: '단체명' },
        { key: 'role', label: '직책/역할' },
        { key: 'join_date', label: '가입일' },
        { key: 'leave_date', label: '탈퇴일' },
      ],
    },
    {
      key: 'awards',
      label: '포상',
      icon: '🏅',
      titleField: 'award_name',
      searchFields: ['award_name', 'awarding_body', 'note'],
      fields: [
        { name: 'award_name', label: '포상명', type: 'text', required: true },
        { name: 'awarding_body', label: '수여기관', type: 'text' },
        { name: 'award_date', label: '수상일', type: 'date' },
        { name: 'note', label: '비고', type: 'textarea' },
      ],
      columns: [
        { key: 'award_name', label: '포상명' },
        { key: 'awarding_body', label: '수여기관' },
        { key: 'award_date', label: '수상일' },
      ],
    },
    {
      key: 'experiences',
      label: '경력',
      icon: '💼',
      titleField: 'company_name',
      searchFields: ['company_name', 'department_position', 'note'],
      fields: [
        { name: 'company_name', label: '회사명', type: 'text', required: true },
        { name: 'department_position', label: '부서/직책(선택)', type: 'text' },
        { name: 'employment_type', label: '고용형태(선택)', type: 'select', options: ['정규직', '계약직', '프리랜서', '인턴', '기타'] },
        { name: 'start_date', label: '입사일', type: 'date' },
        { name: 'end_date', label: '퇴사일(선택, 비우면 재직중)', type: 'date' },
        { name: 'note', label: '담당업무/비고', type: 'textarea' },
      ],
      columns: [
        { key: 'company_name', label: '회사명' },
        { key: 'department_position', label: '부서/직책' },
        { key: 'start_date', label: '입사일' },
        { key: 'end_date', label: '퇴사일' },
      ],
    },
    {
      key: 'photos',
      label: '증명사진',
      icon: '🖼️',
      titleField: 'label',
      searchFields: ['label', 'note'],
      isPhoto: true,
      fields: [
        { name: 'label', label: '캡션(선택, 예: 2026년 여권용)', type: 'text' },
        { name: 'taken_date', label: '촬영일', type: 'date' },
        { name: 'note', label: '비고', type: 'textarea' },
      ],
      columns: [
        { key: '_thumb', label: '사진' },
        { key: 'label', label: '캡션' },
        { key: 'taken_date', label: '촬영일' },
      ],
    },
  ];

  function tableOf(key) {
    return window.CAREER_TABLES[key];
  }

  function renderCareer(root) {
    const container = el('div', {});
    root.append(container);

    let activeCat = CATEGORIES[0].key;
    // 카테고리별 검색어/정렬/선택 상태를 독립적으로 유지한다(탭을 옮겨도 서로 영향 없음).
    const ui = {};
    for (const c of CATEGORIES) ui[c.key] = { query: '', sort: { key: 'sort_order', dir: 'asc' }, selected: new Set() };

    function draw() {
      container.innerHTML = '';
      const cat = CATEGORIES.find((c) => c.key === activeCat);
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '이력/경력 관리'),
          el('div', { class: 'row', style: 'gap:8px' }, [
            el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openRecordForm(cat) }, `+ ${cat.label} 추가`),
          ]),
        ])
      );
      container.append(
        el(
          'div',
          { class: 'quick-tabs' },
          CATEGORIES.map((c) =>
            el(
              'button',
              { class: `quick-tab ${activeCat === c.key ? 'quick-tab--active' : ''}`, onclick: () => { activeCat = c.key; draw(); } },
              `${c.icon} ${c.label}`
            )
          )
        )
      );
      container.append(categorySection(cat));
    }

    function restoreFocus(selector, pos) {
      const next = container.querySelector(selector);
      if (next) {
        next.focus();
        try { next.setSelectionRange(pos, pos); } catch (e) { /* 일부 input type은 미지원 — 무시 */ }
      }
    }

    function sortableTh(label, key, state, onClick) {
      const active = state.key === key;
      return el('th', { class: active ? 'is-sorted' : '', onclick: () => onClick(key) }, [
        label, active ? el('span', { class: 'sort-arrow' }, state.dir === 'asc' ? '▲' : '▼') : null,
      ]);
    }

    function categorySection(cat) {
      const state = ui[cat.key];
      const allRows = appState.career[cat.key] || [];
      let rows = allRows.slice();
      if (state.query.trim()) {
        const q = state.query.trim().toLowerCase();
        rows = rows.filter((r) => cat.searchFields.some((f) => String(r[f] || '').toLowerCase().includes(q)));
      }
      rows = rows.slice().sort((a, b) => {
        const key = state.sort.key;
        let av = key === 'sort_order' ? (a.sort_order || 0) : (a[key] || '');
        let bv = key === 'sort_order' ? (b.sort_order || 0) : (b[key] || '');
        let cmp;
        if (typeof av === 'number' && typeof bv === 'number') cmp = av - bv;
        else cmp = String(av).localeCompare(String(bv));
        return state.sort.dir === 'asc' ? cmp : -cmp;
      });
      const customOrder = state.sort.key === 'sort_order' && state.sort.dir === 'asc' && !state.query.trim();

      const wrap = el('div', {});
      wrap.append(
        el('div', { class: 'filter-bar', style: 'margin-bottom:8px' }, [
          el('input', {
            class: `nm-input career-search-${cat.key}`, style: 'max-width:240px', placeholder: '검색', value: state.query,
            oninput: (e) => { const pos = e.target.selectionStart; state.query = e.target.value; draw(); restoreFocus(`.career-search-${cat.key}`, pos); },
          }),
        ])
      );

      if (!allRows.length) {
        wrap.append(el('div', { class: 'empty-state' }, `등록된 ${cat.label} 기록이 없습니다.`));
        return wrap;
      }

      state.selected = new Set([...state.selected].filter((id) => rows.some((r) => r.id === id)));
      const selCount = state.selected.size;
      wrap.append(
        el('div', { class: 'row row--between', style: 'margin-bottom:8px; align-items:center' }, [
          el('label', { class: 'row', style: 'gap:6px; align-items:center; cursor:pointer; font-size:13px' }, [
            el('input', {
              type: 'checkbox',
              checked: rows.length > 0 && selCount === rows.length ? true : undefined,
              onchange: (e) => { if (e.target.checked) rows.forEach((r) => state.selected.add(r.id)); else state.selected.clear(); draw(); },
            }),
            el('span', { class: 'text-muted' }, '전체선택'),
          ]),
          el('button', {
            class: 'nm-btn nm-btn--danger',
            disabled: selCount === 0 || undefined,
            onclick: async () => {
              if (!confirmDialog(`선택한 ${selCount}건을 삭제할까요?`)) return;
              const ids = [...state.selected];
              state.selected.clear();
              await appState.deleteCareerRecordsBulk(cat.key, ids);
              toast(`${ids.length}건 삭제했습니다.`, 'success');
            },
          }, `선택 삭제${selCount ? ` (${selCount})` : ''}`),
        ])
      );

      if (!customOrder) {
        wrap.append(el('p', { class: 'text-muted', style: 'font-size:11px; margin:-4px 0 8px' }, '※ 검색/정렬 중에는 드래그·↑/↓ 순서 변경이 비활성화됩니다. "작업" 컬럼 정렬을 기본(등록순)으로 되돌리면 다시 쓸 수 있습니다.'));
      }

      if (!rows.length) {
        wrap.append(el('div', { class: 'empty-state' }, '검색 결과가 없습니다.'));
        return wrap;
      }

      const tableWrap = el('div', { class: 'data-table-wrap' });
      const table = el('table', { class: 'data-table' });
      table.append(
        el('colgroup', {}, [
          el('col', { style: 'width:34px' }),
          el('col', { style: 'width:40px' }),
          ...cat.columns.map(() => el('col', {})),
          el('col', { style: 'width:70px' }),
          el('col', { style: 'width:190px' }),
        ])
      );
      table.append(
        el('thead', {}, [
          el('tr', {}, [
            el('th', {}, [
              el('input', {
                type: 'checkbox',
                checked: rows.length > 0 && selCount === rows.length ? true : undefined,
                onchange: (e) => { if (e.target.checked) rows.forEach((r) => state.selected.add(r.id)); else state.selected.clear(); draw(); },
              }),
            ]),
            el('th', {}, 'No'),
            ...cat.columns.map((c) => (c.key === '_thumb' ? el('th', {}, c.label) : sortableTh(c.label, c.key, state.sort, (k) => { state.sort = state.sort.key === k ? { key: k, dir: state.sort.dir === 'asc' ? 'desc' : 'asc' } : { key: k, dir: 'asc' }; draw(); }))),
            el('th', {}, '첨부'),
            el('th', {}, '작업'),
          ]),
        ])
      );
      const tbody = el('tbody', {});
      rows.forEach((r, idx) => {
        const attachCount = appState.getAttachments(tableOf(cat.key), r.id).length;
        const tr = el('tr', {
          draggable: customOrder || undefined,
          dataset: { id: r.id },
        }, [
          el('td', {}, [
            el('input', {
              type: 'checkbox', checked: state.selected.has(r.id) || undefined,
              onchange: (e) => { if (e.target.checked) state.selected.add(r.id); else state.selected.delete(r.id); draw(); },
            }),
          ]),
          el('td', {}, String(idx + 1)),
          ...cat.columns.map((c) => {
            if (c.key === '_thumb') return el('td', {}, [photoThumb(r, cat)]);
            const isTitle = c.key === cat.titleField;
            const val = r[c.key];
            const text = val ? escapeHtml(String(val)) : '-';
            return isTitle
              ? el('td', { style: 'cursor:pointer', onclick: () => openViewModal(cat, r) }, [el('strong', {}, text)])
              : el('td', {}, text);
          }),
          el('td', {}, attachCount ? `📎${attachCount}` : '-'),
          el('td', {}, [
            el('div', { class: 'icon-row' }, [
              el('button', { class: 'nm-btn nm-btn--icon', title: '위로', disabled: !customOrder || idx === 0 || undefined, onclick: () => moveRecord(cat, rows, idx, -1) }, '↑'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '아래로', disabled: !customOrder || idx === rows.length - 1 || undefined, onclick: () => moveRecord(cat, rows, idx, 1) }, '↓'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '열람', onclick: () => openViewModal(cat, r) }, '👁'),
              el('button', { class: 'nm-btn nm-btn--icon', title: '수정', onclick: () => openRecordForm(cat, r) }, '✎'),
              el('button', { class: 'nm-btn nm-btn--icon nm-btn--danger', title: '삭제', onclick: () => removeRecord(cat, r) }, '🗑'),
            ]),
          ]),
        ]);
        if (customOrder) attachDragHandlers(tr, cat, rows, r.id);
        tbody.append(tr);
      });
      table.append(tbody);
      tableWrap.append(table);
      wrap.append(tableWrap);
      return wrap;
    }

    // 증명사진 목록의 썸네일 — 첫 번째 이미지 첨부를 작게 보여준다(없으면 플레이스홀더).
    function photoThumb(r, cat) {
      const atts = appState.getAttachments(tableOf(cat.key), r.id);
      const img = atts.find((a) => (a.mime_type || '').startsWith('image/'));
      if (img) return el('img', { class: 'career-photo-thumb', src: img.data, alt: r.label || '증명사진' });
      return el('div', { class: 'career-photo-thumb--empty' }, '사진없음');
    }

    // ---- 드래그로 순서 변경(HTML5 Drag and Drop) ----
    function attachDragHandlers(tr, cat, rows, id) {
      tr.addEventListener('dragstart', (e) => {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id);
        tr.classList.add('career-row--dragging');
      });
      tr.addEventListener('dragend', () => tr.classList.remove('career-row--dragging'));
      tr.addEventListener('dragover', (e) => {
        e.preventDefault();
        tr.classList.add('career-row--dragover');
      });
      tr.addEventListener('dragleave', () => tr.classList.remove('career-row--dragover'));
      tr.addEventListener('drop', async (e) => {
        e.preventDefault();
        tr.classList.remove('career-row--dragover');
        const draggedId = e.dataTransfer.getData('text/plain');
        if (!draggedId || draggedId === id) return;
        const ids = rows.map((r) => r.id);
        const fromIdx = ids.indexOf(draggedId);
        const toIdx = ids.indexOf(id);
        if (fromIdx === -1 || toIdx === -1) return;
        ids.splice(toIdx, 0, ids.splice(fromIdx, 1)[0]);
        await appState.reorderCareerRecords(cat.key, ids);
      });
    }

    async function moveRecord(cat, rows, idx, dir) {
      const next = rows.slice();
      const swapWith = idx + dir;
      if (swapWith < 0 || swapWith >= next.length) return;
      [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
      await appState.reorderCareerRecords(cat.key, next.map((r) => r.id));
    }

    async function removeRecord(cat, r) {
      const label = r[cat.titleField] || cat.label;
      if (!confirmDialog(`"${label}" 항목을 삭제할까요?`)) return;
      await appState.deleteCareerRecord(cat.key, r.id);
      toast('삭제했습니다.', 'success');
    }

    // ---- 열람(읽기 전용) 모달: 전체 필드 + 첨부파일 미리보기 + 첨부 관리 ----
    function openViewModal(cat, r) {
      openModal({
        title: `${cat.icon} ${cat.label} 열람`,
        contentBuilder(body) {
          const table = tableOf(cat.key);
          if (cat.isPhoto) {
            body.append(el('h2', { style: 'margin:0 0 6px; font-size:18px' }, escapeHtml(r.label || '(캡션 없음)')));
          } else {
            body.append(el('h2', { style: 'margin:0 0 10px; font-size:18px' }, escapeHtml(r[cat.titleField] || '')));
          }
          const detail = el('div', { class: 'stack', style: 'gap:6px; font-size:13px' });
          for (const f of cat.fields) {
            if (f.name === cat.titleField && !cat.isPhoto) continue;
            const val = r[f.name];
            detail.append(
              el('div', { class: 'row', style: 'gap:8px' }, [
                el('span', { class: 'text-muted', style: 'min-width:120px; font-weight:600' }, f.label.replace(/\(선택.*?\)/, '').trim()),
                el('span', { style: 'white-space:pre-wrap' }, val ? escapeHtml(String(val)) : '-'),
              ])
            );
          }
          body.append(detail);

          const atts = appState.getAttachments(table, r.id);
          if (atts.length) {
            body.append(el('h3', { style: 'margin:16px 0 8px; font-size:14px' }, '첨부파일 미리보기'));
            const previewBox = el('div', { class: 'stack', style: 'gap:10px' });
            body.append(previewBox);
            window.renderAttachmentPreviews(previewBox, table, r.id);
          }
          const attachBox = el('div', { style: 'margin-top:16px' });
          body.append(el('h3', { style: 'margin:0 0 6px; font-size:14px' }, '첨부파일 관리(추가/삭제)'), attachBox);
          window.renderAttachmentsPanel(attachBox, table, r.id);
        },
      });
    }

    // ---- 등록/수정 폼 ----
    function buildFieldInput(f, existing) {
      const value = existing ? existing[f.name] : (f.default ?? '');
      if (f.type === 'textarea') return el('textarea', { class: 'nm-textarea', name: f.name }, value || '');
      if (f.type === 'select') {
        const select = el('select', { class: 'nm-select', name: f.name });
        if (!f.required) select.append(el('option', { value: '' }, '(선택 안 함)'));
        for (const opt of f.options) select.append(el('option', { value: opt, selected: opt === value || undefined }, opt));
        return select;
      }
      if (f.type === 'number') return el('input', { class: 'nm-input', type: 'number', name: f.name, value: value ?? '' });
      if (f.type === 'date') return el('input', { class: 'nm-input', type: 'date', name: f.name, value: value || '' });
      return el('input', { class: 'nm-input', type: 'text', name: f.name, required: f.required || undefined, value: value || '' });
    }

    function openRecordForm(cat, existing) {
      openModal({
        title: existing ? `${cat.label} 수정` : `${cat.label} 추가`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const inputs = {};
          for (const f of cat.fields) {
            const input = buildFieldInput(f, existing);
            inputs[f.name] = input;
            form.append(el('div', { class: 'nm-field' }, [el('label', {}, f.label), input]));
          }
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          form.append(submitBtn);
          // 신규 등록 직후 바로 파일을 첨부할 수 있도록(Knowledge/문화생활과 동일한 흐름),
          // 저장되면 폼 자리에 첨부 패널을 보여준다.
          const attachHost = el('div', {});
          body.append(form, attachHost);

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {};
            for (const f of cat.fields) {
              let v = inputs[f.name].value;
              if (f.type === 'number') v = v === '' ? null : Number(v);
              else v = v === '' ? null : v;
              data[f.name] = v;
            }
            try {
              if (existing) {
                await appState.updateCareerRecord(cat.key, existing.id, data);
                toast('저장했습니다.', 'success');
                close();
              } else {
                const row = await appState.addCareerRecord(cat.key, data);
                toast('등록했습니다. 이제 파일을 첨부할 수 있어요.', 'success');
                Array.from(form.elements).forEach((elm) => { elm.disabled = true; });
                submitBtn.style.display = 'none';
                attachHost.append(
                  el('h3', { style: 'margin:16px 0 8px' }, '첨부파일'),
                  el('div', { id: 'new-career-attach-box' }),
                  el('button', { class: 'nm-btn nm-btn--primary', style: 'width:100%; margin-top:12px', onclick: close }, '완료')
                );
                window.renderAttachmentsPanel(attachHost.querySelector('#new-career-attach-box'), tableOf(cat.key), row.id);
              }
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
        },
      });
    }

    draw();
    appState.addEventListener('change', draw);
    return () => appState.removeEventListener('change', draw);
  }

  window.renderCareer = renderCareer;
})();
