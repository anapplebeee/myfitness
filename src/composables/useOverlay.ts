import { ref } from 'vue';

/**
 * 全屏浮层的全局开关，避免每个视图各自维护。
 *
 * liveSessionId 是**录制面板**（LiveWorkout）的开关，
 * openSessionId 是**会话详情**（SessionDetailView）的开关。
 * 两者必须分开：详情是只读回顾，录制是行进中的录入，
 * 混用一个会导致"点开始训练却看到只读详情"。
 */
export const editingTemplateId = ref<string | null>(null);
export const openSessionId = ref<string | null>(null);
export const liveSessionId = ref<string | null>(null);

export function openTemplateEditor(id: string): void {
  editingTemplateId.value = id;
}

export function closeTemplateEditor(): void {
  editingTemplateId.value = null;
}

export function openSession(id: string): void {
  openSessionId.value = id;
}

export function closeSession(): void {
  openSessionId.value = null;
}

/** 开始录制：打开 LiveWorkout。 */
export function startLive(id: string): void {
  liveSessionId.value = id;
}

export function closeLive(): void {
  liveSessionId.value = null;
}
