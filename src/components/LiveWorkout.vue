<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, EXERCISES, MUSCLES } from '../content/exercises';
import { formatLoad, formatRest, formatDuration, formatVolume, shortDate } from '../domain/units';
import { completedSetCount, completedWorkingSets, lastExerciseSets, plannedSetCount } from '../domain/metrics';
import { useRestTimer } from '../composables/useRestTimer';
import { useToast } from '../composables/useToast';
import { setSummary } from '../domain/tracking';
import { diffSessions, previousComparableSession, summarizeSession } from '../domain/goals';
import type { SetRecord, TrackingMode } from '../domain/types';
import { setImmersive } from '../composables/useImmersive';
import { mondayOf } from '../domain/plan';
import { computeWeek } from '../domain/week';

const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ (e: 'close'): void; (e: 'finished'): void }>();

const { push } = useToast();

onMounted(() => setImmersive(true));
onBeforeUnmount(() => setImmersive(false));
const session = computed(() => store.findSession(props.sessionId));
const rest = useRestTimer();

const unit = ref<'kg' | 'lb'>('kg');
const activeExIndex = ref(0);
const showPicker = ref(false);
const finishing = ref(false);
const creditChoice = ref<string>('');
const creditConfirmed = ref(false);
const elapsed = ref(0);
window.setInterval(() => {
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

function complete(exId: string, set: SetRecord): void {
  const parsed = parseDraft(exId, set);
  if (!parsed) {
    push(EXERCISES.find((e) => e.id === exId)?.mode === 'load_reps' ? '先填重量和次数' : '先填完整数据', 'error');
    return;
  }
  const ex = activeExercise.value;
  store.completeSet(props.sessionId, exId, set.id, parsed);
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

function finish(): void {
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
  const sameDay = open.find((o) => o.scheduledDate === s.businessDate);
  creditChoice.value = sameDay?.id ?? open[0]?.id ?? '';
  creditConfirmed.value = false;
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

function confirmFinish(): void {
  store.updateSession(props.sessionId, { status: 'completed', endedAt: new Date().toISOString(), restEndsAt: null });
  store.creditSessionToOccurrence(props.sessionId, creditConfirmed.value && creditChoice.value ? creditChoice.value : null);
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
      </div>

      <div v-if="modeOf(activeExercise.exerciseId) === 'load_reps'" class="seg live__unit">
        <button class="seg__item" :class="{ 'is-on': unit === 'kg' }" @click="unit = 'kg'">kg</button>
        <button class="seg__item" :class="{ 'is-on': unit === 'lb' }" @click="unit = 'lb'">lb</button>
      </div>

      <div class="sets">
        <div v-for="(set, idx) in activeExercise.sets" :key="set.id" class="set" :class="`set--${set.status}`">
          <span class="set__idx">{{ idx + 1 }}</span>
          <template v-if="set.status === 'completed'">
            <span class="set__done">
              <strong>{{ completedSummary(activeExercise.exerciseId, set) }}</strong>
            </span>
            <span v-if="set.rpe" class="chip chip--sm">RPE {{ set.rpe }}</span>
            <span class="chip chip--lime chip--sm">已保存</span>
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
            <button class="btn btn--lime btn--sm" @click="complete(activeExercise.exerciseId, set)">完成</button>
            <button class="set__skipbtn" aria-label="跳过本组" @click="skip(set.id)">跳过</button>
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
                <span class="tiny">只有勾选并确认后，本场才算满足一个计划项目</span>
              </span>
            </label>
            <div v-if="creditConfirmed" class="credit__pick">
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
          </div>

          <div class="row gap-10" style="margin-top: 18px">
            <button class="btn btn--ghost btn--block" @click="finishing = false">继续练</button>
            <button class="btn btn--lime btn--block" @click="confirmFinish">确认结束</button>
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
  background: rgba(244, 246, 238, 0.1);
  color: var(--text-inverse);
}

.live__exlist {
  padding: 2px 0;
}

.live__panel {
  padding: 18px;
}

.live__panel-head {
  margin-bottom: 12px;
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

.set {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.028);
  flex-wrap: wrap;
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
  background: rgba(17, 20, 17, 0.07);
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
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 150px;
}

.set__input {
  height: 46px;
  font-size: 19px;
  border-radius: 12px;
}

.set__x {
  color: var(--text-3);
  font-size: 13px;
}

.set__skipbtn {
  font-size: 11.5px;
  color: var(--text-3);
  padding: 4px 6px;
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
}

.live__finish {
  flex: 1;
}

.credit {
  margin-top: 14px;
  padding: 13px 14px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.035);
}

.credit__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
}

.credit__box {
  width: 20px;
  height: 20px;
  margin-top: 1px;
  accent-color: var(--ink);
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
  background: rgba(17, 20, 17, 0.05);
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
  background: rgba(17, 20, 17, 0.04);
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
  color: #4a7a1f;
}

.cmp__delta.down {
  color: var(--clay);
}

.cmp__text {
  margin-top: 8px;
  color: var(--text-2);
}
</style>
















