import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AssetPicker from './AssetPicker.jsx';
import { apiPost, apiUpload } from '../../lib/api.js';
import {
  transactionErrorMessage,
  slipUploadErrorMessage,
  slipOcrErrorMessage,
  isSlipOcrUpgradeError,
} from '../../lib/dcaErrors.js';
import { buildOcrPrefill } from '../../lib/slipOcrPrefill.js';
import { todayBangkokIso } from '../../lib/dateBangkok.js';
import { resolvePrefillState } from '../../lib/dcaPlanPrefill.js';
import { buildSellPayload, findHolding, formatUnits } from '../../lib/sellForm.js';

const AMOUNT_CHIPS = [500, 1000, 3000, 5000, 10000];

// แนบสลิปหลักฐาน (Premium) — ชนิด/ขนาดที่รับ ตรงกับ storage.service ฝั่ง Backend
// (ALLOWED_SLIP_CONTENT_TYPES + MAX_SLIP_SIZE_BYTES) — Frontend เช็คก่อนเพื่อ UX ที่ดี
// (เตือนทันทีไม่ต้องรอ Round-trip) แต่ "Backend คือด่านตัดสินจริง" ไม่ใช่ชั้นนี้
const SLIP_ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SLIP_ACCEPT_ATTR = SLIP_ACCEPT_TYPES.join(',');
const SLIP_MAX_BYTES = 10 * 1024 * 1024;
// มาสคอต "อีซี่" ท่าคิด/ประมวลผล — อัปโหลดไว้แล้วพร้อมอีก 8 รูปตอน Wire เข้า Flex
// Message ฝั่ง LINE (feature/mascot-flex-redesign) แต่ตอนนั้นไม่มีการ์ดไหนตรงกับ
// สถานะ "กำลังประมวลผล/รอผล AI" (สถานะรออ่านสลิปฝั่ง LINE ตอบเป็นข้อความ Text
// ธรรมดา ไม่ใช่ Flex) จึงยังไม่ได้ใช้ — ตรงนี้คือจุดแรกที่ตรงความหมาย: ระหว่าง
// AI กำลังอ่านสลิปบนเว็บ (ocrScanning) ⚠️ ฝั่งเว็บเท่านั้น ห้ามพอร์ตไป LINE
// (Founder ตัดสินใจแล้ว — LINE ตอบกลับได้ครั้งเดียวต่อ Event ถ้าจะโชว์ "กำลังอ่าน…"
// ต้องเปลี่ยนไปใช้ pushMessage ที่มีโควตาจำกัด เสี่ยงผู้ใช้ไม่ได้รับผลอ่านสลิปเลย)
// Bucket "flex-assets" Public เดียวกับ backend/src/utils/flexMessage.util.js —
// รูปตกแต่ง UI ล้วน ไม่มี PII จึงไม่ต้อง Sign URL แบบสลิปธุรกรรม
const OCR_SCANNING_MASCOT_URL =
  'https://isukdqundjwpbknnvckf.supabase.co/storage/v1/object/public/flex-assets/02-processing-thinking.png';
// USD Toggle เปิดเฉพาะ stock_us ตามที่ Mockup ทำจริง (t==="us" ? "THB⇄USD" : "THB")
// และตาม Requirement งานที่ 2 ("สลับ THB⇄USD เฉพาะสินทรัพย์ที่รองรับ USD (หุ้น US)")
// — Backend (API.md §15.2) เทคนิคแล้วรองรับ USD สำหรับ crypto ด้วย (Round 10) แต่
// ฟอร์มเว็บรอบนี้จงใจไม่เปิดให้ Crypto สลับสกุล ตรงตาม Mockup + Requirement ทั้งคู่
// (ไม่ใช่ข้อจำกัดของ Backend — เป็นการตัดสินใจ UX ของรอบนี้)
const USD_TOGGLE_TYPES = ['stock_us'];

