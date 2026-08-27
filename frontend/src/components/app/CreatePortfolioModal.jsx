import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createPortfolio } from '../../lib/portfolioApi.js';

// ═══════════════════════════════════════════════════════════════════════════
// CreatePortfolioModal — สร้างพอร์ตใหม่ต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// ยิง `POST /api/v1/portfolios` ผ่าน `lib/portfolioApi.js` → `lib/api.js` ตัวเดิม
// **ไม่มี API Client ใหม่** (Token / 401 redirect / Error shape จัดการที่นั่นที่เดียว)
//
// ⚠️ **Frontend ตรวจ = UX ไม่ใช่ Gate** — ด่านจริงคือ `create_portfolio_locked`
// (migration 048) ที่ Lock แถว users แล้วนับพอร์ตใต้ Lock เพราะการตรวจฝั่ง Client
// เป็น check-then-insert ที่ไม่ Atomic เสมอ (ยิงสองแท็บพร้อมกันก็ทะลุได้)
// ที่นี่ตรวจเพื่อบอกผู้ใช้เร็วๆ ก่อนเสียเวลารอ Round-trip เท่านั้น
//
// ⚠️ ห้ามใช้ `<a href>` — JWT อยู่ใน Memory การ Reload ทั้งหน้าจะทำให้ Token หาย
// แล้วเด้งกลับ Login (ใช้ `navigate()` ของ React Router เท่านั้น)

// ต้องตรงกับ CHECK ของ `portfolios.type` และ `PORTFOLIO_TYPES` ฝั่ง Backend เป๊ะ
//
// ⚠️ **ห้ามเติม 'mixed' กลับเข้ามา** — Design Doc เคยเขียนผิดไว้ และ migration 044
// แก้เป็น 'custom' แล้ว ถ้าส่ง 'mixed' ไป Backend ตอบ 400 VALIDATION_ERROR ทันที
const TYPE_OPTIONS = [
  { value: 'custom', label: 'ผสม / กำหนดเอง' },
  { value: 'crypto', label: 'คริปโต' },
  { value: 'stock_th', label: 'หุ้นไทย' },
  { value: 'stock_us', label: 'หุ้นต่างประเทศ' },
  { value: 'etf', label: 'ETF' },
  { value: 'fund', label: 'กองทุนรวม' },
];

// ต้องตรงกับ CHECK constraint `char_length(name) <= 60` ของ migration 044
// เลขนี้อยู่ 2 ที่โดยเจตนา (Pattern เดียวกับ BROKER_NAME_MAX_LENGTH): ที่นี่เพื่อ
// บอกผู้ใช้ก่อนยิง API / ที่ DB เพื่อเป็นด่านสุดท้ายที่ Path อื่นข้ามไม่ได้
const NAME_MAX_LENGTH = 60;

// ═══════════════════════════════════════════════════════════════════════════
// ข้อความไทยต่อ Error Code ที่ Backend ตอบได้จริง
// ═══════════════════════════════════════════════════════════════════════════
// ⚠️ **ห้ามใช้ข้อความเดียวกันสำหรับ 'limit' กับ 'cap'** — คนที่ชน Sanity Cap 50
// คือผู้ใช้ Premium ที่จ่ายเงินอยู่แล้ว การชวนให้ "อัปเกรด" กับเขาคือข้อความที่ผิด
// และน่ารำคาญ (เขาอัปเกรดไปแล้ว) · ทางออกจริงของเขาคือลบพอร์ตที่ไม่ได้ใช้
export function createPortfolioErrorText(code, fallback) {
  const MAP = {
    VALIDATION_ERROR: `ชื่อพอร์ตต้องไม่เว้นว่างและยาวไม่เกิน ${NAME_MAX_LENGTH} ตัวอักษร`,
    PORTFOLIO_LIMIT_REACHED:
      'แพ็กเกจ Free ใช้ได้ 1 พอร์ต — อัปเกรดเป็น Premium เพื่อแยกหลายพอร์ตได้',
    PORTFOLIO_CAP_REACHED:
      'จำนวนพอร์ตถึงขีดจำกัดของระบบแล้ว กรุณาลบพอร์ตที่ไม่ได้ใช้ก่อนสร้างพอร์ตใหม่',
    PORTFOLIO_NAME_EXISTS: 'มีพอร์ตชื่อนี้อยู่แล้ว กรุณาใช้ชื่ออื่น',
  };

  return MAP[code] ?? fallback ?? 'สร้างพอร์ตไม่สำเร็จ';
}

