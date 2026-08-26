import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import DashboardHome from './pages/DashboardHome.jsx';
import Admin from './pages/Admin.jsx';
import Premium from './pages/Premium.jsx';
import Support from './pages/Support.jsx';
// Stage 9 — Dashboard แบบแยกหน้า (Route คู่ขนานที่ /app/*)
// ⚠️ **ไม่ได้แทนที่ /dashboard เดิม** — เพิ่มเป็น Route คนละอันโดยเจตนา เพื่อให้
// Rollback ทำได้ด้วยการปิด Feature Flag ตัวเดียว ไม่ต้อง Revert โค้ด
// (ห้ามลบ Dashboard เดิมจนกว่าจะผ่านการใช้งานจริง)
import { MULTIPAGE_APP_ENABLED } from './lib/featureFlags.js';
import AppShell from './components/app/AppShell.jsx';
import AppPortfolio from './pages/app/AppPortfolio.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        {/* S8 R1b — Dashboard ใหม่ (ตาม design/easydca-dashboard-redesign.html)
            เป็น Route หลักที่ /dashboard */}
        <Route path="/dashboard" element={<DashboardHome />} />
        {/* S8 R3 รอบ 2 — ทุกฟีเจอร์ของ Dashboard.jsx เดิม (Export PDF/Excel, ตาราง
            P&L รายสินทรัพย์, ประวัติ+Filter เต็มรูปแบบ, วิธีใช้งาน LINE, Banner
            Free/Premium) ย้ายเข้า /dashboard ตัวเดียวครบแล้ว — /dashboard/classic
            จึง Redirect กลับไปที่ /dashboard แทนที่จะแสดงหน้าเดิมซ้ำซ้อน (ไม่ใช้ 404:
            กันกรณีมีคน Bookmark ลิงก์เก่าไว้) ไฟล์ pages/Dashboard.jsx "ยังอยู่ในโค้ด
            เหมือนเดิม" (ไม่ได้ลบ) เผื่อต้องย้อนดู Logic อ้างอิงภายหลัง เพียงแต่ไม่มี
            Route ไหน Import มา Render อีกแล้ว */}
        <Route path="/dashboard/classic" element={<Navigate to="/dashboard" replace />} />
        {/* Business Model Beta — หน้าอัพเกรด Premium ผ่าน PromptPay QR บนเว็บ
            (เป้าหมายของปุ่มอัพเกรดจาก Export Gate + DCA Planner Gate + Banner Free) */}
        <Route path="/premium" element={<Premium />} />
        {/* ติดต่อ Admin/Support (ก่อนเปิด Closed Beta Wave 1) — แทนที่ Flow LINE Chat
            เดิมที่ชนกับ Admin ตอบมือใน Chat Mode เดียวกัน (Bot ทับคำตอบของ Admin) */}
        <Route path="/support" element={<Support />} />
        <Route path="/admin" element={<Admin />} />

        {/* ── Stage 9: Dashboard แยกหน้า (/app/*) ──────────────────────────
            Nested Route ใต้ AppShell ซึ่งโหลดพอร์ต + สิทธิ์จริงครั้งเดียวแล้ว
            ส่งลงหน้าลูกผ่าน Outlet Context (หน้าลูกไม่ยิง /portfolios ซ้ำ)

            ⚠️ อยู่หลัง Feature Flag — ปิดอยู่ = ไม่มี Route นี้เลย ผู้ใช้ที่พิมพ์
            URL ตรงจะตกไป Route "/" (Login) ตามปกติ ไม่เจอหน้าครึ่งๆ กลางๆ
            เปิดด้วย VITE_ENABLE_MULTIPAGE_APP=true ตอน Deploy */}
        {MULTIPAGE_APP_ENABLED && (
          <Route path="/app" element={<AppShell />}>
            <Route index element={<Navigate to="/app/portfolio" replace />} />
            <Route path="portfolio" element={<AppPortfolio />} />
            {/* หน้าอื่น (dashboard / transactions / dca / profile) ยัง Port ไม่เสร็จ
                — ชี้กลับหน้าพอร์ตไว้ก่อน ดีกว่าปล่อยให้ตกไป Login แบบไม่มีคำอธิบาย */}
            <Route path="*" element={<Navigate to="/app/portfolio" replace />} />
          </Route>
        )}
      </Routes>
    </BrowserRouter>
  );
}

export default App;
