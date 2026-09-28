// Supabase 모드 스토어. localStore.js와 동일한 인터페이스를 구현해 app.js가
// 두 모드를 구분하지 않고 쓸 수 있게 한다.
// supabase-js는 CDN(ESM)에서 동적 import() 하므로, 'local' 모드에서는 네트워크 요청조차 나가지 않는다.
// 동적 import()는 이 파일 자체가 일반 <script>(비-모듈)여도 그대로 사용할 수 있다.
(function () {
  class SupabaseStore {
    constructor({ url, anonKey }) {
      if (!url || !anonKey) {
        throw new Error('Supabase 설정이 비어 있습니다. js/config.js의 supabaseUrl/supabaseAnonKey를 채워주세요.');
      }
      this._url = url;
      this._anonKey = anonKey;
      this._client = null;
      this._channels = new Map();
    }

    async _ensureClient() {
      if (this._client) return this._client;
      const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
      this._client = createClient(this._url, this._anonKey, {
        auth: { persistSession: true, autoRefreshToken: true },
      });
      return this._client;
    }

    // ---- Auth: 이메일/비밀번호 + 회원가입 + 관리자 승인(QMS 스타일) ----
    // profiles.approved/role은 마이그레이션 0011에서 추가된다. 승인 전에는 세션이 있어도
    // 앱 진입을 막고, 승인 대기 화면을 보여준다(로그인 자체는 Supabase Auth가 성공시킨 뒤 여기서 게이트).
    async _fetchProfile(userId) {
      const client = await this._ensureClient();
      const { data } = await client.from('profiles').select('*').eq('id', userId).maybeSingle();
      return data;
    }

    async getSession() {
      const client = await this._ensureClient();
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      if (!data.session) return null;
      const profile = await this._fetchProfile(data.session.user.id);
      if (!profile || profile.status !== 'approved') {
        return { user: data.session.user, mode: 'supabase', pending: true };
      }
      return { user: { ...data.session.user, name: profile.name, role: profile.role }, mode: 'supabase' };
    }

    // 첫 가입자는 즉시 승인+admin, 이후 가입자는 승인 대기(pending)로 등록된다.
    async signUp({ email, password, name }) {
      const client = await this._ensureClient();
      const { count } = await client.from('profiles').select('id', { count: 'exact', head: true });
      const isFirstUser = !count || count === 0;
      const { data, error } = await client.auth.signUp({ email, password, options: { data: { name } } });
      if (error) throw error;
      const userId = data.user?.id;
      if (userId) {
        await client.from('profiles').upsert({
          id: userId,
          email,
          name: name || email,
          role: isFirstUser ? 'admin' : 'user',
          status: isFirstUser ? 'approved' : 'pending',
        });
      }
      if (isFirstUser) return { pending: false, message: '첫 번째 계정은 관리자로 즉시 활성화됩니다.' };
      return { pending: true, message: '회원가입 신청이 접수되었습니다. 관리자 승인 후 로그인할 수 있습니다. (이메일 확인이 필요할 수 있습니다)' };
    }

    async signIn(email, password) {
      const client = await this._ensureClient();
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (error) throw new Error('아이디(이메일) 또는 비밀번호가 올바르지 않습니다.');
      const profile = await this._fetchProfile(data.user.id);
      if (!profile || profile.status === 'pending') {
        return { pending: true, message: '아직 관리자 승인 대기 중입니다. 승인 후 다시 로그인해 주세요.' };
      }
      if (profile.status === 'rejected') throw new Error('가입이 거절된 계정입니다. 관리자에게 문의해 주세요.');
      return { user: { ...data.user, name: profile.name, role: profile.role }, mode: 'supabase' };
    }

    async signOut() {
      const client = await this._ensureClient();
      await client.auth.signOut();
    }

    // 로그인된 상태에서 현재 비밀번호를 확인한 뒤 새 비밀번호로 바꾼다(설정 화면 "비밀번호 변경").
    // Supabase Auth의 updateUser는 그 자체로 현재 비밀번호를 요구하지 않으므로, 여기서는
    // signInWithPassword로 재인증해 현재 비밀번호가 맞는지 먼저 확인한다.
    async changePassword(currentPassword, newPassword) {
      const client = await this._ensureClient();
      const { data } = await client.auth.getSession();
      const email = data?.session?.user?.email;
      if (!email) throw new Error('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요.');
      const { error: reauthError } = await client.auth.signInWithPassword({ email, password: currentPassword });
      if (reauthError) throw new Error('현재 비밀번호가 올바르지 않습니다.');
      if (!newPassword || newPassword.length < 6) throw new Error('새 비밀번호는 6자 이상이어야 합니다.');
      const { error } = await client.auth.updateUser({ password: newPassword });
      if (error) throw error;
    }

    // 비밀번호를 잊은 경우 이메일로 재설정 링크를 보낸다(로그인 화면 "비밀번호를 잊으셨나요?").
    async sendPasswordReset(email) {
      const client = await this._ensureClient();
      const { error } = await client.auth.resetPasswordForEmail(email);
      if (error) throw error;
    }

    // ---- 관리자 승인 관리 (profiles.role === 'admin'인 사용자만 UI에서 노출됨) ----
    async listPendingUsers() {
      const client = await this._ensureClient();
      const { data, error } = await client.from('profiles').select('*').eq('status', 'pending');
      if (error) throw error;
      return data.map((p) => ({ id: p.id, username: p.email, name: p.name, status: p.status, created_at: p.created_at }));
    }
    async listAllUsers() {
      const client = await this._ensureClient();
      const { data, error } = await client.from('profiles').select('*');
      if (error) throw error;
      return data.map((p) => ({ id: p.id, username: p.email, name: p.name, role: p.role, status: p.status, created_at: p.created_at }));
    }
    async approveUser(userId) {
      const client = await this._ensureClient();
      const { error } = await client.from('profiles').update({ status: 'approved' }).eq('id', userId);
      if (error) throw error;
    }
    async rejectUser(userId) {
      const client = await this._ensureClient();
      const { error } = await client.from('profiles').update({ status: 'rejected' }).eq('id', userId);
      if (error) throw error;
    }

    async onAuthChange(cb) {
      const client = await this._ensureClient();
      const { data } = client.auth.onAuthStateChange((_event, session) => {
        cb(session ? { user: session.user, mode: 'supabase' } : null);
      });
      return () => data.subscription.unsubscribe();
    }

    // ---- 데이터 CRUD (RLS가 user_id를 강제하므로 여기서는 그대로 전달) ----
    async list(table, { where, orderBy, ascending = true } = {}) {
      const client = await this._ensureClient();
      let q = client.from(table).select('*').is('deleted_at', null);
      if (where) for (const [k, v] of Object.entries(where)) q = q.eq(k, v);
      if (orderBy) q = q.order(orderBy, { ascending });
      const { data, error } = await q;
      if (error) throw error;
      return data;
    }

    async get(table, id) {
      const client = await this._ensureClient();
      const { data, error } = await client.from(table).select('*').eq('id', id).maybeSingle();
      if (error) throw error;
      return data;
    }

    async create(table, obj) {
      const client = await this._ensureClient();
      const { data, error } = await client.from(table).insert(obj).select().single();
      if (error) throw error;
      return data;
    }

    async update(table, id, patch) {
      const client = await this._ensureClient();
      const { data, error } = await client.from(table).update(patch).eq('id', id).select().single();
      if (error) throw error;
      return data;
    }

    async softDelete(table, id) {
      return this.update(table, id, { deleted_at: new Date().toISOString() });
    }

    async remove(table, id) {
      const client = await this._ensureClient();
      const { error } = await client.from(table).delete().eq('id', id);
      if (error) throw error;
    }

    subscribe(table, cb) {
      // 비동기 초기화이므로 즉시 unsubscribe 함수를 반환할 수 있게 프라미스를 감싼다.
      let unsub = () => {};
      this._ensureClient().then((client) => {
        const channel = client
          .channel(`realtime:${table}`)
          .on('postgres_changes', { event: '*', schema: 'public', table }, () => {
            this.list(table).then(cb).catch(console.error);
          })
          .subscribe();
        this._channels.set(table, channel);
        unsub = () => client.removeChannel(channel);
      });
      return () => unsub();
    }
  }

  window.SupabaseStore = SupabaseStore;
})();
