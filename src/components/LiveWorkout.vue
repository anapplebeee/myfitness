<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, EXERCISES, MUSCLES } from '../content/exercises';
import { formatLoad, formatRest, formatDuration, formatVolume, shortDate } from '../domain/units';
import { completedSetCount, completedWorkingSets, lastExerciseSets, plannedSetCount } from '../domain/metrics';
import { completionSummary, shouldDefaultCredit } from '../domain/completion';
import { suggestNextLoad } from '../domain/next-load';
import { useRestTimer } from '../composables/useRestTimer';
import { useToast } from '../composables/useToast';
import ExerciseDemo from './ExerciseDemo.vue';
import { setSummary } from '../domain/tracking';
import { diffSessions, previousComparableSession, summarizeSession } from '../domain/goals';
import type { SetRecord, TrackingMode } from '../domain/types';
import { setImmersive } from '../composables/useImmersive';
import { mondayOf } from '../domain/plan';
import { computeWeek } from '../domain/week';
import { useBackLayer, useSheetBack } from '../composables/useBackLayer';

const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'finished'): void }>();

const { push } = useToast();

// 返回键/边缘返回：先关本场录制（会话保持未结束，可继续），
// 而不是把用户带回别的页面、让他以为训练丢了。
useBackLayer(() => emit('close'));

