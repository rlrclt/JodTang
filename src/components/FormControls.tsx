'use client';

/**
 * ฟอร์มพื้นฐานที่ใช้ร่วมกันทุก sheet ของหน้าตั้งค่า (หมวด/กระเป๋า)
 * - `TextField`: label จริง (ไม่ใช้ placeholder ทำหน้าที่แทน label — design §5) · ช่องสูง ≥44px
 * - `OptionChips`: เลือกได้ตัวเดียว (kind) — chip แพตเทิร์นเดียวกับปุ่มกรองในหน้ารายการ
 */

/** chip เลือกได้ตัวเดียว: active = border-border-strong + bg-surface-2 + font-bold (แพตเทิร์นเดิมของแอป) */
export const optionChipClass = (active: boolean) =>
  `flex min-h-11 items-center rounded-btn border px-4 font-semibold ${
    active ? 'border-border-strong bg-surface-2 font-bold' : 'border-border bg-surface text-text'
  }`;

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** id ของข้อความ error ของชีต (a11y): มีค่า = ช่องนี้ถูกทำเครื่องหมายว่าผิด + ผูกกับข้อความนั้นด้วย aria-describedby */
  errorId?: string;
};

export function TextField({ id, label, value, onChange, disabled, placeholder, autoFocus, errorId }: TextFieldProps) {
  return (
    <>
      <label htmlFor={id} className="mt-3 block text-[13px] leading-[18px] text-text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        enterKeyHint="done"
        autoFocus={autoFocus}
        aria-invalid={errorId ? true : undefined}
        aria-describedby={errorId}
        className="mt-1 min-h-14 w-full rounded-input border border-border-strong bg-surface-2 px-3 outline-none"
      />
    </>
  );
}

type OptionChipsProps<T extends string> = {
  legend: string;
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (next: T) => void;
  disabled?: boolean;
};

/** กลุ่มตัวเลือกแบบเลือกได้ตัวเดียว — ใช้ <fieldset>/<legend> เพื่อให้ screen reader อ่านหัวกลุ่ม */
export function OptionChips<T extends string>({ legend, options, value, onChange, disabled }: OptionChipsProps<T>) {
  return (
    <fieldset className="mt-3">
      <legend className="text-[13px] leading-[18px] text-text-muted">{legend}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={`${optionChipClass(value === option.id)} disabled:opacity-40`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type OptionGroupProps = {
  label: string;
  /** ไม่ส่ง = ไม่มีปุ่ม "ทั้งหมด" (ชีตเลือกกระเป๋า/หมวดต้องเลือกค่าจริงเสมอ) */
  allLabel?: string;
  options: readonly { id: string; name: string; color?: string | null }[];
  value: string | undefined;
  onChange: (next: string | undefined) => void;
  disabled?: boolean;
};

/**
 * กลุ่มตัวเลือกแบบมี "ทั้งหมด" (ย้ายมาจาก TransactionFilters — spec §4: 1 implementation)
 * ใช้ทั้งในชีตตัวกรองรายการ และชีตเลือกกระเป๋า/หมวดของ "เพิ่มรายการ"
 */
export function OptionGroup({ label, allLabel, options, value, onChange, disabled }: OptionGroupProps) {
  return (
    <fieldset className="mt-2">
      <legend className="text-[13px] leading-[18px] text-text-muted">{label}</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {allLabel ? (
          <button
            type="button"
            disabled={disabled}
            aria-pressed={value === undefined}
            onClick={() => onChange(undefined)}
            className={`${optionChipClass(value === undefined)} disabled:opacity-40`}
          >
            {allLabel}
          </button>
        ) : null}
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            disabled={disabled}
            aria-pressed={value === option.id}
            onClick={() => onChange(option.id)}
            className={`${optionChipClass(value === option.id)} disabled:opacity-40`}
          >
            {option.color ? (
              <span
                aria-hidden="true"
                className="mr-2 size-2.5 rounded-pill"
                style={{ background: `var(${option.color})` }}
              />
            ) : null}
            {option.name}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

type SummaryChipProps = {
  label: string;
  value: string;
  onClick?: () => void;
  /** true = แสดงเป็นข้อความอ่านอย่างเดียว (เช่น มีกระเป๋าใบเดียว = ไม่มีอะไรให้เลือก — spec §1) */
  readOnly?: boolean;
  disabled?: boolean;
};

/** แถวสรุป 44px ของชีตเพิ่มรายการ: [กระเป๋า: เงินสด] [หมวด: อาหาร] — แตะ = เปลี่ยน (1 แตะ) */
export function SummaryChip({ label, value, onClick, readOnly, disabled }: SummaryChipProps) {
  const labelSpan = <span className="shrink-0 text-[13px] leading-[18px] text-text-muted">{label}</span>;
  const valueSpan = <span className="min-w-0 flex-1 truncate text-left font-semibold">{value}</span>;

  if (readOnly) {
    return (
      <p className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-btn border border-border bg-surface px-3">
        {labelSpan}
        {valueSpan}
      </p>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-11 min-w-0 flex-1 items-center gap-1 rounded-btn border border-border-strong bg-surface-2 px-3 disabled:opacity-40"
    >
      {labelSpan}
      {valueSpan}
      <svg className="size-4 shrink-0 text-text-muted" aria-hidden="true">
        <use href="#i-chevron-right" />
      </svg>
    </button>
  );
}
