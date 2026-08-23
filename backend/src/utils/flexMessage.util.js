const { dowToDayName, THAI_DAY_NAMES, formatThaiDate } = require('./thaiDate.util');

// Flex Message Builders ตาม Design System ใน UI_UX.md § 1, § 3
// สี Sync กับ Theme จริงของเว็บ Dashboard (frontend/src/pages/DashboardHome.css
// :root — --green/--red/--amber/--ink) + Navy จากโลโก้ใหม่ (easydca-logo-full-
// transparent.png, sampled #022B59) แทนค่าเดิมที่อ้างอิง UI_UX.md § 1.1 ซึ่งเป็น
// Palette ฉบับร่างก่อน Redesign (ไม่ตรงกับเว็บจริงที่ใช้งานอยู่แล้ว)
const COLOR = {
  profit: '#1E9E55', // --green
  profitBg: '#E9F6EE', // --green-soft
  loss: '#DE5050', // --red
  lossBg: '#FDEEEE', // --red-soft
  warning: '#F0A93B', // --amber
  warningBg: '#FCF3E1', // --amber-soft
  info: '#022B59', // Navy จากโลโก้ใหม่
  // คู่พื้นหลังอ่อนของ info — เดิมมีแต่สีเข้ม (info) ที่ใช้กับปุ่ม/ตัวอักษร ยังไม่เคยมี
  // การ์ดไหนใช้ info เป็นสีหัวการ์ดจึงไม่เคยต้องมี Bg มาก่อน (โทนอ่อนของ Navy ด้านบน
  // เว็บยังไม่มี Soft Variant ของ Navy จึงคำนวณเป็นโทนอ่อนเดียวกัน)
  infoBg: '#E1E6EB',
  textPrimary: '#22301F', // --ink
  textSecondary: '#4A5A47', // --ink2
};

// มาสคอต "อีซี่" (feature/mascot-flex-redesign) — 9 รูป PNG พื้นหลังโปร่งใสจาก Founder
// อัปโหลดขึ้น Supabase Storage Bucket "flex-assets" (Public — เป็นรูปตกแต่ง UI ล้วน
// ไม่มี PII ต่างจาก payment-slips/transaction-slips/facebook-like-proofs ที่เป็น
// Private ทั้งหมด ดู storage.service.js) ไม่มีนามสกุลไฟล์ที่ต้อง Sign URL แบบสลิป
//
// ⚠️ 02-processing-thinking.png ยังไม่ได้ Wire เข้าที่นี่ — ไม่มี Flex Message Builder
// ใดในไฟล์นี้ที่สื่อ "กำลังประมวลผล/รอผล AI" ได้ตรงความหมาย (สถานะรอ OCR ส่งเป็นข้อความ
// Text ธรรมดาจาก Controller ไม่ใช่ Flex) — รายงานไว้ให้ Founder แทนการฝืนใส่ผิดจุด
const MASCOT_BASE_URL =
  'https://isukdqundjwpbknnvckf.supabase.co/storage/v1/object/public/flex-assets';
const MASCOT = {
  successCheer: `${MASCOT_BASE_URL}/01-success-cheer.png`,
  errorConcern: `${MASCOT_BASE_URL}/03-error-concern.png`,
  lockedStop: `${MASCOT_BASE_URL}/04-locked-stop.png`,
  portfolioUp: `${MASCOT_BASE_URL}/05-portfolio-up.png`,
  portfolioDown: `${MASCOT_BASE_URL}/06-portfolio-down-encourage.png`,
  welcomeWave: `${MASCOT_BASE_URL}/07-welcome-wave.png`,
  achievementTrophy: `${MASCOT_BASE_URL}/08-achievement-trophy.png`,
  decorationSparkle: `${MASCOT_BASE_URL}/09-decoration-sparkle.png`,
};

// Palette พาสเทลสำหรับพื้นหลังวงกลมมาสคอต (ตาม Reference ของ Founder) — ใช้ mint
// เฉพาะการ์ดโทนเขียว (Buy/Profit/Premium) ให้เข้ากับ headerColor เดิม ส่วนการ์ดโทน
// อื่น (แดง/ส้ม/กลาง) ใช้ cream กันสีมาสคอตชนกับสีความหมาย (แดง=ขาดทุน/ระงับ) เดิม
const MASCOT_BG = {
  mint: '#7ED47E',
  cream: '#FFF5E6',
};

// แปล Error Code (API.md § 5) เป็นข้อความไทยที่ผู้ใช้เข้าใจง่าย
// ห้ามโชว์ Code ดิบให้ผู้ใช้เห็น
const ERROR_MESSAGES = {
  ASSET_LIMIT_REACHED:
    'คุณใช้ครบ 2 สินทรัพย์ตามแพ็กเกจ Free แล้ว หากต้องการเพิ่มสินทรัพย์ใหม่ กรุณาอัพเกรดเป็น Premium',
  // เกิดเมื่อสองคำสั่งซื้อ Symbol ใหม่เดียวกันชนกันพอดี (กดซ้ำ/ตอบข้อความซ้ำ) —
  // UNIQUE Constraint กันข้อมูลซ้ำที่ระดับ DB ถูกต้องแล้ว รายการก่อนหน้าน่าจะบันทึก
  // สำเร็จไปแล้ว จึงชวนตรวจพอร์ตแทนบอกให้ "ลองใหม่" (ซึ่งจะซ้ำอีกไม่มีจบ)
  ASSET_ALREADY_EXISTS: 'สินทรัพย์นี้เพิ่งถูกเพิ่มเข้าพอร์ตไปแล้ว (อาจกดซ้ำ) ลองพิมพ์ "พอต" เพื่อตรวจสอบพอร์ตของคุณ',
  ASSET_NOT_FOUND: 'ไม่พบสินทรัพย์นี้ในพอร์ตของคุณ ลองบันทึกรายการซื้อก่อนนะครับ',
  INSUFFICIENT_QUANTITY:
    'จำนวนที่ต้องการขายมากกว่าที่คุณถือครองอยู่ กรุณาตรวจสอบยอดคงเหลืออีกครั้ง',
  NO_HOLDING_TO_CALCULATE_PROFIT:
    'ไม่มีการถือครองสินทรัพย์นี้อยู่ในขณะนี้ จึงยังคำนวณกำไร/ขาดทุนไม่ได้ ลองพิมพ์ "พอต" เพื่อดูสินทรัพย์ที่คุณถืออยู่',
  PRICE_FEED_NOT_IMPLEMENTED:
    'การบันทึกด้วยจำนวนเงินรองรับเฉพาะบางสินทรัพย์ (เช่น Crypto อย่าง BTC/ETH) เท่านั้น สำหรับสินทรัพย์อื่นกรุณาระบุจำนวนหน่วยและราคา เช่น "ซื้อ PTT 50 หุ้น ราคา 34"',
  // ทองคำ (Phase 3 Round 7) — ดึงราคาจากสมาคมค้าทองคำฯ (Community API) ไม่สำเร็จ
  // หรือราคายังว่าง (เช่นก่อนตลาดเปิด) — ไม่เดาราคา ให้ผู้ใช้ลองใหม่/ระบุราคาเอง
  GOLD_PRICE_UNAVAILABLE:
    'ดึงราคาทองคำปัจจุบันไม่ได้ในขณะนี้ (ราคายังไม่อัพเดตหรือระบบราคาขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือระบุราคาต้นทุนเองตอนซื้อ เช่น "ซื้อ GOLD 1 หุ้น ราคา 71000"',
  // กองทุนรวมไทย (Round 7 — SEC Open Data API)
  MUTUAL_FUND_NAV_UNAVAILABLE:
    'ดึงราคา NAV ของกองทุนนี้ไม่ได้ในขณะนี้ (NAV ยังไม่อัพเดตหรือระบบ ก.ล.ต. ขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือระบุราคาต้นทุนเองตอนซื้อ',
  MUTUAL_FUND_LIST_UNAVAILABLE:
    'ค้นหารายชื่อกองทุนไม่ได้ในขณะนี้ (ระบบข้อมูลกองทุนขัดข้องชั่วคราว) กรุณาลองใหม่อีกครั้งภายหลัง',
  FUND_CLASS_NOT_FOUND:
    'ไม่พบชนิดหน่วยลงทุนที่เลือก อาจมีการเปลี่ยนแปลงข้อมูล กรุณาพิมพ์คำสั่งซื้อกองทุนใหม่อีกครั้ง',
  // ยังไม่ได้ตั้งค่า SEC_API_SUBSCRIPTION_KEY / SEC_FUND_MASTER_LIST_PATH (Config ไม่พร้อม)
  SEC_NOT_CONFIGURED:
    'ระบบข้อมูลกองทุนรวมยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลังหรือติดต่อทีมงาน',
  // "ขาย <SYMBOL> ทั้งหมด" — Asset ยังมีอยู่แต่ยอดคงเหลือเป็น 0 (ขายไปหมดแล้ว)
  NOTHING_TO_SELL:
    'สินทรัพย์นี้ถูกขายไปหมดแล้ว ไม่มียอดคงเหลือให้ขายเพิ่ม ลองพิมพ์ "พอต" เพื่อดูสินทรัพย์ที่คุณถืออยู่',
  // "ขาย <SYMBOL> ทั้งหมด" — ดึงราคาตลาดปัจจุบันไม่ได้ (หุ้นไทยยังไม่มี Price Feed
  // หรือระบบราคาขัดข้องชั่วคราว) — ไม่เดาราคาให้
  MARKET_PRICE_UNAVAILABLE:
    'ดึงราคาตลาดของสินทรัพย์นี้ไม่ได้ในขณะนี้ (อาจเป็นสินทรัพย์ที่ยังไม่มีราคาตลาด เช่นหุ้นไทย หรือระบบราคาขัดข้องชั่วคราว) กรุณาลองใหม่อีกครั้งภายหลัง',
  // ราคาที่พิมพ์เป็น USD แต่แปลงเป็นบาทไม่ได้ (ระบบอัตราแลกเปลี่ยนขัดข้อง) — ไม่เดาเรต
  FX_RATE_UNAVAILABLE:
    'แปลงราคาจาก USD เป็นบาทไม่ได้ในขณะนี้ (ระบบอัตราแลกเปลี่ยนขัดข้องชั่วคราว) กรุณาลองใหม่ภายหลัง หรือระบุราคาเป็นบาทโดยตรง',
  VALIDATION_ERROR:
    'ไม่รู้จักสินทรัพย์นี้ กรุณาติดต่อทีมงานเพื่อเพิ่มในระบบ หรือตรวจสอบว่าพิมพ์ชื่อย่อถูกต้องแล้ว',
  // Confirm Flow (SRS.md § 2.3 [5-7]) — Postback มาช้า/ซ้ำ/ไม่พบ pending record
  PENDING_EXPIRED: 'รายการหมดเวลายืนยันแล้ว (เกิน 5 นาที) กรุณาพิมพ์คำสั่งใหม่อีกครั้ง',
  PENDING_NOT_FOUND: 'ไม่พบรายการที่รอยืนยัน อาจหมดอายุหรือถูกยกเลิกไปแล้ว กรุณาพิมพ์คำสั่งใหม่',
  PENDING_ALREADY_RESOLVED: 'รายการนี้ถูกดำเนินการไปแล้ว ไม่สามารถทำซ้ำได้',
  // Command History — คำสั่ง "ยกเลิกล่าสุด" (undoTransaction.service)
  NO_TRANSACTION_TO_UNDO: 'ยังไม่มีรายการให้ยกเลิก ลองบันทึกรายการซื้อ/ขายก่อนนะครับ',
  ALREADY_UNDONE: 'รายการล่าสุดถูกยกเลิกไปแล้ว ไม่สามารถยกเลิกซ้ำได้',
  CANNOT_UNDO_QUANTITY_MISMATCH:
    'ยกเลิกรายการล่าสุดไม่ได้ เพราะยอดคงเหลือปัจจุบันน้อยกว่าจำนวนในรายการนั้น (อาจมีการขายไปแล้วบางส่วน)',
  // DCA Reminder (dcaReminder.service) — ตั้ง/ลบเตือน
  REMINDER_NOT_FOUND:
    'ไม่พบการตั้งเตือนของสินทรัพย์นี้ที่กำลังใช้งานอยู่ ลองพิมพ์ "ดูเตือน" เพื่อดูรายการที่ตั้งไว้',
  INVALID_REMINDER:
    'ตั้งเตือนไม่สำเร็จ กรุณาตรวจสอบรูปแบบ เช่น "ตั้งเตือน BTC ทุกวันจันทร์ 1000" หรือ "ตั้งเตือน AAPL ทุกวันที่ 5 3000"',
  // DCA Planner Gate (Business Model Beta) — Free จำกัด 2 แผน Active (ทั้งเว็บและ LINE)
  PLAN_LIMIT_REACHED:
    'แผน DCA ฟรีจำกัด 2 แผน 🙏 หากต้องการตั้งแผน DCA เพิ่ม กรุณาอัพเกรดเป็น Premium (พิมพ์ "Premium" เพื่อดูวิธีสมัคร) หรือลบแผนเดิมก่อนตั้งใหม่',
  // DCA Reminder Setup Flow (reminderSetupFlow.service) — สนทนาแบบเลือกปุ่มหลายขั้น
  SETUP_SESSION_NOT_FOUND:
    'ไม่พบขั้นตอนการตั้งเตือนที่ค้างอยู่ (อาจหมดเวลา 5 นาทีแล้ว) กรุณากดปุ่ม "⏰ ตั้งเตือน DCA" ที่เมนูเพื่อเริ่มใหม่',
  WRONG_STEP:
    'ปุ่มนี้ไม่ตรงกับขั้นตอนปัจจุบัน (อาจกดปุ่มเก่าซ้ำ) กรุณาทำตามปุ่มล่าสุดที่ระบบส่งให้ หรือกด "ยกเลิก" แล้วเริ่มใหม่',
  PORTFOLIO_EMPTY_FOR_REMINDER:
    'คุณยังไม่มีสินทรัพย์ในพอร์ต จึงยังตั้งเตือน DCA ไม่ได้ ลองบันทึกการซื้อครั้งแรกก่อน เช่น "ซื้อ BTC 1000"',
  INVALID_AMOUNT: 'จำนวนเงินไม่ถูกต้อง กรุณาพิมพ์เป็นตัวเลขที่มากกว่า 0 (เช่น 1000) อีกครั้ง',
  // Guided Buy Flow (guidedBuyFlow.service — S8 R2 รอบ 2) — แยก Code จาก
  // SETUP_SESSION_NOT_FOUND ของ Flow ตั้งเตือน เพราะปุ่มที่ให้กดเริ่มใหม่คนละปุ่มกัน
  GUIDED_BUY_SESSION_NOT_FOUND:
    'ไม่พบขั้นตอนการบันทึกที่ค้างอยู่ (อาจหมดเวลา 5 นาทีแล้ว) กรุณากดปุ่ม "📈 บันทึก DCA" ที่เมนูเพื่อเริ่มใหม่',
  GUIDED_BUY_INVALID_SYMBOL:
    'ชื่อย่อสินทรัพย์ไม่ถูกต้อง กรุณาพิมพ์เป็นชื่อย่อคำเดียว (เช่น BTC, PTT, AAPL) อีกครั้ง',
  GUIDED_BUY_SESSION_BUSY:
    'คุณมีขั้นตอนอื่นค้างอยู่ กรุณาทำให้จบก่อน หรือกด "ยกเลิก" ของขั้นตอนนั้นแล้วเริ่มใหม่',
  // Multi-Currency (S8 R2 รอบ 3) — ผู้ใช้พิมพ์ "100 usd" ให้สินทรัพย์ที่ไม่มีราคา USD
  // (หุ้นไทย/ทอง/กองทุน) — ปุ่ม USD ไม่เคยแสดงให้สินทรัพย์กลุ่มนี้ แต่พิมพ์เองได้
  GUIDED_BUY_CURRENCY_NOT_SUPPORTED:
    'สินทรัพย์นี้บันทึกเป็น USD ไม่ได้ (รองรับเฉพาะ Crypto และหุ้นสหรัฐ) กรุณาพิมพ์เป็นจำนวนเงินบาท เช่น 1000',
  // หน่วยเงินที่พิมพ์มาสะกดไม่ตรงกับที่ระบบรู้จัก (เช่น "150 uas") — ห้ามเดาเป็นบาท
  // เพราะ 150 บาท กับ 150 USD ต่างกัน ~30 เท่า ต้องให้ผู้ใช้ยืนยันด้วยการพิมพ์ใหม่
  GUIDED_BUY_AMBIGUOUS_CURRENCY:
    'ไม่แน่ใจว่าคุณหมายถึงสกุลเงินไหน (หน่วยเงินที่พิมพ์มาสะกดไม่ตรงกับที่ระบบรู้จัก) — ถ้าเป็นเงินบาทพิมพ์เฉพาะตัวเลข เช่น 1500 ถ้าเป็นดอลลาร์พิมพ์ว่า 100 usd',
  INVALID_DAY:
    'วันที่ไม่ถูกต้อง สำหรับรายเดือนกรุณาพิมพ์เลข 1-31 หรือเลือกจากปุ่มที่ระบบส่งให้',
  INTERNAL_ERROR: 'เกิดข้อผิดพลาดบางอย่าง กรุณาลองใหม่อีกครั้งในภายหลัง',
  // Payment Admin Postback (payment.service) — อนุมัติ/ปฏิเสธผ่านปุ่มใน LINE
  // NOT_AUTHORIZED: ตอบสั้นๆ ไม่บอกรายละเอียดเพิ่ม (กัน Enumerate ว่าใครเป็น Admin)
  NOT_AUTHORIZED: 'คุณไม่มีสิทธิ์ทำรายการนี้',
  ALREADY_RESOLVED: 'รายการนี้ถูกดำเนินการไปแล้ว',
  // Payment User Postback (Premium Menu / request_payment / notify_payment)
  PAYMENT_NOT_FOUND: 'ไม่พบคำขอชำระเงินนี้ อาจหมดอายุหรือถูกดำเนินการไปแล้ว กรุณากดเมนู "Premium" เพื่อเริ่มใหม่',
  PAYMENT_NOT_PENDING: 'คำขอชำระเงินนี้ถูกดำเนินการไปแล้ว ไม่ต้องแจ้งซ้ำ หากยังไม่ได้รับสิทธิ์ Premium กรุณาติดต่อทีมงาน',
  // Lock-Until-Resolved (migration 016) — ผู้ใช้กด "แจ้งชำระแล้ว" ก่อนส่งรูปสลิปมา
  SLIP_NOT_ATTACHED: 'ยังไม่พบรูปสลิปสำหรับคำขอนี้ กรุณาส่งรูปสลิปโอนเงินก่อนกดปุ่ม "แจ้งชำระแล้ว"',
  PAYMENT_NOT_CONFIGURED: 'ระบบชำระเงินยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลังหรือติดต่อทีมงาน',
  SATANG_POOL_EXHAUSTED: 'ขณะนี้มีผู้ทำรายการพร้อมกันจำนวนมาก กรุณาลองกดอีกครั้งในอีกสักครู่',
  // F1 — 1 คำขอค้างต่อ user: ปกติผู้ใช้ไม่ควรเห็นข้อความนี้เลย เพราะทั้ง premium_menu
  // และ request_payment ตอบด้วย QR ของคำขอเดิมแทน (ดู webhook.controller) — เก็บไว้
  // เป็นตาข่ายรองเผื่อคำขอถูก Resolve พอดีจังหวะจนดึงกลับมาแสดงไม่ได้
  PENDING_PAYMENT_EXISTS:
    'คุณมีคำขอชำระเงินที่ยังไม่เสร็จสิ้นอยู่แล้ว กรุณากดเมนู "Premium" เพื่อดู QR ของคำขอเดิม หรือรอให้คำขอเดิมหมดอายุก่อนขอใหม่',
  ALLOCATION_CONFLICT: 'ขณะนี้มีผู้ทำรายการพร้อมกันจำนวนมาก กรุณาลองกดอีกครั้งในอีกสักครู่',
  // Duplicate Slip Detection (Payment Beta — migration 015) — สลิปนี้เคยถูกใช้ยืนยัน
  // คำขอที่อนุมัติแล้วก่อนหน้านี้ (payment.service.assertSlipNotReused)
  SLIP_ALREADY_USED:
    'สลิปนี้เคยถูกใช้ยืนยันการชำระเงินที่อนุมัติแล้วก่อนหน้านี้ ไม่สามารถใช้ซ้ำได้ หากคุณโอนเงินสำหรับรอบนี้แยกต่างหาก กรุณาส่งสลิปของรายการโอนนั้นแทน หรือติดต่อทีมงานหากคิดว่าเป็นความผิดพลาด',
  // Bulk Import (bulkImport.service / pendingTransaction.service — Phase 3 Round 6)
  BATCH_NOT_FOUND:
    'ไม่พบรายการนำเข้าพอร์ตนี้ อาจหมดอายุหรือถูกดำเนินการไปแล้ว กรุณาพิมพ์ "นำเข้าพอร์ต" เพื่อเริ่มใหม่',
  // Export รายงาน (Phase 3 Round 8 — reportExport.service)
  EXPORT_INVALID_RANGE:
    'ช่วงเวลาที่ระบุไม่ถูกต้อง กรุณาพิมพ์เช่น "ส่งออกรายงาน เดือนนี้", "ส่งออกรายงาน ปีนี้" หรือ "ส่งออกรายงาน 01/01/2569 - 30/06/2569"',
  EXPORT_INVALID_FORMAT: 'รูปแบบไฟล์ไม่ถูกต้อง กรุณาเลือก PDF หรือ Excel จากปุ่มที่ระบบส่งให้',
  EXPORT_USER_NOT_FOUND: 'ไม่พบบัญชีผู้ใช้ของคุณ กรุณาลองใหม่อีกครั้งภายหลัง',
  EXPORT_GENERATION_FAILED:
    'สร้างรายงานไม่สำเร็จในขณะนี้ กรุณาลองใหม่อีกครั้งภายหลัง หากยังไม่ได้ให้ติดต่อทีมงาน',
};

// Postback data encoding สำหรับปุ่มในข้อความ Preview — Controller ถอดด้วย
// URLSearchParams รูปแบบ "action=<confirm|edit|cancel>&pendingId=<uuid>"
function postbackData(action, pendingId) {
  return `action=${action}&pendingId=${pendingId}`;
}

// Postback data สำหรับปุ่มยืนยัน/ยกเลิก Bulk Import Batch ทั้งก้อน (Phase 3 Round 6)
// พก batchId ตัวเดียวแทน pendingId หลายตัว (กันเกิน Limit ความยาว Postback data
// ของ LINE เมื่อ Batch มีหลายรายการ — ดู migration 008)
function postbackDataBatch(action, batchId) {
  return `action=${action}&batchId=${batchId}`;
}

function formatNumber(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 8 }).format(num);
}

function textLine(text, options = {}) {
  return { type: 'text', text, wrap: true, ...options };
}

