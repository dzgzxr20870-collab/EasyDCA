import { useState } from 'react';
// ⚠️ Reuse ของเดิมทั้งชุด **ห้ามเขียน Dropdown ค้นหาสินทรัพย์ใหม่** — ตัวเดียวกับ
// ที่ DcaForm/RecordTransactionModal ใช้อยู่ (ค้นหา/Keyboard Nav/Chips หมวด)
import AssetPicker from '../dashboard/AssetPicker.jsx';
import { isCurrencySupportedForSymbol } from '../../lib/dcaPlanCurrency.js';
import {
  validateDcaPlanForm,
  existingPlanForSymbol,
  WEEKDAY_OPTIONS,
} from './dcaPlanFormLogic.js';

// ═══════════════════════════════════════════════════════════════════════════
// DcaPlanForm — ฟอร์มสร้างแผน DCA บน /app (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port ตรรกะการเรียก API + การจัดการ Error มาจาก
// `components/dashboard/DcaPlansSection.jsx` ตัวเดิม (ไฟล์นั้นยังใช้งานอยู่บนหน้า
// เก่า **ห้ามแตะ**) — ต่างแค่ Layout ที่ใช้ Class ชุด `demo-*` ของ Stage 9
//
// ⚠️ ตรรกะตัดสิน (Validate/รูปร่าง Payload) อยู่ที่ `dcaPlanFormLogic.js` ซึ่งเป็น
// Pure Function ที่มี Test คลุม — ที่นี่ทำหน้าที่ Apply ผลลง State เท่านั้น
//
// ⚠️ **ห้ามใช้ภาษาชี้นำการลงทุน** (กฎเหล็กข้อ 1) — ฟอร์มนี้บอกได้แค่ "ตั้งแผน
// อย่างไร" ห้ามมีข้อความประเภท "ควรเพิ่มยอด DCA" หรือ "ช่วงนี้เหมาะกับการซื้อ"

