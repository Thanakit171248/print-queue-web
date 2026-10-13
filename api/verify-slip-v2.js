'use strict';

const crypto = require('crypto');

// Secure Auth v2 endpoint. The legacy /api/verify-slip route is retired (HTTP 410).
// Requires: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// SLIPOK_API_KEY, SLIPOK_BRANCH_ID, PRINTDEKD_APP_ORIGIN.
// Authenticates the caller with Supabase Auth, validates the slip with SlipOK, then
// stores a short-lived single-use verification capability. It never credits Coins itself.
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_FILE_BYTES + 128 * 1024;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 12;
const rateWindows = new Map();

function send(res, status, payload) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'no-referrer');
  return res.end(JSON.stringify(payload));
}
function originAllowed(req) {
  const configuredValues = [process.env.PRINTDEKD_APP_ORIGIN, process.env.PRINTDEKD_ALLOWED_ORIGINS]
    .filter(Boolean).join(',');
  const configured = configuredValues
    .split(',').map(x => x.trim()).filter(Boolean).map(x => { try { return new URL(x).origin; } catch { return ''; } }).filter(Boolean);
  const origin = String(req.headers.origin || '');
  try { return Boolean(origin) && configured.includes(new URL(origin).origin); } catch { return false; }
}
function limited(req) {
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'unknown';
  const now = Date.now();
  if (rateWindows.size > 1000) for (const [k, v] of rateWindows) if (now - v.start >= WINDOW_MS) rateWindows.delete(k);
  const v = rateWindows.get(ip);
  if (!v || now - v.start >= WINDOW_MS) { rateWindows.set(ip, { start: now, count: 1 }); return true; }
  v.count += 1; return v.count <= MAX_PER_WINDOW;
}
async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error('คำขอมีขนาดเกินกำหนด'), { statusCode: 413 });
    chunks.push(b);
  }
  return Buffer.concat(chunks, size);
}
function parseMultipart(buffer, contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  const token = (m && (m[1] || m[2]) || '').trim();
  if (!token || token.length > 200) throw Object.assign(new Error('รูปแบบ multipart ไม่ถูกต้อง'), { statusCode: 400 });
  const boundary = Buffer.from(`--${token}`), delimiter = Buffer.concat([Buffer.from('\r\n'), boundary]);
  let cursor = buffer.indexOf(boundary); if (cursor < 0) throw Object.assign(new Error('ไม่พบข้อมูล multipart'), { statusCode: 400 });
  const fields = Object.create(null); let file = null;
  while (cursor >= 0) {
    cursor += boundary.length;
    if (buffer.subarray(cursor, cursor + 2).toString() === '--') break;
    if (buffer.subarray(cursor, cursor + 2).toString() === '\r\n') cursor += 2;
    const hend = buffer.indexOf(Buffer.from('\r\n\r\n'), cursor);
    if (hend < 0) throw Object.assign(new Error('ส่วนหัว multipart ไม่สมบูรณ์'), { statusCode: 400 });
    const headers = buffer.subarray(cursor, hend).toString('utf8'); const start = hend + 4;
    const next = buffer.indexOf(delimiter, start); if (next < 0) throw Object.assign(new Error('ไม่พบจุดสิ้นสุด multipart'), { statusCode: 400 });
    const part = buffer.subarray(start, next);
    const disp = /content-disposition:\s*form-data;([^\r\n]+)/i.exec(headers)?.[1] || '';
    const name = /(?:^|;)\s*name="([^"]+)"/i.exec(disp)?.[1];
    const filename = /(?:^|;)\s*filename="([^"]*)"/i.exec(disp)?.[1];
    if (name === 'slip' && filename !== undefined) {
      if (file) throw Object.assign(new Error('แนบได้ครั้งละหนึ่งไฟล์'), { statusCode: 400 });
      file = { buffer: part, filename: filename.slice(0, 160) || 'slip', mime: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase() || '' };
    } else if (name) {
      if (part.length > 256) throw Object.assign(new Error('ฟิลด์คำขอยาวเกินกำหนด'), { statusCode: 400 });
      fields[name] = part.toString('utf8').trim();
    }
    cursor = next + 2;
  }
  return { fields, file };
}
function imageType(b) {
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg';
  if (b.length >= 12 && b.subarray(0,4).toString('ascii') === 'RIFF' && b.subarray(8,12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}
async function supabaseUser(accessToken) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!base || !anon) throw Object.assign(new Error('ระบบยืนยันตัวตนยังตั้งค่าไม่ครบ'), { statusCode: 503 });
  const r = await fetch(`${base}/auth/v1/user`, { headers: { apikey: anon, Authorization: `Bearer ${accessToken}` }, cache: 'no-store' });
  if (!r.ok) return null;
  const data = await r.json();
  return data?.id && data?.email ? data : null;
}
async function findExistingVerification(base, key, row) {
  const query = new URLSearchParams({
    select: 'id,user_id,purpose,amount,transaction_ref,receiver_name,masked_account,bank_code,verified_at,expires_at,consumed_at,request_key,file_sha256,manual_review',
    user_id: `eq.${row.user_id}`,
    purpose: `eq.${row.purpose}`,
    amount: `eq.${Number(row.amount).toFixed(2)}`,
    transaction_ref: `eq.${row.transaction_ref}`,
    limit: '1'
  });
  const r = await fetch(`${base}/rest/v1/slip_verifications?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store'
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] || null : null;
}

async function findVerificationByRequestKey(base, key, userId, purpose, requestKey) {
  const query = new URLSearchParams({
    select: 'id,user_id,purpose,amount,transaction_ref,receiver_name,masked_account,bank_code,verified_at,expires_at,consumed_at,request_key,file_sha256,manual_review',
    user_id: `eq.${userId}`,
    purpose: `eq.${purpose}`,
    request_key: `eq.${requestKey}`,
    limit: '1'
  });
  const r = await fetch(`${base}/rest/v1/slip_verifications?${query}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: 'no-store'
  });
  if (!r.ok) throw Object.assign(new Error('ตรวจสอบคำขอตรวจสลิปเดิมในฐานข้อมูลไม่ได้'), { statusCode: 503 });
  const rows = await r.json().catch(() => null);
  return Array.isArray(rows) ? rows[0] || null : null;
}


