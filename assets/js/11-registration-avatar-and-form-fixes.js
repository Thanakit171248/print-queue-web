
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const safeText = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
      const notify = (title, message, icon = 'info') => window.showCustomModal?.({ title, message, icon });

      /* ---------- 1. Replace the cropper with one stable square implementation ---------- */
      let cropV10Target = 'profile';
      let cropV10 = { file: null, img: null, nw: 0, nh: 0, baseScale: 1, zoom: 1, x: 0, y: 0, drag: false, pid: null, lx: 0, ly: 0 };

      function closeCropV10(options = {}) {
        const m = $('pd-v10-crop-modal');
        if (m) { m.classList.remove('is-open'); m.setAttribute('aria-hidden', 'true'); m.removeAttribute('data-crop-target'); }
        if (options && options.discard && cropV10Target === 'register') {
          window.pdRegistrationAvatarDataUrl = '';
          const input = $('reg-avatar-file'); if (input) input.value = '';
          const preview = $('reg-avatar-preview');
          if (preview) preview.src = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80';
          const status = $('reg-avatar-crop-status');
          if (status) status.textContent = 'เลือกรูปเพื่อจัดกรอบก่อนสมัคร (ไม่บังคับ)';
        }
        cropV10 = { file: null, img: null, nw: 0, nh: 0, baseScale: 1, zoom: 1, x: 0, y: 0, drag: false, pid: null, lx: 0, ly: 0 };
        cropV10Target = 'profile';
      }
      function cropFrame() { return $('pd-v10-crop-frame')?.getBoundingClientRect() || null }
      function cropStage() { return $('pd-v10-crop-stage')?.getBoundingClientRect() || null }
      function cropRender() {
        const img = cropV10.img; if (!img) return;
        const st = cropStage(), f = cropFrame(); if (!st || !f) return;
        const w = cropV10.nw * cropV10.baseScale * cropV10.zoom;
        const h = cropV10.nh * cropV10.baseScale * cropV10.zoom;
        const maxX = Math.max(0, (w - f.width) / 2), maxY = Math.max(0, (h - f.height) / 2);
        cropV10.x = Math.max(-maxX, Math.min(maxX, cropV10.x));
        cropV10.y = Math.max(-maxY, Math.min(maxY, cropV10.y));
        img.style.transform = `translate3d(calc(-50% + ${cropV10.x}px),calc(-50% + ${cropV10.y}px),0) scale(${cropV10.zoom * cropV10.baseScale})`;
      }
      function cropFit() {
        if (!cropV10.img || !cropV10.nw) return;
        const f = cropFrame(); if (!f) return;
        cropV10.baseScale = Math.max(f.width / cropV10.nw, f.height / cropV10.nh);
        cropV10.zoom = 1; cropV10.x = 0; cropV10.y = 0;
        const z = $('pd-v10-crop-zoom'); if (z) z.value = '1';
        cropRender();
      }
      function ensureCropV10() {
        if ($('pd-v10-crop-modal')) return;
        const m = document.createElement('div');
        m.id = 'pd-v10-crop-modal'; m.setAttribute('aria-hidden', 'true');
        m.innerHTML = `
      <div class="pd-v10-crop-shell" role="dialog" aria-modal="true" aria-label="ครอปรูปโปรไฟล์">
        <div class="flex items-start justify-between gap-3">
          <div><span class="pd-eyebrow">PROFILE STUDIO</span><h3 id="pd-v10-crop-title" class="text-xl font-black text-white mt-1">ครอปรูปโปรไฟล์</h3><p id="pd-v10-crop-description" class="text-xs text-white/55 mt-1">ครอปเป็นสี่เหลี่ยมจัตุรัส 1:1 • ลากเพื่อจัดตำแหน่ง</p></div>
          <button type="button" class="pd-v10-crop-close nav-icon-btn ui-card" aria-label="ปิด"><i data-lucide="x"></i></button>
        </div>
        <div id="pd-v10-crop-stage" class="pd-v10-crop-stage">
          <img id="pd-v10-crop-image" class="pd-v10-crop-image" alt="ตัวอย่างรูปโปรไฟล์" loading="lazy" decoding="async">
          <span id="pd-v10-crop-frame" class="pd-v10-crop-frame"></span>
        </div>
        <div class="pd-v10-crop-hint">ใช้เมาส์/นิ้วลากรูป • ปรับซูมด้านล่าง • พื้นที่ในกรอบคือส่วนที่จะบันทึก</div>
        <div class="mt-3"><input id="pd-v10-crop-zoom" class="pd-v10-crop-range" type="range" min="1" max="3.5" step=".01" value="1" aria-label="ซูมรูป"></div>
        <div class="pd-v10-crop-actions">
          <button type="button" class="ui-card" id="pd-v10-crop-reset">รีเซ็ต</button>
          <button type="button" class="ui-card" id="pd-v10-crop-cancel">ยกเลิก</button>
          <button type="button" class="bg-blue-600 text-white primary" id="pd-v10-crop-apply">ใช้รูปนี้</button>
        </div>
      </div>`;
        document.body.appendChild(m);
        m.addEventListener('click', e => { if (e.target === m) closeCropV10({ discard: true }); });
        m.querySelector('.pd-v10-crop-close').onclick = () => closeCropV10({ discard: true });
        $('pd-v10-crop-cancel').onclick = () => closeCropV10({ discard: true });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && $('pd-v10-crop-modal')?.classList.contains('is-open')) closeCropV10({ discard: true }); });
        $('pd-v10-crop-reset').onclick = () => { cropV10.zoom = 1; cropV10.x = 0; cropV10.y = 0; $('pd-v10-crop-zoom').value = '1'; cropRender() };
        $('pd-v10-crop-zoom').oninput = e => { cropV10.zoom = Math.max(1, Number(e.target.value) || 1); cropRender() };
        $('pd-v10-crop-apply').onclick = applyCropV10;
        const stage = $('pd-v10-crop-stage');
        stage.addEventListener('pointerdown', e => {
          if (e.button !== undefined && e.button !== 0) return;
          cropV10.drag = true; cropV10.pid = e.pointerId; cropV10.lx = e.clientX; cropV10.ly = e.clientY;
          stage.setPointerCapture?.(e.pointerId); e.preventDefault();
        }, { passive: false });
        stage.addEventListener('pointermove', e => {
          if (!cropV10.drag || e.pointerId !== cropV10.pid) return;
          cropV10.x += e.clientX - cropV10.lx; cropV10.y += e.clientY - cropV10.ly; cropV10.lx = e.clientX; cropV10.ly = e.clientY; cropRender(); e.preventDefault();
        }, { passive: false });
        const end = () => { cropV10.drag = false };
        stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
        if (window.lucide) window.lucide.createIcons();
      }
      function applyCropV10() {
        if (!cropV10.img) return;
        const f = cropFrame(); if (!f) return;
        const targetType = cropV10Target;
        const scale = cropV10.baseScale * cropV10.zoom;
        const sourceSize = f.width / scale;
        const cx = cropV10.nw / 2 - (cropV10.x / scale);
        const cy = cropV10.nh / 2 - (cropV10.y / scale);
        const sx = Math.max(0, Math.min(cropV10.nw - sourceSize, cx - sourceSize / 2));
        const sy = Math.max(0, Math.min(cropV10.nh - sourceSize, cy - sourceSize / 2));
        const canvas = document.createElement('canvas'); canvas.width = 384; canvas.height = 384;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return notify('ครอปไม่สำเร็จ', 'เบราว์เซอร์ไม่สามารถสร้างภาพตัวอย่างได้', 'image-off');
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(cropV10.img, sx, sy, sourceSize, sourceSize, 0, 0, 384, 384);
        let out;
        try { out = canvas.toDataURL('image/webp', .84); }
        catch (_) { return notify('บันทึกรูปไม่สำเร็จ', 'เบราว์เซอร์นี้ไม่สามารถแปลงรูปเป็น WEBP ได้ กรุณาลองใช้ Chrome เวอร์ชันปัจจุบัน', 'image-off'); }

        if (targetType === 'register') {
          window.pdRegistrationAvatarDataUrl = out;
          const preview = $('reg-avatar-preview'); if (preview) preview.src = out;
          const status = $('reg-avatar-crop-status');
          if (status) status.textContent = '✓ ครอปรูปแล้ว • พร้อมใช้ในการสมัครสมาชิก';
          closeCropV10();
          notify('ครอปรูปเรียบร้อย', 'รูปโปรไฟล์ถูกครอปเป็นสี่เหลี่ยม 1:1 แล้ว พร้อมใช้ตอนสมัครสมาชิก', 'check-circle-2');
          return;
        }
        const url = $('edit-avatar-url'); if (url) url.value = out;
        const pv = $('pd-edit-avatar-preview'); if (pv) pv.src = out;
        window.tempAvatarUrl = out; closeCropV10();
        notify('ครอปรูปเรียบร้อย', 'รูปถูกจัดเป็นสี่เหลี่ยม 1:1 และพร้อมบันทึกแล้ว', 'check-circle');
      }
      function openCropV10(file, target = 'profile') {
        if (!file) return;
        cropV10Target = target === 'register' ? 'register' : 'profile';
        if (cropV10Target === 'register') {
          window.pdRegistrationAvatarDataUrl = '';
          const preview = $('reg-avatar-preview');
          if (preview) preview.src = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=120&q=80';
          const status = $('reg-avatar-crop-status');
          if (status) status.textContent = 'กำลังเปิดตัวช่วยครอปรูป…';
        }
        const inputId = cropV10Target === 'register' ? 'reg-avatar-file' : 'edit-avatar-file';
        if (!/^image\/(png|jpe?g|webp)$/i.test(file.type || '')) {
          const input = $(inputId); if (input) input.value = '';
          if (cropV10Target === 'register') {
            window.pdRegistrationAvatarDataUrl = '';
            const status = $('reg-avatar-crop-status'); if (status) status.textContent = 'เลือกรูปเพื่อจัดกรอบก่อนสมัคร (ไม่บังคับ)';
          }
          return notify('รูปแบบไฟล์ไม่รองรับ', 'รองรับ PNG, JPG/JPEG และ WEBP เท่านั้น', 'image-off');
        }
        if (file.size > 2 * 1024 * 1024) {
          const input = $(inputId); if (input) input.value = '';
          if (cropV10Target === 'register') {
            window.pdRegistrationAvatarDataUrl = '';
            const status = $('reg-avatar-crop-status'); if (status) status.textContent = 'เลือกรูปเพื่อจัดกรอบก่อนสมัคร (ไม่บังคับ)';
          }
          return notify('รูปภาพใหญ่เกินไป', 'ขนาดสูงสุด 2 MB', 'image-off');
        }
        ensureCropV10();
        const modal = $('pd-v10-crop-modal');
        if (modal) modal.dataset.cropTarget = cropV10Target;
        const title = $('pd-v10-crop-title');
        const description = $('pd-v10-crop-description');
        if (title) title.textContent = cropV10Target === 'register' ? 'ครอปรูปก่อนสมัครสมาชิก' : 'ครอปรูปโปรไฟล์';
        if (description) description.textContent = cropV10Target === 'register'
          ? 'จัดรูปให้เหมือนกันทั้งตอนสมัครและแก้ไขโปรไฟล์ • ลากเพื่อจัดตำแหน่ง'
          : 'ครอปเป็นสี่เหลี่ยมจัตุรัส 1:1 • ลากเพื่อจัดตำแหน่ง';
        const reader = new FileReader();
        reader.onload = e => {
          const src = e.target.result, img = new Image();
          img.onload = () => {
            cropV10.file = file; cropV10.nw = img.naturalWidth; cropV10.nh = img.naturalHeight;
            const targetImg = $('pd-v10-crop-image'); cropV10.img = targetImg; targetImg.src = src;
            modal.classList.add('is-open'); modal.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => { requestAnimationFrame(cropFit) });
          };
          img.onerror = () => {
            const input = $(inputId); if (input) input.value = '';
            if (cropV10Target === 'register') {
              window.pdRegistrationAvatarDataUrl = '';
              const status = $('reg-avatar-crop-status'); if (status) status.textContent = 'เปิดรูปไม่สำเร็จ • กรุณาเลือกรูปอื่น';
            }
            notify('เปิดรูปไม่สำเร็จ', 'ไม่สามารถอ่านรูปนี้ได้ กรุณาเลือกไฟล์อื่น', 'image-off');
          };
          img.src = src;
        };
        reader.onerror = () => {
          const input = $(inputId); if (input) input.value = '';
          if (cropV10Target === 'register') {
            window.pdRegistrationAvatarDataUrl = '';
            const status = $('reg-avatar-crop-status'); if (status) status.textContent = 'อ่านรูปไม่สำเร็จ • กรุณาเลือกรูปอื่น';
          }
          notify('อ่านรูปไม่สำเร็จ', 'เบราว์เซอร์ไม่สามารถอ่านไฟล์นี้ได้', 'image-off');
        };
        reader.readAsDataURL(file);
      }
      function installAvatarInput() {
        const old = $('edit-avatar-file');
        if (!old || old.dataset.v10Installed === '1') return;
        const clone = old.cloneNode(true);
        clone.dataset.v10Installed = '1'; clone.dataset.v8bound = '1'; clone.dataset.pd9 = '1';
        clone.onchange = e => { const f = e.target.files?.[0]; if (f) openCropV10(f) };
        old.replaceWith(clone);
      }
      window.previewEditAvatarFile = eventOrFile => {
        const file = eventOrFile?.target?.files?.[0] || eventOrFile;
        if (file instanceof File) openCropV10(file, 'profile');
      };
      window.previewRegAvatarFile = function (event) {
        const file = event?.target?.files?.[0] || null;
        if (file) { openCropV10(file, 'register'); return; }
        window.pdRegistrationAvatarDataUrl = '';
        const status = $('reg-avatar-crop-status'); if (status) status.textContent = 'เลือกรูปเพื่อจัดกรอบก่อนสมัคร (ไม่บังคับ)';
      };
      window.openSquareCropV10 = openCropV10;
      installAvatarInput();
      const avatarObserver = new MutationObserver(() => installAvatarInput());
      avatarObserver.observe(document.body, { childList: true, subtree: true });
      setTimeout(installAvatarInput, 500);

      /* ---------- 2. Make the page selector a visual 1:1-style document grid ---------- */
      const oldRenderPages = window.renderPdfThumbnails;
      window.renderPdfThumbnails = function (pdf) {
        const grid = $('pages-grid-container'), drawer = $('pdf-preview-wrapper');
        if (!grid) return;
        grid.className = 'pd-v10-page-picker ui-input';
        grid.innerHTML = '';
        if (drawer) drawer.innerHTML = '';
        for (let i = 1; i <= pdf.numPages; i++) {
          const card = document.createElement('label');
          card.className = 'pd-v10-page-card is-selected';
          card.dataset.page = String(i);
          card.innerHTML = `<input type="checkbox" checked value="${i}" class="sr-only"><span class="pd-page-check">✓</span><span class="pd-page-number">หน้า ${i}</span>`;
          const cb = card.querySelector('input');
          cb.addEventListener('change', () => { card.classList.toggle('is-selected', cb.checked); window.updateGridSelectedCount?.() });
          card.addEventListener('click', e => { if (e.target === cb) return; e.preventDefault(); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true })) });
          grid.appendChild(card);
          pdf.getPage(i).then(page => {
            const viewport = page.getViewport({ scale: .65 });
            const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d', { alpha: false });
            canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height); canvas.setAttribute('aria-label', `ตัวอย่างหน้า ${i}`);
            card.insertBefore(canvas, card.querySelector('.pd-page-number'));
            page.render({ canvasContext: ctx, viewport }).promise.catch(() => { });
          }).catch(() => { });
        }
        const count = pdf.numPages;
        const selected = $('selected-pages-count-display'); if (selected) selected.textContent = `${count} หน้า`;
        const printed = $('printed-pages-input'); if (printed) printed.value = count;
        window.calculatePrice?.();
      };
      /* Keep existing global helpers but make them update the new visual state. */
      window.updateGridSelectedCount = function () {
        const checked = [...document.querySelectorAll('#pages-grid-container input[type="checkbox"]')].filter(x => x.checked);
        document.querySelectorAll('#pages-grid-container .pd-v10-page-card').forEach(c => c.classList.toggle('is-selected', !!c.querySelector('input')?.checked));
        const n = checked.length;
        if ($('selected-pages-count-display')) $('selected-pages-count-display').textContent = `${n} หน้า`;
        if ($('printed-pages-input')) $('printed-pages-input').value = n || 1;
        window.calculatePrice?.();
      };
      window.selectAllPages = function (selectAll) {
        document.querySelectorAll('#pages-grid-container input[type="checkbox"]').forEach(cb => cb.checked = !!selectAll);
        window.updateGridSelectedCount();
      };

      /* ---------- 3. Stable order detail ---------- */
      function getAdminOrder(orderId) {
        const a = window.__pdAdminOrders || [];
        return a.find(o => String(o.id) === String(orderId))
          || (typeof currentOrdersList !== 'undefined' ? currentOrdersList.find(o => String(o.id) === String(orderId)) : null);
      }
      window.openQueueDetailModal = async function (orderId) {
        let order = getAdminOrder(orderId);
        if (!order && (typeof supabaseClient !== 'undefined' ? supabaseClient : null)) {
          try {
            const { data, error } = await (typeof supabaseClient !== 'undefined' ? supabaseClient : null).from('orders').select('*').eq('id', orderId).maybeSingle();
            if (error) throw error; order = data;
          } catch (err) { return notify('เปิดข้อมูลไม่สำเร็จ', err?.message || 'ไม่สามารถโหลดออเดอร์นี้ได้', 'database-zap') }
        }
        if (!order) return notify('ไม่พบข้อมูล', 'ไม่พบรายละเอียดของรายการสั่งพิมพ์นี้', 'search-x');
        const set = (id, v) => { const e = $(id); if (e) e.textContent = v ?? '-' };
        set('qd-modal-order-id', `Queue ID: #${order.id}`);
        set('qd-modal-filename', order.file_name || 'เอกสารพิมพ์');
        set('qd-modal-pages', `${order.page_count || 1} หน้า`);
        set('qd-modal-copies', `${order.copies || 1} ชุด`);
        set('qd-modal-paper', order.paper_size || 'A4');
        set('qd-modal-color', order.is_color ? 'พิมพ์สี' : 'ขาว-ดำ');
        set('qd-modal-duplex', order.is_duplex ? 'พิมพ์หน้า-หลัง' : 'หน้าเดียว');
        set('qd-modal-notes', order.admin_note || 'ไม่มีหมายเหตุเพิ่มเติม');
        set('qd-modal-totalprice', `${Number(order.total_price || 0).toFixed(2)} ฿`);
        set('qd-modal-paymethod', order.payment_method === 'coins' ? 'Coins' : 'PromptPay Direct');
        const delivery = order.delivery_method === 'delivery';
        set('qd-modal-pickup-info', delivery ? '🚚 การรับสินค้า: จัดส่งพัสดุถึงบ้าน' : '📍 การรับสินค้า: รับหน้าร้านโดยตรง');
        const track = $('qd-modal-tracking-box');
        if (delivery) {
          set('qd-modal-tracking-num', order.tracking_number ? `เลข Tracking: ${order.tracking_number} (${order.courier_name || 'Kerry Express'})` : 'กำลังเตรียมจัดส่ง');
          set('qd-modal-recipient-info', `ผู้รับ: ${order.recipient_name || '-'} (${order.recipient_phone || '-'}) | ที่อยู่: ${order.recipient_address || '-'}`);
          track?.classList.remove('hidden');
        } else track?.classList.add('hidden');
        const slip = $('qd-modal-slip-box');
        if (order.slip_url) { const im = $('qd-modal-slip-img'); if (im) im.src = order.slip_url; slip?.classList.remove('hidden') } else slip?.classList.add('hidden');
        const badge = $('qd-modal-status-badge');
        if (badge) {
          const map = { pending: ['รอคิว', 'bg-amber-500/15 text-amber-400'], printing: ['กำลังพิมพ์', 'bg-blue-500/15 text-blue-400'], completed: ['พิมพ์เสร็จแล้ว', 'bg-emerald-500/15 text-emerald-400'], cancelled: ['ยกเลิก', 'bg-rose-500/15 text-rose-400'] };
          const [txt, cls] = map[order.status] || map.pending; badge.textContent = txt; badge.className = `px-3 py-1 rounded-full text-xs font-black ${cls}`;
        }
        const body = $('queue-detail-modal')?.querySelector('.flex-1.overflow-y-auto');
        if (body && window.currentUser?.role === 'admin') {
          let panel = $('pd-admin-detail-extra'); if (!panel) { panel = document.createElement('div'); panel.id = 'pd-admin-detail-extra'; panel.className = 'space-y-3'; body.appendChild(panel) }
          panel.innerHTML = `<div class="pd-admin-detail-grid"><div class="pd-admin-detail-item"><small>เจ้าของงาน</small><strong>${safeText(order.user_name || '-')}</strong></div><div class="pd-admin-detail-item"><small>สร้างเมื่อ</small><strong>${order.created_at ? new Date(order.created_at).toLocaleString('th-TH') : '-'}</strong></div><div class="pd-admin-detail-item"><small>ไฟล์</small><strong>${safeText(order.file_name || '-')} • ${order.file_size ? ((Number(order.file_size) / 1048576).toFixed(2) + ' MB') : '-'}</strong></div><div class="pd-admin-detail-item"><small>Bucket</small><strong>${safeText(order.file_bucket || '-')}</strong></div></div><div class="pd-admin-actions">${order.file_path ? `<button type="button" class="bg-blue-600 text-white" data-pd-detail-action="open-file" data-file-path="${safeText(order.file_path)}" data-file-bucket="${safeText(order.file_bucket || 'documents')}" data-file-name="${safeText(order.file_name || 'เอกสาร')}" data-file-mime="${safeText(order.file_mime || '')}">ดูไฟล์เอกสาร</button>` : ''}${order.slip_url ? `<button type="button" class="ui-card" data-pd-detail-action="slip" data-slip-url="${safeText(order.slip_url)}">ดูสลิป</button>` : ''}</div>`;
        }
        const modal = $('queue-detail-modal'); if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden' }
        if (window.lucide) window.lucide.createIcons();
      };
      window.closeQueueDetailModal = function () { const m = $('queue-detail-modal'); if (m) { m.classList.add('hidden'); m.setAttribute('aria-hidden', 'true') } document.body.style.overflow = '' };

      /* ---------- 4. Admin role switching with visible progress + exact errors ---------- */
      window.changeUserRole = async function (userId, newRole) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        if (!['member', 'admin'].includes(newRole)) return notify('สิทธิ์ไม่ถูกต้อง', 'ระบบไม่อนุญาตสิทธิ์นี้', 'shield-alert');
        if (window.currentUser?.id === userId) return notify('เปลี่ยนสิทธิ์ไม่ได้', 'ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีที่กำลังใช้งานอยู่ได้', 'shield-alert');
        const buttons = [...document.querySelectorAll('#admin-users-tbody button')];
        const btn = buttons.find(b => b.getAttribute('onclick')?.includes(String(userId)));
        if (btn) { btn.classList.add('pd-v10-admin-busy'); btn.textContent = 'กำลังบันทึก…'; }
        try {
          if (!(typeof supabaseClient !== 'undefined' ? supabaseClient : null)) throw new Error('Supabase ยังไม่เชื่อมต่อ');
          const { data, error } = await (typeof supabaseClient !== 'undefined' ? supabaseClient : null).from('users').update({ role: newRole }).eq('id', userId).select('id,role').maybeSingle();
          if (error) throw error;
          if (!data || data.role !== newRole) throw new Error('Supabase ไม่คืนข้อมูลการเปลี่ยนสิทธิ์ — ตรวจสอบ RLS Policy ของตาราง users ว่า Admin ที่ใช้ระบบนี้มีสิทธิ์ UPDATE role');
          notify('สลับสิทธิ์สำเร็จ', `เปลี่ยนบัญชีนี้เป็น ${newRole.toUpperCase()} แล้ว`, 'shield-check');
          await window.loadAdminData?.();
        } catch (err) {
          const raw = err?.message || String(err);
          const hint = /row-level security|permission denied|not authorized|JWT|policy/i.test(raw)
            ? `${raw}\n\nสาเหตุคือ Policy/RLS ของ Supabase ยังไม่อนุญาตให้บัญชีที่ใช้งาน UPDATE ช่อง role ในตาราง users`
            : raw;
          notify('เปลี่ยนสิทธิ์ไม่สำเร็จ', hint, 'shield-alert');
          if (btn) { btn.classList.remove('pd-v10-admin-busy'); }
          await window.loadAdminData?.();
        }
      };

      /* ---------- 5. Storage diagnostics + robust print upload ---------- */
      window.setPrintStorageBucket = function (bucket) {
        const b = String(bucket || '').trim(); if (!/^[a-z0-9][a-z0-9._-]{1,62}$/i.test(b)) return notify('ชื่อ Bucket ไม่ถูกต้อง', 'ใช้ชื่อ Bucket เช่น documents หรือ print-files', 'alert-triangle');
        localStorage.setItem('sp_print_bucket', b); location.reload();
      };
      async function uploadPrintFileV10(file, orderId) {
        if (!(typeof supabaseClient !== 'undefined' ? supabaseClient : null)) throw new Error('Supabase ยังไม่เชื่อมต่อ');
        const primary = localStorage.getItem('sp_print_bucket') || 'documents';
        const candidates = [primary, ...(primary === 'documents' ? ['print-files'] : primary === 'print-files' ? ['documents'] : [])];
        const errors = [];
        const safeName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'document';
        for (const bucket of candidates) {
          const path = `${window.currentUser?.id || 'user'}/${orderId}-${Date.now()}-${safeName}`;
          try {
            const { error } = await (typeof supabaseClient !== 'undefined' ? supabaseClient : null).storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600' });
            if (!error) {
              window.PRINT_STORAGE_BUCKET = bucket;
              return { path, bucket, size: file.size, mime_type: file.type || 'application/octet-stream' };
            }
            errors.push(`${bucket}: ${error.message || 'upload failed'}`);
            if (!/bucket.*not found|not found/i.test(error.message || '')) break;
          } catch (e) { errors.push(`${bucket}: ${e.message || e}`) }
        }
        throw new Error(`อัปโหลดไม่สำเร็จ\n${errors.join('\n')}\n\nตรวจสอบ Storage > Buckets และ Storage Policies สำหรับการ INSERT ใน bucket ที่เลือก`);
      }

      /* ---------- 6. Security copy: simple, calm, readable ---------- */
      const securityCard = document.querySelector('.pd-story-security') || document.querySelector('.pd-story-glass');
      if (securityCard) {
        const h = securityCard.querySelector('h3'); const p = securityCard.querySelector('p');
        if (h) h.style.removeProperty('color');
        if (p) p.style.removeProperty('color');
      }

      /* Reinstall after dynamic profile editor creation. */
      window.addEventListener('load', () => { installAvatarInput(); if (window.lucide) window.lucide.createIcons() });
      setTimeout(() => { installAvatarInput(); if (window.lucide) window.lucide.createIcons() }, 800);
    })();
  
