import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiGet, apiPost, apiPatch, apiDelete } from '../../lib/api.js';
import { dcaPlanErrorMessage, isUpgradeRequiredError } from '../../lib/dcaPlansErrors.js';
import { getAssetSymbols } from '../../lib/symbolsCache.js';
import DcaPlanForm from '../../components/app/DcaPlanForm.jsx';
import { describeSchedule } from '../../components/app/dcaPlanFormLogic.js';

// ═══════════════════════════════════════════════════════════════════════════
// AppDca — จัดการแผน DCA บน /app (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// เดิมหน้านี้เป็น **รายการอ่านอย่างเดียว** (มีแค่ apiGet) → ตั้งแผนใหม่ไม่ได้เลย
// ทั้งที่ Backend รองรับ CRUD เต็มมาตลอด (API.md § 15.5) รอบนี้ Port ตรรกะการ
// เรียก API + การจัดการ Error มาจาก `components/dashboard/DcaPlansSection.jsx`
// ตัวเดิม (ไฟล์นั้นยังใช้งานอยู่บนหน้าเก่า **ห้ามแตะ**)
//
// ⚠️ **ห้ามใช้ภาษาชี้นำการลงทุน** (กฎเหล็กข้อ 1) — หน้านี้บอกได้แค่ว่า "ตั้งแผนไว้
// อย่างไร" และ "ถึงรอบเมื่อไหร่" ห้ามมีข้อความประเภท "ควรเพิ่มยอด DCA" หรือ
// "ช่วงนี้เหมาะกับการซื้อ" เด็ดขาด
//
// ⚠️ **แผนที่ถูกหยุด (active: false) ต้องแสดงด้วย ห้ามกรองออก** — แผนที่ผู้ใช้
// "ลบ" ผ่าน LINE จะกลายเป็น active:false ไม่ได้หายไปจริง (API.md § 15.5.2)
// ถ้าซ่อนไว้ ผู้ใช้จะสร้างแผน Symbol เดิมซ้ำแล้วงงว่าทำไมของเดิมโผล่กลับมา
//
// ⚠️ **ไม่มีด่านจำกัดจำนวนแผนฝั่งเว็บ** — เพดาน Free เป็นของ Backend
// (403 PLAN_LIMIT_REACHED) เว็บแค่แสดงข้อความ + ปุ่มอัพเกรดเมื่อได้รับมา
// ถ้า Frontend นับเองจะเพี้ยนจากของจริงทันทีที่ธุรกิจเปลี่ยนเพดาน

function formatAmount(n, currency) {
  const num = new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
  return `${num} ${currency === 'USD' ? 'USD' : 'บาท'}`;
}

