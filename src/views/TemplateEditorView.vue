<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { store } from '../store/appStore';
import { EXERCISES, MUSCLES, exerciseName } from '../content/exercises';
import type { PlanDay, PlanExercise, Template } from '../content/types';
import {
  addDay,
  addExercise,
  cloneTemplate,
  defaultPlanExercise,
  isSameTemplate,
  moveExercise,
  removeDay,
  removeExercise,
  templateSummary,
  updateDay,
  updateExercise,
  validateTemplate,
} from '../domain/template';
import { useToast } from '../composables/useToast';
import { useBackLayer, useSheetBack } from '../composables/useBackLayer';

const props = defineProps<{ templateId: string }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { push } = useToast();
const draft = ref<Template | null>(null);
const baseline = ref<Template | null>(null);
const activeDayId = ref<string>('');
const pickerOpen = ref(false);
const confirmation = ref(false);

// 返回键/边缘返回：先关浮层，再退出编辑器
useBackLayer(() => emit('close'));
useSheetBack(pickerOpen, () => { pickerOpen.value = false; });
useSheetBack(confirmation, () => { confirmation.value = false; });

watch(
  () => props.templateId,
  (id) => {
    const source = store.templateById(id);
    if (!source) return;
    const copy = cloneTemplate(source);
    draft.value = copy;
    baseline.value = cloneTemplate(source);
    activeDayId.value = copy.days[0]?.id ?? '';
  },
  { immediate: true },
);

const errors = computed(() => (draft.value ? validateTemplate(draft.value) : []));

const activeDay = computed<PlanDay | null>(
  () => draft.value?.days.find((d) => d.id === activeDayId.value) ?? null,
);

const changed = computed(() => {
  if (!draft.value || !baseline.value) return false;
  return !isSameTemplate(draft.value, baseline.value);
});

const isActiveTemplate = computed(() => store.state.activeTemplateId === props.templateId);

const weekdayNames = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];

function setTitle(value: string): void {
  if (!draft.value) return;
  draft.value.title = value;
}

function setSubtitle(value: string): void {
  if (!draft.value) return;
  draft.value.subtitle = value;
}

function setProgression(value: string): void {
  if (!draft.value) return;
  draft.value.progression = value;
}

function patchExercise(index: number, patch: Partial<PlanExercise>): void {
  if (!draft.value || !activeDay.value) return;
  draft.value = updateExercise(draft.value, activeDay.value.id, index, patch);
}

