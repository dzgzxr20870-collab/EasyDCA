import { useState, useEffect, useCallback } from 'react';
import { apiGet } from '../../lib/api.js';

// ═══════════════════════════════════════════════════════════════════════════
// AppDca — แผน DCA ต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `pages/demo/DemoDca.jsx` — ใช้ `GET /api/v1/dca-plans` ที่มีอยู่แล้ว
//
// ⚠️ **ห้ามใช้ภาษาชี้นำการลงทุน** (กฎเหล็กข้อ 1) — หน้านี้บอกได้แค่ว่า "ตั้งแผนไว้
// อย่างไร" และ "ถึงรอบเมื่อไหร่" ห้ามมีข้อความประเภท "ควรเพิ่มยอด DCA" หรือ
// "ช่วงนี้เหมาะกับการซื้อ" เด็ดขาด

function formatAmount(n, currency) {
  const num = new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n ?? 0));
  return `${num} ${currency ?? 'บาท'}`;
}

function describeSchedule(plan) {
  if (plan.frequency === 'monthly') return `ทุกวันที่ ${plan.dayOfMonth ?? '-'} ของเดือน`;
  if (plan.frequency === 'weekly') return 'ทุกสัปดาห์';
  // ⚠️ ค่าที่ไม่รู้จักแสดงตามจริง ไม่เดา (Silent Default เป็น Anti-pattern)
  return plan.frequency ?? 'ไม่ระบุรอบ';
}

function AppDca() {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

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

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        <h1>แผน DCA</h1>
      </header>

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

      {!loading && !error && plans.length === 0 && (
        <div className="app-state app-state--empty">
          <strong>ยังไม่มีแผน DCA</strong>
          <p>ตั้งแผนเพื่อให้ระบบเตือนเมื่อถึงรอบที่คุณกำหนดไว้</p>
        </div>
      )}

      {!loading && !error && plans.length > 0 && (
        <ul className="demo-planlist">
          {plans.map((plan) => (
            <li key={plan.id} className="demo-planitem">
              <strong>{plan.symbol}</strong>
              <span>{formatAmount(plan.amount ?? plan.amountThb, plan.currency)}</span>
              <small>{describeSchedule(plan)}</small>
              {plan.isActive === false ? <small>(ปิดใช้งานอยู่)</small> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default AppDca;
