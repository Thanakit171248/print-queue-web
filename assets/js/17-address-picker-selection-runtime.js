
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const db = () => window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
      const asText = value => String(value ?? '');

      function appNotice(title, message, icon = 'info') {
        if (typeof window.showCustomModal === 'function') {
          window.showCustomModal({ title, message, icon });
          const confirm = $('modal-confirm-btn'); if (confirm) confirm.textContent = 'ตกลง';
          const cancel = $('modal-cancel-btn'); if (cancel) cancel.textContent = 'ยกเลิก';
        } else window.alert(`${title}\n\n${message}`);
      }
      function appConfirm({ title, message, icon = 'alert-triangle', confirmText = 'ยืนยัน', onConfirm }) {
        if (typeof window.showCustomModal !== 'function') {
          if (window.confirm(`${title}\n\n${message}`)) onConfirm?.();
          return;
        }
        window.showCustomModal({ title, message, icon, showCancel: true, onConfirm });
        const confirm = $('modal-confirm-btn'); if (confirm) confirm.textContent = confirmText;
        const cancel = $('modal-cancel-btn'); if (cancel) cancel.textContent = 'ยกเลิก';
      }

      function decorateAdminResponsiveTables() {
        const labels = {
          'admin-orders-tbody': ['เลือก', 'คิว', 'ไฟล์และยอด', 'การจัดส่งและที่อยู่', 'ชำระเงินและสลิป', 'สถานะงานพิมพ์', 'การจัดการ'],
          'admin-topups-tbody': ['เลือก', 'วันที่', 'ผู้ใช้งาน', 'ยอดเงินและ Coins', 'รูปสลิป', 'สถานะ', 'จัดการคำขอ'],
          'admin-users-tbody': ['เลือก', 'ชื่อ-นามสกุล', 'อีเมล', 'สิทธิ์', 'จัดการสิทธิ์']
        };
        for (const [tbodyId, rowLabels] of Object.entries(labels)) {
          const tbody = $(tbodyId); if (!tbody) continue;
          tbody.querySelectorAll('tr').forEach(tr => {
            const cells = [...tr.querySelectorAll(':scope > td')];
            if (cells.length === 1 && cells[0].hasAttribute('colspan')) return;
            cells.forEach((cell, i) => { if (rowLabels[i]) cell.dataset.label = rowLabels[i]; });
          });
        }
      }

      function decorateProfileInputs() {
        const items = [
          ['edit-avatar-url', 'link-2', 'ลิงก์รูปโปรไฟล์'],
          ['edit-fullname', 'user-round', 'ชื่อ-นามสกุล']
        ];
        let changed = false;
        for (const [id, icon, label] of items) {
          const input = $(id);
          if (!input || input.closest('.pd-input-icon-wrap')) continue;
          const parent = input.parentElement; if (!parent) continue;
          const wrap = document.createElement('div'); wrap.className = 'pd-input-icon-wrap';
          parent.insertBefore(wrap, input); wrap.appendChild(input);
          const leading = document.createElement('span'); leading.className = 'pd-input-leading-icon'; leading.setAttribute('aria-hidden', 'true');
          const glyph = document.createElement('i'); glyph.setAttribute('data-lucide', icon); leading.appendChild(glyph); wrap.prepend(leading);
          input.classList.add('pd-profile-icon-input');
          if (!input.getAttribute('aria-label')) input.setAttribute('aria-label', label);
          changed = true;
        }
        if (changed) { try { window.lucide?.createIcons(); } catch (_) { } }
      }

      // Data-action event delegation avoids invalid inline onclick attributes with quoted IDs.
      document.addEventListener('click', async event => {
        const detailAction = event.target.closest('[data-pd-detail-action]');
        if (detailAction) {
          event.preventDefault();
          const detailType = detailAction.dataset.pdDetailAction;
          if (detailType === 'open-file') await window.openAdminFileViewer?.(detailAction.dataset.filePath, detailAction.dataset.fileBucket || 'documents', detailAction.dataset.fileName || 'เอกสาร', detailAction.dataset.fileMime || '');
          else if (detailType === 'slip') window.openSlipModal?.(detailAction.dataset.slipUrl);
          else if (detailType === 'close') window.closeQueueDetailModal?.();
          return;
        }
        const queueCard = event.target.closest('[data-pd-order-detail]');
        if (queueCard) { await window.openQueueDetailModal?.(queueCard.dataset.pdOrderDetail); return; }
        const button = event.target.closest('[data-pd-admin-action]');
        if (!button) return;
        const action = button.dataset.pdAdminAction;
        if (action === 'status') return;
        event.preventDefault();
        const orderId = button.dataset.orderId;
        switch (action) {
          case 'role':
            await window.changeUserRole?.(button.dataset.userId, button.dataset.targetRole);
            break;
          case 'delete-order':
            window.deleteCompletedPrintOrder?.(orderId);
            break;
          case 'detail':
            await window.openQueueDetailModal?.(orderId);
            break;
          case 'tracking':
            await window.promptTracking?.(orderId);
            break;
          case 'open-file':
            await window.openStoredPrintFile?.(button.dataset.filePath, button.dataset.fileBucket || 'documents');
            break;
          case 'slip':
            window.openSlipModal?.(button.dataset.slipUrl);
            break;
          case 'approve-topup':
            await window.approveTopup?.(button.dataset.topupId, button.dataset.userId, Number(button.dataset.amount));
            break;
          case 'reject-topup':
            await window.rejectTopup?.(button.dataset.topupId);
            break;
        }
      });
      document.addEventListener('keydown', async event => {
        if (!['Enter', ' '].includes(event.key)) return;
        const queueCard = event.target.closest('[data-pd-order-detail]');
        if (!queueCard) return;
        event.preventDefault();
        await window.openQueueDetailModal?.(queueCard.dataset.pdOrderDetail);
      });
      document.addEventListener('change', async event => {
        const control = event.target.closest('[data-pd-admin-action="status"]');
        if (!control) return;
        const orderId = control.dataset.orderId;
        // The selected value has already changed when a `change` event fires. Keep a
        // canonical previous value on the control itself instead of consulting the
        // shared queue cache, which can contain only the logged-in user's orders.
        const previous = control.dataset.currentStatus || control.value || 'queued';
        const requested = control.value;
        if (requested === previous) return;
        control.disabled = true;
        control.classList.add('pd-status-saving');
        try {
          const saved = await window.updateOrderStatus?.(orderId, requested);
          if (saved === true) control.dataset.currentStatus = requested;
          else if (control.isConnected) control.value = previous;
        } finally {
          if (control.isConnected) {
            control.disabled = false;
            control.classList.remove('pd-status-saving');
          }
        }
      });

      // Rebind responsive labels after every data refresh without duplicating listeners.
      const originalLoadAdminData = window.loadAdminData;
      if (typeof originalLoadAdminData === 'function' && !originalLoadAdminData.__pdV23Wrapped) {
        const wrapped = async function (...args) {
          const result = await originalLoadAdminData.apply(this, args);
          requestAnimationFrame(() => { decorateAdminResponsiveTables(); decorateProfileInputs(); });
          return result;
        };
        wrapped.__pdV23Wrapped = true;
        window.loadAdminData = wrapped;
      }

      window.changeUserRole = async function (userId, newRole) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        if (!['admin', 'member'].includes(String(newRole))) return appNotice('สิทธิ์ไม่ถูกต้อง', 'ระบบรองรับเฉพาะ Admin และ Member', 'shield-alert');
        if (String(window.currentUser?.id) === String(userId)) return appNotice('เปลี่ยนสิทธิ์ไม่ได้', 'ไม่สามารถเปลี่ยนสิทธิ์ของบัญชีที่กำลังใช้งานอยู่ได้ เพื่อป้องกันการล็อกตัวเองออกจากระบบ', 'shield-alert');
        const button = [...document.querySelectorAll('#admin-users-tbody [data-pd-admin-action="role"]')].find(b => String(b.dataset.userId) === String(userId));
        const performUpdate = async () => {
          const client = db();
          if (!client) return appNotice('ฐานข้อมูลยังไม่พร้อม', 'ยังเชื่อมต่อ Supabase ไม่สำเร็จ จึงไม่ได้เปลี่ยนสิทธิ์', 'database-zap');
          const beforeText = button?.textContent;
          if (button) { button.disabled = true; button.classList.add('pd-v23-busy'); button.textContent = 'กำลังบันทึก…'; }
          try {
            const result = await client.from('users').update({ role: newRole }).eq('id', userId).select('id,role').maybeSingle();
            if (result.error) throw result.error;
            if (!result.data || String(result.data.role) !== String(newRole)) throw new Error('ฐานข้อมูลไม่ยืนยันการเปลี่ยนสิทธิ์ ตรวจสอบ RLS Policy ของ public.users ว่า Admin มีสิทธิ์ UPDATE และ SELECT');
            appNotice('สลับสิทธิ์สำเร็จ', `เปลี่ยนสิทธิ์สมาชิกเป็น ${String(newRole).toUpperCase()} แล้ว`, 'shield-check');
            await window.loadAdminData?.();
          } catch (error) {
            const raw = error?.message || String(error);
            const hint = /row.level security|permission denied|not authorized|policy/i.test(raw) ? `${raw}\n\nตรวจสอบ RLS Policy ของตาราง public.users ใน Supabase` : raw;
            appNotice('เปลี่ยนสิทธิ์ไม่สำเร็จ', hint, 'shield-alert');
          } finally {
            if (button?.isConnected) { button.disabled = false; button.classList.remove('pd-v23-busy'); if (beforeText) button.textContent = beforeText; }
          }
        };
        appConfirm({
          title: 'ยืนยันการเปลี่ยนสิทธิ์',
          message: `ต้องการเปลี่ยนบัญชีนี้เป็น ${String(newRole).toUpperCase()} ใช่หรือไม่?\n\nระบบจะบันทึกลงฐานข้อมูลจริงเมื่อคุณยืนยัน`,
          icon: 'shield-check', confirmText: 'ยืนยันเปลี่ยนสิทธิ์', onConfirm: performUpdate
        });
      };

      window.deleteCompletedPrintOrder = async function (orderId) {
        if (typeof window.assertAdminAccess === 'function' && !window.assertAdminAccess()) return;
        const client = db();
        if (!client) return appNotice('ฐานข้อมูลยังไม่พร้อม', 'ไม่สามารถลบรายการได้จนกว่า Supabase จะเชื่อมต่อ', 'database-zap');
        // Always read the current status from the database before deciding whether deletion is allowed.
        let order;
        try {
          const lookup = await client.from('orders').select('id,queue_number,status').eq('id', orderId).maybeSingle();
          if (lookup.error) throw lookup.error;
          order = lookup.data;
          const cached = (window.__pdAdminOrders || []).find(o => String(o.id) === String(orderId));
          if (cached && order) { cached.status = order.status; cached.queue_number = order.queue_number ?? cached.queue_number; }
        } catch (error) { return appNotice('ตรวจสอบคิวไม่สำเร็จ', error?.message || String(error), 'shield-alert'); }
        if (!order) return appNotice('ไม่พบคิวงาน', 'ไม่พบรายการนี้ในฐานข้อมูล อาจมีผู้จัดการลบไปแล้ว', 'search-x');
        if (order.status !== 'completed') {
          const statusLabel = ({ queued: 'รอคิว', pending: 'รอคิว', printing: 'กำลังพิมพ์', cancelled: 'ยกเลิกแล้ว' })[order.status] || String(order.status || 'ไม่ทราบสถานะ');
          return appNotice('ยังลบงานนี้ไม่ได้', `คิว #${order.queue_number ?? order.id} มีสถานะ “${statusLabel}”\n\nระบบอนุญาตให้ลบได้เฉพาะงานที่มีสถานะ “พิมพ์เสร็จแล้ว” เท่านั้น กรุณาอัปเดตสถานะให้ถูกต้องก่อน`, 'alert-triangle');
        }
        appConfirm({
          title: 'ยืนยันการลบงานพิมพ์',
          message: `คิว #${order.queue_number ?? order.id} ทำงานเสร็จแล้ว\n\nเมื่อยืนยัน รายการจะถูกลบออกจากฐานข้อมูล หากต้องการเก็บประวัติไว้ กรุณากดยกเลิก`,
          icon: 'trash-2', confirmText: 'ยืนยันลบงาน',
          onConfirm: async () => {
            const rowButton = [...document.querySelectorAll('#admin-orders-tbody [data-pd-admin-action="delete-order"]')].find(b => String(b.dataset.orderId) === String(orderId));
            if (rowButton) { rowButton.disabled = true; rowButton.classList.add('pd-v23-busy'); rowButton.textContent = 'กำลังลบ…'; }
            try {
              // Read related document references before deletion. No child data is removed unless the parent deletion succeeds.
              const jobsResult = await client.from('print_jobs').select('id,document_id').eq('order_id', orderId);
              if (jobsResult.error) throw jobsResult.error;
              const documentIds = [...new Set((jobsResult.data || []).map(job => job.document_id).filter(Boolean).map(String))];
              let documentRows = [];
              if (documentIds.length) {
                const docsResult = await client.from('documents').select('id,file_path').in('id', documentIds);
                if (docsResult.error) throw docsResult.error;
                documentRows = docsResult.data || [];
              }
              const deleted = await client.from('orders').delete().eq('id', orderId).eq('status', 'completed').select('id').maybeSingle();
              if (deleted.error) throw deleted.error;
              if (!deleted.data) throw new Error('ฐานข้อมูลไม่ได้ยืนยันการลบ อาจมีการเปลี่ยนสถานะพร้อมกันหรือ RLS ไม่อนุญาต');

              // After successful parent deletion, clean orphaned document rows/files only when no other print job references them.
              for (const doc of documentRows) {
                try {
                  const references = await client.from('print_jobs').select('id').eq('document_id', doc.id).limit(1);
                  if (references.error || references.data?.length) continue;
                  if (doc.file_path && !/^https?:\/\//i.test(doc.file_path)) {
                    try { await client.storage.from('documents').remove([doc.file_path]); } catch (_) { }
                  }
                  await client.from('documents').delete().eq('id', doc.id);
                } catch (_) { /* Successful order deletion must not be misreported because optional file cleanup failed. */ }
              }
              appNotice('ลบงานพิมพ์สำเร็จ', `ลบคิว #${order.queue_number ?? order.id} ออกจากรายการแล้ว`, 'check-circle-2');
              await window.loadAdminData?.();
              await window.fetchQueues?.();
            } catch (error) {
              const raw = error?.message || String(error);
              const message = /foreign key|violates.*constraint|constraint/i.test(raw)
                ? `${raw}\n\nฐานข้อมูลยังมีตารางที่อ้างอิงคิวนี้อยู่ จึงยกเลิกการลบเพื่อป้องกันข้อมูลที่เกี่ยวข้องเสียหาย กรุณาตรวจสอบ Foreign Key ของ orders ใน Supabase`
                : raw;
              appNotice('ลบงานไม่สำเร็จ', message, 'shield-alert');
            } finally {
              if (rowButton?.isConnected) { rowButton.disabled = false; rowButton.classList.remove('pd-v23-busy'); rowButton.textContent = '⌫ ลบงาน'; }
            }
          }
        });
      };

      function ready() { decorateAdminResponsiveTables(); decorateProfileInputs(); }
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
      const profileForm = $('profile-edit-section');
      if (profileForm && 'MutationObserver' in window) {
        const observer = new MutationObserver(() => decorateProfileInputs());
        observer.observe(profileForm, { childList: true, subtree: true });
      }
      document.addEventListener('click', event => {
        if (event.target.closest('[onclick*="toggleProfileEdit(true)"]')) setTimeout(decorateProfileInputs, 80);
      }, true);
      const adminBody = $('view-admin');
      if (adminBody && 'MutationObserver' in window) {
        const observer = new MutationObserver(() => decorateAdminResponsiveTables());
        observer.observe(adminBody, { childList: true, subtree: true });
      }
    })();
  
