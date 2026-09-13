/**
 * ช่องประกาศสำหรับ screen reader (wave13b) — store ระดับโมดูล ใช้กับ useSyncExternalStore
 *
 * ทำไมต้องมี: ข้อความยืนยันที่ render อยู่ในส่วนที่ RSC refresh แทนที่ (การ์ด first-run) ถูกถอดออกใน ~39ms
 * → screen reader ไม่ทันประกาศ · ที่นี่ข้อความอยู่ใน live region ที่ **layout** (ไม่ถูก refresh แทนที่) และ
 * คงอยู่ตาม TTL ที่กำหนด แล้วล้างเอง (ไม่ค้างผิดบริบท)
 *
 * ไม่มี dependency · โมดูลนี้ไม่มี JSX/React → ทดสอบด้วย `node --test` ได้ตรง
 */

type Listener = (message: string) => void;

/** handle ของ timer ล้างข้อความ (คนละชนิดกันระหว่างเบราว์เซอร์กับโหนด) — ตั้งชื่อไว้ที่เจ้าของค่า */
type TimerHandle = ReturnType<typeof setTimeout>;

const listeners = new Set<Listener>();
let message = '';
let clearTimer: TimerHandle | undefined;

/** ประกาศข้อความ (แทนที่ข้อความเดิม) — ล้างตัวเองหลัง `ttlMs` เพื่อไม่ให้ค้างผิดบริบท */
export function announce(next: string, ttlMs = 8000): void {
  message = next;
  for (const listener of listeners) listener(message);

  if (clearTimer) clearTimeout(clearTimer);
  clearTimer = setTimeout(() => {
    clearTimer = undefined;
    message = '';
    for (const listener of listeners) listener(message);
  }, ttlMs);
}

/** ข้อความที่ควรประกาศอยู่ตอนนี้ ('' = ไม่มี) — ใช้เป็น getSnapshot ของ useSyncExternalStore */
export function currentAnnouncement(): string {
  return message;
}

/** สมัครรับข้อความ — คืนฟังก์ชันเลิกสมัคร (ใช้เป็น subscribe ของ useSyncExternalStore) */
export function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
