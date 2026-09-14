/**
 * log ฝั่งเซิร์ฟเวอร์แบบมีโครงสร้าง — JSON บรรทัดเดียว อ่านย้อนหลังได้ด้วย `event`/`route`/`code`/`digest`
 *
 * ⚠ ใช้ฝั่งเซิร์ฟเวอร์เท่านั้น (ปัญหาเกิดตอน deploy: Vercel/runtime เก็บ stdout) — อย่า import จาก client component
 *   โมดูลนี้ไม่พึ่ง `node:*` เลย จึงยังทดสอบด้วย `node --test` ได้ตรง ๆ และไม่ลาก runtime มาโดยไม่จำเป็น
 *
 * กติกาความเป็นส่วนตัว (ห้ามหลุดไม่ว่ากรณีใด):
 *   1. คีย์อันตรายถูกตัดทิ้งเสมอ (email · note · name · amount · token · cookie · authorization · secret ·
 *      password · userId ฯลฯ) — เทียบแบบ normalize (ตัด `_`/`-` แล้วพิมพ์เล็ก) และเทียบทั้ง "เท่ากับ" และ "ลงท้ายด้วย"
 *   2. `userId` **ไม่เคยออกดิบ** — ออกเป็นรหัสย่อที่เสถียร (`user` = 8 hex จาก hash) ใช้ตามรอยผู้ใช้คนเดิมข้ามคำขอได้
 *      เหตุผล: id ของผู้ใช้ในระบบนี้เป็นข้อความอิสระ (fixture/ทดสอบใช้คำอ่านออกได้) ⇒ ดิบ = อาจมีชื่อคนติดมาได้
 *   3. ข้อความทุกก้อนถูกปิดอีเมล (`a***@domain`) ตัดความยาวที่ ~200 ตัวอักษร และตัด JWT/token ยาว ๆ
 *      (สำคัญมากกับ error ของ PG ที่มักแนบ "Key (email)=(a@b.com) already exists" มาในข้อความ)
 *   4. ค่าที่ซ้อนกันถูกไล่กรองด้วยกติกาเดียวกัน (จำกัดความลึก/จำนวนคีย์/จำนวนสมาชิกอาเรย์)
 */
export type LogLevel = 'error' | 'warn' | 'info';

/** ฟิลด์ที่ใส่ได้ — ค่าที่เป็น `Error` จะถูกย่อยเป็น name/message/code/digest ให้เอง */
export type LogFields = Record<string, unknown>;

/** ตัดความยาวค่าข้อความ (ตัวอักษร) — พอสำหรับ debug แต่ไม่ทำให้ log บวม/พา PII ยาว ๆ ออกไป */
const MAX_VALUE_LENGTH = 200;
/** ความลึกสูงสุดของการไล่กรองวัตถุซ้อน */
const MAX_DEPTH = 3;
/** จำนวนคีย์สูงสุดต่อวัตถุ (กัน payload ยักษ์) */
const MAX_KEYS = 24;
/** จำนวนสมาชิกสูงสุดที่เก็บจากอาเรย์ */
const MAX_ARRAY_ITEMS = 8;

/**
 * คำที่ห้ามเป็น "คีย์" ของ log — เทียบกับคีย์ที่ normalize แล้ว (ตัวพิมพ์เล็ก, ไม่มี `_`/`-`)
 * ใช้ทั้งแบบเท่ากับและลงท้ายด้วย (เช่น `userEmail` ลงท้ายด้วย `email`) เพื่อกันการตั้งชื่อเลี่ยง
 */
const FORBIDDEN_KEY_WORDS = [
  'email',
  'mail',
  'note',
  'name',
  'amount',
  'token',
  'cookie',
  'authorization',
  'secret',
  'password',
  'apikey',
  'userid',
  'sessionid',
  'accountid',
  'categoryid',
];

const normalizeKey = (key: string): string => key.toLowerCase().replace(/[_-]/g, '');

const isForbiddenKey = (key: string): boolean => {
  const normalized = normalizeKey(key);
  return FORBIDDEN_KEY_WORDS.some((word) => normalized === word || normalized.endsWith(word));
};

/**
 * อีเมลในข้อความ → `a***@domain` (เก็บตัวแรกของ local part กับโดเมนไว้ให้ตามรอยได้)
 * โดเมนต้องมีจุดอย่างน้อย 1 จุด แต่ **ไม่บังคับความยาว TLD** — ของจริงเจอ `Key (email)=(x@y.z)` หลุดเพราะบังคับ {2,}
 * (ไม่ใช้ `\S+@\S+` เพราะกว้างเกินไป จะกินข้อความไทย/URL ปกติ)
 */
