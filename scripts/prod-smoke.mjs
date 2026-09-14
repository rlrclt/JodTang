#!/usr/bin/env node
/**
 * prod smoke — ตรวจ deployment จริง (next start) โดยไม่ใช้เบราว์เซอร์
 *
 * รัน: node scripts/prod-smoke.mjs [url]
 *      หรือ SMOKE_URL=https://<domain> node scripts/prod-smoke.mjs
 * ค่าเริ่มต้น: http://127.0.0.1:3000
 *
 * ทำไมต้องมี: "next build ผ่าน" ไม่ได้แปลว่า deploy เปิดได้จริง — header อาจหาย, manifest อาจพัง,
 * service worker อาจแคช HTML ที่มีข้อมูลการเงิน, หรือ `?m=` อาจทำ 500 · สคริปต์นี้ยิงเส้นทางสำคัญแล้วสรุป PASS/FAIL
 * ใช้ fetch ของ Node ล้วน (ไม่เพิ่ม dependency) · **ห้ามใส่ค่า secret ลงไฟล์นี้** (อ่านจาก env เท่านั้นถ้าจำเป็น)
 *
 * ข้อ 1 (หน้าแรกตอนไม่มีคุกกี้) — วัดของจริงมาแล้วทั้งสองแบบ จึงยอมรับทั้งคู่:
 *   (ก) 3xx ไป /login  ← เกิดจริงเมื่อ DB ต่อไม่ได้/ยังไม่มีคีย์ (ทดสอบในเครื่อง prod + CI)
 *   (ข) 200 ที่เป็นหน้า error ของแอปเอง (มีข้อความให้ลองใหม่) — เกิดได้เมื่อ deploy มี DB จริงแล้วหน้าแรกเรนเดอร์ error state
 *   ทั้งสองแบบต้อง **ไม่ใช่ 5xx** และต้องไม่มีสัญญาณข้อมูลการเงินหลุดออกมา
 */

const BASE = (process.argv[2] ?? process.env.SMOKE_URL ?? 'http://127.0.0.1:3000').replace(/\/+$/, '');

const results = [];
const must = (condition, message) => {
  if (!condition) throw new Error(message);
};
const check = async (name, run) => {
  try {
    const note = await run();
    results.push({ name, ok: true, note: note ?? '' });
  } catch (error) {
    results.push({ name, ok: false, note: error instanceof Error ? error.message : String(error) });
  }
};

const request = (path) => fetch(`${BASE}${path}`, { redirect: 'manual' });

/** ข้อความที่บ่งชี้ว่าเป็นหน้า error/offline shell ของแอป (ไม่ใช่ข้อมูลผู้ใช้) */
const ERROR_SHELL = /ลองใหม่|โหลดไม่สำเร็จ|ออฟไลน์/;
/**
 * ร่องรอยของ "loading shell" ที่ stream มาก่อนที่ server component จะอ่าน session เสร็จ (200 + shell)
 * เป็น **หลักฐานว่านี่คือ shell** เท่านั้น — ไม่ใช่เงื่อนไขที่ทำให้ผ่านด้วยตัวเอง (ต้องไม่มีสัญญาณข้อมูลด้วย)
 * `aria-busy="true"`/`animate-pulse` มาจาก src/app/loading.tsx ซึ่งเป็น skeleton ล้วน (ไม่มีข้อความ)
 */
const LOADING_SHELL = /aria-busy="true"|animate-pulse|role="status"/;
/** สัญญาณข้อมูลการเงิน — ห้ามโผล่ในหน้าที่ไม่ควรมี (offline/หน้า error/loading shell) */
const MONEY_SIGNALS = ['฿', 'ยอดคงเหลือ', 'ยอดรับ', 'ยอดจ่าย', 'รายการล่าสุด'];
/**
 * สัญญาณ "บริบทผู้ใช้": คำที่โผล่เฉพาะเมื่อมี session จริง + อีเมลตัวแทนที่ระบบสร้างให้ (`@line.local`)
 * ไม่ใช้ regex อีเมลกว้าง ๆ เพราะ HTML ของแอปมี `@font-face`/`@media` ใน <style> ที่ทำให้ false positive
 * (ชื่อผู้ใช้จริงเป็นข้อความอิสระ ตรวจด้วยคำไม่ได้ — สองตัวนี้เป็นตัวแทนที่เชื่อถือได้ของ "มีข้อมูลผู้ใช้")
 */
const USER_SIGNALS = ['ออกจากระบบ', 'สวัสดี', '@line.local'];
/** รวมทุกสัญญาณที่ห้ามหลุดในคำตอบของคนที่ยังไม่ล็อกอิน */
const LEAK_SIGNALS = [...MONEY_SIGNALS, ...USER_SIGNALS];

