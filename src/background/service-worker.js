import { recordName, getStats, exportAll, importAll, getFormerNames, deleteUser, listUsers, clearAllUsers } from '../lib/db.js';
import { lookupBatch, syncFollowings } from '../lib/history.js';
import { getSpeedPreset, normalizeSpeed } from '../lib/api.js';

const DEFAULT_SETTINGS = {
  lastScanAt: 0,
  lastScanResult: null,
  lastApiSyncAt: 0,
  lastApiSyncResult: null,
  lastAutoSyncAt: 0,
  lastAutoSyncResult: null,
  collectPausedUntil: 0,
  collectSpeed: 'slow',
  autoSyncOnFirstVisit: false,
  autoSyncOnInterval: false,
  autoSyncIntervalHours: 24,
  autoSyncMethod: 'dom'
};

let cachedSelfMid = '';

async function getSettings() {
  const data = await chrome.storage.local.get({ settings: DEFAULT_SETTINGS });
  return Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
}

async function setSettings(patch) {
  const cur = await getSettings();
  const next = Object.assign({}, cur, patch);
  await chrome.storage.local.set({ settings: next });
  return next;
}

async function loadSelfMid() {
  if (cachedSelfMid) return cachedSelfMid;
  const stored = await chrome.storage.local.get({ selfMid: '' });
  if (stored.selfMid) {
    cachedSelfMid = String(stored.selfMid);
    await deleteUser(cachedSelfMid);
  }
  return cachedSelfMid;
}

function isSelfMid(mid) {
  return cachedSelfMid && String(mid) === String(cachedSelfMid);
}

async function isCollectPaused() {
  const settings = await getSettings();
  const until = Number(settings.collectPausedUntil) || 0;
  return until > Date.now();
}

async function setSelfMid(mid) {
  const id = String(mid || '').trim();
  if (!id) return '';
  cachedSelfMid = id;
  await chrome.storage.local.set({ selfMid: id });
  await deleteUser(id);
  return id;
}

chrome.runtime.onInstalled.addListener(async () => {
  await loadSelfMid();
});

chrome.runtime.onStartup.addListener(async () => {
  await loadSelfMid();
  await setSessionAutoSyncFired(false);
});

// 自动翻页：由离屏文档定时脉冲，避免后台标签页 setTimeout 被节流后停扫
let autoPageTabId = 0;
let autoPageBusy = false;
let autoPageIntervalMs = 3200;
let autoPageLastTickAt = 0;

// 自动同步（可打开关注页 DOM 扫描后关标签，或走 API）
let autoSyncTabId = 0;
let autoSyncRunning = false;
let lastVisitCheckAt = 0;
let autoSyncBootstrapTimer = 0;

async function getSessionAutoSyncFired() {
  try {
    const data = await chrome.storage.session.get({ autoSyncSessionFired: false });
    return !!data.autoSyncSessionFired;
  } catch (_e) {
    return false;
  }
}

async function setSessionAutoSyncFired(fired) {
  try {
    await chrome.storage.session.set({ autoSyncSessionFired: !!fired });
  } catch (_e) {
    // ignore
  }
}

async function evaluateAutoSyncTrigger(settings) {
  const first = !!settings.autoSyncOnFirstVisit;
  const intervalOn = !!settings.autoSyncOnInterval;
  if (!first && !intervalOn) return null;
  if (autoSyncRunning || autoSyncTabId) return null;
  if (autoPageTabId) return null;

  if (first) {
    const fired = await getSessionAutoSyncFired();
    if (!fired) return 'first_visit';
  }
  if (intervalOn) {
    const hours = Math.max(1, Number(settings.autoSyncIntervalHours) || 24);
    const last = Number(settings.lastAutoSyncAt) || 0;
    if (Date.now() - last >= hours * 3600 * 1000) return 'interval';
  }
  return null;
}

async function broadcastToast(message, kind, excludeTabId) {
  const text = String(message || '').trim();
  if (!text) return;
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://www.bilibili.com/*', 'https://space.bilibili.com/*']
    });
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      if (!tab || !tab.id) continue;
      if (excludeTabId && tab.id === excludeTabId) continue;
      chrome.tabs
        .sendMessage(tab.id, {
          type: 'SHOW_TOAST',
          message: text,
          kind: kind || 'err'
        })
        .catch(() => {});
    }
  } catch (_e) {
    // ignore
  }
}

