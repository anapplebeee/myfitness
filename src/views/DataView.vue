<script setup lang="ts">
import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { exportFileName, type ImportMode, type ImportPreview } from '../domain/transfer';
import { useToast } from '../composables/useToast';
import { useSheetBack } from '../composables/useBackLayer';
import SyncPanel from './SyncPanel.vue';

const { push } = useToast();

const preview = ref<ImportPreview | null>(null);
const rawText = ref('');
const fileName = ref('');
const mode = ref<ImportMode>('merge');
const busy = ref(false);
const confirmWipe = ref(false);
const confirmReplace = ref(false);

// 返回键/边缘返回先关确认面板（清空数据是不可逆操作，误触代价很高）
useSheetBack(confirmWipe, () => { confirmWipe.value = false; });
useSheetBack(confirmReplace, () => { confirmReplace.value = false; });

const stats = computed(() => preview.value?.stats ?? null);
const conflicts = computed(() => preview.value?.conflicts ?? []);
const issues = computed(() => preview.value?.issues ?? []);
const fatalIssues = computed(() => issues.value.filter((i) => i.fatal));
const warnings = computed(() => issues.value.filter((i) => !i.fatal));

const backup = computed(() => store.latestBackup());

function download(): void {
  const json = store.buildExportJson();
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(store.datasetId());
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  push('已生成导出文件', 'success');
}

function copyExport(): void {
  const json = store.buildExportJson();
  void navigator.clipboard?.writeText(json).then(
    () => push('已复制到剪贴板', 'success'),
    () => push('复制失败，请用下载', 'error'),
  );
}

function onFile(event: Event): void {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  fileName.value = file.name;
  busy.value = true;
  const reader = new FileReader();
  reader.onload = () => {
    rawText.value = String(reader.result ?? '');
    preview.value = store.previewImportJson(rawText.value);
    busy.value = false;
  };
  reader.onerror = () => {
    busy.value = false;
    push('读取文件失败', 'error');
  };
  reader.readAsText(file);
  input.value = '';
}

function doImport(): void {
  if (!preview.value?.ok) return;
  if (mode.value === 'replace' && !confirmReplace.value) return;
  const error = store.applyImportPreview(preview.value, mode.value);
  if (error) {
    push(error, 'error');
    return;
  }
  push(mode.value === 'replace' ? '已替换，旧数据已自动备份' : '已合并导入', 'success');
  preview.value = null;
  rawText.value = '';
  confirmReplace.value = false;
}

function restore(): void {
  const error = store.restoreBackup();
  if (error) {
    push(error, 'error');
    return;
  }
  push('已恢复到替换前的状态', 'success');
}

function wipe(): void {
  store.wipeLocal();
  confirmWipe.value = false;
  push('本机数据已清空', 'success');
}

const totalRecords = computed(() => {
  const s = store.state;
  return (
    s.sessions.length + s.weights.length + s.foods.length + s.occurrences.length + s.weekGoals.length
  );
});
</script>

