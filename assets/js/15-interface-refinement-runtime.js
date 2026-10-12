
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const safeDataImage = value => typeof value === 'string' && /^data:image\/(png|jpeg|webp);base64,/i.test(value);
      const setAvatarDraft = (value, preview = true) => {
        if (!safeDataImage(value)) return;
        // The legacy app stores cropped avatars as data URLs. Keep them out of the visible URL field.
        try { tempAvatarUrl = value; } catch (_) { }
        window.tempAvatarUrl = value;
        const input = $('edit-avatar-url');
        if (input) input.value = '';
        const image = $('pd-edit-avatar-preview');
        if (image && preview) image.src = value;
        const state = $('pd18-avatar-state');
        if (state) state.hidden = false;
      };

      function installProfileBranding() {
        const form = $('profile-edit-section');
        const stack = form?.querySelector('.pd-form-stack');
        if (!form || !stack) return;
        if (!stack.querySelector('.pd18-profile-brand')) {
          const brand = document.createElement('div');
          brand.className = 'pd18-profile-brand';
          const mark = document.createElement('span'); mark.className = 'pd18-profile-brandmark';
          const icon = document.createElement('i'); icon.setAttribute('data-lucide', 'printer'); mark.appendChild(icon);
          const copy = document.createElement('span'); copy.className = 'pd18-profile-brandcopy';
          const title = document.createElement('strong'); title.textContent = 'PrintDekD Pro';
          const label = document.createElement('small'); label.textContent = 'PROFILE STUDIO · ACCOUNT CENTER';
          copy.append(title, label); brand.append(mark, copy); stack.prepend(brand);
        }
        const url = $('edit-avatar-url');
        if (url) {
          const card = url.closest('.pd-field-card');
          const label = card?.querySelector('label');
          if (label) label.textContent = 'ลิงก์รูปโปรไฟล์ (ไม่บังคับ)';
          url.placeholder = 'https://example.com/avatar.webp';
          url.setAttribute('aria-label', 'ลิงก์ HTTPS ของรูปโปรไฟล์ (ไม่บังคับ)');
          let help = card?.querySelector('.pd18-avatar-help');
          if (card && !help) {
            help = document.createElement('p'); help.className = 'pd18-avatar-help';
            help.textContent = 'หรือเลือกรูปจากเครื่องเพื่อครอปเป็นสี่เหลี่ยม 1:1 ก่อนบันทึก ระบบจะไม่แสดงข้อมูล Base64 ในช่องนี้';
            card.appendChild(help);
          }
          if (card && !$('pd18-avatar-state')) {
            const state = document.createElement('div'); state.id = 'pd18-avatar-state'; state.className = 'pd18-avatar-state'; state.hidden = true;
            const i = document.createElement('i'); i.setAttribute('data-lucide', 'check-circle-2'); const t = document.createElement('span'); t.textContent = 'รูปที่ครอปแล้วพร้อมบันทึก'; state.append(i, t); card.appendChild(state);
          }
        }
        if (window.lucide) { try { window.lucide.createIcons(); } catch (_) { } }
      }

      // Wrap the existing profile editor instead of changing how the app saves profile records.
      const oldToggleProfileEdit = window.toggleProfileEdit;
      if (typeof oldToggleProfileEdit === 'function' && !oldToggleProfileEdit.__pd18) {
        const wrappedToggle = function (show) {
          const result = oldToggleProfileEdit.apply(this, arguments);
          if (show) requestAnimationFrame(() => {
            installProfileBranding();
            const url = $('edit-avatar-url');
            const current = window.currentUser?.avatar_url || '';
            const value = url?.value || '';
            if (safeDataImage(value)) setAvatarDraft(value, false);
            else if (safeDataImage(current)) setAvatarDraft(current, false);
            else {
              try { tempAvatarUrl = ''; } catch (_) { }
              window.tempAvatarUrl = '';
            }
            if (url && url.value.startsWith('data:')) url.value = '';
            const preview = $('pd-edit-avatar-preview');
            if (preview && current) preview.src = current;
            if (window.lucide) { try { window.lucide.createIcons(); } catch (_) { } }
          });
          return result;
        };
        wrappedToggle.__pd18 = true;
        window.toggleProfileEdit = wrappedToggle;
      }

      // Both the older and current cropper write data URLs into #edit-avatar-url. Move the result to draft state after the click handler runs.
      document.addEventListener('click', event => {
        const apply = event.target.closest('#pd-v10-crop-apply,#pd-crop-apply,#pd-crop-apply-v8');
        if (!apply) return;
        // Registration crops write into #reg-avatar-preview; do not let the legacy profile-draft listener touch them.
        if (apply.closest('#pd-v10-crop-modal')?.dataset.cropTarget === 'register') return;
        setTimeout(() => {
          const input = $('edit-avatar-url');
          if (input && safeDataImage(input.value)) {
            const data = input.value;
            setAvatarDraft(data, true);
            // Re-encode once to keep profile payloads small. This runs only on an explicit crop action.
            const image = new Image();
            image.onload = () => {
              try {
                const size = 384, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
                const ctx = canvas.getContext('2d', { alpha: true }); if (!ctx) return;
                ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
                ctx.drawImage(image, 0, 0, size, size);
                const compact = canvas.toDataURL('image/webp', .82);
                if (safeDataImage(compact) && compact.length < data.length) setAvatarDraft(compact, true);
              } catch (_) { }
            };
            image.src = data;
          }
        }, 0);
      }, true);

      // If an existing data URI was pasted/restored into the URL input, never leave it visible or require a user to edit it manually.
      document.addEventListener('focusout', event => {
        if (event.target?.id !== 'edit-avatar-url') return;
        const input = event.target;
        if (safeDataImage(input.value)) setAvatarDraft(input.value, true);
      }, true);
      document.addEventListener('input', event => {
        if (event.target?.id !== 'edit-avatar-url') return;
        const input = event.target;
        if (input.value.trim() && !safeDataImage(input.value)) {
          try { tempAvatarUrl = ''; } catch (_) { }
          window.tempAvatarUrl = '';
          const preview = $('pd-edit-avatar-preview');
          if (preview && /^https:\/\//i.test(input.value.trim())) preview.src = input.value.trim();
        }
      }, true);

      // Make sure saveProfileChanges sees the cropped data, while the visible URL field stays clean.
      const oldSaveProfile = window.saveProfileChanges;
      if (typeof oldSaveProfile === 'function' && !oldSaveProfile.__pd18) {
        const wrappedSaveProfile = function (event) {
          const input = $('edit-avatar-url');
          if (input && safeDataImage(input.value)) setAvatarDraft(input.value, false);
          if (input && safeDataImage(input.value)) input.value = '';
          if ((!input?.value.trim()) && safeDataImage(window.tempAvatarUrl)) {
            try { tempAvatarUrl = window.tempAvatarUrl; } catch (_) { }
          }
          return oldSaveProfile.apply(this, arguments);
        };
        wrappedSaveProfile.__pd18 = true;
        window.saveProfileChanges = wrappedSaveProfile;
      }

      // A clearer wallet heading and live balance, inserted without altering payment / database logic.
      function installWalletHero() {
        const section = $('view-wallet');
        const grid = section?.querySelector(':scope > .grid');
        if (!section || !grid || $('pd18-wallet-hero')) return;
        const header = document.createElement('header'); header.id = 'pd18-wallet-hero'; header.className = 'pd18-wallet-hero';
        header.innerHTML = '<div class="pd18-wallet-headline"><span class="pd18-wallet-brandmark"><i data-lucide="wallet-cards"></i></span><div class="pd18-wallet-copy"><span class="pd-eyebrow">COINS WALLET · PAYMENT CENTER</span><h1>เติม Coins ได้อย่างมั่นใจ</h1><p>เลือกจำนวนเงิน ตรวจยอดโอน แนบสลิป และติดตามสถานะการเติมได้จากหน้าจอเดียว</p></div></div><div class="pd18-wallet-current"><small>ยอด Coins ปัจจุบัน</small><strong id="pd18-wallet-balance">0.00 Coins</strong></div>';
        section.insertBefore(header, grid);
        const pkg = $('selected-topup-amount')?.closest('.space-y-3'); if (pkg) pkg.id = 'pd18-topup-packages';
        const history = $('topup-history-list')?.closest('.ui-panel'); if (history) history.id = 'pd18-topup-history-card';
        header.querySelector('.pd18-wallet-current').setAttribute('aria-live', 'polite');
        header.querySelector('.pd18-wallet-current').title = 'ยอดคงเหลือตามข้อมูลที่แสดงใน Account Center';
        if (window.lucide) { try { window.lucide.createIcons() } catch (_) { } }
        updateWalletBalance();
      }
      function updateWalletBalance() {
        const out = $('pd18-wallet-balance'); if (!out) return;
        const source = $('user-coins-amount')?.textContent || $('prof-coins-amount')?.textContent || '0.00 Coins';
        out.textContent = source.replace(/\s+/g, ' ').trim();
      }
      const coins = $('user-coins-amount');
      if (coins && 'MutationObserver' in window) new MutationObserver(updateWalletBalance).observe(coins, { childList: true, characterData: true, subtree: true });
      window.addEventListener('pd:viewchange', updateWalletBalance, { passive: true });
      document.addEventListener('click', event => {
        if (event.target.closest('#view-wallet .topup-pkg-btn')) requestAnimationFrame(updateWalletBalance);
      }, { passive: true });

      // Context-specific small usability helpers and accessible live feedback.
      const total = $('pd-live-total'); if (total) { total.setAttribute('aria-live', 'polite'); total.setAttribute('aria-atomic', 'true') }
      const status = $('pd-live-order-copy'); if (status) { status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true') }
      $('pd-live-order-strip')?.setAttribute('role', 'status');
      $('pd-help-search')?.setAttribute('autocomplete', 'off');

      installProfileBranding();
      installWalletHero();
      if (window.lucide && !document.documentElement.classList.contains('pd-motion-lite')) {
        try { window.lucide.createIcons(); } catch (_) { }
      }
    })();
  
