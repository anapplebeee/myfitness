<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName } from '../content/exercises';
import {
  addDays,
  businessDate,
  parseBusinessDate,
  shortDate,
  weekdayLabel,
} from '../domain/units';
import {
  computeWeek,
  dayStatesForWeek,
  daysLeftInWeek,
  foldStreak,
  isValidCompletedSession,
  statusLabel,
  targetNarrative,
  EXCUSE_REASONS,
  type DayCell,
  type PlannedOccurrence,
  type WeekResult,
} from '../domain/week';
import { mondayOf } from '../domain/plan';
import { useSheetBack } from '../composables/useBackLayer';
import { useToast } from '../composables/useToast';
import type { NavigatePayload } from '../types/nav';

const emit = defineEmits<{ (e: 'navigate', payload: NavigatePayload): void }>();
defineProps<{ greetingName?: string }>();

const { push } = useToast();
const today = businessDate();
const thisWeek = mondayOf(today);

const weekOffset = ref(0);
const activeWeek = computed(() => addDays(thisWeek, weekOffset.value * 7));

const occurrences = computed(() => store.state.occurrences);
const sessions = computed(() => [...store.state.sessions]);

const result = computed<WeekResult>(() =>
  computeWeek({
    weekStart: activeWeek.value,
    goal: store.goalForWeek(activeWeek.value),
    occurrences: [...occurrences.value],
    sessions: sessions.value,
    now: new Date(),
  }),
);

const weekOccurrences = computed(() =>
  occurrences.value
    .filter((o) => o.weekStart === activeWeek.value)
    .sort((a, b) => (a.scheduledDate < b.scheduledDate ? -1 : 1)),
);

const days = computed<DayCell[]>(() =>
  dayStatesForWeek(activeWeek.value, [...occurrences.value], sessions.value, result.value, today),
);

const goal = computed(() => store.goalForWeek(activeWeek.value));

// 连续达标：从最早到当前周
const streak = computed(() => {
  const weeks: WeekResult[] = [];
  const starts = [...new Set(occurrences.value.map((o) => o.weekStart))].sort();
  for (const w of starts) {
    if (w > activeWeek.value) continue;
    weeks.push(
      computeWeek({
        weekStart: w,
        goal: store.goalForWeek(w),
        occurrences: [...occurrences.value],
        sessions: sessions.value,
        now: new Date(),
      }),
    );
  }
  return foldStreak(weeks);
});

const isCurrentWeek = computed(() => weekOffset.value === 0);
const canGoNext = computed(() => weekOffset.value < 1);
const daysLeft = computed(() => daysLeftInWeek(today, activeWeek.value));

// --- 操作面板 ---
const acting = ref<PlannedOccurrence | null>(null);
const excuseReason = ref<string>(EXCUSE_REASONS[0]);
const postponeDate = ref('');
const showTargetEditor = ref(false);
const targetInput = ref(1);
const targetReason = ref('');

function openActions(o: PlannedOccurrence): void {
  acting.value = o;
  excuseReason.value = EXCUSE_REASONS[0];
  postponeDate.value = o.scheduledDate;
}

function closeActions(): void {
  acting.value = null;
}

function apply(kind: 'excuse' | 'cancel' | 'restore'): void {
  const o = acting.value;
  if (!o) return;
  const command =
    kind === 'excuse'
      ? { kind, id: o.id, reason: excuseReason.value }
      : kind === 'cancel'
        ? { kind, id: o.id, reason: '主动取消' }
        : { kind, id: o.id };
  const error = store.runPlanCommand(command);
  if (error) {
    push(error, 'error');
    return;
  }
  push(kind === 'excuse' ? `已豁免：${o.title}` : kind === 'cancel' ? '已取消这一项' : '已恢复安排', 'success');
  closeActions();
}

