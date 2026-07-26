import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, stashReturnTo, apiPost } from '../lib/api.js';
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

// Social Link — Placeholder เท่านั้น (ยังไม่มี Account จริง) ตั้งใจไม่ใส่ href จริง
// และ Disabled ชัดเจน กัน User กดแล้วเจอ 404/หน้าอื่นที่ไม่ใช่ EasyDCA จริง
const SOCIAL_PLACEHOLDERS = [
  { icon: '📘', label: 'Facebook', note: 'เร็วๆ นี้' },
  { icon: '📷', label: 'Instagram', note: 'เร็วๆ นี้' },
  { icon: '🎵', label: 'TikTok', note: 'เร็วๆ นี้' },
];

function Support() {
  const navigate = useNavigate();

  const [category, setCategory] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState(null);
  const [result, setResult] = useState(null); // { notified: boolean } | null

  // ── Route Guard — ไม่มี Token → กลับ Login (เหมือน Premium/DashboardHome/Admin) ──
  useEffect(() => {
    if (!getToken()) {
      stashReturnTo(window.location.pathname + window.location.search);
      navigate('/', { replace: true });
    }
  }, [navigate]);

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitError(null);
    setSubmitting(true);
    try {
      const res = await apiPost('/api/v1/support/request', { category, message });
      setResult({ notified: res.notified });
    } catch (err) {
      setSubmitError(errorText(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  function handleSendAnother() {
    setResult(null);
    setSubmitError(null);
    setCategory('');
    setMessage('');
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
        {/* ── ช่องทางโซเชียล (Placeholder — ยังไม่มี Account จริง) ──────────────── */}
        <section className="dashboard-section">
          <h2>ช่องทางติดตาม EasyDCA</h2>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
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
            ช่องทางโซเชียลยังไม่เปิดใช้งาน — ติดต่อทีมงานผ่านฟอร์มด้านล่างได้เลยตอนนี้
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
                </select>
              </div>

              <div style={{ marginBottom: '1rem', maxWidth: 420 }}>
                <label className="dashboard-modal-label" htmlFor="support-message">
                  รายละเอียด
                </label>
                <textarea
                  id="support-message"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  required
                  disabled={submitting}
                  maxLength={MAX_MESSAGE_LENGTH}
                  rows={5}
                  placeholder="อธิบายปัญหาที่เจอ หรือสิ่งที่ต้องการสอบถาม"
                  style={{ width: '100%', padding: '0.5rem', marginTop: 4, boxSizing: 'border-box', resize: 'vertical' }}
                />
                <div className="dashboard-card-sub" style={{ marginTop: 2 }}>
                  {message.length}/{MAX_MESSAGE_LENGTH} ตัวอักษร
                </div>
              </div>

              {submitError && <p className="dashboard-message error">{submitError}</p>}

              <button
                type="submit"
                className="dashboard-logout-btn"
                disabled={submitting || !category || !message.trim()}
              >
                {submitting ? 'กำลังส่ง...' : 'ส่งข้อความ'}
              </button>
            </form>
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

        {result && !result.notified && (
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
