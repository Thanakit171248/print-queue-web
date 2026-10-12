
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);

      /* Prevent duplicate crop listeners from older versions: replace the stage once. */
      function stabilizeCropStage() {
        const stage = $('pd-crop-stage');
        if (!stage || stage.dataset.pd9stable) return stage;
        const clone = stage.cloneNode(true);
        clone.dataset.pd9stable = '1';
        clone.dataset.v8bound = '1'; /* tells v8 binder not to attach a second pointer stream */
        stage.replaceWith(clone);
        return clone;
      }

      const crop = { x: 0, y: 0, zoom: 1, baseW: 0, baseH: 0, nw: 0, nh: 0, raf: 0, drag: false, pid: null, lx: 0, ly: 0, img: null };
      const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
      function frame() { return $('pd-crop-stage')?.querySelector('.pd-crop-frame')?.getBoundingClientRect() || null }
      function render() {
        if (crop.raf) return;
        crop.raf = requestAnimationFrame(() => {
          crop.raf = 0; if (!crop.img) return;
          const f = frame(); if (!f) return;
          const w = crop.baseW * crop.zoom, h = crop.baseH * crop.zoom;
          crop.x = clamp(crop.x, -Math.max(0, (w - f.width) / 2), Math.max(0, (w - f.width) / 2));
          crop.y = clamp(crop.y, -Math.max(0, (h - f.height) / 2), Math.max(0, (h - f.height) / 2));
          crop.img.style.transform = `translate3d(calc(-50% + ${crop.x}px),calc(-50% + ${crop.y}px),0) scale(${crop.zoom})`;
        });
      }
      function fit() {
        const stage = $('pd-crop-stage'); if (!stage || !crop.img || !crop.nw) return;
        const f = frame(); if (!f) return;
        const cover = Math.max(f.width / crop.nw, f.height / crop.nh) * 1.015;
        crop.baseW = crop.nw * cover; crop.baseH = crop.nh * cover; crop.x = 0; crop.y = 0; crop.zoom = 1;
        crop.img.style.width = `${crop.nw}px`; crop.img.style.height = `${crop.nh}px`;
        const z = $('pd-crop-zoom'); if (z) z.value = '1'; render();
      }
      function bind() {
        const stage = stabilizeCropStage(); if (!stage || stage.dataset.pd9bound) return;
        stage.dataset.pd9bound = '1';
        stage.addEventListener('pointerdown', e => {
          if (e.button !== undefined && e.button !== 0) return;
          crop.drag = true; crop.pid = e.pointerId; crop.lx = e.clientX; crop.ly = e.clientY;
          stage.setPointerCapture?.(e.pointerId); crop.img?.classList.add('is-dragging'); e.preventDefault();
        }, { passive: false });
        stage.addEventListener('pointermove', e => {
          if (!crop.drag || e.pointerId !== crop.pid) return;
          crop.x += e.clientX - crop.lx; crop.y += e.clientY - crop.ly; crop.lx = e.clientX; crop.ly = e.clientY; render(); e.preventDefault();
        }, { passive: false });
        const end = () => { crop.drag = false; crop.img?.classList.remove('is-dragging') };
        stage.addEventListener('pointerup', end, { passive: true }); stage.addEventListener('pointercancel', end, { passive: true });
      }
      function open(file) {
        if (!file) return;
        if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          const fi = $('edit-avatar-file'); if (fi) fi.value = '';
          return window.showCustomModal?.({ title: 'รูปแบบไฟล์ไม่รองรับ', message: 'รองรับ PNG, JPG/JPEG และ WEBP เท่านั้น', icon: 'image-off' });
        }
        if (file.size > 2 * 1024 * 1024) return window.showCustomModal?.({ title: 'รูปภาพใหญ่เกินไป', message: 'ขนาดสูงสุด 2 MB', icon: 'image-off' });
        stabilizeCropStage(); bind();
        const reader = new FileReader();
        reader.onload = ev => {
          const src = ev.target.result, img = new Image();
          img.onload = () => {
            const stage = $('pd-crop-stage'); if (!stage) return;
            crop.img = $('pd-crop-image'); crop.nw = img.naturalWidth; crop.nh = img.naturalHeight; crop.img.src = src;
            crop.img.onload = () => { fit(); $('pd-crop-modal')?.classList.add('is-open'); $('pd-crop-modal')?.setAttribute('aria-hidden', 'false'); requestAnimationFrame(fit) };
          }; img.src = src;
        }; reader.readAsDataURL(file);
      }
      function apply() {
        if (!crop.img || !crop.nw) return;
        const f = frame(); if (!f) return;
        const scale = (crop.baseW * crop.zoom) / crop.nw;
        const sourceSize = Math.min(crop.nw, crop.nh) / crop.zoom;
        const cx = crop.nw / 2 - (crop.x / scale), cy = crop.nh / 2 - (crop.y / scale);
        const sx = clamp(cx - sourceSize / 2, 0, Math.max(0, crop.nw - sourceSize));
        const sy = clamp(cy - sourceSize / 2, 0, Math.max(0, crop.nh - sourceSize));
        const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 512;
        const ctx = canvas.getContext('2d', { alpha: true }); if (!ctx) return;
        const source = new Image(); source.onload = () => {
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high'; ctx.drawImage(source, sx, sy, sourceSize, sourceSize, 0, 0, 512, 512);
          const out = canvas.toDataURL('image/webp', .9); const url = $('edit-avatar-url'); if (url) url.value = out;
          const pv = $('pd-edit-avatar-preview'); if (pv) pv.src = out; window.tempAvatarUrl = out;
          $('pd-crop-modal')?.classList.remove('is-open'); $('pd-crop-modal')?.setAttribute('aria-hidden', 'true');
        }; source.src = crop.img.src;
      }
      function install() {
        const input = $('edit-avatar-file');
        if (input && !input.dataset.pd9) {
          input.dataset.pd9 = '1'; input.dataset.v8bound = '1'; input.accept = 'image/png,image/jpeg,image/webp';
          input.onchange = e => { const f = e.target.files?.[0]; if (f) open(f) };
        }
        const modal = $('pd-crop-modal'); if (modal) {
          stabilizeCropStage(); bind();
          const z = $('pd-crop-zoom'); if (z && !z.dataset.pd9) { z.dataset.pd9 = '1'; z.addEventListener('input', () => { crop.zoom = Math.max(1, Number(z.value) || 1); render() }, { passive: true }) }
          const reset = $('pd-crop-reset'); if (reset && !reset.dataset.pd9) { reset.dataset.pd9 = '1'; reset.addEventListener('click', () => { crop.x = 0; crop.y = 0; crop.zoom = 1; if (z) z.value = '1'; render() }) }
          const applyBtn = $('pd-crop-apply'); if (applyBtn && !applyBtn.dataset.pd9) { applyBtn.dataset.pd9 = '1'; applyBtn.onclick = apply }
        }
      }
      window.openSquareCropV9 = open; window.applySquareCropV9 = apply;
      const mo = new MutationObserver(install); mo.observe(document.body, { childList: true, subtree: true });
      setTimeout(install, 300);

      /* Small, cheap scroll polish — no scroll-linked blur or expensive paints. */
      let ticking = false;
      window.addEventListener('scroll', () => {
        if (ticking) return; ticking = true; requestAnimationFrame(() => {
          ticking = false; document.documentElement.style.setProperty('--pd-scroll-y', `${window.scrollY}px`);
          document.body.classList.toggle('pd-scrolled', window.scrollY > 24);
        });
      }, { passive: true });

      /* Responsive text QA: add a class to containers whose text actually overflows. */
      function textQA() {
        document.querySelectorAll('.pd-story-card h3,.pd-story-card>p,.pd-section-heading h2,.pd-account-action b').forEach(el => {
          const bad = el.scrollHeight > el.clientHeight + 2 || el.scrollWidth > el.clientWidth + 2;
          el.classList.toggle('pd-text-overflow', bad);
        });
      }
      const ro = new ResizeObserver(() => requestAnimationFrame(textQA)); ro.observe(document.documentElement);
      window.addEventListener('resize', textQA, { passive: true }); setTimeout(textQA, 500);
    })();
  
