<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { EXERCISES, TEMPLATES, TEMPLATE_BY_ID, exerciseName, exerciseGroup, MUSCLES } from '../content/exercises';
import { businessDate, formatDuration, formatVolume, shortDate } from '../domain/units';
import { isValidCompleted, lastExerciseSets, sessionVolumeGrams } from '../domain/metrics';
import LiveWorkout from '../components/LiveWorkout.vue';


const mode = ref<'plan' | 'history' | 'library'>('plan');
const liveSessionId = ref<string | null>(null);
const search = ref('');
const group = ref<string>('all');

const sessions = computed(() => [...store.state.sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
const active = computed(() => sessions.value.find((s) => s.status === 'active' || s.status === 'paused') ?? null);

const history = computed(() => sessions.value.filter(isValidCompleted));

const templates = TEMPLATES;
const currentTemplate = computed(() =>
  store.state.activeTemplateId ? TEMPLATE_BY_ID.get(store.state.activeTemplateId) ?? null : null,
);

const filteredExercises = computed(() => {
  const q = search.value.trim().toLowerCase();
  return EXERCISES.filter((ex) => {
    if (group.value !== 'all' && ex.group !== group.value) return false;
    if (!q) return true;
    return ex.name.toLowerCase().includes(q) || (ex.alias ?? []).some((a) => a.includes(q));
  });
});

function startFromTemplate(dayId: string): void {
  const tpl = currentTemplate.value;
  if (!tpl) return;
  const day = tpl.days.find((d) => d.id === dayId);
  if (!day) return;
  const session = store.createSession({
    id: store.newId('s'),
    templateId: tpl.id,
    dayId: day.id,
    title: day.title,
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    businessDate: businessDate(),
    restEndsAt: null,
    note: '',
    exercises: day.exercises.map((pe, i) => {
      // 用上次可比记录预填计划组，首次训练则留空
      const last = lastExerciseSets([...store.state.sessions], pe.exerciseId, null);
      const top = last.reduce<number>((max, s) => Math.max(max, s.loadGrams ?? 0), 0);
      const topReps = last.find((s) => (s.loadGrams ?? 0) === top)?.reps ?? pe.repMin;
      return {
        id: store.newId('se'),
        exerciseId: pe.exerciseId,
        order: i,
        targetSets: pe.sets,
        repMin: pe.repMin,
        repMax: pe.repMax,
        restSeconds: pe.restSeconds,
        incrementGrams: pe.incrementGrams,
        sets: Array.from({ length: pe.sets }, () => ({
          id: store.newId('set'),
          kind: 'work' as const,
          status: 'planned' as const,
          loadGrams: top > 0 ? top : null,
          reps: top > 0 ? Math.min(pe.repMax, Math.max(pe.repMin, topReps)) : null,
          durationSeconds: null,
          distanceMeters: null,
          rpe: null,
          completedAt: null,
        })),
      };
    }),
  });
  liveSessionId.value = session.id;
}

function startBlank(): void {
  const session = store.createSession({
    id: store.newId('s'),
    templateId: null,
    dayId: null,
    title: '空白训练',
    status: 'active',
    startedAt: new Date().toISOString(),
    endedAt: null,
    businessDate: businessDate(),
    restEndsAt: null,
    note: '',
    exercises: [],
  });
  liveSessionId.value = session.id;
}

function resume(): void {
  if (active.value) liveSessionId.value = active.value.id;
}

function groupLabel(id: string): string {
  return MUSCLES.find((m) => m.id === id)?.short ?? id;
}

function sessionDuration(startedAt: string): string {
  return formatDuration((Date.now() - new Date(startedAt).getTime()) / 1000);
}
</script>

<template>
  <div class="train">
    <LiveWorkout
      v-if="liveSessionId"
      :session-id="liveSessionId"
      @close="liveSessionId = null"
      @finished="liveSessionId = null"
    />

    <template v-else>
      <header class="train__head">
        <div>
          <p class="label">训练</p>
          <h1 class="h1">{{ active ? '有一场未结束' : '今天练点力气' }}</h1>
        </div>
        <span v-if="active" class="chip chip--clay">{{ sessionDuration(active.startedAt) }}</span>
      </header>

      <button v-if="active" class="card resume" @click="resume">
        <span class="resume__pulse" />
        <span class="resume__body">
          <span class="h3">{{ active.title }}</span>
          <span class="tiny">{{ shortDate(active.businessDate) }} 开始 · 点按继续</span>
        </span>
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M9 6l6 6-6 6" />
        </svg>
      </button>

      <div class="seg train__seg" role="tablist">
        <button class="seg__item" :class="{ 'is-on': mode === 'plan' }" @click="mode = 'plan'">计划</button>
        <button class="seg__item" :class="{ 'is-on': mode === 'history' }" @click="mode = 'history'">历史</button>
        <button class="seg__item" :class="{ 'is-on': mode === 'library' }" @click="mode = 'library'">动作库</button>
      </div>

      <!-- plan mode -->
      <template v-if="mode === 'plan'">
        <button class="btn btn--primary btn--block btn--lg start" @click="startBlank">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          空白训练
        </button>

        <div v-if="currentTemplate" class="section">
          <div class="section__head">
            <h2 class="h2">{{ currentTemplate.title }}</h2>
            <span class="chip chip--sm">{{ currentTemplate.daysPerWeek }} 天/周</span>
          </div>
          <p class="small template__sub">{{ currentTemplate.subtitle }}</p>

          <div class="stack gap-8">
            <button
              v-for="day in currentTemplate.days"
              :key="day.id"
              class="card day"
              @click="startFromTemplate(day.id)"
            >
              <span class="day__badge">{{ day.exercises.length }}</span>
              <span class="day__body">
                <span class="h3">{{ day.title }}</span>
                <span class="tiny">{{ day.exercises.map((e) => exerciseName(e.exerciseId)).slice(0, 3).join(' · ') }}</span>
              </span>
              <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M9 6l6 6-6 6" />
              </svg>
            </button>
          </div>

          <div class="card card--flat template__policy">
            <p class="label">渐进规则</p>
            <p class="small">{{ currentTemplate.progression }}</p>
          </div>
        </div>

        <div class="section">
          <div class="section__head">
            <h2 class="h2">换一套模板</h2>
          </div>
          <div class="scroll-x">
            <button
              v-for="tpl in templates"
              :key="tpl.id"
              class="card card--flat tpl"
              :class="{ 'is-on': tpl.id === store.state.activeTemplateId }"
              @click="store.setTemplate(tpl.id)"
            >
              <span class="label">{{ tpl.daysPerWeek }} 天 / 周</span>
              <span class="h3">{{ tpl.title.split(' · ')[0] }}</span>
              <span class="tiny">{{ tpl.days.length }} 个训练日</span>
            </button>
          </div>
        </div>
      </template>

      <!-- history -->
      <template v-else-if="mode === 'history'">
        <div class="card card--ink history__summary">
          <p class="label">累计</p>
          <div class="row gap-28">
            <div class="stat">
              <span class="stat__value">{{ history.length }}<span class="stat__unit">次</span></span>
              <span class="stat__label">有效训练</span>
            </div>
            <div class="stat">
              <span class="stat__value">
                {{ formatVolume(history.reduce((s, x) => s + sessionVolumeGrams(x), 0), 'kg') }}
              </span>
              <span class="stat__label">总容量</span>
            </div>
          </div>
        </div>

        <div class="card history__list">
          <div v-for="s in history.slice(0, 20)" :key="s.id" class="list__row history__row">
            <span class="recent__date">
              <strong>{{ shortDate(s.businessDate).split('月')[1]?.replace('日', '') }}</strong>
              <span>{{ shortDate(s.businessDate).split('月')[0] }}月</span>
            </span>
            <span class="recent__body">
              <span class="h3">{{ s.title }}</span>
              <span class="tiny">
                {{ s.exercises.length }} 个动作 · {{ formatVolume(sessionVolumeGrams(s), 'kg') }} · {{ formatDuration((new Date(s.endedAt ?? s.startedAt).getTime() - new Date(s.startedAt).getTime()) / 1000) }}
              </span>
            </span>
          </div>
          <p v-if="!history.length" class="empty">还没有完成的训练，开始第一场吧。</p>
        </div>
      </template>

      <!-- library -->
      <template v-else>
        <div class="field">
          <input v-model="search" class="input" type="search" placeholder="搜索动作，如 深蹲 / 卧推" />
        </div>
        <div class="scroll-x lib__groups">
          <button class="chip" :class="{ 'chip--on': group === 'all' }" @click="group = 'all'">全部</button>
          <button
            v-for="m in MUSCLES"
            :key="m.id"
            class="chip"
            :class="{ 'chip--on': group === m.id }"
            @click="group = m.id"
          >
            {{ m.label }}
          </button>
        </div>
        <div class="card lib__list">
          <div v-for="ex in filteredExercises" :key="ex.id" class="list__row lib__row">
            <span class="lib__tag">{{ groupLabel(exerciseGroup(ex.id)) }}</span>
            <span class="recent__body">
              <span class="h3">{{ ex.name }}</span>
              <span class="tiny">{{ ex.equipment }} · {{ ex.cues?.slice(0, 2).join(' / ') }}</span>
            </span>
          </div>
          <p v-if="!filteredExercises.length" class="empty">没有匹配的动作，试试其他关键词。</p>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.train {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.train__head {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 12px;
}

.train__seg {
  margin-top: 4px;
}

.resume {
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  width: 100%;
  border-color: rgba(226, 87, 44, 0.28);
}

.resume__pulse {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: var(--clay);
  box-shadow: 0 0 0 4px rgba(226, 87, 44, 0.16);
  animation: breathe 1.8s var(--ease-out) infinite;
}

@keyframes breathe {
  0%, 100% { box-shadow: 0 0 0 4px rgba(226, 87, 44, 0.16); }
  50% { box-shadow: 0 0 0 8px rgba(226, 87, 44, 0.05); }
}

.resume__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.start {
  margin-top: 2px;
}

.template__sub {
  margin-bottom: 12px;
}

.day {
  display: flex;
  align-items: center;
  gap: 14px;
  text-align: left;
  width: 100%;
  padding: 15px 16px;
  transition: transform 0.2s var(--ease-spring), box-shadow 0.2s var(--ease-out);
}

.day:hover {
  transform: translateY(-1px);
  box-shadow: var(--shadow-float);
}

.day__badge {
  width: 34px;
  height: 34px;
  border-radius: 12px;
  background: var(--ink);
  color: var(--lime);
  display: grid;
  place-items: center;
  font-size: 13px;
  font-weight: 680;
  flex: none;
}

.day__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.template__policy {
  margin-top: 12px;
}

.tpl {
  min-width: 168px;
  display: flex;
  flex-direction: column;
  gap: 5px;
  text-align: left;
  padding: 14px;
  flex: none;
}

.tpl.is-on {
  background: var(--ink);
  color: var(--text-inverse);
  border-color: transparent;
}

.tpl.is-on .label,
.tpl.is-on .tiny {
  color: rgba(244, 246, 238, 0.55);
}

.history__summary {
  padding: 20px;
}

.history__list {
  padding: 6px 16px;
}

.history__row {
  align-items: center;
}

.recent__date {
  width: 44px;
  display: flex;
  flex-direction: column;
  align-items: center;
  line-height: 1.05;
  flex: none;
}

.recent__date strong {
  font-size: 19px;
  font-weight: 680;
  letter-spacing: -0.03em;
}

.recent__date span {
  font-size: 10px;
  color: var(--text-3);
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.lib__groups {
  margin-top: 2px;
}

.lib__list {
  padding: 4px 16px;
}

.lib__row {
  align-items: center;
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
</style>




