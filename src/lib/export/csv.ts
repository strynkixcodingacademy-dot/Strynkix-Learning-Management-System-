/**
 * Strynkix LMS — CSV export shared by every report. Cells that a spreadsheet
 * would run as a formula (starting with = + - @, tab or carriage return) are
 * prefixed with an apostrophe, and every cell is quoted.
 */

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | boolean | null | undefined;
}

export function csvCell(raw: string | number | boolean | null | undefined): string {
  if (raw === null || raw === undefined) return '""';
  let s = String(raw);
  if (typeof raw === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv<T>(rows: T[], columns: CsvColumn<T>[], preamble: string[][] = []): string {
  const lines = [
    ...preamble.map((r) => r.map(csvCell).join(',')),
    ...(preamble.length ? [''] : []),
    columns.map((c) => csvCell(c.header)).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(c.value(r))).join(',')),
  ];
  // BOM so Excel opens UTF-8 (₹, names) correctly.
  return `﻿${lines.join('\r\n')}`;
}

export function downloadCsv<T>(filename: string, rows: T[], columns: CsvColumn<T>[], preamble: string[][] = []): void {
  const blob = new Blob([toCsv(rows, columns, preamble)], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace(/[^\w.-]+/g, '_');
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
