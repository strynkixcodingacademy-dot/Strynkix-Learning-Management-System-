import { describe, it, expect } from 'vitest';
import { csvCell, toCsv } from '@/lib/export/csv';
import { formatMoney, moneyPlain, toPaise } from '@/lib/academy/format';

describe('CSV export', () => {
  it('neutralizes spreadsheet formulas and quotes every cell', () => {
    expect(csvCell('=HYPERLINK("x")')).toBe('"\'=HYPERLINK(""x"")"');
    expect(csvCell('+1')).toBe('"\'+1"');
    expect(csvCell('-2')).toBe('"\'-2"');
    expect(csvCell('@SUM(A1)')).toBe('"\'@SUM(A1)"');
    expect(csvCell(-2)).toBe('"-2"');
    expect(csvCell(null)).toBe('""');
    expect(csvCell('a,b')).toBe('"a,b"');
  });
  it('writes a preamble, headers and rows with a BOM', () => {
    const out = toCsv([{ n: 'Asha', amt: 1200 }], [{ header: 'Name', value: (r) => r.n }, { header: 'Amount', value: (r) => r.amt }], [['Branch', 'PUN']]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.split('\r\n')).toEqual(['﻿"Branch","PUN"', '', '"Name","Amount"', '"Asha","1200"']);
  });
});

describe('money', () => {
  it('converts rupees to integer paise and back', () => {
    expect(toPaise('1,250.50')).toBe(125050);
    expect(toPaise('₹ 99')).toBe(9900);
    expect(toPaise('0.1')).toBe(10);
    expect(toPaise('1.234')).toBeNull();
    expect(toPaise('-5')).toBeNull();
    expect(toPaise('abc')).toBeNull();
    expect(moneyPlain(125050)).toBe('1250.50');
    expect(formatMoney(125050)).toContain('1,250.50');
  });
});
