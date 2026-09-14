/**
 * Drizzle schema — ต้องเทียบเท่า docs/schema.sql (แหล่งความจริง) เสมอ
 * กติกา: แก้ตารางต้องแก้ทั้ง docs/schema.sql และไฟล์นี้ใน commit เดียวกัน
 * รายละเอียดการแปลง + จุดที่ต่างได้: docs/drizzle-mapping.md
 *
 * ⚠ drizzle-orm 0.45.2 ไม่มี index().include() — 3 index ที่ต้องมี INCLUDE
 *   (transactions_user_month_idx · transactions_user_kind_time_idx · transactions_user_category_time_idx)
 *   เขียนที่นี่แบบไม่มี include แล้วเติม SQL drop+create ในไฟล์ migration ตาม docs/drizzle-mapping.md ข้อ 2
 */
import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/* -------------------------------------------------------------------------
 * ตารางของ Better Auth — คอลัมน์ใน DB เป็น snake_case, key ฝั่ง JS ใช้ชื่อโมเดล
 * ของ Better Auth (emailVerified, createdAt, ...) เพราะ drizzle adapter อ่าน object นี้
 * ชื่อ constraint ที่ตั้งเองตรงกับที่ PG จะตั้งให้ docs/schema.sql เพื่อให้เทียบ catalog ได้ตรง
 * ---------------------------------------------------------------------- */

export const user = pgTable(
  'user',
  {
    id: text('id').primaryKey(),
    name: text('name').notNull(),
    email: text('email'),
    emailVerified: boolean('email_verified').notNull().default(false),
    image: text('image'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('user_email_key').on(t.email),
    check('user_email_check', sql`${t.email} is null or ${t.email} = lower(btrim(${t.email}))`),
  ],
);

export const session = pgTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    token: text('token').notNull(),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('session_token_key').on(t.token),
    index('session_user_id_idx').on(t.userId),
  ],
);

export const account = pgTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
    refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
    scope: text('scope'),
    password: text('password'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('account_provider_id_account_id_key').on(t.providerId, t.accountId),
    index('account_user_id_idx').on(t.userId),
  ],
);

export const verification = pgTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
);

/* -------------------------------------------------------------------------
 * ตารางของแอป
 * ---------------------------------------------------------------------- */

export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').notNull().default('cash'),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    initialBalance: bigint('initial_balance', { mode: 'number' }).notNull().default(0),
    icon: text('icon'),
    color: text('color'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // เป้าหมายของ composite FK (account_id, user_id) ใน transactions
    unique('accounts_id_user_id_key').on(t.id, t.userId),
    check('accounts_name_check', sql`btrim(${t.name}) <> ''`),
    check('accounts_kind_check', sql`${t.kind} in ('cash', 'bank', 'credit', 'ewallet', 'other')`),
    check('accounts_currency_check', sql`${t.currency} = 'THB'`),
    check(
      'accounts_initial_balance_check',
      sql`${t.initialBalance} > -1000000000000000 and ${t.initialBalance} < 1000000000000000`,
    ),
    uniqueIndex('accounts_user_name_uidx')
      .on(t.userId, sql`lower(btrim(${t.name}))`)
      .where(sql`archived_at is null`),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    name: text('name').notNull(),
    icon: text('icon'),
    color: text('color'),
    sortOrder: integer('sort_order').notNull().default(0),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('categories_id_user_id_key').on(t.id, t.userId),
    // เป้าหมายของ composite FK: บังคับ kind ของหมวดให้ตรงกับ kind ของรายการ
    unique('categories_id_kind_user_id_key').on(t.id, t.kind, t.userId),
    check('categories_kind_check', sql`${t.kind} in ('income', 'expense')`),
    check('categories_name_check', sql`btrim(${t.name}) <> ''`),
    uniqueIndex('categories_user_kind_name_uidx')
      .on(t.userId, t.kind, sql`lower(btrim(${t.name}))`)
      .where(sql`archived_at is null`),
  ],
);

