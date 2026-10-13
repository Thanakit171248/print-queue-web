'use strict';

// Retired legacy route. The secure frontend uses /api/verify-slip-v2, which
// authenticates the caller and creates a single-use verification capability.
// Keep a 410 response instead of an unauthenticated endpoint that consumes SlipOK
// quota but does not write to the secure verification table.
module.exports = function retiredSlipVerifier(req, res) {
  res.statusCode = 410;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  if (req.method !== 'POST') res.setHeader('Allow', 'POST');
  return res.end(JSON.stringify({
    ok: false,
    code: 'legacy_endpoint_retired',
    message: 'ไม่สามารถดำเนินการตรวจสลิปจากช่องทางนี้ได้ กรุณากลับไปยังหน้า PrintDekD แล้วทำรายการอีกครั้ง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'
  }));
};

module.exports.config = { api: { bodyParser: false, maxDuration: 5 } };
