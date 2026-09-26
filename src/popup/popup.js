function send(type, payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(Object.assign({ type }, payload || {}), (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (!res || !res.ok) {
        reject(new Error((res && res.error) || '请求失败'));
        return;
      }
      resolve(res.data);
    });
  });
}

function showMsg(text, ok) {
  const el = document.getElementById('msg');
  el.hidden = false;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
}

function formatTime(ts, emptyText) {
  if (!ts) return emptyText || '无记录';
  const d = new Date(ts);
  return (
    d.getFullYear() +
    '-' +
    String(d.getMonth() + 1).padStart(2, '0') +
    '-' +
    String(d.getDate()).padStart(2, '0') +
    ' ' +
    String(d.getHours()).padStart(2, '0') +
    ':' +
    String(d.getMinutes()).padStart(2, '0')
  );
}

function currentSpeed() {
  const checked = document.querySelector('input[name="collectSpeed"]:checked');
  return checked && checked.value === 'fast' ? 'fast' : 'slow';
}

function currentAutoSyncMethod() {
  const checked = document.querySelector('input[name="autoSyncMethod"]:checked');
  return checked && checked.value === 'api' ? 'api' : 'dom';
}

async function saveCollectSettings() {
  const hours = Number(document.getElementById('autoSyncIntervalHours').value);
  await send('SET_SETTINGS', {
    settings: {
      collectSpeed: currentSpeed(),
      autoSyncOnFirstVisit: document.getElementById('autoSyncOnFirstVisit').checked,
      autoSyncOnInterval: document.getElementById('autoSyncOnInterval').checked,
      autoSyncIntervalHours: Number.isFinite(hours) ? hours : 24,
      autoSyncMethod: currentAutoSyncMethod()
    }
  });
}

async function refresh() {
  const data = await send('GET_STATS');
  document.getElementById('statUsers').textContent = String(data.stats.userCount);
  document.getElementById('statRenamed').textContent = String(data.stats.renamedCount);
  const s = data.settings;

  const speed = s.collectSpeed === 'fast' ? 'fast' : 'slow';
  const speedInput = document.querySelector(
    'input[name="collectSpeed"][value="' + speed + '"]'
  );
  if (speedInput) speedInput.checked = true;

  document.getElementById('autoSyncOnFirstVisit').checked = !!s.autoSyncOnFirstVisit;
  document.getElementById('autoSyncOnInterval').checked = !!s.autoSyncOnInterval;
  document.getElementById('autoSyncIntervalHours').value = String(
    s.autoSyncIntervalHours || 24
  );
  const method = s.autoSyncMethod === 'api' ? 'api' : 'dom';
  const methodInput = document.querySelector(
    'input[name="autoSyncMethod"][value="' + method + '"]'
  );
  if (methodInput) methodInput.checked = true;

  let scanLine = 'DOM 扫描：' + formatTime(s.lastScanAt, '尚未扫描');
  if (s.lastScanResult && s.lastScanResult.ok) {
    scanLine += '（本批 ' + s.lastScanResult.total + '）';
  }
  document.getElementById('lastSync').textContent = scanLine;

  let apiLine = 'API 同步：' + formatTime(s.lastApiSyncAt, '尚未使用');
  if (s.lastApiSyncResult) {
    if (s.lastApiSyncResult.ok) {
      apiLine +=
        '（关注 ' +
        s.lastApiSyncResult.total +
        '，新昵称 ' +
        s.lastApiSyncResult.changed +
        (s.lastApiSyncResult.speed === 'fast' ? '，高速' : '，低速') +
        '）';
    } else {
      apiLine += '（失败：' + (s.lastApiSyncResult.error || '') + '）';
    }
  }
  document.getElementById('lastApiSync').textContent = apiLine;

  let autoLine = '自动同步：' + formatTime(s.lastAutoSyncAt, '尚未使用');
  if (s.lastAutoSyncResult) {
    const r = s.lastAutoSyncResult;
    if (r.ok) {
      autoLine +=
        '（' +
        (r.via === 'api' ? 'API' : 'DOM') +
        (r.seen != null ? '，约 ' + r.seen + ' 人' : r.total != null ? '，' + r.total + ' 人' : '') +
        '）';
    } else {
      autoLine += '（失败：' + (r.reason || r.error || '') + '）';
    }
  }
  document.getElementById('lastAutoSync').textContent = autoLine;
}

document.querySelectorAll('input[name="collectSpeed"]').forEach((el) => {
  el.addEventListener('change', () => {
    saveCollectSettings().catch((e) => showMsg(String(e.message || e), false));
  });
});

