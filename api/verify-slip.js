'use strict';

// Vercel Node.js Function. SlipOK credentials stay in server-only environment variables.
// This endpoint validates a slip; it intentionally does not mutate wallets or approve top-ups.
module.exports.config = { api: { bodyParser: false, maxDuration: 30 } };

const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_REQUEST_BYTES = MAX_FILE_BYTES + 64 * 1024;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 12;
const requestWindows = new Map(); // Best-effort per-instance limit; configure Vercel Firewall for durable limits.

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.end(JSON.stringify(payload));
}

function configuredOrigins() {
  const values = String(process.env.PRINTDEKD_APP_ORIGIN || process.env.PRINTDEKD_ALLOWED_ORIGINS || '')
    .split(',').map(x => x.trim()).filter(Boolean);
  for (const name of ['VERCEL_PROJECT_PRODUCTION_URL', 'VERCEL_URL', 'VERCEL_BRANCH_URL']) {
    const value = String(process.env[name] || '').trim();
    if (value) values.push(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  }
  if (process.env.NODE_ENV !== 'production') values.push('http://localhost:3000', 'http://127.0.0.1:3000');
  return new Set(values.map(value => { try { return new URL(value).origin; } catch (_) { return ''; } }).filter(Boolean));
}

function takeRateLimit(req) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ip = forwarded || String(req.socket?.remoteAddress || 'unknown');
  const now = Date.now();
  // Bound memory even if many different address strings hit this serverless instance.
  if (requestWindows.size > 1000) {
    for (const [key, value] of requestWindows) {
      if (now - value.start >= WINDOW_MS) requestWindows.delete(key);
    }
  }
  if (requestWindows.size >= 3000 && !requestWindows.has(ip)) return false;
  const current = requestWindows.get(ip);
  if (!current || now - current.start >= WINDOW_MS) {
    requestWindows.set(ip, { start: now, count: 1 });
    return true;
  }
  current.count += 1;
  return current.count <= MAX_PER_WINDOW;
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > MAX_REQUEST_BYTES) {
      const err = new Error('ไฟล์สลิปใหญ่เกินกำหนด');
      err.statusCode = 413;
      throw err;
    }
    chunks.push(buf);
  }
  return Buffer.concat(chunks, size);
}

function parseMultipart(buffer, contentType) {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const boundaryValue = (match && (match[1] || match[2]) || '').trim();
  if (!boundaryValue || boundaryValue.length > 200) throw Object.assign(new Error('รูปแบบคำขอไม่ถูกต้อง'), { statusCode: 400 });
  const boundary = Buffer.from(`--${boundaryValue}`);
  const delimiter = Buffer.concat([Buffer.from('\r\n'), boundary]);
  let cursor = buffer.indexOf(boundary);
  if (cursor < 0) throw Object.assign(new Error('ไม่พบข้อมูล multipart'), { statusCode: 400 });
  const fields = Object.create(null);
  let file = null;
  while (cursor >= 0) {
    cursor += boundary.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break;
    if (buffer.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (headerEnd < 0) throw Object.assign(new Error('ส่วนหัว multipart ไม่สมบูรณ์'), { statusCode: 400 });
    const headers = buffer.subarray(cursor, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    const next = buffer.indexOf(delimiter, bodyStart);
    if (next < 0) throw Object.assign(new Error('ไม่พบจุดสิ้นสุดของ multipart'), { statusCode: 400 });
    const part = buffer.subarray(bodyStart, next);
    const disposition = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headers)?.[1] || '';
    const name = /(?:^|;)\s*name="([^"]+)"/i.exec(disposition)?.[1];
    const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(disposition)?.[1];
    if (name === 'slip' && filename !== undefined) {
      if (file) throw Object.assign(new Error('แนบได้ครั้งละหนึ่งไฟล์เท่านั้น'), { statusCode: 400 });
      const mime = /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase() || 'application/octet-stream';
      file = { buffer: part, filename: filename.slice(0, 180), mime };
    } else if (name && !filename) {
      if (part.length > 256) throw Object.assign(new Error('ฟิลด์คำขอยาวเกินกำหนด'), { statusCode: 400 });
      fields[name] = part.toString('utf8').trim();
    }
    cursor = next + 2; // Move from CRLF to the next boundary marker.
  }
  return { fields, file };
}