function formatSyncFailToast(reason, via) {
  const tip =
    '可能是关注列表/页面改版导致选择器失效，也可改用 Popup 手动同步。';
  const prefix =
    via === 'api' ? '曾用名 API 自动同步失败：' : '曾用名自动同步失败：';
  return prefix + (reason || '未知原因') + '。' + tip;
}

async function completeDomAutoSync(payload, senderTabId) {
  const closeId = autoSyncTabId || senderTabId || 0;
  if (!autoSyncRunning && !autoSyncTabId) {
    return { closed: false, already: true };
  }
  autoSyncRunning = false;
  autoSyncTabId = 0;
  if (autoSyncBootstrapTimer) {
    clearTimeout(autoSyncBootstrapTimer);
    autoSyncBootstrapTimer = 0;
  }
  await stopAutoPage();

  const now = Date.now();
  const body = payload || {};
  await setSettings({
    lastAutoSyncAt: now,
    lastAutoSyncResult: {
      ok: !!body.ok,
      via: 'dom',
      pages: body.pages || 0,
      seen: body.seen || 0,
      reason: body.reason || '',
      trigger: body.trigger || '',
      at: now
    },
    lastScanAt: now,
    lastScanResult: {
      ok: !!body.ok,
      total: body.seen || 0,
      pages: body.pages || 0,
      changed: 0,
      at: now,
      via: 'dom-auto'
    },
    collectPausedUntil: 0
  });

  if (!body.ok) {
    // 先通知其它已打开的 B 站页，再关同步标签（避免用户看不到）
    await broadcastToast(
      formatSyncFailToast(body.reason || body.error || '', 'dom'),
      'err',
      closeId
    );
  }

  if (closeId) {
    try {
      await chrome.tabs.remove(closeId);
    } catch (_e) {
      // ignore
    }
  }
  return { closed: !!closeId };
}

async function bootstrapAutoSyncTab(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'AUTO_SYNC_BOOTSTRAP' });
  } catch (_e) {
    if (autoSyncBootstrapTimer) clearTimeout(autoSyncBootstrapTimer);
    autoSyncBootstrapTimer = setTimeout(() => {
      autoSyncBootstrapTimer = 0;
      if (tabId === autoSyncTabId) {
        chrome.tabs.sendMessage(tabId, { type: 'AUTO_SYNC_BOOTSTRAP' }).catch(async () => {
          await completeDomAutoSync(
            {
              ok: false,
              reason: '无法注入关注页脚本',
              pages: 0,
              seen: 0
            },
            tabId
          );
        });
      }
    }, 2500);
  }
}

async function startDomAutoSync(mid, trigger) {
  const url =
    'https://space.bilibili.com/' +
    encodeURIComponent(mid) +
    '/relation/follow';
  const tab = await chrome.tabs.create({ url: url, active: false });
  autoSyncTabId = tab.id;
  autoSyncRunning = true;
  await setSessionAutoSyncFired(true);
  // 等页面 complete 后再启动扫描
  const onUpdated = (tabId, info) => {
    if (tabId !== autoSyncTabId) return;
    if (info.status !== 'complete') return;
    chrome.tabs.onUpdated.removeListener(onUpdated);
    bootstrapAutoSyncTab(tabId);
  };
  chrome.tabs.onUpdated.addListener(onUpdated);
  // 若已 complete（极快），补一次
  try {
    const t = await chrome.tabs.get(tab.id);
    if (t && t.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(onUpdated);
      bootstrapAutoSyncTab(tab.id);
    }
  } catch (_e) {
    // ignore
  }
  return { started: true, method: 'dom', tabId: tab.id, trigger: trigger };
}

async function startApiAutoSync(mid, trigger, speed) {
  autoSyncRunning = true;
  await setSessionAutoSyncFired(true);
  try {
    const result = await syncFollowings({ selfMid: mid, speed: speed });
    if (result.selfMid) await setSelfMid(result.selfMid);
    const now = Date.now();
    await setSettings({
      lastAutoSyncAt: now,
      lastAutoSyncResult: {
        ok: true,
        via: 'api',
        total: result.total,
        changed: result.changed,
        trigger: trigger,
        speed: speed,
        at: now
      },
      lastApiSyncAt: now,
      lastApiSyncResult: {
        ok: true,
        total: result.total,
        changed: result.changed,
        at: now,
        via: 'api',
        speed: speed
      },
      collectPausedUntil: 0
    });
    return { started: true, method: 'api', result: result, trigger: trigger };
  } catch (err) {
    const now = Date.now();
    const errText = String(err && err.message ? err.message : err);
    await setSettings({
      lastAutoSyncAt: now,
      lastAutoSyncResult: {
        ok: false,
        via: 'api',
        error: errText,
        trigger: trigger,
        at: now
      }
    });
    await broadcastToast(formatSyncFailToast(errText, 'api'), 'err', 0);
    return { started: false, method: 'api', error: errText, trigger: trigger };
  } finally {
    autoSyncRunning = false;
  }
}

