/** CSV import of customers, vendors, and products/services: pick, map, preview, import. */
import { el, append, clear, pickFile } from '../ui/dom.js';
import { openDialog } from '../ui/dialog.js';
import { toast, toastError } from '../ui/toast.js';
import { store } from '../lib/store.js';
import { parseCSV } from '../lib/csv.js';
import { parseMoney } from '../lib/money.js';

const FIELDS = {
  customers: [['displayName', '표시 이름', ['display name', 'name', 'customer', 'full name']], ['company', '회사', ['company', 'company name', 'business']], ['firstName', '이름', ['first name', 'first']], ['lastName', '성', ['last name', 'last', 'surname']], ['email', '이메일', ['email', 'e-mail']], ['phone', '전화', ['phone', 'telephone']], ['line1', '주소', ['street', 'address', 'address line 1', 'billing address']], ['city', '도시', ['city', 'town']], ['state', '시/도', ['state', 'province', 'region']], ['zip', '우편번호', ['zip', 'postal code', 'postcode', 'zip code']], ['country', '국가', ['country']], ['notes', '메모', ['notes', 'note', 'memo']]],
  items: [['name', '이름', ['name', 'product', 'service', 'item', 'product/service']], ['sku', 'SKU', ['sku', 'code']], ['desc', '설명', ['description', 'sales description']], ['price', '판매가', ['price', 'rate', 'sales price', 'unit price']], ['cost', '원가', ['cost', 'purchase cost']], ['kind', '유형', ['type', 'item type']]],
};
FIELDS.vendors = FIELDS.customers;

export async function openImport(what) {
  const file = await pickFile('.csv,text/csv');
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { toastError('파일 크기가 5 MB를 넘습니다.'); return; }
  const rows = parseCSV(await file.text());
  if (rows.length < 2) { toastError('가져올 행이 없습니다.'); return; }
  const headers = rows[0];
  const fields = FIELDS[what];
  const mapping = {};
  for (const [key, , guesses] of fields) {
    const i = headers.findIndex((h) => guesses.includes(h.toLowerCase().trim()));
    mapping[key] = i;
  }
  const selects = fields.map(([key, label]) => {
    const s = el('select.select', { 'aria-label': `${label} 열` },
      el('option', { value: '-1' }, '가져오지 않음'),
      headers.map((h, i) => el('option', { value: String(i), selected: mapping[key] === i }, h || `${i + 1}열`)));
    s.addEventListener('change', () => { mapping[key] = +s.value; preview(); });
    return el('div.field', {}, el('label.field-label', {}, label), s);
  });
  const previewBox = el('div');
  const plan = () => {
    const out = [];
    const skipped = [];
    const seen = new Set();
    const get = (r, k) => (mapping[k] >= 0 ? (r[mapping[k]] || '').trim() : '');
    rows.slice(1).forEach((r, idx) => {
      if (what === 'items') {
        const name = get(r, 'name');
        if (!name) { skipped.push(`${idx + 2}행: 이름 없음`); return; }
        if (seen.has(name.toLowerCase()) || store.itemsList({ includeInactive: true }).some((i) => i.name.toLowerCase() === name.toLowerCase())) { skipped.push(`${idx + 2}행: ${name}은(는) 이미 있음`); return; }
        seen.add(name.toLowerCase());
        const kindText = get(r, 'kind').toLowerCase();
        out.push({ name, sku: get(r, 'sku'), desc: get(r, 'desc'), price: Math.abs(parseMoney(get(r, 'price'))), cost: Math.abs(parseMoney(get(r, 'cost'))), kind: kindText.includes('non') || kindText.includes('product') ? 'nonInventory' : 'service', incomeAccountId: store.roleAccount('sales'), sold: true, purchased: !!get(r, 'cost') });
      } else {
        const name = get(r, 'displayName') || get(r, 'company') || [get(r, 'firstName'), get(r, 'lastName')].filter(Boolean).join(' ');
        if (!name) { skipped.push(`${idx + 2}행: 이름 없음`); return; }
        const kind = what === 'vendors' ? 'vendor' : 'customer';
        if (seen.has(name.toLowerCase()) || store.contactsOf(kind, { includeInactive: true }).some((c) => c.displayName.toLowerCase() === name.toLowerCase())) { skipped.push(`${idx + 2}행: ${name}은(는) 이미 있음`); return; }
        seen.add(name.toLowerCase());
        out.push({ kind, displayName: name, company: get(r, 'company'), firstName: get(r, 'firstName'), lastName: get(r, 'lastName'), email: get(r, 'email'), phone: get(r, 'phone'), notes: get(r, 'notes'), billAddr: { line1: get(r, 'line1'), city: get(r, 'city'), state: get(r, 'state'), zip: get(r, 'zip'), country: get(r, 'country') }, terms: store.settings.defaultTerms });
      }
    });
    return { out, skipped };
  };
  function preview() {
    const { out, skipped } = plan();
    append(clear(previewBox), [
      el('p', { role: 'status' }, `${out.length}건을 가져올 예정입니다${skipped.length ? `, ${skipped.length}건 건너뜀` : ''}.`),
      skipped.length ? el('details', {}, el('summary', {}, '건너뛴 행'), el('ul', {}, skipped.slice(0, 50).map((s) => el('li', {}, s)))) : null,
      out.length ? el('div.table-wrap', { style: { marginTop: '10px' } }, el('table.grid', {},
        el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, '이름'), el('th', { scope: 'col' }, what === 'items' ? '판매가' : '이메일'))),
        el('tbody', {}, out.slice(0, 8).map((x) => el('tr', {}, el('td', {}, x.displayName || x.name), el('td', {}, what === 'items' ? (x.price / 100).toFixed(2) : x.email || '')))))) : null]);
  }
  preview();
  const label = what === 'items' ? '품목' : what === 'vendors' ? '공급처' : '고객';
  const dlg = openDialog({
    title: `${label} 가져오기`,
    wide: true,
    body: el('div.stack', {}, el('p.field-hint', {}, `${file.name}: ${rows.length - 1}행. 열과 항목을 연결하세요.`), el('div.form-grid', {}, selects), previewBox),
    footer: el('div.end', {}, el('button.btn', { type: 'button', onclick: () => dlg.close() }, '취소'), el('button.btn.btn-primary', {
      type: 'button',
      onclick: () => {
        const { out } = plan();
        if (!out.length) { toastError('가져올 내용이 없습니다.'); return; }
        store.batch(({ put }) => { for (const rec of out) put(what === 'items' ? 'items' : 'contacts', { active: true, ...rec }); });
        toast(`${label} ${out.length}건을 가져왔습니다`);
        dlg.close();
      },
    }, '가져오기')),
  });
}
