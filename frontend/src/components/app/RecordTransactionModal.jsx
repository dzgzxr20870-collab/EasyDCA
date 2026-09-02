import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiPost, apiUpload } from '../../lib/api.js';
import { listAssets, listBrokers, createBroker, getAssetProfit } from '../../lib/portfolioApi.js';
import { portfolioWriteState } from '../../lib/entitlements.js';
// Reuse ตัวแปลง Error Code → ข้อความไทยของ § 15.8 ที่มีอยู่แล้ว (ครอบครบทุก Code
// ในตาราง Error ของ API.md) — ห้ามเขียนตารางข้อความใหม่ซ้ำ
import { slipOcrErrorMessage, isSlipOcrUpgradeError } from '../../lib/dcaErrors.js';
import SlipUploadField from './SlipUploadField.jsx';
// ⚠️ Reuse ของเดิมทั้งชุด **ห้ามเขียน Dropdown ค้นหาสินทรัพย์ใหม่** — AssetPicker
// (ค้นหา/Keyboard Nav/Chips หมวด) + symbolsCache (Cache ระดับ Module) ถูกใช้งาน
// จริงอยู่แล้วใน DcaForm ของหน้าเก่า
import AssetPicker from '../dashboard/AssetPicker.jsx';
import { getAssetSymbols } from '../../lib/symbolsCache.js';
import {
  buildSlipPrefill,
  quotaNotice,
  buildTransactionPayload,
  buildDividendPayload,
  normalizeBrokerName,
  defaultDestinationPortfolioId,
  needsSymbolFetch,
  assetOptionLabel,
  assetListParams,
  sellAllErrorText,
  buyErrorText,
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
//
// ── 🔧 งาน UI 3 จุด (Founder ทดสอบ /app 29 ส.ค. 2569) ───────────────────────
//   1. Input ไฟล์ของ SlipUploadField ซ่อนด้วย CSS "Visually Hidden" แล้ว (ดู
//      appShell.css .slip-scan__input) — เคยโผล่ปุ่ม "เลือกไฟล์" ของเบราว์เซอร์
//      ซ้อนกับปุ่ม "📄 เลือกรูปสลิป" เพราะไม่มี CSS ซ่อน Input ตัวจริงอยู่เลย
//   2. เพิ่มโบรกใหม่จากในฟอร์มนี้ได้ (state addingBroker/newBrokerName ด้านล่าง)
//      — Reuse `createBroker` เดิมจาก portfolioApi.js ไม่มี Endpoint ใหม่
//   3. เพิ่มช่อง "ค่าธรรมเนียม (ถ้ามี)" — Backend รองรับ `feeThb` อยู่แล้วทั้ง
//      ซื้อ/ขาย (migration 041) เป็น Optional (ดู buildTransactionPayload)

const TYPES = [
  { value: 'buy', label: 'ซื้อ', kind: 'add' },
  { value: 'sell', label: 'ขาย', kind: 'reduce' },
  { value: 'dividend', label: 'เงินปันผล', kind: 'add' },
];

// Sentinel Value ของ Option "+ เพิ่มโบรกใหม่" ใน Dropdown โบรก (งานที่ 2) — ต้อง
// ไม่ชนกับ id จริงของโบรก (UUID) หรือ 'none' ที่มีความหมายอยู่แล้ว
const NEW_BROKER_OPTION = '__new_broker__';
const ADD_BROKER_LABEL = '+ เพิ่มโบรก/Exchange ใหม่';

// Sentinel ของ Option "+ สินทรัพย์ใหม่" ใน Dropdown สินทรัพย์ — ต้องไม่ชนกับ
// assets.id (UUID) หรือ '' ที่ใช้แทน "symbol จากสลิปที่ยังไม่มีในพอร์ต"
const NEW_ASSET_OPTION = '__new_asset__';
const NEW_ASSET_LABEL = '+ สินทรัพย์ใหม่ (พิมพ์เอง)';

function todayBangkok() {
  // ใช้ en-CA เพราะให้รูปแบบ YYYY-MM-DD ตรงกับที่ Backend รับพอดี
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());
}

// ── ตัวช่วยจัดรูปตัวเลขสำหรับ Preview "ขายทั้งหมด" ──────────────────────────
// Pattern เดียวกับ PortfolioHoldingsTable.jsx (fmtQty/fmtMoney) — ไฟล์นี้ไม่มี
// Helper ตัวเลขมาก่อน จึงเขียนสำเนาไว้ในไฟล์นี้เอง (ไม่ Export ใช้ร่วม — ทั้งสอง
// ไฟล์ Logic เหมือนกันทุกตัวอักษร ถ้าจะรวมเป็น lib/ shared ทีหลังค่อยแยกต่างหาก)
function fmtQty(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('th-TH', { maximumFractionDigits: 8 });
}

