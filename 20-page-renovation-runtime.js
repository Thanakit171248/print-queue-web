
(() => {
  'use strict';
  const root = document.documentElement;
  const $ = (selector, scope = document) => scope.querySelector(selector);
  const paymentCard = $('#topup-qr-amount')?.closest('.bg-gradient-to-b');

  /* Build a semantic layout from the existing payment DOM; keep checkout handlers untouched. */
  function enhancePaymentCard() {
    const amount = $('#topup-qr-amount');
    if (!amount) return;
    const card = amount.closest('.bg-gradient-to-b');
    if (!card || card.dataset.pd23Enhanced === 'true') return;
    card.dataset.pd23Enhanced = 'true';
    card.classList.add('pd23-payment-card');

    const amountBadge = amount.closest('div');
    const qrImage = card.querySelector('img[alt*="PromptPay Topup QR"]');
    const qr = qrImage?.parentElement;
    const copyButton = card.querySelector('button[onclick*="copyPromptPay"]');
    const details = copyButton?.parentElement;
    amountBadge?.classList.add('pd23-amount');
    qr?.classList.add('pd23-qr');
    details?.classList.add('pd23-details');

    if (amountBadge && !amountBadge.querySelector('.pd23-amount-label')) {
      const label = document.createElement('span');
      label.className = 'pd23-amount-label';
      label.textContent = 'ยอดโอนที่เลือก';
      amountBadge.prepend(label);
    }
    if (details && !details.querySelector('.pd23-promptpay-note')) {
      const note = document.createElement('p');
      note.className = 'pd23-promptpay-note';
      note.setAttribute('role', 'note');
      note.textContent = 'QR นี้เป็น PromptPay แบบไม่ระบุยอด กรุณาตรวจสอบยอดที่แสดงและกรอกยอดให้ตรงก่อนยืนยันการโอน';
      details.append(note);
    }
    if (qrImage) {
      qrImage.width = 220;
      qrImage.height = 220;
      qrImage.loading = 'lazy';
      qrImage.decoding = 'async';
      qrImage.setAttribute('fetchpriority', 'low');
    }
    const amountValue = Number.parseFloat(amount.textContent || '0');
    if (Number.isFinite(amountValue)) amount.textContent = amountValue.toFixed(2);
  }

  /* No perpetual JS animation loop: pause only selected decorative CSS while page is hidden. */
  function syncVisibilityMotion() {
    root.classList.toggle('pd23-tab-hidden', document.visibilityState === 'hidden');
  }
  document.addEventListener('visibilitychange', syncVisibilityMotion, { passive: true });

  /* Lightweight, local-only diagnostics. No user data or file names are transmitted. */
  window.pdV23Diagnostics = function () {
    const doc = document.documentElement;
    const nav = navigator;
    const result = {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      documentWidth: doc.scrollWidth,
      horizontalOverflow: doc.scrollWidth > doc.clientWidth + 2,
      deviceMemoryGB: Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : null,
      hardwareConcurrency: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null,
      reducedMotion: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
      paymentCardEnhanced: !!$('.pd23-payment-card'),
      qrImageLoaded: !!$('#topup-qr-amount')?.closest('.pd23-payment-card')?.querySelector('img')?.complete,
      secureContext: !!window.isSecureContext,
      supabaseConfigured: !!window.supabaseClient
    };
    console.info('[PrintDekD v23 diagnostics]', result);
    return result;
  };

  /* Record browser performance entries locally for DevTools debugging; do not upload telemetry. */
  if ('PerformanceObserver' in window) {
    try {
      const supported = PerformanceObserver.supportedEntryTypes || [];
      if (supported.includes('longtask')) {
        const observer = new PerformanceObserver(list => {
          for (const entry of list.getEntries()) {
            if (entry.duration >= 100) console.debug('[PrintDekD performance] long task', Math.round(entry.duration) + 'ms');
          }
        });
        observer.observe({ type: 'longtask', buffered: false });
      }
    } catch (_) { /* Unsupported browser: diagnostics remain optional. */ }
  }

  function syncPrintPaymentAmount() {
    const source = $('#total-price'), target = $('#pd-print-qr-amount');
    if (!source || !target) return;
    const amount = Number.parseFloat(String(source.textContent || '').replace(/[^0-9.]/g, ''));
    if (Number.isFinite(amount)) target.textContent = amount.toFixed(2);
  }

  function init() {
    enhancePaymentCard();
    syncPrintPaymentAmount();
    const priceSource = $('#total-price');
    if (priceSource && 'MutationObserver' in window && !priceSource.dataset.pd24AmountObserver) {
      priceSource.dataset.pd24AmountObserver = 'true';
      new MutationObserver(syncPrintPaymentAmount).observe(priceSource, { childList:true, characterData:true, subtree:true });
    }
    const printForm = $('#print-form');
    printForm?.addEventListener('input', syncPrintPaymentAmount, { passive:true });
    printForm?.addEventListener('change', syncPrintPaymentAmount, { passive:true });
    syncVisibilityMotion();
    if (window.lucide?.createIcons) {
      try { window.lucide.createIcons(); } catch (_) { /* Icon rendering is non-critical. */ }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
