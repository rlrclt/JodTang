'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

import { RetryBar } from '@/components/RetryBar';
import { formatSatang } from '@/lib/money';

import { BudgetSheet, type BudgetItem } from './BudgetSheet';

/**
 * ลิสต์หมวดรายจ่าย + งบของเดือนนี้ (ข้อเสนอ §2)
 * - กดทั้งแถว (≥56px) → เปิด bottom sheet ตั้ง/แก้งบ
 * - optimistic: แถวขยับทันทีที่กดบันทึก · พลาด → rollback แล้วคืนค่าเดิมในช่องกรอก (BudgetSheet)
 * - ไม่ reload หน้า: ใช้ router.refresh() ใน transition (design §2)
 */
export function BudgetList({ items, periodLabel }: { items: BudgetItem[]; periodLabel: string }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [editing, setEditing] = useState<BudgetItem | null>(null);
  /** ค่าที่ผู้ใช้เพิ่งยืนยัน (ก่อนเซิร์ฟเวอร์ตอบ) — key = categoryId */
  const [overrides, setOverrides] = useState<Record<string, number | null>>({});

  // ข้อมูลใหม่จากเซิร์ฟเวอร์มาถึง = ทิ้งค่าที่ค้างอยู่ (ค่าจริงกลายเป็นตัวที่แสดง)
  useEffect(() => setOverrides({}), [items]);

  // เปิด sheet ตรง ๆ ด้วย ?budget=<categoryId> (ใช้ถ่ายสกรีนช็อต/ทดสอบโดยไม่ต้องคลิก — แบบเดียวกับ ?add=1)
  const deepLinkDone = useRef(false);
  useEffect(() => {
    if (deepLinkDone.current) return;
    const wanted = new URLSearchParams(window.location.search).get('budget');
    const found = wanted ? items.find((item) => item.categoryId === wanted) : undefined;
    if (found) {
      deepLinkDone.current = true;
      setEditing(found);
    }
  }, [items]);

  const optimistic = (categoryId: string, amount: number | null) => {
    setOverrides((prev) => ({ ...prev, [categoryId]: amount }));
    return () =>
      setOverrides((prev) => {
        const next = { ...prev };
        delete next[categoryId];
        return next;
      });
  };

  const done = () => {
    setEditing(null);
    startTransition(() => router.refresh());
  };

  if (items.length === 0) {
    return <RetryBar message="ยังไม่มีหมวดรายจ่าย — เพิ่มหมวดก่อนจึงตั้งงบได้" />;
  }

  return (
    <>
      <ul className="overflow-hidden rounded-card border border-border bg-surface">
        {items.map((item) => {
          const amount = Object.hasOwn(overrides, item.categoryId) ? overrides[item.categoryId] : item.amount;
          return (
            <li key={item.categoryId} className="border-b border-border last:border-b-0">
              <button
                type="button"
                onClick={() => setEditing(item)}
                className="flex min-h-14 w-full items-center gap-3 px-4 text-left"
              >
                <span
                  aria-hidden="true"
                  className="size-2.5 shrink-0 rounded-pill"
                  style={{ background: item.color ? `var(${item.color})` : 'var(--balance)' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="block truncate font-semibold">{item.name}</span>
                    {item.archived ? (
                      <span className="shrink-0 rounded-pill border border-border-strong px-2 py-0.5 text-[13px] leading-[18px] text-text-muted">
                        เลิกใช้แล้ว
                      </span>
                    ) : null}
                  </span>
                  <span className="block truncate text-[13px] leading-[18px] text-text-muted">
                    {amount === null ? 'ยังไม่ตั้งงบ' : `งบ ${formatSatang(amount)}`}
                  </span>
                </span>
                <span aria-hidden="true" className="shrink-0 text-text-muted">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      {editing ? (
        <BudgetSheet
          item={editing}
          periodLabel={periodLabel}
          onOptimistic={optimistic}
          onDone={done}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}