async function maybeStartAutoSync(preferredMid) {
  await loadSelfMid();
  const settings = await getSettings();
  const trigger = await evaluateAutoSyncTrigger(settings);
  if (!trigger) return { started: false };

  const mid = String(preferredMid || cachedSelfMid || '').trim();
  if (!mid) {
    await broadcastToast(
      '曾用名自动同步未启动：未能识别登录 UID。请确认已登录 B 站后刷新页面。',
      'err',
      0
    );
    return { started: false, needMid: true };
  }

  const method = settings.autoSyncMethod === 'api' ? 'api' : 'dom';
  const speed = normalizeSpeed(settings.collectSpeed);

  try {
    if (method === 'api') {
      return await startApiAutoSync(mid, trigger, speed);
    }
    return await startDomAutoSync(mid, trigger);
  } catch (err) {
    const errText = String(err && err.message ? err.message : err);
    await broadcastToast(formatSyncFailToast(errText, method), 'err', 0);
    return { started: false, error: errText };
  }
}

async function hasOffscreenDocument() {
  if (!chrome.runtime.getContexts) return false;
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL('src/offscreen/offscreen.html')]
  });
  return contexts && contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreenDocument()) return;
  try {
    await chrome.offscreen.createDocument({
      url: 'src/offscreen/offscreen.html',
      reasons: ['DOM_SCRAPING'],
      justification: 'Drive follow-list auto page scan while the tab is in background'
    });
  } catch (e) {
    // 已存在或其他并发创建
    const msg = String(e && e.message ? e.message : e);
    if (msg.indexOf('already') === -1 && msg.indexOf('Only a single') === -1) {
      throw e;
    }
  }
}

async function closeOffscreen() {
  try {
    if (await hasOffscreenDocument()) {
      await chrome.offscreen.closeDocument();
    }
  } catch (_e) {
    // ignore
  }
}

async function patchTabVisibility(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        if (window.__bnhVisPatched) return;
        window.__bnhVisPatched = 1;
        try {
          Object.defineProperty(Document.prototype, 'hidden', {
            configurable: true,
            get: function () {
              return false;
            }
          });
          Object.defineProperty(Document.prototype, 'visibilityState', {
            configurable: true,
            get: function () {
              return 'visible';
            }
          });
        } catch (_e) {
          // ignore
        }
      }
    });
  } catch (_e) {
    // ignore
  }
}

async function unpatchTabVisibility(tabId) {
  if (!tabId) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      world: 'MAIN',
      func: () => {
        try {
          delete Document.prototype.hidden;
          delete Document.prototype.visibilityState;
          window.__bnhVisPatched = 0;
        } catch (_e) {
          // ignore
        }
      }
    });
  } catch (_e) {
    // ignore
  }
}

async function stopAutoPage() {
  const tabId = autoPageTabId;
  autoPageTabId = 0;
  autoPageBusy = false;
  autoPageLastTickAt = 0;
  await unpatchTabVisibility(tabId);
  await closeOffscreen();
}

async function pulseAutoPage() {
  if (!autoPageTabId || autoPageBusy) return;
  const now = Date.now();
  if (autoPageLastTickAt && now - autoPageLastTickAt < autoPageIntervalMs) {
    return;
  }
  autoPageBusy = true;
  autoPageLastTickAt = now;
  const pageTabId = autoPageTabId;
  try {
    const res = await chrome.tabs.sendMessage(pageTabId, { type: 'AUTO_PAGE_TICK' });
    if (!res || res.done) {
      if (autoSyncTabId && autoSyncTabId === pageTabId) {
        // 内容脚本一般会先发 AUTO_SYNC_FINISHED；此处兜底关页
        await completeDomAutoSync(
          { ok: true, reason: 'scan_done', pages: 0, seen: 0 },
          pageTabId
        );
      } else {
        await stopAutoPage();
      }
    }
  } catch (_e) {
    if (autoSyncTabId && autoSyncTabId === pageTabId) {
      await completeDomAutoSync(
        { ok: false, reason: 'tab_lost', pages: 0, seen: 0 },
        pageTabId
      );
    } else {
      await stopAutoPage();
    }
  } finally {
    autoPageBusy = false;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender)
    .then((data) => sendResponse({ ok: true, data }))
    .catch((err) =>
      sendResponse({
        ok: false,
        error: String(err && err.message ? err.message : err)
      })
    );
  return true;
});

