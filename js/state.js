// 아주 작은 중앙 상태 저장소. 프레임워크 없이 pub/sub만으로 화면 갱신을 구동한다.
// 일반 <script>로 로드되며 js/store/index.js가 먼저 로드되어 window.getStore가 있어야 한다.
(function () {
  // 이력/경력 관리 7개 카테고리 — key(상태 필드명) -> 실제 테이블명.
  // 7개 테이블 모두 user_id/sort_order/deleted_at 구조가 동일해(0020 마이그레이션),
  // addCareerRecord 등 공통 메서드 하나로 CRUD를 처리할 수 있다.
  const CAREER_TABLES = {
    education: 'career_education',
    certifications: 'career_certifications',
    trainings: 'career_trainings',
    memberships: 'career_memberships',
    awards: 'career_awards',
    experiences: 'career_experiences',
    photos: 'career_photos',
  };
  window.CAREER_TABLES = CAREER_TABLES;

  // v7.19.0 — 쓰기 후 "해당 테이블만" 다시 읽기 위한 설정(refreshAll은 20여 개 테이블을 전부 다시 읽어 느렸다).
  // field: AppState의 필드명, opts: store.list 옵션, cmp: 화면에서 쓰는 정렬(낙관적 삽입 후 순서 유지).
  const byStr = (key, dir = 1) => (a, b) => dir * String(a[key] || '').localeCompare(String(b[key] || ''));
  const TABLE_STATE = {
    health_metrics: { field: 'healthMetrics', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'recorded_at', ascending: false }), cmp: byStr('recorded_at', -1) },
    health_appointments: { field: 'healthAppointments', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'appointment_date' }), cmp: byStr('appointment_date') },
    health_medications: { field: 'healthMedications', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'sort_order' }), cmp: (a, b) => (a.sort_order || 0) - (b.sort_order || 0) },
    health_med_logs: { field: 'healthMedLogs', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'taken_date', ascending: false }), cmp: byStr('taken_date', -1) },
    schedules: { field: 'schedules', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'date' }), cmp: byStr('date') },
    // v7.20.0 — 프로젝트 WBS 항목 / 챌린지 체크인 / D-day. 화면은 묶음(projectStagesByProject, checkinsByChallenge)을 쓰므로 derive로 다시 만든다.
    project_stages: {
      field: 'projectStages', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'seq' }), cmp: (a, b) => (a.seq || 0) - (b.seq || 0),
      derive: (st) => { st.projectStagesByProject = st._groupBy(st.projectStages, 'project_id'); },
    },
    challenge_checkins: {
      field: 'challengeCheckins', opts: () => ({}), cmp: byStr('checkin_date', -1),
      derive: (st) => { st.checkinsByChallenge = st._groupBy(st.challengeCheckins, 'challenge_id'); },
    },
    ddays: { field: 'ddays', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'target_date' }), cmp: byStr('target_date') },
    // v7.22.0 — 이력/경력 양식 문서(수정일 최신순)와 기본 인적사항(사용자당 1행; careerBasic으로 파생)
    career_documents: { field: 'careerDocuments', opts: (uid) => ({ where: { user_id: uid }, orderBy: 'updated_at', ascending: false }), cmp: (a, b) => String(b.updated_at || b.created_at || '').localeCompare(String(a.updated_at || a.created_at || '')) },
    career_basic_info: {
      field: 'careerBasicRows', opts: (uid) => ({ where: { user_id: uid } }), cmp: null,
      derive: (st) => { st.careerBasic = st.careerBasicRows[0] || null; },
    },
  };
  // 일정의 v7.20.0(0024) 신규 컬럼 — 마이그레이션 전 DB에서도 기존 저장이 깨지지 않게 폴백할 때 쓴다.
  const SCHEDULE_NEW_COLS = ['place', 'category', 'repeat_offsets', 'parent_schedule_id', 'offset_days', 'is_generated'];
  const STAGE_NEW_COLS = ['parent_id', 'progress', 'is_milestone', 'depends_on', 'baseline_start', 'baseline_end', 'legacy_group', 'memo'];
  const CHALLENGE_NEW_COLS = ['freq_type', 'freq_days', 'freq_times'];
  const MIGRATION_0025_HINT = '0025 마이그레이션(supabase/combined/all_migrations_0001_to_0025.sql)을 Supabase SQL Editor에서 실행해 주세요.';
  const MIGRATION_0024_HINT = '0024 마이그레이션(supabase/combined/all_migrations_0001_to_0025.sql)을 Supabase SQL Editor에서 실행해 주세요.';
  // 첨부 목록용 메타 컬럼(본문 data 제외) + 본문 메모리 캐시 상한(LRU)
  const ATTACH_META_COLS = 'id,user_id,owner_table,owner_id,name,mime_type,size,created_at';
  const ATTACH_CACHE_MAX_CHARS = 60 * 1024 * 1024;
  // 아직 서버에 저장되지 않은 낙관적 임시 행의 id 접두어
  const TMP_PREFIX = 'tmp-';

  class AppState extends EventTarget {
    constructor() {
      super();
      this.store = window.getStore();
      this.user = null;
      this.schedules = [];
      this.projects = [];
      this.programs = [];
      this.notifications = [];
      this.progressByProject = {}; // projectId -> [{progress, recorded_at}]

      // 즐겨찾기 URL(바로가기)
      this.bookmarks = [];

      // 챌린저
      this.challenges = [];
      this.checkinsByChallenge = {}; // challengeId -> [{checkin_date, value, memo}]

      // 차량관리
      this.vehicles = [];
      this.maintenanceByVehicle = {}; // vehicleId -> [row]
      this.fuelLogsByVehicle = {}; // vehicleId -> [row]
      this.odometerLogsByVehicle = {}; // vehicleId -> [row]

      // Health
      this.healthMetrics = [];
      this.healthAppointments = [];
      this.healthMedications = []; // 내복약 정보(0023)
      this.healthMedLogs = []; // 복용 체크 기록(0023)

      // 낙관적 갱신 + 대상 테이블만 재조회(v7.19.0)
      this._wseq = {}; // table -> 쓰기 횟수(재조회 중에 쓰기가 끼어들면 그 결과를 버리기 위한 표식)
      this._reconcileTimers = {}; // table -> setTimeout id
      this._inflight = new Set(); // 진행 중인 재조회 Promise
      this._linkPromises = new Map(); // 병원 일정 id -> 일정 메뉴 연동 Promise

      // 내 정보(설정 화면에서 입력하는 나이/혈액형 등 — 나이대별 건강 제안에 사용)
      this.profile = null;

      // 문화생활(PlayList)
      this.playlistItems = [];

      // 관심주제 브리핑
      this.briefingTopics = [];
      this.feedSources = [];
      this.briefingItems = [];

      // Knowledge
      this.knowledgeDocs = [];

      // Automation (사용자별 규칙 on/off·파라미터, 실행 로그)
      this.automationRules = [];
      this.automationLogs = [];

      // Integrations (실제 OAuth 연동 전 — 연결 상태 자리만)
      this.integrations = [];

      // Devlog (개발/개선 기록 — 프로젝트 연계)
      this.devlogs = [];

      // 프로젝트 진척(간트차트): 프로젝트를 단계로 쪼갠 항목별 시작일/목표일
      this.projectStagesByProject = {};
      this.projectStages = []; // v7.20.0: 평평한 목록(트리는 WBS.buildTree로 만든다). projectStagesByProject는 여기서 파생된다.
      this.challengeCheckins = []; // v7.20.0: 평평한 목록. checkinsByChallenge는 여기서 파생된다.
      this.ddays = []; // v7.20.0: D-day(최대 5개)

      // 파일 첨부(모든 메뉴 공통): key = `${owner_table}:${owner_id}` -> [row]
      this.attachmentsByOwner = {};

      // 이력/경력 관리 (7개 카테고리) — 테이블 구조가 모두 동일(사용자 소유 + sort_order +
      // 소프트삭제)하므로 CAREER_TABLES 설정 하나로 상태 보관과 CRUD를 공통 처리한다.
      this.career = {};
      for (const key of Object.keys(CAREER_TABLES)) this.career[key] = [];
      // v7.22.0: 양식 문서 목록 / 기본 인적사항(1행) — 0025 마이그레이션 전에는 빈 값
      this.careerDocuments = [];
      this.careerBasicRows = [];
      this.careerBasic = null;
    }

    emit(name, detail) {
      this.dispatchEvent(new CustomEvent(name, { detail }));
    }

    async refreshAll() {
      const uid = this.user.id;
      const [
        schedules,
        projects,
        programs,
        notifications,
        progress,
        challenges,
        challengeCheckins,
        vehicles,
        vehicleMaintenance,
        vehicleFuelLogs,
        vehicleOdometerLogs,
        healthMetrics,
        healthAppointments,
        healthMedications,
        healthMedLogs,
        playlistItems,
        briefingTopics,
        feedSources,
        briefingItems,
        knowledgeDocs,
        automationRules,
        automationLogs,
        integrations,
        devlogs,
        projectStages,
        attachments,
        profile,
        bookmarks,
        careerLists,
        ddayRows,
        careerDocRows,
        careerBasicRows,
        // 기기 간 설정 동기화(원격 우선 pull). 실패해도 던지지 않으며(settingsSync가 내부에서 폴백),
        // 다른 조회와 병렬이라 첫 화면을 추가로 지연시키지 않는다.
        // 적용된 값은 아래 emit('change') 이전에 localStorage 캐시에 반영된다.
        settingsResult,
      ] = await Promise.all([
        this.store.list('schedules', { where: { user_id: uid }, orderBy: 'date' }).catch(() => []),
        this.store.list('projects', { where: { user_id: uid }, orderBy: 'created_at' }).catch(() => []),
        this.store.list('programs', { where: { user_id: uid }, orderBy: 'run_count', ascending: false }).catch(() => []),
        this.store.list('notifications', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.list('project_progress').catch(() => []),
        this.store.list('challenges', { where: { user_id: uid }, orderBy: 'created_at' }).catch(() => []),
        this.store.list('challenge_checkins').catch(() => []),
        this.store.list('vehicles', { where: { user_id: uid }, orderBy: 'created_at' }).catch(() => []),
        this.store.list('vehicle_maintenance').catch(() => []),
        this.store.list('vehicle_fuel_logs').catch(() => []),
        this.store.list('vehicle_odometer_logs').catch(() => []),
        this.store.list('health_metrics', { where: { user_id: uid }, orderBy: 'recorded_at', ascending: false }).catch(() => []),
        this.store.list('health_appointments', { where: { user_id: uid }, orderBy: 'appointment_date' }).catch(() => []),
        // 0023 미실행(테이블 없음)이어도 빈 목록으로 폴백한다.
        this.store.list('health_medications', TABLE_STATE.health_medications.opts(uid)).catch(() => []),
        this.store.list('health_med_logs', TABLE_STATE.health_med_logs.opts(uid)).catch(() => []),
        this.store.list('playlist_items', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.list('briefing_topics', { where: { user_id: uid }, orderBy: 'created_at' }).catch(() => []),
        this.store.list('feed_sources', { where: { user_id: uid }, orderBy: 'created_at' }).catch(() => []),
        this.store.list('briefing_items', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.list('knowledge_docs', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.list('automation_rules', { where: { user_id: uid } }).catch(() => []),
        this.store.list('automation_logs', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.list('integrations', { where: { user_id: uid } }).catch(() => []),
        this.store.list('devlogs', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.list('project_stages', { where: { user_id: uid }, orderBy: 'seq' }).catch(() => []),
        // v7.21.0: 첨부는 "메타데이터만" 읽는다(id/이름/종류/크기). base64 본문(data)은 최대 10MB(→13MB 문자열)라
        // 전부 내려받으면 페이지를 열 때마다 수십 MB가 오간다 — 본문은 미리보기/다운로드 시점에 getAttachmentData()로 가져온다.
        this.store.list('attachments', { where: { user_id: uid }, orderBy: 'created_at', ascending: false, columns: ATTACH_META_COLS }).catch(() => []),
        this.store.get('profiles', uid).catch(() => null),
        this.store.list('bookmarks', { where: { user_id: uid }, orderBy: 'sort_order' }).catch(() => []),
        Promise.all(
          Object.values(CAREER_TABLES).map((table) =>
            this.store.list(table, { where: { user_id: uid }, orderBy: 'sort_order' }).catch(() => [])
          )
        ),
        // 0024 미실행(테이블 없음)이어도 빈 목록으로 폴백한다.
        this.store.list('ddays', TABLE_STATE.ddays.opts(uid)).catch(() => []),
        // 0025 미실행(테이블 없음)이어도 빈 목록으로 폴백한다.
        this.store.list('career_documents', TABLE_STATE.career_documents.opts(uid)).catch(() => []),
        this.store.list('career_basic_info', TABLE_STATE.career_basic_info.opts(uid)).catch(() => []),
        window.settingsSync.load(uid).catch(() => ({ changed: [] })),
      ]);

      this.schedules = schedules;
      this.projects = this._attachProjectMeta(projects, progress);
      this.programs = programs;
      this.notifications = notifications;
      this.progressByProject = this._groupProgress(progress);

      this.challenges = challenges;
      this.challengeCheckins = challengeCheckins;
      this.checkinsByChallenge = this._groupBy(challengeCheckins, 'challenge_id');

      this.vehicles = vehicles;
      this.maintenanceByVehicle = this._groupBy(vehicleMaintenance, 'vehicle_id');
      this.fuelLogsByVehicle = this._groupBy(vehicleFuelLogs, 'vehicle_id');
      this.odometerLogsByVehicle = this._groupBy(vehicleOdometerLogs, 'vehicle_id');

      this.healthMetrics = healthMetrics;
      this.healthAppointments = healthAppointments;
      this.healthMedications = healthMedications;
      this.healthMedLogs = healthMedLogs;
      this.profile = profile;
      this.bookmarks = bookmarks;

      Object.keys(CAREER_TABLES).forEach((key, idx) => { this.career[key] = careerLists[idx]; });

      this.playlistItems = playlistItems;

      this.briefingTopics = briefingTopics;
      this.feedSources = feedSources;
      this.briefingItems = briefingItems;

      this.knowledgeDocs = knowledgeDocs;
      this.automationRules = automationRules;
      this.automationLogs = automationLogs;
      this.integrations = integrations;
      this.devlogs = devlogs;
      this.projectStages = projectStages;
      this.projectStagesByProject = this._groupBy(projectStages, 'project_id');
      this.ddays = ddayRows;
      this._setRows('career_documents', careerDocRows);
      this._setRows('career_basic_info', careerBasicRows);
      this.attachmentsByOwner = this._groupBy(
        attachments.map((a) => ({ ...a, _ownerKey: `${a.owner_table}:${a.owner_id}` })),
        '_ownerKey'
      );

      this.emit('change', { schedules, projects: this.projects, programs, notifications, settingsChanged: settingsResult?.changed || [] });
      // Supabase 모드에서 데이터를 성공적으로 불러왔다는 것은 Supabase에 실제 요청이 성공했다는
      // 뜻이므로, "Supabase 7일 유지" 기능(설정 화면)의 마지막 활동 시각을 함께 갱신한다.
      if (window.CONFIG?.mode === 'supabase' && window.markSupabaseActive) window.markSupabaseActive();
      return this;
    }

    _groupProgress(rows) {
      const map = {};
      for (const r of rows) {
        if (!map[r.project_id]) map[r.project_id] = [];
        map[r.project_id].push({ progress: r.progress, recorded_at: (r.recorded_at || '').slice(0, 10) });
      }
      return map;
    }

    _groupBy(rows, key) {
      const map = {};
      for (const r of rows) {
        if (!map[r[key]]) map[r[key]] = [];
        map[r[key]].push(r);
      }
      return map;
    }

    _attachProjectMeta(projects, progressRows) {
      const lastByProject = {};
      for (const r of progressRows) {
        const prev = lastByProject[r.project_id];
        if (!prev || r.recorded_at > prev) lastByProject[r.project_id] = r.recorded_at;
      }
      return projects.map((p) => ({ ...p, lastProgressAt: lastByProject[p.id] || null }));
    }

    // ---- 편의 CRUD (호출부에서 매번 store를 신경쓰지 않게) ----
    // ---- 일정 (v7.20.0: 낙관적 갱신 + 장소/구분 + "N일 후" 자식 일정) ----
    // "N일 후" 반복: 부모 일정의 repeat_offsets([5,7])마다 자식 일정(parent_schedule_id/offset_days/is_generated)을 실제 행으로 만든다.
    // 부모를 고치면 자식의 제목/날짜/시간/장소/구분/우선순위/프로젝트/태그/메모가 따라 바뀌고(완료 여부는 그대로),
    // offsets를 바꾸면 달라진 것만 추가/삭제한다(planScheduleChildren — 멱등). 자식을 "독립 일정"으로 만들면 연결이 끊긴다(detachSchedule).
    _scheduleChildren(parentId) {
      return this._getRows('schedules').filter((s) => s.parent_schedule_id === parentId);
    }
    async addSchedule(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(일정 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const payload = { ...data, user_id: this.user.id, done: false };
      const offsets = window.parseOffsets(payload.repeat_offsets || []).offsets;
      if (offsets.length) payload.repeat_offsets = offsets; else delete payload.repeat_offsets;
      const create = async (p) => (await this._optimisticCreate('schedules', [p]))[0];
      if (!offsets.length) return this._withoutMissingColumn(create, payload, SCHEDULE_NEW_COLS, '0024');
      let row;
      try {
        row = await create(payload);
      } catch (e) {
        if (this._isMissingColumnError(e, SCHEDULE_NEW_COLS)) throw new Error(`"N일 후" 반복을 쓰려면 ${MIGRATION_0024_HINT}`);
        throw e;
      }
      await this._syncScheduleChildren(row);
      return row;
    }
    async _syncScheduleChildren(parent) {
      const plan = window.planScheduleChildren(parent, this._scheduleChildren(parent.id));
      const ops = [];
      if (plan.remove.length) {
        ops.push(this._optimisticRemove('schedules', plan.remove, () => Promise.all(plan.remove.map((id) => this.store.remove('schedules', id)))));
      }
      for (const u of plan.update) ops.push(this._optimisticUpdate('schedules', u.id, u.patch, () => this.store.update('schedules', u.id, u.patch)));
      if (plan.create.length) ops.push(this._optimisticCreate('schedules', plan.create.map((c) => ({ ...c, user_id: this.user.id, done: false }))));
      await Promise.all(ops);
      return plan;
    }
    async updateSchedule(id, patch) {
      const cur = this._getRows('schedules').find((r) => r.id === id);
      const next = { ...patch };
      if ('repeat_offsets' in next) next.repeat_offsets = window.parseOffsets(next.repeat_offsets || []).offsets;
      const strict = (next.repeat_offsets && next.repeat_offsets.length) || (cur?.repeat_offsets || []).length > 0 || next.parent_schedule_id;
      const run = (p) => this.store.update('schedules', id, p);
      let saved;
      try {
        saved = await this._optimisticUpdate('schedules', id, next, () => (strict ? run(next) : this._withoutMissingColumn(run, next, SCHEDULE_NEW_COLS, '0024')));
      } catch (e) {
        if (strict && this._isMissingColumnError(e, SCHEDULE_NEW_COLS)) throw new Error(`"N일 후" 반복을 쓰려면 ${MIGRATION_0024_HINT}`);
        throw e;
      }
      const touchesFamily = ['repeat_offsets', ...window.SCHEDULE_SYNC_FIELDS].some((k) => k in next);
      if (cur && !cur.parent_schedule_id && touchesFamily && ((next.repeat_offsets || cur.repeat_offsets || []).length || this._scheduleChildren(id).length)) {
        await this._syncScheduleChildren({ ...cur, ...next, ...(saved && typeof saved === 'object' ? saved : {}), id });
      }
      return saved;
    }
    /** 자식 일정을 부모와의 연결을 끊은 "독립 일정"으로 바꾼다(제목의 "(N일 후)" 표식은 그대로 둔다). */
    async detachSchedule(id) {
      return this.updateSchedule(id, { parent_schedule_id: null, is_generated: false, offset_days: null });
    }
    /** deleteChildren=false이면 자식은 독립 일정으로 남기고 부모만 지운다. */
    async deleteSchedule(id, { deleteChildren = true } = {}) {
      const kids = this._scheduleChildren(id).map((c) => c.id);
      if (kids.length && !deleteChildren) {
        const patch = { parent_schedule_id: null, is_generated: false, offset_days: null };
        await Promise.all(kids.map((k) => this._optimisticUpdate('schedules', k, patch, () => this.store.update('schedules', k, patch))));
        kids.length = 0;
      }
      const ids = [id, ...kids];
      return this._optimisticRemove('schedules', ids, () => Promise.all(ids.map((x) => this.store.remove('schedules', x))));
    }

    async addProject(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(프로젝트 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const row = await this.store.create('projects', { ...data, user_id: this.user.id, status: data.status || 'in_progress' });
      await this.refreshAll();
      return row;
    }
    async updateProject(id, patch) {
      await this.store.update('projects', id, patch);
      return this.refreshAll();
    }
    async deleteProject(id) {
      await this.store.softDelete('projects', id);
      return this.refreshAll();
    }
    async recordProgress(projectId, progress) {
      await this.store.create('project_progress', {
        project_id: projectId,
        progress,
        recorded_at: new Date().toISOString(),
      });
      if (progress >= 100) {
        await this.store.update('projects', projectId, { status: 'done' });
      }
      return this.refreshAll();
    }

    async addProgram(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(프로그램 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const row = await this.store.create('programs', { ...data, user_id: this.user.id, run_count: 0 });
      await this.refreshAll();
      return row;
    }
    async updateProgram(id, patch) {
      await this.store.update('programs', id, patch);
      return this.refreshAll();
    }
    async deleteProgram(id) {
      await this.store.remove('programs', id);
      return this.refreshAll();
    }
    // 여러 프로그램을 한 번에 삭제(목록 화면의 선택삭제). refreshAll은 마지막에 한 번만 호출한다.
    async deleteProgramsBulk(ids) {
      for (const id of ids) await this.store.remove('programs', id);
      return this.refreshAll();
    }
    async runProgram(id) {
      const p = this.programs.find((x) => x.id === id);
      if (!p) return;
      await this.store.update('programs', id, {
        run_count: (p.run_count || 0) + 1,
        last_run: new Date().toISOString(),
      });
      window.open(p.url, '_blank', 'noopener');
      this._trackRecentlyViewed('program', p.id, `${window.programIcon ? window.programIcon(p) : (p.icon || '🔗')} ${p.name}`);
      return this.refreshAll();
    }

    // ---- "최근 본 항목"(홈 화면 벤치마킹 기능) ----
    // Raindrop.io/Notion류 앱의 "최근 항목" 위젯을 벤치마킹: 프로그램을 열거나 즐겨찾기를
    // 열 때마다 최근 사용 목록(settingsSync로 기기 간 동기화, 최대 8개)에 기록해 홈 화면에서
    // 바로 다시 열 수 있게 한다.
    _trackRecentlyViewed(type, id, label) {
      try {
        const KEY = 'workspace:recentlyViewed';
        const raw = window.settingsSync.get(KEY);
        let list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) list = [];
        list = list.filter((item) => !(item.type === type && item.id === id));
        list.unshift({ type, id, label, at: new Date().toISOString() });
        window.settingsSync.set(KEY, JSON.stringify(list.slice(0, 8)));
      } catch { /* localStorage 접근 불가(프라이빗 모드 등)여도 앱 동작엔 영향 없음 */ }
    }
    getRecentlyViewed() {
      try {
        const raw = window.settingsSync.get('workspace:recentlyViewed');
        const list = raw ? JSON.parse(raw) : [];
        return Array.isArray(list) ? list : [];
      } catch {
        return [];
      }
    }

    // ---- 즐겨찾기 URL(바로가기) ----
    async addBookmark(data) {
      const maxOrder = this.bookmarks.reduce((m, b) => Math.max(m, b.sort_order || 0), 0);
      await this.store.create('bookmarks', { ...data, user_id: this.user.id, sort_order: maxOrder + 1 });
      return this.refreshAll();
    }
    async updateBookmark(id, patch) {
      await this.store.update('bookmarks', id, patch);
      return this.refreshAll();
    }
    async deleteBookmark(id) {
      await this.store.remove('bookmarks', id);
      return this.refreshAll();
    }
    async deleteBookmarksBulk(ids) {
      for (const id of ids) await this.store.remove('bookmarks', id);
      return this.refreshAll();
    }
    async openBookmark(id) {
      const b = this.bookmarks.find((x) => x.id === id);
      if (!b) return;
      window.open(b.url, '_blank', 'noopener');
      this._trackRecentlyViewed('bookmark', b.id, `${b.icon || '⭐'} ${b.title}`);
      // 클릭 횟수는 세지 않지만 최근 사용 시각만 가볍게 남겨 홈 화면 "자주 쓰는 링크"에 활용할 수 있게 한다.
      await this.store.update('bookmarks', id, { updated_at: new Date().toISOString() }).catch(() => {});
    }
    async reorderBookmarks(orderedIds) {
      await Promise.all(orderedIds.map((id, idx) => this.store.update('bookmarks', id, { sort_order: idx })));
      return this.refreshAll();
    }

    async markNotificationRead(id) {
      await this.store.update('notifications', id, { is_read: true, read_at: new Date().toISOString() });
      return this.refreshAll();
    }

    // ---- 챌린저 ----
    async addChallenge(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(챌린지 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const payload = { ...data, user_id: this.user.id, status: data.status || 'active' };
      const row = await this._withoutMissingColumn((p) => this.store.create('challenges', p), payload, CHALLENGE_NEW_COLS, '0024');
      await this.refreshAll();
      return row;
    }
    async updateChallenge(id, patch) {
      await this._withoutMissingColumn((p) => this.store.update('challenges', id, p), patch, CHALLENGE_NEW_COLS, '0024');
      return this.refreshAll();
    }
    async deleteChallenge(id) {
      await this.store.remove('challenges', id);
      return this.refreshAll();
    }
    // (challenge_id, checkin_date) unique — 이미 체크인한 날짜면 덮어쓴다. v7.20.0: 낙관적 갱신(주간 알약을 눌러도 바로 반응).
    async checkinChallenge(challengeId, checkinDate, value = 1, memo = null) {
      const existing = this.challengeCheckins.find((c) => c.challenge_id === challengeId && c.checkin_date === checkinDate);
      if (existing) {
        if (existing._pending) return existing;
        return this._optimisticUpdate('challenge_checkins', existing.id, { value, memo }, () => this.store.update('challenge_checkins', existing.id, { value, memo }));
      }
      const [row] = await this._optimisticCreate('challenge_checkins', [{ challenge_id: challengeId, checkin_date: checkinDate, value, memo }]);
      return row;
    }
    async deleteCheckin(id) {
      return this._optimisticRemove('challenge_checkins', [id], () => this.store.remove('challenge_checkins', id));
    }
    /** 그 날짜 체크인을 켜고 끈다(주간 알약 클릭). 저장 중인 칸은 무시한다. @returns {'added'|'removed'|'busy'} */
    async toggleCheckinDay(challengeId, dateIso) {
      const existing = this.challengeCheckins.find((c) => c.challenge_id === challengeId && c.checkin_date === dateIso);
      if (existing?._pending) return 'busy';
      if (existing) { await this.deleteCheckin(existing.id); return 'removed'; }
      await this.checkinChallenge(challengeId, dateIso, 1, null);
      return 'added';
    }

    // ---- D-day (챌린저 메뉴 상단, 최대 5개 — DB에도 trg_dday_limit 트리거가 있다) ----
    async addDday(data) {
      if (this.ddays.length >= window.MAX_DDAYS) throw new Error(`D-day는 최대 ${window.MAX_DDAYS}개까지 등록할 수 있습니다.`);
      const maxOrder = this.ddays.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      try {
        return (await this._optimisticCreate('ddays', [{ ...data, user_id: this.user.id, sort_order: maxOrder + 1 }]))[0];
      } catch (e) {
        const msg = String(e?.message || e);
        if (/dday limit/i.test(msg)) throw new Error(`D-day는 최대 ${window.MAX_DDAYS}개까지 등록할 수 있습니다.`);
        if (/ddays/i.test(msg) && /(relation|schema cache|does not exist|find)/i.test(msg)) throw new Error(`D-day 테이블이 없습니다. ${MIGRATION_0024_HINT}`);
        throw e;
      }
    }
    async updateDday(id, patch) {
      return this._optimisticUpdate('ddays', id, patch, () => this.store.update('ddays', id, patch));
    }
    async deleteDday(id) {
      return this._optimisticRemove('ddays', [id], () => this.store.remove('ddays', id));
    }

    // ---- 차량관리 ----
    async addVehicle(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(차량 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const row = await this.store.create('vehicles', { ...data, user_id: this.user.id });
      await this.refreshAll();
      return row;
    }
    async updateVehicle(id, patch) {
      await this.store.update('vehicles', id, patch);
      return this.refreshAll();
    }
    async deleteVehicle(id) {
      await this.store.softDelete('vehicles', id);
      return this.refreshAll();
    }
    async addMaintenance(vehicleId, data) {
      // 등록 직후 바로 첨부파일(영수증 등)을 붙일 수 있도록, 생성된 행을 반환한다.
      const row = await this.store.create('vehicle_maintenance', { ...data, vehicle_id: vehicleId });
      await this.refreshAll();
      return row;
    }
    async deleteMaintenance(id) {
      await this.store.remove('vehicle_maintenance', id);
      return this.refreshAll();
    }
    async addFuelLog(vehicleId, data) {
      await this.store.create('vehicle_fuel_logs', { ...data, vehicle_id: vehicleId });
      return this.refreshAll();
    }
    async deleteFuelLog(id) {
      await this.store.remove('vehicle_fuel_logs', id);
      return this.refreshAll();
    }

    // =====================================================================
    // 낙관적 갱신 + 대상 테이블만 재조회 (v7.19.0)
    // 느렸던 원인: 쓰기마다 `await refreshAll()`이 20여 개 테이블(첨부파일의 base64 본문 포함)을 네트워크로
    // 전부 다시 읽었고, 혈압은 수축기/이완기 두 행을 순차 create했으며, 일정 등록은 일정 연동 create+update까지
    // 끝나야 모달이 닫혔다. 이제는 (1) 서버가 돌려준 행(또는 임시 행)을 메모리에 바로 넣고 'change'를 즉시 내보내며
    // (2) 그 테이블 하나만 백그라운드로 재조회(디바운스)해 서버 상태와 맞추고 (3) 실패하면 원래대로 되돌린다.
    // =====================================================================
    _bump(table) { this._wseq[table] = (this._wseq[table] || 0) + 1; }

    _sorted(table, rows) {
      const cmp = TABLE_STATE[table]?.cmp;
      return cmp ? rows.slice().sort(cmp) : rows;
    }

    _setRows(table, rows) {
      const cfg = TABLE_STATE[table];
      this[cfg.field] = this._sorted(table, rows);
      if (cfg.derive) cfg.derive(this);
    }
    _getRows(table) {
      return this[TABLE_STATE[table].field] || [];
    }

    // 서버에서 읽은 행에 "아직 저장 중인 임시 행"을 유지해서 합친다(재조회가 낙관적 행을 지워 깜빡이는 것 방지).
    _mergePending(table, fetched) {
      const pending = this._getRows(table).filter((r) => r._pending && !fetched.some((f) => f.id === r.id));
      return pending.length ? [...pending, ...fetched] : fetched;
    }

    /** 한 테이블만 다시 읽어 상태에 반영한다. 읽는 동안 같은 테이블에 쓰기가 있었으면 결과를 버린다(그 쓰기가 다시 예약). */
    async refreshTable(table) {
      const cfg = TABLE_STATE[table];
      if (!cfg || !this.user) return false;
      const seq = this._wseq[table] || 0;
      const p = this.store.list(table, cfg.opts(this.user.id));
      this._inflight.add(p);
      let rows;
      try { rows = await p; } catch (e) { return false; } finally { this._inflight.delete(p); }
      if ((this._wseq[table] || 0) !== seq) return false;
      this._setRows(table, this._mergePending(table, rows));
      this.emit('change', { table, targeted: true });
      return true;
    }

    /** 짧은 시간 안의 여러 쓰기(예: 복약 체크 연타)를 한 번의 재조회로 묶는다. */
    _scheduleReconcile(table, delay = 500) {
      clearTimeout(this._reconcileTimers[table]);
      this._reconcileTimers[table] = setTimeout(() => {
        delete this._reconcileTimers[table];
        const p = this.refreshTable(table);
        this._inflight.add(p);
        p.finally(() => this._inflight.delete(p));
      }, delay);
    }

    /** 예약된 재조회를 지금 실행하고 끝날 때까지 기다린다(테스트/화면 이동 직전용). */
    async flushReconcile() {
      for (const table of Object.keys(this._reconcileTimers)) {
        clearTimeout(this._reconcileTimers[table]);
        delete this._reconcileTimers[table];
        const p = this.refreshTable(table);
        this._inflight.add(p);
        p.finally(() => this._inflight.delete(p));
      }
      await Promise.all([...this._inflight]);
    }

    /** 백그라운드 작업(일정 연동·재조회)이 모두 끝날 때까지 기다린다. 화면 코드는 쓸 필요 없고 테스트/측정용이다. */
    async whenSettled() {
      for (let i = 0; i < 5; i++) {
        await Promise.all([...this._linkPromises.values()]);
        await this.flushReconcile();
        if (!this._linkPromises.size && !Object.keys(this._reconcileTimers).length && !this._inflight.size) break;
      }
    }

    // 임시 행을 먼저 보여주고, 서버 저장이 끝나면 실제 행으로 바꾼다. 실패하면 임시 행을 제거하고 예외를 다시 던진다.
    async _optimisticCreate(table, payloads) {
      const stamp = new Date().toISOString();
      const temps = payloads.map((p) => ({ ...p, id: `${TMP_PREFIX}${window.uid()}`, created_at: stamp, _pending: true }));
      this._bump(table);
      this._setRows(table, [...temps, ...this._getRows(table)]);
      this.emit('change', { table, optimistic: true });
      const tempIds = new Set(temps.map((t) => t.id));
      let created;
      try {
        created = payloads.length === 1 ? [await this.store.create(table, payloads[0])] : await this.store.createMany(table, payloads);
      } catch (e) {
        this._bump(table);
        this._setRows(table, this._getRows(table).filter((r) => !tempIds.has(r.id)));
        this.emit('change', { table, rolledBack: true });
        throw e;
      }
      this._bump(table);
      const createdIds = new Set(created.map((r) => r.id));
      this._setRows(table, [...created, ...this._getRows(table).filter((r) => !tempIds.has(r.id) && !createdIds.has(r.id))]);
      this.emit('change', { table });
      this._scheduleReconcile(table);
      return created;
    }

    // 행을 먼저 지우고 서버 삭제를 기다린다. 실패하면 되살린다.
    async _optimisticRemove(table, ids, remote) {
      const idSet = new Set(ids);
      const removed = this._getRows(table).filter((r) => idSet.has(r.id));
      if (!removed.length) return;
      this._bump(table);
      this._setRows(table, this._getRows(table).filter((r) => !idSet.has(r.id)));
      this.emit('change', { table, optimistic: true });
      try {
        await remote();
      } catch (e) {
        this._bump(table);
        this._setRows(table, [...removed, ...this._getRows(table)]);
        this.emit('change', { table, rolledBack: true });
        throw e;
      }
      this._scheduleReconcile(table);
    }

    // 필드를 먼저 바꾸고 서버 수정을 기다린다. 실패하면 이전 값으로 되돌린다.
    async _optimisticUpdate(table, id, patch, remote) {
      const prev = this._getRows(table).find((r) => r.id === id);
      if (!prev) return remote();
      this._bump(table);
      this._setRows(table, this._getRows(table).map((r) => (r.id === id ? { ...r, ...patch } : r)));
      this.emit('change', { table, optimistic: true });
      try {
        const saved = await remote();
        if (saved && typeof saved === 'object' && saved.id === id) {
          this._bump(table);
          this._setRows(table, this._getRows(table).map((r) => (r.id === id ? { ...r, ...saved } : r)));
          this.emit('change', { table });
        }
        this._scheduleReconcile(table);
        return saved;
      } catch (e) {
        this._bump(table);
        this._setRows(table, this._getRows(table).map((r) => (r.id === id ? prev : r)));
        this.emit('change', { table, rolledBack: true });
        throw e;
      }
    }

    // 마이그레이션 미적용 DB(컬럼이 아직 없음)에서도 기존 저장이 깨지지 않도록, 새 컬럼 때문에 실패하면 그 컬럼만 빼고 재시도한다
    // (컬럼이 여러 개 없으면 하나씩 벗겨 가며 최대 columns.length+1번까지 반복). migration은 안내 문구에 쓰는 번호다.
    async _withoutMissingColumn(run, payload, columns, migration = '0023') {
      let cur = payload;
      const dropped = [];
      for (let i = 0; i <= columns.length; i++) {
        try {
          const row = await run(cur);
          if (dropped.length) this.schemaWarning = `DB에 ${dropped.join(', ')} 컬럼이 없어 해당 값은 저장되지 않았습니다. ${migration} 마이그레이션을 실행해 주세요.`;
          return row;
        } catch (e) {
          const msg = String(e?.message || e);
          const hit = columns.filter((c) => c in cur && msg.includes(c));
          if (!hit.length) throw e;
          cur = { ...cur };
          for (const c of hit) { delete cur[c]; dropped.push(c); }
        }
      }
      throw new Error('컬럼 폴백 재시도 한도를 넘었습니다.');
    }
    _isMissingColumnError(e, columns) {
      const msg = String(e?.message || e);
      return columns.some((c) => msg.includes(c)) && /column|schema cache|does not exist|찾을 수/i.test(msg);
    }

    // ---- Health: 기록(metrics) ----
    // 혈압(수축기/이완기)처럼 한 번의 입력이 여러 행이면 한 번의 insert(createMany)로 보낸다.
    async addHealthMetrics(rows) {
      const stamp = new Date().toISOString();
      const payloads = rows.map((data) => ({ ...data, user_id: this.user.id, recorded_at: data.recorded_at || stamp }));
      return this._optimisticCreate('health_metrics', payloads);
    }
    async addHealthMetric(data) {
      return (await this.addHealthMetrics([data]))[0];
    }
    async deleteHealthMetric(id) {
      return this._optimisticRemove('health_metrics', [id], () => this.store.remove('health_metrics', id));
    }

    // ---- Health: 병원/검진 일정 ----
    // 병원/검진 일정을 등록하면 "일정" 메뉴에도 자동으로 나타나도록, 같은 내용의 일정을 함께 만들고 그 id를
    // health_appointments.schedule_id에 저장해 묶어둔다. 이 연동은 화면을 막지 않고 백그라운드로 진행한다.
    _scheduleFieldsOf(a) {
      return {
        title: `🏥 ${a.title}`,
        date: a.appointment_date,
        time: a.appointment_time || null,
        memo: `Health에서 자동 추가된 일정입니다.${a.location ? ' 장소: ' + a.location : ''}`,
        place: a.location || null,
      };
    }
    async addHealthAppointment(data) {
      const payload = { ...data, user_id: this.user.id };
      const appt = await this._withoutMissingColumn((p) => this.store.create('health_appointments', p), payload, ['appt_type']);
      this._bump('health_appointments');
      this._setRows('health_appointments', [appt, ...this._getRows('health_appointments').filter((r) => r.id !== appt.id)]);
      this.emit('change', { table: 'health_appointments' });
      // 일정 메뉴 연동 — 기다리지 않는다(실패해도 Health 쪽 등록은 유지). 수정/삭제는 이 Promise를 기다린 뒤 진행한다.
      const link = this._linkAppointmentSchedule(appt).catch(() => {});
      this._linkPromises.set(appt.id, link);
      link.finally(() => this._linkPromises.delete(appt.id));
      this._scheduleReconcile('health_appointments');
      return appt; // 등록 직후 바로 첨부파일(진료의뢰서 등)을 붙일 수 있도록 생성된 행을 돌려준다.
    }
    async _linkAppointmentSchedule(appt) {
      // v7.20.0: 병원 일정은 구분 '개인'으로 만든다(수정 때는 구분을 건드리지 않는다 — 사용자가 일정 메뉴에서 바꿨을 수 있다).
      // 0024 미실행 DB에서는 place/category만 빼고 만든다.
      const schedule = await this._withoutMissingColumn(
        (p) => this.store.create('schedules', p),
        { user_id: this.user.id, done: false, ...this._scheduleFieldsOf(appt), category: '개인' },
        ['place', 'category'],
        '0024'
      );
      const updated = await this.store.update('health_appointments', appt.id, { schedule_id: schedule.id });
      this._bump('schedules');
      this._setRows('schedules', [...this._getRows('schedules').filter((r) => r.id !== schedule.id), schedule]);
      this._bump('health_appointments');
      this._setRows('health_appointments', this._getRows('health_appointments').map((r) => (r.id === appt.id ? { ...r, ...updated, schedule_id: schedule.id } : r)));
      this.emit('change', { table: 'schedules' });
      this._scheduleReconcile('schedules');
      this._scheduleReconcile('health_appointments');
    }
    async updateHealthAppointment(id, patch) {
      if (this._linkPromises.has(id)) await this._linkPromises.get(id); // 일정 연동이 끝나 schedule_id가 생길 때까지
      const current = this._getRows('health_appointments').find((a) => a.id === id);
      const saved = await this._optimisticUpdate('health_appointments', id, patch, () =>
        this._withoutMissingColumn((p) => this.store.update('health_appointments', id, p), patch, ['appt_type']));
      // 제목/날짜/시간/장소가 바뀌면 연동된 일정도 같이 갱신한다(화면은 기다리지 않는다).
      const touched = ['title', 'appointment_date', 'appointment_time', 'location'].some((k) => patch[k] !== undefined);
      if (current?.schedule_id && touched) {
        const sf = this._scheduleFieldsOf({ ...current, ...patch });
        this._optimisticUpdate('schedules', current.schedule_id, sf, () =>
          this._withoutMissingColumn((p) => this.store.update('schedules', current.schedule_id, p), sf, ['place'], '0024')).catch(() => {});
      }
      return saved;
    }
    async deleteHealthAppointment(id) {
      return this.deleteHealthAppointments([id]);
    }
    // 여러 건(선택삭제)을 한꺼번에 지운다. 연동된 일정도 함께 지우며 서버 호출은 병렬로 보낸다.
    async deleteHealthAppointments(ids) {
      await Promise.all(ids.map((id) => this._linkPromises.get(id)).filter(Boolean));
      const targets = this._getRows('health_appointments').filter((a) => ids.includes(a.id));
      const scheduleIds = targets.map((a) => a.schedule_id).filter(Boolean);
      if (scheduleIds.length) {
        this._optimisticRemove('schedules', scheduleIds, () => Promise.all(scheduleIds.map((sid) => this.store.remove('schedules', sid)))).catch(() => {});
      }
      return this._optimisticRemove('health_appointments', ids, () => Promise.all(ids.map((id) => this.store.remove('health_appointments', id))));
    }

    // ---- Health: 복약 관리(0023) ----
    async addHealthMedication(data) {
      const maxOrder = this.healthMedications.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      const row = await this.store.create('health_medications', { active: true, ...data, user_id: this.user.id, sort_order: maxOrder + 1 });
      this._bump('health_medications');
      this._setRows('health_medications', [...this.healthMedications.filter((r) => r.id !== row.id), row]);
      this.emit('change', { table: 'health_medications' });
      this._scheduleReconcile('health_medications');
      return row;
    }
    async updateHealthMedication(id, patch) {
      return this._optimisticUpdate('health_medications', id, patch, () => this.store.update('health_medications', id, patch));
    }
    async deleteHealthMedications(ids) {
      return this._optimisticRemove('health_medications', ids, () => Promise.all(ids.map((id) => this.store.softDelete('health_medications', id))));
    }
    // 복용 체크를 켜고 끈다(한 번 누르면 즉시 반영, 서버 저장은 뒤에서). 이미 같은 상태면 체크 해제(행 삭제).
    // 남은 수량(remaining_count)을 입력한 약은 체크할 때 1 줄고 해제하면 1 늘어난다.
    async toggleMedDose(medId, dateIso, slot = '', status = 'taken') {
      const med = this.healthMedications.find((m) => m.id === medId);
      if (!med) return null;
      const existing = this.healthMedLogs.find((l) => l.medication_id === medId && l.taken_date === dateIso && (l.slot || '') === (slot || ''));
      if (existing && existing._pending) return null; // 저장 중인 행은 건드리지 않는다(연타 방지)
      const wasTaken = existing?.status === 'taken';
      const willBeTaken = existing && existing.status === status ? false : status === 'taken';
      let result;
      if (existing && existing.status === status) {
        result = await this._optimisticRemove('health_med_logs', [existing.id], () => this.store.remove('health_med_logs', existing.id));
      } else if (existing) {
        result = await this._optimisticUpdate('health_med_logs', existing.id, { status, logged_at: new Date().toISOString() }, () =>
          this.store.update('health_med_logs', existing.id, { status, logged_at: new Date().toISOString() }));
      } else {
        const [row] = await this._optimisticCreate('health_med_logs', [{
          user_id: this.user.id, medication_id: medId, taken_date: dateIso, slot: slot || '', status, logged_at: new Date().toISOString(),
        }]);
        result = row;
      }
      const delta = (wasTaken ? 1 : 0) - (willBeTaken ? 1 : 0); // 복용하면 남은 수량 -1, 복용 취소면 +1
      if (med.remaining_count != null && delta !== 0) {
        const next = Math.max(0, Number(med.remaining_count) + delta);
        this.updateHealthMedication(medId, { remaining_count: next }).catch(() => {});
      }
      return result;
    }

    // ---- 내 정보(profiles) ----
    async updateMyProfile(patch) {
      await this.store.update('profiles', this.user.id, patch);
      return this.refreshAll();
    }

    // ---- 문화생활(PlayList) ----
    async addPlaylistItem(data) {
      // 등록 즉시 첨부파일을 붙일 수 있도록(등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const row = await this.store.create('playlist_items', { ...data, user_id: this.user.id, status: data.status || 'to_watch' });
      await this.refreshAll();
      return row;
    }
    async updatePlaylistItem(id, patch) {
      await this.store.update('playlist_items', id, patch);
      return this.refreshAll();
    }
    async deletePlaylistItem(id) {
      await this.store.softDelete('playlist_items', id);
      return this.refreshAll();
    }
    // 관람 예정(event_date 있음) 항목을 일정에 바로 등록
    async addPlaylistToSchedule(item) {
      if (!item.event_date) throw new Error('관람 예정일이 없는 항목입니다.');
      await this.addSchedule({
        title: `${item.title} (${window.PLAYLIST_TYPE_LABEL[item.content_type] || item.content_type})`,
        date: item.event_date,
        time: item.event_time || null,
        memo: item.venue_name || null,
      });
    }

    // ---- 관심주제 브리핑 ----
    async addBriefingTopic(data) {
      const activeCount = this.briefingTopics.filter((t) => t.active !== false).length;
      if (activeCount >= 10) throw new Error('관심주제는 최대 10개까지 등록할 수 있습니다.');
      await this.store.create('briefing_topics', { ...data, user_id: this.user.id, active: data.active ?? true });
      return this.refreshAll();
    }
    async updateBriefingTopic(id, patch) {
      await this.store.update('briefing_topics', id, patch);
      return this.refreshAll();
    }
    async deleteBriefingTopic(id) {
      await this.store.remove('briefing_topics', id);
      return this.refreshAll();
    }
    async addFeedSource(data) {
      await this.store.create('feed_sources', { ...data, user_id: this.user.id, enabled: data.enabled ?? true });
      return this.refreshAll();
    }
    async updateFeedSource(id, patch) {
      await this.store.update('feed_sources', id, patch);
      return this.refreshAll();
    }
    async deleteFeedSource(id) {
      await this.store.remove('feed_sources', id);
      return this.refreshAll();
    }
    async markBriefingItemRead(id) {
      await this.store.update('briefing_items', id, { is_read: true, read_at: new Date().toISOString() });
      return this.refreshAll();
    }
    async deleteBriefingItem(id) {
      await this.store.remove('briefing_items', id);
      return this.refreshAll();
    }

    // 활성화된 피드 소스를 전부 가져와 활성 주제와 매칭한 뒤, 새 항목만 저장한다.
    // (user_id, item_hash) 유니크 제약과 동일한 효과를 로컬에서는 Set으로 낸다.
    async collectBriefingItems() {
      const { fetchFeedItems, itemMatchesTopic, simpleHash, parseMarkdownLinks } = window;
      // 'markdown' 타입은 RSS 엔드포인트가 아니라 사용자가 붙여넣은 본문(endpoint 컬럼에 그대로 저장)
      // 이므로 fetchFeedItems() 대신 parseMarkdownLinks()로 링크만 추출한다(아래 루프에서 분기).
      const sources = this.feedSources.filter((s) => s.enabled !== false && s.type !== 'crawl' && s.type !== 'api');
      const activeTopics = this.briefingTopics.filter((t) => t.active !== false);
      const existingHashes = new Set(this.briefingItems.map((i) => i.item_hash));

      let fetchedCount = 0;
      let newCount = 0;
      const errors = [];

      for (const source of sources) {
        let items = [];
        try {
          items = source.type === 'markdown' ? (parseMarkdownLinks(source.endpoint) || []) : await fetchFeedItems(source.endpoint);
        } catch (e) {
          errors.push(`${source.name}: ${e.message}`);
          // 소스 관제(개발계획서 9.3): 시스템이 판단하는 상태(정상/오류/미실행)를 사용자 on/off와 분리해 기록한다.
          await this.store.update('feed_sources', source.id, { last_result: 'error', last_run_at: new Date().toISOString() }).catch(() => {});
          continue;
        }
        fetchedCount += items.length;
        await this.store
          .update('feed_sources', source.id, { last_result: items.length ? 'success' : 'empty', last_run_at: new Date().toISOString() })
          .catch(() => {});
        for (const item of items) {
          const hash = simpleHash(`${item.title}|${item.link}`);
          if (existingHashes.has(hash)) continue;
          // 실제 스키마의 unique(user_id, item_hash) 제약과 맞추기 위해 항목당 주제 하나만 매칭한다
          // (우선순위가 가장 높은=priority 숫자가 큰 주제 하나를 고른다).
          const matched = activeTopics.length
            ? activeTopics.filter((t) => itemMatchesTopic(item, t)).sort((a, b) => (b.priority || 0) - (a.priority || 0))[0]
            : undefined;
          if (activeTopics.length && !matched) continue; // 주제가 있는데 아무것도 안 맞으면 스킵
          await this.store.create('briefing_items', {
            user_id: this.user.id,
            topic_id: matched ? matched.id : null,
            source_id: source.id,
            title: item.title,
            link: item.link,
            summary: item.summary,
            published_at: item.publishedAt,
            item_hash: hash,
            is_read: false,
          });
          existingHashes.add(hash);
          newCount++;
        }
      }
      await this.refreshAll();
      return { fetchedCount, newCount, errors };
    }

    // ---- Knowledge ----
    async addKnowledgeDoc(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(Knowledge 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const row = await this.store.create('knowledge_docs', { ...data, user_id: this.user.id, status: data.status || 'active' });
      await this.refreshAll();
      return row;
    }
    async updateKnowledgeDoc(id, patch) {
      await this.store.update('knowledge_docs', id, patch);
      return this.refreshAll();
    }
    async deleteKnowledgeDoc(id) {
      await this.store.softDelete('knowledge_docs', id);
      return this.refreshAll();
    }
    async deleteKnowledgeDocsBulk(ids) {
      for (const id of ids) await this.store.softDelete('knowledge_docs', id);
      return this.refreshAll();
    }

    // ---- Automation ----
    // rule_type별로 한 행만 유지한다(사용자 설정 upsert).
    async setAutomationRule(ruleType, patch) {
      const existing = this.automationRules.find((r) => r.rule_type === ruleType);
      if (existing) {
        await this.store.update('automation_rules', existing.id, patch);
      } else {
        await this.store.create('automation_rules', { user_id: this.user.id, rule_type: ruleType, enabled: true, params: {}, ...patch });
      }
      return this.refreshAll();
    }
    // js/rules.js가 기대하는 { [ruleType]: {enabled, params} } 형태로 변환
    buildEnabledRulesMap() {
      const map = {};
      for (const r of this.automationRules) map[r.rule_type] = { enabled: r.enabled !== false, params: r.params || {} };
      return map;
    }
    // 로그인 시 자동 실행되는 것과 동일한 자동화를 수동으로 다시 실행한다(Automation 화면의 "지금 실행").
    async runAutomationNow() {
      const challengesWithCheckins = this.challenges.map((c) => ({ ...c, checkins: this.checkinsByChallenge[c.id] || [] }));
      const newAlerts = await window.runAndPersistAutomation(
        this.store,
        this.user.id,
        { projects: this.projects, schedules: this.schedules, vehicles: this.vehicles, challenges: challengesWithCheckins, playlistItems: this.playlistItems },
        this.buildEnabledRulesMap()
      );
      await this.refreshAll();
      return newAlerts;
    }

    // ---- Integrations (연결 상태 자리만 — 실제 OAuth는 고도화 단계에서) ----
    async setIntegrationStatus(provider, status) {
      const existing = this.integrations.find((i) => i.provider === provider);
      if (existing) await this.store.update('integrations', existing.id, { status });
      else await this.store.create('integrations', { user_id: this.user.id, provider, status });
      return this.refreshAll();
    }

    // ---- Devlog (개발/개선 기록, 프로젝트 연계) ----
    async addDevlog(data) {
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(Devlog 등록 화면에서 바로 첨부), 생성된 행을 반환한다.
      const row = await this.store.create('devlogs', { ...data, user_id: this.user.id });
      await this.refreshAll();
      return row;
    }
    async updateDevlog(id, patch) {
      await this.store.update('devlogs', id, patch);
      return this.refreshAll();
    }
    async deleteDevlog(id) {
      await this.store.softDelete('devlogs', id);
      return this.refreshAll();
    }

    // ---- 프로젝트 WBS(트리) 항목 (v7.20.0) ----
    // project_stages 한 행 = WBS 한 노드. parent_id로 트리를 이루고(대/중/소 레벨은 깊이로 자동 결정) seq는 "같은 부모 안의 순서"다.
    // 쓰기는 모두 낙관적 갱신(화면 즉시 반영 → 서버 저장 → 실패 시 되돌림)이다.
    _nextStageSeq(projectId, parentId) {
      const sibs = this.projectStages.filter((s) => s.project_id === projectId && (s.parent_id || null) === (parentId || null));
      return sibs.length ? Math.max(...sibs.map((s) => Number(s.seq) || 0)) + 1 : 0;
    }
    _stageErr(e) {
      return this._isMissingColumnError(e, STAGE_NEW_COLS) ? new Error(`WBS(하위 항목) 저장에는 ${MIGRATION_0024_HINT}`) : e;
    }
    async addProjectStage(projectId, data) {
      const payload = { status: 'todo', ...data, project_id: projectId, user_id: this.user.id };
      if (payload.seq === undefined) payload.seq = this._nextStageSeq(projectId, payload.parent_id);
      try {
        return (await this._optimisticCreate('project_stages', [payload]))[0];
      } catch (e) {
        throw this._stageErr(e);
      }
    }
    /** 여러 항목을 한 번에(createMany) 만든다. rows는 완성된 payload 배열. */
    async addProjectStagesBulk(projectId, rows) {
      const payloads = rows.map((r) => ({ status: 'todo', ...r, project_id: projectId, user_id: this.user.id }));
      try {
        return await this._optimisticCreate('project_stages', payloads);
      } catch (e) {
        throw this._stageErr(e);
      }
    }
    async updateProjectStage(id, patch) {
      try {
        return await this._optimisticUpdate('project_stages', id, patch, () => this.store.update('project_stages', id, patch));
      } catch (e) {
        throw this._stageErr(e);
      }
    }
    /** [{id, patch}] 여러 건을 병렬로 수정(들여쓰기/순서 변경/기준선 저장). */
    async updateProjectStages(patches) {
      try {
        await Promise.all(patches.map((x) => this.updateProjectStage(x.id, x.patch)));
      } catch (e) {
        throw this._stageErr(e);
      }
    }
    /** 항목과 모든 하위 항목을 지운다(DB는 on delete cascade, 로컬은 여기서 직접). 다른 항목의 depends_on에서도 지워진 id를 뺀다. */
    async deleteProjectStage(id) {
      const tree = window.WBS.buildTree(this.projectStages);
      const ids = [id, ...window.WBS.descendantIds(tree, id)];
      const gone = new Set(ids);
      const cleanups = this.projectStages
        .filter((r) => !gone.has(r.id) && (r.depends_on || []).some((d) => gone.has(window.WBS.parseDep(d).id)))
        .map((r) => ({ id: r.id, patch: { depends_on: r.depends_on.filter((d) => !gone.has(window.WBS.parseDep(d).id)) } }));
      await this._optimisticRemove('project_stages', ids, () => Promise.all(ids.map((x) => this.store.remove('project_stages', x))));
      if (cleanups.length) await this.updateProjectStages(cleanups).catch(() => {});
    }
    async reorderProjectStages(projectId, orderedIds) {
      return this.updateProjectStages(orderedIds.map((id, seq) => ({ id, patch: { seq } })));
    }
    /** 현재 날짜를 기준선(baseline)으로 저장한다. @returns {number} 저장한 항목 수 */
    async snapshotProjectBaseline(projectId) {
      const rows = this.projectStages.filter((r) => r.project_id === projectId);
      const patches = window.WBS.snapshotBaseline(rows);
      await this.updateProjectStages(patches);
      return patches.length;
    }
    /** 들여쓰기 개요 텍스트를 parentId(없으면 최상위) 아래에 한 번에 추가한다. @returns {number} 추가한 항목 수 */
    async addProjectOutline(projectId, parentId, text) {
      const items = window.WBS.parseOutline(text);
      if (!items.length) return 0;
      const baseDepth = parentId ? window.WBS.depthOf(window.WBS.buildTree(this.projectStages), parentId) + 1 : 0;
      const usable = items.filter((it) => it.depth + baseDepth < window.WBS.MAX_WBS_DEPTH);
      const plan = window.WBS.outlineToRows(usable, parentId, this._nextStageSeq(projectId, parentId));
      const idByIndex = new Map();
      const maxDepth = Math.max(...plan.map((r) => r.depth));
      for (let d = 0; d <= maxDepth; d++) {
        const level = plan.map((r, i) => ({ r, i })).filter((x) => x.r.depth === d);
        const payloads = level.map(({ r }) => ({ name: r.name, seq: r.seq, parent_id: r.parentIndex === -1 ? r.parent_id : idByIndex.get(r.parentIndex) }));
        const created = await this.addProjectStagesBulk(projectId, payloads);
        level.forEach(({ i }, k) => idByIndex.set(i, created[k].id));
      }
      return plan.length;
    }
    /** 예전 중분류(group_name) 단계를 트리로 옮긴다(0024 SQL과 같은 규칙, 이미 옮긴 것은 건너뜀). 실패하면 한 번만 시도하고 포기한다. @returns {number} 옮긴 항목 수 */
    async migrateLegacyStages() {
      if (this._stageMigrationBusy || this._stageMigrationFailed) return 0;
      const plan = window.WBS.planLegacyStageMigration(this.projectStages.filter((r) => !String(r.id).startsWith(TMP_PREFIX)));
      if (!plan.create.length && !plan.link.length) return 0;
      this._stageMigrationBusy = true;
      try {
        const idByKey = new Map();
        for (const g of plan.create) {
          const row = await this.store.create('project_stages', { user_id: this.user.id, project_id: g.project_id, name: g.name, seq: g.seq, group_name: g.name, legacy_group: true, status: 'todo', progress: 0 });
          idByKey.set(g.key, row.id);
        }
        await Promise.all(plan.link.map((l) => this.store.update('project_stages', l.id, { parent_id: l.parent_id || idByKey.get(l.parentKey) })));
        await this.refreshTable('project_stages');
        return plan.link.length;
      } catch (e) {
        this._stageMigrationFailed = true; // 컬럼이 아직 없는 DB 등 — 0024 실행 전에는 조용히 건너뛴다.
        return 0;
      } finally {
        this._stageMigrationBusy = false;
      }
    }

    // ---- 파일 첨부 (모든 메뉴 공통: 일정/프로젝트단계/챌린저/차량/Devlog/문화생활 등) ----
    getAttachments(ownerTable, ownerId) {
      return this.attachmentsByOwner[`${ownerTable}:${ownerId}`] || [];
    }
    // file: File 객체. base64 Data URL로 인코딩해 저장한다(로컬 모드와 Supabase 모드 모두
    // 별도 스토리지 버킷 설정 없이 동일하게 동작하게 하기 위함). 용량 상한은 소유 메뉴별(window.attachmentLimit):
    // Knowledge 10MB, 그 밖 4MB. 상한 검사는 파일을 읽기 "전에" 한다(큰 파일을 메모리에 올리지 않고 바로 거절).
    async addAttachment(ownerTable, ownerId, file) {
      const chk = window.checkAttachmentSize(ownerTable, file.size, file.name);
      if (!chk.ok) throw new Error(chk.message);
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
        reader.readAsDataURL(file);
      });
      // 응답으로 본문을 다시 받지 않는다(메타 컬럼만) — 10MB 업로드 후 13MB를 되돌려 받는 낭비 방지.
      const row = await this.store.create('attachments', {
        user_id: this.user.id,
        owner_table: ownerTable,
        owner_id: ownerId,
        name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        data: dataUrl,
      }, { columns: ATTACH_META_COLS });
      this._cacheAttachmentData(row.id, dataUrl);
      // v7.19.0: 서버가 돌려준 행을 메모리에 바로 넣는다. refreshAll()은 모든 첨부파일의 base64 본문까지
      // 다시 내려받아 느렸고, 방금 만든 행이 이미 최신이므로 재조회가 필요 없다.
      const { data: _omit, ...meta } = row;
      const key = `${ownerTable}:${ownerId}`;
      this.attachmentsByOwner = { ...this.attachmentsByOwner, [key]: [{ ...meta, _ownerKey: key }, ...(this.attachmentsByOwner[key] || [])] };
      this.emit('change', { table: 'attachments' });
      return meta;
    }

    // ---- 첨부 본문(data) 지연 로딩 + 메모리 캐시(LRU, 약 60MB 상한) ----
    _cacheAttachmentData(id, dataUrl) {
      if (!this._attachCache) { this._attachCache = new Map(); this._attachChars = 0; }
      if (this._attachCache.has(id)) { this._attachChars -= this._attachCache.get(id).length; this._attachCache.delete(id); }
      if (dataUrl.length > ATTACH_CACHE_MAX_CHARS) return; // 상한보다 큰 하나는 캐시하지 않는다
      this._attachCache.set(id, dataUrl);
      this._attachChars += dataUrl.length;
      for (const k of this._attachCache.keys()) {
        if (this._attachChars <= ATTACH_CACHE_MAX_CHARS) break;
        this._attachChars -= this._attachCache.get(k).length;
        this._attachCache.delete(k);
      }
    }
    /** 이미 불러온 본문이 있으면 즉시 돌려준다(없으면 null). 목록 썸네일처럼 동기 렌더가 필요한 곳용. */
    peekAttachmentData(id) {
      const hit = this._attachCache && this._attachCache.get(id);
      if (hit) { this._attachCache.delete(id); this._attachCache.set(id, hit); } // LRU 갱신
      return hit || null;
    }
    /** 본문(Data URL)을 가져온다. 캐시 → 서버(store.get) 순. 같은 id의 동시 요청은 하나로 합친다. */
    async getAttachmentData(id) {
      const hit = this.peekAttachmentData(id);
      if (hit) return hit;
      if (!this._attachInflight) this._attachInflight = new Map();
      if (this._attachInflight.has(id)) return this._attachInflight.get(id);
      const p = (async () => {
        const row = await this.store.get('attachments', id);
        if (!row || !row.data) throw new Error('첨부파일 내용을 불러오지 못했습니다.');
        this._cacheAttachmentData(id, row.data);
        return row.data;
      })().finally(() => this._attachInflight.delete(id));
      this._attachInflight.set(id, p);
      return p;
    }
    /** 목록에서 이미지 썸네일을 보여야 하는 메뉴(증명사진/포스터)용: 본문을 백그라운드로 불러오고 끝나면 'change'를 낸다. */
    prefetchAttachmentData(rows) {
      const need = (rows || []).filter((a) => a && a.id && !this.peekAttachmentData(a.id));
      if (!need.length) return;
      Promise.all(need.map((a) => this.getAttachmentData(a.id).catch(() => null))).then((res) => {
        if (res.some(Boolean)) this.emit('change', { table: 'attachments', dataLoaded: true });
      });
    }
    async deleteAttachment(id) {
      await this.store.remove('attachments', id);
      if (this._attachCache && this._attachCache.has(id)) { this._attachChars -= this._attachCache.get(id).length; this._attachCache.delete(id); }
      const next = {};
      for (const [k, rows] of Object.entries(this.attachmentsByOwner)) next[k] = rows.filter((r) => r.id !== id);
      this.attachmentsByOwner = next;
      this.emit('change', { table: 'attachments' });
    }

    // ---- 이력/경력 관리 (7개 카테고리 공통 CRUD) ----
    // key: CAREER_TABLES의 키(education/certifications/trainings/memberships/awards/experiences/photos)
    async addCareerRecord(key, data) {
      const table = CAREER_TABLES[key];
      const existing = this.career[key] || [];
      const maxOrder = existing.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      // 등록 직후 바로 첨부파일을 붙일 수 있도록(다른 메뉴와 동일한 패턴), 생성된 행을 반환한다.
      const row = await this.store.create(table, { ...data, user_id: this.user.id, sort_order: maxOrder + 1 });
      await this.refreshAll();
      return row;
    }
    async updateCareerRecord(key, id, patch) {
      await this.store.update(CAREER_TABLES[key], id, patch);
      return this.refreshAll();
    }
    async deleteCareerRecord(key, id) {
      await this.store.softDelete(CAREER_TABLES[key], id);
      return this.refreshAll();
    }
    async deleteCareerRecordsBulk(key, ids) {
      for (const id of ids) await this.store.softDelete(CAREER_TABLES[key], id);
      return this.refreshAll();
    }
    async reorderCareerRecords(key, orderedIds) {
      const table = CAREER_TABLES[key];
      await Promise.all(orderedIds.map((id, idx) => this.store.update(table, id, { sort_order: idx })));
      return this.refreshAll();
    }

    // ---- 이력/경력: 기본 인적사항(1행) + 양식 문서 (v7.22.0) ----
    _careerDocError(e, what) {
      const msg = String(e?.message || e);
      if (/career_(documents|basic_info)/i.test(msg) && /(relation|schema cache|does not exist|find|42P01)/i.test(msg)) return new Error(`${what} 테이블이 없습니다. ${MIGRATION_0025_HINT}`);
      return e;
    }
    /** 기본 인적사항 저장(없으면 만들고 있으면 수정). 민감 정보 — 본인 행만(RLS). */
    async saveCareerBasicInfo(data) {
      const existing = this.careerBasic;
      try {
        if (existing && !existing._pending) return await this._optimisticUpdate('career_basic_info', existing.id, data, () => this.store.update('career_basic_info', existing.id, data));
        return (await this._optimisticCreate('career_basic_info', [{ ...data, user_id: this.user.id }]))[0];
      } catch (e) { throw this._careerDocError(e, '기본정보'); }
    }
    async addCareerDocument(data) {
      const maxOrder = this.careerDocuments.reduce((m, r) => Math.max(m, r.sort_order || 0), 0);
      try {
        return (await this._optimisticCreate('career_documents', [{ finals: [], mapping: {}, field_values: {}, status: 'draft', ...data, user_id: this.user.id, sort_order: maxOrder + 1 }]))[0];
      } catch (e) { throw this._careerDocError(e, '양식 문서'); }
    }
    async updateCareerDocument(id, patch) {
      try {
        return await this._optimisticUpdate('career_documents', id, patch, () => this.store.update('career_documents', id, patch));
      } catch (e) { throw this._careerDocError(e, '양식 문서'); }
    }
    /** 양식 문서 삭제: 첨부(양식 원본·최종본·기타)를 모두 지우고 행은 소프트 삭제. */
    async deleteCareerDocuments(ids) {
      for (const id of ids) {
        for (const a of this.getAttachments('career_documents', id)) await this.deleteAttachment(a.id).catch(() => {});
      }
      return this._optimisticRemove('career_documents', ids, () => Promise.all(ids.map((id) => this.store.softDelete('career_documents', id))));
    }
    /** 복제: 매칭 설정/값을 그대로 새 임시저장 문서로 만든다(양식 원본 첨부도 복사 — 원본을 지워도 복제본은 독립). */
    async duplicateCareerDocument(id) {
      const src = this.careerDocuments.find((d) => d.id === id);
      if (!src) throw new Error('복제할 문서를 찾지 못했습니다.');
      const row = await this.addCareerDocument({
        title: `${src.title} (복사본)`, template_name: src.template_name, template_kind: src.template_kind,
        mapping: src.mapping, field_values: src.field_values, status: 'draft', finals: [], template_attachment_id: null,
      });
      if (src.template_attachment_id) {
        try {
          const meta = this.getAttachments('career_documents', id).find((a) => a.id === src.template_attachment_id);
          const dataUrl = await this.getAttachmentData(src.template_attachment_id);
          const file = new File([window.dataUrlToBlob(dataUrl)], meta ? meta.name : src.template_name, { type: meta ? meta.mime_type : '' });
          const att = await this.addAttachment('career_documents', row.id, file);
          await this.updateCareerDocument(row.id, { template_attachment_id: att.id });
        } catch (e) { /* 양식 원본 복사 실패 — 편집 화면에서 다시 올릴 수 있다 */ }
      }
      return row;
    }

    // ---- 차량관리: 주행거리(간단 기록, 주유 없이 계기판만 기록) ----
    async addOdometerLog(vehicleId, data) {
      await this.store.create('vehicle_odometer_logs', { ...data, vehicle_id: vehicleId });
      return this.refreshAll();
    }
    async deleteOdometerLog(id) {
      await this.store.remove('vehicle_odometer_logs', id);
      return this.refreshAll();
    }

    // ---- 홈 "이번 주 활동 요약" (Health 주간 집계, 개발계획서 8.2) ----
    getWeeklyActivitySummary() {
      const todayIso = window.todayISO();
      const weekStart = window.addDays(todayIso, -6);
      const exerciseSessions = this.healthMetrics.filter((m) => m.metric_type === 'exercise' && window.localDateOf(m.recorded_at) >= weekStart).length;
      const doneSchedules = this.schedules.filter((s) => s.done && s.date >= weekStart && s.date <= todayIso).length;
      const checkins = Object.values(this.checkinsByChallenge)
        .flat()
        .filter((c) => c.checkin_date >= weekStart && c.checkin_date <= todayIso).length;
      const weightRows = this.healthMetrics
        .filter((m) => m.metric_type === 'weight')
        .slice()
        .sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''));
      const weightDelta = weightRows.length >= 2 ? Number((weightRows[weightRows.length - 1].value - weightRows[0].value).toFixed(1)) : null;
      // 가장 가까운(오늘 포함 앞으로 남은) D-day 한 건 — 홈 "이번 주 활동 요약"에 같이 보여준다.
      const upcoming = (window.sortDdays ? window.sortDdays(this.ddays, todayIso) : []).map((d) => ({ row: d, info: window.ddayInfo(d.target_date, todayIso, !!d.repeat_yearly) })).find((x) => !x.info.isPast);
      const nextDday = upcoming ? { title: upcoming.row.title, emoji: upcoming.row.emoji || '', text: upcoming.info.text, days: upcoming.info.days } : null;
      return { exerciseSessions, doneSchedules, checkins, weightDelta, nextDday };
    }
  }

  window.appState = new AppState();
})();
