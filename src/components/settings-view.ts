/**
 * ตรรกะบริสุทธิ์ของหน้าจัดการ "หมวดหมู่" + "กระเป๋าเงิน" (wave 9)
 * แยกไว้ที่ components/ เพื่อให้ client component ใช้ได้และทดสอบด้วย `node --test` (ไม่มี DOM/drizzle)
 *
 * กติกาที่อยู่ที่นี่ (สำคัญ): expense ห้ามเสนอสีเขียวของ design §1.1 = `--chart-4`/`--chart-7`
 */

import type { AccountKind } from '@/db/queries/accounts';

/** สีของหมวด/กราฟ 8 สีตาม design §1.1 — เก็บเป็น "ชื่อโทเคน" เสมอ (ห้ามเก็บ hex) */
export const CHART_TOKENS = [
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--chart-6',
  '--chart-7',
  '--chart-8',
] as const;

/** ชื่อสีสำหรับ aria-label — `--chart-6` เป็นเขียวน้ำทะเล จึงต้องไม่เรียกมันว่า "เขียว" เฉย ๆ (spec §3) */
export const COLOR_LABELS: Record<string, string> = {
  '--chart-1': 'ฟ้า',
  '--chart-2': 'ม่วง',
  '--chart-3': 'ส้ม',
  '--chart-4': 'เขียว',
  '--chart-5': 'ชมพู',
  '--chart-6': 'ฟ้าเขียว',
  '--chart-7': 'เขียวมะนาว',
  '--chart-8': 'แดง',
};

/** สีที่ "รายจ่าย" ห้ามเสนอ — เขียวในแอปนี้หมายถึงรายรับ (design §1.1) */
const EXPENSE_FORBIDDEN = new Set(['--chart-4', '--chart-7']);

/** สีที่เลือกได้ของหมวดนั้น: รายจ่าย 6 สี (ตัดเขียว) · รายรับได้ครบ 8 */
export function colorOptionsFor(kind: 'income' | 'expense'): readonly string[] {
  return kind === 'expense' ? CHART_TOKENS.filter((token) => !EXPENSE_FORBIDDEN.has(token)) : CHART_TOKENS;
}

/** สีที่บันทึกไว้เดิมใช้ได้เสมอ แม้จะไม่ใช่ตัวเลือกที่เสนอตอนนี้ (ห้ามแก้สีเดิมให้ผู้ใช้ — spec §3) */
export function colorLabel(token: string): string {
  return COLOR_LABELS[token] ?? token;
}

/** ป้ายประเภทรายหมวด (หมวดแก้ kind ไม่ได้ — แสดงผลอย่างเดียว) */
export const CATEGORY_KIND_LABELS: Record<'income' | 'expense', string> = {
  income: 'รายรับ',
  expense: 'รายจ่าย',
};

/** ป้ายไทยของชนิดกระเป๋า — `Record<AccountKind, …>` บังคับให้ครบทุกชนิดที่ DB รองรับ (เพิ่มใน DB = TS ฟ้อง) */
export const ACCOUNT_KIND_LABELS: Record<AccountKind, string> = {
  cash: 'เงินสด',
  bank: 'ธนาคาร',
  credit: 'บัตรเครดิต',
  ewallet: 'กระเป๋าเงินอิเล็กทรอนิกส์',
  other: 'อื่น ๆ',
};

export const ACCOUNT_KIND_OPTIONS = Object.entries(ACCOUNT_KIND_LABELS).map(([id, label]) => ({
  id: id as AccountKind,
  label,
}));

/**
 * แยกแถวเป็น "ยังใช้งาน" กับ "เลิกใช้แล้ว" โดยคงลำดับเดิมภายในกลุ่ม
 * (ลำดับ active มาจาก DB: sort_order แล้วชื่อ · กลุ่มที่ archive ต่อท้ายเสมอ — spec §1)
 */
export function splitByArchived<T extends { archived: boolean }>(
  rows: readonly T[],
): { active: T[]; archived: T[] } {
  const active: T[] = [];
  const archived: T[] = [];
  for (const row of rows) (row.archived ? archived : active).push(row);
  return { active, archived };
}

/**
 * ช่องของชีตตั้งค่าที่ข้อความ error ชี้ถึง (wave18c) — คุม `aria-invalid` ให้ตรงช่อง
 * ชีตหมวด/กระเป๋าใช้ 'name'/'balance' · ชีตงบใช้ 'amount' · ไม่รู้จัก = null (ไม่ทำเครื่องหมายผิด)
 */
export type SettingsErrorField = 'name' | 'balance' | 'amount';

export function settingsErrorField(message: string): SettingsErrorField | null {
  if (message.includes('ชื่อ')) return 'name'; // รวมเคสชื่อซ้ำ ('มีชื่อนี้อยู่แล้วในหมวดที่ใช้งาน')
  if (message.includes('ยอด')) return 'balance';
  if (message.includes('จำนวน') || message.includes('งบ')) return 'amount';
  return null;
}