function verificationResponse(res, capability, fallbackMessage) {
  const record = capability?.record;
  if (!record?.id) {
    return send(res, 503, {
      ok: false, code: 'manual_review_capability_missing', manualReview: false,
      message: 'ระบบไม่สามารถออกโทเคนตรวจสอบสำหรับแอดมินได้ จึงยังไม่สร้างคำขอและไม่เพิ่ม Coins'
    });
  }
  if (capability.kind === 'manual' || record.manual_review === true) {
    return send(res, 503, {
      ok: false,
      code: 'manual_review_required',
      manualReview: true,
      manualReviewToken: record.id,
      amount: Number(record.amount),
      message: fallbackMessage || 'ขณะนี้ยังยืนยันสลิปไม่ได้ จึงส่งคำขอให้ผู้ดูแลตรวจสอบหลักฐานการโอนจริง โดยจะยังไม่เพิ่ม Coins จนกว่าจะตรวจสอบเสร็จ'
    });
  }
  if (record.consumed_at) {
    return send(res, 422, {
      ok: false, code: 'verification_already_used', manualReview: false,
      message: 'ผลตรวจสลิปนี้ถูกใช้ไปแล้ว กรุณาตรวจประวัติ Coins/คิวก่อนส่งซ้ำ'
    });
  }
  const expiresAt = Date.parse(record.expires_at || '');
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
    return send(res, 422, {
      ok: false, code: 'verification_expired', manualReview: false,
      message: 'ผลตรวจสลิปหมดอายุ กรุณาส่งคำขอใหม่โดยตรวจประวัติก่อนเพื่อป้องกันรายการซ้ำ'
    });
  }
  return send(res, 200, {
    ok: true,
    verificationId: record.id,
    amount: Number(record.amount),
    transRef: String(record.transaction_ref || '').slice(0, 100),
    verifiedAt: record.verified_at,
    receiver: {
      name: record.receiver_name || null,
      maskedAccount: record.masked_account || null,
      bankCode: record.bank_code || null
    },
    message: 'ผลตรวจสลิปที่ผูกกับคำขอนี้ถูกกู้คืนแล้ว โดยไม่ตรวจหรือบันทึกธุรกรรมซ้ำ'
  });
}

