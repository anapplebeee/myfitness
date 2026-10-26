<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { EXERCISES, exerciseName, exerciseGroup, MUSCLES } from '../content/exercises';
import { businessDate, formatDuration, formatVolume, shortDate } from '../domain/units';
import { isValidCompleted, sessionVolumeGrams } from '../domain/metrics';
import { liveSessionId, openSession, openTemplateEditor } from '../composables/useOverlay';
import { useSheetBack } from '../composables/useBackLayer';
import { useToast } from '../composables/useToast';
import { computeWeek, statusLabel } from '../domain/week';
import { mondayOf } from '../domain/plan';
import { todayTraining } from '../domain/today';
import { monthCells, monthLabel, monthSummary, shiftMonth, type MonthCell } from '../domain/calendar';
import MonthCalendar from '../components/MonthCalendar.vue';
import ExerciseDemo from '../components/ExerciseDemo.vue';
import type { Route } from '../types/nav';

const props = defineProps<{ greetingName?: string }>();
void props;
const { push } = useToast();
const emit = defineEmits<{ (e: 'navigate', tab: Route): void }>();
void emit;
const mode = ref<'plan' | 'history' | 'library'>('plan');
// 录制开关统一由 useOverlay 管理，避免本页与全局各持一套状态
const search = ref('');
const group = ref<string>('all');
/** 动作演示面板：非空时显示 */
const demoId = ref<string | null>(null);

const sessions = computed(() => [...store.state.sessions].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1)));
const active = computed(() => sessions.value.find((s) => s.status === 'active' || s.status === 'paused') ?? null);

const history = computed(() => sessions.value.filter(isValidCompleted));

/**
 * 今天的状态。训练页必须和今日页说同一句话：
 * 已经练完/已经顺延的，不要再摆一个"开始"让人重复开一场。
 */
const today = businessDate();
const weekResult = computed(() => {
  const weekStart = mondayOf(today);
  return computeWeek({
    weekStart,
    goal: store.goalForWeek(weekStart),
    occurrences: [...store.state.occurrences],
    sessions: [...store.state.sessions],
    now: new Date(),
  });
});

const todayInfo = computed(() =>
  todayTraining({
    today,
    occurrences: [...store.state.occurrences],
    sessions: [...store.state.sessions],
    result: weekResult.value,
  }),
);

const weekStatusText = computed(() => ({
  label: statusLabel(weekResult.value.status),
  done: weekResult.value.completedOccurrences,
  target: weekResult.value.minimumTarget,
}));

const templates = computed(() => store.allTemplates());
const currentTemplate = computed(() =>
  store.state.activeTemplateId ? store.templateById(store.state.activeTemplateId) : null,
);

/**
 * 训练日历（月）。
 *
 * 原来放在"周目标"页里，但它讲的是"这个月练了哪些天"，
 * 属于训练记录而不是周目标承诺——挪到历史里更符合用户找它的路径。
 */
const monthAnchor = ref(today);
const monthKey = computed(() => monthAnchor.value.slice(0, 7));

const calendarCells = computed<MonthCell[]>(() =>
  monthCells({
    anchor: monthAnchor.value,
    occurrences: [...store.state.occurrences],
    sessions: [...store.state.sessions],
    goalForWeek: (w) => store.goalForWeek(w),
    today,
  }),
);

const calendarStats = computed(() =>
  monthSummary({
    month: monthKey.value,
    cells: calendarCells.value,
    sessions: [...store.state.sessions],
    occurrences: [...store.state.occurrences],
  }),
);

function shiftMonthView(delta: number): void {
  monthAnchor.value = shiftMonth(monthKey.value, delta);
}

/** 点日历某天：有记录就打开那一场，没有就明确说一声，别让用户以为点了没反应。 */
function openDaySessions(cell: MonthCell): void {
  const list = sessions.value.filter(
    (s) => !s.deletedAt && s.businessDate === cell.date && isValidCompleted(s),
  );
  if (!list.length) {
    push(`${shortDate(cell.date)} 没有训练记录`);
    return;
  }
  openSession(list[0]!.id);
}

const filteredExercises = computed(() => {
  const q = search.value.trim().toLowerCase();
  return EXERCISES.filter((ex) => {
    if (group.value !== 'all' && ex.group !== group.value) return false;
    if (!q) return true;
    return ex.name.toLowerCase().includes(q) || (ex.alias ?? []).some((a) => a.includes(q));
  });
});

