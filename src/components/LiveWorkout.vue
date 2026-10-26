<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, EXERCISES, MUSCLES } from '../content/exercises';
import { formatLoad, formatRest, formatDuration, formatVolume, shortDate } from '../domain/units';
import { completedSetCount, completedWorkingSets, lastExerciseSets, plannedSetCount } from '../domain/metrics';
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

onMounted(() => setImmersive(true));
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
const creditChoice = ref<string>('');
const creditConfirmed = ref(false);
const elapsed = ref(0);
/** 动作演示面板：非空时显示 */
const demoId = ref<string | null>(null);
const saving = ref(false);

// 总结面板与动作面板也要能被返回键关掉，而不是直接退出录制
useSheetBack(finishing, () => { finishing.value = false; });
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
  if (ex) rest.start(ex.restSeconds);
  push('已保存本组', 'success');
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
 * 逐组的「上次」参照。
 *
 * 为什么按索引取而不是只显示最佳组：
 * 真实训练里同一动作各组重量不同（热身 60、工作 80、85），
 * 只给一个"上次最佳"会让用户不知道该组该打多少。
 * 标杆产品（Hevy / Strong）都在每一行给该组的历史值。
 */
function prevFor(exId: string, index: number): string {
  const last = lastExerciseSets([...store.state.sessions], exId, props.sessionId);
  const rec = last[index];
  /*
   * 上次那场只做了更少的组时，后面的组没有对照值。
   *
   * 直接显示 "—" 会让用户以为功能坏了（真机实测就是这个反应），
   * 所以区分两种情况：
   *   - 完全没历史 → "首次"
   *   - 有历史但这场组数更少 → "未做"（明确表示上次没做到这一组）
   */
  if (!rec) return last.length ? '未做' : '首次';
  if (rec.loadGrams !== null && rec.reps !== null) {
    return `${formatLoad(rec.loadGrams, unit.value)} × ${rec.reps}`;
  }
  if (rec.reps !== null) return `自重 × ${rec.reps}`;
  if (rec.durationSeconds !== null) return formatRest(rec.durationSeconds);
  return '—';
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
  creditConfirmed.value = Boolean(match);
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
      <span class="chip chip--sm mono">{{ formatDuration(elapsed) }}</span>
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
          <button class="btn btn--ghost btn--sm rest__btn" @click="rest.add(30)">+30s</button>
          <button class="btn btn--lime btn--sm" @click="rest.stop()">跳过</button>
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
        </div>
        <button class="btn btn--ghost btn--sm demo-btn" @click="demoId = activeExercise!.exerciseId">
          要领
        </button>
      </div>

      <div v-if="modeOf(activeExercise.exerciseId) === 'load_reps'" class="seg live__unit">
        <button class="seg__item" :class="{ 'is-on': unit === 'kg' }" @click="unit = 'kg'">kg</button>
        <button class="seg__item" :class="{ 'is-on': unit === 'lb' }" @click="unit = 'lb'">lb</button>
      </div>

      <div class="sets">
        <div v-for="(set, idx) in activeExercise.sets" :key="set.id" class="set" :class="`set--${set.status}`">
          <span class="set__idx">{{ idx + 1 }}</span>
          <span class="set__prev">{{ prevFor(activeExercise.exerciseId, idx) }}</span>
          <template v-if="set.status === 'completed'">
            <span class="set__done">
              <strong>{{ completedSummary(activeExercise.exerciseId, set) }}</strong>
              <span v-if="set.rpe" class="set__rpe">RPE {{ set.rpe }}</span>
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
                  :placeholder="set.loadGrams ? String(set.loadGrams / 1000) : '0'"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { load: ($event.target as HTMLInputElement).value })"
                />
                <span class="set__x">×</span>
                <input
                  class="input input--lg set__input"
                  inputmode="numeric"
                  :aria-label="`${exerciseName(activeExercise.exerciseId)} 次数`"
                  :value="draftFor(activeExercise.exerciseId, set).reps"
                  :placeholder="String(activeExercise.repMin)"
                  @input="updateDraft(activeExercise.exerciseId, set.id, { reps: ($event.target as HTMLInputElement).value })"
                />
              </template>

              <template v-else-if="modeOf(activeExercise.exerciseId) === 'reps'">
                <input
                  class="input input--lg set__input"
                  inputmode="numeric"
                  aria-label="次数"
                  :value="draftFor(activeExercise.exerciseId, set).reps"
                  :placeholder="String(activeExercise.repMin)"
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
      <button class="btn btn--ghost btn--lg" @click="discard">放弃</button>
      <button class="btn btn--primary btn--lg live__finish" @click="finish">结束训练</button>
    </div>

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
            <div class="stat"><span class="stat__value">{{ completedSetCount(session) }}/{{ plannedSetCount(session) }}</span><span class="stat__label">完成/计划</span></div>
          </div>
          <div class="divider" />
          <p class="small">
            {{ completedSetCount(session) < plannedSetCount(session) ? '有未录的计划组，未录组不会自动算完成。' : '全部计划组已完成。' }}
          </p>

          <!-- 本次 vs 上次：即时反馈是坚持的关键 -->
          <div v-if="comparison" class="cmp">
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

.live__unit {
  max-width: 160px;
  margin-bottom: 16px;
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
 * 列：组号 / 上次 / 输入区 / 勾选 / 跳过
 */
.set {
  display: grid;
  grid-template-columns: 16px 44px minmax(0, 1fr) 40px 16px;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.028);
}

.set--completed {
  background: rgba(201, 245, 63, 0.14);
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
  width: 16px;
  height: 40px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text-3);
  opacity: 0.55;
  cursor: pointer;
  position: relative;
}

/*
 * 视觉宽 16px，但触控区向外扩到 44×44，
 * 否则在真机上很难点中，且容易误触到旁边输入框。
 */
.set__skipbtn::after {
  content: '';
  position: absolute;
  top: -2px;
  bottom: -2px;
  left: -14px;
  right: -14px;
}

.set__skipbtn:active {
  opacity: 1;
}

/*
 * 「上次」列：每组的上一场实际值。
 * 这是训练记录类产品的核心价值——知道这一组该打多少。
 * 用等宽数字 + 弱化颜色，避免和本次输入抢注意力。
 */
.set__prev {
  flex: 0 0 auto;
  min-width: 52px;
  font-size: 11.5px;
  line-height: 1.15;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
  text-align: right;
  letter-spacing: -0.01em;
}

/*
 * 勾选框：替代原来的「完成」文字按钮。
 * 原来那个按钮一行里最宽，真机 369px 宽时把「跳过」挤到下一行；
 * 换成 40px 方形后整行结构稳定，且能一眼扫出完成进度。
 */
.set__check {
  flex: 0 0 auto;
  width: 40px;
  height: 40px;
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
  grid-column: 3 / -1;
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


































