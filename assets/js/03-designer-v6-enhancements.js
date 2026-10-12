
    /* ==========================================================
       DESIGNER ADVANCED v6 — CONVENIENCE ENGINE
       ========================================================== */
    (() => {
      const q = (id) => document.getElementById(id);
      const DRAFT_KEY = 'pd_print_draft_v6';
      const LAST_KEY = 'pd_last_print_v6';

      function accountMenu(open) {
        const pop = q('pd-account-popover'), trigger = q('pd-account-trigger');
        if (!pop || !trigger) return;
        const next = open === undefined ? !pop.classList.contains('is-open') : !!open;
        pop.classList.toggle('is-open', next); trigger.classList.toggle('is-open', next);
        trigger.setAttribute('aria-expanded', String(next)); pop.setAttribute('aria-hidden', String(!next));
      }
      window.togglePDAccountMenu = () => accountMenu();
      window.closePDAccountMenu = () => accountMenu(false);

      function syncAccountCenter() {
        if (!window.currentUser) return;
        const name = q('user-display-name'), coins = q('pd-account-coins'), badge = q('pd-account-role-badge'), dot = q('pd-account-role-dot');
        const amount = Number(window.currentUser.coins || 0).toFixed(2);
        if (name) name.textContent = window.currentUser.full_name || 'สมาชิก';
        if (coins) coins.textContent = amount;
        if (badge) { badge.textContent = window.currentUser.role === 'admin' ? 'ADMIN' : 'MEMBER'; badge.classList.toggle('admin', window.currentUser.role === 'admin'); }
        if (dot) dot.classList.toggle('admin', window.currentUser.role === 'admin');
      }

      function saveDraft() {
        if (!window.currentUser) return;
        const ids = ['paper-size', 'copies', 'color-type', 'duplex-type', 'printed-pages-input', 'page-range-input', 'order-notes'];
        const data = { savedAt: Date.now(), values: {} };
        ids.forEach(id => { const el = q(id); if (el) data.values[id] = el.value; });
        const delivery = document.querySelector('input[name="delivery_method"]:checked'); const payment = document.querySelector('input[name="payment_method"]:checked');
        if (delivery) data.delivery = delivery.value; if (payment) data.payment = payment.value;
        try { localStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch { }
      }
      function restoreDraft(silent = false) {
        if (!window.currentUser) return false;
        let data; try { data = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null') } catch { return false }
        if (!data?.values) return false;
        Object.entries(data.values).forEach(([id, val]) => { const el = q(id); if (el && val !== undefined) el.value = val; });
        if (data.delivery) { const el = document.querySelector(`input[name="delivery_method"][value="${CSS.escape(data.delivery)}"]`); if (el) el.checked = true; }
        if (data.payment) { const el = document.querySelector(`input[name="payment_method"][value="${CSS.escape(data.payment)}"]`); if (el) el.checked = true; }
        if (typeof window.toggleDeliveryFields === 'function') window.toggleDeliveryFields();
        if (typeof window.togglePaymentFields === 'function') window.togglePaymentFields();
        if (typeof window.calculatePrice === 'function') window.calculatePrice();
        if (!silent && window.pdToast) window.pdToast('คืนค่าแบบร่างแล้ว', 'ตั้งค่าการสั่งพิมพ์ล่าสุดกลับมาให้คุณแล้ว', 'check-circle');
        return true;
      }
      window.clearPrintDraft = (notify = false) => { try { localStorage.removeItem(DRAFT_KEY) } catch { }; if (notify && window.pdToast) window.pdToast('ล้างแบบร่างแล้ว', 'พร้อมเริ่มรายการใหม่', 'eraser'); };
      window.restoreLastPrintOrder = () => {
        let data; try { data = JSON.parse(localStorage.getItem(LAST_KEY) || 'null') } catch { }
        if (!data) { if (window.pdToast) window.pdToast('ยังไม่มีรายการล่าสุด', 'สร้างรายการแรกแล้วระบบจะจำการตั้งค่าไว้ให้', 'info'); return; }
        if (typeof window.switchView === 'function') window.switchView('dashboard');
        setTimeout(() => {
          Object.entries(data).forEach(([id, val]) => { const el = q(id); if (el && val !== undefined) el.value = val; });
          if (data.delivery) { const el = document.querySelector(`input[name="delivery_method"][value="${CSS.escape(data.delivery)}"]`); if (el) el.checked = true; }
          if (data.payment) { const el = document.querySelector(`input[name="payment_method"][value="${CSS.escape(data.payment)}"]`); if (el) el.checked = true; }
          if (typeof window.toggleDeliveryFields === 'function') window.toggleDeliveryFields();
          if (typeof window.togglePaymentFields === 'function') window.togglePaymentFields();
          if (typeof window.calculatePrice === 'function') window.calculatePrice();
          window.scrollTo({ top: 0, behavior: 'smooth' });
          if (window.pdToast) window.pdToast('ใช้รายการล่าสุด', 'ตั้งค่าการพิมพ์เดิมถูกนำกลับมาแล้ว', 'rotate-ccw');
        }, 120);
      };

      function setLiveState(title, copy) { if (q('pd-live-order-title')) q('pd-live-order-title').textContent = title; if (q('pd-live-order-copy')) q('pd-live-order-copy').textContent = copy; }
      function updateLivePrice(total) {
        const n = Number(total) || 0; if (q('pd-live-total')) q('pd-live-total').textContent = `${n.toFixed(2)} ฿`; if (q('pd-coin-equivalent')) q('pd-coin-equivalent').textContent = `≈ ${n.toFixed(2)} Coins`;
        if (window.currentUser && Number(window.currentUser.coins || 0) < n) setLiveState('Coins ไม่พอสำหรับรายการนี้', `ต้องการ ${n.toFixed(2)} Coins • เติม Coins ได้จาก Wallet`); else setLiveState(window.selectedFileObj ? 'พร้อมคำนวณและส่งงาน' : 'พร้อมสร้างงานพิมพ์', window.selectedFileObj ? 'ระบบกำลังติดตามการตั้งค่าแบบเรียลไทม์' : 'อัปโหลดไฟล์เพื่อเริ่มต้น');
      }

      // Enhance the existing calculator without replacing its pricing rules.
      const originalCalc = window.calculatePrice;
      if (typeof originalCalc === 'function') {
        window.calculatePrice = function () { const total = originalCalc.apply(this, arguments); updateLivePrice(total); saveDraft(); return total; };
      }

      function wireUploadUX() {
        const zone = q('upload-placeholder')?.parentElement, input = q('file-input'); if (!zone || !input || zone.dataset.pdWired) return; zone.dataset.pdWired = '1';
        ['dragenter', 'dragover'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.add('pd-upload-drag') }));
        ['dragleave', 'drop'].forEach(evt => zone.addEventListener(evt, e => { e.preventDefault(); zone.classList.remove('pd-upload-drag') }));
        zone.addEventListener('drop', e => { const file = e.dataTransfer?.files?.[0]; if (!file) return; const dt = new DataTransfer(); dt.items.add(file); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); });
      }

      function wireDraft() {
        const form = q('print-form'); if (!form || form.dataset.pdDraftWired) return; form.dataset.pdDraftWired = '1';
        form.addEventListener('input', saveDraft); form.addEventListener('change', saveDraft);
        setTimeout(() => { wireUploadUX(); if (localStorage.getItem(DRAFT_KEY)) restoreDraft(true); }, 250);
      }

      function enhanceFileSelection() {
        const original = window.handleFileSelect; if (typeof original !== 'function' || original.__pdWrapped) return;
        const wrapped = function (e) {
          const file = e.target?.files?.[0]; if (file) { const bar = q('pd-upload-progress'), pct = q('pd-upload-percent'), status = q('pd-upload-status'), fill = q('pd-upload-progress-bar'); bar?.classList.remove('hidden'); let p = 0; const timer = setInterval(() => { p = Math.min(100, p + 20); if (pct) pct.textContent = p + '%'; if (fill) fill.style.width = p + '%'; if (p >= 100) { clearInterval(timer); if (status) status.textContent = 'ตรวจสอบไฟล์สำเร็จ'; } }, 35); }
          const result = original.call(this, e); setTimeout(() => { wireUploadUX(); updateLivePrice(typeof window.calculatePrice === 'function' ? window.calculatePrice() : 1); }, 100); return result;
        }; wrapped.__pdWrapped = true; window.handleFileSelect = wrapped;
      }

      function addShortcuts() {
        document.addEventListener('keydown', e => {
          if (e.key === 'Escape') { accountMenu(false); return; }
          const tag = (e.target?.tagName || '').toLowerCase(); if (['input', 'textarea', 'select'].includes(tag) || e.target?.isContentEditable) return;
          if ((e.key === 'p' || e.key === 'P') && window.currentUser) { e.preventDefault(); window.switchView?.('dashboard'); }
          if ((e.key === 'u' || e.key === 'U') && window.currentUser) { e.preventDefault(); window.switchView?.('dashboard'); setTimeout(() => q('file-input')?.click(), 120); }
          if ((e.key === 'w' || e.key === 'W') && window.currentUser) { e.preventDefault(); window.switchView?.('wallet'); }
        });
        document.addEventListener('click', e => { const wrap = q('pd-account-wrap'); if (wrap && !wrap.contains(e.target)) accountMenu(false); });
      }

      // Wrap updateUserUI so the account center always reflects role + Coins.
      const originalUpdate = window.updateUserUI;
      if (typeof originalUpdate === 'function' && !originalUpdate.__pdWrapped) {
        const wrapped = function () { const r = originalUpdate.apply(this, arguments); window.currentUser = currentUser; setTimeout(syncAccountCenter, 0); return r }; wrapped.__pdWrapped = true; window.updateUserUI = wrapped;
      }

      const originalLogout = window.handleLogout;
      if (typeof originalLogout === 'function' && !originalLogout.__pdWrapped) {
        const wrapped = function () { accountMenu(false); clearPrintDraft(false); return originalLogout.apply(this, arguments) }; wrapped.__pdWrapped = true; window.handleLogout = wrapped;
      }

      // Keep original success flow but remember useful print preferences.
      const originalSubmit = window.handleOrderSubmit;
      if (typeof originalSubmit === 'function' && !originalSubmit.__pdWrapped) {
        const wrapped = async function (e) {
          const ids = ['paper-size', 'copies', 'color-type', 'duplex-type', 'printed-pages-input', 'page-range-input', 'order-notes'];
          const snapshot = {}; ids.forEach(id => { const el = q(id); if (el) snapshot[id] = el.value }); const delivery = document.querySelector('input[name="delivery_method"]:checked'); const payment = document.querySelector('input[name="payment_method"]:checked'); if (delivery) snapshot.delivery = delivery.value; if (payment) snapshot.payment = payment.value;
          const before = localStorage.getItem(DRAFT_KEY); const r = await originalSubmit.call(this, e); setTimeout(() => { if (window.selectedFileObj === null) { try { localStorage.setItem(LAST_KEY, JSON.stringify(snapshot)); localStorage.removeItem(DRAFT_KEY) } catch { } } else if (before) { try { localStorage.setItem(DRAFT_KEY, before) } catch { } } }, 400); return r;
        }; wrapped.__pdWrapped = true; window.handleOrderSubmit = wrapped;
      }

      function adminStats() {
        const orders = document.querySelectorAll('#admin-orders-tbody tr'); const pending = [...orders].filter(r => r.innerText.includes('รอคิว')).length; const topups = document.querySelectorAll('#admin-topups-tbody tr'); const waiting = [...topups].filter(r => r.innerText.includes('pending') || r.innerText.includes('รอ')).length;
        if (q('pd-admin-orders-count')) q('pd-admin-orders-count').textContent = orders.length || 0; if (q('pd-admin-pending-count')) q('pd-admin-pending-count').textContent = pending; if (q('pd-admin-topup-count')) q('pd-admin-topup-count').textContent = waiting;
      }
      window.filterAdminWorkspace = function (term) { const needle = (term || '').trim().toLowerCase();['#admin-orders-tbody', '#admin-topups-tbody', '#admin-users-tbody'].forEach(sel => document.querySelectorAll(`${sel} tr`).forEach(row => { row.style.display = !needle || row.innerText.toLowerCase().includes(needle) ? '' : 'none' })); };
      const oldLoad = window.loadAdminData;
      if (typeof oldLoad === 'function' && !oldLoad.__pdWrapped) { window.loadAdminData = async function () { const r = await oldLoad.apply(this, arguments); setTimeout(adminStats, 100); return r }; window.loadAdminData.__pdWrapped = true; }

      window.addEventListener('load', () => { wireDraft(); enhanceFileSelection(); addShortcuts(); setTimeout(() => { syncAccountCenter(); wireUploadUX(); adminStats() }, 800); });
    })();
  
