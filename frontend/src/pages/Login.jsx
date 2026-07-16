import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken } from '../lib/api';
import './Login.css';

// LIFF ID เป็นค่า Public ฝัง Client-side ได้ปกติ (ไม่ใช่ Secret)
const LIFF_ID = '2010586158-DO9yzmaP';

// ต้องอ่านจาก Environment Variable เสมอ ห้าม Hardcode Backend URL ตรงๆ
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL;

function Login() {
  const navigate = useNavigate();
  const [status, setStatus] = useState('กำลังเข้าสู่ระบบ...');
  const [statusType, setStatusType] = useState(null);
  const [loading, setLoading] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState(null);

  useEffect(() => {
    async function main() {
      // liff เป็น Global Script (โหลดจาก index.html) ไม่ใช่ ES Module
      const liff = window.liff;

      try {
        await liff.init({ liffId: LIFF_ID });
      } catch (err) {
        setLoading(false);
        setStatus('ไม่สามารถเริ่มต้นระบบได้ กรุณาลองใหม่อีกครั้ง');
        setStatusType('error');
        return;
      }

      // ยังไม่ Login → ส่งไปหน้า Login ของ LINE (จะกลับมาหน้านี้อีกครั้งหลัง Login)
      if (!liff.isLoggedIn()) {
        liff.login();
        return;
      }

      setStatus('กำลังเข้าสู่ระบบ...');

      try {
        const accessToken = liff.getAccessToken();

        const response = await fetch(`${API_BASE_URL}/api/v1/auth/liff-verify`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accessToken }),
        });

        if (!response.ok) {
          setLoading(false);
          setStatus('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
          setStatusType('error');
          return;
        }

        const data = await response.json();

        // เก็บ JWT ของระบบไว้ใช้เรียก API ที่ต้อง Login ต่อไป (ใน Memory เท่านั้น —
        // docs/SECURITY.md § 1.1 ห้ามเก็บ localStorage กัน XSS ขโมย Token)
        setToken(data.token);

        setLoading(false);
        const name = (data.user && data.user.displayName) || '';
        setStatus(`เข้าสู่ระบบสำเร็จ${name ? ' — ' + name : ''}`);
        setStatusType('success');

        if (data.user && data.user.pictureUrl) {
          setAvatarUrl(data.user.pictureUrl);
        }

        navigate('/dashboard');
      } catch (err) {
        setLoading(false);
        setStatus('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        setStatusType('error');
      }
    }

    main();
  }, [navigate]);

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-logo">EasyDCA</div>
        {avatarUrl && <img className="login-avatar" src={avatarUrl} alt="รูปโปรไฟล์" />}
        {loading && <div className="login-spinner" />}
        <div className={`login-status${statusType ? ' ' + statusType : ''}`}>{status}</div>
      </div>
    </div>
  );
}

export default Login;
