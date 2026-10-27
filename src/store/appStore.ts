import { backupKey as makeBackupKey, syncBackupKey as makeSyncBackupKey } from './storageKeys';
import { computed, reactive, readonly, ref, toRaw } from 'vue';
import type { AppState, FoodEntry, Profile, ReminderSettings, Session, SessionExercise, SetRecord, WaterEntry, WeightEntry } from '../domain/types';
import { buildWarmup } from '../domain/warmup';
import { addDays, businessDate, weekStartOf } from '../domain/units';
import { applyShift, previewShift, type OverflowStrategy, type ShiftPreview, type ShiftScope } from '../domain/shift';
import { waterTotal } from '../domain/water';
import { normalizeReminders } from '../domain/reminders';
import { withoutPlanPlaceholder } from '../domain/meal-plan';
import { lastExerciseSets } from '../domain/metrics';
import { validateGoal, type Goal } from '../domain/goals';
import { stateFingerprint } from '../domain/ai-adopt';
import { loadState, saveState } from './repository';
import { seedState } from './seed';
import { loadSyncState, saveSyncState } from './syncStateStore';
import { EXERCISE_BY_ID, TEMPLATE_BY_ID, TEMPLATES } from '../content/exercises';
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
import { isValidCompletedSession, type PlannedOccurrence, type WeekGoal } from '../domain/week';
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
const initError = ref<string | null>(null);
const generation = ref(loadSyncState().generation);
let saveTimer: number | null = null;

function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** 模块级 ID 生成，供不依赖 store 实例的构造逻辑复用。 */
const nextId = uid;

/**
 * 纯构造：把一次训练加进 state 并返回。
 * 抽成模块级函数是为了避免在 reactive 对象里用 `this`——
 * 方法被解构或作为回调传递时 `this` 会丢，属于隐蔽 bug 源。
 */
function createSessionRecord(session: Session): Session {
  state.sessions.push(session);
  schedulePersist();
  return session;
}

async function persist(): Promise<boolean> {
  if (initError.value) return false;
  try {
    await saveState(state);
    saveError.value = null;
    savedAt.value = new Date().toISOString();
    return true;
  } catch (error) {
    saveError.value = error instanceof Error ? error.message : '保存失败';
    return false;
  }
}

function resolveTemplate(id: string): Template | null {
  return state.customTemplates.find((t) => t.id === id) ?? TEMPLATE_BY_ID.get(id) ?? null;
}

/**
 * 预建未来 4 周的计划发生项。
 *
 * 提取为模块级函数而不是 store 方法，因为 init() 需要调用它，
 * 而 init 内用 this 访问其他方法会踩响应式代理的坑。
 */
function ensurePlanAheadImpl(state: AppState): void {
  const template = state.activeTemplateId ? resolveTemplate(state.activeTemplateId) : null;
  if (!template) return;
  const today = businessDate();
  const from = mondayOf(today);
  const missing = [0, 1, 2, 3]
    .map((i) => addDays(from, i * 7))
    .filter((w) => !state.occurrences.some((o) => o.weekStart === w));
  if (!missing.length) return;
  const occ = [...state.occurrences];
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
        title: day.title,
        slotId: `${template.id}-${day.id}`,
        exerciseIds: day.exercises.map((e) => e.exerciseId),
        disposition: 'scheduled',
      });
    }
  }
  state.occurrences = occ;
  state.weekGoals = ensureWeekGoals([...state.weekGoals], occ);
  schedulePersist();
}

function schedulePersist(): void {
  if (initError.value) return;
  generation.value += 1;
  const checkpoint = loadSyncState();
  saveSyncState({ ...checkpoint, generation: generation.value });
  if (saveTimer !== null) window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = null;
    void persist();
  }, 120);
}

/**
 * 找出某个模板训练日在指定业务日期上的发生项。
 *
 * ignoreDate=true 时返回该周这一 slot 的项目，不管它被顺延到了哪天——
 * 训练页需要知道"今天这项被挪走了"，否则会当成新的一天重新开始。
 */