await check('/ (ไม่มีคุกกี้) ไม่ใช่ 5xx + ไป /login หรือเป็น shell ที่ไม่มีข้อมูลการเงิน/บริบทผู้ใช้', async () => {
  const response = await request('/');
  const body = await response.text();
  must(response.status < 500, `ได้ ${response.status} (ห้าม 5xx)`);

  // invariant เดียวที่ห้ามถอยไม่ว่าคำตอบจะเป็นรูปแบบไหน (307 · error shell · loading shell)
  for (const signal of LEAK_SIGNALS) {
    must(
      !body.includes(signal),
      `พบ "${signal}" ในคำตอบของ / ที่ไม่มีคุกกี้ — ข้อมูลผู้ใช้/การเงินหลุด (fail ทันทีไม่ว่ารูปแบบไหน)`,
    );
  }

  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location') ?? '';
    must(location.includes('/login'), `redirect ไป "${location}" (ต้องเป็น /login)`);
    return `${response.status} → ${location} · ไม่มีสัญญาณข้อมูล`;
  }

  must(response.status === 200, `ได้ ${response.status} (รับได้เฉพาะ 3xx→/login หรือ 200)`);
  if (ERROR_SHELL.test(body)) return '200 error shell · ไม่มีสัญญาณข้อมูล';
  if (LOADING_SHELL.test(body)) return '200 loading shell (aria-busy/animate-pulse) · ไม่มีสัญญาณข้อมูล';
  must(
    false,
    'หน้า 200 ต้องเป็น error shell หรือ loading shell ที่ระบุได้ — ถ้าเป็นหน้าจริงของผู้ใช้ ต้องได้ 3xx→/login',
  );
});

await check('/login 200 + ปุ่ม Google/LINE ครบ และ disabled เมื่อไม่ได้ตั้งคีย์', async () => {
  const response = await request('/login');
  must(response.status === 200, `ได้ ${response.status}`);
  const body = await response.text();

  const buttons = [...body.matchAll(/<button\b[^>]*>[\s\S]{0,200}?<\/button>/g)].map((match) => match[0]);
  for (const provider of ['Google', 'LINE']) {
    const label = `ดำเนินการต่อด้วย ${provider}`;
    must(body.includes(label), `ไม่พบปุ่ม "${label}"`);
    const button = buttons.find((html) => html.includes(label));
    must(button, `ไม่พบแท็ก <button> ของ "${label}"`);

    // ไม่มีคีย์ = หน้าบอกเองว่ายังไม่ได้ตั้งค่า → ปุ่มนั้นต้อง disabled (ถ้ามีคีย์ ปุ่มจะกดได้ปกติ)
    const keyName = provider === 'Google' ? 'GOOGLE_CLIENT_ID' : 'LINE_CLIENT_ID';
    if (body.includes(`ยังไม่ได้ตั้งค่า ${keyName}`)) {
      must(/\bdisabled\b/.test(button), `ไม่มีคีย์ ${keyName} → ปุ่ม "${label}" ต้อง disabled`);
    }
  }
  return 'มีปุ่มครบ';
});

await check('/offline: ไม่มีข้อมูลการเงิน/บริบทผู้ใช้', async () => {
  const response = await request('/offline');
  must(response.status === 200, `ได้ ${response.status}`);
  const body = await response.text();

  for (const signal of MONEY_SIGNALS) {
    must(!body.includes(signal), `พบสัญญาณการเงิน "${signal}" ในหน้า offline`);
  }
  for (const signal of ['ออกจากระบบ', 'สวัสดี']) {
    must(!body.includes(signal), `หน้า offline ต้องไม่แสดงบริบทผู้ใช้ ("${signal}")`);
  }
  return 'สะอาด';
});

await check('header ความปลอดภัยครบ 5 ตัวที่ /login', async () => {
  const response = await request('/login');
  const headers = response.headers;
  const expected = {
    'content-security-policy': (value) => value.includes("default-src 'self'") && value.includes("frame-ancestors 'none'"),
    'x-frame-options': (value) => value.toUpperCase() === 'DENY',
    'strict-transport-security': (value) => value.includes('max-age='),
    'referrer-policy': (value) => value === 'strict-origin-when-cross-origin',
    'permissions-policy': (value) => value.includes('camera=()') && value.includes('geolocation=()'),
  };
  for (const [name, ok] of Object.entries(expected)) {
    const value = headers.get(name);
    must(value !== null, `ไม่พบ header ${name}`);
    must(ok(value), `ค่า header ${name} ไม่ถูกต้อง: "${value}"`);
  }
  return `${Object.keys(expected).length} ตัว`;
});

await check('/manifest.webmanifest 200 + JSON มี name/start_url/icons', async () => {
  const response = await request('/manifest.webmanifest');
  must(response.status === 200, `ได้ ${response.status}`);
  const manifest = JSON.parse(await response.text());
  must(typeof manifest.name === 'string' && manifest.name.length > 0, 'ขาด name');
  must(typeof manifest.start_url === 'string' && manifest.start_url.length > 0, 'ขาด start_url');
  must(Array.isArray(manifest.icons) && manifest.icons.length > 0, 'ขาด icons');
  return `${manifest.name} · ${manifest.icons.length} ไอคอน`;
});

/* ---- ตัวช่วยอ่านโครงสร้าง service worker (ตรวจจากซอร์สที่เสิร์ฟจริง ไม่ได้รัน SW) ---- */

