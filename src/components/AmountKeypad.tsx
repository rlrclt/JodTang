'use client';

import type { ReactNode, Ref } from 'react';

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'back'] as const;
const QUICK = ['20', '50', '100', '500'] as const;

/** เพดานหลักของช่องจำนวน — 10 หลัก + ทศนิยม 2 = 9999999999.99 บาท (ยังต่ำกว่าช่วง safe integer ของสตางค์) */
const MAX_DIGITS = 10;

/**
 * สตริงบาทที่พิมพ์อยู่ → สตริงบาทถัดไป (ตรรกะของแป้น: ลบทีละตัว · จุดเดียว · ทศนิยม 2 ตำแหน่ง · เพดานหลัก)
 * เป็นฟังก์ชันบริสุทธิ์เพื่อให้ตรวจได้โดยไม่ต้องมี DOM
 */
export function nextAmount(current: string, key: string): string {
  if (key === 'back') return current.slice(0, -1);
  if (key === '.') return current.includes('.') ? current : current === '' ? '0.' : `${current}.`;
  if (/\.\d\d$/.test(current)) return current; // ทศนิยมครบ 2 ตำแหน่งแล้ว
  if (current.replace('.', '').length >= MAX_DIGITS) return current;
  return current === '0' ? key : current + key;
}

/**
 * สตริงบาท → สตางค์ (จำนวนเต็ม) โดยไม่ผ่าน float
 * '120.5' → 12050 · '' หรือ '.' → null
 * ห้ามใช้ Number(value) * 100: 8.29 × 100 = 828.9999999999999 → สตางค์เพี้ยน
 */
export function satangFromInput(value: string): number | null {
  const match = /^(\d*)(?:\.(\d{0,2}))?$/.exec(value);
  if (!match) return null;
  const [baht = '', fraction = ''] = match.slice(1);
  if (baht === '' && fraction === '') return null;
  return Number(`${baht === '' ? '0' : baht}${fraction.padEnd(2, '0')}`);
}

/**
 * สตางค์ → สตริงในช่องกรอก ('120050' → '1200.50') โดยใช้จำนวนเต็มล้วน
 * คู่กลับของ satangFromInput() — อยู่ไฟล์เดียวกันเพื่อให้มีที่แปลงเดียวต่อทิศทาง
 * (ไม่ใช้ formatSatang: อันนั้นมีสัญลักษณ์ ฿ กับตัวคั่นหลักพัน ซึ่งใช้เป็นค่าใน <input> ไม่ได้)
 */
export function inputFromSatang(satang: number): string {
  return `${Math.floor(satang / 100)}.${String(satang % 100).padStart(2, '0')}`;
}

type Props = {
  /** ใช้คู่กับ <label htmlFor> — ต้องไม่ซ้ำกันในหน้าเดียว */
  id: string;
  label: string;
  /** สตริงบาทที่ผู้ใช้พิมพ์ (คุมค่าจากผู้เรียก) */
  value: string;
  onChange: (next: string) => void;
  /** ข้อความช่วยใต้ช่องกรอก (เช่น "วันนี้ · หมวด: อาหาร") */
  hint?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  disabled?: boolean;
};

/**
 * ช่องจำนวนเงินของแอป (design.md §2) — <input> จริงเสมอ (`inputmode="decimal"`) เพื่อให้
 * screen reader/คีย์บอร์ดระบบใช้ได้ · ตัวเลข tabular + ชิดขวา (§1.2)
 * แยกจากแป้นเพื่อให้ชีต "เพิ่มรายการ" วางแถวสรุป/โน้ตคั่นกลางได้ (wave 10b spec §4)
 */
export function AmountInput({ id, label, value, onChange, hint, inputRef, disabled }: Props) {
  return (
    <>
      <label htmlFor={id} className="mt-3 block text-[13px] leading-[18px] text-text-muted">
        {label}
      </label>
      <div className="mt-1 flex min-h-14 items-center gap-1.5 rounded-input border border-border-strong bg-surface-2 px-3">
        <span aria-hidden="true" className="font-semibold">
          ฿
        </span>
        <input
          id={id}
          ref={inputRef}
          value={value}
          onChange={(event) => onChange(event.target.value.replace(/[^0-9.]/g, ''))}
          inputMode="decimal"
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0"
          disabled={disabled}
          className="num min-h-11 w-full bg-transparent text-right text-2xl font-semibold outline-none"
        />
      </div>
      {hint ? <p className="mt-1 text-[13px] leading-[18px] text-text-muted">{hint}</p> : null}
    </>
  );
}

/** ปุ่มลัดยอด + แป้นตัวเลข (สลับพื้นที่กับตัวเลือกกระเป๋า/หมวดได้ — ความสูงรวมไม่เพิ่ม) */
export function AmountKeys({ value, onChange, disabled }: Pick<Props, 'value' | 'onChange' | 'disabled'>) {
  // ปุ่มที่กดแล้ว "ค่าไม่เปลี่ยน" ต้องปิดให้เห็น ไม่ใช่เงียบ ๆ (reviewer เจอเคส value='0' + กด 0)
  // ใช้เกณฑ์เดียวกับการกดจริง: ปุ่มตาย ⇔ nextAmount(value, key) คืนค่าเดิม (ไม่ต้องไล่เงื่อนไขซ้ำ)
  const isDead = (key: string) => nextAmount(value, key) === value;

  return (
    <>
      <div className="mt-2 grid grid-cols-4 gap-2">
        {QUICK.map((amount) => (
          <button
            key={amount}
            type="button"
            disabled={disabled}
            onClick={() => onChange(amount)}
            className="min-h-11 rounded-btn border border-border bg-surface-2 font-semibold disabled:opacity-40"
          >
            {amount}
          </button>
        ))}
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={disabled || isDead(key)}
            onClick={() => onChange(nextAmount(value, key))}
            aria-label={key === 'back' ? 'ลบทีละตัว' : key === '.' ? 'จุดทศนิยม' : key}
            className="flex min-h-14 items-center justify-center rounded-input border border-border bg-surface-2 text-xl font-semibold active:scale-[0.98] disabled:opacity-40"
          >
            {key === 'back' ? (
              <svg className="size-5" aria-hidden="true">
                <use href="#i-back" />
              </svg>
            ) : (
              key
            )}
          </button>
        ))}
      </div>
    </>
  );
}

/**
 * ช่องจำนวน + แป้นติดกัน (ผู้ใช้เดิม: sheet ตั้งงบ) — เท่ากับ AmountInput + AmountKeys
 * ชีตที่ต้องแทรกแถวสรุป/โน้ตระหว่างสองส่วน ให้ประกอบเองจาก 2 component ข้างบน
 */
export function AmountKeypad(props: Props) {
  return (
    <>
      <AmountInput {...props} />
      <AmountKeys value={props.value} onChange={props.onChange} disabled={props.disabled} />
    </>
  );
}
