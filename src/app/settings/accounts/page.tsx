import Link from 'next/link';

import { LoadFailed } from '@/components/LoadFailed';
import { RetryBar } from '@/components/RetryBar';
import { getDb } from '@/db';
import { accountBalances, accountUsage, listAccounts } from '@/db/queries/accounts';
import { isNextControlFlow } from '@/lib/next-signals';
import { gateSession } from '@/lib/session';

import { AccountList } from './AccountList';
import type { AccountItem } from './AccountSheet';

export const metadata = { title: 'กระเป๋าเงิน · จดจ่าย' };

/**
 * จัดการกระเป๋าเงิน (spec §1, §2) — เห็นทั้งที่ยังใช้งานและที่เลิกใช้แล้ว (ต้องกู้คืนได้)
 * usage ต่อแถวนับรวมรายการที่เป็น "กระเป๋าปลายทาง" ของโอนด้วย (ชั้นข้อมูลทำแล้ว)
 */
export default async function AccountsPage() {
  const gate = await gateSession();
  if (gate.unavailable) return <LoadFailed />;
  const { userId } = gate.user;

  let items: AccountItem[] | null = null;
  try {
    const db = getDb();
    const [rows, balances] = await Promise.all([
      listAccounts(db, userId, { includeArchived: true }),
      accountBalances(db, userId),
    ]);
    const usage = await accountUsage(
      db,
      userId,
      rows.map((row) => row.id),
    );
    items = rows.map((row) => ({
      id: row.id,
      name: row.name,
      kind: row.kind,
      archived: row.archivedAt !== null,
      usage: usage.get(row.id) ?? 0,
      // ยอดคงเหลือ = ตั้งต้น ± รายการของกระเป๋าใบนั้น (สูตรอยู่ src/lib/money.ts · คิดที่ชั้น query)
      balance: balances.get(row.id) ?? 0,
      // ยอดตั้งต้นจริงจากตาราง accounts — ฟอร์มใช้ค่านี้ prefill (ไม่ใช้ balance)
      initialBalance: row.initialBalance,
    }));
  } catch (error) {
    if (isNextControlFlow(error)) throw error; // สัญญาณ prerender ของ Next — ห้ามกลืน
    console.error('[jodjai] โหลดกระเป๋าไม่สำเร็จ:', error);
  }

  return (
    <div className="flex flex-col gap-4">
      <header className="flex min-h-11 items-center gap-1">
        <Link
          href="/settings"
          aria-label="กลับไปหน้าตั้งค่า"
          className="flex size-11 shrink-0 items-center justify-center rounded-input text-text-muted"
        >
          <svg className="size-5" aria-hidden="true">
            <use href="#i-chevron-left" />
          </svg>
        </Link>
        <h1 className="text-2xl font-semibold">กระเป๋าเงิน</h1>
      </header>

      <p className="text-[13px] leading-[18px] text-text-muted">
        ทุกรายการต้องมีกระเป๋า · เลิกใช้แล้วรายการเก่ายังนับในยอดเหมือนเดิม
      </p>

      {items ? <AccountList items={items} /> : <RetryBar message="โหลดกระเป๋าไม่สำเร็จ" />}
    </div>
  );
}