function AppDca() {
  const navigate = useNavigate();
  // Pattern เดียวกับ `?new=1` ของ AppPortfolio — กด Back ปิด Modal ยืนยันลบได้
  // ตามที่คาด และไม่ต้องยก State ขึ้นไปไว้ที่ Shell
  const [searchParams, setSearchParams] = useSearchParams();
  const confirmDeleteId = searchParams.get('delete');

  const [plans, setPlans] = useState([]);
  const [symbols, setSymbols] = useState([]);
  const [loadingSymbols, setLoadingSymbols] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formUpgrade, setFormUpgrade] = useState(false);
  const [busyPlanId, setBusyPlanId] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [deleteError, setDeleteError] = useState(null);
  const [toast, setToast] = useState(null);

  const deleteTarget = plans.find((p) => p.id === confirmDeleteId) ?? null;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet('/api/v1/dca-plans');
      setPlans(data?.plans ?? []);
    } catch (err) {
      setError(err?.message ?? 'โหลดแผน DCA ไม่สำเร็จ');
      setPlans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // รายการสินทรัพย์สำหรับ AssetPicker — symbolsCache มี Cache ระดับ Module อยู่แล้ว
  // (เรียกซ้ำจากหน้าอื่นก็ไม่ยิงซ้ำ) · โหลดพร้อมหน้าเลยเพราะฟอร์มอยู่บนหน้านี้
  // ตั้งแต่แรก ไม่ได้ซ่อนอยู่หลังปุ่มเหมือนใน RecordTransactionModal
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const list = await getAssetSymbols();
        if (alive) setSymbols(list);
      } catch {
        // ⚠️ โหลดรายการไม่ได้ → ฟอร์มสร้างแผนใช้ไม่ได้ แต่ **รายการแผนเดิมต้อง
        // ยังดูได้ปกติ** จึงไม่ตั้ง error ของทั้งหน้า (แยก Failure Domain)
        if (alive) setSymbols([]);
      } finally {
        if (alive) setLoadingSymbols(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function showToast(message) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  // คืน true เมื่อสำเร็จ — DcaPlanForm ใช้ตัดสินว่าจะล้างฟอร์มไหม
  async function handleCreate(payload) {
    setSubmitting(true);
    setFormError(null);
    setFormUpgrade(false);
    try {
      await apiPost('/api/v1/dca-plans', payload);
      await load();
      showToast('✅ ตั้งแผน DCA สำเร็จ');
      return true;
    } catch (err) {
      // ⚠️ ห้ามโชว์ Error Code ดิบ — แปลผ่านตารางกลางที่ครอบทุก Code ของ § 15.5
      setFormError(dcaPlanErrorMessage(err?.message));
      // PLAN_LIMIT_REACHED (403) แก้ที่ฟอร์มไม่ได้ ต้องอัพเกรด → โชว์ปุ่มแทน
      setFormUpgrade(isUpgradeRequiredError(err?.message));
      return false;
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleActive(plan) {
    setBusyPlanId(plan.id);
    setActionError(null);
    try {
      await apiPatch(`/api/v1/dca-plans/${plan.id}`, { active: !plan.active });
      await load();
      showToast(plan.active ? '⏸️ หยุดแผนชั่วคราวแล้ว' : '▶️ เปิดใช้แผนอีกครั้งแล้ว');
    } catch (err) {
      setActionError(dcaPlanErrorMessage(err?.message));
    } finally {
      setBusyPlanId(null);
    }
  }

  function askDelete(planId) {
    const next = new URLSearchParams(searchParams);
    next.set('delete', planId);
    setSearchParams(next, { replace: true });
    setDeleteError(null);
  }

  function cancelDelete() {
    const next = new URLSearchParams(searchParams);
    next.delete('delete');
    setSearchParams(next, { replace: true });
    setDeleteError(null);
  }

  // ⚠️ Hard Delete จริง (ไม่ใช่ Reversal แบบ transactions) — ต้อง Confirm เสมอ
  async function handleConfirmDelete(planId) {
    setBusyPlanId(planId);
    setDeleteError(null);
    try {
      await apiDelete(`/api/v1/dca-plans/${planId}`);
      cancelDelete();
      await load();
      showToast('🗑️ ลบแผน DCA แล้ว');
    } catch (err) {
      setDeleteError(dcaPlanErrorMessage(err?.message));
    } finally {
      setBusyPlanId(null);
    }
  }

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        <h1>แผน DCA</h1>
      </header>

      {toast && (
        <div className="app-state app-state--empty" role="status">
          {toast}
        </div>
      )}

      {/* ── ฟอร์มสร้างแผนใหม่ ─────────────────────────────────────────────── */}
      <div className="demo-card">
        <h2>ตั้งแผนใหม่</h2>
        <DcaPlanForm
          plans={plans}
          symbols={symbols}
          loadingSymbols={loadingSymbols}
          submitting={submitting}
          onSubmit={handleCreate}
        />

        {formError && (
          <p className="app-state app-state--error" role="alert">
            {formError}
            {formUpgrade && (
              <>
                {' '}
                <button
                  type="button"
                  className="demo-btn"
                  onClick={() => navigate('/premium')}
                >
                  ดูแพ็กเกจ Premium
                </button>
              </>
            )}
          </p>
        )}
      </div>

      {/* ── รายการแผนทั้งหมด ─────────────────────────────────────────────── */}
      {loading && (
        <div className="app-state app-state--loading" role="status">
          กำลังโหลดแผน DCA...
        </div>
      )}

      {error && !loading && (
        <div className="app-state app-state--error" role="alert">
          <strong>โหลดแผน DCA ไม่สำเร็จ</strong>
          <p>{error}</p>
          <button type="button" className="demo-btn" onClick={load}>
            ลองใหม่อีกครั้ง
          </button>
        </div>
      )}

      {actionError && (
        <p className="app-state app-state--error" role="alert">
          {actionError}
        </p>
      )}

      {!loading && !error && plans.length === 0 && (
        <div className="app-state app-state--empty">
          <strong>ยังไม่มีแผน DCA</strong>
          <p>ตั้งแผนจากฟอร์มด้านบน แล้วระบบจะเตือนให้เมื่อถึงรอบ</p>
        </div>
      )}

      {!loading && !error && plans.length > 0 && (
        <ul className="app-dca-list">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className={`app-dca-item${plan.active ? '' : ' app-dca-item--paused'}`}
            >
              <div className="app-dca-item__main">
                <strong>
                  {plan.symbol}
                  {plan.name && plan.name !== plan.symbol && <small> {plan.name}</small>}
                </strong>
                <span className="app-dca-item__amount">
                  {formatAmount(plan.amountTotal, plan.currency)}
                </span>
                <small className="app-note">{describeSchedule(plan)}</small>
              </div>

              {/* ⚠️ แผนที่หยุดอยู่ต้องเห็นชัดว่า "หยุดอยู่" ไม่ใช่หายไปเฉยๆ —
                  แผนที่ผู้ใช้ลบผ่าน LINE จะมาโผล่ที่นี่ในสถานะนี้ */}
              {!plan.active && <span className="app-dca-item__flag">หยุดชั่วคราว</span>}

              <div className="app-dca-item__actions">
                <button
                  type="button"
                  className="demo-btn"
                  disabled={busyPlanId === plan.id}
                  onClick={() => handleToggleActive(plan)}
                >
                  {plan.active ? 'หยุดชั่วคราว' : 'เปิดใช้อีกครั้ง'}
                </button>
                <button
                  type="button"
                  className="demo-btn"
                  disabled={busyPlanId === plan.id}
                  onClick={() => askDelete(plan.id)}
                >
                  ลบ
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* ── Modal ยืนยันก่อนลบ (Hard Delete — ย้อนกลับไม่ได้) ─────────────── */}
      {deleteTarget && (
        <div
          className="app-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="ยืนยันการลบแผน DCA"
        >
          <div className="app-modal">
            <header className="app-modal__head">
              <h2>ลบแผน DCA?</h2>
            </header>
            <div className="app-modal__body">
              <p>
                จะลบแผนของ <strong>{deleteTarget.symbol}</strong> (
                {formatAmount(deleteTarget.amountTotal, deleteTarget.currency)} ·{' '}
                {describeSchedule(deleteTarget)}) ออกถาวร
              </p>
              {/* ⚠️ บอกให้ชัดว่าลบแล้วย้อนไม่ได้ และเสนอทางเลือกที่ย้อนได้ —
                  ผู้ใช้ส่วนใหญ่ที่กด "ลบ" จริงๆ แค่อยากหยุดชั่วคราว */}
              <p className="app-note">
                ลบแล้วย้อนกลับไม่ได้ — ถ้าแค่อยากพักไว้ก่อน ให้ใช้ “หยุดชั่วคราว” แทน
              </p>

              {deleteError && (
                <p className="app-state app-state--error" role="alert">
                  {deleteError}
                </p>
              )}

              <div className="demo-actions">
                <button
                  type="button"
                  className="demo-btn demo-btn--primary"
                  disabled={busyPlanId === deleteTarget.id}
                  onClick={() => handleConfirmDelete(deleteTarget.id)}
                >
                  {busyPlanId === deleteTarget.id ? 'กำลังลบ...' : 'ลบถาวร'}
                </button>
                <button
                  type="button"
                  className="demo-btn"
                  disabled={busyPlanId === deleteTarget.id}
                  onClick={cancelDelete}
                >
                  ยกเลิก
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default AppDca;
