
    // Global compatibility bridge for inline handlers and legacy callbacks.
    var notifyV12 = window.notifyV12 || function (title, message = '', icon = 'info') {
      if (typeof window.pdToast === 'function') return window.pdToast(title, message, icon);
      if (typeof window.showCustomModal === 'function') return window.showCustomModal({ title, message, icon });
      window.alert(`${String(title || 'แจ้งเตือนจากระบบ')}\n\n${String(message || '')}`);
      return false;
    };
    if (typeof window.notifyV12 !== 'function') window.notifyV12 = notifyV12;
  