function detectImageMime(buf) {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

function normalizedProviderError(body, httpStatus) {
  const code = Number(body?.code ?? body?.data?.code ?? body?.errorCode ?? 0) || null;
  const message = String(body?.message || body?.data?.message || 'SlipOK ไม่สามารถยืนยันสลิปได้').slice(0, 240);
  const reject = new Set([1005, 1006, 1007, 1008, 1011, 1012, 1013, 1014]);
  const translated = {
    1012: 'สลิปนี้เคยถูกใช้แล้ว ระบบปฏิเสธรายการซ้ำ',
    1013: 'ยอดเงินบนสลิปไม่ตรงกับยอดที่แจ้ง',
    1014: 'บัญชีผู้รับไม่ตรงกับบัญชีหลักที่ตั้งไว้ใน SlipOK',
    1005: 'ไฟล์ไม่ใช่รูปภาพสลิปที่รองรับ',
    1006: 'รูปสลิปไม่ถูกต้องหรืออ่านข้อมูลไม่ได้',
    1007: 'ไม่พบ QR สำหรับตรวจสอบในสลิป',
    1008: 'QR ในภาพไม่ใช่ QR สำหรับตรวจสอบการชำระเงิน',
    1009: 'ข้อมูลจากธนาคารขัดข้องชั่วคราว จึงยังยืนยันสลิปไม่ได้ กรุณาลองใหม่ภายหลัง',
    1010: 'ธนาคารที่ใช้โอนต้องรอการตรวจสอบเพิ่มเติม กรุณารอสักครู่แล้วลองใหม่',
    1011: 'ไม่พบรายการโอนเงินจริงหรือ QR หมดอายุ'
  };
  const hardReject = reject.has(code);
  return {
    status: hardReject ? 422 : 503,
    body: {
      ok: false,
      manualReview: !hardReject,
      code: code || `provider_http_${httpStatus}`,
      message: translated[code] || (hardReject ? message : 'ระบบตรวจสลิปอัตโนมัติขัดข้องหรือยังยืนยันไม่ได้ จึงไม่รับคำขอนี้และไม่มีการเพิ่ม Coins กรุณาลองใหม่ภายหลัง')
    }
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return send(res, 405, { ok: false, manualReview: false, code: 'method_not_allowed', message: 'อนุญาตเฉพาะ POST' });
  }

  const origins = configuredOrigins();
  if (!process.env.SLIPOK_API_KEY || !process.env.SLIPOK_BRANCH_ID || origins.size === 0) {
    return send(res, 503, { ok: false, manualReview: true, code: 'verification_not_configured', message: 'ระบบตรวจสลิปอัตโนมัติยังไม่ได้ตั้งค่า API/โดเมน จึงยังไม่บันทึกคำขอ กรุณาตั้งค่าระบบก่อนลองใหม่' });
  }
  const origin = String(req.headers.origin || '');
  if (!origin || !origins.has(origin)) {
    return send(res, 403, { ok: false, manualReview: false, code: 'origin_not_allowed', message: 'คำขอตรวจสลิปมาจากโดเมนที่ไม่ได้รับอนุญาต กรุณาเปิดเว็บไซต์ PrintDekD จากโดเมนที่ตั้งค่าไว้' });
  }
  if (!takeRateLimit(req)) {
    return send(res, 429, { ok: false, manualReview: true, code: 'rate_limited', message: 'มีคำขอตรวจสลิปหลายครั้งเกินไป จึงยังไม่บันทึกคำขอ กรุณารอสักครู่แล้วลองใหม่' });
  }

  const contentType = String(req.headers['content-type'] || '');
  if (!/^multipart\/form-data\s*;/i.test(contentType)) {
    return send(res, 415, { ok: false, manualReview: false, code: 'unsupported_media_type', message: 'กรุณาส่งไฟล์สลิปเป็น multipart/form-data' });
  }

  let parsed;
  try {
    const payload = await readBody(req);
    parsed = parseMultipart(payload, contentType);
  } catch (error) {
    const status = error.statusCode || 400;
    return send(res, status, { ok: false, manualReview: false, code: 'invalid_upload', message: error.message || 'อ่านไฟล์ที่อัปโหลดไม่สำเร็จ' });
  }

  if (!parsed.file || !parsed.file.buffer.length) {
    return send(res, 400, { ok: false, manualReview: false, code: 'missing_slip', message: 'กรุณาแนบรูปสลิปก่อนยืนยัน' });
  }
  if (parsed.file.buffer.length > MAX_FILE_BYTES) {
    return send(res, 413, { ok: false, manualReview: false, code: 'file_too_large', message: 'ไฟล์สลิปต้องมีขนาดไม่เกิน 4 MB' });
  }
  const mime = detectImageMime(parsed.file.buffer);
  if (!mime) {
    return send(res, 415, { ok: false, manualReview: false, code: 'invalid_image_signature', message: 'ไฟล์ไม่ใช่ PNG, JPG หรือ WEBP ที่ถูกต้อง' });
  }

  const amount = Number(parsed.fields.amount);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || cents <= 0 || Math.abs(amount * 100 - cents) > 0.001 || cents > 10000000) {
    return send(res, 400, { ok: false, manualReview: false, code: 'invalid_amount', message: 'ยอดเงินสำหรับตรวจสลิปไม่ถูกต้อง' });
  }

  try {
    const form = new FormData();
    form.append('files', new Blob([parsed.file.buffer], { type: mime }), parsed.file.filename || 'slip-image');
    form.append('amount', (cents / 100).toFixed(2));
    form.append('log', 'true'); // SlipOK checks its branch's configured recipient and duplicate slips.

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 22000);
    let upstream;
    try {
      upstream = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(process.env.SLIPOK_BRANCH_ID)}`, {
        method: 'POST',
        headers: { 'x-authorization': process.env.SLIPOK_API_KEY },
        body: form,
        signal: controller.signal,
        cache: 'no-store'
      });
    } finally { clearTimeout(timeout); }

    let body;
    try { body = await upstream.json(); } catch (_) { body = null; }
    if (!upstream.ok || body?.success !== true || body?.data?.success !== true) {
      const error = normalizedProviderError(body, upstream.status);
      return send(res, error.status, error.body);
    }

    const data = body.data || {};
    const receivedCents = Math.round(Number(data.amount) * 100);
    if (!Number.isFinite(receivedCents) || receivedCents !== cents) {
      return send(res, 422, { ok: false, manualReview: false, code: 1013, message: 'ยอดเงินบนสลิปไม่ตรงกับยอดที่แจ้ง' });
    }
    const transRef = String(data.transRef || '').trim();
    if (!transRef) {
      return send(res, 503, { ok: false, manualReview: true, code: 'missing_transaction_reference', message: 'สลิปไม่มีเลขอ้างอิงธุรกรรมที่ระบบยืนยันได้ จึงยังไม่บันทึกคำขอ กรุณาตรวจสอบสลิปแล้วลองใหม่' });
    }

    return send(res, 200, {
      ok: true,
      manualReview: false,
      transRef: transRef.slice(0, 100),
      amount: receivedCents / 100,
      verifiedAt: new Date().toISOString(),
      receiver: {
        name: String(data.receiver?.displayName || data.receiver?.name || '').slice(0, 80),
        maskedAccount: String(data.receiver?.account?.value || data.receiver?.proxy?.value || '').slice(0, 60),
        bankCode: String(data.receivingBank || '').slice(0, 8)
      },
      message: 'SlipOK ยืนยันยอดและบัญชีผู้รับหลักที่ตั้งค่าไว้ รวมถึงตรวจสลิปซ้ำแล้ว'
    });
  } catch (error) {
    const isTimeout = error?.name === 'AbortError';
    // Fail closed: without a definitive provider result, the frontend must not create a request.
    return send(res, 503, {
      ok: false,
      manualReview: true,
      code: isTimeout ? 'provider_timeout' : 'provider_unavailable',
      message: 'บริการตรวจสลิปอัตโนมัติขัดข้องหรือหมดเวลารอ จึงยังไม่บันทึกคำขอและไม่มีการเพิ่ม Coins กรุณาลองใหม่ภายหลัง'
    });
  }
};
