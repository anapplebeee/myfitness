import { ref } from 'vue';

export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'error';
  /** 可选操作（撤销删除之类）。有 action 时停留更久。 */
  action?: ToastAction;
}

const toasts = ref<Toast[]>([]);
let seq = 0;

export function useToast() {
  /**
   * 新提示会替换掉尚未消失的旧提示。
   * 训练中连续操作（换动作→保存组）时，堆叠的 Toast 会互相遮挡并压住底部按钮。
   *
   * 第三个参数可带一个操作：删除饮食/体重这种"点错就没了"的动作，
   * 给 5 秒撤销比弹确认框更轻。
   */
  function push(message: string, tone: Toast['tone'] = 'default', action?: ToastAction): void {
    const id = ++seq;
    toasts.value = [{ id, message, tone, action }];
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, action ? 5000 : 2400);
  }

  function dismiss(id: number): void {
    toasts.value = toasts.value.filter((t) => t.id !== id);
  }

  return { toasts, push, dismiss };
}