/**
 * 开始某个训练日。
 *
 * 之前这里自己拼一遍会话，和 store.startSessionFromDay 各写一份预填逻辑；
 * 现在统一走 store，并先看今天这一项的状态：
 * 已完成的直接打开记录，已顺延的明确告知会记为加练，
 * 避免"练完了还能再练一次，周目标却没动"。
 */
function startFromTemplate(dayId: string): void {
  const info = store.planStateForDay(dayId);
  if (info.status === 'done') {
    push('今天这一项已经完成了', 'success');
    if (info.sessionId) openSession(info.sessionId);
    return;
  }
  if (info.status === 'moved') {
    push(`这项已顺延到 ${shortDate(info.movedTo ?? '')}，现在开始会记为加练`, 'error');
  } else if (info.status === 'later') {
    push(`这项排在 ${shortDate(info.movedTo ?? '')}，今天开始会记为加练`);
  } else if (info.status === 'excused') {
    push('这项本周已豁免，今天开始会记为加练');
  } else if (info.status === 'cancelled') {
    push('这项本周已取消，今天开始会记为加练');
  }
  const session = store.startSessionFromDay(dayId);
  if (!session) {
    push('模板不存在', 'error');
    return;
  }
  liveSessionId.value = session.id;
}

function dayChip(dayId: string): { text: string; cls: string } | null {
  const info = store.planStateForDay(dayId);
  if (info.status === 'done') return { text: '已完成', cls: 'chip--lime' };
  if (info.status === 'moved') return { text: `顺延至 ${shortDate(info.movedTo ?? '')}`, cls: '' };
  if (info.status === 'open') return { text: '今天', cls: 'chip--sky' };
  if (info.status === 'later') return { text: shortDate(info.movedTo ?? ''), cls: '' };
  if (info.status === 'excused') return { text: '已豁免', cls: 'chip--sky' };
  if (info.status === 'cancelled') return { text: '已取消', cls: '' };
  return null;
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

function chooseTemplate(id: string): void {
  const error = store.applyTemplate(id);
  if (error) {
    push(error, 'error');
    return;
  }
  push('已切换模板，只影响今天及以后还没开始的安排', 'success');
}

function duplicate(id: string): void {
  const copy = store.duplicateTemplate(id);
  if (!copy) {
    push('复制失败', 'error');
    return;
  }
  push(`已复制为「${copy.title}」`, 'success');
  openTemplateEditor(copy.id);
}

function createNewTemplate(): void {
  const t = store.createTemplate();
  openTemplateEditor(t.id);
}

// ---- 补录 ----
const backfillOpen = ref(false);
const backfillDate = ref('');
const backfillTitle = ref('补录训练');
const backfillSelfReported = ref(false);
const backfillPicked = ref<string[]>([]);

function openBackfill(): void {
  backfillDate.value = businessDate();
  backfillTitle.value = '补录训练';
  backfillSelfReported.value = false;
  backfillPicked.value = [];
  backfillOpen.value = true;
}

function toggleBackfillExercise(id: string): void {
  backfillPicked.value = backfillPicked.value.includes(id)
    ? backfillPicked.value.filter((x) => x !== id)
    : [...backfillPicked.value, id];
}

function submitBackfill(): void {
  const error = store.backfillSession({
    date: backfillDate.value,
    title: backfillTitle.value,
    exerciseIds: backfillPicked.value,
    selfReported: backfillSelfReported.value,
  });
  if (error) {
    push(error, 'error');
    return;
  }
  push('补录已保存', 'success');
  backfillOpen.value = false;
}

// 返回键/边缘返回：先关补录面板
useSheetBack(backfillOpen, () => { backfillOpen.value = false; });

function groupLabel(id: string): string {
  return MUSCLES.find((m) => m.id === id)?.short ?? id;
}

function sessionDuration(startedAt: string): string {
  return formatDuration((Date.now() - new Date(startedAt).getTime()) / 1000);
}
</script>

<template>
  <div class="train">
    <!-- 录制面板由 App.vue 统一渲染（覆盖层），此处不再重复 -->
    <!-- 录制面板由 App.vue 统一渲染（覆盖层），此处不再重复 -->
      <header class="train__head">
        <div>
          <p class="label">训练</p>
          <h1 class="h1">{{ active ? '有一场未结束' : todayInfo.state === 'done' ? '今天已经练完' : '今天练点力气' }}</h1>
        </div>
        <div class="row gap-6">
          <span class="chip chip--sm">{{ weekStatusText.label }} {{ weekStatusText.done }}/{{ weekStatusText.target }}</span>
          <span v-if="active" class="chip chip--clay">{{ sessionDuration(active.startedAt) }}</span>
          <button class="btn btn--ghost btn--sm" @click="openBackfill">补录</button>
        </div>
      </header>

      <!-- 今天的真实状态：避免"已练完/已顺延"还摆着开始按钮 -->
      <button
        v-if="todayInfo.state === 'done' && todayInfo.session"
        class="card todaybar todaybar--done"
        @click="openSession(todayInfo.session.id)"
      >
        <span class="todaybar__badge">✓</span>
        <span class="todaybar__body">
          <span class="h3">今天已完成 · {{ todayInfo.session.title }}</span>
          <span class="tiny">
            {{ todayInfo.session.exercises.length }} 个动作 ·
            {{ todayInfo.credited ? '已计入本周目标' : '未计入周目标，只记次数' }}
          </span>
        </span>
        <span class="chip chip--lime chip--sm">查看</span>
      </button>

      <div v-else-if="todayInfo.state === 'moved'" class="card todaybar todaybar--moved">
        <span class="todaybar__badge">↷</span>
        <span class="todaybar__body">
          <span class="h3">今天这项已顺延</span>
          <span class="tiny">改到 {{ shortDate(todayInfo.movedTo ?? '') }}；今天开始会记为加练，不占用原计划项。</span>
        </span>
      </div>

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
            <div class="row gap-6">
              <span class="chip chip--sm">v{{ currentTemplate.version }}</span>
              <button class="btn btn--ghost btn--sm" @click="openTemplateEditor(currentTemplate.id)">编辑</button>
            </div>
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
              <span v-if="dayChip(day.id)" class="chip chip--sm" :class="dayChip(day.id)!.cls">
                {{ dayChip(day.id)!.text }}
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
            <button class="btn btn--ghost btn--sm" @click="createNewTemplate">新建</button>
          </div>
          <div class="scroll-x">
            <div
              v-for="tpl in templates"
              :key="tpl.id"
              class="tpl-wrap"
            >
              <button
                class="card card--flat tpl"
                :class="{ 'is-on': tpl.id === store.state.activeTemplateId }"
                @click="chooseTemplate(tpl.id)"
              >
                <span class="label">{{ tpl.daysPerWeek }} 天 / 周 · v{{ tpl.version }}</span>
                <span class="h3">{{ tpl.title.split(' · ')[0] }}{{ tpl.title.endsWith('（副本）') ? '（副本）' : '' }}</span>
                <span class="tiny">{{ tpl.days.length }} 个训练日</span>
              </button>
              <div class="tpl__tools">
                <button class="tpl__tool" @click="openTemplateEditor(tpl.id)">编辑</button>
                <button class="tpl__tool" @click="duplicate(tpl.id)">复制</button>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- history -->
      <template v-else-if="mode === 'history'">
        <!-- 训练日历：整月看"哪天练了、哪天断了" -->
        <section class="section">
          <div class="section__head">
            <h2 class="h2">训练日历</h2>
            <div class="row gap-6">
              <button class="icon-btn" aria-label="上个月" @click="shiftMonthView(-1)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6" /></svg>
              </button>
              <span class="tiny">{{ monthLabel(monthKey) }}</span>
              <button class="icon-btn" aria-label="下个月" @click="shiftMonthView(1)">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6" /></svg>
              </button>
            </div>
          </div>
          <div class="card mcalcard">
            <MonthCalendar :cells="calendarCells" :today="today" @select="openDaySessions" />
          </div>
          <div v-if="calendarStats.sessionCount > 0" class="mstat">
            <span><strong>{{ calendarStats.trainedDays }}</strong> 天有训练</span>
            <span><strong>{{ calendarStats.sessionCount }}</strong> 次</span>
            <span v-if="calendarStats.missedDays"><strong>{{ calendarStats.missedDays }}</strong> 天漏做</span>
          </div>
        </section>

        <!-- 空状态：没有记录时显示 0 次与空列表，会让用户以为坏了 -->
        <div v-if="!history.length" class="card history__blank">
          <p class="label">还没有训练记录</p>
          <p class="h2" style="margin-top: 8px">第一次训练完成后，这里会有东西</p>
          <p class="small" style="margin-top: 8px">
            每场训练会记下动作、组数、重量与时长。之后可以按日期回看，也能看到同一动作的变化。
          </p>
          <button class="btn btn--lime btn--block" style="margin-top: 16px" @click="mode = 'plan'">
            去计划页开始
          </button>
        </div>

        <template v-else>
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
          <button
            v-for="s in history.slice(0, 20)"
            :key="s.id"
            class="list__row history__row history__btn"
            @click="openSession(s.id)"
          >
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
            <span v-if="s.completionBasis === 'selfReported'" class="chip chip--sky chip--sm">自报</span>
            <span v-else-if="s.backfilledAt" class="chip chip--sm">补录</span>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
              <path d="M9 6l6 6-6 6" />
            </svg>
          </button>
          <p v-if="!history.length" class="empty">还没有完成的训练，开始第一场吧。</p>
        </div>

        
        </template>
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
          <button
            v-for="ex in filteredExercises"
            :key="ex.id"
            class="list__row lib__row lib__btn"
            @click="demoId = ex.id"
          >
            <span class="lib__tag">{{ groupLabel(exerciseGroup(ex.id)) }}</span>
            <span class="recent__body">
              <span class="h3">{{ ex.name }}</span>
              <span class="tiny">{{ ex.equipment }} · {{ ex.cues?.slice(0, 2).join(' / ') }}</span>
            </span>
            <span class="chip chip--sm">要领</span>
          </button>
          <p v-if="!filteredExercises.length" class="empty">没有匹配的动作，试试其他关键词。</p>
        </div>
      </template>


    <!-- 补录 -->
    <Transition name="sheet">
      <div v-if="backfillOpen" class="sheet" @click.self="backfillOpen = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">补录</p>
              <h2 class="h2">补录一次训练</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="backfillOpen = false">✕</button>
          </div>

          <div class="field">
            <label class="tiny">日期（不能是未来）</label>
            <input v-model="backfillDate" class="input" type="date" :max="businessDate()" />
          </div>
          <div class="field" style="margin-top: 12px">
            <label class="tiny">名称</label>
            <input v-model="backfillTitle" class="input" />
          </div>

          <label class="credit__row" style="margin-top: 14px">
            <input v-model="backfillSelfReported" type="checkbox" class="credit__box" />
            <span class="credit__text">
              <span class="h3">只确认练过，不记组</span>
              <span class="tiny">自报完成不计容量与 PR，但计入训练次数与周目标</span>
            </span>
          </label>

          <template v-if="!backfillSelfReported">
            <div class="divider" />
            <p class="tiny">选择动作（{{ backfillPicked.length }} 个已选）</p>
            <div class="pick-grid">
              <button
                v-for="ex in EXERCISES.slice(0, 18)"
                :key="ex.id"
                class="chip"
                :class="{ 'chip--on': backfillPicked.includes(ex.id) }"
                @click="toggleBackfillExercise(ex.id)"
              >
                {{ ex.name }}
              </button>
            </div>
          </template>

          <button class="btn btn--lime btn--block btn--lg" style="margin-top: 16px" @click="submitBackfill">
            保存补录
          </button>
        </div>
      </div>
    </Transition>

    <!-- 动作演示 -->
    <ExerciseDemo v-if="demoId" :exercise-id="demoId" @close="demoId = null" />
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

/* 今日状态条：把"已经练完 / 已经顺延"写在最上面 */
.todaybar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  text-align: left;
  padding: 14px 16px;
}