export const transactions = pgTable(
  'transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    accountId: uuid('account_id').notNull(),
    toAccountId: uuid('to_account_id'),
    categoryId: uuid('category_id'),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * งวดเดือนไทย (+07) ตรึงที่ DB — ไทยไม่มี DST จึง +7 ตลอดปี
     * ห้ามใส่ค่าตอน insert/update (PG: cannot insert a non-DEFAULT value)
     */
    occurredMonthBkk: date('occurred_month_bkk').generatedAlwaysAs(
      sql`(date_trunc('month', occurred_at at time zone interval '7 hours'))::date`,
    ),
    note: text('note'),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'transactions_account_id_user_id_fkey',
      columns: [t.accountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    foreignKey({
      name: 'transactions_to_account_id_user_id_fkey',
      columns: [t.toAccountId, t.userId],
      foreignColumns: [accounts.id, accounts.userId],
    }),
    foreignKey({
      name: 'transactions_category_id_kind_user_id_fkey',
      columns: [t.categoryId, t.kind, t.userId],
      foreignColumns: [categories.id, categories.kind, categories.userId],
    }),
    check('transactions_kind_check', sql`${t.kind} in ('income', 'expense', 'transfer')`),
    check('transactions_amount_check', sql`${t.amount} > 0 and ${t.amount} < 1000000000000000`),
    check('transactions_currency_check', sql`${t.currency} = 'THB'`),
    check(
      'transactions_shape_ck',
      sql`case when ${t.kind} = 'transfer'
            then ${t.toAccountId} is not null and ${t.toAccountId} <> ${t.accountId} and ${t.categoryId} is null
            else ${t.toAccountId} is null and ${t.categoryId} is not null
          end`,
    ),
    index('transactions_user_recent_idx')
      .on(t.userId, t.occurredAt.desc(), t.id.desc())
      .where(sql`deleted_at is null`),
    // INCLUDE (amount, kind) เติมในไฟล์ migration — ดู docs/drizzle-mapping.md ข้อ 2
    index('transactions_user_month_idx')
      .on(t.userId, t.occurredMonthBkk)
      .where(sql`deleted_at is null`),
    // INCLUDE (amount) เติมในไฟล์ migration
    index('transactions_user_kind_time_idx')
      .on(t.userId, t.kind, t.occurredAt)
      .where(sql`deleted_at is null`),
    // INCLUDE (amount) เติมในไฟล์ migration
    index('transactions_user_category_time_idx')
      .on(t.userId, t.categoryId, t.occurredAt)
      .where(sql`deleted_at is null`),
    // สองตัวนี้ห้ามเป็น partial: PG ตรวจ FK ด้วย query ที่ไม่มี deleted_at → partial จะถูกข้าม
    index('transactions_account_idx').on(t.accountId, t.userId),
    index('transactions_to_account_idx').on(t.toAccountId, t.userId),
    // หน้า "รายการที่ลบแล้ว" — partial ฝั่ง deleted_at is not null (index อื่นอยู่ฝั่ง is null จึงใช้ไม่ได้)
    index('transactions_user_deleted_idx')
      .on(t.userId, t.deletedAt.desc(), t.id.desc())
      .where(sql`deleted_at is not null`),
  ],
);

export const budgets = pgTable(
  'budgets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id').notNull(),
    periodMonth: date('period_month').notNull(),
    amount: bigint('amount', { mode: 'number' }).notNull(),
    currency: char('currency', { length: 3 }).notNull().default('THB'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: 'budgets_category_id_user_id_fkey',
      columns: [t.categoryId, t.userId],
      foreignColumns: [categories.id, categories.userId],
    }),
    unique('budgets_user_id_category_id_period_month_key').on(t.userId, t.categoryId, t.periodMonth),
    check('budgets_amount_check', sql`${t.amount} > 0 and ${t.amount} < 1000000000000000`),
    check('budgets_currency_check', sql`${t.currency} = 'THB'`),
    check('budgets_period_month_ck', sql`${t.periodMonth} = date_trunc('month', ${t.periodMonth})::date`),
  ],
);

/**
 * ยังไม่ทำใน v1 (ตรงกับ docs/schema.sql):
 *   - budgets ผูกหมวด expense-only (minor 4.2) — ต้องมี category_kind + FK 3 คอลัมน์
 *   - trigger updated_at ของตารางแอป 4 ตัว: drizzle เขียน trigger ไม่ได้ (ต้องเติม SQL มือใน migration
 *     หรือทำตอนเขียน write path) — ดูบันทึกท้าย migration
 */
