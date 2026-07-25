import { useEffect, useRef, useState } from 'react';
import AssetPicker from './AssetPicker.jsx';
import { apiPost, apiUpload } from '../../lib/api.js';
import { transactionErrorMessage, slipUploadErrorMessage } from '../../lib/dcaErrors.js';
import { todayBangkokIso } from '../../lib/dateBangkok.js';
import { resolvePrefillState } from '../../lib/dcaPlanPrefill.js';

const AMOUNT_CHIPS = [500, 1000, 3000, 5000, 10000];

// แนบสลิปหลักฐาน (Premium) — ชนิด/ขนาดที่รับ ตรงกับ storage.service ฝั่ง Backend
// (ALLOWED_SLIP_CONTENT_TYPES + MAX_SLIP_SIZE_BYTES) — Frontend เช็คก่อนเพื่อ UX ที่ดี
// (เตือนทันทีไม่ต้องรอ Round-trip) แต่ "Backend คือด่านตัดสินจริง" ไม่ใช่ชั้นนี้
const SLIP_ACCEPT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const SLIP_ACCEPT_ATTR = SLIP_ACCEPT_TYPES.join(',');
const SLIP_MAX_BYTES = 10 * 1024 * 1024;
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

// DcaForm — กล่อง "บันทึก DCA" (งานที่ 2, หัวใจของรอบนี้)
//
// props:
//   symbols: รายการสินทรัพย์จาก GET /api/v1/assets/symbols
//   pickerOpenSignal: Counter ที่ Parent เพิ่มค่าเพื่อสั่งเปิด AssetPicker อัตโนมัติ
//     (ปุ่มบันทึกกลาง Bottom Nav บนมือถือ — งานที่ 1)
//   onRecorded(response): เรียกหลังบันทึกสำเร็จ (ให้ Parent Refetch overview)
//   onRequestUndo(txSummary): เรียกเมื่อกด "ยกเลิกรายการนี้" บนการ์ดยืนยัน (เปิด
//     Confirm Modal ที่ Parent เป็นคนคุม เพื่อใช้ Modal เดียวกับปุ่ม Undo บน
//     รายการล่าสุด — ไม่ทำ Modal ซ้ำสองที่)
//   prefillSignal (S8 R3 รอบ 3): { symbol, amountTotal, currency, nonce } | null —
//     Parent ตั้งค่าใหม่ (Object ใหม่ทุกครั้ง) เมื่อกด "บันทึกเลย" บนการ์ดแผนที่ถึง
//     รอบวันนี้ (SidePanels) เพื่อ Prefill ฟอร์มนี้ให้เอง
function DcaForm({
  symbols,
  pickerOpenSignal,
  onRecorded,
  onRequestUndo,
  prefillSignal = null,
  // แนบสลิปหลักฐาน (Premium) — isPremiumActive มาจาก planInfo ของ DashboardHome
  // (GET /dashboard/me) / onUpgrade พาไป /premium ทั้งคู่เป็น Presentation Gate เฉยๆ
  // Backend ยัง Gate ซ้ำเองที่ POST /transactions/:id/slip (Security Boundary จริง)
  isPremiumActive = false,
  onUpgrade,
}) {
  const [date, setDate] = useState(todayBangkokIso());
  const [picked, setPicked] = useState(null);
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
  const needsManualPrice = picked?.type === 'stock_th';
  const supportsUsd = picked ? USD_TOGGLE_TYPES.includes(picked.type) : false;

  // Prefill จากปุ่ม "บันทึกเลย" (SidePanels) — ไม่ Prefill pricePerUnit เด็ดขาดแม้
  // เป็นหุ้นไทย (needsManualPrice) ต้องให้ผู้ใช้กรอกราคาเองเสมอ ไม่เดาราคาให้
  useEffect(() => {
    const resolved = resolvePrefillState(prefillSignal, symbols);
    if (!resolved) return;
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
    if (!USD_TOGGLE_TYPES.includes(item.type)) {
      setCurrency('THB');
    }
    setFormError(null);
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
    setNote('');
    setDate(todayBangkokIso());
    clearSlip();
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setFormError(null);
    setConfirmed(null);

    if (!picked) {
      setFormError('กรุณาเลือกสินทรัพย์ก่อนบันทึก');
      return;
    }

    const amountTotal = parseAmount(amountInput);
    if (amountTotal === null || amountTotal <= 0) {
      setAmountFieldError(true);
      setFormError('กรุณากรอกจำนวนเงินที่ถูกต้อง (มากกว่า 0)');
      return;
    }

    if (date > today) {
      setFormError('บันทึกรายการล่วงหน้าไม่ได้ กรุณาเลือกวันที่ไม่เกินวันนี้');
      return;
    }

    let priceValue = null;
    if (needsManualPrice) {
      priceValue = parseAmount(pricePerUnit);
      if (priceValue === null || priceValue <= 0) {
        setFormError('หุ้นไทยยังไม่มีราคาตลาดอัตโนมัติ กรุณากรอก "ราคาต่อหน่วย" ที่ซื้อด้วย');
        return;
      }
    }

    const payload = {
      symbol: picked.symbol,
      amountTotal,
      currency,
      date,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(needsManualPrice ? { pricePerUnit: priceValue } : {}),
    };

    setSubmitting(true);
    setSlipNotice(null);
    try {
      const response = await apiPost('/api/v1/transactions', payload);

      // แนบสลิปหลักฐาน (ถ้าเลือกไว้ — Premium เท่านั้น) เป็นขั้นแยกหลังธุรกรรมถูกสร้าง
      // แล้ว (Endpoint รับ transaction id) — Best-effort: ธุรกรรม "บันทึกสำเร็จแล้วจริง"
      // ต่อให้แนบรูปพลาด ต้องไม่ทำให้ผู้ใช้เข้าใจว่าบันทึก DCA ไม่สำเร็จ → ไม่ throw
      // แค่แสดง Warning แยก (รายการยังอยู่ครบ แค่ไม่มีรูปแนบ) Backend Gate Premium ซ้ำเอง
      let slipWarning = null;
      if (slipFile && isPremiumActive) {
        try {
          await apiUpload(`/api/v1/transactions/${response.transaction.id}/slip`, slipFile);
        } catch (err) {
          slipWarning = `บันทึก DCA สำเร็จ แต่แนบรูปสลิปไม่สำเร็จ (${slipUploadErrorMessage(err.message)})`;
        }
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

  return (
    <div className={`dh-dca-grid${confirmed ? '' : ' dh-dca-grid-full'}`}>
      <form className="dh-dca-form" autoComplete="off" onSubmit={handleSubmit}>
        <div className="dh-frow">
          <div>
            <label className="dh-fl" htmlFor="dh-f-date">
              วันที่ลงทุน
            </label>
            <input
              className="dh-inp"
              type="date"
              id="dh-f-date"
              value={date}
              max={today}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          <div>
            <label className="dh-fl">
              สินทรัพย์ <span className="dh-fl-opt">— เลื่อนดูหรือพิมพ์ค้นหา</span>
            </label>
            <AssetPicker
              symbols={symbols}
              value={picked}
              onChange={handlePickAsset}
              openSignal={pickerOpenSignal}
            />
          </div>
        </div>

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
            {needsManualPrice ? (
              <>
                <label className="dh-fl" htmlFor="dh-f-price">
                  ราคา/หน่วย <span className="dh-fl-opt">(หุ้นไทยยังไม่มีราคาสดในระบบ)</span>
                </label>
                <input
                  className="dh-inp"
                  id="dh-f-price"
                  inputMode="decimal"
                  placeholder="เช่น 34.00"
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
            <div className="dh-form-note" style={{ marginTop: 9 }}>
              {picked && !needsManualPrice
                ? 'ระบบดึงราคาตลาด ณ เวลาบันทึกให้อัตโนมัติ แล้วคำนวณจำนวนหน่วยให้เอง — ไม่ต้องกรอกราคาเอง'
                : ''}
            </div>
          </div>
        </div>

        {/* ช่องรายละเอียดยังต้องมีที่กรอกได้เสมอแม้เป็นหุ้นไทย (ราคา/หน่วยแทนที่ตำแหน่ง
            รายละเอียดในคอลัมน์ขวา) — ย้ายรายละเอียดมาไว้แถวถัดไปเมื่อเป็นหุ้นไทย */}
        {needsManualPrice && (
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

        {/* ── แนบสลิปซื้อหุ้นเป็นหลักฐาน (Premium เท่านั้น — เก็บรูปเฉยๆ ไม่มี AI อ่าน) ── */}
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
              {onUpgrade && (
                <button type="button" className="dh-btn-ghost dh-slip-upgrade" onClick={onUpgrade}>
                  👑 อัพเกรด
                </button>
              )}
            </div>
          )}

          {slipNotice && <div className="dh-form-note dh-slip-notice">{slipNotice}</div>}
        </div>

        {formError && <div className="dh-form-error">{formError}</div>}

        <button className="dh-btn-main" type="submit" disabled={submitting}>
          {submitting ? 'กำลังบันทึก...' : 'บันทึก DCA'}
        </button>
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
            <div className="dh-confirm-ok">
              ✅ บันทึกสำเร็จ
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
                  <td>จำนวนเงิน</td>
                  <td>
                    {confirmed.amountTotal.toLocaleString('th-TH', { minimumFractionDigits: 2 })}{' '}
                    {confirmed.currency}
                  </td>
                </tr>
                <tr>
                  <td>จำนวนหน่วย</td>
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
                    type: 'buy',
                    symbol: confirmed.symbol,
                    units: confirmed.units,
                    pricePerUnit: confirmed.pricePerUnit,
                    amountTotal: confirmed.amountTotal,
                    currency: confirmed.currency,
                  })
                }
              >
                ↩︎ ยกเลิกรายการนี้
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default DcaForm;
