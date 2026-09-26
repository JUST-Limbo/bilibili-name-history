(function () {
  'use strict';

  const BADGE_ATTR = 'data-bnh-mid';
  const processed = new WeakSet();
  let scanTimer = 0;
  let selfMid = '';
  let lastVideoKey = '';
  let autoPaging = false;
  let autoStepBusy = false;
  let autoSyncManaged = false;
  let autoSyncBootstrapStarted = false;
  const autoState = {
    pages: 0,
    seen: null,
    phase: 'scan',
    prevSig: '',
    waitStarted: 0,
    lastNext: null,
    startedAt: 0,
    totalPages: 0,
    followTotal: 0,
    pageSize: 0
  };

  function send(type, payload) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(Object.assign({ type }, payload || {}), (res) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: chrome.runtime.lastError.message });
            return;
          }
          resolve(res || { ok: false, error: 'empty response' });
        });
      } catch (e) {
        resolve({ ok: false, error: String(e) });
      }
    });
  }

  function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
  }

  function isCancelledName(name) {
    return name === '账号已注销' || name === '已注销';
  }

  function midFromHref(href) {
    if (!href) return '';
    const m = String(href).match(/space\.bilibili\.com\/(\d+)/);
    return m ? m[1] : '';
  }

  function spaceMidFromUrl() {
    const m = location.pathname.match(/^\/(\d+)/);
    return m ? m[1] : '';
  }

  function cleanText(el) {
    if (!el) return '';
    const clone = el.cloneNode(true);
    const badges = clone.querySelectorAll('.bnh-badge');
    for (let i = 0; i < badges.length; i++) badges[i].remove();
    return (clone.textContent || '').replace(/\s+/g, ' ').trim();
  }

  function selfMidFromCookie() {
    const m = document.cookie.match(/(?:^|;\s*)DedeUserID=(\d+)/);
    return m ? m[1] : '';
  }

  function selfMidFromDom() {
    const selectors = [
      '.header-avatar-wrap a[href*="space.bilibili.com/"]',
      '.header-entry-mini a[href*="space.bilibili.com/"]',
      '#internationalHeader a[href*="space.bilibili.com/"]',
      '.nav-user-info a[href*="space.bilibili.com/"]',
      'a.header-avatar-wrap--container[href*="space.bilibili.com/"]'
    ];
    for (let i = 0; i < selectors.length; i++) {
      const el = document.querySelector(selectors[i]);
      if (!el) continue;
      const mid = midFromHref(el.getAttribute('href') || el.href || '');
      if (mid) return mid;
    }
    return '';
  }

  async function ensureSelfMid() {
    if (selfMid) return selfMid;
    const fromCookie = selfMidFromCookie();
    const fromDom = selfMidFromDom();
    const mid = fromCookie || fromDom;
    if (mid) {
      selfMid = mid;
      await send('SET_SELF_MID', { mid: mid });
      return selfMid;
    }
    const res = await send('GET_SELF_MID', {});
    if (res.ok && res.data) selfMid = String(res.data);
    return selfMid;
  }

  function isSelf(mid) {
    return selfMid && String(mid) === String(selfMid);
  }

  function ensureBadge(anchor, mid, formerNames, currentName) {
    if (!anchor || !mid || !anchor.parentNode) return;

    let badge = null;
    if (anchor.nextElementSibling && anchor.nextElementSibling.classList.contains('bnh-badge')) {
      badge = anchor.nextElementSibling;
    }

    if (!formerNames || formerNames.length === 0) {
      if (badge) badge.remove();
      return;
    }

    const kind = isCancelledName(currentName) ? 'gone' : 'renamed';
    const show = formerNames.slice(-3);
    const label = show.join(' / ');

    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'bnh-badge';
      badge.setAttribute(BADGE_ATTR, mid);
      anchor.insertAdjacentElement('afterend', badge);
    }

    badge.dataset.bnhKind = kind;
    badge.setAttribute(BADGE_ATTR, mid);
    badge.title = '本机记录的曾用名：' + formerNames.join(' → ');
    badge.textContent = '';
    const strong = document.createElement('strong');
    strong.textContent = '曾用 ';
    badge.appendChild(strong);
    badge.appendChild(document.createTextNode(label));
  }

  async function observeUser(anchor, mid, name) {
    if (!mid || !name) return;
    await ensureSelfMid();
    if (isSelf(mid)) {
      ensureBadge(anchor, mid, [], name);
      return;
    }
    const key = mid + '|' + name;
    if (anchor.__bnhKey === key && anchor.__bnhDone) return;
    anchor.__bnhKey = key;

    const rec = await send('RECORD_NAME', { mid: mid, name: name });
    if (!rec.ok) return;

    const formerRes = await send('GET_FORMER', { mid: mid, name: name });
    if (!formerRes.ok) return;
    ensureBadge(anchor, mid, formerRes.data || [], name);
    anchor.__bnhDone = true;
  }

  function findSpaceNameAnchor(mid) {
    const selectors = [
      '#h-name',
      '.h .name',
      '.nickname',
      '.up-info .username',
      '.up-info-top .nickname',
      '.header-info .name',
      '.space-info .name',
      '#app .name[href*="space.bilibili.com/' + mid + '"]',
      'a[href*="space.bilibili.com/' + mid + '"]'
    ];
    for (let i = 0; i < selectors.length; i++) {
      const nodes = document.querySelectorAll(selectors[i]);
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        const name = cleanText(el);
        if (!name || name.length > 40) continue;
        const hrefMid = midFromHref(el.getAttribute('href') || el.href || '');
        if (hrefMid && hrefMid !== mid) continue;
        return el;
      }
    }
    return null;
  }

  async function scanSpacePage() {
    const mid = spaceMidFromUrl();
    if (!mid) return;
    await ensureSelfMid();
    if (isSelf(mid)) return;
    const anchor = findSpaceNameAnchor(mid);
    if (!anchor) return;
    const name = cleanText(anchor);
    if (!name) return;
    observeUser(anchor, mid, name);
  }

  function isVideoLikePage() {
    const path = location.pathname || '';
    return (
      path.indexOf('/video/') !== -1 ||
      path.indexOf('/list/') !== -1 ||
      path.indexOf('/bangumi/') !== -1
    );
  }

  function videoPageKey() {
    const path = location.pathname || '';
    const bv = path.match(/\/video\/(BV[\w]+)/i);
    if (bv) return bv[1];
    const av = path.match(/\/video\/av(\d+)/i);
    if (av) return 'av' + av[1];
    return path;
  }

  function collectVideoOwnerFromDom() {
    const selectors = [
      '.up-panel-container .up-name',
      '.up-info a.up-name',
      '.up-detail-top .up-name',
      '.up-detail a.up-name',
      '.up-info-container .up-name',
      '#v_upinfo .username a',
      '.up-owner a[href*="space.bilibili.com"]',
      '.members-info .avatar a[href*="space.bilibili.com"]',
      '.video-info-detail a[href*="space.bilibili.com"]',
      'a.up-name[href*="space.bilibili.com"]'
    ];

    for (let i = 0; i < selectors.length; i++) {
      const nodes = document.querySelectorAll(selectors[i]);
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        const mid = midFromHref(el.getAttribute('href') || el.href || '');
        let name = cleanText(el);
        if (!mid || !name || name.length > 40) continue;
        // 有的节点只有图标，昵称在兄弟节点
        if (name.length < 2) {
          const parent = el.parentElement;
          if (parent) name = cleanText(parent);
        }
        if (!name || name.length > 40) continue;
        return { el: el, mid: mid, name: name };
      }
    }
    return null;
  }

  async function scanVideoPage() {
    if (!isVideoLikePage()) return;

    const owner = collectVideoOwnerFromDom();
    if (!owner) return;

    const key = videoPageKey() + '|' + owner.mid + '|' + owner.name;
    if (key !== lastVideoKey) {
      lastVideoKey = key;
    }
    await observeUser(owner.el, owner.mid, owner.name);
  }

  function isFollowListPath() {
    return /\/(relation|fans)\/(follow|fans)/.test(location.pathname);
  }

  function followListRoot() {
    return (
      document.querySelector('#page-follows') ||
      document.querySelector('.follow-list') ||
      document.querySelector('.relation-list') ||
      document.querySelector('.space-follow') ||
      document.querySelector('#app .list') ||
      document.body
    );
  }

  function collectFollowItemsFromDom() {
    const root = followListRoot();
    const links = root.querySelectorAll('a[href*="space.bilibili.com/"]');
    const map = new Map();

    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      const mid = midFromHref(a.getAttribute('href') || a.href || '');
      if (!mid || isSelf(mid)) continue;
      // 排除顶栏等：关注列表项通常在列表容器更深处，且文本是昵称
      const name = cleanText(a);
      if (!name || name.length > 30) continue;
      if (!map.has(mid)) {
        map.set(mid, { el: a, mid: mid, name: name });
      }
    }
    return Array.from(map.values());
  }

  async function applyFollowItems(items, force, roundMeta) {
    if (!items.length) return { total: 0, changed: 0 };
    const meta = roundMeta || {};
    const payload = {
      force: !!force,
      items: items.map((it) => ({ mid: it.mid, name: it.name }))
    };
    if (typeof meta.roundSeen === 'number') payload.roundSeen = meta.roundSeen;
    if (typeof meta.pages === 'number') payload.pages = meta.pages;
    await send('RECORD_BATCH', payload);
    const batch = await send('LOOKUP_BATCH', {
      items: items.map((it) => ({ mid: it.mid, name: it.name }))
    });
    const map = batch.ok ? batch.data || {} : {};
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      ensureBadge(it.el, it.mid, map[it.mid] || [], it.name);
      processed.add(it.el);
      it.el.__bnhKey = it.mid + '|' + it.name;
    }
    return { total: items.length, changed: 0 };
  }

  async function scanFollowList() {
    if (!isFollowListPath()) return;
    await ensureSelfMid();
    const items = collectFollowItemsFromDom();
    if (items.length === 0) return;
    // 被动扫描不强制，清空后的暂停期内不会写回
    await applyFollowItems(items, false);
  }

  function findNextPageButton() {
    const selectors = [
      '.vui_pagenation--btns button:last-child',
      '.vui_pagination--btns button:last-child',
      '.vui_pagenation-btn:last-child',
      '.be-pager-next:not(.be-pager-disabled)',
      'li.be-pager-next:not(.be-pager-disabled)',
      'li.be-pager-next:not(.be-pager-disabled) a',
      '.page-item.next:not(.disabled) button',
      '.page-item.next:not(.disabled) a',
      'button[aria-label="下一页"]',
      'button[aria-label="下一頁"]',
      '[class*="pagination"] button:last-child',
      '[class*="pager"] .next:not(.disabled)'
    ];

    for (let i = 0; i < selectors.length; i++) {
      const nodes = document.querySelectorAll(selectors[i]);
      for (let j = 0; j < nodes.length; j++) {
        const el = nodes[j];
        if (!el || el.disabled) continue;
        if (el.classList.contains('disabled') || el.classList.contains('be-pager-disabled')) {
          continue;
        }
        if (el.getAttribute('aria-disabled') === 'true') continue;
        // 排除工具条自身按钮
        if (el.closest('#bnh-follow-toolbar')) continue;
        const text = (el.textContent || '').replace(/\s+/g, '');
        // 末页常见：没有箭头/下一页字样且 disabled；可用则接受「下一页」或仅图标按钮
        if (
          text.indexOf('下一页') !== -1 ||
          text.indexOf('下一頁') !== -1 ||
          text === '>' ||
          text === '›' ||
          text === '' ||
          el.tagName === 'BUTTON' ||
          el.tagName === 'LI' ||
          el.tagName === 'A'
        ) {
          return el;
        }
      }
    }

    // 兜底：找带「下一页」文案的可点元素
    const all = document.querySelectorAll('button, a, li, span');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.closest('#bnh-follow-toolbar')) continue;
      const text = (el.textContent || '').replace(/\s+/g, '');
      if (text !== '下一页' && text !== '下一頁') continue;
      if (el.disabled || el.classList.contains('disabled')) continue;
      return el;
    }
    return null;
  }

  function followListSignature() {
    const items = collectFollowItemsFromDom();
    return items
      .map((it) => it.mid)
      .slice(0, 8)
      .join(',');
  }

  function formatDuration(ms) {
    const s = Math.max(0, Math.round(Number(ms) / 1000));
    if (s < 60) return s + ' 秒';
    const m = Math.floor(s / 60);
    const rs = s % 60;
    if (m < 60) return rs > 0 ? m + ' 分 ' + rs + ' 秒' : m + ' 分钟';
    const h = Math.floor(m / 60);
    const rm = m % 60;
    return rm > 0 ? h + ' 小时 ' + rm + ' 分' : h + ' 小时';
  }

  function paginationRoots() {
    const nodes = document.querySelectorAll(
      '.vui_pagenation, .vui_pagination, .be-pager, [class*="pagenation"], [class*="pagination"], [class*="pager"]'
    );
    const list = [];
    for (let i = 0; i < nodes.length; i++) {
      if (nodes[i].closest('#bnh-follow-toolbar')) continue;
      list.push(nodes[i]);
    }
    return list;
  }

  function readPaginationMeta() {
    let currentPage = 0;
    let totalPages = 0;
    const roots = paginationRoots();
    const texts = [];

    for (let i = 0; i < roots.length; i++) {
      texts.push((roots[i].textContent || '').replace(/\s+/g, ' ').trim());
    }
    texts.push((document.body && document.body.innerText) || '');

    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (!t) continue;
      let m = t.match(/共\s*(\d+)\s*页/);
      if (m) totalPages = Math.max(totalPages, parseInt(m[1], 10) || 0);
      m = t.match(/(\d+)\s*\/\s*(\d+)/);
      if (m) {
        currentPage = Math.max(currentPage, parseInt(m[1], 10) || 0);
        totalPages = Math.max(totalPages, parseInt(m[2], 10) || 0);
      }
    }

    const pn = location.href.match(/[?&]pn=(\d+)/);
    if (pn) currentPage = Math.max(currentPage, parseInt(pn[1], 10) || 0);

    let maxBtn = 0;
    let activeBtn = 0;
    for (let i = 0; i < roots.length; i++) {
      const root = roots[i];
      const active = root.querySelector(
        '.be-pager-item.be-pager-item-active, button[aria-current="page"], .selected, .is-active, [class*="active"]'
      );
      if (active) {
        const n = parseInt((active.textContent || '').replace(/\D/g, ''), 10);
        if (n > 0) activeBtn = Math.max(activeBtn, n);
      }
      const btns = root.querySelectorAll('button, a, li, span');
      for (let j = 0; j < btns.length; j++) {
        const raw = (btns[j].textContent || '').replace(/\s+/g, '');
        if (!/^\d+$/.test(raw)) continue;
        const n = parseInt(raw, 10);
        if (n > maxBtn) maxBtn = n;
      }
    }
    if (activeBtn > 0) currentPage = Math.max(currentPage, activeBtn);
    if (maxBtn > totalPages) totalPages = maxBtn;
    if (!currentPage && autoState.pages > 0) currentPage = autoState.pages;

    return { currentPage: currentPage, totalPages: totalPages };
  }

  function readFollowTotalFromDom() {
    const roots = [];
    const followRoot = followListRoot();
    if (followRoot) roots.push(followRoot);
    const header = document.querySelector('#page-follows, .space-follow, .follow-main, .relation-container');
    if (header) roots.push(header);
    roots.push(document.body);

    for (let i = 0; i < roots.length; i++) {
      const text = (roots[i].innerText || roots[i].textContent || '').replace(/\s+/g, ' ');
      let m = text.match(/关注[了]?\s*(\d+)\s*人/);
      if (m) return parseInt(m[1], 10) || 0;
      m = text.match(/全部关注\s*[（(]?\s*(\d+)/);
      if (m) return parseInt(m[1], 10) || 0;
      m = text.match(/关注\s*[：:]\s*(\d+)/);
      if (m) return parseInt(m[1], 10) || 0;
      m = text.match(/全部\s+(\d{2,})/);
      if (m) return parseInt(m[1], 10) || 0;
    }
    return 0;
  }

  function estimateTotalPages(pageItemCount) {
    const meta = readPaginationMeta();
    if (meta.totalPages > 0) return meta.totalPages;
    const followTotal = autoState.followTotal || readFollowTotalFromDom();
    const size = pageItemCount || autoState.pageSize || 0;
    if (followTotal > 0 && size > 0) {
      return Math.max(1, Math.ceil(followTotal / size));
    }
    return 0;
  }

  function calcProgress() {
    const seen = autoState.seen ? autoState.seen.size : 0;
    const pages = autoState.pages;
    let totalPages = autoState.totalPages || estimateTotalPages(autoState.pageSize);
    if (totalPages > autoState.totalPages) autoState.totalPages = totalPages;

    let pct = 0;
    let remainPages = 0;
    if (totalPages > 0) {
      pct = Math.min(100, Math.round((pages / totalPages) * 100));
      remainPages = Math.max(0, totalPages - pages);
    } else if (autoState.followTotal > 0 && seen > 0) {
      pct = Math.min(99, Math.round((seen / autoState.followTotal) * 100));
      const remainPeople = Math.max(0, autoState.followTotal - seen);
      const size = autoState.pageSize || Math.max(1, Math.round(seen / Math.max(1, pages)));
      remainPages = Math.ceil(remainPeople / size);
    }

    const elapsed = autoState.startedAt ? Date.now() - autoState.startedAt : 0;
    let etaMs = -1;
    let totalEtaMs = -1;
    if (pages >= 1 && remainPages >= 0 && (totalPages > 0 || autoState.followTotal > 0)) {
      const avg = elapsed / pages;
      etaMs = avg * remainPages;
      totalEtaMs = avg * (pages + remainPages);
    }

    return {
      pct: pct,
      pages: pages,
      totalPages: totalPages,
      seen: seen,
      followTotal: autoState.followTotal,
      elapsed: elapsed,
      etaMs: etaMs,
      totalEtaMs: totalEtaMs,
      remainPages: remainPages
    };
  }

  function setAutoStatus(text) {
    const status = document.getElementById('bnh-scan-status');
    if (status) status.textContent = text;
  }

  function setProgressVisible(show) {
    const wrap = document.getElementById('bnh-scan-progress');
    if (wrap) wrap.hidden = !show;
  }

  function updateAutoProgress(phaseText) {
    const p = calcProgress();
    const fill = document.getElementById('bnh-scan-progress-fill');
    const metaEl = document.getElementById('bnh-scan-progress-meta');
    setProgressVisible(true);
    if (fill) fill.style.width = p.pct + '%';

    const parts = [];
    parts.push(p.pct + '%');
    if (p.totalPages > 0) {
      parts.push(p.pages + '/' + p.totalPages + ' 页');
    } else {
      parts.push('已扫 ' + p.pages + ' 页');
    }
    if (p.followTotal > 0) {
      parts.push('约 ' + p.seen + '/' + p.followTotal + ' 人');
    } else {
      parts.push('累计 ' + p.seen + ' 人');
    }
    if (metaEl) metaEl.textContent = parts.join(' · ');

    const lines = [];
    if (phaseText) lines.push(phaseText);
    if (p.etaMs >= 0) {
      if (p.remainPages > 0) {
        lines.push('预计剩余 ' + formatDuration(p.etaMs) + '（全程约 ' + formatDuration(p.totalEtaMs) + '）');
      } else {
        lines.push('即将完成');
      }
    } else if (autoPaging) {
      lines.push('预计耗时：收集 1～2 页后估算');
    }
    setAutoStatus(lines.join('\n'));
  }

  function resetAutoUi() {
    const stopBtn = document.getElementById('bnh-scan-stop');
    const autoBtn = document.getElementById('bnh-scan-auto');
    if (stopBtn) stopBtn.hidden = true;
    if (autoBtn) autoBtn.hidden = false;
  }

  function showToast(message, kind) {
    const text = String(message || '').trim();
    if (!text) return;
    let host = document.getElementById('bnh-toast-host');
    if (!host) {
      host = document.createElement('div');
      host.id = 'bnh-toast-host';
      document.documentElement.appendChild(host);
    }
    const el = document.createElement('div');
    el.className = 'bnh-toast bnh-toast-' + (kind || 'err');
    el.setAttribute('role', 'status');
    el.textContent = text;
    host.appendChild(el);
    setTimeout(function () {
      el.classList.add('bnh-toast-show');
    }, 10);
    setTimeout(function () {
      el.classList.remove('bnh-toast-show');
      setTimeout(function () {
        if (el.parentNode) el.parentNode.removeChild(el);
      }, 280);
    }, 6000);
  }

  function isScanFailureReason(reason) {
    if (!reason) return false;
    if (reason.indexOf('已停止') !== -1) return false;
    if (reason.indexOf('末页') !== -1) return false;
    if (reason.indexOf('未找到下一页') !== -1) return false;
    return (
      reason.indexOf('无响应') !== -1 ||
      reason.indexOf('未识别') !== -1 ||
      reason.indexOf('无法启动') !== -1 ||
      reason.indexOf('未加载') !== -1 ||
      reason.indexOf('失败') !== -1
    );
  }

  function toastScanFailure(reason) {
    showToast(
      '曾用名同步失败：' +
        reason +
        '。可能是页面改版导致选择器失效，请稍后重试或改用 Popup 手动同步。',
      'err'
    );
  }

  async function stopAutoPaging(reason) {
    const p = calcProgress();
    const wasManaged = autoSyncManaged;
    const pages = p.pages;
    const seen = p.seen;
    const elapsed = p.elapsed;
    autoPaging = false;
    autoState.phase = 'scan';
    autoState.seen = null;
    autoSyncManaged = false;
    await send('AUTO_PAGE_STOP');
    const fill = document.getElementById('bnh-scan-progress-fill');
    const metaEl = document.getElementById('bnh-scan-progress-meta');
    if (reason && (reason.indexOf('末页') !== -1 || reason.indexOf('未找到下一页') !== -1)) {
      if (fill) fill.style.width = '100%';
      if (metaEl) {
        metaEl.textContent =
          '100% · ' +
          pages +
          (p.totalPages ? '/' + p.totalPages : '') +
          ' 页 · 累计 ' +
          seen +
          ' 人';
      }
      setAutoStatus(reason + '\n实际耗时 ' + formatDuration(elapsed));
    } else if (reason) {
      setProgressVisible(true);
      if (fill) fill.style.width = p.pct + '%';
      if (metaEl) {
        metaEl.textContent =
          p.pct +
          '% · 已扫 ' +
          pages +
          (p.totalPages ? '/' + p.totalPages : '') +
          ' 页 · 累计 ' +
          seen +
          ' 人';
      }
      setAutoStatus(reason + (elapsed > 0 ? '\n已用时 ' + formatDuration(elapsed) : ''));
    }
    resetAutoUi();

    if (isScanFailureReason(reason)) {
      // 手动翻页失败：本页飘窗；托管自动同步失败还会由后台广播到其它 B 站页
      toastScanFailure(reason);
    }

    // 无论手动/托管，整轮结束都写入累计人数，避免 Popup 只显示最后一页
    const roundOk =
      !!reason &&
      (reason.indexOf('末页') !== -1 ||
        reason.indexOf('未找到下一页') !== -1 ||
        reason === '已停止' ||
        (pages > 0 &&
          reason.indexOf('无响应') === -1 &&
          reason.indexOf('未识别') === -1 &&
          reason.indexOf('无法启动') === -1));
    await send('DOM_SCAN_ROUND_DONE', {
      ok: roundOk,
      reason: reason || '',
      pages: pages,
      seen: seen,
      elapsed: elapsed
    });

    if (wasManaged) {
      await send('AUTO_SYNC_FINISHED', {
        ok: roundOk,
        reason: reason || '',
        pages: pages,
        seen: seen,
        elapsed: elapsed
      });
    }
  }

  async function runAutoPageStep() {
    if (!autoPaging) return { done: true };
    if (autoStepBusy) return { done: false };
    autoStepBusy = true;
    try {
      await ensureSelfMid();

      if (autoState.phase === 'wait') {
        const now = followListSignature();
        const next = findNextPageButton();
        const sigChanged = now && now !== autoState.prevSig;
        const btnChanged = next && next !== autoState.lastNext;
        if (sigChanged || btnChanged) {
          autoState.phase = 'scan';
        } else if (Date.now() - autoState.waitStarted > 15000) {
          await stopAutoPaging(
            '翻页无响应，已停止。累计约 ' + (autoState.seen ? autoState.seen.size : 0) + ' 人'
          );
          return { done: true };
        } else {
          updateAutoProgress('正在翻页…');
          return { done: false };
        }
      }

      const items = collectFollowItemsFromDom();
      if (items.length === 0) {
        await stopAutoPaging('本页未识别到关注项，请确认在「关注」列表');
        return { done: true };
      }
      if (!autoState.pageSize) autoState.pageSize = items.length;
      if (!autoState.followTotal) {
        autoState.followTotal = readFollowTotalFromDom();
      }
      const est = estimateTotalPages(items.length);
      if (est > autoState.totalPages) autoState.totalPages = est;

      if (!autoState.seen) autoState.seen = new Set();
      for (let i = 0; i < items.length; i++) {
        autoState.seen.add(items[i].mid);
      }
      autoState.pages += 1;
      await applyFollowItems(items, true, {
        roundSeen: autoState.seen.size,
        pages: autoState.pages
      });
      updateAutoProgress('正在收集本页…');

      const next = findNextPageButton();
      if (!next) {
        await stopAutoPaging(
          '未找到下一页按钮（可能已到末页或页面结构变化）。累计约 ' +
            autoState.seen.size +
            ' 人'
        );
        return { done: true };
      }
      if (next.disabled) {
        await stopAutoPaging(
          '下一页不可用，已到末页。累计约 ' + autoState.seen.size + ' 人'
        );
        return { done: true };
      }

      autoState.prevSig = followListSignature();
      autoState.lastNext = next;
      next.click();
      autoState.phase = 'wait';
      autoState.waitStarted = Date.now();
      updateAutoProgress('本页完成，正在翻页…');
      return { done: false };
    } finally {
      autoStepBusy = false;
    }
  }

  async function startAutoPaging(options) {
    const opts = options || {};
    if (autoPaging) return { ok: false, error: 'already' };
    autoPaging = true;
    autoSyncManaged = !!opts.managed;
    autoState.pages = 0;
    autoState.seen = new Set();
    autoState.phase = 'scan';
    autoState.prevSig = '';
    autoState.waitStarted = 0;
    autoState.lastNext = null;
    autoState.startedAt = Date.now();
    autoState.pageSize = 0;
    autoState.followTotal = readFollowTotalFromDom();
    autoState.totalPages = estimateTotalPages(0);

    ensureFollowToolbar();
    const toolbar = document.getElementById('bnh-follow-toolbar');
    if (toolbar) setToolbarCollapsed(toolbar, false);
    const autoBtn = document.getElementById('bnh-scan-auto');
    const stopBtn = document.getElementById('bnh-scan-stop');
    if (autoBtn) autoBtn.hidden = true;
    if (stopBtn) stopBtn.hidden = false;
    setProgressVisible(true);

    const tip = autoSyncManaged
      ? '后台自动同步中，完成后将关闭此标签页…'
      : '开始自动翻页（切走标签页也会继续）…';
    updateAutoProgress(tip);

    const startRes = await send('AUTO_PAGE_START');
    if (!startRes.ok) {
      await stopAutoPaging('无法启动后台驱动：' + (startRes.error || 'unknown'));
      return { ok: false, error: startRes.error };
    }
    const speedLabel =
      startRes.data && startRes.data.speed === 'fast' ? '高速' : '低速';
    const intervalMs =
      startRes.data && startRes.data.intervalMs ? startRes.data.intervalMs : 0;
    updateAutoProgress(
      (autoSyncManaged ? '后台自动同步 · ' : '开始自动翻页 · ') +
        speedLabel +
        (intervalMs ? '（约 ' + Math.round(intervalMs / 1000) + ' 秒/步）' : '') +
        (autoSyncManaged ? '；完成后自动关页' : '；切走标签页也会继续')
    );
    await runAutoPageStep();
    return { ok: true };
  }

  async function bootstrapAutoSyncFromBackground() {
    if (autoSyncBootstrapStarted || autoPaging) return;
    if (!isFollowListPath()) return;
    autoSyncBootstrapStarted = true;
    ensureFollowToolbar();
    const t0 = Date.now();
    while (Date.now() - t0 < 20000) {
      if (collectFollowItemsFromDom().length > 0) break;
      await sleep(400);
    }
    if (collectFollowItemsFromDom().length === 0) {
      const reason = '关注列表未加载出内容';
      toastScanFailure(reason);
      await send('AUTO_SYNC_FINISHED', {
        ok: false,
        reason: reason,
        pages: 0,
        seen: 0
      });
      autoSyncBootstrapStarted = false;
      return;
    }
    await startAutoPaging({ managed: true });
  }

  function toolbarStorageKey(kind) {
    return 'bnh-follow-toolbar-' + kind;
  }

  function readToolbarCollapsed() {
    try {
      return localStorage.getItem(toolbarStorageKey('collapsed')) === '1';
    } catch (_e) {
      return false;
    }
  }

  function writeToolbarCollapsed(collapsed) {
    try {
      localStorage.setItem(toolbarStorageKey('collapsed'), collapsed ? '1' : '0');
    } catch (_e) {
      // ignore
    }
  }

  function readToolbarPos() {
    try {
      const raw = localStorage.getItem(toolbarStorageKey('pos'));
      if (!raw) return null;
      const pos = JSON.parse(raw);
      if (!pos || typeof pos.left !== 'number' || typeof pos.top !== 'number') return null;
      return pos;
    } catch (_e) {
      return null;
    }
  }

  function writeToolbarPos(left, top) {
    try {
      localStorage.setItem(
        toolbarStorageKey('pos'),
        JSON.stringify({ left: left, top: top })
      );
    } catch (_e) {
      // ignore
    }
  }

  function clampToolbarPos(bar, left, top) {
    const margin = 8;
    const w = bar.offsetWidth || 260;
    const h = bar.offsetHeight || 40;
    const maxL = Math.max(margin, window.innerWidth - w - margin);
    const maxT = Math.max(margin, window.innerHeight - h - margin);
    return {
      left: Math.min(maxL, Math.max(margin, left)),
      top: Math.min(maxT, Math.max(margin, top))
    };
  }

  function applyToolbarPos(bar, left, top) {
    const pos = clampToolbarPos(bar, left, top);
    bar.style.left = pos.left + 'px';
    bar.style.top = pos.top + 'px';
    bar.style.right = 'auto';
    bar.style.bottom = 'auto';
    writeToolbarPos(pos.left, pos.top);
  }

  function setToolbarCollapsed(bar, collapsed) {
    if (collapsed) bar.classList.add('bnh-tb-collapsed');
    else bar.classList.remove('bnh-tb-collapsed');
    const btn = document.getElementById('bnh-tb-toggle');
    if (btn) {
      btn.textContent = collapsed ? '展开' : '收起';
      btn.setAttribute('title', collapsed ? '展开面板' : '收起面板');
      btn.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    }
    writeToolbarCollapsed(collapsed);
  }

  function bindToolbarDrag(bar) {
    const head = bar.querySelector('.bnh-tb-head');
    if (!head) return;
    let dragging = false;
    let moved = false;
    let startX = 0;
    let startY = 0;
    let originLeft = 0;
    let originTop = 0;

    function onMove(ev) {
      if (!dragging) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      moved = true;
      applyToolbarPos(bar, originLeft + dx, originTop + dy);
    }

    function onUp() {
      if (!dragging) return;
      dragging = false;
      bar.classList.remove('bnh-tb-dragging');
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
    }

    head.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0) return;
      const t = ev.target;
      if (t && (t.id === 'bnh-tb-toggle' || (t.closest && t.closest('#bnh-tb-toggle')))) {
        return;
      }
      const rect = bar.getBoundingClientRect();
      dragging = true;
      moved = false;
      startX = ev.clientX;
      startY = ev.clientY;
      originLeft = rect.left;
      originTop = rect.top;
      bar.classList.add('bnh-tb-dragging');
      // 从默认 right/bottom 切到 left/top，便于拖动
      applyToolbarPos(bar, originLeft, originTop);
      document.addEventListener('mousemove', onMove, true);
      document.addEventListener('mouseup', onUp, true);
      ev.preventDefault();
    });
  }

  function ensureFollowToolbar() {
    if (!isFollowListPath()) return;
    if (document.getElementById('bnh-follow-toolbar')) return;

    const bar = document.createElement('div');
    bar.id = 'bnh-follow-toolbar';
    bar.innerHTML =
      '<div class="bnh-tb-head">' +
      '<span class="bnh-tb-grip" aria-hidden="true" title="拖动">⋮⋮</span>' +
      '<div class="bnh-tb-title">曾用名 · 本页扫描</div>' +
      '<button type="button" class="bnh-tb-toggle" id="bnh-tb-toggle">收起</button>' +
      '</div>' +
      '<div class="bnh-tb-body">' +
      '<button type="button" id="bnh-scan-page">扫描本页</button>' +
      '<button type="button" id="bnh-scan-auto">自动翻页扫描</button>' +
      '<button type="button" id="bnh-scan-stop" hidden>停止</button>' +
      '<div class="bnh-tb-progress" id="bnh-scan-progress" hidden>' +
      '<div class="bnh-tb-progress-bar"><i id="bnh-scan-progress-fill"></i></div>' +
      '<div class="bnh-tb-progress-meta" id="bnh-scan-progress-meta">0%</div>' +
      '</div>' +
      '<div class="bnh-tb-status" id="bnh-scan-status">仅收集页面上可见的关注项</div>' +
      '</div>';
    document.documentElement.appendChild(bar);

    const savedPos = readToolbarPos();
    if (savedPos) applyToolbarPos(bar, savedPos.left, savedPos.top);
    setToolbarCollapsed(bar, readToolbarCollapsed());
    bindToolbarDrag(bar);

    document.getElementById('bnh-tb-toggle').addEventListener('click', (ev) => {
      ev.stopPropagation();
      setToolbarCollapsed(bar, !bar.classList.contains('bnh-tb-collapsed'));
    });

    document.getElementById('bnh-scan-page').addEventListener('click', async () => {
      const status = document.getElementById('bnh-scan-status');
      status.textContent = '扫描中…';
      await ensureSelfMid();
      const items = collectFollowItemsFromDom();
      if (items.length === 0) {
        status.textContent = '本页未识别到关注项';
        showToast(
          '曾用名扫描失败：本页未识别到关注项。可能是关注列表改版导致选择器失效。',
          'err'
        );
        return;
      }
      await applyFollowItems(items, true);
      status.textContent = '本页已记录 ' + items.length + ' 人';
    });

    document.getElementById('bnh-scan-stop').addEventListener('click', async () => {
      await stopAutoPaging('已停止');
    });

    document.getElementById('bnh-scan-auto').addEventListener('click', async () => {
      await startAutoPaging({ managed: false });
    });
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;
    if (msg.type === 'SHOW_TOAST') {
      showToast(msg.message || '', msg.kind || 'err');
      sendResponse({ ok: true });
      return;
    }
    if (msg.type === 'AUTO_PAGE_TICK') {
      runAutoPageStep()
        .then((res) => sendResponse(res || { done: true }))
        .catch(() => sendResponse({ done: true }));
      return true;
    }
    if (msg.type === 'AUTO_SYNC_BOOTSTRAP') {
      bootstrapAutoSyncFromBackground()
        .then(() => sendResponse({ ok: true }))
        .catch((e) => sendResponse({ ok: false, error: String(e) }));
      return true;
    }
  });

  async function reportBiliVisit() {
    await ensureSelfMid();
    await send('BILI_VISIT', { mid: selfMid || selfMidFromCookie() || '' });
  }

  async function scanAll() {
    await ensureSelfMid();
    ensureFollowToolbar();
    scanSpacePage();
    scanVideoPage();
    scanFollowList();
  }

  function scheduleScan() {
    if (scanTimer) clearTimeout(scanTimer);
    scanTimer = setTimeout(scanAll, 350);
  }

  const obs = new MutationObserver(() => scheduleScan());
  obs.observe(document.documentElement, { childList: true, subtree: true });

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      lastVideoKey = '';
      // 自动翻页时 SPA 改 URL 属正常，不能打断 autoPaging
      if (!autoPaging) {
        scheduleScan();
      }
    }
  }, 800);

  scheduleScan();
  reportBiliVisit().catch(() => {});
})();
