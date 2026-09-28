// 로그인 화면. QMS 프로젝트와 동일한 레이아웃(.lo/.lo-card 등, css/modules/auth.css)에
// QMS처럼 아이디/비밀번호 로그인 + 회원가입 + 관리자 승인 흐름을 구현했다.
// - 로컬 모드: 아이디는 자유 문자열, 비밀번호는 브라우저 내 해시(js/store/localStore.js)로 저장.
// - Supabase 모드: 아이디 칸에 이메일을 입력받아 Supabase Auth(이메일/비밀번호)로 처리.
// 첫 번째로 가입하는 사람은 즉시 관리자로 활성화되고, 이후 가입자는 관리자 승인이 있어야 로그인할 수 있다.
// 일반 <script>로 로드되며 js/store/index.js, js/config.js, js/utils/dom.js가 먼저 로드되어야 한다.
(function () {
  const { el, toast } = window;

  function renderAuthScreen(root, onSignedIn) {
    const store = window.getStore();
    const CONFIG = window.CONFIG;
    root.innerHTML = '';
    root.className = 'lo';

    const isLocal = CONFIG.mode === 'local';
    const idLabel = isLocal ? '아이디' : '이메일(아이디)';
    let tab = 'login'; // login | signup | pendingNotice

    const card = el('div', { class: 'lo-card' }, [
      el('div', { class: 'lo-card-top' }, [
        el('div', { class: 'lo-def-wrap' }, [
          el('div', { class: 'lo-mark' }, '⌂'),
          el('div', {}, [
            el('div', { class: 'lo-sys-name' }, '나만의 Work Space'),
            el('div', { class: 'lo-sys-sub' }, `일정·프로젝트·프로그램 통합 대시보드 · ${CONFIG.version}`),
          ]),
        ]),
      ]),
    ]);
    const body = el('div', { class: 'lo-card-body' });
    card.append(body, el('div', { class: 'lo-footer' }, `나만의 Work Space · ${CONFIG.version} · 현재 모드: ${isLocal ? '로컬(local)' : 'Supabase'}`));
    root.append(card);

    drawTab();

    function drawTab() {
      body.innerHTML = '';
      body.append(
        el('div', { class: 'lo-tabs' }, [
          tabBtn('login', '로그인'),
          tabBtn('signup', '회원가입'),
        ])
      );
      if (tab === 'login') body.append(buildLoginPanel());
      else if (tab === 'signup') body.append(buildSignupPanel());
      else body.append(buildPendingPanel());
    }

    function tabBtn(key, label) {
      const active = tab === key;
      return el(
        'button',
        {
          type: 'button',
          class: `lo-tab ${active ? 'lo-tab--active' : ''}`,
          onclick: () => { tab = key; drawTab(); },
        },
        label
      );
    }

    function buildLoginPanel() {
      const idInput = el('input', { type: isLocal ? 'text' : 'email', name: 'username', placeholder: isLocal ? '아이디' : 'you@example.com', required: true, autofocus: true, autocomplete: 'username' });
      const pwInput = el('input', { type: 'password', name: 'password', placeholder: '비밀번호', required: true, autocomplete: 'current-password' });
      const errMsg = el('div', { class: 'lo-errmsg', id: 'errLogin' });
      const submitBtn = el('button', { class: 'lo-btn', type: 'submit' }, '로그인');

      const form = el('form', { class: 'lo-panel on' }, [
        el('div', { class: 'lfg' }, [el('label', {}, idLabel), el('div', { class: 'lo-input-wrap' }, [idInput])]),
        el('div', { class: 'lfg' }, [el('label', {}, '비밀번호'), el('div', { class: 'lo-input-wrap' }, [pwInput]), errMsg]),
        submitBtn,
      ]);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errMsg.classList.remove('show');
        idInput.classList.remove('err');
        pwInput.classList.remove('err');
        submitBtn.disabled = true;
        submitBtn.textContent = '로그인 중…';
        try {
          const result = await store.signIn(idInput.value, pwInput.value);
          if (result?.pending) {
            toast(result.message, 'error');
            errMsg.textContent = result.message;
            errMsg.classList.add('show');
            submitBtn.disabled = false;
            submitBtn.textContent = '로그인';
            return;
          }
          onSignedIn(result.user);
        } catch (err) {
          idInput.classList.add('err');
          pwInput.classList.add('err');
          errMsg.textContent = err.message || '로그인에 실패했습니다.';
          errMsg.classList.add('show');
          toast(err.message || '로그인에 실패했습니다.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = '로그인';
        }
      });

      return el('div', {}, [
        form,
        el('button', { type: 'button', class: 'lo-forgot-link', onclick: () => forgotPassword(idInput.value) }, '비밀번호를 잊으셨나요?'),
        el('div', { class: 'lo-hint' },
          isLocal
            ? '로컬 데모 모드 — 이 브라우저에만 데이터가 저장됩니다. 첫 회원가입자는 즉시 관리자로 활성화되고, 이후 가입자는 관리자 승인이 필요합니다.'
            : 'Supabase 계정(이메일/비밀번호)으로 로그인합니다. 첫 가입자는 즉시 관리자로 활성화되고, 이후 가입자는 관리자 승인이 필요합니다.'
        ),
      ]);
    }

    async function forgotPassword(prefill) {
      if (isLocal) {
        toast('로컬 모드에서는 이메일 발송이 불가능합니다. 관리자에게 요청하면 설정 화면의 "사용자 관리"에서 비밀번호를 재설정해 줄 수 있습니다.', 'info');
        return;
      }
      const email = prefill && prefill.includes('@') ? prefill : window.prompt('가입 시 사용한 이메일을 입력해 주세요.');
      if (!email) return;
      try {
        await store.sendPasswordReset(email);
        toast('비밀번호 재설정 메일을 보냈습니다. 메일함을 확인해 주세요.', 'success');
      } catch (err) {
        toast(err.message || '재설정 메일 발송에 실패했습니다.', 'error');
      }
    }

    function buildSignupPanel() {
      const idInput = el('input', { type: isLocal ? 'text' : 'email', name: 'username', placeholder: isLocal ? '사용할 아이디' : 'you@example.com', required: true, autofocus: true, autocomplete: 'username' });
      const nameInput = el('input', { type: 'text', name: 'name', placeholder: '이름(선택)', autocomplete: 'name' });
      const pwInput = el('input', { type: 'password', name: 'password', placeholder: '비밀번호(4자 이상)', required: true, minlength: '4', autocomplete: 'new-password' });
      const pwConfirmInput = el('input', { type: 'password', name: 'passwordConfirm', placeholder: '비밀번호 확인', required: true, autocomplete: 'new-password' });
      const errMsg = el('div', { class: 'lo-errmsg', id: 'errSignup' });
      const submitBtn = el('button', { class: 'lo-btn', type: 'submit' }, '회원가입');

      const form = el('form', { class: 'lo-panel on' }, [
        el('div', { class: 'lfg' }, [el('label', {}, idLabel), el('div', { class: 'lo-input-wrap' }, [idInput])]),
        el('div', { class: 'lfg' }, [el('label', {}, '이름(선택)'), el('div', { class: 'lo-input-wrap' }, [nameInput])]),
        el('div', { class: 'lfg' }, [el('label', {}, '비밀번호'), el('div', { class: 'lo-input-wrap' }, [pwInput])]),
        el('div', { class: 'lfg' }, [el('label', {}, '비밀번호 확인'), el('div', { class: 'lo-input-wrap' }, [pwConfirmInput]), errMsg]),
        submitBtn,
      ]);

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errMsg.classList.remove('show');
        if (pwInput.value !== pwConfirmInput.value) {
          errMsg.textContent = '비밀번호가 일치하지 않습니다.';
          errMsg.classList.add('show');
          return;
        }
        submitBtn.disabled = true;
        submitBtn.textContent = '처리 중…';
        try {
          const result = isLocal
            ? await store.signUp({ username: idInput.value, password: pwInput.value, name: nameInput.value })
            : await store.signUp({ email: idInput.value, password: pwInput.value, name: nameInput.value });
          toast(result.message, 'success');
          tab = 'pendingNotice';
          pendingNoticeMessage = result.message;
          drawTab();
        } catch (err) {
          errMsg.textContent = err.message || '회원가입에 실패했습니다.';
          errMsg.classList.add('show');
          toast(err.message || '회원가입에 실패했습니다.', 'error');
          submitBtn.disabled = false;
          submitBtn.textContent = '회원가입';
        }
      });

      return el('div', {}, [
        form,
        el('div', { class: 'lo-hint' }, '가입 후 관리자(맨 처음 가입한 계정)가 설정 화면에서 승인해야 로그인할 수 있습니다.'),
      ]);
    }

    let pendingNoticeMessage = '';
    function buildPendingPanel() {
      return el('div', { class: 'lo-panel on', style: 'text-align:center; padding:16px 0' }, [
        el('div', { style: 'font-size:36px; margin-bottom:12px' }, '⏳'),
        el('div', { style: 'font-weight:700; margin-bottom:8px' }, '가입 신청이 접수되었습니다'),
        el('div', { style: 'color:var(--lo-tm); font-size:13px; margin-bottom:20px' }, pendingNoticeMessage),
        el('button', { class: 'lo-btn', type: 'button', onclick: () => { tab = 'login'; drawTab(); } }, '로그인 화면으로'),
      ]);
    }
  }

  window.renderAuthScreen = renderAuthScreen;
})();