['autoSyncOnFirstVisit', 'autoSyncOnInterval', 'autoSyncIntervalHours'].forEach((id) => {
  const el = document.getElementById(id);
  el.addEventListener('change', () => {
    saveCollectSettings().catch((e) => showMsg(String(e.message || e), false));
  });
});

document.querySelectorAll('input[name="autoSyncMethod"]').forEach((el) => {
  el.addEventListener('change', () => {
    saveCollectSettings().catch((e) => showMsg(String(e.message || e), false));
  });
});

document.getElementById('btnOpenList').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('src/list/list.html') });
});

document.getElementById('btnOpenFollow').addEventListener('click', async () => {
  try {
    const data = await send('GET_STATS');
    const mid = data.selfMid;
    if (!mid) {
      showMsg('尚未识别到登录 UID，请先打开 bilibili.com 任意页面后再试', false);
      return;
    }
    chrome.tabs.create({
      url: 'https://space.bilibili.com/' + encodeURIComponent(mid) + '/relation/follow'
    });
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

document.getElementById('btnSyncDom').addEventListener('click', async () => {
  const speed = currentSpeed();
  const speedLabel = speed === 'fast' ? '高速' : '低速';
  const btn = document.getElementById('btnSyncDom');
  btn.disabled = true;
  btn.textContent = '正在启动 DOM 同步…';
  try {
    await saveCollectSettings();
    const result = await send('SYNC_FOLLOWINGS_DOM', { speed: speed });
    showMsg(
      '已在后台打开关注页开始 DOM 翻页同步（' +
        speedLabel +
        '）' +
        (result && result.tabId ? '，完成后自动关页' : ''),
      true
    );
    await refresh();
  } catch (e) {
    showMsg(String(e.message || e), false);
  } finally {
    btn.disabled = false;
    btn.textContent = 'DOM 翻页同步关注列表';
  }
});

document.getElementById('btnSyncApi').addEventListener('click', async () => {
  const speed = currentSpeed();
  const speedLabel = speed === 'fast' ? '高速' : '低速';
  const ok = window.confirm(
    '即将通过 B 站 API 翻页拉取全部关注列表（当前：' +
      speedLabel +
      '）。\n\n' +
      '短时间大量请求可能触发账号风控（验证码、临时限制等）。\n' +
      '低速可能降低触发概率，但不能保证安全。\n' +
      '建议优先使用关注页「自动翻页扫描」或自动同步的 DOM 方式。\n\n' +
      '确认继续？'
  );
  if (!ok) return;

  const btn = document.getElementById('btnSyncApi');
  btn.disabled = true;
  btn.textContent = 'API 同步中（' + speedLabel + '）…';
  try {
    await saveCollectSettings();
    const result = await send('SYNC_FOLLOWINGS', { speed: speed });
    showMsg(
      'API 同步完成（' +
        speedLabel +
        '）：' +
        result.total +
        ' 人，新昵称变更 ' +
        result.changed,
      true
    );
    await refresh();
  } catch (e) {
    showMsg(String(e.message || e), false);
    try {
      await refresh();
    } catch (_e) {
      // ignore
    }
  } finally {
    btn.disabled = false;
    btn.textContent = 'API 同步关注列表';
  }
});

document.getElementById('btnExport').addEventListener('click', async () => {
  try {
    const data = await send('EXPORT_DATA');
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'bili-name-history-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
    showMsg('已导出备份', true);
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

document.getElementById('btnImport').addEventListener('click', () => {
  document.getElementById('fileImport').click();
});

document.getElementById('btnClear').addEventListener('click', async () => {
  const ok = window.confirm(
    '确定清空本机全部昵称备份？此操作不可恢复。\n清空后约 10 分钟内暂停自动收集（避免仍打开的页面立刻写回）。\n建议先点「导出备份」。'
  );
  if (!ok) return;
  try {
    const result = await send('CLEAR_DATA');
    showMsg(
      '本地备份已清空' +
        (result && result.pausedMinutes
          ? '，已暂停自动收集 ' + result.pausedMinutes + ' 分钟'
          : ''),
      true
    );
    await refresh();
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

document.getElementById('fileImport').addEventListener('change', async (e) => {
  const file = e.target.files && e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const payload = JSON.parse(text);
    await send('IMPORT_DATA', { payload, merge: true });
    showMsg('导入完成（合并模式）', true);
    await refresh();
  } catch (err) {
    showMsg(String(err.message || err), false);
  }
});

refresh().catch((e) => showMsg(String(e.message || e), false));
