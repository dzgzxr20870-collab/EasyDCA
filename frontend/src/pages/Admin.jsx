import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, apiGet } from '../lib/api.js';

// หน้า /admin — Round 4a ยังเป็น Placeholder ยังไม่ใช่ Dashboard จริง (Round 4b)
// Route Guard 3 ชั้น:
//   1) ยังไม่ Login (ไม่มี Token) → กลับหน้า Login เดิม (/)
//   2) Login แล้วแต่ role !== 'admin' → กลับ Dashboard ปกติ (/dashboard)
//      ไม่ใช่หน้า Error ที่บอกใบ้ว่ามี Route ลับอยู่
//   3) Login แล้วและเป็น Admin → แสดง Placeholder + เรียก /api/v1/admin/ping
//      มายืนยันว่า Wiring ทำงานจริงจบทั้ง Stack (requireAuth + requireAdmin)
//
// role อ่านจาก Endpoint /api/v1/dashboard/me (Backend คืนมาจาก JWT) — ไม่ Decode
// JWT เองฝั่ง Client เพื่อไม่ให้มี Logic ตีความ Token กระจายหลายที่
function Admin() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [pingResult, setPingResult] = useState(null);

  useEffect(() => {
    // ยังไม่ Login → กลับหน้า Login (replace: ไม่ให้กด Back กลับมาหน้านี้ค้าง)
    if (!getToken()) {
      navigate('/', { replace: true });
      return;
    }

    async function verifyAndLoad() {
      try {
        const me = await apiGet('/api/v1/dashboard/me');
        if (me.role !== 'admin') {
          // ไม่ใช่ Admin → กลับ Dashboard ปกติ
          navigate('/dashboard', { replace: true });
          return;
        }

        setReady(true);
        // ยืนยัน Wiring ทั้ง Stack — ถ้า Admin จริงต้องได้ 200 { ok, role }
        const ping = await apiGet('/api/v1/admin/ping');
        setPingResult(ping);
      } catch (err) {
        // apiGet จัดการ 401 (Token หมดอายุ/ไม่ถูกต้อง) ด้วยการ Redirect ไป Login ให้แล้ว
        // Error อื่น (รวม 403 ถ้า role เพี้ยน) → ถือว่าไม่มีสิทธิ์ กลับ Dashboard ปกติ
        navigate('/dashboard', { replace: true });
      }
    }

    verifyAndLoad();
  }, [navigate]);

  if (!ready) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center' }}>กำลังตรวจสอบสิทธิ์...</div>
    );
  }

  return (
    <div style={{ padding: '2rem', maxWidth: 640, margin: '0 auto' }}>
      <h1>Admin Dashboard (เร็วๆ นี้)</h1>
      <p>หน้านี้จะเปิดใช้งานจริงใน Round 4b</p>
      <p>
        สถานะการเชื่อมต่อ Backend:{' '}
        {pingResult
          ? `✅ OK (role: ${pingResult.role})`
          : 'กำลังตรวจสอบ...'}
      </p>
    </div>
  );
}

export default Admin;
