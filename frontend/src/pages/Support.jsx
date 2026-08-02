import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, stashReturnTo, apiGet, apiPost, apiUpload } from '../lib/api.js';
// Reuse Style Pattern เดียวกับ Premium/Dashboard (การ์ด/ปุ่ม) — ไม่ทำ CSS ใหม่
import './Dashboard.css';

// ═══════════════════════════════════════════════════════════════════════════
// Support — หน้าติดต่อ Admin/Support (ก่อนเปิด Closed Beta Wave 1)
// ═══════════════════════════════════════════════════════════════════════════
// แทนที่ Flow LINE Chat เดิม (พิมพ์ Trigger → ถามข้อความในแชทตรงๆ) เพราะ Webhook
// ตอบอัตโนมัติชนกับตอน Admin เข้าไปตอบมือใน LINE Chat Mode เดียวกัน (Bot ทับคำตอบ
// ของ Admin) — LINE Chat ฝั่งเดิมตอนนี้แค่ตอบ Link มาที่หน้านี้แทน (ดู
// webhook.controller.js case COMMANDS.CONTACT_SUPPORT)
//
// ไม่ทำ Real-time Chat รอบนี้ (Post-Beta) — Submit แล้วจบ ผลตอบกลับตามจริงว่า Push
// ถึง Admin สำเร็จไหม (ห้ามโกหกว่าสำเร็จถ้าไม่สำเร็จจริง — บทเรียนจากบั๊ก Payment
// Slip auto-notify)

// หมวดปัญหา — ต้องตรงกับ supportRequestFlow.CATEGORIES ฝั่ง Backend เป๊ะ (ค่า value
// ที่ส่งไป ไม่ใช่ label) Backend ไม่เชื่อ Client เสมอ ส่งค่าอื่นมาจะโดนปฏิเสธ 400
const CATEGORY_OPTIONS = [
  { value: 'payment_premium', label: 'ปัญหาชำระเงิน/Premium' },
  { value: 'ocr', label: 'OCR อ่านสลิปผิด' },
  { value: 'portfolio_ledger', label: 'ข้อมูลพอร์ต/Ledger ผิด' },
  { value: 'other', label: 'อื่นๆ' },
];

// ── แคมเปญ Premium ฟรี 1 เดือน แลกกด Like Facebook ────────────────────────────
// Category พิเศษที่ "ไม่ได้อยู่ใน CATEGORY_OPTIONS" ด้านบนโดยเจตนา — เลือกอันนี้แล้ว
// จะยิงคนละ Endpoint (POST /support/facebook-like) และลงคนละตารางกับ support_requests
// เดิมโดยสิ้นเชิง (คนละ Life Cycle — อันนี้มี pending/approved/rejected + แนบรูป)
//
// ⚠️ ค่านี้ห้ามหลุดไปเป็น category ของ POST /support/request เด็ดขาด — Backend มี
// CHECK constraint จำกัดไว้ 4 ค่าเดิมเท่านั้น (migration 026) จะ Insert ไม่ผ่าน
const FB_LIKE_CATEGORY = 'facebook_like_premium';
const FB_LIKE_LABEL = '🎁 ขอ Premium ฟรี 1 เดือน (กดไลก์เพจ Facebook)';

// ชนิดรูปที่ยอมรับ — ตรงกับ ALLOWED_SLIP_CONTENT_TYPES ฝั่ง Backend (storage.service)
const ACCEPTED_IMAGE_TYPES = 'image/jpeg,image/png,image/webp,image/gif';
// 10MB — ตรงกับ MAX_SLIP_SIZE_BYTES ฝั่ง Backend (ตรวจฝั่ง Client ก่อนเพื่อ UX ที่ดีกว่า
// การรอ Upload จนเต็มแล้วโดนปฏิเสธ — Backend ยังตรวจซ้ำอยู่ดี ไม่ได้เชื่อ Client)
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