/** ตัดคอมเมนต์ออกก่อนตรวจ เพื่อไม่ให้ข้อความในคอมเมนต์หลอกการตรวจ (และไม่ให้ `//` ใน URL ถูกตัดผิด) */
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** เนื้อในวงเล็บปีกกาของบล็อกที่เริ่มตรง `from` (นับปีกกาเอา — ไม่พึ่งการเยื้อง ซึ่งเปราะกับฟอร์แมตที่ยังถูกต้อง) */
function blockBody(code, from) {
  const open = code.indexOf('{', from);
  if (open === -1) return null;
  let depth = 0;
  for (let index = open; index < code.length; index += 1) {
    if (code[index] === '{') depth += 1;
    else if (code[index] === '}') {
      depth -= 1;
      if (depth === 0) return code.slice(open + 1, index);
    }
  }
  return null;
}

/** เนื้อในฟังก์ชันที่ประกาศด้วยชื่อนี้ (เช่น networkOnlyNavigation) */
function functionBody(code, name) {
  const found = new RegExp(`(?:async\\s+)?function\\s+${name}\\s*\\(`).exec(code);
  return found ? blockBody(code, found.index) : null;
}

const squash = (code) => code.replace(/\s+/g, ' ').trim();

await check('/sw.js: navigation ไม่ถูกแคช + precache มี /offline', async () => {
  const response = await request('/sw.js');
  must(response.status === 200, `ได้ ${response.status}`);
  const source = stripComments(await response.text());

  // 1) ที่เก็บ /offline ต้องมีอยู่และประกาศชัด
  must(/const OFFLINE_URL = '\/offline'/.test(source), "ต้องประกาศ OFFLINE_URL = '/offline'");
  must(/cache\.put\(\s*OFFLINE_URL\s*,/.test(source), 'precache ต้องเก็บ /offline ด้วย cache.put(OFFLINE_URL, …)');

  // 2) สาขา navigation/document ต้องเป็น "เรียก networkOnlyNavigation แล้ว return" เท่านั้น — กติกาเชิงโครงสร้าง
  //    (กันได้จริงกว่าแบนคำ: ต่อให้เปลี่ยนชื่อ cache/handle หรือยัดการแคชผ่านฟังก์ชันอื่น ก็ต้องเขียนเพิ่มในสาขานี้ไม่ได้)
  const navGuard = /if \(request\.mode === 'navigate' \|\| request\.destination === 'document'\)/.exec(source);
  must(navGuard, 'ไม่พบสาขา navigation/document ที่อ่านออก (สคริปต์นี้ตรวจโครงสร้าง ไม่ใช่รัน SW)');
  const navBranch = blockBody(source, navGuard.index);
  must(navBranch !== null, 'อ่านเนื้อสาขา navigation/document ไม่ได้');
  const expected = 'event.respondWith(networkOnlyNavigation(request)); return;';
  must(
    squash(navBranch) === expected,
    `สาขา navigation/document ต้องเป็น "${expected}" เท่านั้น (พบ "${squash(navBranch).slice(0, 120)}")`,
  );

  // 3) เสริม: ในสาขานั้นห้ามมีคำที่เกี่ยวกับแคชเลย (อ่านง่าย + จับความพยายามแคชในชื่ออื่น)
  for (const banned of ['.put(', 'caches.open', 'caches.match', 'cacheFirst', 'cache.match']) {
    must(!navBranch.includes(banned), `ห้าม "${banned}" ในสาขา navigation/document`);
  }

  // 4) เสริมอีกชั้น: ตัว networkOnlyNavigation เองต้องไม่เขียน cache (อ่าน /offline จาก cache ได้ แต่ห้ามเก็บ)
  const navFn = functionBody(source, 'networkOnlyNavigation');
  must(navFn !== null, 'ไม่พบฟังก์ชัน networkOnlyNavigation (สาขา navigation ต้องเรียกฟังก์ชันนี้)');
  for (const banned of ['.put(', 'caches.open', 'cacheFirst']) {
    must(!navFn.includes(banned), `ห้าม "${banned}" ใน networkOnlyNavigation (ห้ามแคชเอกสารของผู้ใช้)`);
  }
  must(/caches\.match\(\s*OFFLINE_URL/.test(navFn), 'networkOnlyNavigation ต้องเสิร์ฟ /offline จาก cache ตอนออฟไลน์');

  return 'navigation = network-only (ตรวจเชิงโครงสร้าง)';
});

await check('พารามิเตอร์เดือน ?m= ไม่ทำ 5xx (abc · all · zzz)', async () => {
  for (const path of ['/?m=abc', '/transactions?m=all', '/summary?m=all', '/login?m=zzz']) {
    const response = await request(path);
    must(response.status < 500, `${path} ได้ ${response.status} (ห้าม 5xx)`);
  }
  return '4 เส้นทาง';
});

const failed = results.filter((result) => !result.ok).length;
console.log(`\nprod smoke → ${BASE}\n`);
for (const result of results) {
  console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.note ? ` — ${result.note}` : ''}`);
}
console.log(`\n${results.length - failed}/${results.length} ผ่าน${failed ? ` · ไม่ผ่าน ${failed} ข้อ` : ''}`);
process.exit(failed === 0 ? 0 : 1);