<template>
  <div class="data">
    <header class="page-head">
      <div>
        <p class="label">数据</p>
        <h1 class="page-head__title">导出与备份</h1>
      </div>
    </header>

    <!-- 概览 -->
    <section class="card card--ink">
      <p class="label">本机数据</p>
      <p class="data__count">{{ totalRecords }}<span>条记录</span></p>
      <div class="data__grid">
        <div><span class="data__num">{{ store.state.sessions.length }}</span><span class="tiny">训练</span></div>
        <div><span class="data__num">{{ store.state.weights.length }}</span><span class="tiny">体重</span></div>
        <div><span class="data__num">{{ store.state.foods.length }}</span><span class="tiny">饮食</span></div>
        <div><span class="data__num">{{ store.state.weekGoals.length }}</span><span class="tiny">周目标</span></div>
      </div>
      <p class="tiny data__id">数据集 {{ store.datasetId() }}</p>
    </section>

    <!-- 导出 -->
    <section class="card">
      <p class="label">导出</p>
      <p class="small" style="margin-top: 6px">
        生成一个 JSON 文件，包含训练、饮食、体重、计划与自建模板。密钥与设备偏好不会被导出。
      </p>
      <div class="row gap-8" style="margin-top: 14px">
        <button class="btn btn--lime btn--block" @click="download">下载备份文件</button>
        <button class="btn btn--ghost btn--sm" @click="copyExport">复制</button>
      </div>
    </section>

    <!-- 导入 -->
    <section class="card">
      <p class="label">导入</p>
      <p class="small" style="margin-top: 6px">
        先校验再预览，确认后才写入。合并模式不会覆盖本地已有内容。
      </p>

      <label class="upload">
        <input type="file" accept="application/json,.json" class="upload__input" @change="onFile" />
        <span class="upload__box">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M12 16V4M8 8l4-4 4 4M4 16v2.4A1.6 1.6 0 0 0 5.6 20h12.8A1.6 1.6 0 0 0 20 18.4V16" />
          </svg>
          <span>{{ fileName || '选择导出文件' }}</span>
        </span>
      </label>

      <p v-if="busy" class="tiny" style="margin-top: 10px">正在读取…</p>

      <!-- 校验结果 -->
      <template v-if="preview">
        <div class="divider" />

        <div v-if="fatalIssues.length" class="issues issues--bad">
          <p v-for="(i, idx) in fatalIssues" :key="idx" class="tiny">✕ {{ i.message }}</p>
          <p class="tiny" style="margin-top: 6px">文件未通过校验，没有写入任何数据。</p>
        </div>

        <template v-else>
          <div v-if="warnings.length" class="issues issues--warn">
            <p v-for="(i, idx) in warnings" :key="idx" class="tiny">! {{ i.message }}</p>
          </div>

          <div v-if="stats" class="preview">
            <p class="label">将导入</p>
            <div class="preview__grid">
              <div><span class="data__num">{{ stats.sessions }}</span><span class="tiny">训练</span></div>
              <div><span class="data__num">{{ stats.weights }}</span><span class="tiny">体重</span></div>
              <div><span class="data__num">{{ stats.foods }}</span><span class="tiny">饮食</span></div>
              <div><span class="data__num">{{ stats.occurrences }}</span><span class="tiny">计划项</span></div>
            </div>
          </div>

          <div v-if="conflicts.length" class="issues issues--warn" style="margin-top: 10px">
            <p class="tiny">{{ conflicts.length }} 处冲突会保留本地版本：</p>
            <p v-for="(c, idx) in conflicts.slice(0, 5)" :key="idx" class="tiny">· {{ c.entity }} {{ c.id }}：{{ c.reason }}</p>
            <p v-if="conflicts.length > 5" class="tiny">…还有 {{ conflicts.length - 5 }} 处</p>
          </div>

          <div class="seg" style="margin-top: 14px">
            <button class="seg__item" :class="{ 'is-on': mode === 'merge' }" @click="mode = 'merge'">合并</button>
            <button class="seg__item" :class="{ 'is-on': mode === 'replace' }" @click="mode = 'replace'">替换</button>
          </div>
          <p class="tiny" style="margin-top: 8px">
            {{ mode === 'merge'
              ? '合并：同 ID 同内容跳过，同 ID 异内容保留本地，新记录追加。'
              : '替换：清空现有记录后写入文件内容，会先自动备份当前状态。' }}
          </p>

          <label v-if="mode === 'replace'" class="credit__row" style="margin-top: 12px">
            <input v-model="confirmReplace" type="checkbox" class="credit__box" />
            <span class="credit__text">
              <span class="h3">我确认要替换</span>
              <span class="tiny">现有记录会被文件内容取代，可从备份恢复</span>
            </span>
          </label>

          <button
            class="btn btn--lime btn--block"
            style="margin-top: 14px"
            :disabled="mode === 'replace' && !confirmReplace"
            @click="doImport"
          >
            {{ mode === 'merge' ? '确认合并导入' : '确认替换' }}
          </button>
        </template>
      </template>
    </section>

    <!-- 同步 -->
    <SyncPanel />

    <!-- 备份恢复 -->
    <section v-if="backup" class="card">
      <p class="label">自动备份</p>
      <p class="small" style="margin-top: 6px">
        上次替换前保存的快照（{{ backup.state.sessions.length }} 条训练）。
      </p>
      <button class="btn btn--ghost btn--block" style="margin-top: 12px" @click="restore">恢复到替换前</button>
    </section>

    <!-- 清空 -->
    <section class="card card--dashed">
      <p class="label">清空本机</p>
      <p class="small" style="margin-top: 6px">
        删除本机所有训练、饮食与体重记录，恢复到初始状态。若你配置过同步，远端数据不会被删除，重新同步可能再次下载。
      </p>
      <button class="btn btn--danger btn--block" style="margin-top: 12px" @click="confirmWipe = true">清空本机数据</button>
    </section>

    <Transition name="sheet">
      <div v-if="confirmWipe" class="sheet" @click.self="confirmWipe = false">
        <div class="sheet__panel">
          <div class="sheet__head">
            <div>
              <p class="label">清空</p>
              <h2 class="h2">确定删除本机数据？</h2>
            </div>
            <button class="icon-btn" aria-label="关闭" @click="confirmWipe = false">✕</button>
          </div>
          <p class="small">
            这会删除 {{ totalRecords }} 条记录，无法撤销。建议先下载备份文件；清空后只能从备份文件恢复。
          </p>
          <div class="row gap-10" style="margin-top: 16px">
            <button class="btn btn--ghost btn--block" @click="confirmWipe = false">取消</button>
            <button class="btn btn--danger btn--block" @click="wipe">确认清空</button>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.data {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.data__count {
  font-size: 40px;
  font-weight: 700;
  letter-spacing: -0.045em;
  line-height: 1;
  margin: 8px 0 14px;
}

.data__count span {
  font-size: 13px;
  color: rgba(244, 246, 238, 0.5);
  margin-left: 6px;
  font-weight: 500;
  letter-spacing: 0;
}

.data__grid,
.preview__grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.data__grid > div,
.preview__grid > div {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.data__grid .tiny {
  color: rgba(244, 246, 238, 0.45);
}

.data__num {
  font-size: 18px;
  font-weight: 680;
  letter-spacing: -0.02em;
}

.data__id {
  margin-top: 14px;
  color: rgba(244, 246, 238, 0.35);
  font-family: var(--mono);
  font-size: 10.5px;
}

.upload {
  display: block;
  margin-top: 12px;
  cursor: pointer;
}

.upload__input {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
}

.upload__box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 54px;
  border-radius: 16px;
  border: 1.5px dashed var(--line-strong);
  color: var(--text-2);
  font-size: 13.5px;
  font-weight: 600;
}

.upload:hover .upload__box {
  border-color: var(--ink);
  color: var(--text);
}

.issues {
  display: flex;
  flex-direction: column;
  gap: 3px;
  padding: 11px 14px;
  border-radius: 14px;
  margin-top: 10px;
}

.issues--bad {
  background: var(--clay-soft);
  color: var(--clay);
}

.issues--warn {
  background: #fdf6e3;
  color: #8a6d1f;
}

.preview {
  margin-top: 12px;
}

.preview__grid {
  margin-top: 8px;
}

.credit__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  cursor: pointer;
  padding: 12px 14px;
  border-radius: 16px;
  background: rgba(17, 20, 17, 0.035);
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
</style>


