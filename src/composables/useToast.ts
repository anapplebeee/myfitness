import { ref } from 'vue';

export interface Toast {
  id: number;
  message: string;
  tone: 'default' | 'success' | 'error';
}

const toasts = ref<Toast[]>([]);
let seq = 0;

export function useToast() {
  function push(message: string, tone: Toast['tone'] = 'default'): void {
    const id = ++seq;
    toasts.value = [...toasts.value, { id, message, tone }];
    window.setTimeout(() => {
      toasts.value = toasts.value.filter((t) => t.id !== id);
    }, 2400);
  }

  return { toasts, push };
}
