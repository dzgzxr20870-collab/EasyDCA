import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, stashReturnTo, apiPost, apiUpload, API_BASE_URL } from '../lib/api.js';
// Reuse Style Pattern เดียวกับ Dashboard/Admin (การ์ด/ปุ่ม) — ไม่ทำ CSS ใหม่
import './Dashboard.css';

// ═══════════════════════════════════════════════════════════════════════════
// Premium — หน้าอัพเกรด Premium ผ่าน PromptPay QR บนเว็บ (Business Model Beta)
// ═══════════════════════════════════════════════════════════════════════════
// มิเรอร์ Flow เดิมของ LINE ทุกขั้น โดย "Reuse payment.service เดิมทั้งหมด" ผ่าน
// Endpoint JWT ที่มีอยู่แล้ว (ไม่มี Logic คำนวณ/สร้าง Payment คู่ขนานใหม่):
//   1) POST /api/v1/payment/request  → สร้างคำขอ + ได้ยอดที่ต้องโอน (เศษสตางค์เฉพาะ)
//   2) GET  /api/v1/payment/:id/qr.png → รูป QR (Endpoint เดียวกับที่การ์ด LINE ใช้)
//   3) POST /api/v1/payment/:id/slip → อัปโหลดรูปสลิป (มิเรอร์ handlePaymentSlipImage)
//   4) POST /api/v1/payment/:id/notify → Admin ได้ Push เหมือน LINE ทุกประการ
//
// Route Guard: Pattern เดียวกับ DashboardHome/Admin — ไม่มี Token (เช่นเปิดหน้านี้ตรงๆ
// หลัง Refresh ที่ทำ JWT ใน Memory หาย) → เด้งกลับ Login (/) ให้ LIFF Re-auth ใหม่

// ป้ายราคาแพ็กเกจ (Presentation) — ยอดจริงที่ต้องโอน (รวมเศษสตางค์) มาจาก Response
// ของ requestPayment เท่านั้น ไม่คำนวณเองฝั่ง Client
const PLAN_OPTIONS = [
  { value: 'monthly', label: 'รายเดือน', priceLabel: '59 บาท / เดือน' },
  { value: 'yearly', label: 'รายปี', priceLabel: '590 บาท / ปี (ประหยัดกว่า)' },
];

// ข้อความ Error → ภาษาไทย (code จาก Backend payment.controller STATUS_BY_CODE)
const ERROR_MESSAGES = {
  PAYMENT_NOT_CONFIGURED: 'ระบบชำระเงินยังไม่พร้อมใช้งาน กรุณาลองใหม่ภายหลัง',
  VALIDATION_ERROR: 'ข้อมูลไม่ถูกต้อง กรุณาลองใหม่',
  SATANG_POOL_EXHAUSTED: 'ขณะนี้มีคำขอชำระเงินจำนวนมาก กรุณาลองใหม่อีกครั้งในอีกสักครู่',
  ALLOCATION_CONFLICT: 'สร้างคำขอไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
  PAYMENT_NOT_FOUND: 'ไม่พบคำขอชำระเงินนี้ กรุณาเริ่มใหม่',
  PAYMENT_NOT_PENDING: 'คำขอนี้ถูกดำเนินการไปแล้ว กรุณาเริ่มใหม่',
  SLIP_NOT_ATTACHED: 'กรุณาแนบรูปสลิปก่อนกดแจ้งชำระเงิน',
  SLIP_ALREADY_USED: 'สลิปนี้เคยถูกใช้ยืนยันการชำระเงินไปแล้ว กรุณาใช้สลิปการโอนจริงของรอบนี้',
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
  EMPTY_BODY: 'ไม่พบไฟล์รูป กรุณาเลือกรูปสลิปใหม่',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
};

function errorText(code) {
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
}

function qrImageUrl(paymentId) {
  return `${API_BASE_URL}/api/v1/payment/${paymentId}/qr.png`;
}