onMounted(() => {
  setImmersive(true);
  /*
   * 恢复休息计时：离开训练页时倒计时原本直接丢失（组件内 state），
   * 训练中切出去看一眼再回来节奏就断了。按 session.restEndsAt 接着走。
   */
  const endsAt = session.value?.restEndsAt;
  if (endsAt) {
    const ms = new Date(endsAt).getTime();
    if (Number.isFinite(ms) && ms > Date.now()) rest.restore(ms);
  }
});
onBeforeUnmount(() => {
  setImmersive(false);
  if (elapsedTimer !== null) {
    window.clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
});
const session = computed(() => store.findSession(props.sessionId));
const rest = useRestTimer();

const unit = ref<'kg' | 'lb'>('kg');
const activeExIndex = ref(0);
const showPicker = ref(false);
const finishing = ref(false);
const confirmDiscard = ref(false);
const moreOpen = ref(false);
const creditChoice = ref<string>('');
const creditConfirmed = ref(false);
const elapsed = ref(0);
/** 动作演示面板：非空时显示 */
const demoId = ref<string | null>(null);
const saving = ref(false);

// 总结面板与动作面板也要能被返回键关掉，而不是直接退出录制
useSheetBack(finishing, () => { finishing.value = false; });
useSheetBack(confirmDiscard, () => { confirmDiscard.value = false; });
useSheetBack(moreOpen, () => { moreOpen.value = false; });
useSheetBack(showPicker, () => { showPicker.value = false; });
/*
 * 训练计时：每秒刷新已用时长。
 *
 * 必须在 onBeforeUnmount 里 clearInterval——原来没有清理，
 * 每次进出训练界面就多一个每秒执行的定时器，且闭包持有 session。
 * 在低端安卓上表现为训练越久越卡、电量异常。
 */
let elapsedTimer: number | null = null;
elapsedTimer = window.setInterval(() => {
  const s = session.value;
  if (s) elapsed.value = (Date.now() - new Date(s.startedAt).getTime()) / 1000;
}, 1000);

const activeExercise = computed(() => session.value?.exercises[activeExIndex.value] ?? null);

/* ---------- 训练现场的即时反馈 ---------- */

/**
 * 保存状态必须一直可见。
 *
 * 健身房里最怕"记了半天没存上"：出错时不能只在控制台里，
 * 用户需要立刻知道并去导出备份。
 */
const saveState = computed(() => {
  if (store.saveError.value) return { text: '保存失败', cls: 'chip--clay' };
  if (!store.savedAt.value) return { text: '未保存', cls: '' };
  const t = new Date(store.savedAt.value);
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return { text: `已保存 ${hh}:${mm}`, cls: 'chip--lime' };
});

/** 已完成 / 跳过 / 未记录：只数工作组，热身组单独用行标记，不混进完成度。 */
const setCounts = computed(() => {
  const sets = (activeExercise.value?.sets ?? []).filter((s) => s.kind === 'work');
  return {
    done: sets.filter((s) => s.status === 'completed').length,
    skipped: sets.filter((s) => s.status === 'skipped').length,
    pending: sets.filter((s) => s.status === 'planned').length,
  };
});

/** 上次同动作的工作组（按顺序），逐组提示与建议都用它。 */
const lastWorkSets = computed(() =>
  activeExercise.value
    ? lastExerciseSets([...store.state.sessions], activeExercise.value.exerciseId, props.sessionId)
    : [],
);

/** 下次重量建议；样本不足返回 null，只展示记录、不硬给结论。 */
const loadSuggestion = computed(() => {
  const ex = activeExercise.value;
  if (!ex) return null;
  return suggestNextLoad({
    sets: lastWorkSets.value,
    repMin: ex.repMin,
    repMax: ex.repMax,
    incrementGrams: ex.incrementGrams,
  });
});

/** 首组工作重量：优先用用户刚输入的草稿，其次用已保存值。 */
const firstWorkLoad = computed(() => {
  const ex = activeExercise.value;
  if (!ex) return 0;
  const first = ex.sets.find((s) => s.kind === 'work');
  if (!first) return 0;
  const raw = draftFor(ex.exerciseId, first).load;
  const n = Number.parseFloat(raw.replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return first.loadGrams ?? 0;
  return Math.round((unit.value === 'kg' ? n : n / 2.20462) * 1000);
});

const warmupSets = computed(() => (activeExercise.value?.sets ?? []).filter((s) => s.kind === 'warmup'));
const warmupEditable = computed(() => warmupSets.value.every((s) => s.status === 'planned'));

/** 工作组列表与"正在做的组"：视觉焦点跟着第一个未完成的工作组走。 */
const workRows = computed(() => (activeExercise.value?.sets ?? []).filter((s) => s.kind === 'work'));
const firstWorkIdx = computed(() => (activeExercise.value?.sets ?? []).findIndex((s) => s.kind === 'work'));
const currentSetId = computed(
  () => (activeExercise.value?.sets ?? []).find((s) => s.kind === 'work' && s.status === 'planned')?.id ?? null,
);

/** 工作重量改过、且热身还没开始 → 提示可以按新重量更新。 */
const workLoadEdited = computed(() => {
  const ex = activeExercise.value;
  if (!ex || !warmupSets.value.length) return false;
  const first = ex.sets.find((s) => s.kind === 'work');
  if (!first || first.loadGrams === null) return false;
  return Math.abs(firstWorkLoad.value - first.loadGrams) > 1;
});

function applySuggestion(): void {
  const ex = activeExercise.value;
  const s = loadSuggestion.value;
  if (!ex || !s) return;
  const load = unit.value === 'kg' ? String(s.grams / 1000) : String(Math.round((s.grams / 1000) * 2.20462 * 10) / 10);
  for (const set of ex.sets) {
    if (set.kind === 'work' && set.status === 'planned') {
      updateDraft(ex.exerciseId, set.id, { load });
    }
  }
  push(`已填入建议重量 ${formatLoad(s.grams, unit.value)}`, 'success');
}

function refreshWarmups(): void {
  const ex = activeExercise.value;
  if (!ex) return;
  const grams = firstWorkLoad.value;
  if (grams <= 0) {
    push('先填第一组的工作重量，再生成热身', 'error');
    return;
  }
  const error = store.replaceWarmups(props.sessionId, ex.exerciseId, grams);
  if (error) {
    push(error, 'error');
    return;
  }
  push('热身组已按当前工作重量更新', 'success');
}

/** RPE 选填：只在已完成的组上填，不打断记录流程。 */
function setRpe(set: SetRecord, value: number | null): void {
  const ex = activeExercise.value;
  if (!ex) return;
  const error = store.editSet(props.sessionId, ex.exerciseId, set.id, { rpe: value });
  if (error) push(error, 'error');
}

interface DraftSet {
  load: string;
  reps: string;
  duration: string;
  distance: string;
  rpe: string;
}

const drafts = ref<Record<string, DraftSet>>({});

function draftKey(exId: string, setId: string): string {
  return `${exId}:${setId}`;
}

function draftFor(exId: string, set: SetRecord): DraftSet {
  const key = draftKey(exId, set.id);
  if (!drafts.value[key]) {
    const base = set.loadGrams ?? 0;
    drafts.value[key] = {
      load: base ? String(unit.value === 'kg' ? base / 1000 : (base / 1000) * 2.20462) : '',
      reps: set.reps ? String(set.reps) : '',
      duration: set.durationSeconds ? String(set.durationSeconds) : '',
      distance: set.distanceMeters ? String(set.distanceMeters) : '',
      rpe: '',
    };
  }
  return drafts.value[key]!;
}

function updateDraft(exId: string, setId: string, patch: Partial<DraftSet>): void {
  const key = draftKey(exId, setId);
  const current: DraftSet = drafts.value[key] ?? { load: '', reps: '', duration: '', distance: '', rpe: '' };
  drafts.value[key] = { ...current, ...patch };
}

/** 按动作模式把草稿解析成组记录；返回 null 表示输入不完整。 */
function parseDraft(exId: string, set: SetRecord): Partial<SetRecord> | null {
  const ex = EXERCISES.find((e) => e.id === exId);
  if (!ex) return null;
  const d = draftFor(exId, set);
  const patch: Partial<SetRecord> = {};

  if (ex.mode === 'load_reps') {
    const load = Number.parseFloat(d.load.replace(',', '.'));
    const reps = Number.parseInt(d.reps, 10);
    if (!Number.isFinite(load) || load < 0 || !Number.isFinite(reps) || reps <= 0) return null;
    patch.loadGrams = unit.value === 'kg' ? Math.round(load * 1000) : Math.round((load / 2.20462) * 1000);
    patch.reps = reps;
  } else if (ex.mode === 'reps') {
    const reps = Number.parseInt(d.reps, 10);
    if (!Number.isFinite(reps) || reps <= 0) return null;
    patch.reps = reps;
  } else if (ex.mode === 'duration') {
    const secs = Number.parseInt(d.duration, 10);
    if (!Number.isFinite(secs) || secs <= 0) return null;
    patch.durationSeconds = secs;
  } else {
    const dist = Number.parseFloat(d.distance.replace(',', '.'));
    const secs = Number.parseInt(d.duration, 10);
    if (!Number.isFinite(dist) || dist <= 0 || !Number.isFinite(secs) || secs <= 0) return null;
    patch.distanceMeters = Math.round(dist);
    patch.durationSeconds = secs;
  }

  const rpeRaw = d.rpe;
  patch.rpe = rpeRaw ? Number(rpeRaw) : null;
  return patch;
}

const pickerKeyword = ref('');

/**
 * 面板列出全部动作并支持搜索。
 * 原实现只列前 24 个，导致平板支撑、坡度快走等排在后面的动作根本选不到。
 */
const pickerResults = computed(() => {
  const q = pickerKeyword.value.trim().toLowerCase();
  if (!q) return EXERCISES;
  return EXERCISES.filter(
    (e) => e.name.toLowerCase().includes(q) || (e.alias ?? []).some((a) => a.includes(q)),
  );
});

/** 目标提示按模式给：计时/距离类不该显示"N 次"。 */
function targetHint(ex: { exerciseId: string; targetSets: number; repMin: number; repMax: number }): string {
  const def = EXERCISES.find((e) => e.id === ex.exerciseId);
  const mode = def?.mode ?? 'load_reps';
  if (mode === 'duration') return '目标 ' + ex.targetSets + ' 组 · 每组计时';
  if (mode === 'distance_duration') return '目标 ' + ex.targetSets + ' 组 · 每组记距离与时长';
  if (mode === 'reps') return '目标 ' + ex.targetSets + ' 组 × ' + ex.repMin + '–' + ex.repMax + ' 次（自重）';
  return '目标 ' + ex.targetSets + ' 组 × ' + ex.repMin + '–' + ex.repMax + ' 次';
}


/**
 * 工作组序号（1 起）。
 *
 * 热身组不占编号：肌肉记忆里的"第 3 组"指的是第 3 个工作组，
 * 不是列表里的第 3 行。
 */
function workIndex(sets: Array<{ kind: string }>, idx: number): number {
  let n = 0;
  for (let i = 0; i <= idx && i < sets.length; i += 1) {
    if (sets[i]?.kind !== 'warmup') n += 1;
  }
  return n;
}
function completedSummary(exerciseId: string, set: SetRecord): string {
  const def = EXERCISES.find((e) => e.id === exerciseId);
  if (!def) return '—';
  return setSummary(def, set, unit.value);
}

function modeLabel(mode: string): string {
  return mode === 'load_reps' ? '负重' : mode === 'reps' ? '次数' : mode === 'duration' ? '计时' : '距离';
}

function modeOf(exId: string): TrackingMode {
  return EXERCISES.find((e) => e.id === exId)?.mode ?? 'load_reps';
}

async function complete(exId: string, set: SetRecord): Promise<void> {
  if (saving.value) return;
  const parsed = parseDraft(exId, set);
  if (!parsed) {
    push(EXERCISES.find((e) => e.id === exId)?.mode === 'load_reps' ? '先填重量和次数' : '先填完整数据', 'error');
    return;
  }
  const ex = activeExercise.value;
  saving.value = true;
  const saved = await store.completeSet(props.sessionId, exId, set.id, parsed);
  saving.value = false;
  if (!saved) {
    push(store.saveError.value ?? '本组尚未保存，请重试', 'error');
    return;
  }
  if (ex) {
    rest.start(ex.restSeconds);
    syncRestPersist();
  }
  push('已保存本组', 'success');
}

/** 把计时结束时间写回会话，离开页面再回来能接着走。 */
function syncRestPersist(): void {
  const ends = rest.endsAtMs();
  store.updateSession(props.sessionId, {
    restEndsAt: ends === null ? null : new Date(ends).toISOString(),
  });
}

function addSet(): void {
  const ex = activeExercise.value;
  if (!ex) return;
  store.addSet(props.sessionId, ex.exerciseId);
}

function skip(setId: string): void {
  const ex = activeExercise.value;
  if (!ex) return;
  store.skipSet(props.sessionId, ex.exerciseId, setId);
}

function lastHint(exId: string): string {
  const last = lastExerciseSets([...store.state.sessions], exId, props.sessionId);
  if (!last.length) return '首次记录';
  const top = last.reduce((a, b) => ((b.loadGrams ?? 0) > (a.loadGrams ?? 0) ? b : a));
  if (top.loadGrams === null || top.reps === null) return '首次记录';
  return `上次 ${formatLoad(top.loadGrams, unit.value)} × ${top.reps}`;
}

/**
 * 上一场同一索引组的数值，供输入框做 ghost 占位。
 *
 * 原来每组单独占一列「上次」：360px 宽时 `105 kg ×` / `6` 折成两行，
 * 且同一动作 5 行组的文字完全一样，是纯噪声（PM 深评 P0-4）。
 * 现在把上次值放进输入框 placeholder，行宽从 5 列回到 4 列。
 */
function prevSetFor(
  exId: string,
  index: number,
): { loadGrams: number | null; reps: number | null } | null {
  const last = lastExerciseSets([...store.state.sessions], exId, props.sessionId);
  const rec = last[index];
  if (!rec) return null;
  return { loadGrams: rec.loadGrams, reps: rec.reps };
}

function prevLoadPlaceholder(exId: string, index: number, set: SetRecord): string {
  const grams = prevSetFor(exId, index)?.loadGrams ?? set.loadGrams ?? 0;
  if (!grams) return '0';
  const value = unit.value === 'kg' ? grams / 1000 : (grams / 1000) * 2.20462;
  return String(Math.round(value * 10) / 10);
}

function prevRepsPlaceholder(exId: string, index: number, fallback: number): string {
  return String(prevSetFor(exId, index)?.reps ?? fallback);
}

function finish(): void {
  if (saving.value) return;
  const s = session.value;
  if (!s) return;
  if (completedWorkingSets(s) === 0) {
    push('至少完成一个工作组才能结束', 'error');
    return;
  }
  // 优先匹配同日的计划项目；无计划训练允许手动匹配本周未满足项目（09:48）
  const weekStart = mondayOf(s.businessDate);
  const weekState = computeWeek({
    weekStart,
    goal: store.goalForWeek(weekStart),
    occurrences: [...store.state.occurrences],
    sessions: [...store.state.sessions],
    now: new Date(),
  });
  // 排除已被其他场次满足的项目，避免一场顶掉已有记录
  const open = store.openOccurrences(weekStart, weekState.satisfiedOccurrenceIds);
  /*
   * 默认匹配项：
   * 1. 开始训练时就绑定的那一项（从"今日计划"进来的情况）
   * 2. 否则取同日的项目
   * 有默认值就顺手勾上——否则用户练完直接点"确认结束"，
   * 周目标仍然是 0/N，看起来像没记上。仍可手动取消。
   */
  const bound = s.occurrenceId ? open.find((o) => o.id === s.occurrenceId) : undefined;
  const match = bound ?? open.find((o) => o.scheduledDate === s.businessDate);
  creditChoice.value = match?.id ?? '';
  /*
   * 只有练够了才默认勾选。
   * 1/16 组也自动计入，会让周目标变成"打卡"，所以部分完成时默认不勾，
   * 由用户自己决定要不要认（面板上会说明只完成了几成）。
   */
  creditConfirmed.value = Boolean(match) && shouldDefaultCredit(s);
  finishing.value = true;
}

/** 总结页可选项：只列本周仍未被满足的项目。 */
const creditOptions = computed(() => {
  const s = session.value;
  if (!s) return [];
  const weekStart = mondayOf(s.businessDate);
  const weekState = computeWeek({
    weekStart,
    goal: store.goalForWeek(weekStart),
    occurrences: [...store.state.occurrences],
    sessions: [...store.state.sessions],
    now: new Date(),
  });
  return store.openOccurrences(weekStart, weekState.satisfiedOccurrenceIds);
});

/** 本场完成度：结束面板据此决定默认是否计入周目标。 */
const completion = computed(() => {
  const s = session.value;
  if (!s) return { completedWorkSets: 0, plannedWorkSets: 0, ratio: 1, partial: false, text: '0 组' };
  return completionSummary(s);
});

/** 与上次同类训练对比，供结束总结使用。 */
const comparison = computed(() => {
  const s = session.value;
  if (!s) return null;
  const prev = previousComparableSession(s, [...store.state.sessions]);
  if (!prev) return null;
  // 结束前本场可能还未标记 completed，先按当前数据算
  const cur = summarizeSession({ ...s, endedAt: s.endedAt ?? new Date().toISOString() });
  const before = summarizeSession(prev);
  return {
    prevDate: prev.businessDate,
    prevTitle: prev.title,
    current: cur,
    previous: before,
    diff: diffSessions(cur, before),
  };
});

async function confirmFinish(): Promise<void> {
  if (saving.value) return;
  saving.value = true;
  const saved = await store.finishSession(props.sessionId, creditConfirmed.value && creditChoice.value ? creditChoice.value : null);
  saving.value = false;
  if (!saved) {
    push(store.saveError.value ?? '训练尚未保存，请重试', 'error');
    return;
  }
  finishing.value = false;
  push('训练已保存', 'success');
  emit('finished');
}

function discard(): void {
  store.updateSession(props.sessionId, { status: 'discarded', endedAt: new Date().toISOString(), restEndsAt: null });
  push('已放弃，本场不计入统计', 'error');
  emit('finished');
}

/** 放弃是不可撤销的整场丢弃，必须先确认。 */
function askDiscard(): void {
  confirmDiscard.value = true;
}

function pickExercise(exerciseId: string): void {
  const ex = activeExercise.value;
  if (!ex) {
    const def = EXERCISES.find((e) => e.id === exerciseId);
    // 必须带出可录入的组：空数组会让本动作一个输入框都没有
    const sets = Array.from({ length: 3 }, () => ({
      id: store.newId('set'),
      kind: 'work' as const,
      status: 'planned' as const,
      loadGrams: null,
      reps: null,
      durationSeconds: null,
      distanceMeters: null,
      rpe: null,
      completedAt: null,
    }));
    store.addExerciseToSession(props.sessionId, {
      id: store.newId('se'),
      exerciseId,
      order: 0,
      targetSets: 3,
      // 计时/距离类不该显示"8–12 次"
      repMin: def?.mode === 'load_reps' || def?.mode === 'reps' ? 8 : 1,
      repMax: def?.mode === 'load_reps' || def?.mode === 'reps' ? 12 : 1,
      restSeconds: 90,
      incrementGrams: 2500,
      sets,
    });
  } else {
    store.replaceExerciseInSession(props.sessionId, ex.exerciseId, exerciseId);
    // 新动作插在原动作之后，自动切过去，否则用户看到的是已跳过的旧动作
    const list = store.findSession(props.sessionId)?.exercises ?? [];
    const at = list.findIndex((x) => x.exerciseId === exerciseId);
    if (at >= 0) activeExIndex.value = at;
  }
  showPicker.value = false;
  push('已更新本场动作，仅影响本次');
}

const progress = computed(() => {
  const s = session.value;
  if (!s) return 0;
  const planned = plannedSetCount(s);
  return planned ? Math.min(100, Math.round((completedSetCount(s) / planned) * 100)) : 0;
});
</script>

<template>
  <div v-if="session" class="live">
    <!-- header -->
    <header class="live__head">
      <button class="icon-btn" aria-label="返回" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <div class="live__title">
        <p class="label">{{ session.status === 'paused' ? '已暂停' : '训练中' }}</p>
        <p class="h3">{{ session.title }}</p>
      </div>
      <div class="live__head-right">
        <span class="chip chip--sm" :class="saveState.cls">{{ saveState.text }}</span>
        <span class="chip chip--sm mono">{{ formatDuration(elapsed) }}</span>
      </div>
    </header>

    <div class="bar live__progress"><div class="bar__fill" :style="{ width: `${progress}%` }" /></div>

    <!-- rest timer -->
    <Transition name="rise">
      <div v-if="rest.running.value" class="rest card card--ink">
        <div>
          <p class="label">休息</p>
          <p class="rest__time mono">{{ formatRest(rest.remaining.value) }}</p>
        </div>
        <div class="row gap-6">
          <button class="btn btn--ghost btn--sm rest__btn" @click="rest.add(30); syncRestPersist()">+30s</button>
          <button class="btn btn--lime btn--sm" @click="rest.stop(); syncRestPersist()">跳过</button>
        </div>
      </div>
    </Transition>

    <!-- exercise tabs -->
    <div class="scroll-x live__exlist">
      <button
        v-for="(ex, i) in session.exercises"
        :key="ex.id"
        class="chip"
        :class="{ 'chip--on': i === activeExIndex }"
        @click="activeExIndex = i"
      >
        {{ exerciseName(ex.exerciseId) }}
      </button>
      <button class="chip chip--lime" @click="showPicker = true">
        {{ session.exercises.length ? '换动作' : '加动作' }}
      </button>
    </div>

    <!-- active exercise -->
    <section v-if="activeExercise" class="card live__panel">
      <div class="live__panel-head">
        <div>
          <p class="label">{{ MUSCLES.find((m) => m.id === EXERCISES.find((e) => e.id === activeExercise!.exerciseId)?.group)?.label }}</p>
          <h2 class="h2">{{ exerciseName(activeExercise.exerciseId) }}</h2>
          <p class="tiny">{{ lastHint(activeExercise.exerciseId) }} · {{ targetHint(activeExercise) }}</p>
          <p class="tiny live__counts">
            已完成 {{ setCounts.done }} · 跳过 {{ setCounts.skipped }} · 未记录 {{ setCounts.pending }}
          </p>
        </div>
        <div class="live__panel-actions">
          <!--
            单位是全局偏好，不该独占一整行（原来占 46px 高、整行宽）。
            收到动作名右侧，和「要领」并排。
          -->
          <div v-if="modeOf(activeExercise.exerciseId) === 'load_reps'" class="seg seg--mini">
            <button class="seg__item" :class="{ 'is-on': unit === 'kg' }" @click="unit = 'kg'">kg</button>
            <button class="seg__item" :class="{ 'is-on': unit === 'lb' }" @click="unit = 'lb'">lb</button>
          </div>
          <button class="btn btn--ghost btn--sm demo-btn" @click="demoId = activeExercise!.exerciseId">
            要领
          </button>
        </div>
      </div>

      <!-- 下次怎么练：可解释的建议 + 热身入口（都可拒绝/跳过） -->
      <div class="live__assist">
        <template v-if="loadSuggestion">
          <span class="tiny">
            建议 <strong>{{ formatLoad(loadSuggestion.grams, unit) }}</strong> · {{ loadSuggestion.reason }}
          </span>
          <button class="btn btn--ghost btn--sm" @click="applySuggestion">采用</button>
        </template>
        <span v-else class="tiny">这个动作历史不足，先按自己的重量练</span>
        <button
          v-if="warmupEditable && firstWorkLoad > 0"
          class="btn btn--ghost btn--sm"
          @click="refreshWarmups"
        >
          {{ warmupSets.length ? '更新热身' : '加热身' }}
        </button>
      </div>
      <p v-if="workLoadEdited && warmupEditable" class="tiny live__warm-hint">
        工作重量已改，建议按新重量更新热身组
      </p>

      <div class="sets">
        <!--
          热身与工作组分成两个区块：热身压缩高度、工作组编号更清楚；
          正在做的组（第一个未完成工作组）用荧光条标出。
        -->
        <div v-if="warmupSets.length" class="sets__head">
          <span class="label">热身</span>
          <span class="tiny">{{ warmupSets.length }} 组 · 不计入训练量</span>
        </div>
        <template v-for="(set, idx) in activeExercise.sets" :key="set.id">
          <div v-if="idx === firstWorkIdx" class="sets__head">
            <span class="label">工作组</span>
            <span class="tiny">共 {{ workRows.length }} 组</span>
          </div>
          <div
            class="set"
            :class="[`set--${set.status}`, { 'set--warmup': set.kind === 'warmup', 'is-current': set.id === currentSetId }]"
          >
          <span class="set__idx">
            <template v-if="set.kind === 'warmup'">热身</template>
            <template v-else>{{ workIndex(activeExercise.sets, idx) }}</template>
          </span>
          <template v-if="set.status === 'completed'">
            <span class="set__done">
              <strong>{{ completedSummary(activeExercise.exerciseId, set) }}</strong>
              <select
                class="set__rpe-select"
                :aria-label="`第 ${idx + 1} 组主观强度`"
                :value="set.rpe ?? ''"
                @change="setRpe(set, ($event.target as HTMLSelectElement).value ? Number(($event.target as HTMLSelectElement).value) : null)"
              >
                <option value="">RPE</option>
                <option v-for="n in [6, 7, 8, 9, 10]" :key="n" :value="n">{{ n }}</option>
              </select>
            </span>
          </template>
          <template v-else-if="set.status === 'skipped'">
            <span class="set__skip">已跳过</span>
          </template>
          <template v-else>
            <div class="set__inputs">
              <template v-if="modeOf(activeExercise.exerciseId) === 'load_reps'">
                <input
                  class="input input--lg set__input"
                  inputmode="decimal"
                  :aria-label="`${exerciseName(activeExercise.exerciseId)} 重量`"
                  :value="draftFor(activeExercise.exerciseId, set).load"
                  :placeholder="prevLoadPlaceholder(activeExercise.exerciseId, idx, set)"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { load: ($event.target as HTMLInputElement).value })"
                />
                <span class="set__x">×</span>
                <input
                  class="input input--lg set__input"
                  inputmode="numeric"
                  :aria-label="`${exerciseName(activeExercise.exerciseId)} 次数`"
                  :value="draftFor(activeExercise.exerciseId, set).reps"
                  :placeholder="prevRepsPlaceholder(activeExercise.exerciseId, idx, activeExercise.repMin)"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { reps: ($event.target as HTMLInputElement).value })"
                />
              </template>

              <template v-else-if="modeOf(activeExercise.exerciseId) === 'reps'">
                <input
                  class="input input--lg set__input"
                  inputmode="numeric"
                  aria-label="次数"
                  :value="draftFor(activeExercise.exerciseId, set).reps"
                  :placeholder="prevRepsPlaceholder(activeExercise.exerciseId, idx, activeExercise.repMin)"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { reps: ($event.target as HTMLInputElement).value })"
                />
                <span class="set__unit">次</span>
              </template>

              <template v-else-if="modeOf(activeExercise.exerciseId) === 'duration'">
                <input
                  class="input input--lg set__input"
                  inputmode="numeric"
                  aria-label="时长（秒）"
                  :value="draftFor(activeExercise.exerciseId, set).duration"
                  placeholder="45"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { duration: ($event.target as HTMLInputElement).value })"
                />
                <span class="set__unit">秒</span>
              </template>

              <template v-else>
                <input
                  class="input input--lg set__input"
                  inputmode="decimal"
                  aria-label="距离（米）"
                  :value="draftFor(activeExercise.exerciseId, set).distance"
                  placeholder="2000"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { distance: ($event.target as HTMLInputElement).value })"
                />
                <span class="set__unit">m</span>
                <input
                  class="input input--lg set__input"
                  inputmode="numeric"
                  aria-label="时长（秒）"
                  :value="draftFor(activeExercise.exerciseId, set).duration"
                  placeholder="720"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { duration: ($event.target as HTMLInputElement).value })"
                />
                <span class="set__unit">秒</span>
              </template>
            </div>
            <button
              class="set__check"
              :disabled="saving"
              :aria-label="`完成第 ${idx + 1} 组`"
              @click="complete(activeExercise.exerciseId, set)"
            >
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
                <path d="M5 12.5l4.5 4.5L19 7.5" />
              </svg>
            </button>
            <button class="set__skipbtn" aria-label="跳过本组" title="跳过" @click="skip(set.id)">
              <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </template>
          </div>
        </template>

        <button class="addset" @click="addSet">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          加一组
        </button>
      </div>
    </section>

    <p v-else class="empty card">还没有动作，先从「加动作」开始。</p>

    <!-- actions -->
    <div class="live__actions">
      <button class="btn btn--ghost btn--lg live__more" aria-label="更多操作" @click="moreOpen = true">
        <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      <button class="btn btn--primary btn--lg live__finish" @click="finish">结束训练</button>
    </div>

    <!-- 更多操作：放弃低频且危险，收进来别和逐组确认抢位置 -->
    <Transition name="sheet">
      <div v-if="moreOpen" class="sheet" @click.self="moreOpen = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">更多</p>
              <h2 class="h2">本场操作</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="moreOpen = false">✕</button>
          </div>
          <button class="btn btn--danger btn--block" @click="moreOpen = false; askDiscard()">放弃这场训练</button>
          <p class="tiny" style="margin-top: 8px">放弃会丢弃已记录内容，还需二次确认。</p>
        </div>
      </div>
    </Transition>

    <!-- 放弃确认：整场丢弃不可撤销，不能单击就走 -->
    <Transition name="sheet">
      <div v-if="confirmDiscard" class="sheet" @click.self="confirmDiscard = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">放弃</p>
              <h2 class="h2">丢掉这场训练？</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="confirmDiscard = false">✕</button>
          </div>
          <p class="small">
            已经记录 {{ completedWorkingSets(session) }} 个工作组。放弃后本场不计入任何统计，
            也不能恢复。想保留数据就选「结束训练」。
          </p>
          <div class="row gap-10" style="margin-top: 16px">
            <button class="btn btn--ghost btn--block" @click="confirmDiscard = false">继续练</button>
            <button class="btn btn--danger btn--block" @click="discard">确认放弃</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- finish sheet -->
    <Transition name="sheet">
      <div v-if="finishing" class="sheet" @click.self="finishing = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">结束</p>
              <h2 class="h2">本场总结</h2>
            </div>
            <button class="icon-btn" @click="finishing = false" aria-label="关闭">✕</button>
          </div>
          <div class="grid-2">
            <div class="stat"><span class="stat__value">{{ completedWorkingSets(session) }}</span><span class="stat__label">工作组</span></div>
            <div class="stat"><span class="stat__value">{{ completedSetCount(session) }}/{{ plannedSetCount(session) }}</span><span class="stat__label">全场完成/计划</span></div>
          </div>
          <div class="divider" />
          <!-- 一个工作组都没完成时，这场连训练次数都算不上，必须说清楚 -->
          <p v-if="completion.completedWorkSets === 0" class="small completion__warn">
            这一场还没有完成任何工作组，结束后不会计入训练次数与周目标。
          </p>
          <!-- 部分完成要明说，别让"1/16 组"看起来像练完了 -->
          <p v-else-if="completion.partial" class="small completion__warn">
            只完成 {{ completion.text }}（{{ Math.round(completion.ratio * 100) }}%），
            默认不计入周目标。如果这次就是练到这儿，可以自己勾上。
          </p>
          <p v-else class="small">
            {{ completedSetCount(session) < plannedSetCount(session) ? '有未录的计划组，未录组不会自动算完成。' : '全部计划组已完成。' }}
          </p>

          <!--
            本次 vs 上次。
            部分完成时不做全场对比：拿"1 组"去和上次完整的 15 组比容量，
            会得到 -94.2% 这种算得对、但会打击人的数字（PM 深评 §2.6）。
          -->
          <div v-if="comparison && !completion.partial" class="cmp">
            <p class="label">对比上次</p>
            <p class="tiny cmp__sub">{{ shortDate(comparison.prevDate) }} · {{ comparison.prevTitle }}</p>
            <div class="cmp__grid">
              <div>
                <span class="cmp__num">{{ comparison.current.sets }}</span>
                <span class="tiny">本次组数</span>
                <span v-if="comparison.diff.setsDelta !== 0" class="cmp__delta" :class="comparison.diff.setsDelta > 0 ? 'up' : 'down'">
                  {{ comparison.diff.setsDelta > 0 ? '+' : '' }}{{ comparison.diff.setsDelta }}
                </span>
              </div>
              <div>
                <span class="cmp__num">{{ formatVolume(comparison.current.volumeGrams, unit) }}</span>
                <span class="tiny">容量</span>
                <span v-if="comparison.diff.volumeDeltaPct !== null" class="cmp__delta" :class="comparison.diff.volumeDeltaPct > 0 ? 'up' : 'down'">
                  {{ comparison.diff.volumeDeltaPct > 0 ? '+' : '' }}{{ comparison.diff.volumeDeltaPct }}%
                </span>
              </div>
            </div>
            <p class="tiny cmp__text">{{ comparison.diff.text }}</p>
          </div>
          <!-- 部分完成：说明"为什么这次不比较"，而不是甩一个负数 -->
          <div v-else-if="comparison && completion.completedWorkSets > 0" class="cmp cmp--part">
            <p class="label">对比上次</p>
            <p class="tiny cmp__sub">{{ shortDate(comparison.prevDate) }} · {{ comparison.prevTitle }}</p>
            <p class="small">
              本次只完成 {{ completion.completedWorkSets }} 个工作组，样本不足，先不做全场对比。
              下次练完整了再看。
            </p>
          </div>
          <div v-else class="cmp cmp--first">
            <p class="tiny">这是这个训练日的第一次记录，下次就能对比了。</p>
          </div>

          <div class="credit">
            <label class="credit__row">
              <input v-model="creditConfirmed" type="checkbox" class="credit__box" />
              <span class="credit__text">
                <span class="h3">本次计入周目标</span>
                <span class="tiny">
                  {{
                    creditConfirmed
                      ? '已匹配到本周计划项；取消勾选则只记次数与天数'
                      : '勾选后本场才算满足一个计划项目'
                  }}
                </span>
              </span>
            </label>
            <div v-if="creditConfirmed && creditOptions.length" class="credit__pick">
              <label class="tiny">匹配哪一项</label>
              <select v-model="creditChoice" class="input credit__select">
                <option value="">不匹配具体项目</option>
                <option
                  v-for="o in creditOptions"
                  :key="o.id"
                  :value="o.id"
                >
                  {{ o.title }}
                </option>
              </select>
            </div>
            <p v-else-if="!creditOptions.length" class="tiny credit__none">
              本周没有可匹配的计划项，本场只计入次数与天数。
            </p>
          </div>

          <div class="row gap-10" style="margin-top: 18px">
            <button class="btn btn--ghost btn--block" @click="finishing = false">继续练</button>
            <button class="btn btn--lime btn--block" :disabled="saving" @click="confirmFinish">确认结束</button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- exercise picker -->
    <Transition name="sheet">
      <div v-if="showPicker" class="sheet" @click.self="showPicker = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">选择动作</p>
              <h2 class="h2">只影响本次训练</h2>
            </div>
            <button class="icon-btn" @click="showPicker = false" aria-label="关闭">✕</button>
          </div>
          <input v-model="pickerKeyword" class="input" type="search" placeholder="搜索动作，如 平板 / 快走" style="margin-bottom: 8px" />
          <div class="picker">
            <button v-for="ex in pickerResults" :key="ex.id" class="picker__item" @click="pickExercise(ex.id)">
              <span class="lib__tag">{{ MUSCLES.find((m) => m.id === ex.group)?.short }}</span>
              <span class="recent__body">
                <span class="h3">{{ ex.name }}</span>
                <span class="tiny">{{ ex.equipment }} · {{ modeLabel(ex.mode) }}</span>
              </span>
            </button>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 动作演示 -->
    <ExerciseDemo v-if="demoId" :exercise-id="demoId" @close="demoId = null" />
  </div>
