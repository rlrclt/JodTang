/**
 * ตรรกะบริสุทธิ์ของหน้ารายการทั้งหมด (ใช้ร่วมกับ client component จึงอยู่ที่ components/ ไม่ใช่ app/ — components ต้องไม่ import จาก app) — แยกออกมาเพื่อให้ทดสอบด้วย `node --test` ได้โดยไม่ต้องมี DOM/React
 * (บั๊ก 2 ตัวของ wave 8 อยู่ตรงนี้: URL ของ "ล้างตัวกรอง" และเกณฑ์แยกสถานะว่าง)
 */

/**
 * เพดานความยาวคำค้นที่ UI ยอมให้พิมพ์/วาง (wave15b)
 *
 * **ต้องเท่ากับ `MAX_SEARCH_LENGTH` ใน src/db/queries/transactions.ts** — ชั้นข้อมูลตัดที่ขอบเหมือนกัน
 * ถ้าฝั่ง UI ไม่ cap ผู้ใช้จะถูกตัดคำค้นเงียบ ๆ (พิมพ์ 250 ได้ แต่ค้นแค่ 200)
 *
 * ประกาศซ้ำที่นี่โดยตั้งใจ ไม่ import จากโมดูล DB: ไฟล์นี้ถูกใช้จาก client component ('use client')
 * การลาก src/db เข้ามาจะพา drizzle + schema ลง bundle ฝั่งเบราว์เซอร์ (แพตเทิร์นเดิมของโปรเจกต์คือ
 * components → db ใช้ได้เฉพาะ `import type` หรือใน 'use server') — มีเทสต์กันค่าเพี้ยนใน transactions-view.test.ts
 */
export const SEARCH_MAX_LENGTH = 200;

/**
 * สร้าง `/transactions?…` จากตัวกรองปัจจุบัน (base) + ค่าที่จะเปลี่ยน
 * - ค่า `undefined` = ตัด key นั้นออกจาก URL (เช่น `{ q: undefined }` = ล้างคำค้น)
 * - ตัด `pages` ทิ้งเสมอ: เปลี่ยนตัวกรอง/คำค้น = กลับหน้าแรก (ไม่งั้นได้หน้าว่างที่ดูเหมือนไม่มีข้อมูล)
 */
export function buildHref(base: string, overrides: Record<string, string | undefined>): string {
  const params = new URLSearchParams(base);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) params.delete(key);
    else params.set(key, value);
  }
  params.delete('pages');
  return `/transactions?${params.toString()}`;
}

/**
 * ค่าที่ช่องค้นหาต้องแสดง เมื่อค่าจาก URL (`urlQ`) เปลี่ยนจากรอบก่อน
 *
 * คืน `null` = **ไม่ต้องแตะ** สิ่งที่ผู้ใช้กำลังพิมพ์ เพราะ URL เปลี่ยนเพราะคำสั่งนำทางของเราเอง
 * (ถ้าเขียนทับตรงนี้ ผู้ใช้ที่พิมพ์ต่อระหว่างรอ round-trip จะเสียตัวอักษร)
 *
 * บั๊ก wave 8: "ล้างตัวกรอง" เขียน URL ใหม่ (ไม่มี `q`) แต่ local state เดิมยังอยู่ → debounce ยิง `q` กลับเข้า URL
 * แก้ด้วยการให้ URL ชนะเมื่อการเปลี่ยนนั้น **ไม่ได้มาจากเรา** (`urlQ !== lastRequested`) — ครอบคลุม
 * ล้างตัวกรอง · ลิงก์เปลี่ยนเดือน · Back/Forward · ปุ่ม ✕ ด้วยตรรกะเดียว
 */
export function searchInputAfterUrlChange(urlQ: string, lastRequested: string, current: string): string | null {
  if (urlQ === lastRequested) return null; // ผลของ replace ที่เราสั่งเอง
  return urlQ === current ? null : urlQ; // มาจากภายนอก → ช่องค้นหาต้องตรงกับ URL
}

/** สิ่งที่ผู้ใช้ต้องทำต่อจากสถานะว่าง — คนละปุ่มสำหรับคนละสาเหตุ */
export type EmptyAction = 'open-add' | 'back-to-current' | 'clear-filters' | 'none';

export type EmptyState = { message: string; action: EmptyAction };

/**
 * สถานะว่างของหน้ารายการ (spec §3) — **เกณฑ์เดียว** ตัดสินทั้งข้อความและปุ่ม
 *
 * แยก 3 กรณี (บั๊กเดิม: ข้อความใช้เกณฑ์ "เดือนปัจจุบันไหม" แต่ปุ่มใช้เกณฑ์ "เคยมีรายการไหม"
 * ทำให้วันที่ 1 ของเดือนได้ข้อความ "เริ่มบันทึกรายการแรก" ทั้งที่มีข้อมูลเดือนอื่น และปุ่ม
 * "กลับเดือนนี้" ชี้กลับไป URL เดิม = กดแล้วไม่มีอะไรเกิดขึ้น):
 *   1. มีตัวกรอง/คำค้น → "ไม่พบรายการที่ตรงกับตัวกรอง" + ล้างตัวกรอง
 *   2. ไม่มีข้อมูลเลยทั้งบัญชี → "เริ่มบันทึกรายการแรก" + เปิด sheet เพิ่มรายการ
 *   3. เดือนที่ดูว่างแต่มีข้อมูลเดือนอื่น → "เดือนนี้ยังไม่มีรายการ" + กลับเดือนนี้ **เฉพาะเมื่อได้ดูเดือนอื่นอยู่**
 *      (ถ้าดูเดือนปัจจุบันที่ว่างอยู่แล้ว ไม่มีปุ่ม — "กลับเดือนนี้" จะชี้ที่เดิม)
 */
export function emptyStateFor(input: {
  rowCount: number;
  activeFilterCount: number;
  /** ผู้ใช้คนนี้มีรายการที่ยังไม่ถูกลบเหลืออยู่ไหม (ทุกเดือน) */
  hasAnyTransaction: boolean;
  /** งวดเดือนที่ดูอยู่ = เดือนปัจจุบัน (Asia/Bangkok) ไหม */
  isCurrentMonth: boolean;
}): EmptyState | null {
  if (input.rowCount > 0) return null;

  if (input.activeFilterCount > 0) {
    return { message: 'ไม่พบรายการที่ตรงกับตัวกรอง', action: 'clear-filters' };
  }

  if (!input.hasAnyTransaction) {
    return { message: 'เริ่มบันทึกรายการแรก', action: 'open-add' };
  }

  return { message: 'เดือนนี้ยังไม่มีรายการ', action: input.isCurrentMonth ? 'none' : 'back-to-current' };
}
