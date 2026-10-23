import { describe, it, expect } from 'vitest';
import { makeBooks } from './helpers/books.js';
import { search } from '../src/lib/search.js';
import { validateTxn } from '../src/lib/txn.js';

describe('search', () => {
  it('finds transactions by number, name, and amount, plus contacts and reports', () => {
    const { s, customer, service } = makeBooks();
    s.saveTxn({ type: 'invoice', num: '1042', date: '2026-06-01', contactId: customer.id, lines: [{ itemId: service.id, qty: 1, rate: 12345 }] });
    const byNum = search(s, '1042');
    expect(byNum.find((g) => g.group === '거래').items[0].label).toBe('청구서 1042');
    const byAmount = search(s, '123.45');
    expect(byAmount.find((g) => g.group === '거래').items.length).toBe(1);
    const byName = search(s, 'acme');
    expect(byName.some((g) => g.group === '거래처')).toBe(true);
    expect(search(s, '재무상태표').find((g) => g.group === '보고서').items[0].route).toBe('report/bs');
    expect(search(s, '새 청구서').find((g) => g.group === '만들기').items[0].route).toBe('new/invoice');
    expect(search(s, '')).toEqual([]);
  });
});

describe('validation', () => {
  it('asks for what each type needs', () => {
    expect(validateTxn({ type: 'invoice', date: '2026-01-01', lines: [] })).toEqual(expect.arrayContaining(['고객을 선택하세요.', '최소 한 줄을 추가하세요.']));
    expect(validateTxn({ type: 'expense', date: '2026-01-01', lines: [{ amount: 100 }] })).toEqual(expect.arrayContaining(['지급할 계좌를 선택하세요.', '금액이 있는 모든 줄에 계정을 선택하세요.']));
    expect(validateTxn({ type: 'transfer', date: '2026-01-01', fromId: 'a', toId: 'a', amount: 1 })).toContain('서로 다른 두 계좌 사이의 이체여야 합니다.');
    expect(validateTxn({ type: 'journal', date: '2026-01-01', lines: [{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 90 }] })).toContain('차변과 대변의 합계가 일치해야 합니다.');
    expect(validateTxn({ type: 'journal', date: '2026-01-01', lines: [{ accountId: 'a', debit: 100 }, { accountId: 'b', credit: 100 }] })).toEqual([]);
    expect(validateTxn({ type: 'payment', date: '2026-01-01', contactId: 'c', amount: 50, applied: [{ txnId: 'x', amount: 60 }] })).toContain('적용된 금액의 합이 결제 금액보다 큽니다.');
  });
});
