
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      let pdPdfLibraryPromise = null;
      function ensurePdPdfLibrary() {
        if (window.pdfjsLib) {
          if (window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
          return Promise.resolve(window.pdfjsLib);
        }
        if (pdPdfLibraryPromise) return pdPdfLibraryPromise;
        pdPdfLibraryPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
          script.async = true;
          script.onload = () => {
            if (!window.pdfjsLib) return reject(new Error('PDF.js loaded but pdfjsLib is unavailable'));
            if (window.pdfjsLib.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
            resolve(window.pdfjsLib);
          };
          script.onerror = () => reject(new Error('Unable to load PDF.js'));
          document.head.appendChild(script);
        }).catch(error => {
          pdPdfLibraryPromise = null;
          throw error;
        });
        return pdPdfLibraryPromise;
      }
      window.ensurePdPdfLibrary = ensurePdPdfLibrary;
      if (window.pdfjsLib?.GlobalWorkerOptions && !window.pdfjsLib.GlobalWorkerOptions.workerSrc) {
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
      }

      /* Ensure the account tabs are mutually exclusive even when style order changes. */
      function setAuthTab(tab) {
        const login = $('form-login'), register = $('form-register');
        const loginTab = $('tab-login'), registerTab = $('tab-register');
        const isLogin = tab !== 'register';
        if (!login || !register || !loginTab || !registerTab) return;
        login.classList.toggle('hidden', !isLogin);
        register.classList.toggle('hidden', isLogin);
        login.style.display = isLogin ? 'flex' : 'none';
        register.style.display = isLogin ? 'none' : 'flex';
        loginTab.setAttribute('aria-selected', String(isLogin));
        registerTab.setAttribute('aria-selected', String(!isLogin));
        if (window.lucide) window.lucide.createIcons();
      }
      const originalSwitchAuthTab = window.switchAuthTab;
      window.switchAuthTab = function (tab) {
        setAuthTab(tab);
        if (typeof originalSwitchAuthTab === 'function') {
          try { originalSwitchAuthTab(tab); } catch (e) { console.warn('Auth tab decoration skipped', e); }
        }
        setAuthTab(tab);
      };
      document.addEventListener('DOMContentLoaded', () => setAuthTab('login'), { once: true });
      setAuthTab('login');

      let currentPdf = null;
      let previewGeneration = 0;
      let jobQueue = [];
      let activeRender = 0;
      let gridObserver = null;
      let previewObserver = null;
      let activeImageUrl = null;
      const maxConcurrentRenders = 1;

      function previewMessage(icon, title, message) {
        const holder = document.createElement('div');
        holder.className = 'pd-v15-preview-message';
        const iconEl = document.createElement('i');
        iconEl.setAttribute('data-lucide', icon || 'file-text');
        const heading = document.createElement('strong'); heading.textContent = title;
        const copy = document.createElement('p'); copy.textContent = message;
        holder.append(iconEl, heading, copy);
        return holder;
      }
      window.__pdV15ShowPdfFailure = function (error) {
        clearRenderState();
        const message = /worker|csp|content security/i.test(String(error?.message || error))
          ? 'ตัวอ่าน PDF ถูกบล็อกโดยนโยบายความปลอดภัยหรือเครือข่าย กรุณารีเฟรชหน้าเว็บ แล้วลองอีกครั้ง'
          : 'ไฟล์อาจเสียหาย มีรหัสผ่าน หรือไม่ใช่ PDF ที่รองรับ ลองเปิดไฟล์บนเครื่องก่อนแล้วบันทึกเป็น PDF ใหม่';
        const panel = previewMessage('file-warning', 'แสดงพรีวิว PDF ไม่สำเร็จ', message);
        $('pdf-preview-wrapper')?.replaceChildren(panel.cloneNode(true));
        $('pages-grid-container')?.replaceChildren(panel);
        if (window.lucide) window.lucide.createIcons();
      };
      function clearRenderState() {
        previewGeneration++;
        jobQueue = [];
        gridObserver?.disconnect(); previewObserver?.disconnect();
        gridObserver = previewObserver = null;
        const previousPdf = currentPdf;
        currentPdf = null;
        if (previousPdf && typeof previousPdf.destroy === 'function') {
          try { Promise.resolve(previousPdf.destroy()).catch(() => { }); } catch (_) { }
        }
        if (activeImageUrl) { try { URL.revokeObjectURL(activeImageUrl); } catch (_) { } activeImageUrl = null; }
      }
      function enqueueRender(job) {
        if (!job.canvas || job.canvas.dataset.pdRendered === '1' || job.canvas.dataset.pdQueued === '1') return;
        job.canvas.dataset.pdQueued = '1';
        job.generation = previewGeneration;
        jobQueue.push(job);
        pumpQueue();
      }
      async function pumpQueue() {
        if (activeRender >= maxConcurrentRenders || !jobQueue.length) return;
        const job = jobQueue.shift();
        if (!job || job.generation !== previewGeneration || job.generation !== Number(job.canvas.dataset.pdGeneration)) {
          activeRender = Math.max(0, activeRender); pumpQueue(); return;
        }
        activeRender++;
        try {
          const page = await job.pdf.getPage(job.pageNumber);
          if (job.generation !== previewGeneration || !job.canvas.isConnected) return;
          const base = page.getViewport({ scale: 1 });
          const scale = job.kind === 'thumb'
            ? Math.min(0.24, 138 / Math.max(base.width, base.height))
            : Math.min(1.15, 820 / base.width);
          const viewport = page.getViewport({ scale });
          const canvas = job.canvas;
          const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
          if (!ctx) return;
          canvas.width = Math.max(1, Math.ceil(viewport.width));
          canvas.height = Math.max(1, Math.ceil(viewport.height));
          await page.render({ canvasContext: ctx, viewport }).promise;
          if (job.generation === previewGeneration) {
            canvas.dataset.pdRendered = '1';
            canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
          }
          page.cleanup?.();
        } catch (err) {
          if (job.generation === previewGeneration) console.warn('PDF preview render failed:', err);
        } finally {
          activeRender = Math.max(0, activeRender - 1);
          if (job.canvas) job.canvas.dataset.pdQueued = '0';
          pumpQueue();
        }
      }
      function makePreviewCanvas(kind, pageNumber, pdf) {
        const canvas = document.createElement('canvas');
        canvas.width = 100; canvas.height = 141;
        canvas.dataset.pdGeneration = String(previewGeneration);
        canvas.dataset.pdPage = String(pageNumber);
        canvas.dataset.pdKind = kind;
        if (kind === 'thumb') canvas.className = 'pd-v15-thumb-canvas';
        else canvas.className = 'pd-v15-page-canvas';
        return canvas;
      }
      function renderPdfPages(pdf) {
        clearRenderState();
        currentPdf = pdf;
        const generation = previewGeneration;
        const grid = $('pages-grid-container');
        const drawer = $('pdf-preview-wrapper');
        if (!grid || !drawer) return;
        grid.className = 'pd-v15-page-picker ui-input';
        grid.replaceChildren();
        drawer.replaceChildren();
        if (gridObserver) gridObserver.disconnect();
        if (previewObserver) previewObserver.disconnect();
        const thumbObserver = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const canvas = entry.target;
            thumbObserver.unobserve(canvas);
            enqueueRender({ pdf, pageNumber: Number(canvas.dataset.pdPage), canvas, kind: 'thumb' });
          });
        }, { root: grid, rootMargin: '160px 0px', threshold: 0.01 });
        gridObserver = thumbObserver;
        const fullPreviewObserver = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (!entry.isIntersecting) return;
            const canvas = entry.target;
            fullPreviewObserver.unobserve(canvas);
            enqueueRender({ pdf, pageNumber: Number(canvas.dataset.pdPage), canvas, kind: 'preview' });
          });
        }, { root: drawer.parentElement, rootMargin: '240px 0px', threshold: 0.01 });
        previewObserver = fullPreviewObserver;

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
          const card = document.createElement('label');
          card.className = 'pd-v15-thumb-card is-selected';
          card.dataset.page = String(pageNumber);
          const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = true; cb.value = String(pageNumber); cb.className = 'sr-only';
          const thumb = makePreviewCanvas('thumb', pageNumber, pdf);
          const label = document.createElement('span'); label.className = 'pd-v15-page-num';
          const check = document.createElement('span'); check.className = 'pd-v15-check'; check.textContent = '✓';
          const txt = document.createElement('span'); txt.textContent = `หน้า ${pageNumber}`;
          label.append(check, txt); card.append(cb, thumb, label); grid.appendChild(card);
          cb.addEventListener('change', () => { card.classList.toggle('is-selected', cb.checked); window.updateGridSelectedCount?.(); });
          card.addEventListener('click', e => {
            if (e.target === cb) return;
            e.preventDefault(); cb.checked = !cb.checked; cb.dispatchEvent(new Event('change', { bubbles: true }));
          });
          gridObserver.observe(thumb);

          const pageBox = document.createElement('section'); pageBox.className = 'pd-v15-preview-page';
          const tag = document.createElement('span'); tag.className = 'pd-v15-preview-label'; tag.textContent = `หน้า ${pageNumber}`;
          const canvas = makePreviewCanvas('preview', pageNumber, pdf);
          pageBox.append(tag, canvas); drawer.appendChild(pageBox);
          previewObserver.observe(canvas);
        }
        const pages = pdf.numPages;
        if ($('total-pages-display')) $('total-pages-display').textContent = `${pages} หน้า`;
        if ($('selected-pages-count-display')) $('selected-pages-count-display').textContent = `${pages} หน้า`;
        if ($('printed-pages-input')) $('printed-pages-input').value = pages;
        if ($('preview-modal-pages')) $('preview-modal-pages').textContent = `${pages} หน้า`;
        if ($('preview-modal-type')) $('preview-modal-type').textContent = 'PDF';
        window.detectedPageCount = pages;
        window.calculatePrice?.();
        if (window.lucide) window.lucide.createIcons();
        /* Touch observers after the overlay transitions from hidden to visible. */
        window.__pdV15RefreshPreview = () => {
          if (!currentPdf || currentPdf !== pdf || generation !== previewGeneration) return;
          const scroller = drawer.parentElement;
          const scheduleVisible = (root, selector, kind) => {
            const rr = root?.getBoundingClientRect(); if (!rr || rr.width <= 0 || rr.height <= 0) return;
            root.querySelectorAll(selector).forEach(canvas => {
              if (canvas.dataset.pdRendered === '1' || canvas.dataset.pdQueued === '1') return;
              const r = canvas.getBoundingClientRect();
              if (r.bottom >= rr.top - 260 && r.top <= rr.bottom + 260) {
                enqueueRender({ pdf, pageNumber: Number(canvas.dataset.pdPage), canvas, kind });
              }
            });
          };
          scheduleVisible(grid, '.pd-v15-thumb-canvas', 'thumb');
          scheduleVisible(scroller, '.pd-v15-page-canvas', 'preview');
        };
      }
      window.renderPdfThumbnails = renderPdfPages;

      function renderNonPdf(file) {
        clearRenderState();
        const grid = $('pages-grid-container'), drawer = $('pdf-preview-wrapper');
        if (grid) { grid.className = 'pd-v15-page-picker ui-input'; grid.replaceChildren(); grid.append(previewMessage('file-check', 'เลือกหน้าพิมพ์รายหน้าไม่ได้สำหรับไฟล์นี้', 'ระบบจะคิดจำนวนหน้าเป็น 1 หน้า หากต้องเลือกหน้ารายหน้า กรุณาอัปโหลด PDF')); }
        if (drawer) {
          drawer.replaceChildren();
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          if (/^image\/(png|jpe?g|webp)$/i.test(file.type || '') || ['png', 'jpg', 'jpeg', 'webp'].includes(ext)) {
            if (activeImageUrl) URL.revokeObjectURL(activeImageUrl);
            activeImageUrl = URL.createObjectURL(file);
            const box = document.createElement('div'); box.className = 'pd-v15-preview-message';
            const im = document.createElement('img'); im.src = activeImageUrl; im.alt = 'พรีวิวไฟล์ภาพ';
            im.style.cssText = 'display:block;max-width:100%;max-height:65vh;object-fit:contain;margin:0 auto 16px;border-radius:12px;background:#fff';
            const title = document.createElement('strong'); title.textContent = file.name;
            const copy = document.createElement('p'); copy.textContent = `รูปภาพ • ${(file.size / 1048576).toFixed(2)} MB • พร้อมดูตัวอย่าง`;
            box.append(im, title, copy); drawer.appendChild(box);
            if ($('preview-modal-type')) $('preview-modal-type').textContent = 'Image';
          } else {
            drawer.append(previewMessage('file-text', 'รับไฟล์แล้ว แต่ไม่สามารถแสดงหน้ากระดาษ Word โดยตรงได้', 'เบราว์เซอร์นี้ยังไม่มีตัวแปลง DOC/DOCX เป็นพรีวิว กรุณาแปลงเอกสารเป็น PDF เพื่อดูทุกหน้าได้แม่นยำ'));
            if ($('preview-modal-type')) $('preview-modal-type').textContent = ext.toUpperCase() || 'Document';
          }
        }
        if ($('total-pages-display')) $('total-pages-display').textContent = '1 หน้า';
        if ($('selected-pages-count-display')) $('selected-pages-count-display').textContent = '1 หน้า';
        if ($('printed-pages-input')) $('printed-pages-input').value = 1;
        if ($('preview-modal-pages')) $('preview-modal-pages').textContent = '1 หน้า';
        window.calculatePrice?.();
        if (window.lucide) window.lucide.createIcons();
      }
      window.__pdV15RenderNonPdfPreview = renderNonPdf;

      /* Wrap the existing validator/upload-state handler. Defer PDF.js until a PDF is chosen. */
      const originalHandleFileSelect = window.handleFileSelect;
      if (typeof originalHandleFileSelect === 'function') {
        window.handleFileSelect = function (event) {
          const input = event?.target;
          const file = input?.files?.[0];
          if (!file) return originalHandleFileSelect.call(this, event);
          const ext = (file.name.split('.').pop() || '').toLowerCase();
          const isPdf = file.type === 'application/pdf' || ext === 'pdf';

          if (isPdf && !window.pdfjsLib) {
            const drawer = $('pdf-preview-wrapper'), grid = $('pages-grid-container');
            if (drawer) drawer.replaceChildren(previewMessage('file-text', 'กำลังโหลดตัวอ่าน PDF', 'โหลดเฉพาะตอนเลือก PDF เพื่อลดภาระตอนเปิดเว็บไซต์…'));
            if (grid) { grid.className = 'pd-v15-page-picker ui-input'; grid.replaceChildren(previewMessage('file-text', 'กำลังเตรียมตัวอ่าน PDF', 'กรุณารอสักครู่…')); }
            ensurePdPdfLibrary().then(() => {
              /* Use the input's current FileList in case the user chose another file meanwhile. */
              if (input?.files?.length) window.handleFileSelect.call(this, { target: input });
            }).catch(error => {
              if (input) input.value = '';
              window.selectedFileObj = null;
              try { if (typeof selectedFileObj !== 'undefined') selectedFileObj = null; } catch (_) { }
              window.__pdV15ShowPdfFailure?.(error);
              window.showCustomModal?.({ title: 'โหลดตัวอ่าน PDF ไม่สำเร็จ', message: 'ตรวจสอบอินเทอร์เน็ตแล้วเลือกไฟล์ PDF อีกครั้ง หรือแปลงไฟล์เป็น PDF ใหม่', icon: 'file-warning' });
              console.warn('PDF.js lazy-load error:', error);
            });
            return;
          }

          const result = originalHandleFileSelect.call(this, event);
          /* The original handler clears input on rejected files. */
          if (input?.value === '' || window.selectedFileObj !== file) return result;
          if (!isPdf) {
            renderNonPdf(file);
          } else {
            /* Worker policy / MIME fallbacks; original file read remains intact. */
            clearRenderState();
            if (window.pdfjsLib?.GlobalWorkerOptions) window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER;
            const drawer = $('pdf-preview-wrapper'), grid = $('pages-grid-container');
            if (drawer) drawer.replaceChildren(previewMessage('file-text', 'กำลังเตรียมพรีวิว PDF', 'กำลังอ่านจำนวนหน้าและสร้างตัวอย่างแบบประหยัดทรัพยากร…'));
            if (grid) { grid.className = 'pd-v15-page-picker ui-input'; grid.replaceChildren(previewMessage('file-text', 'กำลังอ่าน PDF', 'กำลังเตรียมรายการหน้า…')); }
            if ($('preview-modal-type')) $('preview-modal-type').textContent = 'PDF';
          }
          return result;
        };
      }

      const originalToggleDrawer = window.toggleFilePreviewDrawer;
      window.toggleFilePreviewDrawer = function (show = true) {
        if (typeof originalToggleDrawer === 'function') originalToggleDrawer.call(this, show);
        const drawer = $('file-preview-drawer');
        if (drawer) drawer.classList.toggle('hidden', !show);
        if (show) requestAnimationFrame(() => window.__pdV15RefreshPreview?.());
      };
      /* Refresh the lazy preview after the drawer is displayed. */
      $('file-preview-drawer')?.addEventListener('transitionend', () => window.__pdV15RefreshPreview?.());
      $('print-form')?.addEventListener('reset', () => setTimeout(() => {
        if (!window.selectedFileObj && !$('file-input')?.files?.length) clearRenderState();
      }, 0));
      window.addEventListener('resize', () => window.__pdV15RefreshPreview?.(), { passive: true });
      document.addEventListener('change', e => {
        if (e.target?.name === 'page_selection_mode' && e.target.value === 'grid') {
          requestAnimationFrame(() => window.__pdV15RefreshPreview?.());
        }
      }, { passive: true });
    })();
  