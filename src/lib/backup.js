/**
 * Whole-company backup as one JSON document, and restore from one. A backup
 * is validated completely before anything is written, so a damaged file
 * never leaves the books half-replaced.
 */
import { COLLECTIONS } from './store.js';
import { TXN_TYPES } from './txn.js';
import { ACCOUNT_TYPES } from './accounts.js';

export const BACKUP_FORMAT = 'payon-acc-backup';

export function exportBackup(store) {
  const collections = {};
  for (const name of Object.keys(COLLECTIONS)) collections[name] = [...store[name].values()];
  return { format: BACKUP_FORMAT, version: 1, exportedAt: new Date().toISOString(), settings: store.settings, collections };
}

/** Throws with a readable message when the backup cannot be restored. */
export function validateBackup(data) {
  if (!data || typeof data !== 'object') throw new Error('이 파일은 백업 파일이 아닙니다.');
  if (data.format !== BACKUP_FORMAT) throw new Error('이 파일은 Payon 백업 파일이 아닙니다.');
  if (data.version !== 1) throw new Error(`지원하지 않는 백업 버전입니다: ${data.version}.`);
  const c = data.collections || {};
  for (const name of Object.keys(c)) {
    if (!COLLECTIONS[name]) throw new Error(`백업에 알 수 없는 섹션이 있습니다: ${name}.`);
    if (!Array.isArray(c[name])) throw new Error(`백업의 ${name} 섹션이 손상되었습니다.`);
    for (const r of c[name]) if (!r || typeof r.id !== 'string' || !r.id || r.id.includes(':')) throw new Error(`${name} 안의 레코드에 유효한 id가 없습니다.`);
  }
  for (const a of c.accounts || []) if (!ACCOUNT_TYPES[a.type]) throw new Error(`계정 ${a.name}에 알 수 없는 유형이 있습니다.`);
  for (const t of c.txns || []) if (!TXN_TYPES[t.type]) throw new Error(`알 수 없는 거래 유형: ${t.type}.`);
  return true;
}

export function restoreBackup(store, data) {
  validateBackup(data);
  store.batch(({ put, remove }) => {
    for (const name of Object.keys(COLLECTIONS)) for (const id of [...store[name].keys()]) remove(name, id);
    for (const [name, list] of Object.entries(data.collections || {})) for (const r of list) put(name, r);
  });
  store.saveSettings(data.settings || {});
}

/** Remove every record (used by "모든 데이터 초기화"). */
export function eraseAll(store) {
  store.batch(({ remove }) => {
    for (const name of Object.keys(COLLECTIONS)) for (const id of [...store[name].keys()]) remove(name, id);
  });
}