async function handleMessage(msg, sender) {
  if (!msg || !msg.type) throw new Error('invalid message');

  // 离屏脉冲不走业务库
  if (msg.type === 'AUTO_PAGE_PULSE') {
    await pulseAutoPage();
    return { pulsed: true };
  }
  if (msg.type === 'AUTO_PAGE_START') {
    const tabId = sender && sender.tab && sender.tab.id;
    if (!tabId) throw new Error('no tab');
    const settings = await getSettings();
    const preset = getSpeedPreset(settings.collectSpeed);
    autoPageTabId = tabId;
    autoPageIntervalMs = preset.domPulseMs;
    autoPageLastTickAt = 0;
    await ensureOffscreen();
    await patchTabVisibility(tabId);
    return {
      started: true,
      tabId: tabId,
      speed: normalizeSpeed(settings.collectSpeed),
      intervalMs: autoPageIntervalMs
    };
  }
  if (msg.type === 'AUTO_PAGE_STOP') {
    await stopAutoPage();
    return { stopped: true };
  }
  if (msg.type === 'AUTO_SYNC_FINISHED') {
    return completeDomAutoSync(
      {
        ok: !!msg.ok,
        reason: msg.reason || '',
        pages: msg.pages || 0,
        seen: msg.seen || 0,
        trigger: msg.trigger || ''
      },
      sender && sender.tab ? sender.tab.id : 0
    );
  }
  if (msg.type === 'BILI_VISIT') {
    const senderTabId = sender && sender.tab ? sender.tab.id : 0;
    if (msg.mid) await setSelfMid(msg.mid);
    else await loadSelfMid();
    // 跳过我们自己打开的同步标签，避免递归触发
    if (senderTabId && autoSyncTabId && senderTabId === autoSyncTabId) {
      return { ignored: true, reason: 'autosync_tab' };
    }
    const now = Date.now();
    if (now - lastVisitCheckAt < 8000) {
      return { debounced: true };
    }
    lastVisitCheckAt = now;
    return maybeStartAutoSync(msg.mid || cachedSelfMid);
  }

  await loadSelfMid();

  switch (msg.type) {
    case 'GET_SELF_MID': {
      return cachedSelfMid || '';
    }
    case 'SET_SELF_MID': {
      return setSelfMid(msg.mid);
    }
    case 'RECORD_NAME': {
      if (!msg.force && (await isCollectPaused())) {
        return {
          changed: false,
          formerNames: [],
          currentName: msg.name || '',
          paused: true
        };
      }
      if (isSelfMid(msg.mid)) {
        return {
          changed: false,
          formerNames: [],
          currentName: msg.name || '',
          skippedSelf: true
        };
      }
      return recordName(msg.mid, msg.name, msg.seenAt || Date.now());
    }
    case 'RECORD_BATCH': {
      // force=true：关注页手动扫描，忽略暂停并解除暂停
      if (!msg.force && (await isCollectPaused())) {
        return { total: 0, changed: 0, paused: true };
      }
      const items = msg.items || [];
      let changed = 0;
      const now = Date.now();
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (!it || isSelfMid(it.mid)) continue;
        const result = await recordName(it.mid, it.name, now);
        if (result.changed) changed += 1;
      }
      // roundSeen：自动翻页时传整轮累计人数，避免被「当页人数」覆盖
      const roundSeen =
        typeof msg.roundSeen === 'number' && msg.roundSeen >= 0
          ? msg.roundSeen
          : items.length;
      const pages =
        typeof msg.pages === 'number' && msg.pages > 0 ? msg.pages : 1;
      const patch = {
        lastScanAt: now,
        lastScanResult: {
          ok: true,
          total: roundSeen,
          pages: pages,
          changed: changed,
          at: now
        }
      };
      if (msg.force) patch.collectPausedUntil = 0;
      await setSettings(patch);
      return { total: roundSeen, pageTotal: items.length, changed: changed };
    }
    case 'DOM_SCAN_ROUND_DONE': {
      // 自动翻页整轮结束（含手动停止）：写入本轮累计
      const now = Date.now();
      const seen =
        typeof msg.seen === 'number' && msg.seen >= 0 ? msg.seen : 0;
      const pages =
        typeof msg.pages === 'number' && msg.pages > 0 ? msg.pages : 0;
      await setSettings({
        lastScanAt: now,
        lastScanResult: {
          ok: msg.ok !== false,
          total: seen,
          pages: pages,
          changed: 0,
          at: now,
          via: 'dom-round',
          reason: msg.reason || ''
        }
      });
      return { total: seen, pages: pages };
    }
    case 'GET_FORMER': {
      if (isSelfMid(msg.mid)) return [];
      return getFormerNames(msg.mid, msg.name || '');
    }
    case 'LOOKUP_BATCH': {
      const items = (msg.items || []).filter((it) => !isSelfMid(it.mid));
      return lookupBatch(items);
    }
    case 'SYNC_FOLLOWINGS_DOM': {
      // 手动：后台打开关注页 DOM 翻页，扫完关页
      if (autoSyncRunning || autoSyncTabId) {
        throw new Error('已有 DOM 同步任务在进行中');
      }
      if (autoPageTabId) {
        throw new Error('关注页正在翻页扫描，请稍后再试');
      }
      let mid = cachedSelfMid || '';
      if (!mid) {
        throw new Error('尚未识别到登录 UID，请先打开 bilibili.com 并登录');
      }
      if (msg.speed) {
        await setSettings({ collectSpeed: normalizeSpeed(msg.speed) });
      }
      return startDomAutoSync(mid, 'manual');
    }
    case 'SYNC_FOLLOWINGS': {
      // 可选 API 路线：短时间翻页请求关注列表，可能触发风控
      let mid = cachedSelfMid || '';
      const settings = await getSettings();
      const speed = normalizeSpeed(
        msg.speed || settings.collectSpeed || 'slow'
      );
      try {
        const result = await syncFollowings({ selfMid: mid, speed: speed });
        if (result.selfMid) {
          await setSelfMid(result.selfMid);
        }
        const now = Date.now();
        await setSettings({
          collectSpeed: speed,
          lastApiSyncAt: now,
          lastApiSyncResult: {
            ok: true,
            total: result.total,
            changed: result.changed,
            at: now,
            via: 'api',
            speed: speed
          },
          collectPausedUntil: 0
        });
        return result;
      } catch (err) {
        const now = Date.now();
        await setSettings({
          lastApiSyncAt: now,
          lastApiSyncResult: {
            ok: false,
            error: String(err && err.message ? err.message : err),
            at: now,
            via: 'api',
            speed: speed
          }
        });
        throw err;
      }
    }
    case 'GET_LIST': {
      const rows = await listUsers();
      return rows.filter((r) => !isSelfMid(r.mid));
    }
    case 'GET_STATS': {
      const stats = await getStats();
      const settings = await getSettings();
      return { stats, settings, selfMid: cachedSelfMid || '' };
    }
    case 'GET_SETTINGS': {
      return getSettings();
    }
    case 'SET_SETTINGS': {
      const patch = Object.assign({}, msg.settings || {});
      if (patch.collectSpeed) {
        patch.collectSpeed = normalizeSpeed(patch.collectSpeed);
      }
      if (patch.autoSyncMethod && patch.autoSyncMethod !== 'api') {
        patch.autoSyncMethod = 'dom';
      }
      if (patch.autoSyncIntervalHours != null) {
        const h = Number(patch.autoSyncIntervalHours);
        patch.autoSyncIntervalHours = Number.isFinite(h) ? Math.max(1, Math.min(720, h)) : 24;
      }
      return setSettings(patch);
    }
    case 'EXPORT_DATA': {
      return exportAll();
    }
    case 'IMPORT_DATA': {
      await importAll(msg.payload, msg.merge !== false);
      return { imported: true };
    }
    case 'CLEAR_DATA': {
      await clearAllUsers();
      // 暂停被动收集一段时间，避免仍打开的 B 站页立刻又写回来
      const pauseMs = 10 * 60 * 1000;
      await setSettings({
        lastScanAt: 0,
        lastScanResult: null,
        collectPausedUntil: Date.now() + pauseMs
      });
      return { cleared: true, pausedMinutes: 10 };
    }
    default:
      throw new Error('unknown type: ' + msg.type);
  }
}