// ข้อความ Error ของ Endpoint แคมเปญนี้ (คนละชุดกับ ERROR_MESSAGES ด้านบน)
const FB_LIKE_ERROR_MESSAGES = {
  FEATURE_DISABLED: 'แคมเปญนี้ปิดรับแล้วในขณะนี้',
  ACCOUNT_NOT_ELIGIBLE: 'บัญชีนี้ไม่สามารถรับสิทธิ์นี้ได้',
  ALREADY_GRANTED: 'คุณได้รับสิทธิ์จากแคมเปญนี้ไปแล้ว (ใช้ได้ครั้งเดียวเท่านั้น)',
  ALREADY_USED_FREE_TRIAL: 'คุณเคยใช้สิทธิ์ Premium ฟรี 1 เดือนไปแล้ว จึงไม่สามารถรับซ้ำจากแคมเปญนี้ได้',
  ALREADY_PREMIUM: 'คุณเป็นสมาชิก Premium อยู่แล้ว',
  ALREADY_PAID_BEFORE: 'สิทธิ์นี้สำหรับผู้ที่ยังไม่เคยเป็นสมาชิก Premium เท่านั้น',
  ALREADY_GRANTED_BEFORE: 'คุณเคยได้รับสิทธิ์ Premium ฟรีไปแล้ว',
  REQUEST_ALREADY_PENDING: 'คุณส่งคำขอไปแล้ว ทีมงานกำลังตรวจสอบอยู่ กรุณารอผลก่อนส่งใหม่',
  SCREENSHOT_REQUIRED: 'กรุณาแนบรูป Screenshot ที่แสดงว่ากดไลก์เพจแล้ว',
  MESSAGE_TOO_LONG: 'ข้อความยาวเกินไป',
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
  EMPTY_BODY: 'ไม่พบไฟล์รูป กรุณาเลือกรูปใหม่',
};

function fbLikeErrorText(code) {
  return FB_LIKE_ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}

const MAX_MESSAGE_LENGTH = 500; // ต้องตรงกับ supportRequestFlow.MAX_MESSAGE_LENGTH

const ERROR_MESSAGES = {
  SUPPORT_REQUEST_RATE_LIMITED: 'คุณเพิ่งแจ้งไปแล้ว รอทีมงานติดต่อกลับก่อนนะคะ/ครับ (ส่งได้อีกครั้งภายใน 1 ชั่วโมงหลังแจ้งครั้งล่าสุด)',
  SUPPORT_REQUEST_EMPTY_MESSAGE: 'กรุณาพิมพ์รายละเอียดปัญหาก่อนกดส่ง',
  SUPPORT_REQUEST_MESSAGE_TOO_LONG: `ข้อความยาวเกินไป (จำกัด ${MAX_MESSAGE_LENGTH} ตัวอักษร) กรุณาพิมพ์สั้นลง`,
  SUPPORT_REQUEST_INVALID_CATEGORY: 'กรุณาเลือกหมวดปัญหาก่อนกดส่ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
};

function errorText(code) {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}

// Facebook Page จริง (Account เดียวที่เปิดใช้งานแล้วตอนนี้) — เปิดผ่านแท็บใหม่เสมอ
// (target="_blank" + rel="noopener noreferrer") ไม่ทับหน้า /support เดิม กัน User
// กลับมาแล้วต้อง Reload/Login ใหม่ (noopener กัน Tab ใหม่แก้ window.opener ของหน้านี้ได้)
const FACEBOOK_URL = 'https://www.facebook.com/profile.php?id=61591681353766';

// ไอคอนโลโก้ Facebook มาตรฐาน (วงกลมน้ำเงิน + ตัว "f" ขาว) — Inline SVG แทนการเพิ่ม
// Icon Library ใหม่ทั้งก้อน (โปรเจกต์นี้ยังไม่มี lucide-react/react-icons ติดตั้งอยู่
// เลย และมีแค่ไอคอนนี้ตัวเดียวที่ต้องใช้จริงตอนนี้)
function FacebookIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="12" fill="#1877F2" />
      <path
        fill="#FFFFFF"
        d="M15.4 12.5h-2.1V19h-2.7v-6.5H9.1v-2.3h1.5V9.4c0-1.5.9-2.9 3.2-2.9.9 0 1.6.1 1.6.1v2.1h-1.1c-1.1 0-1.3.5-1.3 1.3v1.4h2.4l-.3 2.3z"
      />
    </svg>
  );
}

// Instagram/TikTok — ยังเป็น Placeholder (ยังไม่มี Account จริง) ตั้งใจไม่ใส่ href
// จริงและ Disabled ชัดเจน กัน User กดแล้วเจอ 404/หน้าอื่นที่ไม่ใช่ EasyDCA จริง
const SOCIAL_PLACEHOLDERS = [
  { icon: '📷', label: 'Instagram', note: 'เร็วๆ นี้' },
  { icon: '🎵', label: 'TikTok', note: 'เร็วๆ นี้' },
];

