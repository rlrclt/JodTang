// catalog_diff.mjs — เทียบ catalog ของ Postgres จริง 2 ตัว ไม่เทียบข้อความ SQL
//
// ใช้:  node catalog_diff.mjs <A> <B>
//   A = ไฟล์ .sql (หรือโฟลเดอร์ที่มี .sql) ที่เป็นแหล่งความจริง เช่น docs/schema.sql
//   B = โฟลเดอร์ migrations ของ drizzle-kit (หรือ .sql เดียว) เช่น ./migrations
// ทางเลือก: node catalog_diff.mjs --selftest /home/yoru/projects/jodjai/docs/schema.sql
//   (พิสูจน์ว่าตัวเทียบเองจับของที่หายได้จริง: ตัด include 3 ตัว + trigger 4 ตัวออก แล้วต้องรายงานครบเท่านั้น)
//
// เทียบ 5 ชั้น: ตาราง+คอลัมน์ · constraint · index · trigger · function
// ความต่างที่ยอมรับได้ (กรองออกแล้ว นับจำนวนให้เห็น ไม่ใช่ซ่อน):
//   1) ชื่อ constraint/index/trigger ที่ PG ตั้งให้ — เทียบด้วยนิยาม ไม่เทียบชื่อ
//   2) NULLS FIRST/LAST ของ index — คอลัมน์ที่ใช้เรียงเป็น not null จึงไม่มีความต่างเชิงพฤติกรรม
//   3) comment ในไฟล์ SQL — ไม่เข้า catalog อยู่แล้ว (เราไม่ใช้ COMMENT ON)
// นอกนั้นต่าง = FAIL (exit 1)
//
// หมายเหตุสำหรับ agent ที่รันใน session นี้ (ห้ามตีความผิด): อย่าใช้ `npm run lint` ตัดสินว่าสคริปต์นี้สะอาด
// ตัวดัก output ของ session (rtk) จะคืน exit 2 พร้อมข้อความ "ESLint output (JSON parse failed...)" แม้ ESLint ผ่าน
// ใช้ `./node_modules/.bin/eslint .` แทน (exit 0 = สะอาด) — ตรวจแล้วว่าไม่ใช่ปัญหาของโค้ดหรือ eslint config
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();

function collect(p) {
  if (statSync(p).isDirectory()) {
    return readdirSync(p).filter(f => f.endsWith('.sql')).sort().map(f => readFileSync(join(p, f), 'utf8')).join('\n');
  }
  return readFileSync(p, 'utf8');
}

// ---- เทียบเป็นชุดข้อความ canonical ต่อชั้น ----
async function snapshot(sql) {
  const db = new PGlite();
  await db.exec(sql);
  const q = (t) => db.query(t).then(r => r.rows);

  const cols = (await q(`
    select c.relname tbl, a.attname col, format_type(a.atttypid, a.atttypmod) typ,
           a.attnotnull nn, a.attgenerated gen,
           pg_get_expr(d.adbin, d.adrelid) def
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_attrdef d on d.adrelid = c.oid and d.adnum = a.attnum
    where n.nspname='public' and c.relkind='r' and a.attnum>0 and not a.attisdropped
    order by 1,2`)).map(r =>
    `column ${r.tbl}.${r.col} :: ${r.typ}${r.nn ? ' not null' : ''}${r.gen ? ` generated(${r.gen})` : ''}${r.def ? ` default ${norm(r.def)}` : ''}`);

  const cons = (await q(`
    select c.relname tbl, con.contype typ, pg_get_constraintdef(con.oid, true) def,
           coalesce(rn.nspname || '.' || rc.relname, '') reftbl
    from pg_constraint con
    join pg_class c on c.oid = con.conrelid
    join pg_namespace n on n.oid = c.relnamespace
    left join pg_class rc on rc.oid = con.confrelid
    left join pg_namespace rn on rn.oid = rc.relnamespace
    where n.nspname='public'
    order by 1,2,3`)).map(r => {
    const kind = { p: 'primary key', u: 'unique', f: 'foreign key', c: 'check', x: 'exclude' }[r.typ] ?? r.typ;
    return `constraint ${r.tbl} ${kind} ${norm(r.def).replace(/^FOREIGN KEY \(([^)]*)\) REFERENCES (\S+)/, 'FOREIGN KEY ($1) REFERENCES $2')}`
      .replace(/\s+/g, ' ');
  });

  const idxRaw = await q(`select tablename tbl, indexname, indexdef from pg_indexes where schemaname='public' order by 1,3`);
  let nullsDropped = 0;
  const idx = idxRaw.map(r => {
    let d = norm(r.indexdef)
      .replace(/^CREATE (UNIQUE )?INDEX \S+ ON /, 'CREATE $1INDEX ON ')
      .replace(/\bpublic\./g, '');
    if (/ NULLS (FIRST|LAST)/.test(d)) { nullsDropped++; d = d.replace(/ NULLS (FIRST|LAST)/g, ''); }
    return `index ${d}`;
  });

  const trg = (await q(`
    select c.relname tbl, pg_get_triggerdef(t.oid, true) def
    from pg_trigger t join pg_class c on c.oid = t.tgrelid
    where not t.tgisinternal order by 1,2`)).map(r =>
    `trigger ${r.tbl} ${norm(r.def).replace(/^CREATE TRIGGER \S+ /, 'CREATE TRIGGER ').replace(/\bpublic\./g, '')}`);

  const fn = (await q(`
    select p.proname, pg_get_functiondef(p.oid) def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' order by 1`)).map(r =>
    `function ${norm(r.def).replace(/\/\*[\s\S]*?\*\//g, '').replace(/\bpublic\./g, '')}`);

  await db.close();
  return {
    layers: { 'ตาราง/คอลัมน์': cols, constraint: cons, index: idx, trigger: trg, function: fn },
    nullsDropped,
  };
}

