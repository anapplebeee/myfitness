<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { exerciseName, MUSCLES, EXERCISE_BY_ID } from '../content/exercises';
import { formatDuration, formatLoad, formatVolume, shortDate, weekdayLabel } from '../domain/units';
import {
  completedWorkingSets,
  isValidCompleted,
  lastExerciseSets,
  plannedSetCount,
  sessionVolumeGrams,
} from '../domain/metrics';
import { pendingSetCount, contributesToVolume } from '../domain/amend';
import { setSummary } from '../domain/tracking';
import { computeWeek } from '../domain/week';
import { mondayOf } from '../domain/plan';
import { useToast } from '../composables/useToast';
import { useBackLayer, useSheetBack } from '../composables/useBackLayer';
import { buildShareCardData } from '../domain/share-card';
import { shareCard } from '../lib/share-card-canvas';
import type { SetRecord } from '../domain/types';

const props = defineProps<{ sessionId: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { push } = useToast();
const unit = ref<'kg' | 'lb'>('kg');
const dateSheet = ref(false);
const nextDate = ref('');
const editSetId = ref<string | null>(null);
const editLoad = ref('');
const editReps = ref('');
const editExId = ref('');
const confirmDelete = ref(false);
const sharing = ref(false);

/**
 * 生成并分享训练卡片。
 *
 * 用户取消系统分享面板不是错误，所以只有真正失败才提示。
 * 生成过程可能耗时（canvas 绘制 + toBlob），期间禁用按钮避免重复点击。
 */
async function doShare(): Promise<void> {
  const s = session.value;
  if (!s || sharing.value) return;
  sharing.value = true;
  try {
    const outcome = await shareCard(buildShareCardData(s, unit.value));
    if (outcome === 'downloaded') push('图片已保存', 'success');
    else if (outcome === 'unsupported') push('当前环境不支持分享，已尝试保存', 'error');
  } catch {
    push('生成分享图失败', 'error');
  } finally {
    sharing.value = false;
  }
}

// 返回键/边缘返回先关详情，而不是跳回上一个页面
useBackLayer(() => emit('close'));
useSheetBack(dateSheet, () => { dateSheet.value = false; });
useSheetBack(confirmDelete, () => { confirmDelete.value = false; });
useSheetBack(computed(() => editSetId.value !== null), () => { editSetId.value = null; });

// 必须走响应式查询：更正会整体替换 sessions 数组，旧对象引用不会触发重算
const session = computed(() => store.sessionById(props.sessionId));
const isDeleted = computed(() => Boolean(session.value?.deletedAt));
const isSelfReported = computed(() => session.value?.completionBasis === 'selfReported');
const volume = computed(() => (session.value ? sessionVolumeGrams(session.value) : 0));
const pending = computed(() => (session.value ? pendingSetCount(session.value) : 0));
const duration = computed(() => {
  const s = session.value;
  if (!s) return '—';
  if (!s.endedAt) return '未结束';
  return formatDuration((new Date(s.endedAt).getTime() - new Date(s.startedAt).getTime()) / 1000);
});
const countsAsTraining = computed(() => (session.value ? isValidCompleted(session.value) : false));

/**
 * 事后关联周目标。
 *
 * 结束训练时默认会勾上"计入周目标"，但用户可能取消，或这场是空白训练。
 * 没有这个入口的话，"已练完但周目标还是 0"就变成了无法自救的状态。
 */
const creditSheet = ref(false);
useSheetBack(creditSheet, () => { creditSheet.value = false; });

const weekStart = computed(() => (session.value ? mondayOf(session.value.businessDate) : ''));
const weekResult = computed(() => {
  const s = session.value;
  if (!s) return null;
  return computeWeek({
    weekStart: weekStart.value,
    goal: store.goalForWeek(weekStart.value),
    occurrences: [...store.state.occurrences],
    sessions: [...store.state.sessions],
    now: new Date(),
  });
});

const creditedTitle = computed(() => {
  const id = session.value?.occurrenceId;
  if (!id) return '';
  return store.state.occurrences.find((o) => o.id === id)?.title ?? '';
});

/** 可关联的项目：本周仍未满足的；已关联的那一项也算进来，方便取消。 */
const creditOptions = computed(() => {
  const s = session.value;
  if (!s || !weekResult.value) return [];
  const open = store.openOccurrences(weekStart.value, weekResult.value.satisfiedOccurrenceIds);
  const current = s.occurrenceId
    ? store.state.occurrences.find((o) => o.id === s.occurrenceId) ?? null
    : null;
  if (current && !open.some((o) => o.id === current.id)) return [current, ...open];
  return open;
});

function applyCredit(occurrenceId: string | null): void {
  store.creditSessionToOccurrence(props.sessionId, occurrenceId);
  creditSheet.value = false;
  push(occurrenceId ? '已计入本周目标' : '已取消计入周目标', 'success');
}

function openDateSheet(): void {
  nextDate.value = session.value?.businessDate ?? '';
  dateSheet.value = true;
}

function saveDate(): void {
  const error = store.amendSessionDate(props.sessionId, nextDate.value);
  if (error) {
    push(error, 'error');
    return;
  }
  push('日期已更正，相关周已重算', 'success');
  dateSheet.value = false;
}

function startEdit(exerciseId: string, set: SetRecord): void {
  editExId.value = exerciseId;
  editSetId.value = set.id;
  editLoad.value = set.loadGrams !== null ? String(set.loadGrams / 1000) : '';
  editReps.value = set.reps !== null ? String(set.reps) : '';
}

function saveEdit(): void {
  if (!editSetId.value) return;
  const load = Number.parseFloat(editLoad.value.replace(',', '.'));
  const reps = Number.parseInt(editReps.value, 10);
  const patch: Partial<SetRecord> = {};
  if (Number.isFinite(load)) patch.loadGrams = Math.round(load * 1000);
  if (Number.isFinite(reps)) patch.reps = reps;
  const error = store.editSet(props.sessionId, editExId.value, editSetId.value, patch);
  if (error) {
    push(error, 'error');
    return;
  }
  push('已更正这一组', 'success');
  editSetId.value = null;
}

function doDelete(): void {
  store.deleteSession(props.sessionId);
  confirmDelete.value = false;
  push('已删除，可在"已删除"里恢复', 'success');
}

function doRestore(): void {
  store.restoreSession(props.sessionId);
  push('已恢复这场训练', 'success');
}

function skipRest(): void {
  store.skipRemaining(props.sessionId);
  push('剩余未录组已标记为跳过', 'success');
}

function markSelfReported(): void {
  store.markSelfReported(props.sessionId);
  push('已标记为本人确认练过', 'success');
}

function summaryFor(exerciseId: string, set: SetRecord): string {
  const def = EXERCISE_BY_ID.get(exerciseId);
  if (!def) return '—';
  return setSummary(def, set, unit.value);
}

function groupLabel(exerciseId: string): string {
  const g = EXERCISE_BY_ID.get(exerciseId)?.group;
  return MUSCLES.find((m) => m.id === g)?.label ?? '';
}

function lastHint(exerciseId: string): string {
  const list = lastExerciseSets([...store.state.sessions], exerciseId, props.sessionId);
  if (!list.length) return '';
  const top = list.reduce((a, b) => ((b.loadGrams ?? 0) > (a.loadGrams ?? 0) ? b : a));
  if (top.loadGrams === null) return '';
  return `上次 ${formatLoad(top.loadGrams, unit.value)} × ${top.reps}`;
}
</script>

<template>
  <div v-if="session" class="detail">
    <header class="detail__head">
      <button class="icon-btn" aria-label="返回" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <div class="detail__title">
        <p class="label">{{ shortDate(session.businessDate) }} · {{ weekdayLabel(session.businessDate) }}</p>
        <p class="h3">{{ session.title }}</p>
      </div>
      <span v-if="isDeleted" class="chip chip--clay chip--sm">已删除</span>
      <span v-else-if="session.completionBasis === 'selfReported'" class="chip chip--sky chip--sm">自报</span>
      <span v-else-if="session.backfilledAt" class="chip chip--sm">补录</span>
    </header>

    <p v-if="isDeleted" class="detail__banner">
      这场训练已删除，不计入任何统计。原始数据仍保留，可随时恢复。
    </p>

    <section class="card card--ink detail__summary">
      <div class="detail__stats">
        <div>
          <span class="detail__num">{{ completedWorkingSets(session) }}</span>
          <span class="tiny">工作组</span>
        </div>
        <div>
          <span class="detail__num">{{ formatVolume(contributesToVolume(session) ? volume : 0, unit) }}</span>
          <span class="tiny">容量</span>
        </div>
        <div>
          <span class="detail__num">{{ duration }}</span>
          <span class="tiny">时长</span>
        </div>
      </div>
      <p v-if="isSelfReported" class="tiny detail__note">
        本人确认练过，没有逐组记录，因此不计算容量与 PR。
      </p>
      <p v-else-if="pending > 0" class="tiny detail__note">
        还有 {{ pending }} 个计划组没有录入，未录组不会自动算完成。
      </p>
    </section>

    <div class="row gap-8 wrap">
      <button class="btn btn--ghost btn--sm" @click="openDateSheet">更正日期</button>
      <!--
        已删除的场次不给分享入口：分享出去等于把用户主动删掉的记录又传播一次。
        未完成的场次也不给，卡片上的数字会很难看且没有意义。
      -->
      <button
        v-if="!isDeleted && session.status === 'completed'"
        class="btn btn--lime btn--sm"
        :disabled="sharing"
        @click="doShare"
      >
        {{ sharing ? '生成中…' : '分享' }}
      </button>
      <button v-if="pending > 0 && !isDeleted" class="btn btn--ghost btn--sm" @click="skipRest">
        标记剩余为跳过
      </button>
      <button
        v-if="pending === plannedSetCount(session) && !isSelfReported && !isDeleted"
        class="btn btn--ghost btn--sm"
        @click="markSelfReported"
      >
        我确实练过
      </button>
      <button v-if="isDeleted" class="btn btn--lime btn--sm" @click="doRestore">恢复</button>
      <button v-else class="btn btn--danger btn--sm" @click="confirmDelete = true">删除</button>
    </div>

    <section v-for="ex in session.exercises" :key="ex.id" class="card ex">
      <div class="ex__head">
        <div>
          <p class="label">{{ groupLabel(ex.exerciseId) }}</p>
          <p class="h3">{{ exerciseName(ex.exerciseId) }}</p>
          <p v-if="lastHint(ex.exerciseId)" class="tiny">{{ lastHint(ex.exerciseId) }}</p>
        </div>
        <span class="tiny">目标 {{ ex.targetSets }} 组 × {{ ex.repMin }}–{{ ex.repMax }}</span>
      </div>

      <div class="sets">
        <button
          v-for="(set, i) in ex.sets"
          :key="set.id"
          class="set"
          :class="`set--${set.status}`"
          :disabled="isDeleted"
          @click="startEdit(ex.exerciseId, set)"
        >
          <span class="set__idx">{{ i + 1 }}</span>
          <template v-if="set.status === 'completed'">
            <span class="set__main">
              <strong>{{ summaryFor(ex.exerciseId, set) }}</strong>
            </span>
            <span v-if="set.kind === 'warmup'" class="chip chip--sm">热身</span>
            <span v-if="set.editedAt" class="chip chip--sm">已更正</span>
            <span v-else-if="set.kind !== 'warmup'" class="chip chip--lime chip--sm">完成</span>
          </template>
          <span v-else-if="set.status === 'skipped'" class="set__muted">跳过</span>
          <span v-else class="set__muted">未录入</span>
        </button>
      </div>
    </section>

    <p v-if="!session.exercises.length" class="empty card">这场训练没有动作记录。</p>

    <!-- 周目标关联：练完了但没计入时，这里能补上；本周没有可匹配项就不摆这个入口 -->
    <section
      v-if="countsAsTraining && !isDeleted && (session.occurrenceId || creditOptions.length)"
      class="card creditcard"
    >
      <div class="row between">
        <div>
          <p class="label">周目标</p>
          <p class="small creditcard__text">
            {{ session.goalCreditConfirmed && creditedTitle ? `已计入：${creditedTitle}` : '这场还没计入本周目标，只记了次数与天数' }}
          </p>
        </div>
        <button class="btn btn--ghost btn--sm" @click="creditSheet = true">
          {{ session.goalCreditConfirmed ? '修改' : '计入' }}
        </button>
      </div>
    </section>
    <p v-else-if="!countsAsTraining" class="tiny detail__foot">不计入训练次数：没有完成的工作组。</p>

    <!-- 日期更正 -->
    <Transition name="sheet">
      <div v-if="dateSheet" class="sheet" @click.self="dateSheet = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">更正</p>
              <h2 class="h2">训练日期</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="dateSheet = false">✕</button>
          </div>
          <div class="field">
            <label class="tiny">新的日期</label>
            <input v-model="nextDate" class="input" type="date" :max="new Date().toISOString().slice(0, 10)" />
          </div>
          <p class="tiny" style="margin-top: 10px">
            移到其他周会同时解除与计划项目的关联，需要重新选择匹配项；受影响的两周会重算。
          </p>
          <button class="btn btn--lime btn--block btn--lg" style="margin-top: 16px" @click="saveDate">保存日期</button>
        </div>
      </div>
    </Transition>

    <!-- 单组更正 -->
    <Transition name="sheet">
      <div v-if="editSetId" class="sheet" @click.self="editSetId = null">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">更正</p>
              <h2 class="h2">{{ exerciseName(editExId) }}</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="editSetId = null">✕</button>
          </div>
          <div class="grid-2">
            <div class="field">
              <label class="tiny">重量（kg）</label>
              <input v-model="editLoad" class="input input--lg" inputmode="decimal" />
            </div>
            <div class="field">
              <label class="tiny">次数</label>
              <input v-model="editReps" class="input input--lg" inputmode="numeric" />
            </div>
          </div>
          <button class="btn btn--lime btn--block btn--lg" style="margin-top: 16px" @click="saveEdit">保存更正</button>
        </div>
      </div>
    </Transition>

    <!-- 周目标关联 -->
    <Transition name="sheet">
      <div v-if="creditSheet" class="sheet" @click.self="creditSheet = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">周目标</p>
              <h2 class="h2">这场训练算哪一项</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="creditSheet = false">✕</button>
          </div>
          <p class="small">
            一个计划项最多由一场训练满足。改动只影响周目标完成数，不改变训练记录本身。
          </p>
          <div class="stack gap-8" style="margin-top: 12px">
            <button
              v-for="o in creditOptions"
              :key="o.id"
              class="list__row creditrow"
              :class="{ 'is-on': session.occurrenceId === o.id }"
              @click="applyCredit(o.id)"
            >
              <span class="recent__body">
                <span class="h3">{{ o.title }}</span>
                <span class="tiny">{{ shortDate(o.scheduledDate) }}</span>
              </span>
              <span v-if="session.occurrenceId === o.id" class="chip chip--lime chip--sm">当前</span>
            </button>
            <p v-if="!creditOptions.length" class="empty">本周没有可匹配的计划项。</p>
          </div>
          <button
            v-if="session.occurrenceId"
            class="btn btn--ghost btn--block"
            style="margin-top: 12px"
            @click="applyCredit(null)"
          >
            取消计入
          </button>
        </div>
      </div>
    </Transition>

    <!-- 删除确认 -->
    <Transition name="sheet">
      <div v-if="confirmDelete" class="sheet" @click.self="confirmDelete = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">删除</p>
              <h2 class="h2">删除这场训练？</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="confirmDelete = false">✕</button>
          </div>
          <p class="small">
            删除后不计入统计与周目标，但数据会保留为墓碑记录，可以恢复。不会只改统计而不留痕迹。
          </p>
          <div class="row gap-10" style="margin-top: 16px">
            <button class="btn btn--ghost btn--block" @click="confirmDelete = false">取消</button>
            <button class="btn btn--danger btn--block" @click="doDelete">确认删除</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 40px;
}

