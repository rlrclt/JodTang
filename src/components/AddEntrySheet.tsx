'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { AmountInput, AmountKeys, satangFromInput } from '@/components/AmountKeypad';
import { OptionGroup, SummaryChip, TextField, optionChipClass } from '@/components/FormControls';
import { useOffline } from '@/components/Pwa';
import {
  createCashAccountAction,
  createEntryCategoryAction,
  loadEntryOptions,
  saveEntryAction,
} from '@/components/entry-actions';
import {
  type EntryKind,
  type EntryOptions,
  ENTRY_KIND_LABELS,
  SUGGESTED_CATEGORY_NAMES,
  canTransferWith,
  defaultAccountId,
  defaultCategoryId,
  entryBlockReason,
} from '@/components/entry-view';

const KINDS: EntryKind[] = ['expense', 'income', 'transfer'];

/**
 * S3 เพิ่มรายการเร็ว (design.md §4 S3 + §2 · wave 10b spec §1-4)
 * - 2 แตะเมื่อมีกระเป๋า ≥1 ใบ: FAB → (จำนวน) → บันทึก · กระเป๋าเดาจากใบที่ใช้ล่าสุด · หมวดเดาจากรายการล่าสุดของ kind
 * - แตะ chip กระเป๋า/หมวด = เปลี่ยนพื้นที่เดียวกับแป้นตัวเลข (ความสูงรวมไม่เพิ่ม)
 * - แถวปุ่มบันทึกอยู่นอกพื้นที่เลื่อน = มองเห็นตลอดแม้จอเล็ก (320×568)
 */
export function AddEntryFab() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  const openSheet = () => {
    dialogRef.current?.showModal();
    setOpen(true); // mount EntryForm → โหลดตัวเลือกชุดใหม่ทุกครั้งที่เปิด
  };

  // เปิด sheet ตรง ๆ ด้วย ?add=1 (ใช้ถ่ายสกรีนช็อต/ทดสอบโดยไม่ต้องคลิก)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('add') === '1') openSheet();
  }, []);

  // ปุ่มที่ไหนก็ได้ในแอปเปิด sheet นี้ได้ด้วย attribute `data-open-add`
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-open-add]')) openSheet();
    };
    document.addEventListener('click', onClick);
    return () => document.removeEventListener('click', onClick);
  }, []);

  // หน้าเข้าสู่ระบบไม่มีปุ่มเพิ่มรายการ — design.md §3
  if (pathname === '/login') return null;

  return (
    <>
      {/* FAB: ห่างขอบขวา 16 · เหนือแถบแท็บ 16 (§2, z-index 30 §1.6) */}
      <button
        type="button"
        onClick={openSheet}
        aria-label="เพิ่มรายการ"
        className="fixed bottom-[calc(56px+16px+env(safe-area-inset-bottom))] right-[max(16px,calc(50%-215px+16px))] z-30 flex size-14 items-center justify-center rounded-card bg-balance text-on-accent shadow-[var(--shadow-sticky)] active:scale-[0.98]"
      >
        <svg className="size-6" aria-hidden="true">
          <use href="#i-plus" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-label="เพิ่มรายการ"
        onClose={() => setOpen(false)}
        className="mt-auto mb-0 flex max-h-[100dvh] w-full max-w-[430px] flex-col rounded-t-[20px] border-0 bg-surface p-0 text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
      >
        {open ? <EntryForm onDone={() => dialogRef.current?.close()} /> : null}
      </dialog>
    </>
  );
}

