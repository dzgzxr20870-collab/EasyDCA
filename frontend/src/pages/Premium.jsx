import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getToken, stashReturnTo, apiGet, apiPost, apiUpload, API_BASE_URL } from '../lib/api.js';
// Reuse Style Pattern เดียวกับ Dashboard/Admin (การ์ด/ปุ่ม) — ไม่ทำ CSS ใหม่
import './Dashboard.css';
// Mascot — ข้อยกเว้นกฎ "ห้าม Mascot" ของโปรเจกต์ จำกัดเฉพาะหน้า /premium เท่านั้น
// (ผู้ใช้อนุมัติ/ออกแบบเองแล้ว) ห้ามนำไปใช้หน้าอื่น
import mascotPremium from '../assets/mascot-premium.png';

// ชื่อเดือนไทยเต็ม — Copy Pattern เดียวกับ Dashboard.jsx/DashboardHome.jsx
// (formatThaiDate เขียน Inline ในแต่ละหน้า ไม่มี Shared Util ข้ามหน้าในโปรเจกต์นี้)
const THAI_MONTH_NAMES = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

// จัดรูปวันหมดอายุ Premium เป็นภาษาไทย/พ.ศ. ตามเขตเวลา Asia/Bangkok
function formatThaiDate(value) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));

  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  const year = get('year');
  const month = get('month');
  const day = get('day');

  return `${day} ${THAI_MONTH_NAMES[month - 1]} ${year + 543}`;
}

// ตารางเทียบ Feature Free vs Premium — เพดาน "จำนวนสินทรัพย์" และ "จำนวนแผน DCA"
// ดึงจาก assetLimit ที่ GET /api/v1/dashboard/me คืนจริง (ไม่ Hardcode เลข) เพดาน
// แผน DCA ใช้เลขเดียวกับ Asset Limit ได้เพราะตั้งใจให้เท่ากันเสมอโดยออกแบบ (ดู
// entitlement.service.js: FREE_TIER_DCA_PLAN_LIMIT ผูกกับ FREE_TIER_ASSET_LIMIT
// และมี Test ยืนยัน Invariant นี้ไว้แล้ว) กันต้องเพิ่ม Field ใหม่ใน Backend ซ้ำ
function buildFeatureRows(assetLimit) {
  return [
    { label: 'บันทึก DCA (พิมพ์/กดปุ่ม)', free: true, premium: true },
    { label: 'จำนวนสินทรัพย์ที่ถือได้', free: `จำกัด ${assetLimit} ตัว`, premium: 'ไม่จำกัด' },
    { label: 'แผน DCA อัตโนมัติ (ตั้งเตือน)', free: `จำกัด ${assetLimit} แผน`, premium: 'ไม่จำกัด' },
    { label: 'แนบสลิปให้ AI อ่านอัตโนมัติ', free: false, premium: true },
    { label: 'ส่งออกรายงาน PDF/Excel', free: false, premium: true },
    { label: 'Dashboard เว็บเต็มรูปแบบ', free: true, premium: true },
  ];
}

// Render List <li> ของการ์ดเทียบแผน จาก buildFeatureRows แถวเดียวกัน (column =
// 'free' | 'premium') — ค่าที่เป็น String (เช่น "จำกัด 2 ตัว") ต่อท้ายในวงเล็บ,
// false = ปิด (✗ + สีจาง), อย่างอื่นถือว่าเปิด (✓)
function renderPlanFeatureList(rows, column) {
  return rows.map((row) => {
    const value = row[column];
    const enabled = value !== false;
    const detail = typeof value === 'string' ? ` (${value})` : '';
    return (
      <li key={row.label} className={enabled ? undefined : 'off'}>
        <span className="dashboard-premium-plan-check">{enabled ? '✓' : '✗'}</span>
        <span>
          {row.label}
          {detail}
        </span>
      </li>
    );
  });
}