function planOccurrenceForDay(
  state: AppState,
  templateId: string,
  dayId: string,
  date: string,
  options: { ignoreDate?: boolean; includeDisposed?: boolean } = {},
): PlannedOccurrence | null {
  const weekStart = mondayOf(date);
  const slotId = `${templateId}-${dayId}`;
  const template = resolveTemplate(templateId);
  const week = state.occurrences.filter(
    (o) =>
      o.weekStart === weekStart &&
      o.slotId === slotId &&
      (!template || o.planVersionId === `${templateId}@v${template.version}`) &&
      (options.includeDisposed || o.disposition === 'scheduled'),
  );
  if (!week.length) return null;
  return week.find((o) => o.scheduledDate === date) ?? (options.ignoreDate ? week[0]! : null);
}

export const store = {
  state: readonly(state) as Readonly<AppState>,
  ready,
  saveError,
  savedAt,
  initError,
  generation,

  /** 等待当前内存版本真正落盘；调用方据此决定是否展示成功。 */
  async flush(): Promise<boolean> {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    return persist();
  },

  async init(): Promise<void> {
    if (saveTimer !== null) window.clearTimeout(saveTimer);
    saveTimer = null;
    ready.value = false;
    initError.value = null;
    try {
      const loaded = await loadState();
      if (loaded && loaded.version !== 2) {
        throw new Error('数据来自不支持的版本，请更新应用或恢复备份；原始数据未改动');
      }
      if (loaded) {
        if (!loaded.profile || !Array.isArray(loaded.sessions) || !Array.isArray(loaded.weights) || !Array.isArray(loaded.foods)) {
          throw new Error('本地数据结构损坏，原始数据未改动，请恢复备份');
        }
        const restored = { ...seedState(), ...loaded, profile: { ...seedState().profile, ...loaded.profile } };
        restored.profile.restrictionsConfirmed = loaded.profile.restrictionsConfirmed === true;
        restored.profile.allergies = Array.isArray(loaded.profile.allergies) ? loaded.profile.allergies : [];
        restored.profile.restrictions = Array.isArray(loaded.profile.restrictions) ? loaded.profile.restrictions : [];
        restored.lastBackupKey ??= null;
        restored.customTemplates ??= [];
        restored.occurrences ??= [];
        restored.weekGoals ??= [];
        restored.goals ??= [];
        Object.assign(state, restored);
      } else {
        Object.assign(state, seedState());
        await persist();
      }
      ensurePlanAheadImpl(state);
      ready.value = true;
    } catch (error) {
      initError.value = error instanceof Error ? error.message : '读取失败，原始数据未改动';
      // 不播种、不补计划、不保存：保留未知版本或损坏数据供用户恢复。
    }
  },

  /**
   * 完成首次引导。
   *
   * 原实现把 onboarded 硬编为 true，等于宣称"用户已完成引导"却从未引导过；
   * 新用户会直接看到 42 场示例训练并误以为是自己的数据。
   */
  completeOnboarding(input: {
    templateId: string;
    weeklyGoal: number;
    keepDemoData: boolean;
    /** 可选：引导第四步设定的目标。允许为空。 */
    bodyGoalKg?: number | null;
    strengthGoal?: { exerciseId: string; targetKg: number } | null;
  }): void {
    if (!input.keepDemoData) {
      // 清空示例业务数据，但保留 datasetId 与内容包
      state.sessions = [];
      state.weights = [];
      state.foods = [];
      state.occurrences = [];
      state.weekGoals = [];
      state.bodyGoalGrams = null;
    }
    state.activeTemplateId = input.templateId;
    state.activeTemplateSince = businessDate();
    state.weeklyGoal = input.weeklyGoal;
    state.profile.weeklyTarget = input.weeklyGoal;

    /*
     * 引导第四步的目标（可跳过）。
     * 体重目标需要起点：用当前最新体重作起点，没有记录则留空，
     * 由 goals 的进度计算显示"缺少起始体重"。
     */
    if (input.bodyGoalKg != null && input.bodyGoalKg > 0) {
      const latest = [...state.weights].sort((a, b) => (a.date < b.date ? 1 : -1))[0] ?? null;
      state.goals = state.goals.filter((g) => g.kind !== 'bodyweight');
      state.goals.push({
        kind: 'bodyweight',
        targetGrams: Math.round(input.bodyGoalKg * 1000),
        startGrams: latest?.grams ?? null,
        targetDate: null,
        createdAt: new Date().toISOString(),
      });
      state.bodyGoalGrams = Math.round(input.bodyGoalKg * 1000);
    }
    if (input.strengthGoal && input.strengthGoal.targetKg > 0) {
      const sg = input.strengthGoal;
      state.goals = state.goals.filter(
        (g) => !(g.kind === 'strength' && g.exerciseId === sg.exerciseId),
      );
      state.goals.push({
        kind: 'strength',
        exerciseId: sg.exerciseId,
        targetGrams: Math.round(sg.targetKg * 1000),
        targetDate: null,
        createdAt: new Date().toISOString(),
      });
    }
    state.onboarded = true;

    /*
     * 选择"从零开始"时上面把 occurrences 清空了，必须立刻按新模板重建本周计划。
     * 之前只在 init() 里 ensurePlanAhead，于是新用户进来看到"本周没有设定计划 0/0"，
     * 刷新一次才正常——第一条路径就断在最核心的周目标上。
     */
    ensurePlanAheadImpl(state);

    schedulePersist();
  },

  // ---------- 目标 ----------

  /** 新增或替换同类型目标（体重/力量按 exerciseId 唯一，频率唯一）。 */
  setGoal(goal: Goal): string | null {
    const err = validateGoal(goal);
    if (err) return err;
    const existing = state.goals.findIndex((g) => {
      if (g.kind !== goal.kind) return false;
      if (g.kind === 'strength' && goal.kind === 'strength') return g.exerciseId === goal.exerciseId;
      return true;
    });
    if (existing >= 0) state.goals.splice(existing, 1, goal);
    else state.goals.push(goal);
    if (goal.kind === 'bodyweight') state.bodyGoalGrams = goal.targetGrams;
    schedulePersist();
    return null;
  },

  removeGoal(kind: Goal['kind'], exerciseId?: string): void {
    const idx = state.goals.findIndex((g) => {
      if (g.kind !== kind) return false;
      if (kind === 'strength' && g.kind === 'strength') return g.exerciseId === exerciseId;
      return true;
    });
    if (idx >= 0) state.goals.splice(idx, 1);
    if (kind === 'bodyweight') state.bodyGoalGrams = null;
    schedulePersist();
  },

  goalsOf(kind: Goal['kind']): Goal[] {
    return state.goals.filter((g) => g.kind === kind);
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

  /**
   * 按模板某一天开始训练。
   *
   * 今日页的"开始训练"与训练页的"开始这一天"必须走同一条路径，
   * 否则两处预填逻辑会各自演化。原实现里今日页只做了跳转，
   * 用户点完还得再点一次，与"开始训练"的字面承诺不符。
   *
   * 另外：如果今天正好有这个训练日的安排，直接把会话**绑定**到该发生项。
   * 不绑定的话，结束训练时"计入周目标"没有默认匹配项，
   * 用户很容易漏勾，于是练完了周目标还是 0/4。
   */
  startSessionFromDay(dayId: string): Session | null {
    const tpl = state.activeTemplateId ? resolveTemplate(state.activeTemplateId) : null;
    const day = tpl?.days.find((d) => d.id === dayId);
    if (!tpl || !day) return null;
    const today = businessDate();
    const candidate = planOccurrenceForDay(state, tpl.id, day.id, today);
    // 已经被别的场次满足的项目不再绑定，否则两场训练会抢同一个计划项
    const taken =
      candidate !== null &&
      state.sessions.some(
        (s) =>
          !s.deletedAt &&
          isValidCompletedSession(s) &&
          s.occurrenceId === candidate.id &&
          s.goalCreditConfirmed === true,
      );
    const bound = taken ? null : candidate;
    const session = createSessionRecord({
      id: nextId('s'),
      templateId: tpl.id,
      dayId: day.id,
      title: day.title,
      status: 'active',
      startedAt: new Date().toISOString(),
      endedAt: null,
      businessDate: today,
      restEndsAt: null,
      note: '',
      ...(bound ? { occurrenceId: bound.id } : {}),
      exercises: day.exercises.map((pe, i) => {
        // 用上次可比记录预填计划组，首次训练则留空
        const last = lastExerciseSets([...state.sessions], pe.exerciseId, null);
        const top = last.reduce<number>((max, s) => Math.max(max, s.loadGrams ?? 0), 0);
        const topReps = last.find((s) => (s.loadGrams ?? 0) === top)?.reps ?? pe.repMin;
        /*
         * 热身组：只在杠铃动作上生成。
         *
         * 模板里新手第一个动作就是杠铃深蹲，直接上工作组是受伤风险。
         * 哑铃/器械动作负载低、递增空间小，全部生成反而让录制页变长，
         * 用户会用"每组都要填"的印象把它关掉，等于白做。
         */
        const meta = EXERCISE_BY_ID.get(pe.exerciseId);
        const warm = top > 0 && meta?.equipment === '杠铃'
          ? buildWarmup({ workingGrams: top, isBarbell: true })
          : [];
        return {
          id: nextId('se'),
          exerciseId: pe.exerciseId,
          order: i,
          targetSets: pe.sets,
          repMin: pe.repMin,
          repMax: pe.repMax,
          restSeconds: pe.restSeconds,
          incrementGrams: pe.incrementGrams,
          sets: [
          // 热身组在前，标 kind: warmup——不计入容量与工作组的统计
          ...warm.map((w) => ({
            id: nextId('set'),
            kind: 'warmup' as const,
            status: 'planned' as const,
            loadGrams: w.loadGrams,
            reps: w.reps,
            durationSeconds: null,
            distanceMeters: null,
            rpe: null,
            completedAt: null,
          })),
          ...Array.from({ length: pe.sets }, () => ({
            id: nextId('set'),
            kind: 'work' as const,
            status: 'planned' as const,
            loadGrams: top > 0 ? top : null,
            reps: top > 0 ? Math.min(pe.repMax, Math.max(pe.repMin, topReps)) : null,
            durationSeconds: null,
            distanceMeters: null,
            rpe: null,
            completedAt: null,
          })),
          ],
        };
      }),
    });
    return session;
  },

  /**
   * 某个模板训练日在**今天**的状态。
   *
   * 训练页据此决定：能不能开始、要不要提示"已经完成/已经顺延"，
   * 避免同一项被重复练两遍还各自算一次。
   */
  planStateForDay(dayId: string): {
    status: 'open' | 'done' | 'moved' | 'later' | 'excused' | 'cancelled' | 'none';
    occurrenceId: string | null;
    movedTo: string | null;
    sessionId: string | null;
  } {
    const today = businessDate();
    const tplId = state.activeTemplateId;
    if (!tplId) return { status: 'none', occurrenceId: null, movedTo: null, sessionId: null };
    const occ = planOccurrenceForDay(state, tplId, dayId, today, {
      ignoreDate: true,
      includeDisposed: true,
    });
    if (!occ) return { status: 'none', occurrenceId: null, movedTo: null, sessionId: null };

    // 豁免/取消的项目仍要显示出来，否则用户会以为计划丢了
    if (occ.disposition === 'excused') {
      return { status: 'excused', occurrenceId: occ.id, movedTo: null, sessionId: null };
    }
    if (occ.disposition === 'cancelled') {
      return { status: 'cancelled', occurrenceId: occ.id, movedTo: null, sessionId: null };
    }

    const credited = state.sessions.find(
      (s) =>
        !s.deletedAt &&
        isValidCompletedSession(s) &&
        s.occurrenceId === occ.id &&
        s.goalCreditConfirmed === true,
    );
    if (credited) {
      return { status: 'done', occurrenceId: occ.id, movedTo: null, sessionId: credited.id };
    }
    if (occ.scheduledDate !== today) {
      // 只有 originalDate ≠ scheduledDate 才是"顺延"；
      // 正常排在别的日子的项目不该被说成顺延。
      if (occ.originalDate !== occ.scheduledDate) {
        return { status: 'moved', occurrenceId: occ.id, movedTo: occ.scheduledDate, sessionId: null };
      }
      return { status: 'later', occurrenceId: occ.id, movedTo: occ.scheduledDate, sessionId: null };
    }
    return { status: 'open', occurrenceId: occ.id, movedTo: null, sessionId: null };
  },

  createSession(session: Session): Session {
    return createSessionRecord(session);
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

  async completeSet(sessionId: string, exerciseId: string, setId: string, patch: Partial<SetRecord>): Promise<boolean> {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return false;
    const ex = s.exercises.find((x) => x.exerciseId === exerciseId);
    if (!ex) return false;
    const set = ex.sets.find((x) => x.id === setId);
    if (!set || set.status === 'completed') return false;
    const before = { ...set };
    Object.assign(set, patch, { status: 'completed', completedAt: new Date().toISOString() });
    schedulePersist();
    if (await store.flush()) return true;
    Object.assign(set, before);
    return false;
  },

  async finishSession(sessionId: string, occurrenceId: string | null): Promise<boolean> {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s || (s.status !== 'active' && s.status !== 'paused')) return false;
    const before = JSON.parse(JSON.stringify(s)) as Session;
    Object.assign(s, { status: 'completed', endedAt: new Date().toISOString(), restEndsAt: null,
      occurrenceId: occurrenceId ?? undefined, goalCreditConfirmed: occurrenceId !== null });
    schedulePersist();
    if (await store.flush()) return true;
    delete s.occurrenceId;
    delete s.goalCreditConfirmed;
    Object.assign(s, before);
    return false;
  },

  /**
   * 重开一场已结束的训练（"部分完成 → 继续这场"）。
   *
   * 结束判定改成有刻度之后，练了 1/16 组会被标成部分完成；
   * 这时用户需要能回到同一场继续记，而不是另开一场把数据拆成两半。
   */
  reopenSession(sessionId: string): string | null {
    const s = state.sessions.find((x) => x.id === sessionId);
    if (!s) return '找不到这场训练';
    if (s.deletedAt) return '这场训练已删除，先恢复再继续';
    if (s.status === 'active' || s.status === 'paused') return null;
    s.status = 'active';
    s.endedAt = null;
    schedulePersist();
    return null;
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

  /** 撤销删除体重记录。 */
  restoreWeight(entry: WeightEntry): void {
    if (state.weights.some((w) => w.date === entry.date)) return;
    state.weights.push({ ...entry });
    state.weights.sort((a, b) => (a.date < b.date ? -1 : 1));
    schedulePersist();
  },

  addFood(entry: Omit<FoodEntry, 'id' | 'createdAt'>): void {
    /*
     * 手动记录同一餐次时，先移除"按计划完成"的占位条目。
     * 否则用户按计划勾过之后又补录实际吃的，热量会被算两遍。
     */
    state.foods = withoutPlanPlaceholder(state.foods, entry);
    state.foods.push({ ...entry, id: uid('f'), createdAt: new Date().toISOString() });
    schedulePersist();
  },

  removeFood(id: string): void {
    state.foods = state.foods.filter((f) => f.id !== id);
    schedulePersist();
  },

  /** 撤销删除：按原 id 放回，避免重复条目。 */
  restoreFood(entry: FoodEntry): void {
    if (state.foods.some((f) => f.id === entry.id)) return;
    state.foods.push(entry);
    state.foods.sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
    schedulePersist();
  },

  setTargets(kcal: number | null, protein: number | null): void {
    state.targetKcal = kcal;
    state.targetProtein = protein;
    schedulePersist();
  },

  // ---------- 饮水 ----------

  waterForDate(date = businessDate()): WaterEntry[] {
    return (state.water ?? []).filter((w) => w.date === date);
  },

  waterTotalFor(date = businessDate()): number {
    return waterTotal(state.water, date);
  },

  /** 记一笔饮水；返回新条目，便于撤销删除时按 id 放回。 */
  addWater(ml: number, date = businessDate()): WaterEntry | null {
    const value = Math.round(ml);
    if (!Number.isFinite(value) || value <= 0) return null;
    if (!state.water) state.water = [];
    const entry: WaterEntry = {
      id: uid('wa'),
      date,
      ml: value,
      createdAt: new Date().toISOString(),
    };
    state.water.push(entry);
    schedulePersist();
    return entry;
  },

  removeWater(id: string): void {
    state.water = (state.water ?? []).filter((w) => w.id !== id);
    schedulePersist();
  },

  /** 撤销删除：按原 id 放回，避免重复条目。 */
  restoreWater(entry: WaterEntry): void {
    if (!state.water) state.water = [];
    if (state.water.some((w) => w.id === entry.id)) return;
    state.water.push(entry);
    schedulePersist();
  },

  setWaterGoal(ml: number | null): void {
    state.waterGoalMl = ml && ml > 0 ? Math.round(ml) : undefined;
    schedulePersist();
  },

  // ---------- 提醒 ----------

  updateReminders(patch: Partial<ReminderSettings>): void {
    state.reminders = normalizeReminders({ ...state.reminders, ...patch });
    schedulePersist();
  },

  newId(prefix: string): string {
    return nextId(prefix);
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

  /** 预览后移：不落库，用来判断是否需要让用户选"减少一天 / 加入下周"。 */
  previewPlanShift(scope: ShiftScope, date: string): ShiftPreview {
    return previewShift(state.occurrences, weekStartOf(date), scope, date);
  },

  applyPlanShift(scope: ShiftScope, date: string, strategy: OverflowStrategy): string | null {
    const result = applyShift({
      occurrences: [...state.occurrences],
      goals: [...state.weekGoals],
      weekStart: weekStartOf(date),
      scope,
      date,
      strategy,
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
    const next = resolveTemplate(nextId);
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
    ensurePlanAheadImpl(state);
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

  // ---------- AI 教练 ----------

  /**
   * 当前状态指纹，用于判断 AI 建议是否已过期。
   *
   * 由 domain/ai-adopt 定义"哪些字段算相关"，
   * 商店只负责把当前状态交给它，不重复定义口径。
   */
  aiStateFingerprint(): string {
    return stateFingerprint(toRaw(state) as AppState);
  },

  /** 采纳 AI 建议：只改周目标与训练目标，不直接写训练记录。 */
  adoptAiWeeklyGoal(weeklyGoal: number): void {
    if (!Number.isInteger(weeklyGoal) || weeklyGoal < 1 || weeklyGoal > 21) return;
    state.weeklyGoal = weeklyGoal;
    state.profile.weeklyTarget = weeklyGoal;
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
    let backupKey: string | null = null;
    if (result.backup) {
      // 替换模式：先把旧状态另存为备份，失败可回滚
      backupKey = makeBackupKey(Date.now());
      try {
        localStorage.setItem(backupKey, JSON.stringify(result.backup));
        state.lastBackupKey = backupKey;
      } catch {
        return '无法写入备份（存储空间不足），已取消替换';
      }
    }
    /*
     * 先记下备份键，再整体替换。
     *
     * result.state 是从 current 派生的，其中的 lastBackupKey 还是替换前的旧值；
     * 若无条件 Object.assign，刚写好的备份键会被旧值覆盖掉，
     * localStorage 里明明有备份，latestBackup() 却永远返回 null，
     * "恢复到替换前"入口从此消失（备份写了却找不回来）。
     */
    Object.assign(state, result.state);
    if (backupKey) state.lastBackupKey = backupKey;
    schedulePersist();
    return null;
  },

  /**
   * 应用远端快照（快进场景）。
   *
   * 只替换快照覆盖的业务字段，保留本机设备私有配置（datasetId 除外——
   * 快照里的 datasetId 才是权威值）。应用前把当前状态存为备份，
   * 避免用户误点后无法回退。
   */
  applyExternalSnapshot(snapshot: {
    datasetId: string;
    createdAt: string;
    records: Record<string, unknown>;
  }): string | null {
    const r = snapshot.records as Record<string, unknown>;
    const backupKey = makeSyncBackupKey(Date.now());
    try {
      localStorage.setItem(backupKey, JSON.stringify(state));
      state.lastBackupKey = backupKey;
    } catch {
      return '无法写入本地备份，已取消应用远端数据';
    }

    const assign = <K extends keyof AppState>(key: K, value: unknown): void => {
      if (value !== undefined) state[key] = value as AppState[K];
    };
    assign('datasetId', snapshot.datasetId);
    assign('createdAt', snapshot.createdAt);
    assign('profile', r.profile);
    assign('sessions', r.sessions);
    assign('weights', r.weights);
    assign('foods', r.foods);
    assign('occurrences', r.occurrences);
    assign('weekGoals', r.weekGoals);
    assign('customTemplates', r.customTemplates);
    assign('bodyGoalGrams', r.bodyGoalGrams);
    assign('targetKcal', r.targetKcal);
    assign('targetProtein', r.targetProtein);
    assign('weeklyGoal', r.weeklyGoal);
    assign('activeTemplateId', r.activeTemplateId);
    assign('activeTemplateSince', r.activeTemplateSince);
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





