function Support() {
  const navigate = useNavigate();

  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null); // { notified } | { fbLikeSubmitted } | null

  // ── แคมเปญ Premium ฟรี (Like Facebook) ────────────────────────────────────────
  // fbLike = ผลจาก GET /api/v1/support/facebook-like { enabled, eligible, reason, message }
  // Default enabled:false → ถ้า Endpoint ล่ม/ยังโหลดไม่เสร็จ จะ "ไม่โชว์ Category นี้"
  // ไว้ก่อน (Fail-closed: ดีกว่าโชว์ตัวเลือกแจกของฟรีค้างไว้ทั้งที่แคมเปญปิดแล้ว)
  const [fbLike, setFbLike] = useState({ enabled: false, eligible: false });
  const [screenshotFile, setScreenshotFile] = useState(null);
  const [screenshotError, setScreenshotError] = useState(null);

  const isFbLikeCategory = category === FB_LIKE_CATEGORY;

  // ── Route Guard — ไม่มี Token → กลับ Login (เหมือน Premium/DashboardHome/Admin) ──
  useEffect(() => {
    if (!getToken()) {
      stashReturnTo(window.location.pathname + window.location.search);
      navigate('/', { replace: true });
    }
  }, [navigate]);

  // สิทธิ์แคมเปญ Like Facebook — ล้มเหลวเงียบๆ แล้วคง enabled:false ไว้ (ไม่บล็อกหน้า
  // ฟอร์มติดต่อทีมงานปกติ ซึ่งเป็นหน้าที่หลักของหน้านี้)
  useEffect(() => {
    apiGet('/api/v1/support/facebook-like')
      .then(setFbLike)
      .catch(() => {});
  }, []);

  // ตรวจไฟล์ฝั่ง Client ก่อน (ชนิด+ขนาด) เพื่อบอกผู้ใช้ทันทีโดยไม่ต้องรออัปโหลดจนเต็ม
  // — Backend ตรวจซ้ำอยู่แล้ว (ไม่ได้เชื่อ Client) ดู storage.service
  function handleScreenshotChange(e) {
    const file = e.target.files?.[0] ?? null;
    setScreenshotError(null);

    if (!file) {
      setScreenshotFile(null);
      return;
    }
    if (!ACCEPTED_IMAGE_TYPES.split(',').includes(file.type)) {
      setScreenshotFile(null);
      setScreenshotError(FB_LIKE_ERROR_MESSAGES.INVALID_SLIP_CONTENT_TYPE);
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setScreenshotFile(null);
      setScreenshotError(FB_LIKE_ERROR_MESSAGES.SLIP_TOO_LARGE);
      return;
    }
    setScreenshotFile(file);
  }

  // ส่งคำขอแคมเปญ Like Facebook — 2 ขั้น (อัปโหลดรูป → ส่งคำขอ) เพราะ Backend ไม่มี
  // multipart parser (Pattern เดียวกับ Payment Slip ในหน้า /premium)
  async function submitFacebookLikeRequest() {
    const { screenshotPath } = await apiUpload(
      '/api/v1/support/facebook-like/screenshot',
      screenshotFile
    );
    await apiPost('/api/v1/support/facebook-like', {
      screenshotPath,
      message: message.trim() || null,
    });
    setResult({ fbLikeSubmitted: true });
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      if (isFbLikeCategory) {
        // คนละ Endpoint/คนละตารางกับฟอร์มติดต่อทีมงานปกติโดยสิ้นเชิง
        await submitFacebookLikeRequest();
      } else {
        const res = await apiPost('/api/v1/support/request', { category, message });
        setResult({ notified: res.notified });
      }
    } catch (err) {
      setSubmitError(isFbLikeCategory ? fbLikeErrorText(err.message) : errorText(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSendAnother() {
    setResult(null);
    setSubmitError(null);
    setCategory('');
    setMessage('');
    setScreenshotFile(null);
    setScreenshotError(null);
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-logo">EasyDCA · ติดต่อทีมงาน</div>
        <button type="button" className="dashboard-logout-btn" onClick={() => navigate('/dashboard')}>
          ← กลับ Dashboard
        </button>
      </header>

      <div className="dashboard-container">
        {/* ── ช่องทางโซเชียล — Facebook เปิดใช้งานจริงแล้ว, IG/TikTok ยังเป็น
            Placeholder (ดู Comment ที่ SOCIAL_PLACEHOLDERS ด้านบน) ──────────────── */}
        <section className="dashboard-section">
          <h2>ช่องทางติดตาม EasyDCA</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
            <a
              className="dashboard-chip"
              href={FACEBOOK_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', textDecoration: 'none' }}
            >
              <FacebookIcon /> Facebook
            </a>
            {SOCIAL_PLACEHOLDERS.map((s) => (
              <div
                key={s.label}
                className="dashboard-chip"
                style={{ opacity: 0.55, cursor: 'default' }}
                aria-disabled="true"
              >
                {s.icon} {s.label} <span className="dashboard-badge">{s.note}</span>
              </div>
            ))}
          </div>
          <p className="dashboard-card-sub" style={{ marginTop: '0.5rem' }}>
            ติดตามเพจ Facebook ได้แล้ววันนี้ — Instagram/TikTok ยังไม่เปิดใช้งาน แจ้งปัญหาผ่านฟอร์มด้านล่างได้เลยตอนนี้
          </p>
        </section>

        {/* ── ฟอร์มติดต่อทีมงาน ─────────────────────────────────────────────── */}
        {!result && (
          <section className="dashboard-section">
            <h2>แจ้งปัญหา / ติดต่อทีมงาน</h2>
            <form onSubmit={handleSubmit}>
              <div style={{ marginBottom: '1rem', maxWidth: 420 }}>
                <label className="dashboard-modal-label" htmlFor="support-category">
                  หมวดปัญหา
                </label>
                <select
                  id="support-category"
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  required
                  disabled={submitting}
                  style={{ width: '100%', padding: '0.5rem', marginTop: 4, boxSizing: 'border-box' }}
                >
                  <option value="" disabled>
                    เลือกหมวดปัญหา
                  </option>
                  {CATEGORY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                  {/* แคมเปญชั่วคราว — โชว์เฉพาะตอนแคมเปญเปิด "และ" ผู้ใช้ยังมีสิทธิ์
                      (คนที่เคยได้/มีคำขอค้างจะไม่เห็นตัวเลือกนี้เลย ไม่ใช่เห็นแล้วกดไม่ได้)
                      ⚠️ นี่เป็นแค่ UX — Backend เป็นด่านตัดสินจริงเสมอ */}
                  {fbLike.enabled && fbLike.eligible && (
                    <option value={FB_LIKE_CATEGORY}>{FB_LIKE_LABEL}</option>
                  )}
                </select>
                {/* บอกเหตุผลตรงๆ เมื่อแคมเปญเปิดอยู่แต่ผู้ใช้คนนี้ขอไม่ได้ — ดีกว่าเงียบ
                    จนผู้ใช้สงสัยว่าทำไมไม่เห็นตัวเลือกที่เพื่อนเห็น */}
                {fbLike.enabled && !fbLike.eligible && fbLike.message && (
                  <p className="dashboard-card-sub" style={{ marginTop: 4 }}>
                    🎁 แคมเปญ Premium ฟรี: {fbLike.message}
                  </p>
                )}
              </div>

              {/* ── ช่องแนบ Screenshot — แสดงเฉพาะ Category แคมเปญ Like Facebook ── */}
              {isFbLikeCategory && (
                <div style={{ marginBottom: '1rem', maxWidth: 420 }}>
                  <label className="dashboard-modal-label" htmlFor="fb-like-screenshot">
                    แนบ Screenshot ที่แสดงว่ากดไลก์เพจแล้ว *
                  </label>
                  <input
                    id="fb-like-screenshot"
                    type="file"
                    accept={ACCEPTED_IMAGE_TYPES}
                    onChange={handleScreenshotChange}
                    disabled={submitting}
                    style={{ width: '100%', marginTop: 4, boxSizing: 'border-box' }}
                  />
                  <div className="dashboard-card-sub" style={{ marginTop: 2 }}>
                    รูป JPG/PNG/WebP/GIF ขนาดไม่เกิน 10 MB — ทีมงานตรวจด้วยตาแล้วแจ้งผลทาง LINE
                  </div>
                  {screenshotFile && (
                    <p className="dashboard-message" style={{ marginTop: 4 }}>
                      ✅ เลือกไฟล์แล้ว: {screenshotFile.name}
                    </p>
                  )}
                  {screenshotError && (
                    <p className="dashboard-message error" style={{ marginTop: 4 }}>
                      {screenshotError}
                    </p>
                  )}
                </div>
              )}

              <div style={{ marginBottom: '1rem', maxWidth: 420 }}>
                <label className="dashboard-modal-label" htmlFor="support-message">
                  {/* แคมเปญ: ข้อความเป็น "ไม่บังคับ" (หลักฐานคือรูป) ต่างจากฟอร์มแจ้งปัญหา
                      ปกติที่ข้อความคือเนื้อหาหลัก จึงต้องบอกให้ชัดว่าอันไหนบังคับ */}
                  {isFbLikeCategory ? 'ข้อความเพิ่มเติม (ไม่บังคับ)' : 'รายละเอียด'}
                </label>
                <textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required={!isFbLikeCategory}
                  disabled={submitting}
                  maxLength={MAX_MESSAGE_LENGTH}
                  rows={5}
                  placeholder={
                    isFbLikeCategory
                      ? 'เช่น กดไลก์ด้วยบัญชี Facebook ชื่อ ... (กรณีชื่อไม่ตรงกับ LINE)'
                      : 'อธิบายปัญหาที่เจอ หรือสิ่งที่ต้องการสอบถาม'
                  }
                  style={{ width: '100%', padding: '0.5rem', marginTop: 4, boxSizing: 'border-box', resize: 'vertical' }}
                />
                <div className="dashboard-card-sub" style={{ marginTop: 2 }}>
                  {message.length}/{MAX_MESSAGE_LENGTH} ตัวอักษร
                </div>
              </div>

              {submitError && <p className="dashboard-message error">{submitError}</p>}

              {/* เงื่อนไขปุ่มต่างกันตาม Category: แคมเปญบังคับ "รูป" (ข้อความไม่บังคับ)
                  ส่วนฟอร์มแจ้งปัญหาปกติบังคับ "ข้อความ" (ไม่มีรูป) */}
              <button
                type="submit"
                className="dashboard-logout-btn"
                disabled={
                  submitting ||
                  !category ||
                  (isFbLikeCategory ? !screenshotFile : !message.trim())
                }
              >
                {submitting
                  ? 'กำลังส่ง...'
                  : isFbLikeCategory
                    ? 'ส่งคำขอรับสิทธิ์'
                    : 'ส่งข้อความ'}
              </button>
            </form>
          </section>
        )}

        {/* ── ผลลัพธ์หลังส่งคำขอแคมเปญ Like Facebook ────────────────────────────
            ต่างจากฟอร์มติดต่อทีมงานปกติ: ตรงนี้ "คำขอถูกบันทึกลง DB จริงแล้ว" ไม่ว่า
            Push หา Admin จะสำเร็จหรือไม่ (Admin เห็นคำขอในหน้า Admin Panel ได้อยู่ดี)
            จึงไม่มีเคส "ส่งไม่สำเร็จ" แบบฟอร์มปกติที่พึ่ง Push เป็นช่องทางเดียว */}
        {result && result.fbLikeSubmitted && (
          <section className="dashboard-section">
            <h2>✅ ส่งคำขอเรียบร้อยแล้ว</h2>
            <p className="dashboard-message">
              ทีมงานจะตรวจสอบ Screenshot ของคุณและแจ้งผลทาง LINE — หากผ่านการตรวจสอบ
              คุณจะได้รับ Premium ฟรี 1 เดือนทันที
            </p>
            <p className="dashboard-card-sub">
              หากคำขอไม่ผ่าน (เช่นรูปไม่ชัด) คุณสามารถแก้ไขแล้วส่งใหม่ได้ทันที สิทธิ์ยังไม่ถูกใช้ไป
            </p>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="dashboard-logout-btn" onClick={() => navigate('/dashboard')}>
                กลับสู่ Dashboard
              </button>
            </div>
          </section>
        )}

        {/* ── ผลลัพธ์หลัง Submit — ตามจริงเท่านั้น ห้ามโกหกว่าสำเร็จถ้าไม่สำเร็จจริง ── */}
        {result && result.notified && (
          <section className="dashboard-section">
            <h2>✅ ส่งข้อความถึงทีมงานแล้ว</h2>
            <p className="dashboard-message">
              ทีมงานได้รับข้อความของคุณแล้ว จะติดต่อกลับโดยเร็วที่สุด — ขอบคุณที่แจ้งให้ทราบครับ
            </p>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="dashboard-logout-btn" onClick={() => navigate('/dashboard')}>
                กลับสู่ Dashboard
              </button>
            </div>
          </section>
        )}

        {/* ⚠️ ต้องเช็ค !result.fbLikeSubmitted ด้วย — ผลลัพธ์ของแคมเปญไม่มี Field
            notified เลย (undefined) ถ้าเช็คแค่ !result.notified การ์ด "ส่งไม่สำเร็จ"
            จะโผล่ซ้อนกับการ์ดสำเร็จของแคมเปญพร้อมกันทั้งคู่ */}
        {result && !result.fbLikeSubmitted && !result.notified && (
          <section className="dashboard-section">
            <h2>⚠️ ส่งข้อความไม่สำเร็จ</h2>
            <p className="dashboard-message error">
              ขออภัยค่ะ ระบบส่งข้อความถึงทีมงานไม่สำเร็จในขณะนี้ กรุณาลองใหม่อีกครั้ง
            </p>
            <div style={{ marginTop: '1rem' }}>
              <button type="button" className="dashboard-chip" onClick={handleSendAnother}>
                ลองส่งใหม่อีกครั้ง
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default Support;
