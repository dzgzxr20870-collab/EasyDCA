const express = require('express');
const validateLineSignature = require('../middleware/lineSignature.middleware');

const router = express.Router();

router.post('/', validateLineSignature, (req, res) => {
  const events = req.body.events || [];
  console.log('[webhook] Received LINE events:', JSON.stringify(events, null, 2));

  // LINE Messaging API ต้องได้ 200 OK เสมอ ไม่เช่นนั้นจะ Retry ส่ง Event ซ้ำ
  res.status(200).json({ success: true, data: null });
});

module.exports = router;