const EMAIL_PATTERN = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;
/**
 * JWT (`eyJ…`) หรือสตริงทึบยาว ๆ (session token/API key/hash) → ปิดทั้งก้อน
 * ต้องรวม `/` `+` `=` ด้วย: พิสูจน์แล้วว่า token แบบ base64 (เช่น `wJalrXUtnFEMI/K7MDENG/bPx…`) หลุด
 * ถ้าใช้ชุดอักขระที่ไม่รวม `/` (เคสจริงที่เจอตอนทดสอบ — มีเทสต์ล็อกไว้)
 */
const TOKEN_PATTERN = /eyJ[A-Za-z0-9._-]{10,}|[A-Za-z0-9_+/=-]{40,}/g;

/** ข้อความปลอดภัย: ปิดอีเมล/token แล้วตัดความยาว */
function safeText(value: string): string {
  const masked = value.replace(EMAIL_PATTERN, '$1***@$2').replace(TOKEN_PATTERN, '[ตัด]');
  return masked.length > MAX_VALUE_LENGTH ? `${masked.slice(0, MAX_VALUE_LENGTH - 1)}…` : masked;
}

/**
 * รหัสย่อของผู้ใช้ — hash แบบ FNV-1a (ไม่พึ่ง node:crypto เพื่อให้ไฟล์นี้ import ได้ทุก runtime)
 * เสถียรต่อค่าเดิม (ตามรอยข้ามคำขอได้) และย้อนกลับเป็น id จริงไม่ได้ในทางปฏิบัติ
 */
export function userIdDigest(userId: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < userId.length; index += 1) {
    hash ^= userId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/** ค่าที่แทนเมื่ออ่านค่าไม่ได้ (getter/toJSON ที่ throw ฯลฯ) — log ต้องไม่พังเพราะข้อมูลที่พัง */
const UNREADABLE = '[อ่านไม่ได้]';

/** เรียกฟังก์ชันที่อาจโยน — คืน UNREADABLE แทนการโยน (หัวใจของ "log ต้องไม่ทำให้คำขอพัง") */
function attempt<T>(run: () => T): T | string {
  try {
    return run();
  } catch {
    return UNREADABLE;
  }
}

/** ย่อย Error ให้เหลือฟิลด์ที่ปลอดภัย (ข้อความผ่านการปิดอีเมลแล้ว) */
function safeError(error: Error): Record<string, unknown> {
  // อ่านทุกช่องผ่าน attempt(): `Error.message` อาจถูก define เป็น getter ที่ throw ได้
  const digest = attempt(() => (error as Error & { digest?: unknown }).digest);
  const code = attempt(() => (error as Error & { code?: unknown }).code);
  return {
    errorName: attempt(() => safeText(String(error.name))),
    message: attempt(() => safeText(String(error.message ?? ''))),
    ...(typeof code === 'string' ? { code: attempt(() => safeText(code)) } : {}),
    ...(typeof digest === 'string' ? { digest: attempt(() => safeText(digest)) } : {}),
  };
}

/** แปลงค่าใด ๆ → ค่าที่ปลอดภัยจะออก log (ไล่ตามกติกาข้อ 1-4) · ครอบ try/catch ต่อค่า: ค่าที่พังเหลือ UNREADABLE */
function safeValue(value: unknown, depth: number): unknown {
  try {
    return safeValueInner(value, depth);
  } catch {
    return UNREADABLE;
  }
}

function safeValueInner(value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return safeText(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value);
  if (typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function') return '[ฟังก์ชัน]';
  if (typeof value === 'symbol') return String(value);
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Error) return safeError(value);
  if (depth >= MAX_DEPTH) return '[ลึกเกินกำหนด]';

  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ARRAY_ITEMS).map((item) => safeValue(item, depth + 1));
    return value.length > MAX_ARRAY_ITEMS ? [...items, `[+${value.length - MAX_ARRAY_ITEMS}]`] : items;
  }

  const source = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  let kept = 0;
  for (const key of Object.keys(source)) {
    if (kept >= MAX_KEYS) {
      out['…'] = 'ตัดคีย์ส่วนเกิน';
      break;
    }
    out[key] = isForbiddenKey(key) ? '[ตัด: ข้อมูลส่วนตัว]' : safeValue(source[key], depth + 1);
    kept += 1;
  }
  return out;
}