// พอร์ตตัวอย่างประกอบ Hero (Decorative Mock) — สัดส่วนสมมติทั่วไป ไม่ใช่ข้อมูลจริง
// ของ User และไม่ใช่ผลตอบแทนที่ Premium การันตีให้ได้ (EasyDCA ห้ามสื่อการันตี/ผล
// ตอบแทนการลงทุนตามกฎยืนของโปรเจกต์) — ใช้สัดส่วน Asset Allocation (องค์ประกอบพอร์ต)
// แทนตัวเลขผลตอบแทน/กำไร กัน User เข้าใจผิดว่าเป็นการการันตีผลตอบแทน ต้องมี Label
// "ภาพประกอบ" กำกับเสมอ (ดู Disclaimer ท้ายการ์ด)
const MOCK_ALLOCATION = [
  { label: 'คริปโต', pct: 40 },
  { label: 'หุ้นสหรัฐ', pct: 35 },
  { label: 'ทองคำ', pct: 25 },
];

// Benefit "Premium จะช่วยคุณ" — อ้างอิงเฉพาะ Feature/Gate จริงที่มีอยู่แล้วเท่านั้น
// (Asset Limit, DCA Planner Gate, AI Slip OCR Gate (Round 9, Premium เท่านั้น),
// Export Gate) ห้ามใส่ Feature ที่ระบบยังไม่มีจริง (เช่น Multi-Portfolio)
const PREMIUM_BENEFITS = [
  {
    icon: '💼',
    title: 'ถือสินทรัพย์ได้ไม่จำกัด',
    desc: 'ติดตามพอร์ตของคุณได้ทุกสินทรัพย์ ไม่ต้องเลือกว่าจะเก็บอะไรบ้าง',
  },
  {
    icon: '🔔',
    title: 'ตั้งแผน DCA อัตโนมัติได้ไม่จำกัด',
    desc: 'ตั้งเตือนซื้อสินทรัพย์ได้หลายแผนพร้อมกัน ไม่ติดเพดานเหมือนแผนฟรี',
  },
  {
    icon: '🤖',
    title: 'AI อ่านสลิปให้อัตโนมัติ',
    desc: 'แนบรูปสลิปซื้อขาย แล้วให้ AI กรอกรายการให้ทันที ไม่ต้องพิมพ์เอง',
  },
  {
    icon: '📄',
    title: 'ส่งออกรายงาน PDF/Excel',
    desc: 'ดาวน์โหลดรายงานพอร์ตของคุณไปใช้ต่อได้ทุกเมื่อที่ต้องการ',
  },
];

