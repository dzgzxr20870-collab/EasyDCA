const express = require('express');
const validateLineSignature = require('../middleware/lineSignature.middleware');
const webhookController = require('../controllers/webhook.controller');

const router = express.Router();

router.post('/', validateLineSignature, async (req, res) => {
  const events = req.body.events || [];

  // ประมวลผลทุก Event แบบแยกจากกัน — Event หนึ่งพังไม่กระทบ Event อื่น
  await Promise.all(
    events.map((event) =>
      webhookController.handleEvent(event).catch((err) => {
        console.error(`[webhook] event processing failed: ${err.message}`);
      })
    )
  );

  // LINE Messaging API ต้องได้ 200 OK เสมอ ไม่เช่นนั้นจะ Retry ส่ง Event ซ้ำ
  res.status(200).json({ success: true, data: null });
});

module.exports = router;
