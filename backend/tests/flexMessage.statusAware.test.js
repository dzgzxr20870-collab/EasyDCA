// ═══════════════════════════════════════════════════════════════════════
// flexMessage.statusAware — ข้อความต้องแยกตาม status จริง ไม่ใช่ "ถูกดำเนินการไปแล้ว"
// เหมือนกันหมด (fix/misleading-messages ข้อ 3) + ข้อ 6 PRICE_FEED_NOT_IMPLEMENTED
// ═══════════════════════════════════════════════════════════════════════
// buildErrorMessage เป็น Pure Function ล้วน (ไม่แตะ DB/Network) จึง Test ตรงๆ ได้
// โดยไม่ต้อง Mock อะไรเลย — ดู webhook.controller.test.js สำหรับ Integration Test
// ที่พิสูจน์ว่า err.details ถูกส่งมาถึงชั้นนี้จริงจาก confirmPending/cancelPending

const flexMessage = require('../src/utils/flexMessage.util');

describe('PENDING_ALREADY_RESOLVED — แยกข้อความตาม pending_transactions.status จริง', () => {
  test('status=confirmed → บอกว่าบันทึกสำเร็จแล้ว ไม่ใช่ข้อความกลางๆ', () => {
    const text = JSON.stringify(
      flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED', { status: 'confirmed' })
    );
    expect(text).toContain('บันทึกรายการนี้เรียบร้อยแล้ว');
    expect(text).not.toContain('ถูกดำเนินการไปแล้ว');
  });

  test('status=cancelled → บอกว่าไม่ได้บันทึกลงพอร์ต (ถูกยกเลิกไปก่อนหน้านี้)', () => {
    const text = JSON.stringify(
      flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED', { status: 'cancelled' })
    );
    expect(text).toContain('ไม่ได้บันทึกลงพอร์ต');
  });

  test('status=expired → บอกว่าหมดเวลายืนยัน ไม่ได้บันทึก', () => {
    const text = JSON.stringify(
      flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED', { status: 'expired' })
    );
    expect(text).toContain('หมดเวลายืนยัน');
    expect(text).toContain('ไม่ได้บันทึก');
  });

  test('confirmed / cancelled / expired ต้องได้ข้อความไม่ซ้ำกันเลยสักคู่ (พิสูจน์ว่าแยกจริง)', () => {
    const msgs = ['confirmed', 'cancelled', 'expired'].map((status) =>
      JSON.stringify(flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED', { status }))
    );
    expect(new Set(msgs).size).toBe(3);
  });

  // Error ธรรมดาที่ตั้ง .code เองไม่มี .details แนบมา (Pattern ที่ใช้อยู่จริงใน
  // webhook.controller.test.js เดิมหลายจุด) ต้องไม่ throw และได้ข้อความเดิมกลับมา
  test('ไม่มี details เลย (undefined) → Fallback ข้อความเดิม ไม่ throw', () => {
    expect(() => flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED')).not.toThrow();
    const text = JSON.stringify(flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED'));
    expect(text).toContain('ถูกดำเนินการไปแล้ว');
  });

  test('status ที่ไม่รู้จัก → Fallback ข้อความเดิมเช่นกัน (กัน Enum ใหม่ในอนาคต)', () => {
    const text = JSON.stringify(
      flexMessage.buildErrorMessage('PENDING_ALREADY_RESOLVED', { status: 'some_future_status' })
    );
    expect(text).toContain('ถูกดำเนินการไปแล้ว');
  });
});

describe('PAYMENT_NOT_PENDING — แยกข้อความตาม payments.status จริง', () => {
  test('status=approved → บอกว่าอนุมัติแล้ว ได้ Premium', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PAYMENT_NOT_PENDING', { status: 'approved' }));
    expect(text).toContain('อนุมัติแล้ว');
  });

  test('status=rejected → บอกว่าถูกปฏิเสธ', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PAYMENT_NOT_PENDING', { status: 'rejected' }));
    expect(text).toContain('ถูกปฏิเสธ');
  });

  test('status=reviewing → บอกว่ากำลังตรวจสอบอยู่ ไม่ต้องแจ้งซ้ำ', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PAYMENT_NOT_PENDING', { status: 'reviewing' }));
    expect(text).toContain('ระหว่างตรวจสอบ');
  });

  test('status=expired → บอกว่าหมดเวลาแล้ว', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PAYMENT_NOT_PENDING', { status: 'expired' }));
    expect(text).toContain('หมดเวลา');
  });

  test('approved / rejected / reviewing / expired ได้ข้อความไม่ซ้ำกันเลยสักคู่', () => {
    const msgs = ['approved', 'rejected', 'reviewing', 'expired'].map((status) =>
      JSON.stringify(flexMessage.buildErrorMessage('PAYMENT_NOT_PENDING', { status }))
    );
    expect(new Set(msgs).size).toBe(4);
  });

  // Regression กันพัง webhook.controller.test.js เดิม (Mock err ธรรมดาไม่มี details)
  test('ไม่มี details เลย → Fallback ข้อความเดิม', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PAYMENT_NOT_PENDING'));
    expect(text).toContain('ถูกดำเนินการไปแล้ว');
  });
});

