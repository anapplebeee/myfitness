/**
 * 组间休息通知。
 *
 * 为什么需要：休息时锁屏看手机是常态。现在的休息计时只活在页面里，
 * 一锁屏就看不到，回来发现早就该开始下一组了。
 *
 * 两条通路，和 reminders 保持一致的分工：
 * - 原生：Capacitor Local Notifications，**App 在后台/关闭也能响**，
 *   按结束时间戳排一条一次性通知，改了时间就取消重排；
 * - 网页：页面开着时才有效，用 setTimeout + Notification API，
 *   且只在页面不可见时弹（页面上本来就有倒计时，再弹一次是骚扰）。
 *
 * 固定使用同一个通知 id：同一时刻只应该有一条"休息结束"待触发，
 * 换 id 会在改时间后留下孤儿通知。
 */

const NOTIFY_ID = 9101;
const PREF_KEY = 'lianji.restNotify';

/** 用户是否开启组间提醒。默认开：这是"该开始下一组了"的提示，不是营销推送。 */
export function restNotifyEnabled(): boolean {
  try {
    return localStorage.getItem(PREF_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setRestNotifyEnabled(on: boolean): void {
  try {
    localStorage.setItem(PREF_KEY, on ? 'on' : 'off');
  } catch {
    /* 存不进去就按默认值走，不影响训练 */
  }
}

function isNative(): boolean {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return Boolean(cap?.isNativePlatform?.());
}

async function loadPlugin() {
  return import('@capacitor/local-notifications');
}

let webTimer: number | null = null;

function clearWebTimer(): void {
  if (webTimer !== null) {
    window.clearTimeout(webTimer);
    webTimer = null;
  }
}

/**
 * 排一条"休息结束"通知。
 *
 * @param endAtMs 休息结束的绝对时间戳（与持久化的 restEndsAt 同源）
 */
export async function armRestNotification(endAtMs: number | null): Promise<void> {
  await disarmRestNotification();
  if (endAtMs === null) return;
  if (!restNotifyEnabled()) return;

  const delay = endAtMs - Date.now();
  // 已经到点或已过：不排。补一条"现在就去练"的通知没有意义。
  if (delay <= 0) return;

  if (isNative()) {
    try {
      const { LocalNotifications } = await loadPlugin();
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const asked = await LocalNotifications.requestPermissions();
        if (asked.display !== 'granted') return;
      }
      await LocalNotifications.schedule({
        notifications: [
          {
            id: NOTIFY_ID,
            title: '休息结束',
            body: '可以开始下一组了',
            /*
             * allowWhileIdle 不能省。
             * 不设它，插件排的是 RTC（非唤醒）闹钟且不带 ALLOW_WHILE_IDLE：
             * 真机实测「按 Home 切后台后到点完全收不到」——而这正是这个功能
             * 唯一的目标场景（锁屏休息）。提醒类通知一直是这么传的，这里漏了。
             *
             * 代价：Doze 下系统限制每个应用 9 分钟最多一次。休息间隔通常 1–3
             * 分钟，最坏情况是连续两组之间少响一次，但不会像原来那样一次都不响。
             */
            schedule: { at: new Date(endAtMs), allowWhileIdle: true },
          },
        ],
      });
    } catch {
      /* 排程失败不该影响训练流程 */
    }
    return;
  }

  // 网页：只在页面不可见时弹，避免和页面内倒计时重复
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'denied') return;

  webTimer = window.setTimeout(() => {
    webTimer = null;
    if (Notification.permission !== 'granted') return;
    if (!document.hidden) return;
    try {
      // eslint-disable-next-line no-new
      new Notification('休息结束', { body: '可以开始下一组了' });
    } catch {
      /* 某些浏览器在非 SW 上下文禁用构造器，静默失败 */
    }
  }, delay);
}

/** 取消待触发的休息通知（跳过休息、改时间、结束训练时调用）。 */
export async function disarmRestNotification(): Promise<void> {
  clearWebTimer();
  if (!isNative()) return;
  try {
    const { LocalNotifications } = await loadPlugin();
    await LocalNotifications.cancel({ notifications: [{ id: NOTIFY_ID }] });
  } catch {
    /* 没有待取消的通知时取消会抛错，忽略 */
  }
}

/** 网页端首次需要请求权限；原生在 arm 时按需请求。 */
export async function ensureRestNotifyPermission(): Promise<void> {
  if (isNative()) return;
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'default') return;
  try {
    await Notification.requestPermission();
  } catch {
    /* 用户拒绝就静默，不弹二次请求 */
  }
}

