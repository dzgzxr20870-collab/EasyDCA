// One-time Setup Script — สร้าง Rich Menu ตาม ROADMAP.md Phase 1
// (เพิ่มรายการ, พอร์ต, ประวัติ, Premium, ตั้งค่า) แล้ว Set เป็น Default
// ให้ User ทุกคน
//
// รันด้วย: npm run setup-richmenu
// ไม่ใช่ส่วนหนึ่งของ Server ที่รันทุกครั้ง (ไม่ require จาก src/index.js)
//
// Idempotent-friendly: ทุกครั้งที่รันจะสร้าง Rich Menu ใหม่ 1 อัน (LINE ไม่มี
// "อัพเดท" Rich Menu เดิมได้ ต้องสร้างใหม่เสมอ) — Log Rich Menu ID ที่สร้าง
// สำเร็จออกมาชัดเจน เพื่อให้เอาไปลบ Rich Menu เก่าที่ไม่ใช้แล้วได้ทีหลัง
// ด้วย DELETE https://api.line.me/v2/bot/richmenu/{richMenuId}
const fs = require('fs');
const path = require('path');
const config = require('../config/env');
// ยังใช้ค่าคงที่ Grid (WIDTH/HEIGHT/CELL_WIDTH/CELL_HEIGHT) จาก richMenuImage เพื่อ
// วาง bounds ให้ตรงกับรูปจริง (2500x1686 = 2 แถว x 3 คอลัมน์) แต่ไม่ใช้
// generatePlaceholderImage แล้ว — เปลี่ยนไปอ่านรูป Design จริงจากไฟล์แทน (ดู main)
const { WIDTH, HEIGHT, CELL_WIDTH, CELL_HEIGHT } = require('./richMenuImage');

// รูป Rich Menu จริงจากทีม Design (ขนาด 2500x1686 ตรงตาม Grid เดิมเป๊ะ)
const RICHMENU_IMAGE_PATH = path.join(__dirname, '../../assets/richmenu-2500x1686.png');

// หมายเหตุ: Endpoint อัพโหลดเนื้อหา (รูปภาพ) ของ LINE ใช้ Host แยกต่างหาก
// คือ api-data.line.me (ไม่ใช่ api.line.me เหมือน Endpoint อื่น) ตาม LINE
// Messaging API Reference — ถ้าใช้ api.line.me กับ Endpoint นี้จะได้ 404
const RICHMENU_API_URL = 'https://api.line.me/v2/bot/richmenu';
const RICHMENU_DATA_API_URL = 'https://api-data.line.me/v2/bot/richmenu';
const RICHMENU_DEFAULT_URL = 'https://api.line.me/v2/bot/user/all/richmenu';

// action type "message" ของ LINE ส่งข้อความนั้นออกไปทันทีเมื่อผู้ใช้แตะปุ่ม
// (ไม่ใช่แค่เติมข้อความในช่อง Input ให้พิมพ์ต่อ — LINE Rich Menu ไม่มี Action
// แบบ "เติมข้อความแต่ยังไม่ส่ง" ให้ใช้) ดังนั้นปุ่ม "เพิ่มรายการ" ที่ส่ง "ซื้อ"
// เปล่าๆ จะเข้า Command Parser ไม่ Match รูปแบบไหนเลย → ตกไปที่ UNKNOWN
// Command ซึ่งระบบตอบกลับด้วยตัวอย่างคำสั่งที่ถูกต้องอยู่แล้ว
// (flexMessage.util.js buildUnknownCommandMessage) ผลลัพธ์จึงยังใกล้เคียง
// เจตนาเดิม (ชี้แนะให้ผู้ใช้พิมพ์ต่อ) แม้กลไกจะต่างจากการ "Prefix ในช่อง Input"
//
// Layout: Grid 2 แถว x 3 คอลัมน์ (2500x1686)
//   แถวบน:  ซื้อ | พอต | ประวัติ
//   แถวล่าง: Dashboard | ตั้งเตือน DCA | Premium
function buildRichMenuPayload() {
  // 1 ช่องใน Grid (col 0..2, row 0..1)
  const cell = (col, row, action) => ({
    bounds: { x: col * CELL_WIDTH, y: row * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT },
    action,
  });
  const message = (text) => ({ type: 'message', text });

  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: 'EasyDCA Main Menu',
    chatBarText: 'เมนู',
    areas: [
      // ── แถวบน ──────────────────────────────────────────────────────────
      cell(0, 0, message('ซื้อ')), // เพิ่มรายการ — Prefix ให้พิมพ์ต่อ (ดู Comment ด้านบน)
      cell(1, 0, message('พอต')), // พอร์ต — คำสั่งสมบูรณ์
      cell(2, 0, message('ประวัติ')), // ประวัติ — คำสั่งสมบูรณ์
      // ── แถวล่าง ────────────────────────────────────────────────────────
      // Postback (ไม่ใช่ message) โดยตั้งใจ — กันข้อความหลุดไปเข้า Command Parser
      // แล้วตก UNKNOWN โดยไม่ได้ตั้งใจ (เหมือนปัญหาเดิมของ 'ซื้อ' เปล่าๆ)
      // routePostback จับ action เหล่านี้ตรงๆ (ดู webhook.controller)
      cell(0, 1, {
        type: 'postback',
        data: 'action=open_dashboard',
        displayText: '📊 Dashboard',
      }),
      // ปุ่มใหม่ — Postback (ไม่ใช่ message) เพราะเริ่ม Flow ตั้งเตือน DCA แบบ Quick
      // Reply หลายขั้นตอน webhook.controller routePostback จับ action นี้ (ไม่ผ่าน
      // Command Parser) displayText แสดงในแชทเสมือนผู้ใช้กดเลือกเอง
      cell(1, 1, {
        type: 'postback',
        data: 'action=start_reminder_setup',
        displayText: '⏰ ตั้งเตือน DCA',
      }),
      cell(2, 1, {
        type: 'postback',
        data: 'action=premium_menu',
        displayText: '👑 Premium',
      }),
    ],
  };
}

