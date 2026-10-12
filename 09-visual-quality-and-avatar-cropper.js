
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      let cropState = { src: '', naturalW: 0, naturalH: 0, baseW: 0, baseH: 0, zoom: 1, x: 0, y: 0, raf: 0, drag: false, pid: null, lastX: 0, lastY: 0 };
      let cropImg = null;
      const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

      function cropFrameSize() {
        const frame = $('pd-crop-stage')?.querySelector('.pd-crop-frame');
        return frame ? frame.getBoundingClientRect() : null;
      }
      function cropRender() {
        if (cropState.raf) return;
        cropState.raf = requestAnimationFrame(() => {
          cropState.raf = 0;
          if (!cropImg) return;
          const stage = $('pd-crop-stage');
          if (!stage) return;
          const frame = cropFrameSize();
          if (!frame) return;
          const stageR = stage.getBoundingClientRect();
          const frameW = frame.width, frameH = frame.height;
          const w = cropState.baseW * cropState.zoom, h = cropState.baseH * cropState.zoom;
          const maxX = Math.max(0, (w - frameW) / 2), maxY = Math.max(0, (h - frameH) / 2);
          cropState.x = clamp(cropState.x, -maxX, maxX);
          cropState.y = clamp(cropState.y, -maxY, maxY);
          cropImg.style.transform = `translate3d(calc(-50% + ${cropState.x}px),calc(-50% + ${cropState.y}px),0) scale(${cropState.zoom})`;
        });
      }
      function cropFit() {
        const stage = $('pd-crop-stage');
        if (!stage || !cropImg || !cropState.naturalW) return;
        const frame = cropFrameSize(), sr = stage.getBoundingClientRect();
        const fw = frame?.width || 280, fh = frame?.height || 280;
        const cover = Math.max(fw / cropState.naturalW, fh / cropState.naturalH) * 1.04;
        cropState.baseW = cropState.naturalW * cover;
        cropState.baseH = cropState.naturalH * cover;
        cropState.zoom = 1; cropState.x = 0; cropState.y = 0;
        cropImg.style.width = `${cropState.naturalW}px`;
        cropImg.style.height = `${cropState.naturalH}px`;
        $('pd-crop-zoom') && ($('pd-crop-zoom').value = '1');
        cropRender();
      }
      function bindCrop() {
        const stage = $('pd-crop-stage');
        if (!stage || stage.dataset.v8bound) return;
        stage.dataset.v8bound = '1';
        stage.addEventListener('pointerdown', e => {
          if (e.button !== undefined && e.button !== 0) return;
          cropState.drag = true; cropState.pid = e.pointerId; cropState.lastX = e.clientX; cropState.lastY = e.clientY;
          cropImg?.classList.add('is-dragging'); stage.setPointerCapture?.(e.pointerId);
        }, { passive: true });
        stage.addEventListener('pointermove', e => {
          if (!cropState.drag || e.pointerId !== cropState.pid) return;
          cropState.x += e.clientX - cropState.lastX; cropState.y += e.clientY - cropState.lastY;
          cropState.lastX = e.clientX; cropState.lastY = e.clientY; cropRender();
        }, { passive: true });
        const end = () => { cropState.drag = false; cropImg?.classList.remove('is-dragging') };
        stage.addEventListener('pointerup', end, { passive: true }); stage.addEventListener('pointercancel', end, { passive: true }); stage.addEventListener('lostpointercapture', end, { passive: true });
      }
      function setupCropper() {
        const modal = $('pd-crop-modal'); if (!modal) return;
        bindCrop();
        const z = $('pd-crop-zoom');
        if (z && !z.dataset.v8bound) { z.dataset.v8bound = '1'; z.addEventListener('input', () => { cropState.zoom = Number(z.value) || 1; cropRender() }, { passive: true }) }
        const reset = $('pd-crop-reset');
        if (reset && !reset.dataset.v8bound) { reset.dataset.v8bound = '1'; reset.addEventListener('click', () => { cropState.zoom = 1; cropState.x = 0; cropState.y = 0; if (z) z.value = '1'; cropRender() }) }
      }
      function openSquareCrop(file) {
        if (!file) return;
        ensureCropModal(); setupCropper();
        const reader = new FileReader();
        reader.onload = ev => {
          const src = ev.target.result;
          const image = new Image();
          image.onload = () => {
            cropImg = $('pd-crop-image'); cropState.src = src; cropState.naturalW = image.naturalWidth; cropState.naturalH = image.naturalHeight;
            cropImg.src = src; cropImg.onload = () => { cropFit(); $('pd-crop-modal').classList.add('is-open'); $('pd-crop-modal').setAttribute('aria-hidden', 'false'); requestAnimationFrame(cropFit) };
          };
          image.src = src;
        };
        reader.readAsDataURL(file);
      }
      function applySquareCrop() {
        if (!cropImg || !cropState.naturalW) return;
        const frame = cropFrameSize();
        const fw = frame?.width || 280;
        const displayScale = (cropState.baseW * cropState.zoom) / cropState.naturalW;
        const sourceSize = fw / displayScale;
        const leftSource = (cropState.naturalW - sourceSize) / 2 - (cropState.x / displayScale);
        const topSource = (cropState.naturalH - sourceSize) / 2 - (cropState.y / displayScale);
        const sx = clamp(leftSource, 0, Math.max(0, cropState.naturalW - sourceSize));
        const sy = clamp(topSource, 0, Math.max(0, cropState.naturalH - sourceSize));
        const size = 512, canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size;
        const ctx = canvas.getContext('2d');
        const source = new Image(); source.onload = () => {
          ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(source, sx, sy, sourceSize, sourceSize, 0, 0, size, size);
          const out = canvas.toDataURL('image/webp', .90);
          const url = $('edit-avatar-url'); if (url) url.value = out;
          const pv = $('pd-edit-avatar-preview'); if (pv) pv.src = out;
          window.tempAvatarUrl = out;
          $('pd-crop-modal')?.classList.remove('is-open'); $('pd-crop-modal')?.setAttribute('aria-hidden', 'true');
        }; source.src = cropState.src;
      }
      window.previewEditAvatarFileV8 = function (e) {
        const file = e?.target?.files?.[0]; if (!file) return;
        const allowed = ['image/png', 'image/jpeg', 'image/webp'];
        if (!allowed.includes(file.type)) { e.target.value = ''; return showCustomModal({ title: 'รูปแบบไฟล์ไม่รองรับ', message: 'รองรับเฉพาะ PNG, JPG/JPEG และ WEBP เท่านั้น', icon: 'image-off' }); }
        if (file.size > 2 * 1024 * 1024) { e.target.value = ''; return showCustomModal({ title: 'รูปภาพใหญ่เกินไป', message: 'ขนาดสูงสุด 2 MB', icon: 'image-off' }); }
        openSquareCrop(file);
      };
      window.openSquareCrop = openSquareCrop;
      window.applySquareCrop = applySquareCrop;

      /* Replace the old crop controls once the modal is created. */
      const observer = new MutationObserver(() => {
        const modal = $('pd-crop-modal');
        if (modal) {
          const frame = modal.querySelector('.pd-crop-frame');
          if (frame) frame.style.borderRadius = '24px';
          const title = modal.querySelector('h3'); if (title) title.textContent = 'จัดวางรูปโปรไฟล์แบบสี่เหลี่ยม';
          const desc = modal.querySelector('p'); if (desc) desc.textContent = 'ลากเพื่อจัดตำแหน่ง • ซูมอย่างลื่น • ครอปสี่เหลี่ยม';
          const apply = $('pd-crop-apply'); if (apply && !apply.dataset.v8bound) { apply.dataset.v8bound = '1'; apply.onclick = applySquareCrop }
          setupCropper();
        }
        const input = $('edit-avatar-file');
        if (input && !input.dataset.v8bound) { input.dataset.v8bound = '1'; input.onchange = window.previewEditAvatarFileV8 }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => { setupCropper(); const input = $('edit-avatar-file'); if (input && !input.dataset.v8bound) { input.dataset.v8bound = '1'; input.onchange = window.previewEditAvatarFileV8 } }, 500);
    })();
  