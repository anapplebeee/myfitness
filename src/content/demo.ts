/**
 * 动作示意图。
 *
 * 数据来自 free-exercise-db（Unlicense，可商用、可离线打包），
 * 已按动作 id 落到 `src/assets/exercise/<exerciseId>.jpg`，
 * 构建时由 Vite 转成带 hash 的静态资源，运行时不联网。
 *
 * 为什么不用在线图片：这是本地优先应用，训练时经常没有网络，
 * 示意图必须在包里。
 */

const files = import.meta.glob('../assets/exercise/*.jpg', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const BY_ID = new Map<string, string>();
for (const [path, url] of Object.entries(files)) {
  const id = path.split('/').pop()?.replace(/\.jpg$/, '') ?? '';
  if (id) BY_ID.set(id, url);
}

/** 没有示意图的动作返回 null，界面退回"要领文字"模式。 */
export function demoImage(exerciseId: string): string | null {
  return BY_ID.get(exerciseId) ?? null;
}

export const DEMO_ATTRIBUTION = '示意图：free-exercise-db（Unlicense）';