// เลื่อนหน้าไปที่การ์ดเทียบแผน — ใช้กับปุ่ม CTA ใน Hero (Pattern scrollIntoView
// เดียวกับที่ DashboardHome.jsx ใช้กับเมนู Sidebar Anchor)
function scrollToPlans() {
  document.getElementById('dashboard-premium-plans')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

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
//
// Business Model: จ่ายครั้งเดียวต่อรอบ (ไม่ใช่ Subscription ที่ตัดเงินอัตโนมัติ) —
// plan_expires_at หมดอายุเองแล้ว Cron (planDowngrade.job.js) ลดเป็น Free ให้อัตโนมัติ
// ไม่มี Auto-renew ให้ "ยกเลิก" จึงใช้ Copy "ไม่ต้องผูกมัดระยะยาว" แทน (ดู Perks Strip)

// ราคาแพ็กเกจจริง (Presentation) — ยอดที่ต้องโอนจริง (รวมเศษสตางค์เฉพาะคำขอ) มาจาก
// Response ของ requestPayment เท่านั้น ไม่คำนวณเองฝั่ง Client — priceThb ใช้แสดงผล
// บนการ์ดเทียบแผน + คำนวณ "เฉลี่ยต่อเดือน" ของแพ็กเกจรายปีเท่านั้น (Single Source
// เดียวกับที่เคยใช้ Generate QR กันเลขไม่ตรงกัน 2 จุด)
const PLAN_OPTIONS = [
  { value: 'monthly', label: 'รายเดือน', priceThb: 59, priceUnit: 'บาท / เดือน' },
  { value: 'yearly', label: 'รายปี', priceThb: 590, priceUnit: 'บาท / ปี' },
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

// ── รับ Premium ฟรี 1 เดือน (แคมเปญชั่วคราว) — Error Code จาก
// POST /api/v1/payment/free-trial/claim (payment.controller FREE_TRIAL_MESSAGES)
// แยกตารางจาก ERROR_MESSAGES ด้านบนเพราะเป็นคนละ Endpoint/คนละชุด Code
const FREE_TRIAL_ERROR_MESSAGES = {
  FEATURE_DISABLED: 'แคมเปญรับ Premium ฟรีปิดรับแล้วในขณะนี้',
  ACCOUNT_NOT_ELIGIBLE: 'บัญชีนี้ไม่สามารถรับสิทธิ์นี้ได้',
  ALREADY_CLAIMED: 'คุณใช้สิทธิ์รับ Premium ฟรีไปแล้ว (ใช้ได้ครั้งเดียวเท่านั้น)',
  ALREADY_PREMIUM: 'คุณเป็นสมาชิก Premium อยู่แล้ว',
  ALREADY_PAID_BEFORE:
    'สิทธิ์นี้สำหรับผู้ที่ยังไม่เคยเป็นสมาชิก Premium เท่านั้น — ต่ออายุได้ผ่านการชำระเงินตามปกติ',
  ALREADY_GRANTED_BEFORE: 'คุณเคยได้รับสิทธิ์ Premium ฟรีไปแล้ว',
  USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้',
  UNAUTHORIZED: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่อีกครั้ง',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
};

function freeTrialErrorText(code) {
  return FREE_TRIAL_ERROR_MESSAGES[code] ?? FREE_TRIAL_ERROR_MESSAGES.INTERNAL_ERROR;
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

  // สถานะ Plan ปัจจุบัน — Default เป็น Free/assetLimit 2 (ค่าจริงตอนนี้) ระหว่างรอ
  // /me โหลด หรือถ้าโหลดไม่สำเร็จ (Pattern เดียวกับ planInfo Fallback ใน Dashboard.jsx)
  const [planInfo, setPlanInfo] = useState({
    isPremiumActive: false,
    planExpiresAt: null,
    assetLimit: 2,
  });

  // billingPeriod ที่กำลังสร้าง QR อยู่ (null = ไม่มี) — การ์ดเทียบแผนแต่ละใบยิง
  // handleCreatePayment(period) ตรงๆ เมื่อกด "เลือกแพ็กเกจนี้" (รวมขั้นเลือก+ยืนยัน
  // เป็นคลิกเดียวต่อการ์ด แทน Chip-Select + ปุ่มแยกแบบเดิม) ไม่ใช่ Logic การเงินใหม่
  // ยังเรียก POST /api/v1/payment/request Endpoint เดิมทุกประการ
  const [creatingPeriod, setCreatingPeriod] = useState(null);
  const [payment, setPayment] = useState(null); // { paymentId, amountThb, expiresAt }
  const [createError, setCreateError] = useState(null);

  const [slipFile, setSlipFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState(null);
  const [slipUploaded, setSlipUploaded] = useState(false);

  const [notifying, setNotifying] = useState(false);
  const [notifyError, setNotifyError] = useState(null);
  const [notified, setNotified] = useState(false);

  // ── รับ Premium ฟรี 1 เดือน (แคมเปญชั่วคราว) ──────────────────────────────────
  // freeTrial = ผลจาก GET /api/v1/payment/free-trial
  //   { enabled, eligible, reason, message, claimedAt }
  // Default enabled:false → ถ้า Endpoint ล่ม/ยังโหลดไม่เสร็จ จะ "ไม่โชว์ Banner" ไว้ก่อน
  // (Fail-closed: ดีกว่าโชว์ปุ่มแจกของฟรีค้างไว้ทั้งที่แคมเปญปิดแล้ว)
  const [freeTrial, setFreeTrial] = useState({ enabled: false, eligible: false });
  const [claimingTrial, setClaimingTrial] = useState(false);
  const [trialError, setTrialError] = useState(null);
  const [trialClaimed, setTrialClaimed] = useState(null); // { planExpiresAt } หลังกดสำเร็จ

  // ── Route Guard — ไม่มี Token → กลับ Login (เหมือน DashboardHome/Admin) ────────
  useEffect(() => {
    if (!getToken()) {
      // จำหน้านี้ไว้ ให้ Login พากลับมา /premium หลัง Re-auth (ไม่เด้งไป /dashboard)
      stashReturnTo(window.location.pathname + window.location.search);
      navigate('/', { replace: true });
    }
  }, [navigate]);

  // โหลดสถานะ Plan จริง (isPremiumActive/planExpiresAt/assetLimit) สำหรับตาราง
  // Feature + CTA Dynamic — ล้มเหลวเงียบๆ แล้วคง Default Free ไว้ (ไม่บล็อกหน้า)
  useEffect(() => {
    apiGet('/api/v1/dashboard/me')
      .then(setPlanInfo)
      .catch(() => {});
  }, []);

  // สิทธิ์รับ Premium ฟรี — แยก Endpoint จาก /dashboard/me โดยเจตนา (ต้อง Query
  // payments + premium_grant_logs เพิ่ม ซึ่งหนักเกินจะใส่ใน Hot Path ของ Dashboard)
  // ล้มเหลวเงียบๆ แล้วคง enabled:false ไว้ (ไม่บล็อกหน้า ไม่โชว์ Banner)
  useEffect(() => {
    apiGet('/api/v1/payment/free-trial')
      .then(setFreeTrial)
      .catch(() => {});
  }, []);

  const featureRows = buildFeatureRows(planInfo.assetLimit ?? 2);

  // กดรับ Premium ฟรี — Backend เป็นด่านตัดสินจริงเสมอ (Banner นี้แค่ซ่อน/โชว์ตาม
  // eligible เพื่อ UX เท่านั้น ไม่ได้เป็น Guard)
  async function handleClaimFreeTrial() {
    setTrialError(null);
    setClaimingTrial(true);
    try {
      const result = await apiPost('/api/v1/payment/free-trial/claim', {});
      setTrialClaimed({ planExpiresAt: result.planExpiresAt });
      // Refetch สถานะจริงจาก Backend แทนการเดาเอง (planInfo ต้องกลายเป็น Premium
      // และ freeTrial ต้องกลายเป็น eligible:false — ให้ Server เป็นคนบอก)
      apiGet('/api/v1/dashboard/me').then(setPlanInfo).catch(() => {});
      apiGet('/api/v1/payment/free-trial').then(setFreeTrial).catch(() => {});
    } catch (err) {
      // apiPost โยน Error(code) — แปลผ่านตารางข้อความไทย (ไม่โชว์ Code ดิบ)
      setTrialError(freeTrialErrorText(err.message));
    } finally {
      setClaimingTrial(false);
    }
  }

  async function handleCreatePayment(period) {
    setCreateError(null);
    setCreatingPeriod(period);
    try {
      const result = await apiPost('/api/v1/payment/request', { billingPeriod: period });
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
      setCreatingPeriod(null);
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
        {/* ── แคมเปญชั่วคราว: รับ Premium ฟรี 1 เดือน ────────────────────────────
            เงื่อนไขการโชว์ (ทั้งหมดต้องจริง):
              - freeTrial.enabled  → แคมเปญยังเปิดอยู่ (Flag ฝั่ง Backend)
              - ไม่ได้อยู่ในขั้นตอนจ่ายเงิน (!payment) → ไม่แย่งความสนใจตอนกำลังสแกน QR
              - eligible หรือเพิ่งกดสำเร็จ → คนที่ใช้สิทธิ์ไปแล้ว/ไม่มีสิทธิ์ ไม่เห็นเลย
                (ไม่โชว์ปุ่มที่กดแล้วขึ้น Error — Backend ยังกันซ้ำอยู่ดี Banner แค่ UX)
            ⚠️ Banner นี้ "ไม่ใช่ Guard" — ด่านตัดสินจริงคือ freeTrial.service ฝั่ง Backend */}
        {freeTrial.enabled && !payment && (freeTrial.eligible || trialClaimed) && (
          <section className="premium-freetrial">
            {trialClaimed ? (
              <div className="premium-freetrial-done">
                <p className="premium-freetrial-title">🎉 รับสิทธิ์เรียบร้อยแล้ว!</p>
                <p className="premium-freetrial-desc">
                  คุณเป็นสมาชิก Premium ถึงวันที่ <b>{formatThaiDate(trialClaimed.planExpiresAt)}</b>{' '}
                  — หลังจากนั้นบัญชีจะกลับเป็น Free อัตโนมัติ (ข้อมูลเดิมยังอยู่ครบ)
                  ต่ออายุได้ผ่านการชำระเงินด้านล่าง
                </p>
              </div>
            ) : (
              <>
                <div className="premium-freetrial-body">
                  <p className="premium-freetrial-title">🎁 รับ Premium ฟรี 1 เดือน</p>
                </div>
                <div className="premium-freetrial-action">
                  <button
                    type="button"
                    className="premium-freetrial-btn"
                    onClick={handleClaimFreeTrial}
                    disabled={claimingTrial}
                  >
                    {claimingTrial ? 'กำลังดำเนินการ...' : '🎁 รับสิทธิ์ฟรี 1 เดือน'}
                  </button>
                  {trialError && <p className="premium-freetrial-error">{trialError}</p>}
                </div>
              </>
            )}
          </section>
        )}

        {/* ── Hero Banner + Mascot (ข้อยกเว้นเฉพาะหน้านี้) ─────────────────────── */}
        {!payment && (
          <section className="dashboard-premium-hero">
            <div>
              <h1 className="dashboard-premium-hero-title">EasyDCA Premium</h1>
              <p className="dashboard-premium-hero-sub">
                ปลดล็อกการทำ DCA แบบเต็มรูปแบบ — ติดตามสินทรัพย์ไม่จำกัด ตั้งแผนอัตโนมัติไม่จำกัด
                พร้อมให้ AI ช่วยอ่านสลิปและส่งออกรายงานพอร์ตของคุณได้ทุกเมื่อ
              </p>
              {planInfo.isPremiumActive && (
                <p className="dashboard-premium-hero-expiry">
                  สมาชิกของคุณจะหมดอายุวันที่ {formatThaiDate(planInfo.planExpiresAt)}
                </p>
              )}
              <button type="button" className="dashboard-premium-hero-cta" onClick={scrollToPlans}>
                {planInfo.isPremiumActive ? '🔄 ต่ออายุสมาชิก Premium' : '👑 อัพเกรดเป็น Premium'}
              </button>
            </div>

            <div className="dashboard-premium-hero-right">
              <img src={mascotPremium} alt="EasyDCA Mascot" className="dashboard-premium-mascot" />
              <div className="dashboard-premium-mock-card">
                <p className="dashboard-premium-mock-title">ตัวอย่างสัดส่วนพอร์ต</p>
                <div className="dashboard-premium-mock-bars">
                  {MOCK_ALLOCATION.map((row) => (
                    <div className="dashboard-premium-mock-bar-row" key={row.label}>
                      <span className="dashboard-premium-mock-bar-label">{row.label}</span>
                      <span className="dashboard-premium-mock-bar-track">
                        <span
                          className="dashboard-premium-mock-bar-fill"
                          style={{ width: `${row.pct}%` }}
                        />
                      </span>
                      <span>{row.pct}%</span>
                    </div>
                  ))}
                </div>
                <p className="dashboard-premium-mock-disclaimer">
                  *ภาพประกอบตัวอย่าง ไม่ใช่ข้อมูลพอร์ตหรือผลตอบแทนจริง
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ── List "Premium จะช่วยคุณ" ─────────────────────────────────────────── */}
        {!payment && (
          <section className="dashboard-section">
            <h2>Premium จะช่วยคุณ</h2>
            <ul className="dashboard-premium-benefits">
              {PREMIUM_BENEFITS.map((b) => (
                <li className="dashboard-premium-benefit" key={b.title}>
                  <span className="dashboard-premium-benefit-ic">{b.icon}</span>
                  <div>
                    <p className="dashboard-premium-benefit-title">{b.title}</p>
                    <p className="dashboard-premium-benefit-desc">{b.desc}</p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* ── การ์ดเทียบแผน 3 คอลัมน์ (Free / Premium รายเดือน / Premium รายปี-เด่น) ── */}
        {!payment && (
          <section className="dashboard-section" id="dashboard-premium-plans">
            <h2>เลือกแผนที่ใช่สำหรับคุณ</h2>
            {createError && <p className="dashboard-message error">{createError}</p>}
            <div className="dashboard-premium-plans">
              <div className="dashboard-premium-plan-card">
                <p className="dashboard-premium-plan-name">Free</p>
                <p className="dashboard-premium-plan-price">ฟรี</p>
                <p className="dashboard-premium-plan-note">&nbsp;</p>
                <ul className="dashboard-premium-plan-features">
                  {renderPlanFeatureList(featureRows, 'free')}
                </ul>
                <div className="dashboard-premium-plan-current">
                  {!planInfo.isPremiumActive ? 'แผนที่คุณใช้อยู่ตอนนี้' : ' '}
                </div>
              </div>

              {PLAN_OPTIONS.map((opt) => {
                const featured = opt.value === 'yearly';
                return (
                  <div
                    key={opt.value}
                    className={`dashboard-premium-plan-card${featured ? ' featured' : ''}`}
                  >
                    {featured && <span className="dashboard-premium-plan-badge">แนะนำ · คุ้มกว่า</span>}
                    <p className="dashboard-premium-plan-name">Premium {opt.label}</p>
                    <p className="dashboard-premium-plan-price">
                      {opt.priceThb.toLocaleString('th-TH')} <small>{opt.priceUnit}</small>
                    </p>
                    <p className="dashboard-premium-plan-note">
                      {featured ? `เฉลี่ย ~${Math.round(opt.priceThb / 12)} บาท/เดือน` : ' '}
                    </p>
                    <ul className="dashboard-premium-plan-features">
                      {renderPlanFeatureList(featureRows, 'premium')}
                    </ul>
                    <button
                      type="button"
                      className={`dashboard-premium-plan-btn${featured ? ' primary' : ''}`}
                      onClick={() => handleCreatePayment(opt.value)}
                      disabled={creatingPeriod !== null}
                    >
                      {creatingPeriod === opt.value ? 'กำลังสร้าง QR...' : 'เลือกแพ็กเกจนี้'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* ── Perks Strip — เฉพาะข้อความที่เป็นจริงตาม Business Model ปัจจุบัน ──────── */}
        {!payment && (
          <section className="dashboard-section">
            <div className="dashboard-premium-perks">
              <div className="dashboard-premium-perk">
                <span className="dashboard-premium-perk-ic">🔓</span> ไม่ต้องผูกมัดระยะยาว
              </div>
              <div className="dashboard-premium-perk">
                <span className="dashboard-premium-perk-ic">💳</span> ชำระเงินปลอดภัยผ่าน PromptPay
              </div>
              <div className="dashboard-premium-perk">
                <span className="dashboard-premium-perk-ic">🔒</span> ข้อมูล Backup ของคุณเข้ารหัสระดับธนาคาร
                (AES-256-GCM)
              </div>
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