function numeric(value: string, fallback: number): number {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function onAddDay(): void {
  if (!draft.value) return;
  const used = new Set(draft.value.days.map((d) => d.slot));
  const slot = [0, 1, 2, 3, 4, 5, 6].find((s) => !used.has(s)) ?? 6;
  const next = addDay(draft.value, `${draft.value.id}-d${Date.now().toString(36)}`, slot);
  draft.value = next;
  activeDayId.value = next.days[next.days.length - 1]?.id ?? '';
}

function onRemoveDay(dayId: string): void {
  if (!draft.value) return;
  const next = removeDay(draft.value, dayId);
  draft.value = next;
  if (activeDayId.value === dayId) activeDayId.value = next.days[0]?.id ?? '';
}

function onDaySlot(dayId: string, slot: number): void {
  if (!draft.value) return;
  draft.value = updateDay(draft.value, dayId, { slot });
}

function onDayTitle(dayId: string, title: string): void {
  if (!draft.value) return;
  draft.value = updateDay(draft.value, dayId, { title });
}

function onAddExercise(exerciseId: string): void {
  if (!draft.value || !activeDay.value) return;
  draft.value = addExercise(draft.value, activeDay.value.id, defaultPlanExercise(exerciseId));
  pickerOpen.value = false;
}

function onRemoveExercise(index: number): void {
  if (!draft.value || !activeDay.value) return;
  draft.value = removeExercise(draft.value, activeDay.value.id, index);
}

function onMove(index: number, delta: number): void {
  if (!draft.value || !activeDay.value) return;
  draft.value = moveExercise(draft.value, activeDay.value.id, index, delta);
}

function save(): void {
  if (!draft.value) return;
  if (errors.value.length) {
    push(errors.value[0]!.message, 'error');
    return;
  }
  if (changed.value && isActiveTemplate.value) {
    confirmation.value = true;
    return;
  }
  commit();
}

function commit(): void {
  if (!draft.value) return;
  // 改动内容则升版本，保证 planVersionId 变化，历史安排不被覆盖
  const next: Template = changed.value
    ? { ...cloneTemplate(draft.value), version: (baseline.value?.version ?? 1) + 1 }
    : cloneTemplate(draft.value);
  const error = store.saveTemplate(next);
  if (error) {
    push(error, 'error');
    return;
  }
  push(changed.value ? `已保存为新版本 v${next.version}` : '模板未改动', 'success');
  confirmation.value = false;
  emit('close');
}

const groupedExercises = computed(() =>
  MUSCLES.map((m) => ({
    ...m,
    items: EXERCISES.filter((e) => e.group === m.id),
  })).filter((g) => g.items.length),
);

const groupFilter = ref<string>('all');
const keyword = ref('');

const filteredGroups = computed(() => {
  const q = keyword.value.trim();
  return groupedExercises.value
    .filter((g) => groupFilter.value === 'all' || g.id === groupFilter.value)
    .map((g) => ({
      ...g,
      items: q ? g.items.filter((e) => e.name.includes(q)) : g.items,
    }))
    .filter((g) => g.items.length);
});
</script>

<template>
  <div v-if="draft" class="editor">
    <header class="editor__head">
      <button class="icon-btn" aria-label="返回" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M15 6l-6 6 6 6" />
        </svg>
      </button>
      <div class="editor__title">
        <p class="label label--plain">模板 v{{ draft.version }}</p>
        <p class="h3">{{ draft.title || '未命名模板' }}</p>
      </div>
      <button class="btn btn--lime btn--sm" :disabled="!changed && !errors.length" @click="save">保存</button>
    </header>

    <div v-if="errors.length" class="editor__errors">
      <p v-for="(e, i) in errors.slice(0, 3)" :key="i" class="tiny">{{ e.message }}</p>
    </div>

    <section class="card">
      <div class="field">
        <label class="tiny">模板名称</label>
        <input class="input" :value="draft.title" @input="setTitle(($event.target as HTMLInputElement).value)" />
      </div>
      <div class="field" style="margin-top: 12px">
        <label class="tiny">说明</label>
        <input class="input" :value="draft.subtitle" @input="setSubtitle(($event.target as HTMLInputElement).value)" />
      </div>
      <div class="field" style="margin-top: 12px">
        <label class="tiny">渐进规则</label>
        <textarea class="textarea" :value="draft.progression" @input="setProgression(($event.target as HTMLTextAreaElement).value)" />
      </div>
      <p class="tiny editor__summary">{{ templateSummary(draft) }}</p>
    </section>

    <!-- 训练日 -->
    <section class="section">
      <div class="section__head">
        <h2 class="h2">训练日</h2>
        <button class="btn btn--ghost btn--sm" @click="onAddDay">加一天</button>
      </div>
      <div class="scroll-x days">
        <button
          v-for="day in draft.days"
          :key="day.id"
          class="chip"
          :class="{ 'chip--on': day.id === activeDayId }"
          @click="activeDayId = day.id"
        >
          {{ day.title }} · {{ weekdayNames[day.slot] }}
        </button>
      </div>
    </section>

    <section v-if="activeDay" class="section">
      <div class="card">
        <div class="row gap-8">
          <div class="field" style="flex: 1">
            <label class="tiny">名称</label>
            <input
              class="input"
              :value="activeDay.title"
              @input="onDayTitle(activeDay.id, ($event.target as HTMLInputElement).value)"
            />
          </div>
          <div class="field" style="width: 110px">
            <label class="tiny">星期</label>
            <select
              class="input"
              :value="activeDay.slot"
              @change="onDaySlot(activeDay.id, Number(($event.target as HTMLSelectElement).value))"
            >
              <option v-for="(name, i) in weekdayNames" :key="i" :value="i">{{ name }}</option>
            </select>
          </div>
        </div>
        <button
          v-if="draft.days.length > 1"
          class="btn btn--danger btn--sm"
          style="margin-top: 12px"
          @click="onRemoveDay(activeDay.id)"
        >
          删除这一天
        </button>
      </div>

      <div class="stack gap-8" style="margin-top: 12px">
        <div v-for="(ex, i) in activeDay.exercises" :key="`${ex.exerciseId}-${i}`" class="card ex">
          <div class="ex__head">
            <span class="h3">{{ exerciseName(ex.exerciseId) }}</span>
            <div class="row gap-4">
              <button class="icon-btn ex__btn" aria-label="上移" @click="onMove(i, -1)">↑</button>
              <button class="icon-btn ex__btn" aria-label="下移" @click="onMove(i, 1)">↓</button>
              <button class="icon-btn ex__btn" aria-label="删除" @click="onRemoveExercise(i)">✕</button>
            </div>
          </div>
          <div class="ex__grid">
            <label class="ex__field">
              <span class="tiny">组数</span>
              <input
                class="input ex__input"
                type="number"
                min="1"
                max="10"
                :value="ex.sets"
                @input="patchExercise(i, { sets: numeric(($event.target as HTMLInputElement).value, ex.sets) })"
              />
            </label>
            <label class="ex__field">
              <span class="tiny">次数下限</span>
              <input
                class="input ex__input"
                type="number"
                min="1"
                max="100"
                :value="ex.repMin"
                @input="patchExercise(i, { repMin: numeric(($event.target as HTMLInputElement).value, ex.repMin) })"
              />
            </label>
            <label class="ex__field">
              <span class="tiny">次数上限</span>
              <input
                class="input ex__input"
                type="number"
                min="1"
                max="100"
                :value="ex.repMax"
                @input="patchExercise(i, { repMax: numeric(($event.target as HTMLInputElement).value, ex.repMax) })"
              />
            </label>
            <label class="ex__field">
              <span class="tiny">休息（秒）</span>
              <input
                class="input ex__input"
                type="number"
                min="0"
                max="600"
                step="15"
                :value="ex.restSeconds"
                @input="patchExercise(i, { restSeconds: numeric(($event.target as HTMLInputElement).value, ex.restSeconds) })"
              />
            </label>
          </div>
        </div>

        <button class="addset" @click="pickerOpen = true">+ 添加动作</button>
      </div>
    </section>

    <div class="editor__actions">
      <button class="btn btn--ghost btn--lg" @click="emit('close')">取消</button>
      <button class="btn btn--primary btn--lg" style="flex: 1" :disabled="errors.length > 0" @click="save">
        {{ changed ? '保存为新版本' : '完成' }}
      </button>
    </div>

    <!-- 动作选择 -->
    <Transition name="sheet">
      <div v-if="pickerOpen" class="sheet" @click.self="pickerOpen = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">添加动作</p>
              <h2 class="h2">选择动作</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="pickerOpen = false">✕</button>
          </div>
          <input v-model="keyword" class="input" type="search" placeholder="搜索动作" />
          <div class="scroll-x" style="margin-top: 10px">
            <button class="chip" :class="{ 'chip--on': groupFilter === 'all' }" @click="groupFilter = 'all'">全部</button>
            <button
              v-for="m in MUSCLES"
              :key="m.id"
              class="chip"
              :class="{ 'chip--on': groupFilter === m.id }"
              @click="groupFilter = m.id"
            >
              {{ m.label }}
            </button>
          </div>
          <div class="picker">
            <template v-for="g in filteredGroups" :key="g.id">
              <p class="label picker__group">{{ g.label }}</p>
              <button v-for="ex in g.items" :key="ex.id" class="picker__item" @click="onAddExercise(ex.id)">
                <span class="recent__body">
                  <span class="h3">{{ ex.name }}</span>
                  <span class="tiny">{{ ex.equipment }}</span>
                </span>
              </button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <!-- 版本确认 -->
    <Transition name="sheet">
      <div v-if="confirmation" class="sheet" @click.self="confirmation = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">确认改版</p>
              <h2 class="h2">这是正在使用的模板</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="confirmation = false">✕</button>
          </div>
          <p class="small">
            保存后生成 v{{ (baseline?.version ?? 1) + 1 }}，只会重排今天及以后还没开始的安排。
            已经完成或已经开始的训练不受影响，历史记录逐字段保留。
          </p>
          <div class="divider" />
          <div class="row gap-10">
            <button class="btn btn--ghost btn--block" @click="confirmation = false">再想想</button>
            <button class="btn btn--lime btn--block" @click="commit">确认保存</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding-bottom: 90px;
}

