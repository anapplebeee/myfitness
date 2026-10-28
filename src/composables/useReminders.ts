/**
 * 本地提醒适配层。
 *
 * 两条通路分开实现，不再共用一套 schedule 参数：
 * - 原生（Android/iOS）：Capacitor Local Notifications，App 关闭也能提醒，
 *   用 `schedule.on` 按每天固定时刻重复；
 * - 网页/PWA：插件 Web 实现并不按 `on` 延时（实测 23:59 的计划会立即触发），
 *   这里改为前台按分钟轮询 + Notification API，页面开着才生效。
 */

import { computed, ref } from 'vue';
import { store } from '../store/appStore';
import { dueReminders, normalizeReminders, waterTimes } from '../domain/reminders';

export type NotificationPermission = 'granted' | 'denied' | 'prompt' | 'unsupported';

const permission = ref<NotificationPermission>('prompt');
const busy = ref(false);
const error = ref<string | null>(null);
let started = false;
let pollTimer: number | null = null;

/** 已触发记录：key = 日期-类型-时刻，避免同一分钟重复弹。 */
const FIRED_KEY = 'lianji.reminder.fired';

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

function webPermission(): NotificationPermission {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as NotificationPermission;
}

async function refreshPermission(): Promise<void> {
  if (!isNative()) {
    permission.value = webPermission();
    return;
  }
  try {
    const { LocalNotifications } = await loadPlugin();
    const res = await LocalNotifications.checkPermissions();
    permission.value = (res.display as NotificationPermission) ?? 'prompt';
  } catch {
    permission.value = webPermission();
  }
}

async function requestPermission(): Promise<void> {
  busy.value = true;
  error.value = null;
  try {
    if (!isNative()) {
      if (typeof Notification === 'undefined') {
        permission.value = 'unsupported';
        return;
      }
      permission.value = (await Notification.requestPermission()) as NotificationPermission;
      return;
    }
    const { LocalNotifications } = await loadPlugin();
    const res = await LocalNotifications.requestPermissions();
    permission.value = (res.display as NotificationPermission) ?? 'prompt';
  } catch {
    permission.value = webPermission();
  } finally {
    busy.value = false;
  }
}

/* ---------- 网页：前台轮询 ---------- */

function firedMap(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(FIRED_KEY) ?? '{}') as Record<string, number>;
  } catch {
    return {};
  }
}

function markFired(key: string): void {
  const map = firedMap();
  map[key] = Date.now();
  const cutoff = Date.now() - 3 * 86_400_000;
  for (const k of Object.keys(map)) {
    if ((map[k] ?? 0) < cutoff) delete map[k];
  }
  try {
    localStorage.setItem(FIRED_KEY, JSON.stringify(map));
  } catch {
    /* 存不下只影响去重，不影响提醒本身 */
  }
}

/** 检查"现在这一分钟"是否有提醒要弹；纯判断在 domain/reminders.ts。 */
function pollWeb(): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const settings = normalizeReminders(store.state.reminders);
  const now = new Date();
  const due = dueReminders(now, settings, store.waterTotalFor());
  if (!due.length) return;
  const fired = firedMap();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  for (const item of due) {
    const key = `${day}-${item.kind}-${item.time}`;
    if (fired[key]) continue;
    try {
      new Notification(item.title, { body: item.body, tag: key });
      markFired(key);
    } catch {
      /* 某些环境不允许直接构造通知 */
    }
  }
}

function startWebLoop(): void {
  if (pollTimer !== null) return;
  pollWeb();
  pollTimer = window.setInterval(pollWeb, 20_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollWeb();
  });
}

/* ---------- 原生：系统级排程 ---------- */

function waterBody(): string {
  const total = store.waterTotalFor();
  return total > 0 ? `今天已喝 ${total} ml，再补一杯` : '补一杯水，别等渴了才喝';
}

async function applySchedule(): Promise<void> {
  const settings = normalizeReminders(store.state.reminders);
  busy.value = true;
  error.value = null;
  try {
    if (!isNative()) {
      if (permission.value === 'granted') {
        startWebLoop();
      } else {
        error.value = '网页版需要允许通知，且页面保持打开才能提醒；装成 Android App 后关闭也能提醒。';
      }
      return;
    }

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
      : '网页版需要允许通知，且页面保持打开；装成 Android App 后关闭也能提醒。';
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