function compare(a, b) {
  const out = [];
  for (const layer of Object.keys(a.layers)) {
    const A = new Set(a.layers[layer]), B = new Set(b.layers[layer]);
    const onlyA = [...A].filter(x => !B.has(x));
    const onlyB = [...B].filter(x => !A.has(x));
    out.push({ layer, onlyA, onlyB });
  }
  return out;
}

function stripVariant(sql) {
  // ตัด include(...) 3 ตัวออก และตัด create trigger 4 ตัวออก → จำลอง migration ที่ยังไม่ได้เติมของที่ drizzle ทำไม่ได้
  return sql
    .split('\n')
    .filter(l => !/^\s*include \([^)]*\)\s*$/i.test(l))
    .filter(l => !/^\s*create trigger /i.test(l))
    .join('\n');
}

const args = process.argv.slice(2);
const selftest = args[0] === '--selftest';
const A = selftest ? args[1] : args[0];
const B = selftest ? null : args[1];
if (!A || (!B && !selftest)) {
  console.log('ใช้: node catalog_diff.mjs <A.sql|dir> <B.sql|dir>   หรือ   node catalog_diff.mjs --selftest <A.sql>');
  process.exit(2);
}

const sqlA = collect(A);
let sqlB, labelB;
if (selftest) { sqlB = stripVariant(sqlA); labelB = '(selftest: A ที่ตัด include 3 + trigger 4)'; }
else { sqlB = collect(B); labelB = B; }

console.log(`A (แหล่งความจริง): ${A}`);
console.log(`B (migrations)   : ${labelB}`);
const sa = await snapshot(sqlA);
const sb = await snapshot(sqlB);

let real = 0;
for (const { layer, onlyA, onlyB } of compare(sa, sb)) {
  if (!onlyA.length && !onlyB.length) { console.log(`\n[${layer}] ตรงกัน (${sa.layers[layer].length} รายการ)`); continue; }
  real += onlyA.length + onlyB.length;
  console.log(`\n[${layer}] ต่าง ${onlyA.length + onlyB.length} รายการ`);
  for (const x of onlyA) console.log('  ขาดใน B  → ' + x);
  for (const x of onlyB) console.log('  เกินใน B  ← ' + x);
}

if (selftest) {
  const d = compare(sa, sb);
  const idx = d.find(x => x.layer === 'index');
  const trg = d.find(x => x.layer === 'trigger');
  const others = d.filter(x => !['index', 'trigger'].includes(x.layer));
  const okIdx = idx.onlyA.length === 3 && idx.onlyB.length === 3
    && idx.onlyA.every(x => x.includes('INCLUDE'))
    && idx.onlyB.every(x => !x.includes('INCLUDE'));
  const okTrg = trg.onlyA.length === 4 && trg.onlyB.length === 0;
  const okOthers = others.every(x => !x.onlyA.length && !x.onlyB.length);
  console.log(`\nselftest: จับ index ที่หาย ${idx.onlyA.length}/3 ${okIdx ? 'ok' : 'FAIL'} · trigger ที่หาย ${trg.onlyA.length}/4 ${okTrg ? 'ok' : 'FAIL'} · ชั้นอื่นต้องไม่ต่าง ${okOthers ? 'ok' : 'FAIL'}`);
  const pass = okIdx && okTrg && okOthers;
  console.log(pass ? 'selftest ผ่าน — ตัวเทียบเชื่อได้' : 'selftest ไม่ผ่าน — ห้ามใช้ตัวเทียบนี้ตัดสินงานจริง');
  process.exit(pass ? 0 : 1);
}

console.log(`\nสรุป: ${real === 0 ? 'catalog ตรงกันทั้งหมด' : `ต่างจริง ${real} รายการ (ต้องแก้หรือใส่ในรายการยกเว้นอย่างมีเหตุผล)`}`);
console.log(`ความต่างที่กรองออกโดยตั้งใจ: ชื่อ constraint/index/trigger · NULLS FIRST/LAST ใน index (${sa.nullsDropped}/${sb.nullsDropped} ตัว) · comment ในไฟล์ SQL`);
process.exit(real === 0 ? 0 : 1);