function formatBaht(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return '-';
  return num.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function Premium() {
  const navigate = useNavigate();

  const [billingPeriod, setBillingPeriod] = useState('monthly');
  const [payment, setPayment] = useState(null); // { paymentId, amountThb, expiresAt }
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const [slipFile, setSlipFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [slipUploaded, setSlipUploaded] = useState(false);

  const [notifying, setNotifying] = useState(false);
  const [notifyError, setNotifyError] = useState(null);
  const [notified, setNotified] = useState(false);

  // ── Route Guard — ไม่มี Token → กลับ Login (เหมือน DashboardHome/Admin) ────────
  useEffect(() => {
    if (!getToken()) {
      // จำหน้านี้ไว้ ให้ Login พากลับมา /premium หลัง Re-auth (ไม่เด้งไป /dashboard)
      stashReturnTo(window.location.pathname + window.location.search);
      navigate('/', { replace: true });
    }
  }, [navigate]);

  async function handleCreatePayment() {
    setCreateError(null);
    setCreating(true);
    try {
      const result = await apiPost('/api/v1/payment/request', { billingPeriod });
      setPayment({
        paymentId: result.paymentId,
        amountThb: result.amountThb,
        expiresAt: result.expiresAt,
      });
      // เริ่มขั้นแนบสลิปใหม่ทุกครั้งที่สร้างคำขอ
      setSlipFile(null);
      setSlipUploaded(false);
      setUploadError(null);
      setNotified(false);
      setNotifyError(null);
    } catch (err) {
      setCreateError(errorText(err.message));
    } finally {
      setCreating(false);
    }
  }

  async function handleUploadSlip() {
    if (!slipFile) {
      setUploadError('กรุณาเลือกรูปสลิปก่อน');
      return;
    }
    setUploadError(null);
    setUploading(true);
    try {
      await apiUpload(`/api/v1/payment/${payment.paymentId}/slip`, slipFile);
      setSlipUploaded(true);
    } catch (err) {
      setUploadError(errorText(err.message));
    } finally {
      setUploading(false);
    }
  }

  async function handleNotify() {
    setNotifyError(null);
    setNotifying(true);
    try {
      await apiPost(`/api/v1/payment/${payment.paymentId}/notify`, {});
      setNotified(true);
    } catch (err) {
      setNotifyError(errorText(err.message));
    } finally {
      setNotifying(false);
    }
  }

  return (
    <div className="dashboard-page">
      <header className="dashboard-header">
        <div className="dashboard-logo">EasyDCA · Premium</div>
        <button
          type="button"
          className="dashboard-logout-btn"
          onClick={() => navigate('/dashboard')}
        >
          ← กลับ Dashboard
        </button>
      </header>

      <div className="dashboard-container">
        {/* ── ขั้นที่ 1: เลือกแพ็กเกจ + สร้าง QR ──────────────────────────────── */}
        {!payment && (
          <section className="dashboard-section">
            <h2>👑 อัพเกรดเป็น Premium</h2>
            <p className="dashboard-card-sub">
              ปลดล็อกทุกฟีเจอร์: สินทรัพย์ไม่จำกัด, แผน DCA ไม่จำกัด และส่งออกรายงาน PDF/Excel
            </p>

            <div className="dashboard-chip-group" style={{ marginTop: '1rem' }}>
              {PLAN_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`dashboard-chip${billingPeriod === opt.value ? ' on' : ''}`}
                  onClick={() => setBillingPeriod(opt.value)}
                >
                  {opt.label} · {opt.priceLabel}
                </button>
              ))}
            </div>

            {createError && <p className="dashboard-message error">{createError}</p>}

            <div style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="dashboard-logout-btn"
                onClick={handleCreatePayment}
                disabled={creating}
              >
                {creating ? 'กำลังสร้าง QR...' : 'สร้าง QR ชำระเงิน'}
              </button>
            </div>
          </section>
        )}

        {/* ── ขั้นที่ 2: แสดง QR + แนบสลิป + แจ้งชำระ ─────────────────────────── */}
        {payment && !notified && (
          <section className="dashboard-section">
            <h2>สแกนจ่ายด้วย PromptPay</h2>
            <p className="dashboard-card-sub">
              โอนยอด <strong>{formatBaht(payment.amountThb)} บาท</strong> (ยอดนี้มีเศษสตางค์เฉพาะคำขอ
              เพื่อให้ระบบจับคู่การโอนของคุณได้ กรุณาโอนให้ตรงทุกสตางค์)
            </p>

            <div style={{ margin: '1rem 0' }}>
              <img
                src={qrImageUrl(payment.paymentId)}
                alt="QR PromptPay"
                className="dashboard-image-thumb"
                style={{ width: 220, height: 220 }}
              />
            </div>

            {/* ช่องกรอกโค้ดส่วนลด — Placeholder เตรียมไว้เท่านั้น (ยังไม่มีผลกับยอดเงิน)
                Disabled + Label ชัดเจนว่ายังใช้ไม่ได้ กันผู้ใช้เข้าใจผิดว่าได้ส่วนลดจริง */}
            <div style={{ margin: '1rem 0', maxWidth: 360 }}>
              <label className="dashboard-modal-label" htmlFor="discount-code">
                โค้ดส่วนลด <span className="dashboard-badge">เร็วๆ นี้</span>
              </label>
              <input
                id="discount-code"
                type="text"
                placeholder="ยังไม่เปิดใช้งาน"
                disabled
                style={{ width: '100%', padding: '0.5rem', marginTop: 4, boxSizing: 'border-box' }}
              />
              <div className="dashboard-card-sub" style={{ marginTop: 2 }}>
                ระบบโค้ดส่วนลดจะเปิดให้ใช้เร็วๆ นี้ — ยอดที่ต้องโอนตอนนี้ยังไม่มีการหักส่วนลด
              </div>
            </div>

            {/* ── แนบสลิป ── */}
            <div style={{ marginTop: '1rem' }}>
              <label className="dashboard-modal-label" htmlFor="slip-file">
                แนบรูปสลิปการโอนเงิน
              </label>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginTop: 4 }}>
                <input
                  id="slip-file"
                  type="file"
                  accept="image/*"
                  disabled={uploading || slipUploaded}
                  onChange={(e) => {
                    setSlipFile(e.target.files?.[0] ?? null);
                    setSlipUploaded(false);
                    setUploadError(null);
                  }}
                />
                <button
                  type="button"
                  className="dashboard-chip"
                  onClick={handleUploadSlip}
                  disabled={uploading || slipUploaded || !slipFile}
                >
                  {uploading ? 'กำลังอัปโหลด...' : slipUploaded ? '✅ แนบแล้ว' : 'อัปโหลดสลิป'}
                </button>
              </div>
              {uploadError && <p className="dashboard-message error">{uploadError}</p>}
            </div>

            {/* ── แจ้งชำระแล้ว (ยิง Flow เดียวกับ LINE — Admin ได้ Push) ── */}
            <div style={{ marginTop: '1.25rem' }}>
              <button
                type="button"
                className="dashboard-logout-btn"
                onClick={handleNotify}
                disabled={notifying || !slipUploaded}
              >
                {notifying ? 'กำลังแจ้ง...' : 'แจ้งชำระเงินแล้ว'}
              </button>
              {!slipUploaded && (
                <div className="dashboard-card-sub" style={{ marginTop: 4 }}>
                  แนบรูปสลิปก่อนจึงจะกดแจ้งชำระเงินได้
                </div>
              )}
              {notifyError && <p className="dashboard-message error">{notifyError}</p>}
            </div>
          </section>
        )}

        {/* ── ขั้นที่ 3: แจ้งชำระสำเร็จ รอ Admin ตรวจ ──────────────────────────── */}
        {notified && (
          <section className="dashboard-section">
            <h2>✅ แจ้งชำระเงินเรียบร้อย</h2>
            <p className="dashboard-message">
              ระบบได้แจ้งทีมงานให้ตรวจสอบการชำระเงินของคุณแล้ว เมื่ออนุมัติ บัญชีของคุณจะอัพเกรดเป็น
              Premium โดยอัตโนมัติ (โดยปกติภายใน 24 ชั่วโมง) — ขอบคุณที่สนับสนุน EasyDCA 🙏
            </p>
            <div style={{ marginTop: '1rem' }}>
              <button
                type="button"
                className="dashboard-logout-btn"
                onClick={() => navigate('/dashboard')}
              >
                กลับสู่ Dashboard
              </button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default Premium;
