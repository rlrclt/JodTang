/**
 * ตรรกะบริสุทธิ์ของการแสดงอีเมลในหน้าตั้งค่า (wave25) — แยกออกมาให้ทดสอบด้วย `node --test` ได้
 *
 * กติกาที่ต้องไม่พลาด:
 * - อีเมลตัวแทน (`<sub>@line.local`) หรืออีเมลว่าง → แสดง "ยังไม่ได้ตั้งอีเมล" **ห้ามโชว์ที่อยู่ภายในระบบ**
 * - ยืนยันแล้ว (มาจากผู้ให้บริการ) → ป้าย "ยืนยันแล้ว" + แก้ไม่ได้ (ตั้งใหม่ได้ false เสมอ = เสียสถานะโดยไม่ได้อะไร)
 * - ยังไม่ยืนยัน → ป้าย "ยังไม่ยืนยัน" + แก้ได้ (ค่าที่ตั้งเองเป็น false เสมอ — แอปไม่มีการยืนยันอีเมล)
 */

export type EmailBadge = 'verified' | 'unverified';

export type EmailDisplay = {
  /** ข้อความบรรทัดอีเมล — ค่าคงที่เท่านั้น ไม่ echo ค่าดิบจาก DB เมื่อเป็นอีเมลตัวแทน */
  label: string;
  /** ป้ายสถานะ (null = ยังไม่มีอีเมลของตัวเอง จึงไม่ต้องมีป้าย) */
  badge: EmailBadge | null;
  /** มีปุ่มตั้ง/แก้ไขไหม */
  canEdit: boolean;
  /** ค่าเริ่มต้นในช่องกรอก ('' = ยังไม่มี/ล้าง) */
  fieldValue: string;
  /** ป้ายข้อความของปุ่ม */
  buttonLabel: 'ตั้งอีเมล' | 'แก้ไข' | null;
};

export function emailDisplay(input: {
  email: string | null;
  emailVerified: boolean;
  usesPlaceholderEmail: boolean;
}): EmailDisplay {
  const own = input.email !== null && !input.usesPlaceholderEmail ? input.email : null;

  if (own === null) {
    return {
      label: 'ยังไม่ได้ตั้งอีเมล',
      badge: null,
      canEdit: !input.emailVerified,
      fieldValue: '',
      buttonLabel: input.emailVerified ? null : 'ตั้งอีเมล',
    };
  }

  return {
    label: own,
    badge: input.emailVerified ? 'verified' : 'unverified',
    canEdit: !input.emailVerified,
    fieldValue: own,
    buttonLabel: input.emailVerified ? null : 'แก้ไข',
  };
}
