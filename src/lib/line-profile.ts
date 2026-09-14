/**
 * แปลงโปรไฟล์จาก LINE → ข้อมูลผู้ใช้ที่ better-auth ใช้สร้างแถว `user`
 * แยกเป็นไฟล์นี้ (ไม่มี import จาก '@/' และไม่มี dependency) เพื่อทดสอบตรง ๆ ด้วย `node --test`
 *
 * ทำไมต้องมี: LINE Login ที่ไม่ได้ขอสโคป `email` (สถานะปัจจุบันของโปรเจกต์ — PLAN §3/§8) ส่งโปรไฟล์
 * **ไม่มีอีเมล** กลับมา · better-auth 1.7.4 ปฏิเสธ callback ที่ไม่มีอีเมล:
 *   `Provider "line" did not return an email … or create a placeholder via mapProfileToUser`
 * ⇒ ถ้าไม่มีที่ไฟล์นี้ ผู้ใช้ LINE (ตลาดหลักของแอป) ล็อกอินไม่ผ่านเลย 100%
 *
 * กติกาที่เลือก (สำคัญ — อย่าแก้โดยไม่อ่าน):
 *   1. อีเมลตัวแทน = `<sub>@line.local` โดย **lowercase sub** — ต้องเสถียรต่อผู้ใช้คนเดิม (sub ของ LINE
 *      คือ userId ที่ไม่เปลี่ยนตลอดชีพ) และต้องผ่าน check ของ DB `email = lower(btrim(email))` (docs/schema.sql)
 *      LINE ส่ง sub มาเป็นตัวพิมพ์ใหญ่ (U…) จึงต้อง lower
 *   2. โดเมน `line.local` — `.local` สงวนไว้สำหรับ mDNS (RFC 6762) ไม่มีทางเป็นอีเมลจริงของใคร
 *      ⇒ ไม่ชนกับอีเมลจริงจาก Google/LINE ที่มี scope email · ส่วน sub ทำให้ไม่ชนกันเองระหว่างผู้ใช้
 *   3. **`emailVerified: false` เสมอ** — ทั้งอีเมลจริงและอีเมลตัวแทน: LINE ไม่ยืนยันอีเมล (PLAN §3 เตือนว่า
 *      ห้ามใช้ email เป็นกุญแจเชื่อมบัญชีข้าม provider) · ค่าจริงยังต้องอ่านจาก DB ยืนยัน (เทสต์ e2e ทำ)
 *   4. ถ้าโปรไฟล์มีอีเมลจริง → **ใช้ค่านั้น** (แค่ normalize เป็น lower/trim ให้ผ่าน check ของ DB ไม่ใช่แทนที่)
 *      ⇒ วันที่ LINE อนุมัติสโคป email ระบบทำงานได้ทั้งสองทางโดยไม่ต้องแก้ไฟล์นี้
 *   5. ไม่มีทั้งอีเมลและ sub → โยน error (สร้างอีเมลที่เสถียรไม่ได้ = สร้างผู้ใช้ที่ซ้ำ/ปนกันได้ ต้องล้มเสียงดัง)
 */
export type LineMappedUser = {
  name: string;
  email: string;
  /** LINE ไม่ยืนยันอีเมล — ต้องเป็น false เสมอ (ดูกติกาข้อ 3) */
  emailVerified: false;
};

/** โดเมนของอีเมลตัวแทน — `.local` เป็นโดเมนสงวนสำหรับ mDNS ไม่ใช่โดเมนอีเมลจริง */
const PLACEHOLDER_DOMAIN = 'line.local';

/** อ่านฟิลด์สตริงจากโปรไฟล์ภายนอก (ตรวจ typeof ทุกครั้ง — ห้ามเชื่อรูปทรงที่ส่งมา) */
function stringField(source: Record<string, unknown>, key: string): string {
  const value = source[key];
  return typeof value === 'string' ? value.trim() : '';
}

export function mapLineProfileToUser(profile: unknown): LineMappedUser {
  if (typeof profile !== 'object' || profile === null) {
    throw new Error('โปรไฟล์จาก LINE ต้องเป็น object');
  }
  // cast เพื่อ index ด้วยชื่อคีย์เท่านั้น — ทุกฟิลด์ที่อ่านผ่าน stringField() ถูกตรวจ typeof ก่อนใช้
  const source = profile as Record<string, unknown>;

  const sub = stringField(source, 'sub');
  const name = stringField(source, 'name') || stringField(source, 'displayName') || 'ผู้ใช้ LINE';
  const realEmail = stringField(source, 'email').toLowerCase();

  if (realEmail !== '') return { name, email: realEmail, emailVerified: false };
  if (sub === '') {
    throw new Error('โปรไฟล์ LINE ไม่มี sub — สร้างอีเมลตัวแทนที่เสถียรต่อผู้ใช้ไม่ได้');
  }
  return { name, email: `${sub.toLowerCase()}@${PLACEHOLDER_DOMAIN}`, emailVerified: false };
}