.detail__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail__title {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail__banner {
  padding: 11px 14px;
  border-radius: 14px;
  background: var(--clay-soft);
  color: var(--clay);
  font-size: 12.5px;
}

.detail__summary {
  padding: 18px;
  background: radial-gradient(120% 100% at 100% 0%, var(--ink-glow) 0%, var(--surface-ink) 58%);
}

.detail__stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

.detail__stats > div {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.detail__stats .tiny {
  color: rgba(var(--inv-rgb), 0.45);
}

.detail__num {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.03em;
}

.detail__note {
  margin-top: 12px;
  color: rgba(var(--inv-rgb), 0.55);
}

.ex {
  padding: 15px 16px;
}

.ex__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.sets {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.set {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 9px 10px;
  border-radius: 13px;
  background: rgba(var(--ink-rgb), 0.03);
  text-align: left;
  width: 100%;
}

.set--completed {
  background: rgba(201, 245, 63, 0.14);
}

/* 热身组不计入容量，视觉上要与工作组区分 */
.set--completed:has(.chip:not(.chip--lime)) {
  background: rgba(var(--ink-rgb), 0.045);
}

.set--skipped,
.set--planned {
  opacity: 0.62;
}

.set__idx {
  width: 22px;
  height: 22px;
  border-radius: 7px;
  background: rgba(var(--ink-rgb), 0.07);
  display: grid;
  place-items: center;
  font-size: 11px;
  font-weight: 650;
  color: var(--text-2);
  flex: none;
}

.set__main {
  display: flex;
  align-items: baseline;
  gap: 6px;
  flex: 1;
}

.set__main strong {
  font-size: 15px;
  font-weight: 680;
}

.set__main span {
  font-size: 12.5px;
  color: var(--text-2);
}

.set__muted {
  font-size: 12.5px;
  color: var(--text-3);
  flex: 1;
}

.detail__foot {
  padding: 0 4px;
}

.creditcard {
  padding: 14px 16px;
}

.creditcard__text {
  margin-top: 4px;
  line-height: 1.5;
}

.creditrow {
  width: 100%;
  text-align: left;
  align-items: center;
  padding: 10px 12px;
  border-radius: 14px;
  background: rgba(var(--ink-rgb), 0.035);
}

.creditrow.is-on {
  background: rgba(201, 245, 63, 0.18);
}
</style>








