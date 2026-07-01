const crypto = require('crypto');
const config = require('../config/env');

function validateLineSignature(req, res, next) {
  const signature = req.headers['x-line-signature'];

  if (!signature || !req.rawBody) {
    console.warn('[webhook] Missing x-line-signature header or raw body');
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_SIGNATURE',
        message: 'Missing x-line-signature header or request body',
        details: {},
      },
    });
  }

  const expectedSignature = crypto
    .createHmac('sha256', config.line.channelSecret)
    .update(req.rawBody)
    .digest('base64');

  const receivedBuffer = Buffer.from(signature, 'base64');
  const expectedBuffer = Buffer.from(expectedSignature, 'base64');

  const isValid =
    receivedBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(receivedBuffer, expectedBuffer);

  if (!isValid) {
    console.warn('[webhook] Invalid LINE signature received');
    return res.status(401).json({
      success: false,
      error: {
        code: 'INVALID_SIGNATURE',
        message: 'LINE webhook signature validation failed',
        details: {},
      },
    });
  }

  next();
}

module.exports = validateLineSignature;
