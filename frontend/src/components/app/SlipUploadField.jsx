import { useRef } from 'react';

// ═══════════════════════════════════════════════════════════════════════════
// SlipUploadField — ปุ่ม "แนบสลิปให้ AI อ่าน" + สถานะระหว่างอ่าน (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// ส่วนแสดงผลล้วน — **ไม่ยิง API เอง ไม่ตัดสินอะไรเอง** ทุกอย่างมาจาก Props
// (การเรียก § 15.8 และการตัดสินว่าจะ Prefill อะไร อยู่ที่ RecordTransactionModal
// + recordTransactionLogic.js ซึ่งทดสอบได้โดยไม่ต้อง Render)
//
// ⚠️ ใช้ได้เฉพาะคำสั่งซื้อ/ขาย — ปันผลไม่มี Endpoint อ่านสลิป (API.md § 15.8)
// Caller เป็นคนกันไม่ให้ Render ตอน type === 'dividend'

// ═══════════════════════════════════════════════════════════════════════════
// 📌 TODO (Founder): สลับ Spinner เป็น GIF ของจริงเมื่อไฟล์พร้อม
// ═══════════════════════════════════════════════════════════════════════════
// **แก้ที่ฟังก์ชันนี้จุดเดียวจบ** — ไม่มี Loading Indicator กระจายอยู่ที่อื่นเลย
// เปลี่ยนเนื้อในเป็น:
//     <img className="slip-scan__spinner" src="/assets/slip-loading.gif" alt="" />
// โดยคง `className="slip-scan__indicator"` ของตัวห่อไว้ (CSS ผูกกับชื่อนี้)
//
// ⚠️ ถ้า GIF โหลดไม่ขึ้น (เน็ตช้า/ไฟล์หาย) ต้องยังเห็นข้อความ "กำลังอ่านสลิป…"
// อยู่ดี — บทเรียนจาก DcaForm ที่ต้องเพิ่ม state `ocrMascotFailed` ทีหลังเพราะ
// ไอคอนรูปแตกค้างบนหน้าจอ (จึงควรใส่ onError ให้ซ่อนเฉพาะ <img> ไม่ใช่ทั้งบล็อก)
function ScanIndicator() {
  return (
    <span className="slip-scan__indicator" aria-hidden="true">
      <span className="slip-scan__spinner" />
    </span>
  );
}

function SlipUploadField({
  scanning,
  error,
  showUpgrade,
  notice,
  warning,
  fileName,
  disabled,
  onPick,
  onUpgrade,
}) {
  const inputRef = useRef(null);

  return (
    <div className="demo-field slip-scan">
      <span>แนบสลิปให้ AI อ่าน</span>

      {/* ⚠️ ปุ่มนี้แยกจากปุ่ม "บันทึก" โดยสิ้นเชิง — คนละ Action คนละสถานะโหลด
          การอ่านสลิป **ไม่สร้างธุรกรรมใดๆ** (API.md § 15.8) แค่เติมค่าลงฟอร์ม */}
      <div className="slip-scan__row">
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          className="slip-scan__input"
          disabled={disabled || scanning}
          onChange={(e) => {
            const file = e.target.files?.[0];
            // เคลียร์ค่าใน input ทันทีเพื่อให้เลือก "ไฟล์เดิมซ้ำ" ได้อีก
            // (เบราว์เซอร์ไม่ยิง change ถ้าค่าเดิมไม่เปลี่ยน — ผู้ใช้ที่อ่านพลาด
            // แล้วอยากลองใหม่ด้วยรูปเดิมจะกดไม่ติด)
            e.target.value = '';
            if (file) onPick(file);
          }}
        />

        <button
          type="button"
          className="demo-btn"
          disabled={disabled || scanning}
          onClick={() => inputRef.current?.click()}
        >
          {scanning ? 'กำลังอ่านสลิป…' : '📄 เลือกรูปสลิป'}
        </button>

        {scanning && (
          <span className="slip-scan__status" role="status">
            <ScanIndicator />
            กำลังให้ AI อ่านสลิป…
          </span>
        )}

        {!scanning && fileName && <small className="app-note">{fileName}</small>}
      </div>

      <small className="app-note">
        ระบบจะอ่านค่าจากรูปมาเติมในฟอร์มให้ — <strong>ตรวจและแก้ไขได้ทุกช่อง</strong>{' '}
        ก่อนกดบันทึก (การอ่านสลิปไม่บันทึกรายการให้อัตโนมัติ)
      </small>

      {/* ⚠️ คำเตือนของคำสั่งที่ "ยังไม่เกิดขึ้นจริง" — ต้องเด่นกว่า notice ทั่วไป
          และต้องไม่ปิดปุ่มบันทึก (Backend เป็นด่านสุดท้าย · ผู้ใช้อาจรู้ว่าคำสั่ง
          จับคู่แล้วทีหลังและต้องการกรอกเอง) */}
      {warning && (
        <p className="app-state app-state--warn" role="alert">
          {warning}
        </p>
      )}

      {error && (
        <p className="app-state app-state--error" role="alert">
          {error}
          {showUpgrade && (
            <>
              {' '}
              <button type="button" className="demo-btn" onClick={onUpgrade}>
                ดูแพ็กเกจ Premium
              </button>
            </>
          )}
        </p>
      )}

      {notice && <small className="app-note">{notice}</small>}
    </div>
  );
}

export default SlipUploadField;