describe('buildErrorMessage — Backward Compat กับ Call Site เดิมทั้งหมดที่ไม่เกี่ยวกับ status', () => {
  test('เรียกแบบ Arg เดียว (ไม่ส่ง details) ยังทำงานเหมือนเดิมสำหรับ Code อื่น', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('GOLD_PRICE_UNAVAILABLE'));
    expect(text).toContain('ราคาทองคำ');
    expect(text).not.toContain('GOLD_PRICE_UNAVAILABLE');
  });

  test('details ที่ไม่เกี่ยวกับ status-aware code (เช่น ASSET_LIMIT_REACHED) ไม่กระทบข้อความ', () => {
    const text = JSON.stringify(
      flexMessage.buildErrorMessage('ASSET_LIMIT_REACHED', { status: 'confirmed' })
    );
    expect(text).toContain('Free');
  });
});

describe('ข้อ 2 + 5 — buildUndoMessage: คำว่า "ย้อน" + ผลลัพธ์ขึ้นก่อนกลไก', () => {
  const { buildCancelledMessage, buildUndoMessage } = flexMessage;

  const UNDO_RESULT = {
    originalType: 'buy',
    symbol: 'ASTS',
    quantity: 20.0104114,
    amountThb: 1497.6,
  };

  test('Header ใช้คำว่า "ย้อน" ไม่ใช่ "ยกเลิก" (ต่างจาก buildCancelledMessage โดยตั้งใจ)', () => {
    const text = JSON.stringify(buildUndoMessage(UNDO_RESULT));
    expect(text).toContain('ย้อนรายการล่าสุดแล้ว');
    expect(text).not.toContain('ยกเลิกรายการล่าสุดแล้ว');
  });

  // buildCancelledMessage (Pending ที่ไม่เคยบันทึก) ใช้ "ยกเลิก" ถูกอยู่แล้ว — ต้อง
  // ไม่ถูกแก้ไปด้วย (คนละเหตุการณ์กับ buildUndoMessage — มติ Founder: ห้ามใช้คำ
  // เดียวกัน แปลว่าสองข้อความนี้ต้อง "ต่างกัน" ไม่ใช่ทั้งคู่กลายเป็นคำเดียวกัน)
  test('buildCancelledMessage ยังใช้ "ยกเลิก" เหมือนเดิม (ถูกต้องอยู่แล้ว ไม่ต้องแก้)', () => {
    const text = JSON.stringify(buildCancelledMessage());
    expect(text).toContain('ยกเลิกรายการแล้ว');
  });

  test('buildUndoMessage และ buildCancelledMessage ไม่ใช้คำเดียวกันสื่อผลลัพธ์ (Header ต่างกัน)', () => {
    const undoHeader = buildUndoMessage(UNDO_RESULT).contents.header.contents[0].text;
    const cancelHeader = buildCancelledMessage().contents.header.contents[0].text;
    expect(undoHeader).not.toBe(cancelHeader);
    expect(undoHeader).toContain('ย้อน');
    expect(cancelHeader).toContain('ยกเลิก');
  });

  // Founder: "เอาผลลัพธ์ขึ้นก่อน เช่น 'ยอด ASTS ในพอร์ตกลับไปเป็นเหมือนก่อนบันทึก
  // รายการนี้แล้ว' แล้วค่อยตามด้วยหมายเหตุตัวเล็กว่าประวัติยังเก็บไว้"
  test('บรรทัดแรกของ Body บอกผลลัพธ์ก่อน (ยอดในพอร์ตกลับไปเป็นเท่าไหร่)', () => {
    const firstLine = buildUndoMessage(UNDO_RESULT).contents.body.contents[0].text;
    expect(firstLine).toContain('ASTS');
    expect(firstLine).toContain('กลับไปเป็นเหมือนก่อนบันทึก');
  });

  test('คำอธิบายกลไก (สร้างรายการตรงข้าม/ประวัติยังเก็บไว้) ยังอยู่ แต่เป็นหมายเหตุท้ายการ์ด ไม่ใช่บรรทัดแรก', () => {
    const bodyTexts = buildUndoMessage(UNDO_RESULT).contents.body.contents.map((c) => c.text);
    const mechanismLine = bodyTexts.find((t) => t.includes('สร้างรายการตรงข้าม'));
    expect(mechanismLine).toBeDefined();
    expect(mechanismLine).toContain('ประวัติเดิมยังถูกเก็บไว้ครบถ้วน');
    expect(bodyTexts.indexOf(mechanismLine)).toBeGreaterThan(0); // ไม่ใช่บรรทัดแรก
  });

  test('ยังแสดงจำนวน + มูลค่ารวมครบเหมือนเดิม (ไม่เสียข้อมูลเดิมไประหว่างจัดลำดับใหม่)', () => {
    const text = JSON.stringify(buildUndoMessage(UNDO_RESULT));
    expect(text).toContain('20.0104114');
    expect(text).toContain('1,497.6');
  });
});

