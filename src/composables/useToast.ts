import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'error';
}

const toasts = ref<Toast[]>([]);
let seq = 0;

export function useToast() {
  /**
   * 新提示会替换掉尚未消失的旧提示。
   * 训练中连续操作（换动作→保存组）时，堆叠的 Toast 会互相遮挡并压住底部按钮。
   */
  function push(message: string, tone: Toast['tone'] = 'default'): void {
    const id = ++seq;
    toasts.value = [{ id, message, tone }];
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2400);
  }

  return { toasts, push };
}
