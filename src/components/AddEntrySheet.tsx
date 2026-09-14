'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';

import { AmountInput, AmountKeys, inputFromSatang, satangFromInput } from '@/components/AmountKeypad';
import { OptionGroup, SummaryChip, TextField, optionChipClass } from '@/components/FormControls';
import { useOffline } from '@/components/Pwa';
import { announce } from '@/components/announce-store';
import {
  createCashAccountAction,
  createEntryCategoryAction,
  deleteEntryAction,
  loadEntryForEditAction,
  loadEntryOptions,
  saveEntryAction,
  updateEntryAction,
  type EditableEntry,
} from '@/components/entry-actions';
import {
  type EntryErrorField,
  type EntryKind,
  type EntryOptions,
  ENTRY_KIND_LABELS,
  entryErrorField,
  SUGGESTED_CATEGORY_NAMES,
  bangkokDateValue,
  bangkokTodayValue,
  bangkokYesterdayValue,
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
/** เป้าหมายของชีต: เพิ่มใหม่ หรือ แก้รายการที่บันทึกแล้ว (wave17) — ฟอร์มชุดเดียวกันทั้งสองโหมด */
type SheetTarget = { mode: 'add' } | { mode: 'edit'; id: string };

/**
 * คืนโฟกัสหลังชีตปิด (a11y — spec §5): แถวเดิมถ้ายังอยู่ (แก้) · หัวลิสต์ถ้าลบไปแล้ว
 * หน่วงสั้น ๆ เพราะ router.refresh() ยังเรนเดอร์ไม่เสร็จตอนชีตปิด — หาไม่เจอก็ไม่ทำอะไร (ไม่ throw)
 */
function focusAfterSheet(entryId: string, removed: boolean) {
  window.setTimeout(() => {
    const row = removed ? null : document.querySelector<HTMLElement>(`[data-open-edit="${CSS.escape(entryId)}"]`);
    if (row) {
      row.focus();
      return;
    }
    const heading = document.querySelector<HTMLElement>('#recent-label, #transactions-label, h1');
    if (!heading) return;
    heading.setAttribute('tabindex', '-1'); // หัวเรื่องโฟกัสได้เฉพาะเมื่อเราสั่ง (ไม่เข้า tab order)
    heading.focus();
  }, 400);
}

export function AddEntryFab() {
  const pathname = usePathname();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [target, setTarget] = useState<SheetTarget | null>(null);

  const openSheet = (next: SheetTarget) => {
    dialogRef.current?.showModal();
    setTarget(next); // mount EntryForm → โหลดตัวเลือกชุดใหม่ทุกครั้งที่เปิด
  };

  // เปิด sheet ตรง ๆ ด้วย ?add=1 · ?edit=<id> (ใช้ถ่ายสกรีนช็อต/ทดสอบโดยไม่ต้องคลิก)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const edit = params.get('edit');
    if (params.get('add') === '1') openSheet({ mode: 'add' });
    else if (edit) openSheet({ mode: 'edit', id: edit });
  }, []);

  // เปิดชีตจากที่ไหนก็ได้: `data-open-add` (เพิ่ม) · `data-open-edit="<id>"` (แก้ — ใช้ทั้งหน้าแรกและ /transactions)
  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (!(event.target instanceof Element)) return;
      const id = event.target.closest('[data-open-edit]')?.getAttribute('data-open-edit');
      if (id) {
        openSheet({ mode: 'edit', id });
        return;
      }
      if (event.target.closest('[data-open-add]')) openSheet({ mode: 'add' });
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
        onClick={() => openSheet({ mode: 'add' })}
        aria-label="เพิ่มรายการ"
        className="fixed bottom-[calc(56px+16px+env(safe-area-inset-bottom))] right-[max(16px,calc(50%-215px+16px))] z-30 flex size-14 items-center justify-center rounded-card bg-balance text-on-accent shadow-[var(--shadow-sticky)] active:scale-[0.98]"
      >
        <svg className="size-6" aria-hidden="true">
          <use href="#i-plus" />
        </svg>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="entry-sheet-title"
        onClose={() => setTarget(null)}
        className="mt-auto mb-0 flex max-h-[100dvh] w-full max-w-[430px] flex-col rounded-t-[20px] border-0 bg-surface p-0 text-text shadow-[var(--shadow-sheet)] backdrop:bg-[rgb(2_6_23_/_0.45)] sm:mx-auto"
      >
        {target ? (
          <EntryForm
            key={target.mode === 'edit' ? `edit:${target.id}` : 'add'}
            target={target}
            onDone={() => dialogRef.current?.close()}
          />
        ) : null}
      </dialog>
    </>
  );
}

