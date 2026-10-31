import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright';
const appPid = execFileSync('adb', ['shell','pidof','app.lianji.fit'], { encoding: 'utf8' }).trim();
execFileSync('adb', ['forward','--remove-all']);
execFileSync('adb', ['forward','tcp:9333',`localabstract:webview_devtools_remote_${appPid}`]);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? await ctx.waitForEvent('page');
const out = await page.evaluate(async () => {
  const P = window.Capacitor?.Plugins?.LocalNotifications;
  if (!P) return { error: 'no plugin' };
  const r = {};
  try { r.perm = await P.checkPermissions(); } catch (e) { r.permErr = String(e); }
  try {
    await P.schedule({ notifications: [{ id: 9001, title: '验收', body: 'x', schedule: { at: new Date(Date.now() + 120000) } }] });
    r.scheduled = true;
  } catch (e) { r.scheduleErr = String(e?.message ?? e); }
  try { r.pending = (await P.getPending()).notifications?.length ?? 0; } catch (e) { r.pendingErr = String(e); }
  return r;
});
console.log('RESULT=' + JSON.stringify(out));
await browser.close();
