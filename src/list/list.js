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

let allRows = [];
let filter = 'all';

function showMsg(text, ok) {
  const el = document.getElementById('msg');
  el.hidden = false;
  el.className = 'msg ' + (ok ? 'ok' : 'err');
  el.textContent = text;
}

function formatTime(ts) {
  if (!ts) return '-';
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

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function filteredRows() {
  const q = (document.getElementById('q').value || '').trim().toLowerCase();
  return allRows.filter((r) => {
    if (filter === 'renamed' && r.formerNames.length === 0) return false;
    if (filter === 'cancelled' && !r.cancelled) return false;
    if (!q) return true;
    const blob = (
      r.currentName +
      ' ' +
      r.mid +
      ' ' +
      r.formerNames.join(' ')
    ).toLowerCase();
    return blob.indexOf(q) !== -1;
  });
}

function render() {
  const rows = filteredRows();
  document.getElementById('count').textContent = '显示 ' + rows.length + ' / ' + allRows.length;
  const tbody = document.getElementById('tbody');
  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="4" class="empty">暂无数据。请打开关注列表，用右下角「扫描本页」收集</td></tr>';
    return;
  }

  const html = rows
    .map((r) => {
      let tag = '';
      if (r.cancelled) tag = '<span class="tag gone">已注销</span>';
      else if (r.formerNames.length) tag = '<span class="tag renamed">改名</span>';
      const former =
        r.formerNames.length > 0
          ? '<span class="former">' + escapeHtml(r.formerNames.join(' → ')) + '</span>'
          : '<span style="color:#c9ccd0">—</span>';
      return (
        '<tr>' +
        '<td><a class="name" target="_blank" rel="noopener" href="https://space.bilibili.com/' +
        encodeURIComponent(r.mid) +
        '">' +
        escapeHtml(r.currentName || '(无昵称)') +
        '</a>' +
        tag +
        '</td>' +
        '<td>' +
        former +
        '</td>' +
        '<td class="uid">' +
        escapeHtml(r.mid) +
        '</td>' +
        '<td class="time">' +
        formatTime(r.updatedAt) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  tbody.innerHTML = html;
}

async function loadList() {
  allRows = await send('GET_LIST');
  render();
}

document.getElementById('btnRefresh').addEventListener('click', async () => {
  try {
    await loadList();
    showMsg('已刷新', true);
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

document.getElementById('btnOpenFollow').addEventListener('click', async () => {
  try {
    const data = await send('GET_STATS');
    const mid = data.selfMid;
    if (!mid) {
      showMsg('尚未识别登录 UID，请先打开 bilibili.com 任意页面后再试', false);
      return;
    }
    chrome.tabs.create({
      url: 'https://space.bilibili.com/' + encodeURIComponent(mid) + '/relation/follow'
    });
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

document.getElementById('btnClear').addEventListener('click', async () => {
  const ok = window.confirm(
    '确定清空本机全部昵称备份？此操作不可恢复。\n清空后约 10 分钟内暂停自动收集（避免仍打开的页面立刻写回）。\n建议先导出备份。'
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
    await loadList();
  } catch (e) {
    showMsg(String(e.message || e), false);
  }
});

document.getElementById('q').addEventListener('input', render);

document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    filter = btn.getAttribute('data-filter') || 'all';
    render();
  });
});

loadList().catch((e) => {
  document.getElementById('tbody').innerHTML =
    '<tr><td colspan="4" class="empty">' + escapeHtml(String(e.message || e)) + '</td></tr>';
});