async function issueManualReviewCapability({ base, key, user, purpose, amount, requestKey, fileSha256 }) {
  if (!base || !key) {
    throw Object.assign(new Error('ระบบบันทึกโทเคนตรวจสอบฝั่งเซิร์ฟเวอร์ยังตั้งค่าไม่ครบ'), {
      statusCode: 503, code: 'manual_review_not_configured'
    });
  }
  let existing = await findVerificationByRequestKey(base, key, user.id, purpose, requestKey);
  const now = Date.now();
  const expiresAt = new Date(now + 10 * 60 * 1000).toISOString();

  if (existing) {
    if (Number(existing.amount) !== Number(amount) || existing.file_sha256 !== fileSha256) {
      throw Object.assign(new Error('รหัสคำขอนี้ถูกผูกกับสลิปหรือยอดอื่นแล้ว ระบบปฏิเสธรายการซ้ำ'), {
        statusCode: 409, code: 'request_key_conflict'
      });
    }
    if (existing.consumed_at) {
      throw Object.assign(new Error('ผลตรวจหรือโทเคนของคำขอนี้ถูกใช้แล้ว กรุณาตรวจประวัติ Coins ก่อนส่งซ้ำ'), {
        statusCode: 422, code: 'verification_already_used'
      });
    }
    if (Date.parse(existing.expires_at || '') > now) {
      return { kind: existing.manual_review === true ? 'manual' : 'verified', record: existing };
    }

    // Renew an expired, still-unused capability as manual-review-only. It must never
    // be accepted by the automatic credit RPC after this flag becomes true.
    const patchUrl = `${base}/rest/v1/slip_verifications?id=eq.${encodeURIComponent(existing.id)}&user_id=eq.${encodeURIComponent(user.id)}&consumed_at=is.null`;
    const patched = await fetch(patchUrl, {
      method: 'PATCH',
      headers: {
        apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
        Prefer: 'return=representation'
      },
      body: JSON.stringify({ manual_review: true, expires_at: expiresAt }),
      cache: 'no-store'
    });
    const patchedRows = await patched.json().catch(() => null);
    if (!patched.ok) throw Object.assign(new Error('ต่ออายุโทเคนสำหรับตรวจด้วยตนเองไม่ได้'), { statusCode: 503, code: 'manual_review_issue_failed' });
    const renewed = Array.isArray(patchedRows) ? patchedRows[0] : null;
    if (!renewed) {
      existing = await findVerificationByRequestKey(base, key, user.id, purpose, requestKey);
      if (existing?.consumed_at) throw Object.assign(new Error('ผลตรวจนี้ถูกใช้ไปแล้ว กรุณาตรวจประวัติก่อนส่งซ้ำ'), { statusCode: 422, code: 'verification_already_used' });
      throw Object.assign(new Error('ไม่สามารถยืนยันสถานะโทเคนเดิมได้ กรุณาตรวจประวัติก่อนลองใหม่'), { statusCode: 503, code: 'manual_review_issue_failed' });
    }
    return { kind: 'manual', record: renewed };
  }

  // A server-issued capability, not client-provided proof. The special ref is NOT
  // a real bank transfer reference; manual approval requires the Admin to enter a
  // real reference from the bank statement and the manual RPC enforces uniqueness.
  const row = {
    user_id: user.id,
    purpose,
    amount: Number(amount),
    transaction_ref: `MANUAL_REVIEW:${user.id}:${purpose}:${requestKey}`,
    request_key: requestKey,
    file_sha256: fileSha256,
    manual_review: true,
    verified_at: new Date(now).toISOString(),
    expires_at: expiresAt
  };
  const created = await fetch(`${base}/rest/v1/slip_verifications`, {
    method: 'POST',
    headers: {
      apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json',
      Prefer: 'return=representation'
    },
    body: JSON.stringify(row),
    cache: 'no-store'
  });
  const body = await created.json().catch(() => null);
  if (created.ok) {
    const record = Array.isArray(body) ? body[0] : body;
    if (record?.id) return { kind: 'manual', record };
    throw Object.assign(new Error('ฐานข้อมูลไม่คืนโทเคน Manual Review'), { statusCode: 503, code: 'manual_review_issue_failed' });
  }

  // Concurrent submissions may race on the (user,purpose,request_key) unique index.
  if (created.status === 409 || body?.code === '23505') {
    existing = await findVerificationByRequestKey(base, key, user.id, purpose, requestKey);
    if (existing && Number(existing.amount) === Number(amount) && existing.file_sha256 === fileSha256 && !existing.consumed_at) {
      if (Date.parse(existing.expires_at || '') > Date.now()) {
        return { kind: existing.manual_review === true ? 'manual' : 'verified', record: existing };
      }
      return issueManualReviewCapability({ base, key, user, purpose, amount, requestKey, fileSha256 });
    }
    if (existing?.consumed_at) throw Object.assign(new Error('ผลตรวจของคำขอนี้ถูกใช้แล้ว กรุณาตรวจประวัติก่อนส่งซ้ำ'), { statusCode: 422, code: 'verification_already_used' });
    throw Object.assign(new Error('ออกโทเคน Manual Review ไม่สำเร็จเนื่องจากคำขอซ้ำหรือข้อมูลไม่ตรงกัน'), { statusCode: 409, code: 'manual_review_conflict' });
  }
  throw Object.assign(new Error('ไม่สามารถออกโทเคน Manual Review ในฐานข้อมูลได้'), {
    statusCode: 503, code: 'manual_review_issue_failed'
  });
}

