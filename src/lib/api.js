const PAGE_SIZE = 50;

export const SPEED_PRESETS = {
  fast: {
    label: '高速',
    apiPageDelayMs: 350,
    apiJitterMs: 200,
    domPulseMs: 1200
  },
  slow: {
    label: '低速',
    apiPageDelayMs: 1800,
    apiJitterMs: 900,
    domPulseMs: 3200
  }
};

export function normalizeSpeed(speed) {
  return speed === 'fast' ? 'fast' : 'slow';
}

export function getSpeedPreset(speed) {
  return SPEED_PRESETS[normalizeSpeed(speed)];
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function jitteredDelay(baseMs, jitterMs) {
  const base = Math.max(0, Number(baseMs) || 0);
  const jitter = Math.max(0, Number(jitterMs) || 0);
  if (jitter <= 0) return base;
  return base + Math.floor(Math.random() * (jitter + 1));
}

async function biliFetch(url) {
  const res = await fetch(url, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json, text/plain, */*'
    }
  });
  if (!res.ok) {
    throw new Error('HTTP ' + res.status);
  }
  const json = await res.json();
  if (json.code !== 0) {
    throw new Error(json.message || 'API code ' + json.code);
  }
  return json.data;
}

/** 通过 nav 接口解析当前登录 mid */
export async function getSelfMid() {
  const data = await biliFetch('https://api.bilibili.com/x/web-interface/nav');
  if (!data.isLogin || !data.mid) {
    throw new Error('未登录B站，请先在浏览器打开 bilibili.com 并登录');
  }
  return String(data.mid);
}

/**
 * 拉取自己的全部关注（mid + uname + mtime + sign 等）
 * onProgress({ fetched, total, page })
 * options: { speed?: 'fast'|'slow', pageDelayMs?, jitterMs? }
 */
export async function fetchAllFollowings(selfMid, onProgress, options) {
  const opts = options || {};
  const preset = getSpeedPreset(opts.speed);
  const pageDelayMs =
    typeof opts.pageDelayMs === 'number' ? opts.pageDelayMs : preset.apiPageDelayMs;
  const jitterMs = typeof opts.jitterMs === 'number' ? opts.jitterMs : preset.apiJitterMs;

  const list = [];
  let pn = 1;
  let total = Infinity;

  while (list.length < total) {
    const data = await biliFetch(
      'https://api.bilibili.com/x/relation/followings?vmid=' +
        encodeURIComponent(selfMid) +
        '&pn=' +
        pn +
        '&ps=' +
        PAGE_SIZE +
        '&order=desc&order_type=attention'
    );
    total = typeof data.total === 'number' ? data.total : list.length;
    const page = data.list || [];
    if (page.length === 0) break;
    for (let i = 0; i < page.length; i++) {
      const u = page[i];
      list.push({
        mid: String(u.mid),
        name: u.uname || u.name || '',
        face: u.face || '',
        attribute: u.attribute,
        mtime: typeof u.mtime === 'number' ? u.mtime : Number(u.mtime) || 0,
        sign: u.sign != null ? String(u.sign) : ''
      });
    }
    if (onProgress) {
      onProgress({ fetched: list.length, total: total, page: pn });
    }
    if (page.length < PAGE_SIZE) break;
    pn += 1;
    await sleep(jitteredDelay(pageDelayMs, jitterMs));
  }

  return list;
}