// เตือนที่มาของราคาเมื่อมาจาก Price Feed Service (CoinGecko) ไม่ใช่ราคาที่
// User ระบุเอง — CoinGecko เป็น Price Aggregator จึงต่างจาก Exchange ที่ User
// ใช้จริงได้เล็กน้อย (~0.1-0.3%) เป็นเรื่องปกติ แต่ต้องแจ้งไม่ให้เข้าใจผิดว่า
// ระบบมีปัญหา — priceSource === 'user' หรือไม่มี Field นี้ (Backward
// Compatible กับ Caller เดิม) ไม่ต้องแสดงข้อความนี้
function priceSourceNote(priceSource) {
  if (priceSource === 'coingecko') {
    return textLine('* ราคาอ้างอิงจาก CoinGecko อาจคลาดเคลื่อนจาก Exchange ที่คุณใช้เล็กน้อย', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  // Twelve Data (หุ้นสหรัฐ) — Pattern เดียวกับ CoinGecko ข้างต้น
  if (priceSource === 'twelvedata') {
    return textLine('* ราคาอ้างอิงจาก Twelve Data อาจคลาดเคลื่อนจาก Exchange ที่คุณใช้เล็กน้อย', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  // ทองคำ (Phase 3 Round 7) — ราคาอ้างอิงจากสมาคมค้าทองคำฯ ผ่าน API ชุมชน
  // (ไม่ใช่ API ทางการ) อาจล่าช้า/คลาดเคลื่อนจากหน้าร้านได้เล็กน้อย
  if (priceSource === 'thaigold') {
    return textLine('* ราคาอ้างอิงจากสมาคมค้าทองคำฯ (ผ่าน API ชุมชน) อาจคลาดเคลื่อน/ล่าช้าจากหน้าร้านเล็กน้อย', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  // กองทุนรวม (Round 7) — NAV จาก ก.ล.ต. (SEC) อัปเดตวันละครั้ง ราคาที่ใช้อาจเป็น
  // ของวันทำการก่อนหน้า (NAV วันนี้ประกาศตอนเย็น/วันถัดไป)
  if (priceSource === 'secnav') {
    return textLine('* ราคา NAV อ้างอิงจาก ก.ล.ต. (SEC) ล่าสุด อาจเป็นราคาของวันทำการก่อนหน้า', {
      size: 'xs',
      color: COLOR.textSecondary,
    });
  }

  return null;
}

// บรรทัดแสดงราคาอ้างอิง USD ของทอง (Phase 3 Round 7) — ใช้ทั้งใน Preview (goldUsd จาก
// transaction.service) และหน้ากำไร (usd จาก profit.service) รูปแบบ Field ต่างกันเล็กน้อย
// จึงรับเป็น Argument ตรงๆ คืน [] ถ้าไม่มีข้อมูล (เพื่อ Spread เข้า body ได้เสมอ)
function goldUsdLines({ usdThbRate, pricePerUnitUsd, currentPriceUsd, currentValueUsd }) {
  const lines = [];
  const priceUsd = pricePerUnitUsd ?? currentPriceUsd;
  if (priceUsd !== undefined && priceUsd !== null) {
    lines.push(
      textLine(`≈ ${formatNumber(priceUsd)} USD/บาททองคำ (เรต 1 USD = ${formatNumber(usdThbRate)} บาท)`, {
        size: 'xs',
        color: COLOR.textSecondary,
      })
    );
  }
  if (currentValueUsd !== undefined && currentValueUsd !== null) {
    lines.push(
      textLine(`มูลค่าปัจจุบัน ≈ ${formatNumber(currentValueUsd)} USD`, {
        size: 'xs',
        color: COLOR.textSecondary,
      })
    );
  }
  return lines;
}

// Multi-Currency (Round 10): บรรทัด "ยอดเทียบเป็นบาท" สำหรับธุรกรรมสกุล USD —
// fx = { rate, asOf, stale, amountThb } (ยอดเทียบบาทเพื่อแสดงผลเท่านั้น ไม่ได้บันทึก)
// หรือ null ถ้าดึงเรตไม่ได้ → แสดงหมายเหตุว่ายังตีเป็นบาทไม่ได้ (แต่ธุรกรรมยังบันทึกเป็น
// USD ตามจริงไปแล้ว) กำกับเรต + วันที่อ้างอิงเสมอเพื่อความโปร่งใส
function usdFxLines(fx) {
  if (!fx || fx.rate === null || fx.rate === undefined) {
    return [
      textLine('(ยังตีเป็นบาทไม่ได้ — ดึงอัตราแลกเปลี่ยนไม่สำเร็จ)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ];
  }

  const staleTag = fx.stale ? ' (เรตล่าสุดที่มี)' : '';
  const asOfTag = fx.asOf ? ` ณ ${fx.asOf}` : '';
  const lines = [];
  if (fx.amountThb !== undefined && fx.amountThb !== null) {
    lines.push(
      textLine(`≈ ${formatNumber(fx.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
  }
  lines.push(
    textLine(`อัตราแลกเปลี่ยน 1 USD = ${formatNumber(fx.rate)} บาท${asOfTag}${staleTag}`, {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );
  return lines;
}

// วงกลมมาสคอตมุมขวาบนของ Header (feature/mascot-flex-redesign) — url = รูปจาก MASCOT,
// sparkle = true แปะ 09-decoration-sparkle.png มุมขวาบนซ้อนทับด้วย position: 'absolute'
// (เฉพาะการ์ด "ข่าวดี" ตามที่ Founder ระบุ — บันทึกสำเร็จ/บรรลุเป้าหมาย) bg = พื้นหลัง
// วงกลม เลือกจาก MASCOT_BG ให้เข้ากับ headerColor ของการ์ดนั้นๆ (Default: cream)
function mascotAvatar({ url, sparkle = false, bg = MASCOT_BG.cream }) {
  const contents = [{ type: 'image', url, aspectMode: 'cover', size: 'full' }];

  if (sparkle) {
    // ⚠️ Hotfix (2026-08-18): LINE Flex Message Schema ไม่รับ width/height บน
    // Component type: 'image' (รับเฉพาะ box) — เดิมใส่ width/height ผิดตรงนี้ ทำให้
    // Reply API คืน 400 "unknown field .../width" ทุกครั้งที่การ์ดนี้ถูกส่ง (Silent
    // Failure ฝั่งผู้ใช้ ธุรกรรมยัง Commit สำเร็จอยู่แล้วก่อนจุดนี้ — ไม่เกี่ยวกับ Ledger)
    // ใช้ size แทน ซึ่งรองรับค่าพิกเซลตรงๆ เหมือนกัน
    contents.push({
      type: 'image',
      url: MASCOT.decorationSparkle,
      position: 'absolute',
      offsetTop: '-8px',
      offsetEnd: '-8px',
      size: '22px',
    });
  }

  return {
    type: 'box',
    layout: 'vertical',
    width: '56px',
    height: '56px',
    cornerRadius: '28px',
    backgroundColor: bg,
    justifyContent: 'center',
    alignItems: 'center',
    contents,
  };
}

// Header Box ของ Bubble — แยกออกมาจาก bubble() เพื่อให้ Builder ที่ประกอบ Bubble เอง
// นอก bubble() (เช่น buildPremiumStatusMessage ที่มี footer ปุ่มซับซ้อน) เรียกใช้ร่วมกัน
// ได้ ไม่ต้องก็อปโครงสร้าง Header ซ้ำ — ไม่ใส่ mascot = พฤติกรรมเดิมเป๊ะ (Backward Compat
// กับ Bubble ที่ยังไม่ได้ Wire รูปมาสคอตในรอบนี้)
function headerBox(headerText, headerColor, headerBg, mascot) {
  if (!mascot) {
    return {
      type: 'box',
      layout: 'vertical',
      backgroundColor: headerBg,
      paddingAll: '12px',
      contents: [textLine(headerText, { weight: 'bold', color: headerColor })],
    };
  }

  return {
    type: 'box',
    layout: 'horizontal',
    backgroundColor: headerBg,
    paddingAll: '12px',
    cornerRadius: 'lg',
    alignItems: 'center',
    spacing: 'sm',
    contents: [
      {
        type: 'box',
        layout: 'vertical',
        flex: 1,
        justifyContent: 'center',
        contents: [textLine(headerText, { weight: 'bold', color: headerColor })],
      },
      mascotAvatar(mascot),
    ],
  };
}

function bubble({ headerText, headerColor, headerBg, bodyContents, mascot }) {
  return {
    type: 'flex',
    altText: headerText,
    contents: {
      type: 'bubble',
      header: headerBox(headerText, headerColor, headerBg, mascot),
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: bodyContents,
      },
    },
  };
}

function buildBuyConfirmMessage(result) {
  // Multi-Currency (Round 10) — แสดงหน่วยตามสกุลจริงของธุรกรรม (Default THB)
  const unit = result.currency === 'USD' ? 'USD' : 'บาท';
  const body = [
    textLine(result.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine(`จำนวน: ${formatNumber(result.quantity)} ${result.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาต่อหน่วย: ${formatNumber(result.pricePerUnit)} ${unit}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่ารวม: ${formatNumber(result.amountThb)} ${unit}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
  ];

  if (result.newAssetCreated) {
    body.push(textLine('✨ เพิ่มสินทรัพย์ใหม่เข้าพอร์ตแล้ว', { size: 'xs', color: COLOR.info }));
  }

  const note = priceSourceNote(result.priceSource);
  if (note) body.push(note);

  return bubble({
    headerText: '🟢 ยืนยันรายการซื้อ',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: body,
    mascot: { url: MASCOT.successCheer, sparkle: true, bg: MASCOT_BG.mint },
  });
}

function buildSellConfirmMessage(result) {
  // Multi-Currency (Round 10) — แสดงหน่วยตามสกุลจริงของธุรกรรม (Default THB)
  const unit = result.currency === 'USD' ? 'USD' : 'บาท';
  const body = [
    textLine(result.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine(`จำนวน: ${formatNumber(result.quantity)} ${result.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาต่อหน่วย: ${formatNumber(result.pricePerUnit)} ${unit}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่ารวม: ${formatNumber(result.amountThb)} ${unit}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(`คงเหลือ: ${formatNumber(result.remainingQuantity)} ${result.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
  ];

  const note = priceSourceNote(result.priceSource);
  if (note) body.push(note);

  return bubble({
    headerText: '🔴 ยืนยันรายการขาย',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: body,
    mascot: { url: MASCOT.successCheer, sparkle: true, bg: MASCOT_BG.cream },
  });
}

// ข้อความผลกำไร/ขาดทุนของสินทรัพย์ 1 ตัว (คำสั่ง "กำไร") จาก profit.service
// สีเขียว/แดงตามผลกำไร-ขาดทุน (Pattern เดียวกับ Buy/Sell Confirm)
function buildProfitMessage(profit) {
  const isProfit = profit.profitLoss >= 0;
  const plColor = isProfit ? COLOR.profit : COLOR.loss;
  const sign = isProfit ? '+' : '-';
  const plAbs = Math.abs(profit.profitLoss);
  const percentAbs = Math.abs(profit.profitLossPercent);
  // Multi-Currency (Round 10) — หน่วยตามสกุลของสินทรัพย์ (Default THB)
  const unit = profit.currency === 'USD' ? 'USD' : 'บาท';

  const body = [
    textLine(profit.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    // กองทุนรวม (Round 7) — ระบุ Class + วันที่ NAV ที่ใช้คำนวณ (null สำหรับสินทรัพย์อื่น)
    ...(profit.fundClassName
      ? [textLine(`ชนิดหน่วยลงทุน: ${profit.fundClassName}`, { size: 'sm', color: COLOR.info })]
      : []),
    textLine(`จำนวนที่ถือ: ${formatNumber(profit.heldQuantity)} ${profit.symbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ต้นทุนเฉลี่ย: ${formatNumber(profit.averageCost)} ${unit}/หน่วย`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`เงินลงทุน: ${formatNumber(profit.totalInvested)} ${unit}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาปัจจุบัน: ${formatNumber(profit.currentPrice)} ${unit}/หน่วย`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`มูลค่าปัจจุบัน: ${formatNumber(profit.currentValue)} ${unit}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(
      `กำไร/ขาดทุน: ${sign}${formatNumber(plAbs)} ${unit} (${sign}${formatNumber(percentAbs)}%)`,
      { size: 'md', weight: 'bold', color: plColor }
    ),
  ];

  // ทอง (Phase 3 Round 7): แสดงราคา/มูลค่าปัจจุบันเป็น USD คู่กับ THB (profit.usd
  // จาก profit.service — null ถ้าไม่ใช่ทองหรือดึงเรต FX ไม่ได้ → ไม่แสดงบรรทัด USD)
  if (profit.usd) {
    body.push(...goldUsdLines(profit.usd));
  }

  // Multi-Currency (Round 10): สินทรัพย์สกุล USD — แสดง "ยอดเทียบเป็นบาท" (มูลค่า +
  // กำไร/ขาดทุน) จาก profit.fxThb (null ถ้าดึงเรตไม่ได้ → แสดงเฉพาะ USD) + กำกับเรต/วันที่
  if (profit.currency === 'USD') {
    if (profit.fxThb) {
      const plThbAbs = Math.abs(profit.fxThb.profitLossThb);
      body.push(
        textLine(`≈ มูลค่า ${formatNumber(profit.fxThb.currentValueThb)} บาท`, {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
        textLine(`≈ กำไร/ขาดทุน ${sign}${formatNumber(plThbAbs)} บาท`, {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
        textLine(
          `อัตราแลกเปลี่ยน 1 USD = ${formatNumber(profit.fxThb.rate)} บาท` +
            `${profit.fxThb.asOf ? ` ณ ${profit.fxThb.asOf}` : ''}` +
            `${profit.fxThb.stale ? ' (เรตล่าสุดที่มี)' : ''}`,
          { size: 'xs', color: COLOR.textSecondary }
        )
      );
    } else {
      body.push(
        textLine('(ยังตีเป็นบาทไม่ได้ — ดึงอัตราแลกเปลี่ยนไม่สำเร็จ)', {
          size: 'xs',
          color: COLOR.textSecondary,
        })
      );
    }
  }

  const note = priceSourceNote(profit.priceSource);
  if (note) body.push(note);

  return bubble({
    headerText: isProfit ? '📈 กำไร' : '📉 ขาดทุน',
    headerColor: plColor,
    headerBg: isProfit ? COLOR.profitBg : COLOR.lossBg,
    bodyContents: body,
  });
}

function buildErrorMessage(code) {
  const message = ERROR_MESSAGES[code] ?? ERROR_MESSAGES.INTERNAL_ERROR;

  return bubble({
    headerText: '⚠️ ไม่สำเร็จ',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [textLine(message, { size: 'sm', color: COLOR.textPrimary })],
    mascot: { url: MASCOT.errorConcern, bg: MASCOT_BG.cream },
  });
}

// เส้นคั่นบางๆ ระหว่างรายการสินทรัพย์กับสรุปรวม
function separator() {
  return { type: 'separator', margin: 'md' };
}

function buildPortfolioMessage(summary) {
  // พอร์ตว่าง (ไม่มี Asset ที่ยังถืออยู่เลย) — แนะนำให้เริ่มบันทึกรายการแรก
  if (summary.isEmpty) {
    return bubble({
      headerText: '📊 พอร์ตของคุณ',
      headerColor: COLOR.info,
      headerBg: COLOR.profitBg,
      bodyContents: [
        textLine('พอร์ตของคุณยังว่างอยู่', {
          size: 'md',
          weight: 'bold',
          color: COLOR.textPrimary,
        }),
        textLine('เริ่มบันทึกรายการแรกได้เลย เช่น "ซื้อ PTT 50 หุ้น ราคา 34"', {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
      ],
    });
  }

  const body = [];

  summary.holdings.forEach((h) => {
    // Multi-Currency (Round 10) — หน่วยตามสกุลของสินทรัพย์ (Default THB) เหมือน
    // buildProfitMessage/buildHistoryMessage และตาราง Holdings ฝั่งเว็บที่ใช้
    // formatMoneyCur(…, h.currency) — h.currency มาจาก portfolio.service
    const unit = h.currency === 'USD' ? 'USD' : 'บาท';

    body.push(textLine(h.symbol, { size: 'md', weight: 'bold', color: COLOR.textPrimary }));
    body.push(
      textLine(`จำนวน: ${formatNumber(h.heldQuantity)} ${h.symbol}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(
      textLine(
        `ต้นทุนเฉลี่ย: ${h.averageCost === null ? '-' : formatNumber(h.averageCost)} ${unit}/หน่วย`,
        { size: 'sm', color: COLOR.textSecondary }
      )
    );
    body.push(
      textLine(`เงินลงทุน: ${formatNumber(h.totalInvested)} ${unit}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(separator());
  });

  // Multi-Currency (Round 10): ยอดรวมต้องแยกตามสกุล ไม่ถัวข้ามสกุล — Pattern เดียวกับ
  // Dashboard เว็บ (Dashboard.jsx / PortfolioDetailSection.jsx) คือ investedByCurrency
  // จาก portfolio.service เป็นแหล่งจริง ส่วน summary.totalInvested เป็นยอด THB
  // เท่านั้น (portfolio.service.js — คงไว้เพื่อ Backward Compat) จึงใช้ได้แค่เป็น
  // Fallback ของยอด THB สำหรับ Caller เดิมที่ยังไม่ส่ง investedByCurrency มา
  const investedThb = summary.investedByCurrency?.THB ?? summary.totalInvested ?? 0;
  const investedUsd = summary.investedByCurrency?.USD ?? 0;

  const totalLine = (text) =>
    textLine(text, { size: 'md', weight: 'bold', color: COLOR.textPrimary });

  if (investedThb > 0 && investedUsd > 0) {
    // พอร์ตปนสกุล — กำกับสกุลในหัวข้อทั้งสองบรรทัดเพื่อไม่ให้เข้าใจผิดว่าเป็นยอดทั้งพอร์ต
    body.push(totalLine(`รวมเงินลงทุนทั้งพอร์ต (บาท): ${formatNumber(investedThb)} บาท`));
    body.push(totalLine(`รวมเงินลงทุนทั้งพอร์ต (USD): ${formatNumber(investedUsd)} USD`));
  } else if (investedUsd > 0) {
    // พอร์ต USD ล้วน — เดิมโชว์ "0 บาท" เพราะอ่าน totalInvested (ยอด THB) ตรงๆ
    body.push(totalLine(`รวมเงินลงทุนทั้งพอร์ต: ${formatNumber(investedUsd)} USD`));
  } else {
    // พอร์ต THB ล้วน (และเคส 0 ทั้งคู่ — ยังต้องมีบรรทัดนี้ ไม่ปล่อยให้หาย)
    body.push(totalLine(`รวมเงินลงทุนทั้งพอร์ต: ${formatNumber(investedThb)} บาท`));
  }

  // ระบุชัดเจนว่ายังไม่มี Current Value / กำไร-ขาดทุน (ไม่มี Price Feed)
  body.push(
    textLine('* ยังไม่รองรับราคาตลาดปัจจุบัน (Current Value/กำไร-ขาดทุน จะเพิ่มเมื่อมี Price Feed)', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  return bubble({
    headerText: '📊 พอร์ตของคุณ',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

function buildHistoryMessage(transactions) {
  // ไม่มีประวัติเลย — แนะนำให้เริ่มบันทึกรายการแรก
  if (transactions.length === 0) {
    return bubble({
      headerText: '🕒 ประวัติล่าสุด',
      headerColor: COLOR.info,
      headerBg: COLOR.profitBg,
      bodyContents: [
        textLine('ยังไม่มีประวัติธุรกรรม', { size: 'md', weight: 'bold', color: COLOR.textPrimary }),
        textLine('เริ่มบันทึกรายการแรกได้เลย เช่น "ซื้อ PTT 50 หุ้น ราคา 34"', {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
      ],
    });
  }

  const body = [];

  transactions.forEach((tx) => {
    const isBuy = tx.type === 'buy';
    const label = isBuy ? '🟢 ซื้อ' : '🔴 ขาย';
    const color = isBuy ? COLOR.profit : COLOR.loss;
    // Multi-Currency (Round 10) — หน่วยตามสกุลของธุรกรรม (Default THB)
    const unit = tx.currency === 'USD' ? 'USD' : 'บาท';

    body.push(
      textLine(`${label} ${tx.symbol}`, { size: 'md', weight: 'bold', color })
    );
    body.push(
      textLine(
        `จำนวน: ${formatNumber(tx.quantity)} ${tx.symbol} @ ${formatNumber(tx.pricePerUnit)} ${unit}`,
        { size: 'sm', color: COLOR.textSecondary }
      )
    );
    body.push(
      textLine(`มูลค่ารวม: ${formatNumber(tx.amountThb)} ${unit} • ${tx.date}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(separator());
  });

  return bubble({
    headerText: '🕒 ประวัติล่าสุด',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

// ข้อความ Preview พร้อมปุ่ม [ยืนยัน]/[แก้ไข]/[ยกเลิก] (SRS.md § 2.3 [4])
// รับ pending record จาก pendingTransaction.service.createPending
function buildPreviewMessage(pending) {
  const isBuy = pending.commandType === 'buy';
  const headerText = isBuy ? '🟢 ยืนยันการซื้อ' : '🔴 ยืนยันการขาย';
  const headerColor = isBuy ? COLOR.profit : COLOR.loss;
  const headerBg = isBuy ? COLOR.profitBg : COLOR.lossBg;

  // Multi-Currency (Round 10): ธุรกรรมสกุล USD เก็บ "ตามจริง" (ไม่แปลงตอนบันทึก)
  // — แสดงยอดเป็น USD ตามจริง + บรรทัด "≈ บาท" (จาก pending.fx = ยอดเทียบบาทเพื่อ
  // แสดงผลเท่านั้น, null ถ้าดึงเรตไม่ได้ → ไม่แสดงบรรทัดเทียบบาท แต่ยังบันทึกได้)
  const unit = pending.currency === 'USD' ? 'USD' : 'บาท';

  const body = [
    textLine(pending.assetSymbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
  ];

  // กองทุนรวม (Round 7) — ระบุชนิดหน่วยลงทุน (Class) ให้ชัด ไม่ใช่แค่ชื่อย่อดิบ
  if (pending.fundClassName) {
    body.push(
      textLine(`ชนิดหน่วยลงทุน: ${pending.fundClassName}`, { size: 'sm', color: COLOR.info })
    );
  }

  body.push(
    textLine(`จำนวน: ${formatNumber(pending.quantity)} ${pending.assetSymbol}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ราคาต่อหน่วย: ${formatNumber(pending.pricePerUnit)} ${unit}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    })
  );

  // ทอง (Phase 3 Round 7): แสดงราคาต้นทุนอ้างอิงเป็น USD คู่กับ THB (pending.goldUsd
  // จาก transaction.service — null ถ้าไม่ใช่ทองหรือดึงเรต FX ไม่ได้ → ไม่แสดง)
  if (pending.goldUsd) {
    body.push(...goldUsdLines(pending.goldUsd));
  }

  body.push(
    textLine(`มูลค่ารวม: ${formatNumber(pending.amountThb)} ${unit}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    })
  );

  // ยอดเทียบเป็นบาท (เฉพาะสกุล USD ที่ดึงเรตได้) — กำกับเรต + วันที่อ้างอิง
  if (pending.currency === 'USD') {
    body.push(...usdFxLines(pending.fx));
  }

  body.push(
    textLine('ตรวจสอบแล้วกด "ยืนยัน" เพื่อบันทึก (รายการหมดอายุใน 5 นาที)', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  const note = priceSourceNote(pending.priceSource);
  if (note) body.push(note);

  // ปุ่ม action:postback — data ถูกถอดที่ Controller (routePostback)
  // displayText = ข้อความที่แสดงในแชทเสมือนผู้ใช้พิมพ์เอง เมื่อกดปุ่ม
  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: headerColor,
      action: {
        type: 'postback',
        label: '✅ ยืนยัน',
        data: postbackData('confirm', pending.id),
        displayText: 'ยืนยันรายการ',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '✏️ แก้ไข',
        data: postbackData('edit', pending.id),
        displayText: 'แก้ไขรายการ',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ยกเลิก',
        data: postbackData('cancel', pending.id),
        displayText: 'ยกเลิกรายการ',
      },
    },
  ];

  return {
    type: 'flex',
    altText: headerText,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBg,
        paddingAll: '12px',
        contents: [textLine(headerText, { weight: 'bold', color: headerColor })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: body,
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: footerButtons,
      },
    },
  };
}

// ตอบกลับเมื่อผู้ใช้กด "ยกเลิก"
function buildCancelledMessage() {
  return bubble({
    headerText: '❌ ยกเลิกรายการแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('รายการนี้ถูกยกเลิก ไม่มีการบันทึกลงพอร์ตของคุณ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
    ],
  });
}

// ตอบกลับเมื่อผู้ใช้กด "แก้ไข" — Phase นี้ยังไม่มี Stateful Edit Flow จึงให้
// ยกเลิกรายการเดิมแล้วแนะนำให้พิมพ์คำสั่งใหม่พร้อมข้อมูลที่ถูกต้อง
function buildEditHintMessage() {
  return bubble({
    headerText: '✏️ แก้ไขรายการ',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ยกเลิกรายการเดิมแล้ว กรุณาพิมพ์คำสั่งใหม่พร้อมข้อมูลที่ถูกต้อง', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เช่น "ซื้อ PTT 50 หุ้น ราคา 34"', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });
}

// ตอบกลับคำสั่ง "ยกเลิกล่าสุด" (Command History) — แจ้งว่าย้อนรายการเดิมแล้ว
// โดยระบุว่าเป็นการสร้างรายการตรงข้ามชดเชย (ไม่ได้ลบของเดิม) ตาม DATABASE.md § 8
function buildUndoMessage(result) {
  const wasBuy = result.originalType === 'buy';
  const originalLabel = wasBuy ? 'ซื้อ' : 'ขาย';
  const symbol = result.symbol ?? '';

  return bubble({
    headerText: '↩️ ยกเลิกรายการล่าสุดแล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`ย้อนรายการ${originalLabel} ${symbol}`.trim(), {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine(`จำนวน: ${formatNumber(result.quantity)} ${symbol}`.trimEnd(), {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`มูลค่ารวม: ${formatNumber(result.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine('* สร้างรายการตรงข้ามเพื่อชดเชย ประวัติเดิมยังถูกเก็บไว้ครบถ้วน', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── PDPA Express Opt-in Consent (LINE Chat Gate) ────────────────────────────
// ผู้ใช้ที่ยังไม่เคยกดยอมรับ (users.pdpa_consented_at IS NULL — migration 017) จะเจอ
// การ์ดนี้แทนผลลัพธ์ของคำสั่งที่พิมพ์มา จนกว่าจะกด "ยอมรับ" (Gate ฝั่ง LINE Chat คู่กับ
// requireConsent Middleware ฝั่ง Web — ใช้ Field เดียวกัน ยอมรับช่องทางไหนก็นับทั้งคู่)
//
// privacyUrl อาจเป็น null ได้ถ้ายังไม่ได้ตั้ง FRONTEND_URL — กรณีนั้น "ไม่ใส่ปุ่มลิงก์"
// เลย (แทนที่จะใส่ uri ว่างๆ ซึ่งทำให้ LINE ปฏิเสธทั้งข้อความด้วย 400 และผู้ใช้จะไม่เห็น
// อะไรเลย รวมถึงปุ่มยอมรับ = Deadlock) — เนื้อหาสรุปในการ์ดยังอ่านได้ครบโดยไม่ต้องมีลิงก์
function buildPdpaConsentRequiredMessage(privacyUrl) {
  const body = [
    textLine('ก่อนเริ่มใช้งาน EasyDCA เราขอความยินยอมในการเก็บและใช้ข้อมูลของคุณ', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    textLine('• ข้อมูลโปรไฟล์ LINE (ชื่อ/รูป) เพื่อผูกบัญชีของคุณ', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
    textLine('• ข้อมูลการลงทุนที่คุณบันทึกเอง เพื่อคำนวณพอร์ต/กำไร-ขาดทุน', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
    textLine('• คุณขอลบข้อมูลได้ทุกเมื่อ โดยพิมพ์ "ลบข้อมูล"', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
  ];

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '✅ ยอมรับ',
        data: 'action=pdpa_accept',
        displayText: 'ยอมรับนโยบายความเป็นส่วนตัว',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ไม่ยอมรับ',
        data: 'action=pdpa_decline',
        displayText: 'ไม่ยอมรับนโยบายความเป็นส่วนตัว',
      },
    },
  ];

  // ปุ่มอ่านนโยบายฉบับเต็ม — ใส่เฉพาะเมื่อมี URL จริงเท่านั้น (เหตุผลด้านบน)
  if (privacyUrl) {
    footerButtons.unshift({
      type: 'button',
      style: 'link',
      action: { type: 'uri', label: '📄 อ่านนโยบายความเป็นส่วนตัว', uri: privacyUrl },
    });
  }

  return {
    type: 'flex',
    altText: 'กรุณายอมรับนโยบายความเป็นส่วนตัวก่อนเริ่มใช้งาน',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('🔒 ขอความยินยอมก่อนใช้งาน', { weight: 'bold', color: COLOR.info })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// กด "ยอมรับ" สำเร็จ — บอกให้พิมพ์คำสั่งเดิมซ้ำ (คำสั่งต้นฉบับถูก Gate บล็อกไปแล้ว
// ไม่มีการ Auto-retry ให้ — ตั้งใจให้ Flow ตรงไปตรงมา ไม่ต้องเก็บ State ของคำสั่งค้าง)
function buildPdpaConsentAcceptedMessage() {
  return bubble({
    headerText: '✅ ยอมรับเรียบร้อยแล้ว',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ขอบคุณครับ เริ่มใช้งาน EasyDCA ได้เลย', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('กรุณาพิมพ์คำสั่งที่ต้องการอีกครั้ง (เช่น "พอต" ดูพอร์ตของคุณ)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// กด "ไม่ยอมรับ" — ไม่แตะ Database เลย (ยังคง pdpa_consented_at เป็น NULL ต่อไป)
// ผู้ใช้กลับมากด "ยอมรับ" ทีหลังได้เสมอ (Gate จะแสดงการ์ดเดิมซ้ำเมื่อพิมพ์คำสั่งอื่น)
function buildPdpaConsentDeclinedMessage() {
  return bubble({
    headerText: '⚠️ ยังใช้งานไม่ได้',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ต้องยอมรับนโยบายความเป็นส่วนตัวก่อน จึงจะใช้งาน EasyDCA ได้', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('หากเปลี่ยนใจ พิมพ์คำสั่งอะไรก็ได้เพื่อให้ระบบแสดงปุ่มยอมรับอีกครั้ง', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── บัญชีถูกล็อก (Offensive Review Round 2 — F7) ──────────────────────────────
// Parity กับ ACCOUNT_LOCKED ฝั่ง REST (auth.middleware) — ผู้ใช้ที่ถูกล็อกทัก LINE
// เข้ามาต้องได้คำอธิบายสั้นๆ เสมอ ไม่ใช่ Error ดิบหรือเงียบหาย (คนที่ทักแล้วบอตไม่ตอบ
// จะเข้าใจว่าระบบล่มแล้วทักซ้ำเรื่อยๆ ทั้งที่เป็นการกระทำที่เราตั้งใจ)
//
// reason = ข้อความที่ Admin เขียนเองตอนสั่งล็อก (users.lock_reason) — แสดงตรงๆ ได้
// เพราะไม่มีข้อมูลภายในระบบหลุดไปโดยอัตโนมัติ ถ้าไม่มี (แถวเก่าก่อน migration 039
// หรือถูกล็อกด้วยมือผ่าน Supabase Dashboard) ให้ข้ามบรรทัดเหตุผลไปเลย ไม่แสดงคำว่า
// "null"/"ไม่ระบุ" ซึ่งดูเหมือนระบบพัง
function buildAccountLockedMessage(reason) {
  const body = [
    textLine('บัญชีนี้ถูกระงับการใช้งานชั่วคราว', {
      size: 'md',
      weight: 'bold',
      color: COLOR.loss,
    }),
  ];

  if (typeof reason === 'string' && reason.trim()) {
    body.push(
      textLine(`เหตุผล: ${reason.trim()}`, { size: 'sm', color: COLOR.textPrimary, wrap: true })
    );
  }

  body.push(
    textLine('หากคิดว่าเป็นความผิดพลาด กรุณาติดต่อทีมงานเพื่อตรวจสอบ', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  return bubble({
    headerText: '🔒 บัญชีถูกระงับ',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: body,
    mascot: { url: MASCOT.lockedStop, bg: MASCOT_BG.cream },
  });
}

// ── PDPA Self-Service Erasure — คำสั่ง "ลบข้อมูล" (2-Step Confirm) ─────────────
// ขั้นที่ 1: อธิบายผลกระทบให้ชัดเจนก่อนถามยืนยันจริง (Action ย้อนกลับไม่ได้ —
// Pattern 2-Step Confirm เดียวกับ Broadcast/Bulk Import เดิม) hasPendingPayment
// (จาก paymentService.findPendingByUserId ที่ webhook.controller เช็คมาก่อนเรียก
// ฟังก์ชันนี้) เพิ่มคำเตือนพิเศษว่า Admin จะตรวจสอบไม่ได้อีกว่า Payment ที่ค้างอยู่
// เป็นของใคร ถ้ายืนยันลบไปตอนนี้
function buildErasureConfirmMessage(hasPendingPayment) {
  const body = [
    textLine('การกระทำนี้ย้อนกลับไม่ได้', {
      size: 'md',
      weight: 'bold',
      color: COLOR.loss,
    }),
    textLine('• ข้อมูลที่ระบุตัวตนได้ (ชื่อ รูปโปรไฟล์ การเชื่อมต่อ LINE) จะถูกลบถาวร', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    textLine('• ประวัติธุรกรรม/การชำระเงินจะยังถูกเก็บไว้ แต่ไม่ระบุตัวตนอีกต่อไป', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    textLine('• คุณจะไม่สามารถเข้าใช้บัญชีเดิมนี้ได้อีก', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
  ];

  if (hasPendingPayment) {
    body.push(
      textLine(
        '⚠️ คุณมีคำขอชำระเงินที่ยังไม่ได้ตรวจสอบค้างอยู่ — หากลบข้อมูลตอนนี้ ผู้ดูแล' +
          'ระบบจะไม่สามารถตรวจสอบได้อีกว่ารายการนั้นเป็นของคุณ',
        { size: 'xs', color: COLOR.warning }
      )
    );
  }

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.loss,
      action: {
        type: 'postback',
        label: '✅ ยืนยันลบ',
        data: 'action=confirm_erase_data',
        displayText: 'ยืนยันลบข้อมูล',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ยกเลิก',
        data: 'action=cancel_erase_data',
        displayText: 'ยกเลิกการลบข้อมูล',
      },
    },
  ];

  return {
    type: 'flex',
    altText: 'ยืนยันการลบข้อมูล — การกระทำนี้ย้อนกลับไม่ได้',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.lossBg,
        paddingAll: '12px',
        contents: [textLine('🗑️ ยืนยันการลบข้อมูล', { weight: 'bold', color: COLOR.loss })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// ขั้นที่ 2: ตอบกลับหลัง Anonymize สำเร็จจริง (event.replyToken ยังใช้ได้ตามปกติ —
// ผูกกับ Postback Event เดิม ไม่ใช่การค้นหาผู้ใช้ใหม่ผ่าน LINE User ID ที่เพิ่งถูก
// ล้างไป)
function buildDataErasedMessage() {
  return bubble({
    headerText: '✅ ลบข้อมูลเรียบร้อยแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ข้อมูลที่ระบุตัวตนของคุณถูกลบออกจากระบบเรียบร้อยแล้ว', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('หากต้องการใช้งานอีกครั้ง สามารถเริ่มต้นใหม่ได้ทุกเมื่อ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// อธิบายรอบเตือนเป็นข้อความไทย: weekly → "ทุกวันจันทร์", monthly → "ทุกวันที่ 5"
function describeSchedule(reminder) {
  if (reminder.frequency === 'weekly') {
    const dayName = dowToDayName(Number(reminder.dayOfWeek));
    return `ทุกวัน${dayName ?? ''}`.trim();
  }
  return `ทุกวันที่ ${reminder.dayOfMonth}`;
}

// ยืนยันว่าตั้งเตือนสำเร็จ — ย้ำว่าเป็นการเตือนให้มาซื้อเอง ไม่ซื้อให้อัตโนมัติ
// (PROJECT_BRIEF § 17 — ระบบไม่ตัดสินใจ/ทำธุรกรรมลงทุนแทนผู้ใช้)
function buildReminderSetMessage(reminder) {
  return bubble({
    headerText: '⏰ ตั้งเตือน DCA แล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine(reminder.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
      textLine(`รอบเตือน: ${describeSchedule(reminder)}`, { size: 'sm', color: COLOR.textSecondary }),
      textLine(`จำนวนที่ตั้งใจ: ${formatNumber(reminder.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine('* ระบบจะเตือนให้คุณมาพิมพ์คำสั่งซื้อเอง ไม่ได้ซื้อหรือบันทึกให้อัตโนมัติ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// แสดงรายการเตือนที่ Active — ถ้าไม่มีเลยแนะนำให้เริ่มตั้ง
function buildReminderListMessage(reminders) {
  if (!reminders || reminders.length === 0) {
    return bubble({
      headerText: '⏰ การเตือน DCA',
      headerColor: COLOR.info,
      headerBg: COLOR.profitBg,
      bodyContents: [
        textLine('ยังไม่มีการตั้งเตือน', { size: 'md', weight: 'bold', color: COLOR.textPrimary }),
        textLine('เริ่มตั้งได้เลย เช่น "ตั้งเตือน BTC ทุกวันจันทร์ 1000"', {
          size: 'sm',
          color: COLOR.textSecondary,
        }),
      ],
    });
  }

  const body = [];
  reminders.forEach((reminder) => {
    body.push(textLine(reminder.symbol, { size: 'md', weight: 'bold', color: COLOR.textPrimary }));
    body.push(
      textLine(`${describeSchedule(reminder)} • ${formatNumber(reminder.amountThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
    body.push(separator());
  });
  body.push(
    textLine('พิมพ์ "ลบเตือน <ชื่อย่อ>" เพื่อปิดการเตือน', {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  return bubble({
    headerText: '⏰ การเตือน DCA',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: body,
  });
}

// ยืนยันว่าปิด/ลบเตือนสำเร็จ (Soft-delete — ประวัติเดิมยังอยู่)
function buildReminderDeletedMessage(symbol) {
  return bubble({
    headerText: '🔕 ปิดการเตือนแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`ปิดการเตือน DCA ของ ${symbol} เรียบร้อยแล้ว`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('* ประวัติการตั้งเตือนเดิมยังถูกเก็บไว้ (ปิดการใช้งานเท่านั้น)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ข้อความที่ Push จริงตอน Cron ครบกำหนด — bubble() คืน Flex Message Object แบบ
// เดียวกับที่ LINE Push API รับได้ (โครงเดียวกับ Reply) เชิญชวนให้พิมพ์คำสั่งซื้อ
// เอง ไม่มีการซื้ออัตโนมัติ
function buildReminderPushMessage(reminder) {
  return bubble({
    headerText: '⏰ ถึงรอบ DCA แล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine(reminder.symbol, { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
      textLine(`วันนี้ถึงรอบที่คุณตั้งใจ DCA ${reminder.symbol}`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`จำนวนที่ตั้งใจ: ${formatNumber(reminder.amountThb)} บาท`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine(
        `ถ้าซื้อแล้วพิมพ์บันทึกเองได้เลย เช่น "ซื้อ ${reminder.symbol} ${formatNumber(reminder.amountThb)}"`,
        { size: 'sm', color: COLOR.textSecondary }
      ),
      textLine('* นี่เป็นเพียงการแจ้งเตือน ระบบไม่ได้ซื้อหรือบันทึกรายการให้อัตโนมัติ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// DCA Reminder Setup Flow — Quick Reply (แถบปุ่มด้านล่างจอ) หลายขั้นตอน
// ทุกข้อความแนบปุ่ม "❌ ยกเลิก" (Postback action=cancel_reminder_setup) เสมอ
// ให้ผู้ใช้เลิก Flow กลางทางได้ (Requirement ข้อ 5-6)
// ═══════════════════════════════════════════════════════════════════════

// 1 Quick Reply Item แบบ Postback — data ถอดที่ Controller ด้วย URLSearchParams
function quickReplyPostback(label, data, displayText) {
  return {
    type: 'action',
    action: { type: 'postback', label, data, displayText },
  };
}

// ปุ่มยกเลิกที่แนบไปทุกขั้นตอน
function cancelSetupItem() {
  return quickReplyPostback('❌ ยกเลิก', 'action=cancel_reminder_setup', 'ยกเลิกการตั้งเตือน');
}

// ข้อความ Text + Quick Reply — ผนวกปุ่มยกเลิกต่อท้ายเสมอ (LINE จำกัด 13 items/ข้อความ)
function textWithQuickReply(text, items = []) {
  return {
    type: 'text',
    text,
    quickReply: { items: [...items, cancelSetupItem()] },
  };
}

// ── กองทุนรวม (Round 7): เลือกชนิดหน่วยลงทุน (Fund Class) ──────────────────
// Postback พก projId + class + พารามิเตอร์ซื้อเดิม (amt หรือ qty+price) เพื่อให้
// Handler สร้าง Pending ได้โดยไม่ต้องเก็บ Session (LINE Postback ≤ 300 ตัวอักษร
// พอสำหรับ projId + class + ยอด) — Encode ด้วย URLSearchParams (Controller ถอด
// ด้วย URLSearchParams เดียวกัน) รองรับ Class ที่มี "(", ")" ในชื่อ
function fundBuyPostback(action, projId, fundClassName, buy = {}) {
  const p = new URLSearchParams();
  p.set('action', action);
  p.set('projId', projId);
  if (fundClassName) p.set('class', fundClassName);
  if (buy.amountThb !== undefined && buy.amountThb !== null) p.set('amt', String(buy.amountThb));
  if (buy.quantity !== undefined && buy.quantity !== null) p.set('qty', String(buy.quantity));
  if (buy.pricePerUnit !== undefined && buy.pricePerUnit !== null) p.set('price', String(buy.pricePerUnit));
  return p.toString();
}

// project = { projId, projAbbrName, classes: [{ fundClassName, fundClassDetail }] }
// buy = { amountThb } หรือ { quantity, pricePerUnit } (พารามิเตอร์ซื้อจากคำสั่งเดิม)
// แสดงทุก Class + fund_class_detail ประกอบ และปุ่ม "ไม่แน่ใจ / เลือกให้อัตโนมัติ"
// เป็นตัวเลือกสุดท้ายเสมอ (Scope ข้อ 3)
function buildFundClassPickerMessage(project, buy = {}) {
  const classes = (project.classes ?? []).slice(0, 12);

  const items = classes.map((c) => ({
    type: 'action',
    action: {
      type: 'postback',
      label: String(c.fundClassName).slice(0, 20), // LINE label ≤ 20 ตัวอักษร
      data: fundBuyPostback('fund_buy', project.projId, c.fundClassName, buy),
      displayText: `เลือก ${c.fundClassName}`,
    },
  }));

  // ปุ่ม "ไม่แน่ใจ" ท้ายสุด — Handler Auto-select ตาม Priority (ดู mutualFund.service)
  items.push({
    type: 'action',
    action: {
      type: 'postback',
      label: '🤖 ไม่แน่ใจ เลือกให้',
      data: fundBuyPostback('fund_buy_auto', project.projId, null, buy),
      displayText: 'เลือกชนิดหน่วยลงทุนให้อัตโนมัติ',
    },
  });

  const lines = classes
    .map((c) => `• ${c.fundClassName}${c.fundClassDetail ? ` — ${c.fundClassDetail}` : ''}`)
    .join('\n');
  const text =
    `กองทุน ${project.projAbbrName} มีหลายชนิดหน่วยลงทุน กรุณาเลือกชนิดที่ต้องการบันทึกครับ:\n${lines}`;

  return { type: 'text', text, quickReply: { items } };
}

// ไม่พบกองทุนที่ค้นหา (Scope ข้อ 4) — ไม่ทำ Did-you-mean
function buildFundNotFoundMessage(query) {
  return bubble({
    headerText: '🔍 ไม่พบกองทุน',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`ไม่พบกองทุนชื่อย่อ "${query}" ในระบบ`, { size: 'sm', color: COLOR.textPrimary }),
      textLine('กรุณาตรวจสอบชื่อย่อกองทุนให้ถูกต้องอีกครั้ง (เช่น K-SELECT, SCBRM)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── ขั้น 1: เลือก Symbol ที่ถืออยู่ในพอร์ต ────────────────────────────────
// LINE จำกัด 13 items/ข้อความ (รวมปุ่มยกเลิก) — จำกัด Symbol ไว้ 12 ตัว
function buildSymbolQuickReply(symbols) {
  const items = (symbols ?? [])
    .slice(0, 12)
    .map((symbol) =>
      quickReplyPostback(
        String(symbol).slice(0, 20), // LINE label ≤ 20 ตัวอักษร — assets.symbol เป็น TEXT
        // ไม่จำกัดความยาวที่ DB จึงต้อง Slice ที่นี่เอง (Pattern เดียวกับ
        // buildGuidedBuySymbolQuickReply) data/displayText ยังใช้ symbol เต็มเสมอ
        `action=reminder_symbol&symbol=${symbol}`,
        symbol
      )
    );

  return textWithQuickReply('จะตั้งเตือน DCA ให้สินทรัพย์ไหนดีครับ? เลือกจากพอร์ตของคุณได้เลย', items);
}

// ── ขั้น 2: เลือกความถี่ ──────────────────────────────────────────────────
function buildFrequencyQuickReply() {
  const items = [
    quickReplyPostback('รายสัปดาห์', 'action=reminder_freq&frequency=weekly', 'รายสัปดาห์'),
    quickReplyPostback('รายเดือน', 'action=reminder_freq&frequency=monthly', 'รายเดือน'),
  ];

  return textWithQuickReply('ต้องการให้เตือนบ่อยแค่ไหนครับ?', items);
}

// ── ขั้น 3a: เลือกวันในสัปดาห์ (รายสัปดาห์) — 7 วัน ────────────────────────
function buildDayOfWeekQuickReply() {
  const items = THAI_DAY_NAMES.map((dayName, dow) =>
    quickReplyPostback(dayName, `action=reminder_day&dayOfWeek=${dow}`, `วัน${dayName}`)
  );

  return textWithQuickReply('เตือนทุกวันอะไรของสัปดาห์ดีครับ?', items);
}

// ── ขั้น 3b: เลือกวันของเดือน (รายเดือน) — ปุ่มวันยอดนิยม + พิมพ์เองได้ ──────
function buildDayOfMonthQuickReply() {
  const items = [1, 5, 10, 15, 20, 25].map((day) =>
    quickReplyPostback(`วันที่ ${day}`, `action=reminder_day&dayOfMonth=${day}`, `วันที่ ${day}`)
  );

  return textWithQuickReply(
    'เตือนทุกวันที่เท่าไรของเดือนดีครับ? เลือกจากปุ่ม หรือพิมพ์ตัวเลข 1-31 เองก็ได้',
    items
  );
}

// ── ขั้น 4: ขอจำนวนเงิน (พิมพ์เอง — เดาไม่ได้ จึงไม่มีปุ่มตัวเลือก มีแต่ยกเลิก) ─
function buildAskAmountMessage(symbol) {
  return textWithQuickReply(
    `ตั้งใจ DCA ${symbol} ครั้งละกี่บาทครับ? พิมพ์จำนวนเงินมาได้เลย (เช่น 1000)`
  );
}

// ยืนยันว่ายกเลิก Flow ตั้งเตือนแล้ว (กดปุ่มยกเลิกกลางทาง)
function buildReminderSetupCancelledMessage() {
  return bubble({
    headerText: '❌ ยกเลิกการตั้งเตือนแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ยกเลิกขั้นตอนการตั้งเตือน DCA แล้ว ยังไม่มีการบันทึกการเตือนใดๆ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('อยากเริ่มใหม่กดปุ่ม "⏰ ตั้งเตือน DCA" ที่เมนูได้เลย', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Guided Buy Flow (S8 R2 รอบ 2) — บันทึก DCA แบบกดปุ่มทีละขั้น
// ═══════════════════════════════════════════════════════════════════════
// ขั้นตอน: เลือก/พิมพ์ Symbol → เลือก/พิมพ์จำนวนเงิน → การ์ด Preview เดิม
// (buildPreviewMessage + ปุ่ม confirm/cancel ของ Expert Path — ไม่มีปุ่มยืนยันใหม่)
//
// ⚠️ ห้ามใช้ textWithQuickReply() ประกอบข้อความของ Flow นี้เด็ดขาด: helper ตัวนั้น
// ผนวกปุ่ม "❌ ยกเลิก" ที่มี action=cancel_reminder_setup (ของ Flow ตั้งเตือน) ต่อท้าย
// เสมอ — ถ้าหลุดมาอยู่ใน Guided Buy ผู้ใช้กดแล้วจะไปเรียก reminderSetupFlow.cancelFlow
// ทั้งที่ไม่มี Session ตั้งเตือน (Session ของ Guided Buy จะค้างอยู่ต่อ = ยกเลิกไม่ได้จริง)
// นี่คือบั๊กเดียวกับที่เจอใน S8 R2 รอบ 1 จึงมี helper คู่แยกของตัวเองด้านล่าง
//
// ⚠️ ห้ามแนะนำซื้อ/ขายรายตัว: ทุกข้อความในกลุ่มนี้ "ถาม" ว่าผู้ใช้ซื้ออะไรไปแล้ว
// เพื่อบันทึก ไม่มีคำชักชวน/เสนอแนะสินทรัพย์ใดๆ — ปุ่ม Symbol มาจากพอร์ตของผู้ใช้เอง
// เท่านั้น (ไม่ใช่รายการที่ระบบคัดมาแนะนำ) และตัวเลขจำนวนเงินเป็นค่ากลมทั่วไป
const GUIDED_BUY_CANCEL_ACTION = 'cancel_guided_buy';

// ปุ่มยกเลิกเฉพาะของ Guided Buy — action ห้ามซ้ำกับ cancel_reminder_setup
function guidedBuyCancelItem() {
  return quickReplyPostback('❌ ยกเลิก', `action=${GUIDED_BUY_CANCEL_ACTION}`, 'ยกเลิกการบันทึก');
}

// คู่แฝดของ textWithQuickReply สำหรับ Flow นี้ (ผนวกปุ่มยกเลิกของ Guided Buy แทน)
function guidedBuyTextWithQuickReply(text, items = []) {
  return {
    type: 'text',
    text,
    quickReply: { items: [...items, guidedBuyCancelItem()] },
  };
}

// ── ขั้น 1: เลือกสินทรัพย์ ────────────────────────────────────────────────
// symbols = Symbol ที่ผู้ใช้ "ถืออยู่จริงในพอร์ตตัวเอง" (guidedBuyFlow.startFlow
// จำกัดมาแล้วไม่เกิน 11 ตัว) — ไม่ใช่รายการแนะนำจากระบบ
// LINE จำกัด 13 items/ข้อความ: 11 Symbol + "พิมพ์ชื่อเอง" + "ยกเลิก" = 13 พอดี
// พอร์ตว่าง (ซื้อครั้งแรก) → ไม่มีปุ่ม Symbol เลย เหลือ "พิมพ์ชื่อเอง" เป็นทางเดียว
function buildGuidedBuySymbolQuickReply(symbols) {
  const list = (symbols ?? []).slice(0, 11);

  const items = list.map((symbol) =>
    quickReplyPostback(
      String(symbol).slice(0, 20), // LINE label ≤ 20 ตัวอักษร
      `action=gbuy_symbol&sym=${encodeURIComponent(symbol)}`,
      symbol
    )
  );

  items.push(quickReplyPostback('✏️ พิมพ์ชื่อเอง', 'action=gbuy_symbol_manual', 'พิมพ์ชื่อเอง'));

  const text =
    list.length > 0
      ? 'บันทึกการซื้อของสินทรัพย์ไหนครับ? เลือกจากพอร์ตของคุณ หรือกด "พิมพ์ชื่อเอง"'
      : 'บันทึกการซื้อของสินทรัพย์ไหนครับ? พิมพ์ชื่อย่อมาได้เลย (เช่น BTC, PTT, AAPL)';

  return guidedBuyTextWithQuickReply(text, items);
}

// ผู้ใช้กด "พิมพ์ชื่อเอง" — ชวนพิมพ์ชื่อย่อ (ยังอยู่ขั้น AWAITING_SYMBOL)
//
// ⚠️ ตัดตัวอย่าง "K-SELECT" (กองทุนรวม) ออกจากตัวอย่างชั่วคราว — ฟีเจอร์ค้นกองทุน
// ด้วยชื่อ (Round 7) ยังใช้งานจริงไม่ได้เลยตั้งแต่สร้างระบบ เพราะไม่เคย Config
// SEC_API_SUBSCRIPTION_KEY บน Production (ดู tryResolveFundBuy ใน
// webhook.controller.js) การแนะนำตัวอย่างนี้ให้ User โดยตรงจะยิ่งพา User ไปเจอ
// Error "ระบบยังไม่พร้อมใช้งาน" ทั้งที่ไม่ได้พิมพ์ผิดเลย — เอากลับมาใส่ได้เมื่อสมัคร
// SEC API สำเร็จแล้ว (แยกงานคนละชุด)
function buildGuidedBuyAskSymbolMessage() {
  return guidedBuyTextWithQuickReply(
    'พิมพ์ชื่อย่อสินทรัพย์ที่ต้องการบันทึกมาได้เลยครับ (เช่น BTC, PTT, AAPL)'
  );
}

// ── ขั้น 2: จำนวนเงิน — Amount Chips (บาท + USD) + กำหนดเอง ────────────────
// Multi-Currency (S8 R2 รอบ 3): สกุลเงินอยู่ "ในปุ่มจำนวนเงิน" ไม่ใช่ขั้นแยก —
// Postback พก cur=USD ไปพร้อมยอดเลย จึงไม่ต้องเก็บสกุลใน guided_buy_sessions
// (ขั้นนี้เป็นขั้นสุดท้าย ได้ค่ามาแล้วใช้ต่อทันทีในคำขอเดียว เหตุผลเดียวกับที่
// migration 022 ไม่เก็บจำนวนเงินไว้ใน Session) = ไม่ต้องมี Migration ใหม่
//
// ปุ่ม USD แสดง "เฉพาะสินทรัพย์ที่มีราคา USD จริง" (crypto/stock_us ตัดสินโดย
// guidedBuyFlow.isUsdSupported ที่ Reuse Single Source เดียวกับฝั่งเว็บ) —
// สินทรัพย์อื่น (หุ้นไทย/ทอง/กองทุน) เห็นปุ่มชุดเดิมเป๊ะ ไม่มีอะไรเปลี่ยน
const GUIDED_BUY_AMOUNT_CHIPS = [500, 1000, 3000, 5000];

// ⚠️ เลขกลม USD ตามชุดที่รอบก่อนระบุไว้ว่าจะใช้ (50/100/300/500) — "ไม่ใช่" ยอดบาท
// ที่แปลงด้วยเรต เพราะเรตขึ้นลงทุกวันปุ่มจะเพี้ยนตาม และป้ายกำกับต้องแยกสกุลชัดเจน
// ("$100" vs "1,000 บาท") กันผู้ใช้กดผิดสกุล — เป็นบทเรียนเดียวกับฟอร์มเว็บ
// (DcaForm.jsx) ที่เลือก "ซ่อน" Chips บาทตอนสลับ USD เพราะกลัวกด 10,000 คิดว่าบาท
const GUIDED_BUY_USD_AMOUNT_CHIPS = [50, 100, 300, 500];

// LINE จำกัด 13 items/ข้อความ — กรณีเปิด USD: 4 บาท + 4 USD + กำหนดเอง + ยกเลิก = 10
function buildGuidedBuyAmountQuickReply(symbol, { usdSupported = false } = {}) {
  const items = GUIDED_BUY_AMOUNT_CHIPS.map((amount) =>
    quickReplyPostback(
      `${formatNumber(amount)} บาท`,
      `action=gbuy_amount&amt=${amount}`,
      `${formatNumber(amount)} บาท`
    )
  );

  if (usdSupported) {
    items.push(
      ...GUIDED_BUY_USD_AMOUNT_CHIPS.map((amount) =>
        quickReplyPostback(
          `$${formatNumber(amount)}`,
          `action=gbuy_amount&amt=${amount}&cur=USD`,
          `${formatNumber(amount)} USD`
        )
      )
    );
  }

  items.push(quickReplyPostback('✏️ กำหนดเอง', 'action=gbuy_amount_manual', 'กำหนดเอง'));

  return guidedBuyTextWithQuickReply(
    usdSupported
      ? `บันทึกซื้อ ${symbol} เป็นเงินเท่าไรครับ? เลือกจากปุ่ม (บาท หรือ USD) หรือกด "กำหนดเอง" เพื่อพิมพ์เอง`
      : `บันทึกซื้อ ${symbol} เป็นเงินกี่บาทครับ? เลือกจากปุ่ม หรือกด "กำหนดเอง" เพื่อพิมพ์เอง`,
    items
  );
}

// ผู้ใช้กด "กำหนดเอง" — ชวนพิมพ์ตัวเลข (ยังอยู่ขั้น AWAITING_AMOUNT)
// สินทรัพย์ที่รองรับ USD: บอกวิธีพิมพ์สกุลด้วย ("100 usd") — คำเดียวกับที่ Expert Path
// รองรับอยู่แล้ว ไม่มี Suffix = บาท (Default เดิม)
function buildGuidedBuyAskAmountMessage(symbol, { usdSupported = false } = {}) {
  return guidedBuyTextWithQuickReply(
    usdSupported
      ? `พิมพ์จำนวนเงินที่ซื้อ ${symbol} มาได้เลยครับ — หน่วยเป็นบาท (เช่น 1500) หรือต่อท้ายว่า usd ถ้าเป็นดอลลาร์ (เช่น 100 usd)`
      : `พิมพ์จำนวนเงินที่ซื้อ ${symbol} มาได้เลยครับ (เช่น 1500) หน่วยเป็นบาท`
  );
}

// ยืนยันว่ายกเลิก Guided Buy แล้ว (กดปุ่มยกเลิกกลางทาง) — ต้องบอกชัดว่า
// "ยังไม่มีการบันทึกรายการใดๆ" เพราะ Flow นี้เกี่ยวกับเงินโดยตรง
function buildGuidedBuyCancelledMessage() {
  return bubble({
    headerText: '❌ ยกเลิกการบันทึกแล้ว',
    headerColor: COLOR.textSecondary,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ยกเลิกขั้นตอนบันทึก DCA แล้ว ยังไม่มีรายการใดถูกบันทึกลงพอร์ต', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('อยากเริ่มใหม่กดปุ่ม "📈 บันทึก DCA" ที่เมนูได้เลย', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Session ชนกันตอน "เริ่ม" Flow (ตัดสินใจ: บล็อก ไม่เขียนทับเงียบๆ) ─────────
// ผู้ใช้มี Session ของ Flow อื่นค้างอยู่ (ตั้งเตือน DCA / นำเข้าพอร์ต) แล้วกด
// "บันทึก DCA" — บอกให้รู้ตัวว่ามีอะไรค้าง แล้วให้ "ผู้ใช้เลือกเอง" ว่าจะทิ้งของเดิม
// (ปุ่ม) หรือกลับไปทำต่อให้จบ (ไม่กดอะไร รอ 5 นาที Session หมดอายุเองก็ได้)
//
// ปุ่มนี้ใช้ action=gbuy_force_start ของตัวเอง ไม่ Reuse cancel_reminder_setup /
// cancel_bulk_import (ซึ่งยกเลิกได้แค่ทีละ Flow และไม่เริ่ม Guided Buy ต่อให้)
function buildGuidedBuyBusyMessage(kind) {
  const label = kind === 'bulk_import' ? 'นำเข้าพอร์ต' : 'ตั้งเตือน DCA';

  return {
    type: 'text',
    text:
      `ตอนนี้คุณมีขั้นตอน "${label}" ค้างอยู่ครับ 🙏\n` +
      'ทำให้จบก่อนได้เลย หรือถ้าไม่เอาแล้ว กดปุ่มด้านล่างเพื่อทิ้งของเดิมแล้วเริ่มบันทึก DCA ใหม่',
    quickReply: {
      items: [
        // Bug Fix: Label เดิม '🔄 ทิ้งของเดิม เริ่มบันทึก DCA' ยาว 29 ตัวอักษร เกิน
        // Limit 20 ตัวของ LINE (quickReply.items[].action.label) ทำให้ Reply ทั้ง
        // ข้อความถูกปฏิเสธ 400 เงียบๆ (Log ฝั่ง Server เท่านั้น ผู้ใช้ไม่เห็นอะไรเลย)
        // — displayText/ข้อความเต็มยังคงความหมายเดิมไว้ (Label สั้นแค่ปุ่มเท่านั้น)
        quickReplyPostback(
          '🔄 เริ่มบันทึกใหม่',
          'action=gbuy_force_start',
          'เริ่มบันทึก DCA ใหม่'
        ),
      ],
    },
  };
}

// ข้อความ Push สรุปพอร์ตรายสัปดาห์/รายเดือน (portfolioSummary.job) — bubble()
// คืน Flex Message Object แบบเดียวกับที่ LINE Push API รับได้ ใช้ Pattern สี
// เขียว/แดงตามกำไร-ขาดทุนเหมือน buildProfitMessage
function buildPortfolioSummaryPushMessage(summary) {
  const isMonthly = summary.periodLabel === 'monthly';
  const headerText = isMonthly ? '📊 สรุปพอร์ตประจำเดือน' : '📊 สรุปพอร์ตประจำสัปดาห์';

  const isProfit = summary.totalProfitLoss >= 0;
  const plColor = isProfit ? COLOR.profit : COLOR.loss;
  const sign = isProfit ? '+' : '-';
  const plAbs = Math.abs(summary.totalProfitLoss);

  // Multi-Currency (Round 10): เงินลงทุนรวมต้องแยกตามสกุล ไม่ถัวข้ามสกุล (Pattern
  // เดียวกับ buildPortfolioMessage) — totalInvestedAllAssets เป็นยอด THB เท่านั้น
  // (portfolioSummary.service ส่งต่อ portfolio.service.totalInvested ที่คงไว้เพื่อ
  // Backward Compat) ส่วนยอดสกุล USD อ่านจาก summary.byCurrency
  // หมายเหตุ: byCurrency นับเฉพาะ Asset ที่ดึงราคาได้ ต่างจาก totalInvestedAllAssets
  // ที่นับทุก Asset — บรรทัด excludedCount ด้านล่างบอก User อยู่แล้วว่ามี Asset ที่ไม่ถูกนับ
  const investedThb = summary.totalInvestedAllAssets ?? 0;
  const investedUsd = summary.byCurrency?.USD?.invested ?? 0;
  const hasUsd = investedUsd > 0;

  const investedLines = [];
  if (investedThb > 0 && hasUsd) {
    investedLines.push(
      textLine(`เงินลงทุนรวมทั้งพอร์ต (บาท): ${formatNumber(investedThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`เงินลงทุนรวมทั้งพอร์ต (USD): ${formatNumber(investedUsd)} USD`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
  } else if (hasUsd) {
    // พอร์ต USD ล้วน — เดิมโชว์ "0 บาท" เพราะอ่าน totalInvestedAllAssets (ยอด THB) ตรงๆ
    investedLines.push(
      textLine(`เงินลงทุนรวมทั้งพอร์ต: ${formatNumber(investedUsd)} USD`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
  } else {
    investedLines.push(
      textLine(`เงินลงทุนรวมทั้งพอร์ต: ${formatNumber(investedThb)} บาท`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );
  }

  // มูลค่า/กำไร-ขาดทุนรวมเป็นยอด "เทียบบาท" (แปลง USD ด้วยเรตเดียวใน portfolioSummary
  // .service) — กำกับ (เทียบบาท) เมื่อมีส่วน USD เพื่อไม่ให้เข้าใจผิดว่าเป็นยอด THB ล้วน
  // (Pattern เดียวกับ reportExport.service ที่ใช้ 'รวมทั้งพอร์ต (เทียบบาท)')
  const thbEquivSuffix = hasUsd ? ' (เทียบบาท)' : '';

  // percent เป็น null เมื่อไม่มี Asset ที่มีราคาเลย (หารด้วยศูนย์) → แสดงเฉพาะจำนวนเงิน
  const plText =
    summary.totalProfitLossPercent === null
      ? `กำไร/ขาดทุนรวม${thbEquivSuffix}: ${sign}${formatNumber(plAbs)} บาท`
      : `กำไร/ขาดทุนรวม${thbEquivSuffix}: ${sign}${formatNumber(plAbs)} บาท (${sign}${formatNumber(
          Math.abs(summary.totalProfitLossPercent)
        )}%)`;

  const body = [
    ...investedLines,
    textLine(`มูลค่าปัจจุบันรวม${thbEquivSuffix}: ${formatNumber(summary.totalCurrentValue)} บาท`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(plText, { size: 'md', weight: 'bold', color: plColor }),
  ];

  // มี Asset ที่ยังไม่มีราคาตลาด (เช่นหุ้นไทย) — บอกชัดว่าตัวเลขกำไร/ขาดทุน
  // ไม่ได้รวมทั้งพอร์ต เพื่อไม่ให้ User เข้าใจผิด
  if (summary.excludedCount > 0) {
    body.push(
      textLine(
        `* ไม่รวม ${summary.excludedCount} สินทรัพย์ที่ยังไม่มีราคาตลาด (เช่น หุ้นไทย) ตัวเลขนี้จึงไม่ใช่ทั้งพอร์ต`,
        { size: 'xs', color: COLOR.textSecondary }
      )
    );
  }

  // Multi-Currency (Round 10): กำกับเรตที่ใช้แปลงยอด "เทียบบาท" (Pattern เดียวกับ
  // buildProfitMessage) — และถ้ามีส่วน USD แต่ดึงเรตไม่ได้ (fxUnavailableForUsd)
  // ต้องบอกตรงๆ ว่ายอดเทียบบาทยังไม่รวมส่วนนั้น ไม่ปล่อยให้ User เข้าใจว่าครบแล้ว
  if (summary.fxUnavailableForUsd) {
    body.push(
      textLine('* ยังตีส่วนสกุล USD เป็นบาทไม่ได้ (ดึงอัตราแลกเปลี่ยนไม่สำเร็จ) ยอดเทียบบาทจึงยังไม่รวมส่วนนี้', {
        size: 'xs',
        color: COLOR.textSecondary,
      })
    );
  } else if (hasUsd && summary.fxRate) {
    body.push(
      textLine(
        `อัตราแลกเปลี่ยน 1 USD = ${formatNumber(summary.fxRate)} บาท` +
          `${summary.fxAsOf ? ` ณ ${summary.fxAsOf}` : ''}` +
          `${summary.fxStale ? ' (เรตล่าสุดที่มี)' : ''}`,
        { size: 'xs', color: COLOR.textSecondary }
      )
    );
  }

  return bubble({
    headerText,
    headerColor: plColor,
    headerBg: isProfit ? COLOR.profitBg : COLOR.lossBg,
    bodyContents: body,
    mascot: {
      url: isProfit ? MASCOT.portfolioUp : MASCOT.portfolioDown,
      bg: isProfit ? MASCOT_BG.mint : MASCOT_BG.cream,
    },
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Payment (Phase 2 Step 3 — Premium ผ่าน PromptPay QR + Admin Approval)
// ═══════════════════════════════════════════════════════════════════════

// รอบบิลเป็นข้อความไทย
function billingLabel(billingPeriod) {
  return billingPeriod === 'yearly' ? 'รายปี' : 'รายเดือน';
}

// จัดรูปวันหมดอายุเป็น YYYY-MM-DD ตามเขตเวลา Asia/Bangkok (Pattern เดียวกับ
// todayInBangkok ใน transaction.service) — รับได้ทั้ง Date และ ISO string
function formatDateBangkok(value) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date(value));
}

// ── Push หา Admin: มีคำขอชำระเงินใหม่ พร้อมปุ่มอนุมัติ/ปฏิเสธ ────────────────
// ปุ่ม Postback encode paymentId (คนละ Key กับ pendingId ของ Flow ซื้อ/ขาย)
// Controller (routePostback) ถอดด้วย URLSearchParams action=approve_payment/reject_payment
//
// qrImageUrl (Lock-Until-Resolved, migration 016): URL รูป QR ที่ Render สดจาก
// GET /api/v1/payment/:id/qr.png (payment.service.buildQrImageUrl) — ตัวเดียวกับที่
// การ์ด QR ของผู้ใช้ใช้ (Deterministic จาก payment.amountThb ใน DB) แทนที่จะให้ผู้ใช้
// ต้อง Forward รูป QR กลับมาเอง (Screenshot ไม่มีทางยืนยันได้ว่าตรงจริง) — Admin จึง
// เทียบ QR + สลิปคู่กันได้ในการ์ดเดียว ไม่ต้องเพิ่ม Flow ฝั่งผู้ใช้เลย แสดงเสมอ (ทุกคำขอ
// pending มี QR ที่ Render ได้แน่นอน) ต่างจากสลิป (Hero ด้านล่าง) ที่ยังอาจไม่มีก็ได้
function buildAdminPaymentRequestMessage(payment, userDisplayName, qrImageUrl) {
  const body = [
    {
      type: 'image',
      url: qrImageUrl,
      size: 'full',
      aspectMode: 'fit',
      aspectRatio: '1:1',
      action: { type: 'uri', label: 'ดู QR', uri: qrImageUrl },
    },
    textLine(`ผู้ใช้: ${userDisplayName ?? '-'}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`แพ็กเกจ: Premium (${billingLabel(payment.billingPeriod)})`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    textLine(`ยอดที่ต้องได้รับ: ${formatNumber(payment.amountThb)} บาท`, {
      size: 'lg',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('* ตรวจยอดในบัญชีให้ตรงเป๊ะ (รวมเศษสตางค์) ก่อนกดอนุมัติ', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
  ];

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '✅ อนุมัติ',
        data: `action=approve_payment&paymentId=${payment.id}`,
        displayText: 'อนุมัติการชำระเงิน',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ปฏิเสธ',
        data: `action=reject_payment&paymentId=${payment.id}`,
        displayText: 'ปฏิเสธการชำระเงิน',
      },
    },
  ];

  const contents = {
    type: 'bubble',
    header: {
      type: 'box',
      layout: 'vertical',
      backgroundColor: COLOR.warningBg,
      paddingAll: '12px',
      contents: [textLine('💰 คำขอชำระเงินใหม่', { weight: 'bold', color: COLOR.warning })],
    },
    body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
    footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
  };

  // แนบรูปสลิปเป็น Hero ถ้าผู้ใช้ส่งมาแล้ว (slip_image_url ถูกเซฟจาก Image Handler) —
  // แตะรูปเพื่อเปิดเต็มใน Browser ได้ (uri action) ช่วย Admin ตรวจยอดก่อนกดอนุมัติ
  // ถ้ายังไม่มีสลิป (ผู้ใช้กดแจ้งชำระก่อนส่งรูป) ก็ไม่แนบ Hero — Flow เดิมทำงานปกติ
  if (payment.slipImageUrl) {
    contents.hero = {
      type: 'image',
      url: payment.slipImageUrl,
      size: 'full',
      aspectMode: 'fit',
      aspectRatio: '3:4',
      action: { type: 'uri', label: 'ดูสลิป', uri: payment.slipImageUrl },
    };
  }

  return {
    type: 'flex',
    altText: `คำขอชำระเงินใหม่ ${formatNumber(payment.amountThb)} บาท`,
    contents,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// ติดต่อ Admin/Support (ก่อนเปิด Closed Beta Wave 1)
// ═══════════════════════════════════════════════════════════════════════
// ⚠️ Pivot จาก LINE Chat Inline (พิมพ์ Trigger → ถามข้อความในแชทตรงๆ — Migration
// 024) เป็นหน้าเว็บ /support แยกต่างหาก เพราะ Webhook ตอบอัตโนมัติชนกับตอน Admin
// เข้าไปตอบมือใน LINE Chat Mode เดียวกัน (Bot ทับคำตอบของ Admin) — LINE Chat ฝั่ง
// เดิมตอนนี้แค่พิมพ์ Trigger แล้วได้ Link ไปหน้าเว็บทันที (ดู buildSupportLinkMessage)
// Builder ที่เหลือด้านล่างใช้ตอน Submit จากหน้าเว็บ (support.controller.js)

// เวลาแบบไทย "DD MMM YYYY HH:mm น." (Asia/Bangkok) — formatThaiDate ให้แค่วันที่
// จึงต่อเวลาเองที่นี่ (เฉพาะจุดนี้ที่ต้องโชว์เวลานาที ไม่ใช่แค่วันที่เหมือนที่อื่น)
function formatThaiDateTime(value) {
  const timePart = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value));
  return `${formatThaiDate(value)} ${timePart} น.`;
}

// ป้ายชื่อหมวดปัญหา (ตรงกับ supportRequestFlow.CATEGORIES) — ใช้แสดงบนการ์ด Admin
const SUPPORT_CATEGORY_LABELS = {
  payment_premium: 'ปัญหาชำระเงิน/Premium',
  ocr: 'OCR อ่านสลิปผิด',
  portfolio_ledger: 'ข้อมูลพอร์ต/Ledger ผิด',
  other: 'อื่นๆ',
};

// ── Push หา Admin: มีข้อความติดต่อใหม่ (ข้อมูล ไม่มีปุ่ม Action — ต่างจากคำขอชำระเงิน
// ที่ต้องอนุมัติ/ปฏิเสธ Admin ตอบกลับ User เองนอกระบบ) ─────────────────────────
// category อาจเป็น null (แถวเก่าก่อน Migration 026 ไม่มีหมวด) → ไม่แสดงบรรทัดนี้เลย
function buildAdminSupportRequestMessage(user, message, timestamp, category = null) {
  const body = [
    textLine(`ผู้ใช้: ${user.displayName ?? '-'}`, { size: 'sm', color: COLOR.textSecondary }),
    textLine(`LINE User ID: ${user.lineUserId}`, { size: 'xs', color: COLOR.textSecondary }),
    textLine(`เวลา: ${formatThaiDateTime(timestamp)}`, { size: 'xs', color: COLOR.textSecondary }),
  ];
  if (category && SUPPORT_CATEGORY_LABELS[category]) {
    body.push(
      textLine(`หมวด: ${SUPPORT_CATEGORY_LABELS[category]}`, { size: 'xs', color: COLOR.textSecondary })
    );
  }
  body.push(separator(), textLine(message, { size: 'sm', color: COLOR.textPrimary, wrap: true }));

  return bubble({
    headerText: '🆘 มีข้อความติดต่อใหม่',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: body,
  });
}

// ── Trigger ในแชท LINE → ตอบ Link ไปหน้าเว็บ /support ทันที (Pattern เดียวกับ
// buildDashboardLinkMessage) ไม่มี Session/Push ฝั่ง LINE อีกต่อไป ─────────────
function buildSupportLinkMessage(supportUrl) {
  return {
    type: 'flex',
    altText: 'ติดต่อทีมงาน',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.warningBg,
        paddingAll: '12px',
        contents: [textLine('🆘 ติดต่อทีมงาน', { weight: 'bold', color: COLOR.warning })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          textLine('แจ้งปัญหาหรือติดต่อทีมงานได้ที่หน้าเว็บนี้เลยครับ', {
            size: 'sm',
            color: COLOR.textPrimary,
            wrap: true,
          }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLOR.warning,
            action: { type: 'uri', label: 'ไปหน้าติดต่อทีมงาน', uri: supportUrl },
          },
        ],
      },
    },
  };
}

// ── Reply ยืนยันกับ Admin หลังอนุมัติสำเร็จ ───────────────────────────────
function buildAdminApproveAckMessage(payment, newExpiry) {
  return bubble({
    headerText: '✅ อนุมัติแล้ว',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine(`ยอด ${formatNumber(payment.amountThb)} บาท (${billingLabel(payment.billingPeriod)})`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`ต่ออายุ Premium ให้ผู้ใช้ถึง ${formatDateBangkok(newExpiry)} แล้ว`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Reply ยืนยันกับ Admin หลังปฏิเสธสำเร็จ ─────────────────────────────────
function buildAdminRejectAckMessage(payment) {
  return bubble({
    headerText: '❌ ปฏิเสธแล้ว',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: [
      textLine(`ปฏิเสธคำขอยอด ${formatNumber(payment.amountThb)} บาทแล้ว`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('ไม่มีการเปลี่ยนแปลงสิทธิ์ของผู้ใช้', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Push หาผู้ใช้: อนุมัติสำเร็จ Premium ใช้งานได้ ─────────────────────────
function buildPaymentApprovedMessage(payment, newExpiry) {
  return bubble({
    headerText: '🎉 อัพเกรด Premium สำเร็จ',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ขอบคุณที่สนับสนุน EasyDCA! บัญชีของคุณเป็น Premium แล้ว', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`ใช้งาน Premium ได้ถึง: ${formatDateBangkok(newExpiry)}`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine('* บันทึกสินทรัพย์ได้ไม่จำกัดแล้ว', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
    mascot: { url: MASCOT.achievementTrophy, sparkle: true, bg: MASCOT_BG.mint },
  });
}

// ── Push หาผู้ใช้: คำขอถูกปฏิเสธ ───────────────────────────────────────────
function buildPaymentRejectedMessage(payment) {
  return bubble({
    headerText: '⚠️ คำขอชำระเงินไม่ผ่าน',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine(`คำขอ Premium (${billingLabel(payment.billingPeriod)}) ยอด ${formatNumber(payment.amountThb)} บาท ไม่ผ่านการตรวจสอบ`, {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('อาจเกิดจากยอดโอนไม่ตรงหรือสลิปไม่ชัด กรุณาลองทำรายการใหม่อีกครั้ง หากคิดว่าผิดพลาดติดต่อทีมงานได้เลย', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ── Push หาผู้ใช้: กดรับ Free Trial สำเร็จ (self-service, ดู freeTrial.service) ──
// รูปแบบเดียวกับ buildPaymentApprovedMessage (Header สีเขียว/โทนเดียวกัน) ต่างกันที่
// 1) มีวันเริ่มด้วย (Payment จริงไม่ต้องบอกวันเริ่มเพราะเริ่มทันที/ต่อจากวันหมดอายุเดิม
//    ซึ่งผู้ใช้รู้อยู่แล้ว ส่วน Free Trial ผู้ใช้อาจอยากรู้ชัดว่านับจากวันนี้)
// 2) มีปุ่มลิงก์ไปหน้า /premium (Pattern เดียวกับ buildPremiumExpiringSoonMessage —
//    ใช้ URL ผ่านภายนอก Browser จาก externalUrl.util ไม่ใช่ liff.line.me) ให้กดต่ออายุ
//    ตอนหมดอายุได้ทันทีจากข้อความนี้เลย ไม่ต้องหาทางกลับไปหน้า Premium เอง
// premiumUrl เป็น null ได้ (ยังไม่ได้ตั้ง FRONTEND_URL) → ไม่ใส่ปุ่ม แต่ยัง Push ได้ปกติ
function buildFreeTrialClaimedMessage(claimedAt, expiresAt, premiumUrl) {
  const message = bubble({
    headerText: '🎁 รับ Premium ฟรี 1 เดือนสำเร็จ',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('บัญชีของคุณเป็น Premium แล้ว ใช้งานได้เต็มรูปแบบ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(`เริ่มใช้งาน: ${formatDateBangkok(claimedAt)}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`ใช้งาน Premium ได้ถึง: ${formatDateBangkok(expiresAt)}`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine('หากต้องการใช้ต่อหลังหมดอายุ ต่ออายุได้ผ่านเว็บ Dashboard', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });

  if (premiumUrl) {
    message.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.profit,
          action: { type: 'uri', label: '👑 ไปที่ Dashboard', uri: premiumUrl },
        },
      ],
    };
  }

  return message;
}

// ── Push หา Admin: มีคำขอ Premium ฟรี (Like Facebook) ใหม่รอตรวจ ──────────────
// จงใจ "ไม่มีปุ่ม Approve/Reject" ในการ์ดนี้ (ต่างจาก buildAdminPaymentRequestMessage
// ที่มี Postback อนุมัติในตัว) — Admin ต้องเปิดดู Screenshot ก่อนตัดสินเสมอ ซึ่งการ์ด
// LINE แสดงรูปจาก Private Bucket ไม่ได้ (ต้อง Signed URL ที่หมดอายุใน 5 นาที) จึงส่ง
// เป็น "แจ้งเตือน + ลิงก์ไปหน้า Admin" แทน กัน Admin เผลอกดอนุมัติโดยไม่ได้ดูรูปจริง
//
// adminUrl = null ได้ (ยังไม่ได้ตั้ง FRONTEND_URL) → การ์ดไม่มีปุ่ม แต่ยังแจ้งได้
function buildAdminFacebookLikeRequestMessage(user, message, timestamp, adminUrl) {
  const body = [
    textLine(`ผู้ใช้: ${user.displayName ?? '-'}`, { size: 'sm', color: COLOR.textSecondary }),
    textLine(`LINE User ID: ${user.lineUserId ?? '-'}`, { size: 'xs', color: COLOR.textSecondary }),
    textLine(`เวลา: ${formatThaiDateTime(timestamp)}`, { size: 'xs', color: COLOR.textSecondary }),
    separator(),
    textLine('เปิดหน้า Admin เพื่อดู Screenshot แล้วกดอนุมัติ/ปฏิเสธ', {
      size: 'sm',
      color: COLOR.textPrimary,
      wrap: true,
    }),
  ];

  if (message) {
    body.push(textLine(`ข้อความจากผู้ใช้: ${message}`, {
      size: 'xs',
      color: COLOR.textSecondary,
      wrap: true,
    }));
  }

  const card = bubble({
    headerText: '👍 คำขอ Premium ฟรี (Like Facebook)',
    headerColor: COLOR.info,
    headerBg: COLOR.infoBg,
    bodyContents: body,
  });

  if (adminUrl) {
    card.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.info,
          action: { type: 'uri', label: '🛠️ ไปหน้า Admin', uri: adminUrl },
        },
      ],
    };
  }

  return card;
}

// ── Push หาผู้ใช้: คำขอ Like Facebook ได้รับอนุมัติ → ได้ Premium 1 เดือน ──────────
// รูปแบบเดียวกับ buildFreeTrialClaimedMessage (แคมเปญพี่น้องกัน) เพื่อให้ผู้ใช้ที่เคย
// เห็นการ์ดหนึ่งอ่านอีกการ์ดได้ทันทีโดยไม่ต้องเรียนรู้ใหม่
function buildFacebookLikeApprovedMessage(grantedAt, expiresAt, premiumUrl) {
  const message = bubble({
    headerText: '🎉 ได้รับ Premium ฟรี 1 เดือนแล้ว',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ขอบคุณที่กดไลก์เพจ EasyDCA! ทีมงานตรวจสอบเรียบร้อยแล้ว', {
        size: 'sm',
        color: COLOR.textPrimary,
        wrap: true,
      }),
      textLine(`เริ่มใช้งาน: ${formatDateBangkok(grantedAt)}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
      textLine(`ใช้งาน Premium ได้ถึง: ${formatDateBangkok(expiresAt)}`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine('หากต้องการใช้ต่อหลังหมดอายุ ต่ออายุได้ผ่านเว็บ Dashboard', {
        size: 'xs',
        color: COLOR.textSecondary,
        wrap: true,
      }),
    ],
  });

  if (premiumUrl) {
    message.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.profit,
          action: { type: 'uri', label: '👑 ไปที่ Dashboard', uri: premiumUrl },
        },
      ],
    };
  }

  return message;
}

// ── Push หาผู้ใช้: คำขอ Like Facebook ไม่ผ่านการตรวจสอบ ────────────────────────
// ต้องบอกให้ชัดว่า "ส่งใหม่ได้" (Partial Unique Index ครอบเฉพาะ pending — คำขอที่ถูก
// ปฏิเสธไม่บล็อกการส่งใหม่) มิฉะนั้นผู้ใช้จะเข้าใจว่าเสียสิทธิ์ไปแล้วถาวร
function buildFacebookLikeRejectedMessage(rejectReason, supportUrl) {
  const body = [
    textLine('คำขอ Premium ฟรี (กดไลก์เพจ) ยังไม่ผ่านการตรวจสอบ', {
      size: 'sm',
      color: COLOR.textPrimary,
      wrap: true,
    }),
  ];

  if (rejectReason) {
    body.push(textLine(`เหตุผล: ${rejectReason}`, {
      size: 'sm',
      color: COLOR.textSecondary,
      wrap: true,
    }));
  }

  body.push(
    textLine('แก้ไขแล้วส่งคำขอใหม่ได้ทันทีที่หน้าติดต่อทีมงาน — สิทธิ์ของคุณยังไม่ถูกใช้ไป', {
      size: 'xs',
      color: COLOR.textSecondary,
      wrap: true,
    })
  );

  const card = bubble({
    headerText: '⚠️ คำขอยังไม่ผ่านการตรวจสอบ',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: body,
  });

  if (supportUrl) {
    card.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.warning,
          action: { type: 'uri', label: 'ส่งคำขอใหม่', uri: supportUrl },
        },
      ],
    };
  }

  return card;
}

// ยอดเงินบาททศนิยม 2 ตำแหน่งเป๊ะเสมอ (เช่น 59.17 / 590.05) — ยอดชำระมีเศษ
// สตางค์เฉพาะ (satang tag) ที่ต้องโอนให้ตรงทุกหลัก ต่างจาก formatNumber ที่ตัด
// ศูนย์ท้าย (59.10 → "59.1") ซึ่งอาจทำให้ผู้ใช้โอนยอดผิด
function formatThb2(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return String(value);
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// ── ปุ่มเสนอแพ็กเกจ Premium (รายเดือน/รายปี) — ใช้ร่วมทั้งเคสยังไม่ Premium และ
// เคสต่ออายุ (Postback request_payment เดียวกัน paymentService.requestPayment
// ใช้ Stacking Logic ต่อจากวันหมดอายุเดิมให้เองอยู่แล้ว) ────────────────────
function premiumPeriodButtons(monthlyLabel, yearlyLabel) {
  return [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.info,
      action: {
        type: 'postback',
        label: monthlyLabel,
        data: 'action=request_payment&period=monthly',
        displayText: monthlyLabel,
      },
    },
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: yearlyLabel,
        data: 'action=request_payment&period=yearly',
        displayText: yearlyLabel,
      },
    },
  ];
}

// เคส 1: ยังไม่ใช่ Premium และไม่มีคำขอค้าง — เสนอ 2 แพ็กเกจให้เลือก
function buildPremiumOfferMessage() {
  const body = [
    textLine('อัพเกรดเป็น Premium 👑', { size: 'lg', weight: 'bold', color: COLOR.textPrimary }),
    textLine('บันทึกสินทรัพย์ได้ไม่จำกัด + ดู Dashboard เต็มรูปแบบ', {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    separator(),
    textLine('เลือกแพ็กเกจที่ต้องการ แล้วระบบจะสร้าง QR PromptPay ให้โอน', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
  ];

  return {
    type: 'flex',
    altText: 'อัพเกรดเป็น Premium',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('👑 Premium', { weight: 'bold', color: COLOR.profit })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: premiumPeriodButtons('รายเดือน 59 บาท', 'รายปี 590 บาท'),
      },
    },
  };
}

// เคส 2: เป็น Premium Active อยู่แล้ว — แสดงวันหมดอายุ (ไทย/พ.ศ.) + ปุ่มต่ออายุ
function buildPremiumStatusMessage(expiresAt) {
  const body = [
    textLine('คุณเป็นสมาชิก Premium อยู่แล้ว ✅', {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(`หมดอายุวันที่ ${formatThaiDate(expiresAt)}`, {
      size: 'md',
      weight: 'bold',
      color: COLOR.info,
    }),
    textLine('* ต่ออายุล่วงหน้าได้ ระบบจะบวกเวลาต่อจากวันหมดอายุเดิมให้ ไม่เสียวันที่เหลือ', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
  ];

  return {
    type: 'flex',
    altText: 'สถานะ Premium',
    contents: {
      type: 'bubble',
      header: headerBox('👑 Premium ของคุณ', COLOR.profit, COLOR.profitBg, {
        url: MASCOT.achievementTrophy,
        bg: MASCOT_BG.mint,
      }),
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        // Bug Fix: 'ต่ออายุรายเดือน 59 บาท' เดิมยาว 22 ตัวอักษร เกิน Limit 20 ของ LINE
        // (พบระหว่างสแกน Label ทั้งไฟล์ตามบั๊ก Guided Buy Busy Message ด้านบน — ย่อ
        // ไว้กันไว้ก่อนแม้ Flex Button (ไม่ใช่ quickReply) เพราะเป็น Flow จ่ายเงินจริง)
        contents: premiumPeriodButtons('ต่อรายเดือน 59 บาท', 'ต่อรายปี 590 บาท'),
      },
    },
  };
}

// เคส 3 + หลังกด request_payment: แสดงรูป QR PromptPay ให้สแกนโอน พร้อมยอดเป๊ะ
// (2 ตำแหน่งทศนิยม) เวลาหมดอายุ และปุ่ม "แจ้งชำระแล้ว"
// payment ต้องมี { id, amountThb, billingPeriod, expiresAt } | qrImageUrl = URL
// รูป PNG ที่ LINE Fetch ได้ (Endpoint GET /api/v1/payment/:id/qr.png)
function buildPaymentQrMessage(payment, qrImageUrl) {
  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '📤 แจ้งชำระแล้ว',
        data: `action=notify_payment&paymentId=${payment.id}`,
        displayText: 'แจ้งชำระเงินแล้ว',
      },
    },
  ];

  return {
    type: 'flex',
    altText: `สแกนจ่าย Premium ${formatThb2(payment.amountThb)} บาท`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('💳 สแกนจ่ายผ่าน PromptPay', { weight: 'bold', color: COLOR.profit })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          {
            type: 'image',
            url: qrImageUrl,
            size: 'full',
            aspectMode: 'fit',
            aspectRatio: '1:1',
          },
          textLine(`ยอดที่ต้องโอน: ${formatThb2(payment.amountThb)} บาท`, {
            size: 'lg',
            weight: 'bold',
            color: COLOR.textPrimary,
          }),
          textLine(`แพ็กเกจ: Premium (${billingLabel(payment.billingPeriod)})`, {
            size: 'sm',
            color: COLOR.textSecondary,
          }),
          textLine(`กรุณาโอนภายใน: ${formatDateBangkok(payment.expiresAt)} (คำขอมีอายุ 24 ชม.)`, {
            size: 'sm',
            color: COLOR.textSecondary,
          }),
          textLine('⚠️ โอนยอดให้ตรงทุกหลักรวมเศษสตางค์ เพื่อให้ระบบจับคู่รายการได้', {
            size: 'xs',
            color: COLOR.warning,
          }),
          textLine('โอนแล้วกด "แจ้งชำระแล้ว" เพื่อให้ทีมงานตรวจสอบ', {
            size: 'xs',
            color: COLOR.textSecondary,
          }),
        ],
      },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// ตอบผู้ใช้หลังกด "แจ้งชำระแล้ว" — คำขอถูกส่งให้ Admin ตรวจสอบแล้ว
function buildPaymentNotifySubmittedMessage() {
  return bubble({
    headerText: '📤 แจ้งชำระเงินแล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ได้รับแจ้งการชำระเงินแล้ว กำลังรอ Admin ตรวจสอบ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เมื่ออนุมัติแล้วระบบจะแจ้งเตือนและเปิดสิทธิ์ Premium ให้ทันที', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ตอบผู้ใช้เมื่อได้รับรูปสลิปและผูกเข้ากับคำขอ pending สำเร็จ (Image Handler ใน Webhook)
//
// adminNotified   = Push การ์ดถึง Admin ได้จริงอย่างน้อย 1 คนหรือไม่
// isReplacement   = เป็นสลิปใบที่ 2+ ของคำขอเดิม (เขียนทับใบก่อนหน้า) ซึ่งจะไม่ Push ซ้ำ
//
// ⚠️ ข้อความเดิมบอกว่า "กำลังรอ Admin ตรวจสอบ" ทุกกรณี ทั้งที่ตอนนั้นระบบยังไม่ได้ส่ง
// อะไรไปหา Admin เลย (ต้องรอผู้ใช้กดปุ่ม "แจ้งชำระแล้ว" อีกที) ผู้ใช้จึงเข้าใจว่าจบแล้ว
// แล้วคำขอค้างถาวร — ตอนนี้ระบบแจ้ง Admin ให้ตั้งแต่รับรูป ข้อความจึงยืนยันได้ว่าแจ้งจริง
// แต่ต้อง "ไม่โกหก" เมื่อ Push ไม่สำเร็จ จึงแยกข้อความตามผลจริง
function buildSlipReceivedMessage(adminNotified = true, isReplacement = false) {
  // สลิปใบที่ 2+ ไม่ได้ Push รอบนี้ จึงห้ามพูดว่า "เพิ่งแจ้งทีมงาน" — และห้ามพูดว่ายังไม่แจ้ง
  // ด้วย (ใบแรกอาจแจ้งไปแล้ว) ใช้ข้อความที่ถูกต้องทุกกรณี: อัปเดตรูปแล้ว + อยู่ระหว่างตรวจสอบ
  const bodyContents = isReplacement
    ? [
        textLine('อัปเดตรูปสลิปล่าสุดให้คำขอนี้เรียบร้อยแล้ว', {
          size: 'sm',
          color: COLOR.textPrimary,
        }),
        textLine('ทีมงานกำลังตรวจสอบคำขอของคุณอยู่ เมื่ออนุมัติแล้วระบบจะแจ้งเตือนทันที', {
          size: 'xs',
          color: COLOR.textSecondary,
        }),
      ]
    : adminNotified
    ? [
        textLine('ได้รับรูปสลิปการโอนเงินแล้ว และแจ้งทีมงานให้ตรวจสอบเรียบร้อยแล้ว', {
          size: 'sm',
          color: COLOR.textPrimary,
        }),
        textLine('เมื่ออนุมัติแล้วระบบจะแจ้งเตือนและเปิดสิทธิ์ Premium ให้ทันที', {
          size: 'xs',
          color: COLOR.textSecondary,
        }),
      ]
    : [
        textLine('ได้รับรูปสลิปการโอนเงินและบันทึกคำขอของคุณเรียบร้อยแล้ว', {
          size: 'sm',
          color: COLOR.textPrimary,
        }),
        // ไม่บอกว่า "แจ้งทีมงานแล้ว" เพราะ Push ไม่ถึงจริง — แต่คำขอถูกบันทึกใน DB แล้ว
        // ทีมงานยังเห็นย้อนหลังได้ที่หน้า Admin จึงไม่ต้องให้ผู้ใช้ทำอะไรซ้ำ
        textLine('ทีมงานจะตรวจสอบและอนุมัติให้โดยเร็วที่สุดครับ', {
          size: 'xs',
          color: COLOR.textSecondary,
        }),
      ];

  return bubble({
    headerText: '🧾 ได้รับสลิปแล้ว',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents,
  });
}

// ── ปุ่มเปิด Web Dashboard (LIFF) — action type uri (เปิดใน LINE In-App Browser)
function buildDashboardLinkMessage(dashboardUrl) {
  return {
    type: 'flex',
    altText: 'เปิด Dashboard',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('📊 Web Dashboard', { weight: 'bold', color: COLOR.info })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          textLine('ดูพอร์ต กราฟ และประวัติแบบเต็มรูปแบบบนหน้าเว็บ', {
            size: 'sm',
            color: COLOR.textPrimary,
          }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLOR.info,
            action: { type: 'uri', label: '📊 เปิด Dashboard', uri: dashboardUrl },
          },
        ],
      },
    },
  };
}

// ── Push เตือน "Premium ใกล้หมดอายุ" (premiumExpiryReminder.job) ──────────────
// ส่งล่วงหน้าก่อนหมดอายุ เพื่อให้ผู้ใช้มีเวลาต่ออายุก่อนถูกลดชั้นเป็น Free
// (คู่กับ buildPlanDowngradedMessage ด้านล่างที่ส่ง "หลัง" หมดอายุแล้ว — คนละใบ
// คนละจังหวะ ไม่ซ้ำกัน เพราะ Job คนละตัวและกรองช่วงเวลาไม่ทับกัน)
//
// premiumUrl อาจเป็น null ได้ถ้ายังไม่ได้ตั้ง FRONTEND_URL — กรณีนั้นไม่ใส่ปุ่มลิงก์
// (Pattern เดียวกับ buildPdpaConsentRequiredMessage: uri ว่างทำให้ LINE ปฏิเสธทั้ง
// ข้อความด้วย 400 ผู้ใช้จะไม่เห็นแม้แต่ข้อความเตือน)
function buildPremiumExpiringSoonMessage(daysLeft, expiresAt, premiumUrl) {
  const message = {
    type: 'flex',
    altText: `Premium ใกล้หมดอายุ (อีก ${daysLeft} วัน)`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.warningBg,
        paddingAll: '12px',
        contents: [
          textLine('⏳ Premium ใกล้หมดอายุ', { weight: 'bold', color: COLOR.warning }),
        ],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          textLine(`แพ็กเกจ Premium ของคุณจะหมดอายุในอีก ${daysLeft} วัน`, {
            size: 'sm',
            color: COLOR.textPrimary,
          }),
          textLine(`หมดอายุวันที่ ${formatThaiDate(expiresAt)}`, {
            size: 'sm',
            weight: 'bold',
            color: COLOR.textPrimary,
          }),
          textLine(
            'ต่ออายุก่อนหมดเพื่อใช้สินทรัพย์ไม่จำกัดและแผน DCA ไม่จำกัดต่อเนื่อง — ข้อมูลเดิมยังอยู่ครบเสมอแม้ไม่ต่อ',
            { size: 'xs', color: COLOR.textSecondary }
          ),
        ],
      },
    },
  };

  if (premiumUrl) {
    message.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.warning,
          action: { type: 'uri', label: '👑 ต่ออายุ Premium', uri: premiumUrl },
        },
      ],
    };
  }

  return message;
}

// ── Push หาผู้ใช้เมื่อ Premium หมดอายุ (planDowngrade.job) — กลับเป็น Free ────
function buildPlanDowngradedMessage() {
  return bubble({
    headerText: '⚠️ Premium หมดอายุแล้ว',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('แพ็กเกจ Premium ของคุณหมดอายุแล้ว บัญชีกลับเป็น Free (จำกัด 2 สินทรัพย์)', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('ข้อมูลเดิมทั้งหมดยังอยู่ครบ ต่ออายุได้ทุกเมื่อผ่านเมนู "Premium"', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ตอบกลับปุ่ม Rich Menu "เพิ่มรายการ" (Postback action=add_guide) — สอนวิธีพิมพ์
// คำสั่งซื้อ/ขายตรงๆ ทันที ไม่มีปุ่มกด (แค่ข้อความสอน) Pattern Header/สีเดียวกับ
// buildUnknownCommandMessage ด้านล่าง | Syntax ตัวอย่างตรงกับ commandParser.service.js
// (DETAILED_BUY/DETAILED_SELL) เป๊ะ ห้ามเดาเอง
function buildAddGuideMessage() {
  return bubble({
    headerText: '📝 วิธีเพิ่มรายการซื้อ/ขาย',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('พิมพ์ข้อความตามรูปแบบด้านล่างได้เลย', { size: 'sm', color: COLOR.textPrimary }),
      textLine('• ซื้อ BTC 0.01 หุ้น ราคา 3400000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ขาย PTT 50 หุ้น ราคา 34', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });
}

function buildUnknownCommandMessage() {
  return bubble({
    headerText: '🤔 ไม่เข้าใจคำสั่งนี้',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ลองพิมพ์คำสั่งเหล่านี้ดูนะครับ', { size: 'sm', color: COLOR.textPrimary }),
      textLine('• ซื้อ BTC 0.01 หุ้น ราคา 3400000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ขาย PTT 50 หุ้น ราคา 34', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• พอต', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• กำไร BTC', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ประวัติ', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Fallback Quick Reply Menu (S8 R2 รอบ 1)
// ═══════════════════════════════════════════════════════════════════════
// แทน buildUnknownCommandMessage (ทางตัน ไม่มีปุ่ม) เมื่อ Parse คำสั่งไม่ออกและ
// ไม่มี Session ค้าง — ให้ผู้ใช้ "กดต่อได้" แทนที่จะต้องเดาคำสั่งเอง
//
// ⚠️ ห้ามใช้ textWithQuickReply() ประกอบเมนูนี้: helper ตัวนั้นผนวกปุ่ม
// "❌ ยกเลิก" (action=cancel_reminder_setup) ต่อท้ายเสมอ ซึ่งเป็นของ Flow ตั้งเตือน
// โดยเฉพาะ — ถ้าโผล่ในเมนูทั่วไป ผู้ใช้กดแล้วจะเข้า cancelFlow ทั้งที่ไม่มี Session
// (สับสน + throw) จึงประกอบ quickReply เองที่นี่
//
// การเลือกชนิด Action ยึดตาม Convention เดิมของ Rich Menu (setupRichMenu.js):
//   - คำสั่งที่ "สมบูรณ์ในตัว" → type message (ผ่าน Command Parser เดิมเป๊ะ ไม่ต้อง
//     เขียน Handler ใหม่ และ Expert Path ได้ผลลัพธ์เดียวกับพิมพ์เอง 100%)
//   - คำสั่งที่ "ไม่สมบูรณ์/เริ่ม Flow" → type postback (กันข้อความเปล่าหลุดเข้า
//     Command Parser แล้วตก UNKNOWN — บทเรียนจากปุ่ม 'ซื้อ' เปล่าๆ เดิม)
function fallbackQuickReplyItems() {
  return [
    // รอบ 2: จุดเริ่ม Guided Buy Flow เต็มรูปแบบ (เลือก Symbol → จำนวนเงิน → Preview)
    // ปลายทางคือ routeCommand(BUY) → createPending เส้นเดียวกับ Expert Path เป๊ะ
    // Expert Path ยังหาเจอเสมอผ่านปุ่ม "❓ วิธีใช้งาน" (buildHelpMessage) ด้านล่าง
    quickReplyPostback('📈 บันทึก DCA', 'action=buy_guide', '📈 บันทึก DCA'),
    // Reuse คำสั่ง "พอต" เดิมตรงๆ ผ่าน Command Parser (ไม่มี Handler ใหม่)
    { type: 'action', action: { type: 'message', label: '💰 ดูพอร์ต', text: 'พอต' } },
    // Reuse Flow ตั้งเตือน DCA เดิมทั้งดุ้น (action เดียวกับปุ่ม Rich Menu)
    quickReplyPostback('🔔 ตั้งเตือน DCA', 'action=start_reminder_setup', '🔔 ตั้งเตือน DCA'),
    quickReplyPostback('❓ วิธีใช้งาน', 'action=help_guide', '❓ วิธีใช้งาน'),
  ];
}

// Tone: ชวนทำรายการต่อ ไม่ใช่แจ้ง Error (ห้ามใช้คำว่า "ไม่เข้าใจ"/"ขอโทษ") — จุดนี้
// เป็นทางออกปกติของ Flow (Parse ไม่ออก + ไม่มี Session ค้าง) ไม่ใช่ระบบมีปัญหา
function buildFallbackMenuMessage() {
  return {
    type: 'text',
    text: 'สามารถทำรายการด้านล่างนี้ได้เลยครับ 👇 หรือพิมพ์คำสั่งเองก็ได้',
    quickReply: { items: fallbackQuickReplyItems() },
  };
}

// การ์ด "วิธีใช้งาน" — รวมคำสั่งพิมพ์ตรงทั้งหมดไว้ที่เดียว (Expert Path ต้องค้นเจอ
// ได้เสมอ ไม่ถูกซ่อนเพราะมีเมนูปุ่มใหม่) แนบ Quick Reply เดิมต่อท้ายให้กดต่อได้
function buildHelpMessage() {
  const card = bubble({
    headerText: '❓ วิธีใช้งาน EasyDCA',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('พิมพ์คำสั่งเหล่านี้ได้โดยตรง', { size: 'sm', weight: 'bold', color: COLOR.textPrimary }),
      textLine('บันทึกซื้อ/ขาย', { size: 'xs', weight: 'bold', color: COLOR.textPrimary }),
      textLine('• ซื้อ BTC 1000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ซื้อ BTC 0.01 หุ้น ราคา 3400000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ขาย PTT 50 หุ้น ราคา 34', { size: 'sm', color: COLOR.textSecondary }),
      textLine('ดูข้อมูล', { size: 'xs', weight: 'bold', color: COLOR.textPrimary }),
      textLine('• พอต — สรุปพอร์ตทั้งหมด', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• กำไร BTC — กำไร/ขาดทุนรายตัว', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ประวัติ — รายการล่าสุด', { size: 'sm', color: COLOR.textSecondary }),
      textLine('จัดการ', { size: 'xs', weight: 'bold', color: COLOR.textPrimary }),
      textLine('• ยกเลิกล่าสุด — ย้อนรายการล่าสุด', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• นำเข้าพอร์ต — เพิ่มหลายรายการพร้อมกัน', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ดูเตือน / ลบเตือน BTC', { size: 'sm', color: COLOR.textSecondary }),
    ],
  });

  return { ...card, quickReply: { items: fallbackQuickReplyItems() } };
}

// ═══════════════════════════════════════════════════════════════════════
// Follow Event (แอดเพื่อน/Unblock) — ข้อความต้อนรับผู้ใช้ใหม่ (ทำงานคู่กับ
// handleFollow ใน webhook.controller.js) ส่งเป็น 3 ข้อความต่อกัน: แนะนำตัว →
// วิธีใช้งานเบื้องต้น → ชวนกด Premium ฟรี 1 เดือน
//
// ปุ่ม Premium "ไม่" Auto-grant เอง แค่พาไปหน้า /premium ให้ Guard/Logic เดิม
// (payment.controller.js: checkEligibility/claim) ทำงานเหมือนกดจากที่อื่นทุกจุด
// ไม่สร้าง Path Grant ใหม่ซ้อน — ถ้า Free Trial Flag ปิดอยู่ หน้าเว็บจะแจ้งเองว่า
// ปิดรับสมัคร (FEATURE_DISABLED) เหมือน Entry Point อื่น
// ═══════════════════════════════════════════════════════════════════════

function buildWelcomeIntroMessage() {
  return bubble({
    headerText: '👋 ยินดีต้อนรับสู่ EasyDCA',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('EasyDCA ช่วยบันทึกและติดตามพอร์ตการลงทุนแบบ DCA ของคุณผ่าน LINE', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(
        'พิมพ์คำสั่งซื้อ/ขายตรงๆ ได้เลย ระบบคำนวณต้นทุนเฉลี่ยและกำไร/ขาดทุนให้อัตโนมัติ',
        { size: 'sm', color: COLOR.textSecondary }
      ),
    ],
    mascot: { url: MASCOT.welcomeWave, bg: MASCOT_BG.cream },
  });
}

function buildWelcomeGuideMessage() {
  return bubble({
    headerText: '📝 เริ่มใช้งานเบื้องต้น',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('พิมพ์บันทึกรายการซื้อ/ขายได้ทันที เช่น', { size: 'sm', color: COLOR.textPrimary }),
      textLine('• ซื้อ BTC 0.01 หุ้น ราคา 3400000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ขาย PTT 50 หุ้น ราคา 34', { size: 'sm', color: COLOR.textSecondary }),
      textLine(
        'หรือกดเมนูด้านล่างแชท (Rich Menu) เพื่อดูพอร์ต ตั้งเตือน DCA และเปิด Dashboard',
        { size: 'sm', color: COLOR.textSecondary }
      ),
      textLine('พิมพ์ "วิธีใช้งาน" ได้ทุกเมื่อถ้าลืมคำสั่ง', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// premiumUrl มาจาก buildExternalUrl('/premium') — เป็น null ได้ถ้ายังไม่ได้ตั้ง
// FRONTEND_URL (Pattern เดียวกับ buildPremiumExpiringSoonMessage/buildDashboardLinkMessage)
// กรณีนั้นไม่ใส่ปุ่ม กันข้อความถูก LINE ปฏิเสธทั้งใบเพราะ uri ว่าง
function buildWelcomeFreeTrialMessage(premiumUrl) {
  const message = bubble({
    headerText: '🎁 Premium ฟรี 1 เดือน',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('ทดลองใช้ Premium ฟรี 1 เดือน บันทึกสินทรัพย์ได้ไม่จำกัด', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('กดปุ่มด้านล่างเพื่อไปรับสิทธิ์ที่หน้าเว็บ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });

  if (premiumUrl) {
    message.contents.footer = {
      type: 'box',
      layout: 'vertical',
      contents: [
        {
          type: 'button',
          style: 'primary',
          color: COLOR.profit,
          action: { type: 'uri', label: '🎁 กดรับ Premium ฟรี 1 เดือน', uri: premiumUrl },
        },
      ],
    };
  }

  return message;
}

// ═══════════════════════════════════════════════════════════════════════
// Bulk Import (Phase 3 Round 6 — นำเข้าพอร์ตแบบ Multi-line)
// ═══════════════════════════════════════════════════════════════════════

// ข้อความที่ 1 ของ Flow — ตอบทันทีที่พิมพ์ "นำเข้าพอร์ต" อธิบาย Format + ตัวอย่าง
// (bulkImportSession Service เป็นผู้เริ่ม Session รอรับ Batch คู่กับข้อความนี้)
function buildBulkImportInstructionsMessage() {
  return bubble({
    headerText: '📥 นำเข้าพอร์ต',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('พิมพ์รายการที่ต้องการนำเข้า บรรทัดละ 1 รายการ ส่งเป็นข้อความเดียว', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('รูปแบบ: SYMBOL จำนวน ต้นทุน ราคาต่อหน่วย [วันที่ DD/MM/YYYY]', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
      separator(),
      textLine('BTC 0.5 ต้นทุน 1500000', { size: 'sm', color: COLOR.textSecondary }),
      textLine('ETH 2 ต้นทุน 80000 วันที่ 01/03/2569', { size: 'sm', color: COLOR.textSecondary }),
      textLine('MSFT 3 ต้นทุน 300 USD', { size: 'sm', color: COLOR.textSecondary }),
      separator(),
      textLine('ไม่ระบุวันที่ = ใช้วันนี้ • ระบุ USD ท้ายราคาได้ถ้าซื้อเป็นดอลลาร์', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
      textLine('ส่งภายใน 5 นาทีหลังพิมพ์คำสั่งนี้ มิฉะนั้นต้องเริ่มใหม่', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// Batch ว่างเปล่า (ผู้ใช้ส่งข้อความว่าง/มีแต่ Whitespace หลังพิมพ์ "นำเข้าพอร์ต")
function buildBulkImportEmptyMessage() {
  return bubble({
    headerText: '⚠️ ไม่พบรายการ',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('ไม่พบรายการในข้อความนี้เลย กรุณาพิมพ์อย่างน้อย 1 บรรทัด', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('เช่น: BTC 0.5 ต้นทุน 1500000', { size: 'xs', color: COLOR.textSecondary }),
    ],
  });
}

// แปล Error 1 รายการของ Batch เป็นข้อความไทย — รองรับ 2 รูปแบบปนกันได้:
//  - Parse-level (commandParser.parseBulkImportLines): { line, reason } (reason
//    เป็นข้อความไทยสำเร็จรูปแล้ว)
//  - Business-level (bulkImport.service.validateItems): { line, symbol, code }
//    (code ต้องแปลผ่าน ERROR_MESSAGES ที่นี่ — Service Layer ไม่รู้จัก Map นี้)
//  - Aggregate Asset Limit ทั้ง Batch: { line: null, code } (ไม่ผูกกับบรรทัดใด)
function describeBulkImportError(error) {
  const message = error.reason ?? ERROR_MESSAGES[error.code] ?? ERROR_MESSAGES.INTERNAL_ERROR;
  const prefix = error.symbol ? `${error.symbol}: ` : '';

  if (error.line === null || error.line === undefined) {
    return `${prefix}${message}`;
  }
  return `บรรทัด ${error.line}: ${prefix}${message}`;
}

// Batch ถูกปฏิเสธทั้งก้อน (Parse หรือ Business Validation ไม่ผ่านอย่างน้อย 1 บรรทัด)
// — แสดงทุกบรรทัดที่ผิดพร้อมเหตุผล (ไม่ใช่แค่บรรทัดแรก) ไม่มีอะไรถูกบันทึกลง DB เลย
function buildBulkImportRejectedMessage(errors) {
  const body = [
    textLine('พบข้อผิดพลาดในรายการที่ส่งมา กรุณาแก้ไขแล้วส่งใหม่ทั้งก้อน', {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    separator(),
    ...errors.map((error) =>
      textLine(`• ${describeBulkImportError(error)}`, { size: 'sm', color: COLOR.loss })
    ),
  ];

  return bubble({
    headerText: '❌ นำเข้าพอร์ตไม่สำเร็จ',
    headerColor: COLOR.loss,
    headerBg: COLOR.lossBg,
    bodyContents: body,
  });
}

// Preview ก่อนบันทึกจริง (Batch Parse+Validate ผ่านหมดแล้ว) — ตารางรายการ +
// ยอดรวม + ปุ่มยืนยัน/ยกเลิก (Postback พก batchId เดียว ไม่ใช่ pendingId ทีละตัว)
function buildBulkImportPreviewMessage(batch) {
  const body = [
    textLine(`พบ ${batch.items.length} รายการ ตรวจสอบก่อนกด "ยืนยัน"`, {
      size: 'sm',
      color: COLOR.textPrimary,
    }),
    separator(),
  ];

  // Multi-Currency (Round 10): แยกยอดรวมตามสกุลเงิน ไม่ถัวข้ามสกุล (item.currency
  // จาก pending record) — USD แสดงยอด USD ตามจริง + ยอดเทียบบาทรวม (จาก item.fx)
  const totalByCurrency = { THB: 0, USD: 0 };
  let usdConvertedThbTotal = 0;
  let usdRateAvailable = false;

  batch.items.forEach((item) => {
    const isUsd = item.currency === 'USD';
    const unit = isUsd ? 'USD' : 'บาท';
    totalByCurrency[isUsd ? 'USD' : 'THB'] += Number(item.amountThb);
    if (isUsd && item.fx && item.fx.amountThb !== undefined && item.fx.amountThb !== null) {
      usdConvertedThbTotal += Number(item.fx.amountThb);
      usdRateAvailable = true;
    }

    body.push(
      textLine(item.assetSymbol, { weight: 'bold', color: COLOR.textPrimary }),
      textLine(
        `จำนวน: ${formatNumber(item.quantity)} ${item.assetSymbol} @ ${formatNumber(item.pricePerUnit)} ${unit}`,
        { size: 'sm', color: COLOR.textSecondary }
      ),
      textLine(`มูลค่า: ${formatNumber(item.amountThb)} ${unit} • ${item.txnDate}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );

    // ยอดเทียบบาทต่อรายการ (เฉพาะ USD ที่ดึงเรตได้)
    if (isUsd && item.fx) {
      body.push(...usdFxLines(item.fx));
    }

    body.push(separator());
  });

  // ── ยอดรวมแยกตามสกุล ─────────────────────────────────────────────────────
  if (totalByCurrency.THB > 0) {
    body.push(
      textLine(`รวม (บาท): ${formatNumber(totalByCurrency.THB)} บาท`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      })
    );
  }
  if (totalByCurrency.USD > 0) {
    body.push(
      textLine(`รวม (USD): ${formatNumber(totalByCurrency.USD)} USD`, {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      })
    );
    if (usdRateAvailable) {
      body.push(
        textLine(`≈ ${formatNumber(usdConvertedThbTotal)} บาท (ตามอัตราแลกเปลี่ยนล่าสุด)`, {
          size: 'xs',
          color: COLOR.textSecondary,
        })
      );
    }
  }

  body.push(
    textLine(`รวม ${batch.items.length} รายการ • ตรวจสอบแล้วกด "ยืนยัน" (หมดอายุใน 5 นาที)`, {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );

  const footerButtons = [
    {
      type: 'button',
      style: 'primary',
      color: COLOR.profit,
      action: {
        type: 'postback',
        label: '✅ ยืนยันทั้งหมด',
        data: postbackDataBatch('confirm_bulk_import', batch.batchId),
        displayText: 'ยืนยันนำเข้าพอร์ต',
      },
    },
    {
      type: 'button',
      style: 'secondary',
      action: {
        type: 'postback',
        label: '❌ ยกเลิก',
        data: postbackDataBatch('cancel_bulk_import', batch.batchId),
        displayText: 'ยกเลิกนำเข้าพอร์ต',
      },
    },
  ];

  // altText แยกยอดตามสกุล (ไม่รวมข้ามสกุล) — Fallback '0 บาท' ถ้าไม่มียอดเลย
  const altParts = [];
  if (totalByCurrency.THB > 0) altParts.push(`${formatNumber(totalByCurrency.THB)} บาท`);
  if (totalByCurrency.USD > 0) altParts.push(`${formatNumber(totalByCurrency.USD)} USD`);

  return {
    type: 'flex',
    altText: `นำเข้าพอร์ต ${batch.items.length} รายการ รวม ${altParts.join(' + ') || '0 บาท'}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('📥 ตรวจสอบก่อนนำเข้า', { weight: 'bold', color: COLOR.info })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// หลังกด "ยืนยันทั้งหมด" — ผลลัพธ์ Best-effort จาก pendingTransactionService.confirmBatch
// (result: { total, succeeded, failed }) แสดงจำนวนสำเร็จเสมอ และรายการที่ล้มเหลว
// (ถ้ามี) พร้อมเหตุผล ไม่ทำให้ผู้ใช้เข้าใจผิดว่าทุกอย่างสำเร็จเมื่อมีบางรายการพลาด
function buildBulkImportConfirmedMessage(result) {
  const allSucceeded = result.failed.length === 0;

  const body = [
    textLine(`บันทึกสำเร็จ ${result.succeeded.length}/${result.total} รายการ`, {
      size: 'md',
      weight: 'bold',
      color: allSucceeded ? COLOR.profit : COLOR.warning,
    }),
  ];

  if (!allSucceeded) {
    body.push(
      separator(),
      textLine('รายการที่ไม่สำเร็จ (ลองพิมพ์ "ซื้อ" รายการนี้เพิ่มเองภายหลัง):', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      ...result.failed.map((f) =>
        textLine(`• ${f.symbol ?? '-'}: ${ERROR_MESSAGES[f.code] ?? ERROR_MESSAGES.INTERNAL_ERROR}`, {
          size: 'xs',
          color: COLOR.loss,
        })
      )
    );
  }

  return bubble({
    headerText: allSucceeded ? '✅ นำเข้าพอร์ตสำเร็จ' : '⚠️ นำเข้าพอร์ตสำเร็จบางส่วน',
    headerColor: allSucceeded ? COLOR.profit : COLOR.warning,
    headerBg: allSucceeded ? COLOR.profitBg : COLOR.warningBg,
    bodyContents: body,
  });
}

// ═══════════════════════════════════════════════════════════════════════
// Export รายงาน PDF/Excel (Phase 3 Round 8 — Premium Feature)
// ═══════════════════════════════════════════════════════════════════════

// Postback data ของปุ่มเลือกรูปแบบไฟล์ — พก range type (rt) + from/to (เฉพาะ custom)
// เพื่อให้ Handler Regenerate ได้โดยไม่ต้องเก็บ Session (LINE Postback ≤ 300 ตัวอักษร
// พอสำหรับ format + วันที่) rt=month/year → Handler Re-resolve ช่วงตามวันปัจจุบันเอง
function exportPostback(format, params) {
  const base =
    params.range === 'custom'
      ? `rt=custom&from=${params.from}&to=${params.to}`
      : `rt=${params.range}`;
  return `action=export_report&format=${format}&${base}`;
}

// Quick Reply ให้เลือก PDF/Excel หลังพิมพ์ "ส่งออกรายงาน [ช่วงเวลา]" (Premium ผ่านแล้ว)
// label = ข้อความช่วงเวลาไทยจาก reportExport.resolveRange (แสดงให้ผู้ใช้ยืนยันช่วงที่เลือก)
function buildExportFormatQuickReply(params, label) {
  const items = [
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '📄 PDF',
        data: exportPostback('pdf', params),
        displayText: 'ส่งออกรายงานเป็น PDF',
      },
    },
    {
      type: 'action',
      action: {
        type: 'postback',
        label: '📊 Excel',
        data: exportPostback('excel', params),
        displayText: 'ส่งออกรายงานเป็น Excel',
      },
    },
  ];

  return {
    type: 'text',
    text: `จะส่งออกรายงานช่วง "${label}" เป็นไฟล์แบบไหนดีครับ?`,
    quickReply: { items },
  };
}

// การ์ดแจ้งลิงก์ดาวน์โหลดรายงาน (หลังสร้างไฟล์ + อัปโหลด Storage + Signed URL สำเร็จ)
// ปุ่ม "ดาวน์โหลดรายงาน" = uri action ชี้ไป Signed URL + คำเตือนหมดอายุตาม TTL จริง
// arg = { signedUrl, format ('pdf'|'excel'), rangeLabel, expiresMinutes }
function buildReportReadyMessage({ signedUrl, format, rangeLabel, expiresMinutes }) {
  const formatLabel = format === 'excel' ? 'Excel (.xlsx)' : 'PDF (.pdf)';

  return {
    type: 'flex',
    altText: 'รายงานพร้อมดาวน์โหลดแล้ว',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('📑 รายงานพร้อมแล้ว', { weight: 'bold', color: COLOR.profit })],
      },
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          textLine(`ช่วงเวลา: ${rangeLabel}`, { size: 'sm', color: COLOR.textPrimary }),
          textLine(`รูปแบบไฟล์: ${formatLabel}`, { size: 'sm', color: COLOR.textSecondary }),
          textLine(`⚠️ ลิงก์นี้จะหมดอายุใน ${expiresMinutes} นาที กรุณาดาวน์โหลดทันที`, {
            size: 'xs',
            color: COLOR.warning,
          }),
        ],
      },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: COLOR.profit,
            action: { type: 'uri', label: '⬇️ ดาวน์โหลดรายงาน', uri: signedUrl },
          },
        ],
      },
    },
  };
}

// ข้อความแจ้งว่า Export เป็นฟีเจอร์ Premium พร้อม CTA อัพเกรด (Reuse ปุ่มแพ็กเกจเดิม)
function buildExportPremiumRequiredMessage() {
  const body = [
    textLine('Export รายงานเป็นฟีเจอร์สมาชิก Premium 👑', {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine('อัพเกรดเป็น Premium เพื่อส่งออกรายงานสรุปพอร์ต + ประวัติธุรกรรมเป็น PDF/Excel ได้', {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    separator(),
    textLine('เลือกแพ็กเกจด้านล่างเพื่ออัพเกรดได้เลย', { size: 'sm', color: COLOR.textPrimary }),
  ];

  return {
    type: 'flex',
    altText: 'Export รายงานเป็นฟีเจอร์ Premium',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.warningBg,
        paddingAll: '12px',
        contents: [textLine('👑 ฟีเจอร์ Premium', { weight: 'bold', color: COLOR.warning })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: premiumPeriodButtons('รายเดือน 59 บาท', 'รายปี 590 บาท'),
      },
    },
  };
}

// อธิบายรูปแบบคำสั่งที่ถูกต้องเมื่อ Parse ช่วงเวลาไม่ได้ (ไม่ปล่อย Error ดิบ)
function buildExportFormatHelpMessage() {
  return bubble({
    headerText: '📑 ส่งออกรายงาน',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('พิมพ์คำสั่งส่งออกรายงานตามรูปแบบด้านล่างได้เลย', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('• ส่งออกรายงาน  (ค่าเริ่มต้น = เดือนนี้)', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ส่งออกรายงาน เดือนนี้', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ส่งออกรายงาน ปีนี้', { size: 'sm', color: COLOR.textSecondary }),
      textLine('• ส่งออกรายงาน 01/01/2569 - 30/06/2569', {
        size: 'sm',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// AI Slip OCR (Phase 3 Round 9 — Premium Feature)
// ═══════════════════════════════════════════════════════════════════════

// Postback data ของปุ่ม [ยืนยัน]/[แก้ไข] บนการ์ด OCR — พกค่าที่ AI อ่านได้ (Symbol/
// ทิศทาง/จำนวน+ราคา หรือ ยอดรวม/วันที่ ISO) เพื่อให้ Handler สร้าง Pending ได้โดยไม่
// ต้องเก็บ Session (LINE Postback ≤ 300 ตัวอักษร พอสำหรับข้อมูล 1 รายการ)
// sideOverride = ทิศทางที่ "ผู้ใช้เลือกเอง" บนการ์ดกรณี AI อ่านไม่ชัด (ocr.side === null)
// — ปุ่มยืนยันจะส่งค่านี้มาแทน ไม่ใช่ให้ระบบเดา
function ocrPostback(action, ocr, sideOverride = null) {
  const p = new URLSearchParams();
  p.set('action', action);
  p.set('sym', ocr.symbol);
  // ⚠️ ห้าม Default เป็น 'buy' เมื่อ side เป็น null (บั๊กสลิปขายถูกบันทึกเป็นซื้อ) —
  // กรณีอ่านไม่ชัดให้ "ไม่ส่ง side" ไปเลย แล้วให้ปลายทางบังคับผู้ใช้เลือก:
  // ocr_confirm จะมีปุ่มแยก 2 ทาง (ส่ง sideOverride) ส่วน ocr_edit จะ Prefill เป็น
  // <ซื้อ/ขาย> ให้ผู้ใช้พิมพ์เลือกเอง (ดู webhook.controller case 'ocr_edit')
  const side = sideOverride ?? ocr.side;
  if (side === 'buy' || side === 'sell') p.set('side', side);
  if (ocr.quantity !== null && ocr.pricePerUnit !== null) {
    p.set('qty', String(ocr.quantity));
    p.set('price', String(ocr.pricePerUnit));
  } else if (ocr.amountThb !== null) {
    p.set('amt', String(ocr.amountThb));
  }
  // Multi-Currency (Round 10) — พกสกุลเงินที่ AI อ่านได้ (เฉพาะ USD; THB เป็น Default
  // ที่ Handler เติมเองถ้าไม่มี) เพื่อให้ ocr_confirm/ocr_edit ประกอบคำสั่งสกุลถูกต้อง
  if (ocr.currency === 'USD') p.set('cur', 'USD');
  // ค่าธรรมเนียมจากสลิป (Migration 041) — ส่งเฉพาะปุ่มยืนยัน เพราะเป็นจังหวะเดียวที่
  // Transaction ถูกสร้างจริง · ไม่ส่งเมื่อสลิปไม่ระบุ (null = "ไม่รู้" ห้ามเดาเป็น 0)
  if (action === 'ocr_confirm' && ocr.feeTotal !== null && ocr.feeTotal !== undefined) {
    p.set('fee', String(ocr.feeTotal));
  }
  // วันที่ส่งเฉพาะปุ่มยืนยัน (Path Postback ไม่ผ่าน Command Parser ที่ไม่รองรับวันที่)
  if (action === 'ocr_confirm' && ocr.dateIso) p.set('date', ocr.dateIso);
  // แนบรูปสลิป (S8) — พก "token" ของไฟล์ที่อัปโหลดไว้แล้ว (รูปแบบ "{timestamp}.{ext}"
  // ~18 ตัวอักษร) เฉพาะปุ่มยืนยัน เพราะเป็นจังหวะเดียวที่ Transaction ถูกสร้างจริง
  // ⚠️ ไม่พก path เต็มที่มี userId นำหน้า — Postback data ผู้ใช้แก้ได้ ถ้าพก path เต็ม
  // จะแก้ให้ชี้ไฟล์ของ User คนอื่นได้ ฝั่ง Handler จึงประกอบ path จาก user.id ที่
  // Authenticate แล้วเสมอ (ดู storage.service.buildTransactionSlipPath)
  if (action === 'ocr_confirm' && ocr.slipToken) p.set('slip', ocr.slipToken);
  // ── มูลค่าหุ้นที่ "พิสูจน์แล้วว่าเป็นเลขบนสลิปจริง" (บั๊ค B) ────────────────
  // ⚠️ ถ้าไม่พกไป การ์ดจะแสดง "มูลค่าหุ้น: 106.44" แต่ตอนกดยืนยันปลายทางได้แค่
  // qty + price แล้วคูณกลับเป็น 106.32 → แสดงเลขหนึ่งบันทึกอีกเลขหนึ่ง (บั๊ค A ซ้ำรอย)
  //
  // ส่งเฉพาะเมื่อ resolveGrossAmount ยืนยันแล้วว่าเป็นเลขบนสลิป (amountSource ===
  // 'slip_gross') — ถ้าเป็น 'computed' ยอดก็เท่ากับ qty × price อยู่แล้ว ไม่ต้องพก
  // (ประหยัดโควตา 300 ตัวอักษรของ Postback ไว้ให้ Field ที่จำเป็นกว่า)
  //
  // กรณีสลิป Amount-only (ไม่มี qty/price) ยอดถูกพกไปทาง 'amt' อยู่แล้วด้านบน
  if (
    action === 'ocr_confirm' &&
    ocr.amountSource === 'slip_gross' &&
    ocr.quantity !== null &&
    ocr.pricePerUnit !== null &&
    ocr.amountThb !== null &&
    ocr.amountThb !== undefined
  ) {
    p.set('gross', String(ocr.amountThb));
  }
  return p.toString();
}

// การ์ด Preview หลัง AI อ่านสลิปสำเร็จ — แสดง Field ที่อ่านได้/อ่านไม่ได้ชัดเจน + ปุ่ม
// [ยืนยันบันทึก] (เฉพาะเมื่อข้อมูลครบพอสร้างธุรกรรม) และ [แก้ไข] เสมอ พร้อม Disclaimer
// ว่าเป็นการอ่านข้อมูลด้วย AI ไม่ใช่คำแนะนำการลงทุน (กฎเหล็ก PROJECT_BRIEF)
function buildOcrPreviewMessage(ocr) {
  // ทิศทางรายการมี 3 สถานะจริง: 'buy' / 'sell' / null (AI อ่านไม่ชัด)
  // ⚠️ เดิมใช้ `ocr.side !== 'sell'` ซึ่งยุบ null รวมกับ buy → การ์ดขึ้น "🟢 ซื้อ" อย่าง
  // มั่นใจทั้งที่อ่านไม่ชัด ผู้ใช้กดยืนยันแล้วได้ Ledger ผิด (Preview เลยไม่ได้ทำหน้าที่
  // Safety Net เลย) ตอนนี้แยก null ออกมาเป็นสถานะ "ต้องให้ผู้ใช้เลือกก่อน" ชัดเจน
  const isUnknownSide = ocr.side !== 'buy' && ocr.side !== 'sell';
  const isBuy = ocr.side === 'buy';
  const sideLabel = isUnknownSide ? 'ซื้อ/ขาย?' : isBuy ? 'ซื้อ' : 'ขาย';
  const naText = 'อ่านไม่ได้ (กรุณากรอกเอง)';

  // ── สถานะคำสั่ง: คำสั่งที่ยังไม่เกิดขึ้นจริง ห้ามเสนอปุ่ม "ยืนยันบันทึก" ─────────
  // Limit Order ที่ "รอจับคู่/รอเวลาทำการ" อาจไม่มีวันจับคู่สำเร็จ (ยกเลิกได้/หมดอายุตอน
  // ตลาดปิด) ถ้าผู้ใช้กดยืนยันไปแล้ว Ledger จะมีรายการที่ไม่เคยเกิดขึ้นจริง — และเป็น
  // Immutable Ledger ที่แก้ทีหลังต้องใช้ Reversal ไม่ใช่ลบทิ้ง
  //
  // ⚠️ ตัดแค่ปุ่มยืนยัน "ไม่ใช่" ตอบเป็นการ์ด Error เต็มใบ — ปุ่ม "แก้ไข" ต้องคงอยู่เสมอ
  // เพื่อให้ผู้ใช้ยังบันทึกเองได้ถ้า AI อ่านสถานะผิด (False Positive ต้องไม่ล็อกตาย)
  // หลักการเดียวกับ isUnknownSide ที่ลดรูปการ์ดแทนการ Error ทิ้ง
  const isUnfilled = ocr.orderStatus === 'pending' || ocr.orderStatus === 'cancelled';
  const isCancelled = ocr.orderStatus === 'cancelled';

  // สร้างธุรกรรมได้เมื่อมี Symbol + (จำนวน&ราคา) หรือ (ยอดรวมบาท) อย่างใดอย่างหนึ่ง
  // และคำสั่งต้องไม่อยู่ในสถานะที่ยังไม่เกิดขึ้นจริง
  const confirmable =
    !isUnfilled &&
    Boolean(ocr.symbol) &&
    ((ocr.quantity !== null && ocr.pricePerUnit !== null) || ocr.amountThb !== null);

  // Manual Quantity Fallback (Round 10-B) — สลิป Amount-only (มียอดรวม แต่ไม่มีจำนวน)
  // ของสินทรัพย์ที่ "ไม่ใช่ Crypto" (หุ้น/กองทุน ฯลฯ) มักไม่มี Price Feed อัตโนมัติ →
  // เสนอปุ่ม "กรอกจำนวนหุ้น" ควบคู่ปุ่มยืนยัน (ocr.assetType เติมโดย Controller จาก
  // symbolRegistry ; undefined/ไม่รู้จัก = ถือว่าไม่ใช่ Crypto → เสนอทางเลือกไว้ก่อน)
  const amountOnly = ocr.amountThb !== null && ocr.quantity === null;
  const showManualQty = amountOnly && ocr.assetType !== 'crypto';

  // Multi-Currency (Round 10) — แสดงหน่วยตามสกุลที่ AI อ่านได้ (Default THB)
  const unit = ocr.currency === 'USD' ? 'USD' : 'บาท';

  // หัวการ์ด: คำสั่งที่ยังไม่เกิดขึ้นจริงต้องไม่ขึ้นไอคอน 🟢/🔴 แบบรายการที่สำเร็จแล้ว
  // (สีเขียว/แดงสื่อว่า "บันทึกได้เลย" ซึ่งขัดกับสิ่งที่การ์ดกำลังจะบอก)
  const headIcon = isUnfilled ? (isCancelled ? '🚫' : '⏳') : isUnknownSide ? '⚠️' : isBuy ? '🟢' : '🔴';
  const headSuffix = isUnfilled ? (isCancelled ? ' (ยกเลิกแล้ว)' : ' (ยังไม่จับคู่)') : '';

  const body = [
    textLine(`${headIcon} ${sideLabel} ${ocr.symbol}${headSuffix}`, {
      size: 'lg',
      weight: 'bold',
      color: isUnknownSide || isUnfilled ? COLOR.warning : COLOR.textPrimary,
    }),
  ];
  // อ่านทิศทางไม่ชัด → บอกตรงๆ ว่าระบบไม่รู้ และต้องให้ผู้ใช้เลือกเอง (ห้ามเดาให้)
  if (isUnknownSide) {
    body.push(
      textLine('ระบบอ่านไม่ชัดว่าเป็นรายการ "ซื้อ" หรือ "ขาย" กรุณาเลือกให้ถูกต้องก่อนบันทึก', {
        size: 'sm',
        color: COLOR.warning,
        wrap: true,
      })
    );
  }
  // คำสั่งยังไม่เกิดขึ้นจริง → บอกให้ชัดว่า "ยังไม่บันทึก" และต้องกลับมาบันทึกเมื่อจับคู่แล้ว
  // (ผู้ใช้ต้องเข้าใจว่าไม่ใช่ระบบอ่านไม่ออก แต่รายการนี้ยังไม่ควรลง Ledger)
  if (isUnfilled) {
    body.push(
      textLine(
        isCancelled
          ? 'สลิปนี้ระบุว่าคำสั่ง "ถูกยกเลิก/หมดอายุ" จึงไม่มีธุรกรรมเกิดขึ้นจริง ระบบจึงไม่บันทึกให้'
          : 'สลิปนี้ระบุว่าคำสั่ง "ยังไม่จับคู่สำเร็จ" (รอจับคู่/รอเวลาทำการ) ซึ่งอาจไม่เกิดขึ้นจริง ระบบจึงยังไม่บันทึกให้',
        { size: 'sm', color: COLOR.warning, wrap: true }
      ),
      textLine(
        isCancelled
          ? 'หากคำสั่งนี้จับคู่สำเร็จจริง กรุณากด "✏️ บันทึกเอง" ด้านล่าง'
          : 'เมื่อคำสั่งจับคู่สำเร็จแล้ว ให้ส่งสลิปใบใหม่ หรือกด "✏️ บันทึกเอง" ด้านล่าง',
        { size: 'xs', color: COLOR.textSecondary, wrap: true }
      )
    );
  }
  body.push(
    textLine(
      `จำนวน: ${ocr.quantity !== null ? `${formatNumber(ocr.quantity)} ${ocr.symbol}` : naText}`,
      { size: 'sm', color: ocr.quantity !== null ? COLOR.textSecondary : COLOR.warning }
    ),
    textLine(
      `ราคาต่อหน่วย: ${ocr.pricePerUnit !== null ? `${formatNumber(ocr.pricePerUnit)} ${unit}` : naText}`,
      { size: 'sm', color: ocr.pricePerUnit !== null ? COLOR.textSecondary : COLOR.warning }
    )
  );
  // ── ยอดเงิน: แยกบรรทัดให้บวกกันเห็นชัดเมื่อรู้ค่าธรรมเนียม (Migration 041) ──
  //
  // ⚠️ เหตุผลที่ต้องแยกบรรทัด: ผู้ใช้จำ "ยอดที่จ่ายจริง" (เช่น 1,500) แต่ระบบบันทึก
  // "มูลค่าหุ้น" (1,497.60) ซึ่งเป็นฐานต้นทุนที่ถูกต้อง — ถ้าโชว์เลขเดียวโดดๆ ผู้ใช้
  // จะคิดว่าระบบอ่านสลิปผิด (Founder เองยังเข้าใจผิดตอนทดสอบ) การแสดงเป็นรายการที่
  // บวกกันแล้วได้ยอดที่จ่ายจริง ทำให้เข้าใจได้ทันทีโดยไม่ต้องเดา
  if (ocr.amountThb !== null) {
    const hasFee = ocr.feeTotal !== null && ocr.feeTotal !== undefined && ocr.feeTotal > 0;

    body.push(
      textLine(`มูลค่าหุ้น: ${formatNumber(ocr.amountThb)} ${unit}`, {
        size: 'sm',
        color: COLOR.textSecondary,
      })
    );

    if (hasFee) {
      body.push(
        textLine(`ค่าธรรมเนียม: ${formatNumber(ocr.feeTotal)} ${unit}`, {
          size: 'sm',
          color: COLOR.textSecondary,
        })
      );
      // ── บรรทัดยอดรวม: ห้ามอ้างว่าเป็น "ยอดที่จ่ายจริง" ถ้าสลิปไม่ได้ระบุไว้ ──────
      //
      // ⚠️ บั๊ค B (เคสจริง EOSE): เดิมบรรทัดนี้เขียนว่า "รวมจ่ายจริง: 106.59" ทั้งที่
      // ผู้ใช้จ่ายจริง 106.72 ตามสลิป — เพราะเมื่อ AI อ่านยอดสุทธิไม่ได้ (netAmount
      // = null) โค้ดจะบวก "มูลค่าหุ้น + ค่าธรรมเนียม" เองแล้วแปะป้ายว่าเป็นยอดจริง
      // นี่คือข้อความที่ผิดข้อเท็จจริง ไม่ใช่แค่ตัวเลขคลาดเคลื่อน
      //
      // หลักที่ยึด (มติ Founder): แสดงเลขผิดโดยไม่บอกว่าไม่แน่ใจ แย่กว่าไม่แสดงเลย
      //   - สลิประบุยอดสุทธิมา  → แสดงตามสลิป ป้าย "รวมจ่ายจริง/รับจริง" ได้เต็มปาก
      //   - สลิปไม่ระบุ         → แสดงได้แต่ต้องกำกับว่า "คำนวณเอง" ไม่ใช่ยอดจากสลิป
      const netFromSlip = ocr.netAmount !== null && ocr.netAmount !== undefined;
      const totalPaid = netFromSlip
        ? ocr.netAmount
        : Math.round((ocr.amountThb + ocr.feeTotal) * 100) / 100;
      body.push(
        textLine(
          netFromSlip
            ? `รวม${isBuy ? 'จ่ายจริง' : 'รับจริง'}: ${formatNumber(totalPaid)} ${unit}`
            : `รวมโดยประมาณ: ${formatNumber(totalPaid)} ${unit}`,
          {
            size: 'sm',
            weight: 'bold',
            color: COLOR.textPrimary,
          }
        ),
        textLine(
          netFromSlip
            ? `* ระบบบันทึก "มูลค่าหุ้น" เป็นต้นทุน (${formatNumber(ocr.amountThb)} ${unit}) — ต่างจากยอดที่${isBuy ? 'จ่าย' : 'รับ'}เพราะค่าธรรมเนียม ไม่ใช่ระบบอ่านผิด`
            : `* ยอดรวมนี้ระบบคำนวณเอง (มูลค่าหุ้น + ค่าธรรมเนียม) เพราะอ่านยอดสุทธิจากสลิปไม่ได้ — อาจต่างจากยอดที่${isBuy ? 'จ่าย' : 'รับ'}จริงเล็กน้อย กรุณาเทียบกับสลิป`,
          { size: 'xs', color: COLOR.textSecondary, wrap: true }
        )
      );
    }
  }
  body.push(
    textLine(`วันที่: ${ocr.date ?? 'วันนี้ (ไม่พบวันที่ในสลิป)'}`, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    separator(),
    textLine('* ระบบอ่านข้อมูลจากรูปด้วย AI เท่านั้น ไม่ใช่คำแนะนำการลงทุน กรุณาตรวจสอบก่อนกดยืนยัน', {
      size: 'xs',
      color: COLOR.textSecondary,
    }),
    textLine(`* โควตาอ่านสลิปเดือนนี้เหลือ ${ocr.remainingQuota}/${ocr.quotaLimit} ครั้ง`, {
      size: 'xs',
      color: COLOR.textSecondary,
    })
  );
  // คำใบ้นี้อ้างถึงปุ่ม "ยืนยันบันทึก" — ห้ามแสดงตอนที่ไม่มีปุ่มนั้นอยู่จริง (คำสั่งยังไม่จับคู่)
  if (showManualQty && confirmable) {
    body.push(
      textLine('* หากกด "ยืนยันบันทึก" แล้วระบบหาราคาตลาดไม่ได้ ให้กด "✏️ กรอกจำนวนหุ้น" เพื่อระบุจำนวนหน่วยเอง', {
        size: 'xs',
        color: COLOR.warning,
      })
    );
  }

  const footerButtons = [];
  if (confirmable) {
    if (isUnknownSide) {
      // AI อ่านทิศทางไม่ชัด → ไม่มีปุ่ม "ยืนยันบันทึก" เดี่ยวๆ ให้กดพลาด แต่บังคับให้
      // ผู้ใช้ระบุทิศทางเองผ่านปุ่มแยก 2 ทาง (ค่าที่ส่งมาจากผู้ใช้ ไม่ใช่ระบบเดา)
      footerButtons.push(
        {
          type: 'button',
          style: 'primary',
          color: COLOR.profit,
          action: {
            type: 'postback',
            label: '🟢 ยืนยันเป็น "ซื้อ"',
            data: ocrPostback('ocr_confirm', ocr, 'buy'),
            displayText: 'ยืนยันบันทึกเป็นรายการซื้อ',
          },
        },
        {
          type: 'button',
          style: 'primary',
          color: COLOR.loss,
          action: {
            type: 'postback',
            label: '🔴 ยืนยันเป็น "ขาย"',
            data: ocrPostback('ocr_confirm', ocr, 'sell'),
            displayText: 'ยืนยันบันทึกเป็นรายการขาย',
          },
        }
      );
    } else {
      footerButtons.push({
        type: 'button',
        style: 'primary',
        color: isBuy ? COLOR.profit : COLOR.loss,
        action: {
          type: 'postback',
          label: '✅ ยืนยันบันทึก',
          data: ocrPostback('ocr_confirm', ocr),
          displayText: 'ยืนยันบันทึกรายการจากสลิป',
        },
      });
    }
  }
  footerButtons.push({
    type: 'button',
    style: 'secondary',
    action: {
      type: 'postback',
      // Manual Quantity Fallback (Round 10-B) — Amount-only + ไม่ใช่ Crypto ใช้ Label
      // ที่สื่อชัดว่าเป็นการกรอกจำนวนหุ้นเอง (ocr_edit จะ Prefill รูปแบบ "จำนวน + ยอดรวม")
      // คำสั่งที่ยังไม่จับคู่มาก่อนทุกกรณี — ปุ่มนี้คือทางออกเดียวที่เหลือ Label ต้องตรงกับ
      // ข้อความเตือนด้านบนที่บอกให้ "บันทึกเอง" (ไม่ใช่ "กรอกจำนวนหุ้น" ที่สื่อคนละเรื่อง)
      label: isUnfilled
        ? '✏️ บันทึกเอง'
        : showManualQty
          ? '✏️ กรอกจำนวนหุ้น'
          : confirmable
            ? '✏️ แก้ไข'
            : '✏️ กรอกเอง',
      data: ocrPostback('ocr_edit', ocr),
      displayText: 'แก้ไขรายการจากสลิป',
    },
  });

  return {
    type: 'flex',
    // altText คือสิ่งที่ผู้ใช้เห็นใน Notification — ต้องไม่สื่อว่าบันทึกรายการแล้ว
    altText: `อ่านสลิป ${sideLabel} ${ocr.symbol}${headSuffix}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.profitBg,
        paddingAll: '12px',
        contents: [textLine('🧾 อ่านสลิปแล้ว ตรวจสอบก่อนบันทึก', { weight: 'bold', color: COLOR.info })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: { type: 'box', layout: 'vertical', spacing: 'sm', contents: footerButtons },
    },
  };
}

// ข้อความ [แก้ไข] — Prefill คำสั่งซื้อ/ขายให้ผู้ใช้ Copy ไปแก้เฉพาะจุดที่ผิดแล้วส่งใหม่
// เข้า Command Parser เดิม (ไม่เขียน Parser ใหม่) — prefillText มาจาก Controller
function buildOcrEditPrefillMessage(prefillText) {
  return bubble({
    headerText: '✏️ แก้ไขรายการ',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('คัดลอกข้อความด้านล่าง แก้ไขให้ถูกต้อง แล้วส่งกลับมาเพื่อบันทึก', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(prefillText, { size: 'md', weight: 'bold', color: COLOR.textPrimary }),
      textLine('* ส่วนที่เป็น <...> คือค่าที่ AI อ่านไม่ได้ กรุณากรอกแทนที่ก่อนส่ง', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ทิศทางรายการ (ซื้อ/ขาย) หายไปจาก Postback ตอนกดยืนยัน — เกิดได้จากการ์ดเก่าที่ค้าง
// อยู่ในแชท หรือ Postback ที่ถูกแก้ค่ามา ⚠️ ห้ามเดาเป็น "ซื้อ" แล้วบันทึกต่อ เพราะถ้าจริงๆ
// เป็นรายการขายจะได้ Ledger ที่กลับด้าน (P&L/จำนวนหน่วยถือครองผิด) และเป็น Immutable
// Ledger ที่ต้องแก้ด้วย Reversal — ให้ผู้ใช้ส่งสลิปใหม่/พิมพ์คำสั่งเองแทน
function buildOcrSideRequiredMessage() {
  return bubble({
    headerText: '⚠️ ไม่ทราบว่าเป็นการซื้อหรือขาย',
    headerColor: COLOR.warning,
    headerBg: COLOR.lossBg,
    bodyContents: [
      textLine('ระบบไม่ได้รับข้อมูลว่ารายการนี้เป็น "ซื้อ" หรือ "ขาย" จึงยังไม่บันทึกให้', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('กรุณาส่งรูปสลิปใหม่อีกครั้ง แล้วเลือกทิศทางรายการบนการ์ด หรือพิมพ์คำสั่งเอง เช่น', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('ขาย PTT 100 หุ้น ราคา 35', {
        size: 'md',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine('* ระบบจะไม่เดาทิศทางรายการให้ เพราะหากบันทึกผิดด้านจะทำให้กำไร/ขาดทุนคำนวณผิด', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// ข้อความ [กรอกจำนวนหุ้นเอง] — Manual Quantity Fallback (Round 10-B) สำหรับสลิป
// Amount-only ของสินทรัพย์ที่ไม่มี Price Feed อัตโนมัติ (หุ้น Small-cap เช่น EOSE)
// Prefill รูปแบบ "จำนวน + ยอดรวม" ให้ผู้ใช้เติมแค่จำนวนหุ้น แล้วส่งกลับเข้า Command
// Parser เดิม (ไม่เขียน Parser ใหม่) — ระบบคำนวณราคาต่อหน่วย = ยอดรวม / จำนวน เอง
function buildOcrManualQuantityMessage(prefillText) {
  return bubble({
    headerText: '✏️ กรอกจำนวนหุ้นเอง',
    headerColor: COLOR.info,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('สินทรัพย์นี้ยังไม่มีราคาตลาดอัตโนมัติ จึงคำนวณจำนวนหุ้นจากยอดเงินให้ไม่ได้', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine('คัดลอกข้อความด้านล่าง แทนที่ <จำนวนหุ้น> ด้วยจำนวนจริง แล้วส่งกลับมาเพื่อบันทึก', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      textLine(prefillText, { size: 'md', weight: 'bold', color: COLOR.textPrimary }),
      textLine('* ระบบจะคำนวณราคาต่อหน่วยให้อัตโนมัติจาก ยอดรวม ÷ จำนวนหุ้น', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

// อ่านสลิปเป็นฟีเจอร์ Premium — ตอบเมื่อผู้ใช้ที่ไม่ใช่ Premium ส่งรูป (ไม่มีคำขอชำระเงิน
// ค้าง) พร้อม CTA อัพเกรด (Reuse ปุ่มแพ็กเกจเดิม premiumPeriodButtons)
// reason: undefined = ยังไม่เคยได้สิทธิ์ทดลอง (ข้อความเดิม) — Backward Compatible
//         'TRIAL_EXHAUSTED'  = ใช้สิทธิ์ทดลองฟรีครบ 3 ครั้งแล้ว
//         'TRIAL_CALL_LIMIT' = ชนเพดานคุมต้นทุนของผู้ใช้ Free (ส่งรูปที่อ่านไม่ออกซ้ำๆ)
function buildOcrPremiumRequiredMessage(reason) {
  // ⚠️ จงใจไม่ใส่ตัวเลขโควตาทดลองในข้อความนี้ เพื่อไม่ให้ View Layer ต้อง import
  // slipOcrAccess.service (ซึ่งลากสาย repository → config/supabase ที่มี Side Effect
  // เข้ามาในไฟล์ที่ตอนนี้ import แค่ thaiDate.util) — จำนวนครั้งที่เหลือถูกบอกผู้ใช้
  // ตั้งแต่การ์ด Preview ทุกใบระหว่างที่ยังทดลองอยู่แล้ว (ดู buildOcrPreviewMessage)
  const isTrialEnded = reason === 'TRIAL_EXHAUSTED' || reason === 'TRIAL_CALL_LIMIT';
  const headline = isTrialEnded
    ? 'ใช้สิทธิ์ทดลองอ่านสลิปด้วย AI ครบแล้ว'
    : 'อ่านสลิปด้วย AI เป็นฟีเจอร์สมาชิก Premium 👑';

  const detail =
    reason === 'TRIAL_CALL_LIMIT'
      ? 'อัพเกรดเป็น Premium เพื่อส่งรูปสลิปให้ระบบอ่านและกรอกรายการซื้อ/ขายให้อัตโนมัติ (รวมถึงรูปที่อ่านไม่ออกและต้องส่งใหม่)'
      : 'อัพเกรดเป็น Premium เพื่อส่งรูปสลิปให้ระบบอ่านและกรอกรายการซื้อ/ขายให้อัตโนมัติ';

  const body = [
    textLine(headline, {
      size: 'md',
      weight: 'bold',
      color: COLOR.textPrimary,
    }),
    textLine(detail, {
      size: 'sm',
      color: COLOR.textSecondary,
    }),
    separator(),
    textLine('เลือกแพ็กเกจด้านล่างเพื่ออัพเกรดได้เลย', { size: 'sm', color: COLOR.textPrimary }),
  ];

  return {
    type: 'flex',
    altText: 'อ่านสลิปเป็นฟีเจอร์ Premium',
    contents: {
      type: 'bubble',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: COLOR.warningBg,
        paddingAll: '12px',
        contents: [textLine('👑 ฟีเจอร์ Premium', { weight: 'bold', color: COLOR.warning })],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        contents: premiumPeriodButtons('รายเดือน 59 บาท', 'รายปี 590 บาท'),
      },
    },
  };
}

// ข้อความ Error ของ Flow OCR (Quota/ไม่ใช่สลิป/หลายรายการ/Rate Limit/ล้มเหลว) เป็นไทย
// ทั้งหมด ไม่ปล่อย Error ดิบ — ทุกกรณีย้ำว่า "ไม่ถูกนับโควตา" ตามที่เกี่ยวข้อง
const OCR_ERROR = {
  OCR_QUOTA_EXCEEDED: {
    header: '⚠️ ใช้ครบโควตาเดือนนี้แล้ว',
    color: COLOR.warning,
    bg: COLOR.warningBg,
    message:
      'คุณใช้สิทธิ์อ่านสลิปด้วย AI ครบ 50 ครั้งในเดือนนี้แล้ว สิทธิ์จะรีเซ็ตในเดือนถัดไป ระหว่างนี้ยังพิมพ์คำสั่งซื้อ/ขายเองได้ตามปกติ',
  },
  // แยกจาก OCR_QUOTA_EXCEEDED โดยตั้งใจ (Offensive Review R2 — F2): อันนั้นคือ
  // "ใช้สิทธิ์อ่านสำเร็จครบ 50 ครั้ง" ที่ผู้ใช้คุ้นเคยและเป็นสิ่งที่เราสัญญาไว้ ส่วนอันนี้คือ
  // "ส่งรูปที่อ่านไม่ออกเข้ามาเยอะผิดปกติ" ซึ่งผู้ใช้สุจริตแทบไม่มีทางเจอ — ถ้าใช้ข้อความ
  // เดียวกันจะสับสนหนักมาก (เห็น "โควตาหมด" ทั้งที่ยอดอ่านสำเร็จยังเหลือเพียบ)
  // ⚠️ ไม่บอกตัวเลขเพดานในข้อความ — ไม่มีประโยชน์กับผู้ใช้จริง และเป็นการบอกใบ้
  // ขอบเขตให้คนที่ตั้งใจยิงรัวรู้ว่าต้องหยุดตรงไหน
  OCR_CALL_LIMIT_EXCEEDED: {
    header: '⚠️ ส่งรูปเข้ามามากผิดปกติ',
    color: COLOR.warning,
    bg: COLOR.warningBg,
    message:
      'ระบบพบการส่งรูปเข้ามาอ่านมากผิดปกติในเดือนนี้ จึงพักการอ่านสลิปด้วย AI ไว้ชั่วคราว สิทธิ์จะรีเซ็ตในเดือนถัดไป ระหว่างนี้ยังพิมพ์คำสั่งซื้อ/ขายเองได้ตามปกติ หากคิดว่าผิดพลาด กรุณาติดต่อทีมงาน',
  },
  OCR_NOT_A_SLIP: {
    header: '🔍 ไม่พบข้อมูลการซื้อขาย',
    color: COLOR.warning,
    bg: COLOR.warningBg,
    message:
      'ไม่พบข้อมูลการซื้อ/ขายสินทรัพย์ในรูปนี้ กรุณาส่งรูปสลิปที่ชัดเจน หรือพิมพ์คำสั่งเอง เช่น "ซื้อ BTC 0.01 หุ้น ราคา 3400000" (ครั้งนี้ไม่ถูกนับโควตา)',
  },
  OCR_MULTIPLE_ITEMS: {
    header: '📄 พบหลายรายการในรูป',
    color: COLOR.info,
    bg: COLOR.profitBg,
    message:
      'รูปนี้มีหลายรายการ ระบบยังไม่รองรับการอ่าน Statement หลายรายการต่อรูป กรุณาใช้คำสั่ง "นำเข้าพอร์ต" เพื่อนำเข้าหลายรายการ หรือส่งสลิปทีละรายการ (ครั้งนี้ไม่ถูกนับโควตา)',
  },
  OCR_RATE_LIMITED: {
    header: '⏳ ส่งเร็วเกินไป',
    color: COLOR.warning,
    bg: COLOR.warningBg,
    message: 'คุณส่งรูปถี่เกินไป กรุณารอสักครู่ (ประมาณ 10 วินาที) แล้วส่งใหม่อีกครั้ง',
  },
  OCR_FAILED: {
    header: '⚠️ อ่านสลิปไม่สำเร็จ',
    color: COLOR.warning,
    bg: COLOR.warningBg,
    message:
      'อ่านสลิปไม่สำเร็จในขณะนี้ กรุณาลองส่งรูปใหม่อีกครั้งภายหลัง หรือพิมพ์คำสั่งซื้อ/ขายเอง (การอ่านที่ไม่สำเร็จไม่ถูกนับโควตา)',
  },
  OCR_NOT_CONFIGURED: {
    header: '⚠️ ระบบยังไม่พร้อม',
    color: COLOR.warning,
    bg: COLOR.warningBg,
    message: 'ระบบอ่านสลิปด้วย AI ยังไม่พร้อมใช้งานในขณะนี้ กรุณาลองใหม่ภายหลังหรือติดต่อทีมงาน',
  },
};

function buildOcrErrorMessage(code) {
  const e = OCR_ERROR[code] ?? OCR_ERROR.OCR_FAILED;
  return bubble({
    headerText: e.header,
    headerColor: e.color,
    headerBg: e.bg,
    bodyContents: [textLine(e.message, { size: 'sm', color: COLOR.textPrimary })],
  });
}

// ═══════════════════════════════════════════════════════════════════════
// ถามหาสลิปหลังบันทึกรายการที่ผู้ใช้ "พิมพ์เอง" (transactionSlipSession)
// ═══════════════════════════════════════════════════════════════════════
// ⚠️ ข้อความในกลุ่มนี้ "ห้ามอ้างเรื่องภาษี" เด็ดขาด (คำสั่งชัดเจนของงานนี้):
// ห้ามเขียนทำนอง "เก็บไว้ยื่นภาษี" / "ใช้ลดหย่อนภาษีได้" เพราะเท่ากับระบบรับรองว่า
// สลิปนี้ใช้กับภาษีได้จริง ซึ่งเราไม่อยู่ในฐานะรับประกัน และสุ่มเสี่ยงเข้าข่ายให้
// คำแนะนำด้านภาษี — ใช้สำนวนกลางๆ "เป็นหลักฐาน เผื่อต้องใช้ภายหลัง" ซึ่งสื่อประโยชน์
// เหมือนกันแต่ไม่สัญญาแทนผู้ใช้ (ยึดแนวเดียวกับ Disclaimer เดิมของระบบที่ย้ำว่า
// EasyDCA เป็นผู้ช่วยบันทึก ไม่ใช่ที่ปรึกษา)
function buildSlipAttachPromptMessage() {
  return bubble({
    headerText: '📎 แนบสลิปไว้ด้วยไหม',
    headerColor: COLOR.info,
    headerBg: COLOR.infoBg,
    bodyContents: [
      textLine('ส่งรูปสลิปของรายการนี้เข้ามาได้เลย ระบบจะเก็บแนบไว้กับรายการเป็นหลักฐาน เผื่อต้องใช้ภายหลัง', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
      separator(),
      textLine('ถ้าไม่แนบก็ข้ามได้เลย ไม่ต้องทำอะไรเพิ่ม (คำขอนี้จะหมดอายุเองใน 10 นาที)', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

function buildSlipAttachedMessage() {
  return bubble({
    headerText: '✅ แนบสลิปเรียบร้อย',
    headerColor: COLOR.profit,
    headerBg: COLOR.profitBg,
    bodyContents: [
      textLine('เก็บรูปสลิปไว้กับรายการนี้แล้ว เปิดดูย้อนหลังได้ที่หน้าเว็บ Dashboard → ประวัติรายการ', {
        size: 'sm',
        color: COLOR.textPrimary,
      }),
    ],
  });
}

// code มาจาก StorageServiceError (INVALID_SLIP_CONTENT_TYPE / SLIP_TOO_LARGE) หรือ
// undefined เมื่อเป็นความล้มเหลวอื่น — ย้ำเสมอว่า "ธุรกรรมบันทึกสำเร็จแล้ว" เพราะ
// เส้นทางนี้เกิดหลัง Commit เท่านั้น ผู้ใช้ต้องไม่เข้าใจผิดว่ารายการหายไปด้วย
const SLIP_ATTACH_FAILED_DETAIL = {
  INVALID_SLIP_CONTENT_TYPE: 'ไฟล์ต้องเป็นรูปภาพ (JPG, PNG, WebP หรือ GIF) เท่านั้น',
  SLIP_TOO_LARGE: 'ไฟล์รูปใหญ่เกินไป (สูงสุด 10 MB)',
};

function buildSlipAttachFailedMessage(code) {
  const detail =
    SLIP_ATTACH_FAILED_DETAIL[code] ?? 'แนบรูปไม่สำเร็จในขณะนี้ กรุณาลองใหม่ภายหลัง';

  return bubble({
    headerText: '⚠️ แนบสลิปไม่สำเร็จ',
    headerColor: COLOR.warning,
    headerBg: COLOR.warningBg,
    bodyContents: [
      textLine('รายการของคุณถูกบันทึกเรียบร้อยแล้ว — ไม่ได้หายไปไหน', {
        size: 'sm',
        weight: 'bold',
        color: COLOR.textPrimary,
      }),
      textLine(detail, { size: 'sm', color: COLOR.textSecondary }),
      separator(),
      textLine('แนบสลิปย้อนหลังได้ที่หน้าเว็บ Dashboard → ประวัติรายการ', {
        size: 'xs',
        color: COLOR.textSecondary,
      }),
    ],
  });
}

module.exports = {
  ERROR_MESSAGES,
  buildOcrPreviewMessage,
  buildOcrEditPrefillMessage,
  buildOcrManualQuantityMessage,
  buildOcrSideRequiredMessage,
  buildOcrPremiumRequiredMessage,
  buildSlipAttachPromptMessage,
  buildSlipAttachedMessage,
  buildSlipAttachFailedMessage,
  buildOcrErrorMessage,
  buildExportFormatQuickReply,
  buildReportReadyMessage,
  buildExportPremiumRequiredMessage,
  buildExportFormatHelpMessage,
  buildBuyConfirmMessage,
  buildSellConfirmMessage,
  buildProfitMessage,
  buildPreviewMessage,
  buildCancelledMessage,
  buildEditHintMessage,
  buildPortfolioMessage,
  buildHistoryMessage,
  buildUndoMessage,
  buildPdpaConsentRequiredMessage,
  buildPdpaConsentAcceptedMessage,
  buildPdpaConsentDeclinedMessage,
  // บัญชีถูกล็อก (F7) — Parity กับ ACCOUNT_LOCKED ฝั่ง REST
  buildAccountLockedMessage,
  buildErasureConfirmMessage,
  buildDataErasedMessage,
  buildReminderSetMessage,
  buildReminderListMessage,
  buildReminderDeletedMessage,
  buildReminderPushMessage,
  buildPortfolioSummaryPushMessage,
  buildSymbolQuickReply,
  buildFrequencyQuickReply,
  buildDayOfWeekQuickReply,
  buildDayOfMonthQuickReply,
  buildAskAmountMessage,
  buildReminderSetupCancelledMessage,
  // Guided Buy Flow (S8 R2 รอบ 2)
  buildGuidedBuySymbolQuickReply,
  buildGuidedBuyAskSymbolMessage,
  buildGuidedBuyAmountQuickReply,
  buildGuidedBuyAskAmountMessage,
  buildGuidedBuyCancelledMessage,
  buildGuidedBuyBusyMessage,
  buildAdminPaymentRequestMessage,
  buildAdminApproveAckMessage,
  buildAdminSupportRequestMessage,
  buildSupportLinkMessage,
  buildAdminRejectAckMessage,
  buildPaymentApprovedMessage,
  buildPaymentRejectedMessage,
  buildFreeTrialClaimedMessage,
  buildAdminFacebookLikeRequestMessage,
  buildFacebookLikeApprovedMessage,
  buildFacebookLikeRejectedMessage,
  buildPremiumOfferMessage,
  buildPremiumStatusMessage,
  buildPaymentQrMessage,
  buildPaymentNotifySubmittedMessage,
  buildSlipReceivedMessage,
  buildBulkImportInstructionsMessage,
  buildBulkImportEmptyMessage,
  buildBulkImportRejectedMessage,
  buildBulkImportPreviewMessage,
  buildBulkImportConfirmedMessage,
  buildFundClassPickerMessage,
  buildFundNotFoundMessage,
  buildDashboardLinkMessage,
  buildPlanDowngradedMessage,
  buildPremiumExpiringSoonMessage,
  buildErrorMessage,
  buildAddGuideMessage,
  buildUnknownCommandMessage,
  buildFallbackMenuMessage,
  buildHelpMessage,
  buildWelcomeIntroMessage,
  buildWelcomeGuideMessage,
  buildWelcomeFreeTrialMessage,
};
