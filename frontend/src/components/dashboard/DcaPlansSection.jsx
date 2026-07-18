import { useState } from 'react';
import AssetPicker from './AssetPicker.jsx';
import { typeMeta } from '../../lib/assetTypeMeta.js';
import { apiPost, apiPatch, apiDelete } from '../../lib/api.js';
import { dcaPlanErrorMessage } from '../../lib/dcaPlansErrors.js';
import { isCurrencySupportedForSymbol } from '../../lib/dcaPlanCurrency.js';

const WEEKDAY_OPTIONS = [
  { value: 0, label: 'อาทิตย์' },
  { value: 1, label: 'จันทร์' },
  { value: 2, label: 'อังคาร' },
  { value: 3, label: 'พุธ' },
  { value: 4, label: 'พฤหัสบดี' },
  { value: 5, label: 'ศุกร์' },
  { value: 6, label: 'เสาร์' },
];

function fmt(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString('th-TH', { maximumFractionDigits: 2 }) : '-';
}

function parseAmount(raw) {
  const n = parseFloat(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ═══════════════════════════════════════════════════════════════════════
// DcaPlansSection — หน้าจัดการแผน DCA (S8 R3 รอบ 3, งานที่ 2) — List แผนทั้งหมด
// (Active+Paused) + ฟอร์มสร้างแผนใหม่ ผูกกับ /api/v1/dca-plans ตรงๆ
// ═══════════════════════════════════════════════════════════════════════
// ตารางนี้ไม่ใช่ Immutable Ledger — ลบ/แก้ไขแผนทำได้ปกติ ไม่มี Pattern
// Reversal/Undo แบบ Transaction แค่ต้อง Confirm ก่อนลบเสมอ (Hard Delete จริง)
//
// props:
//   plans: [{id,symbol,name,amountTotal,currency,frequency,dayOfWeek,dayOfMonth,
//     dayLabel,active}] จาก GET /api/v1/dca-plans
//   symbols: [{symbol,name,type}] จาก GET /api/v1/assets/symbols (ใช้หา type เพื่อ
//     สีอวตาร์ + isCurrencySupportedForSymbol ของฟอร์มสร้างแผน)
//   loadError: ข้อความ error ถ้าโหลด plans ไม่สำเร็จ (Parent เป็นคน Fetch/Fallback)
//   onChanged(): เรียกหลัง Create/Pause/Resume/Delete สำเร็จ ให้ Parent Refetch ทั้ง
//     listPlans และ overview (todayDuePlans อาจเปลี่ยนถ้าแผนที่แก้ตรงกับวันนี้พอดี)
//   showToast(message): แสดง Toast แจ้งผลสำเร็จ (Component เดียวกับที่ DashboardHome
//     ใช้อยู่แล้วสำหรับบันทึก DCA)
function DcaPlansSection({ plans, symbols, loadError, onChanged, showToast }) {
  const [picked, setPicked] = useState(null);
  const [amountInput, setAmountInput] = useState('');
  const [currency, setCurrency] = useState('THB');
  const [frequency, setFrequency] = useState('');
  const [frequencyValue, setFrequencyValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [busyPlanId, setBusyPlanId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [deleteError, setDeleteError] = useState(null);

  const symbolTypeBySymbol = new Map(symbols.map((s) => [s.symbol, s.type]));
  const supportsUsd = picked ? isCurrencySupportedForSymbol(picked.type) : false;
  const deleteTarget = plans.find((p) => p.id === confirmDeleteId) ?? null;

  function handlePickAsset(item) {
    setPicked(item);
    if (!isCurrencySupportedForSymbol(item.type)) {
      setCurrency('THB');
    }
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

    if (!picked) {
      setFormError('กรุณาเลือกสินทรัพย์ก่อนสร้างแผน');
      return;
    }

    const amountTotal = parseAmount(amountInput);
    if (amountTotal === null || amountTotal <= 0) {
      setFormError('กรุณากรอกจำนวนเงินที่ถูกต้อง (มากกว่า 0)');
      return;
    }

    if (frequency !== 'weekly' && frequency !== 'monthly') {
      setFormError('กรุณาเลือกความถี่ (รายสัปดาห์ หรือ รายเดือน)');
      return;
    }

    const frequencyValueNum = parseInt(frequencyValue, 10);
    if (
      frequency === 'weekly' &&
      (!Number.isInteger(frequencyValueNum) || frequencyValueNum < 0 || frequencyValueNum > 6)
    ) {
      setFormError('กรุณาเลือกวันในสัปดาห์ (อาทิตย์–เสาร์)');
      return;
    }
    if (
      frequency === 'monthly' &&
      (!Number.isInteger(frequencyValueNum) || frequencyValueNum < 1 || frequencyValueNum > 31)
    ) {
      setFormError('กรุณากรอกวันที่ของเดือน (1-31)');
      return;
    }

    setSubmitting(true);
    try {
      await apiPost('/api/v1/dca-plans', {
        symbol: picked.symbol,
        amountTotal,
        currency,
        frequency,
        frequencyValue: frequencyValueNum,
      });
      resetForm();
      onChanged();
      showToast('✅ ตั้งแผน DCA สำเร็จ');
    } catch (err) {
      setFormError(dcaPlanErrorMessage(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(plan) {
    setBusyPlanId(plan.id);
    setActionError(null);
    try {
      await apiPatch(`/api/v1/dca-plans/${plan.id}`, { active: !plan.active });
      onChanged();
      showToast(plan.active ? '⏸️ หยุดแผนชั่วคราวแล้ว' : '▶️ เปิดใช้แผนอีกครั้งแล้ว');
    } catch (err) {
      setActionError(dcaPlanErrorMessage(err.message));
    } finally {
      setBusyPlanId(null);
    }
  }

  async function handleConfirmDelete(planId) {
    setBusyPlanId(planId);
    setDeleteError(null);
    try {
      await apiDelete(`/api/v1/dca-plans/${planId}`);
      setConfirmDeleteId(null);
      onChanged();
      showToast('🗑️ ลบแผนแล้ว');
    } catch (err) {
      setDeleteError(dcaPlanErrorMessage(err.message));
    } finally {
      setBusyPlanId(null);
    }
  }

  return (
    <div className="dh-dca-plans">
      {loadError && <div className="dh-form-error">{loadError}</div>}
      {actionError && <div className="dh-form-error">{actionError}</div>}

      {plans.length === 0 ? (
        <p className="dh-empty-msg">ยังไม่มีแผน DCA — สร้างแผนแรกของคุณได้ด้านล่าง</p>
      ) : (
        <div className="dh-hold-list">
          {plans.map((plan) => {
            const meta = typeMeta(symbolTypeBySymbol.get(plan.symbol));
            const busy = busyPlanId === plan.id;
            return (
              <div className="dh-hrow" key={plan.id}>
                <span className="dh-avatar" style={{ background: meta.color }}>
                  {plan.symbol.slice(0, 4)}
                </span>
                <span className="dh-hrow-nm">
                  <b>{plan.symbol}</b>{' '}
                  <span className={`dh-tbadge ${plan.active ? 'dh-t-active' : 'dh-t-paused'}`}>
                    {plan.active ? 'Active' : 'Paused'}
                  </span>
                  <small>{plan.dayLabel}</small>
                </span>
                <span className="dh-hrow-val">
                  {fmt(plan.amountTotal)} {plan.currency}
                </span>
                <div className="dh-plan-row-actions">
                  <button
                    type="button"
                    className="dh-btn-ghost"
                    disabled={busy}
                    onClick={() => handleToggleActive(plan)}
                  >
                    {plan.active ? 'หยุดชั่วคราว' : 'เปิดใช้อีกครั้ง'}
                  </button>
                  <button
                    type="button"
                    className="dh-btn-ghost dh-btn-ghost-danger"
                    disabled={busy}
                    onClick={() => {
                      setDeleteError(null);
                      setConfirmDeleteId(plan.id);
                    }}
                  >
                    ลบ
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <form className="dh-dca-plan-form" autoComplete="off" onSubmit={handleSubmit}>
        <div className="dh-frow">
          <div>
            <label className="dh-fl">สินทรัพย์</label>
            <AssetPicker symbols={symbols} value={picked} onChange={handlePickAsset} />
          </div>
          <div>
            <label className="dh-fl" htmlFor="dh-plan-amt">
              จำนวนเงินต่อรอบ
            </label>
            <div className="dh-amt-wrap">
              <input
                className="dh-inp"
                id="dh-plan-amt"
                inputMode="decimal"
                placeholder="0.00"
                value={amountInput}
                onChange={(e) => setAmountInput(e.target.value)}
              />
              {supportsUsd ? (
                <div className="dh-cur-toggle">
                  <button
                    type="button"
                    className={currency === 'THB' ? 'dh-cur-on' : ''}
                    onClick={() => setCurrency('THB')}
                  >
                    THB
                  </button>
                  <button
                    type="button"
                    className={currency === 'USD' ? 'dh-cur-on' : ''}
                    onClick={() => setCurrency('USD')}
                  >
                    USD
                  </button>
                </div>
              ) : (
                <span className="dh-cur">THB</span>
              )}
            </div>
          </div>
        </div>

        <div className="dh-frow">
          <div>
            <label className="dh-fl" htmlFor="dh-plan-freq">
              ความถี่
            </label>
            <select
              className="dh-inp"
              id="dh-plan-freq"
              value={frequency}
              onChange={(e) => {
                setFrequency(e.target.value);
                setFrequencyValue('');
              }}
            >
              <option value="">เลือกความถี่</option>
              <option value="weekly">รายสัปดาห์</option>
              <option value="monthly">รายเดือน</option>
            </select>
          </div>
          <div>
            {frequency === 'weekly' && (
              <>
                <label className="dh-fl" htmlFor="dh-plan-dow">
                  วันในสัปดาห์
                </label>
                <select
                  className="dh-inp"
                  id="dh-plan-dow"
                  value={frequencyValue}
                  onChange={(e) => setFrequencyValue(e.target.value)}
                >
                  <option value="">เลือกวัน</option>
                  {WEEKDAY_OPTIONS.map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </>
            )}
            {frequency === 'monthly' && (
              <>
                <label className="dh-fl" htmlFor="dh-plan-dom">
                  วันที่ของเดือน
                </label>
                <input
                  className="dh-inp"
                  id="dh-plan-dom"
                  type="number"
                  min="1"
                  max="31"
                  placeholder="1-31"
                  value={frequencyValue}
                  onChange={(e) => setFrequencyValue(e.target.value)}
                />
              </>
            )}
          </div>
        </div>

        {formError && <div className="dh-form-error">{formError}</div>}

        <button className="dh-btn-main" type="submit" disabled={submitting}>
          {submitting ? 'กำลังสร้างแผน...' : '+ สร้างแผน DCA ใหม่'}
        </button>
      </form>

      {deleteTarget && (
        <div
          className="dh-modal-overlay"
          onClick={() => busyPlanId !== deleteTarget.id && setConfirmDeleteId(null)}
        >
          <div className="dh-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dh-modal-header">
              <h3>🗑️ ยืนยันลบแผน DCA</h3>
            </div>
            <div className="dh-modal-body">
              <p>คุณกำลังจะลบแผนนี้ถาวร (ลบแล้วกู้คืนไม่ได้):</p>
              <table className="dh-modal-summary">
                <tbody>
                  <tr>
                    <td>สินทรัพย์</td>
                    <td>{deleteTarget.symbol}</td>
                  </tr>
                  <tr>
                    <td>รอบ</td>
                    <td>{deleteTarget.dayLabel}</td>
                  </tr>
                  <tr>
                    <td>จำนวนเงิน</td>
                    <td>
                      {fmt(deleteTarget.amountTotal)} {deleteTarget.currency}
                    </td>
                  </tr>
                </tbody>
              </table>
              {deleteError && <p className="dh-modal-error">{deleteError}</p>}
              <div className="dh-modal-actions">
                <button
                  type="button"
                  className="dh-btn-ghost"
                  onClick={() => setConfirmDeleteId(null)}
                  disabled={busyPlanId === deleteTarget.id}
                >
                  ไม่ลบ
                </button>
                <button
                  type="button"
                  className="dh-btn-ghost dh-btn-ghost-danger"
                  onClick={() => handleConfirmDelete(deleteTarget.id)}
                  disabled={busyPlanId === deleteTarget.id}
                >
                  {busyPlanId === deleteTarget.id ? 'กำลังลบ...' : 'ยืนยันลบแผนนี้'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default DcaPlansSection;
