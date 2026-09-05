import { useState } from 'react';
import { useOutletContext, Link } from 'react-router-dom';
import { setDefaultPortfolio } from '../../lib/portfolioApi.js';
import ExportReportPanel from '../../components/app/ExportReportPanel.jsx';

// ═══════════════════════════════════════════════════════════════════════════
// AppProfile — โปรไฟล์ + จัดการพอร์ต ต่อ API จริง (Stage 9)
// ═══════════════════════════════════════════════════════════════════════════
// Port มาจาก `pages/demo/DemoProfile.jsx` — สิทธิ์มาจาก `/dashboard/me` จริง
// (Demo ใช้ Toggle "ดูแบบ Free / ดูแบบ Premium" ปลอม ซึ่งถูกตัดออกตั้งแต่ AppShell)
//
// ⭐ **หน้านี้คือที่ที่ผู้ใช้ "เลือกพอร์ตหลัก" ได้** — สำคัญมากสำหรับผู้ใช้ที่ Premium
// หมดอายุ เพราะพอร์ตหลักคือพอร์ตเดียวที่ยังเพิ่มรายการใหม่ได้ · ถ้าเลือกเองไม่ได้
// จะถูกขังอยู่กับพอร์ตที่ migration 044 Backfill สร้างให้ (ซึ่งมักแทบว่างเปล่า)
// ขณะที่พอร์ตที่เขาใช้จริงถูกล็อก — มติ Founder 24 ส.ค. 2569

function AppProfile() {
  const { portfolios, entitlements, reload } = useOutletContext();
  const [busyId, setBusyId] = useState(null);
  const [error, setError] = useState(null);

  async function handleSetDefault(id) {
    setBusyId(id);
    setError(null);
    try {
      await setDefaultPortfolio(id);
      // โหลดใหม่ทั้งชุด — canWrite ของ "ทุก" พอร์ตเปลี่ยนตามพอร์ตหลักใหม่
      await reload?.();
    } catch (err) {
      setError(err?.message ?? 'ตั้งพอร์ตหลักไม่สำเร็จ');
    } finally {
      setBusyId(null);
    }
  }

  // ⚠️ แยก "Premium ที่ยังใช้งานอยู่" ออกจาก "เคยเป็น Premium แต่หมดอายุ" ให้ชัด
  // ผู้ใช้กลุ่มหลังต้องรู้ว่าข้อมูลยังอยู่ครบ ไม่ได้ถูกลบ
  const planLabel = entitlements.isPremiumActive
    ? 'Premium (ใช้งานอยู่)'
    : entitlements.plan === 'premium'
      ? 'Premium (หมดอายุแล้ว)'
      : 'Free';

  return (
    <section className="demo-page">
      <header className="demo-page__head">
        <h1>โปรไฟล์</h1>
      </header>

      <section className="demo-card">
        <h2>แพ็กเกจ</h2>
        <p>
          <strong>{planLabel}</strong>
        </p>

        {entitlements.planExpiresAt && (
          <p className="app-note">
            วันหมดอายุ: {new Date(entitlements.planExpiresAt).toLocaleDateString('th-TH')}
          </p>
        )}

        {/* ⚠️ เพดานมาจาก Backend เสมอ (/dashboard/me) — ห้าม Hardcode ใน Frontend
            "ไม่ทราบ" คือค่าที่ถูกต้องเมื่อยังโหลดไม่เสร็จ ดีกว่าเดาตัวเลข */}
        <p className="app-note">
          พอร์ตที่สร้างได้: {entitlements.portfolioLimit ?? 'ไม่ทราบ'} ·
          สินทรัพย์:{' '}
          {entitlements.assetLimit === null
            ? 'ไม่จำกัด'
            : (entitlements.assetLimit ?? 'ไม่ทราบ')}
        </p>

        {!entitlements.isPremiumActive && (
          <Link to="/premium" className="demo-btn demo-btn--primary">
            อัปเกรดเป็น Premium
          </Link>
        )}
      </section>

      <section className="demo-card">
        <h2>พอร์ตของฉัน</h2>

        {error && (
          <p className="app-state app-state--error" role="alert">
            {error}
          </p>
        )}

        {portfolios.length === 0 ? (
          <p className="app-note">กำลังโหลด...</p>
        ) : (
          <ul className="demo-portfoliolist">
            {portfolios.map((p) => (
              <li key={p.id} className="demo-portfolioitem">
                <strong>
                  {p.isDefault ? '⭐ ' : ''}
                  {p.name}
                </strong>
                <small>{p.type}</small>
                {p.canWrite === false && <small>เพิ่มรายการใหม่ไม่ได้</small>}

                {/* ปุ่มโผล่เฉพาะตอนมีพอร์ตมากกว่า 1 อัน — มีพอร์ตเดียวเปลี่ยนไปก็
                    ไม่มีความหมาย (Backend ตอบ VALIDATION_ERROR ในกรณีนั้น) */}
                {!p.isDefault && portfolios.length > 1 && (
                  <button
                    type="button"
                    className="demo-btn"
                    disabled={busyId !== null}
                    onClick={() => handleSetDefault(p.id)}
                  >
                    {busyId === p.id ? 'กำลังตั้ง...' : 'ตั้งเป็นพอร์ตหลัก'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {/* ⭐ ต้องอธิบายให้ชัดว่า "พอร์ตหลัก" มีผลอะไร — ผู้ใช้ที่ Premium หมดอายุ
            ต้องรู้ว่าเขา *เลือกได้* ว่าพอร์ตไหนจะยังเพิ่มรายการใหม่ได้ ไม่ใช่ถูก
            ระบบเลือกให้ · และต้องรู้ว่าพอร์ตอื่นยังขาย/ย้ายออกได้ ไม่ได้ถูกขัง */}
        <p className="app-note">
          ⭐ พอร์ตหลักคือพอร์ตที่ยังเพิ่มรายการใหม่ได้เสมอ แม้แพ็กเกจ Premium หมดอายุแล้ว —
          พอร์ตอื่นยังเปิดดูย้อนหลัง บันทึกการขาย ย้อนรายการ และย้ายสินทรัพย์ออกได้ตามปกติ
          ข้อมูลเดิมอยู่ครบทุกรายการ ไม่มีอะไรถูกลบ
        </p>
      </section>

      <ExportReportPanel isPremiumActive={entitlements.isPremiumActive} />

      {/* หน้า /support (ฟอร์มติดต่อทีมงาน) มีอยู่แล้วและทำงานสมบูรณ์ แต่หน้า /app/profile
          นี้ยังไม่เคยมีลิงก์ไปหาเลย — เพิ่มทางเข้าให้ผู้ใช้ที่ใช้ App Shell ใหม่ (/app/*)
          หาเจอโดยไม่ต้องพึ่ง Dashboard เดิม (/dashboard) ที่มีลิงก์นี้อยู่แล้ว */}
      <section className="demo-card">
        <h2>ติดต่อทีมงาน</h2>
        <p className="app-note">
          มีปัญหาการใช้งาน แจ้งชำระเงิน หรือข้อสงสัยอื่นๆ ติดต่อทีมงานได้ที่นี่
        </p>
        <Link to="/support" className="demo-btn">
          🆘 ติดต่อซัพพอร์ต
        </Link>
      </section>
    </section>
  );
}

export default AppProfile;
