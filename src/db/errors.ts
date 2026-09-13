/**
 * error ของชั้น DB ที่ผู้ใช้เห็นได้ — ใช้ร่วมกันทุกตาราง (transactions · accounts · categories)
 *
 * กติกา (design §4): ห้ามให้ .message ของ drizzle (มี SQL เต็ม) หรือรหัส PG ถึงผู้ใช้
 *   - input ที่เราตรวจเองไม่ผ่าน  → ValidationError (ข้อความไทย) ยิงก่อนถึง DB
 *   - DB ปฏิเสธ (uuid/FK/unique/check) → toUserError() แปลเป็น ValidationError ที่จุดเดียว
 *   - รหัสที่ไม่รู้จัก = ปล่อย error เดิมผ่าน (บั๊กจริง/DB ล่ม ต้องเห็น stack ไม่ใช่กลายเป็นข้อความผู้ใช้)
 * error เดิมยังอยู่ที่ cause + console.error ไว้ debug
 */
/** input ผิดกติกาของผู้ใช้ (ไม่ใช่บั๊ก) — server action ควรตอบเป็นข้อความให้ผู้ใช้ ไม่ใช่ 500 */
export class ValidationError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ValidationError';
  }
}

/** รหัส error ของ PG ที่แปลเป็นข้อความผู้ใช้ (กฎข้อ 2 + design §4: ห้ามให้ SQL/ศัพท์เทคนิคถึงผู้ใช้) */
const DB_ERROR_MESSAGES: Record<string, string> = {
  '22P02': 'รูปแบบข้อมูลไม่ถูกต้อง', // uuid ผิดรูป ฯลฯ
  '23503': 'ไม่พบกระเป๋าเงินหรือหมวดที่อ้างถึง (หรือไม่ใช่ของผู้ใช้คนนี้)', // FK: ไม่มีอยู่/ข้ามผู้ใช้/kind ไม่ตรง
  '23514': 'ข้อมูลไม่ตรงกติกาของรายการ', // check ของ DB
};

/** SQLSTATE จาก error ของ drizzle/PGlite — มันซ้อนกันอยู่ที่ cause */
function pgCode(error: unknown): string | undefined {
  for (let node: unknown = error, depth = 0; node && depth < 4; depth++) {
    const code = (node as { code?: unknown }).code;
    if (typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code)) return code;
    node = (node as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * แปล error ดิบของ DB → ValidationError ที่จุดเดียว (error เดิมคงไว้ที่ cause + log ไว้ debug)
 * รหัสที่ไม่รู้จัก = คืน error เดิม (บั๊กจริง/DB ล่ม ต้องเห็น stack ไม่ใช่กลายเป็นข้อความผู้ใช้)
 */
export function toUserError(error: unknown): unknown {
  const message = DB_ERROR_MESSAGES[pgCode(error) ?? ''];
  if (!message) return error;
  console.error('[jodjai] transaction write rejected by DB:', error);
  return new ValidationError(message, { cause: error });
}

/** รันคำสั่ง DB แล้วแปล error ที่ผู้ใช้ทำได้ (uuid/FK/unique/check) ให้เป็นข้อความไทย */
export async function guardWrite<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    throw toUserError(error);
  }
}