async function sendManualFallback(res, context, message) {
  // Manual fallback is intentionally available for Coins top-ups only. A print order
  // cannot be queued without a verified payment capability.
  if (context.purpose !== 'topup') {
    return send(res, 503, {
      ok: false, code: 'provider_unavailable', manualReview: false,
      message: `${message || 'ยังไม่สามารถยืนยันสลิปได้'} งานพิมพ์ยังไม่ถูกสร้างและไม่มีการหัก Coins`
    });
  }
  try {
    const capability = await issueManualReviewCapability(context);
    return verificationResponse(res, capability, message);
  } catch (e) {
    return send(res, e.statusCode || 503, {
      ok: false, code: e.code || 'manual_review_issue_failed', manualReview: false,
      message: 'ยังไม่สามารถส่งรายการให้ผู้ดูแลตรวจสอบได้ จึงไม่มีการเพิ่ม Coins กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'
    });
  }
}

async function storeVerification(row) {
  const base = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !key) throw Object.assign(new Error('ระบบบันทึกผลตรวจยังตั้งค่าไม่ครบ'), { statusCode: 503 });
  const r = await fetch(`${base}/rest/v1/slip_verifications`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    body: JSON.stringify(row), cache: 'no-store'
  });
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    // Recover a prior successful verification for the same authenticated user,
    // purpose, exact amount and transaction reference. This makes a lost HTTP
    // response idempotent without allowing the same transfer to credit twice.
    const duplicate = r.status === 409 || body?.code === '23505';
    if (duplicate) {
      // First handle a concurrent retry with the same request key. A key may not
      // be reused for a different image, purpose, or amount.
      let byRequestKey = null;
      if (row.request_key) {
        byRequestKey = await findVerificationByRequestKey(base, key, row.user_id, row.purpose, row.request_key);
      }
      if (byRequestKey) {
        if (byRequestKey.file_sha256 !== row.file_sha256 || Number(byRequestKey.amount) !== Number(row.amount)) {
          throw Object.assign(new Error('รหัสคำขอนี้เคยผูกกับสลิปหรือยอดอื่นแล้ว'), {
            statusCode: 409, code: 'request_key_conflict'
          });
        }
        if (!byRequestKey.consumed_at && Date.parse(byRequestKey.expires_at || '') > Date.now()) return byRequestKey;
        if (!byRequestKey.consumed_at) {
          throw Object.assign(new Error('ผลตรวจสลิปเดิมหมดอายุ จึงส่งคำขอให้ผู้ดูแลตรวจด้วยตนเองได้'), {
            statusCode: 503, code: 'verification_expired', manualReview: true
          });
        }
        throw Object.assign(new Error('ผลตรวจสลิปนี้ถูกใช้ไปแล้ว ระบบปฏิเสธรายการซ้ำ'), {
          statusCode: 422, code: 'verification_already_used'
        });
      }

      // A transaction reference is globally unique as well. Recover it only for
      // the same owner, purpose, and amount; a consumed capability is never reused.
      const existing = await findExistingVerification(base, key, row);
      if (existing) {
        const expiresAt = Date.parse(existing.expires_at || '');
        if (!existing.consumed_at && Number.isFinite(expiresAt) && expiresAt > Date.now()) return existing;
        if (!existing.consumed_at && Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
          throw Object.assign(new Error('สลิปนี้เคยตรวจแล้ว แต่ผลตรวจหมดอายุ จึงส่งคำขอให้ผู้ดูแลตรวจด้วยตนเองได้'), {
            statusCode: 503, code: 'verification_expired', manualReview: true
          });
        }
      }
    }
    throw Object.assign(new Error(duplicate ? 'สลิปนี้เคยถูกใช้แล้ว ระบบปฏิเสธรายการซ้ำ' : 'บันทึกผลตรวจไม่สำเร็จ ระบบจึงไม่ยืนยันรายการ'), {
      statusCode: duplicate ? 422 : 503,
      code: duplicate ? 'duplicate_slip' : 'verification_store_failed'
    });
  }
  return Array.isArray(body) ? body[0] : body;
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res,405,{ok:false,code:'method_not_allowed',message:'อนุญาตเฉพาะ POST'}); }
  if (!originAllowed(req)) return send(res,403,{ok:false,code:'origin_not_allowed',message:'โดเมนไม่ได้รับอนุญาต'});
  if (!limited(req)) return send(res,429,{ok:false,code:'rate_limited',message:'ส่งคำขอมากเกินไป กรุณารอสักครู่'});
  const bearer = /^Bearer\s+(.+)$/i.exec(String(req.headers.authorization || ''));
  if (!bearer) return send(res,401,{ok:false,code:'auth_required',message:'กรุณาเข้าสู่ระบบใหม่ก่อนตรวจสลิป'});
  let user;
  try { user = await supabaseUser(bearer[1]); } catch (e) { console.error('[PrintDekD] Slip verification session check failed:', e); return send(res,e.statusCode || 503,{ok:false,code:'auth_unavailable',message:'ไม่สามารถตรวจสอบการเข้าสู่ระบบได้ในขณะนี้ กรุณาเข้าสู่ระบบอีกครั้ง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'}); }
  if (!user) return send(res,401,{ok:false,code:'invalid_session',message:'เซสชันไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่'});
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return send(res,503,{
      ok:false, code:'manual_review_not_configured', manualReview:false,
      message:'ระบบตรวจสลิปยังไม่มีคีย์บริการฝั่งเซิร์ฟเวอร์ จึงไม่สามารถยืนยันหรือสร้างโทเคนให้แอดมินตรวจได้ และไม่มีการเพิ่ม Coins'
    });
  }
  const ct = String(req.headers['content-type'] || '');
  if (!/^multipart\/form-data\s*;/i.test(ct)) return send(res,415,{ok:false,code:'unsupported_media_type',message:'กรุณาแนบไฟล์สลิปเป็น multipart/form-data'});
  let parsed;
  try { parsed = parseMultipart(await readBody(req), ct); }
  catch (e) { console.warn('[PrintDekD] Slip file upload validation failed:', e); return send(res,e.statusCode || 400,{ok:false,code:'invalid_upload',message:'อ่านไฟล์สลิปไม่สำเร็จ กรุณาเลือกไฟล์รูปภาพที่รองรับแล้วลองใหม่'}); }
  if (!parsed.file?.buffer?.length) return send(res,400,{ok:false,code:'missing_slip',message:'กรุณาแนบรูปสลิป'});
  if (parsed.file.buffer.length > MAX_FILE_BYTES) return send(res,413,{ok:false,code:'file_too_large',message:'ไฟล์สลิปต้องไม่เกิน 4 MB'});
  const mime = imageType(parsed.file.buffer);
  if (!mime) return send(res,415,{ok:false,code:'invalid_image_signature',message:'ไฟล์ต้องเป็นภาพ PNG, JPG หรือ WEBP ที่ถูกต้อง'});
  const purpose = parsed.fields.purpose;
  if (!['topup','print'].includes(purpose)) return send(res,400,{ok:false,code:'invalid_purpose',message:'ประเภทการชำระเงินไม่ถูกต้อง'});
  const amount = Number(parsed.fields.amount), cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || cents <= 0 || Math.abs(amount*100-cents) > 0.001 || cents > 10000000) return send(res,400,{ok:false,code:'invalid_amount',message:'ยอดเงินไม่ถูกต้อง'});
  const requestKey = parsed.fields.requestKey;
  if (!requestKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
    return send(res,400,{ok:false,code:'invalid_request_key',message:'รหัสคำขอตรวจสลิปไม่ถูกต้อง'});
  }
  const fileSha256 = crypto.createHash('sha256').update(parsed.file.buffer).digest('hex');
  const supabaseBase = String(process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  let priorVerification;
  try {
    priorVerification = await findVerificationByRequestKey(
      supabaseBase, process.env.SUPABASE_SERVICE_ROLE_KEY, user.id, purpose, requestKey
    );
  } catch (e) {
    console.error('[PrintDekD] Previous slip verification lookup failed:', e); return send(res,e.statusCode || 503,{ok:false,code:'verification_lookup_failed',message:'ไม่สามารถตรวจสอบคำขอเดิมได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'});
  }
  if (priorVerification) {
    if (priorVerification.purpose !== purpose || Number(priorVerification.amount) !== cents / 100 || priorVerification.file_sha256 !== fileSha256) {
      return send(res,409,{ok:false,code:'request_key_conflict',manualReview:false,message:'รหัสคำขอนี้เคยผูกกับสลิป/ยอด/ประเภทอื่นแล้ว กรุณาเริ่มคำขอใหม่'});
    }
    if (priorVerification.consumed_at) {
      return send(res,422,{ok:false,code:'verification_already_used',manualReview:false,message:'ผลตรวจสลิปนี้ถูกใช้ไปแล้ว กรุณาตรวจประวัติ Coins/คิวก่อนส่งซ้ำ'});
    }
    if (Date.parse(priorVerification.expires_at || '') <= Date.now()) {
      return sendManualFallback(res, { base: supabaseBase, key: process.env.SUPABASE_SERVICE_ROLE_KEY, user, purpose, amount: cents / 100, requestKey, fileSha256 }, 'ผลตรวจสลิปเดิมหมดอายุและยังไม่ถูกใช้ จึงต้องให้ผู้ดูแลตรวจหลักฐานโอนจริง');
    }
    if (priorVerification.manual_review === true) {
      return verificationResponse(res, { kind: 'manual', record: priorVerification }, 'คำขอนี้รอผู้ดูแลตรวจหลักฐานโอนจริงอยู่แล้ว');
    }
    return verificationResponse(res, { kind: 'verified', record: priorVerification });
  }

  if (!process.env.SLIPOK_API_KEY || !process.env.SLIPOK_BRANCH_ID) {
    return sendManualFallback(res, { base: supabaseBase, key: process.env.SUPABASE_SERVICE_ROLE_KEY, user, purpose, amount: cents / 100, requestKey, fileSha256 }, 'บริการตรวจสอบสลิปอัตโนมัติยังไม่พร้อมให้บริการ จึงส่งคำขอให้ผู้ดูแลตรวจหลักฐานการโอนจริง');
  }

  let upstream;
  try {
    const form = new FormData();
    form.append('files', new Blob([parsed.file.buffer],{type:mime}), parsed.file.filename);
    form.append('amount',(cents/100).toFixed(2));
    form.append('log','true');
    const controller = new AbortController(); const timer = setTimeout(()=>controller.abort(),22000);
    try {
      upstream = await fetch(`https://api.slipok.com/api/line/apikey/${encodeURIComponent(process.env.SLIPOK_BRANCH_ID)}`, {
        method:'POST', headers:{'x-authorization':process.env.SLIPOK_API_KEY}, body:form, signal:controller.signal, cache:'no-store'
      });
    } finally { clearTimeout(timer); }
    const result = await upstream.json().catch(()=>null);
    if (!upstream.ok || result?.success !== true || result?.data?.success !== true) {
      const code = Number(result?.code ?? result?.data?.code ?? 0) || null;
      const messages = {1012:'สลิปนี้เคยถูกใช้แล้ว',1013:'ยอดเงินบนสลิปไม่ตรงกับยอดที่ระบุ',1014:'บัญชีผู้รับไม่ตรงกับบัญชีที่กำหนดไว้',1005:'ชนิดไฟล์ไม่ถูกต้อง',1006:'อ่านรูปสลิปไม่ได้',1007:'ไม่พบ QR ในสลิป',1008:'QR ไม่ใช่รายการชำระเงิน',1011:'ไม่พบรายการโอนหรือ QR หมดอายุ'};
      // Manual review is a fallback for ambiguous reading/provider failures, not a
      // way around a duplicate slip, amount mismatch, receiver mismatch, or invalid file.
      // In the manual path the wallet is NOT credited until the Admin verifies the real
      // bank transfer and approves the pending request through the secure RPC.
      const hardReject = [1005, 1012, 1013, 1014].includes(code);
      const message = messages[code] || 'ยังไม่สามารถยืนยันสลิปได้ จึงยังไม่มีการเพิ่ม Coins กรุณาตรวจสอบรูปสลิปแล้วลองใหม่อีกครั้ง';
      if (hardReject) {
        return send(res,422,{ok:false,code:code || `provider_http_${upstream.status}`,manualReview:false,message});
      }
      return sendManualFallback(res, { base: supabaseBase, key: process.env.SUPABASE_SERVICE_ROLE_KEY, user, purpose, amount: cents / 100, requestKey, fileSha256 }, message);
    }
    const d = result.data;
    const got = Math.round(Number(d.amount)*100);
    if (!Number.isFinite(got) || got !== cents) return send(res,422,{ok:false,code:1013,message:'ยอดเงินบนสลิปไม่ตรงกับยอดที่ระบุ'});
    const transRef = String(d.transRef || '').trim();
    if (!transRef) return sendManualFallback(res, { base: supabaseBase, key: process.env.SUPABASE_SERVICE_ROLE_KEY, user, purpose, amount: cents / 100, requestKey, fileSha256 }, 'ระบบยังยืนยันรายละเอียดการโอนไม่ได้ จึงต้องให้ผู้ดูแลตรวจหลักฐานการโอนจริง');
    let record;
    try {
      record = await storeVerification({
        user_id:user.id, purpose, amount:cents/100, transaction_ref:transRef, request_key:requestKey, file_sha256:fileSha256, manual_review:false,
        receiver_name:String(d.receiver?.displayName || d.receiver?.name || '').slice(0,80) || null,
        masked_account:String(d.receiver?.account?.value || d.receiver?.proxy?.value || '').slice(0,60) || null,
        bank_code:String(d.receivingBank || '').slice(0,8) || null,
        verified_at:new Date().toISOString(), expires_at:new Date(Date.now()+10*60*1000).toISOString()
      });
    } catch (e) {
      if (e.manualReview === true) {
        console.warn('[PrintDekD] Reusing previous slip result failed:', e); return sendManualFallback(res, { base: supabaseBase, key: process.env.SUPABASE_SERVICE_ROLE_KEY, user, purpose, amount: cents / 100, requestKey, fileSha256 }, 'ไม่สามารถใช้ผลตรวจเดิมได้ในขณะนี้ กรุณาให้ผู้ดูแลตรวจหลักฐานการโอนจริง');
      }
      console.error('[PrintDekD] Verification result could not be saved:', e); return send(res,e.statusCode || 503,{ok:false,code:e.code || 'verification_store_failed',manualReview:false,message:'ยังไม่สามารถบันทึกผลตรวจสลิปได้ จึงยังไม่มีการสร้างรายการหรือเพิ่ม Coins กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'});
    }
    return verificationResponse(res, { kind: record?.manual_review === true ? 'manual' : 'verified', record }, 'คำขอนี้ต้องผ่านการตรวจโดยผู้ดูแล');
  } catch (e) {
    return sendManualFallback(res, { base: supabaseBase, key: process.env.SUPABASE_SERVICE_ROLE_KEY, user, purpose, amount: cents / 100, requestKey, fileSha256 }, e?.name==='AbortError' ? 'การตรวจสอบสลิปใช้เวลานานกว่าปกติ จึงต้องให้ผู้ดูแลตรวจหลักฐานการโอนจริง' : 'บริการตรวจสอบสลิปขัดข้องชั่วคราว จึงต้องให้ผู้ดูแลตรวจหลักฐานการโอนจริง');
  }
};

// Vercel reads function config from the exported handler. Attach it AFTER assigning
// the function to module.exports; setting it before replacement silently discards it.
module.exports.config = { api: { bodyParser: false, maxDuration: 30 } };
