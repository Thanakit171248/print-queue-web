
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

      /* ---------- PrintDekD Help Chooser (curated answers, no free-text AI claim) ---------- */
      const PD_HELP_TOPICS = [
        {
          id: 'print', icon: 'printer', title: 'สั่งพิมพ์เอกสาร', subtitle: 'เริ่มงานพิมพ์ทีละขั้นตอน',
          answer: '1. เข้าสู่ระบบก่อนสั่งพิมพ์\n2. เปิดหน้า “สั่งพิมพ์ / คิวงาน” และเลือกไฟล์\n3. ตรวจตัวอย่างเอกสาร จำนวนหน้า กระดาษ สี จำนวนชุด และวิธีรับ\n4. ตรวจยอดรวมก่อนยืนยันรายการ',
          actionLabel: 'ไปหน้าสั่งพิมพ์', action: 'print'
        },
        {
          id: 'files', icon: 'file-check-2', title: 'ไฟล์ที่รองรับ', subtitle: 'ชนิดไฟล์และขนาดอัปโหลด',
          answer: 'รองรับ PDF, DOC, DOCX, JPG, JPEG และ PNG ขนาดไม่เกิน 20 MB ต่อไฟล์\n\nหากต้องเลือกช่วงหน้า หรือต้องการให้รูปแบบเอกสารคงที่ แนะนำให้แปลงเป็น PDF และตรวจตัวอย่างก่อนส่งงาน',
          actionLabel: 'ไปหน้าอัปโหลดไฟล์', action: 'print'
        },
        {
          id: 'queue', icon: 'clipboard-list', title: 'ติดตามคิวงาน', subtitle: 'ดูสถานะและรายละเอียดคำสั่งพิมพ์',
          answer: 'เข้าสู่ระบบแล้วเปิดหน้า “สั่งพิมพ์ / คิวงาน” เพื่อดูรายการของคุณ เลือกคิวที่ต้องการเพื่อตรวจสอบสถานะ รายละเอียดงาน และวิธีรับเอกสารได้',
          actionLabel: 'ดูคิวงานของฉัน', action: 'queue'
        },
        {
          id: 'coins', icon: 'wallet-cards', title: 'Coins และการเติมเงิน', subtitle: 'ดูยอดคงเหลือและรายการเติม',
          answer: 'เปิด Coins Wallet เพื่อดูยอด Coins และเลือกแพ็กเกจเติมเงินตามตัวเลือกในหน้า Wallet หากต้องแนบสลิป ให้ตรวจยอดและรายละเอียดก่อนส่ง จากนั้นรอผลตรวจสอบตามสถานะที่แสดงในระบบ',
          actionLabel: 'เปิด Coins Wallet', action: 'wallet'
        },
        {
          id: 'payment', icon: 'receipt-text', title: 'การชำระเงินและสลิป', subtitle: 'ตรวจสอบรายการและสถานะการชำระ',
          answer: 'ตรวจยอดที่ต้องชำระและข้อมูลรายการให้ถูกต้องก่อนยืนยัน หากส่งสลิปเติม Coins แล้ว สถานะอาจต้องรอผู้ดูแลตรวจสอบ อย่าส่งข้อมูลธนาคารหรือรหัสผ่านให้บุคคลอื่น',
          actionLabel: 'ตรวจสอบ Wallet', action: 'wallet'
        },
        {
          id: 'delivery', icon: 'truck', title: 'รับที่ร้านหรือจัดส่ง', subtitle: 'เตรียมข้อมูลสำหรับรับเอกสาร',
          answer: 'เลือกวิธีรับเอกสารในขั้นตอนสั่งพิมพ์\n• รับที่ร้าน: ตรวจสอบสถานะคิวก่อนเดินทางไปรับ\n• จัดส่ง: ตรวจชื่อผู้รับ เบอร์โทรศัพท์ และที่อยู่ให้ครบถ้วนก่อนยืนยัน แล้วตรวจสถานะ/Tracking ในรายละเอียดคิวเมื่อมีการบันทึกข้อมูล',
          actionLabel: 'ดูคิวและวิธีรับงาน', action: 'queue'
        },
        {
          id: 'account', icon: 'user-round', title: 'บัญชีและโปรไฟล์', subtitle: 'เข้าสู่ระบบหรือแก้ไขข้อมูลบัญชี',
          answer: 'เข้าสู่ระบบด้วยอีเมลที่ลงทะเบียนไว้ จากเมนูบัญชีจึงเปิด Account Center เพื่อดูหรือแก้ไขข้อมูลโปรไฟล์ได้ อย่าส่งรหัสผ่านหรือรหัสยืนยันให้ผู้อื่น',
          actionLabel: 'เปิดบัญชีของฉัน', action: 'account'
        },
        {
          id: 'guide', icon: 'book-open-text', title: 'คู่มือและคำถามอื่น ๆ', subtitle: 'เปิดหัวข้อช่วยเหลือทั้งหมด',
          answer: 'ในศูนย์ช่วยเหลือมีคู่มือสั่งพิมพ์ พรีวิวเอกสาร Coins การติดตามคิว บัญชี และความปลอดภัย เลือกหมวดหมู่หรือคำถามที่พบบ่อยบนหน้านี้เพื่อดูคำแนะนำเพิ่มเติม',
          actionLabel: 'เปิดศูนย์ช่วยเหลือ', action: 'guide'
        }
      ];

      window.togglePDAssistant = function () {
        const panel = $('pd-ai-panel');
        if (!panel) return;
        const isOpen = panel.classList.toggle('is-open');
        panel.setAttribute('aria-hidden', isOpen ? 'false' : 'true');
        $('pd-ai-launcher')?.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
        if (isOpen) setTimeout(() => panel.querySelector('.pd-ai-close')?.focus(), 0);
        else $('pd-ai-launcher')?.focus();
      };

      function routeHelpChoice(action) {
        const user = window.currentUser || (typeof currentUser !== 'undefined' ? currentUser : null);
        const needsLogin = ['print', 'queue', 'wallet', 'account'].includes(action);
        if (needsLogin && !user) {
          window.togglePDAssistant?.();
          window.switchView?.('auth');
          window.switchAuthTab?.('login');
          return;
        }
        if (action === 'print') {
          window.togglePDAssistant?.();
          if (typeof window.handleStartPrinting === 'function') window.handleStartPrinting();
          else window.switchView?.('dashboard');
        } else if (action === 'queue') {
          window.togglePDAssistant?.();
          window.switchView?.('dashboard');
        } else if (action === 'wallet') {
          window.togglePDAssistant?.();
          window.switchView?.('wallet');
        } else if (action === 'account') {
          window.togglePDAssistant?.();
          if (typeof window.openUserProfileModal === 'function') window.openUserProfileModal();
          else { window.switchView?.('auth'); window.switchAuthTab?.('login'); }
        } else if (action === 'guide') {
          window.togglePDAssistant?.();
          window.switchView?.('help');
          setTimeout(() => document.querySelector('#view-help .pd-help-content-grid')?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }), 100);
        }
      }

      function showHelpTopic(id) {
        const topic = PD_HELP_TOPICS.find(item => item.id === id);
        const answer = $('pd-help-choice-answer');
        if (!topic || !answer) return;
        document.querySelectorAll('[data-pd-help-topic]').forEach(button => {
          const selected = button.dataset.pdHelpTopic === id;
          button.classList.toggle('is-selected', selected);
          button.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        answer.replaceChildren();
        const heading = document.createElement('h3');
        heading.className = 'pd-help-answer-title';
        heading.textContent = topic.title;
        const body = document.createElement('p');
        body.className = 'pd-help-answer-copy';
        body.textContent = topic.answer;
        answer.append(heading, body);
        if (topic.actionLabel && topic.action) {
          const actionButton = document.createElement('button');
          actionButton.type = 'button';
          actionButton.className = 'pd-help-answer-action';
          actionButton.innerHTML = `<span>${safe(topic.actionLabel)}</span><i data-lucide="arrow-up-right" aria-hidden="true"></i>`;
          actionButton.addEventListener('click', () => routeHelpChoice(topic.action));
          answer.appendChild(actionButton);
        }
        if (window.lucide) window.lucide.createIcons({ root: answer });
      }

      function installHelpChooser() {
        if ($('pd-ai-launcher') || $('pd-ai-panel')) return;
        const launcher = document.createElement('button');
        launcher.id = 'pd-ai-launcher';
        launcher.type = 'button';
        launcher.setAttribute('aria-label', 'เปิดศูนย์ช่วยเหลือ PrintDekD');
        launcher.setAttribute('aria-controls', 'pd-ai-panel');
        launcher.setAttribute('aria-expanded', 'false');
        launcher.innerHTML = '<i data-lucide="life-buoy" class="w-7 h-7" aria-hidden="true"></i>';
        launcher.addEventListener('click', window.togglePDAssistant);
        document.body.appendChild(launcher);

        const panel = document.createElement('section');
        panel.id = 'pd-ai-panel';
        panel.setAttribute('aria-label', 'ศูนย์ช่วยเหลือ PrintDekD');
        panel.setAttribute('aria-hidden', 'true');
        panel.innerHTML = `
          <header class="pd-ai-head">
            <div class="pd-ai-brand">
              <div class="pd-ai-icon"><i data-lucide="life-buoy" aria-hidden="true"></i></div>
              <div class="pd-help-assistant-heading"><div class="pd-ai-title">ศูนย์ช่วยเหลือ PrintDekD</div><div class="pd-ai-sub">เลือกหัวข้อที่ต้องการ · ไม่ต้องพิมพ์คำถาม</div></div>
            </div>
            <button class="pd-ai-close" type="button" aria-label="ปิดศูนย์ช่วยเหลือ"><i data-lucide="x" aria-hidden="true"></i></button>
          </header>
          <div class="pd-help-choice-body">
            <div class="pd-help-choice-intro"><span class="pd-help-choice-eyebrow">QUICK HELP</span><h2>วันนี้ให้เราช่วยเรื่องอะไร?</h2><p>เลือกหัวข้อเพื่อดูคำแนะนำและไปยังหน้าที่เกี่ยวข้องได้ทันที</p></div>
            <div class="pd-help-choice-grid" aria-label="หัวข้อช่วยเหลือ">
              ${PD_HELP_TOPICS.map(topic => `<button type="button" class="pd-help-choice-card" data-pd-help-topic="${topic.id}" aria-pressed="false"><span class="pd-help-choice-icon" aria-hidden="true"><i data-lucide="${topic.icon}"></i></span><span class="pd-help-choice-text"><strong>${safe(topic.title)}</strong><small>${safe(topic.subtitle)}</small></span><i class="pd-help-choice-arrow" data-lucide="chevron-right" aria-hidden="true"></i></button>`).join('')}
            </div>
            <section id="pd-help-choice-answer" class="pd-help-choice-answer" aria-live="polite" aria-atomic="true"><div class="pd-help-answer-empty"><span class="pd-help-answer-empty-icon"><i data-lucide="mouse-pointer-click" aria-hidden="true"></i></span><strong>เลือกหัวข้อด้านบนได้เลย</strong><p>เราจะแสดงคำแนะนำที่ตรงกับเรื่องที่คุณเลือก พร้อมปุ่มลัดไปยังหน้าที่เกี่ยวข้อง</p></div></section>
            <p class="pd-help-choice-disclaimer"><i data-lucide="info" aria-hidden="true"></i> ใช้คำแนะนำที่เตรียมไว้ล่วงหน้า ไม่ใช่แชต AI หรือเจ้าหน้าที่สด</p>
          </div>`;
        document.body.appendChild(panel);
        panel.querySelector('.pd-ai-close')?.addEventListener('click', window.togglePDAssistant);
        panel.querySelectorAll('[data-pd-help-topic]').forEach(button => button.addEventListener('click', () => showHelpTopic(button.dataset.pdHelpTopic)));
        document.addEventListener('keydown', event => {
          if (event.key === 'Escape' && panel.classList.contains('is-open')) window.togglePDAssistant();
        });
        if (window.lucide) window.lucide.createIcons();
      }

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
      installHelpChooser(); installMotion();
    })();
  
