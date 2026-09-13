'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { OptionGroup, optionChipClass } from '@/components/FormControls';
import { buildHref, searchInputAfterUrlChange } from '@/components/transactions-view';

export type CategoryOption = { id: string; name: string; color: string | null };
export type AccountOption = { id: string; name: string };

export type ActiveFilters = {
  kind?: string;
  categoryId?: string;
  accountId?: string;
  q?: string;
};

const KIND_CHIPS = [
  { id: undefined, label: 'ทั้งหมด' },
  { id: 'income', label: 'รับ' },
  { id: 'expense', label: 'จ่าย' },
  { id: 'transfer', label: 'โอน' },
] as const;

/**
 * ช่องค้นหา — debounce 300ms แล้ว `router.replace` (ไม่ push: Back ต้องย้อนทีละหน้า ไม่ใช่ทีละตัวอักษร — spec §2)
 * กด Enter ยิงทันที · ค้นทั้งโน้ตและชื่อหมวด (API ทำแล้ว) จึงบอกขอบเขตใน placeholder
 *
 * **การซิงก์กับ URL** (บั๊ก wave 8: "ล้างตัวกรอง" ล้างคำค้นไม่ได้ เพราะ local state เดิม re-apply ผ่าน replace):
 * prop `q` คือค่าจาก URL · effect ข้างล่างเทียบกับ `lastRequested` ซึ่งเป็นค่าที่ **เราเอง** สั่งนำทางล่าสุด
 *   - `q` เปลี่ยนเพราะคำสั่งของเรา (ผลของ replace ที่เพิ่งยิง) → ไม่แตะ state ผู้ใช้ (กันพิมพ์ค้างระหว่าง round-trip หาย)
 *   - `q` เปลี่ยนจากที่อื่น (ล้างตัวกรอง · ลิงก์เปลี่ยนเดือน · Back/Forward · ปุ่ม ✕) → ช่องค้นหาต้องตรงกับ URL เสมอ
 * เลือกวิธีนี้ (ไม่ใช้ `key={q}` เพราะ remount จะทำ focus หลุดกลางคัน · ไม่ใช้ `useSearchParams` เป็นแหล่งเดียว
 * เพราะต้องมี draft ระหว่างพิมพ์อยู่ดี) และการซิงก์เป็นแค่ setState — ไม่ยิง request เพิ่ม · debounce 300ms เท่าเดิม
 */
export function SearchBox({ base, q }: { base: string; q: string }) {
  const router = useRouter();
  const [value, setValue] = useState(q);
  const lastRequested = useRef(q);

  useEffect(() => {
    const next = searchInputAfterUrlChange(q, lastRequested.current, value);
    if (next === null) return; // URL เปลี่ยนเพราะเราเพิ่งสั่งเอง — อย่าไปเขียนทับสิ่งที่ผู้ใช้พิมพ์
    lastRequested.current = q;
    setValue(next);
  }, [q, value]);

  useEffect(() => {
    if (value === q) return;
    const timer = setTimeout(() => {
      lastRequested.current = value;
      router.replace(buildHref(base, { q: value === '' ? undefined : value }));
    }, 300);
    return () => clearTimeout(timer);
  }, [value, q, base, router]);

  const submitNow = () => {
    lastRequested.current = value;
    router.replace(buildHref(base, { q: value === '' ? undefined : value }));
  };

  return (
    <div className="flex min-h-14 items-center gap-2 rounded-input border border-border-strong bg-surface px-3">
      <svg className="size-5 shrink-0 text-text-muted" aria-hidden="true">
        <use href="#i-search" />
      </svg>
      {/* label จริง (ไม่ใช้ placeholder ทำหน้าที่แทน label — §5) */}
      <label className="sr-only" htmlFor="q">
        ค้นหารายการจากโน้ตหรือชื่อหมวด
      </label>
      <input
        id="q"
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submitNow();
        }}
        placeholder="ค้นหาโน้ต/ชื่อหมวด"
        autoComplete="off"
        enterKeyHint="search"
        className="min-h-11 w-full bg-transparent outline-none"
      />
      {value ? (
        <button type="button" onClick={() => setValue('')} aria-label="ล้างคำค้น" className="min-h-11 shrink-0 px-1 text-text-muted">
          ✕
        </button>
      ) : null}
    </div>
  );
}

/** แถว chips เลื่อนแนวนอน + ปุ่มเปิด sheet หมวด/กระเป๋า (spec §2) */
export function FilterBar({
  base,
  active,
  categories,
  accounts,
}: {
  base: string;
  active: ActiveFilters;
  categories: readonly CategoryOption[];
  accounts: readonly AccountOption[];
}) {
  const [open, setOpen] = useState(false);
  const sheetCount = (active.categoryId ? 1 : 0) + (active.accountId ? 1 : 0);

  return (
    <>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="group" aria-label="ตัวกรองรายการ">
        {KIND_CHIPS.map((chip) => (
          <Link key={chip.label} href={buildHref(base, { kind: chip.id })} className={optionChipClass(active.kind === chip.id)}>
            {chip.label}
          </Link>
        ))}
        <button type="button" onClick={() => setOpen(true)} className={optionChipClass(sheetCount > 0)}>
          ตัวกรอง{sheetCount > 0 ? ` (${sheetCount})` : ''}
        </button>
      </div>

      {open ? (
        <FilterSheet
          base={base}
          active={active}
          categories={categories}
          accounts={accounts}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/**
 * sheet เลือกหมวด + กระเป๋า (มีได้หลายสิบรายการ ไม่ควรเป็น chip) — `<dialog>` แพตเทิร์นเดียวกับ sheet อื่น
 * เลือกได้อย่างละ 1 (spec §2: พร้อมกันสูงสุด 4 ตัว = ประเภท/หมวด/กระเป๋า/คำค้น)
 */
function FilterSheet({
  base,
  active,
  categories,
  accounts,
  onClose,
}: {
  base: string;
  active: ActiveFilters;
  categories: readonly CategoryOption[];
  accounts: readonly AccountOption[];
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [categoryId, setCategoryId] = useState(active.categoryId);
  const [accountId, setAccountId] = useState(active.accountId);

  useEffect(() => {
    dialogRef.current?.showModal();
  }, []);

  const apply = () => {
    router.replace(buildHref(base, { categoryId, accountId }));
    dialogRef.current?.close();
  };

  return (
    <dialog
      ref={dialogRef}
      aria-label="ตัวกรองรายการ"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialogRef.current) dialogRef.current?.close(); // แตะฉากหลัง = ปิด
      }}
      className="mt-auto mb-0 w-full max-w-[430px] rounded-t-[20px] border-0 bg-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
    >
      <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />

      <OptionGroup
        label="หมวด"
        allLabel="ทุกหมวด"
        options={categories}
        value={categoryId}
        onChange={setCategoryId}
      />
      <OptionGroup label="กระเป๋าเงิน" allLabel="ทุกกระเป๋า" options={accounts} value={accountId} onChange={setAccountId} />

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => {
            setCategoryId(undefined);
            setAccountId(undefined);
          }}
          className="min-h-14 rounded-btn border border-border px-4 font-semibold"
        >
          ล้างในชีต
        </button>
        <button type="button" onClick={apply} className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent">
          ใช้ตัวกรอง
        </button>
      </div>
    </dialog>
  );
}