async function createRichMenu(payload) {
  console.log('[setup-richmenu] [1/3] กำลังสร้าง Rich Menu...');

  const response = await fetch(RICHMENU_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.line.channelAccessToken}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`สร้าง Rich Menu ไม่สำเร็จ: ${response.status} ${detail}`);
  }

  const { richMenuId } = await response.json();
  console.log(`[setup-richmenu] [1/3] สำเร็จ — RICH_MENU_ID=${richMenuId}`);
  return richMenuId;
}

async function uploadRichMenuImage(richMenuId, imageBuffer) {
  console.log('[setup-richmenu] [2/3] กำลังอัพโหลดรูปภาพ Rich Menu...');

  const response = await fetch(`${RICHMENU_DATA_API_URL}/${richMenuId}/content`, {
    method: 'POST',
    headers: {
      'Content-Type': 'image/png',
      Authorization: `Bearer ${config.line.channelAccessToken}`,
    },
    body: imageBuffer,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`อัพโหลดรูปภาพ Rich Menu ไม่สำเร็จ (richMenuId=${richMenuId}): ${response.status} ${detail}`);
  }

  console.log('[setup-richmenu] [2/3] สำเร็จ — อัพโหลดรูปภาพแล้ว');
}

async function setDefaultRichMenu(richMenuId) {
  console.log('[setup-richmenu] [3/3] กำลัง Set เป็น Default Rich Menu สำหรับ User ทั้งหมด...');

  const response = await fetch(`${RICHMENU_DEFAULT_URL}/${richMenuId}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.line.channelAccessToken}`,
    },
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Set Default Rich Menu ไม่สำเร็จ (richMenuId=${richMenuId}): ${response.status} ${detail}`);
  }

  console.log('[setup-richmenu] [3/3] สำเร็จ — Set เป็น Default Rich Menu แล้ว');
}

// อ่านรูป Rich Menu จริงจากไฟล์เป็น Buffer — Fail เร็วพร้อมข้อความชัดเจนถ้าไฟล์หาย
// (จะได้ไม่สร้าง Rich Menu ค้างไว้โดยไม่มีรูป)
function readRichMenuImage() {
  if (!fs.existsSync(RICHMENU_IMAGE_PATH)) {
    throw new Error(`ไม่พบไฟล์รูป Rich Menu ที่ ${RICHMENU_IMAGE_PATH}`);
  }
  return fs.readFileSync(RICHMENU_IMAGE_PATH);
}

async function main() {
  console.log('[setup-richmenu] เริ่มต้น Setup Rich Menu...');
  console.log(`[setup-richmenu] ใช้รูป Design จริงจาก ${RICHMENU_IMAGE_PATH}`);

  // อ่านรูปก่อนสร้าง Rich Menu — ถ้าไฟล์หายจะ throw ตั้งแต่ตรงนี้ (ยังไม่สร้างอะไรค้าง)
  const imageBuffer = readRichMenuImage();
  const richMenuId = await createRichMenu(buildRichMenuPayload());
  await uploadRichMenuImage(richMenuId, imageBuffer);
  await setDefaultRichMenu(richMenuId);

  console.log('[setup-richmenu] ──────────────────────────────────────────');
  console.log(`[setup-richmenu] เสร็จสมบูรณ์ — RICH_MENU_ID=${richMenuId}`);
  console.log(
    '[setup-richmenu] หากต้องรัน Script นี้ซ้ำ ให้ลบ Rich Menu เก่านี้ก่อนด้วย:'
  );
  console.log(`[setup-richmenu]   DELETE ${RICHMENU_API_URL}/${richMenuId}`);
  console.log('[setup-richmenu] ──────────────────────────────────────────');
}

main().catch((err) => {
  console.error(`[setup-richmenu] ล้มเหลว: ${err.message}`);
  process.exitCode = 1;
});