function DcaPlanForm({ plans = [], symbols = [], loadingSymbols, submitting, onSubmit }) {
  const [picked, setPicked] = useState(null);
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState('THB');
  const [frequency, setFrequency] = useState('');
  const [frequencyValue, setFrequencyValue] = useState('');
  const [formError, setFormError] = useState(null);

  const supportsUsd = picked ? isCurrencySupportedForSymbol(picked.type) : false;
  // ⚠️ UX เท่านั้น ไม่ใช่ด่าน — "แทนที่แผนเดิม" คือพฤติกรรมที่ถูกต้องตาม Contract
  const replacing = existingPlanForSymbol(plans, picked?.symbol);

  function handlePickAsset(item) {
    setPicked(item);
    // สินทรัพย์ที่ตั้งแผน USD ไม่ได้ → ดึงกลับเป็น THB ทันที ไม่ปล่อยให้ค้างแล้ว
    // ไปโดน 400 CURRENCY_NOT_SUPPORTED_FOR_ASSET ตอนกดบันทึก
    if (!isCurrencySupportedForSymbol(item?.type)) setCurrency('THB');
    setFormError(null);
  }

  function resetForm() {
    setPicked(null);
    setAmountInput('');
    setCurrency('THB');
    setFrequency('');
    setFrequencyValue('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);

    const { error, payload } = validateDcaPlanForm({
      picked,
      amountInput,
      currency,
      frequency,
      frequencyValue,
    });
    if (error) {
      setFormError(error);
      return;
    }

    // Parent เป็นคนยิง API + จัดการ Error ของ Backend (คืน true เมื่อสำเร็จ)
    const ok = await onSubmit(payload);
    if (ok) resetForm();
  }

  return (
    <form className="demo-form app-dca-form" onSubmit={handleSubmit}>
      <div className="demo-field">
        <span>สินทรัพย์</span>
        {loadingSymbols && (
          <p className="app-state app-state--loading">กำลังโหลดรายการสินทรัพย์...</p>
        )}
        <AssetPicker
          symbols={symbols}
          value={picked}
          onChange={handlePickAsset}
          disabled={loadingSymbols || submitting}
        />
        {/* ⭐ เตือนว่าจะแทนที่แผนเดิม — ไม่บล็อก เพราะเป็นวิธีที่ระบบตั้งใจให้
            "แก้แผน" ได้ด้วยการสร้างทับ (API.md § 15.5.1) */}
        {replacing && (
          <small className="app-note">
            มีแผนของ {replacing.symbol} อยู่แล้ว — บันทึกครั้งนี้จะ<strong>แทนที่แผนเดิม</strong>
          </small>
        )}
      </div>

      <label className="demo-field">
        <span>จำนวนเงินต่อรอบ</span>
        <input
          type="text"
          inputMode="decimal"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          placeholder="เช่น 1000"
          disabled={submitting}
        />
      </label>

      <label className="demo-field">
        <span>สกุลเงิน</span>
        <select
          value={currency}
          onChange={(e) => setCurrency(e.target.value)}
          disabled={submitting || !supportsUsd}
        >
          <option value="THB">บาท (THB)</option>
          <option value="USD">ดอลลาร์ (USD)</option>
        </select>
        {/* ⚠️ บอกเหตุผลที่ช่องถูกปิด ไม่ใช่ปิดเฉยๆ ให้ผู้ใช้เดาเอง */}
        {picked && !supportsUsd && (
          <small className="app-note">
            สินทรัพย์นี้ตั้งแผนเป็นสกุล USD ไม่ได้ — รองรับเฉพาะคริปโตและหุ้นสหรัฐ
          </small>
        )}
      </label>

      <label className="demo-field">
        <span>ความถี่</span>
        <select
          value={frequency}
          onChange={(e) => {
            setFrequency(e.target.value);
            // เปลี่ยนความถี่ = ช่วงค่าที่ถูกต้องเปลี่ยนตาม ต้องล้างค่าเดิมทิ้ง
            // ไม่งั้นวันที่ 25 ของ monthly จะค้างไปเป็น weekly ที่รับแค่ 0–6
            setFrequencyValue('');
          }}
          disabled={submitting}
        >
          <option value="">— เลือกความถี่ —</option>
          <option value="weekly">รายสัปดาห์</option>
          <option value="monthly">รายเดือน</option>
        </select>
      </label>

      {frequency === 'weekly' && (
        <label className="demo-field">
          <span>วันในสัปดาห์</span>
          <select
            value={frequencyValue}
            onChange={(e) => setFrequencyValue(e.target.value)}
            disabled={submitting}
          >
            <option value="">— เลือกวัน —</option>
            {WEEKDAY_OPTIONS.map((d) => (
              <option key={d.value} value={d.value}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
      )}

      {frequency === 'monthly' && (
        <label className="demo-field">
          <span>วันที่ของเดือน</span>
          <input
            type="number"
            min="1"
            max="31"
            value={frequencyValue}
            onChange={(e) => setFrequencyValue(e.target.value)}
            placeholder="1-31"
            disabled={submitting}
          />
          {/* วันที่ 29–31 ไม่มีในบางเดือน — Backend เลื่อนให้เองตามกติกาเดิมของ
              dcaReminder ไม่ใช่ข้ามรอบ · บอกไว้กันผู้ใช้เข้าใจผิด */}
          {Number(frequencyValue) > 28 && (
            <small className="app-note">
              เดือนที่ไม่มีวันที่นี้ ระบบจะเตือนในวันสุดท้ายของเดือนแทน
            </small>
          )}
        </label>
      )}

      {formError && (
        <p className="app-state app-state--error" role="alert">
          {formError}
        </p>
      )}

      <div className="demo-actions">
        <button type="submit" className="demo-btn demo-btn--primary" disabled={submitting}>
          {submitting ? 'กำลังบันทึก...' : 'ตั้งแผน DCA'}
        </button>
      </div>
    </form>
  );
}

export default DcaPlanForm;
