import { BrowserRouter, Routes, Route } from 'react-router-dom';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import DashboardHome from './pages/DashboardHome.jsx';
import Admin from './pages/Admin.jsx';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        {/* S8 R1b — Dashboard ใหม่ (ตาม design/easydca-dashboard-redesign.html)
            เป็น Route หลักที่ /dashboard แทนที่ Dashboard.jsx เดิม — เนื้อหาเดิมของ
            Dashboard.jsx (Export PDF/Excel, ตาราง P&L รายสินทรัพย์, ประวัติ+Filter
            เต็มรูปแบบ, วิธีใช้งาน LINE) ยังอยู่ครบทุกฟีเจอร์ ไม่ได้ถูกลบ — ย้ายไปที่
            /dashboard/classic แทน (ดู Report: เหตุผลที่เลือกย้ายแทนลบ/รวมเข้าด้วยกัน) */}
        <Route path="/dashboard" element={<DashboardHome />} />
        <Route path="/dashboard/classic" element={<Dashboard />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
