import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost, apiUpload } from '../../lib/api.js';
import { listAssets, listBrokers } from '../../lib/portfolioApi.js';
import { portfolioWriteState } from '../../lib/entitlements.js';
// Reuse ตัวแปลง Error Code → ข้อความไทยของ § 15.8 ที่มีอยู่แล้ว (ครอบครบทุก Code
// ในตาราง Error ของ API.md) — ห้ามเขียนตารางข้อความใหม่ซ้ำ
import { slipOcrErrorMessage, isSlipOcrUpgradeError } from '../../lib/dcaErrors.js';
import SlipUploadField from './SlipUploadField.jsx';
import {
  buildSlipPrefill,
  quotaNotice,
  buildTransactionPayload,
  buildDividendPayload,
} from './recordTransactionLogic.js';

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
//
// ── 📄 แนบสลิปให้ AI อ่าน (§ 15.8) ────────────────────────────────────────
// เลือกรูป → POST /transactions/slip-ocr → เติมค่าลงฟอร์ม → **ผู้ใช้ตรวจ/แก้ได้ทุกช่อง**
// → กดปุ่ม "บันทึก" เดิม (จุดเดียวที่ยิง § 15.2 จริง)
// การอ่านสลิป **ไม่สร้างธุรกรรมใดๆ** และค่าจาก AI ไม่มีทางไหลลง Ledger โดยไม่ผ่านตา
//
// ⚠️ ตรรกะตัดสินทั้งหมด (side null / orderStatus / รูปร่าง Payload) อยู่ที่
// `recordTransactionLogic.js` เป็น Pure Function ที่มี Test คลุม — ที่นี่ทำหน้าที่
// Apply ผลลง State เท่านั้น ไม่ตัดสินใจอะไรเอง
//
// ── 🔴 บั๊กที่แก้ไปพร้อมงานนี้: `amountThb` → `amountTotal` ─────────────────
// § 15.2 อ่าน `body.amountTotal` (controller: toPositiveNumber(body.amountTotal))
// แต่ฟอร์มเดิมส่ง `amountThb` ซึ่งไม่เคยถูกอ่านเลย → กรอก "จำนวนเงินรวม" อย่างเดียว
// (เคสซื้อ DCA ปกติที่สุด) ได้ VALIDATION_ERROR ทุกครั้ง
// ⚠️ Endpoint **ปันผล** ใช้ `amountThb` จริงตาม Contract — ห้ามเปลี่ยนตาม

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
  // 🔴 สกุลเงิน — จำเป็นเพราะสลิปคืน USD ได้ ถ้าไม่ส่ง currency ไป Backend จะ
  // Default เป็น 'THB' แล้วยอด USD จะถูกบันทึกเป็นบาท = เงินผิดใน Ledger จริง
  const [currency, setCurrency] = useState('THB');

  const [loadingRefs, setLoadingRefs] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // ── สถานะของการอ่านสลิป — แยกจาก submitting โดยสิ้นเชิง (คนละ Action) ──────
  const [scanning, setScanning] = useState(false);
  const [slipError, setSlipError] = useState(null);
  const [slipUpgrade, setSlipUpgrade] = useState(false);
  const [slipNotice, setSlipNotice] = useState(null);
  const [slipWarning, setSlipWarning] = useState(null);
  const [slipFileName, setSlipFileName] = useState(null);
  // Token รูปที่ Backend เก็บไว้ให้ (Premium เท่านั้น — Free/Trial ได้ null)
  // ⚠️ null ต้องแปลว่า "ไม่ส่ง Key นี้เลย" ไม่ใช่ส่ง null (ดู buildTransactionPayload)
  const [slipToken, setSlipToken] = useState(null);

  const navigate = useNavigate();

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

  // ── สินทรัพย์จากสลิปที่ "ยังไม่เคยซื้อมาก่อน" ──────────────────────────────
  // § 15.2 ระบุสินทรัพย์ด้วย `symbol` ตรงๆ (ไม่ใช่ assetId) จึงบันทึกสินทรัพย์ใหม่
  // ได้เลยโดยไม่ต้องมีในรายการ — แต่ <select> เดิมแสดงได้เฉพาะของที่มีอยู่ เราจึง
  // เติม Option ชั่วคราวให้ผู้ใช้ "เห็นว่ากำลังจะบันทึกตัวไหน" และเปลี่ยนใจได้
  //
  // ⚠️ ห้ามบล็อกเหมือน DcaForm (ที่ตอบ "ระบบยังไม่รองรับสินทรัพย์นี้") — ฟอร์มนั้น
  // ผูกกับ Registry เพราะใช้ AssetPicker ส่วนฟอร์มนี้ส่ง symbol ตรงๆ ได้อยู่แล้ว
  const symbolNotInList = Boolean(symbol) && !assets.some((a) => a.symbol === symbol);

  function pickSymbolFromSlip(slipSymbol) {
    const matched = assets.find((a) => a.symbol === slipSymbol);
    if (matched) {
      setAssetId(matched.id);
      setSymbol(matched.symbol);
      return;
    }
    // ไม่มีในพอร์ต → เคลียร์ assetId แล้วใช้ symbol ดิบจากสลิป
    setAssetId('');
    setSymbol(slipSymbol);
  }

  // ── ให้ AI อ่านสลิปแล้วเติมค่าลงฟอร์ม (§ 15.8) ────────────────────────────
  // ⚠️ ไม่บันทึกอะไรทั้งสิ้น — แค่เติมช่องกรอกที่ผู้ใช้แก้ได้ (ปุ่ม "บันทึก" เดิม
  // ยังเป็นจุดเดียวที่ยิง § 15.2)
  async function handleScanSlip(file) {
    setSlipError(null);
    setSlipUpgrade(false);
    setSlipNotice(null);
    setSlipWarning(null);
    setError(null);
    setSlipFileName(file?.name ?? null);
    setScanning(true);

    try {
      const { slip, slipToken: token, quota } = await apiUpload(
        '/api/v1/transactions/slip-ocr',
        file
      );

      // ตรรกะตัดสินทั้งหมดอยู่ใน Pure Function (มี Test คลุม) — ที่นี่แค่ Apply
      const prefill = buildSlipPrefill(slip);

      // Token เก็บไว้เสมอแม้สลิปจะถูกเตือน (ผู้ใช้อาจแก้ค่าแล้วบันทึกเอง)
      setSlipToken(token ?? null);
      setSlipNotice(quotaNotice(quota));

      // ⚠️ คำสั่งที่ "ยังไม่เกิดขึ้นจริง" → **ไม่เติมค่าใดๆ เลย** + เตือนให้ชัด
      // ไม่ปิดปุ่มบันทึก (Backend เป็นด่านสุดท้าย · ผู้ใช้อาจรู้ว่าจับคู่แล้วทีหลัง)
      if (prefill.blockReason) {
        setSlipWarning(
          prefill.blockReason === 'pending'
            ? 'สลิปนี้เป็นคำสั่งที่ "ยังไม่สำเร็จ" (รอจับคู่/รอดำเนินการ) ระบบจึงไม่เติมค่าให้ — ถ้าคำสั่งจับคู่แล้ว กรุณากรอกรายการเอง'
            : 'สลิปนี้เป็นคำสั่งที่ "ถูกยกเลิก/ไม่สำเร็จ" ระบบจึงไม่เติมค่าให้ — ถ้าจะบันทึกจริง กรุณากรอกรายการเอง'
        );
        return;
      }

      // ── Prefill — ทุกค่าที่เติมยังแก้ไขได้ทั้งหมด ────────────────────────
      // ⚠️ setType เฉพาะตอนรู้ทิศทางจริง — side = null ต้องปล่อยไว้ตามที่ผู้ใช้
      // เปิดมา **ห้ามเดาให้เด็ดขาด** (เคส BCPG: สลิป "ขาย" เคยถูกบันทึกเป็น "ซื้อ")
      if (prefill.type) setType(prefill.type);
      if (prefill.symbol) pickSymbolFromSlip(prefill.symbol);
      if (prefill.date) setDate(prefill.date);
      if (prefill.currency) setCurrency(prefill.currency);
      if (prefill.quantity) setQuantity(prefill.quantity);
      if (prefill.pricePerUnit) setPricePerUnit(prefill.pricePerUnit);
      if (prefill.amountTotal) setAmountThb(prefill.amountTotal);

      const warnings = [];
      if (prefill.sideUnresolved) {
        warnings.push(
          '⚠️ อ่านทิศทางรายการ (ซื้อ/ขาย) จากสลิปไม่ได้ — ระบบจึงยังไม่เลือกโหมดและไม่กรอกจำนวนให้ กรุณาเลือกซื้อ/ขายเอง แล้วกรอกตัวเลขจากสลิป'
        );
      }
      if (prefill.lowConfidence) {
        warnings.push('ความมั่นใจในการอ่านต่ำ กรุณาตรวจตัวเลขทุกช่องก่อนกดบันทึก');
      }
      if (warnings.length > 0) setSlipWarning(warnings.join(' · '));
    } catch (err) {
      // ⚠️ ห้ามโชว์ Error Code ดิบให้ผู้ใช้ — แปลผ่านตารางกลางที่ครอบครบทุก Code
      setSlipError(slipOcrErrorMessage(err?.message));
      setSlipUpgrade(isSlipOcrUpgradeError(err?.message));
    } finally {
      setScanning(false);
    }
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
        // ⚠️ Endpoint นี้ใช้ `amountThb` จริงตาม Contract (คนละตัวกับ § 15.2)
        await apiPost(
          '/api/v1/transactions/dividend',
          buildDividendPayload({ assetId, amountThb, quantity, date, note })
        );
      } else {
        // ⚠️ รูปร่าง Payload ตัดสินใน Pure Function ที่มี Test คลุม — โดยเฉพาะ
        // `amountTotal` (ไม่ใช่ amountThb) และ `slipToken` ที่ต้องหายไปทั้ง Key
        // เมื่อเป็น null (ผู้ใช้ Free/Trial)
        await apiPost(
          '/api/v1/transactions',
          buildTransactionPayload({
            type,
            symbol,
            quantity,
            pricePerUnit,
            amountTotal: amountThb,
            currency,
            brokerId,
            date,
            note,
            slipToken,
          })
        );
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

          {/* ── 📌 พอร์ตปลายทางมาจาก "สินทรัพย์" ไม่ใช่ Switcher ด้านบน ──────────
              ⚠️ ข้อความนี้ต้องขึ้น **ทุกกรณี** ไม่ใช่เฉพาะตอนเลือก "ทั้งหมด" —
              เพราะฟอร์มนี้ **ไม่เคยส่ง portfolioId ไป Backend เลย** ไม่ว่าจะเลือก
              พอร์ตไหนค้างไว้ก็ตาม (ดู buildTransactionPayload ใน
              recordTransactionLogic.js — ไม่มี Key นี้อยู่ในรูปร่าง Payload)
              Backend เป็นคน Resolve ปลายทางเองจาก Symbol ที่ผู้ใช้กรอก
              (transaction.service.validateBuy)

              ถ้าโชว์เฉพาะตอน "ทั้งหมด" ผู้ใช้จะอนุมานว่า "งั้นเลือกพอร์ตด้านบนก่อน
              แล้วมันจะลงพอร์ตนั้น" ซึ่ง **ไม่จริง** — เป็นความเข้าใจผิดชนิดเดียวกับ
              บั๊ก 29 ส.ค. 2569 คือ UI พูดเรื่องที่ตัวเองไม่ได้เป็นคนตัดสิน */}
          <p className="app-note">
            📌 รายการนี้จะถูกบันทึกลง<strong>พอร์ตที่ถือสินทรัพย์นี้อยู่แล้ว</strong> — ถ้ายังไม่เคยถือที่ไหนเลย
            ระบบจะบันทึกเข้า<strong>พอร์ตหลัก</strong>ให้อัตโนมัติ (ไม่ขึ้นกับพอร์ตที่กำลังดูอยู่ด้านบน)
          </p>

          {loadingRefs && <p className="app-state app-state--loading">กำลังโหลดรายการสินทรัพย์...</p>}

          {/* ⚠️ ปันผลไม่มี Endpoint อ่านสลิป (API.md § 15.8) — ซ่อนทั้งบล็อก */}
          {type !== 'dividend' && (
            <SlipUploadField
              scanning={scanning}
              error={slipError}
              showUpgrade={slipUpgrade}
              notice={slipNotice}
              warning={slipWarning}
              fileName={slipFileName}
              disabled={loadingRefs || submitting}
              onPick={handleScanSlip}
              onUpgrade={() => navigate('/premium')}
            />
          )}

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
                  disabled={assets.length === 0 && !symbolNotInList}
                >
                  {/* สินทรัพย์จากสลิปที่ยังไม่มีในพอร์ต — บันทึกได้เพราะ § 15.2
                      ระบุด้วย symbol ตรงๆ (value='' = ไม่มี assetId ให้อ้าง) */}
                  {symbolNotInList && (
                    <option value="">{symbol} — (จากสลิป · ยังไม่มีในพอร์ต)</option>
                  )}
                  {assets.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.symbol} — {a.name}
                    </option>
                  ))}
                </select>
              </label>

              {/* 🔴 สกุลเงิน — สลิป USD ต้องไม่ถูกบันทึกเป็นบาท (Backend Default
                  เป็น THB เมื่อไม่ส่ง Key นี้) · USD ใช้ได้เฉพาะ crypto/stock_us
                  ซึ่ง Backend ตรวจให้อีกชั้น (§ 15.2.1) */}
              <label className="demo-field">
                <span>สกุลเงิน</span>
                <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
                  <option value="THB">บาท (THB)</option>
                  <option value="USD">ดอลลาร์ (USD)</option>
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
