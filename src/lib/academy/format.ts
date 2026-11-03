/** Strynkix LMS — consistent money and date formatting (money is integer paise). */

const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

export const formatMoney = (paise: number | null | undefined) => (paise === null || paise === undefined ? '—' : INR.format(paise / 100));
/** Plain number for CSV ("12345.50"), never a formula. */
export const moneyPlain = (paise: number | null | undefined) => (paise === null || paise === undefined ? '' : (paise / 100).toFixed(2));
/** Rupees typed by a person → paise. Rejects anything but a non-negative amount with up to 2 decimals. */
export function toPaise(input: string): number | null {
  const s = input.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  return Math.round(Number(s) * 100);
}
export const formatDate = (d: string | null | undefined) => {
  if (!d) return '—';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(`${d}T00:00:00`) : new Date(d);
  return Number.isNaN(date.getTime()) ? d : date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
};
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