describe('ข้อ 6 — PRICE_FEED_NOT_IMPLEMENTED ต้องไม่อ้างว่า "รองรับเฉพาะ Crypto" (ผิดข้อเท็จจริง)', () => {
  // ไล่โค้ดยืนยันแล้ว: priceFeed.service.getCurrentPrice route type==='stock_us' ผ่าน
  // Twelve Data ด้วย (ไม่ใช่แค่ Crypto ผ่าน CoinGecko) — ดู Comment เต็มที่จุดแก้ไข
  test('ไม่มีคำว่า "รองรับเฉพาะบางสินทรัพย์" อีกต่อไป', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PRICE_FEED_NOT_IMPLEMENTED'));
    expect(text).not.toContain('รองรับเฉพาะบางสินทรัพย์');
  });

  test('พูดถึงหุ้นสหรัฐ + แนะนำ "usd" เป็นทางที่ใช้ได้จริง (เสถียรกว่าเพราะยิง Request เดียว)', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PRICE_FEED_NOT_IMPLEMENTED'));
    expect(text).toContain('หุ้นสหรัฐ');
    expect(text).toContain('usd');
  });

  test('ยังคงบอกทางสำรอง (ระบุจำนวนหน่วย+ราคาเอง) ไว้เหมือนเดิม', () => {
    const text = JSON.stringify(flexMessage.buildErrorMessage('PRICE_FEED_NOT_IMPLEMENTED'));
    expect(text).toContain('จำนวนหน่วย');
    expect(text).not.toContain('PRICE_FEED_NOT_IMPLEMENTED');
  });
});

describe('ข้อ (fix/undo-command-aliases) — buildHelpMessage สอนคำสั่ง Undo ที่ตรงกับ Regex จริง', () => {
  // buildHelpMessage() ไม่รับ Parameter — สอน "คำสั่งที่พิมพ์ตรงได้" ทั้งหมดไว้ที่เดียว
  // (Expert Path) เดิมสอนแค่ "ยกเลิกล่าสุด" ทั้งที่การ์ดยืนยัน/ปุ่มเว็บพูดคำว่า "ย้อน"
  // มาตั้งแต่ fix/misleading-messages (d89c2b6) — ต้องสอนคำที่ตรงกับที่ระบบพูดเอง
  test('สอนคำว่า "ย้อนล่าสุด" (ตรงกับที่การ์ดยืนยันพูด) พร้อมระบุว่า "ยกเลิกล่าสุด" ยังใช้ได้', () => {
    const text = JSON.stringify(flexMessage.buildHelpMessage());
    expect(text).toContain('ย้อนล่าสุด');
    expect(text).toContain('ยกเลิกล่าสุด');
  });
});
