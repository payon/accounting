/**
 * The company file, in memory.
 *
 * Records live in Maps by collection. Everything derived from them (the
 * ledger, open balances, statuses, sorted lists, the search index) is built
 * lazily and cached against `version`, which every change bumps. Views ask
 * for what they need; nothing is recomputed until someone asks again after a
 * change, and nothing is recomputed twice for the same version.
 */
import { newId } from './ids.js';
import { defaultAccounts, sortChart, typeInfo, accountLabel, descendantIds, ROLES } from './accounts.js';
import { TXN_TYPES, txnTotal, validateTxn, docStatus, TERMS, salesTotals, postings as postingsOf, primaryAccountId, withSnapshots, withoutSnapshots, freezeOldValues } from './txn.js';
import { Ledger } from './ledger.js';
import { today } from './dates.js';
import { sum } from './money.js';

export const COLLECTIONS = {
  accounts: 'a',
  contacts: 'c',
  items: 'i',
  txns: 't',
  bankLines: 'b',
  rules: 'r',
  recurring: 'p',
  taxRates: 'x',
  recons: 'n',
};

const PREFIX_TO_COLLECTION = Object.fromEntries(Object.entries(COLLECTIONS).map(([k, v]) => [v, k]));

export const DEFAULT_SETTINGS = {
  company: { name: '', legalName: '', email: '', phone: '', website: '', taxId: '', address: { line1: '', line2: '', city: '', state: '', zip: '', country: '' } },
  currency: 'USD',
  dateStyle: 'mdy',
  fiscalStartMonth: 1,
  closeDate: null,
  defaultTerms: 'net30',
  terms: TERMS,
  paymentsToUndeposited: false,
  accountingMethod: 'accrual',
  showAccountNumbers: true,
  theme: 'system',
  invoiceStart: 1001,
  invoiceMessage: '거래에 감사드립니다.',
  favoriteReports: ['pnl', 'bs', 'arAging'],
  onboarded: false,
};

function mergeDefaults(defaults, saved) {
  const out = structuredClone(defaults);
  for (const [k, v] of Object.entries(saved || {})) {
    const isGroup = v && typeof v === 'object' && !Array.isArray(v) && out[k] && typeof out[k] === 'object' && !Array.isArray(out[k]);
    out[k] = isGroup ? mergeDefaults(out[k], v) : v;
  }
  return out;
}

export class Store {
  constructor() {
    this.version = 0;
    this.listeners = new Set();
    this.sync = null;
    this.user = null;
    this.readOnly = false;
    this.clock = () => today();
    this.reset();
  }

  reset() {
    for (const name of Object.keys(COLLECTIONS)) this[name] = new Map();
    this.settings = structuredClone(DEFAULT_SETTINGS);
    this._cache = new Map();
    this.version++;
  }

