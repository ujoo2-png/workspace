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

  // v7.34.0 사용자 컬럼: 기본 카테고리 설정에 사용자 정의 필드/컬럼/검색 대상을 덧붙인 "유효 설정"을 만든다(멱등).
  function effective(cat) {
    const CC = window.CareerCols;
    if (!cat || cat._eff || !CC) return cat;
    const list = CC.active(cat.key);
    if (!list.length) return cat;
    const cf = list.map((d) => ({ name: CC.fieldName(d.id), label: d.label, type: d.type, options: d.options, custom: true, def: d }));
    return {
      ...cat, _eff: true, base: cat, customFields: cf,
      fields: [...cat.fields.filter((f) => f.name !== 'note'), ...cf, ...cat.fields.filter((f) => f.name === 'note')],
      columns: [...cat.columns, ...cf.filter((f) => f.def.list).map((f) => ({ key: f.name, label: f.label, custom: true }))],
      searchFields: [...cat.searchFields, ...cf.map((f) => f.name)],
    };
  }
  const cv = (r, key) => (window.CareerCols && window.CareerCols.isCustomName(key) ? ((r.extra && r.extra[key.slice(2)]) ?? '') : r[key]);

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

    // ---- v7.22.0 추가 아이디어: 총 경력(겹침 제외) · 경력기술서 자동 문안 · 자격증 만료 임박 ----
    function careerExtras(cat) {
      const CLg = window.CareerLogic;
      const rows = appState.career[cat.key] || [];
      if (!rows.length) return null;
      if (cat.key === 'experiences') {
        const total = CLg.totalExperience(rows, todayISO());
        return el('div', { class: 'career-extra career-extra--exp' }, [
          el('span', { class: 'career-extra__main' }, [
            '총 경력 ', el('strong', { class: 'career-total-exp' }, total.count ? total.text : '계산할 기간 없음'),
            el('span', { class: 'text-muted', style: 'font-size:12px' }, total.count ? ` · 겹치는 기간은 한 번만 계산(${total.count}건 → ${total.intervals}개 구간)` : ' · 입사일이 있는 경력이 없습니다'),
          ]),
          el('button', { class: 'nm-btn career-narrative-btn', onclick: () => openNarrativeModal() }, '📝 경력기술서 만들기'),
        ]);
      }
      if (cat.key === 'certifications') {
        const sts = rows.map((r) => ({ r, st: CLg.certExpiryStatus(r, todayISO()) }));
        const soon = sts.filter((x) => x.st.state === 'soon');
        const expired = sts.filter((x) => x.st.state === 'expired');
        if (!soon.length && !expired.length) return null;
        return el('div', { class: 'career-extra career-extra--cert' }, [
          '⏰ 자격증 유효기간 알림 ',
          soon.length ? el('span', { class: 'career-exp-badge career-exp-badge--soon' }, `만료 임박 ${soon.length}건 (90일 이내): ${soon.map((x) => x.r.cert_name).join(', ')}`) : null,
          expired.length ? el('span', { class: 'career-exp-badge career-exp-badge--expired' }, `만료됨 ${expired.length}건: ${expired.map((x) => x.r.cert_name).join(', ')}`) : null,
        ]);
      }
      return null;
    }
    function openNarrativeModal() {
      const CLg = window.CareerLogic;
      openModal({
        title: '📝 경력기술서 자동 문안', width: '640px',
        contentBuilder(body) {
          let order = 'desc';
          const ta = el('textarea', { class: 'nm-textarea', rows: 16, name: 'narrative', style: 'font-family:inherit' });
          const fill = () => { ta.value = CLg.careerNarrative(appState.career.experiences || [], { order, fmt: 'YYYY.MM', todayIso: todayISO() }); };
          fill();
          body.append(
            el('p', { class: 'text-muted', style: 'font-size:12px' }, '등록된 경력(회사·기간·부서/직책·담당업무)으로 만든 초안입니다. 자유롭게 고쳐서 복사해 쓰세요. 양식 문서의 "경력기술서" 칸에는 자동으로 들어갑니다.'),
            el('label', { class: 'row', style: 'gap:6px; align-items:center; margin-bottom:6px' }, ['정렬',
              el('select', { class: 'nm-select', style: 'width:auto', onchange: (e) => { order = e.target.value; fill(); } }, [el('option', { value: 'desc' }, '최근 경력부터'), el('option', { value: 'asc' }, '오래된 경력부터')])]),
            ta,
            el('div', { class: 'row', style: 'gap:8px; margin-top:8px' }, [
              el('button', { class: 'nm-btn nm-btn--primary', onclick: async () => { try { await navigator.clipboard.writeText(ta.value); toast('복사했습니다.', 'success'); } catch (e) { ta.select(); toast('자동 복사가 막혔습니다. 선택된 텍스트를 직접 복사해 주세요.', 'error'); } } }, '📋 복사'),
              el('button', { class: 'nm-btn', onclick: () => { const url = URL.createObjectURL(new Blob([ta.value], { type: 'text/plain;charset=utf-8' })); const a = document.createElement('a'); a.href = url; a.download = `경력기술서_${todayISO()}.txt`; a.click(); URL.revokeObjectURL(url); } }, '⬇ .txt 저장'),
            ])
          );
        },
      });
    }

    // ---- 기본정보(사용자당 1행) — 민감한 개인정보 ----
    const BASIC_FORM = [
      { name: 'name', label: '성명(한글)', type: 'text', required: true, autocomplete: 'name' },
      { name: 'name_en', label: '영문 이름(선택)', type: 'text' },
      { name: 'name_hanja', label: '한자 이름(선택)', type: 'text' },
      { name: 'birth_date', label: '생년월일', type: 'date' },
      { name: 'gender', label: '성별', type: 'select', options: ['남', '여', '기타'] },
      { name: 'phone', label: '연락처(휴대폰)', type: 'text', autocomplete: 'tel' },
      { name: 'email', label: '이메일', type: 'text', autocomplete: 'email' },
      { name: 'address', label: '주소', type: 'text', autocomplete: 'street-address', wide: true },
      { name: 'military', label: '병역(선택)', type: 'select', options: ['군필', '미필', '면제', '해당없음'] },
      { name: 'nationality', label: '국적(선택)', type: 'text' },
    ];
    function basicInfoSection() {
      const cur = appState.careerBasic || {};
      const prof = appState.profile || {};
      const wrap = el('div', { class: 'career-basic' });
      wrap.append(el('div', { class: 'career-pii' }, [
        el('strong', {}, '🔒 민감한 개인정보 '),
        '이름·연락처·주소는 이 계정에서만 보이며(DB 행 단위 보안 RLS), 양식 문서를 채울 때만 사용합니다. 어떤 외부 서비스로도 전송하지 않습니다. ',
        '전체 백업(JSON)에는 포함되니 백업 파일을 안전하게 보관하세요. 주민등록번호 같은 고유식별번호는 일부러 저장 칸을 만들지 않았습니다(양식에서는 직접 입력).',
      ]));
      const form = el('form', { class: 'career-basic__form', novalidate: true });
      const inputs = {};
      for (const f of BASIC_FORM) {
        let init = cur[f.name] || '';
        // 설정의 "내 정보"에 있는 생년월일/성별은 비어 있을 때 미리 채워 준다(저장해야 반영).
        if (!init && f.name === 'birth_date' && prof.birth_date) init = prof.birth_date;
        if (!init && f.name === 'gender' && prof.gender) init = { male: '남', female: '여', other: '기타' }[prof.gender] || '';
        let input;
        if (f.type === 'select') {
          input = el('select', { class: 'nm-select', name: f.name }, [el('option', { value: '' }, '(선택 안 함)'), ...f.options.map((o) => el('option', { value: o, selected: o === init || undefined }, o))]);
        } else {
          input = el('input', { class: 'nm-input', type: f.type, name: f.name, value: init, autocomplete: f.autocomplete || 'off', required: f.required || undefined });
        }
        inputs[f.name] = input;
        form.append(el('div', { class: `nm-field ${f.wide ? 'career-basic__wide' : ''}` }, [el('label', {}, f.label), input]));
      }
      const errBox = el('div', { class: 'cd-error hidden', role: 'alert' });
      form.append(errBox, el('button', { class: 'nm-btn nm-btn--primary career-basic__save', type: 'submit' }, '저장'));
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errBox.classList.add('hidden');
        const data = {};
        for (const f of BASIC_FORM) { const v = inputs[f.name].value.trim(); data[f.name] = v === '' ? null : v; }
        if (!data.name) { errBox.textContent = '성명을 입력해 주세요.'; errBox.classList.remove('hidden'); inputs.name.focus(); return; }
        if (data.email && !/^\S+@\S+\.\S+$/.test(data.email)) { errBox.textContent = '이메일 형식을 확인해 주세요.'; errBox.classList.remove('hidden'); inputs.email.focus(); return; }
        try { await appState.saveCareerBasicInfo(data); toast('기본정보를 저장했습니다.', 'success'); } catch (err) { toast(`저장 실패: ${err.message || err}`, 'error'); }
      });
      wrap.append(form);
      wrap.append(el('p', { class: 'text-muted', style: 'font-size:12px; margin-top:12px' }, '여기에 저장한 값은 "📄 양식 문서"에서 성명/생년월일/연락처/이메일/주소/병역/국적 칸을 자동으로 채우는 데 쓰입니다.'));
      return wrap;
    }

    // 확장 탭: 📄 양식 문서(지연 로딩) / 👤 기본정보
    const EXTRA_TABS = [
      { key: 'docs', label: '양식 문서', icon: '📄', accent: true },
      { key: 'basic', label: '기본정보', icon: '👤' },
    ];
    const docsHost = el('div', { class: 'career-docs-host' });
    let docsApi = null;
    let docsState = 'idle'; // idle | loading | ready | error

    function mountDocs() {
      if (docsState !== 'idle') return;
      docsState = 'loading';
      docsHost.append(el('div', { class: 'empty-state' }, '⏳ 양식 문서 도구를 불러오는 중… (처음 한 번만, 약 1MB)'));
      window.loadFormTools().then(() => {
        docsHost.innerHTML = '';
        docsApi = window.renderCareerDocuments(docsHost);
        docsState = 'ready';
        draw();
      }).catch((err) => {
        docsState = 'idle';
        docsHost.innerHTML = '';
        docsHost.append(el('div', { class: 'empty-state' }, [`양식 문서 도구를 불러오지 못했습니다: ${err.message || err} `, el('button', { class: 'nm-btn', onclick: () => { docsHost.innerHTML = ''; mountDocs(); } }, '다시 시도')]));
      });
    }

    function draw() {
      container.innerHTML = '';
      const isExtra = EXTRA_TABS.some((t) => t.key === activeCat);
      const cat = CATEGORIES.find((c) => c.key === activeCat);
      let headBtn = null;
      if (activeCat === 'docs') headBtn = el('button', { class: 'nm-btn nm-btn--primary', disabled: docsState !== 'ready' || undefined, onclick: () => docsApi && docsApi.openNew() }, '+ 새 양식 문서');
      else if (cat) headBtn = el('button', { class: 'nm-btn nm-btn--primary', onclick: () => openRecordForm(cat) }, `+ ${cat.label} 추가`);
      container.append(
        el('div', { class: 'page-header' }, [
          el('h1', {}, '이력/경력 관리'),
          el('div', { class: 'row', style: 'gap:8px' }, [headBtn]),
        ])
      );
      container.append(
        el(
          'div',
          { class: 'quick-tabs' },
          [...CATEGORIES.map((c) => ({ key: c.key, label: c.label, icon: c.icon })), ...EXTRA_TABS].map((c) =>
            el(
              'button',
              { class: `quick-tab ${activeCat === c.key ? 'quick-tab--active' : ''} ${c.accent ? 'quick-tab--accent' : ''}`, dataset: { tab: c.key }, onclick: () => { activeCat = c.key; draw(); } },
              [`${c.icon} ${c.label}`, c.accent ? el('span', { class: 'career-new-tag' }, 'NEW') : null]
            )
          )
        )
      );
      if (activeCat === 'docs') { container.append(docsHost); mountDocs(); } else if (activeCat === 'basic') container.append(basicInfoSection());
      else if (!isExtra) container.append(categorySection(cat));
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

    function categorySection(baseCat) {
      const cat = effective(baseCat);
      const state = ui[cat.key];
      const allRows = appState.career[cat.key] || [];
      let rows = allRows.slice();
      if (state.query.trim()) {
        const q = state.query.trim().toLowerCase();
        rows = rows.filter((r) => cat.searchFields.some((f) => String(cv(r, f) || '').toLowerCase().includes(q)));
      }
      rows = rows.slice().sort((a, b) => {
        const key = state.sort.key;
        let av = key === 'sort_order' ? (a.sort_order || 0) : (cv(a, key) || '');
        let bv = key === 'sort_order' ? (b.sort_order || 0) : (cv(b, key) || '');
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
          el('button', { class: 'nm-btn career-colmgr-btn', title: '이 항목에 양식별로 필요한 컬럼을 최대 5개까지 추가', onclick: () => openColumnManager(baseCat) }, `⚙ 컬럼 설정${window.CareerCols.active(cat.key).length ? ` (${window.CareerCols.active(cat.key).length}/${window.CareerCols.MAX})` : ''}`),
        ])
      );

      const extras = careerExtras(cat);
      if (extras) wrap.append(extras);

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
            const val = cv(r, c.key);
            const text = val ? escapeHtml(String(val)) : '-';
            if (cat.key === 'certifications' && c.key === 'expiry_date') {
              const st = window.CareerLogic.certExpiryStatus(r, todayISO());
              return el('td', {}, [el('span', {}, val ? String(val) : '-'), st.state === 'soon' || st.state === 'expired' ? el('span', { class: `career-exp-badge career-exp-badge--${st.state}`, style: 'margin-left:6px' }, window.CareerLogic.expiryLabel(st)) : null]);
            }
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
      if (img) {
        // 목록에는 본문이 없다(v7.21.0 지연 로딩) — 캐시에 있으면 바로, 없으면 백그라운드로 불러온 뒤 다시 그려진다.
        const data = appState.peekAttachmentData(img.id);
        if (data) return el('img', { class: 'career-photo-thumb', src: data, alt: r.label || '증명사진' });
        appState.prefetchAttachmentData([img]);
        return el('div', { class: 'career-photo-thumb--empty' }, '불러오는 중…');
      }
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
    function openViewModal(baseCat, r) {
      const cat = effective(baseCat);
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
            const val = cv(r, f.name);
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
      const value = existing ? cv(existing, f.name) : (f.default ?? '');
      if (f.type === 'textarea') return el('textarea', { class: 'nm-textarea', name: f.name }, value || '');
      if (f.type === 'select') {
        const select = el('select', { class: 'nm-select', name: f.name });
        if (!f.required) select.append(el('option', { value: '' }, '(선택 안 함)'));
        const opts = f.custom && value && !f.options.includes(value) ? [...f.options, value] : f.options; // 목록에서 빠진 옛 값도 잃지 않게 유지
        for (const opt of opts) select.append(el('option', { value: opt, selected: opt === value || undefined }, opt));
        return select;
      }
      if (f.type === 'number') return el('input', { class: 'nm-input', type: 'number', name: f.name, value: value ?? '' });
      if (f.type === 'date') return el('input', { class: 'nm-input', type: 'date', name: f.name, value: value || '' });
      return el('input', { class: 'nm-input', type: 'text', name: f.name, required: f.required || undefined, value: value || '' });
    }


    // ================================================================
    // v7.34.0 ⚙ 컬럼 설정 — 이력서 양식에 따라 필요한 컬럼을 카테고리마다 최대 5개 추가(코드 수정·SQL 불필요)
    // ================================================================
    async function builtinFor(cat) {
      const CC = window.CareerCols; const out = [];
      try { await window.loadFormCore(); if (window.FormTemplate && window.FormTemplate.CATS[cat.key]) out.push(...window.FormTemplate.builtinTerms(cat.key)); } catch { /* 사전을 못 불러와도 화면 라벨 기준 검사는 한다 */ }
      for (const f of cat.fields) { const label = String(f.label).replace(/\(선택.*?\)/, '').trim(); const term = CC.norm(label); if (term) out.push({ term, label, fromLabel: true }); }
      return out;
    }
    function openColumnManager(baseCat) {
      const CC = window.CareerCols;
      openModal({
        title: `⚙ ${baseCat.label} 컬럼 설정`, width: '680px',
        contentBuilder(body) {
          const host = el('div', {}); body.append(host);
          let builtin = null;
          builtinFor(baseCat).then((b) => { builtin = b; });
          const usage = (id) => (appState.career[baseCat.key] || []).filter((r) => r.extra && r.extra[id] !== undefined && r.extra[id] !== null && r.extra[id] !== '').length;
          const commit = (map) => {
            CC.save(map);
            if (window.FormTemplate) window.FormTemplate.registerCustom(Object.fromEntries(Object.keys(window.FormTemplate.CATS).map((k) => [k, CC.defs(k, map)])));
            draw(); paint();
          };
          async function addColumn(label, type, options) {
            if (!builtin) builtin = await builtinFor(baseCat);
            const map = CC.load();
            if (CC.active(baseCat.key, map).length >= CC.MAX) { toast(`컬럼은 항목마다 최대 ${CC.MAX}개입니다. 안 쓰는 컬럼을 숨김 보관하세요.`, 'error'); return false; }
            const chk = CC.checkLabel(baseCat.key, label, builtin, map);
            if (chk.level === 'block') { toast(chk.msg, 'error'); return false; }
            if (chk.level === 'warn' && !confirmDialog(`${chk.msg}\n\n그래도 새 컬럼으로 만들까요?`)) return false;
            const arr = CC.defs(baseCat.key, map);
            arr.push(CC.clean({ id: CC.newId(map), label, type, options, list: true, aliases: [], archived: false }));
            map[baseCat.key] = arr; commit(map); toast(`"${label}" 컬럼을 추가했습니다.`, 'success'); return true;
          }
          function patchDef(id, fn) { const map = CC.load(); map[baseCat.key] = CC.defs(baseCat.key, map).map((d) => (d.id === id ? CC.clean(fn({ ...d })) : d)); commit(map); }

          function paint() {
            host.innerHTML = '';
            const map = CC.load(); const act = CC.active(baseCat.key, map); const arch = CC.archived(baseCat.key, map);
            host.append(el('p', { class: 'text-muted', style: 'font-size:12px; margin:0 0 8px' }, `제출처마다 요구하는 항목이 달라서 직접 만드는 컬럼입니다(예: 학력의 소재지, 경력의 직위, 자격증의 등급). 이 항목에 최대 ${CC.MAX}개까지 추가되고, 등록·수정 폼, 목록, 검색, 양식 문서 매칭에 자동 반영됩니다. 기존 필드와 겹치는 이름은 새로 만들지 않고 기존 필드를 쓰도록 안내합니다.`));
            host.append(el('div', { style: 'font-size:13px; font-weight:600; margin:6px 0' }, `사용 중 ${act.length}/${CC.MAX}`));
            if (!act.length) host.append(el('div', { class: 'text-muted', style: 'font-size:12px; padding:6px 0' }, '아직 추가한 컬럼이 없습니다. 아래 추천에서 한 번에 추가하거나 직접 만드세요.'));
            for (const d of act) {
              const nameIn = el('input', { class: 'nm-input', value: d.label, maxlength: 20, style: 'flex:1; min-width:120px' });
              nameIn.addEventListener('change', async () => {
                if (!builtin) builtin = await builtinFor(baseCat);
                const v = nameIn.value.trim(); if (v === d.label) return;
                const chk = CC.checkLabel(baseCat.key, v, builtin, CC.load(), { ignoreId: d.id });
                if (chk.level === 'block') { toast(chk.msg, 'error'); nameIn.value = d.label; return; }
                if (chk.level === 'warn' && !confirmDialog(`${chk.msg}\n\n그래도 이 이름으로 바꿀까요?`)) { nameIn.value = d.label; return; }
                patchDef(d.id, (x) => { x.label = v; return x; }); // id는 그대로라 저장된 값·양식 매핑이 유지된다
              });
              const row = el('div', { class: 'nm-card', style: 'padding:8px; margin-bottom:6px' }, [
                el('div', { class: 'row', style: 'gap:6px; align-items:center; flex-wrap:wrap' }, [
                  nameIn,
                  el('span', { class: 'nm-badge', title: '날짜·숫자 종류는 만든 뒤 바꿀 수 없습니다(저장된 값 보호). 텍스트↔선택은 아래 목록 입력으로 전환됩니다' }, (CC.TYPES.find((t) => t[0] === d.type) || [])[1] || d.type),
                  el('label', { class: 'row', style: 'gap:4px; align-items:center; font-size:12px' }, [el('input', { type: 'checkbox', checked: d.list || undefined, onchange: (e) => patchDef(d.id, (x) => { x.list = e.target.checked; return x; }) }), '목록에 표시']),
                  el('span', { class: 'text-muted', style: 'font-size:11px' }, `값 입력 ${usage(d.id)}건`),
                  el('button', { class: 'nm-btn', style: 'padding:2px 8px; font-size:12px', title: '숨김 보관 — 데이터는 남고 화면·양식에서만 빠집니다', onclick: () => { if (confirmDialog(`"${d.label}" 컬럼을 숨김 보관할까요?\n입력한 값은 지우지 않고, 나중에 복원할 수 있습니다.`)) patchDef(d.id, (x) => { x.archived = true; return x; }); } }, '숨김 보관'),
                ]),
                (d.type === 'select' || d.type === 'text') ? el('div', { class: 'nm-field', style: 'margin:6px 0 0' }, [
                  el('label', { style: 'font-size:11px' }, d.type === 'select' ? '선택 목록 (쉼표로 구분 · 비우면 다시 자유 입력)' : '선택 목록으로 바꾸기 (쉼표로 구분 · 예: 사원, 대리, 과장) — 입력하면 등록 때 목록에서 고릅니다'),
                  el('input', { class: 'nm-input career-col-options', value: d.options.join(', '), placeholder: '사원, 대리, 과장, 차장, 부장', onchange: (e) => {
                    const next = CC.parseOptions(e.target.value);
                    const removed = d.options.filter((o) => !next.includes(o));
                    const used = removed.filter((o) => (appState.career[baseCat.key] || []).some((r) => r.extra && r.extra[d.id] === o));
                    if (used.length && !confirmDialog(`목록에서 뺀 값 중 이미 입력된 것이 있습니다: ${used.join(', ')}\n저장된 데이터는 지워지지 않고, 수정 화면에서 "목록에 없는 값"으로 표시됩니다. 계속할까요?`)) { e.target.value = d.options.join(', '); return; }
                    patchDef(d.id, (x) => { x.options = next; x.type = next.length ? 'select' : 'text'; return x; });
                  } }),
                  d.type === 'select' ? el('div', { class: 'text-muted', style: 'font-size:11px; margin-top:2px' }, `${d.options.length}개: ${d.options.join(' · ')}`) : null,
                ]) : null,
                el('div', { class: 'nm-field', style: 'margin:6px 0 0' }, [el('label', { style: 'font-size:11px' }, '양식 머리글 별칭 (쉼표로 구분 · 양식에서 다른 이름으로 불러도 자동 연결)'), el('input', { class: 'nm-input', value: d.aliases.join(', '), placeholder: '예: 학교소재지, 지역', onchange: (e) => patchDef(d.id, (x) => { x.aliases = e.target.value.split(/[,\n]/).map((v) => v.trim()).filter(Boolean); return x; }) })]),
              ]);
              host.append(row);
            }
            // 추가
            if (act.length < CC.MAX) {
              const nameIn = el('input', { class: 'nm-input', placeholder: '새 컬럼 이름 (예: 소재지)', maxlength: 20, style: 'flex:1; min-width:140px' });
              const typeSel = el('select', { class: 'nm-select', style: 'width:auto' }, CC.TYPES.map(([v, l]) => el('option', { value: v }, l)));
              const optIn = el('input', { class: 'nm-input career-newcol-options', placeholder: '선택 목록 (선택사항): 사원, 대리, 과장, 차장, 부장 — 입력하면 등록 때 목록에서 고릅니다', style: 'flex:1 1 100%' });
              const syncType = () => { if (CC.parseOptions(optIn.value).length && typeSel.value === 'text') typeSel.value = 'select'; };
              optIn.addEventListener('input', syncType);
              typeSel.addEventListener('change', () => { if (typeSel.value !== 'select' && typeSel.value !== 'text') optIn.value = ''; optIn.disabled = typeSel.value === 'date' || typeSel.value === 'number'; });
              const go = async () => {
                const opts = CC.parseOptions(optIn.value);
                let type = typeSel.value;
                if (opts.length && type === 'text') type = 'select';
                if (type === 'select' && !opts.length) { toast('"선택" 종류는 목록이 필요합니다. 쉼표로 구분해 입력해 주세요. (예: 사원, 대리, 과장)', 'error'); optIn.focus(); return; }
                const ok = await addColumn(nameIn.value, type, opts);
                if (ok) { nameIn.value = ''; optIn.value = ''; }
              };
              nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
              host.append(el('div', { style: 'font-size:13px; font-weight:600; margin:12px 0 4px' }, '새 컬럼 추가'), el('div', { class: 'row', style: 'gap:6px; flex-wrap:wrap' }, [nameIn, typeSel, el('button', { class: 'nm-btn nm-btn--primary', onclick: go }, '추가'), optIn]));
              const presets = (CC.PRESETS[baseCat.key] || []).filter(([l]) => !CC.defs(baseCat.key, map).some((d) => CC.norm(d.label) === CC.norm(l)));
              if (presets.length) host.append(el('div', { style: 'margin-top:8px' }, [el('span', { class: 'text-muted', style: 'font-size:11px' }, '추천(한 번에 추가): '), ...presets.map(([l, t, o]) => el('button', { class: 'nm-btn', style: 'padding:2px 10px; font-size:12px; margin:2px', onclick: () => addColumn(l, t, o || []) }, `+ ${l}`))]));
            } else host.append(el('div', { class: 'text-muted', style: 'font-size:12px; margin-top:10px' }, `최대 ${CC.MAX}개를 모두 사용 중입니다. 안 쓰는 컬럼을 숨김 보관하면 자리가 생깁니다.`));
            // 숨김 보관
            if (arch.length) {
              host.append(el('div', { style: 'font-size:13px; font-weight:600; margin:14px 0 4px' }, `숨김 보관 ${arch.length}개`));
              for (const d of arch) host.append(el('div', { class: 'row row--between', style: 'font-size:12px; padding:3px 0; align-items:center' }, [
                el('span', {}, `${d.label} · 값 ${usage(d.id)}건`),
                el('span', { class: 'row', style: 'gap:6px' }, [
                  el('button', { class: 'nm-btn', style: 'padding:2px 8px; font-size:12px', disabled: act.length >= CC.MAX || undefined, onclick: () => patchDef(d.id, (x) => { x.archived = false; return x; }) }, '복원'),
                  el('button', { class: 'nm-btn nm-btn--danger', style: 'padding:2px 8px; font-size:12px', onclick: async () => {
                    const n = usage(d.id);
                    if (!confirmDialog(`"${d.label}" 컬럼을 완전 삭제할까요?${n ? `\n입력된 값 ${n}건도 모두 지워지며 되돌릴 수 없습니다.` : ''}`)) return;
                    try { if (n) await appState.purgeCareerExtraKey(baseCat.key, d.id); const m = CC.load(); m[baseCat.key] = CC.defs(baseCat.key, m).filter((x) => x.id !== d.id); commit(m); toast('완전 삭제했습니다.', 'success'); } catch (e) { toast(`삭제 실패: ${e.message || e}`, 'error'); }
                  } }, '완전 삭제'),
                ]),
              ]));
            }
          }
          paint();
        },
      });
    }

    function openRecordForm(baseCat, existing) {
      const cat = effective(baseCat);
      openModal({
        title: existing ? `${cat.label} 수정` : `${cat.label} 추가`,
        contentBuilder(body, close) {
          const form = el('form', { class: 'stack' });
          const inputs = {};
          for (const f of cat.fields) {
            const input = buildFieldInput(f, existing);
            inputs[f.name] = input;
            const fieldKids = [el('label', {}, f.label), input];
            // 자동완성: 같은 사용자 컬럼에 전에 입력한 값을 후보로(텍스트형만)
            if (f.custom && f.type === 'text') {
              const seen = [...new Set((appState.career[cat.key] || []).map((r) => cv(r, f.name)).filter((v) => v !== '' && v != null).map(String))].slice(0, 30);
              if (seen.length) { const id = `dl-${cat.key}-${f.name}`; input.setAttribute('list', id); fieldKids.push(el('datalist', { id }, seen.map((v) => el('option', { value: v })))); }
            }
            form.append(el('div', { class: 'nm-field' }, fieldKids));
          }
          const submitBtn = el('button', { class: 'nm-btn nm-btn--primary', type: 'submit', style: 'width:100%' }, '저장');
          // v7.33.0: 저장 전에 처음부터 파일을 담아 둔다(저장하면 Supabase에 등록되고 담은 파일도 함께 첨부 — 저장 후 별도 첨부 단계 없음).
          const pendingHost = el('div', {});
          const pendingAttach = existing ? null : window.createPendingAttachments(pendingHost, tableOf(cat.key));
          if (pendingAttach) form.append(el('div', { class: 'nm-field' }, [el('label', {}, '파일 첨부 (선택)'), pendingHost]));
          form.append(submitBtn);
          // 신규 등록 직후 바로 파일을 첨부할 수 있도록(Knowledge/문화생활과 동일한 흐름),
          // 저장되면 폼 자리에 첨부 패널을 보여준다.
          const attachHost = el('div', {});
          body.append(form, attachHost);

          form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const data = {};
            const extraRaw = {};
            for (const f of cat.fields) {
              let v = inputs[f.name].value;
              if (f.custom) { extraRaw[f.def.id] = v; continue; } // 사용자 컬럼은 extra(jsonb)로 따로 저장
              if (f.type === 'number') v = v === '' ? null : Number(v);
              else v = v === '' ? null : v;
              data[f.name] = v;
            }
            if (cat.customFields && cat.customFields.length) data.extra = window.CareerCols.toExtra(cat.customFields.map((f) => f.def), extraRaw);
            try {
              if (existing) {
                await appState.updateCareerRecord(cat.key, existing.id, data);
                toast('저장했습니다.', 'success');
                close();
              } else {
                const row = await appState.addCareerRecord(cat.key, data);
                toast('등록했습니다.', 'success');
              const attachedN = pendingAttach ? await pendingAttach.flush(row.id) : 0;
              if (attachedN) toast(`첨부 ${attachedN}개도 함께 저장했습니다.`, 'success');
              close();
              }
            } catch (err) {
              toast(`저장에 실패했습니다: ${err.message || err}`, 'error');
            }
          });
        },
      });
    }

    draw();
    // 양식 문서 탭이 열려 있으면 그 화면이 스스로 갱신한다(자동 저장 때마다 입력 중인 칸의 포커스를 잃지 않게).
    const onChange = () => { if (activeCat === 'docs' && docsState === 'ready') return; draw(); };
    appState.addEventListener('change', onChange);
    return () => {
      appState.removeEventListener('change', onChange);
      if (docsApi) docsApi.destroy(); // 편집 중이던 변경은 조용히 임시저장
    };
  }

  window.renderCareer = renderCareer;
})();
