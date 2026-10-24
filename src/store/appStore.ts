import { computed, reactive, readonly, ref } from 'vue';
import type { AppState, FoodEntry, Profile, Session, SessionExercise, SetRecord, WeightEntry } from '../domain/types';
import { addDays, businessDate } from '../domain/units';
import { loadState, saveState } from './repository';
import { seedState } from './seed';
import { TEMPLATE_BY_ID, TEMPLATES } from '../content/exercises';
import type { Template } from '../content/types';
import {
  blankTemplate,
  cloneTemplate,
  isSameTemplate,
  validateTemplate,
} from '../domain/template';
import {
  buildBackfill,
  changeSessionDate,
  liveSessions,
  restoreTombstone,
  skipRemainingSets,
  tombstone,
  updateSet,
  type BackfillInput,
} from '../domain/amend';
import {
  changeMinimumTarget,
  ensureWeekGoals,
  mondayOf,
  openOccurrencesForWeek,
  runOccurrenceCommand,
  switchTemplate,
  type OccurrenceCommand,
} from '../domain/plan';
import type { PlannedOccurrence, WeekGoal } from '../domain/week';
import {
  applyImport,
  buildExport,
  previewImport,
  type ImportMode,
  type ImportPreview,
} from '../domain/transfer';

const state = reactive<AppState>(seedState());
const ready = ref(false);
const saveError = ref<string | null>(null);
const savedAt = ref<string | null>(null);
let saveTimer: number | null = null;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

async function persist(): Promise<void> {
  try {
    await saveState(state);
    saveError.value = null;
    savedAt.value = new Date().toISOString();
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败';
  }
}

function schedulePersist(): void {
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 120);
}

