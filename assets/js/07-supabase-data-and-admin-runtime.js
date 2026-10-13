
    (() => {
      'use strict';

      /* ================================================================
         PrintDekD Pro v12 — LIVE DATABASE ALIGNMENT
         Live schema model:
           orders        = queue + total_amount + status
           documents     = uploaded file metadata
           print_jobs    = copies/color/paper/duplex/page_range
           deliveries    = delivery information
           payments      = payment/slip
           wallets       = Coins balance (SOURCE OF TRUTH)
           wallet_transactions = Coins ledger
         This layer intentionally does NOT create orders.copies / total_price /
         file_name / slip_url etc. Those belong to the normalized child tables.
         ================================================================ */

      const db = () => window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
      const $ = (id) => document.getElementById(id);
      const q = (s, r = document) => r.querySelector(s);

      // One reliable, accessible status dialog for checkout validation, success and failure.
      // This function was referenced by the checkout flow but was missing from the original file.
      function notifyV12(title, message = '', icon = 'info') {
        const heading = String(title || 'แจ้งเตือนจากระบบ');
        const detail = String(message ?? '');
        const negative = /(ไม่สำเร็จ|ไม่พอ|ไม่ถูกต้อง|ไม่ครบ|ไม่พบ|ไม่สามารถ|ไม่ได้|ไม่พร้อม|ไม่ผ่าน|ผิดพลาด|ล้มเหลว|ขัดข้อง|ไม่อนุญาต|จำกัดสิทธิ์|เกินกำหนด|ไม่รองรับ)/i.test(heading);
        const warning = !negative && /(ตรวจสอบ|กรุณา|ยังไม่|ยังไม่มี|ยังไม่ได้|ยังตั้งค่า|กำลังส่ง|รอการ|รอตรวจ)/i.test(heading);
        const positive = !negative && !warning && /(สำเร็จ|เรียบร้อย|อนุมัติแล้ว|บันทึกคำสั่งซื้อแล้ว|ส่งคำขอแล้ว)/i.test(heading);
        const tone = negative ? 'danger' : warning ? 'warning' : positive ? 'success' : 'info';
        const icons = { success: 'check-circle-2', danger: 'shield-alert', warning: 'alert-triangle', info: 'info' };
        let root = document.getElementById('pd-result-modal');
        if (!root) {
          root = document.createElement('div');
          root.id = 'pd-result-modal';
          root.className = 'pd-result-modal';
          root.hidden = true;
          root.innerHTML = `
            <section class="pd-result-card" role="alertdialog" aria-modal="true" aria-labelledby="pd-result-title" aria-describedby="pd-result-message" tabindex="-1">
              <button type="button" class="pd-result-dismiss" data-pd-result-close aria-label="ปิดหน้าต่างแจ้งเตือน">×</button>
              <div class="pd-result-mark" aria-hidden="true"><i data-lucide="info"></i></div>
              <div class="pd-result-kicker">PRINTDEKD PRO <span>•</span> SYSTEM STATUS</div>
              <h2 id="pd-result-title"></h2>
              <p id="pd-result-message"></p>
              <div class="pd-result-footer"><span class="pd-result-status-dot"></span><span id="pd-result-caption">รายละเอียดสถานะระบบ</span></div>
              <button type="button" class="pd-result-primary" data-pd-result-close>รับทราบ</button>
            </section>`;
          document.body.appendChild(root);
          root.addEventListener('click', event => {
            if (event.target === root || event.target.closest('[data-pd-result-close]')) closeV12Notice();
          });
          root.addEventListener('keydown', event => {
            if (event.key !== 'Tab') return;
            const focusable = [...root.querySelectorAll('button:not([disabled])')];
            if (!focusable.length) return;
            const first = focusable[0], last = focusable[focusable.length - 1];
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
            else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
          });
        }
        const card = root.querySelector('.pd-result-card');
        const mark = root.querySelector('.pd-result-mark');
        card.dataset.tone = tone;
        // Lucide replaces the data-lucide node with SVG after rendering; recreate it for each notice.
        if (mark) mark.innerHTML = `<i data-lucide="${icons[tone] || 'info'}"></i>`;
        root.querySelector('#pd-result-title').textContent = heading;
        root.querySelector('#pd-result-message').textContent = detail;
        root.querySelector('#pd-result-caption').textContent = tone === 'success'
          ? 'ระบบบันทึกรายการแล้ว'
          : tone === 'danger' ? 'รายการยังไม่สำเร็จ — ตรวจสอบรายละเอียดด้านบน'
          : tone === 'warning' ? 'โปรดตรวจสอบข้อมูลก่อนดำเนินการต่อ'
          : 'ข้อความจากระบบ PrintDekD Pro';
        const action = root.querySelector('.pd-result-primary');
        action.textContent = tone === 'danger' || tone === 'warning' ? 'กลับไปตรวจสอบ' : 'รับทราบ';
        window.__pdPreviousFocus = document.activeElement;
        root.hidden = false;
        document.body.classList.add('pd-result-modal-open');
        try { window.lucide?.createIcons?.(); } catch (_) { /* Icon rendering is decorative only. */ }
        requestAnimationFrame(() => action.focus({ preventScroll: true }));
        return false;
      }

      function closeV12Notice() {
        const root = document.getElementById('pd-result-modal');
        if (!root || root.hidden) return;
        root.hidden = true;
        document.body.classList.remove('pd-result-modal-open');
        const previous = window.__pdPreviousFocus;
        if (previous && previous.isConnected && typeof previous.focus === 'function') {
          try { previous.focus({ preventScroll: true }); } catch (_) { }
        }
      }
      window.notifyV12 = notifyV12;

      // Customer-friendly styled input dialog, matching the PrintDekD logout/result modal.
      window.pdAskTracking = function (initial = '') {
        return new Promise(resolve => {
          let root = document.getElementById('pd-tracking-input-modal');
          if (!root) {
            root = document.createElement('div'); root.id = 'pd-tracking-input-modal';
            root.className = 'pd-result-modal'; root.hidden = true;
            root.innerHTML = `<section class="pd-result-card pd-tracking-card" role="dialog" aria-modal="true" aria-labelledby="pd-tracking-title">
              <button type="button" class="pd-result-dismiss" data-track-cancel aria-label="ปิด">×</button>
              <div class="pd-result-mark"><i data-lucide="package-check"></i></div>
              <div class="pd-result-kicker">PRINTDEKD PRO <span>•</span> DELIVERY</div>
              <h2 id="pd-tracking-title">เพิ่มเลขพัสดุ</h2>
              <p>กรอกหมายเลขติดตามพัสดุที่ได้รับจากบริษัทขนส่ง ลูกค้าจะใช้หมายเลขนี้ติดตามการจัดส่ง</p>
              <label for="pd-tracking-provider" class="pd-tracking-label">บริษัทขนส่ง</label>
              <select id="pd-tracking-provider" class="pd-tracking-input"><option value="Kerry Express">Kerry Express</option><option value="ไปรษณีย์ไทย">ไปรษณีย์ไทย</option><option value="Messenger">Messenger</option><option value="LINE MAN">LINE MAN</option><option value="Flash Express">Flash Express</option><option value="J&amp;T Express">J&amp;T Express</option><option value="บริษัทขนส่งอื่น">บริษัทขนส่งอื่น</option></select>
              <input id="pd-tracking-provider-other" class="pd-tracking-input" type="text" maxlength="80" placeholder="ระบุชื่อผู้ให้บริการอื่น" hidden />
              <label for="pd-tracking-number" class="pd-tracking-label">หมายเลข Tracking</label>
              <input id="pd-tracking-number" class="pd-tracking-input" type="text" maxlength="100" autocomplete="off" placeholder="เช่น TH123456789" />
              <p class="pd-tracking-hint">ตรวจสอบตัวอักษรและตัวเลขให้ถูกต้องก่อนบันทึก</p>
              <div class="pd-tracking-actions"><button type="button" class="pd-tracking-cancel" data-track-cancel>ยกเลิก</button><button type="button" class="pd-result-primary" data-track-save>บันทึกเลขพัสดุ</button></div>
            </section>`;
            document.body.appendChild(root);
            root.addEventListener('click', e => { if (e.target === root || e.target.closest('[data-track-cancel]')) { root.hidden=true; const done=root.__pdResolve; root.__pdResolve=null; done?.(null); } });
            root.querySelector('#pd-tracking-provider').addEventListener('change', () => { const other=root.querySelector('#pd-tracking-provider-other'); other.hidden=root.querySelector('#pd-tracking-provider').value!=='บริษัทขนส่งอื่น'; if(!other.hidden) other.focus(); });
            root.querySelector('[data-track-save]').addEventListener('click', () => {
              const value=root.querySelector('#pd-tracking-number').value.trim();
              if (!value) { root.querySelector('#pd-tracking-number').focus(); notifyV12('กรุณากรอกหมายเลข Tracking','กรอกหมายเลขพัสดุก่อนบันทึก เพื่อให้ลูกค้าติดตามการจัดส่งได้','alert-triangle'); return; }
              let provider=root.querySelector('#pd-tracking-provider').value;
              if(provider==='บริษัทขนส่งอื่น') { provider=root.querySelector('#pd-tracking-provider-other').value.trim(); if(!provider) {root.querySelector('#pd-tracking-provider-other').focus(); notifyV12('กรุณาระบุผู้ให้บริการ','พิมพ์ชื่อบริษัทขนส่งอื่นก่อนบันทึก','alert-triangle');return;} }
              root.hidden=true; const done=root.__pdResolve; root.__pdResolve=null; done?.({tracking:value, provider});
            });
            root.addEventListener('keydown', e => { if(e.key==='Escape'){root.hidden=true;const done=root.__pdResolve;root.__pdResolve=null;done?.(null)} if(e.key==='Enter' && e.target.id==='pd-tracking-number'){e.preventDefault();root.querySelector('[data-track-save]').click()} });
          }
          root.__pdResolve=resolve;
          root.querySelector('#pd-tracking-number').value=initial;
          root.querySelector('#pd-tracking-provider-other').hidden=root.querySelector('#pd-tracking-provider').value!=='บริษัทขนส่งอื่น';
          root.hidden=false; window.lucide?.createIcons?.(); requestAnimationFrame(()=>root.querySelector('#pd-tracking-number').focus());
        });
      };
      window.closeV12Notice = closeV12Notice;
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape') closeV12Notice();
      });

      const qa = (s, r = document) => [...r.querySelectorAll(s)];

      function v(id) { return ($(id)?.value ?? '').toString().trim(); }
      function safe(s) { return typeof escapeHtml === 'function' ? escapeHtml(String(s ?? '')) : String(s ?? ''); }
      function money(n) { return Number(n || 0).toFixed(2); }
      function notifyV(title, message, icon = 'info') {
        if (typeof window.notify === 'function') return window.notify(title, message, icon);
        if (typeof window.showCustomModal === 'function') return window.showCustomModal({ title, message, icon });
      }

      function getSelectedPageRange() {
        const mode = q('input[name="page_selection_mode"]:checked')?.value || 'text';
        const typed = v('page-range-input');
        if (mode === 'text' && typed) return typed;
        const checked = qa('#pages-grid-container input[type="checkbox"]').filter(x => x.checked).map(x => Number(x.value)).filter(Number.isFinite).sort((a, b) => a - b);
        if (!checked.length) {
          const pages = Math.max(1, parseInt(v('printed-pages-input')) || 1);
          return `1-${pages}`;
        }
        const ranges = [];
        let start = checked[0], prev = checked[0];
        for (let i = 1; i < checked.length; i++) {
          const n = checked[i];
          if (n === prev + 1) { prev = n; continue; }
          ranges.push(start === prev ? String(start) : `${start}-${prev}`);
          start = prev = n;
        }
        ranges.push(start === prev ? String(start) : `${start}-${prev}`);
        return ranges.join(', ');
      }

      async function loadPricingV12(paper) {
        const client = db();
        if (!client) throw new Error('Supabase ยังไม่เชื่อมต่อ');
        const { data, error } = await client.from('pricing')
          .select('id,paper_size,black_white_price,color_price,duplex_price')
          .eq('paper_size', paper)
          .maybeSingle();
        if (error) throw error;
        if (!data) throw new Error(`ยังไม่มีราคาสำหรับกระดาษ ${paper} ในตาราง pricing กรุณาตั้งราคาก่อนสั่งพิมพ์`);
        return data;
      }

      async function hydrateOrdersV12(orders) {
        const client = db();
        if (!client || !orders?.length) return [];
        const ids = orders.map(o => o.id).filter(Boolean);
        const userIds = [...new Set(orders.map(o => o.user_id).filter(Boolean))];

        const [jobsR, deliveriesR, paymentsR, usersR] = await Promise.all([
          client.from('print_jobs').select('id,order_id,document_id,copies,color,paper_size,duplex,status,page_range').in('order_id', ids).order('id', { ascending: true }),
          client.from('deliveries').select('id,order_id,delivery_method,recipient_name,phone_number,delivery_address,delivery_provider,tracking_number').in('order_id', ids),
          client.from('payments').select('id,order_id,amount,status,payment_method,slip_url,created_at').in('order_id', ids),
          userIds.length ? client.from('users').select('id,full_name,email').in('id', userIds) : Promise.resolve({ data: [], error: null })
        ]);
        for (const r of [jobsR, deliveriesR, paymentsR, usersR]) if (r.error) throw r.error;

        const jobs = jobsR.data || [];
        const docIds = [...new Set(jobs.map(j => j.document_id).filter(Boolean))];
        let docs = [];
        if (docIds.length) {
          const r = await client.from('documents').select('id,user_id,file_name,file_path,page_count,file_size,created_at').in('id', docIds);
          if (r.error) throw r.error;
          docs = r.data || [];
        }
        const jm = new Map(jobs.map(x => [String(x.order_id), x]));
        const dm = new Map(docs.map(x => [String(x.id), x]));
        const delm = new Map((deliveriesR.data || []).map(x => [String(x.order_id), x]));
        const paym = new Map((paymentsR.data || []).map(x => [String(x.order_id), x]));
        const um = new Map((usersR.data || []).map(x => [String(x.id), x]));

        return orders.map(order => {
          const job = jm.get(String(order.id)) || {};
          const doc = dm.get(String(job.document_id)) || {};
          const delivery = delm.get(String(order.id)) || {};
          const payment = paym.get(String(order.id)) || {};
          const user = um.get(String(order.user_id)) || {};
          return {
            ...order,
            queue_label: order.queue_number ?? order.id,
            user_name: user.full_name || '',
            user_email: user.email || '',
            file_name: doc.file_name || 'เอกสารพิมพ์',
            file_path: doc.file_path || '',
            file_bucket: 'documents',
            file_size: doc.file_size || 0,
            file_mime: '',
            page_count: doc.page_count || 1,
            copies: job.copies || 1,
            paper_size: job.paper_size || 'A4',
            is_color: !!job.color,
            is_duplex: !!job.duplex,
            page_range: job.page_range || '',
            delivery_method: delivery.delivery_method || 'pickup',
            recipient_name: delivery.recipient_name || '',
            recipient_phone: delivery.phone_number || '',
            recipient_address: delivery.delivery_address || '',
            delivery_provider: delivery.delivery_provider || '',
            tracking_number: delivery.tracking_number || '',
            delivery_fee: delivery.delivery_method === 'delivery' ? 30 : 0,
            total_price: Number(order.total_amount || 0),
            payment_method: payment.payment_method || '',
            slip_url: payment.slip_url || '',
            payment_status: payment.status || '',
            admin_note: order.admin_note || '',
            status: order.status || 'queued',
            created_at: order.created_at
          };
        });
      }

      function renderQueueV12(orders) {
        const container = $('queue-cards-container');
        if (!container) return;
        if (!orders?.length) {
          container.innerHTML = `<div class="p-8 rounded-2xl ui-card text-center space-y-3"><i data-lucide="inbox" class="w-10 h-10 sub-text mx-auto"></i><p class="text-sm font-bold titanium-text">ยังไม่มีคิวงานพิมพ์ในขณะนี้</p><p class="text-xs sub-text">สร้างรายการใหม่ที่แบบฟอร์มด้านซ้ายมือได้ทันที</p></div>`;
          window.lucide?.createIcons(); return;
        }
        container.innerHTML = orders.map(ord => {
          const deliveryOrder = ord.delivery_method === 'delivery';
        const legacyCompletedLabel = deliveryOrder ? 'พร้อมจัดส่งพัสดุ' : 'พร้อมรับเอกสาร';
        const statusMeta = ({
          queued: ['รอแอดมินตรวจสอบ', 'amber', 'clock-3'],
          pending: ['รอแอดมินตรวจสอบ', 'amber', 'clock-3'],
          preparing: ['กำลังตรวจสอบ / จัดเตรียม', 'blue', 'clipboard-check'],
          printing: ['กำลังตรวจสอบ / จัดเตรียม', 'blue', 'clipboard-check'],
          ready_for_pickup: ['พร้อมรับเอกสาร', 'emerald', 'package-check'],
          shipped: ['จัดส่งแล้ว', 'blue', 'truck'],
          finished: ['ส่งมอบเรียบร้อย', 'emerald', 'check-circle-2'],
          completed: [legacyCompletedLabel, 'emerald', 'package-check'],
          failed: ['ต้องตรวจสอบแก้ไข', 'rose', 'alert-triangle'],
          cancelled: ['ยกเลิกแล้ว', 'rose', 'circle-x']
        })[String(ord.status || 'queued').toLowerCase()] || ['รอแอดมินตรวจสอบ', 'amber', 'clock-3'];
        const statusColorClass = statusMeta[1] === 'emerald' ? 'bg-emerald-500/15 text-emerald-500 border-emerald-500/30'
          : statusMeta[1] === 'blue' ? 'bg-blue-500/15 text-blue-500 border-blue-500/30'
          : statusMeta[1] === 'rose' ? 'bg-rose-500/15 text-rose-500 border-rose-500/30'
          : 'bg-amber-500/15 text-amber-500 border-amber-500/30';
        const status = `<span class="pd-order-status-badge px-3 py-1 rounded-full text-xs font-bold border ${statusColorClass}">${safe(statusMeta[0])}</span>`;
          return `<div class="p-4 rounded-xl ui-card border space-y-2.5 hover:border-blue-500 transition cursor-pointer" role="button" tabindex="0" data-pd-order-detail="${safe(ord.id)}" aria-label="เปิดรายละเอียดคิวงานพิมพ์">
        <div class="flex items-center justify-between"><span class="text-xs font-bold font-mono text-blue-500">คิว #${safe(ord.queue_label)}</span>${status}</div>
        <div class="flex items-center justify-between gap-3"><div class="min-w-0"><p class="text-sm font-bold titanium-text truncate max-w-[230px]">${safe(ord.file_name)}</p><p class="text-[11px] sub-text">${(ord.page_range ? `หน้าที่เลือก ${safe(ord.page_range)}` : `${ord.page_count || 1} หน้า`)} | ${ord.copies || 1} ชุด | ${ord.delivery_method === 'delivery' ? '🚚 จัดส่งพัสดุ' : '📍 รับหน้าร้าน'}</p></div><span class="text-lg font-black blue-gradient-text shrink-0">${money(ord.total_price)} ฿</span></div>
        ${ord.tracking_number ? `<div class="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30 text-xs font-bold text-emerald-500">🚚 Tracking: ${safe(ord.tracking_number)} ${ord.delivery_provider ? `(${safe(ord.delivery_provider)})` : ''}</div>` : ''}
      </div>`;
        }).join('');
        window.lucide?.createIcons();
      }

      window.fetchQueues = async function () {
        const container = $('queue-cards-container');
        if (!container) return;
        const client = db();
        if (!client || !window.currentUser?.id) { currentOrdersList = []; renderQueueV12([]); return; }
        try {
          const { data, error } = await client.from('orders').select('id,user_id,queue_number,total_amount,status,estimated_pickup,admin_note,created_at').eq('user_id', window.currentUser.id).order('created_at', { ascending: false });
          if (error) throw error;
          const hydrated = await hydrateOrdersV12(data || []);
          currentOrdersList = hydrated; window.__pdUserOrders = hydrated; renderQueueV12(hydrated);
        } catch (err) {
          container.innerHTML = `<p class="py-8 text-center text-rose-500 text-xs">${safe(err?.message || 'ไม่สามารถโหลดข้อมูลคิวงานได้')}</p>`;
        }
      };

      window.fetchUserTopups = async function () {
        const list = $('topup-history-list');
        if (!list) return;
        const client = db();
        if (!client || !window.currentUser?.id) { list.innerHTML = '<p class="text-center py-8 sub-text text-xs">กรุณาเข้าสู่ระบบและเชื่อมต่อฐานข้อมูล</p>'; return; }
        try {
          const { data, error } = await client.from('topups').select('id,user_id,amount,status,created_at').eq('user_id', window.currentUser.id).order('created_at', { ascending: false });
          if (error) throw error;
          if (!data?.length) { list.innerHTML = '<p class="text-center py-8 sub-text text-xs">ยังไม่มีประวัติการเติม Coins</p>'; return; }
          list.innerHTML = data.map(tp => `<div class="p-4 rounded-2xl ui-card border flex items-center justify-between gap-3 text-xs shadow-sm"><div><p class="font-black text-amber-500 text-sm">+${money(tp.amount)} Coins</p><p class="text-[10px] sub-text font-mono mt-0.5">${safe(new Date(tp.created_at).toLocaleString('th-TH'))}</p></div><span class="security-badge ${tp.status === 'approved' ? 'good' : tp.status === 'rejected' ? 'bad' : 'warn'}">${tp.status === 'approved' ? 'อนุมัติแล้ว' : tp.status === 'rejected' ? 'ปฏิเสธ' : 'รอตรวจสอบ'}</span></div>`).join('');
        } catch (err) { list.innerHTML = `<p class="text-center py-8 text-rose-500 text-xs">${safe(err?.message || 'ไม่สามารถโหลดประวัติได้')}</p>`; }
      };

      async function uploadToBucketV12(bucket, file, path) {
        const client = db();
        const { error } = await client.storage.from(bucket).upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream', cacheControl: '3600' });
        if (error) throw error;
        return path;
      }

      async function removeStorageV12(bucket, path) {
        if (!bucket || !path) return;
        try { await db().storage.from(bucket).remove([path]); } catch (_) { }
      }

      // The UI must never label a slip as accepted until the same-origin server
      // function has received a positive SlipOK result. This is deliberately fail-closed:
      // 4xx/5xx, timeout, missing environment variables and malformed responses create no row.
      async function verifySlipV12(file, expectedAmount) {
        if (!file) throw new Error('กรุณาแนบรูปสลิปก่อนยืนยัน');
        if (!/^image\/(png|jpe?g|webp)$/i.test(String(file.type || ''))) {
          throw new Error('ไฟล์นี้ไม่ใช่ PNG/JPG/WEBP ที่รองรับ กรุณาแนบรูปสลิปจากรายการโอนเงินจริง');
        }
        if (file.size <= 0 || file.size > 4 * 1024 * 1024) {
          throw new Error('ไฟล์สลิปต้องมีขนาดมากกว่า 0 และไม่เกิน 4 MB');
        }
        const amount = Number(expectedAmount);
        if (!Number.isFinite(amount) || amount <= 0) throw new Error('ยอดชำระที่ต้องตรวจสอบไม่ถูกต้อง');
        const form = new FormData();
        form.append('slip', file, String(file.name || 'slip-image').slice(0, 180));
        form.append('amount', amount.toFixed(2));
        let response;
        try {
          response = await fetch('/api/verify-slip', {
            method: 'POST', body: form, credentials: 'same-origin', cache: 'no-store',
            headers: { 'Accept': 'application/json' }
          });
        } catch (_) {
          throw new Error('ติดต่อระบบตรวจสลิปอัตโนมัติไม่ได้ จึงยังไม่ได้บันทึกคำขอเติม Coins/สั่งพิมพ์ กรุณาลองใหม่ภายหลัง');
        }
        let result = null;
        try { result = await response.json(); } catch (_) { }
        if (!response.ok || result?.ok !== true || result?.manualReview === true) {
          const providerMessage = String(result?.message || '').trim();
          if (response.status === 503 || response.status === 429) {
            throw new Error(`${providerMessage || 'ระบบตรวจสลิปอัตโนมัติยังไม่พร้อม'}\nไม่ได้บันทึกคำขอและยังไม่มีการเพิ่ม Coins กรุณาลองใหม่ภายหลัง`);
          }
          throw new Error(providerMessage || `ตรวจสลิปไม่ผ่าน (HTTP ${response.status}) กรุณาใช้สลิปโอนเงินจริงที่ถูกต้อง`);
        }
        const confirmedAmount = Number(result.amount);
        const transRef = String(result.transRef || '').trim();
        if (!Number.isFinite(confirmedAmount) || Math.round(confirmedAmount * 100) !== Math.round(amount * 100)) {
          throw new Error('ยอดเงินที่ผู้ให้บริการยืนยันไม่ตรงกับยอดที่ต้องชำระ จึงปฏิเสธรายการ');
        }
        if (!transRef) throw new Error('ระบบตรวจสลิปไม่ส่งเลขอ้างอิงธุรกรรมกลับมา จึงยังไม่รับรายการนี้');
        return {
          transRef,
          amount: confirmedAmount,
          verifiedAt: String(result.verifiedAt || new Date().toISOString()),
          message: String(result.message || 'ตรวจสลิปผ่านอัตโนมัติแล้ว').slice(0, 240),
          receiver: result.receiver || null
        };
      }

      function isMissingVerificationColumnsV12(error) {
        const message = String(error?.message || error || '');
        return /(verification_status|verification_ref|verification_message|verified_at)/i.test(message)
          && /(column|schema cache|does not exist|could not find|not found|unknown)/i.test(message);
      }

      // Try to persist audit metadata. On an older schema, keep the already-verified
      // payment/top-up in the legacy columns and return a flag so the user is warned.
      async function insertVerifiedRecordV12(client, table, baseRow, verification) {
        const verifiedRow = {
          ...baseRow,
          verification_status: 'verified',
          verification_ref: verification.transRef,
          verification_message: verification.message,
          verified_at: verification.verifiedAt
        };
        const first = await client.from(table).insert([verifiedRow]);
        if (!first.error) return { metadataStored: true };
        if (!isMissingVerificationColumnsV12(first.error)) throw first.error;
        const fallback = await client.from(table).insert([baseRow]);
        if (fallback.error) throw fallback.error;
        return { metadataStored: false };
      }

      window.handleOrderSubmit = async function (e) {
        e?.preventDefault();
        const client = db(), user = window.currentUser;
        if (!user) return notifyV12('กรุณาล็อกอิน', 'กรุณาล็อกอินก่อนทำการสั่งพิมพ์', 'lock');
        if (!client) return notifyV12('ฐานข้อมูลยังไม่พร้อม', 'กรุณาเชื่อมต่อ Supabase ก่อนสั่งงาน', 'database-zap');

        const file = window.selectedFileObj;
        if (!file) return notifyV12('ยังไม่ได้เลือกไฟล์', 'กรุณาอัปโหลดเอกสารก่อนสร้างรายการ', 'file-plus-2');
        if (typeof window.validateUploadFile === 'function') {
          const chk = window.validateUploadFile(file, { maxMB: 20, extensions: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'] });
          if (!chk.ok) return notifyV12('ไฟล์ไม่ผ่านการตรวจสอบ', chk.message, 'file-warning');
        }

        const pages = Math.max(1, parseInt(v('printed-pages-input')) || 1);
        const copies = Math.max(1, parseInt(v('copies')) || 1);
        const paper = v('paper-size') || 'A4';
        const isColor = v('color-type') === 'color';
        const isDuplex = v('duplex-type') === 'duplex';
        const pageRange = getSelectedPageRange();
        const payMethod = q('input[name="payment_method"]:checked')?.value;
        const deliveryMethod = q('input[name="delivery_method"]:checked')?.value;
        const notes = v('order-notes');
        if (!payMethod || !deliveryMethod) return notifyV12('ตรวจสอบตัวเลือก', 'กรุณาเลือกการชำระเงินและการรับสินค้า', 'alert-triangle');

        let recipientName = '', recipientPhone = '', recipientAddress = '';
        if (deliveryMethod === 'delivery') {
          recipientName = v('recipient-name'); recipientPhone = v('recipient-phone'); recipientAddress = v('recipient-address');
          if (!recipientName || !/^0[0-9\-\s]{8,14}$/.test(recipientPhone) || !recipientAddress)
            return notifyV12('ข้อมูลจัดส่งไม่ครบ', 'กรุณากรอกชื่อ เบอร์โทร และที่อยู่ให้ครบถ้วน', 'map-pin-x');
        }

        let pricing;
        try { pricing = await loadPricingV12(paper); } catch (err) { return notifyV12('ยังตั้งค่าราคาไม่ครบ', err.message, 'badge-alert'); }
        const pageRate = Number(isColor ? pricing.color_price : pricing.black_white_price) + (isDuplex ? Number(pricing.duplex_price) : 0);
        const printCost = pages * pageRate * copies;
        const deliveryFee = deliveryMethod === 'delivery' ? 30 : 0;
        const total = Number((printCost + deliveryFee).toFixed(2));
        if (!Number.isFinite(pageRate) || pageRate < 0 || !Number.isFinite(total) || total <= 0) {
          return notifyV12('ราคายังยืนยันไม่ได้', 'ระบบพบราคาหรือยอดรวมไม่ถูกต้อง จึงหยุดก่อนสร้างคำสั่งซื้อ', 'shield-alert');
        }
        if (!['coins', 'promptpay'].includes(payMethod) || !['pickup', 'delivery'].includes(deliveryMethod)) {
          return notifyV12('วิธีทำรายการไม่ถูกต้อง', 'กรุณาเลือกวิธีชำระเงินและรับสินค้าใหม่', 'shield-alert');
        }

        if (payMethod === 'coins') {
          try { await window.fetchUserWallet?.(); } catch (err) { return notifyV12('ตรวจสอบ Coins ไม่สำเร็จ', err.message || 'ไม่สามารถอ่าน wallets.balance', 'shield-alert'); }
          const balance = Number(window.currentUser?.coins || 0);
          if (balance < total) return notifyV12('Coins ไม่พอ', `มี ${money(balance)} Coins แต่ต้องใช้ ${money(total)} Coins`, 'coins');
        }

        let promptPaySlipFile = null, promptPayVerification = null;
        if (payMethod === 'promptpay') {
          promptPaySlipFile = $('order-slip-file')?.files?.[0];
          try {
            promptPayVerification = await verifySlipV12(promptPaySlipFile, total);
          } catch (verifyError) {
            return notifyV12('ตรวจสลิปไม่ผ่าน', verifyError?.message || 'ไม่สามารถยืนยันสลิปได้ จึงยังไม่ได้สร้างคิวงานพิมพ์', 'shield-alert');
          }
        }

        const orderId = crypto.randomUUID();
        const docId = crypto.randomUUID();
        let documentPath = '', slipPath = '', orderCreated = false, docCreated = false, jobCreated = false, deliveryCreated = false, paymentCreated = false, walletChanged = false;
        let verificationMetadataWarning = false;
        let walletBefore = 0, walletId = null, checkoutCommitted = false, walletRollbackConflict = false;

        try {
          const safeName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'document';
          documentPath = `${user.id}/${orderId}/${safeName}`;
          await uploadToBucketV12('documents', file, documentPath);

          const { error: docError } = await client.from('documents').insert([{
            id: docId, user_id: user.id, file_name: file.name, file_path: documentPath, page_count: pages, file_size: file.size, created_at: new Date().toISOString()
          }]);
          if (docError) throw docError;
          docCreated = true;

          const { data: order, error: orderError } = await client.from('orders').insert([{
            id: orderId, user_id: user.id, total_amount: total, status: 'queued', admin_note: notes || null, created_at: new Date().toISOString()
          }]).select('id,queue_number,total_amount,status,created_at').single();
          if (orderError) throw orderError;
          if (!order) throw new Error('Supabase ไม่คืนข้อมูลออเดอร์');
          orderCreated = true;

          const { error: jobError } = await client.from('print_jobs').insert([{
            id: crypto.randomUUID(), order_id: orderId, document_id: docId, copies, color: isColor, paper_size: paper, duplex: isDuplex, status: 'queued', page_range: pageRange
          }]);
          if (jobError) throw jobError;
          jobCreated = true;

          if (deliveryMethod === 'delivery') {
            const { error: deliveryError } = await client.from('deliveries').insert([{
              order_id: orderId, delivery_method: 'delivery', recipient_name: recipientName, phone_number: recipientPhone, delivery_address: recipientAddress, delivery_provider: null, tracking_number: null
            }]);
            if (deliveryError) throw deliveryError;
            deliveryCreated = true;
          }

          if (payMethod === 'promptpay') {
            const slipFile = promptPaySlipFile;
            const slipName = String(slipFile.name || 'slip').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'slip.jpg';
            slipPath = `${user.id}/${orderId}/${Date.now()}-${slipName}`;
            await uploadToBucketV12('slips', slipFile, slipPath);
            const { data: pub } = client.storage.from('slips').getPublicUrl(slipPath);
            const paymentSave = await insertVerifiedRecordV12(client, 'payments', {
              order_id: orderId, amount: total, status: 'pending', payment_method: 'promptpay',
              slip_url: pub?.publicUrl || slipPath, created_at: new Date().toISOString()
            }, promptPayVerification);
            verificationMetadataWarning = !paymentSave.metadataStored;
            paymentCreated = true;
          } else {
            const { error: payError } = await client.from('payments').insert([{ order_id: orderId, amount: total, status: 'completed', payment_method: 'coins', slip_url: null, created_at: new Date().toISOString() }]);
            if (payError) throw payError;
            paymentCreated = true;

            const wallet = await window.ensureUserWalletV12(user.id);
            walletId = wallet.id; walletBefore = Number(wallet.balance || 0);
            const next = Number((walletBefore - total).toFixed(2));
            if (next < 0) throw new Error('ยอด Coins ไม่เพียงพอ');
            const { data: changed, error: walletError } = await client.from('wallets').update({ balance: next, updated_at: new Date().toISOString() }).eq('id', wallet.id).eq('balance', walletBefore).select('id,user_id,balance,updated_at').maybeSingle();
            if (walletError) throw walletError;
            if (!changed) throw new Error('ยอด Coins เปลี่ยนระหว่างการทำรายการ กรุณาลองใหม่');
            walletChanged = true;

            const { error: txError } = await client.from('wallet_transactions').insert([{
              wallet_id: wallet.id, order_id: orderId, transaction_type: 'payment', amount: -total, description: `ชำระค่าพิมพ์คิว #${order.queue_number ?? order.id}`, transaction_date: new Date().toISOString()
            }]);
            if (txError) throw txError;
          }

          // The database writes above are the checkout commit. Refresh failures must not
          // roll back a paid order or delete its audit trail after a successful transaction.
          checkoutCommitted = true;
          try { await window.fetchUserWallet?.(); } catch (refreshError) { console.warn('[PrintDekD] Wallet refresh failed after checkout commit:', refreshError); }
          try { await window.fetchQueues?.(); } catch (refreshError) { console.warn('[PrintDekD] Queue refresh failed after checkout commit:', refreshError); }
          const paymentStatus = payMethod === 'promptpay'
            ? `ยอดรวม ${money(total)} บาท\nตรวจสลิปอัตโนมัติผ่านแล้ว — รอผู้ดูแลยืนยันก่อนดำเนินการ`
            : `ยอดรวม ${money(total)} Coins\nหัก Coins และบันทึกคิวเรียบร้อยแล้ว`;
          const schemaWarning = verificationMetadataWarning
            ? '\nคำเตือน: ฐานข้อมูลยังไม่มีคอลัมน์บันทึกผลตรวจสลิป กรุณารัน database/printdekd-wallet-verification.sql'
            : '';
          notifyV12('ส่งคำสั่งพิมพ์สำเร็จ', `คิว #${order.queue_number ?? order.id} • ${pages} หน้า × ${copies} ชุด\n${paymentStatus}${schemaWarning}`, verificationMetadataWarning ? 'alert-triangle' : 'check-circle-2');
          $('print-form')?.reset(); window.selectedFileObj = null;
          $('upload-placeholder')?.classList.remove('hidden'); $('file-details')?.classList.add('hidden'); $('preview-file-drawer-btn')?.classList.add('hidden');
          if ($('pdf-preview-wrapper')) $('pdf-preview-wrapper').innerHTML = '<p class="text-xs sub-text py-12">อัปโหลดไฟล์ PDF เพื่อแสดงพรีวิวหน้า...</p>';
          if ($('pages-grid-container')) $('pages-grid-container').innerHTML = '<p class="col-span-full text-center text-xs sub-text py-2">กรุณาอัปโหลดไฟล์ PDF เพื่อเลือกหน้า</p>';
          toggleDeliveryFields?.();
        } catch (err) {
          if (checkoutCommitted) {
            console.error('[PrintDekD] Checkout committed, but a later UI step failed:', err);
            notifyV12('บันทึกคำสั่งซื้อแล้ว', 'คำสั่งซื้อถูกบันทึกแล้ว แต่มีขั้นตอนแสดงผลบางส่วนไม่สำเร็จ กรุณากดรีเฟรชคิวแทนการสั่งซ้ำ', 'check-circle-2');
            return;
          }
          if (walletChanged && walletId) {
            const expectedAfterDebit = Number((walletBefore - total).toFixed(2));
            try {
              const restored = await client.from('wallets').update({ balance: walletBefore, updated_at: new Date().toISOString() })
                .eq('id', walletId).eq('balance', expectedAfterDebit).select('id').maybeSingle();
              if (restored.error || !restored.data) walletRollbackConflict = true;
            } catch (_) { walletRollbackConflict = true; }
          }
          if (!walletRollbackConflict) {
            if (paymentCreated) try { await client.from('payments').delete().eq('order_id', orderId); } catch (_) { }
            if (deliveryCreated) try { await client.from('deliveries').delete().eq('order_id', orderId); } catch (_) { }
            if (jobCreated) try { await client.from('print_jobs').delete().eq('order_id', orderId); } catch (_) { }
            if (orderCreated) try { await client.from('orders').delete().eq('id', orderId); } catch (_) { }
            if (docCreated) try { await client.from('documents').delete().eq('id', docId); } catch (_) { }
            await removeStorageV12('documents', documentPath);
            await removeStorageV12('slips', slipPath);
          } else {
            // Preserve order/payment evidence when a safe balance rollback cannot be proven.
            console.error('[PrintDekD] Wallet rollback conflict; retain order records for admin reconciliation.', { orderId, walletId, total });
          }
          notifyV12('สร้างรายการไม่สำเร็จ', walletRollbackConflict
            ? 'ตรวจพบยอด Wallet เปลี่ยนพร้อมกันและไม่สามารถคืนยอดอย่างปลอดภัย ระบบเก็บหลักฐานรายการไว้ให้ผู้ดูแลตรวจสอบแล้ว กรุณาอย่าส่งคำสั่งซื้อซ้ำ'
            : (err?.message || 'ไม่สามารถบันทึกข้อมูลได้'), 'shield-alert');
        }
      };

      window.ensureUserWalletV12 = async function (userId) {
        const client = db();
        const { data, error } = await client.from('wallets').select('id,user_id,balance,updated_at').eq('user_id', userId).maybeSingle();
        if (error) throw error;
        if (data) return data;
        const { data: created, error: createError } = await client.from('wallets').insert([{ user_id: userId, balance: 0 }]).select('id,user_id,balance,updated_at').single();
        if (createError) throw createError;
        return created;
      };

      window.openStoredPrintFile = async function (filePath, fileBucket = 'documents') {
        if (!filePath) return notifyV12('ยังไม่มีไฟล์ออนไลน์', 'รายการนี้ไม่มีตำแหน่งไฟล์ใน Storage', 'file-warning');
        if (/^https?:\/\//i.test(filePath)) { window.open(filePath, '_blank', 'noopener,noreferrer'); return; }
        try {
          const { data, error } = await db().storage.from(fileBucket || 'documents').createSignedUrl(filePath, 900);
          if (error || !data?.signedUrl) throw error || new Error('สร้างลิงก์ไฟล์ชั่วคราวไม่สำเร็จ');
          window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
        } catch (err) { notifyV12('เปิดไฟล์ไม่สำเร็จ', err.message || 'ตรวจสอบ Storage Policy', 'file-warning'); }
      };

      window.openQueueDetailModal = async function (orderId) {
        let order = (window.__pdAdminOrders || []).find(o => String(o.id) === String(orderId)) || (currentOrdersList || []).find(o => String(o.id) === String(orderId));
        try {
          if (!order) {
            const r = await db().from('orders').select('id,user_id,queue_number,total_amount,status,estimated_pickup,admin_note,created_at').eq('id', orderId).maybeSingle();
            if (r.error) throw r.error; order = (await hydrateOrdersV12(r.data ? [r.data] : []))[0];
          }
          if (!order) return notifyV12('ไม่พบข้อมูล', 'ไม่พบรายละเอียดคิวนี้', 'search-x');
          const set = (id, val) => { const e = $(id); if (e) e.textContent = val ?? '-'; };
          set('qd-modal-order-id', `คิว #${order.queue_number ?? order.id}`);
          set('qd-modal-filename', order.file_name);
          set('qd-modal-pages', `${order.page_count || 1} หน้า`);
          set('qd-modal-copies', `${order.copies || 1} ชุด`);
          set('qd-modal-paper', order.paper_size || 'A4');
          set('qd-modal-color', order.is_color ? 'พิมพ์สี' : 'ขาว-ดำ');
          set('qd-modal-duplex', order.is_duplex ? 'พิมพ์หน้า-หลัง' : 'หน้าเดียว');
          set('qd-modal-notes', order.admin_note || 'ไม่มีหมายเหตุเพิ่มเติม');
          set('qd-modal-totalprice', `${money(order.total_price)} ฿`);
          set('qd-modal-paymethod', order.payment_method === 'coins' ? 'Coins' : 'PromptPay');
          set('qd-modal-pickup-info', order.delivery_method === 'delivery' ? '🚚 การรับสินค้า: จัดส่งพัสดุ' : '📍 การรับสินค้า: รับหน้าร้านโดยตรง');
          const track = $('qd-modal-tracking-box');
          if (order.delivery_method === 'delivery') {
            set('qd-modal-tracking-num', order.tracking_number ? `เลข Tracking: ${order.tracking_number} (${order.delivery_provider || 'ผู้ให้บริการขนส่ง'})` : 'กำลังเตรียมจัดส่ง');
            set('qd-modal-recipient-info', `ผู้รับ: ${order.recipient_name || '-'} (${order.recipient_phone || '-'}) | ที่อยู่: ${order.recipient_address || '-'}`);
            track?.classList.remove('hidden');
          } else track?.classList.add('hidden');
          const slip = $('qd-modal-slip-box');
          if (order.slip_url) { const im = $('qd-modal-slip-img'); if (im) im.src = order.slip_url; slip?.classList.remove('hidden') } else slip?.classList.add('hidden');
          const badge = $('qd-modal-status-badge');
          if (badge) {
            const map = { queued: ['รอคิว', 'bg-amber-500/15 text-amber-400'], printing: ['กำลังพิมพ์', 'bg-blue-500/15 text-blue-400'], completed: ['พิมพ์เสร็จแล้ว', 'bg-emerald-500/15 text-emerald-400'], cancelled: ['ยกเลิก', 'bg-rose-500/15 text-rose-400'] };
            const [txt, cls] = map[order.status] || map.queued; badge.textContent = txt; badge.className = `px-3 py-1 rounded-full text-xs font-black ${cls}`;
          }
          const modal = $('queue-detail-modal'); if (modal) { modal.classList.remove('hidden'); modal.setAttribute('aria-hidden', 'false'); document.body.style.overflow = 'hidden'; }
          window.lucide?.createIcons();
        } catch (err) { notifyV12('เปิดข้อมูลไม่สำเร็จ', err.message || 'ไม่สามารถโหลดคิวได้', 'database-zap'); }
      };

      window.promptTracking = async function (orderId) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        const trackingInput = await window.pdAskTracking?.();
        if (!trackingInput) return;
        const tracking = trackingInput.tracking;
        if (tracking.length > 100) return notifyV12('Tracking ไม่ถูกต้อง', 'หมายเลข Tracking ยาวเกินกำหนด', 'alert-triangle');
        try {
          const r = await db().from('deliveries').update({ tracking_number: tracking, delivery_provider: trackingInput.provider }).eq('order_id', orderId).select('id,tracking_number,delivery_provider').maybeSingle();
          if (r.error) throw r.error;
          if (!r.data) throw new Error('ไม่พบรายการจัดส่งของออเดอร์นี้');
          notifyV12('บันทึก Tracking สำเร็จ', 'ข้อมูลถูกบันทึกในตาราง deliveries แล้ว', 'shield-check');
          await window.loadAdminData?.();
        } catch (err) { notifyV12('บันทึก Tracking ไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาด', 'shield-alert'); }
      };

      window.updateOrderStatus = async function (orderId, newStatus) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        if (!['queued', 'printing', 'completed', 'cancelled'].includes(newStatus)) return notifyV12('สถานะไม่ถูกต้อง', 'สถานะต้องเป็น queued, printing หรือ completed', 'shield-alert');
        try {
          const r = await db().from('orders').update({ status: newStatus }).eq('id', orderId).select('id,status').maybeSingle();
          if (r.error) throw r.error; if (!r.data) throw new Error('ไม่พบออเดอร์หรือ UPDATE ไม่สำเร็จ');
          notifyV12('อัปเดตสถานะสำเร็จ', `คิว #${orderId} เปลี่ยนเป็น ${newStatus}`, 'shield-check');
          await window.loadAdminData?.(); await window.fetchQueues?.();
        } catch (err) { notifyV12('อัปเดตสถานะไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาด', 'shield-alert'); }
      };

      window.approveTopup = async function (topupId, _userId, _amount) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        // Legacy/pre-fix requests may be pending without an automatic verification result.
        // Require an explicit manual confirmation before crediting any such request.
        try {
          const review = await db().from('topups').select('*').eq('id', topupId).maybeSingle();
          if (review.error) throw review.error;
          if (!review.data || review.data.status !== 'pending') return notifyV12('รายการถูกจัดการแล้ว', 'ไม่พบคำขอที่ยังรออนุมัติ', 'shield-check');
          if (review.data.verification_status !== 'verified') {
            const proceed = window.confirm('คำขอนี้ยังไม่มีผลตรวจอัตโนมัติที่บันทึกไว้ (อาจเป็นรายการเก่าก่อนแก้ระบบ)\n\nก่อนอนุมัติ ให้เปิดดูสลิปและตรวจยอดเงิน วันเวลา เลขอ้างอิง และบัญชีผู้รับจากรายการโอนจริงด้วยตนเอง\n\nต้องการดำเนินการตรวจด้วยตนเองต่อหรือไม่?');
            if (!proceed) return;
          }
        } catch (reviewError) {
          return notifyV12('ตรวจคำขอก่อนอนุมัติไม่สำเร็จ', reviewError.message || 'ไม่สามารถอ่านคำขอจากฐานข้อมูลได้', 'shield-alert');
        }
        let claimed = false, walletChanged = false, ledgerCreated = false, rollbackSafe = true;
        let walletId = null, before = 0, after = 0;
        try {
          // Claim the pending row first, then trust only the values read back from Postgres.
          const claim = await db().from('topups').update({ status: 'approved' })
            .eq('id', topupId).eq('status', 'pending').select('id,user_id,amount').maybeSingle();
          if (claim.error) throw claim.error;
          if (!claim.data) return notifyV12('รายการถูกจัดการแล้ว', 'คำขอนี้ไม่ได้อยู่ในสถานะ pending', 'shield-check');
          claimed = true;
          const targetUserId = claim.data.user_id;
          const value = Number(claim.data.amount);
          if (!targetUserId || !Number.isFinite(value) || ![20, 50, 100, 200, 500].includes(value)) {
            throw new Error('ข้อมูลคำขอเติมเงินไม่ถูกต้อง: user_id/amount ไม่ตรงกับแพ็กเกจที่ระบบอนุญาต');
          }
          const wallet = await window.ensureUserWalletV12(targetUserId);
          walletId = wallet.id;
          before = Number(wallet.balance || 0);
          if (!Number.isFinite(before) || before < 0) throw new Error('ยอด Wallet ปัจจุบันไม่ถูกต้อง');
          after = Number((before + value).toFixed(2));
          const changed = await db().from('wallets').update({ balance: after, updated_at: new Date().toISOString() })
            .eq('id', wallet.id).eq('balance', before).select('id,balance').maybeSingle();
          if (changed.error || !changed.data) throw changed.error || new Error('ยอด Coins เปลี่ยนระหว่างการอนุมัติ');
          walletChanged = true;
          const tx = await db().from('wallet_transactions').insert([{
            wallet_id: wallet.id, order_id: null, transaction_type: 'topup', amount: value,
            description: 'เติมเงิน Coins ผ่านสลิปโอนเงิน', transaction_date: new Date().toISOString()
          }]);
          if (tx.error) throw tx.error;
          ledgerCreated = true;
          notifyV12('อนุมัติเรียบร้อย', `เพิ่ม ${money(value)} Coins ให้ผู้ใช้แล้ว`, 'shield-check');
          await window.loadAdminData?.();
        } catch (err) {
          // Roll back only if the balance is still exactly the value written by this operation.
          if (walletChanged && !ledgerCreated && walletId) {
            try {
              const restored = await db().from('wallets').update({ balance: before, updated_at: new Date().toISOString() })
                .eq('id', walletId).eq('balance', after).select('id').maybeSingle();
              rollbackSafe = !restored.error && !!restored.data;
            } catch (_) { rollbackSafe = false; }
          }
          // Never return a row to pending when a balance change may have survived: that can double-credit on retry.
          if (claimed && (!walletChanged || (walletChanged && !ledgerCreated && rollbackSafe))) {
            try { await db().from('topups').update({ status: 'pending' }).eq('id', topupId).eq('status', 'approved'); } catch (_) { }
          }
          if (walletChanged && !ledgerCreated && !rollbackSafe) {
            console.error('[PrintDekD] Top-up needs reconciliation; status retained to prevent duplicate credit.', { topupId, walletId, before, after });
            notifyV12('ต้องตรวจสอบรายการเติม Coins', 'ไม่สามารถยืนยันการคืนยอด Wallet ได้ ระบบคงสถานะคำขอไว้เพื่อป้องกันการเติมซ้ำ กรุณาตรวจสอบ Wallet และประวัติธุรกรรมก่อนดำเนินการต่อ', 'shield-alert');
          } else {
            notifyV12('อนุมัติไม่สำเร็จ', err.message || 'ระบบยกเลิกรายการเพื่อความปลอดภัย', 'shield-alert');
          }
        }
      };

      window.rejectTopup = async function (topupId) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        try {
          const r = await db().from('topups').update({ status: 'rejected' }).eq('id', topupId).eq('status', 'pending').select('id').maybeSingle();
          if (r.error) throw r.error; if (!r.data) return notifyV12('รายการถูกจัดการแล้ว', 'คำขอนี้ไม่อยู่ในสถานะ pending แล้ว', 'shield-check');
          notifyV12('ปฏิเสธคำขอแล้ว', 'สถานะถูกบันทึกใน topups', 'x-circle'); await window.loadAdminData?.();
        } catch (err) { notifyV12('ปฏิเสธรายการไม่สำเร็จ', err.message || 'เกิดข้อผิดพลาด', 'shield-alert'); }
      };


      window.handleTopupSubmit = async function (e) {
        e?.preventDefault();
        const client = db(), user = window.currentUser;
        if (!user) return notifyV12('กรุณาล็อกอิน', 'กรุณาล็อกอินก่อนทำรายการเติมเงิน', 'lock');
        if (!client) return notifyV12('ฐานข้อมูลยังไม่พร้อม', 'ระบบไม่รับคำขอเติมเงินในโหมดออฟไลน์', 'database-zap');
        const amount = Number($('selected-topup-amount')?.value || 20);
        if (![20, 50, 100, 200, 500].includes(amount)) return notifyV12('แพ็กเกจไม่ถูกต้อง', 'กรุณาเลือกจำนวน Coins จากแพ็กเกจที่ระบบกำหนด', 'shield-alert');
        const file = $('topup-slip-file')?.files?.[0];
        if (!file) return notifyV12('ยังไม่ได้แนบสลิป', 'กรุณาแนบสลิปการโอนเงินจริงก่อนส่งคำขอ', 'file-warning');

        // Critical fix: the previous handler only checked the file MIME/size and never
        // called /api/verify-slip. Any JPG/PNG/WEBP was therefore queued as pending.
        let verification;
        try {
          verification = await verifySlipV12(file, amount);
        } catch (verifyError) {
          return notifyV12('ตรวจสลิปไม่ผ่าน', verifyError?.message || 'ระบบยังยืนยันสลิปไม่ได้ จึงไม่ได้บันทึกคำขอเติม Coins', 'shield-alert');
        }

        let slipPath = '', topupCreated = false;
        try {
          const safeName = String(file.name || 'slip').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 100) || 'slip.jpg';
          slipPath = `${user.id}/topup-${crypto.randomUUID()}-${safeName}`;
          await uploadToBucketV12('slips', file, slipPath);
          const { data: pub } = client.storage.from('slips').getPublicUrl(slipPath);
          const topupId = `TP-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const save = await insertVerifiedRecordV12(client, 'topups', {
            id: topupId,
            user_id: user.id,
            user_name: user.full_name || '',
            amount,
            slip_url: pub?.publicUrl || slipPath,
            status: 'pending',
            created_at: new Date().toISOString()
          }, verification);
          topupCreated = true;
          const note = save.metadataStored
            ? `SlipOK ตรวจสลิปผ่าน ยอด ${money(verification.amount)} บาทและส่งเลขอ้างอิงธุรกรรมแล้ว คำขอยังรอแอดมินอนุมัติ Coins จึงยังไม่เพิ่ม`
            : `SlipOK ตรวจสลิปผ่านแล้วและบันทึกคำขอไว้รอแอดมิน แต่ฐานข้อมูลยังไม่มีคอลัมน์เก็บผลตรวจ กรุณารัน database/printdekd-wallet-verification.sql ก่อนใช้งานจริง`;
          notifyV12(save.metadataStored ? 'ตรวจสลิปผ่านแล้ว' : 'บันทึกคำขอพร้อมคำเตือน', note, save.metadataStored ? 'shield-check' : 'alert-triangle');
          $('topup-slip-file').value = '';
          await window.fetchUserTopups?.();
        } catch (err) {
          if (!topupCreated) await removeStorageV12('slips', slipPath);
          notifyV12('ส่งคำขอไม่สำเร็จ', err.message || 'ไม่สามารถบันทึกข้อมูลได้', 'shield-alert');
        }
      };

      // Keep the Admin status dropdown values aligned with pd_update_order_status_v2.
      // Old rows are displayed explicitly so the browser never silently falls back to the first option.
      function normalizeAdminStatusValueV12(rawStatus) {
        const status = String(rawStatus || 'queued').toLowerCase();
        return ({ pending: 'queued' })[status] || status;
      }

      function renderAdminStatusSelectV12(ord) {
        const rawStatus = String(ord.status || 'queued').toLowerCase();
        const current = normalizeAdminStatusValueV12(rawStatus);
        const delivery = ord.delivery_method === 'delivery';
        const hasTracking = Boolean(String(ord.tracking_number || '').trim() && String(ord.delivery_provider || '').trim());
        const labels = {
          queued: 'รอจัดการงานพิมพ์', printing: 'กำลังพิมพ์ (จากระบบเดิม)', completed: 'พิมพ์เสร็จแล้ว (ยืนยันหลังตรวจจริง)',
          preparing: 'กำลังจัดเตรียม / เข้าเล่ม', ready_for_pickup: delivery ? 'พร้อมจัดส่ง' : 'พร้อมรับเอกสาร',
          shipped: 'จัดส่งแล้ว', finished: 'ส่งมอบเรียบร้อย', failed: 'ต้องตรวจสอบแก้ไข', cancelled: 'ยกเลิกแล้ว'
        };
        let allowed;
        if (current === 'queued') allowed = ['queued', 'completed', 'failed', 'cancelled'];
        else if (current === 'printing') allowed = ['printing', 'completed', 'failed'];
        else if (current === 'preparing') allowed = ['preparing', 'ready_for_pickup', 'failed'];
        else if (current === 'ready_for_pickup') allowed = ['ready_for_pickup', ...(delivery ? ['shipped'] : ['finished'])];
        else if (current === 'shipped') allowed = ['shipped', 'finished'];
        else if (current === 'failed') allowed = ['failed', 'queued', 'cancelled'];
        else if (current === 'finished' || current === 'cancelled') allowed = [current];
        else if (current === 'completed') allowed = ['completed', 'preparing'];
        else allowed = [current];

        const options = allowed.map(value => {
          const label = labels[value] || `สถานะเดิม: ${value}`;
          const disabled = value === 'shipped' && delivery && !hasTracking && current !== 'shipped';
          const suffix = disabled ? ' · กรุณาบันทึกเลขพัสดุก่อน' : '';
          return `<option value="${safe(value)}" ${value === current ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${safe(label + suffix)}</option>`;
        });
        if (!allowed.includes(current)) options.unshift(`<option value="${safe(current)}" selected>สถานะเดิม: ${safe(current)}</option>`);
        const terminal = ['finished', 'cancelled'].includes(current);
        return `<select data-pd-admin-action="status" data-order-id="${safe(ord.id)}" data-current-status="${safe(current)}" aria-label="สถานะคิวงานพิมพ์" class="ui-input rounded-xl p-2 text-sm font-bold pd-admin-status-select" ${terminal ? 'disabled aria-disabled="true"' : ''}>${options.join('')}</select>`;
      }

      window.loadAdminData = async function () {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        try {
          const client = db();
          const [or, tr, ur] = await Promise.all([
            client.from('orders').select('id,user_id,queue_number,total_amount,status,estimated_pickup,admin_note,created_at').order('created_at', { ascending: false }),
            client.from('topups').select('*').order('created_at', { ascending: false }),
            client.from('users').select('id,full_name,email,role')
          ]);
          const adminErrors = [];
          let orders = [];
          let orderDataError = or.error || null;
          if (or.error) adminErrors.push(`orders: ${or.error.message}`);
          else { try { orders = await hydrateOrdersV12(or.data || []); } catch (hydrateError) { orderDataError = hydrateError; adminErrors.push(`รายละเอียดคิว/ตารางที่เกี่ยวข้อง: ${hydrateError?.message || hydrateError}`); } }
          if (tr.error) adminErrors.push(`topups: ${tr.error.message}`);
          if (ur.error) adminErrors.push(`users/สิทธิ์สมาชิก: ${ur.error.message}`);
          window.__pdAdminOrders = orders; currentOrdersList = orders;
          const search = (v('pd-admin-search') || '').toLowerCase();
          const filtered = orders.filter(o => !search || [o.id, o.queue_number, o.file_name, o.user_name, o.user_email].some(x => String(x || '').toLowerCase().includes(search)));
          const tb = $('admin-orders-tbody');
          if (tb && orderDataError) tb.innerHTML = `<tr><td colspan="6" class="py-8 px-4 text-center text-rose-400">โหลดข้อมูลคิวไม่สำเร็จ: ${safe(orderDataError.message || String(orderDataError))}</td></tr>`;
          else if (tb) tb.innerHTML = filtered.map(ord => `<tr class="hover:bg-slate-200/50 dark:hover:bg-white/5 transition">
        <td class="py-3 px-3 font-mono text-blue-500 font-bold">#${safe(ord.queue_number ?? ord.id)}</td>
        <td class="py-3 px-3"><p class="font-bold titanium-text truncate max-w-[170px]">${safe(ord.file_name)}</p><p class="sub-text text-[10px]">${money(ord.total_price)} ฿ · ${ord.page_range ? `หน้าที่เลือก ${safe(ord.page_range)}` : `ทั้งหมด ${ord.page_count || 1} หน้า`}</p>${ord.file_path ? `<button type="button" data-pd-admin-action="open-file" data-file-path="${safe(ord.file_path)}" data-file-bucket="documents" class="mt-1 text-[12px] font-black text-blue-500 hover:underline">เปิดไฟล์</button>` : ''}</td>
        <td class="py-3 px-3">${ord.delivery_method === 'delivery' ? `<p class="text-blue-500 font-bold">🚚 จัดส่งพัสดุ</p><p class="sub-text text-[10px] truncate max-w-[150px]">${safe(ord.recipient_name)} (${safe(ord.recipient_phone)})</p>` : `<p class="text-emerald-500 font-bold">📍 หน้าร้าน</p>`}</td>
        <td class="py-3 px-3">${ord.slip_url ? `<button type="button" data-pd-admin-action="slip" data-slip-url="${safe(ord.slip_url)}" class="text-blue-500 underline font-bold">ดูสลิป</button>` : '<span class="sub-text">Coins</span>'}</td>
        <td class="py-3 px-3">${renderAdminStatusSelectV12(ord)}</td>
        <td class="py-3 px-3 text-right space-x-1">${ord.delivery_method === 'delivery' ? `<button type="button" data-pd-admin-action="tracking" data-order-id="${safe(ord.id)}" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold">Tracking</button>` : ''}<button type="button" data-pd-admin-action="detail" data-order-id="${safe(ord.id)}" class="px-3 py-2 ui-card rounded-xl text-sm font-bold">ดูข้อมูล</button><button type="button" data-pd-admin-action="delete-order" data-order-id="${safe(ord.id)}" class="px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white text-sm font-extrabold transition" aria-label="ลบคิว #${safe(ord.queue_number ?? ord.id)}"><span aria-hidden="true">⌫</span> ลบงาน</button></td>
      </tr>`).join('') || '<tr><td colspan="6" class="py-10 text-center sub-text">ยังไม่มีรายการ</td></tr>';

          const topupTb = $('admin-topups-tbody');
          if (topupTb && tr.error) topupTb.innerHTML = `<tr><td colspan="6" class="py-8 px-4 text-center text-rose-400">โหลดรายการเติม Coins ไม่สำเร็จ: ${safe(tr.error.message || String(tr.error))}</td></tr>`;
          else if (topupTb) topupTb.innerHTML = (tr.data || []).map(tp => `<tr data-pd-topup-row-id="${safe(tp.id)}" class="hover:bg-slate-200/50 dark:hover:bg-white/5 transition">
        <td class="py-3 px-3 sub-text text-[10px]">${safe(new Date(tp.created_at).toLocaleString('th-TH'))}</td>
        <td class="py-3 px-3 font-bold titanium-text">${safe(tp.user_name || tp.user_id)}</td>
        <td class="py-3 px-3 font-black text-amber-500">+${money(tp.amount)} Coins</td>
        <td class="py-3 px-3">${tp.slip_url ? `<button type="button" data-pd-admin-action="slip" data-slip-url="${safe(tp.slip_url)}" class="text-blue-500 underline font-bold">ดูสลิป</button>` : '-'}</td>
        <td class="py-3 px-3 font-bold ${tp.status === 'approved' ? 'text-emerald-500' : tp.status === 'rejected' ? 'text-rose-500' : 'text-amber-500'}"><div>${safe(tp.status || 'pending')}</div><div class="mt-1 text-[11px] font-semibold ${/ผู้ดูแลตรวจ/.test(String(tp.verification_message || '')) ? (tp.status === 'approved' ? 'text-emerald-500' : 'text-rose-500') : tp.verification_status === 'verified' ? 'text-emerald-500' : tp.verification_status === 'rejected' ? 'text-rose-500' : 'text-amber-500'}">${/ผู้ดูแลตรวจ/.test(String(tp.verification_message || '')) ? (tp.status === 'approved' ? 'Admin: ตรวจหลักฐานโอนแล้ว' : 'Admin: ปฏิเสธหลังตรวจหลักฐาน') : tp.verification_status === 'verified' ? 'SlipOK: ตรวจผ่าน' : tp.verification_status === 'rejected' ? 'SlipOK: ไม่ผ่าน' : tp.verification_status === 'manual_review' ? 'รอตรวจหลักฐานด้วยตนเอง' : 'ยังไม่มีผลตรวจอัตโนมัติ'}</div>${tp.verification_ref ? `<div class="mt-1 text-[10px] sub-text font-mono break-all">Ref: ${safe(tp.verification_ref)}</div>` : ''}</td>
        <td class="py-3 px-3 text-right">${tp.status === 'pending' ? `<div class="flex gap-2 justify-end"><button type="button" data-pd-admin-action="approve-topup" data-topup-id="${safe(tp.id)}" data-user-id="${safe(tp.user_id)}" data-amount="${Number(tp.amount)}" class="px-3 py-2 bg-emerald-600 text-white font-bold rounded-xl text-sm">อนุมัติ</button><button type="button" data-pd-admin-action="reject-topup" data-topup-id="${safe(tp.id)}" class="px-3 py-2 bg-rose-600 text-white font-bold rounded-xl text-sm">ปฏิเสธ</button></div>` : '-'}</td>
      </tr>`).join('') || '<tr><td colspan="6" class="py-10 text-center sub-text">ยังไม่มีคำขอเติม Coins</td></tr>';

          const userTb = $('admin-users-tbody');
          if (userTb && ur.error) userTb.innerHTML = `<tr><td colspan="4" class="py-8 px-4 text-center text-rose-400">โหลดรายชื่อสมาชิก/สิทธิ์ไม่สำเร็จ: ${safe(ur.error.message || String(ur.error))}<br><span class="text-xs">ตรวจสอบ RLS/Policy ของ public.users ใน Supabase</span></td></tr>`;
          else if (userTb) userTb.innerHTML = (ur.data || []).map(u => {
            const legacyStaff = String(u.role || '').toLowerCase() === 'staff';
            const shownRole = legacyStaff ? 'employee' : String(u.role || 'member').toLowerCase();
            const roleName = shownRole === 'admin' ? 'Admin' : shownRole === 'employee' ? 'Employee' : 'Member';
            return `<tr class="pd-admin-user-row hover:bg-slate-200/50 dark:hover:bg-white/5 transition"><td class="py-3 px-3 font-bold titanium-text">${safe(u.full_name)}</td><td class="py-3 px-3 sub-text">${safe(u.email)}</td><td class="py-3 px-3 font-bold ${shownRole === 'admin' ? 'text-purple-500' : shownRole === 'employee' ? 'text-emerald-500' : 'sub-text'}"><span>${roleName}</span>${legacyStaff ? '<span class="pd-legacy-role-note">Staff เดิม · จะเปลี่ยนเป็น Employee</span>' : ''}</td><td class="py-3 px-3 text-right"><div class="pd-role-editor"><select data-pd-role-select data-user-id="${safe(u.id)}" data-current-role="${safe(u.role)}" class="ui-input rounded-lg p-2 text-xs" aria-label="กำหนดสิทธิ์ ${safe(u.full_name || u.email)}"><option value="member" ${shownRole==='member'?'selected':''}>Member · ลูกค้า</option><option value="employee" ${shownRole==='employee'?'selected':''}>Employee · พนักงาน</option><option value="admin" ${shownRole==='admin'?'selected':''}>Admin · ผู้ดูแลระบบ</option></select><button type="button" data-pd-role-save data-user-id="${safe(u.id)}" class="pd-role-save-btn px-3 py-2 ui-card rounded-xl text-xs font-extrabold">บันทึกสิทธิ์</button></div></td></tr>`;
          }).join('') || '<tr><td colspan="4" class="py-10 text-center sub-text">ยังไม่มีสมาชิก</td></tr>';

          $('pd-admin-orders-count') && ($('pd-admin-orders-count').textContent = String(orders.length));
          $('pd-admin-pending-count') && ($('pd-admin-pending-count').textContent = String(orders.filter(o => o.status === 'queued').length));
          $('pd-admin-topup-count') && ($('pd-admin-topup-count').textContent = String((tr.error ? [] : (tr.data || [])).filter(x => x.status === 'pending').length));
          window.lucide?.createIcons();
          if (adminErrors.length) notifyV12('โหลดข้อมูล Admin ได้บางส่วน', adminErrors.join('\n'), 'database');
        } catch (err) { notifyV12('โหลดข้อมูล Admin ไม่สำเร็จ', err.message || 'ไม่สามารถดึงข้อมูลได้', 'shield-alert'); }
      };

      window.filterAdminWorkspace = () => window.loadAdminData?.();

      /* No extra switchView wrapper here: the original switchView already refreshes
         the selected view. Wrapping it and calling these same loaders again doubled
         database traffic on every navigation. */

      /* Prevent the old schema probe from blocking the new normalized model. */
      window.pdV11EnsureOrderSchema = async () => true;

      /* Diagnostics now checks the actual live tables/columns instead of orders.copies. */
      window.pdV11RunDiagnostics = async function () {
        const client = db(); const rows = [];
        if (!client) return ['❌ Supabase: ยังไม่เชื่อมต่อ'];
        const checks = [
          ['orders', 'id,user_id,queue_number,total_amount,status,created_at'],
          ['documents', 'id,user_id,file_name,file_path,page_count,file_size,created_at'],
          ['print_jobs', 'id,order_id,document_id,copies,color,paper_size,duplex,status,page_range'],
          ['deliveries', 'id,order_id,delivery_method,recipient_name,phone_number,delivery_address,delivery_provider,tracking_number'],
          ['payments', 'id,order_id,amount,status,payment_method,slip_url,created_at'],
          ['wallets', 'id,user_id,balance,updated_at'],
          ['wallet_transactions', 'id,wallet_id,order_id,transaction_type,amount,description,transaction_date'],
          ['pricing', 'id,paper_size,black_white_price,color_price,duplex_price']
        ];
        for (const [table, cols] of checks) {
          try { const r = await client.from(table).select(cols).limit(1); rows.push(r.error ? `❌ ${table}: ${r.error.message}` : `✅ ${table}: schema OK`); } catch (e) { rows.push(`❌ ${table}: ${e.message}`); }
        }
        notifyV12('ตรวจสอบฐานข้อมูล v12', rows.join('\n'), 'database');
        return rows;
      };

      /* Replace the old hard-coded price display when the user changes A4/A3.
         The authoritative total is still re-read from pricing at submission time. */
      window.pdV12RefreshPrice = async function () {
        try {
          const paper = v('paper-size') || 'A4', p = await loadPricingV12(paper);
          const pages = Math.max(1, parseInt(v('printed-pages-input')) || 1), copies = Math.max(1, parseInt(v('copies')) || 1);
          const color = v('color-type') === 'color', duplex = v('duplex-type') === 'duplex', delivery = q('input[name="delivery_method"]:checked')?.value === 'delivery';
          const rate = Number(color ? p.color_price : p.black_white_price) + (duplex ? Number(p.duplex_price) : 0);
          const printCost = pages * rate * copies, total = printCost + (delivery ? 30 : 0);
          if ($('total-price')) $('total-price').textContent = `${money(total)} ฿`;
          if ($('price-breakdown')) $('price-breakdown').textContent = delivery ? `(ค่าพิมพ์ ${money(printCost)} ฿ + ค่าจัดส่ง 30.00 ฿)` : `(${pages} หน้า × ${money(rate)} ฿ × ${copies} ชุด | รับหน้าร้านฟรี)`;
        } catch (_) { }
      };
      ['paper-size', 'copies', 'color-type', 'duplex-type', 'printed-pages-input'].forEach(id => $(id)?.addEventListener('change', () => window.pdV12RefreshPrice()));
      qa('input[name="delivery_method"]').forEach(x => x.addEventListener('change', () => window.pdV12RefreshPrice()));
      setTimeout(() => window.pdV12RefreshPrice(), 700);

      window.addEventListener('load', () => {
        window.fetchQueues?.();
        window.fetchUserTopups?.();
        if (window.currentUser?.role === 'admin') window.loadAdminData?.();
        window.pdV12RefreshPrice?.();
      });
    })();
  
