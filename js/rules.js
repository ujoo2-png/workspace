// 자동 워크플로우 규칙 엔진 (순수 함수).
// 원칙(개발계획서 5.3): 자동화는 "제안형"이 기본이며, 파괴적 액션은 여기서 만들지 않는다.
// 이 모듈은 현재 데이터 스냅샷을 보고 "지금 발생해야 할 알림 후보" 목록을 계산만 한다.
// 실제 저장/중복 방지는 services/automationService.js에서 dedupeKey로 처리한다.
//
// 각 규칙은 Automation 화면(js/modules/automation.js)에서 개별적으로 켜고 끌 수 있다.
// enabledRules를 넘기지 않으면(null) 모든 규칙이 기본값으로 켜진 것으로 간주한다 —
// 그래서 이 함수의 기존 3-인자 호출부(단위 테스트 포함)는 그대로 동작한다.
//
// 일반 <script>로 로드되며 js/utils/date.js, js/predict.js가 먼저 로드되어 있어야 한다.
// globalThis를 쓰면 브라우저(window)와 Node(단위 테스트) 양쪽에서 동일하게 동작한다.
(function () {
  const { diffDays, todayISO, predictScheduleDensity, computeChallengeStreak } = globalThis;

  const RULE_DEFS = [
    { type: 'deadline', label: '프로젝트 마감 D-n 경고', defaultParams: { days: 7 } },
    { type: 'overdue_project', label: '프로젝트 마감 초과', defaultParams: {} },
    { type: 'stale_project', label: '프로젝트 진행 정체(14일+)', defaultParams: { idleDays: 14 } },
    { type: 'overdue_schedule', label: '지난 일정 미완료', defaultParams: {} },
    { type: 'congestion', label: '일정 밀집 예상', defaultParams: {} },
    { type: 'vehicle_insurance_expiry', label: '차량 보험 만료 임박', defaultParams: { days: 30 } },
    { type: 'vehicle_registration_expiry', label: '차량 등록 만료 임박', defaultParams: { days: 30 } },
    { type: 'challenge_at_risk', label: '챌린지 연속기록 끊길 위험', defaultParams: { minStreak: 3 } },
    { type: 'playlist_reminder', label: '문화생활 관람 예정 D-1 알림', defaultParams: { days: 1 } },
  ];

  function ruleConfig(enabledRules, type) {
    const def = RULE_DEFS.find((r) => r.type === type);
    const stored = enabledRules ? enabledRules[type] : null;
    return {
      enabled: stored ? stored.enabled !== false : true,
      params: { ...(def ? def.defaultParams : {}), ...(stored?.params || {}) },
    };
  }

  /**
   * @param {object} data
   * @param {object[]} data.projects
   * @param {object[]} data.schedules
   * @param {object[]} [data.vehicles] insurance_expiry/registration_expiry 필드 포함
   * @param {object[]} [data.challenges] 각 항목에 checkins:[{checkin_date}] 배열이 붙어 있어야 함
   * @param {object} config CONFIG.automation (deadlineWarningDays 등 레거시 기본값)
   * @param {string} todayIso
   * @param {object|null} enabledRules { [ruleType]: { enabled, params } } — Automation 화면에서 저장한 사용자 설정
   * @returns {{dedupeKey:string, type:string, severity:'info'|'warning'|'critical', title:string, message:string, relatedTable:string, relatedId:string}[]}
   */
  function runAutomationRules({ projects = [], schedules = [], vehicles = [], challenges = [], playlistItems = [] }, config = {}, todayIso = todayISO(), enabledRules = null) {
    const out = [];

    // 1) 프로젝트 마감 D-n 경고 / 마감 초과 (진행 중 상태만, 완료/보류 제외)
    const deadlineCfg = ruleConfig(enabledRules, 'deadline');
    const overdueProjectCfg = ruleConfig(enabledRules, 'overdue_project');
    const deadlineDays = config.deadlineWarningDays ?? deadlineCfg.params.days ?? 7;
    for (const p of projects) {
      if (!p.deadline || p.status !== 'in_progress' || p.deleted_at) continue;
      const d = diffDays(todayIso, p.deadline);
      if (deadlineCfg.enabled && d >= 0 && d <= deadlineDays) {
        out.push({
          dedupeKey: `deadline:${p.id}:${p.deadline}`,
          type: 'deadline',
          severity: d <= 2 ? 'critical' : 'warning',
          title: `마감 D-${d}: ${p.name}`,
          message: `프로젝트 "${p.name}"의 마감일이 ${d}일 남았습니다.`,
          relatedTable: 'projects',
          relatedId: p.id,
        });
      }
      if (overdueProjectCfg.enabled && d < 0) {
        out.push({
          dedupeKey: `overdue_project:${p.id}:${p.deadline}`,
          type: 'overdue_project',
          severity: 'critical',
          title: `마감 초과: ${p.name}`,
          message: `프로젝트 "${p.name}"의 마감일이 ${Math.abs(d)}일 지났습니다.`,
          relatedTable: 'projects',
          relatedId: p.id,
        });
      }
    }

    // 2) 진행률 정체(기본 14일 이상 기록 없음, 진행 중 상태)
    const staleCfg = ruleConfig(enabledRules, 'stale_project');
    if (staleCfg.enabled) {
      for (const p of projects) {
        if (p.status !== 'in_progress' || p.deleted_at) continue;
        const lastUpdate = p.lastProgressAt || p.created_at;
        if (!lastUpdate) continue;
        const idleDays = diffDays(lastUpdate.slice(0, 10), todayIso);
        if (idleDays >= (staleCfg.params.idleDays ?? 14)) {
          out.push({
            dedupeKey: `stale_project:${p.id}:${todayIso}`,
            type: 'stale_project',
            severity: 'info',
            title: `진행 정체: ${p.name}`,
            message: `"${p.name}" 프로젝트가 ${idleDays}일째 진행률 업데이트가 없습니다.`,
            relatedTable: 'projects',
            relatedId: p.id,
          });
        }
      }
    }

    // 3) 완료되지 않은 지난 일정 (오늘 이전, done=false)
    const overdueScheduleCfg = ruleConfig(enabledRules, 'overdue_schedule');
    if (overdueScheduleCfg.enabled) {
      for (const s of schedules) {
        if (s.done || !s.date) continue;
        const d = diffDays(s.date, todayIso);
        if (d > 0) {
          out.push({
            dedupeKey: `overdue_schedule:${s.id}:${todayIso}`,
            type: 'overdue_schedule',
            severity: 'warning',
            title: `지난 일정 미완료: ${s.title}`,
            message: `"${s.title}" 일정(${s.date})이 완료 처리되지 않았습니다.`,
            relatedTable: 'schedules',
            relatedId: s.id,
          });
        }
      }
    }

    // 4) 다음 7일 중 일정 과밀 예상일 경고
    const congestionCfg = ruleConfig(enabledRules, 'congestion');
    if (congestionCfg.enabled) {
      const density = predictScheduleDensity(schedules, todayIso);
      for (const day of density) {
        if (day.congested) {
          out.push({
            dedupeKey: `congestion:${day.date}`,
            type: 'congestion',
            severity: 'info',
            title: `일정 밀집 예상: ${day.date}`,
            message: `${day.date}에 일정이 ${day.count}건으로 평소(${day.average.toFixed(1)}건)보다 많습니다.`,
            relatedTable: 'schedules',
            relatedId: day.date,
          });
        }
      }
    }

    // 5) 차량 보험/등록 만료 D-n (개발계획서 8.2)
    const insuranceCfg = ruleConfig(enabledRules, 'vehicle_insurance_expiry');
    const registrationCfg = ruleConfig(enabledRules, 'vehicle_registration_expiry');
    for (const v of vehicles) {
      if (v.deleted_at) continue;
      if (insuranceCfg.enabled && v.insurance_expiry) {
        const d = diffDays(todayIso, v.insurance_expiry);
        if (d >= 0 && d <= (insuranceCfg.params.days ?? 30)) {
          out.push({
            dedupeKey: `vehicle_insurance:${v.id}:${v.insurance_expiry}`,
            type: 'vehicle_insurance_expiry',
            severity: d <= 7 ? 'critical' : 'warning',
            title: `보험 만료 D-${d}: ${v.name}`,
            message: `"${v.name}" 차량 보험 만료일이 ${d}일 남았습니다.`,
            relatedTable: 'vehicles',
            relatedId: v.id,
          });
        }
      }
      if (registrationCfg.enabled && v.registration_expiry) {
        const d = diffDays(todayIso, v.registration_expiry);
        if (d >= 0 && d <= (registrationCfg.params.days ?? 30)) {
          out.push({
            dedupeKey: `vehicle_registration:${v.id}:${v.registration_expiry}`,
            type: 'vehicle_registration_expiry',
            severity: d <= 7 ? 'critical' : 'warning',
            title: `차량 등록(검사) 만료 D-${d}: ${v.name}`,
            message: `"${v.name}" 차량 등록/검사 만료일이 ${d}일 남았습니다.`,
            relatedTable: 'vehicles',
            relatedId: v.id,
          });
        }
      }
    }

    // 6) 챌린지 연속기록이 끊길 위험 (오늘 아직 체크인 안 했고, 이어온 스트릭이 있음)
    const streakCfg = ruleConfig(enabledRules, 'challenge_at_risk');
    if (streakCfg.enabled) {
      for (const c of challenges) {
        if (c.status !== 'active') continue;
        const { streak, atRisk } = computeChallengeStreak(c.checkins || [], todayIso);
        if (atRisk && streak >= (streakCfg.params.minStreak ?? 3)) {
          out.push({
            dedupeKey: `challenge_at_risk:${c.id}:${todayIso}`,
            type: 'challenge_at_risk',
            severity: 'warning',
            title: `연속 ${streak}일 기록이 끊길 위험: ${c.title}`,
            message: `"${c.title}" 챌린지를 ${streak}일 연속 체크인했는데, 오늘은 아직입니다.`,
            relatedTable: 'challenges',
            relatedId: c.id,
          });
        }
      }
    }

    // 7) 문화생활 관람 예정 D-1 알림 (예정 상태 + 관람예정일이 임박한 항목)
    const playlistCfg = ruleConfig(enabledRules, 'playlist_reminder');
    if (playlistCfg.enabled) {
      for (const p of playlistItems) {
        if (p.deleted_at || p.status !== 'to_watch' || !p.event_date) continue;
        const d = diffDays(todayIso, p.event_date);
        if (d >= 0 && d <= (playlistCfg.params.days ?? 1)) {
          out.push({
            dedupeKey: `playlist_reminder:${p.id}:${p.event_date}`,
            type: 'playlist_reminder',
            severity: d === 0 ? 'warning' : 'info',
            title: `관람 예정 D-${d}: ${p.title}`,
            message: `"${p.title}" 관람/관람예정일이 ${d === 0 ? '오늘' : '내일'}입니다${p.venue_name ? ' (' + p.venue_name + ')' : ''}.`,
            relatedTable: 'playlist_items',
            relatedId: p.id,
          });
        }
      }
    }

    return out;
  }

  globalThis.runAutomationRules = runAutomationRules;
  globalThis.AUTOMATION_RULE_DEFS = RULE_DEFS;
})();