function applyPostpone(): void {
  const o = acting.value;
  if (!o) return;
  const error = store.runPlanCommand({ kind: 'postpone', id: o.id, date: postponeDate.value });
  if (error) {
    push(error, 'error');
    return;
  }
  push(`已顺延到 ${shortDate(postponeDate.value)}`, 'success');
  closeActions();
}

function openTargetEditor(): void {
  const g = goal.value;
  if (!g) return;
  targetInput.value = result.value.minimumTarget;
  targetReason.value = '';
  showTargetEditor.value = true;
}

function saveTarget(): void {
  const error = store.setMinimumTarget(activeWeek.value, targetInput.value, targetReason.value || '未填写原因');
  if (error) {
    push(error, 'error');
    return;
  }
  push('最低目标已更新，保留调整记录', 'success');
  showTargetEditor.value = false;
}

const weekdayOfWeek = (i: number) => weekdayLabel(addDays(activeWeek.value, i)).replace('周', '');

function isSatisfied(o: PlannedOccurrence): boolean {
  // 以会话关联为唯一权威（09 号口径），不依赖当前周的统计结果——
  // 月视图里会点到别的周的项目，用周结果判断会串周。
  return sessions.value.some(
    (s) =>
      !s.deletedAt &&
      isValidCompletedSession(s) &&
      s.occurrenceId === o.id &&
      s.goalCreditConfirmed === true,
  );
}

const stateTone: Record<DayCell['primary'], string> = {
  done: 'is-done',
  in_progress: 'is-live',
  partial: 'is-partial',
  excused: 'is-excused',
  missed: 'is-missed',
  scheduled: 'is-scheduled',
  rest: 'is-rest',
};

const stateLabel: Record<DayCell['primary'], string> = {
  done: '完成',
  in_progress: '进行中',
  partial: '未完成',
  excused: '豁免',
  missed: '未达标',
  scheduled: '待训练',
  rest: '休息',
};

const tone: Record<WeekResult['status'], string> = {
  achieved: 'chip--lime',
  notAchieved: 'chip--clay',
  ongoing: 'chip--sky',
  paused: '',
  upcoming: '',
  unplanned: '',
};

function occurrenceState(o: PlannedOccurrence): { text: string; cls: string } {
  if (o.disposition === 'excused') return { text: '豁免', cls: 'chip--sky' };
  if (o.disposition === 'cancelled') return { text: '已取消', cls: '' };
  if (isSatisfied(o)) return { text: '已完成', cls: 'chip--lime' };
  if (o.scheduledDate < today) return { text: '未完成', cls: 'chip--clay' };
  if (o.originalDate !== o.scheduledDate) return { text: `顺延至 ${shortDate(o.scheduledDate)}`, cls: '' };
  return { text: shortDate(o.scheduledDate), cls: '' };
}

const dayDetail = ref<DayCell | null>(null);

function openDay(cell: DayCell): void {
  dayDetail.value = cell;
}

/** 单日详情里的项目：不限于当前周，月视图点任意一天都能看到内容。 */
const dayItems = computed(() => {
  const cell = dayDetail.value;
  if (!cell) return [];
  return occurrences.value
    .filter((o) => o.scheduledDate === cell.date)
    .sort((a, b) => (a.title < b.title ? -1 : 1));
});

/** 从单日详情跳到该日期所在的周。 */
function jumpToWeek(cell: DayCell): void {
  const target = mondayOf(cell.date);
  const diff = Math.round(
    (new Date(`${target}T12:00:00`).getTime() - new Date(`${thisWeek}T12:00:00`).getTime()) / 86_400_000,
  );
  weekOffset.value = Math.round(diff / 7);
  dayDetail.value = null;
}

/** 在单日详情里点某一项 → 直接打开操作面板（先关掉日详情，避免面板叠面板）。 */
function actFromDay(o: PlannedOccurrence): void {
  dayDetail.value = null;
  openActions(o);
}

// 返回键/边缘返回：先关面板，而不是离开周目标页
useSheetBack(computed(() => acting.value !== null), closeActions);
useSheetBack(showTargetEditor, () => { showTargetEditor.value = false; });
useSheetBack(computed(() => dayDetail.value !== null), () => { dayDetail.value = null; });

