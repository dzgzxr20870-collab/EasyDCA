const { ping } = require('../src/controllers/admin.controller');

function mockRes() {
  const res = {};
  res.status = jest.fn().mockReturnValue(res);
  res.json = jest.fn().mockReturnValue(res);
  return res;
}

describe('admin.controller.ping', () => {
  test('คืน 200 { ok: true, role } สะท้อน role จาก req.user (ที่ requireAdmin การันตีว่า admin แล้ว)', () => {
    const req = { user: { id: 'admin-1', lineUserId: 'Uadmin1', role: 'admin' } };
    const res = mockRes();

    ping(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ ok: true, role: 'admin' });
  });
});
