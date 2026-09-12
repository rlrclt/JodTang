export default function Home() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-[430px] flex-col justify-center gap-4 p-4">
      <h1 className="text-2xl font-bold">จดจ่าย</h1>
      <p className="text-muted">
        เฟส 1: โครงพร้อมแล้ว (Next.js 15 + Tailwind v4 + Drizzle + Better Auth) — หน้าจอจริงตาม
        docs/design.md ทำในเฟส 2
      </p>
      <p className="text-muted text-sm">
        ยังไม่ได้ตั้ง env: ดู .env.example · migration: npx drizzle-kit generate
      </p>
    </main>
  );
}
