import { useState } from 'react';
import { Link } from 'react-router-dom';
import { apiDownload } from '../../lib/api.js';

// ═══════════════════════════════════════════════════════════════════════════
// ExportReportPanel — ปุ่ม Export รายงาน PDF/Excel บนหน้า /app/profile (พรอมต์ ก.ย. 2569)
// ═══════════════════════════════════════════════════════════════════════════
// ⭐ ใช้ GET /api/v1/reports/export ที่มีอยู่แล้ว (Round 8 — สร้างจริงผ่าน LINE
// Bot มานาน) ไม่สร้าง Endpoint ใหม่ · Logic Validate ช่วงเวลา + Trigger Download
// เป็น Pattern เดียวกับ `components/dashboard/PortfolioDetailSection.jsx`
// (confirmExport) ที่ Production-verified อยู่แล้ว — ต่างแค่ UI ให้เข้ากับธีม
// /app/* (demo-*/app-* class แทน dh-*) และตัด Preview 2 ขั้นออก (ไม่ได้ระบุใน
// Scope พรอมต์นี้)
//
// ⚠️ isPremiumActive มาจาก entitlements ที่ AppShell โหลดไว้แล้ว (Prop) — รู้
// สถานะ Premium ล่วงหน้าไม่ต้องรอ Backend ตอบ 403 ก่อนค่อยรู้ (แต่ยัง Handle
// EXPORT_PREMIUM_REQUIRED ไว้เผื่อ Race Condition: เปิดฟอร์มค้างไว้จน Premium
// หมดอายุระหว่างนั้น)

const RANGE_OPTIONS = [
  { value: 'month', label: 'เดือนนี้' },
  { value: 'year', label: 'ปีนี้' },
  { value: 'custom', label: 'กำหนดเอง' },
];

function ExportReportPanel({ isPremiumActive }) {
  const [format, setFormat] = useState('pdf');
  const [range, setRange] = useState('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [showUpgrade, setShowUpgrade] = useState(false);

  async function handleExport() {
    setError(null);
    setShowUpgrade(false);

    // ⚠️ Validate ฝั่ง Frontend ก่อนเสมอ — ไม่ต้องรอ Backend ตอบ
    // EXPORT_INVALID_RANGE (input type="date" ให้รูปแบบ YYYY-MM-DD มาแล้ว
    // จึงเช็คแค่ "กรอกครบ" กับ "from <= to")
    if (range === 'custom') {
      if (!from || !to) {
        setError('กรุณาเลือกวันเริ่มต้นและวันสิ้นสุด');
        return;
      }
      if (from > to) {
        setError('วันเริ่มต้นต้องไม่เกินวันสิ้นสุด');
        return;
      }
    }

    setExporting(true);
    try {
      const params = new URLSearchParams({ format, range });
      if (range === 'custom') {
        params.set('from', from);
        params.set('to', to);
      }

      const { blob, filename } = await apiDownload(`/api/v1/reports/export?${params.toString()}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      if (err?.message === 'EXPORT_PREMIUM_REQUIRED') {
        setError('การส่งออกรายงานเป็นฟีเจอร์สำหรับสมาชิก Premium — อัพเกรดเพื่อปลดล็อกการส่งออก PDF/Excel');
        setShowUpgrade(true);
      } else if (err?.message === 'EXPORT_INVALID_RANGE') {
        setError('ช่วงเวลาที่เลือกไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง');
      } else {
        setError('สร้างรายงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
      }
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="demo-card">
      <h2>📄 Export รายงาน</h2>
      <p className="app-note">ส่งออกสรุปพอร์ต + ประวัติธุรกรรมเป็นไฟล์ PDF หรือ Excel</p>

      {/* ⭐ Free → ไม่ยิง Request ไป Backend เปล่าๆ ให้โดน 403 เลย — พาไปหน้า
          /premium ตรงๆ แทนฟอร์ม (รู้สถานะจาก entitlements ที่โหลดไว้แล้ว) */}
      {!isPremiumActive ? (
        <>
          <p className="app-note">Export รายงานเป็นฟีเจอร์สำหรับสมาชิก Premium</p>
          <Link to="/premium" className="demo-btn demo-btn--primary">
            อัปเกรดเป็น Premium
          </Link>
        </>
      ) : (
        <div className="demo-form">
          <label className="demo-field">
            <span>รูปแบบไฟล์</span>
            <select value={format} onChange={(e) => setFormat(e.target.value)} disabled={exporting}>
              <option value="pdf">PDF</option>
              <option value="excel">Excel</option>
            </select>
          </label>

          <label className="demo-field">
            <span>ช่วงเวลา</span>
            <select value={range} onChange={(e) => setRange(e.target.value)} disabled={exporting}>
              {RANGE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          {/* ช่องวันที่โผล่เฉพาะตอนเลือก "กำหนดเอง" เท่านั้น */}
          {range === 'custom' && (
            <div className="demo-frow">
              <label className="demo-field">
                <span>จากวันที่</span>
                <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} disabled={exporting} />
              </label>
              <label className="demo-field">
                <span>ถึงวันที่</span>
                <input type="date" value={to} onChange={(e) => setTo(e.target.value)} disabled={exporting} />
              </label>
            </div>
          )}

          {error && (
            <p className="app-state app-state--error" role="alert">
              {error}
            </p>
          )}

          <div className="demo-actions">
            <button
              type="button"
              className="demo-btn demo-btn--primary"
              disabled={exporting}
              onClick={handleExport}
            >
              {exporting ? '⏳ กำลังสร้างรายงาน...' : '📑 Export'}
            </button>
            {showUpgrade && (
              <Link to="/premium" className="demo-btn">
                ดูแพ็กเกจ Premium
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export default ExportReportPanel;
