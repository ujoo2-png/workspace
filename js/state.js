// 아주 작은 중앙 상태 저장소. 프레임워크 없이 pub/sub만으로 화면 갱신을 구동한다.
// 일반 <script>로 로드되며 js/store/index.js가 먼저 로드되어 window.getStore가 있어야 한다.
(function () {
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

      // 파일 첨부(모든 메뉴 공통): key = `${owner_table}:${owner_id}` -> [row]
      this.attachmentsByOwner = {};
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
        this.store.list('attachments', { where: { user_id: uid }, orderBy: 'created_at', ascending: false }).catch(() => []),
        this.store.get('profiles', uid).catch(() => null),
      ]);

      this.schedules = schedules;
      this.projects = this._attachProjectMeta(projects, progress);
      this.programs = programs;
      this.notifications = notifications;
      this.progressByProject = this._groupProgress(progress);

      this.challenges = challenges;
      this.checkinsByChallenge = this._groupBy(challengeCheckins, 'challenge_id');

      this.vehicles = vehicles;
      this.maintenanceByVehicle = this._groupBy(vehicleMaintenance, 'vehicle_id');
      this.fuelLogsByVehicle = this._groupBy(vehicleFuelLogs, 'vehicle_id');
      this.odometerLogsByVehicle = this._groupBy(vehicleOdometerLogs, 'vehicle_id');

      this.healthMetrics = healthMetrics;
      this.healthAppointments = healthAppointments;
      this.profile = profile;

      this.playlistItems = playlistItems;

      this.briefingTopics = briefingTopics;
      this.feedSources = feedSources;
      this.briefingItems = briefingItems;

      this.knowledgeDocs = knowledgeDocs;
      this.automationRules = automationRules;
      this.automationLogs = automationLogs;
      this.integrations = integrations;
      this.devlogs = devlogs;
      this.projectStagesByProject = this._groupBy(projectStages, 'project_id');
      this.attachmentsByOwner = this._groupBy(
        attachments.map((a) => ({ ...a, _ownerKey: `${a.owner_table}:${a.owner_id}` })),
        '_ownerKey'
      );

      this.emit('change', { schedules, projects: this.projects, programs, notifications });
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
    async addSchedule(data) {
      await this.store.create('schedules', { ...data, user_id: this.user.id, done: false });
      return this.refreshAll();
    }
    async updateSchedule(id, patch) {
      await this.store.update('schedules', id, patch);
      return this.refreshAll();
    }
    async deleteSchedule(id) {
      await this.store.remove('schedules', id);
      return this.refreshAll();
    }

    async addProject(data) {
      await this.store.create('projects', { ...data, user_id: this.user.id, status: data.status || 'in_progress' });
      return this.refreshAll();
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
      await this.store.create('programs', { ...data, user_id: this.user.id, run_count: 0 });
      return this.refreshAll();
    }
    async updateProgram(id, patch) {
      await this.store.update('programs', id, patch);
      return this.refreshAll();
    }
    async deleteProgram(id) {
      await this.store.remove('programs', id);
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
      return this.refreshAll();
    }

    async markNotificationRead(id) {
      await this.store.update('notifications', id, { is_read: true, read_at: new Date().toISOString() });
      return this.refreshAll();
    }

    // ---- 챌린저 ----
    async addChallenge(data) {
      await this.store.create('challenges', { ...data, user_id: this.user.id, status: data.status || 'active' });
      return this.refreshAll();
    }
    async updateChallenge(id, patch) {
      await this.store.update('challenges', id, patch);
      return this.refreshAll();
    }
    async deleteChallenge(id) {
      await this.store.remove('challenges', id);
      return this.refreshAll();
    }
    // (challenge_id, checkin_date) unique — 이미 체크인한 날짜면 덮어쓴다.
    async checkinChallenge(challengeId, checkinDate, value = 1, memo = null) {
      const existing = (this.checkinsByChallenge[challengeId] || []).find((c) => c.checkin_date === checkinDate);
      if (existing) {
        await this.store.update('challenge_checkins', existing.id, { value, memo });
      } else {
        await this.store.create('challenge_checkins', { challenge_id: challengeId, checkin_date: checkinDate, value, memo });
      }
      return this.refreshAll();
    }
    async deleteCheckin(id) {
      await this.store.remove('challenge_checkins', id);
      return this.refreshAll();
    }

    // ---- 차량관리 ----
    async addVehicle(data) {
      await this.store.create('vehicles', { ...data, user_id: this.user.id });
      return this.refreshAll();
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
      await this.store.create('vehicle_maintenance', { ...data, vehicle_id: vehicleId });
      return this.refreshAll();
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

    // ---- Health ----
    async addHealthMetric(data) {
      await this.store.create('health_metrics', { ...data, user_id: this.user.id, recorded_at: data.recorded_at || new Date().toISOString() });
      return this.refreshAll();
    }
    // 혈압처럼 한 번의 기록 입력이 여러 metric_type 행으로 나뉘어 저장돼야 하는 경우
    // (수축기/이완기) refreshAll을 한 번만 호출하도록 모아서 저장한다.
    async addHealthMetrics(rows) {
      for (const data of rows) {
        await this.store.create('health_metrics', { ...data, user_id: this.user.id, recorded_at: data.recorded_at || new Date().toISOString() });
      }
      return this.refreshAll();
    }
    async deleteHealthMetric(id) {
      await this.store.remove('health_metrics', id);
      return this.refreshAll();
    }
    // 병원/검진 일정을 등록하면 "일정" 메뉴에도 자동으로 나타나도록, 같은 내용의 일정을
    // 함께 만들고 그 id를 health_appointments.schedule_id에 저장해 묶어둔다(1.2처럼
    // 참고용 오버레이가 아니라 실제 내 일정에 반영되는 것이 사용자 의도이므로 자동 추가한다).
    async addHealthAppointment(data) {
      const appt = await this.store.create('health_appointments', { ...data, user_id: this.user.id });
      try {
        const schedule = await this.store.create('schedules', {
          user_id: this.user.id,
          done: false,
          title: `🏥 ${data.title}`,
          date: data.appointment_date,
          memo: `Health에서 자동 추가된 일정입니다.${data.location ? ' 장소: ' + data.location : ''}`,
        });
        await this.store.update('health_appointments', appt.id, { schedule_id: schedule.id });
      } catch (e) {
        // 일정 자동 추가에 실패해도 Health 쪽 등록 자체는 유지한다.
      }
      return this.refreshAll();
    }
    async updateHealthAppointment(id, patch) {
      const current = (this.healthAppointments || []).find((a) => a.id === id);
      await this.store.update('health_appointments', id, patch);
      // 날짜/제목/장소가 바뀌면 연동된 일정도 같이 갱신한다.
      if (current?.schedule_id && (patch.title !== undefined || patch.appointment_date !== undefined || patch.location !== undefined)) {
        const next = { ...current, ...patch };
        await this.store.update('schedules', current.schedule_id, {
          title: `🏥 ${next.title}`,
          date: next.appointment_date,
          memo: `Health에서 자동 추가된 일정입니다.${next.location ? ' 장소: ' + next.location : ''}`,
        }).catch(() => {});
      }
      return this.refreshAll();
    }
    async deleteHealthAppointment(id) {
      const current = (this.healthAppointments || []).find((a) => a.id === id);
      if (current?.schedule_id) {
        await this.store.remove('schedules', current.schedule_id).catch(() => {});
      }
      await this.store.remove('health_appointments', id);
      return this.refreshAll();
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
      await this.store.create('knowledge_docs', { ...data, user_id: this.user.id, status: data.status || 'active' });
      return this.refreshAll();
    }
    async updateKnowledgeDoc(id, patch) {
      await this.store.update('knowledge_docs', id, patch);
      return this.refreshAll();
    }
    async deleteKnowledgeDoc(id) {
      await this.store.softDelete('knowledge_docs', id);
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
      await this.store.create('devlogs', { ...data, user_id: this.user.id });
      return this.refreshAll();
    }
    async updateDevlog(id, patch) {
      await this.store.update('devlogs', id, patch);
      return this.refreshAll();
    }
    async deleteDevlog(id) {
      await this.store.softDelete('devlogs', id);
      return this.refreshAll();
    }

    // ---- 프로젝트 진척 단계(간트차트 항목) ----
    async addProjectStage(projectId, data) {
      const existing = this.projectStagesByProject[projectId] || [];
      const seq = existing.length ? Math.max(...existing.map((s) => s.seq || 0)) + 1 : 0;
      await this.store.create('project_stages', { ...data, project_id: projectId, user_id: this.user.id, seq });
      return this.refreshAll();
    }
    async updateProjectStage(id, patch) {
      await this.store.update('project_stages', id, patch);
      return this.refreshAll();
    }
    async deleteProjectStage(id) {
      await this.store.remove('project_stages', id);
      return this.refreshAll();
    }
    async reorderProjectStages(projectId, orderedIds) {
      await Promise.all(orderedIds.map((id, seq) => this.store.update('project_stages', id, { seq })));
      return this.refreshAll();
    }

    // ---- 파일 첨부 (모든 메뉴 공통: 일정/프로젝트단계/챌린저/차량/Devlog/문화생활 등) ----
    getAttachments(ownerTable, ownerId) {
      return this.attachmentsByOwner[`${ownerTable}:${ownerId}`] || [];
    }
    // file: File 객체. base64 Data URL로 인코딩해 저장한다(로컬 모드와 Supabase 모드 모두
    // 별도 스토리지 버킷 설정 없이 동일하게 동작하게 하기 위함). 데모 성격의 개인 워크스페이스이므로
    // 용량은 파일당 4MB로 제한한다.
    async addAttachment(ownerTable, ownerId, file) {
      const MAX_BYTES = 4 * 1024 * 1024;
      if (file.size > MAX_BYTES) throw new Error('파일이 너무 큽니다(최대 4MB).');
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('파일을 읽는 중 오류가 발생했습니다.'));
        reader.readAsDataURL(file);
      });
      await this.store.create('attachments', {
        user_id: this.user.id,
        owner_table: ownerTable,
        owner_id: ownerId,
        name: file.name,
        mime_type: file.type || 'application/octet-stream',
        size: file.size,
        data: dataUrl,
      });
      return this.refreshAll();
    }
    async deleteAttachment(id) {
      await this.store.remove('attachments', id);
      return this.refreshAll();
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
      const exerciseSessions = this.healthMetrics.filter((m) => m.metric_type === 'exercise' && (m.recorded_at || '').slice(0, 10) >= weekStart).length;
      const doneSchedules = this.schedules.filter((s) => s.done && s.date >= weekStart && s.date <= todayIso).length;
      const checkins = Object.values(this.checkinsByChallenge)
        .flat()
        .filter((c) => c.checkin_date >= weekStart && c.checkin_date <= todayIso).length;
      const weightRows = this.healthMetrics
        .filter((m) => m.metric_type === 'weight')
        .slice()
        .sort((a, b) => (a.recorded_at || '').localeCompare(b.recorded_at || ''));
      const weightDelta = weightRows.length >= 2 ? Number((weightRows[weightRows.length - 1].value - weightRows[0].value).toFixed(1)) : null;
      return { exerciseSessions, doneSchedules, checkins, weightDelta };
    }
  }

  window.appState = new AppState();
})();
