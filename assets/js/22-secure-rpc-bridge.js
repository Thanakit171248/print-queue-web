/*
 * PrintDekD Pro — Secure RPC bridge
 *
 * Loaded after the legacy UI scripts intentionally, so the final public handlers
 * use the secured Supabase RPCs rather than direct writes to financial tables.
 *
 * Required database migration:
 *   database/20261013_secure_rpc_topups_and_orders.sql
 * Required Vercel server env:
 *   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY,
 *   SLIPOK_API_KEY, SLIPOK_BRANCH_ID, PRINTDEKD_APP_ORIGIN
 */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const db = () => window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const money = (value) => Number(value || 0).toFixed(2);
  const notify = (title, message, icon = 'info') => {
    if (typeof window.notifyV12 === 'function') return window.notifyV12(title, message, icon);
    if (typeof window.notify === 'function') return window.notify(title, message, icon);
    if (typeof window.showCustomModal === 'function') return window.showCustomModal({ title, message, icon });
    console.warn(`[PrintDekD] ${title}: ${message}`);
  };

  // Present clear, customer-friendly Thai messages instead of exposing internal
  // service names, database objects, permission codes, or raw server errors.
  const CUSTOMER_ERROR_FALLBACK = 'ขออภัย ขณะนี้ไม่สามารถทำรายการได้ กรุณาลองใหม่อีกครั้ง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ';
  const INTERNAL_ERROR_PATTERN = /(supabase|\brpc\b|\bapi\b|\bsql\b|\brls\b|policy|storage|schema|column|\btable\b|postgres|permission denied|not authorized|jwt|http\s*\d{3}|pgrst|foreign key|constraint|could not find|does not exist|trigger|wallets\.balance|delivery_options|\bpricing\b|row-level security|duplicate key|violates|slipok|secure context|print\s*server|worker|\bcups\b|จัดเตรียมได้หลัง|พิมพ์เสร็จ)/i;
  function customerFacingMessage(error, fallback = CUSTOMER_ERROR_FALLBACK) {
    const raw = typeof error === 'string' ? error : (error?.message || (error == null ? '' : String(error)));
    const message = String(raw || '').trim();
    if (!message || message.length > 220 || INTERNAL_ERROR_PATTERN.test(message) || !/[\u0E00-\u0E7F]/.test(message)) return fallback;
    return message;
  }
  window.pdCustomerFacingMessage = customerFacingMessage;

  // Use PrintDekD's own modal for confirmations instead of browser-native confirm().
  // This keeps Admin actions visually consistent with the existing logout/success dialog.
  function showAppConfirm({ title, message, icon = 'shield-check', confirmText = 'ยืนยัน', cancelText = 'ยกเลิก', onConfirm }) {
    const modal = $('custom-modal');
    const titleEl = $('modal-title');
    const messageEl = $('modal-message');
    const iconEl = $('modal-icon');
    const confirmButton = $('modal-confirm-btn');
    const cancelButton = $('modal-cancel-btn');

    // The project includes these elements; retain a safe fallback only if markup was removed.
    if (!modal || !titleEl || !messageEl || !iconEl || !confirmButton || !cancelButton) {
      if (window.confirm(`${title}\n\n${message}`)) return onConfirm?.();
      return;
    }

    titleEl.textContent = title;
    messageEl.textContent = message;
    iconEl.setAttribute('data-lucide', icon);
    cancelButton.classList.remove('hidden');
    cancelButton.textContent = cancelText;
    confirmButton.textContent = confirmText;

    const close = () => {
      // `hidden` removes the dialog from the accessibility tree; leave aria-hidden
      // false so later standard notifications can reopen this shared modal normally.
      modal.classList.add('hidden');
    };
    cancelButton.onclick = (event) => {
      event?.preventDefault?.();
      close();
    };
    confirmButton.onclick = (event) => {
      event?.preventDefault?.();
      close();
      try {
        const result = onConfirm?.();
        if (result && typeof result.catch === 'function') {
          result.catch((error) => console.error('[PrintDekD] Confirmation action failed:', error));
        }
      } catch (error) {
        console.error('[PrintDekD] Confirmation action failed:', error);
      }
    };

    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-labelledby', 'modal-title');
    modal.setAttribute('aria-describedby', 'modal-message');
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.remove('hidden');
    try { window.lucide?.createIcons(); } catch (_) { /* icon library is optional */ }
    // Focus the safer option first so Enter does not immediately change permissions.
    requestAnimationFrame(() => cancelButton.focus({ preventScroll: true }));
  }
  const currentValue = (id) => String($(id)?.value ?? '').trim();
  const randomKey = () => {
    if (window.crypto?.randomUUID) return window.crypto.randomUUID();
    throw new Error('เบราว์เซอร์นี้สร้างรหัสคำขอที่ปลอดภัยไม่ได้ กรุณาเปิด Chrome/Edge เวอร์ชันปัจจุบัน');
  };

  async function requireSession() {
    const client = db();
    if (!client) throw new Error('ระบบยังไม่พร้อมให้บริการ กรุณาลองใหม่ภายหลัง');
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    const session = data?.session;
    if (!session?.access_token || !session?.user?.id) throw new Error('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
    if (window.currentUser?.id && String(window.currentUser.id) !== String(session.user.id)) {
      throw new Error('บัญชีที่ล็อกอินไม่ตรงกับโปรไฟล์ที่เปิดอยู่ กรุณารีเฟรชหน้าเว็บแล้วเข้าสู่ระบบใหม่');
    }
    return session;
  }

  async function rpc(name, args) {
    const client = db();
    if (!client) throw new Error('ระบบยังไม่พร้อมให้บริการ กรุณาลองใหม่ภายหลัง');
    const { data, error } = await client.rpc(name, args);
    if (error) throw error;
    return Array.isArray(data) && data.length === 1 ? data[0] : data;
  }

  function getStableRequestKey(form, datasetKey) {
    if (!form.dataset[datasetKey]) form.dataset[datasetKey] = randomKey();
    return form.dataset[datasetKey];
  }

  function safeFilename(file, fallback = 'upload.bin') {
    const name = String(file?.name || fallback).replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 100);
    return name && name !== '.' && name !== '..' ? name : fallback;
  }

  async function uploadPrivateFile(bucket, path, file, contentType) {
    const client = db();
    const { error } = await client.storage.from(bucket).upload(path, file, {
      upsert: true,
      contentType: contentType || file.type || 'application/octet-stream',
      cacheControl: '3600'
    });
    if (error) throw error;
    return path;
  }

  async function removePrivateFile(bucket, path) {
    if (!bucket || !path) return;
    try { await db()?.storage.from(bucket).remove([path]); } catch (_) { /* Best-effort cleanup only. */ }
  }

  function canManualReview(result, response) {
    // Only an explicit server-side manualReview result is eligible for the pending
    // admin path. Definite rejects (duplicate slip, amount/receiver mismatch, bad QR)
    // must not silently turn into an approvable top-up request.
    return response?.status >= 500 && result?.manualReview === true && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(result?.manualReviewToken || ''));
  }

  async function verifySlipWithV2(file, amount, purpose, requestKey) {
    if (!file) throw new Error('กรุณาแนบรูปสลิปก่อนยืนยัน');
    if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
      throw new Error('รองรับเฉพาะรูปสลิป PNG, JPG/JPEG หรือ WEBP');
    }
    if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
      throw new Error('ไฟล์สลิปต้องมีขนาดมากกว่า 0 และไม่เกิน 4 MB');
    }
    const amountNumber = Number(amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) throw new Error('ยอดเงินที่ต้องตรวจสอบไม่ถูกต้อง');
    if (!['topup', 'print'].includes(purpose)) throw new Error('ประเภทการตรวจสลิปไม่ถูกต้อง');

    const session = await requireSession();
    const body = new FormData();
    body.append('slip', file, safeFilename(file, 'slip.jpg'));
    body.append('amount', amountNumber.toFixed(2));
    body.append('purpose', purpose);
    if (!requestKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requestKey)) {
      throw new Error('รหัสคำขอไม่ถูกต้อง จึงไม่ส่งไฟล์สลิปไปตรวจ');
    }
    body.append('requestKey', requestKey);

    let response;
    try {
      response = await fetch('/api/verify-slip-v2', {
        method: 'POST',
        body,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { Accept: 'application/json', Authorization: `Bearer ${session.access_token}` }
      });
    } catch (_) {
      // A network failure is ambiguous: the server may already have stored a
      // verification capability. Do not create a second manual request in this case.
      throw new Error('ไม่สามารถตรวจสอบสลิปได้ในขณะนี้ จึงยังไม่มีการเพิ่ม Coins กรุณาลองใหม่ภายหลัง และตรวจสอบประวัติ Coins ก่อนส่งคำขอซ้ำ');
    }

    let result = null;
    try { result = await response.json(); } catch (_) { }
    if (canManualReview(result, response)) {
      return {
        manualReview: true,
        manualReviewToken: String(result.manualReviewToken),
        amount: amountNumber,
        message: customerFacingMessage(result?.message, 'ยังไม่สามารถยืนยันสลิปได้ในขณะนี้ คุณสามารถส่งคำขอให้ผู้ดูแลตรวจสอบหลักฐานการโอนได้'),
        code: String(result?.code || 'manual_review_required')
      };
    }
    if (!response.ok || result?.ok !== true) {
      throw new Error(String(result?.message || 'ไม่สามารถยืนยันสลิปได้ กรุณาตรวจสอบรูปสลิปและลองใหม่อีกครั้ง'));
    }
    const confirmed = Number(result.amount);
    if (!Number.isFinite(confirmed) || Math.round(confirmed * 100) !== Math.round(amountNumber * 100)) {
      throw new Error('ยอดเงินบนสลิปไม่ตรงกับยอดที่เลือก กรุณาตรวจสอบจำนวนเงินแล้วลองใหม่อีกครั้ง');
    }
    if (!result.verificationId || !String(result.transRef || '').trim()) {
      throw new Error('ยังยืนยันผลตรวจสลิปไม่ได้ กรุณาตรวจสอบประวัติ Coins ก่อนส่งรายการซ้ำ หรือ ติดต่อผู้ดูแลระบบ');
    }
    return {
      manualReview: false,
      verificationId: String(result.verificationId),
      transRef: String(result.transRef).slice(0, 100),
      amount: confirmed,
      verifiedAt: String(result.verifiedAt || new Date().toISOString()),
      message: String(result.message || 'ยืนยันสลิปเรียบร้อยแล้ว')
    };
  }

  async function findTopupByRequestKey(userId, requestKey) {
    const client = db();
    const { data, error } = await client.from('topups')
      .select('id,user_id,amount,status,verification_status,created_at,request_key')
      .eq('user_id', userId).eq('request_key', requestKey).maybeSingle();
    if (error) throw error;
    return data;
  }

  function finishTopupForm(fileInput) {
    if (fileInput) fileInput.value = '';
    // The idempotency key is derived from the uploaded image + account, so it is
    // stable even after a reload and prevents a manual-review request being
    // auto-credited later as a second top-up using the same receipt.
  }

  async function deterministicTopupRequestKey(userId, file) {
    if (!window.crypto?.subtle) throw new Error('เบราว์เซอร์นี้ไม่รองรับการตรวจสอบไฟล์อย่างปลอดภัย กรุณาใช้เบราว์เซอร์รุ่นล่าสุดและเปิดเว็บไซต์ผ่านการเชื่อมต่อที่ปลอดภัย');
    const fileDigest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()));
    const hex = [...fileDigest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    const seed = new TextEncoder().encode(`${userId}:${hex}`);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', seed));
    const bytes = digest.slice(0, 16);
    // Format the first 128 hash bits as a deterministic UUID-shaped idempotency key.
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const out = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    return `${out.slice(0,8)}-${out.slice(8,12)}-${out.slice(12,16)}-${out.slice(16,20)}-${out.slice(20,32)}`;
  }

  window.handleTopupSubmit = async function handleTopupSubmitSecureRpc(event) {
    event?.preventDefault();
    const client = db();
    const user = window.currentUser;
    const fileInput = $('topup-slip-file');
    const form = fileInput?.form || q('#view-wallet form');
    if (!user) return notify('กรุณาล็อกอิน', 'กรุณาล็อกอินก่อนทำรายการเติม Coins', 'lock');
    if (!client) return notify('ระบบยังไม่พร้อมให้บริการ', 'ยังไม่สามารถรับคำขอเติม Coins ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ', 'database-zap');
    const amount = Number($('selected-topup-amount')?.value || 20);
    if (![20, 50, 100, 200, 500].includes(amount)) return notify('แพ็กเกจไม่ถูกต้อง', 'เลือก Coins ได้เฉพาะ 20, 50, 100, 200 หรือ 500 บาท', 'shield-alert');
    const file = fileInput?.files?.[0];
    if (!file) return notify('ยังไม่ได้แนบสลิป', 'กรุณาแนบสลิปการโอนเงินจริงก่อนส่งคำขอ', 'file-warning');
    if (file.size > 4 * 1024 * 1024) return notify('ไฟล์ใหญ่เกินไป', 'ไฟล์สลิปต้องไม่เกิน 4 MB', 'file-warning');

    const submit = form?.querySelector('button[type="submit"]');
    if (submit?.disabled) return;
    if (submit) { submit.disabled = true; submit.dataset.pdRpcBusy = '1'; }
    let requestKey = '';
    let slipPath = '';
    try {
      const session = await requireSession();
      requestKey = await deterministicTopupRequestKey(session.user.id, file);
      const existing = await findTopupByRequestKey(session.user.id, requestKey);
      if (existing) {
        if (Number(existing.amount) !== amount) {
          return notify('สลิปนี้เคยถูกส่งแล้ว', `ไฟล์สลิปนี้ผูกกับคำขอเดิมจำนวน ${money(existing.amount)} Coins ไม่สามารถนำไฟล์เดิมไปขอเติม ${money(amount)} Coins ซ้ำได้`, 'shield-alert');
        }
        finishTopupForm(fileInput);
        await window.fetchUserTopups?.();
        if (existing.status === 'approved') {
          await window.fetchUserWallet?.();
          return notify('รายการเติม Coins เสร็จแล้ว', `พบรายการเดิม #${existing.id} จำนวน ${money(existing.amount)} Coins สถานะอนุมัติแล้ว จึงไม่เพิ่ม Coins ซ้ำ`, 'check-circle-2');
        }
        if (existing.status === 'rejected') return notify('รายการเดิมถูกปฏิเสธแล้ว', `คำขอ #${existing.id} ถูกจัดการไปแล้ว จึงไม่ส่งซ้ำ`, 'shield-alert');
        return notify('มีคำขอรอตรวจสอบอยู่แล้ว', `คำขอ #${existing.id} ยังรอแอดมินตรวจสลิปและอนุมัติ Coins`, 'clock');
      }

      const verification = await verifySlipWithV2(file, amount, 'topup', requestKey);
      const filename = safeFilename(file, 'slip.jpg');
      slipPath = `${session.user.id}/topups/${requestKey}/${filename}`;
      await uploadPrivateFile('slips', slipPath, file, file.type);

      if (verification.manualReview) {
        const pending = await rpc('pd_create_pending_topup_v2', {
          p_amount: amount,
          p_slip_path: slipPath,
          p_request_key: requestKey,
          p_manual_verification_id: verification.manualReviewToken
        });
        finishTopupForm(fileInput);
        await window.fetchUserTopups?.();
        if (pending?.status === 'approved') {
          await window.fetchUserWallet?.();
          notify('คำขอนี้ได้รับการอนุมัติแล้ว', `พบรายการ #${pending?.topup_id || ''} ที่อนุมัติไปแล้ว จึงไม่เพิ่ม Coins ซ้ำ`, 'check-circle-2');
        } else if (pending?.status === 'rejected') {
          notify('คำขอนี้ถูกปฏิเสธแล้ว', `พบคำขอเดิม #${pending?.topup_id || ''} ระบบไม่เพิ่ม Coins`, 'shield-alert');
        } else {
          notify(
            'ส่งคำขอให้แอดมินตรวจสอบแล้ว',
            `ยังไม่สามารถยืนยันสลิปได้ในขณะนี้\n\nส่งคำขอ ${pending?.topup_id || ''} ให้ผู้ดูแลตรวจสอบแล้ว Coins จะเพิ่มหลังจากผู้ดูแลตรวจหลักฐานการโอนและอนุมัติเท่านั้น`,
            'clock'
          );
        }
        return;
      }

      const created = await rpc('pd_create_topup_v2', {
        p_slip_verification_id: verification.verificationId,
        p_slip_path: slipPath,
        p_request_key: requestKey
      });
      finishTopupForm(fileInput);
      try { await window.fetchUserWallet?.(); } catch (refreshError) { console.warn('[PrintDekD] Wallet refresh after top-up:', refreshError); }
      try { await window.fetchUserTopups?.(); } catch (refreshError) { console.warn('[PrintDekD] Top-up history refresh:', refreshError); }
      if (created?.status === 'pending') {
        notify('คำขอเติม Coins ยังรอตรวจสอบ', `พบคำขอเดิม #${created?.topup_id || ''} จำนวน ${money(created?.amount ?? verification.amount)} Coins ซึ่งยังไม่อนุมัติ จึงไม่มีการเพิ่ม Coins ในขั้นตอนนี้`, 'clock');
      } else if (created?.status === 'rejected') {
        notify('คำขอเติม Coins นี้ถูกปฏิเสธแล้ว', `พบคำขอเดิม #${created?.topup_id || ''} ระบบไม่เพิ่ม Coins ซ้ำ`, 'shield-alert');
      } else {
        notify(
          created?.idempotent_replay ? 'รายการเติม Coins มีอยู่แล้ว' : 'เติม Coins สำเร็จ',
          `ตรวจสอบยอดโอน ${money(created?.amount ?? verification.amount)} บาทเรียบร้อยแล้ว.\n${created?.idempotent_replay ? 'พบรายการเดิม จึงไม่มีการเพิ่ม Coins ซ้ำ' : 'เพิ่ม Coins ให้บัญชีของคุณเรียบร้อยแล้ว'}${created?.balance != null ? `\nยอดคงเหลือ ${money(created.balance)} Coins` : ''}`,
          'check-circle-2'
        );
      }
    } catch (error) {
      const friendly = customerFacingMessage(error, 'ส่งคำขอเติม Coins ไม่สำเร็จ กรุณาตรวจสอบประวัติ Coins ก่อนส่งซ้ำ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ');
      // Keep the technical error in the console for maintainers, not in customer-facing copy.
      console.error('[PrintDekD] Top-up action failed:', error);
      notify('ส่งคำขอเติม Coins ไม่สำเร็จ', `${friendly}\n\nกรุณาตรวจสอบประวัติ Coins ก่อนส่งคำขอซ้ำ`, 'shield-alert');
    } finally {
      if (submit?.isConnected) { submit.disabled = false; delete submit.dataset.pdRpcBusy; }
    }
  };

  function compressPageNumbers(numbers) {
    if (!numbers.length) return '';
    const ranges = [];
    let start = numbers[0], previous = numbers[0];
    for (let i = 1; i < numbers.length; i++) {
      const value = numbers[i];
      if (value === previous + 1) { previous = value; continue; }
      ranges.push(start === previous ? String(start) : `${start}-${previous}`);
      start = previous = value;
    }
    ranges.push(start === previous ? String(start) : `${start}-${previous}`);
    return ranges.join(',');
  }

  function currentPageRange(totalPages) {
    const mode = q('input[name="page_selection_mode"]:checked')?.value || 'text';
    if (mode === 'text') {
      const typed = currentValue('page-range-input');
      return typed || `1-${totalPages}`;
    }
    const checked = qa('#pages-grid-container input[type="checkbox"]:checked')
      .map((item) => Number(item.value)).filter(Number.isInteger).sort((a, b) => a - b);
    return checked.length ? compressPageNumbers([...new Set(checked)]) : `1-${totalPages}`;
  }

  function countPageRange(rangeText, totalPages) {
    const text = String(rangeText || '').replace(/\s+/g, '');
    if (!text || ['all', 'ทั้งหมด'].includes(text.toLowerCase())) return totalPages;
    const chosen = new Set();
    for (const chunk of text.split(',')) {
      let start, end;
      if (/^\d+$/.test(chunk)) start = end = Number(chunk);
      else if (/^\d+-\d+$/.test(chunk)) {
        const split = chunk.split('-').map(Number); [start, end] = split;
      } else throw new Error(`ช่วงหน้า “${chunk}” ไม่ถูกต้อง ใช้รูปแบบ 1-3,5`);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > totalPages) {
        throw new Error(`ช่วงหน้า ${chunk} อยู่นอกเอกสาร 1-${totalPages}`);
      }
      if (end - start > 5000) throw new Error('ช่วงหน้ากว้างเกินไป');
      for (let page = start; page <= end; page++) {
        if (chosen.has(page)) throw new Error(`มีการเลือกหน้า ${page} ซ้ำกัน`);
        chosen.add(page);
      }
    }
    if (!chosen.size) throw new Error('กรุณาเลือกหน้าที่ต้องการพิมพ์');
    return chosen.size;
  }

  async function getPricingForOrder(client, paperSize, deliveryMethod) {
    const { data: price, error: priceError } = await client.from('pricing')
      .select('paper_size,black_white_price,color_price,duplex_price,active')
      .eq('paper_size', paperSize).eq('active', true).maybeSingle();
    if (priceError) throw priceError;
    if (!price) throw new Error(`ยังไม่มีราคาที่เปิดใช้งานสำหรับกระดาษ ${paperSize}`);
    let deliveryFee = 0;
    if (deliveryMethod === 'delivery') {
      const { data: option, error: optionError } = await client.from('delivery_options')
        .select('provider_key,fee,active').eq('provider_key', 'parcel').eq('active', true).maybeSingle();
      if (optionError) throw optionError;
      if (!option || option.fee == null) throw new Error('ขณะนี้ยังไม่พร้อมให้เลือกจัดส่งพัสดุ กรุณาเลือกมารับที่ร้านหรือติดต่อผู้ดูแลระบบ');
      deliveryFee = Number(option.fee);
    }
    return { price, deliveryFee };
  }

  async function findOrderByRequestKey(client, userId, requestKey) {
    const { data, error } = await client.from('orders')
      .select('id,queue_number,total_amount,status,client_request_key')
      .eq('user_id', userId).eq('client_request_key', requestKey).maybeSingle();
    if (error) throw error;
    return data;
  }

  function formAddress() {
    const stored = currentValue('recipient-address');
    if (stored) return stored.slice(0, 1000);
    const parts = [
      currentValue('recipient-house-no'), currentValue('recipient-moo'),
      currentValue('recipient-village'), currentValue('recipient-soi'), currentValue('recipient-road'),
      currentValue('recipient-subdistrict') ? `ตำบล/แขวง ${currentValue('recipient-subdistrict')}` : '',
      currentValue('recipient-district') ? `อำเภอ/เขต ${currentValue('recipient-district')}` : '',
      currentValue('recipient-province') ? `จังหวัด ${currentValue('recipient-province')}` : '',
      currentValue('recipient-postal-code'), currentValue('recipient-address-extra')
    ].filter(Boolean);
    return parts.join(' ').slice(0, 1000);
  }

  function resetPrintForm() {
    const form = $('print-form');
    form?.reset();
    if (form) delete form.dataset.pdOrderRequestKey;
    window.selectedFileObj = null;
    $('upload-placeholder')?.classList.remove('hidden');
    $('file-details')?.classList.add('hidden');
    $('preview-file-drawer-btn')?.classList.add('hidden');
    if ($('pdf-preview-wrapper')) $('pdf-preview-wrapper').innerHTML = '<p class="text-xs sub-text py-12">อัปโหลดไฟล์ PDF เพื่อแสดงพรีวิวหน้า...</p>';
    if ($('pages-grid-container')) $('pages-grid-container').innerHTML = '<p class="col-span-full text-center text-xs sub-text py-2">กรุณาอัปโหลดไฟล์ PDF เพื่อเลือกหน้า</p>';
    try { window.toggleDeliveryFields?.(); } catch (_) { }
  }

  window.handleOrderSubmit = async function handleOrderSubmitSecureRpc(event) {
    event?.preventDefault();
    const client = db();
    const user = window.currentUser;
    const form = $('print-form');
    const submit = form?.querySelector('button[type="submit"]');
    if (!user) return notify('กรุณาล็อกอิน', 'กรุณาล็อกอินก่อนสร้างคิวงานพิมพ์', 'lock');
    if (!client) return notify('ระบบยังไม่พร้อมให้บริการ', 'ยังไม่สามารถรับคำสั่งพิมพ์ได้ในขณะนี้ กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ', 'database-zap');
    if (submit?.disabled) return;

    const file = window.selectedFileObj || $('file-input')?.files?.[0];
    if (!file) return notify('ยังไม่ได้เลือกไฟล์', 'กรุณาอัปโหลดเอกสาร PDF ก่อนสร้างรายการ', 'file-plus-2');
    if (!/\.pdf$/i.test(String(file.name || '')) || (file.type && file.type !== 'application/pdf')) {
      return notify('รองรับไฟล์ PDF เท่านั้น', 'กรุณาบันทึกเอกสารเป็นไฟล์ PDF ก่อนอัปโหลด เพื่อให้ระบบตรวจจำนวนหน้าและคำนวณราคาได้ถูกต้อง', 'file-warning');
    }
    if (file.size <= 0 || file.size > 20 * 1024 * 1024) return notify('ขนาดไฟล์ไม่ถูกต้อง', 'ไฟล์ PDF ต้องมีขนาดมากกว่า 0 และไม่เกิน 20 MB', 'file-warning');
    try {
      const signature = new Uint8Array(await file.slice(0, 5).arrayBuffer());
      if (new TextDecoder().decode(signature) !== '%PDF-') throw new Error('ไฟล์นี้ไม่มีลายเซ็น PDF ที่ถูกต้อง กรุณาเลือกไฟล์ PDF จริง');
    } catch (error) { return notify('ตรวจสอบไฟล์ไม่สำเร็จ', customerFacingMessage(error, 'อ่านไฟล์ PDF ไม่สำเร็จ กรุณาลองใช้ไฟล์ PDF อื่น หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'file-warning'); }

    const paymentMethod = q('input[name="payment_method"]:checked')?.value;
    const deliveryMethod = q('input[name="delivery_method"]:checked')?.value;
    if (!['coins', 'promptpay'].includes(paymentMethod) || !['pickup', 'delivery'].includes(deliveryMethod)) {
      return notify('ตรวจสอบตัวเลือก', 'กรุณาเลือกวิธีชำระเงินและวิธีรับเอกสาร', 'alert-triangle');
    }
    const totalPages = Number(window.detectedPageCount || Number.parseInt(currentValue('printed-pages-input'), 10) || 0);
    if (!Number.isInteger(totalPages) || totalPages < 1) return notify('ยังอ่านจำนวนหน้าไม่ได้', 'รอให้ระบบอ่านพรีวิว PDF เสร็จแล้วลองอีกครั้ง', 'file-warning');
    const pageRange = currentPageRange(totalPages);
    let selectedPages;
    try { selectedPages = countPageRange(pageRange, totalPages); }
    catch (error) { return notify('ช่วงหน้าไม่ถูกต้อง', customerFacingMessage(error, 'กรุณาตรวจสอบเลขหน้าที่เลือก แล้วลองใหม่อีกครั้ง'), 'alert-triangle'); }
    const copies = Number.parseInt(currentValue('copies'), 10);
    if (!Number.isInteger(copies) || copies < 1 || copies > 500) return notify('จำนวนชุดไม่ถูกต้อง', 'จำนวนชุดต้องอยู่ระหว่าง 1–500 ชุด', 'alert-triangle');
    const paperSize = currentValue('paper-size') || 'A4';
    const color = currentValue('color-type') === 'color';
    const duplex = currentValue('duplex-type') === 'duplex';
    const note = currentValue('order-notes');
    let recipientName = '', phone = '', address = '';
    if (deliveryMethod === 'delivery') {
      // Keep the existing postcode-first validator (province -> district -> subdistrict)
      // from the address-picker runtime, even though this last-loaded bridge replaces
      // the old submit wrapper that originally called it.
      if (typeof window.pdEnsureValidatedDeliveryAddress === 'function') {
        try { await window.pdEnsureValidatedDeliveryAddress(); }
        catch (_) { return; } // Validator has already shown the field-specific message.
      }
      recipientName = currentValue('recipient-name');
      phone = currentValue('recipient-phone');
      address = formAddress();
      if (!recipientName || !/^0[0-9\-\s]{8,14}$/.test(phone) || !address) {
        return notify('ข้อมูลจัดส่งไม่ครบ', 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่ให้ครบถ้วน', 'map-pin-x');
      }
      if (!currentValue('recipient-house-no') || !currentValue('recipient-postal-code') || !currentValue('recipient-province') || !currentValue('recipient-district') || !currentValue('recipient-subdistrict')) {
        return notify('ที่อยู่ยังไม่สมบูรณ์', 'กรุณากรอกบ้านเลขที่และยืนยันรหัสไปรษณีย์ จังหวัด อำเภอ และตำบลให้ครบ', 'map-pin-x');
      }
    }

    const requestKey = getStableRequestKey(form, 'pdOrderRequestKey');
    if (submit) { submit.disabled = true; submit.dataset.pdRpcBusy = '1'; }
    let documentPath = '', slipPath = '', documentId = '', documentRowCreated = false, rpcStarted = false;
    try {
      const session = await requireSession();
      const existing = await findOrderByRequestKey(client, session.user.id, requestKey);
      if (existing) {
        resetPrintForm();
        await window.fetchQueues?.();
        if (paymentMethod === 'coins') await window.fetchUserWallet?.();
        return notify('พบรายการที่บันทึกแล้ว', `คำขอเดิมถูกบันทึกเป็นคิว #${existing.queue_number ?? existing.id} จำนวน ${money(existing.total_amount)} บาท/Coins จึงไม่ส่งรายการซ้ำ`, 'check-circle-2');
      }

      const { price, deliveryFee } = await getPricingForOrder(client, paperSize, deliveryMethod);
      const perPage = Number(color ? price.color_price : price.black_white_price) + (duplex ? Number(price.duplex_price || 0) : 0);
      const estimatedTotal = Number((selectedPages * perPage * copies + deliveryFee).toFixed(2));
      if (!Number.isFinite(estimatedTotal) || estimatedTotal <= 0) throw new Error('ขณะนี้ยังคำนวณราคาไม่ได้ กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ');

      const totalEl = $('total-price');
      if (totalEl) totalEl.textContent = `${money(estimatedTotal)} ฿`;
      const breakdown = $('price-breakdown');
      if (breakdown) breakdown.textContent = `(${selectedPages} หน้า × ${money(perPage)} ฿ × ${copies} ชุด${deliveryFee ? ` + ค่าส่ง ${money(deliveryFee)} ฿` : ''})`;

      if (paymentMethod === 'coins') {
        await window.fetchUserWallet?.();
        const balance = Number(window.currentUser?.coins || 0);
        if (balance < estimatedTotal) throw new Error(`Coins ไม่เพียงพอ มี ${money(balance)} แต่ต้องใช้ ${money(estimatedTotal)} Coins`);
      }

      let verification = null;
      if (paymentMethod === 'promptpay') {
        const slipFile = $('order-slip-file')?.files?.[0];
        if (!slipFile) throw new Error('กรุณาแนบสลิป PromptPay ก่อนสั่งพิมพ์');
        verification = await verifySlipWithV2(slipFile, estimatedTotal, 'print', requestKey);
        if (verification.manualReview) {
          throw new Error(`ยังไม่สามารถยืนยันการชำระเงินของงานพิมพ์ได้ในขณะนี้: ${customerFacingMessage(verification.message, 'กรุณาตรวจสอบสลิปแล้วลองใหม่อีกครั้ง')}\nเพื่อป้องกันการสร้างคิวที่ยังไม่ได้ชำระเงิน ระบบยังไม่ได้สร้างคิว กรุณาลองใหม่ภายหลังหรือติดต่อผู้ดูแลระบบ`);
        }
        slipPath = `${session.user.id}/orders/${requestKey}/${safeFilename(slipFile, 'payment-slip.jpg')}`;
        await uploadPrivateFile('slips', slipPath, slipFile, slipFile.type);
      }

      const documentName = safeFilename(file, 'document.pdf');
      documentPath = `${session.user.id}/orders/${requestKey}/${documentName}`;
      await uploadPrivateFile('documents', documentPath, file, 'application/pdf');
      documentId = randomKey();
      const { error: documentError } = await client.from('documents').insert([{
        id: documentId,
        user_id: session.user.id,
        file_name: String(file.name || 'document.pdf').slice(0, 250),
        file_path: documentPath,
        file_bucket: 'documents',
        file_mime: 'application/pdf',
        page_count: totalPages,
        file_size: file.size
      }]);
      if (documentError) throw documentError;
      documentRowCreated = true;

      rpcStarted = true;
      const result = await rpc('pd_create_print_order_v2', {
        p_document_id: documentId,
        p_page_range: pageRange,
        p_copies: copies,
        p_color: color,
        p_paper_size: paperSize,
        p_duplex: duplex,
        p_binding_option_id: null,
        p_delivery_method: deliveryMethod,
        p_delivery_provider: deliveryMethod === 'delivery' ? 'parcel' : null,
        p_recipient_name: deliveryMethod === 'delivery' ? recipientName : null,
        p_phone_number: deliveryMethod === 'delivery' ? phone : null,
        p_delivery_address: deliveryMethod === 'delivery' ? address : null,
        p_payment_method: paymentMethod,
        p_slip_verification_id: verification?.verificationId || null,
        p_client_request_key: requestKey,
        p_slip_path: slipPath || null
      });

      delete form.dataset.pdOrderRequestKey;
      await window.fetchQueues?.();
      if (paymentMethod === 'coins') await window.fetchUserWallet?.();
      resetPrintForm();
      const queueLabel = result?.queue_number ?? result?.order_id ?? 'บันทึกแล้ว';
      notify(
        result?.idempotent_replay ? 'พบคิวที่บันทึกไว้แล้ว' : 'ส่งคำสั่งพิมพ์สำเร็จ',
        `คิว #${queueLabel} • ${selectedPages} หน้า × ${copies} ชุด\nยอด ${money(result?.total_amount ?? estimatedTotal)} ${paymentMethod === 'coins' ? 'Coins' : 'บาท'}\n${paymentMethod === 'coins' ? 'หัก Coins และบันทึกคิวเรียบร้อยแล้ว' : 'ยืนยันการชำระเงินและบันทึกคิวเรียบร้อยแล้ว'}${note ? `\nหมายเหตุที่กรอก: ${note}` : ''}`,
        'check-circle-2'
      );
    } catch (error) {
      const raw = customerFacingMessage(error, 'สร้างรายการไม่สำเร็จ กรุณาตรวจสอบคิวก่อนส่งซ้ำ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ');
      console.error('[PrintDekD] Print-order action failed:', error);
      // A database error with a server code is a confirmed rollback. Network
      // failures are ambiguous, so preserve uploaded evidence and keep the request key.
      const confirmedDatabaseFailure = Boolean(error?.code) && rpcStarted;
      const mayCleanUp = !rpcStarted || confirmedDatabaseFailure;
      if (mayCleanUp) {
        if (documentRowCreated && documentId) {
          try { await client.from('documents').delete().eq('id', documentId).eq('user_id', window.currentUser.id); } catch (_) { }
        }
        await removePrivateFile('documents', documentPath);
        await removePrivateFile('slips', slipPath);
      }
      notify('สร้างรายการไม่สำเร็จ', `${raw}${rpcStarted && !confirmedDatabaseFailure ? '\n\nระบบยังยืนยันผลการบันทึกไม่ได้ กรุณารีเฟรชและตรวจสอบคิวก่อนส่งคำสั่งซ้ำ' : ''}`, 'shield-alert');
    } finally {
      if (submit?.isConnected) { submit.disabled = false; delete submit.dataset.pdRpcBusy; }
    }
  };

  // Wallet rows are created by the auth.users trigger in the supplied schema.
  // Never create or change a wallet directly from browser code.
  window.ensureUserWalletV12 = async function ensureExistingWalletOnly(userId) {
    const client = db();
    if (!client) throw new Error('ระบบยังไม่พร้อมให้บริการ กรุณาลองใหม่ภายหลัง');
    const { data, error } = await client.from('wallets')
      .select('id,user_id,balance,updated_at').eq('user_id', userId).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('ยังไม่พบกระเป๋า Coins สำหรับบัญชีนี้ กรุณาติดต่อผู้ดูแลระบบเพื่อให้ตรวจสอบบัญชีของคุณ');
    return data;
  };

  window.approveTopup = async function approveTopupThroughRpc(topupId) {
    if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
    const client = db();
    if (!client) return notify('ระบบยังไม่พร้อมให้บริการ', 'ยังไม่สามารถอนุมัติรายการได้ กรุณาลองใหม่ภายหลัง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ', 'database-zap');
    if (!window.confirm('ก่อนอนุมัติ กรุณาตรวจสอบหลักฐานการโอนจริงจากรายการเดินบัญชีของบัญชีผู้รับ ทั้งยอดเงิน วันเวลา และรายการโอน\n\nCoins จะเพิ่มให้สมาชิกหลังจากยืนยันว่ามีการโอนเงินจริงแล้วเท่านั้น\n\nต้องการดำเนินการต่อหรือไม่?')) return;
    const verificationRef = window.prompt('กรอกเลขอ้างอิงธุรกรรมจากสลิปหรือรายการเดินบัญชีธนาคาร (จำเป็นเพื่อป้องกันการเติมซ้ำ):')?.trim();
    if (!verificationRef) return notify('ยังไม่ได้กรอกเลขอ้างอิง', 'ยกเลิกการอนุมัติแล้ว ไม่มีการเพิ่ม Coins', 'shield-alert');
    if (verificationRef.length > 120) return notify('เลขอ้างอิงยาวเกินไป', 'เลขอ้างอิงต้องไม่เกิน 120 ตัวอักษร', 'shield-alert');
    try {
      const result = await rpc('pd_admin_review_topup_v2', {
        p_topup_id: String(topupId),
        p_decision: 'approve',
        p_admin_note: 'อนุมัติโดยผู้ดูแลหลังตรวจสอบการโอนจริง',
        p_verification_ref: verificationRef
      });
      notify('อนุมัติรายการสำเร็จ', `คำขอ ${result?.topup_id || topupId} • ${money(result?.amount)} Coins${result?.balance != null ? `\nยอดคงเหลือสมาชิก ${money(result.balance)} Coins` : ''}${result?.idempotent_replay ? '\nรายการนี้เคยถูกจัดการแล้ว จึงไม่มีการเพิ่ม Coins ซ้ำ' : '\nเพิ่ม Coins ให้สมาชิกเรียบร้อยแล้ว'}`, 'check-circle-2');
      await window.loadAdminData?.();
    } catch (error) {
      notify('อนุมัติไม่สำเร็จ', customerFacingMessage(error, 'ยังไม่สามารถอนุมัติรายการได้ กรุณาตรวจสอบข้อมูลและลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'shield-alert');
    }
  };

  window.rejectTopup = async function rejectTopupThroughRpc(topupId) {
    if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
    if (!window.confirm('ยืนยันปฏิเสธคำขอเติม Coins นี้หรือไม่?\n\nระบบจะไม่เปลี่ยนยอด Coins ของผู้ใช้')) return;
    try {
      const result = await rpc('pd_admin_review_topup_v2', {
        p_topup_id: String(topupId),
        p_decision: 'reject',
        p_admin_note: 'ปฏิเสธโดยผู้ดูแลหลังตรวจสอบหลักฐาน',
        p_verification_ref: null
      });
      notify('ปฏิเสธคำขอแล้ว', `คำขอ ${result?.topup_id || topupId} ถูกปฏิเสธ และไม่มีการเพิ่ม Coins`, 'check-circle-2');
      await window.loadAdminData?.();
    } catch (error) {
      notify('ปฏิเสธรายการไม่สำเร็จ', customerFacingMessage(error, 'ยังไม่สามารถจัดการรายการนี้ได้ กรุณาลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'shield-alert');
    }
  };

  window.changeUserRole = async function changeUserRoleThroughRpc(userId, newRole) {
    if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
    const role = String(newRole || '').toLowerCase();
    if (!['admin', 'staff', 'member'].includes(role)) return notify('สิทธิ์ไม่ถูกต้อง', 'เลือกได้เฉพาะ Admin, Staff หรือ Member', 'shield-alert');
    if (String(window.currentUser?.id) === String(userId)) return notify('เปลี่ยนสิทธิ์ไม่ได้', 'เพื่อป้องกันการล็อกตัวเองออกจากระบบ ไม่อนุญาตให้เปลี่ยนบทบาทบัญชีที่กำลังใช้งาน', 'shield-alert');
    const roleLabel = role === 'admin' ? 'Admin' : role === 'staff' ? 'Staff' : 'Member';
    showAppConfirm({
      title: 'ยืนยันการเปลี่ยนสิทธิ์',
      message: `ต้องการเปลี่ยนสิทธิ์บัญชีนี้เป็น ${roleLabel} หรือไม่?\n\nการเปลี่ยนสิทธิ์จะมีผลหลังจากคุณกดยืนยัน`,
      icon: role === 'admin' ? 'shield-check' : 'user-round',
      confirmText: `ยืนยันเป็น ${roleLabel}`,
      cancelText: 'ยกเลิก',
      onConfirm: async () => {
        try {
          await rpc('pd_admin_set_user_role_v2', { p_user_id: String(userId), p_new_role: role });
          const { data, error } = await db().from('users').select('id,role').eq('id', userId).maybeSingle();
          if (error) throw error;
          if (!data || data.role !== role) throw new Error('ระบบยังยืนยันการเปลี่ยนสิทธิ์ไม่สำเร็จ กรุณารีเฟรชหน้าแล้วลองอีกครั้ง หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ');
          notify('เปลี่ยนสิทธิ์สำเร็จ', `เปลี่ยนสิทธิ์สมาชิกเป็น ${roleLabel} เรียบร้อยแล้ว`, 'shield-check');
          await window.loadAdminData?.();
        } catch (error) {
          notify('เปลี่ยนสิทธิ์ไม่สำเร็จ', customerFacingMessage(error, 'ยังไม่สามารถเปลี่ยนสิทธิ์สมาชิกได้ กรุณาลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'shield-alert');
        }
      }
    });
  };

  const RPC_TARGET_STATUSES = [
    ['queued', 'รอแอดมินตรวจสอบ'],
    ['preparing', 'กำลังตรวจสอบ / จัดเตรียม'],
    ['ready_for_pickup', 'พร้อมรับเอกสาร'],
    ['shipped', 'จัดส่งแล้ว'],
    ['finished', 'ส่งมอบเรียบร้อย'],
    ['failed', 'งานล้มเหลว'],
    ['cancelled', 'ยกเลิกคิว']
  ];
  function decorateStatusSelects(root = document) {
    // Important: MutationObserver watches this tbody. Do not replace <option>s
    // unless the option list actually differs, or each replacement will trigger
    // the observer again and can lock the browser in an endless mutation loop.
    const selector = 'select[data-pd-admin-action="status"]';
    const selects = root?.matches?.(selector)
      ? [root]
      : [...(root?.querySelectorAll?.(selector) || [])];

    selects.forEach((select) => {
      const current = select.value;
      const options = [...RPC_TARGET_STATUSES];
      if (current && !options.some(([value]) => value === current)) {
        const legacyLabel = ({ printing: 'กำลังดำเนินการ', completed: 'ดำเนินการแล้ว' })[current] || 'สถานะเดิม';
        options.unshift([current, `${legacyLabel}`]);
      }

      const unchanged = select.options.length === options.length && options.every(([value, label], index) => {
        const existing = select.options[index];
        return existing && existing.value === value && existing.textContent === label;
      });
      if (unchanged) return;

      select.replaceChildren(...options.map(([value, label]) => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        return option;
      }));
      select.value = current;
    });
  }

  window.updateOrderStatus = async function updateOrderStatusThroughRpc(orderId, newStatus) {
    if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
    if (!RPC_TARGET_STATUSES.some(([status]) => status === newStatus)) {
      return notify('ยังเปลี่ยนสถานะนี้ไม่ได้', 'สถานะนี้ต้องได้รับการยืนยันจากขั้นตอนการทำงานของเจ้าหน้าที่ กรุณาติดต่อผู้ดูแลระบบหากต้องการความช่วยเหลือ', 'shield-alert');
    }
    try {
      const result = await rpc('pd_update_order_status_v2', {
        p_order_id: String(orderId), p_new_status: String(newStatus), p_admin_note: null
      });
      const statusLabel = ({ queued: 'รอแอดมินตรวจสอบ', preparing: 'กำลังตรวจสอบ / จัดเตรียม', ready_for_pickup: 'พร้อมรับเอกสาร', shipped: 'จัดส่งแล้ว', finished: 'ส่งมอบเรียบร้อย', failed: 'ต้องตรวจสอบแก้ไข', cancelled: 'ยกเลิกแล้ว' })[newStatus] || 'อัปเดตแล้ว';
      notify('อัปเดตสถานะคิวสำเร็จ', `คิว #${result?.queue_number ?? orderId} → ${statusLabel}`, 'shield-check');
      await window.loadAdminData?.();
      await window.fetchQueues?.();
    } catch (error) {
      notify('อัปเดตสถานะไม่สำเร็จ', customerFacingMessage(error, 'ยังไม่สามารถบันทึกสถานะคิวได้ กรุณาลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'shield-alert');
      await window.loadAdminData?.();
    }
  };

  window.promptTracking = async function promptTrackingThroughRpc(orderId) {
    if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
    const tracking = window.prompt('กรุณากรอกหมายเลข Tracking พัสดุ:')?.trim();
    if (!tracking) return;
    if (tracking.length > 100) return notify('Tracking ไม่ถูกต้อง', 'หมายเลข Tracking ยาวเกิน 100 ตัวอักษร', 'alert-triangle');
    try {
      const client = db();
      const { data: order, error: orderError } = await client.from('orders')
        .select('id,user_id,status,delivery_method').eq('id', orderId).maybeSingle();
      if (orderError) throw orderError;
      if (!order) throw new Error('ไม่พบคิวนี้');
      if (order.delivery_method !== 'delivery') throw new Error('คิวนี้ไม่ได้เลือกจัดส่งพัสดุ');
      const { data: delivery, error: deliveryError } = await client.from('deliveries')
        .select('recipient_name,phone_number,delivery_address,delivery_provider,tracking_number')
        .eq('order_id', orderId).maybeSingle();
      if (deliveryError) throw deliveryError;
      if (!delivery) throw new Error('ไม่พบข้อมูลจัดส่งของคิวนี้');
      const result = await rpc('pd_update_delivery_v2', {
        p_order_id: String(orderId),
        p_provider: delivery.delivery_provider || 'Kerry Express',
        p_recipient_name: delivery.recipient_name,
        p_phone_number: delivery.phone_number,
        p_delivery_address: delivery.delivery_address,
        p_tracking_number: tracking
      });
      notify('บันทึก Tracking สำเร็จ', `คิว #${orderId} • ${result?.tracking_number || tracking}`, 'shield-check');
      await window.loadAdminData?.();
    } catch (error) {
      notify('บันทึกข้อมูลจัดส่งไม่สำเร็จ', customerFacingMessage(error, 'ยังไม่สามารถบันทึกข้อมูลจัดส่งได้ กรุณาตรวจสอบข้อมูลแล้วลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'shield-alert');
    }
  };

  // Slip paths are intentionally private object paths. Give authenticated staff a
  // short-lived signed URL when clicking a stored path; already-signed/public URLs
  // continue through the original modal implementation.
  const originalOpenSlipModal = window.openSlipModal;
  if (typeof originalOpenSlipModal === 'function') {
    window.openSlipModal = async function openPrivateSlipOrLegacyUrl(value) {
      const path = String(value || '').trim();
      if (!path) return notify('ไม่พบสลิป', 'ไม่มีตำแหน่งรูปสลิปในรายการนี้', 'image-off');
      if (/^https?:\/\//i.test(path)) return originalOpenSlipModal(path);
      try {
        const session = await requireSession();
        const privileged = ['admin', 'staff'].includes(String(window.currentUser?.role || '').toLowerCase());
        if (!privileged) throw new Error('ต้องเป็นผู้ดูแลหรือเจ้าหน้าที่จึงจะเปิดสลิปของสมาชิกได้');
        const { data, error } = await db().storage.from('slips').createSignedUrl(path, 600);
        if (error) throw error;
        if (!data?.signedUrl) throw new Error('ไม่สามารถเปิดดูสลิปนี้ได้ในขณะนี้ กรุณาลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ');
        return originalOpenSlipModal(data.signedUrl);
      } catch (error) {
        notify('เปิดสลิปไม่สำเร็จ', customerFacingMessage(error, 'ไม่สามารถเปิดดูสลิปได้ในขณะนี้ กรุณาลองใหม่ หากยังพบปัญหา โปรดติดต่อผู้ดูแลระบบ'), 'shield-alert');
      }
    };
  }

  // The supplied SQL deliberately has no client-facing delete RPC for ledger-linked
  // orders/top-ups. Do not leave old direct DELETE handlers appearing to succeed.
  window.deleteCompletedPrintOrder = function deletionBlockedWithoutSecureRpc() {
    notify('ยังไม่สามารถลบคิวจากหน้านี้ได้', 'เพื่อป้องกันข้อมูลการชำระเงินสูญหาย การลบคิวต้องผ่านการตรวจสอบเพิ่มเติม กรุณาติดต่อผู้ดูแลระบบเพื่อดำเนินการ', 'shield-alert');
  };
  document.addEventListener('click', (event) => {
    const bulk = event.target.closest('[data-pd-bulk-action="orders"], [data-pd-bulk-action="topups"]');
    if (!bulk) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    notify('ยังไม่สามารถลบประวัตินี้ได้', 'ระบบเก็บประวัติการทำรายการไว้เพื่อการตรวจสอบ กรุณาติดต่อผู้ดูแลระบบหากต้องการให้ช่วยตรวจสอบรายการนี้', 'shield-alert');
  }, true);

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => decorateStatusSelects(), { once: true });
  } else decorateStatusSelects();
  const adminOrdersBody = $('admin-orders-tbody');
  if (adminOrdersBody && 'MutationObserver' in window) {
    let statusDecorateQueued = false;
    const observer = new MutationObserver(() => {
      if (statusDecorateQueued) return;
      statusDecorateQueued = true;
      requestAnimationFrame(() => {
        statusDecorateQueued = false;
        decorateStatusSelects(adminOrdersBody);
      });
    });
    observer.observe(adminOrdersBody, { childList: true, subtree: true });
  }

  console.info('[PrintDekD] Secure RPC bridge loaded. Top-up, checkout and admin mutations use database RPCs.');
})();
