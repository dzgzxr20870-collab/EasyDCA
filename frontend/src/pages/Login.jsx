import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { setToken, clearToken, apiPost } from '../lib/api';
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

  // PDPA Compliance (migration 017) — Express Opt-in Consent ก่อนเข้า Dashboard
  // ครั้งแรก (needsConsent = data.user.pdpaConsentedAt เป็น null/undefined ตอน
  // liff-verify สำเร็จ) User เดิมที่ถูก Backfill (Grandfather Clause) จะไม่เจอ
  // หน้านี้เลย ข้ามไป navigate('/dashboard') ตามปกติทันที
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [consenting, setConsenting] = useState(false);
  const [consentError, setConsentError] = useState(null);

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
        // docs/SECURITY.md § 1.1 ห้ามเก็บ localStorage กัน XSS ขโมย Token) ต้องตั้งก่อน
        // เช็ค Consent เสมอ เพราะ POST /pdpa-consent ก็ต้องใช้ Token นี้เรียกเช่นกัน
        setToken(data.token);

        const name = (data.user && data.user.displayName) || '';
        if (data.user && data.user.pictureUrl) {
          setAvatarUrl(data.user.pictureUrl);
        }

        // ยังไม่เคย Consent (pdpaConsentedAt เป็น null) → แสดงหน้ายืนยันก่อนเข้า
        // Dashboard ครั้งแรกเสมอ (Express Opt-in — ห้ามข้ามขั้นตอนนี้)
        if (!data.user || !data.user.pdpaConsentedAt) {
          setLoading(false);
          setNeedsConsent(true);
          return;
        }

        setLoading(false);
        setStatus(`เข้าสู่ระบบสำเร็จ${name ? ' — ' + name : ''}`);
        setStatusType('success');

        navigate('/dashboard');
      } catch (err) {
        setLoading(false);
        setStatus('เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
        setStatusType('error');
      }
    }

    main();
  }, [navigate]);

  // ผู้ใช้กด "ยอมรับและเข้าใช้งาน" — ต้องเช็ค Checkbox ก่อนเสมอ (ปุ่มถูก disabled
  // ไว้ถ้ายังไม่ติ๊ก ที่นี่เป็น Guard ชั้นที่สอง) เรียก Endpoint ยืนยันจริงแล้วเข้า
  // Dashboard — ถ้า Endpoint ล้มเหลว ยังอยู่หน้านี้ให้ลองใหม่ได้ (ไม่ Navigate)
  async function handleConsentAccept() {
    if (!consentChecked) return;

    setConsenting(true);
    setConsentError(null);
    try {
      await apiPost('/api/v1/auth/pdpa-consent', {});
      navigate('/dashboard');
    } catch (err) {
      setConsentError('ยืนยันไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setConsenting(false);
    }
  }

  // ผู้ใช้กด "ไม่ยอมรับ" — ห้ามเข้าใช้งานต่อ เคลียร์ Token ที่ตั้งไว้แล้วกลับสู่
  // สถานะเริ่มต้น (ไม่ Reload หน้า — Token ใน Memory หายเองอยู่แล้วจาก clearToken)
  function handleConsentDecline() {
    clearToken();
    setNeedsConsent(false);
    setStatus('คุณต้องยอมรับนโยบายความเป็นส่วนตัวก่อนจึงจะใช้งาน EasyDCA ได้');
    setStatusType('error');
  }

  if (needsConsent) {
    return (
      <div className="login-page">
        <div className="login-card">
          <div className="login-logo">EasyDCA</div>
          {avatarUrl && <img className="login-avatar" src={avatarUrl} alt="รูปโปรไฟล์" />}
          <div className="login-consent">
            <p className="login-consent-text">
              ก่อนใช้งาน กรุณาอ่านและยอมรับ{' '}
              <a href="/privacy.html" target="_blank" rel="noreferrer">
                นโยบายความเป็นส่วนตัว
              </a>{' '}
              ของเรา
            </p>
            <label className="login-consent-check">
              <input
                type="checkbox"
                checked={consentChecked}
                onChange={(e) => setConsentChecked(e.target.checked)}
              />
              <span>ฉันได้อ่านและยอมรับนโยบายความเป็นส่วนตัวแล้ว</span>
            </label>
            {consentError && <div className="login-status error">{consentError}</div>}
            <div className="login-consent-actions">
              <button
                type="button"
                className="login-consent-btn primary"
                onClick={handleConsentAccept}
                disabled={!consentChecked || consenting}
              >
                {consenting ? 'กำลังดำเนินการ...' : 'ยอมรับและเข้าใช้งาน'}
              </button>
              <button
                type="button"
                className="login-consent-btn secondary"
                onClick={handleConsentDecline}
                disabled={consenting}
              >
                ไม่ยอมรับ
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

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
