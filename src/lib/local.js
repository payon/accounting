/**
 * 로컬 전용 저장소: 로그인 없이 이 브라우저의 IndexedDB(Payon DB)에
 * 장부 데이터를 저장한다. 과거에는 Puter SDK(클라우드 KV + 드라이브)를
 * 사용했지만, 지금은 이 파일이 같은 인터페이스를 로컬로 제공한다.
 *
 *  - kv : 키-값 저장소(Puter KV API와 호환)
 *         get / set(배열 지원) / del / incr / list(pattern, cursor)
 *  - fs : 첨부파일 등 간단한 파일 저장소(Puter 드라이브 API와 호환)
 *         read(path) → Blob, write(path, blob, opts), delete(path)
 */

const DB_NAME = 'payon';
export const LOCAL_USER = { username: 'payon', uuid: 'local', plan: 'free' };

function req(r) {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function txDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const open = globalThis.indexedDB.open(DB_NAME, 1);
      open.onupgradeneeded = () => {
        const d = open.result;
        for (const s of ['kv', 'files']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
      };
      open.onsuccess = () => resolve(open.result);
      open.onerror = () => reject(open.error);
    });
  }
  return dbPromise;
}

function openW(d, store) {
  return d.transaction(store, 'readwrite');
}

/** Puter KV와 같은 모양의 로컬 키-값 저장소. */
export const kv = {
  async get(key) {
    const d = await db();
    const v = await req(d.transaction('kv', 'readonly').objectStore('kv').get(key));
    return v === undefined ? null : v;
  },
  async set(entries) {
    if (!Array.isArray(entries)) entries = [[entries.key, entries.value]];
    const d = await db();
    const tx = openW(d, 'kv');
    const os = tx.objectStore('kv');
    for (const { key, value } of entries) {
      if (value === null || value === undefined) os.delete(key);
      else os.put(value, key);
    }
    await txDone(tx);
  },
  async del(...keys) {
    const d = await db();
    const tx = openW(d, 'kv');
    const os = tx.objectStore('kv');
    for (const k of keys) os.delete(k);
    await txDone(tx);
  },
  async incr(key) {
    const d = await db();
    const n = Number(await req(d.transaction('kv', 'readonly').objectStore('kv').get(key))) || 0;
    const tx = openW(d, 'kv');
    tx.objectStore('kv').put(n + 1, key);
    await txDone(tx);
    return n + 1;
  },
  async list({ pattern, returnValues, limit = 1000, cursor }) {
    const prefix = String(pattern || '').replace(/[*].*$/, '');
    const d = await db();
    const os = d.transaction('kv', 'readonly').objectStore('kv');
    const [keys, values] = await Promise.all([req(os.getAllKeys()), req(os.getAll())]);
    const items = keys
      .map((k, i) => [String(k), values[i]])
      .filter(([k]) => k.startsWith(prefix))
      .slice(0, limit)
      .map(([key, value]) => (returnValues ? { key, value } : { key }));
    return { items, cursor: null };
  },
};

/** Puter 드라이브와 같은 모양의 로컬 파일 저장소. */
export const fs = {
  async read(path) {
    const d = await db();
    const v = await req(d.transaction('files', 'readonly').objectStore('files').get(path));
    if (v === undefined || v === null) throw new Error(`파일을 찾을 수 없습니다: ${path}`);
    if (v instanceof Blob) return v;
    return new Blob([v]);
  },
  async write(path, value, { dedupeName = false } = {}) {
    let savedPath = path;
    const stored = value instanceof Blob ? value : new Blob([String(value)]);
    const d = await db();
    if (dedupeName) {
      const exists = (await req(d.transaction('files', 'readonly').objectStore('files').get(savedPath))) !== undefined;
      if (exists) {
        const dot = savedPath.lastIndexOf('.');
        const base = dot > -1 ? savedPath.slice(0, dot) : savedPath;
        const ext = dot > -1 ? savedPath.slice(dot) : '';
        for (let i = 1; ; i++) {
          const alt = `${base} (${i})${ext}`;
          const d2 = await db();
          const taken = (await req(d2.transaction('files', 'readonly').objectStore('files').get(alt))) !== undefined;
          if (!taken) { savedPath = alt; break; }
        }
      }
    }
    const tx = openW(d, 'files');
    tx.objectStore('files').put(stored, savedPath);
    await txDone(tx);
    return { path: savedPath };
  },
  async delete(...paths) {
    const d = await db();
    const tx = openW(d, 'files');
    const os = tx.objectStore('files');
    for (const p of paths) os.delete(p);
    await txDone(tx);
  },
};

/** 언제나 로컬이므로 false. 로그아웃 메뉴 표시 여부 등에서 사용된다. */
export function isPuterApp() {
  return false;
}

/** 로그인 없이 이 브라우저 저장소만 사용하는 모드인가? */
export function isLocalMode() {
  return true;
}

/** kv와 files 저장소를 모두 비운다(초기화). */
export async function wipeAll() {
  const d = await db();
  for (const s of ['kv', 'files']) {
    const tx = openW(d, s);
    tx.objectStore(s).clear();
    await txDone(tx);
  }
}