</script>

<template>
  <div class="plan">
    <header class="page-head">
      <div>
        <p class="label">周目标</p>
        <h1 class="page-head__title">把这一周安排明白</h1>
      </div>
      <button class="btn btn--ghost btn--sm" @click="emit('navigate', { to: 'train', from: 'plan' })">去训练</button>
    </header>

    <!-- 周切换 -->
    <div class="weeknav">
      <button class="icon-btn" aria-label="上一周" @click="weekOffset -= 1">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <div class="weeknav__label">
        <strong>{{ shortDate(activeWeek) }} – {{ shortDate(addDays(activeWeek, 6)) }}</strong>
        <span class="tiny">{{ isCurrentWeek ? `本周 · 还剩 ${daysLeft} 天` : weekOffset < 0 ? '历史周' : '未来周' }}</span>
      </div>
      <button class="icon-btn" aria-label="下一周" :disabled="!canGoNext" @click="weekOffset += 1">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 6l6 6-6 6" /></svg>
      </button>
    </div>

    <!-- 目标卡 -->
    <section class="card card--ink goalcard">
      <div class="goalcard__top">
        <div>
          <p class="label">本周目标</p>
          <p class="goalcard__value">
            {{ result.completedOccurrences }}<span>/{{ result.minimumTarget }}</span>
          </p>
          <p class="goalcard__narr">{{ targetNarrative(result) }}</p>
        </div>
        <div class="goalcard__badge">
          <span class="chip" :class="tone[result.status]">{{ statusLabel(result.status) }}</span>
          <span v-if="result.targetReached && result.status === 'ongoing'" class="tiny goalcard__hint">已达标，进行中</span>
        </div>
      </div>

      <div class="goalcard__bar">
        <div class="bar">
          <div
            class="bar__fill"
            :style="{ width: `${result.minimumTarget ? Math.min(100, Math.round((result.completedOccurrences / result.minimumTarget) * 100)) : 0}%` }"
          />
        </div>
      </div>

      <div class="goalcard__stats">
        <div>
          <span class="goalcard__num">{{ result.actualSessionCount }}</span>
          <span class="tiny">训练次数</span>
        </div>
        <div>
          <span class="goalcard__num">{{ result.trainingDays }}</span>
          <span class="tiny">训练天数</span>
        </div>
        <div>
          <span class="goalcard__num">{{ streak }}</span>
          <span class="tiny">连续达标周</span>
        </div>
        <div v-if="result.excusedCount || result.cancelledCount">
          <span class="goalcard__num">{{ result.excusedCount }}<span class="goalcard__sub">/{{ result.cancelledCount }}</span></span>
          <span class="tiny">豁免 / 取消</span>
        </div>
      </div>

      <button v-if="goal" class="btn btn--ghost btn--sm goalcard__edit" @click="openTargetEditor">调整最低目标</button>
    </section>

    <p v-if="result.originalPlanned !== result.adjustedPlanned" class="tiny plan__note">
      原始计划 {{ result.originalPlanned }} 项，因豁免或取消调整为 {{ result.adjustedPlanned }} 项；原始承诺保留不变。
    </p>

    <!-- 日历 -->
    <section class="section">
      <div class="section__head">
        <h2 class="h2">本周安排</h2>
        <span class="tiny">{{ weekOccurrences.length }} 项</span>
      </div>
      <div class="week">
        <button
          v-for="(cell, i) in days"
          :key="cell.date"
          class="day"
          :class="[stateTone[cell.primary], { 'is-today': cell.date === today }]"
          @click="openDay(cell)"
        >
          <span class="day__label">{{ weekdayOfWeek(i) }}</span>
          <span class="day__num">{{ parseBusinessDate(cell.date).getDate() }}</span>
          <span class="day__badge">{{ stateLabel[cell.primary] }}</span>
          <span v-if="cell.missedNote" class="day__note">{{ cell.missedNote }}</span>
          <span v-else-if="cell.movedCount" class="day__note">顺延 {{ cell.movedCount }}</span>
        </button>
      </div>
      <p class="tiny plan__legend">
        徽标优先：完成 › 进行中 › 未完成 › 未达标 › 待训练 › 豁免 › 休息。一天完成一项漏一项时仍会标注漏项。
      </p>
    </section>

    <!-- 明细 -->
    <section class="section">
      <div class="section__head">
        <h2 class="h2">项目明细</h2>
      </div>
      <div class="card items">
        <button
          v-for="o in weekOccurrences"
          :key="o.id"
          class="item"
          :class="{ 'is-disposed': o.disposition !== 'scheduled' }"
          @click="openActions(o)"
        >
          <span class="item__date">
            <strong>{{ parseBusinessDate(o.scheduledDate).getDate() }}</strong>
            <span>{{ weekdayOfWeek(Number(o.scheduledDate.slice(8, 10)) - Number(activeWeek.slice(8, 10))) }}</span>
          </span>
          <span class="item__body">
            <span class="h3">{{ o.title }}</span>
            <span class="tiny">
              {{ o.exerciseIds.slice(0, 3).map((id) => exerciseName(id)).join(' · ') }}
              <template v-if="o.dispositionReason"> · {{ o.dispositionReason }}</template>
            </span>
          </span>
          <span class="chip chip--sm" :class="occurrenceState(o).cls">{{ occurrenceState(o).text }}</span>
        </button>
        <p v-if="!weekOccurrences.length" class="empty">这一周还没有安排。</p>
      </div>
    </section>

    <p class="tiny plan__foot">
      豁免与取消无限额，不需要理由也会记录；跨周不搬训练债务，可豁免或保留原周未完成。
    </p>

    <!-- 项目操作 -->
    <Transition name="sheet">
      <div v-if="acting" class="sheet" @click.self="closeActions">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">{{ shortDate(acting.scheduledDate) }}</p>
              <h2 class="h2">{{ acting.title }}</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="closeActions">✕</button>
          </div>

          <p v-if="isSatisfied(acting)" class="tiny acts__locked">
            这一项已经由一场训练满足。改动计划不会抹掉训练事实；如需更正，请在训练记录里修改。
          </p>
          <div v-else class="acts">
            <button class="act" @click="apply('excuse')">
              <span class="act__title">豁免</span>
              <span class="tiny">不计入最低目标，保留原因</span>
            </button>
            <button class="act" @click="apply('cancel')">
              <span class="act__title">取消</span>
              <span class="tiny">从本周安排移除，保留审计</span>
            </button>
            <button v-if="acting.disposition !== 'scheduled'" class="act" @click="apply('restore')">
              <span class="act__title">恢复</span>
              <span class="tiny">重新计入最低目标</span>
            </button>
          </div>

          <div class="divider" />

          <div class="field">
            <label class="tiny">豁免原因</label>
            <div class="scroll-x reasons">
              <button
                v-for="r in EXCUSE_REASONS"
                :key="r"
                class="chip"
                :class="{ 'chip--on': excuseReason === r }"
                @click="excuseReason = r"
              >
                {{ r }}
              </button>
            </div>
          </div>

          <div class="field" style="margin-top: 14px">
            <label class="tiny">顺延到（仅限本周内）</label>
            <div class="row gap-8">
              <input v-model="postponeDate" class="input" type="date" :min="activeWeek" :max="addDays(activeWeek, 6)" />
              <button class="btn btn--primary btn--sm" @click="applyPostpone">顺延</button>
            </div>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 目标编辑 -->
    <Transition name="sheet">
      <div v-if="showTargetEditor" class="sheet" @click.self="showTargetEditor = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">最低目标</p>
              <h2 class="h2">{{ shortDate(activeWeek) }} 这一周</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="showTargetEditor = false">✕</button>
          </div>
          <p class="small">
            当前可执行 {{ result.adjustedPlanned }} 项，原始计划 {{ result.originalPlanned }} 项。
            调整会记录原值与原因，不做静默修改。
          </p>
          <div class="field" style="margin-top: 14px">
            <label class="tiny">新的最低目标</label>
            <input v-model.number="targetInput" class="input input--lg" type="number" :min="0" :max="result.adjustedPlanned" />
          </div>
          <div class="field" style="margin-top: 12px">
            <label class="tiny">原因（会写入调整记录）</label>
            <input v-model="targetReason" class="input" placeholder="如：这周出差，先保 2 次" />
          </div>
          <button class="btn btn--lime btn--block btn--lg" style="margin-top: 16px" @click="saveTarget">保存目标</button>
        </div>
      </div>
    </Transition>

    <!-- 单日详情 -->
    <Transition name="sheet">
      <div v-if="dayDetail" class="sheet" @click.self="dayDetail = null">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">{{ weekdayLabel(dayDetail.date) }}</p>
              <h2 class="h2">{{ shortDate(dayDetail.date) }}</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="dayDetail = null">✕</button>
          </div>
          <div class="row gap-6 wrap">
            <span class="chip chip--sm" :class="stateTone[dayDetail.primary] === 'is-done' ? 'chip--lime' : ''">
              {{ stateLabel[dayDetail.primary] }}
            </span>
            <span v-if="dayDetail.missedNote" class="chip chip--sm chip--clay">{{ dayDetail.missedNote }}</span>
            <span v-if="dayDetail.movedCount" class="chip chip--sm">顺延 {{ dayDetail.movedCount }} 项</span>
          </div>
          <div class="divider" />
          <div v-if="dayItems.length" class="stack gap-8">
            <button
              v-for="o in dayItems"
              :key="o.id"
              class="list__row dayitem"
              :class="{ 'is-disposed': o.disposition !== 'scheduled' }"
              @click="actFromDay(o)"
            >
              <span class="item__body">
                <span class="h3">{{ o.title }}</span>
                <span class="tiny">
                  {{ o.exerciseIds.slice(0, 3).map((id) => exerciseName(id)).join(' · ') }}
                </span>
              </span>
              <span class="chip chip--sm" :class="occurrenceState(o).cls">{{ occurrenceState(o).text }}</span>
            </button>
          </div>
          <p v-else class="empty">这天没有安排，也没有训练记录。</p>

          <div class="row gap-10" style="margin-top: 16px">
            <button class="btn btn--ghost btn--block" @click="dayDetail = null">关闭</button>
            <button class="btn btn--primary btn--block" @click="jumpToWeek(dayDetail)">看这一周</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.plan {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.weeknav {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dayitem {
  width: 100%;
  text-align: left;
  align-items: center;
}

.dayitem.is-disposed {
  opacity: 0.55;
}

.weeknav__label {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.weeknav__label strong {
  font-size: 14.5px;
  letter-spacing: -0.02em;
}

.goalcard {
  padding: 20px;
  background: radial-gradient(120% 100% at 100% 0%, var(--ink-glow) 0%, var(--surface-ink) 58%);
}

.goalcard__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.goalcard__value {
  font-size: 46px;
  font-weight: 700;
  letter-spacing: -0.05em;
  line-height: 1;
  margin: 8px 0 6px;
}

.goalcard__value span {
  font-size: 20px;
  color: rgba(var(--inv-rgb), 0.45);
  font-weight: 600;
}

.goalcard__narr {
  font-size: 12px;
  color: rgba(var(--inv-rgb), 0.55);
}

.goalcard__badge {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 5px;
}

.goalcard__hint {
  color: rgba(201, 245, 63, 0.7);
}

.goalcard__bar {
  margin-top: 16px;
}

.goalcard__stats {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  margin-top: 16px;
}

.goalcard__stats > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.goalcard__stats .tiny {
  color: rgba(var(--inv-rgb), 0.45);
  font-size: 10.5px;
}

.goalcard__sub {
  font-size: 12px;
  color: rgba(var(--inv-rgb), 0.45);
}

.goalcard__num {
  font-size: 19px;
  font-weight: 680;
  letter-spacing: -0.03em;
}

.goalcard__edit {
  margin-top: 14px;
  background: rgba(var(--inv-rgb), 0.1);
  color: var(--text-inverse);
}

.plan__note {
  padding: 0 4px;
}

.week {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 6px;
}

.day {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  gap: 4px;
  min-height: 96px;
  padding: 10px 4px 9px;
  border-radius: 15px;
  background: var(--card);
  border: 1px solid var(--line);
  transition: transform 0.18s var(--ease-spring);
}

.day:active {
  transform: scale(0.96);
}

.day__label {
  font-size: 10px;
  color: var(--text-3);
}

.day__num {
  font-size: 16px;
  line-height: 1.15;
  font-weight: 680;
  letter-spacing: -0.03em;
}

.day__badge {
  font-size: 9px;
  line-height: 1;
  padding: 3px 5px;
  border-radius: 6px;
  background: rgba(var(--ink-rgb), 0.05);
  color: var(--text-2);
  white-space: nowrap;
}

.day__note {
  font-size: 8.5px;
  color: var(--clay);
  text-align: center;
  line-height: 1.1;
}

.day.is-done {
  background: var(--surface-ink);
  border-color: transparent;
  color: var(--lime);
}

.day.is-done .day__label {
  color: rgba(201, 245, 63, 0.6);
}

.day.is-done .day__badge {
  background: rgba(201, 245, 63, 0.18);
  color: var(--lime);
}

.day.is-live {
  background: var(--lime);
  border-color: transparent;
}

.day.is-live .day__label,
.day.is-live .day__badge {
  color: var(--lime-ink);
}

.day.is-live .day__badge {
  background: rgba(var(--ink-rgb), 0.1);
}

.day.is-partial {
  background: var(--clay-soft);
  border-color: rgba(226, 87, 44, 0.24);
}

.day.is-partial .day__badge {
  background: var(--clay-soft);
  color: var(--clay);
}

.day.is-missed {
  border-color: rgba(226, 87, 44, 0.4);
  border-style: dashed;
}

.day.is-missed .day__badge {
  background: var(--clay-soft);
  color: var(--clay);
}

.day.is-excused {
  background: var(--sky-soft);
  border-color: transparent;
}

.day.is-excused .day__badge {
  background: rgba(79, 125, 240, 0.16);
  color: var(--sky-ink);
}

.day.is-today {
  box-shadow: 0 0 0 1.5px var(--text);
}

.plan__legend {
  margin-top: 8px;
  padding: 0 2px;
  line-height: 1.5;
}

.items {
  padding: 4px 16px;
}

.item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 0;
  border-bottom: 1px solid var(--line);
  text-align: left;
}

.item:last-child {
  border-bottom: 0;
}

.item.is-disposed {
  opacity: 0.55;
}

.item__date {
  width: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: none;
  line-height: 1.05;
}

.item__date strong {
  font-size: 17px;
  font-weight: 680;
}

.item__date span {
  font-size: 9.5px;
  color: var(--text-3);
}

.item__body {
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
  min-width: 0;
}

.plan__foot {
  padding: 0 4px;
  line-height: 1.5;
}

.acts__locked {
  padding: 12px 14px;
  border-radius: 14px;
  background: rgba(201, 245, 63, 0.16);
  color: var(--lime-ink);
}

.acts {
  display: grid;
  grid-template-columns: 1fr;
  gap: 8px;
}

.act {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 13px 15px;
  border-radius: 16px;
  background: rgba(var(--ink-rgb), 0.035);
  text-align: left;
}

.act:hover {
  background: rgba(var(--ink-rgb), 0.07);
}

.act__title {
  font-size: 14.5px;
  font-weight: 640;
}

.reasons {
  margin-top: 8px;
}
</style>