export const store = {
  state: readonly(state) as Readonly<AppState>,
  ready,
  saveError,
  savedAt,

  async init(): Promise<void> {
    let fromSeed = false;
    try {
      const loaded = await Promise.race([
        loadState(),
        new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1200)),
      ]);
      if (loaded && loaded.version === 2) {
        Object.assign(state, loaded);
        state.profile = { ...state.profile, ...loaded.profile };
        // 老数据可能缺新字段，补齐但不覆盖已有值
        if (!state.datasetId) state.datasetId = `ds_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
        state.lastBackupKey ??= null;
        state.customTemplates ??= [];
        state.occurrences ??= [];
        state.weekGoals ??= [];
      } else {
        Object.assign(state, seedState());
        fromSeed = true;
      }
    } catch {
      Object.assign(state, seedState());
      fromSeed = true;
    } finally {
      ready.value = true;
      // 种子数据必须立即落盘：否则每次刷新都会换 datasetId，
      // 导致自己导出的备份在下次导入时被判为"另一个数据集"。
      if (fromSeed) void persist();
    }
  },

  updateProfile(patch: Partial<Profile>): void {
    Object.assign(state.profile, patch);
    if (patch.weeklyTarget !== undefined) state.weeklyGoal = patch.weeklyTarget;
    schedulePersist();
  },

  setTemplate(templateId: string | null): void {
    state.activeTemplateId = templateId;
    schedulePersist();
  },

  createSession(session: Session): Session {
    state.sessions.push(session);
    schedulePersist();
    return session;
  },

  findSession(id: string): Session | undefined {
    return state.sessions.find((s) => s.id === id);
  },

  updateSession(id: string, patch: Partial<Session>): void {
    const s = state.sessions.find((x) => x.id === id);
    if (!s) return;
    Object.assign(s, patch);
    schedulePersist();
  },

  addExerciseToSession(sessionId: string, ex: SessionExercise): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    ex.order = s.exercises.length;
    s.exercises.push(ex);
    schedulePersist();
  },

  /**
   * 换动作：按 11:28「替代后新建记录，原已完成组保留原动作」。
   * - 旧动作保留已完成的组（历史事实不消失）
   * - 旧动作未录的组转为 skipped
   * - 新增一个动作项承载新动作，从空组开始，不继承负荷
   */
  replaceExerciseInSession(sessionId: string, exerciseId: string, nextExerciseId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const target = s.exercises.find((x) => x.exerciseId === exerciseId);
    if (!target) return;

    // 旧动作：保留完成组，其余标 skipped
    for (const set of target.sets) {
      if (set.status !== 'completed') set.status = 'skipped';
    }

    // 新动作：全新一组计划组
    const targetSets = Math.max(1, target.targetSets);
    const next: typeof target = {
      id: uid('se'),
      exerciseId: nextExerciseId,
      order: target.order + 1,
      targetSets,
      repMin: target.repMin,
      repMax: target.repMax,
      restSeconds: target.restSeconds,
      incrementGrams: target.incrementGrams,
      sets: Array.from({ length: targetSets }, () => ({
        id: uid('set'),
        kind: 'work' as const,
        status: 'planned' as const,
        loadGrams: null,
        reps: null,
        durationSeconds: null,
        distanceMeters: null,
        rpe: null,
        completedAt: null,
      })),
    };
    // 插到旧动作之后，并重排 order
    const at = s.exercises.indexOf(target);
    s.exercises.splice(at + 1, 0, next);
    s.exercises.forEach((x, i) => {
      x.order = i;
    });
    schedulePersist();
  },
  removeExerciseFromSession(sessionId: string, exerciseId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    s.exercises = s.exercises.filter((x) => x.exerciseId !== exerciseId);
    s.exercises.forEach((x, i) => {
      x.order = i;
    });
    schedulePersist();
  },

  completeSet(sessionId: string, exerciseId: string, setId: string, patch: Partial<SetRecord>): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const ex = s.exercises.find((x) => x.exerciseId === exerciseId);
    if (!ex) return;
    const set = ex.sets.find((x) => x.id === setId);
    if (!set) return;
    Object.assign(set, patch, { status: 'completed', completedAt: new Date().toISOString() });
    schedulePersist();
  },

  skipSet(sessionId: string, exerciseId: string, setId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    const ex = s.exercises.find((x) => x.exerciseId === exerciseId);
    const set = ex?.sets.find((x) => x.id === setId);
    if (!set) return;
    set.status = 'skipped';
    schedulePersist();
  },

  addSet(sessionId: string, exerciseId: string): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    const ex = s?.exercises.find((x) => x.exerciseId === exerciseId);
    if (!ex) return;
    const last = ex.sets[ex.sets.length - 1];
    ex.sets.push({
      id: uid('set'),
      kind: 'work',
      status: 'planned',
      loadGrams: last?.loadGrams ?? null,
      reps: last?.reps ?? null,
      durationSeconds: null,
      distanceMeters: null,
      rpe: null,
      completedAt: null,
    });
    ex.targetSets += 1;
    schedulePersist();
  },

  addWeight(grams: number, date = businessDate(), note = ''): void {
    const existing = state.weights.find((w) => w.date === date);
    if (existing) {
      existing.grams = grams;
      existing.note = note;
    } else {
      state.weights.push({ id: uid('w'), date, grams, note } as WeightEntry);
      state.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
    }
    schedulePersist();
  },

  removeWeight(date: string): void {
    state.weights = state.weights.filter((w) => w.date !== date);
    schedulePersist();
  },

  addFood(entry: Omit<FoodEntry, 'id' | 'createdAt'>): void {
    state.foods.push({ ...entry, id: uid('f'), createdAt: new Date().toISOString() });
    schedulePersist();
  },

  removeFood(id: string): void {
    state.foods = state.foods.filter((f) => f.id !== id);
    schedulePersist();
  },

  setTargets(kcal: number | null, protein: number | null): void {
    state.targetKcal = kcal;
    state.targetProtein = protein;
    schedulePersist();
  },

  newId(prefix: string): string {
    return uid(prefix);
  },
  // ---------- 周计划 ----------

  occurrencesForWeek(weekStart: string): PlannedOccurrence[] {
    return state.occurrences.filter((o) => o.weekStart === weekStart);
  },

  goalForWeek(weekStart: string): WeekGoal | null {
    return state.weekGoals.find((g) => g.weekStart === weekStart) ?? null;
  },

  runPlanCommand(command: OccurrenceCommand): string | null {
    const result = runOccurrenceCommand({
      command,
      occurrences: [...state.occurrences],
      goals: [...state.weekGoals],
      sessions: [...state.sessions],
      recordedAt: new Date().toISOString(),
      idFactory: uid,
    });
    if (result.error) return result.error;
    state.occurrences = result.occurrences;
    state.weekGoals = result.goals;
    schedulePersist();
    return null;
  },

  setMinimumTarget(weekStart: string, next: number, reason: string): string | null {
    const result = changeMinimumTarget({
      goals: [...state.weekGoals],
      occurrences: [...state.occurrences],
      weekStart,
      next,
      reason,
      recordedAt: new Date().toISOString(),
      idFactory: uid,
    });
    if (result.error) return result.error;
    state.weekGoals = result.goals;
    schedulePersist();
    return null;
  },

  applyTemplate(nextId: string): string | null {
    const next = TEMPLATE_BY_ID.get(nextId);
    if (!next) return '模板不存在';
    const today = businessDate();
    const result = switchTemplate({
      occurrences: [...state.occurrences],
      goals: [...state.weekGoals],
      next,
      effectiveFrom: today,
      sessions: [...state.sessions],
      idFactory: uid,
      recordedAt: new Date().toISOString(),
    });
    state.occurrences = result.occurrences;
    state.weekGoals = result.goals;
    state.activeTemplateId = nextId;
    state.activeTemplateSince = today;
    schedulePersist();
    return null;
  },

  creditSessionToOccurrence(sessionId: string, occurrenceId: string | null): void {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return;
    s.occurrenceId = occurrenceId ?? undefined;
    s.goalCreditConfirmed = occurrenceId !== null;
    schedulePersist();
  },

  openOccurrences(weekStart: string, satisfiedIds: string[]): PlannedOccurrence[] {
    return openOccurrencesForWeek([...state.occurrences], weekStart, satisfiedIds);
  },

  ensurePlanAhead(): void {
    const template = state.activeTemplateId ? TEMPLATE_BY_ID.get(state.activeTemplateId) : null;
    if (!template) return;
    const today = businessDate();
    const from = mondayOf(today);
    const missing = [0, 1, 2, 3]
      .map((i) => addDays(from, i * 7))
      .filter((w) => !state.occurrences.some((o) => o.weekStart === w));
    if (!missing.length) return;
    let occ = [...state.occurrences];
    for (const weekStart of missing) {
      for (const day of template.days) {
        const date = addDays(weekStart, day.slot);
        if (date < today) continue;
        occ.push({
          id: uid('occ'),
          planVersionId: `${template.id}@v${template.version}`,
          weekStart,
          originalDate: date,
          scheduledDate: date,
          slotId: `${template.id}-${day.id}`,
          title: day.title,
          exerciseIds: day.exercises.map((e) => e.exerciseId),
          disposition: 'scheduled',
        });
      }
    }
    state.occurrences = occ;
    state.weekGoals = ensureWeekGoals([...state.weekGoals], occ);
    schedulePersist();
  },

  // ---------- 模板编辑 ----------

  /** 取模板：先查自建，再查内置。 */
  templateById(id: string): Template | null {
    return state.customTemplates.find((t) => t.id === id) ?? TEMPLATE_BY_ID.get(id) ?? null;
  },

  /** 列表：同一 ID 以自建/改版后的为最新，避免出现两个同名模板。 */
  allTemplates(): Template[] {
    const customIds = new Set(state.customTemplates.map((t) => t.id));
    const builtins = TEMPLATES.filter((t) => !customIds.has(t.id));
    return [...builtins, ...state.customTemplates];
  },

  /** 保存模板；若是已启用模板的内容改动，自动升版本并按新版本重排未来安排。 */
  saveTemplate(next: Template, options: { applyToPlan?: boolean } = {}): string | null {
    const issues = validateTemplate(next);
    if (issues.length) return issues[0]!.message;

    const existingIndex = state.customTemplates.findIndex((t) => t.id === next.id);
    const builtin = TEMPLATE_BY_ID.get(next.id);

    if (existingIndex >= 0) {
      state.customTemplates = state.customTemplates.map((t, i) => (i === existingIndex ? next : t));
    } else if (builtin && isSameTemplate(builtin, next)) {
      // 内置模板未改动，无需存副本
    } else {
      state.customTemplates = [...state.customTemplates, next];
    }

    if (options.applyToPlan !== false && state.activeTemplateId === next.id) {
      const error = store.applyTemplate(next.id);
      if (error) return error;
    }
    schedulePersist();
    return null;
  },

  createTemplate(): Template {
    const t = blankTemplate(uid('tpl'));
    state.customTemplates = [...state.customTemplates, t];
    schedulePersist();
    return t;
  },

  /** 基于内置模板复制一份可编辑副本。 */
  duplicateTemplate(sourceId: string): Template | null {
    const source = store.templateById(sourceId);
    if (!source) return null;
    const copy: Template = {
      ...cloneTemplate(source),
      id: uid('tpl'),
      title: `${source.title}（副本）`,
      version: 1,
    };
    // 训练日 ID 必须重新生成，避免与源模板 slotId 冲突
    copy.days = copy.days.map((d, i) => ({
      ...d,
      id: `${copy.id}-d${i}`,
      exercises: d.exercises.map((e) => ({ ...e })),
    }));
    state.customTemplates = [...state.customTemplates, copy];
    schedulePersist();
    return copy;
  },

  deleteTemplate(id: string): void {
    state.customTemplates = state.customTemplates.filter((t) => t.id !== id);
    if (state.activeTemplateId === id) state.activeTemplateId = null;
    schedulePersist();
  },

  // ---------- 训练更正 / 补录 ----------

  getSession(id: string): Session | undefined {
    return state.sessions.find((s) => s.id === id);
  },

  /** 响应式单场查询：视图里用 computed 包裹后，数组被替换时会正确重算。 */
  sessionById(id: string): Session | null {
    return state.sessions.find((s) => s.id === id) ?? null;
  },

  /** 可编辑/可删除的场次：过滤 tombstone 后展示。 */
  visibleSessions(): Session[] {
    return liveSessions([...state.sessions]);
  },

  backfillSession(input: BackfillInput): string | null {
    const result = buildBackfill(input, businessDate(), uid);
    if (result.issue) return result.issue;
    if (result.session) state.sessions.push(result.session);
    schedulePersist();
    return null;
  },

  amendSessionDate(sessionId: string, nextDate: string): string | null {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return '找不到这场训练';
    const result = changeSessionDate(s, nextDate, mondayOf, businessDate());
    if (result.issue) return result.issue;
    if (result.session) {
      state.sessions = state.sessions.map((x) => (x.id === sessionId ? result.session! : x));
    }
    schedulePersist();
    return null;
  },

  editSet(sessionId: string, exerciseId: string, setId: string, patch: Partial<SetRecord>): string | null {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return '找不到这场训练';
    const result = updateSet(s, exerciseId, setId, patch);
    if (result.issue) return result.issue;
    if (result.session) {
      state.sessions = state.sessions.map((x) => (x.id === sessionId ? result.session! : x));
    }
    schedulePersist();
    return null;
  },

  deleteSession(sessionId: string): void {
    state.sessions = state.sessions.map((s) =>
      s.id === sessionId ? tombstone(s) : s,
    );
    schedulePersist();
  },

  restoreSession(sessionId: string): void {
    state.sessions = state.sessions.map((s) =>
      s.id === sessionId ? restoreTombstone(s) : s,
    );
    schedulePersist();
  },

  skipRemaining(sessionId: string): void {
    state.sessions = state.sessions.map((s) =>
      s.id === sessionId ? skipRemainingSets(s) : s,
    );
    schedulePersist();
  },

  /** 自报完成：把没有组记录的场次标记为本人确认。 */
  markSelfReported(sessionId: string): void {
    state.sessions = state.sessions.map((s) =>
      s.id === sessionId ? { ...s, completionBasis: 'selfReported' as const } : s,
    );
    schedulePersist();
  },

  // ---------- 导出 / 导入 / 备份 ----------

  /** 稳定数据集 ID：首次导出时生成并持久化，之后不变。 */
  datasetId(): string {
    if (!state.datasetId) {
      state.datasetId = `ds_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      schedulePersist();
    }
    return state.datasetId;
  },

  buildExportJson(): string {
    const env = buildExport(state, store.datasetId());
    return JSON.stringify(env, null, 2);
  },

  previewImportJson(raw: string): ImportPreview {
    return previewImport(raw, { currentDatasetId: store.datasetId(), currentState: state });
  },

  applyImportPreview(preview: ImportPreview, mode: ImportMode): string | null {
    const result = applyImport(preview, state, mode);
    if (result.backup) {
      // 替换模式：先把旧状态另存为备份，失败可回滚
      const backupKey = `tieguan.backup.${Date.now()}`;
      try {
        localStorage.setItem(backupKey, JSON.stringify(result.backup));
        state.lastBackupKey = backupKey;
      } catch {
        return '无法写入备份（存储空间不足），已取消替换';
      }
    }
    Object.assign(state, result.state);
    schedulePersist();
    return null;
  },

  /** 读取最近一次自动备份，用于误操作恢复。 */
  latestBackup(): { key: string; state: AppState } | null {
    if (!state.lastBackupKey) return null;
    try {
      const raw = localStorage.getItem(state.lastBackupKey);
      if (!raw) return null;
      return { key: state.lastBackupKey, state: JSON.parse(raw) as AppState };
    } catch {
      return null;
    }
  },

  restoreBackup(): string | null {
    const backup = store.latestBackup();
    if (!backup) return '没有可恢复的备份';
    Object.assign(state, backup.state);
    schedulePersist();
    return null;
  },

  /** 清空本机：删除数据但保留数据集 ID 以外的一切重置为种子。 */
  wipeLocal(): void {
    const datasetId = state.datasetId;
    const fresh = seedState();
    Object.assign(state, fresh, { datasetId });
    schedulePersist();
  },
};

const weightSeries = computed<WeightEntry[]>(() =>
  [...store.state.weights].sort((a, b) => (a.date < b.date ? -1 : 1)),
);

const latestWeight = computed<WeightEntry | null>(
  () => weightSeries.value[weightSeries.value.length - 1] ?? null,
);

export const derived = { weightSeries, latestWeight };