.todaybar--done {
  border-color: rgba(201, 245, 63, 0.5);
  background: linear-gradient(120% 100% at 100% 0%, rgba(201, 245, 63, 0.18), var(--card) 62%);
}

.todaybar--moved {
  border-color: rgba(226, 87, 44, 0.26);
}

.todaybar__badge {
  width: 32px;
  height: 32px;
  border-radius: 11px;
  display: grid;
  place-items: center;
  background: var(--surface-ink);
  color: var(--lime);
  font-size: 14px;
  font-weight: 700;
  flex: none;
}

.todaybar--moved .todaybar__badge {
  background: var(--clay-soft);
  color: var(--clay);
}

.todaybar__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
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
  background: var(--surface-ink);
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
  background: var(--surface-ink);
  color: var(--text-inverse);
  border-color: transparent;
}

.tpl.is-on .label,
.tpl.is-on .tiny {
  color: rgba(var(--inv-rgb), 0.55);
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

.mcalcard {
  padding: 14px 12px;
}

.mstat {
  display: flex;
  gap: 14px;
  padding: 2px 4px 0;
  font-size: 12px;
  color: var(--text-2);
}

.mstat strong {
  font-size: 14px;
  font-weight: 680;
  color: var(--text);
}

.lib__list {
  padding: 4px 16px;
}

.lib__row {
  align-items: center;
}

.lib__btn {
  width: 100%;
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
</style>






<style>
.credit__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.035);
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

.pick-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 8px;
  max-height: 30vh;
  overflow: auto;
}
</style>