/** เนื้อในชีต — mount ใหม่ทุกครั้งที่เปิด (ค่าเริ่มต้นจึงสดเสมอ) */
function EntryForm({ onDone }: { onDone: () => void }) {
  const router = useRouter();
  const offline = useOffline();
  const [options, setOptions] = useState<EntryOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<EntryKind>('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | 'account' | 'toAccount' | 'category'>(null);
  const [busy, setBusy] = useState<null | 'save' | 'create'>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setLoadError(null);
    try {
      const result = await loadEntryOptions();
      if (!result.ok) {
        setLoadError(result.message);
        return;
      }
      setOptions(result.options);
      setAccountId(defaultAccountId(result.options));
      setCategoryId(defaultCategoryId(result.options, 'expense'));
    } catch {
      setLoadError('โหลดตัวเลือกไม่สำเร็จ ลองใหม่');
    }
  };

  useEffect(() => {
    void load();
    // โหลดครั้งเดียวตอนเปิดชีต (spec §2: 1 server action) — ไม่ผูกกับ deps อื่นโดยตั้งใจ
  }, []);

  const accounts = options?.accounts ?? [];
  const categories = options && kind !== 'transfer' ? options.categories[kind] : [];
  const satang = satangFromInput(amount);
  const blockReason = options
    ? entryBlockReason({ kind, amountSatang: satang, accountId, toAccountId, categoryId, accountCount: accounts.length })
    : null;
  const canSave = Boolean(options) && blockReason === null && satang !== null && satang > 0 && busy === null && !offline;

  const changeKind = (next: EntryKind) => {
    if (next === 'transfer' && !canTransferWith(accounts.length)) return;
    setKind(next);
    setPicker(null);
    setError(null);
    if (next === 'transfer') {
      setCategoryId(null);
      setToAccountId(null);
      return;
    }
    setToAccountId(null);
    if (options) setCategoryId(defaultCategoryId(options, next)); // สลับ kind = หมวดของ kind นั้นเสมอ
  };

  const save = async () => {
    if (!canSave || satang === null || !accountId) return;
    setBusy('save');
    setError(null);
    try {
      const result = await saveEntryAction({
        kind,
        amount: satang,
        accountId,
        toAccountId: kind === 'transfer' ? toAccountId : null,
        categoryId: kind === 'transfer' ? null : categoryId,
        note,
      });
      if (!result.ok) {
        setError(result.message); // ไม่ปิดชีต + ค่าที่กรอกยังอยู่
        return;
      }
      // design §2: haptic ตอนบันทึกสำเร็จ — iOS ไม่มี navigator.vibrate จึงต้องมี fallback (ปุ่มยุบ 100ms ด้วย active:scale)
      if ('vibrate' in navigator) navigator.vibrate(10);
      onDone();
      router.refresh();
    } catch {
      setError('บันทึกไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(null);
    }
  };

  /** 0 กระเป๋า: สร้าง "เงินสด" 1 แตะ แล้วเลือกให้ทันที — ค่าที่พิมพ์ไว้ต้องไม่หาย */
  const createCashAccount = async () => {
    setBusy('create');
    setError(null);
    try {
      const result = await createCashAccountAction();
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // เพิ่มเข้า options ในเครื่องแล้วเลือกเลย — ไม่เรียก action รอบสอง (ประหยัด 1 round trip
      // และยังเลือกให้ถูกแม้เน็ตช้าที่รอบถัดไป) · ชื่อ/kind มาจากที่ action สร้างจริง ('เงินสด', 'cash')
      setOptions((prev) =>
        prev
          ? {
              ...prev,
              accounts: [...prev.accounts, { id: result.id, name: 'เงินสด' }],
              lastUsedAccountId: result.id,
            }
          : prev,
      );
      setAccountId(result.id);
      setCategoryId((prev) => prev ?? (options ? defaultCategoryId(options, kind === 'transfer' ? 'expense' : kind) : null));
    } catch {
      setError('สร้างกระเป๋าไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(null);
    }
  };

  /** ไม่มีหมวดของ kind นี้เลย → สร้าง+เลือก 1 แตะ (ห้ามพาไปหน้าตั้งค่าก่อน — spec §2) */
  const createCategory = async (name: string) => {
    if (!options || kind === 'transfer') return;
    setCreating(name);
    setError(null);
    try {
      const result = await createEntryCategoryAction({ kind, name });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      // เพิ่มในเครื่องแล้วเลือกเลย — ไม่เรียก action รอบสอง ⇒ สถานะ chip ตรงกับค่าที่จะบันทึกเสมอ
      // (เดิม: ถ้ารอบสองล้ม chip ยังโชว์ "เลือกหมวด" ทั้งที่ categoryId ถูกตั้งแล้ว)
      setOptions((prev) =>
        prev
          ? {
              ...prev,
              categories: {
                ...prev.categories,
                [kind]: [...prev.categories[kind], { id: result.id, name, color: null }],
              },
            }
          : prev,
      );
      setCategoryId(result.id);
      setPicker(null);
    } catch {
      setError('สร้างหมวดไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setCreating(null);
    }
  };

  const accountName = accounts.find((account) => account.id === accountId)?.name ?? '—';
  const toAccountName = accounts.find((account) => account.id === toAccountId)?.name ?? 'เลือกปลายทาง';
  const categoryName =
    kind === 'transfer' ? '' : (categories.find((category) => category.id === categoryId)?.name ?? 'เลือกหมวด');
  const doneButton = (
    <button
      type="button"
      onClick={() => setPicker(null)}
      className="mt-2 flex min-h-14 w-full items-center justify-center rounded-btn border border-border-strong bg-surface font-semibold"
    >
      เสร็จ
    </button>
  );

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div aria-hidden="true" className="mx-auto mb-3 h-1 w-10 rounded-pill bg-border-strong" />

        <div className="flex flex-wrap gap-2" role="group" aria-label="ประเภทรายการ">
          {KINDS.map((item) => {
            const disabled = item === 'transfer' && !canTransferWith(accounts.length);
            return (
              <button
                key={item}
                type="button"
                disabled={disabled || busy !== null}
                aria-pressed={kind === item}
                onClick={() => changeKind(item)}
                className={`${optionChipClass(kind === item)} disabled:opacity-40`}
              >
                {ENTRY_KIND_LABELS[item]}
              </button>
            );
          })}
        </div>
        {!canTransferWith(accounts.length) ? (
          <p className="mt-1 text-[13px] leading-[18px] text-text-muted">โอนต้องมีอย่างน้อย 2 กระเป๋า</p>
        ) : null}

        <AmountInput
          id="sheet-amount"
          label="จำนวนเงิน (บาท)"
          value={amount}
          onChange={setAmount}
          disabled={busy !== null}
        />

        {loadError ? (
          <div className="mt-2 flex items-center justify-between gap-2 rounded-card border border-border bg-surface-2 p-3">
            <p className="text-[13px] leading-[18px] text-warn">⚠ {loadError}</p>
            <button
              type="button"
              onClick={() => void load()}
              className="min-h-11 shrink-0 rounded-btn border border-border-strong px-3 font-semibold"
            >
              ลองใหม่
            </button>
          </div>
        ) : null}

        <div className="mt-2 flex gap-2">
          {options === null && !loadError ? (
            <p className="flex min-h-11 flex-1 items-center text-[13px] leading-[18px] text-text-muted">กำลังโหลดตัวเลือก…</p>
          ) : accounts.length === 0 ? (
            // 0 กระเป๋า: ทางออก 1 แตะ (spec §1) — ค่าที่พิมพ์ไว้ไม่หายเพราะไม่ remount
            <button
              type="button"
              onClick={createCashAccount}
              disabled={busy !== null}
              className="flex min-h-11 flex-1 items-center justify-center rounded-btn bg-balance px-3 font-bold text-on-accent disabled:opacity-40"
            >
              {busy === 'create' ? 'กำลังสร้าง…' : '＋ สร้างกระเป๋า เงินสด'}
            </button>
          ) : (
            <>
              <SummaryChip
                label="กระเป๋า"
                value={accountName}
                readOnly={accounts.length === 1} // ใบเดียว = ไม่มีอะไรให้เลือก (spec §1)
                onClick={() => setPicker('account')}
                disabled={busy !== null}
              />
              {kind === 'transfer' ? (
                <SummaryChip
                  label="ไปกระเป๋า"
                  value={toAccountName}
                  onClick={() => setPicker('toAccount')}
                  disabled={busy !== null}
                />
              ) : (
                <SummaryChip
                  label="หมวด"
                  value={categoryName}
                  onClick={() => setPicker('category')}
                  disabled={busy !== null}
                />
              )}
            </>
          )}
        </div>

        <TextField
          id="entry-note"
          label="โน้ต (ไม่บังคับ)"
          value={note}
          onChange={setNote}
          disabled={busy !== null}
          placeholder="เช่น กาแฟเช้า"
        />

        {/* พื้นที่เดียวสลับกัน: แป้นตัวเลข ⇄ ตัวเลือก (ความสูงรวมไม่เพิ่ม — spec §4) */}
        {picker === 'account' ? (
          <>
            <OptionGroup
              label="กระเป๋า"
              options={accounts}
              value={accountId ?? undefined}
              onChange={(next) => {
                setAccountId(next ?? null);
                setToAccountId((prev) => (prev === next ? null : prev));
                setPicker(null); // เลือกแล้วกลับไปที่แป้นทันที (เปลี่ยนกระเป๋า = แตะเดียว)
              }}
              disabled={busy !== null}
            />
            {doneButton}
          </>
        ) : picker === 'toAccount' ? (
          <>
            <OptionGroup
              label="ไปกระเป๋า"
              options={accounts.filter((account) => account.id !== accountId)}
              value={toAccountId ?? undefined}
              onChange={(next) => {
                setToAccountId(next ?? null);
                setPicker(null);
              }}
              disabled={busy !== null}
            />
            {doneButton}
          </>
        ) : picker === 'category' ? (
          <>
            {categories.length > 0 ? (
              <OptionGroup
                label="หมวด"
                options={categories}
                value={categoryId ?? undefined}
                onChange={(next) => {
                  setCategoryId(next ?? null);
                  setPicker(null);
                }}
                disabled={busy !== null}
              />
            ) : (
              <>
                <p className="mt-2 text-[13px] leading-[18px] text-text-muted">
                  ยังไม่มีหมวด{CATEGORY_KIND_HINT[kind === 'transfer' ? 'expense' : kind]} — เลือกเพื่อสร้างได้เลย
                </p>
                <div className="mt-1 flex flex-wrap gap-2">
                  {SUGGESTED_CATEGORY_NAMES[kind === 'transfer' ? 'expense' : kind].map((name) => (
                    <button
                      key={name}
                      type="button"
                      disabled={busy !== null || creating !== null}
                      onClick={() => createCategory(name)}
                      className={`${optionChipClass(false)} disabled:opacity-40`}
                    >
                      {creating === name ? 'กำลังสร้าง…' : `＋ ${name}`}
                    </button>
                  ))}
                </div>
              </>
            )}
            {doneButton}
          </>
        ) : (
          <AmountKeys value={amount} onChange={setAmount} disabled={busy !== null} />
        )}
      </div>

      {/* แถวล่าง: อยู่นอกพื้นที่เลื่อน → มองเห็นตลอด (acceptance 6) */}
      <div className="border-t border-border bg-surface px-4 pb-[calc(16px+env(safe-area-inset-bottom))] pt-3">
        {offline ? (
          <p className="mb-2 text-[13px] leading-[18px] text-warn">
            ออฟไลน์อยู่ — บันทึกใหม่ยังไม่ได้ (คิวออฟไลน์จะมาในเวอร์ชันถัดไป)
          </p>
        ) : null}
        {error ? (
          <p role="alert" className="mb-2 text-[13px] leading-[18px] text-warn">
            ⚠ {error}
          </p>
        ) : null}
        {blockReason && !loadError ? (
          <p className="mb-2 text-[13px] leading-[18px] text-warn">⚠ {blockReason}</p>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onDone}
            className="min-h-14 rounded-btn border border-border px-4 font-semibold"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!canSave}
            className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
          >
            {busy === 'save' ? 'กำลังบันทึก…' : 'บันทึก'}
          </button>
        </div>
      </div>
    </>
  );
}

/** คำที่ใช้ต่อท้ายข้อความ "ยังไม่มีหมวด…" */
const CATEGORY_KIND_HINT: Record<'income' | 'expense', string> = {
  income: 'รายรับ',
  expense: 'รายจ่าย',
};
