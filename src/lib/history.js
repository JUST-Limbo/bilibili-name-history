import { recordName, getFormerNames, getUsers } from './db.js';
import { getSelfMid, fetchAllFollowings } from './api.js';

export async function lookupFormer(mid, currentName) {
  return getFormerNames(mid, currentName);
}

export async function lookupBatch(items) {
  const mids = items.map((i) => String(i.mid));
  const map = await getUsers(mids);
  const out = {};
  for (const item of items) {
    const mid = String(item.mid);
    const current = (item.name || '').trim();
    const user = map[mid];
    if (!user) {
      out[mid] = [];
      continue;
    }
    const seen = new Set();
    const former = [];
    for (const n of user.names || []) {
      if (!n.name || n.name === current) continue;
      if (seen.has(n.name)) continue;
      seen.add(n.name);
      former.push(n.name);
    }
    out[mid] = former;
  }
  return out;
}

/**
 * API 拉取关注列表并写入本地昵称历史
 * @param {{ selfMid?: string, onProgress?: Function, speed?: 'fast'|'slow' }} options
 */
export async function syncFollowings(options) {
  const opts = options || {};
  let selfMid = String(opts.selfMid || '').trim();
  if (!selfMid) {
    selfMid = await getSelfMid();
  }
  const list = await fetchAllFollowings(selfMid, opts.onProgress, {
    speed: opts.speed
  });
  let changed = 0;
  const now = Date.now();
  for (let i = 0; i < list.length; i++) {
    const u = list[i];
    if (!u || !u.mid || String(u.mid) === selfMid) continue;
    const result = await recordName(u.mid, u.name, now, {
      mtime: u.mtime || 0,
      sign: u.sign || ''
    });
    if (result.changed) changed += 1;
  }
  return {
    selfMid: selfMid,
    total: list.length,
    changed: changed,
    speed: opts.speed || 'slow'
  };
}
