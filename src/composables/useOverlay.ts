import { ref } from 'vue';

/** 全屏编辑器与详情浮层的全局开关，避免每个视图各自维护。 */
export const editingTemplateId = ref<string | null>(null);
export const openSessionId = ref<string | null>(null);

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