</template>

<style scoped>
.live {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.live__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.live__title {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.live__progress {
  margin-top: -2px;
}

.rest {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
}

.rest__time {
  font-size: 26px;
  font-weight: 700;
  letter-spacing: -0.03em;
  color: var(--lime);
  line-height: 1.05;
}

.rest__btn {
  background: rgba(var(--inv-rgb), 0.1);
  color: var(--text-inverse);
}

.live__exlist {
  padding: 2px 0;
}

.live__panel {
  padding: 18px;
}

.live__panel-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 12px;
}

.demo-btn {
  flex: none;
}

.completion__warn {
  color: var(--danger, #c0392b);
  line-height: 1.55;
}

.live__panel-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
}

/* 迷你单位切换：只占动作名右侧一小块，不再独占整行 */
.seg--mini {
  flex: none;
  padding: 2px;
  border-radius: 10px;
}

.seg--mini .seg__item {
  flex: none;
  height: 28px;
  min-width: 30px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 11.5px;
}

.sets {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/*
 * 组行用 CSS Grid，不用 flex。
 *
 * 为什么：flex + min-width 在 360px 宽时会溢出，
 * 导致勾选框压在"次数"输入框上面（实测截图确认，完全无法点击）。
 * Grid 的列是"分配制"而非"竞争制"：列宽加起来等于容器宽，
 * 不可能互相压盖，这是这里最需要的性质。
 *
 * 列：组号 / 输入区 / 勾选 / 跳过
 */
.set {
  display: grid;
  /* 「上次」列已并入输入框 placeholder，行宽从 5 列回到 4 列，360px 不折行 */
  grid-template-columns: 24px minmax(0, 1fr) 44px 44px;
  align-items: center;
  gap: 6px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.028);
}

.set--completed {
  background: rgba(201, 245, 63, 0.14);
}

/* 热身与工作组分成两个区块 */
.sets__head {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin: 10px 0 6px;
}

/* 热身行压缩：更弱的存在感，别和工作组抢 */
.set--warmup {
  padding-block: 6px;
  background: rgba(var(--ink-rgb), 0.014);
  border-left: 2px solid var(--line);
}

.set--warmup .set__input {
  height: 40px;
  font-size: 14px;
}

/* 正在做的组：荧光条描边，一眼找到下一步 */
.set.is-current {
  box-shadow: inset 0 0 0 1.5px var(--lime), inset 4px 0 0 var(--lime);
}

.set--skipped {
  opacity: 0.5;
}

.set__idx {
  width: 24px;
  height: 24px;
  border-radius: 8px;
  background: rgba(var(--ink-rgb), 0.07);
  display: grid;
  place-items: center;
  font-size: 11.5px;
  font-weight: 650;
  color: var(--text-2);
  flex: none;
}

.set__done {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
}

.set__done strong {
  font-size: 17px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.set__done span {
  font-size: 13px;
  color: var(--text-2);
}

.set__skip {
  font-size: 12.5px;
  color: var(--text-3);
  flex: 1;
}

.set__inputs {
  display: grid;
  /* 两个输入框等分，中间的乘号固定宽度，绝不重叠 */
  grid-template-columns: minmax(0, 1fr) 12px minmax(0, 1fr);
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.set__input {
  height: 46px;
  font-size: 18px;
  border-radius: 12px;
  min-width: 0;
  width: 100%;
  /*
   * 等宽数字：9 变 10 时列宽不跳动。
   * 训练中反复改重量，比例数字会让整行左右抖，非常干扰。
   */
  font-variant-numeric: tabular-nums;
  /* 数字在格子里居中，扫读时两列数字能对齐成一条竖线 */
  text-align: center;
  /* 覆盖 .input 的默认内边距：居中后需要左右等宽留白，否则数字偏左 */
  padding-left: 0;
  padding-right: 0;
}

.set__x {
  color: var(--text-3);
  font-size: 13px;
}

/*
 * 跳过改成图标（✕）。
 * 原来竖排"跳过"两字要占 16px 且视觉很吵，
 * 图标同样可识别、宽度更小，且不干扰组表扫读。
 * 触控区仍保持 40px 高（按钮本身撑开）。
 */
.set__skipbtn {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-3);
  opacity: 0.55;
  cursor: pointer;
}

.set__skipbtn:active {
  opacity: 1;
}

/*
 * 勾选框：替代原来的「完成」文字按钮。
 * 原来那个按钮一行里最宽，真机 369px 宽时把「跳过」挤到下一行；
 * 换成 44px 方形后整行结构稳定，且能一眼扫出完成进度。
 */
.set__check {
  flex: 0 0 auto;
  width: 44px;
  height: 44px;
  display: grid;
  place-items: center;
  border-radius: 12px;
  border: 1.6px solid var(--line-strong);
  background: transparent;
  color: var(--text-3);
  cursor: pointer;
  transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
}

.set__check:active {
  background: rgba(var(--ink-rgb), 0.06);
}

/* 已完成的组整行染绿（对齐标杆产品的"扫一眼就知道进度"） */
.set--completed .set__check {
  background: var(--lime);
  border-color: var(--lime);
  color: var(--on-lime);
}

/*
 * 已完成的行没有输入框，用 grid-column 让它跨过输入区+勾选+跳过的位置，
 * 否则后续元素会挤到错误的列上。
 */
.set--completed .set__done,
.set--skipped .set__skip {
  grid-column: 2 / -1;
}

.set__done {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  /*
   * 与第 2 列的「上次」之间加一条细分隔线。
   * 不加的话两个数字会连成一串：真机实测显示成 "80 kg ×7 80 kg × 8"，
   * 用户根本分不清哪个是历史、哪个是本次。
   */
  padding-left: 8px;
  border-left: 1.5px solid var(--line-strong);
}

.set__done strong {
  font-size: 16px;
  font-weight: 680;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.set__rpe {
  font-size: 11px;
  color: var(--text-3);
}

/* RPE 选填：已完成组上用下拉，不打断记录流程 */
.set__rpe-select {
  height: 30px;
  padding: 0 4px;
  border-radius: 8px;
  border: 1px solid var(--line-strong);
  background: transparent;
  color: var(--text-2);
  font-size: 12px;
}

.live__head-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.live__counts {
  margin-top: 3px;
}

/* 建议 + 热身入口：一行、可换行，不抢组行的注意力 */
.live__assist {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin: 10px 0;
  padding: 10px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper-card);
}

.live__assist .tiny {
  flex: 1;
  min-width: 0;
}

.live__warm-hint {
  margin: -2px 0 8px;
  color: var(--clay);
}

.set--completed .set__prev {
  color: var(--text-3);
  opacity: 0.7;
}

.addset {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 44px;
  border-radius: 14px;
  border: 1.5px dashed var(--line-strong);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
  margin-top: 4px;
}

.live__actions {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  /*
   * 真机上「放弃」曾被压到贴屏幕左边缘（文字被裁）。
   * 原因：它没有宽度约束，flex 把剩余空间全给了「结束训练」。
   * 这里给「放弃」固定最小宽度，并允许它在极窄屏上收缩但不消失。
   */
  padding-bottom: env(safe-area-inset-bottom, 0px);
}

.live__actions .btn--ghost {
  flex: 0 0 auto;
  min-width: 88px;
  padding-left: 0;
  padding-right: 0;
}

.live__finish {
  flex: 1;
}

.credit {
  margin-top: 14px;
  padding: 13px 14px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.035);
}

.credit__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.credit__none {
  margin-top: 8px;
  padding-left: 30px;
  color: var(--text-2);
  line-height: 1.45;
}

.credit__box {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  accent-color: var(--text);
  flex: none;
}

.credit__text {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.credit__pick {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.credit__select {
  height: 44px;
  font-size: 14px;
}
.picker {
  display: flex;
  flex-direction: column;
  max-height: 52vh;
  overflow: auto;
}

.picker__item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 11px 2px;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.lib__tag {
  width: 26px;
  height: 26px;
  border-radius: 9px;
  background: rgba(var(--ink-rgb), 0.05);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-2);
  flex: none;
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}
.cmp {
  margin-top: 14px;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.04);
}

.cmp--first {
  background: transparent;
  padding: 10px 2px;
  color: var(--text-2);
}

.cmp__sub {
  margin-top: 3px;
  color: var(--text-3);
}

.cmp__grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
  margin-top: 10px;
}

.cmp__grid > div {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.cmp__num {
  font-size: 19px;
  font-weight: 700;
  letter-spacing: -0.02em;
}

.cmp__delta {
  font-size: 11.5px;
  font-weight: 600;
}

.cmp__delta.up {
  color: var(--lime-ink);
}

.cmp__delta.down {
  color: var(--clay);
}

.cmp__text {
  margin-top: 8px;
  color: var(--text-2);
}
</style>



































/* 热身组：弱化但不隐藏——用户要能看到"先做这些再加重量" */
.set--warmup {
  opacity: 0.85;
}

.set--warmup .set__idx {
  background: transparent;
  border: 1px dashed rgba(var(--ink-rgb), 0.28);
  color: var(--text-3);
  font-size: 10px;
  letter-spacing: 0;
}
