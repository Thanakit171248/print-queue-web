
    (() => {
      'use strict';
      const q = s => document.querySelector(s), qa = s => [...document.querySelectorAll(s)];
      const notify = (title, message, icon = 'info') => {
        if (typeof window.pdToast === 'function') return window.pdToast(title, message, icon);
        if (typeof window.showCustomModal === 'function') return window.showCustomModal({ title, message, icon });
        console.warn(title, message);
      };
      const safe = s => String(s ?? '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

      /* ---------------------------------------------------------------
         A. Rebuild the hamburger menu from the index1_2 interaction model.
         The same view ids are retained, so the existing application logic
         continues to work. No inline JSON is placed in generated buttons.
         --------------------------------------------------------------- */
      function rebuildV11Menu() {
        const menu = q('#apple-tab-menu'); if (!menu) return;
        menu.innerHTML = `
   <div class="absolute inset-0" data-v11-menu-backdrop></div>
   <div class="apple-menu-sheet relative z-10" data-v11-menu-sheet>
     <header class="apple-menu-head">
       <div class="apple-menu-brand">
         <div class="apple-menu-brandmark"><i data-lucide="command" class="w-5 h-5"></i></div>
         <div>
           <div class="text-xl font-black tracking-tight text-white">PrintDekD Pro</div>
           <div class="text-[10px] text-blue-300 font-extrabold uppercase tracking-[0.16em]">KMUTNB ITI Platform</div>
         </div>
       </div>
       <button type="button" class="apple-menu-close" data-v11-menu-close aria-label="ปิดเมนู"><i data-lucide="x" class="w-5 h-5"></i></button>
     </header>
     <nav class="apple-menu-nav" aria-label="เมนูหลัก">
       <button type="button" class="apple-menu-item" data-view="landing" data-menu-link="landing" style="--accent:#3b82f6">
         <span class="menu-icon"><i data-lucide="house" class="w-5 h-5"></i></span><span><span class="menu-kicker">01 · HOME</span><span class="menu-title block">หน้าแรก</span></span><span class="menu-state">กำลังใช้งาน</span>
       </button>
       <button type="button" class="apple-menu-item" data-view="dashboard" data-menu-link="dashboard" style="--accent:#0a84ff">
         <span class="menu-icon"><i data-lucide="file-up" class="w-5 h-5"></i></span><span><span class="menu-kicker">02 · PRINT</span><span class="menu-title block">สั่งพิมพ์ & คิวงาน</span></span><span class="menu-state">เปิดอยู่</span>
       </button>
       <button type="button" class="apple-menu-item" data-view="wallet" data-menu-link="wallet" style="--accent:#f5a400">
         <span class="menu-icon"><i data-lucide="wallet-cards" class="w-5 h-5"></i></span><span><span class="menu-kicker">03 · WALLET</span><span class="menu-title block">Coins Wallet</span></span><span class="menu-state">เปิดอยู่</span>
       </button>
       <button type="button" id="apple-admin-menu-btn" class="hidden apple-menu-item" data-view="admin" data-menu-link="admin" style="--accent:#a855f7">
         <span class="menu-icon"><i data-lucide="shield-check" class="w-5 h-5"></i></span><span><span class="menu-kicker">04 · ADMIN</span><span class="menu-title block">Admin Backoffice</span></span><span class="menu-state">ผู้ดูแล</span>
       </button>
     </nav>
     <footer class="apple-menu-foot"><span class="flex items-center gap-2 text-emerald-300 font-bold"><span class="w-2.5 h-2.5 rounded-full bg-emerald-400 pulse-dot"></span>ระบบเครื่องพิมพ์ ITI Online</span><span>© 2026 PrintDekD Pro</span></footer>
   </div>`;
        menu.addEventListener('click', e => {
          const close = e.target.closest('[data-v11-menu-close]');
          const back = e.target.closest('[data-v11-menu-backdrop]');
          const item = e.target.closest('[data-menu-link]');
          if (close || back) { window.toggleAppleTabMenu?.(false); return; }
          if (item) { const view = item.dataset.view; if (view === 'admin' && window.currentUser?.role !== 'admin') { notify('จำกัดสิทธิ์', 'บัญชีนี้ยังไม่มีสิทธิ์ผู้ดูแล', 'shield-alert'); return; } window.switchView?.(view); window.toggleAppleTabMenu?.(false); }
        });
        if (window.lucide) window.lucide.createIcons();
      }
      rebuildV11Menu();

      /* ---------------------------------------------------------------
         B. Security strip copy: short, calm, high contrast.
         --------------------------------------------------------------- */
      function calmSecurityCopy() {
        const t = q('#security-title'), c = q('#security-copy');
        if (!t || !c) return;
        const ok = !!window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
        t.textContent = ok ? 'ปลอดภัย โดยไม่รบกวน' : 'การเชื่อมต่อยังไม่ปลอดภัย';
        c.textContent = ok ? 'ระบบตรวจสอบเฉพาะเมื่อจำเป็น • เปิดรายละเอียดได้จากการตั้งค่าระบบ' : 'ควรเปิดเว็บผ่าน HTTPS ก่อนใช้งานจริง';
      }
      calmSecurityCopy(); setTimeout(calmSecurityCopy, 1200);

      /* ---------------------------------------------------------------
         C. Safe admin rendering. Dynamic values are data attributes, not
         executable inline JavaScript. This removes a common source of
         "Unexpected end of input" when names/IDs contain quotes.
         --------------------------------------------------------------- */
      function bindAdminSafeActions() {
        const users = q('#admin-users-tbody');
        if (users && !users.dataset.v11Bound) {
          users.dataset.v11Bound = '1';
          users.addEventListener('click', e => {
            const b = e.target.closest('[data-pd-role-target]'); if (!b) return;
            const id = b.dataset.pdRoleTarget, role = b.dataset.pdRole;
            window.changeUserRole?.(id, role);
          });
        }
        const orders = q('#admin-orders-tbody');
        if (orders && !orders.dataset.v11Bound) {
          orders.dataset.v11Bound = '1';
          orders.addEventListener('click', e => {
            const b = e.target.closest('[data-pd-order-detail]'); if (!b) return;
            window.openQueueDetailModal?.(b.dataset.pdOrderDetail);
          });
        }
      }
      function decorateAdminRows() {
        bindAdminSafeActions();
        const users = q('#admin-users-tbody');
        if (users) {
          qa('#admin-users-tbody tr').forEach(tr => {
            const cells = tr.querySelectorAll('td'); if (cells.length < 4) return;
            const old = cells[3].querySelector('button');
            if (!old) return;
            const role = (cells[2].textContent || '').trim().toLowerCase();
            const id = (old.getAttribute('onclick') || '').match(/changeUserRole\((?:"|')?([^,"')]+)/)?.[1] || old.dataset.pdRoleTarget;
            if (!id) return;
            const target = role === 'admin' ? 'member' : 'admin';
            const b = document.createElement('button'); b.type = 'button'; b.className = 'px-3 py-2 ui-card hover:border-purple-500 rounded-xl text-[11px] font-bold'; b.dataset.pdRoleTarget = id; b.dataset.pdRole = target; b.textContent = `สลับสิทธิ์เป็น ${target === 'admin' ? 'Admin' : 'Member'}`;
            old.replaceWith(b);
          });
        }
        const orders = q('#admin-orders-tbody');
        if (orders) {
          qa('#admin-orders-tbody tr').forEach(tr => {
            const old = [...tr.querySelectorAll('button')].find(b => (b.textContent || '').includes('ดูข้อมูล'));
            if (!old) return;
            const id = (old.getAttribute('onclick') || '').match(/openQueueDetailModal\((?:"|')?([^\)"']+)/)?.[1];
            if (!id) return;
            const b = old.cloneNode(true); b.removeAttribute('onclick'); b.dataset.pdOrderDetail = id; b.textContent = 'ดูข้อมูล'; old.replaceWith(b);
          });
        }
      }

      /* ---------------------------------------------------------------
         D. Role switching: explicit progress, select() confirmation and
         exact RLS diagnosis. The UI never claims success without a row.
         --------------------------------------------------------------- */
      window.changeUserRole = async function (userId, newRole) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        if (!['member', 'admin'].includes(newRole)) return notify('สิทธิ์ไม่ถูกต้อง', 'ระบบไม่อนุญาตสิทธิ์นี้', 'shield-alert');
        if (window.currentUser?.id === userId) return notify('เปลี่ยนสิทธิ์ไม่ได้', 'ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีที่กำลังใช้งานอยู่ได้', 'shield-alert');
        const btn = qa('#admin-users-tbody [data-pd-role-target]').find(x => String(x.dataset.pdRoleTarget) === String(userId));
        if (btn) { btn.classList.add('pd-v11-busy'); btn.disabled = true; btn.dataset.oldText = btn.textContent; btn.textContent = 'กำลังบันทึก…'; }
        try {
          if (!window.supabaseClient) throw new Error('Supabase ยังไม่เชื่อมต่อ');
          const r = await window.supabaseClient.from('users').update({ role: newRole }).eq('id', userId).select('id,role').maybeSingle();
          if (r.error) throw r.error;
          if (!r.data) throw new Error('UPDATE ไม่คืนแถวข้อมูล — ตรวจสอบ RLS Policy ของ public.users ว่าบัญชีผู้ดูแลที่ใช้งานมีสิทธิ์ UPDATE และ SELECT');
          if (r.data.role !== newRole) throw new Error('ฐานข้อมูลไม่ยืนยัน role ใหม่');
          notify('สลับสิทธิ์สำเร็จ', `เปลี่ยนเป็น ${newRole.toUpperCase()} แล้ว`, 'shield-check');
          btn?.classList.add('pd-v11-result-good');
          await window.loadAdminData?.(); setTimeout(decorateAdminRows, 120);
        } catch (err) {
          const raw = err?.message || String(err);
          let msg = raw;
          if (/row-level security|permission denied|not authorized|policy/i.test(raw)) msg = `${raw}\n\nสาเหตุ: Supabase RLS/Policy ของ users ยังไม่อนุญาต UPDATE role จาก client นี้`;
          if (/JWT|auth\.uid/i.test(raw)) msg = `${raw}\n\nระบบปัจจุบันใช้ session users แบบกำหนดเอง ไม่ใช่ Supabase Auth จึงไม่สามารถใช้ auth.uid() เป็นตัวพิสูจน์ Admin ได้อย่างปลอดภัย`;
          notify('เปลี่ยนสิทธิ์ไม่สำเร็จ', msg, 'shield-alert');
          btn?.classList.add('pd-v11-result-bad');
        } finally {
          if (btn) { btn.disabled = false; btn.classList.remove('pd-v11-busy'); btn.textContent = btn.dataset.oldText || 'สลับสิทธิ์'; }
        }
      };

      /* ---------------------------------------------------------------
         E. Storage upload: documents is the real bucket from the supplied
         Supabase screen. It is tried first. print-files remains fallback.
         --------------------------------------------------------------- */
      window.pdV11UploadPrintFile = async function (file, orderId) {
        if (!window.supabaseClient) throw new Error('Supabase ยังไม่เชื่อมต่อ');
        const preferred = localStorage.getItem('sp_print_bucket') || 'documents';
        const buckets = [...new Set([preferred, 'documents', 'print-files'])];
        const safeName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'document';
        const errors = [];
        for (const bucket of buckets) {
          const path = `${window.currentUser?.id || 'user'}/${orderId}-${Date.now()}-${safeName}`;
          try {
            const r = await window.supabaseClient.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600' });
            if (!r.error) { localStorage.setItem('sp_print_bucket', bucket); window.PRINT_STORAGE_BUCKET = bucket; return { path, bucket, size: file.size, mime_type: file.type || 'application/octet-stream' }; }
            errors.push(`${bucket}: ${r.error.message || 'upload failed'}`);
            if (!/bucket.*not found|not found/i.test(r.error.message || '')) break;
          } catch (e) { errors.push(`${bucket}: ${e.message || e}`) }
        }
        throw new Error(`อัปโหลดไฟล์ไม่สำเร็จ\n${errors.join('\n')}\n\nBucket documents มีอยู่ในโปรเจกต์ของคุณแล้ว หากยังอัปโหลดไม่ได้ให้ตรวจ Storage Policy สำหรับ INSERT`);
      };

      /* ---------------------------------------------------------------
         F. Order creation compatibility. The visible error in the supplied
         console is specifically the missing orders.copies column. We stop
         before upload and show the exact migration instead of wasting a file.
         --------------------------------------------------------------- */
      async function probeOrdersCopies() {
        if (!window.supabaseClient) return { ok: false, error: 'Supabase ยังไม่เชื่อมต่อ' };
        const r = await window.supabaseClient.from('orders').select('copies').limit(1);
        if (r.error) return { ok: false, error: r.error.message };
        return { ok: true };
      }
      window.pdV11EnsureOrderSchema = async function () {
        const r = await probeOrdersCopies();
        if (r.ok) return true;
        if (/copies.*column|column.*copies|schema cache/i.test(r.error || '')) {
          notify('ฐานข้อมูลยังขาดคอลัมน์ copies', 'กรุณารัน SQL Migration ที่แนบมากับ v11 แล้วรีเฟรชหน้าเว็บ', 'database-zap');
          return false;
        }
        return true;
      };

      /* Replace the original submit handler with a single controlled path. */
      window.handleOrderSubmit = async function (e) {
        e?.preventDefault();
        const u = window.currentUser;
        if (!u) return notify('กรุณาล็อกอิน', 'กรุณาล็อกอินก่อนทำการสั่งพิมพ์', 'lock');
        if (!window.supabaseClient) return notify('ฐานข้อมูลยังไม่พร้อม', 'กรุณาเชื่อมต่อ Supabase ก่อนสั่งงาน', 'database-zap');
        if (!(await window.pdV11EnsureOrderSchema())) return;
        const val = id => q('#' + id)?.value?.trim?.() ?? q('#' + id)?.value ?? '';
        const pages = Math.max(1, parseInt(val('printed-pages-input')) || 1);
        const copies = Math.max(1, parseInt(val('copies')) || 1);
        const paper = val('paper-size') || 'A4';
        const isColor = val('color-type') === 'color';
        const isDuplex = val('duplex-type') === 'duplex';
        const notes = val('order-notes');
        const payMethod = q('input[name="payment_method"]:checked')?.value;
        const deliveryMethod = q('input[name="delivery_method"]:checked')?.value;
        if (!payMethod || !deliveryMethod) return notify('ตรวจสอบตัวเลือก', 'กรุณาเลือกการชำระเงินและการรับสินค้า', 'alert-triangle');
        const file = window.selectedFileObj;
        if (!file) return notify('ยังไม่ได้เลือกไฟล์', 'กรุณาอัปโหลดเอกสารก่อนสร้างรายการ', 'file-plus-2');
        if (typeof window.validateUploadFile === 'function') { const chk = window.validateUploadFile(file, { maxMB: window.MAX_PRINT_FILE_MB || 20, extensions: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'] }); if (!chk.ok) return notify('ไฟล์ไม่ผ่านการตรวจสอบ', chk.message, 'file-warning'); }
        let rn = '', rp = '', ra = '';
        if (deliveryMethod === 'delivery') {
          rn = val('recipient-name'); rp = val('recipient-phone'); ra = val('recipient-address');
          if (!rn || !/^0[0-9\-\s]{8,14}$/.test(rp) || !ra) return notify('ข้อมูลจัดส่งไม่ครบ', 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่ให้ครบ', 'map-pin-x');
        }
        const rate = (isColor ? 5 : 1) + (isDuplex ? .5 : 0), delivery = deliveryMethod === 'delivery' ? 30 : 0, total = pages * rate * copies + delivery;
        if (payMethod === 'coins') {
          try { await window.fetchUserWallet?.() } catch (_) { return notify('ตรวจสอบ Coins ไม่สำเร็จ', 'ระบบยังยืนยันยอดล่าสุดไม่ได้ จึงยังไม่หักเงิน', 'shield-alert'); }
          const balance = Number(window.currentUser?.coins || 0); if (balance < total) return notify('Coins ไม่พอ', `มี ${balance.toFixed(2)} Coins แต่ต้องใช้ ${total.toFixed(2)} Coins`, 'coins');
        }
        let slipUrl = '';
        if (payMethod === 'promptpay') {
          const f = q('#order-slip-file')?.files?.[0];
          if (!f) return notify('ยังไม่มีสลิป', 'กรุณาแนบสลิปก่อนสร้างรายการ', 'image-plus');
          slipUrl = await new Promise((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(r.result); r.onerror = reject; r.readAsDataURL(f) });
        }
        const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
        let uploaded = null, created = false;
        try {
          uploaded = await window.pdV11UploadPrintFile(file, orderId);
          const obj = { id: orderId, user_id: u.id, user_name: u.full_name || '', file_name: file.name, file_path: uploaded.path, file_bucket: uploaded.bucket, file_size: file.size, file_mime: file.type || 'application/octet-stream', page_count: pages, copies, paper_size: paper, is_color: isColor, is_duplex: isDuplex, delivery_method: deliveryMethod, recipient_name: rn, recipient_phone: rp, recipient_address: ra, delivery_fee: delivery, total_price: total, payment_method: payMethod, slip_url: slipUrl, admin_note: notes, status: 'pending', created_at: new Date().toISOString() };
          const ins = await window.supabaseClient.from('orders').insert([obj]).select('id,copies,file_path,file_bucket,total_price').maybeSingle();
          if (ins.error) throw ins.error;
          if (!ins.data) throw new Error('Supabase ไม่คืนรายการที่สร้าง — ตรวจสอบ INSERT/SELECT Policy ของ orders');
          created = true;
          if (payMethod === 'coins') {
            const before = Number(u.coins || 0), after = Number((before - total).toFixed(2));
            try { const w = await window.compareAndSwapWalletBalance?.(u.id, before, after); u.coins = Number(w?.balance ?? after) } catch (err) { await window.supabaseClient.from('orders').delete().eq('id', orderId).eq('user_id', u.id); throw new Error(`หัก Coins ไม่สำเร็จ: ${err.message || err}`) }
          }
          localStorage.setItem('sp_user', JSON.stringify(u)); window.currentUser = u;
          notify('สร้างรายการสำเร็จ', `#${orderId} • ${pages} หน้า × ${copies} ชุด • ${total.toFixed(2)} Coins`, 'check-circle-2');
          q('#print-form')?.reset(); window.selectedFileObj = null; q('#upload-placeholder')?.classList.remove('hidden'); q('#file-details')?.classList.add('hidden'); q('#preview-file-drawer-btn')?.classList.add('hidden'); window.fetchQueues?.(); window.fetchUserWallet?.();
        } catch (err) {
          if (uploaded && !created) {
            try { await window.supabaseClient.storage.from(uploaded.bucket).remove([uploaded.path]) } catch (_) { }
          }
          notify('สร้างรายการไม่สำเร็จ', err?.message || 'ไม่สามารถบันทึกรายการได้', 'shield-alert');
        }
      };

      /* ---------------------------------------------------------------
         G. Diagnostics button for admin: no secret, no schema mutation.
         --------------------------------------------------------------- */
      window.pdV11RunDiagnostics = async function () {
        const rows = [];
        if (!window.supabaseClient) { rows.push('❌ Supabase: ยังไม่เชื่อมต่อ'); }
        else {
          rows.push('✅ Supabase: เชื่อมต่อ client แล้ว');
          try { const b = await window.supabaseClient.storage.listBuckets(); const names = (b.data || []).map(x => x.name); rows.push(names.includes('documents') ? '✅ Storage: documents พบแล้ว' : '❌ Storage: ไม่พบ documents'); rows.push(names.includes('slips') ? '✅ Storage: slips พบแล้ว' : '⚠️ Storage: ไม่พบ slips'); } catch (e) { rows.push('⚠️ Storage ตรวจไม่ได้: ' + e.message) }
          const cp = await probeOrdersCopies(); rows.push(cp.ok ? '✅ orders.copies: พบ' : '❌ orders.copies: ยังไม่มี / schema cache ไม่พบ');
          try { const r = await window.supabaseClient.from('orders').select('id').limit(1); rows.push(r.error ? '❌ orders SELECT: ' + r.error.message : '✅ orders SELECT: OK') } catch (e) { rows.push('❌ orders SELECT: ' + e.message) }
          try { const r = await window.supabaseClient.from('users').select('id,role').limit(1); rows.push(r.error ? '❌ users SELECT: ' + r.error.message : '✅ users SELECT: OK') } catch (e) { rows.push('❌ users SELECT: ' + e.message) }
        }
        notify('ตรวจสอบระบบ v11', rows.join('\n'), 'activity');
        return rows;
      };

      /* ---------------------------------------------------------------
         H. Remove visual ambiguity and add a tiny pointer tilt only on
         fine pointers. This never runs on touch devices.
         --------------------------------------------------------------- */
      function installLandingMotion() {
        // CSS-only hover animation is smoother and more predictable than pointer-driven 3D transforms.
      }
      installLandingMotion();

      /* Keep admin decoration alive after every refresh. */
      const oldLoad = window.loadAdminData;
      if (typeof oldLoad === 'function' && !oldLoad.__v11) {
        window.loadAdminData = async function () { const r = await oldLoad.apply(this, arguments); setTimeout(decorateAdminRows, 80); return r }; window.loadAdminData.__v11 = true;
      }
      setTimeout(decorateAdminRows, 700);
      window.addEventListener('load', () => { setTimeout(decorateAdminRows, 300); if (window.lucide) window.lucide.createIcons() });
    })();
  