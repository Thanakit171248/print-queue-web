/* PrintDekD Admin UX v6 — safe deletion actions for service configuration.
 * Keeps historical orders intact: binding options referenced by old orders/jobs are disabled,
 * not hard-deleted. Delivery configuration is deleted independently from delivery history rows.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const client = () => window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const isAdmin = () => String(window.currentUser?.role || '').toLowerCase() === 'admin';
  const esc = (value) => typeof window.escapeHtml === 'function'
    ? window.escapeHtml(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const notice = (title, message, icon = 'info') => {
    if (typeof window.notifyV12 === 'function') return window.notifyV12(title, message, icon);
    if (typeof window.showCustomModal === 'function') return window.showCustomModal({ title, message, icon });
  };

  function confirmDelete({ title, message, onConfirm }) {
    if (typeof window.pdShowAppConfirm === 'function') {
      return window.pdShowAppConfirm({
        title, message, icon: 'trash-2', confirmText: 'ยืนยันลบ', cancelText: 'ยกเลิก', danger: true,
        onConfirm: async () => { try { await onConfirm(); } catch (error) { console.error('[PrintDekD] Delete failed', error); } }
      });
    }
    // Fallback only if the shared app dialog is missing from a partial deployment.
    if (window.confirm(`${title}\n\n${message}`)) return onConfirm();
  }

  async function reloadServices() {
    if (typeof window.pdReloadAdminServices === 'function') await window.pdReloadAdminServices();
    window.lucide?.createIcons?.();
  }

  async function countByValue(table, column, value) {
    const response = await client().from(table).select('id', { count: 'exact', head: true }).eq(column, value);
    if (response.error) throw response.error;
    return Number(response.count || 0);
  }

  async function countDeliveryProviderReferences(providerKey, itemName) {
    // Employee records the carrier as text, so check both the stable config key and
    // the display name. If the query cannot be completed, the option is preserved.
    const response = await client().from('deliveries')
      .select('order_id', { count: 'exact', head: true })
      .in('delivery_provider', [...new Set([String(providerKey || '').trim(), String(itemName || '').trim()].filter(Boolean))]);
    if (response.error) throw response.error;
    return Number(response.count || 0);
  }

  async function disableBindingInsteadOfDelete(id, itemName, reason) {
    const { error } = await client().from('binding_options')
      .update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw error;
    await reloadServices();
    notice('ปิดใช้งานบริการเข้าเล่มแล้ว', `${itemName} ถูกนำออกจากตัวเลือกสำหรับคำสั่งพิมพ์ใหม่ แต่เก็บรายการไว้เพื่อรักษาประวัติงานเดิม${reason ? ` (${reason})` : ''}`, 'check-circle-2');
  }

  async function deleteBinding(id, itemName, button) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'การลบบริการทำได้เฉพาะ Admin เท่านั้น', 'shield-alert');
    const db = client();
    if (!db) return notice('ฐานข้อมูลไม่พร้อม', 'เชื่อมต่อระบบฐานข้อมูลไม่ได้ จึงยังไม่มีการเปลี่ยนแปลง', 'database-zap');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      // Disable first so the active service is no longer offered while references are checked.
      const { error: pauseError } = await db.from('binding_options')
        .update({ active: false, updated_at: new Date().toISOString() }).eq('id', id);
      if (pauseError) throw pauseError;
      let ordersCount = 0, jobsCount = 0;
      try {
        [ordersCount, jobsCount] = await Promise.all([
          countByValue('orders', 'binding_option_id', id),
          countByValue('print_jobs', 'binding_option_id', id)
        ]);
      } catch (checkError) {
        // If history cannot be checked confidently, never hard-delete a referenced configuration.
        await disableBindingInsteadOfDelete(id, itemName, 'ตรวจสอบประวัติไม่ครบ จึงเลือกเก็บข้อมูลอย่างปลอดภัย');
        return;
      }
      if (ordersCount > 0 || jobsCount > 0) {
        await disableBindingInsteadOfDelete(id, itemName, `พบงานเดิม ${Math.max(ordersCount, jobsCount)} รายการที่อาจอ้างอิงบริการนี้`);
        return;
      }
      const { error } = await db.from('binding_options').delete().eq('id', id);
      if (error) {
        if (/foreign key|constraint|violates/i.test(String(error.message || ''))) {
          await disableBindingInsteadOfDelete(id, itemName, 'ฐานข้อมูลมีประวัติที่อ้างอิงรายการนี้');
          return;
        }
        throw error;
      }
      await reloadServices();
      notice('ลบบริการเข้าเล่มแล้ว', `นำ “${itemName}” ออกจากรายการบริการเรียบร้อย`, 'check-circle-2');
    } catch (error) {
      await reloadServices().catch(() => {});
      notice('ลบบริการไม่สำเร็จ', error?.message || 'หากรายการถูกปิดใช้งานก่อนเกิดข้อผิดพลาด ระบบเก็บไว้ในสถานะปิดใช้เพื่อป้องกันการนำไปใช้งานใหม่', 'shield-alert');
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  async function deleteDelivery(providerKey, itemName, button) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'การลบช่องทางจัดส่งทำได้เฉพาะ Admin เท่านั้น', 'shield-alert');
    const db = client();
    if (!db) return notice('ฐานข้อมูลไม่พร้อม', 'เชื่อมต่อระบบฐานข้อมูลไม่ได้ จึงยังไม่มีการเปลี่ยนแปลง', 'database-zap');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      // Remove the option from new checkout choices before attempting permanent deletion.
      const { error: pauseError } = await db.from('delivery_options')
        .update({ active: false, updated_at: new Date().toISOString() }).eq('provider_key', providerKey);
      if (pauseError) throw pauseError;
      let deliveriesCount = 0;
      try {
        deliveriesCount = await countDeliveryProviderReferences(providerKey, itemName);
      } catch (_) {
        await reloadServices();
        notice('ปิดใช้งานช่องทางจัดส่งแล้ว', `เก็บ “${itemName}” ไว้ในสถานะปิดใช้งาน เพราะตรวจประวัติการจัดส่งได้ไม่ครบ จึงยังไม่ลบถาวร`, 'check-circle-2');
        return;
      }
      if (deliveriesCount > 0) {
        await reloadServices();
        notice('ปิดใช้งานแทนการลบ', `พบประวัติการจัดส่ง ${deliveriesCount} รายการที่ใช้ผู้ให้บริการนี้ จึงปิดไม่ให้ใช้กับคำสั่งใหม่ โดยเก็บประวัติและ Tracking เดิมไว้`, 'check-circle-2');
        return;
      }
      const { error } = await db.from('delivery_options').delete().eq('provider_key', providerKey);
      if (error) {
        if (/foreign key|constraint|violates/i.test(String(error.message || ''))) {
          const { error: disableError } = await db.from('delivery_options')
            .update({ active: false, updated_at: new Date().toISOString() }).eq('provider_key', providerKey);
          if (disableError) throw disableError;
          await reloadServices();
          notice('ปิดใช้งานแทนการลบ', `ช่องทาง “${itemName}” มีข้อมูลที่อ้างอิงอยู่ จึงปิดไม่ให้ใช้กับคำสั่งใหม่ โดยไม่ลบประวัติเดิม`, 'check-circle-2');
          return;
        }
        throw error;
      }
      await reloadServices();
      notice('ลบช่องทางจัดส่งแล้ว', `นำ “${itemName}” ออกจากตัวเลือกจัดส่งแล้ว ข้อมูลจัดส่งและ Tracking ที่บันทึกในออเดอร์เดิมไม่ได้ถูกลบ`, 'check-circle-2');
    } catch (error) {
      await reloadServices().catch(() => {});
      notice('ลบช่องทางจัดส่งไม่สำเร็จ', error?.message || 'ถ้ารายการถูกปิดใช้ก่อนเกิดข้อผิดพลาด จะคงสถานะปิดไว้เพื่อป้องกันการเลือกใช้ใหม่', 'shield-alert');
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }


  async function deletePrice(paperSize, button) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'การลบชนิดกระดาษและราคา ทำได้เฉพาะ Admin เท่านั้น', 'shield-alert');
    const db = client();
    if (!db) return notice('ฐานข้อมูลไม่พร้อม', 'เชื่อมต่อระบบฐานข้อมูลไม่ได้ จึงยังไม่มีการเปลี่ยนแปลง', 'database-zap');
    if (button?.disabled) return;
    if (button) button.disabled = true;
    try {
      // Pause the price before deletion to avoid it being chosen for a new order mid-operation.
      const { error: pauseError } = await db.from('pricing')
        .update({ active: false, updated_at: new Date().toISOString() }).eq('paper_size', paperSize);
      if (pauseError) throw pauseError;
      let ordersCount = 0, jobsCount = 0;
      try {
        [ordersCount, jobsCount] = await Promise.all([
          countByValue('orders', 'paper_size', paperSize),
          countByValue('print_jobs', 'paper_size', paperSize)
        ]);
      } catch (_) {
        await reloadServices();
        notice('ปิดใช้เรตราคาแล้ว', `เก็บชนิดกระดาษ ${paperSize} ไว้ในสถานะปิดใช้ เพราะตรวจประวัติงานได้ไม่ครบ จึงยังไม่ลบถาวร`, 'check-circle-2');
        return;
      }
      if (ordersCount > 0 || jobsCount > 0) {
        await reloadServices();
        notice('ปิดใช้เรตราคาแทนการลบ', `พบออเดอร์ ${ordersCount} รายการ และงานพิมพ์ ${jobsCount} รายการที่ใช้กระดาษ ${paperSize} จึงปิดไม่ให้เลือกในคำสั่งใหม่ โดยเก็บประวัติเดิมไว้`, 'check-circle-2');
        return;
      }
      const { error } = await db.from('pricing').delete().eq('paper_size', paperSize);
      if (error) {
        if (/foreign key|constraint|violates/i.test(String(error.message || ''))) {
          const { error: disableError } = await db.from('pricing')
            .update({ active: false, updated_at: new Date().toISOString() }).eq('paper_size', paperSize);
          if (disableError) throw disableError;
          await reloadServices();
          notice('ปิดใช้เรตราคาแทนการลบ', `ชนิดกระดาษ ${paperSize} มีข้อมูลที่อ้างอิงอยู่ จึงปิดไม่ให้ใช้กับคำสั่งใหม่ โดยเก็บประวัติเดิมไว้`, 'check-circle-2');
          return;
        }
        throw error;
      }
      await reloadServices();
      notice('ลบชนิดกระดาษและราคาแล้ว', `นำเรตราคา ${paperSize} ออกจากตัวเลือกและการคำนวณคำสั่งพิมพ์ใหม่แล้ว ข้อมูลในออเดอร์เดิมไม่ได้ถูกลบ`, 'check-circle-2');
    } catch (error) {
      await reloadServices().catch(() => {});
      notice('ลบเรตราคาไม่สำเร็จ', error?.message || 'ถ้าเรตราคาถูกปิดใช้ก่อนเกิดข้อผิดพลาด จะคงสถานะปิดไว้เพื่อป้องกันการใช้กับออเดอร์ใหม่', 'shield-alert');
    } finally {
      if (button?.isConnected) button.disabled = false;
    }
  }

  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-pd-delete-price], button[data-pd-delete-binding], button[data-pd-delete-delivery]');
    if (!button) return;
    event.preventDefault();
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'การลบบริการทำได้เฉพาะ Admin เท่านั้น', 'shield-alert');
    if (button.hasAttribute('data-pd-delete-price')) {
      const paperSize = button.getAttribute('data-pd-delete-price');
      confirmDelete({
        title: 'ลบชนิดกระดาษและราคา?',
        message: `คุณเลือกเรตราคา ${paperSize}\n\nการลบนี้นำชนิดกระดาษออกจากตัวเลือกและการคำนวณคำสั่งพิมพ์ใหม่เท่านั้น ข้อมูลชนิดกระดาษและยอดเงินในออเดอร์เดิมจะไม่ถูกลบ`,
        onConfirm: () => deletePrice(paperSize, button)
      });
    } else if (button.hasAttribute('data-pd-delete-binding')) {
      const id = button.getAttribute('data-pd-delete-binding');
      const name = button.getAttribute('data-item-name') || 'บริการเข้าเล่มนี้';
      confirmDelete({
        title: 'ลบบริการเข้าเล่ม?',
        message: `คุณเลือก “${name}”\n\nถ้ามีคำสั่งพิมพ์เก่าอ้างอิงรายการนี้ ระบบจะปิดใช้งานแทนการลบถาวร เพื่อรักษาประวัติย้อนหลัง`,
        onConfirm: () => deleteBinding(id, name, button)
      });
    } else {
      const key = button.getAttribute('data-pd-delete-delivery');
      const name = button.getAttribute('data-item-name') || key || 'ช่องทางจัดส่งนี้';
      confirmDelete({
        title: 'ลบช่องทางจัดส่ง?',
        message: `คุณเลือก “${name}” (${key})\n\nระบบจะลบเฉพาะค่าตั้งต้นของช่องทางนี้ ไม่ลบข้อมูลผู้รับ ค่าจัดส่ง หรือ Tracking ที่บันทึกในคำสั่งพิมพ์เดิม`,
        onConfirm: () => deleteDelivery(key, name, button)
      });
    }
  });
})();