  on(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(detail = {}) {
    this.version++;
    this._cache.clear();
    for (const fn of this.listeners) fn(detail);
  }

  /** Memoize a derived value for the current version. */
  memo(key, build) {
    if (this._cache.has(key)) return this._cache.get(key);
    const value = build();
    this._cache.set(key, value);
    return value;
  }

  // ---------------------------------------------------------------- loading

  /** Replace all state from a Map of KV key -> value. */
  loadRecords(records) {
    this.reset();
    for (const [key, value] of records) this._applyRecord(key, value);
    this.emit({ loaded: true });
  }

  /** Apply remote changes ([[key, value|undefined]]) without re-persisting them. */
  applyChanges(changes) {
    if (!changes.length) return;
    const touched = new Set();
    for (const [key, value] of changes) touched.add(this._applyRecord(key, value));
    this.emit({ remote: true, collections: touched });
  }

  _applyRecord(key, value) {
    if (key === 'settings') {
      this.settings = mergeDefaults(DEFAULT_SETTINGS, value || {});
      return 'settings';
    }
    const at = key.indexOf(':');
    const collection = PREFIX_TO_COLLECTION[key.slice(0, at)];
    if (!collection) return null;
    const id = key.slice(at + 1);
    if (value === undefined || value === null) this[collection].delete(id);
    else this[collection].set(id, value);
    return collection;
  }

  // ------------------------------------------------------------ persistence

  _persist(collection, record) {
    if (this.sync) this.sync.put(`${COLLECTIONS[collection]}:${record.id}`, record);
  }

  _unpersist(collection, id) {
    if (this.sync) this.sync.del(`${COLLECTIONS[collection]}:${id}`);
  }

  _guard() {
    if (this.readOnly) throw new Error('오프라인 상태이며 이 사본은 읽기 전용입니다.');
  }

  /** Generic upsert used by every collection. */
  put(collection, record, { silent = false } = {}) {
    this._guard();
    const now = Date.now();
    const existing = record.id ? this[collection].get(record.id) : null;
    // Changing a tax rate or an item's accounts must not move past documents.
    if (existing && collection === 'taxRates' && (existing.rate || 0) !== (record.rate || 0)) this._freeze({ oldTaxRate: existing });
    if (existing && collection === 'items' && (existing.incomeAccountId !== record.incomeAccountId || existing.expenseAccountId !== record.expenseAccountId)) this._freeze({ oldItem: existing });
    const next = { ...record, id: record.id || newId(now), createdAt: existing?.createdAt || record.createdAt || now, updatedAt: now };
    this[collection].set(next.id, next);
    this._persist(collection, next);
    if (!silent) this.emit({ collections: new Set([collection]), id: next.id });
    return next;
  }

  _freeze(old) {
    for (const t of freezeOldValues(this.txns.values(), this.ctx(), old)) this.put('txns', t, { silent: true });
  }

  remove(collection, id, { silent = false } = {}) {
    this._guard();
    if (!this[collection].has(id)) return;
    this[collection].delete(id);
    this._unpersist(collection, id);
    if (!silent) this.emit({ collections: new Set([collection]), id });
  }

  /** Several writes, one change event. */
  batch(fn) {
    const touched = new Set();
    const put = (c, r) => { touched.add(c); return this.put(c, r, { silent: true }); };
    const remove = (c, id) => { touched.add(c); this.remove(c, id, { silent: true }); };
    const result = fn({ put, remove });
    this.emit({ collections: touched });
    return result;
  }

  saveSettings(patch) {
    this._guard();
    this.settings = mergeDefaults(this.settings, patch);
    if (this.sync) this.sync.put('settings', this.settings);
    this.emit({ collections: new Set(['settings']) });
  }

  // --------------------------------------------------------- new company

  /** Seed the chart of accounts and defaults for a brand-new company. */
  createCompany({ name, currency = 'USD', fiscalStartMonth = 1, dateStyle = 'mdy' } = {}) {
    this.batch(({ put }) => {
      if (!this.accounts.size) for (const a of defaultAccounts(() => newId())) put('accounts', a);
      if (!this.taxRates.size) put('taxRates', { name: '부가세', rate: 0, agency: '', active: true });
    });
    this.saveSettings({ company: { name: name || '내 회사' }, currency, fiscalStartMonth, dateStyle, onboarded: true });
  }

  // ------------------------------------------------------------- accounts

  /** Role -> account id, creating any missing system account on demand. */
  roleMap() {
    return this.memo('roles', () => {
      const m = new Map();
      for (const a of this.accounts.values()) if (a.role && !m.has(a.role)) m.set(a.role, a.id);
      return m;
    });
  }

  roleAccount(role) {
    let id = this.roleMap().get(role);
    if (!id && !this.readOnly && ROLES[role]) {
      const types = { ar: 'ar', ap: 'ap', undeposited: 'otherCurrentAsset', salesTax: 'otherCurrentLiability', openingBalance: 'equity', retainedEarnings: 'equity', inventory: 'otherCurrentAsset', cogs: 'cogs', sales: 'income', uncategorizedIncome: 'income', uncategorizedExpense: 'expense', uncategorizedAsset: 'otherCurrentAsset', reconDiscrepancy: 'otherExpense', discounts: 'income' };
      const created = this.put('accounts', { name: ROLES[role], type: types[role] || 'expense', role, number: '', active: true, parentId: null, description: '' }, { silent: true });
      for (const k of ['roles', 'chart:false', 'chart:true']) this._cache.delete(k);
      id = created.id;
    }
    return id;
  }

  account(id) {
    return this.accounts.get(id) || null;
  }

  chart({ includeInactive = false } = {}) {
    return this.memo(`chart:${includeInactive}`, () =>
      sortChart([...this.accounts.values()].filter((a) => includeInactive || a.active !== false)));
  }

  accountName(id, opts) {
    const a = this.accounts.get(id);
    if (!a) return '';
    return accountLabel(a, this.accounts, { withNumber: this.settings.showAccountNumbers !== false, ...opts });
  }

  accountsOfType(...types) {
    return this.chart().map((r) => r.account).filter((a) => types.includes(a.type));
  }

  saveAccount(a) {
    if (!a.name?.trim()) throw new Error('계정 이름을 입력하세요.');
    if (!typeInfo(a.type)) throw new Error('계정 유형을 선택하세요.');
    const dup = [...this.accounts.values()].find((x) => x.id !== a.id && x.name.trim().toLowerCase() === a.name.trim().toLowerCase() && (x.parentId || null) === (a.parentId || null));
    if (dup) throw new Error('같은 이름의 다른 계정이 있습니다.');
    if (a.parentId) {
      if (a.parentId === a.id) throw new Error('계정은 자기 자신을 상위 계정으로 가질 수 없습니다.');
      if (a.id && descendantIds(a.id, [...this.accounts.values()]).has(a.parentId)) throw new Error('자기 하위 계정의 하위 계정이 될 수는 없습니다.');
      const parent = this.accounts.get(a.parentId);
      if (parent && typeInfo(parent.type).cls !== typeInfo(a.type).cls) throw new Error('하위 계정은 상위 계정과 같은 유형이어야 합니다.');
    }
    return this.put('accounts', { active: true, parentId: null, role: null, ...a, name: a.name.trim() });
  }

  /** Accounts in use by a transaction, a recurring template, a rule, an item, or a sub-account cannot be deleted, only made inactive. */
  accountInUse(id) {
    if (this.ledger('accrual').accountIndex.has(id) && this.ledger('accrual').sumAccount(id) !== 0) return true;
    const refers = (t) => !!t && (t.accountId === id || t.depositToId === id || t.fromId === id || t.toId === id || t.ccAccountId === id || t.bankAccountId === id || t.cashBackAccountId === id
      || (t.lines || []).some((l) => l.accountId === id));
    for (const t of this.txns.values()) if (refers(t)) return true;
    for (const r of this.recurring.values()) if (refers(r.template)) return true;
    for (const r of this.rules.values()) if (r.accountIds?.includes(id) || r.set?.categoryId === id || r.set?.transferAccountId === id) return true;
    for (const a of this.accounts.values()) if (a.parentId === id) return true;
    for (const i of this.items.values()) if (i.incomeAccountId === id || i.expenseAccountId === id) return true;
    return false;
  }

  deleteAccount(id) {
    const a = this.accounts.get(id);
    if (!a) return;
    if (a.role) throw new Error('이 계정은 장부에 필요한 계정이라 삭제할 수 없습니다. 이름은 바꿀 수 있습니다.');
    if (this.accountInUse(id)) {
      this.put('accounts', { ...a, active: false });
      return 'inactive';
    }
    this.remove('accounts', id);
    return 'deleted';
  }

  // -------------------------------------------------------------- lookups

  ctx() {
    return this.memo('ctx', () => ({
      role: (r) => this.roleAccount(r),
      item: (id) => this.items.get(id),
      taxRate: (id) => this.taxRates.get(id),
      txn: (id) => this.txns.get(id),
    }));
  }

  ledger(basis = 'accrual') {
    return this.memo(`ledger:${basis}`, () => {
      const ctx = this.ctx();
      return new Ledger([...this.txns.values()], ctx, basis, this.chart({ includeInactive: true }).map((r) => r.account.id));
    });
  }

  /** The postings of one transaction (for split columns and the journal). */
  ledgerPostingsOf(t, basis = 'accrual') {
    return postingsOf(t, basis, this.ctx()).filter((p) => p.accountId && p.amount);
  }

  primaryAccount(t) {
    return primaryAccountId(t, this.ctx());
  }

  /** The account on the other side, or "-분개-" when there are several. */
  splitName(t, primaryId = this.primaryAccount(t)) {
    const others = new Set(this.ledgerPostingsOf(t).map((p) => p.accountId).filter((id) => id !== primaryId));
    if (!others.size) return '';
    if (others.size > 1) return '-분개-';
    return this.accountName([...others][0]);
  }

  /** Balance of an account (including sub-accounts) in its natural sign. */
  accountBalance(id, { asOf = null, includeSubs = true } = {}) {
    const a = this.accounts.get(id);
    if (!a) return 0;
    const ids = includeSubs ? descendantIds(id, [...this.accounts.values()]) : new Set([id]);
    const L = this.ledger('accrual');
    let total = 0;
    if (!asOf) {
      const bal = this.memo('balances', () => L.balancesAsOf(null));
      for (const x of ids) {
        const i = L.accountIndex.get(x);
        if (i !== undefined) total += bal[i];
      }
    } else {
      for (const x of ids) total += L.sumAccount(x, null, asOf);
    }
    return total * typeInfo(a.type).sign;
  }

  // ------------------------------------------------------------- contacts

  contact(id) {
    return this.contacts.get(id) || null;
  }

  contactName(id) {
    return this.contacts.get(id)?.displayName || '';
  }

  contactsOf(kind, { includeInactive = false } = {}) {
    return this.memo(`contacts:${kind}:${includeInactive}`, () =>
      [...this.contacts.values()]
        .filter((c) => (kind === 'any' || c.kind === kind) && (includeInactive || c.active !== false))
        .sort((a, b) => a.displayName.localeCompare(b.displayName)));
  }

  saveContact(c) {
    const displayName = (c.displayName || c.company || [c.firstName, c.lastName].filter(Boolean).join(' ')).trim();
    if (!displayName) throw new Error('표시 이름을 입력하세요.');
    const dup = [...this.contacts.values()].find((x) => x.id !== c.id && x.kind === c.kind && x.displayName.toLowerCase() === displayName.toLowerCase());
    if (dup) throw new Error(`같은 표시 이름을 쓰는 다른 ${c.kind === 'vendor' ? '공급처' : '고객'}이 있습니다.`);
    return this.put('contacts', { active: true, ...c, displayName });
  }

  contactInUse(id) {
    for (const t of this.txns.values()) {
      if (t.contactId === id) return true;
      if ((t.lines || []).some((l) => l.contactId === id || l.customerId === id)) return true;
    }
    return false;
  }

  deleteContact(id) {
    const c = this.contacts.get(id);
    if (!c) return;
    if (this.contactInUse(id)) {
      this.put('contacts', { ...c, active: false });
      return 'inactive';
    }
    this.remove('contacts', id);
    return 'deleted';
  }

  /** Open A/R (customer) or A/P (vendor) balance, from the ledger. */
  contactBalances(kind) {
    return this.memo(`contactBalances:${kind}`, () => {
      const L = this.ledger('accrual');
      const target = this.roleMap().get(kind === 'vendor' ? 'ap' : 'ar');
      const idx = L.accountIndex.get(target);
      const m = new Map();
      if (idx === undefined) return m;
      const list = L.byAccount(idx);
      for (let k = 0; k < list.length; k++) {
        const i = list[k];
        const c = L.contact[i];
        if (c < 0) continue;
        const id = L.contactIds[c];
        m.set(id, (m.get(id) || 0) + L.amt[i]);
      }
      if (kind === 'vendor') for (const [id, v] of m) m.set(id, -v);
      return m;
    });
  }

  // ----------------------------------------------------------------- items

  item(id) {
    return this.items.get(id) || null;
  }

  itemsList({ includeInactive = false } = {}) {
    return this.memo(`items:${includeInactive}`, () =>
      [...this.items.values()].filter((i) => includeInactive || i.active !== false).sort((a, b) => a.name.localeCompare(b.name)));
  }

  saveItem(item) {
    if (!item.name?.trim()) throw new Error('이름을 입력하세요.');
    const dup = [...this.items.values()].find((x) => x.id !== item.id && x.name.toLowerCase() === item.name.trim().toLowerCase());
    if (dup) throw new Error('같은 이름의 다른 상품이나 서비스가 있습니다.');
    return this.put('items', { active: true, kind: 'service', ...item, name: item.name.trim() });
  }

  // ---------------------------------------------------------- transactions

  txn(id) {
    return this.txns.get(id) || null;
  }

  total(t) {
    return this.docInfo().totals.get(t.id) ?? txnTotal(t, this.ctx());
  }

  /**
   * Totals, applications, open balances and statuses for every transaction,
   * computed in one pass per version.
   */
  docInfo() {
    return this.memo('docInfo', () => {
      const ctx = this.ctx();
      const totals = new Map();
      const appliedTo = new Map(); // invoice/bill id -> amount settled
      const appliedFrom = new Map(); // payment/credit id -> amount used
      const links = new Map(); // doc id -> [{ txnId, amount }] settling it
      const deposited = new Map(); // payment/receipt id -> deposit id
      for (const t of this.txns.values()) {
        totals.set(t.id, t.voided ? 0 : txnTotal(t, ctx));
        if (t.voided) continue;
        if (t.applied) {
          let used = 0;
          for (const a of t.applied) {
            const amt = Math.round(a.amount || 0);
            if (!amt || !this.txns.has(a.txnId)) continue;
            used += amt;
            appliedTo.set(a.txnId, (appliedTo.get(a.txnId) || 0) + amt);
            if (!links.has(a.txnId)) links.set(a.txnId, []);
            links.get(a.txnId).push({ txnId: t.id, amount: amt });
          }
          appliedFrom.set(t.id, used);
        }
        if (t.type === 'deposit') for (const l of t.lines || []) if (l.paymentId) deposited.set(l.paymentId, t.id);
      }
      const open = new Map();
      for (const t of this.txns.values()) {
        const total = totals.get(t.id);
        switch (t.type) {
          case 'invoice': case 'bill':
            open.set(t.id, t.voided ? 0 : total - (appliedTo.get(t.id) || 0));
            break;
          case 'payment': case 'billPayment': case 'creditMemo': case 'vendorCredit':
            open.set(t.id, t.voided ? 0 : total - (appliedFrom.get(t.id) || 0));
            break;
          default:
        }
      }
      return { totals, open, links, deposited };
    });
  }

  openBalance(id) {
    return this.docInfo().open.get(id) ?? 0;
  }

  status(t) {
    const info = this.docInfo();
    const withTotal = { ...t, _total: info.totals.get(t.id) ?? 0 };
    if (t.type === 'payment') {
      const depTo = t.depositToId || this.roleMap().get('undeposited');
      withTotal._deposited = depTo !== this.roleMap().get('undeposited') || info.deposited.has(t.id);
    }
    return docStatus(withTotal, info.open.get(t.id) ?? 0, this.clock());
  }

  /** Transactions sorted newest first, optionally filtered. */
  txnList(filter) {
    const all = this.memo('txnsSorted', () =>
      [...this.txns.values()].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || 0) - (a.createdAt || 0))));
    return filter ? all.filter(filter) : all;
  }

  /** The next document number for a numbered type ("1001", "1002", ...). */
  nextNumber(type) {
    let max = 0;
    let found = false;
    for (const t of this.txns.values()) {
      if (t.type !== type || !t.num) continue;
      const n = parseInt(String(t.num).replace(/^\D+/, ''), 10);
      if (Number.isFinite(n)) { max = Math.max(max, n); found = true; }
    }
    if (!found) return type === 'invoice' ? String(this.settings.invoiceStart || 1001) : type === 'journal' ? '1' : type === 'estimate' ? '1001' : '1001';
    return String(max + 1);
  }

  isLocked(date) {
    return !!(this.settings.closeDate && date && date <= this.settings.closeDate);
  }

  /**
   * Validate and save a transaction. Applications are checked against the
   * open balances they draw on, so a payment cannot settle more of an
   * invoice than is left on it.
   */
  /** Throw if saving would be refused, without saving. */
  assertTxn(t, opts) {
    const errors = this.checkTxn(t, opts);
    if (errors.length) {
      const err = new Error(errors[0]);
      err.errors = errors;
      throw err;
    }
  }

  saveTxn(t, opts = {}) {
    this.assertTxn(t, opts);
    // A new transaction takes today's tax rate and item accounts; an edited
    // one keeps those it was saved with.
    const clean = withSnapshots({ ...t }, this.ctx(), { fresh: !(t.id && this.txns.has(t.id)) });
    for (const k of Object.keys(clean)) if (k.startsWith('_')) delete clean[k];
    if (clean.applied) clean.applied = clean.applied.filter((a) => Math.round(a.amount || 0) !== 0);
    return this.put('txns', clean);
  }

  /** Every reason saving this transaction would be refused. */
  checkTxn(t, { allowLocked = false } = {}) {
    const errors = validateTxn(t, this.ctx());
    const prev = t.id ? this.txns.get(t.id) : null;
    // Postings to an account that no longer exists would drop out of every report.
    if (postingsOf(t, 'accrual', this.ctx()).some((p) => p.accountId && p.amount && !this.accounts.has(p.accountId))) {
      errors.push('이 거래의 계정 하나가 삭제되었습니다. 다른 계정을 선택하세요.');
    }
    if (!allowLocked && (this.isLocked(t.date) || (prev && this.isLocked(prev.date))) && !this._onlyAppliesCredit(t, prev)) {
      errors.push(`장부가 ${this.settings.closeDate}까지 마감되어 있습니다. 설정에서 마감일을 변경한 후 이 기간을 편집할 수 있습니다.`);
    }
    if (t.applied) {
      const info = this.docInfo();
      // Several entries for the same document count together.
      const wanted = new Map();
      for (const a of t.applied) wanted.set(a.txnId, (wanted.get(a.txnId) || 0) + Math.round(a.amount || 0));
      for (const [txnId, amount] of wanted) {
        const target = this.txns.get(txnId);
        if (!target) continue;
        const already = (info.links.get(txnId) || []).filter((l) => l.txnId !== t.id).reduce((s, l) => s + l.amount, 0);
        const available = (info.totals.get(txnId) || 0) - already;
        if (amount > available) errors.push(`${TXN_TYPES[target.type].label} ${target.num || ''}의 미결 잔액을 초과하여 적용되었습니다.`.replace(' .', '.'));
      }
      // Money and credits settle documents of their own customer or vendor.
      if (!prev || prev.contactId !== t.contactId) {
        const other = [...wanted].map(([txnId, amount]) => amount && this.txns.get(txnId)).find((d) => d && d.contactId !== t.contactId);
        if (other) {
          const doc = [TXN_TYPES[other.type].label, other.num].filter(Boolean).join(' ').trim();
          errors.push(`이 건은 다른 ${TXN_TYPES[t.type].side === 'purchases' ? '공급처' : '고객'}의 ${doc}에 적용되어 있습니다. 먼저 적용을 해제하세요.`);
        }
      }
      // A credit cannot give away more than it is worth.
      if (t.type === 'creditMemo' || t.type === 'vendorCredit') {
        const used = t.applied.reduce((s, a) => s + Math.round(a.amount || 0), 0);
        if (used > txnTotal(t, this.ctx())) errors.push('크레딧의 가치 이상을 적용했습니다.');
      }
    }
    // A deposited payment's deposit line carries its amount out of Undeposited Funds.
    if (prev && !prev.voided && (t.type === 'payment' || t.type === 'salesReceipt') && this.docInfo().deposited.has(t.id)) {
      const undep = this.roleMap().get('undeposited');
      if (txnTotal(t, this.ctx()) !== txnTotal(prev, this.ctx()) || (t.depositToId || undep) !== (prev.depositToId || undep)) {
        errors.push(`이 ${TXN_TYPES[t.type].label}은(는) 예금에 포함되어 있습니다. 금액이나 계정을 변경하기 전에 예금에서 제거하세요.`);
      }
    }
    // A document cannot shrink below what has already been paid or credited on it.
    if (prev && ['invoice', 'bill'].includes(t.type)) {
      const settled = (this.docInfo().links.get(t.id) || []).reduce((s, l) => s + l.amount, 0);
      if (settled && prev.contactId !== t.contactId) {
        errors.push(`결제 또는 크레딧이 이 ${TXN_TYPES[t.type].label}에 적용되어 있습니다. ${t.type === 'bill' ? '공급처' : '고객'}을(를) 변경하기 전에 먼저 적용을 해제하세요.`);
      }
      if (settled > txnTotal(t, this.ctx())) {
        errors.push(`이미 ${(settled / 100).toFixed(2)}의 결제가 이 ${TXN_TYPES[t.type].label}에 적용되어 있습니다. 합계를 낮추기 전에 먼저 적용을 해제하세요.`);
      }
    }
    return errors;
  }

  /**
   * A credit memo or vendor credit from a closed period may still be applied
   * to (or taken off) documents in the open period: nothing it posts depends
   * on where it is applied, on either basis, so the closed period's reports
   * do not move. Everything else about it stays as it was.
   */
  _onlyAppliesCredit(t, prev) {
    if (!prev || (t.type !== 'creditMemo' && t.type !== 'vendorCredit') || t.type !== prev.type) return false;
    const strip = (x) => {
      const out = {};
      for (const k of Object.keys(x).sort()) if (k !== 'applied' && k !== 'updatedAt' && !k.startsWith('_')) out[k] = x[k];
      return JSON.stringify(out);
    };
    if (strip(t) !== strip(prev)) return false;
    const change = new Map();
    for (const a of prev.applied || []) change.set(a.txnId, (change.get(a.txnId) || 0) - Math.round(a.amount || 0));
    for (const a of t.applied || []) change.set(a.txnId, (change.get(a.txnId) || 0) + Math.round(a.amount || 0));
    for (const [txnId, v] of change) {
      const target = this.txns.get(txnId);
      if (v && (!target || this.isLocked(target.date))) return false;
    }
    return true;
  }

  /** Deleting or voiding changes the records that point at it; they must be in an open period too. */
  _assertDependentsOpen(id) {
    for (const other of this.txns.values()) {
      if (other.id === id || !this.isLocked(other.date)) continue;
      // A closed-period credit may be taken off an open-period document (see _onlyAppliesCredit).
      const credit = other.type === 'creditMemo' || other.type === 'vendorCredit';
      const refers = (!credit && other.applied?.some((a) => a.txnId === id)) || (other.type === 'deposit' && other.lines?.some((l) => l.paymentId === id));
      if (refers) throw new Error(`마감 기간(${this.settings.closeDate}까지)의 ${TXN_TYPES[other.type].label}이 이 거래에 의존하고 있습니다.`);
    }
  }

  /** Remove a transaction and every application that points at it. */
  deleteTxn(id, { allowLocked = false } = {}) {
    const t = this.txns.get(id);
    if (!t) return;
    if (!allowLocked && this.isLocked(t.date)) throw new Error(`장부가 ${this.settings.closeDate}까지 마감되어 있습니다.`);
    if (!allowLocked) this._assertDependentsOpen(id);
    // Everything this changes is returned as it was, so Undo restores all of it.
    const before = { txns: [structuredClone(t)], bankLines: [] };
    this.batch(({ put, remove }) => {
      for (const other of this.txns.values()) {
        if (other.id === id) continue;
        let changed = false;
        let next = other;
        if (other.applied?.some((a) => a.txnId === id)) {
          next = { ...next, applied: other.applied.filter((a) => a.txnId !== id) };
          changed = true;
        }
        if (other.type === 'deposit' && other.lines?.some((l) => l.paymentId === id)) {
          next = { ...next, lines: other.lines.filter((l) => l.paymentId !== id) };
          changed = true;
        }
        if (other.estimateId === id) { next = { ...next, estimateId: null }; changed = true; }
        if (changed) { before.txns.push(structuredClone(other)); put('txns', next); }
      }
      for (const line of this.bankLines.values()) {
        if (line.txnId === id) { before.bankLines.push(structuredClone(line)); put('bankLines', { ...line, txnId: null, status: 'review' }); }
      }
      remove('txns', id);
    });
    return before;
  }

  /** Put back what deleteTxn() returned. */
  restore(before) {
    this.batch(({ put }) => {
      for (const t of before.txns || []) put('txns', t);
      for (const l of before.bankLines || []) put('bankLines', l);
    });
  }

  /** Void: keep the record and its number, zero its effect on the books. */
  voidTxn(id) {
    const t = this.txns.get(id);
    if (!t) return;
    if (this.isLocked(t.date)) throw new Error(`The books are closed through ${this.settings.closeDate}.`);
    this._assertDependentsOpen(id);
    this.batch(({ put }) => {
      for (const other of this.txns.values()) {
        let next = other;
        if (other.applied?.some((a) => a.txnId === id)) next = { ...next, applied: other.applied.filter((a) => a.txnId !== id) };
        // A voided payment leaves its deposit, as a deleted one does.
        if (other.type === 'deposit' && other.lines?.some((l) => l.paymentId === id)) next = { ...next, lines: other.lines.filter((l) => l.paymentId !== id) };
        if (next !== other) put('txns', next);
      }
      put('txns', { ...t, voided: true, applied: [], memo: `취소됨${t.memo ? `: ${t.memo}` : ''}` });
    });
  }

  /** Copy a transaction into a new unsaved draft (no id, today's date, next number). */
  duplicateTxn(id) {
    const t = this.txns.get(id);
    if (!t) return null;
    const copy = withoutSnapshots(structuredClone(t));
    delete copy.id;
    delete copy.createdAt;
    delete copy.updatedAt;
    delete copy.voided;
    delete copy.attachments;
    copy.applied = copy.applied ? [] : undefined;
    copy.date = this.clock();
    if (TXN_TYPES[t.type].numbered) copy.num = this.nextNumber(t.type);
    return copy;
  }

  // ------------------------------------------------------------- reconcile

  /** Txn ids reconciled for an account: union of its finished reconciliations. */
  reconciledIds(accountId) {
    return this.memo(`reconciled:${accountId}`, () => {
      const set = new Set();
      for (const r of this.recons.values()) {
        if (r.accountId === accountId && r.status === 'done') for (const id of r.clearedIds || []) set.add(id);
      }
      return set;
    });
  }

  /** Txn ids cleared in the bank feed for an account (matched or added). */
  clearedIds(accountId) {
    return this.memo(`cleared:${accountId}`, () => {
      const set = new Set();
      for (const l of this.bankLines.values()) if (l.accountId === accountId && l.txnId && l.status === 'added') set.add(l.txnId);
      return set;
    });
  }

  reconcileStatus(txnId, accountId) {
    if (this.reconciledIds(accountId).has(txnId)) return 'R';
    if (this.clearedIds(accountId).has(txnId)) return 'C';
    return '';
  }

  // ------------------------------------------------------------- tax rates

  taxRateList({ includeInactive = false } = {}) {
    return [...this.taxRates.values()].filter((r) => includeInactive || r.active !== false).sort((a, b) => a.name.localeCompare(b.name));
  }

  // ---------------------------------------------------------------- totals

  salesTotals(doc) {
    return salesTotals(doc, this.ctx());
  }

  /** Quick numbers for the home page. */
  summary() {
    // Keyed by the date too: what is overdue changes at midnight even when
    // nothing in the books does.
    const now = this.clock();
    return this.memo(`summary:${now}`, () => {
      const info = this.docInfo();
      let openInvoices = 0; let overdueInvoices = 0; let openCount = 0; let overdueCount = 0;
      let openBills = 0; let overdueBills = 0; let billCount = 0; let overdueBillCount = 0;
      let notDeposited = 0; let notDepositedCount = 0;
      const undep = this.roleMap().get('undeposited');
      for (const t of this.txns.values()) {
        if (t.voided) continue;
        const open = info.open.get(t.id) || 0;
        if (t.type === 'invoice' && open > 0) {
          openInvoices += open; openCount++;
          if (t.dueDate && t.dueDate < now) { overdueInvoices += open; overdueCount++; }
        } else if (t.type === 'bill' && open > 0) {
          openBills += open; billCount++;
          if (t.dueDate && t.dueDate < now) { overdueBills += open; overdueBillCount++; }
        } else if ((t.type === 'payment' || t.type === 'salesReceipt') && (t.depositToId || undep) === undep && !info.deposited.has(t.id)) {
          notDeposited += info.totals.get(t.id) || 0; notDepositedCount++;
        }
      }
      return { openInvoices, overdueInvoices, openCount, overdueCount, openBills, overdueBills, billCount, overdueBillCount, notDeposited, notDepositedCount };
    });
  }

  /** Undeposited payments and receipts available to a deposit. */
  undepositedItems(exceptDepositId) {
    const info = this.docInfo();
    const undep = this.roleMap().get('undeposited');
    const out = [];
    for (const t of this.txns.values()) {
      if (t.voided) continue;
      if (t.type !== 'payment' && t.type !== 'salesReceipt') continue;
      if ((t.depositToId || undep) !== undep) continue;
      const dep = info.deposited.get(t.id);
      if (dep && dep !== exceptDepositId) continue;
      out.push(t);
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }

  /** Open invoices for a customer (or open bills for a vendor), oldest first. */
  openDocs(contactId, type, exceptTxnId) {
    const info = this.docInfo();
    const out = [];
    for (const t of this.txns.values()) {
      if (t.type !== type || t.contactId !== contactId || t.voided) continue;
      const settledByThis = (info.links.get(t.id) || []).filter((l) => l.txnId === exceptTxnId).reduce((s, l) => s + l.amount, 0);
      const open = (info.open.get(t.id) || 0) + settledByThis;
      if (open > 0 || settledByThis > 0) out.push({ txn: t, open, settledByThis, total: info.totals.get(t.id) || 0 });
    }
    return out.sort((a, b) => (a.txn.dueDate || a.txn.date).localeCompare(b.txn.dueDate || b.txn.date));
  }

  /** Unapplied credits (credit memos or vendor credits) for a contact. */
  openCredits(contactId, type, exceptTxnId) {
    return this.openDocs(contactId, type, exceptTxnId);
  }

  stats() {
    return {
      accounts: this.accounts.size,
      contacts: this.contacts.size,
      items: this.items.size,
      txns: this.txns.size,
      postings: this.ledger().size,
      imbalance: this.ledger().imbalance(),
      total: sum([...this.txns.values()], (t) => this.total(t)),
    };
  }
}

export const store = new Store();
