import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login.jsx';
import DashboardHome from './pages/DashboardHome.jsx';
import Admin from './pages/Admin.jsx';
import Premium from './pages/Premium.jsx';

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
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
