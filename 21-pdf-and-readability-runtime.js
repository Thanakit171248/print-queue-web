
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const db = () => window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const notice = (title, message, icon = 'info') => {
    if (typeof window.showCustomModal === 'function') window.showCustomModal({ title, message, icon });
    else window.alert(`${title}\n\n${message}`);
  };
  function confirmAction({ title, message, icon = 'trash-2', confirmText = 'ยืนยันลบ', onConfirm }) {
    if (typeof window.showCustomModal !== 'function') {
      if (window.confirm(`${title}\n\n${message}`)) Promise.resolve(onConfirm?.());
      return;
    }
    window.showCustomModal({ title, message, icon, showCancel: true, onConfirm });
    const ok = $('modal-confirm-btn'); if (ok) ok.textContent = confirmText;
    const cancel = $('modal-cancel-btn'); if (cancel) cancel.textContent = 'ยกเลิก';
  }
  function assertAdmin() {
    if (typeof window.assertAdminAccess === 'function') return !!window.assertAdminAccess();
    notice('ตรวจสอบสิทธิ์ไม่ได้', 'ไม่พบตัวตรวจสอบสิทธิ์แอดมิน ระบบจึงไม่ดำเนินการลบ', 'shield-alert');
    return false;
  }
  const bulkConfigs = {
    orders: { tbody: 'admin-orders-tbody', title: 'คิวงานพิมพ์', button: 'ลบคิวที่เลือก', note: 'ลบได้เฉพาะงานที่พิมพ์เสร็จแล้ว เพื่อไม่ให้คิวที่กำลังทำงานหายไป' },
    topups: { tbody: 'admin-topups-tbody', title: 'ประวัติเติม Coins', button: 'ลบประวัติที่เลือก', note: 'ลบได้เฉพาะคำขอที่อนุมัติหรือปฏิเสธแล้ว รายการรอตรวจจะถูกล็อกไว้' },
    users: { tbody: 'admin-users-tbody', title: 'สมาชิก', button: 'ตรวจสอบการลบสมาชิก', note: 'การลบบัญชีจริงต้องทำผ่าน API ฝั่งเซิร์ฟเวอร์' }
  };
  function getRowId(kind, row) {
    if (kind === 'topups' && row.dataset.pdTopupRowId) return String(row.dataset.pdTopupRowId);
    const selector = kind === 'orders' ? '[data-order-id]' : kind === 'topups' ? '[data-topup-id]' : '[data-user-id]';
    const control = row.querySelector(selector);
    if (!control) return '';
    return String(kind === 'orders' ? control.dataset.orderId : kind === 'topups' ? control.dataset.topupId : control.dataset.userId || '').trim();
  }
  function canSelectRow(kind, row, id) {
    if (!id) return false;
    if (kind === 'orders') {
      const liveStatus = row.querySelector('[data-pd-admin-action="status"]')?.value;
      const cached = (window.__pdAdminOrders || []).find(o => String(o.id) === String(id));
      return String(liveStatus || cached?.status || '').toLowerCase() === 'completed';
    }
    if (kind === 'topups') {
      const cells = [...row.querySelectorAll(':scope > td')];
      const status = String(cells[4]?.textContent || '').trim().toLowerCase();
      return status === 'approved' || status === 'rejected';
    }
    if (kind === 'users') return String(window.currentUser?.id || '') !== String(id);
    return false;
  }
  function selectedFor(kind) {
    return [...document.querySelectorAll(`#${bulkConfigs[kind].tbody} input[data-pd-bulk-item="${kind}"]:checked`)]
      .map(cb => cb.dataset.recordId).filter(Boolean);
  }
  function syncBulkToolbar(kind) {
    const config = bulkConfigs[kind], tbody = $(config.tbody);
    const toolbar = document.querySelector(`[data-pd-bulk-toolbar="${kind}"]`);
    if (!tbody || !toolbar) return;
    const selectable = [...tbody.querySelectorAll(`input[data-pd-bulk-item="${kind}"]:not(:disabled)` )];
    const selected = selectedFor(kind);
    const all = toolbar.querySelector('[data-pd-bulk-select-all]');
    if (all) {
      all.disabled = selectable.length === 0;
      all.checked = selectable.length > 0 && selectable.every(cb => cb.checked);
      all.indeterminate = selected.length > 0 && selected.length < selectable.length;
    }
    const count = toolbar.querySelector('[data-pd-bulk-count]');
    if (count) count.textContent = `เลือก ${selected.length} รายการ`;
    const action = toolbar.querySelector('[data-pd-bulk-action]');
    if (action) action.disabled = selected.length === 0;
  }
  function ensureToolbar(kind, tbody) {
    let toolbar = document.querySelector(`[data-pd-bulk-toolbar="${kind}"]`);
    if (toolbar) return toolbar;
    const panel = tbody.closest('.ui-panel');
    const tableWrap = tbody.closest('.overflow-x-auto');
    if (!panel || !tableWrap) return null;
    toolbar = document.createElement('div');
    toolbar.className = 'pd-admin-bulk-toolbar';
    toolbar.dataset.pdBulkToolbar = kind;
    toolbar.innerHTML = `
      <div class="pd-bulk-description">
        <input type="checkbox" class="pd-admin-bulk-toolbar__checkbox" data-pd-bulk-select-all aria-label="เลือกที่ลบได้ทั้งหมด">
        <div><strong>${bulkConfigs[kind].title}</strong><div class="pd-bulk-count" data-pd-bulk-count>เลือก 0 รายการ</div></div>
      </div>
      <button type="button" class="pd-bulk-action" data-pd-bulk-action="${kind}" disabled>${bulkConfigs[kind].button}</button>`;
    panel.insertBefore(toolbar, tableWrap);
    return toolbar;
  }
  function enhanceAdminTable(kind) {
    const config = bulkConfigs[kind], tbody = $(config.tbody);
    if (!tbody) return;
    ensureToolbar(kind, tbody);
    const headerRow = tbody.closest('table')?.querySelector('thead tr');
    if (headerRow && !headerRow.querySelector(`[data-pd-bulk-header="${kind}"]`)) {
      const th = document.createElement('th'); th.dataset.pdBulkHeader = kind; th.className = 'py-3 px-3'; th.scope = 'col'; th.textContent = 'เลือก';
      headerRow.prepend(th);
    }
    [...tbody.querySelectorAll(':scope > tr')].forEach(row => {
      if (row.hasAttribute('data-pd-bulk-enhanced')) return;
      const cells = [...row.querySelectorAll(':scope > td')];
      if (cells.length === 1 && cells[0].hasAttribute('colspan')) return;
      const id = getRowId(kind, row);
      if (!id) return;
      row.dataset.pdBulkEnhanced = kind;
      row.dataset.pdBulkId = id;
      const selectable = canSelectRow(kind, row, id);
      const cell = document.createElement('td');
      cell.className = 'pd-bulk-cell py-3 px-3';
      cell.dataset.label = 'เลือก';
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.className = 'pd-bulk-row-checkbox'; cb.dataset.pdBulkItem = kind; cb.dataset.recordId = id;
      cb.disabled = !selectable;
      cb.setAttribute('aria-label', selectable ? `เลือก${config.title} ${id} เพื่อลบ` : (kind === 'orders' ? 'ลบได้เฉพาะงานที่เสร็จแล้ว' : kind === 'topups' ? 'ลบได้เฉพาะรายการที่อนุมัติหรือปฏิเสธแล้ว' : 'ไม่สามารถเลือกบัญชีที่กำลังใช้งานอยู่'));
      if (!selectable) cb.title = cb.getAttribute('aria-label');
      cell.appendChild(cb); row.prepend(cell);
    });
    syncBulkToolbar(kind);
  }
  function enhanceAdminTables() {
    for (const kind of Object.keys(bulkConfigs)) enhanceAdminTable(kind);
  }
  async function bulkDeleteOrders(ids) {
    if (!assertAdmin()) return;
    const client = db(); if (!client) return notice('ฐานข้อมูลยังไม่พร้อม', 'ยังเชื่อมต่อ Supabase ไม่ได้ จึงไม่มีรายการถูกลบ', 'database-zap');
    const lookup = await client.from('orders').select('id,queue_number,status').in('id', ids);
    if (lookup.error) throw lookup.error;
    const rows = lookup.data || [];
    if (rows.length !== ids.length) throw new Error('มีคิวที่หาไม่พบในฐานข้อมูลแล้ว กรุณารีเฟรชก่อนลองใหม่');
    const ineligible = rows.filter(o => String(o.status) !== 'completed');
    if (ineligible.length) throw new Error(`มี ${ineligible.length} คิวที่ยังไม่ใช่สถานะพิมพ์เสร็จ ระบบจึงยกเลิกการลบทั้งหมดเพื่อความปลอดภัย`);

    /* Preflight child references before deleting any parent rows. */
    const jobsResult = await client.from('print_jobs').select('id,order_id,document_id').in('order_id', ids);
    if (jobsResult.error) throw jobsResult.error;
    const documentIds = [...new Set((jobsResult.data || []).map(j => j.document_id).filter(Boolean).map(String))];
    let documentRows = [];
    if (documentIds.length) {
      const docsResult = await client.from('documents').select('id,file_path').in('id', documentIds);
      if (docsResult.error) throw docsResult.error;
      documentRows = docsResult.data || [];
    }
    const deletedIds = [], failed = [];
    for (const item of rows) {
      try {
        const result = await client.from('orders').delete().eq('id', item.id).eq('status', 'completed').select('id').maybeSingle();
        if (result.error) throw result.error;
        if (!result.data) throw new Error('ฐานข้อมูลไม่ได้ยืนยันการลบ หรือสถานะเปลี่ยนไปแล้ว');
        deletedIds.push(String(item.id));
      } catch (error) { failed.push({ id: item.id, error: error?.message || String(error) }); }
    }
    /* Remove files/metadata only if no remaining job refers to a document. */
    for (const doc of documentRows) {
      try {
        const refs = await client.from('print_jobs').select('id').eq('document_id', doc.id).limit(1);
        if (refs.error || refs.data?.length) continue;
        if (doc.file_path && !/^https?:\/\//i.test(doc.file_path)) {
          try { await client.storage.from('documents').remove([doc.file_path]); } catch (_) { }
        }
        await client.from('documents').delete().eq('id', doc.id);
      } catch (_) { /* The primary order deletion already succeeded. */ }
    }
    if (deletedIds.length) {
      await window.loadAdminData?.(); await window.fetchQueues?.();
    }
    if (failed.length) throw new Error(`ลบสำเร็จ ${deletedIds.length} รายการ แต่ลบไม่สำเร็จ ${failed.length} รายการ\n${failed.slice(0, 3).map(x => `คิว ${x.id}: ${x.error}`).join('\n')}`);
    notice('ลบคิวที่เลือกสำเร็จ', `ลบงานที่เสร็จแล้ว ${deletedIds.length} รายการ\nข้อมูลที่ยังมีความสัมพันธ์ในฐานข้อมูลจะไม่ถูกลบตามโดยอัตโนมัติ`, 'check-circle-2');
  }
  async function bulkDeleteTopups(ids) {
    if (!assertAdmin()) return;
    const client = db(); if (!client) return notice('ฐานข้อมูลยังไม่พร้อม', 'ยังเชื่อมต่อ Supabase ไม่ได้ จึงไม่มีรายการถูกลบ', 'database-zap');
    const lookup = await client.from('topups').select('id,status').in('id', ids);
    if (lookup.error) throw lookup.error;
    const rows = lookup.data || [];
    if (rows.length !== ids.length) throw new Error('มีประวัติเติม Coins ที่หาไม่พบแล้ว กรุณารีเฟรชก่อนลองใหม่');
    if (rows.some(r => !['approved', 'rejected'].includes(String(r.status).toLowerCase()))) {
      throw new Error('มีคำขอเติม Coins ที่ยังรอตรวจสอบ ระบบจึงยกเลิกการลบทั้งหมด');
    }
    const result = await client.from('topups').delete().in('id', ids).in('status', ['approved', 'rejected']).select('id');
    if (result.error) throw result.error;
    if ((result.data || []).length !== ids.length) throw new Error('ฐานข้อมูลลบได้ไม่ครบตามจำนวนที่เลือก กรุณารีเฟรชและตรวจสอบรายการอีกครั้ง');
    await window.loadAdminData?.();
    notice('ลบประวัติสำเร็จ', `ลบประวัติเติม Coins ${ids.length} รายการแล้ว\nการลบนี้ลบเฉพาะประวัติ ไม่เปลี่ยนยอด Coins ในกระเป๋า`, 'check-circle-2');
  }
  function bulkUserDeleteBlocked(ids) {
    if (!assertAdmin()) return;
    notice('ยังไม่ลบบัญชีผู้ใช้', `เลือกไว้ ${ids.length} บัญชี แต่ไฟล์หน้าเว็บนี้ไม่มี API ฝั่งเซิร์ฟเวอร์ที่สามารถลบบัญชี Supabase Auth และตรวจความสัมพันธ์ orders / topups / wallet ได้ครบถ้วน\n\nการลบแถว public.users จากเบราว์เซอร์อย่างเดียวอาจทำให้ล็อกอินหรือประวัติข้อมูลไม่สอดคล้องกัน จึงยังไม่มีข้อมูลใดถูกลบ\n\nขั้นตอนถัดไปที่ปลอดภัยคือเพิ่ม endpoint ที่ตรวจสิทธิ์แอดมินฝั่งเซิร์ฟเวอร์ ใช้ service role key เฉพาะฝั่งเซิร์ฟเวอร์ และกำหนดนโยบายเก็บ/ลบข้อมูลที่เกี่ยวข้องให้ชัดเจน`, 'shield-alert');
  }
  async function runBulkAction(kind) {
    const ids = [...new Set(selectedFor(kind))];
    if (!ids.length) return;
    if (!assertAdmin()) return;
    if (kind === 'users') return bulkUserDeleteBlocked(ids);
    const isOrders = kind === 'orders';
    confirmAction({
      title: isOrders ? 'ยืนยันลบคิวงานที่เลือก' : 'ยืนยันลบประวัติเติม Coins',
      message: isOrders
        ? `คุณเลือก ${ids.length} คิว\nระบบจะตรวจสถานะจริงจากฐานข้อมูลอีกครั้งและลบได้เฉพาะคิวที่พิมพ์เสร็จแล้ว\nการลบไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่?`
        : `คุณเลือกประวัติเติม Coins ${ids.length} รายการ\nระบบจะลบเฉพาะรายการที่อนุมัติหรือปฏิเสธแล้ว ไม่เปลี่ยนยอด Coins ในกระเป๋า\nการลบไม่สามารถย้อนกลับได้ ต้องการดำเนินการต่อหรือไม่?`,
      icon: 'trash-2', confirmText: 'ยืนยันลบรายการ',
      onConfirm: async () => {
        const button = document.querySelector(`[data-pd-bulk-action="${kind}"]`);
        if (button) { button.disabled = true; button.textContent = 'กำลังตรวจสอบ…'; }
        try { if (kind === 'orders') await bulkDeleteOrders(ids); else await bulkDeleteTopups(ids); }
        catch (error) { notice('ลบรายการไม่สำเร็จ', error?.message || String(error), 'shield-alert'); }
        finally {
          if (button) button.textContent = bulkConfigs[kind].button;
          enhanceAdminTables();
        }
      }
    });
  }

  document.addEventListener('change', event => {
    const all = event.target.closest('[data-pd-bulk-select-all]');
    if (all) {
      const kind = all.closest('[data-pd-bulk-toolbar]')?.dataset.pdBulkToolbar;
      if (!kind) return;
      const tbody = $(bulkConfigs[kind].tbody);
      tbody?.querySelectorAll(`input[data-pd-bulk-item="${kind}"]:not(:disabled)`).forEach(cb => { cb.checked = all.checked; });
      syncBulkToolbar(kind); return;
    }
    const cb = event.target.closest('input[data-pd-bulk-item]');
    if (cb) syncBulkToolbar(cb.dataset.pdBulkItem);
  });
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-pd-bulk-action]');
    if (button) { event.preventDefault(); runBulkAction(button.dataset.pdBulkAction); }
  });

  /* PDF PREVIEW REPAIR v24.2
     The previous last override only populated the page-selection thumbnails and
     explicitly emptied #pdf-preview-wrapper. This replacement renders both the
     thumbnail grid and the full-size preview, with lazy rendering and clear status. */
  let pdPdfPreviewState = null;
  let pdPdfPreviewGeneration = 0;
  window.renderPdfThumbnails = function (pdf) {
    const grid = $('pages-grid-container');
    const drawer = $('pdf-preview-wrapper');
    if (!grid || !drawer || !pdf || !Number.isInteger(pdf.numPages) || pdf.numPages < 1) {
      const msg = $('pdf-preview-wrapper');
      if (msg) msg.textContent = 'ไม่พบหน้าของเอกสาร PDF ที่สามารถแสดงได้';
      return;
    }

    if (grid.__pdPdfCleanup) { try { grid.__pdPdfCleanup(); } catch (_) {} }
    if (drawer.__pdPdfCleanup) { try { drawer.__pdPdfCleanup(); } catch (_) {} }
    if (pdPdfPreviewState) {
      const old = pdPdfPreviewState;
      old.disposed = true;
      old.thumbObserver?.disconnect();
      old.pageObserver?.disconnect();
      old.tasks.forEach(task => { try { task.cancel(); } catch (_) {} });
      old.queue.length = 0;
      if (old.pdf && old.pdf !== pdf && typeof old.pdf.destroy === 'function') {
        try { Promise.resolve(old.pdf.destroy()).catch(() => {}); } catch (_) {}
      }
    }

    const state = {
      pdf, generation: ++pdPdfPreviewGeneration, disposed: false,
      queue: [], active: 0, concurrency: 1, tasks: new Set(),
      thumbObserver: null, pageObserver: null
    };
    pdPdfPreviewState = state;
    grid.dataset.pdPreviewDensity = (window.devicePixelRatio || 1) >= 1.5 ? 'high' : 'standard';
    if (typeof currentPdfZoom !== 'undefined') currentPdfZoom = 1;
    drawer.style.transform = 'scale(1)';
    if ($('zoom-level-text')) $('zoom-level-text').textContent = '100%';
    grid.className = 'pd-v15-page-picker ui-input';
    grid.replaceChildren();
    drawer.replaceChildren();

    function isCurrent() {
      return !state.disposed && pdPdfPreviewState === state && state.generation === pdPdfPreviewGeneration;
    }

    function setPageCount() {
      const pages = pdf.numPages;
      if ($('total-pages-display')) $('total-pages-display').textContent = `${pages} หน้า`;
      if ($('selected-pages-count-display')) $('selected-pages-count-display').textContent = `${pages} หน้า`;
      if ($('printed-pages-input')) $('printed-pages-input').value = String(pages);
      if ($('preview-modal-pages')) $('preview-modal-pages').textContent = `${pages} หน้า`;
      if ($('preview-modal-type')) $('preview-modal-type').textContent = 'PDF';
      window.detectedPageCount = pages;
      window.calculatePrice?.();
    }

    function schedule(canvas, pageNumber, kind, priority = false) {
      if (!isCurrent() || !canvas || !canvas.isConnected) return;
      if (['queued', 'rendering', 'ready'].includes(canvas.dataset.renderState)) return;
      canvas.dataset.renderState = 'queued';
      const job = { canvas, pageNumber, kind, generation: state.generation };
      if (priority) state.queue.unshift(job); else state.queue.push(job);
      void drain();
    }

    async function drain() {
      if (!isCurrent() || state.active >= state.concurrency || !state.queue.length) return;
      const job = state.queue.shift();
      if (!job || job.generation !== state.generation || !job.canvas?.isConnected) {
        void drain(); return;
      }
      state.active++;
      job.canvas.dataset.renderState = 'rendering';
      const pageBox = job.canvas.closest('.pd-v15-preview-page');
      const status = pageBox?.querySelector('.pd-pdf-page-status');
      if (status) { status.textContent = 'กำลังสร้างพรีวิวความคมชัดสูง…'; status.dataset.state = 'loading'; }
      let renderTask = null;
      try {
        const page = await pdf.getPage(job.pageNumber);
        if (!isCurrent() || !job.canvas.isConnected) return;
        const base = page.getViewport({ scale: 1 });
        const parent = job.canvas.parentElement;
        const boxWidth = parent?.clientWidth || (job.kind === 'thumb' ? 140 : 820);
        const targetWidth = job.kind === 'thumb'
          ? Math.min(150, Math.max(100, boxWidth - 18))
          : Math.min(820, Math.max(280, boxWidth - 24));
        const scale = Math.min(job.kind === 'thumb' ? 0.35 : 2.0, targetWidth / Math.max(1, base.width));
        const viewport = page.getViewport({ scale });
        const requestedDpr = Math.max(1, Math.min(job.kind === 'thumb' ? 1.75 : 2.0, Number(window.devicePixelRatio) || 1));
        const pixelCount = Math.max(1, viewport.width * viewport.height);
        const dpr = Math.max(1, Math.min(requestedDpr, Math.sqrt(16000000 / pixelCount)));
        const canvas = job.canvas;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('Canvas 2D is unavailable');
        canvas.width = Math.max(1, Math.ceil(viewport.width * dpr));
        canvas.height = Math.max(1, Math.ceil(viewport.height * dpr));
        canvas.style.aspectRatio = `${viewport.width} / ${viewport.height}`;
        canvas.style.background = '#ffffff';
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        renderTask = page.render({
          canvasContext: ctx,
          viewport,
          transform: dpr > 1 ? [dpr, 0, 0, dpr, 0, 0] : null
        });
        state.tasks.add(renderTask);
        await renderTask.promise;
        if (!isCurrent() || !canvas.isConnected) return;
        canvas.dataset.renderState = 'ready';
        if (status) status.remove();
        page.cleanup?.();
      } catch (error) {
        if (!isCurrent() || !job.canvas?.isConnected) return;
        const cancelled = error?.name === 'RenderingCancelledException';
        job.canvas.dataset.renderState = cancelled ? 'idle' : 'failed';
        if (!cancelled) {
          if (status) {
            status.textContent = 'พรีวิวหน้านี้ไม่สำเร็จ กรุณาลองอัปโหลดไฟล์ PDF ใหม่';
            status.dataset.state = 'error';
            status.setAttribute('role', 'alert');
          } else {
            const errorLabel = document.createElement('span');
            errorLabel.className = 'pd-pdf-render-error';
            errorLabel.textContent = 'แสดงหน้านี้ไม่สำเร็จ';
            job.canvas.parentElement?.appendChild(errorLabel);
          }
          console.warn('[PrintDekD PDF preview]', `page ${job.pageNumber}`, error?.message || error);
        }
      } finally {
        if (renderTask) state.tasks.delete(renderTask);
        state.active = Math.max(0, state.active - 1);
        if (isCurrent() && state.queue.length) queueMicrotask(drain);
      }
    }

    function createCanvas(kind, pageNumber) {
      const canvas = document.createElement('canvas');
      canvas.className = kind === 'thumb' ? 'pd-v15-thumb-canvas pd-pdf-hires-thumb' : 'pd-v15-page-canvas';
      canvas.dataset.page = String(pageNumber);
      canvas.dataset.kind = kind;
      canvas.dataset.renderState = 'idle';
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `ตัวอย่างเอกสารหน้า ${pageNumber}`);
      canvas.style.background = '#ffffff';
      return canvas;
    }

    for (let i = 1; i <= pdf.numPages; i++) {
      /* Page selection thumbnail */
      const card = document.createElement('label');
      card.className = 'pd-v15-thumb-card pd-v10-page-card is-selected';
      card.dataset.page = String(i);
      const cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true; cb.value = String(i); cb.className = 'sr-only';
      cb.setAttribute('aria-label', `เลือกหน้า ${i} เพื่อพิมพ์`);
      const thumb = createCanvas('thumb', i);
      const pageLabel = document.createElement('span');
      pageLabel.className = 'pd-v15-page-num pd-page-number';
      const check = document.createElement('span'); check.className = 'pd-v15-check pd-page-check'; check.textContent = '✓'; check.setAttribute('aria-hidden', 'true');
      const pageText = document.createElement('span'); pageText.textContent = `หน้า ${i}`;
      pageLabel.append(check, pageText);
      card.append(cb, thumb, pageLabel);
      grid.appendChild(card);
      cb.addEventListener('change', () => {
        card.classList.toggle('is-selected', cb.checked);
        window.updateGridSelectedCount?.();
      });
      card.addEventListener('click', event => {
        if (event.target === cb || event.target.closest('input')) return;
        event.preventDefault();
        cb.checked = !cb.checked;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
      });

      /* Full-size page preview. This is the area that the previous override left empty. */
      const pageBox = document.createElement('section');
      pageBox.className = 'pd-v15-preview-page';
      pageBox.dataset.page = String(i);
      const pageTag = document.createElement('span');
      pageTag.className = 'pd-v15-preview-label'; pageTag.textContent = `หน้า ${i}`;
      const pageStatus = document.createElement('span');
      pageStatus.className = 'pd-pdf-page-status'; pageStatus.textContent = 'รอแสดงตัวอย่าง…';
      pageStatus.setAttribute('role', 'status');
      const fullCanvas = createCanvas('preview', i);
      pageBox.append(pageTag, pageStatus, fullCanvas);
      drawer.appendChild(pageBox);
    }

    /* Lazy-load thumbnails and full-size pages; the first full page is rendered immediately. */
    if ('IntersectionObserver' in window) {
      state.thumbObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          state.thumbObserver?.unobserve(entry.target);
          const card = entry.target.closest('.pd-v15-thumb-card');
          const canvas = card?.querySelector('canvas');
          schedule(canvas, Number(card?.dataset.page), 'thumb');
        });
      }, { root: grid, rootMargin: '180px 0px', threshold: 0.01 });
      grid.querySelectorAll('.pd-v15-thumb-card').forEach(card => state.thumbObserver.observe(card));

      const scrollRoot = drawer.parentElement;
      state.pageObserver = new IntersectionObserver(entries => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return;
          state.pageObserver?.unobserve(entry.target);
          const canvas = entry.target;
          schedule(canvas, Number(canvas.dataset.page), 'preview');
        });
      }, { root: scrollRoot, rootMargin: '320px 0px', threshold: 0.01 });
      drawer.querySelectorAll('.pd-v15-page-canvas').forEach(canvas => state.pageObserver.observe(canvas));
    } else {
      grid.querySelectorAll('.pd-v15-thumb-card').forEach((card, index) => {
        if (index < 8) schedule(card.querySelector('canvas'), Number(card.dataset.page), 'thumb');
      });
      drawer.querySelectorAll('.pd-v15-page-canvas').forEach((canvas, index) => {
        if (index < 2) schedule(canvas, Number(canvas.dataset.page), 'preview', index === 0);
      });
    }

    const firstPage = drawer.querySelector('.pd-v15-page-canvas');
    if (firstPage) schedule(firstPage, 1, 'preview', true);
    setPageCount();

    function refreshVisible() {
      if (!isCurrent()) return;
      const modal = $('file-preview-drawer');
      const modalOpen = !!modal && !modal.classList.contains('hidden') && modal.getBoundingClientRect().width > 0;
      if (!modalOpen) return;
      const scrollRoot = drawer.parentElement;
      const rootRect = scrollRoot?.getBoundingClientRect();
      if (rootRect && rootRect.width > 0 && rootRect.height > 0) {
        drawer.querySelectorAll('.pd-v15-page-canvas').forEach(canvas => {
          if (['queued', 'rendering', 'ready'].includes(canvas.dataset.renderState)) return;
          const r = canvas.getBoundingClientRect();
          if (r.bottom >= rootRect.top - 320 && r.top <= rootRect.bottom + 320) {
            state.pageObserver?.unobserve(canvas);
            schedule(canvas, Number(canvas.dataset.page), 'preview', Number(canvas.dataset.page) === 1);
          }
        });
      }
    }
    window.__pdV15RefreshPreview = refreshVisible;
    window.__pdPdfPreviewRefresh = refreshVisible;
    grid.__pdPdfCleanup = drawer.__pdPdfCleanup = () => {
      if (state.disposed) return;
      state.disposed = true;
      state.thumbObserver?.disconnect(); state.pageObserver?.disconnect();
      state.queue.length = 0;
      state.tasks.forEach(task => { try { task.cancel(); } catch (_) {} });
      state.tasks.clear();
    };

    /* Render page one before the modal opens, so users never see an empty preview. */
    if (firstPage) schedule(firstPage, 1, 'preview', true);
    if (window.lucide) window.lucide.createIcons();
    window.calculatePrice?.();
    window.setTimeout?.(refreshVisible, 80);
  };

  /* On opening the preview modal, re-check the viewport after its display transition. */
  const pdOriginalPreviewToggle = window.toggleFilePreviewDrawer;
  window.toggleFilePreviewDrawer = function (show = true) {
    if (typeof pdOriginalPreviewToggle === 'function') pdOriginalPreviewToggle.call(this, show);
    const modal = $('file-preview-drawer');
    if (modal) modal.classList.toggle('hidden', !show);
    if (show) {
      requestAnimationFrame(() => window.__pdPdfPreviewRefresh?.());
      setTimeout(() => window.__pdPdfPreviewRefresh?.(), 120);
    }
  };

  function disposePdPdfPreview() {
    const state = pdPdfPreviewState;
    if (!state) return;
    state.disposed = true;
    state.thumbObserver?.disconnect(); state.pageObserver?.disconnect();
    state.queue.length = 0;
    state.tasks.forEach(task => { try { task.cancel(); } catch (_) {} });
    state.tasks.clear();
    if (state.pdf && typeof state.pdf.destroy === 'function') {
      try { Promise.resolve(state.pdf.destroy()).catch(() => {}); } catch (_) {}
    }
    pdPdfPreviewState = null;
  }
  const pdOriginalRemoveSelectedPrintFile = window.removeSelectedPrintFile;
  if (typeof pdOriginalRemoveSelectedPrintFile === 'function') {
    window.removeSelectedPrintFile = function (...args) {
      disposePdPdfPreview();
      return pdOriginalRemoveSelectedPrintFile.apply(this, args);
    };
  }
  $('print-form')?.addEventListener('reset', () => setTimeout(disposePdPdfPreview, 0));

  function ready() {
    enhanceAdminTables();
    /* Keep the title natural-flowing if another script re-inserts its copy from cached markup. */
    const storyHeading = document.querySelector('.pd-story-section .pd-section-heading h2');
    if (storyHeading && storyHeading.innerHTML.includes('ทุกขั้นตอนถูกออกแบบ<br')) storyHeading.innerHTML = 'ทุกขั้นตอนถูกออกแบบ <em>ให้รู้สึกง่าย</em>';
    try { window.lucide?.createIcons?.(); } catch (_) {}
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ready, { once: true }); else ready();
  const admin = $('view-admin');
  if (admin && 'MutationObserver' in window) {
    let queued = false;
    const observer = new MutationObserver(() => {
      if (queued) return; queued = true;
      requestAnimationFrame(() => { queued = false; enhanceAdminTables(); });
    });
    observer.observe(admin, { childList: true, subtree: true });
  }
})();
