// GET /api/v1/admin/ping — Wiring Check ชั่วคราวของ Round 4a เท่านั้น
// ผ่าน requireAuth + requireAdmin มาแล้ว จึงการันตีว่า req.user.role === 'admin'
// ใช้ยืนยันว่าเส้นทาง Auth → Authorization → Route เดินครบทั้ง Stack ก่อนเริ่ม Round 4b
// (จะถูกแทนที่ด้วย Endpoint จริงของ Admin Dashboard ใน Round 4b)
function ping(req, res) {
  return res.status(200).json({ ok: true, role: req.user.role });
}

module.exports = { ping };
