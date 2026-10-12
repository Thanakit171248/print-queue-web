'use strict';

// Secure Auth v2 counterpart. Keep legacy /api/verify-slip untouched during migration.
// Requires: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
// SLIPOK_API_KEY, SLIPOK_BRANCH_ID, PRINTDEKD_APP_ORIGIN.
// Authenticates the caller with Supabase Auth, validates the slip with SlipOK, then
// stores a short-lived single-use verification capability. It never credits Coins itself.
module.exports.config = { api: { bodyParser: false, maxDuration: 30 } };

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
  const configured = String(process.env.PRINTDEKD_APP_ORIGIN || process.env.PRINTDEKD_ALLOWED_ORIGINS || '')
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
    // Unique transaction_ref failures are treated as a duplicate, never as a new credit.
    const dup = r.status === 409 || body?.code === '23505';
    throw Object.assign(new Error(dup ? 'สลิปนี้เคยถูกใช้แล้ว ระบบปฏิเสธรายการซ้ำ' : 'บันทึกผลตรวจไม่สำเร็จ ระบบจึงไม่ยืนยันรายการ'), { statusCode: dup ? 422 : 503, code: dup ? 'duplicate_slip' : 'verification_store_failed' });
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
  try { user = await supabaseUser(bearer[1]); } catch (e) { return send(res,e.statusCode || 503,{ok:false,code:'auth_unavailable',message:e.message || 'ตรวจสอบเซสชันไม่ได้'}); }
  if (!user) return send(res,401,{ok:false,code:'invalid_session',message:'เซสชันไม่ถูกต้องหรือหมดอายุ กรุณาเข้าสู่ระบบใหม่'});
  if (!process.env.SLIPOK_API_KEY || !process.env.SLIPOK_BRANCH_ID || !process.env.SUPABASE_SERVICE_ROLE_KEY) return send(res,503,{ok:false,code:'not_configured',message:'ระบบตรวจสลิปยังตั้งค่าไม่ครบ จึงไม่ยืนยันและไม่เพิ่ม Coins'});
  const ct = String(req.headers['content-type'] || '');
  if (!/^multipart\/form-data\s*;/i.test(ct)) return send(res,415,{ok:false,code:'unsupported_media_type',message:'กรุณาแนบไฟล์สลิปเป็น multipart/form-data'});
  let parsed;
  try { parsed = parseMultipart(await readBody(req), ct); }
  catch (e) { return send(res,e.statusCode || 400,{ok:false,code:'invalid_upload',message:e.message || 'อ่านไฟล์ไม่สำเร็จ'}); }
  if (!parsed.file?.buffer?.length) return send(res,400,{ok:false,code:'missing_slip',message:'กรุณาแนบรูปสลิป'});
  if (parsed.file.buffer.length > MAX_FILE_BYTES) return send(res,413,{ok:false,code:'file_too_large',message:'ไฟล์สลิปต้องไม่เกิน 4 MB'});
  const mime = imageType(parsed.file.buffer);
  if (!mime) return send(res,415,{ok:false,code:'invalid_image_signature',message:'ไฟล์ต้องเป็นภาพ PNG, JPG หรือ WEBP ที่ถูกต้อง'});
  const purpose = parsed.fields.purpose;
  if (!['topup','print'].includes(purpose)) return send(res,400,{ok:false,code:'invalid_purpose',message:'ประเภทการชำระเงินไม่ถูกต้อง'});
  const amount = Number(parsed.fields.amount), cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || cents <= 0 || Math.abs(amount*100-cents) > 0.001 || cents > 10000000) return send(res,400,{ok:false,code:'invalid_amount',message:'ยอดเงินไม่ถูกต้อง'});

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
      const messages = {1012:'สลิปนี้เคยถูกใช้แล้ว',1013:'ยอดเงินบนสลิปไม่ตรงกับยอดที่ระบุ',1014:'บัญชีผู้รับไม่ตรงกับบัญชีหลักใน SlipOK',1005:'ชนิดไฟล์ไม่ถูกต้อง',1006:'อ่านรูปสลิปไม่ได้',1007:'ไม่พบ QR ในสลิป',1008:'QR ไม่ใช่รายการชำระเงิน',1011:'ไม่พบรายการโอนหรือ QR หมดอายุ'};
      const hard = [1005,1006,1007,1008,1011,1012,1013,1014].includes(code);
      return send(res,hard?422:503,{ok:false,code:code || `provider_http_${upstream.status}`,manualReview:!hard,message:messages[code] || 'SlipOK ยังยืนยันไม่ได้ จึงไม่มีการสร้างรายการหรือเพิ่ม Coins'});
    }
    const d = result.data;
    const got = Math.round(Number(d.amount)*100);
    if (!Number.isFinite(got) || got !== cents) return send(res,422,{ok:false,code:1013,message:'ยอดเงินบนสลิปไม่ตรงกับยอดที่ระบุ'});
    const transRef = String(d.transRef || '').trim();
    if (!transRef) return send(res,503,{ok:false,code:'missing_transaction_reference',message:'สลิปไม่มีเลขอ้างอิงธุรกรรมที่ยืนยันได้'});
    let record;
    try {
      record = await storeVerification({
        user_id:user.id, purpose, amount:cents/100, transaction_ref:transRef,
        receiver_name:String(d.receiver?.displayName || d.receiver?.name || '').slice(0,80) || null,
        masked_account:String(d.receiver?.account?.value || d.receiver?.proxy?.value || '').slice(0,60) || null,
        bank_code:String(d.receivingBank || '').slice(0,8) || null,
        verified_at:new Date().toISOString(), expires_at:new Date(Date.now()+10*60*1000).toISOString()
      });
    } catch (e) { return send(res,e.statusCode || 503,{ok:false,code:e.code || 'verification_store_failed',message:e.message || 'บันทึกผลตรวจไม่ได้ จึงไม่สร้างรายการ'}); }
    return send(res,200,{ok:true,verificationId:record.id,amount:cents/100,transRef:transRef.slice(0,100),verifiedAt:record.verified_at,receiver:{name:record.receiver_name,maskedAccount:record.masked_account,bankCode:record.bank_code},message:'ยืนยันสลิปแล้ว ผลตรวจนี้ใช้ได้ครั้งเดียวและหมดอายุใน 10 นาที'});
  } catch (e) {
    return send(res,503,{ok:false,code:e?.name==='AbortError'?'provider_timeout':'provider_unavailable',manualReview:true,message:'บริการตรวจสลิปขัดข้อง จึงไม่สร้างรายการและไม่มีการเพิ่ม Coins กรุณาลองใหม่ภายหลัง'});
  }
};
