<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, EXERCISES, MUSCLES } from '../content/exercises';
import { formatLoad, formatRest, formatDuration } from '../domain/units';
import { completedSetCount, completedWorkingSets, lastExerciseSets, plannedSetCount } from '../domain/metrics';
import { useRestTimer } from '../composables/useRestTimer';
import { useToast } from '../composables/useToast';
import type { SetRecord } from '../domain/types';
import { setImmersive } from '../composables/useImmersive';

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
const elapsed = ref(0);
window.setInterval(() => {
  const s = session.value;
  if (s) elapsed.value = (Date.now() - new Date(s.startedAt).getTime()) / 1000;
}, 1000);

const activeExercise = computed(() => session.value?.exercises[activeExIndex.value] ?? null);

interface DraftSet {
  load: string;
  reps: string;
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
      rpe: '',
    };
  }
  return drafts.value[key]!;
}

function updateDraft(exId: string, setId: string, patch: Partial<DraftSet>): void {
  const key = draftKey(exId, setId);
  const current = drafts.value[key] ?? { load: '', reps: '', rpe: '' };
  drafts.value[key] = { ...current, ...patch };
}

function parseDraft(exId: string, set: SetRecord): { loadGrams: number; reps: number } | null {
  const d = draftFor(exId, set);
  const load = Number.parseFloat(d.load.replace(',', '.'));
  const reps = Number.parseInt(d.reps, 10);
  if (!Number.isFinite(load) || load < 0 || !Number.isFinite(reps) || reps <= 0) return null;
  const grams = unit.value === 'kg' ? Math.round(load * 1000) : Math.round((load / 2.20462) * 1000);
  return { loadGrams: grams, reps };
}

function complete(exId: string, set: SetRecord): void {
  const parsed = parseDraft(exId, set);
  if (!parsed) {
    push('先填重量和次数', 'error');
    return;
  }
  const ex = activeExercise.value;
  store.completeSet(props.sessionId, exId, set.id, {
    ...parsed,
    rpe: drafts.value[draftKey(exId, set.id)]?.rpe ? Number(drafts.value[draftKey(exId, set.id)]!.rpe) : null,
  });
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
  finishing.value = true;
}

function confirmFinish(): void {
  store.updateSession(props.sessionId, { status: 'completed', endedAt: new Date().toISOString(), restEndsAt: null });
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
    store.addExerciseToSession(props.sessionId, {
      id: store.newId('se'),
      exerciseId,
      order: 0,
      targetSets: 3,
      repMin: 8,
      repMax: 12,
      restSeconds: 90,
      incrementGrams: 2500,
      sets: [],
    });
  } else {
    store.replaceExerciseInSession(props.sessionId, ex.exerciseId, exerciseId);
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
          <p class="tiny">{{ lastHint(activeExercise.exerciseId) }} · 目标 {{ activeExercise.targetSets }} 组 × {{ activeExercise.repMin }}–{{ activeExercise.repMax }} 次</p>
        </div>
      </div>

      <div class="seg live__unit">
        <button class="seg__item" :class="{ 'is-on': unit === 'kg' }" @click="unit = 'kg'">kg</button>
        <button class="seg__item" :class="{ 'is-on': unit === 'lb' }" @click="unit = 'lb'">lb</button>
      </div>

      <div class="sets">
        <div v-for="(set, idx) in activeExercise.sets" :key="set.id" class="set" :class="`set--${set.status}`">
          <span class="set__idx">{{ idx + 1 }}</span>
          <template v-if="set.status === 'completed'">
            <span class="set__done">
              <strong>{{ set.loadGrams !== null ? formatLoad(set.loadGrams, unit) : '—' }}</strong>
              <span>× {{ set.reps }}</span>
            </span>
            <span v-if="set.rpe" class="chip chip--sm">RPE {{ set.rpe }}</span>
            <span class="chip chip--lime chip--sm">已保存</span>
          </template>
          <template v-else-if="set.status === 'skipped'">
            <span class="set__skip">已跳过</span>
          </template>
          <template v-else>
            <div class="set__inputs">
              <input
                class="input input--lg set__input"
                inputmode="decimal"
                :value="draftFor(activeExercise.exerciseId, set).load"
                :placeholder="set.loadGrams ? String(set.loadGrams / 1000) : '0'"
                @input="updateDraft(activeExercise.exerciseId, set.id, { load: ($event.target as HTMLInputElement).value })"
              />
              <span class="set__x">×</span>
              <input
                class="input input--lg set__input"
                inputmode="numeric"
                :value="draftFor(activeExercise.exerciseId, set).reps"
                :placeholder="String(activeExercise.repMin)"
                @input="updateDraft(activeExercise.exerciseId, set.id, { reps: ($event.target as HTMLInputElement).value })"
              />
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
          <div class="picker">
            <button v-for="ex in EXERCISES.slice(0, 24)" :key="ex.id" class="picker__item" @click="pickExercise(ex.id)">
              <span class="lib__tag">{{ MUSCLES.find((m) => m.id === ex.group)?.short }}</span>
              <span class="recent__body">
                <span class="h3">{{ ex.name }}</span>
                <span class="tiny">{{ ex.equipment }}</span>
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
</style>

