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
const { buildExternalUrl } = require('../utils/externalUrl.util');

// รูป Rich Menu จริงจากทีม Design (ขนาด 2500x1686 ตรงตาม Grid เดิมเป๊ะ)
const RICHMENU_IMAGE_PATH = path.join(__dirname, '../../assets/richmenu-2500x1686.png');

// หมายเหตุ: Endpoint อัพโหลดเนื้อหา (รูปภาพ) ของ LINE ใช้ Host แยกต่างหาก
// คือ api-data.line.me (ไม่ใช่ api.line.me เหมือน Endpoint อื่น) ตาม LINE
// Messaging API Reference — ถ้าใช้ api.line.me กับ Endpoint นี้จะได้ 404
const RICHMENU_API_URL = 'https://api.line.me/v2/bot/richmenu';
const RICHMENU_DATA_API_URL = 'https://api-data.line.me/v2/bot/richmenu';
const RICHMENU_DEFAULT_URL = 'https://api.line.me/v2/bot/user/all/richmenu';

// Postback (ไม่ใช่ message) เพื่อส่ง Flex Message สอนวิธีพิมพ์คำสั่งซื้อ/ขายทันที
// (buildAddGuideMessage) กันข้อความเปล่าหลุดเข้า Command Parser — Pattern
// เดียวกับปุ่ม Dashboard/Premium/ตั้งเตือน DCA
//
// Layout: Grid 2 แถว x 3 คอลัมน์ (2500x1686)
//   แถวบน:  เพิ่มรายการ (postback→คำแนะนำ) | พอต | ประวัติ
//   แถวล่าง: Dashboard | ตั้งเตือน DCA | Premium
function buildRichMenuPayload() {
  // 1 ช่องใน Grid (col 0..2, row 0..1)
  const cell = (col, row, action) => ({
    bounds: { x: col * CELL_WIDTH, y: row * CELL_HEIGHT, width: CELL_WIDTH, height: CELL_HEIGHT },
    action,
  });
  const message = (text) => ({ type: 'message', text });

  // ปุ่ม Dashboard/Premium ชี้ Domain ของเว็บเราตรงๆ + openExternalBrowser=1 แทน
  // https://liff.line.me/{liffId} เดิม — บังคับเปิดผ่าน Browser ภายนอกของเครื่อง
  // เสมอ (LIFF In-App Browser เดิมเปิดไม่ขึ้นในบาง Case จริง) เหตุผลเต็ม + ยืนยัน
  // ว่า Login/JWT ยังทำงานถูกต้องอยู่ใน utils/externalUrl.util.js — Path Catch-all
  // Rewrite ทุก Path ไปที่ index.html อยู่แล้ว (frontend/public/serve.json) จึง
  // ลิงก์ตรงเข้าหน้าในแอปได้เลย ถ้า JWT ใน Memory ยังไม่มี Route Guard ของแต่ละหน้า
  // จะ stashReturnTo + เด้งไป Login ให้เอง แล้ว Login พากลับมาหน้าเดิมหลัง Verify
  // เสร็จ (Return-To Pattern เดียวกับที่ใช้อยู่แล้วทั่วเว็บ)
  const dashboardUrl = buildExternalUrl('/dashboard');
  const premiumUrl = buildExternalUrl('/premium');
  if (!dashboardUrl || !premiumUrl) {
    // Fail-fast ก่อนยิง LINE API เลย — ดีกว่าสร้าง Rich Menu ที่มีปุ่มลิงก์พังค้าง
    // ไว้บน Production (ต้องลบแล้วสร้างใหม่ทั้งอัน ไม่มี "แก้ปุ่มเดียว" ทำได้)
    throw new Error(
      'FRONTEND_URL ยังไม่ได้ตั้งค่า — ต้องตั้งก่อนรัน setup-richmenu (ปุ่ม Dashboard/Premium ต้องมี URL จริง)'
    );
  }

  return {
    size: { width: WIDTH, height: HEIGHT },
    selected: true,
    name: 'EasyDCA Main Menu',
    chatBarText: 'เมนู',
    areas: [
      // ── แถวบน ──────────────────────────────────────────────────────────
      // เพิ่มรายการ — Postback (ไม่ใช่ message) กันข้อความเปล่าหลุด Command Parser
      // (ดู Comment ด้านบน) routePostback จับ action นี้ตรงๆ (ดู webhook.controller)
      cell(0, 0, {
        type: 'postback',
        data: 'action=add_guide',
        displayText: '📝 เพิ่มรายการ',
      }),
      cell(1, 0, message('พอต')), // ดูพอร์ต (เร็ว) — message ตอบในแชททันที ไม่เปิดเว็บ
      cell(2, 0, message('ประวัติ')), // ดูประวัติ (เร็ว) — เช่นเดียวกัน
      // ── แถวล่าง ────────────────────────────────────────────────────────
      // แดชบอร์ดเว็บ — เปลี่ยนจาก Postback (ตอบการ์ดในแชทแล้วต้องกดปุ่มในการ์ดซ้ำ
      // อีกที) เป็น uri ตรงๆ ลัดไปเปิด /dashboard ทันทีในคลิกเดียว ผ่าน Browser
      // ภายนอกเสมอ (เดิมมี Flex Message Card คั่นกลาง — buildDashboardLinkMessage
      // ยังอยู่ในโค้ดเผื่อจุดอื่นเรียกใช้ แต่ Rich Menu ไม่ผ่านจุดนั้นแล้ว)
      cell(0, 1, { type: 'uri', uri: dashboardUrl, label: 'แดชบอร์ดเว็บ' }),
      // ปุ่มใหม่ — Postback (ไม่ใช่ message) เพราะเริ่ม Flow ตั้งเตือน DCA แบบ Quick
      // Reply หลายขั้นตอน webhook.controller routePostback จับ action นี้ (ไม่ผ่าน
      // Command Parser) displayText แสดงในแชทเสมือนผู้ใช้กดเลือกเอง
      cell(1, 1, {
        type: 'postback',
        data: 'action=start_reminder_setup',
        displayText: '⏰ ตั้งเตือน DCA',
      }),
      // Premium — เปลี่ยนจาก Postback (Flow เสนอแพ็กเกจ/สถานะ/QR ในแชท ผ่าน
      // buildPremiumOfferMessage/buildPremiumStatusMessage/buildPaymentQrMessage)
      // เป็น uri ลัดตรงไปหน้า /premium เวอร์ชันใหม่ (Hero + การ์ดเทียบแผน 3 คอลัมน์ —
      // Commit 25ca0a0) ตามที่ Confirm แล้ว — Flow ในแชทเดิม (case 'premium_menu' ใน
      // webhook.controller.js) ไม่มีทางเข้าถึงจาก Rich Menu อีกต่อไป (เคย Grep ยืนยัน
      // ว่าไม่มี Text Command อื่นเรียก action นี้เลย จึงกลายเป็น Dead Code ในทาง
      // ปฏิบัติ — โค้ด Handler เดิมยังอยู่ครบ ไม่ได้ลบ เผื่อย้อนกลับ Decision นี้ทีหลัง)
      cell(2, 1, { type: 'uri', uri: premiumUrl, label: 'อัพเกรด Premium' }),
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
