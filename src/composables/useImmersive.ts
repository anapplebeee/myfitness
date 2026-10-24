import { ref } from 'vue';

/** 训练进行中要隐藏底部导航，避免遮挡操作按钮。 */
export const immersive = ref(false);

export function setImmersive(on: boolean): void {
  immersive.value = on;
}
