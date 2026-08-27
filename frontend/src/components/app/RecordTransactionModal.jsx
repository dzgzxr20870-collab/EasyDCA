import { useState, useEffect } from 'react';
import { apiPost } from '../../lib/api.js';
import { listAssets, listBrokers } from '../../lib/portfolioApi.js';
import { portfolioWriteState } from '../../lib/entitlements.js';

// ═══════════════════════════════════════════════════════════════════════════
// RecordTransactionModal — บันทึกซื้อ/ขาย/ปันผล ต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `components/demo/RecordTransactionModal.jsx` ซึ่งเป็น Session-only
// (ไม่ยิง API เลย) — ตัวนี้ยิงของจริง 2 Endpoint:
//   ซื้อ/ขาย → POST /api/v1/transactions        { side, symbol, ... }
//   ปันผล    → POST /api/v1/transactions/dividend { assetId, amountThb, quantity, ... }
//
// ⚠️ แยก Endpoint ตาม Design Doc § 4.5 โดยตั้งใจ — Payload ของปันผลต่างกันเชิง
// ความหมายทั้งชุด (ระบุด้วย assetId ตรงๆ ไม่มีทิศทาง ไม่มีราคาที่ผู้ใช้กรอก)
//
// ⚠️ **`quantity` ของปันผลเป็นค่าบังคับ** (มติ Founder 24 ส.ค. 2569) — ฟอร์มต้องมี
// ช่องนี้และห้ามปล่อยว่าง · Backend ตอบ 400 VALIDATION_ERROR ถ้าไม่ส่ง
// เหตุผล: จำนวนหน่วยที่ระบบรู้กับที่ได้ปันผลจริงไม่จำเป็นต้องเท่ากัน (ปันผลจ่าย
// ตามยอด ณ วัน XD) และค่านี้ไหลต่อไปเป็น DPS ที่ผู้ใช้เอาไปเทียบข้ามงวดจริง
//
// ⭐ กติกาพอร์ตที่ถูกล็อก (มติ 24 ส.ค. 2569):
//   เพิ่มของใหม่ (ซื้อ · ปันผล) → ปิดเมื่อ canAdd = false
//   ลดของเดิม (ขาย)            → **เปิดเสมอ** ห้ามปิดไม่ว่ากรณีใด
// ถ้าปิดปุ่มขายด้วย ผู้ใช้จะคิดว่าติดกับแล้วไม่บันทึกการขายจริง → ยอดผิดถาวร

const TYPES = [
  { value: 'buy', label: 'ซื้อ', kind: 'add' },
  { value: 'sell', label: 'ขาย', kind: 'reduce' },
  { value: 'dividend', label: 'เงินปันผล', kind: 'add' },
];

