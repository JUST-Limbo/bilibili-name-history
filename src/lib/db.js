const DB_NAME = 'bili-name-history';
const DB_VERSION = 1;
const STORE = 'users';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'mid' });
      }
    };
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('aborted'));
  });
}

export async function getUser(mid) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(String(mid));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function deleteUser(mid) {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).delete(String(mid));
  await txDone(tx);
}

/** Clear all nickname history records */
export async function clearAllUsers() {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  tx.objectStore(STORE).clear();
  await txDone(tx);
}

export async function getUsers(mids) {
  const db = await openDb();
  const out = {};
  await Promise.all(
    mids.map(
      (mid) =>
        new Promise((resolve, reject) => {
          const tx = db.transaction(STORE, 'readonly');
          const req = tx.objectStore(STORE).get(String(mid));
          req.onsuccess = () => {
            if (req.result) out[String(mid)] = req.result;
            resolve();
          };
          req.onerror = () => reject(req.error);
        })
    )
  );
  return out;
}

/**
 * Record a seen nickname. Same name only updates lastSeen.
 * Returns { changed, formerNames, currentName }
 */
export async function recordName(mid, name, seenAt = Date.now()) {
  const id = String(mid);
  const nick = (name || '').trim();
  if (!id || !nick) {
    return { changed: false, formerNames: [], currentName: nick };
  }

  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);

  const existing = await new Promise((resolve, reject) => {
    const req = store.get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });

  let record;
  let changed = false;

  if (!existing) {
    record = {
      mid: id,
      names: [{ name: nick, firstSeen: seenAt, lastSeen: seenAt }],
      updatedAt: seenAt
    };
    changed = true;
  } else {
    record = existing;
    const last = record.names[record.names.length - 1];
    if (last && last.name === nick) {
      last.lastSeen = seenAt;
    } else {
      record.names.push({ name: nick, firstSeen: seenAt, lastSeen: seenAt });
      changed = true;
    }
    record.updatedAt = seenAt;
  }

  store.put(record);
  await txDone(tx);

  const formerNames = record.names.slice(0, -1).map((n) => n.name);
  return {
    changed,
    formerNames,
    currentName: nick,
    names: record.names
  };
}

export async function getFormerNames(mid, currentName) {
  const user = await getUser(mid);
  if (!user || !user.names || user.names.length === 0) {
    return [];
  }
  const current = (currentName || '').trim();
  const seen = new Set();
  const former = [];
  for (const item of user.names) {
    if (!item.name || item.name === current) continue;
    if (seen.has(item.name)) continue;
    seen.add(item.name);
    former.push(item.name);
  }
  return former;
}

export async function getStats() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      let renamed = 0;
      for (const u of all) {
        if (u.names && u.names.length > 1) renamed += 1;
      }
      resolve({
        userCount: all.length,
        renamedCount: renamed
      });
    };
    req.onerror = () => reject(req.error);
  });
}

/** Flatten records for UI list */
export async function listUsers() {
  const db = await openDb();
  const all = await new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const rows = all.map((u) => {
    const names = u.names || [];
    const currentName = names.length ? names[names.length - 1].name : '';
    const formerNames = [];
    const seen = new Set();
    for (let i = 0; i < names.length - 1; i++) {
      const n = names[i].name;
      if (!n || n === currentName || seen.has(n)) continue;
      seen.add(n);
      formerNames.push(n);
    }
    return {
      mid: u.mid,
      currentName: currentName,
      formerNames: formerNames,
      nameCount: names.length,
      updatedAt: u.updatedAt || 0,
      cancelled: currentName === '账号已注销' || currentName === '已注销'
    };
  });

  rows.sort((a, b) => {
    if (a.cancelled !== b.cancelled) return a.cancelled ? -1 : 1;
    if ((b.formerNames.length > 0) !== (a.formerNames.length > 0)) {
      return b.formerNames.length > 0 ? 1 : -1;
    }
    return (b.updatedAt || 0) - (a.updatedAt || 0);
  });

  return rows;
}

export async function exportAll() {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      resolve({
        exportedAt: new Date().toISOString(),
        version: 1,
        users: req.result || []
      });
    };
    req.onerror = () => reject(req.error);
  });
}

export async function importAll(payload, merge = true) {
  const users = payload && payload.users ? payload.users : [];
  if (!Array.isArray(users)) throw new Error('invalid import');
  const db = await openDb();

  for (const raw of users) {
    if (!raw || !raw.mid || !Array.isArray(raw.names)) continue;
    const mid = String(raw.mid);

    if (!merge) {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        mid,
        names: raw.names,
        updatedAt: raw.updatedAt || Date.now()
      });
      await txDone(tx);
      continue;
    }

    const existing = await getUser(mid);
    let names;
    if (!existing) {
      names = raw.names;
    } else {
      const map = new Map();
      for (const n of (existing.names || []).concat(raw.names)) {
        const key = n.name;
        if (!map.has(key)) {
          map.set(key, Object.assign({}, n));
        } else {
          const cur = map.get(key);
          cur.firstSeen = Math.min(cur.firstSeen || n.firstSeen, n.firstSeen || cur.firstSeen);
          cur.lastSeen = Math.max(cur.lastSeen || 0, n.lastSeen || 0);
        }
      }
      names = Array.from(map.values()).sort(
        (a, b) => (a.firstSeen || 0) - (b.firstSeen || 0)
      );
    }

    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ mid, names, updatedAt: Date.now() });
    await txDone(tx);
  }
}
