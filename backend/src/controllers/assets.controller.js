const symbolRegistry = require('../services/symbolRegistry.service');

// GET /api/v1/assets/symbols — รายการสินทรัพย์ทั้งหมดที่ระบบรองรับ สำหรับ Dropdown
// ค้นหาบนเว็บ
//
// Reuse symbolRegistry.listSymbols ตรงๆ — "ระบบรองรับ Symbol ใด" ตัดสินที่ Registry
// ที่เดียวเหมือนทุกจุดของระบบ (LINE/Bulk Import/OCR) จึงไม่มีทางที่ Dropdown จะโชว์
// สินทรัพย์ที่บันทึกจริงไม่ได้
//
// ข้อมูล Static (Hardcode ในโค้ด ไม่ได้มาจาก DB) — ไม่แตะฐานข้อมูลเลย และไม่มี
// ข้อมูลส่วนบุคคลใดๆ ผูกกับ User แต่ยัง Gate ด้วย requireAuth + requireConsent
// ตาม Pattern ของ dashboard.routes (Route ฝั่งเว็บทั้งหมดอยู่หลัง Login เสมอ)
function getSymbols(req, res) {
  try {
    const symbols = symbolRegistry.listSymbols();

    // Cache ที่ Browser 1 ชม. — private เพราะอยู่หลัง Authorization Header
    // (ห้าม public: Shared Cache/CDN ไม่ควรเก็บ Response ของ Route ที่ต้อง Login
    // แม้เนื้อหาจะเหมือนกันทุก User ก็ตาม — กันพลาดเชิงนโยบายไว้ก่อน)
    res.set('Cache-Control', 'private, max-age=3600');

    return res.status(200).json({ symbols });
  } catch (err) {
    console.error(`[assets] getSymbols failed: ${err.message}`);
    return res.status(500).json({ error: 'INTERNAL_ERROR' });
  }
}

module.exports = { getSymbols };