function fmtMoney(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// defaultType — แท็บที่เปิดค้างไว้ตอน Modal โผล่ ('buy' | 'sell' | 'dividend')
//
// ⚠️ เป็นแค่ **ค่าเริ่มต้น** ไม่ใช่การล็อกโหมด — ผู้ใช้ยังสลับไปแท็บอื่นได้เสมอ
// การล็อกโหมดจะทำให้ผู้ใช้ที่กด "บันทึกการขาย" แล้วเปลี่ยนใจต้องปิดแล้วเปิดใหม่
//
// ⚠️ ห้ามใช้ defaultType เป็นด่านสิทธิ์ — ด่านจริงคือ `blocked` ด้านล่าง ซึ่งอ่านจาก
// `portfolioWriteState(selectedPortfolio)` และ Backend เป็นคนตัดสินอีกชั้นเสมอ
function RecordTransactionModal({
  selectedPortfolio,
  // รายการพอร์ตเต็มจาก GET /portfolios (Shell โหลดไว้แล้ว ส่งลงมาทาง Prop —
  // Modal ไม่ยิงเอง) · [] = ยังไม่รู้ → ไม่แสดงช่องเลือกพอร์ต
  portfolios = [],
  // ── ⭐ บริบทพอร์ตที่กำลังเปิดดูอยู่ (Founder ทดสอบกดปุ่ม "+ บันทึกรายการขาย"
  // จากหน้ารายละเอียดพอร์ต 30 ส.ค. 2569) ────────────────────────────────────
  // undefined = "ไม่รู้บริบทพอร์ต" (เปิดจาก Topbar ที่ Switcher เป็น "ทั้งหมด")
  // → listAssets ไม่กรอง โหลดทุกพอร์ตเหมือนเดิมทุกประการ (ดู assetListParams)
  // uuid = เปิดจากหน้ารายละเอียดพอร์ต/Topbar ที่ Switcher เจาะจงพอร์ตแล้ว →
  // Dropdown สินทรัพย์กรองเหลือเฉพาะพอร์ตนี้ กันผู้ใช้กดขายผิดพอร์ตโดยไม่รู้ตัว
  scopePortfolioId,
  onClose,
  onSaved,
  defaultType = 'buy',
}) {
  const [type, setType] = useState(
    TYPES.some((t) => t.value === defaultType) ? defaultType : 'buy'
  );
  const [assets, setAssets] = useState([]);
  const [brokers, setBrokers] = useState([]);
  const [assetId, setAssetId] = useState('');
  const [symbol, setSymbol] = useState('');
  const [brokerId, setBrokerId] = useState('none');
  // ── เพิ่มโบรกใหม่จากในฟอร์มนี้ (งานที่ 2) ────────────────────────────────
  // ⚠️ ตั้งใจ **ไม่** ใช้ Sentinel Value เดียวกับ `brokerId` (เช่นเซ็ต brokerId
  // เป็น '__new__' ตรงๆ) — ถ้าทำแบบนั้นแล้วผู้ใช้กด "ยกเลิก"/ปิด Modal โดยไม่กด
  // ยืนยัน brokerId จะค้างเป็นค่าที่ไม่มีจริงและหลุดไปกับ Payload ได้ แยก State
  // ต่างหากทำให้ brokerId เดิมไม่ถูกแตะเลยจนกว่าจะสร้างโบรกสำเร็จจริง
  const [addingBroker, setAddingBroker] = useState(false);
  const [newBrokerName, setNewBrokerName] = useState('');
  const [creatingBroker, setCreatingBroker] = useState(false);
  const [brokerError, setBrokerError] = useState(null);
  const [quantity, setQuantity] = useState('');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [amountThb, setAmountThb] = useState('');
  // ── ⭐ ขายทั้งหมด (Founder ทดสอบฟอร์มขาย 30 ส.ค. 2569 — ปัญหาที่ 3) ─────────
  // true → ไม่ส่งจำนวน/ราคา/ยอดเงินไปเลย Backend ดึงยอดคงเหลือ + ราคาตลาด ณ
  // ตอนนี้มาคำนวณเอง (validateSell params.sellAll) — เฉพาะโหมดขายเท่านั้น
  const [sellAll, setSellAll] = useState(false);
  // ── ⭐ Preview ก่อนยืนยัน "ขายทั้งหมด" (Founder ทดสอบ UI Confirm 30 ส.ค. 2569)
  // ─────────────────────────────────────────────────────────────────────────
  // ปุ่มที่แก้คืนยากที่สุดของฟอร์มนี้ (ขายทั้งพอร์ตไปแล้ว) ต้องให้เห็นตัวเลขจริง
  // ก่อนกดยืนยัน ไม่ใช่กดครั้งเดียวจบ — null = ยังไม่ Preview · object =
  // { symbol, heldQuantity, currentPrice, currentValue, currency } จาก
  // getAssetProfit() (Reuse GET /dashboard/profit/:symbol ที่มีอยู่แล้ว — Backend
  // ไม่มี Endpoint Preview แยกและตั้งใจไม่ทำ Preview→Confirm ให้ฝั่งเว็บ แต่
  // Endpoint นี้ Read-only ล้วนและคำนวณตัวเลขชุดเดียวกับที่ sellAll จะใช้จริง)
  const [sellAllPreview, setSellAllPreview] = useState(null);
  const [previewingSellAll, setPreviewingSellAll] = useState(false);
  // ⭐ ค่าธรรมเนียม (ถ้ามี) — งานที่ 3 · Optional เหมือน note ด้านล่าง ไม่กรอก =
  // ไม่ส่ง Key นี้ไป Backend เลย (ดู buildTransactionPayload)
  const [feeThb, setFeeThb] = useState('');
  // ── ซื้อสินทรัพย์ที่ยังไม่เคยถือ (Founder 29 ส.ค. 2569) ────────────────────
  // เดิม Dropdown แสดงได้เฉพาะของที่ถืออยู่ (listAssets) → ทางเดียวที่จะซื้อของ
  // ใหม่คือต้องอ่านสลิปเท่านั้น ทั้งที่ § 15.2 รับ `symbol` ตรงๆ อยู่แล้ว
  const [pickingNewAsset, setPickingNewAsset] = useState(false);
  const [registrySymbols, setRegistrySymbols] = useState(null); // null = ยังไม่โหลด
  const [loadingSymbols, setLoadingSymbols] = useState(false);
  const [symbolsError, setSymbolsError] = useState(null);
  // ── ⭐ ถือ Symbol นี้อยู่พอร์ตอื่นแล้ว → ถามก่อนว่าจะแยกหรือรวม ────────────
  // null = ยังไม่ถูกถาม · object = details ที่ Backend ส่งมา (409)
  const [separatePrompt, setSeparatePrompt] = useState(null);
  // ── ⭐ พอร์ตปลายทาง (มติ Founder 29 ส.ค. 2569) ────────────────────────────
  // ค่าตั้งต้นตัดสินใน Pure Function ที่มี Test คลุม (ดู
  // recordTransactionLogic.defaultDestinationPortfolioId) — ที่นี่แค่เก็บ State
  //
  // ⚠️ ใช้ Lazy Initializer: Shell เปิด Modal ได้ก็ต่อเมื่อโหลดพอร์ตเสร็จแล้ว
  // (ปุ่มถูก disabled ตอน loading) `portfolios` จึงเติมค่าแล้วเสมอตอน mount
  const [destinationPortfolioId, setDestinationPortfolioId] = useState(() =>
    defaultDestinationPortfolioId(selectedPortfolio, portfolios)
  );
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
  // พอร์ตที่เป็นปลายทางของ "ของใหม่" ได้จริง — Backend เป็นคนบอกผ่าน canWrite
  // (ห้ามคำนวณเองจาก plan · ดู lib/entitlements.js)
  const writablePortfolios = (portfolios ?? []).filter((p) => p?.canWrite === true);
  const kind = TYPES.find((t) => t.value === type)?.kind ?? 'add';
  const blocked = kind === 'add' && !write.canAdd;

  // ⭐⭐ excludeZeroHolding (E2E Chrome Test — บั๊กที่ 1 ตามจริง, มติ Founder) —
  // ขาย/ปันผลต้องกรองสินทรัพย์ 0 หน่วยออก ซื้อไม่ต้อง (ดู assetListParams)
  // แยกเป็น Boolean ต่างหาก (ไม่ผูก Effect กับ `type` ดิบ) เพื่อไม่ Refetch ซ้ำ
  // ตอนสลับไปมาระหว่าง "ขาย" ↔ "ปันผล" (Filter ผลลัพธ์เหมือนกันทั้งคู่)
  const excludeZeroHolding = type === 'sell' || type === 'dividend';

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoadingRefs(true);
      try {
        const [a, b] = await Promise.all([
          listAssets(assetListParams(scopePortfolioId, type)),
          listBrokers(),
        ]);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ตั้งใจไม่ใส่ `type`
    // ตรงๆ (ดู excludeZeroHolding ด้านบน) — Effect ยิงซ้ำเฉพาะตอน Filter ที่ส่ง
    // ไป Backend จริงๆ เปลี่ยน ไม่ใช่ทุกครั้งที่สลับแท็บ
  }, [scopePortfolioId, excludeZeroHolding]);

  function pickAsset(id) {
    setAssetId(id);
    const found = assets.find((a) => a.id === id);
    setSymbol(found?.symbol ?? '');
    // ⭐ Sync ช่องโบรกให้ตรงกับสินทรัพย์ที่เลือกเสมอ (ปัญหาที่ 1 — ช่องโบรกเดิม
    // เป็น State อิสระ ไม่เคยตามสินทรัพย์ที่เลือกจาก Dropdown เลย) **เฉพาะโหมด
    // ขาย** เท่านั้น — โหมดซื้อ/ปันผลผู้ใช้ยังต้องเลือกโบรกเองได้ตามเดิมทุกประการ
    // (เลือก "EOSE" ที่ถืออยู่แล้วแต่กำลังจะซื้อเพิ่มที่โบรกอื่นเป็นกรณีปกติ)
    if (type === 'sell') {
      setBrokerId(found?.brokerId ?? 'none');
    }
  }

  // ── สร้างโบรกใหม่จาก Dropdown โดยตรง (งานที่ 2) ───────────────────────────
  // Reuse `createBroker` เดิมจาก portfolioApi.js (ยิง POST /api/v1/brokers จริง)
  // — ไม่มี Endpoint/State Management ใหม่ที่ซ้อนทับของเดิม
  //
  // ⚠️ เพิ่มโบรกที่สร้างสำเร็จเข้า `brokers` ใน State ทันที **ไม่ Refetch
  // listBrokers() ใหม่ทั้งชุด** (ตามที่ระบุในงาน) — ลด Round-trip โดยไม่จำเป็น
  // และกันเคส Race ที่ Refetch มาช้ากว่าที่ผู้ใช้กด "บันทึก" ต่อทันที
  async function handleAddBroker() {
    const trimmed = normalizeBrokerName(newBrokerName);
    if (!trimmed) return;

    setCreatingBroker(true);
    setBrokerError(null);
    try {
      const broker = await createBroker(trimmed);
      if (broker) {
        setBrokers((prev) => [...prev, broker]);
        // เลือกโบรกที่เพิ่งสร้างให้อัตโนมัติ — ผู้ใช้ไม่ต้องเปิด Dropdown มาเลือกซ้ำ
        setBrokerId(broker.id);
      }
      setAddingBroker(false);
      setNewBrokerName('');
    } catch (err) {
      // ⚠️ Pattern เดียวกับ handleSubmit ด้านล่าง — โชว์ข้อความจาก Backend ตรงๆ
      // (ครอบเคส BROKER_NAME_EXISTS ที่ Frontend ไม่รู้ล่วงหน้าว่าชื่อซ้ำ)
      setBrokerError(err?.message ?? 'เพิ่มโบรกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setCreatingBroker(false);
    }
  }

  // ── สินทรัพย์ที่ "ยังไม่เคยซื้อมาก่อน" ─────────────────────────────────────
  // § 15.2 ระบุสินทรัพย์ด้วย `symbol` ตรงๆ (ไม่ใช่ assetId) จึงบันทึกสินทรัพย์ใหม่
  // ได้เลยโดยไม่ต้องมีในรายการ — แต่ <select> เดิมแสดงได้เฉพาะของที่มีอยู่ เราจึง
  // เติม Option ชั่วคราวให้ผู้ใช้ "เห็นว่ากำลังจะบันทึกตัวไหน" และเปลี่ยนใจได้
  //
  // ⚠️ ห้ามบล็อกเหมือน DcaForm (ที่ตอบ "ระบบยังไม่รองรับสินทรัพย์นี้") — ฟอร์มนั้น
  // ผูกกับ Registry เพราะใช้ AssetPicker ส่วนฟอร์มนี้ส่ง symbol ตรงๆ ได้อยู่แล้ว
  const symbolNotInList = Boolean(symbol) && !assets.some((a) => a.symbol === symbol);

  // ⭐ ใช้ร่วมกัน **2 ทาง** ที่เป็นสถานการณ์เดียวกันเป๊ะ ("รู้ symbol แต่ยังไม่รู้
  // assetId"): อ่านสลิป · เลือกเองจาก AssetPicker — จึงไม่เขียน Logic คู่ขนานใหม่
  // (เดิมชื่อ pickSymbolFromSlip ตอนที่มีทางเข้าเดียว)
  function pickSymbol(nextSymbol) {
    const matched = assets.find((a) => a.symbol === nextSymbol);
    if (matched) {
      // บังเอิญตรงกับของที่ถืออยู่แล้ว → ผูก assetId ให้เลย ผู้ใช้ไม่ต้องรู้ตัว
      setAssetId(matched.id);
      setSymbol(matched.symbol);
      return;
    }
    // ยังไม่มีในพอร์ต → เคลียร์ assetId แล้วใช้ symbol ดิบ
    setAssetId('');
    setSymbol(nextSymbol);
  }

  // ── เปิดโหมด "สินทรัพย์ใหม่" + โหลด Registry แบบ Lazy ─────────────────────
  // ⚠️ โหลดเฉพาะตอนกดจริง ไม่ใช่ตอนเปิด Modal — กรณีส่วนใหญ่คือซื้อของที่ถืออยู่
  // แล้ว การยิง /assets/symbols ทุกครั้งที่เปิดฟอร์มจึงเป็นคำขอที่เสียเปล่า
  //
  // กันยิงซ้ำ 2 ชั้น: needsSymbolFetch (ไม่เรียกซ้ำตั้งแต่ต้น) + Cache ระดับ
  // Module ใน symbolsCache.js เอง (เผื่อฟอร์มอื่นโหลดไปแล้ว)
  async function openNewAssetPicker() {
    setPickingNewAsset(true);
    setSymbolsError(null);
    if (!needsSymbolFetch(registrySymbols)) return;

    setLoadingSymbols(true);
    try {
      setRegistrySymbols(await getAssetSymbols());
    } catch (err) {
      // ⚠️ ห้ามกลืนเงียบ — ถ้าโหลดรายการไม่ได้ ผู้ใช้ต้องรู้ว่าทำไมช่องค้นหาว่าง
      setSymbolsError(err?.message ?? 'โหลดรายการสินทรัพย์ไม่สำเร็จ');
    } finally {
      setLoadingSymbols(false);
    }
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
      if (prefill.symbol) pickSymbol(prefill.symbol);
      if (prefill.date) setDate(prefill.date);
      if (prefill.currency) setCurrency(prefill.currency);
      if (prefill.quantity) setQuantity(prefill.quantity);
      if (prefill.pricePerUnit) setPricePerUnit(prefill.pricePerUnit);
      if (prefill.amountTotal) setAmountThb(prefill.amountTotal);
      // ⭐ ค่าธรรมเนียมจากสลิป — null (สลิปไม่ระบุ) จะไม่เข้าเงื่อนไขนี้ ช่องจึง
      // ว่างไว้เหมือนเดิม ไม่ถูกเติมเป็น 0 · ค่าที่เติมแล้วผู้ใช้ยังแก้ได้ทุกเมื่อ
      if (prefill.feeThb) setFeeThb(prefill.feeThb);

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
      // ⭐ "ขายทั้งหมด" ไม่ต้องกรอกอะไรเลย — Backend คำนวณจำนวน/ราคาเอง
      if (!(type === 'sell' && sellAll) && !(Number(quantity) > 0) && !(Number(amountThb) > 0)) {
        return setError('กรุณากรอกจำนวนหน่วย หรือจำนวนเงินรวม อย่างน้อยหนึ่งอย่าง');
      }
    }

    // ⭐ ขายทั้งหมด → ต้องเห็นตัวเลขจริงก่อนกดยืนยันเสมอ (ปุ่มที่แก้คืนยากที่สุด
    // ของฟอร์มนี้) — กด "บันทึก" ครั้งแรกแค่ Preview ยังไม่ยิง § 15.2 จริง
    // (ดู handlePreviewSellAll) ปุ่ม "ยืนยันขาย" ใน Dialog Preview ต่างหากที่เรียก
    // submitTransaction() จริง
    if (type === 'sell' && sellAll) {
      await handlePreviewSellAll();
      return;
    }

    await submitTransaction();
  }

  // ── Preview "ขายทั้งหมด" ก่อนยืนยัน (ปัญหาที่ 3, Founder 30 ส.ค. 2569) ───────
  // Reuse GET /dashboard/profit/:symbol (Read-only ล้วน ไม่แตะ Ledger) — คำนวณ
  // heldQuantity/currentPrice/currentValue จากสูตรเดียวกับที่ validateSell's
  // sellAll Branch จะใช้จริงตอนกดยืนยัน (Price Feed ตัวเดียวกัน) ต่างกันแค่ราคา
  // อาจขยับเล็กน้อยระหว่าง Preview กับตอนกดยืนยันจริง (Caveat เดียวกับที่ Preview→
  // Confirm ฝั่ง LINE มีอยู่แล้ว ยอมรับได้เพราะเป็นแค่ตัวเลข "โดยประมาณ")
  //
  // ⚠️ ส่ง portfolioId/brokerId ของสินทรัพย์ที่เลือกไปด้วยเสมอ (จาก assets ที่โหลด
  // ไว้แล้ว) เพื่อระบุแถวที่แน่นอน — กัน AMBIGUOUS_ASSET_BROKER/PORTFOLIO ที่ไม่
  // ควรเกิดจริงเพราะผู้ใช้เลือกจาก Dropdown มาแล้ว (เหตุผลเดียวกับ assetId
  // Fast-Path ของ § 15.2 ฝั่งขาย)
  async function handlePreviewSellAll() {
    setError(null);
    setPreviewingSellAll(true);
    try {
      const picked = assets.find((a) => a.id === assetId);
      const profit = await getAssetProfit(symbol, {
        portfolioId: picked?.portfolioId,
        brokerId: picked?.brokerId,
      });
      setSellAllPreview(profit);
    } catch (err) {
      setError(
        sellAllErrorText(err?.message) ?? err?.message ?? 'ดูตัวอย่างก่อนขายทั้งหมดไม่สำเร็จ'
      );
    } finally {
      setPreviewingSellAll(false);
    }
  }

  // ── ยิงจริง — แยกออกมาเพื่อ "ยิงซ้ำพร้อมคำตอบ" ได้โดยไม่ Validate ใหม่ ────────
  // confirmSeparate: undefined = ยังไม่ถาม · true = แยกพอร์ต · false = รวมพอร์ตเดิม
  async function submitTransaction(confirmSeparate) {
    setSubmitting(true);
    setError(null);
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
            // ⭐ Fast-Path Resolution ฝั่งขาย (ปัญหาที่ 4) — ส่งเฉพาะตอนรู้ assetId
            // แน่ชัดจริง (เลือกจาก Dropdown) ว่างเปล่าเมื่อพิมพ์ Symbol ใหม่ที่ยัง
            // ไม่เคยถือ (assetId ถูกเคลียร์เป็น '' โดย pickSymbol อยู่แล้วในเคสนั้น)
            assetId,
            quantity,
            pricePerUnit,
            amountTotal: amountThb,
            currency,
            brokerId,
            date,
            note,
            slipToken,
            feeThb,
            // ⚠️ เฉพาะ "ซื้อ" — ขายไม่มีคอนเซ็ปต์เลือกพอร์ตปลายทาง (สินทรัพย์ที่
            // ถืออยู่เป็นตัวกำหนด) และ Backend ก็ละเว้น Key นี้ตอนขายอยู่แล้ว
            portfolioId: type === 'buy' ? destinationPortfolioId : undefined,
            confirmSeparatePortfolio: confirmSeparate,
            // ⭐ ขายทั้งหมด (ปัญหาที่ 3) — เฉพาะโหมดขายเท่านั้น
            sellAll: type === 'sell' && sellAll,
          })
        );
      }
      setSeparatePrompt(null);
      setSellAllPreview(null);
      onSaved?.();
    } catch (err) {
      // ⭐ **ไม่ใช่ Error ที่บล็อกถาวร** — Backend กำลังถามว่าจะแยกหรือรวมพอร์ต
      // เปิด Dialog ให้ผู้ใช้ตอบ แล้วยิงซ้ำพร้อมคำตอบ (ห้ามโชว์เป็น Error แดงๆ
      // เพราะผู้ใช้ยังไม่ได้ทำอะไรผิด)
      if (err?.message === 'ASSET_EXISTS_IN_OTHER_PORTFOLIO') {
        setSeparatePrompt(err?.details ?? {});
        return;
      }
      // ⚠️ แสดงข้อความจาก Backend ตรงๆ — มันถูกเขียนมาให้ผู้ใช้อ่านรู้เรื่องแล้ว
      // และครอบเคสที่ Frontend ไม่รู้ (พอร์ตถูกล็อก · กำกวมข้ามพอร์ต/โบรก · เพดาน)
      //
      // ⭐ Code บางตัว (เช่น PRICE_FEED_NOT_IMPLEMENTED) throw ได้จากทั้งซื้อและ
      // ขาย แต่ทางออกที่ถูกต้องต่างกันคนละแบบ (Founder เจอบั๊ก 30 ส.ค. 2569: ซื้อ
      // ด้วยยอดรวมแล้วโดนบอกให้ "เลือกขายทั้งหมด" ทั้งที่กำลังซื้อ) — เลือก Mapper
      // ตาม `type` เสมอ ห้ามใช้ sellAllErrorText() กับ Error ฝั่งซื้อเด็ดขาด
      // err.message ของ lib/api.js เป็น Error Code ดิบ (ดู sellAllErrorText/
      // buyErrorText) ไม่ใช่ข้อความไทยจริงๆ ต่างจากที่คอมเมนต์เดิมด้านบนว่าไว้
      const contextErrorText = type === 'sell' ? sellAllErrorText : buyErrorText;
      setError(contextErrorText(err?.message) ?? err?.message ?? 'บันทึกไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
    } finally {
      setSubmitting(false);
    }
  }

  // ชื่อพอร์ตจาก id — ใช้ประกอบประโยคใน Dialog ให้ผู้ใช้เห็น "ชื่อ" ไม่ใช่ UUID
  const portfolioName = (id) =>
    (portfolios ?? []).find((p) => p.id === id)?.name ?? 'พอร์ตอื่น';

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ Dialog: ถือ Symbol นี้อยู่พอร์ตอื่นแล้ว — แยก หรือ รวม?
  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️ **ห้ามเลือกให้เองไม่ว่าทางไหน** — สองทางนี้ให้ผลต่อ "ต้นทุนเฉลี่ย" ที่ผู้ใช้
  // จะเห็นต่อไปคนละแบบสิ้นเชิง (รวม = ถัวเฉลี่ยรวมกัน · แยก = สองก้อนแยกกัน)
  // การเดาแทนผู้ใช้คือบั๊กคลาสเดียวกับ POSTMORTEM_PORTFOLIO_RESOLUTION.md
  if (separatePrompt) {
    const fromName = portfolioName(separatePrompt.existingPortfolioId);
    const toName = portfolioName(separatePrompt.destinationPortfolioId);

    return (
      <div
        className="demo-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="เลือกพอร์ตปลายทาง"
      >
        <div className="demo-modal">
          <header className="demo-modal__head">
            <h2>มีสินทรัพย์นี้อยู่ในพอร์ตอื่นแล้ว</h2>
          </header>

          <div className="app-modal__body">
            <p>
              คุณมี <strong>{separatePrompt.symbol ?? symbol}</strong> อยู่ในพอร์ต{' '}
              <strong>{fromName}</strong> อยู่แล้ว
            </p>
            <p>ต้องการบันทึกรายการนี้อย่างไร?</p>

            {/* ⚠️ อธิบายผลของแต่ละทางให้ชัด — ผู้ใช้ต้องตัดสินใจได้โดยไม่ต้องเดา
                ว่าตัวเลือกไหนทำอะไรกับตัวเลขของตัวเอง */}
            <ul className="app-note">
              <li>
                <strong>แยกพอร์ต</strong> — สร้างเป็นอีกรายการในพอร์ต {toName} ต้นทุนเฉลี่ยแยกจากของเดิม
              </li>
              <li>
                <strong>รวมพอร์ตเดิม</strong> — รวมเข้ารายการที่มีอยู่ในพอร์ต {fromName} ถัวเฉลี่ยต้นทุนด้วยกัน
              </li>
            </ul>

            {error && (
              <p className="app-state app-state--error" role="alert">
                {error}
              </p>
            )}

            <div className="demo-actions">
              <button
                type="button"
                className="demo-btn demo-btn--primary"
                disabled={submitting}
                onClick={() => submitTransaction(true)}
              >
                แยกพอร์ต ({toName})
              </button>
              <button
                type="button"
                className="demo-btn"
                disabled={submitting}
                onClick={() => submitTransaction(false)}
              >
                รวมพอร์ตเดิม ({fromName})
              </button>
              <button
                type="button"
                className="demo-btn"
                disabled={submitting}
                onClick={() => setSeparatePrompt(null)}
              >
                ย้อนกลับไปแก้ฟอร์ม
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════
  // ⭐ Dialog: ยืนยันขายทั้งหมด — เห็นตัวเลขจริงก่อนกด (Founder 30 ส.ค. 2569)
  // ═══════════════════════════════════════════════════════════════════════
  // ⚠️ ปุ่มที่แก้คืนยากที่สุดของฟอร์มนี้ — ขายสินทรัพย์ทั้งหมดไปแล้ว จะย้อนกลับ
  // ได้ก็ต่อเมื่อกด "ย้อนรายการ" ทันเวลา (คนละ Flow) และราคาตลาด ณ ตอนย้อนก็ไม่ใช่
  // ราคาเดิมอีกแล้ว — ต้องให้เห็นจำนวน/ราคา/ยอดเงินก่อนกดยืนยันเสมอ ห้ามกดครั้ง
  // เดียวจบเหมือนก่อนหน้านี้
  if (sellAllPreview) {
    return (
      <div
        className="demo-modal-backdrop"
        role="dialog"
        aria-modal="true"
        aria-label="ยืนยันขายทั้งหมด"
      >
        <div className="demo-modal">
          <header className="demo-modal__head">
            <h2>ยืนยันขายทั้งหมด</h2>
          </header>

          <div className="app-modal__body">
            <p>
              คุณกำลังจะขาย <strong>{sellAllPreview.symbol}</strong> ที่ถืออยู่ทั้งหมด —
              ตรวจสอบตัวเลขก่อนกดยืนยัน:
            </p>

            <ul className="app-note">
              <li>จำนวนหน่วยที่จะขาย: {fmtQty(sellAllPreview.heldQuantity)} หน่วย</li>
              <li>
                ราคาตลาดโดยประมาณ: {fmtMoney(sellAllPreview.currentPrice)}{' '}
                {sellAllPreview.currency === 'USD' ? 'USD' : 'บาท'} / หน่วย
              </li>
              <li>
                ยอดเงินโดยประมาณที่จะได้รับ: {fmtMoney(sellAllPreview.currentValue)}{' '}
                {sellAllPreview.currency === 'USD' ? 'USD' : 'บาท'}
              </li>
            </ul>

            {/* ⚠️ ตัวเลขนี้เป็นราคา ณ ตอน Preview — ราคาตลาดขยับได้ตลอดเวลา ยอดที่
                บันทึกจริงตอนกด "ยืนยันขาย" อาจคลาดเคลื่อนจากที่แสดงนี้เล็กน้อย
                (Caveat เดียวกับ Preview→Confirm ฝั่ง LINE) */}
            <p className="app-note">
              ราคาจริงตอนบันทึกอาจคลาดเคลื่อนเล็กน้อยจากที่แสดงนี้ เพราะราคาตลาดขยับตลอดเวลา
            </p>

            {error && (
              <p className="app-state app-state--error" role="alert">
                {error}
              </p>
            )}

            <div className="demo-actions">
              <button
                type="button"
                className="demo-btn demo-btn--primary"
                disabled={submitting}
                onClick={() => submitTransaction()}
              >
                {submitting ? 'กำลังบันทึก...' : 'ยืนยันขาย'}
              </button>
              <button
                type="button"
                className="demo-btn"
                disabled={submitting}
                onClick={() => setSellAllPreview(null)}
              >
                ย้อนกลับไปแก้ฟอร์ม
              </button>
            </div>
          </div>
        </div>
      </div>
    );
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
                      onChange={() => {
                        setType(t.value);
                        // สลับออกจากโหมดขาย → เคลียร์ "ขายทั้งหมด" กันค้างเป็น true
                        // เงียบๆ แล้วกลับมาขายอีกทีโดยไม่ตั้งใจ (ช่องถูกซ่อนไปแล้ว
                        // ตอนไม่ใช่โหมดขาย ผู้ใช้จะไม่เห็นว่ายังติ๊กค้างอยู่)
                        if (t.value !== 'sell') {
                          setSellAll(false);
                          setSellAllPreview(null);
                        }
                      }}
                    />
                    {t.label}
                    {disabled ? ' (พอร์ตนี้เพิ่มรายการใหม่ไม่ได้)' : ''}
                  </label>
                );
              })}
            </div>
          </div>

          {/* ── ⭐ พอร์ตปลายทาง (มติ Founder 29 ส.ค. 2569) ────────────────────
              เดิมฟอร์มนี้ไม่เคยส่ง portfolioId ไป Backend เลย → สินทรัพย์ใหม่ลง
              พอร์ตหลักเสมอ ผู้ใช้ที่สร้างพอร์ตแยกไว้จึงหารายการไม่เจอ

              ⚠️ เฉพาะโหมด "ซื้อ" เท่านั้น:
                ขาย   → ปลายทางถูกกำหนดโดยสินทรัพย์ที่ถืออยู่จริง (validateSell)
                ปันผล → ระบุด้วย assetId ซึ่งผูกกับพอร์ตอยู่แล้ว (dividend.service
                        อ่าน asset.portfolioId) · Endpoint ไม่รับ Key นี้ด้วยซ้ำ
              ถ้าโชว์ในสองโหมดนั้นจะเป็นช่องที่กดแล้วไม่มีผล = UI ที่โกหกผู้ใช้

              ⚠️ แสดงเฉพาะพอร์ตที่ canWrite === true — พอร์ตที่ถูกล็อกไม่ควรเป็น
              ตัวเลือกปลายทางของ "ของใหม่" ตั้งแต่แรก (ลดโอกาสเจอ 403 โดยไม่จำเป็น)
              แต่ด่านจริงยังอยู่ที่ Backend เสมอ ถ้าพอร์ตเพิ่งถูกล็อกระหว่างกรอกฟอร์ม
              จะได้ 403 PORTFOLIO_READ_ONLY ซึ่ง catch ด้านล่างแสดงข้อความให้อยู่แล้ว */}
          {type === 'buy' && writablePortfolios.length > 0 && (
            <label className="demo-field">
              <span>บันทึกลงพอร์ต</span>
              <select
                value={destinationPortfolioId ?? ''}
                onChange={(e) => setDestinationPortfolioId(e.target.value)}
              >
                {writablePortfolios.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isDefault ? '⭐' : '🗂️'} {p.name}
                  </option>
                ))}
              </select>
              {/* ⭐ สื่อสารพฤติกรรมจริงของ Backend — ป้องกันความสับสนแบบที่
                  Founder เจอ: เลือกพอร์ตไว้แล้วรายการดัน "ไปรวม" ที่พอร์ตอื่น
                  ⚠️ นี่ไม่ใช่ข้อจำกัดชั่วคราว แต่เป็นกติกาที่ตั้งใจ — กันสินทรัพย์
                  ตัวเดียวกันแตกเป็นสองแถวสองพอร์ต ซึ่งทำให้ต้นทุนเฉลี่ยเพี้ยน */}
              <small className="app-note">
                ถ้าสินทรัพย์นี้มีอยู่แล้วในพอร์ตอื่น ระบบจะรวมไว้ที่พอร์ตเดิมแทน ไม่สร้างแยกใหม่
              </small>
            </label>
          )}

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
                      {assetOptionLabel(a, brokers)}
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
                {/* ⭐ โหมด "สินทรัพย์ใหม่" → สลับไปใช้ AssetPicker ที่ค้นจาก
                    Registry เต็ม (ไม่ใช่แค่ของที่ถืออยู่) · โหมดปกติ → Dropdown เดิม
                    ⚠️ เฉพาะซื้อเท่านั้น — ขายเลือกได้แค่ของที่ถืออยู่จริง ซึ่งถูกต้อง
                    อยู่แล้วและ validateSell หา Asset จาก Ledger ไม่ใช่ Registry */}
                {pickingNewAsset && type === 'buy' ? (
                  <>
                    {loadingSymbols && (
                      <p className="app-state app-state--loading">กำลังโหลดรายการสินทรัพย์...</p>
                    )}
                    {symbolsError && (
                      <p className="app-state app-state--error" role="alert">
                        {symbolsError}
                      </p>
                    )}
                    <AssetPicker
                      symbols={registrySymbols ?? []}
                      value={(registrySymbols ?? []).find((x) => x.symbol === symbol) ?? null}
                      onChange={(picked) => picked?.symbol && pickSymbol(picked.symbol)}
                      disabled={loadingSymbols || submitting}
                    />
                    <button
                      type="button"
                      className="demo-btn"
                      onClick={() => {
                        setPickingNewAsset(false);
                        setSymbolsError(null);
                      }}
                    >
                      ← เลือกจากสินทรัพย์ที่ถืออยู่
                    </button>
                  </>
                ) : (
                  <select
                    value={assetId}
                    /* ⚠️ ยัง Disable เมื่อ "ไม่มีอะไรให้เลือกจริงๆ" เหมือนเดิม —
                       แต่ **เฉพาะโหมดขาย** เพราะโหมดซื้อมี "+ สินทรัพย์ใหม่"
                       เป็นตัวเลือกเสมอ ถ้า Disable ไปด้วยจะปิดทางเดียวที่เหลือ
                       ของผู้ใช้ใหม่ (ยังไม่ถืออะไรเลย) = บั๊กที่กำลังแก้อยู่นี่เอง */
                    disabled={type !== 'buy' && assets.length === 0 && !symbolNotInList}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === NEW_ASSET_OPTION) {
                        openNewAssetPicker();
                        return;
                      }
                      pickAsset(v);
                    }}
                  >
                    {/* สินทรัพย์ที่ยังไม่มีในพอร์ต (จากสลิป/เพิ่งเลือกเอง) — บันทึกได้
                        เพราะ § 15.2 ระบุด้วย symbol ตรงๆ (value='' = ไม่มี assetId) */}
                    {symbolNotInList && (
                      <option value="">{symbol} — (ยังไม่มีในพอร์ต)</option>
                    )}
                    {assets.map((a) => (
                      <option key={a.id} value={a.id}>
                        {assetOptionLabel(a, brokers)}
                      </option>
                    ))}
                    {/* ⭐ ทางเข้า "ซื้อของที่ยังไม่เคยถือ" — เดิมทำได้ทางเดียวคือ
                        ต้องอ่านสลิปเท่านั้น ทั้งที่ Backend รองรับมาตลอด */}
                    {type === 'buy' && (
                      <option value={NEW_ASSET_OPTION}>{NEW_ASSET_LABEL}</option>
                    )}
                  </select>
                )}
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

              {/* ⭐ ช่องโบรก — ซ่อนทั้งช่องตอนขาย (ปัญหาที่ 1) — เลือกสินทรัพย์จาก
                  Dropdown ที่กำกับชื่อโบรกไว้แล้ว (เช่น "EOSE — Weblue") ก็รู้โบรก
                  ในตัวอยู่แล้ว ช่องแยกต่างหากที่ไม่เคย Sync กันมีแต่จะสับสน/พาให้
                  เลือกโบรกผิดจากที่ตั้งใจ — brokerId ภายในยัง Sync ถูกต้องเสมอผ่าน
                  pickAsset ด้านบน แม้ผู้ใช้จะไม่เห็นช่องนี้เลยก็ตาม */}
              {type !== 'sell' && (
                <>
                  <label className="demo-field">
                    <span>โบรก/Exchange</span>
                    <select
                      value={addingBroker ? NEW_BROKER_OPTION : brokerId}
                      onChange={(e) => {
                        const v = e.target.value;
                        if (v === NEW_BROKER_OPTION) {
                          // ⚠️ ไม่แตะ brokerId ที่นี่ — คงค่าที่เลือกไว้เดิมจนกว่าจะ
                          // สร้างโบรกใหม่สำเร็จจริง (ดูเหตุผลตรง State ด้านบน)
                          setAddingBroker(true);
                          setBrokerError(null);
                        } else {
                          setAddingBroker(false);
                          setBrokerId(v);
                        }
                      }}
                    >
                      <option value="none">ไม่ระบุ</option>
                      {brokers.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                      <option value={NEW_BROKER_OPTION}>{ADD_BROKER_LABEL}</option>
                    </select>
                  </label>

                  {/* ── ช่องพิมพ์ชื่อโบรกใหม่ — โผล่เฉพาะตอนเลือก "+ เพิ่มโบรก..." ── */}
                  {addingBroker && (
                    <div className="demo-field">
                      <span>ชื่อโบรก/Exchange ใหม่</span>
                      <div className="demo-inline-row">
                        <input
                          type="text"
                          value={newBrokerName}
                          onChange={(e) => setNewBrokerName(e.target.value)}
                          placeholder="เช่น Bitkub, บัวหลวง"
                          disabled={creatingBroker}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="demo-btn"
                          disabled={creatingBroker || !normalizeBrokerName(newBrokerName)}
                          onClick={handleAddBroker}
                        >
                          {creatingBroker ? 'กำลังเพิ่ม...' : 'ยืนยัน'}
                        </button>
                        <button
                          type="button"
                          className="demo-btn"
                          disabled={creatingBroker}
                          onClick={() => {
                            setAddingBroker(false);
                            setNewBrokerName('');
                            setBrokerError(null);
                          }}
                        >
                          ยกเลิก
                        </button>
                      </div>
                      {brokerError && (
                        <p className="app-state app-state--error" role="alert">
                          {brokerError}
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ⭐ ขายทั้งหมด (ปัญหาที่ 3) — ไม่ต้องกรอกจำนวน/ราคา/ยอดเงินเลย
                  Backend ดึงยอดคงเหลือ + ราคาตลาด ณ ตอนนี้มาคำนวณให้เอง (ใช้ Price
                  Feed เดียวกับที่ระบบมีอยู่แล้ว — ครอบคลุมเฉพาะ Crypto/หุ้นสหรัฐ
                  หุ้นไทยอย่าง EOSE ยังไม่มีราคาสด กดปุ่มนี้แล้วจะได้ Error ที่บอก
                  ให้กรอกจำนวน/ราคาเองแทน ดู sellAllErrorText) */}
              {type === 'sell' && (
                <label className="demo-field">
                  <span>
                    <input
                      type="checkbox"
                      checked={sellAll}
                      onChange={(e) => {
                        setSellAll(e.target.checked);
                        // เปลี่ยนใจ/ติ๊กใหม่ → Preview เก่า (ถ้ามี) ไม่ตรงกับ
                        // ฟอร์มปัจจุบันแล้ว ต้อง Preview ใหม่เสมอ ห้ามใช้ตัวเลขเก่า
                        setSellAllPreview(null);
                      }}
                    />{' '}
                    ขายทั้งหมด (ระบบคำนวณจำนวน + ราคาตลาดปัจจุบันให้อัตโนมัติ)
                  </span>
                </label>
              )}

              {!(type === 'sell' && sellAll) && (
                <>
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

              {/* ⭐ ค่าธรรมเนียม — งานที่ 3 · Optional ทั้งซื้อ/ขาย ไม่มีในโหมด
                  ปันผล (Endpoint ปันผลไม่มี Field นี้ตาม Contract) */}
              <label className="demo-field">
                <span>ค่าธรรมเนียม (ถ้ามี)</span>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={feeThb}
                  onChange={(e) => setFeeThb(e.target.value)}
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
              disabled={submitting || blocked || loadingRefs || previewingSellAll}
            >
              {type === 'sell' && sellAll
                ? previewingSellAll
                  ? 'กำลังตรวจสอบ...'
                  : 'ตรวจสอบก่อนขาย'
                : submitting
                  ? 'กำลังบันทึก...'
                  : 'บันทึก'}
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
