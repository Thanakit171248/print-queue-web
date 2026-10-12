
  (() => {
    'use strict';
    const form = document.getElementById('print-form');
    if (!form || typeof window.handleOrderSubmit !== 'function' || window.handleOrderSubmit.__pdOrderFeedbackWrapped) return;
    const originalSubmit = window.handleOrderSubmit;
    let submitting = false;
    window.handleOrderSubmit = async function (event) {
      event?.preventDefault();
      if (submitting) return;
      submitting = true;
      const button = event?.submitter || form.querySelector('button[type="submit"]');
      const originalMarkup = button?.innerHTML;
      if (button) {
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.classList.add('pd-order-submitting');
        button.innerHTML = '<span class="pd-submit-spinner" aria-hidden="true"></span><span>กำลังส่งคำสั่งพิมพ์…</span>';
      }
      try {
        return await originalSubmit.apply(this, arguments);
      } catch (error) {
        console.error('[PrintDekD] Unexpected checkout error:', error);
        if (typeof window.notifyV12 === 'function') {
          window.notifyV12('ส่งคำสั่งพิมพ์ไม่สำเร็จ', error?.message || 'เกิดข้อผิดพลาดที่ไม่คาดคิด กรุณาตรวจสอบคิวก่อนลองส่งอีกครั้ง', 'shield-alert');
        } else if (typeof window.showCustomModal === 'function') {
          window.showCustomModal({ title: 'ส่งคำสั่งพิมพ์ไม่สำเร็จ', message: error?.message || 'กรุณาตรวจสอบคิวก่อนลองส่งอีกครั้ง', icon: 'shield-alert' });
        }
      } finally {
        submitting = false;
        if (button?.isConnected) {
          button.disabled = false;
          button.removeAttribute('aria-busy');
          button.classList.remove('pd-order-submitting');
          button.innerHTML = originalMarkup || '<i data-lucide="send" class="w-5 h-5"></i> ยืนยันการสั่งพิมพ์';
          try { window.lucide?.createIcons?.(); } catch (_) { }
        }
      }
    };
    window.handleOrderSubmit.__pdOrderFeedbackWrapped = true;
  })();
