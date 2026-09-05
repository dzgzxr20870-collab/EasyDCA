import { useState } from 'react';
import { updateAsset } from '../../lib/portfolioApi.js';

// ตรงกับ assetsService.SECTOR_MAX_LENGTH ฝั่ง Backend (CHECK ของ assets.sector,
// migration 043) — Duplicate ค่าคงที่นี้เพราะ Frontend/Backend เป็นคนละ Bundle
// (แพทเทิร์นเดียวกับ THAI_MONTH_NAMES/formatThaiDate ที่ซ้ำกันข้าม pages/components)
// ⚠️ ถ้า Backend เปลี่ยนค่านี้ ต้องแก้ที่นี่ให้ตรงกันด้วย ไม่งั้น Frontend จะ
// Validate หลวม/แน่นกว่าความจริง
const SECTOR_MAX_LENGTH = 60;

// ═══════════════════════════════════════════════════════════════════════════
// EditSectorDialog — กำหนดหมวดธุรกิจ (Sector) ให้สินทรัพย์ (พรอมต์ ก.ย. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ Pattern เดียวกับ MoveAssetPortfolioDialog.jsx — ใช้ PATCH /assets/{id}
// ที่มีอยู่แล้ว (assets.service ไม่แตะสูตรเงินเลย, sector เป็นมิติจัดกลุ่มล้วน)
// ไม่สร้าง Endpoint ใหม่
//
// ⚠️ ค่าว่าง/เว้นวรรคล้วน = "ล้าง Sector" — ตรงกับ Convention ของ
// assets.service.normalizeSector (สตริงว่างหลัง Trim → ส่ง null ให้ Backend
// แปลเป็น NULL) **ต้อง Trim ก่อนส่งเสมอ** ไม่งั้นช่องว่างล้วนจะถูกนับความยาว
// เกิน 0 ทั้งที่ควรตีความเป็น "ล้างค่า" เหมือนกัน

function EditSectorDialog({ holding, onClose, onSaved }) {
  const [value, setValue] = useState(holding.sector ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const trimmed = value.trim().replace(/\s+/g, ' ');
  const tooLong = trimmed.length > SECTOR_MAX_LENGTH;

  async function handleSave() {
    if (tooLong) return;
    setSaving(true);
    setError(null);
    try {
      // สตริงว่าง → null (ล้างค่า) ตรงกับ Convention ของ Backend
      await updateAsset(holding.assetId, { sector: trimmed === '' ? null : trimmed });
      await onSaved?.();
      onClose();
    } catch (err) {
      setError(err?.message ?? 'บันทึกหมวดธุรกิจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-modal-backdrop" role="dialog" aria-modal="true" aria-label="กำหนดหมวดธุรกิจ">
      <div className="app-modal">
        <header className="app-modal__head">
          <h2>หมวดธุรกิจของ {holding.symbol}</h2>
          <button type="button" className="app-modal__close" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </header>

        <div className="app-modal__body">
          <p className="app-note">
            ใช้จัดกลุ่มสัดส่วนพอร์ตแบบ &quot;หมวดธุรกิจ&quot; (กราฟโดนัทหน้าพอร์ต) — พิมพ์ชื่อเอง
            เช่น &quot;เทคโนโลยี&quot;, &quot;พลังงาน&quot; ปล่อยว่างไว้เพื่อล้างหมวดธุรกิจเดิม
          </p>

          <label className="demo-field">
            <span>หมวดธุรกิจ</span>
            <input
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="เช่น เทคโนโลยี"
              disabled={saving}
              maxLength={SECTOR_MAX_LENGTH + 20}
            />
          </label>

          {tooLong && (
            <p className="app-state app-state--warn" role="alert">
              หมวดธุรกิจยาวเกินไป ({trimmed.length}/{SECTOR_MAX_LENGTH} ตัวอักษร)
            </p>
          )}

          {error && (
            <p className="app-state app-state--error" role="alert">
              {error}
            </p>
          )}

          <div className="demo-actions">
            <button
              type="button"
              className="demo-btn demo-btn--primary"
              disabled={saving || tooLong}
              onClick={handleSave}
            >
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </button>
            <button type="button" className="demo-btn" onClick={onClose} disabled={saving}>
              ยกเลิก
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default EditSectorDialog;
