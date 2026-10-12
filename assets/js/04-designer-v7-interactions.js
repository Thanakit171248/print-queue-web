
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const safe = v => (typeof escapeHtml === 'function' ? escapeHtml(v ?? '') : String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));

      /* ---------- file removal ---------- */
      window.removeSelectedPrintFile = function () {
        const input = $('file-input');
        if (input) input.value = '';
        if (typeof selectedFileObj !== 'undefined') selectedFileObj = null;
        window.selectedFileObj = null;
        const ph = $('upload-placeholder'), details = $('file-details'), preview = $('preview-file-drawer-btn');
        ph?.classList.remove('hidden'); details?.classList.add('hidden'); preview?.classList.add('hidden');
        const grid = $('pages-grid-container'), drawer = $('pdf-preview-wrapper');
        if (grid) grid.innerHTML = '<p class="col-span-full text-center text-xs sub-text py-2">กรุณาอัปโหลดไฟล์ PDF เพื่อเลือกหน้า</p>';
        if (drawer) drawer.innerHTML = '<p class="text-xs sub-text py-12">อัปโหลดไฟล์ PDF เพื่อแสดงพรีวิวหน้า...</p>';
        $('pd-upload-progress')?.classList.add('hidden');
        $('total-pages-display') && ($('total-pages-display').innerText = '1 หน้า');
        $('selected-pages-count-display') && ($('selected-pages-count-display').innerText = '1 หน้า');
        $('printed-pages-input') && ($('printed-pages-input').value = 1);
        if (typeof setLiveState === 'function') setLiveState('พร้อมอัปโหลดไฟล์', 'สามารถเลือกเอกสารใหม่ได้ทันที');
      };

      const oldFileSelect = window.handleFileSelect;
      window.handleFileSelect = function (e) {
        const f = e?.target?.files?.[0];
        if (!f) return;
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        const allowed = ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'];
        if (!allowed.includes(ext)) {
          e.target.value = '';
          return showCustomModal({ title: 'รูปแบบไฟล์ไม่รองรับ', message: 'รองรับเฉพาะ PDF, DOC, DOCX, JPG, JPEG และ PNG เท่านั้น', icon: 'file-warning' });
        }
        if (f.size > 20 * 1024 * 1024) { e.target.value = ''; return showCustomModal({ title: 'ไฟล์ใหญ่เกินไป', message: 'ขนาดไฟล์สูงสุด 20 MB', icon: 'file-warning' }); }
        try { oldFileSelect?.call(this, e); } catch (err) { console.error(err); }
        setTimeout(() => {
          const card = $('file-details');
          if (card && !card.querySelector('.pd-file-remove')) {
            card.classList.add('pd-file-card');
            const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'pd-file-remove'; btn.innerHTML = '<i data-lucide="trash-2" class="w-4 h-4"></i> ลบไฟล์'; btn.onclick = (ev) => { ev.stopPropagation(); removeSelectedPrintFile() }; card.appendChild(btn);
            if (window.lucide) lucide.createIcons();
          }
        }, 80);
      };

      /* ---------- profile cropper ---------- */
      let cropImage = null, cropScale = 1, cropX = 0, cropY = 0, dragging = false, dragStart = null;
      function ensureCropModal() {
        if ($('pd-crop-modal')) return;
        const el = document.createElement('div'); el.id = 'pd-crop-modal'; el.setAttribute('aria-hidden', 'true');
        el.innerHTML = `<div class="pd-crop-shell"><div class="flex items-center justify-between gap-3 mb-3"><div><span class="pd-eyebrow">PROFILE STUDIO</span><h3 class="text-xl font-black titanium-text mt-1">จัดวางรูปโปรไฟล์</h3><p class="text-xs sub-text mt-1">ลากรูป • ซูม • ครอปเป็นวงกลม</p></div><button type="button" class="pd-crop-close nav-icon-btn ui-card" aria-label="ปิด"><i data-lucide="x"></i></button></div><div class="pd-crop-stage" id="pd-crop-stage"><img id="pd-crop-image" alt="ตัวอย่างรูปโปรไฟล์" loading="lazy" decoding="async"><span class="pd-crop-frame"></span></div><div class="pd-crop-controls"><input id="pd-crop-zoom" type="range" min="1" max="3.2" step="0.01" value="1"><button type="button" class="ui-card" id="pd-crop-reset">รีเซ็ต</button><button type="button" class="bg-blue-600 text-white" id="pd-crop-apply">ใช้รูปนี้</button></div></div>`;
        document.body.appendChild(el); if (window.lucide) lucide.createIcons();
        $('pd-crop-modal').addEventListener('click', e => { if (e.target.id === 'pd-crop-modal') closeCropper() });
        $('pd-crop-modal').querySelector('.pd-crop-close').onclick = closeCropper;
        $('pd-crop-zoom').oninput = e => { cropScale = Number(e.target.value); renderCrop() };
        $('pd-crop-reset').onclick = () => { cropScale = 1; cropX = 0; cropY = 0; $('pd-crop-zoom').value = 1; renderCrop() };
        $('pd-crop-apply').onclick = applyCrop;
        const stage = $('pd-crop-stage');
        stage.addEventListener('pointerdown', e => { dragging = true; dragStart = { x: e.clientX - cropX, y: e.clientY - cropY }; stage.setPointerCapture?.(e.pointerId) });
        stage.addEventListener('pointermove', e => { if (!dragging) return; cropX = e.clientX - dragStart.x; cropY = e.clientY - dragStart.y; renderCrop() });
        stage.addEventListener('pointerup', () => dragging = false); stage.addEventListener('pointercancel', () => dragging = false);
      }
      function renderCrop() { const img = $('pd-crop-image'); if (img) img.style.transform = `translate(${cropX}px,${cropY}px) scale(${cropScale})` }
      function closeCropper() { const m = $('pd-crop-modal'); if (m) { m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true') } }
      function openCropper(file) {
        ensureCropModal(); const reader = new FileReader(); reader.onload = e => { cropImage = e.target.result; cropScale = 1; cropX = 0; cropY = 0; $('pd-crop-image').src = cropImage; $('pd-crop-zoom').value = 1; $('pd-crop-modal').classList.add('is-open'); $('pd-crop-modal').setAttribute('aria-hidden', 'false'); setTimeout(renderCrop, 20) }; reader.readAsDataURL(file);
      }
      function applyCrop() {
        const img = $('pd-crop-image'), size = 420, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const ctx = canvas.getContext('2d');
        const frame = 280, stage = $('pd-crop-stage'), sr = stage.getBoundingClientRect(), ir = img.getBoundingClientRect();
        const cx = sr.left + sr.width / 2, cy = sr.top + sr.height / 2; const scale = frame / ir.width; const sx = (cx - frame / 2 - ir.left) / scale, sy = (cy - frame / 2 - ir.top) / scale, sw = frame / scale, sh = frame / scale;
        const source = new Image(); source.onload = () => { ctx.save(); ctx.beginPath(); ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2); ctx.clip(); ctx.drawImage(source, sx, sy, sw, sh, 0, 0, size, size); ctx.restore(); tempAvatarUrl = canvas.toDataURL('image/webp', .88); $('edit-avatar-url').value = tempAvatarUrl; const pv = $('pd-edit-avatar-preview'); if (pv) pv.src = tempAvatarUrl; closeCropper() }; source.src = img.src;
      }
      window.previewEditAvatarFile = function (e) {
        const file = e?.target?.files?.[0]; if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) { e.target.value = ''; return showCustomModal({ title: 'รูปแบบรูปภาพไม่รองรับ', message: 'รองรับ PNG, JPG/JPEG และ WEBP เท่านั้น', icon: 'image-off' }); }
        if (file.size > 2 * 1024 * 1024) { e.target.value = ''; return showCustomModal({ title: 'รูปภาพใหญ่เกินไป', message: 'ขนาดสูงสุด 2 MB เพื่อให้ระบบทำงานเร็วและปลอดภัย', icon: 'image-off' }); }
        openCropper(file);
      };
      const oldToggleProfileEdit = window.toggleProfileEdit;
      window.toggleProfileEdit = function (show) { oldToggleProfileEdit?.(show); if (show) { const pv = $('pd-edit-avatar-preview'), main = $('prof-avatar-img'); if (pv && main) pv.src = main.src; $('edit-avatar-file') && ($('edit-avatar-file').value = '') } };

      /* Inject richer editor preview into existing form */
      function upgradeProfileEditor() {
        const form = $('profile-edit-section'); if (!form || form.dataset.v7) return; form.dataset.v7 = '1';
        const old = form.querySelector('.p-5.ui-card'); if (!old) return;
        const title = old.querySelector('h4');
        old.className = 'pd-profile-editor';
        old.innerHTML = `<div class="pd-avatar-stage"><img id="pd-edit-avatar-preview" class="pd-avatar-preview" src="${safe(currentUser?.avatar_url || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80')}" alt="ตัวอย่างรูปโปรไฟล์" loading="lazy" decoding="async"><label class="pd-avatar-upload-btn"><i data-lucide="image-plus" class="w-4 h-4"></i> เลือกรูปใหม่<input type="file" id="edit-avatar-file" accept="image/png,image/jpeg,image/webp" class="hidden"></label><div class="pd-avatar-hint">PNG / JPG / WEBP<br>ไม่เกิน 2 MB • ครอปก่อนบันทึก</div></div><div class="pd-form-stack"><div class="pd-field-card"><label>รูปโปรไฟล์</label><input type="url" id="edit-avatar-url" placeholder="หรือวาง URL HTTPS ของรูปภาพ" autocomplete="url" class="w-full ui-input rounded-2xl text-sm"><p class="text-[10px] sub-text mt-2">ถ้าอัปโหลดรูปจากเครื่อง ระบบจะเปิด Profile Studio ให้ตัดขอบก่อน</p></div><div class="pd-field-card"><label>ชื่อ-นามสกุล</label><input type="text" id="edit-fullname" required maxlength="80" autocomplete="name" class="w-full ui-input rounded-2xl text-sm font-bold"></div><div class="pd-field-card"><div class="flex items-center gap-2"><i data-lucide="sparkles" class="w-4 h-4 text-blue-500"></i><span class="text-xs font-black titanium-text">Live Preview</span></div><p class="text-xs sub-text mt-1">รูปและชื่อจะถูกอัปเดตใน Account Center หลังบันทึก</p></div></div>`;
        $('edit-avatar-file').addEventListener('change', window.previewEditAvatarFile); if (window.lucide) lucide.createIcons();
      }
      const profileObserver = new MutationObserver(() => { if ($('profile-edit-section')) upgradeProfileEditor() }); profileObserver.observe(document.body, { childList: true, subtree: true }); setTimeout(upgradeProfileEditor, 300);

      /* ---------- admin order detail / file viewer ---------- */
      function statusLabel(s) { return s === 'completed' ? 'พิมพ์เสร็จแล้ว' : s === 'printing' ? 'กำลังพิมพ์' : s === 'cancelled' ? 'ยกเลิก' : 'รอคิว' }
      window.openAdminFileViewer = async function (filePath, fileBucket, fileName, fileMime) {
        if (!filePath) return showCustomModal({ title: 'ยังไม่มีไฟล์', message: 'ออเดอร์นี้ไม่มีไฟล์ที่เก็บใน Storage', icon: 'file-warning' });
        if (!supabaseClient) return showCustomModal({ title: 'ฐานข้อมูลยังไม่พร้อม', message: 'ไม่สามารถสร้างลิงก์ไฟล์ชั่วคราวได้', icon: 'database-zap' });
        try {
          const bucket = fileBucket || window.PRINT_STORAGE_BUCKET || 'print-files'; const { data, error } = await supabaseClient.storage.from(bucket).createSignedUrl(filePath, 900); if (error || !data?.signedUrl) throw error || new Error('สร้างลิงก์ไฟล์ชั่วคราวไม่สำเร็จ');
          let m = $('pd-file-viewer-modal'); if (!m) { m = document.createElement('div'); m.id = 'pd-file-viewer-modal'; m.className = 'fixed inset-0 z-[10000] hidden items-center justify-center p-4 bg-black/80 backdrop-blur-2xl'; m.innerHTML = '<div class="ui-panel w-full max-w-6xl rounded-[30px] p-4 sm:p-5 animate-modal" onclick="event.stopPropagation()"><div class="flex items-center justify-between gap-3 pb-3"><div class="min-w-0"><span class="pd-eyebrow">SECURE FILE PREVIEW</span><h3 id="pd-file-viewer-title" class="text-lg sm:text-xl font-black titanium-text truncate mt-1">ไฟล์เอกสาร</h3></div><button id="pd-file-viewer-close" class="nav-icon-btn ui-card"><i data-lucide="x"></i></button></div><div id="pd-file-viewer-body" class="pd-admin-file-preview"></div><div class="flex justify-end gap-2 pt-3"><a id="pd-file-viewer-open" target="_blank" rel="noopener noreferrer" class="min-h-[46px] px-4 rounded-2xl bg-blue-600 text-white font-black text-xs flex items-center gap-2"><i data-lucide="external-link" class="w-4 h-4"></i> เปิดเต็มหน้าต่าง</a></div></div>'; document.body.appendChild(m); $('pd-file-viewer-close').onclick = () => m.classList.add('hidden'); m.onclick = () => m.classList.add('hidden'); if (window.lucide) lucide.createIcons() }
          $('pd-file-viewer-title').textContent = fileName || 'ไฟล์เอกสาร'; $('pd-file-viewer-open').href = data.signedUrl; const body = $('pd-file-viewer-body'); body.innerHTML = ''; const mime = (fileMime || '').toLowerCase(); if (mime.startsWith('image/')) { const img = document.createElement('img'); img.src = data.signedUrl; img.alt = fileName || 'document'; body.appendChild(img) } else { const iframe = document.createElement('iframe'); iframe.src = data.signedUrl; iframe.title = fileName || 'document'; body.appendChild(iframe) } m.classList.remove('hidden'); m.classList.add('flex');
        } catch (err) { showCustomModal({ title: 'เปิดไฟล์ไม่สำเร็จ', message: err.message || 'ตรวจสอบ Storage Policy ของ Supabase', icon: 'file-warning' }) }
      };

      const oldOpenStored = window.openStoredPrintFile;
      window.openStoredPrintFile = async function (filePath) {
        try {
          const order = (window.__pdAdminOrders || []).find(o => o.file_path === filePath); const bucket = order?.file_bucket || window.PRINT_STORAGE_BUCKET || 'print-files';
          return openAdminFileViewer(filePath, bucket, order?.file_name || 'ไฟล์เอกสาร', order?.file_mime || '');
        } catch (e) { return oldOpenStored?.(filePath) }
      };

      const oldOpenQueue = window.openQueueDetailModal;
      window.openQueueDetailModal = async function (orderId) {
        let order = (window.__pdAdminOrders || []).find(o => o.id === orderId) || (typeof currentOrdersList !== 'undefined' ? currentOrdersList.find(o => o.id === orderId) : null);
        if (!order && currentUser?.role === 'admin' && supabaseClient) { try { const { data, error } = await supabaseClient.from('orders').select('*').eq('id', orderId).maybeSingle(); if (error) throw error; order = data } catch (err) { return showCustomModal({ title: 'โหลดรายละเอียดไม่สำเร็จ', message: err.message || 'ไม่สามารถดึงข้อมูลออเดอร์', icon: 'database-zap' }) } }
        if (!order) return oldOpenQueue?.(orderId);
        try {
          const set = (id, val) => { const e = $(id); if (e) e.innerText = val ?? '-' }; set('qd-modal-order-id', `Queue ID: #${order.id}`); set('qd-modal-filename', order.file_name || 'เอกสารพิมพ์'); set('qd-modal-pages', `${order.page_count || 1} หน้า`); set('qd-modal-copies', `${order.copies || 1} ชุด`); set('qd-modal-paper', order.paper_size || 'A4'); set('qd-modal-color', order.is_color ? 'พิมพ์สี' : 'ขาว-ดำ'); set('qd-modal-duplex', order.is_duplex ? 'พิมพ์หน้า-หลัง' : 'หน้าเดียว'); set('qd-modal-notes', order.admin_note || 'ไม่มีหมายเหตุเพิ่มเติม'); set('qd-modal-totalprice', `${Number(order.total_price || 0).toFixed(2)} ฿`); set('qd-modal-paymethod', order.payment_method === 'coins' ? 'Coins' : 'PromptPay Direct'); set('qd-modal-pickup-info', order.delivery_method === 'delivery' ? '🚚 การรับสินค้า: จัดส่งพัสดุถึงบ้าน' : '📍 การรับสินค้า: รับหน้าร้านโดยตรง');
          const sb = $('qd-modal-status-badge'); if (sb) { sb.textContent = statusLabel(order.status); sb.className = 'px-3 py-1 rounded-full text-xs font-black ' + (order.status === 'completed' ? 'bg-emerald-500/15 text-emerald-500' : order.status === 'printing' ? 'bg-blue-500/15 text-blue-500' : order.status === 'cancelled' ? 'bg-rose-500/15 text-rose-500' : 'bg-amber-500/15 text-amber-500') }
          const tr = $('qd-modal-tracking-box'); if (order.delivery_method === 'delivery') { set('qd-modal-tracking-num', order.tracking_number ? `เลข Tracking: ${order.tracking_number} (${order.courier_name || 'Kerry Express'})` : 'กำลังเตรียมจัดส่ง'); set('qd-modal-recipient-info', `ผู้รับ: ${order.recipient_name || '-'} (${order.recipient_phone || '-'}) | ที่อยู่: ${order.recipient_address || '-'}`); tr?.classList.remove('hidden') } else tr?.classList.add('hidden');
          const slip = $('qd-modal-slip-box'); if (order.slip_url) { $('qd-modal-slip-img').src = order.slip_url; slip?.classList.remove('hidden') } else slip?.classList.add('hidden');
          let body = $('queue-detail-modal')?.querySelector('.flex-1.overflow-y-auto'); if (body && currentUser?.role === 'admin') { let panel = $('pd-admin-detail-extra'); if (!panel) { panel = document.createElement('div'); panel.id = 'pd-admin-detail-extra'; panel.className = 'space-y-3'; body.appendChild(panel) } panel.innerHTML = `<div class="pd-admin-detail-grid"><div class="pd-admin-detail-item"><small>เจ้าของงาน</small><strong>${safe(order.user_name || '-')}</strong></div><div class="pd-admin-detail-item"><small>User ID</small><strong>${safe(order.user_id || '-')}</strong></div><div class="pd-admin-detail-item"><small>สร้างเมื่อ</small><strong>${order.created_at ? new Date(order.created_at).toLocaleString('th-TH') : '-'}</strong></div><div class="pd-admin-detail-item"><small>ไฟล์</small><strong>${safe(order.file_name || '-')} • ${order.file_size ? ((Number(order.file_size) / 1048576).toFixed(2) + ' MB') : '-'}</strong></div><div class="pd-admin-detail-item"><small>Bucket</small><strong>${safe(order.file_bucket || '-')}</strong></div><div class="pd-admin-detail-item"><small>หมายเหตุแอดมิน</small><strong>${safe(order.admin_note || '-')}</strong></div></div><div class="pd-admin-actions">${order.file_path ? `<button type="button" class="bg-blue-600 text-white" data-pd-detail-action="open-file" data-file-path="${safe(order.file_path)}" data-file-bucket="${safe(order.file_bucket || 'print-files')}" data-file-name="${safe(order.file_name || 'เอกสาร')}" data-file-mime="${safe(order.file_mime || '')}"><i data-lucide="file-eye" class="w-4 h-4 inline"></i> ดูไฟล์เอกสาร</button>` : ''}${order.slip_url ? `<button type="button" class="ui-card" data-pd-detail-action="slip" data-slip-url="${safe(order.slip_url)}"><i data-lucide="receipt" class="w-4 h-4 inline"></i> ดูสลิป</button>` : ''}<button type="button" class="ui-card" data-pd-detail-action="close">ปิดรายละเอียด</button></div>`; if (window.lucide) lucide.createIcons() }
          $('queue-detail-modal')?.classList.remove('hidden');
        } catch (err) { console.error(err); showCustomModal({ title: 'แสดงรายละเอียดไม่สำเร็จ', message: err.message || 'ข้อมูลบางส่วนไม่พร้อม', icon: 'alert-circle' }) }
      };

      /* Patch admin loader: keep full order objects and use richer file buttons. */
      const oldAdminLoader = window.loadAdminData;
      if (oldAdminLoader && !oldAdminLoader.__v7) { window.loadAdminData = async function () { const r = await oldAdminLoader.apply(this, arguments); try { const { data } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false }); window.__pdAdminOrders = data || []; document.querySelectorAll('#admin-orders-tbody tr').forEach(tr => { const id = (tr.querySelector('td')?.innerText || '').replace(/^#/, '').trim(); const o = window.__pdAdminOrders.find(x => x.id === id); if (o) { const action = tr.querySelector('td:last-child'); if (action && !action.querySelector('[data-v7-file]') && o.file_path) { const b = document.createElement('button'); b.type = 'button'; b.dataset.v7File = '1'; b.className = 'px-3 py-2 bg-blue-600 text-white rounded-xl text-[11px] font-black ml-1'; b.innerHTML = 'ดูไฟล์'; b.onclick = () => openAdminFileViewer(o.file_path, o.file_bucket, o.file_name, o.file_mime); action.prepend(b) } } }) } catch (e) { console.warn('v7 admin enrichment', e) } return r }; window.loadAdminData.__v7 = true }

      /* Patch role update to detect silent RLS failures. */
      window.changeUserRole = async function (userId, newRole) {
        if (typeof assertAdminAccess === 'function' && !assertAdminAccess()) return;
        if (!['member', 'admin'].includes(newRole)) return showCustomModal({ title: 'สิทธิ์ไม่ถูกต้อง', message: 'ระบบหยุดการเปลี่ยนสิทธิ์เพื่อความปลอดภัย', icon: 'shield-alert' });
        if (currentUser?.id === userId) return showCustomModal({ title: 'ป้องกันการเปลี่ยนสิทธิ์ตัวเอง', message: 'กรุณาใช้บัญชีผู้ดูแลอื่นเมื่อจำเป็นต้องเปลี่ยนสิทธิ์ของบัญชีนี้', icon: 'shield-alert' });
        try { const { data, error } = await supabaseClient.from('users').update({ role: newRole }).eq('id', userId).select('id,role').maybeSingle(); if (error) throw error; if (!data || data.role !== newRole) throw new Error('Supabase ไม่อนุญาตให้แก้ไขสิทธิ์รายการนี้ (ตรวจสอบ RLS Policy ของตาราง users)'); showCustomModal({ title: 'สลับสิทธิ์สำเร็จ', message: `บัญชีนี้ถูกเปลี่ยนเป็น ${newRole.toUpperCase()} แล้ว`, icon: 'shield-check' }); await loadAdminData() } catch (err) { showCustomModal({ title: 'เปลี่ยนสิทธิ์ไม่สำเร็จ', message: err.message || 'ไม่สามารถอัปเดตสิทธิ์ได้', icon: 'shield-alert' }) }
      };

      /* ---------- local system AI assistant ---------- */
      function addAiMsg(text, who = 'bot') { const box = $('pd-ai-messages'); if (!box) return; const d = document.createElement('div'); d.className = 'pd-ai-msg ' + who; d.textContent = text; box.appendChild(d); box.scrollTop = box.scrollHeight }
      function aiAnswer(q) {
        const x = (q || '').toLowerCase(); const u = window.currentUser || currentUser; const orders = window.__pdAdminOrders || [];
        if (/เหรียญ|coins|ยอด/.test(x)) return `ตอนนี้บัญชีของคุณมียอด Coins ${Number(u?.coins || 0).toFixed(2)} Coins\nสามารถไปที่ Wallet เพื่อเติม Coins ได้ทันที`;
        if (/อัปโหลด|upload|ไฟล์/.test(x)) return 'ไปที่ “สั่งพิมพ์” แล้วอัปโหลด PDF, DOC, DOCX, JPG, JPEG หรือ PNG ได้สูงสุด 20 MB\nถ้าไฟล์ไม่รองรับ ระบบจะแจ้งเตือนทันที และสามารถกด “ลบไฟล์” เพื่อเลือกไฟล์ใหม่ได้';
        if (/คิว|สถานะ|งานพิมพ์/.test(x)) return u ? `ระบบจะแสดงคิวล่าสุดในหน้า “สั่งพิมพ์”\n${u.role === 'admin' && orders.length ? `แอดมินมีรายการที่โหลดไว้ ${orders.length} รายการ` : 'เปิดรายการคิวเพื่อดูสถานะและรายละเอียดได้เลย'}` : 'กรุณาเข้าสู่ระบบก่อนดูคิวงานพิมพ์';
        if (/แอดมิน|admin|สมาชิก|สิทธิ์/.test(x)) return u?.role === 'admin' ? 'คุณกำลังใช้งานสิทธิ์ Admin สามารถดูรายละเอียดคิว เปิดไฟล์ ตรวจสลิป อัปเดตสถานะ และจัดการสิทธิ์สมาชิกได้' : 'บัญชี Member จะไม่เห็นพื้นที่ Admin';
        if (/โปรไฟล์|รูป|avatar/.test(x)) return 'เปิด Account Center → โปรไฟล์ → แก้ไขโปรไฟล์\nเลือกรูป PNG/JPG/WEBP ไม่เกิน 2 MB แล้ว Profile Studio จะให้ลาก/ซูม/ครอปก่อนบันทึก';
        if (/promptpay|สลิป|เติมเงิน/.test(x)) return 'Wallet รองรับการเลือกแพ็กเกจ Coins และแนบสลิปเพื่อรอแอดมินตรวจสอบ\nแอดมินสามารถเปิดสลิปจากหน้า Admin ได้';
        if (/ราคา|คิดราคา|คำนวณ/.test(x)) return 'ระบบคำนวณจากจำนวนหน้า × อัตราพิมพ์ × จำนวนชุด และเพิ่มค่าจัดส่ง 30 บาทเมื่อเลือกจัดส่ง โดยจะแสดงยอดรวมแบบเรียลไทม์';
        return 'ผมเป็นผู้ช่วยคู่มือภายใน PrintDekD Pro โดยรุ่นนี้ใช้คำสำคัญและคำตอบที่เตรียมไว้ ยังไม่ได้เชื่อมต่อ Generative AI เพื่อสร้างคำตอบอิสระ\n\nลองถามว่า “Coins เหลือเท่าไร”, “อัปโหลดไฟล์อะไรได้บ้าง”, “ดูคิวอย่างไร” หรือ “Admin ทำอะไรได้บ้าง”';
      }
      window.togglePDAssistant = function () { const p = $('pd-ai-panel'); p?.classList.toggle('is-open'); if (p?.classList.contains('is-open')) $('pd-ai-input')?.focus() };
      function installAI() { if ($('pd-ai-launcher')) return; const l = document.createElement('button'); l.id = 'pd-ai-launcher'; l.type = 'button'; l.setAttribute('aria-label', 'เปิด AI ผู้ช่วย'); l.innerHTML = '<span class="pd-ai-pulse"></span><i data-lucide="sparkles" class="w-7 h-7"></i>'; l.onclick = togglePDAssistant; document.body.appendChild(l); const p = document.createElement('div'); p.id = 'pd-ai-panel'; p.innerHTML = '<div class="pd-ai-head"><div class="pd-ai-brand"><div class="pd-ai-icon"><i data-lucide="sparkles"></i></div><div><div class="pd-ai-title">PrintDekD AI</div><div class="pd-ai-sub">ผู้ช่วยคู่มือและคำถามที่พบบ่อย</div></div></div><button class="pd-ai-close" type="button" onclick="togglePDAssistant()"><i data-lucide="x"></i></button></div><div id="pd-ai-messages" class="pd-ai-messages"></div><div class="pd-ai-suggestions"><button>Coins เหลือเท่าไร?</button><button>อัปโหลดไฟล์อะไรได้บ้าง?</button><button>ดูคิวอย่างไร?</button><button>Admin ทำอะไรได้บ้าง?</button></div><form id="pd-ai-form" class="pd-ai-form"><input id="pd-ai-input" autocomplete="off" placeholder="ถามอะไรเกี่ยวกับระบบก็ได้…"><button type="submit"><i data-lucide="arrow-up"></i></button></form>'; document.body.appendChild(p); p.querySelectorAll('.pd-ai-suggestions button').forEach(b => b.onclick = () => { addAiMsg(b.textContent, 'user'); setTimeout(() => addAiMsg(aiAnswer(b.textContent)), 220) }); $('pd-ai-form').onsubmit = e => { e.preventDefault(); const v = $('pd-ai-input').value.trim(); if (!v) return; $('pd-ai-input').value = ''; addAiMsg(v, 'user'); setTimeout(() => addAiMsg(aiAnswer(v)), 240) }; if (window.lucide) lucide.createIcons(); addAiMsg('สวัสดีครับ 👋 ผมช่วยตอบเรื่อง Coins, การอัปโหลด, คิวงาน, โปรไฟล์ และฟังก์ชัน Admin ได้ ลองถามได้เลย'); }

      /* ---------- scroll / cinematic motion ---------- */
      function installMotion() {
        // Use the browser's intersection scheduler for image entrances; no scroll event timer/blur wash.
        const imgs = [...document.querySelectorAll('#view-landing img, #view-dashboard img, #view-wallet img, #view-admin img')];
        if (!('IntersectionObserver' in window)) { imgs.forEach(img => img.classList.add('pd-slide-image')); return; }
        const io = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            entry.target.classList.add('pd-slide-image');
            io.unobserve(entry.target);
          });
        }, { threshold: .08, rootMargin: '100px 0px' });
        imgs.forEach(img => io.observe(img));
      }
      installAI(); installMotion();
    })();
  