function CreatePortfolioModal({ onClose, onCreated }) {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [type, setType] = useState('custom');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  const trimmed = name.trim();
  const nameTooLong = [...trimmed].length > NAME_MAX_LENGTH;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setErrorCode(null);

    if (!trimmed) return setError('กรุณาตั้งชื่อพอร์ต');
    if (nameTooLong) return setError(createPortfolioErrorText('VALIDATION_ERROR'));

    setSubmitting(true);
    try {
      const portfolio = await createPortfolio({ name: trimmed, type });
      await onCreated?.(portfolio);
    } catch (err) {
      // ⚠️ ต้องเก็บ code ไว้ด้วย ไม่ใช่แค่ข้อความ — ปุ่ม "อัปเกรด" ต้องโผล่เฉพาะ
      // กรณี 'limit' เท่านั้น (ดูเหตุผลใน createPortfolioErrorText)
      setErrorCode(err?.code ?? null);
      setError(createPortfolioErrorText(err?.code, err?.message));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-label="สร้างพอร์ตใหม่">
      <div className="app-modal">
        <header className="app-modal__head">
          <h2>สร้างพอร์ตใหม่</h2>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="app-modal__body">
          <label className="demo-field">
            <span>ชื่อพอร์ต</span>
            <input
              type="text"
              value={name}
              maxLength={NAME_MAX_LENGTH}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ระยะยาว, เก็บเกษียณ"
              autoFocus
            />
            <small className="app-note">
              {[...trimmed].length}/{NAME_MAX_LENGTH} ตัวอักษร
            </small>
          </label>

          <label className="demo-field">
            <span>ประเภทพอร์ต</span>
            <select value={type} onChange={(e) => setType(e.target.value)}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            {/* ⚠️ ต้องบอกให้ชัดว่าประเภทเป็นแค่ป้ายกำกับ ไม่ได้บังคับว่าใส่อะไรได้บ้าง
                ไม่งั้นผู้ใช้จะกลัวว่าเลือกผิดแล้วบันทึกสินทรัพย์ไม่ได้ */}
            <small className="app-note">
              ใช้เป็นป้ายกำกับสำหรับจัดกลุ่มเท่านั้น — ไม่ได้จำกัดว่าพอร์ตนี้ถือสินทรัพย์อะไรได้บ้าง
            </small>
          </label>

          {error && (
            <div className="app-state app-state--error" role="alert">
              <p>{error}</p>
              {/* ⚠️ ชวนอัปเกรดเฉพาะ 'limit' — คนที่ชน Cap 50 จ่ายเงินอยู่แล้ว */}
              {errorCode === 'PORTFOLIO_LIMIT_REACHED' && (
                <button
                  type="button"
                  className="demo-btn demo-btn--primary"
                  onClick={() => navigate('/premium')}
                >
                  ดูแพ็กเกจ Premium
                </button>
              )}
            </div>
          )}

          <div className="demo-actions">
            <button
              type="submit"
              className="demo-btn demo-btn--primary"
              disabled={submitting || !trimmed || nameTooLong}
            >
              {submitting ? 'กำลังสร้าง...' : 'สร้างพอร์ต'}
            </button>
            <button type="button" className="demo-btn" onClick={onClose} disabled={submitting}>
              ยกเลิก
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreatePortfolioModal;