function todayBangkok() {
  // ใช้ en-CA เพราะให้รูปแบบ YYYY-MM-DD ตรงกับที่ Backend รับพอดี
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

// defaultType — แท็บที่เปิดค้างไว้ตอน Modal โผล่ ('buy' | 'sell' | 'dividend')
//
// ⚠️ เป็นแค่ **ค่าเริ่มต้น** ไม่ใช่การล็อกโหมด — ผู้ใช้ยังสลับไปแท็บอื่นได้เสมอ
// การล็อกโหมดจะทำให้ผู้ใช้ที่กด "บันทึกการขาย" แล้วเปลี่ยนใจต้องปิดแล้วเปิดใหม่
//
// ⚠️ ห้ามใช้ defaultType เป็นด่านสิทธิ์ — ด่านจริงคือ `blocked` ด้านล่าง ซึ่งอ่านจาก
// `portfolioWriteState(selectedPortfolio)` และ Backend เป็นคนตัดสินอีกชั้นเสมอ
function RecordTransactionModal({ selectedPortfolio, onClose, onSaved, defaultType = 'buy' }) {
  const [type, setType] = useState(
    TYPES.some((t) => t.value === defaultType) ? defaultType : 'buy'
  );
  const [assets, setAssets] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [assetId, setAssetId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [brokerId, setBrokerId] = useState('none');
  const [quantity, setQuantity] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [amountThb, setAmountThb] = useState('');
  const [date, setDate] = useState(todayBangkok());
  const [note, setNote] = useState('');

  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const write = portfolioWriteState(selectedPortfolio);
  const kind = TYPES.find((t) => t.value === type)?.kind ?? 'add';
  const blocked = kind === 'add' && !write.canAdd;

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingRefs(true);
      try {
        const [a, b] = await Promise.all([listAssets(), listBrokers()]);
        if (!alive) return;
        setAssets(a);
        setBrokers(b);
        if (a.length > 0) {
          setAssetId(a[0].id);
          setSymbol(a[0].symbol);
        }
      } catch (err) {
        if (alive) setError(err?.message ?? 'โหลดรายการสินทรัพย์ไม่สำเร็จ');
      } finally {
        if (alive) setLoadingRefs(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  function pickAsset(id) {
    setAssetId(id);
    setSymbol(assets.find((a) => a.id === id)?.symbol ?? '');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);

    // ── Validation ฝั่ง Client — เพื่อบอกผู้ใช้เร็ว ไม่ใช่เพื่อความปลอดภัย ──────
    // ⚠️ ด่านจริงอยู่ Backend เสมอ (Frontend ตรวจคือ UX ไม่ใช่ Gate)
    if (type === 'dividend') {
      if (!assetId) return setError('กรุณาเลือกสินทรัพย์ที่ได้รับปันผล');
      if (!(Number(amountThb) > 0)) return setError('กรุณากรอกจำนวนเงินปันผล (มากกว่า 0)');
      // ⭐ บังคับกรอก — ห้ามเติมให้เองเมื่อผู้ใช้ไม่กรอก (มติ Founder 24 ส.ค. 2569)
      if (!(Number(quantity) > 0)) {
        return setError('กรุณากรอกจำนวนหน่วยที่ได้รับปันผล (ระบบไม่เติมให้อัตโนมัติ)');
      }
    } else {
      if (!symbol) return setError('กรุณาเลือกสินทรัพย์');
      if (!(Number(quantity) > 0) && !(Number(amountThb) > 0)) {
        return setError('กรุณากรอกจำนวนหน่วย หรือจำนวนเงินรวม อย่างน้อยหนึ่งอย่าง');
      }
    }

    setSubmitting(true);
    try {
      if (type === 'dividend') {
        await apiPost('/api/v1/transactions/dividend', {
          assetId,
          amountThb: Number(amountThb),
          quantity: Number(quantity),
          date,
          ...(note ? { note } : {}),
        });
      } else {
        await apiPost('/api/v1/transactions', {
          side: type,
          symbol,
          ...(quantity ? { quantity: Number(quantity) } : {}),
          ...(pricePerUnit ? { pricePerUnit: Number(pricePerUnit) } : {}),
          ...(amountThb ? { amountThb: Number(amountThb) } : {}),
          // 'none' = ไม่ระบุโบรก (คนละความหมายกับไม่ส่ง Key มาเลย)
          ...(brokerId ? { brokerId } : {}),
          date,
          ...(note ? { note } : {}),
        });
      }
      onSaved?.();
    } catch (err) {
      // ⚠️ แสดงข้อความจาก Backend ตรงๆ — มันถูกเขียนมาให้ผู้ใช้อ่านรู้เรื่องแล้ว
      // และครอบเคสที่ Frontend ไม่รู้ (พอร์ตถูกล็อก · กำกวมข้ามพอร์ต/โบรก · เพดาน)
      setError(err?.message ?? 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="demo-modal-backdrop" role="dialog" aria-modal="true" aria-label="บันทึกรายการ">
      <div className="demo-modal">
        <header className="demo-modal__head">
          <h2>บันทึกรายการ</h2>
          <button type="button" className="demo-btn" onClick={onClose} aria-label="ปิด">
            ✕
          </button>
        </header>

        <form onSubmit={handleSubmit} className="demo-form">
          <div className="demo-field">
            <span>ประเภท</span>
            <div className="demo-typegroup">
              {TYPES.map((t) => {
                // ⭐ ปุ่ม "ขาย" ต้องกดได้เสมอ แม้พอร์ตถูกล็อก
                const disabled = t.kind === 'add' && !write.canAdd;
                return (
                  <label key={t.value} className={disabled ? 'is-disabled' : ''}>
                    <input
                      type="radio"
                      name="txn-type"
                      value={t.value}
                      checked={type === t.value}
                      disabled={disabled}
                      onChange={() => setType(t.value)}
                    />
                    {t.label}
                    {disabled ? ' (พอร์ตนี้เพิ่มรายการใหม่ไม่ได้)' : ''}
                  </label>
                );
              })}
            </div>
          </div>

          {loadingRefs && <p className="app-state app-state--loading">กำลังโหลดรายการสินทรัพย์...</p>}

          {type === 'dividend' ? (
            <>
              <label className="demo-field">
                <span>สินทรัพย์ที่ได้รับปันผล</span>
                <select value={assetId} onChange={(e) => pickAsset(e.target.value)}>
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.symbol} — {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="demo-field">
                <span>เงินปันผลรวมที่ได้รับ</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountThb}
                  onChange={(e) => setAmountThb(e.target.value)}
                />
              </label>

              {/* ⭐ บังคับกรอก — ระบบไม่เติมให้ (มติ Founder 24 ส.ค. 2569) */}
              <label className="demo-field">
                <span>
                  จำนวนหน่วยที่ได้รับปันผล <strong>(จำเป็น)</strong>
                </span>
                <input
                  type="number"
                  step="0.00000001"
                  min="0"
                  required
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
                <small className="app-note">
                  จำนวนหน่วย ณ วันที่ได้รับสิทธิ์ (XD) ซึ่งอาจไม่เท่ากับที่ถืออยู่ตอนนี้ —
                  ระบบจึงไม่เติมให้อัตโนมัติ และใช้ค่านี้คำนวณเงินปันผลต่อหน่วย
                </small>
              </label>
            </>
          ) : (
            <>
              <label className="demo-field">
                <span>สินทรัพย์</span>
                <select
                  value={assetId}
                  onChange={(e) => pickAsset(e.target.value)}
                  disabled={assets.length === 0}
                >
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.symbol} — {a.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="demo-field">
                <span>โบรก/Exchange</span>
                <select value={brokerId} onChange={(e) => setBrokerId(e.target.value)}>
                  <option value="none">ไม่ระบุ</option>
                  {brokers.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="demo-field">
                <span>จำนวนหน่วย</span>
                <input
                  type="number"
                  step="0.00000001"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                />
              </label>

              <label className="demo-field">
                <span>ราคาต่อหน่วย</span>
                <input
                  type="number"
                  step="0.00000001"
                  min="0"
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                />
              </label>

              <label className="demo-field">
                <span>จำนวนเงินรวม</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={amountThb}
                  onChange={(e) => setAmountThb(e.target.value)}
                />
              </label>
            </>
          )}

          <label className="demo-field">
            <span>วันที่</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>

          <label className="demo-field">
            <span>หมายเหตุ</span>
            <input type="text" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>

          {blocked && (
            <p className="app-state app-state--warn">
              พอร์ตนี้เพิ่มรายการใหม่ไม่ได้ เพราะแพ็กเกจ Premium หมดอายุแล้ว —
              แต่ยังบันทึก <strong>การขาย</strong> ได้ตามปกติ
            </p>
          )}

          {error && (
            <p className="app-state app-state--error" role="alert">
              {error}
            </p>
          )}

          <div className="demo-actions">
            <button
              type="submit"
              className="demo-btn demo-btn--primary"
              disabled={submitting || blocked || loadingRefs}
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึก'}
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

export default RecordTransactionModal;
