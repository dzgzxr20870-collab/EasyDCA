// ═══════════════════════════════════════════════════════════════════════
// qrImage.service — Render สตริง Payload ใดๆ เป็นรูป QR PNG (Buffer)
// ═══════════════════════════════════════════════════════════════════════
// ใช้ Library 'qrcode' (ติดตั้งอยู่แล้วเป็น Dependency ของ promptpay-qr) แต่
// ประกาศไว้ใน package.json ของ backend ตรงๆ ด้วย เพราะเราเรียกใช้เองแล้ว
//
// ⚠️ qrcode รุ่นที่ติดตั้ง (0.9.0) ไม่มี toBuffer() — จึงใช้ toDataURL() ที่ได้
// Data URI (base64 PNG) แล้วถอดเป็น Buffer เอง (ใช้ได้ทั้งรุ่นเก่า/ใหม่)
// ที่นี่ Pure ต่อ Input เดียว (ไม่มี DB/Network) — Caller (Endpoint qr.png) เป็น
// ผู้ประกอบ Payload จากยอดใน DB มาให้ ไม่เชื่อค่าจากภายนอก
const QRCode = require('qrcode');

// Render Payload เป็น PNG Buffer — คืน Promise<Buffer>
// margin/width ตั้งค่าให้สแกนง่ายบนมือถือ (ขอบ 1 module, กว้าง 512px)
function renderPng(text, opts = {}) {
  return new Promise((resolve, reject) => {
    QRCode.toDataURL(
      text,
      { type: 'image/png', margin: 1, width: 512, ...opts },
      (err, dataUrl) => {
        if (err) return reject(err);
        // dataUrl = "data:image/png;base64,<...>" — ตัดส่วนหัวออกแล้วถอด base64
        const base64 = String(dataUrl).split(',')[1];
        resolve(Buffer.from(base64, 'base64'));
      }
    );
  });
}

module.exports = {
  renderPng,
};