/** เนื้อในชีต — mount ใหม่ทุกครั้งที่เปิด (ค่าเริ่มต้นจึงสดเสมอ) · โหมดแก้ prefill จาก loadEntryForEdit */
function EntryForm({ target, onDone }: { target: SheetTarget; onDone: () => void }) {
  const router = useRouter();
  const offline = useOffline();
  const entryId = target.mode === 'edit' ? target.id : null;
  const editing = entryId !== null;
  const [options, setOptions] = useState<EntryOptions | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kind, setKind] = useState<EntryKind>('expense');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(() => bangkokTodayValue());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [toAccountId, setToAccountId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | 'account' | 'toAccount' | 'category'>(null);
  const [busy, setBusy] = useState<null | 'save' | 'create' | 'delete'>(null);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      // โหมดแก้: 2 action พร้อมกัน (ตัวเลือก + ตัวรายการ) = ยังรอรอบเดียว
      const [optionsResult, entryResult] = await Promise.all([
        loadEntryOptions(),
        entryId !== null ? loadEntryForEditAction(entryId) : Promise.resolve(null),
      ]);
      if (!optionsResult.ok) {
        setLoadError(optionsResult.message);
        return;
      }
      if (entryResult && !entryResult.ok) {
        setLoadError(entryResult.message); // เช่น "ไม่พบรายการนี้ (อาจถูกลบไปแล้ว)" — ข้อความไทย ไม่ใช่ 500
        return;
      }
      setOptions(optionsResult.options);

      if (entryResult?.ok) {
        // prefill ค่าจริงจาก DB · kind ตั้งครั้งเดียวตรงนี้ (โหมดแก้ไม่มีชิปเปลี่ยนทิศทาง)
        const row: EditableEntry = entryResult.entry;
        setKind(row.kind);
        setAmount(inputFromSatang(row.amount));
        setAccountId(row.accountId);
        setToAccountId(row.toAccountId);
        setCategoryId(row.categoryId);
        setNote(row.note ?? '');
        setDate(bangkokDateValue(new Date(row.occurredAt)));
        return;
      }

      setAccountId(defaultAccountId(optionsResult.options));
      setCategoryId(defaultCategoryId(optionsResult.options, 'expense'));
    } catch {
      setLoadError('โหลดตัวเลือกไม่สำเร็จ ลองใหม่');
    }
    // ขึ้นกับ entryId ตัวเดียว: ฟอร์มถูก mount ใหม่ทุกครั้งที่เปิด (key ที่ AddEntryFab) → โหลดรอบเดียวต่อการเปิด 1 ครั้ง
  }, [entryId]);

  useEffect(() => {
    void load();
  }, [load]);

  const accounts = options?.accounts ?? [];
  const categories = options && kind !== 'transfer' ? options.categories[kind] : [];
  const satang = satangFromInput(amount);
  const blockReason = options
    ? entryBlockReason({ kind, amountSatang: satang, accountId, toAccountId, categoryId, accountCount: accounts.length })
    : null;
  // error รายช่อง: ทำเครื่องหมาย aria-invalid เฉพาะช่องที่ข้อความชี้ถึง (ไม่ประทับทั้งชีต)
  const errorField: EntryErrorField | null = error ? entryErrorField(error) : null;
  const errorId = (field: EntryErrorField) => (errorField === field ? 'entry-error' : undefined);

  // โหมดแก้ต้องมีวันที่จริง (ล้างช่องวันที = '' → ห้ามบันทึก ไม่ปล่อยให้ action โยนกลับมา)
  const dateOk = !editing || date !== '';
  const canSave =
    Boolean(options) && blockReason === null && satang !== null && satang > 0 && busy === null && !offline && dateOk;

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
      // ประกอบร่างทีละฟิลด์ (ไม่ spread ของ client) — โอนส่ง toAccountId ไม่มีหมวด · รับ/จ่ายตรงข้าม
      const payload = {
        kind,
        amount: satang,
        accountId,
        toAccountId: kind === 'transfer' ? toAccountId : null,
        categoryId: kind === 'transfer' ? null : categoryId,
        note,
      };
      const result = entryId
        ? await updateEntryAction({ id: entryId, occurredAt: date, ...payload })
        : await saveEntryAction(payload);
      if (!result.ok) {
        setError(result.message); // ไม่ปิดชีต + ค่าที่กรอกยังอยู่
        return;
      }
      // design §2: haptic ตอนบันทึกสำเร็จ — iOS ไม่มี navigator.vibrate จึงต้องมี fallback (ปุ่มยุบ 100ms ด้วย active:scale)
      if ('vibrate' in navigator) navigator.vibrate(10);
      // ประกาศผ่าน live region ถาวรใน layout (aria-live) — เพิ่ม/แก้ ต้องได้ยินเหมือนกัน (wave18b)
      announce(entryId ? 'บันทึกการแก้ไขแล้ว' : 'บันทึกรายการแล้ว');
      onDone();
      router.refresh();
      if (entryId) focusAfterSheet(entryId, false);
    } catch {
      setError(editing ? 'บันทึกการแก้ไขไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)' : 'บันทึกไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
    } finally {
      setBusy(null);
    }
  };

  /** ลบ = soft delete 2 ขั้น (ยืนยันในชีตเดียวกัน ไม่ซ้อน dialog — แพตเทิร์นเดียวกับเลิกใช้หมวด) */
  const remove = async () => {
    if (!entryId) return;
    setBusy('delete');
    setError(null);
    try {
      const result = await deleteEntryAction(entryId);
      if (!result.ok) {
        setError(result.message); // ชีตไม่ปิด · ยืนยันยังอยู่ กดซ้ำได้
        return;
      }
      if ('vibrate' in navigator) navigator.vibrate(10);
      announce('ลบรายการแล้ว');
      onDone();
      router.refresh();
      focusAfterSheet(entryId, true);
    } catch {
      setError('ลบรายการไม่สำเร็จ ลองใหม่ (เน็ตมีปัญหา)');
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
        {/* หัวเรื่องของชีต — ซ่อนด้วยตาแต่ให้ dialog ใช้เป็นชื่อ (aria-labelledby) ไม่ต้องมี aria-label ซ้ำ */}
        <h2 id="entry-sheet-title" className="sr-only">
          {editing ? 'แก้ไขรายการ' : 'เพิ่มรายการ'}
        </h2>

        {editing ? (
          // kind แก้ไม่ได้โดยตั้งใจ (เปลี่ยนแล้วรูปร่าง to_account/category ต้องรื้อ) → อ่านอย่างเดียว ไม่มีชิปเปลี่ยนทิศทาง
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="ประเภทรายการ">
            <span className="flex min-h-11 items-center rounded-btn border border-border bg-surface-2 px-4 font-bold">
              {ENTRY_KIND_LABELS[kind]}
            </span>
            <span className="text-[13px] leading-[18px] text-text-muted">
              ประเภทแก้ไม่ได้ — ถ้าต้องสลับรับ/จ่าย ให้ลบแล้วบันทึกใหม่
            </span>
          </div>
        ) : (
          <>
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
          </>
        )}

        <AmountInput
          id="sheet-amount"
          errorId={errorId('amount')}
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
          errorId={errorId('note')}
          label="โน้ต (ไม่บังคับ)"
          value={note}
          onChange={setNote}
          disabled={busy !== null}
          placeholder="เช่น กาแฟเช้า"
        />

        {/* วันที่: เฉพาะโหมดแก้ (โหมดเพิ่มใช้ "ตอนนี้" เสมอ เพื่อคง 2 แตะ) — design.md §2: native date + ปุ่มลัด */}
        {editing ? (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="entry-date" className="text-[13px] leading-[18px] text-text-muted">
                วันที่
              </label>
              <input
                id="entry-date"
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                disabled={busy !== null}
                aria-invalid={errorId('date') ? true : undefined}
                aria-describedby={errorId('date')}
                className="num ml-auto min-h-11 rounded-input border border-border-strong bg-surface px-3 text-right disabled:opacity-40"
              />
              <button
                type="button"
                onClick={() => setDate(bangkokTodayValue())}
                disabled={busy !== null}
                aria-pressed={date === bangkokTodayValue()}
                className={`${optionChipClass(date === bangkokTodayValue())} disabled:opacity-40`}
              >
                วันนี้
              </button>
              <button
                type="button"
                onClick={() => setDate(bangkokYesterdayValue())}
                disabled={busy !== null}
                aria-pressed={date === bangkokYesterdayValue()}
                className={`${optionChipClass(date === bangkokYesterdayValue())} disabled:opacity-40`}
              >
                เมื่อวาน
              </button>
            </div>
            {date === '' ? (
              <p className="mt-1 text-[13px] leading-[18px] text-warn">⚠ เลือกวันที่ก่อนบันทึก</p>
            ) : null}
          </div>
        ) : null}

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
          <p id="entry-error" role="alert" className="mb-2 text-[13px] leading-[18px] text-warn">
            ⚠ {error}
          </p>
        ) : null}
        {blockReason && !loadError ? (
          // role=status: เหตุผลที่บันทึกไม่ได้ต้องถูกประกาศด้วย ไม่ใช่เห็นอย่างเดียว (ผู้ใช้ screen reader จะค้างหน้าปุ่มที่กดไม่ได้)
          <p id="entry-block-reason" role="status" className="mb-2 text-[13px] leading-[18px] text-warn">
            ⚠ {blockReason}
          </p>
        ) : null}

        <div className="flex justify-end gap-2">
          {editing && !confirmingDelete ? (
            <button
              type="button"
              onClick={() => setConfirmingDelete(true)}
              disabled={busy !== null}
              className="min-h-14 rounded-btn border border-border px-4 font-semibold text-warn disabled:opacity-40"
            >
              ลบรายการนี้
            </button>
          ) : null}
          {confirmingDelete ? null : (
            <>
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
                aria-describedby={blockReason && !loadError ? 'entry-block-reason' : undefined}
                className="min-h-14 flex-1 rounded-btn bg-balance font-bold text-on-accent disabled:opacity-40"
              >
                {busy === 'save' ? 'กำลังบันทึก…' : editing ? 'บันทึกการแก้ไข' : 'บันทึก'}
              </button>
            </>
          )}
        </div>

        {confirmingDelete ? (
          // 2 ขั้น: ยืนยันในชีตเดียวกัน (ไม่ซ้อน dialog) — ข้อความบอกความจริงเรื่องกู้คืนไม่ได้
          <div className="mt-2 rounded-card border border-border-strong bg-surface-2 p-3">
            <p className="font-semibold">ลบรายการนี้?</p>
            <p className="mt-1 text-[13px] leading-[18px] text-text-muted">{DELETE_IMPACT}</p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={busy !== null}
                className="min-h-11 rounded-btn border border-border px-4 font-semibold disabled:opacity-40"
              >
                ไม่ลบ
              </button>
              <button
                type="button"
                onClick={remove}
                disabled={busy !== null}
                className="min-h-11 rounded-btn bg-warn px-4 font-bold text-on-accent disabled:opacity-40"
              >
                {busy === 'delete' ? 'กำลังลบ…' : 'ยืนยันลบ'}
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** คำที่ใช้ต่อท้ายข้อความ "ยังไม่มีหมวด…" */
const CATEGORY_KIND_HINT: Record<'income' | 'expense', string> = {
  income: 'รายรับ',
  expense: 'รายจ่าย',
};

/**
 * ข้อความยืนยันตอนลบ — ต้องบอกความจริงทั้งสองด้าน: หายจากยอดทันที และ **กู้คืนจากในแอปไม่ได้**
 * (ชั้นข้อมูลเป็น soft delete เก็บไว้เป็นประวัติ แต่ v1 ไม่มีถังขยะ/undo ให้ผู้ใช้)
 */
const DELETE_IMPACT =
  'ลบแล้วรายการหายจากยอดและรายงานทันที · กู้คืนจากในแอปไม่ได้ (ระบบเก็บไว้เป็นประวัติ)';