/**
 * กรองฟิลด์ก่อนออก log — pure function (มีเทสต์)
 * `userId` ถูกแทนด้วยรหัสย่อเสมอ และคีย์อันตรายถูกแทนด้วยข้อความ `[ตัด: ข้อมูลส่วนตัว]`
 */
export function safeFields(fields: LogFields = {}): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let entries: [string, unknown][];
  try {
    entries = Object.entries(fields ?? {});
  } catch {
    // แม้แต่การไล่คีย์ก็อาจโยน (Proxy ที่ดัก ownKeys/get) — ไม่เป็นไร ยังต้องคืน log ที่ปลอดภัยได้
    return { fields: UNREADABLE };
  }
  for (const [key, value] of entries) {
    try {
      if (normalizeKey(key) === 'userid') {
        out.user = typeof value === 'string' && value.length > 0 ? userIdDigest(value) : '[ไม่มีผู้ใช้]';
        continue;
      }
      out[key] = isForbiddenKey(key) ? '[ตัด: ข้อมูลส่วนตัว]' : safeValue(value, 0);
    } catch {
      out[key] = UNREADABLE;
    }
  }
  return out;
}

/**
 * ประกอบเป็น JSON บรรทัดเดียว — pure function (มีเทสต์ · ส่ง `now` เข้ามาได้เพื่อให้ผลคงที่)
 * รูป: `{"t":ISO,"lvl":"…","event":"…","route?":…,"code?":…,"digest?":…,…ฟิลด์อื่นที่กรองแล้ว}`
 * `route`/`code`/`digest` ถูกยกขึ้นระดับบนสุดเมื่อผู้เรียกส่งมา (หรือเมื่อมาจาก Error) — ที่เหลืออยู่ในก้อนเดียวกัน
 */
export function serializeLog(event: string, fields: LogFields = {}, now: Date = new Date()): string {
  try {
    return serializeLogInner(event, fields, now);
  } catch {
    // ทางออกสุดท้าย: บรรทัดปลอดภัยขั้นต่ำที่ประกอบเองได้โดยไม่แตะข้อมูลของผู้เรียกเลย
    return `{"t":"${new Date().toISOString()}","lvl":"error","event":"log_failed"}`;
  }
}

function serializeLogInner(event: string, fields: LogFields, now: Date): string {
  const safe = safeFields(fields);
  const level = (fields.level === 'warn' || fields.level === 'info' ? fields.level : 'error') as LogLevel;

  // `level` ถูกใช้ไปแล้วใน `lvl` — ไม่ต้องออกซ้ำเป็นฟิลด์
  delete safe.level;

  const code = safe.code ?? (safe.error as Record<string, unknown> | undefined)?.code;
  const digest = safe.digest ?? (safe.error as Record<string, unknown> | undefined)?.digest;

  return JSON.stringify({
    t: now.toISOString(),
    lvl: level,
    event: safeText(event),
    ...(typeof safe.route === 'string' ? { route: safe.route } : {}),
    ...(typeof code === 'string' ? { code } : {}),
    ...(typeof digest === 'string' ? { digest } : {}),
    ...safe,
  });
}

/**
 * เขียน log หนึ่งบรรทัด — ใช้เฉพาะเส้นที่ "จัดการความล้มเหลว" (ผู้ใช้เห็นข้อความไทย แต่เราต้องตามรอยได้)
 * ระดับเลือกด้วย `fields.level` (ค่าเริ่มต้น error) → เรียก console ตามระดับนั้น
 */
export function logServer(event: string, fields: LogFields = {}): void {
  // ⚠ ห้ามโยนออกจากฟังก์ชันนี้เด็ดขาด: ทุกจุดเรียกอยู่ใน `catch` ของเส้นที่ผู้ใช้เห็นข้อความไทย
  // ถ้า log โยนเอง ผู้ใช้จะได้ 500 แทนข้อความไทย (reviewer พิสูจน์เคส getter ที่ throw ไว้)
  const level = attempt(() => fields?.level);
  const line = serializeLog(event, fields);
  try {
    if (level === 'info') console.log(line);
    else if (level === 'warn') console.warn(line);
    else console.error(line);
  } catch {
    // console พัง (ไม่ควรเกิด) — กลืนไว้ ไม่ให้ล้มคำขอ
  }
}
