/**
 * 本地提醒适配层。
 *
 * 只做一件事：把"用户设置的提醒"翻译成系统通知。
 * - 原生（Android/iOS）：Capacitor Local Notifications，App 关闭也能提醒；
 * - 网页/PWA：插件自带 Web 实现 + Notification API，页面开着时生效。
 *
 * 不经过任何服务器，符合本地优先的定位。
 */

import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { normalizeReminders, waterTimes } from '../domain/reminders';

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

const permission = ref<NotificationPermission>('prompt');
const busy = ref(false);
const error = ref<string | null>(null);
let started = false;

const permissionLabel = computed(() => {
  switch (permission.value) {
    case 'granted':
      return '已允许';
    case 'denied':
      return '已拒绝（需在系统设置里改）';
    case 'unsupported':
      return '当前环境不支持';
    default:
      return '未授权';
  }
});

function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

async function loadPlugin() {
  return import('@capacitor/local-notifications');
}

async function refreshPermission(): Promise<void> {
  try {
    const { LocalNotifications } = await loadPlugin();
    const res = await LocalNotifications.checkPermissions();
    permission.value = (res.display as NotificationPermission) ?? 'prompt';
  } catch {
    permission.value =
      typeof Notification !== 'undefined'
        ? (Notification.permission as NotificationPermission)
        : 'unsupported';
  }
}

async function requestPermission(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    const { LocalNotifications } = await loadPlugin();
    const res = await LocalNotifications.requestPermissions();
    permission.value = (res.display as NotificationPermission) ?? 'prompt';
  } catch {
    if (typeof Notification !== 'undefined') {
      permission.value = (await Notification.requestPermission()) as NotificationPermission;
    } else {
      permission.value = 'unsupported';
    }
  } finally {
    busy.value = false;
  }
}

/** 喝水提醒带上今天已喝量，比一句干巴巴的"该喝水了"有用。 */
function waterBody(): string {
  const total = store.waterTotalFor();
  return total > 0 ? `今天已喝 ${total} ml，再补一杯` : '补一杯水，别等渴了才喝';
}

/** 清掉旧计划再按当前设置重排，避免改完设置后重复提醒。 */
async function applySchedule(): Promise<void> {
  const settings = normalizeReminders(store.state.reminders);
  busy.value = true;
  error.value = null;
  try {
    const { LocalNotifications } = await loadPlugin();

    const pending = await LocalNotifications.getPending();
    if (pending.notifications.length) {
      await LocalNotifications.cancel({
        notifications: pending.notifications.map((n) => ({ id: n.id })),
      });
    }

    const notifications: Array<Record<string, unknown>> = [];
    let id = 1000;

    if (settings.waterEnabled) {
      for (const t of waterTimes(settings)) {
        const [hour, minute] = t.split(':').map(Number);
        notifications.push({
          id: id++,
          title: '该喝水了',
          body: waterBody(),
          schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
        });
      }
    }

    if (settings.workoutEnabled) {
      const [hour, minute] = settings.workoutTime.split(':').map(Number);
      notifications.push({
        id: id++,
        title: '该训练了',
        body: '打开练迹，看一眼今天练什么',
        schedule: { on: { hour, minute }, repeats: true, allowWhileIdle: true },
      });
    }

    if (notifications.length) {
      await LocalNotifications.schedule({ notifications: notifications as never });
    }
  } catch {
    error.value = isNative()
      ? '系统通知不可用，请在系统设置里允许通知后重试。'
      : '网页版需要允许通知且页面保持打开；装成 Android App 后关闭也能提醒。';
  } finally {
    busy.value = false;
  }
}

/** App 启动时调用一次：读权限，已授权就按设置排好。 */
async function setupReminders(): Promise<void> {
  if (started) return;
  started = true;
  await refreshPermission();
  if (permission.value === 'granted') await applySchedule();
}

export function useReminders() {
  return {
    permission,
    permissionLabel,
    busy,
    error,
    isNative,
    refreshPermission,
    requestPermission,
    applySchedule,
    setupReminders,
  };
}
