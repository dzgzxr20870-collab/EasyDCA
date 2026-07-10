// flexMessage.util — Builders สำหรับ Export รายงาน (Phase 3 Round 8)
const flex = require('../src/utils/flexMessage.util');

// ดึง Postback data ทั้งหมดใน Quick Reply items
function itemDatas(msg) {
  return msg.quickReply.items.map((i) => i.action.data);
}

describe('buildExportFormatQuickReply', () => {
  test('month → ปุ่ม PDF/Excel พก rt=month + แสดง label ช่วงเวลา', () => {
    const msg = flex.buildExportFormatQuickReply({ range: 'month' }, 'เดือนกรกฎาคม 2569');
    expect(msg.type).toBe('text');
    expect(msg.text).toContain('เดือนกรกฎาคม 2569');
    const datas = itemDatas(msg);
    expect(datas).toContain('action=export_report&format=pdf&rt=month');
    expect(datas).toContain('action=export_report&format=excel&rt=month');
  });

  test('custom → พก from/to ใน Postback', () => {
    const msg = flex.buildExportFormatQuickReply(
      { range: 'custom', from: '2026-01-01', to: '2026-06-30' },
      '1 มกราคม 2569 - 30 มิถุนายน 2569'
    );
    const datas = itemDatas(msg);
    expect(datas).toContain('action=export_report&format=pdf&rt=custom&from=2026-01-01&to=2026-06-30');
  });
});

describe('buildReportReadyMessage', () => {
  test('ปุ่มดาวน์โหลดชี้ไป Signed URL + คำเตือนหมดอายุตามนาทีที่ส่งมา', () => {
    const msg = flex.buildReportReadyMessage({
      signedUrl: 'https://cdn/reports/u1-1.pdf?token=abc',
      format: 'pdf',
      rangeLabel: 'เดือนกรกฎาคม 2569',
      expiresMinutes: 15,
    });

    const button = msg.contents.footer.contents[0];
    expect(button.action.type).toBe('uri');
    expect(button.action.uri).toBe('https://cdn/reports/u1-1.pdf?token=abc');

    const bodyText = JSON.stringify(msg.contents.body.contents);
    expect(bodyText).toContain('15 นาที');
    expect(bodyText).toContain('เดือนกรกฎาคม 2569');
    expect(bodyText).toContain('PDF');
  });
});

describe('buildExportPremiumRequiredMessage', () => {
  test('มีปุ่มอัพเกรด (request_payment) รายเดือน/รายปี', () => {
    const msg = flex.buildExportPremiumRequiredMessage();
    const datas = msg.contents.footer.contents.map((b) => b.action.data);
    expect(datas).toContain('action=request_payment&period=monthly');
    expect(datas).toContain('action=request_payment&period=yearly');
  });
});

describe('buildExportFormatHelpMessage', () => {
  test('อธิบายรูปแบบคำสั่งพร้อมตัวอย่าง (bubble)', () => {
    const msg = flex.buildExportFormatHelpMessage();
    const text = JSON.stringify(msg);
    expect(text).toContain('ส่งออกรายงาน');
    expect(text).toContain('เดือนนี้');
    expect(text).toContain('ปีนี้');
  });
});

describe('ERROR_MESSAGES — Export codes', () => {
  test('มีข้อความไทยครบสำหรับ code Export', () => {
    for (const code of ['EXPORT_INVALID_RANGE', 'EXPORT_INVALID_FORMAT', 'EXPORT_USER_NOT_FOUND', 'EXPORT_GENERATION_FAILED']) {
      expect(typeof flex.ERROR_MESSAGES[code]).toBe('string');
      expect(flex.ERROR_MESSAGES[code].length).toBeGreaterThan(0);
    }
  });
});