function parseAmount(raw) {
  const n = parseFloat(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// รูปฟอร์แมตเงินแบบไทย (คอมม่าคั่นหลักพัน) — Presentation ล้วน ไม่ปัดเศษเปลี่ยนค่า
function fmtAmountInput(n) {
  return n.toLocaleString('th-TH');
}

// DcaForm — กล่อง "บันทึกรายการ" ซื้อ (DCA) และขาย (งานที่ 2, หัวใจของรอบนี้)
//
// ── โหมดซื้อ vs โหมดขาย ─────────────────────────────────────────────────────
// กล่องเดียวสลับด้วย Toggle ด้านบน (ไม่ทำ Modal/การ์ดที่สอง) เพราะ Field ส่วนใหญ่
// (วันที่ / สินทรัพย์ / รายละเอียด) ใช้ร่วมกัน และช่องทางหลักของผู้ใช้คือ LIFF บน
// มือถือที่พื้นที่จำกัด — สิ่งที่ "ต่างกันจริง" มีแค่ 3 อย่าง:
//   1) รายการสินทรัพย์ให้เลือก — ซื้อ = Registry ทั้งหมด / ขาย = เฉพาะที่ถืออยู่จริง
//   2) ช่องกรอก — ซื้อ = "จำนวนเงิน" (Backend หารเป็นหน่วยให้) /
//      ขาย = "จำนวนหน่วย + ราคาที่ขายได้" (ธรรมชาติของการขาย และเป็นเส้นทางเดียว
//      ที่ใช้ได้กับทุกประเภทสินทรัพย์รวมหุ้นไทยที่ไม่มี Price Feed)
//   3) สกุลเงิน — ซื้อ = เลือกได้ (THB⇄USD สำหรับหุ้น US) / ขาย = ล็อกตามสกุลของ
//      สินทรัพย์ที่ถืออยู่ (Backend อนุมานจากประวัติจริง — ให้เลือกเองจะทำ Ledger ปนสกุล)
//
// props:
//   symbols: รายการสินทรัพย์จาก GET /api/v1/assets/symbols
//   pickerOpenSignal: Counter ที่ Parent เพิ่มค่าเพื่อสั่งเปิด AssetPicker อัตโนมัติ
//     (ปุ่มบันทึกกลาง Bottom Nav บนมือถือ — งานที่ 1)
//   onRecorded(response): เรียกหลังบันทึกสำเร็จ (ให้ Parent Refetch overview)
//   onRequestUndo(txSummary): เรียกเมื่อกด "ย้อนรายการนี้" บนการ์ดยืนยัน (เปิด
//     Confirm Modal ที่ Parent เป็นคนคุม เพื่อใช้ Modal เดียวกับปุ่ม Undo บน
//     รายการล่าสุด — ไม่ทำ Modal ซ้ำสองที่)
//   prefillSignal (S8 R3 รอบ 3): { symbol, amountTotal, currency, nonce } | null —
//     Parent ตั้งค่าใหม่ (Object ใหม่ทุกครั้ง) เมื่อกด "บันทึกเลย" บนการ์ดแผนที่ถึง
//     รอบวันนี้ (SidePanels) เพื่อ Prefill ฟอร์มนี้ให้เอง

// มาสคอตท่าคิด/ประมวลผลระหว่างรอ AI อ่านสลิป — แยกเป็น Sub-component รับ Prop ตรงๆ
// (ไม่อ่าน State ของ DcaForm เอง) เพื่อให้ Test เรนเดอร์ scanning=true/false ได้ตรงๆ
// ผ่าน renderToStaticMarkup โดยไม่ต้องจำลอง File Upload จริง (Repo นี้ไม่มี React
// Testing Library — ดู Comment หัวไฟล์ dashboardComponents.render.test.js)
//
// <span> Render อยู่เสมอไม่ว่า scanning จะเป็นอะไร (สลับแค่ Class ผ่าน opacity/
// animation) เพื่อ "จอง" ขนาดกล่องไว้คงที่ตลอด — Layout จะไม่กระโดดตอนโผล่/หาย
// เพราะไม่มีการเพิ่ม/ลด Element ที่มีขนาดออกจาก Flow เลย (ดู .dh-scan-mascot ใน
// DashboardHome.css) · alt สื่อความหมายจริง (ไม่ใช่ alt="") ให้ Screen Reader/
// กรณีโหลดรูปไม่ขึ้นยังมีข้อความ · onError กัน Icon รูปแตกค้าง (Supabase ล่ม/เน็ตช้า
// ไม่ทำให้พัง — ปุ่มข้าง ๆ ยังโชว์ "🤖 กำลังอ่านสลิป…" ตามปกติเสมอไม่ว่ากรณีนี้)
function ScanningMascot({ scanning, failed, onImgError }) {
  return (
    <span className={`dh-scan-mascot${scanning && !failed ? ' dh-scan-mascot-visible' : ''}`}>
      <img src={OCR_SCANNING_MASCOT_URL} alt="กำลังอ่านสลิป" onError={onImgError} />
    </span>
  );
}

function DcaForm({
  symbols,
  pickerOpenSignal,
  onRecorded,
  onRequestUndo,
  prefillSignal = null,
  // holdings: [{symbol,name,type,units,currency}] — สินทรัพย์ที่ผู้ใช้ "ถืออยู่จริง"
  // ที่ Parent สร้างจาก overview.allocation ผ่าน sellForm.buildHoldings (ยอดคงเหลือ
  // คำนวณโดย Backend จาก Ledger — Component นี้ไม่บวกลบยอดเองเด็ดขาด)
  // ว่าง = ยังไม่มีอะไรให้ขาย → โหมดขายจะขึ้น Empty State แทนฟอร์ม
  holdings = [],
  // โหมดที่ฟอร์มเปิดขึ้นมาครั้งแรก ('buy' = พฤติกรรมเดิมทุกประการ) — ผู้ใช้สลับเองได้
  // ด้วย Toggle เสมอ ค่านี้แค่กำหนดค่าเริ่มต้น
  defaultSide = 'buy',
  // แนบสลิปหลักฐาน (Premium) — isPremiumActive มาจาก planInfo ของ DashboardHome
  // (GET /dashboard/me) / onUpgrade พาไป /premium ทั้งคู่เป็น Presentation Gate เฉยๆ
  // Backend ยัง Gate ซ้ำเองที่ POST /transactions/:id/slip (Security Boundary จริง)
  isPremiumActive = false,
  onUpgrade,
}) {
  const navigate = useNavigate();
  // Default กันปุ่ม "อัพเกรด" ตายถ้า Parent ลืมส่ง onUpgrade (P0-1) — พาไป /premium
  // ผ่าน React Router (กฎข้อ 12 ห้าม <a href>/window.location ที่ทำ JWT ใน Memory หาย)
  const handleUpgrade = onUpgrade ?? (() => navigate('/premium'));

  // 'buy' = บันทึก DCA (เดิม) | 'sell' = บันทึกการขาย — สลับด้วย Toggle ด้านบนฟอร์ม
  const [side, setSide] = useState(defaultSide === 'sell' ? 'sell' : 'buy');
  const [date, setDate] = useState(todayBangkokIso());
  const [picked, setPicked] = useState(null);
  // โหมดขาย: จำนวน "หน่วย" ที่ขาย + ราคาที่ขายได้ต่อหน่วย (คนละความหมายกับ
  // amountInput ของโหมดซื้อที่เป็น "จำนวนเงิน" — จงใจแยก State กันสับสนข้ามโหมด)
  const [sellQuantity, setSellQuantity] = useState('');
  const [sellPrice, setSellPrice] = useState('');
  const [sellFieldError, setSellFieldError] = useState(null); // 'quantity' | 'price' | 'date' | null
  const [amountInput, setAmountInput] = useState('');
  const [selectedChip, setSelectedChip] = useState(null);
  const [currency, setCurrency] = useState('THB');
  const [pricePerUnit, setPricePerUnit] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [amountFieldError, setAmountFieldError] = useState(false);
  const [confirmed, setConfirmed] = useState(null); // response.transaction ล่าสุดที่บันทึกสำเร็จ

  // แนบสลิปหลักฐาน (Premium) — slipFile = ไฟล์ที่จะแนบหลังบันทึกสำเร็จ,
  // slipPreviewUrl = Object URL สำหรับ Thumbnail, slipNotice = ข้อความใต้ช่อง
  // (Validation เตือน หรือ Warning "บันทึกสำเร็จแต่แนบรูปไม่สำเร็จ")
  const [slipFile, setSlipFile] = useState(null);
  const [slipPreviewUrl, setSlipPreviewUrl] = useState(null);
  const [slipNotice, setSlipNotice] = useState(null);

  // ── AI อ่านสลิป (งานที่ 2.2) ───────────────────────────────────────────────
  // Flow: เลือกรูป → POST /transactions/slip-ocr → Prefill ฟอร์มด้วยค่าที่อ่านได้ →
  // ผู้ใช้ "ตรวจ + แก้ไขได้" → กดปุ่มบันทึกเดิม → POST /transactions พร้อม slipToken
  //
  // ⚠️ ห้ามบันทึกลง Ledger ทันทีหลัง AI อ่านเสร็จเด็ดขาด (Requirement) — Endpoint
  // /slip-ocr ไม่สร้างธุรกรรมอยู่แล้ว และหน้านี้แค่ "เติมค่าในฟอร์ม" ให้ผู้ใช้ยืนยันเอง
  // (Pattern เดียวกับการ์ด Preview ใน LINE)
  //
  // ocrSlipToken: รูปที่ถูกอัปโหลดไว้แล้วตอนอ่าน (Premium เท่านั้น — ผู้ใช้ทดลองฟรี
  // ได้ null) ส่งไปกับ Payload ตอนยืนยันเพื่อให้ Backend แนบเข้ารายการที่เพิ่งสร้าง
  const [ocrScanning, setOcrScanning] = useState(false);
  // true = รูปมาสคอตโหลดไม่สำเร็จ (Supabase ล่ม/เน็ตช้า) → ไม่วาด <img> ต่อ กัน
  // ไอคอนรูปแตกโผล่ค้าง — ปุ่มยังโชว์ "🤖 กำลังอ่านสลิป…" ตามปกติเสมอไม่ว่ากรณีนี้
  // (Reset กลับ false ทุกครั้งที่เริ่มสแกนใหม่ เผื่อเน็ตกลับมาใช้ได้รอบหน้า)
  const [ocrMascotFailed, setOcrMascotFailed] = useState(false);
  const [ocrError, setOcrError] = useState(null);
  const [ocrUpgrade, setOcrUpgrade] = useState(false);
  const [ocrSlipToken, setOcrSlipToken] = useState(null);
  const [ocrNotice, setOcrNotice] = useState(null);
  // true = AI อ่านทิศทาง (ซื้อ/ขาย) ไม่ได้ → ไฮไลต์ปุ่มเลือกโหมดให้ผู้ใช้เห็นชัด
  // ว่ายังต้องเลือกเอง (ระบบไม่เดาให้ — ดู lib/slipOcrPrefill.js)
  const [ocrSideUnresolved, setOcrSideUnresolved] = useState(false);

  // ── ตัวเลขจากสลิปที่จะถูกบันทึกจริง (โหมดซื้อ) ─────────────────────────────
  // ⚠️ ต้องเป็นช่องที่ "ผู้ใช้เห็นและแก้ได้" ไม่ใช่ค่าซ่อนที่ไหลลง Ledger เงียบๆ
  // (มติ Founder: ผู้ใช้ควรเห็นตัวเลขที่กำลังจะถูกบันทึกก่อนกดบันทึก)
  // ว่างทั้งคู่ = ไม่ได้มาจากสลิป → ฟอร์มทำงานแบบเดิมทุกประการ (ใช้จำนวนเงิน)
  const [slipQuantityInput, setSlipQuantityInput] = useState('');
  const [slipPriceInput, setSlipPriceInput] = useState('');
  // ค่าธรรมเนียม (Migration 041) — ผู้ใช้แก้เองได้เผื่อ AI อ่านผิด/สลิปไม่ระบุ
  // '' = ไม่รู้ (ส่ง undefined ไป Backend → ลง DB เป็น NULL ไม่ใช่ 0)
  const [slipFeeInput, setSlipFeeInput] = useState('');
  // ยอดสุทธิตามสลิป — แสดงผลอย่างเดียว ไม่ถูกบันทึก (ใช้บอกผู้ใช้ว่ายอดที่จำได้
  // ต่างจากมูลค่าหุ้นเพราะค่าธรรมเนียม) · null = สลิปไม่ระบุ/AI อ่านไม่ได้
  const [slipNetAmount, setSlipNetAmount] = useState(null);
  // ── มูลค่าหุ้นที่ Backend "พิสูจน์แล้วว่าเป็นเลขบนสลิปจริง" (บั๊ค B) ──────────
  // เดิมฟอร์มคำนวณ quantity × price เองในเบราว์เซอร์เสมอ ทำให้ค่าที่ resolveGrossAmount
  // ตรวจสอบมาแล้วถูกทิ้งทุกครั้ง — เคส EOSE สลิประบุ 106.44 แต่ฟอร์มโชว์ 106.32
  // (ราคาต่อหน่วยบนสลิปถูกปัดมาแสดง 4.25 ทั้งที่จริงคือ 4.2548 พอคูณกลับจึงไม่ตรง)
  //
  // เก็บคู่กับ "ค่าที่ Prefill มาตอนแรก" เพื่อรู้ว่าผู้ใช้แก้ช่องจำนวน/ราคาไปหรือยัง —
  // ถ้าแก้แล้ว ยอดจากสลิปใบนั้นไม่ใช่ยอดของตัวเลขคู่ใหม่อีกต่อไป ต้องกลับไปคำนวณเอง
  const [slipGrossAmount, setSlipGrossAmount] = useState(null);
  const [slipPrefilled, setSlipPrefilled] = useState(null);

  // Revoke Object URL ล่าสุด "ตอน Unmount เท่านั้น" (กัน Memory leak) — ใช้ ref กัน
  // ไม่ให้ revoke ทุกครั้งที่ URL เปลี่ยน (การเปลี่ยน/ลบ revoke เองอยู่แล้วในแต่ละ Handler)
  const slipPreviewRef = useRef(null);
  useEffect(() => {
    slipPreviewRef.current = slipPreviewUrl;
  }, [slipPreviewUrl]);
  useEffect(() => {
    return () => {
      if (slipPreviewRef.current) URL.revokeObjectURL(slipPreviewRef.current);
    };
  }, []);

  const today = todayBangkokIso();
  const isSell = side === 'sell';
  // ── ราคาต่อหน่วย (โหมดซื้อ) ────────────────────────────────────────────────
  // priceRequired    : บังคับกรอก — หุ้นไทยไม่มี Price Feed ในระบบ ถ้าไม่กรอกจะไป
  //                    จบที่ PRICE_FEED_NOT_IMPLEMENTED ฝั่ง Backend อยู่ดี
  // slipNumbersActive: กำลังใช้ตัวเลขจากสลิป (กล่องเขียวด้านล่าง) — ต้องซ่อนช่องราคา
  //                    ปกติทิ้ง ไม่งั้นหน้าจอมีช่องราคา 2 ช่องที่ขัดแย้งกันเอง
  // showPriceField   : แสดงช่องให้กรอกเอง — เปิดให้ "ทุกสินทรัพย์" ไม่ใช่แค่หุ้นไทย
  //                    (ราคาตลาดตอนกดบันทึกไม่เคยตรงกับราคาที่จับคู่จริง ผู้ใช้ที่รู้
  //                    ราคาจริงควรกรอกเองได้) — ⚠️ ห้ามเติมราคาให้อัตโนมัติเด็ดขาด
  //                    เพราะต้องยิง Price Feed ทุกครั้งที่เปิดฟอร์ม ซึ่ง Twelve Data
  //                    ชนเพดาน 8 ครั้ง/นาทีอยู่บ่อยแล้ว — ปล่อยว่างให้ผู้ใช้กรอกเอง
  const priceRequired = !isSell && picked?.type === 'stock_th';
  const slipNumbersActive = !isSell && slipQuantityInput !== '' && slipPriceInput !== '';
  // มูลค่าหุ้นที่สลิประบุและ Backend พิสูจน์แล้ว "และผู้ใช้ยังไม่ได้แก้ช่องจำนวน/ราคา"
  // (บั๊ค B) — null = ไม่มีค่าที่เชื่อได้ ให้คำนวณ quantity × price เองตามเดิม
  // ใช้ทั้งตอนแสดงผลและตอนส่งบันทึก เพื่อให้ "เลขที่แสดง = เลขที่บันทึก" เสมอ
  const slipGrossUntouched =
    slipGrossAmount !== null &&
    slipPrefilled !== null &&
    slipQuantityInput === slipPrefilled.quantity &&
    slipPriceInput === slipPrefilled.pricePerUnit
      ? slipGrossAmount
      : null;
  const showPriceField = !isSell && !slipNumbersActive;
  // ชื่อเดิม — คงไว้เพื่อไม่ต้องแก้ทุกจุดที่อ้างถึงความหมาย "ต้องกรอกราคาเอง"
  const needsManualPrice = priceRequired;
  const supportsUsd = !isSell && picked ? USD_TOGGLE_TYPES.includes(picked.type) : false;
  // ยอดคงเหลือของตัวที่เลือกในโหมดขาย — อ่านจาก holdings (Backend คำนวณมาแล้ว)
  // ไม่ใช่ค่าที่คำนวณในหน้านี้ ดูหมายเหตุที่ props holdings
  const heldHolding = isSell ? findHolding(holdings, picked?.symbol) : null;

  // Prefill จากปุ่ม "บันทึกเลย" (SidePanels) — ไม่ Prefill pricePerUnit เด็ดขาดแม้
  // เป็นหุ้นไทย (needsManualPrice) ต้องให้ผู้ใช้กรอกราคาเองเสมอ ไม่เดาราคาให้
  useEffect(() => {
    const resolved = resolvePrefillState(prefillSignal, symbols);
    if (!resolved) return;
    // แผน DCA เป็นเรื่องของ "การซื้อ" เสมอ — ถ้าผู้ใช้ค้างอยู่โหมดขายแล้วกด "บันทึกเลย"
    // ต้องดึงกลับมาโหมดซื้อ ไม่งั้นค่าที่ Prefill จะไปโผล่ในฟอร์มที่ตีความคนละแบบ
    setSide('buy');
    setPicked(resolved.picked);
    setAmountInput(resolved.amountInputStr);
    setCurrency(resolved.currency);
    setSelectedChip(null);
    setPricePerUnit('');
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefillSignal]);

  function handleChipClick(amt) {
    setAmountInput(fmtAmountInput(amt));
    setSelectedChip(amt);
    setAmountFieldError(false);
  }

  function handleAmountInput(raw) {
    setAmountInput(raw);
    setSelectedChip(null);
    setAmountFieldError(false);
  }

  function handlePickAsset(item) {
    setPicked(item);
    // สลับสินทรัพย์ที่ไม่รองรับ USD ระหว่างกรอก → รีเซ็ตกลับ THB (กัน Payload
    // ค้างเป็น USD ของสินทรัพย์ที่ backend ปฏิเสธแน่ๆ)
    // โหมดขายไม่แตะ currency เลย — สกุลล็อกตามสินทรัพย์ที่ถืออยู่ (holding.currency)
    if (!isSell && !USD_TOGGLE_TYPES.includes(item.type)) {
      setCurrency('THB');
    }
    setFormError(null);
    setSellFieldError(null);
  }

  // สลับโหมดซื้อ/ขาย — ล้างทุกช่องที่ "ตีความคนละแบบ" ระหว่างสองโหมดทิ้งเสมอ
  // (จำนวนเงิน 1,000 ของโหมดซื้อ ≠ จำนวนหน่วย 1,000 ของโหมดขาย — ถ้าปล่อยค้างไว้
  // ผู้ใช้อาจกดบันทึกทับโดยไม่ทันดู) รวมถึง picked เพราะรายการที่เลือกได้คนละชุดกัน
  function handleSwitchSide(next) {
    if (next === side) return;
    setSide(next);
    setPicked(null);
    setAmountInput('');
    setSelectedChip(null);
    setCurrency('THB');
    setPricePerUnit('');
    setSellQuantity('');
    setSellPrice('');
    setFormError(null);
    setAmountFieldError(false);
    setSellFieldError(null);
    setConfirmed(null);
    // สลิปเป็นของฝั่งซื้อ (แนบเป็นหลักฐานตอน DCA) — ล้างไฟล์ที่ค้างไว้ด้วย
    clearSlip();
    setSlipNotice(null);
    // ⚠️ ต้องล้าง token ของสลิปที่ AI อ่านไว้ด้วย: ผู้ใช้สลับโหมดเอง = ตั้งใจเริ่มรายการ
    // ใหม่ ถ้าปล่อย token ค้าง รูปสลิปใบเดิมจะถูกแนบเข้ารายการใหม่ที่คนละใบกัน
    clearOcrState();
  }

  // ล้างสลิปที่เลือกไว้ + revoke Preview URL (เรียกทั้งตอนกด "ลบรูป" และหลังบันทึกสำเร็จ)
  function clearSlip() {
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    setSlipFile(null);
    setSlipPreviewUrl(null);
  }

  function handleSlipChange(e) {
    const file = e.target.files?.[0] ?? null;
    if (slipPreviewUrl) URL.revokeObjectURL(slipPreviewUrl);
    setSlipNotice(null);
    if (!file) {
      setSlipFile(null);
      setSlipPreviewUrl(null);
      return;
    }
    // Validate ฝั่ง Client ก่อน (Backend ตรวจซ้ำ) — Reject แล้วไม่เก็บไฟล์ + เคลียร์ input
    // ให้เลือกใหม่ได้ (ไม่ค้างชื่อไฟล์เดิมใน input)
    if (!SLIP_ACCEPT_TYPES.includes(file.type)) {
      setSlipFile(null);
      setSlipPreviewUrl(null);
      setSlipNotice('ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น');
      e.target.value = '';
      return;
    }
    if (file.size > SLIP_MAX_BYTES) {
      setSlipFile(null);
      setSlipPreviewUrl(null);
      setSlipNotice('ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)');
      e.target.value = '';
      return;
    }
    setSlipFile(file);
    setSlipPreviewUrl(URL.createObjectURL(file));
  }

  function resetFormAfterSuccess() {
    setPicked(null);
    setAmountInput('');
    setSelectedChip(null);
    setCurrency('THB');
    setPricePerUnit('');
    setSellQuantity('');
    setSellPrice('');
    setSellFieldError(null);
    setNote('');
    setDate(todayBangkokIso());
    clearSlip();
    clearOcrState();
  }

  // ล้างสถานะ AI อ่านสลิป — ⚠️ ต้องล้าง ocrSlipToken ทุกครั้งที่ฟอร์มถูก Reset/สลับโหมด
  // ไม่งั้น token ของสลิปใบเก่าจะค้างไปแนบเข้ารายการ "ใบถัดไป" ที่ไม่เกี่ยวข้องกันเลย
  // (หลักฐานผิดรายการ = ร้ายแรงกว่าไม่มีหลักฐาน)
  function clearOcrState() {
    setOcrSlipToken(null);
    setOcrError(null);
    setOcrUpgrade(false);
    setOcrNotice(null);
    setOcrSideUnresolved(false);
    setSlipQuantityInput('');
    setSlipPriceInput('');
    setSlipFeeInput('');
    setSlipNetAmount(null);
    setSlipGrossAmount(null);
    setSlipPrefilled(null);
  }

  // ── บันทึกการขาย ──────────────────────────────────────────────────────────
  // sellAll = true เมื่อกดปุ่ม "ขายทั้งหมด" (ไม่ส่งจำนวน/ราคาไปเลย ให้ Backend
  // ดึงยอดคงเหลือ + ราคาตลาดเอง — ดูเหตุผลใน lib/sellForm.js)
  async function submitSell(sellAll) {
    setFormError(null);
    setSellFieldError(null);
    setConfirmed(null);

    const built = buildSellPayload({
      holding: heldHolding,
      sellAll,
      quantityInput: sellQuantity,
      priceInput: sellPrice,
      date,
      today,
      note,
    });

    if (built.error) {
      setFormError(built.error);
      setSellFieldError(built.field ?? null);
      return;
    }

    setSubmitting(true);
    try {
      const response = await apiPost('/api/v1/transactions', built.payload);
      setConfirmed(response.transaction);
      resetFormAfterSuccess();
      onRecorded(response);
    } catch (err) {
      setFormError(transactionErrorMessage(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();

    // โหมดขายเดินคนละเส้นทางทั้งหมด (Payload/Validation/Endpoint Field ต่างกัน) —
    // แยกฟังก์ชันไปเลยดีกว่าเสียบ if ซ้อนตลอดทั้งฟังก์ชันเดิมของฝั่งซื้อ
    if (isSell) {
      await submitSell(false);
      return;
    }

    setFormError(null);
    setConfirmed(null);

    if (!picked) {
      setFormError('กรุณาเลือกสินทรัพย์ก่อนบันทึก');
      return;
    }

    // ── ตัวเลขจากสลิป (จำนวนหน่วย + ราคาที่ได้จริง) ─────────────────────────────
    // เมื่อสลิประบุครบทั้งคู่ ให้ส่งค่าคู่นั้นเป็นหลักแทน "จำนวนเงิน" — Backend จะ
    // บันทึกตามนี้ตรงๆ ไม่ไปดึงราคาตลาดมาคำนวณจำนวนหน่วยใหม่ (ซึ่งทำให้รายการ
    // ที่บันทึกย้อนหลังเพี้ยนตามราคาวันที่กดบันทึก ไม่ใช่ราคาที่ซื้อได้จริง)
    const slipQty = parseAmount(slipQuantityInput);
    const slipPrice = parseAmount(slipPriceInput);
    const useSlipNumbers = slipQty !== null && slipQty > 0 && slipPrice !== null && slipPrice > 0;

    // จำนวนเงินยังบังคับเหมือนเดิม "ยกเว้น" ตอนใช้ตัวเลขจากสลิป (ยอดรวมคำนวณได้เอง
    // จาก จำนวน × ราคา — Backend คำนวณให้ด้วยสูตรเดียวกับทุกจุดของระบบ)
    const amountTotal = parseAmount(amountInput);
    if (!useSlipNumbers && (amountTotal === null || amountTotal <= 0)) {
      setAmountFieldError(true);
      setFormError('กรุณากรอกจำนวนเงินที่ถูกต้อง (มากกว่า 0)');
      return;
    }

    if (date > today) {
      setFormError('บันทึกรายการล่วงหน้าไม่ได้ กรุณาเลือกวันที่ไม่เกินวันนี้');
      return;
    }

    // ── ราคาต่อหน่วย: กรอกเองได้ทุกสินทรัพย์ (ไม่บังคับ ยกเว้นหุ้นไทย) ──────────
    // เหตุผล: ราคาตลาดที่ดึงตอนกดบันทึกไม่เคยตรงกับราคาที่จับคู่จริง แม้บันทึกวัน
    // เดียวกัน ทำให้จำนวนหน่วยคลาดสะสมไปเรื่อยๆ — ผู้ใช้ที่รู้ราคาจริงควรกรอกเองได้
    // เว้นว่าง = ใช้ราคาตลาดเหมือนเดิมทุกประการ (ไม่ทำลายความสะดวกของคนที่ไม่อยากกรอก)
    let priceValue = null;
    if (!useSlipNumbers) {
      if (pricePerUnit.trim() !== '') {
        priceValue = parseAmount(pricePerUnit);
        if (priceValue === null || priceValue <= 0) {
          setFormError('ราคาต่อหน่วยไม่ถูกต้อง — กรอกตัวเลขมากกว่า 0 หรือเว้นว่างไว้เพื่อใช้ราคาตลาด');
          return;
        }
      } else if (priceRequired) {
        setFormError('หุ้นไทยยังไม่มีราคาตลาดอัตโนมัติ กรุณากรอก "ราคาต่อหน่วย" ที่ซื้อด้วย');
        return;
      }
    }

    const payload = {
      symbol: picked.symbol,
      currency,
      date,
      ...(note.trim() ? { note: note.trim() } : {}),
      // ใช้ตัวเลขจากสลิป → ส่ง quantity + pricePerUnit เป็นหลัก
      //
      // ⚠️ บั๊ค B: ส่ง amountTotal ไปด้วย "เฉพาะเมื่อสลิประบุมูลค่าหุ้นไว้ตรงๆ และ
      // Backend พิสูจน์แล้ว" (slipGrossUntouched) — ไม่งั้น Backend จะคำนวณ
      // quantity × pricePerUnit ขึ้นมาใหม่ แล้วบันทึก 106.32 ทั้งที่ฟอร์มแสดง 106.44
      // ซึ่งขัดหลัก "ยอดที่บันทึกต้องเท่ากับยอดที่ผู้ใช้เห็นตอนกดบันทึก" (มติ Founder)
      // เมื่อไม่มีค่าที่พิสูจน์ได้ = ไม่ส่ง = Backend คำนวณเองเหมือนเดิมทุกประการ
      ...(useSlipNumbers
        ? {
            quantity: slipQty,
            pricePerUnit: slipPrice,
            ...(slipGrossUntouched !== null ? { amountTotal: slipGrossUntouched } : {}),
          }
        : { amountTotal, ...(priceValue !== null ? { pricePerUnit: priceValue } : {}) }),
      // ค่าธรรมเนียม (Migration 041) — ส่งเฉพาะเมื่อรู้จริง ('' = ไม่รู้ → ไม่ส่ง Key
      // เลย เพื่อให้ Backend ลง NULL ไม่ใช่ 0) · ผู้ใช้กรอก 0 เอง = ยืนยันว่าไม่มี
      ...(slipFeeInput.trim() !== '' && Number.isFinite(Number(slipFeeInput))
        ? { feeThb: Number(slipFeeInput) }
        : {}),
      // AI อ่านสลิป (งานที่ 2.2) — รูปถูกอัปโหลดไว้แล้วตอนอ่าน Backend จะแนบเข้า
      // รายการที่เพิ่งสร้างให้เอง (Fail Isolated ฝั่ง Backend) จึง "ไม่" ต้องอัปโหลดซ้ำ
      // ผ่าน apiUpload ด้านล่าง — ดู ocrSlipToken ใน Guard ของ slipFile
      ...(ocrSlipToken ? { slipToken: ocrSlipToken } : {}),
    };

    setSubmitting(true);
    setSlipNotice(null);
    try {
      const response = await apiPost('/api/v1/transactions', payload);

      // แนบสลิปหลักฐาน (ถ้าเลือกไว้ — Premium เท่านั้น) เป็นขั้นแยกหลังธุรกรรมถูกสร้าง
      // แล้ว (Endpoint รับ transaction id) — Best-effort: ธุรกรรม "บันทึกสำเร็จแล้วจริง"
      // ต่อให้แนบรูปพลาด ต้องไม่ทำให้ผู้ใช้เข้าใจว่าบันทึก DCA ไม่สำเร็จ → ไม่ throw
      // แค่แสดง Warning แยก (รายการยังอยู่ครบ แค่ไม่มีรูปแนบ) Backend Gate Premium ซ้ำเอง
      // ⚠️ ข้ามการอัปโหลดซ้ำเมื่อรายการนี้มาจาก AI อ่านสลิป — รูปใบนั้นถูกอัปโหลดและ
      // แนบโดย Backend ไปแล้ว (slipToken ใน Payload) ถ้ายิงซ้ำจะได้ SLIP_ALREADY_ATTACHED
      // แล้วขึ้น Warning หลอกว่า "แนบไม่สำเร็จ" ทั้งที่แนบไปแล้วเรียบร้อย
      let slipWarning = null;
      if (ocrSlipToken) {
        // ไม่ทำอะไร — Backend แนบให้แล้ว
      } else if (slipFile && isPremiumActive) {
        try {
          await apiUpload(`/api/v1/transactions/${response.transaction.id}/slip`, slipFile);
        } catch (err) {
          slipWarning = `บันทึก DCA สำเร็จ แต่แนบรูปสลิปไม่สำเร็จ (${slipUploadErrorMessage(err.message)})`;
        }
      } else if (slipFile) {
        // P2-6: มีไฟล์เลือกไว้แต่ isPremiumActive กลายเป็น false (สิทธิ์หมดอายุ/เพี้ยนกลางคัน)
        // → ไฟล์ "ไม่ถูกแนบ" ต้องบอกให้ชัด ห้ามทิ้งเงียบให้ผู้ใช้เข้าใจผิดว่าแนบสำเร็จ
        // (หลักฐานภาษีหายเงียบ = ร้ายแรงกว่าแนบไม่ได้)
        slipWarning =
          'บันทึก DCA สำเร็จ แต่รูปสลิปไม่ได้ถูกแนบ (การแนบสลิปใช้ได้เฉพาะสมาชิก Premium)';
      }

      setConfirmed(response.transaction);
      resetFormAfterSuccess();
      onRecorded(response);
      // ตั้ง Warning "หลัง" reset (resetFormAfterSuccess ไม่แตะ slipNotice แล้ว — ตั้งตรงนี้
      // เพื่อให้ข้อความค้างให้ผู้ใช้เห็นว่ารูปไม่ได้แนบ ทั้งที่รายการบันทึกสำเร็จ)
      if (slipWarning) setSlipNotice(slipWarning);
    } catch (err) {
      setFormError(transactionErrorMessage(err.message));
    } finally {
      setSubmitting(false);
    }
  }

  // ── ให้ AI อ่านสลิปแล้ว Prefill ฟอร์ม (งานที่ 2.2) ─────────────────────────
  async function handleScanSlip(file) {
    if (!file) return;
    setOcrError(null);
    setOcrUpgrade(false);
    setOcrNotice(null);
    setFormError(null);
    setOcrMascotFailed(false);
    setOcrScanning(true);

    try {
      const result = await apiUpload('/api/v1/transactions/slip-ocr', file);
      const { slip, slipToken, quota } = result;

      // ⚠️ คำสั่งที่ "ยังไม่เกิดขึ้นจริง" (Limit Order รอจับคู่/ถูกยกเลิก) ห้าม Prefill
      // ให้กดบันทึกง่ายๆ — เหตุผลเดียวกับที่การ์ด Preview ฝั่ง LINE ตัดปุ่มยืนยันออก
      // (slipOcr.service.isUnfilledStatus): Ledger ต้องไม่มีรายการที่ไม่เคยเกิดขึ้น
      if (slip.orderStatus === 'pending' || slip.orderStatus === 'cancelled') {
        setOcrError(
          slip.orderStatus === 'pending'
            ? 'สลิปนี้เป็นคำสั่งที่ "ยังไม่สำเร็จ" (รอจับคู่/รอดำเนินการ) จึงยังไม่บันทึกให้อัตโนมัติ — ถ้าคำสั่งจับคู่แล้ว กรุณากรอกรายการเอง'
            : 'สลิปนี้เป็นคำสั่งที่ถูกยกเลิก/ไม่สำเร็จ จึงไม่บันทึกเป็นรายการให้'
        );
        return;
      }

      // Symbol ต้องมีอยู่ใน Registry ที่หน้านี้รู้จัก ไม่งั้น AssetPicker เลือกไม่ได้
      const matched = symbols.find((s) => s.symbol === slip.symbol) ?? null;
      if (!matched) {
        setOcrError(
          `อ่านสลิปได้ว่าเป็น "${slip.symbol}" แต่ระบบยังไม่รองรับสินทรัพย์นี้ กรุณาเลือกสินทรัพย์เองแล้วกรอกรายการต่อ`
        );
        return;
      }

      // ── Prefill ── ทุกค่าที่เติมยัง "แก้ไขได้ทั้งหมด" ผู้ใช้ต้องกดบันทึกเองอยู่ดี
      // ตรรกะว่า "เติมอะไรได้บ้าง" อยู่ใน lib/slipOcrPrefill.js (Pure + มี Test คลุม)
      // — ที่นี่ทำหน้าที่ Apply ผลลัพธ์ลง State เท่านั้น ไม่ตัดสินใจอะไรเอง
      const prefill = buildOcrPrefill(slip);

      setPicked(matched);
      setSelectedChip(null);
      if (prefill.date) setDate(prefill.date);

      // ⚠️ ล้างช่องที่ผูกกับทิศทางก่อนเติมใหม่เสมอ — กันค่าจากสลิป "ใบก่อนหน้า"
      // ค้างอยู่แล้วดูเหมือนเป็นค่าของใบนี้ (สแกนใบที่ 2 ทับใบที่ 1) ซึ่งอันตราย
      // ที่สุดตอน side ไม่ชัด เพราะเราจะไม่เติมทับให้เลย
      setAmountInput('');
      setPricePerUnit('');
      setSellQuantity('');
      setSellPrice('');
      setCurrency('THB');
      setSlipQuantityInput('');
      setSlipPriceInput('');
      setSlipFeeInput('');
      setSlipNetAmount(null);
      setSlipGrossAmount(null);
      setSlipPrefilled(null);

      // ⚠️ setSide เฉพาะตอนที่ "รู้ทิศทางจริง" เท่านั้น — side = null (อ่านไม่ออก/
      // สัญญาณขัดกัน) ต้องปล่อยฟอร์มไว้ตามที่ผู้ใช้เปิดมา ห้ามเดาให้เด็ดขาด
      // (ดูเหตุผลเต็ม + เคส BCPG ใน lib/slipOcrPrefill.js)
      if (prefill.side) setSide(prefill.side);
      if (prefill.currency) setCurrency(prefill.currency);
      if (prefill.amountInput) setAmountInput(prefill.amountInput);
      if (prefill.pricePerUnit) setPricePerUnit(prefill.pricePerUnit);
      if (prefill.sellQuantity) setSellQuantity(prefill.sellQuantity);
      if (prefill.sellPrice) setSellPrice(prefill.sellPrice);
      // โหมดซื้อ: สลิปให้จำนวนหน่วย+ราคาครบ → บันทึกด้วยตัวเลขจริงจากสลิป ไม่ใช่
      // ยอดเงินที่ต้องเอาไปหารด้วยราคาตลาดวันนี้ (ดู buildOcrPrefill.buyQuantity)
      if (prefill.buyQuantity) setSlipQuantityInput(prefill.buyQuantity);
      if (prefill.buyPricePerUnit) setSlipPriceInput(prefill.buyPricePerUnit);
      // ค่าธรรมเนียม + ยอดสุทธิ (Migration 041) — ไม่ขึ้นกับทิศทาง เติมได้เสมอ
      if (prefill.feeTotal) setSlipFeeInput(prefill.feeTotal);
      if (prefill.netAmount) setSlipNetAmount(Number(prefill.netAmount));
      // มูลค่าหุ้นที่ Backend พิสูจน์แล้วว่าเป็นเลขบนสลิปจริง (บั๊ค B) — มีเฉพาะตอนที่
      // resolveGrossAmount ตอบ amountSource='slip_gross' เท่านั้น ถ้าเป็น 'computed'
      // แปลว่าระบบก็คำนวณเองอยู่แล้ว ฟอร์มคำนวณเองต่อไปได้ ผลเท่ากันและตรงไปตรงมากว่า
      if (prefill.slipGrossAmount !== null && prefill.buyQuantity && prefill.buyPricePerUnit) {
        setSlipGrossAmount(Number(prefill.slipGrossAmount));
        setSlipPrefilled({ quantity: prefill.buyQuantity, pricePerUnit: prefill.buyPricePerUnit });
      }

      // ไฮไลต์ปุ่มซื้อ/ขายให้เห็นชัดว่า "ยังต้องเลือกเอง" (ข้อความเตือนอย่างเดียว
      // ผู้ใช้ที่กดเร็วๆ มักไม่ทันอ่าน — นี่คือช่องที่ทำให้บั๊ก BCPG หลุดมาได้)
      setOcrSideUnresolved(prefill.sideUnresolved);

      setOcrSlipToken(slipToken ?? null);

      // ⚠️ ทิศทางอ่านไม่ชัด = ต้องเตือนให้ผู้ใช้เลือกเอง ห้ามเดา (เคส BCPG: สลิป "ขาย"
      // เคยถูกบันทึกเป็น "ซื้อ" มาแล้ว — เป็นบั๊กที่กระทบ P&L/จำนวนหน่วยโดยตรง)
      const parts = [];
      if (prefill.sideUnresolved) {
        // ข้อความต้องตรงกับพฤติกรรมจริง: ระบบ "ไม่ได้เลือกให้" และ "ไม่ได้กรอกตัวเลข"
        // (เดิมเขียนว่า "กรุณาเลือกเองให้ถูกต้อง" ทั้งที่โค้ดเลือก buy ให้ไปแล้ว —
        // ข้อความกับพฤติกรรมขัดกันเอง ทำให้ผู้ใช้เข้าใจผิดว่าที่เห็นคือค่าจากสลิป)
        parts.push(
          '⚠️ อ่านทิศทางรายการ (ซื้อ/ขาย) จากสลิปไม่ได้ — ระบบจึงยังไม่เลือกโหมดและไม่กรอกจำนวนให้ กรุณาเลือกซื้อ/ขายเอง แล้วกรอกจำนวนจากสลิป'
        );
      }
      if (slip.confidence === 'low') {
        parts.push('ความมั่นใจในการอ่านต่ำ กรุณาตรวจตัวเลขทุกช่องก่อนกดบันทึก');
      }
      parts.push(
        quota?.mode === 'trial'
          ? `ทดลองใช้ฟรี — เหลืออีก ${quota.remaining} ครั้ง`
          : `โควตาอ่านสลิปเดือนนี้เหลือ ${quota?.remaining ?? '-'} ครั้ง`
      );
      if (quota?.mode === 'trial') {
        parts.push('(การเก็บรูปสลิปเป็นหลักฐานเป็นสิทธิ์ของสมาชิก Premium)');
      }
      setOcrNotice(parts.join(' · '));
    } catch (err) {
      setOcrError(slipOcrErrorMessage(err.message));
      setOcrUpgrade(isSlipOcrUpgradeError(err.message));
    } finally {
      setOcrScanning(false);
    }
  }

  // โหมดขายที่ยังไม่มีอะไรให้ขาย — บอกตรงๆ ดีกว่าปล่อยให้เปิด Picker แล้วเจอ
  // "ไม่พบรายการ" (ข้อความของ Picker ชวนให้แจ้งทีมงานเพิ่มสินทรัพย์ ซึ่งไม่ใช่ปัญหานี้)
  const sellEmpty = isSell && holdings.length === 0;

  return (
    <div className={`dh-dca-grid${confirmed ? '' : ' dh-dca-grid-full'}`}>
      <form className="dh-dca-form" autoComplete="off" onSubmit={handleSubmit}>
        {/* ── ทางเลือกการกรอก: กรอกเอง หรือ ให้ AI อ่านสลิป (งานที่ 2.2) ──────────
            วางไว้บนสุดของฟอร์มโดยเจตนา — Requirement ระบุว่าต้อง "เด่นและใช้ง่าย
            ระดับเดียวกับปุ่มบันทึก" และผู้ใช้ต้องเห็นทางเลือกก่อนเริ่มกรอก ไม่ใช่
            หลังกรอกไปครึ่งฟอร์มแล้ว
            ไม่ใช่ Toggle โหมด: กดแล้วเปิดหน้าต่างเลือกไฟล์ทันที (Action ไม่ใช่ State)
            ฟอร์มด้านล่างยังเป็นตัวเดิมเสมอ — AI แค่ "เติมค่าให้" แล้วผู้ใช้ตรวจ/แก้/ยืนยันเอง */}
        <div className="dh-entry-choice">
          <span className="dh-entry-choice-lbl">กรอกเอง หรือ</span>
          <label className={`dh-scan-btn${ocrScanning ? ' dh-scan-btn-busy' : ''}`}>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              hidden
              disabled={ocrScanning || submitting}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                // Reset ทันทีเพื่อให้เลือกไฟล์เดิมซ้ำได้หลังอ่านพลาด
                e.target.value = '';
                handleScanSlip(file);
              }}
            />
            {ocrScanning ? '🤖 กำลังอ่านสลิป…' : '📷 อัปโหลดสลิปให้ AI อ่าน'}
          </label>
          <ScanningMascot
            scanning={ocrScanning}
            failed={ocrMascotFailed}
            onImgError={() => setOcrMascotFailed(true)}
          />
        </div>

        {ocrError && (
          <div className="dh-form-error">
            {ocrError}
            {ocrUpgrade && (
              <div style={{ marginTop: 8 }}>
                <button type="button" className="dh-btn-main" onClick={handleUpgrade}>
                  👑 อัพเกรด Premium
                </button>
              </div>
            )}
          </div>
        )}
        {ocrNotice && <div className="dh-form-note dh-ocr-notice">🤖 {ocrNotice}</div>}

        {/* ── Toggle ซื้อ/ขาย ─────────────────────────────────────────────────
            role="tablist" + aria-selected เพื่อให้ Screen Reader รู้ว่าเป็นการสลับ
            "โหมดของฟอร์มเดียวกัน" ไม่ใช่ปุ่มสั่งงาน 2 ปุ่มที่กดแล้วบันทึกทันที */}
        <div
          className={`dh-side-toggle${ocrSideUnresolved ? ' dh-side-toggle-attention' : ''}`}
          role="tablist"
          aria-label="เลือกประเภทรายการ"
        >
          <button
            type="button"
            role="tab"
            aria-selected={!isSell}
            className={`dh-side-tab${!isSell ? ' dh-side-tab-buy-on' : ''}`}
            onClick={() => handleSwitchSide('buy')}
          >
            🟢 ซื้อ (DCA)
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSell}
            className={`dh-side-tab${isSell ? ' dh-side-tab-sell-on' : ''}`}
            onClick={() => handleSwitchSide('sell')}
          >
            🔴 ขาย
          </button>
        </div>

        <div className="dh-frow">
          <div>
            <label className="dh-fl" htmlFor="dh-f-date">
              {isSell ? 'วันที่ขาย' : 'วันที่ลงทุน'}
            </label>
            <input
              className="dh-inp"
              type="date"
              id="dh-f-date"
              value={date}
              max={today}
              style={sellFieldError === 'date' ? { borderColor: 'var(--red)' } : undefined}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="dh-fl">
              สินทรัพย์{' '}
              <span className="dh-fl-opt">
                {isSell ? '— เฉพาะที่คุณถืออยู่' : '— เลื่อนดูหรือพิมพ์ค้นหา'}
              </span>
            </label>
            {/* โหมดขายส่ง holdings (ที่ถืออยู่จริง) แทน symbols ทั้ง Registry —
                Reuse Component เดิม เพราะ Shape {symbol,name,type} ตรงกันอยู่แล้ว */}
            <AssetPicker
              symbols={isSell ? holdings : symbols}
              value={picked}
              onChange={handlePickAsset}
              disabled={sellEmpty}
              openSignal={isSell ? undefined : pickerOpenSignal}
            />
          </div>
        </div>

        {sellEmpty && (
          <div className="dh-form-note">
            ยังไม่มีสินทรัพย์ในพอร์ตให้ขาย — บันทึกการซื้อก่อน แล้วรายการจะมาแสดงตรงนี้เอง
          </div>
        )}

        {/* ══════════════ โหมดขาย ══════════════ */}
        {isSell && !sellEmpty && (
          <>
            {/* ยอดคงเหลือของตัวที่เลือก — ตัวเลขจาก Backend ตรงๆ (Ledger) ไม่ใช่ที่หน้านี้
                คำนวณ แสดงก่อนช่องกรอกเสมอเพื่อให้ผู้ใช้เห็นเพดานก่อนพิมพ์จำนวน */}
            {heldHolding && (
              <div className="dh-sell-held">
                <span className="dh-sell-held-lbl">ถืออยู่ตอนนี้</span>
                <b>
                  {formatUnits(heldHolding.units)} {heldHolding.symbol}
                </b>
                <span className="dh-tbadge dh-t-currency">{heldHolding.currency}</span>
              </div>
            )}

            <div className="dh-frow">
              <div>
                <label className="dh-fl" htmlFor="dh-f-sell-qty">
                  จำนวนหน่วยที่ขาย <span className="dh-fl-opt">(ไม่ใช่จำนวนเงิน)</span>
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-sell-qty"
                  inputMode="decimal"
                  placeholder={heldHolding ? formatUnits(heldHolding.units) : '0'}
                  value={sellQuantity}
                  style={sellFieldError === 'quantity' ? { borderColor: 'var(--red)' } : undefined}
                  onChange={(e) => {
                    setSellQuantity(e.target.value);
                    setSellFieldError(null);
                  }}
                />
              </div>
              <div>
                <label className="dh-fl" htmlFor="dh-f-sell-price">
                  ราคาที่ขายได้ / หน่วย{' '}
                  <span className="dh-fl-opt">({heldHolding?.currency ?? 'THB'})</span>
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-sell-price"
                  inputMode="decimal"
                  placeholder="เช่น 36.00"
                  value={sellPrice}
                  style={sellFieldError === 'price' ? { borderColor: 'var(--red)' } : undefined}
                  onChange={(e) => {
                    setSellPrice(e.target.value);
                    setSellFieldError(null);
                  }}
                />
              </div>
            </div>

            <div>
              <label className="dh-fl" htmlFor="dh-f-sell-note">
                รายละเอียด <span className="dh-fl-opt">(ไม่บังคับ)</span>
              </label>
              <input
                className="dh-inp"
                id="dh-f-sell-note"
                placeholder="เช่น ขายทำกำไรบางส่วน"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </div>

            <div className="dh-form-note">
              ระบบบันทึกการขายตามราคาที่คุณกรอกเท่านั้น ไม่มีการส่งคำสั่งขายจริงไปที่โบรกเกอร์ —
              หากต้องการขายยอดคงเหลือทั้งหมด กด "ขายทั้งหมด" แล้วระบบจะใช้ยอดคงเหลือจริงกับราคาตลาด
              ณ ตอนนั้นให้เอง (ไม่เหลือเศษค้างในพอร์ต)
            </div>
          </>
        )}

        {/* ══════════════ โหมดซื้อ (DCA) — ของเดิมทั้งหมด ══════════════ */}
        {!isSell && (
        <div className="dh-frow">
          <div>
            <label className="dh-fl" htmlFor="dh-f-amt">
              จำนวนเงินที่ลงทุน (DCA)
            </label>
            <div className="dh-amt-wrap">
              <input
                className="dh-inp"
                id="dh-f-amt"
                inputMode="decimal"
                placeholder="0.00"
                value={amountInput}
                style={amountFieldError ? { borderColor: 'var(--red)' } : undefined}
                onChange={(e) => handleAmountInput(e.target.value)}
              />
              {supportsUsd ? (
                <div className="dh-cur-toggle">
                  <button
                    type="button"
                    className={currency === 'THB' ? 'dh-cur-on' : ''}
                    onClick={() => {
                      setCurrency('THB');
                      setSelectedChip(null);
                    }}
                  >
                    THB
                  </button>
                  <button
                    type="button"
                    className={currency === 'USD' ? 'dh-cur-on' : ''}
                    onClick={() => {
                      setCurrency('USD');
                      setSelectedChip(null);
                    }}
                  >
                    USD
                  </button>
                </div>
              ) : (
                <span className="dh-cur">THB</span>
              )}
            </div>
            {/* Chips ลัด (500/1,000/3,000/5,000/10,000) ออกแบบมาสำหรับหน่วยบาทเท่านั้น
                — ซ่อนตอนสลับเป็น USD กัน User กด "10,000" เข้าใจว่าลัดยอดบาท แต่กลาย
                เป็น 10,000 USD (≈3.5 ล้านบาท) จริงๆ ตอน Submit (Review รอบนี้ — ไม่มี
                Design ของชุด Chips สำหรับ USD ใน Mockup จึงซ่อนแทนการเดาเลขชุดใหม่) */}
            {currency === 'THB' && (
              <div className="dh-chips">
                {AMOUNT_CHIPS.map((amt) => (
                  <button
                    key={amt}
                    type="button"
                    className={`dh-chip${selectedChip === amt ? ' dh-chip-on' : ''}`}
                    onClick={() => handleChipClick(amt)}
                  >
                    {amt.toLocaleString('th-TH')}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            {showPriceField ? (
              <>
                <label className="dh-fl" htmlFor="dh-f-price">
                  ราคา/หน่วย{' '}
                  <span className="dh-fl-opt">
                    {priceRequired ? '(หุ้นไทยยังไม่มีราคาสดในระบบ)' : '(ไม่บังคับ)'}
                  </span>
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-price"
                  inputMode="decimal"
                  placeholder={priceRequired ? 'เช่น 34.00' : 'เว้นว่าง = ใช้ราคาตลาด'}
                  value={pricePerUnit}
                  onChange={(e) => setPricePerUnit(e.target.value)}
                />
              </>
            ) : (
              <>
                <label className="dh-fl" htmlFor="dh-f-note">
                  รายละเอียด <span className="dh-fl-opt">(ไม่บังคับ)</span>
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-note"
                  placeholder="เช่น DCA ประจำเดือน ก.ค."
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                />
              </>
            )}
            {/* ⚠️ ข้อความนี้เคยขัดแย้งกับกล่องเขียว "ใช้ราคาจากสลิป ไม่ใช่ราคาตลาดวันนี้"
                ที่อยู่ห่างกันไม่ถึงนิ้วบนหน้าจอ (ผู้ใช้ไม่รู้ว่าตกลงระบบใช้อะไร) —
                ตอนนี้เลือกข้อความตามสถานะจริงของฟอร์ม ไม่พูดสิ่งที่ไม่ตรงกับที่ทำ */}
            <div className="dh-form-note" style={{ marginTop: 9 }}>
              {!picked
                ? ''
                : slipNumbersActive
                  ? '' /* กล่องเขียวด้านล่างอธิบายครบแล้ว — ไม่พูดเรื่องราคาตลาดซ้ำให้ขัดกันเอง */
                  : priceRequired
                    ? 'หุ้นไทยยังไม่มีราคาสดในระบบ กรุณากรอกราคาที่ซื้อได้จริง'
                    : pricePerUnit.trim() !== ''
                      ? 'จะบันทึกด้วยราคาที่คุณกรอก — ไม่ดึงราคาตลาด'
                      : 'เว้นว่างไว้ = ระบบดึงราคาตลาด ณ เวลาบันทึกให้อัตโนมัติ · กรอกเองได้ถ้ารู้ราคาที่ซื้อจริง'}
            </div>
          </div>
        </div>
        )}

        {/* ── ตัวเลขจากสลิปที่จะถูกบันทึกจริง (โหมดซื้อ) ────────────────────────
            โผล่เฉพาะตอนที่ AI อ่านสลิปแล้วได้ "จำนวนหน่วย + ราคา" ครบทั้งคู่
            ⚠️ ต้องแสดงให้เห็นและแก้ได้ ไม่ใช่ค่าซ่อนที่ไหลลง Ledger เงียบๆ —
            เมื่อมีบล็อกนี้ ระบบจะบันทึกตามตัวเลขนี้ ไม่ใช่ช่อง "จำนวนเงิน" ด้านบน
            (ยอดเงินกลายเป็นผลคูณของสองช่องนี้แทน) */}
        {!isSell && slipQuantityInput !== '' && slipPriceInput !== '' && (
          <div className="dh-slip-numbers">
            <p className="dh-slip-numbers-title">
              🧾 ตัวเลขจากสลิป — ระบบจะบันทึกตามนี้
            </p>
            <div className="dh-frow">
              <div>
                <label className="dh-fl" htmlFor="dh-f-slip-qty">
                  จำนวนหน่วยที่ได้จริง
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-slip-qty"
                  inputMode="decimal"
                  value={slipQuantityInput}
                  onChange={(e) => setSlipQuantityInput(e.target.value)}
                />
              </div>
              <div>
                <label className="dh-fl" htmlFor="dh-f-slip-price">
                  ราคาต่อหน่วยที่ได้จริง ({currency})
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-slip-price"
                  inputMode="decimal"
                  value={slipPriceInput}
                  onChange={(e) => setSlipPriceInput(e.target.value)}
                />
              </div>
            </div>
            {/* ── ค่าธรรมเนียม: แก้เองได้เผื่อ AI อ่านผิด/สลิปไม่ระบุ ────────────── */}
            <div>
              <label className="dh-fl" htmlFor="dh-f-slip-fee">
                ค่าธรรมเนียม ({currency}) <span className="dh-fl-opt">(ไม่บังคับ)</span>
              </label>
              <input
                className="dh-inp"
                id="dh-f-slip-fee"
                inputMode="decimal"
                placeholder="เว้นว่าง = ไม่ทราบ"
                value={slipFeeInput}
                onChange={(e) => setSlipFeeInput(e.target.value)}
              />
            </div>

            {/* ── สรุปยอดแบบแยกบรรทัดให้บวกกันเห็นชัด ──────────────────────────
                ⚠️ สำคัญ: ผู้ใช้จำ "ยอดที่จ่ายจริง" (1,500) แต่ระบบบันทึก "มูลค่าหุ้น"
                (1,497.60) ถ้าโชว์เลขเดียวโดดๆ จะเข้าใจผิดว่าระบบอ่านสลิปผิด
                (Founder เองยังเข้าใจผิดตอนทดสอบ) — ต้องเห็นว่าบวกกันแล้วได้ยอดที่จ่าย */}
            {(() => {
              const q = parseAmount(slipQuantityInput);
              const p = parseAmount(slipPriceInput);
              const computedGross = q > 0 && p > 0 ? Math.round(q * p * 100) / 100 : null;
              const fee = slipFeeInput.trim() === '' ? null : parseAmount(slipFeeInput);
              const fmt = (n) => n.toLocaleString('th-TH', { maximumFractionDigits: 8 });

              if (computedGross === null) {
                return <p className="dh-form-note dh-slip-numbers-total">กรอกจำนวนหน่วยและราคาให้ครบเพื่อดูยอดรวม</p>;
              }

              // ── มูลค่าหุ้น: ใช้เลขที่สลิประบุเมื่อพิสูจน์แล้ว (บั๊ค B) ────────────
              // เงื่อนไข: Backend ยืนยันว่าเป็นเลขบนสลิปจริง (slipGrossAmount ไม่ null)
              // "และ" ผู้ใช้ยังไม่ได้แก้ช่องจำนวน/ราคา — ถ้าแก้แล้ว ยอดของสลิปใบนั้น
              // ไม่ใช่ยอดของตัวเลขคู่ใหม่อีกต่อไป ต้องกลับไปคำนวณเองทันที
              const grossFromSlip = slipGrossUntouched !== null;
              const gross = grossFromSlip ? slipGrossUntouched : computedGross;

              // ── ยอดรวม: ห้ามอ้างว่าเป็น "ยอดที่จ่ายจริง" ถ้าสลิปไม่ได้ระบุไว้ ──────
              // ⚠️ บั๊ค B (เคสจริง EOSE): เดิมบรรทัดนี้เขียน "รวมจ่ายจริง 106.59" ทั้งที่
              // ผู้ใช้จ่ายจริง 106.72 ตามสลิป — เพราะเมื่อ AI อ่านยอดสุทธิไม่ได้ ระบบบวก
              // "มูลค่าหุ้น + ค่าธรรมเนียม" เองแล้วแปะป้ายว่าเป็นยอดจริง = ผิดข้อเท็จจริง
              // มติ Founder: แสดงเลขผิดโดยไม่บอกว่าไม่แน่ใจ แย่กว่าไม่แสดงเลย
              const netFromSlip = slipNetAmount !== null;
              const totalPaid = netFromSlip
                ? slipNetAmount
                : fee !== null
                  ? Math.round((gross + fee) * 100) / 100
                  : null;

              return (
                <div className="dh-slip-breakdown">
                  <div className="dh-slip-brk-row">
                    <span>มูลค่าหุ้น (บันทึกเป็นต้นทุน)</span>
                    <b>{fmt(gross)} {currency}</b>
                  </div>
                  {fee !== null && fee > 0 && (
                    <div className="dh-slip-brk-row">
                      <span>ค่าธรรมเนียม</span>
                      <b>{fmt(fee)} {currency}</b>
                    </div>
                  )}
                  {totalPaid !== null && (
                    <div className="dh-slip-brk-row dh-slip-brk-total">
                      <span>{netFromSlip ? `รวม${isSell ? 'รับจริง' : 'จ่ายจริง'}` : 'รวมโดยประมาณ'}</span>
                      <b>{fmt(totalPaid)} {currency}</b>
                    </div>
                  )}
                  <p className="dh-form-note" style={{ margin: '6px 0 0' }}>
                    {totalPaid !== null && !netFromSlip
                      ? `ยอดรวมนี้ระบบคำนวณเอง (มูลค่าหุ้น + ค่าธรรมเนียม) เพราะอ่านยอดสุทธิจากสลิปไม่ได้ — อาจต่างจากยอดที่${isSell ? 'รับ' : 'จ่าย'}จริงเล็กน้อย กรุณาเทียบกับสลิป`
                      : fee !== null && fee > 0
                        ? `ระบบบันทึก "มูลค่าหุ้น" เป็นต้นทุน — ต่างจากยอดที่${isSell ? 'รับ' : 'จ่าย'}เพราะค่าธรรมเนียม ไม่ใช่ระบบอ่านผิด`
                        : 'ใช้ราคาจากสลิป ไม่ใช่ราคาตลาดวันนี้ (ล้างช่องจำนวนหน่วยหรือราคาเพื่อกลับไปใช้จำนวนเงินด้านบน)'}
                  </p>
                  {grossFromSlip && (
                    <p className="dh-form-note" style={{ margin: '4px 0 0' }}>
                      * มูลค่าหุ้นใช้ตัวเลขที่สลิประบุไว้ตรงๆ (ไม่ใช่ จำนวน × ราคา ซึ่งได้{' '}
                      {fmt(computedGross)} {currency} เพราะราคาต่อหน่วยบนสลิปถูกปัดเศษมาแสดง)
                    </p>
                  )}
                </div>
              );
            })()}
          </div>
        )}

        {/* ช่องรายละเอียดต้องมีที่กรอกได้เสมอ — เมื่อคอลัมน์ขวาถูกใช้แสดงช่องราคา
            (ตอนนี้คือทุกกรณีในโหมดซื้อ ยกเว้นตอนใช้ตัวเลขจากสลิป) ให้ย้ายมาแถวถัดไป */}
        {showPriceField && (
          <div>
            <label className="dh-fl" htmlFor="dh-f-note-2">
              รายละเอียด <span className="dh-fl-opt">(ไม่บังคับ)</span>
            </label>
            <input
              className="dh-inp"
              id="dh-f-note-2"
              placeholder="เช่น DCA ประจำเดือน ก.ค."
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>
        )}

        {/* ── แนบสลิปซื้อหุ้นเป็นหลักฐาน (Premium เท่านั้น — เก็บรูปเฉยๆ ไม่มี AI อ่าน) ──
            โหมดขายยังไม่เปิดให้แนบสลิปในรอบนี้: Endpoint POST /transactions/:id/slip
            รองรับได้ทางเทคนิคอยู่แล้ว แต่จงใจไม่เพิ่มพร้อมกันเพื่อไม่ให้รอบนี้ขยายเกิน
            "เปิดปุ่มขาย" (ผู้ใช้ที่ต้องการแนบหลักฐานการขายยังทำผ่าน LINE ได้เหมือนเดิม) */}
        {!isSell && (
        <div className="dh-slip-field">
          <label className="dh-fl">
            แนบสลิปซื้อหุ้นเป็นหลักฐาน <span className="dh-fl-opt">(ไม่บังคับ)</span>
          </label>

          {isPremiumActive ? (
            slipPreviewUrl ? (
              <div className="dh-slip-preview">
                <img src={slipPreviewUrl} alt="ตัวอย่างรูปสลิปที่จะแนบ" className="dh-slip-thumb" />
                <div className="dh-slip-preview-info">
                  <span className="dh-slip-filename">{slipFile?.name}</span>
                  <button type="button" className="dh-btn-ghost dh-slip-clear" onClick={clearSlip}>
                    ลบรูป
                  </button>
                </div>
              </div>
            ) : (
              <label className="dh-slip-picker">
                <input
                  type="file"
                  accept={SLIP_ACCEPT_ATTR}
                  onChange={handleSlipChange}
                  style={{ display: 'none' }}
                />
                <span className="dh-slip-picker-btn">📎 เลือกรูปสลิป</span>
                <span className="dh-form-note">
                  JPG, PNG, WebP หรือ GIF · สูงสุด 10 MB — เก็บเป็นหลักฐานประกอบเท่านั้น
                  ไม่มีการอ่านตัวเลขจากรูป (ยังต้องกรอกจำนวนเงินเอง)
                </span>
              </label>
            )
          ) : (
            <div className="dh-slip-locked">
              <span className="dh-slip-lock-ic">🔒</span>
              <div className="dh-slip-lock-body">
                <p className="dh-slip-lock-title">แนบสลิปเป็นหลักฐานสำหรับสมาชิก Premium</p>
                <p className="dh-form-note">อัพเกรดเพื่อแนบรูปสลิปซื้อขายเก็บไว้ประกอบแต่ละรายการ</p>
              </div>
              {/* แสดงปุ่มเสมอ (P0-1) — handleUpgrade มี Default พาไป /premium อยู่แล้วถ้า
                  Parent ไม่ส่ง onUpgrade จึงไม่มีทางเป็นปุ่มตาย */}
              <button type="button" className="dh-btn-ghost dh-slip-upgrade" onClick={handleUpgrade}>
                👑 อัพเกรด
              </button>
            </div>
          )}

          {slipNotice && <div className="dh-form-note dh-slip-notice">{slipNotice}</div>}
        </div>
        )}

        {formError && <div className="dh-form-error">{formError}</div>}

        {isSell ? (
          <div className="dh-sell-actions">
            <button
              className="dh-btn-main dh-btn-sell"
              type="submit"
              disabled={submitting || sellEmpty}
            >
              {submitting ? 'กำลังบันทึก...' : 'บันทึกการขาย'}
            </button>
            {/* type="button" — ไม่ผ่าน onSubmit ของฟอร์ม เพราะเส้นทางนี้ "ไม่อ่าน"
                ช่องจำนวน/ราคาที่กรอกไว้เลย (ส่ง sellAll:true ให้ Backend หาเอง) */}
            <button
              type="button"
              className="dh-btn-ghost dh-btn-sell-all"
              disabled={submitting || sellEmpty || !heldHolding}
              onClick={() => submitSell(true)}
            >
              ขายทั้งหมด
            </button>
          </div>
        ) : (
          <button className="dh-btn-main" type="submit" disabled={submitting}>
            {submitting ? 'กำลังบันทึก...' : 'บันทึก DCA'}
          </button>
        )}
        <div className="dh-form-note">
          * EasyDCA by JaydeX เป็นผู้ช่วยบันทึกและติดตามพอร์ต ไม่ใช่โบรกเกอร์ ไม่มีการส่งคำสั่งซื้อขายจริง
          และไม่แนะนำการซื้อขายหลักทรัพย์รายตัว
        </div>
      </form>

      {/* S8 R3 รอบ 3 (Code Review): เดิมมี Panel Static "วันนี้ถึงรอบ DCA ของคุณ" ค้าง
          อยู่ตรงนี้ ซ้ำซ้อนกับ Panel จริงใน SidePanels.jsx (CalendarPlaceholder) ที่ใช้
          overview.todayDuePlans จริงแล้ว — ข้อความ 2 จุดไม่ตรงกัน (จุดนี้ Static เสมอ)
          จึงลบออก ให้ SidePanels (Rail ขวา) เป็นจุดเดียวที่บอกสถานะแผนวันนี้ */}
      <div className="dh-dca-side">
        {confirmed && (
          <div className="dh-confirm-box dh-confirm-box-show">
            {/* confirmed.side มาจาก Response ของ Backend (ทิศทางที่ "บันทึกจริง")
                ไม่ใช่ State ของ Toggle ในหน้านี้ — ถ้าอ่านจาก Toggle แล้วผู้ใช้สลับโหมด
                หลังบันทึกสำเร็จ การ์ดจะเปลี่ยนคำโดยที่รายการจริงไม่ได้เปลี่ยนตาม */}
            <div className="dh-confirm-ok">
              {confirmed.side === 'sell' ? '✅ บันทึกการขายสำเร็จ' : '✅ บันทึกสำเร็จ'}
              <span className="dh-tbadge dh-t-currency" style={{ marginLeft: 'auto' }}>
                {confirmed.currency}
              </span>
            </div>
            <table>
              <tbody>
                <tr>
                  <td>สินทรัพย์</td>
                  <td>{confirmed.symbol}</td>
                </tr>
                <tr>
                  <td>{confirmed.side === 'sell' ? 'เงินที่ได้รับ' : 'จำนวนเงิน'}</td>
                  <td>
                    {confirmed.amountTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}{' '}
                    {confirmed.currency}
                  </td>
                </tr>
                <tr>
                  <td>{confirmed.side === 'sell' ? 'จำนวนหน่วยที่ขาย' : 'จำนวนหน่วย'}</td>
                  <td>{confirmed.units.toLocaleString('th-TH', { maximumFractionDigits: 8 })}</td>
                </tr>
                <tr>
                  <td>ราคา/หน่วย</td>
                  <td>
                    {confirmed.priceSource === 'user'
                      ? 'กรอกเอง'
                      : `ดึงราคาตลาดอัตโนมัติ (${confirmed.pricePerUnit.toLocaleString('th-TH', {
                          maximumFractionDigits: 8,
                        })})`}
                  </td>
                </tr>
                {/* ยอดคงเหลือหลังขาย — Backend คำนวณให้ (processSellCommand
                    .remainingQuantity) ไม่ใช่ยอดเดิมลบเองในหน้านี้ */}
                {confirmed.side === 'sell' && confirmed.remainingQuantity !== undefined && (
                  <tr>
                    <td>คงเหลือหลังขาย</td>
                    <td>{formatUnits(confirmed.remainingQuantity)}</td>
                  </tr>
                )}
                <tr>
                  <td>วันที่</td>
                  <td>{confirmed.date}</td>
                </tr>
                {confirmed.note && (
                  <tr>
                    <td>รายละเอียด</td>
                    <td>{confirmed.note}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <div className="dh-confirm-acts">
              <button
                type="button"
                className="dh-btn-ghost"
                onClick={() => setConfirmed(null)}
              >
                ✏️ ปิด
              </button>
              <button
                type="button"
                className="dh-btn-ghost dh-btn-ghost-danger"
                onClick={() =>
                  onRequestUndo({
                    // ทิศทางจริงจาก Backend — Modal ยืนยันแสดง "ซื้อ/ขาย" ตามนี้
                    type: confirmed.side === 'sell' ? 'sell' : 'buy',
                    symbol: confirmed.symbol,
                    units: confirmed.units,
                    pricePerUnit: confirmed.pricePerUnit,
                    amountTotal: confirmed.amountTotal,
                    currency: confirmed.currency,
                  })
                }
              >
                {/* fix/misleading-messages ข้อ 2/4: รายการนี้บันทึกลง Ledger ไปแล้ว
                    จริง (ปุ่มนี้เปิด UndoConfirmModal ที่ใช้คำว่า "ย้อน") — Label ต้อง
                    สอดคล้องกัน ไม่งั้นหน้าจอขัดกันเอง */}
                ↩︎ ย้อนรายการนี้
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// Export แยกไว้ให้ Test เรนเดอร์ scanning=true/false ตรงๆ ได้ (ดู Comment ที่จุด
// ประกาศ Component ด้านบน) — ไม่กระทบ Default Export ของ DcaForm เอง
export { ScanningMascot };
export default DcaForm;
