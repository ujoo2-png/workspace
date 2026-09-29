// 로컬 모드 스토어: localStorage 기반. Supabase 스토어와 동일한 인터페이스를 구현한다.
// 실제 배포 전 오프라인 데모, 그리고 이 앱의 로직(예측·자동화·화면)을 설정 없이 검증하는 용도.
// 일반 <script>로 로드되며 js/utils/id.js가 먼저 로드되어 window.uid가 있어야 한다.
(function () {
  const { uid } = window;

  const KEY = 'workspace:v1';
  const AUTH_KEY = 'workspace:auth:v1';
  // "로그인 상태 유지"를 체크하지 않으면 세션을 sessionStorage에만 저장한다 — 탭/브라우저를
  // 닫으면 사라지고, 다음 접속 시 로그인 화면부터 다시 보이게 하기 위함. 체크하면 기존처럼
  // localStorage에 저장해 브라우저를 껐다 켜도 로그인 상태가 유지된다. REMEMBER_KEY 자체는
  // 세션 데이터가 아니라 "어느 저장소를 볼지"를 가리키는 값이라 localStorage에 둬도 무방하다.
  const REMEMBER_KEY = 'workspace:auth:remember';

  // 이전 버전(로그인 기능 추가 전 등)에 저장된 데이터에는 users처럼 나중에 추가된 배열이
  // 아예 없을 수 있다. 그 상태로 불러오면 this.db.users.find(...)에서 "Cannot read
  // properties of undefined" 오류가 나므로, 기본값과 병합해 누락된 키를 항상 채워준다.
  function defaultDb() {
    return {
      profiles: [],
      users: [], // 아이디/비밀번호 계정 + 승인 상태 (QMS 스타일 회원가입·승인)
      schedules: [],
      projects: [],
      project_progress: [],
      programs: [],
      notifications: [],
      automation_logs: [],
      attachments: [],
      vehicle_odometer_logs: [],
    };
  }

  function loadDb() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const merged = { ...defaultDb(), ...parsed };
        // 병합 결과를 바로 저장해두면 다음부터는 매번 병합할 필요가 없다.
        if (Object.keys(merged).some((k) => !(k in parsed))) saveDb(merged);
        return merged;
      }
    } catch (e) {
      console.warn('로컬 데이터 로드 실패, 초기화합니다.', e);
    }
    return defaultDb();
  }

  function saveDb(db) {
    localStorage.setItem(KEY, JSON.stringify(db));
    // 같은 브라우저의 다른 탭에도 즉시 반영되도록 storage 이벤트를 활용(브라우저가 자동 발생시킴)
  }

  // 비밀번호는 평문으로 저장하지 않는다. 브라우저 내 데모용 해시(SHA-256 + 사용자별 salt)이며,
  // 실서비스 보안 수준이 필요하면 Supabase 모드(js/config.js CONFIG.mode)로 전환해 Supabase Auth의
  // 서버측 비밀번호 해싱을 쓴다.
  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const data = enc.encode(`${salt}:${password}`);
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  function randomSalt() {
    return Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  // 관리자 화면에 사용자 목록을 보여줄 때 비밀번호 해시/salt는 절대 내보내지 않는다.
  function stripSecrets(u) {
    const { passwordHash, salt, ...rest } = u;
    return rest;
  }

  class LocalStore {
    constructor() {
      this.db = loadDb();
      this._listeners = new Map(); // table -> Set<cb>
      this._authListeners = new Set();
      window.addEventListener('storage', (e) => {
        if (e.key === KEY) {
          this.db = loadDb();
          for (const [table, cbs] of this._listeners) {
            for (const cb of cbs) cb(this._table(table));
          }
        }
      });
    }

    // ---- Auth: 아이디/비밀번호 + 회원가입 + 관리자 승인(QMS 스타일) ----
    async getSession() {
      try {
        const remember = localStorage.getItem(REMEMBER_KEY) === '1';
        const raw = (remember ? localStorage : sessionStorage).getItem(AUTH_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    }

    // 첫 번째 가입자는 승인 없이 즉시 admin으로 활성화된다(개인 워크스페이스이므로 최초 1명은
    // 스스로를 승인할 관리자가 없기 때문). 이후 가입자는 status:'pending'으로 대기하며,
    // admin이 approveUser/rejectUser로 처리해야 로그인할 수 있다.
    async signUp({ username, password, name }) {
      const id = (username || '').trim();
      if (!id) throw new Error('아이디를 입력해 주세요.');
      if (!password || password.length < 4) throw new Error('비밀번호는 4자 이상이어야 합니다.');
      if (this.db.users.find((u) => u.username.toLowerCase() === id.toLowerCase())) {
        throw new Error('이미 사용 중인 아이디입니다.');
      }
      const isFirstUser = this.db.users.length === 0;
      const salt = randomSalt();
      const passwordHash = await hashPassword(password, salt);
      const user = {
        id: uid(),
        username: id,
        name: name || id,
        passwordHash,
        salt,
        role: isFirstUser ? 'admin' : 'user',
        status: isFirstUser ? 'approved' : 'pending',
        created_at: new Date().toISOString(),
      };
      this.db.users.push(user);
      saveDb(this.db);
      if (isFirstUser) {
        return { pending: false, message: '첫 번째 계정은 관리자로 즉시 활성화됩니다.' };
      }
      return { pending: true, message: '회원가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다.' };
    }

    async signIn(username, password, remember = false) {
      const id = (username || '').trim();
      if (!id || !password) throw new Error('아이디와 비밀번호를 입력해 주세요.');
      const user = this.db.users.find((u) => u.username.toLowerCase() === id.toLowerCase());
      if (!user) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
      const hash = await hashPassword(password, user.salt);
      if (hash !== user.passwordHash) throw new Error('아이디 또는 비밀번호가 올바르지 않습니다.');
      if (user.status === 'pending') throw new Error('아직 관리자 승인 대기 중입니다. 승인 후 다시 로그인해 주세요.');
      if (user.status === 'rejected') throw new Error('가입이 거절된 계정입니다. 관리자에게 문의해 주세요.');

      const sessionUser = { id: user.id, email: user.username, name: user.name, role: user.role };
      const session = { user: sessionUser, mode: 'local' };
      localStorage.setItem(REMEMBER_KEY, remember ? '1' : '0');
      (remember ? localStorage : sessionStorage).setItem(AUTH_KEY, JSON.stringify(session));
      // 이전에 반대 방식으로 저장된 세션이 남아있지 않도록 정리한다.
      (remember ? sessionStorage : localStorage).removeItem(AUTH_KEY);
      if (!this.db.profiles.find((p) => p.id === user.id)) {
        this.db.profiles.push({ id: user.id, email: user.username, created_at: new Date().toISOString() });
        saveDb(this.db);
      }
      this._authListeners.forEach((cb) => cb(session));
      return session;
    }

    async signOut() {
      localStorage.removeItem(AUTH_KEY);
      sessionStorage.removeItem(AUTH_KEY);
      this._authListeners.forEach((cb) => cb(null));
    }

    // ---- 관리자 승인 관리 (role:'admin'인 사용자만 UI에서 노출됨) ----
    async listPendingUsers() {
      return this.db.users.filter((u) => u.status === 'pending').map(stripSecrets);
    }
    async listAllUsers() {
      return this.db.users.map(stripSecrets);
    }
    async approveUser(userId) {
      const u = this.db.users.find((u) => u.id === userId);
      if (!u) throw new Error('사용자를 찾을 수 없습니다.');
      u.status = 'approved';
      saveDb(this.db);
    }
    async rejectUser(userId) {
      const u = this.db.users.find((u) => u.id === userId);
      if (!u) throw new Error('사용자를 찾을 수 없습니다.');
      u.status = 'rejected';
      saveDb(this.db);
    }

    // 본인이 현재 비밀번호를 알고 있는 상태에서 바꾸는 경우(설정 화면 "비밀번호 변경").
    async changePassword(userId, currentPassword, newPassword) {
      const user = this.db.users.find((u) => u.id === userId);
      if (!user) throw new Error('사용자를 찾을 수 없습니다.');
      const hash = await hashPassword(currentPassword, user.salt);
      if (hash !== user.passwordHash) throw new Error('현재 비밀번호가 올바르지 않습니다.');
      if (!newPassword || newPassword.length < 4) throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
      const salt = randomSalt();
      user.passwordHash = await hashPassword(newPassword, salt);
      user.salt = salt;
      saveDb(this.db);
    }

    // 비밀번호를 잊어버린 사용자를 위해 관리자가 새 비밀번호로 강제 재설정한다(로컬 모드 전용 —
    // Supabase 모드는 service_role 키가 있는 서버에서만 가능한 관리자 API라 클라이언트에서 지원하지 않는다).
    async adminResetPassword(userId, newPassword) {
      const user = this.db.users.find((u) => u.id === userId);
      if (!user) throw new Error('사용자를 찾을 수 없습니다.');
      if (!newPassword || newPassword.length < 4) throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
      const salt = randomSalt();
      user.passwordHash = await hashPassword(newPassword, salt);
      user.salt = salt;
      saveDb(this.db);
    }

    onAuthChange(cb) {
      this._authListeners.add(cb);
      return () => this._authListeners.delete(cb);
    }

    // ---- 데이터 CRUD ----
    _table(name) {
      if (!this.db[name]) this.db[name] = [];
      return this.db[name];
    }

    async list(table, { where, orderBy, ascending = true } = {}) {
      let rows = this._table(table).filter((r) => !r.deleted_at);
      if (where) {
        rows = rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
      }
      if (orderBy) {
        rows = rows.slice().sort((a, b) => {
          if (a[orderBy] === b[orderBy]) return 0;
          const cmp = a[orderBy] < b[orderBy] ? -1 : 1;
          return ascending ? cmp : -cmp;
        });
      }
      return rows;
    }

    async get(table, id) {
      return this._table(table).find((r) => r.id === id) || null;
    }

    async create(table, obj) {
      const row = { id: uid(), created_at: new Date().toISOString(), ...obj };
      this._table(table).push(row);
      saveDb(this.db);
      this._emit(table);
      return row;
    }

    async update(table, id, patch) {
      const rows = this._table(table);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx === -1) throw new Error('레코드를 찾을 수 없습니다: ' + id);
      rows[idx] = { ...rows[idx], ...patch, updated_at: new Date().toISOString() };
      saveDb(this.db);
      this._emit(table);
      return rows[idx];
    }

    async softDelete(table, id) {
      return this.update(table, id, { deleted_at: new Date().toISOString() });
    }

    async remove(table, id) {
      const rows = this._table(table);
      const idx = rows.findIndex((r) => r.id === id);
      if (idx !== -1) rows.splice(idx, 1);
      saveDb(this.db);
      this._emit(table);
    }

    subscribe(table, cb) {
      if (!this._listeners.has(table)) this._listeners.set(table, new Set());
      this._listeners.get(table).add(cb);
      return () => this._listeners.get(table)?.delete(cb);
    }

    _emit(table) {
      // 같은 탭 안에서는 storage 이벤트가 발생하지 않으므로 직접 호출
      const cbs = this._listeners.get(table);
      if (cbs) cbs.forEach((cb) => cb(this._table(table)));
    }
  }

  window.LocalStore = LocalStore;
})();