.editor__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.editor__title {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.editor__errors {
  padding: 11px 14px;
  border-radius: 14px;
  background: var(--clay-soft);
  color: var(--clay);
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.editor__summary {
  margin-top: 10px;
}

.days {
  padding: 2px 0;
}

.ex {
  padding: 14px 16px;
}

.ex__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 10px;
}

.ex__btn {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  font-size: 13px;
}

.ex__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.ex__field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.ex__input {
  height: 42px;
  padding: 0 10px;
  text-align: center;
  font-size: 14px;
}

.addset {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 48px;
  border-radius: 14px;
  border: 1.5px dashed var(--line-strong);
  color: var(--text-2);
  font-size: 13px;
  font-weight: 600;
}

.editor__actions {
  position: sticky;
  bottom: 0;
  display: flex;
  gap: 10px;
  padding: 10px 0 max(12px, env(safe-area-inset-bottom));
  background: linear-gradient(180deg, rgba(242, 240, 234, 0) 0%, var(--paper) 36%);
}

.picker {
  display: flex;
  flex-direction: column;
  max-height: 46vh;
  overflow: auto;
  margin-top: 6px;
}

.picker__group {
  padding: 10px 0 4px;
}

.picker__item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 2px;
  border-bottom: 1px solid var(--line);
  text-align: left;
  width: 100%;
}

.recent__body {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
  min-width: 0;
}

@media (max-width: 380px) {
  .ex__grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>

