// ต้อง Load และ Validate Environment Variables ก่อน Import อย่างอื่นเสมอ
// (ถ้าค่าที่จำเป็นหายไป ต้อง Fail ทันทีตั้งแต่ Startup ไม่ใช่ตอน Request เข้ามา)
const config = require('./config/env');

const express = require('express');
const cors = require('cors');

const app = express();

app.use(cors());
app.use(express.json());

// Railway Health Check (ดู docs/DEPLOYMENT.md § 3.1)
app.get('/health', (req, res) => {
  res.status(200).json({ success: true, data: { status: 'ok' } });
});

app.listen(config.app.port, () => {
  console.log(`EasyDCA API Server listening on port ${config.app.port} (${config.app.nodeEnv})`);
});

module.exports = app;
