/* PrintDekD Pro — Mini Project employee + admin scope runtime.
 * All privileged writes go through role-checked RPCs or existing Admin-only RLS.
 * Printer connectivity is only live when a real Print Server updates last_seen_at.
 */
(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const db = () => window.supabaseClient || (typeof supabaseClient !== 'undefined' ? supabaseClient : null);
  const role = () => String(window.currentUser?.role || '').toLowerCase();
  const isAdmin = () => role() === 'admin';
  const isStaff = () => ['admin', 'employee'].includes(role());
  const esc = (value) => typeof window.escapeHtml === 'function'
    ? window.escapeHtml(String(value ?? ''))
    : String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = (n) => (Number(n || 0)).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});
  const notice = (title, message, icon = 'info') => {
    if (typeof window.notifyV12 === 'function') return window.notifyV12(title, message, icon);
    if (typeof window.showCustomModal === 'function') return window.showCustomModal({title, message, icon});
  };
  const humanStatus = (status) => ({
    queued:'รอจัดการงานพิมพ์', printing:'กำลังพิมพ์ (สถานะเดิม)', completed:'พิมพ์เสร็จแล้ว',
    preparing:'กำลังจัดเตรียม / เข้าเล่ม', ready_for_pickup:'พร้อมรับ / พร้อมจัดส่ง',
    shipped:'จัดส่งแล้ว', finished:'ส่งมอบเรียบร้อย', cancelled:'ยกเลิกแล้ว', failed:'ต้องตรวจสอบแก้ไข', pending:'รอจัดการงานพิมพ์'
  })[String(status || '').toLowerCase()] || String(status || 'ไม่ทราบสถานะ');
  const roleLabel = (v) => ({admin:'Admin · ผู้ดูแลระบบ',employee:'Employee · พนักงาน',staff:'Staff เดิม · ต้องปรับเป็น Employee',member:'Member · ลูกค้า'})[v] || v;
  let activePricing = [];
  let activeBindings = [];
  let activeDeliveries = [];
  let configLoadPromise = null;
  let employeeOrdersCache = [];
  let adminReportCache = null;

  function selectedDeliveryMethod() {
    return document.querySelector('input[name="delivery_method"]:checked')?.value || 'pickup';
  }
  function currentText(id) { return String($(id)?.value ?? '').trim(); }
  function selectedPageCount() {
    const mode = document.querySelector('input[name="page_selection_mode"]:checked')?.value || 'text';
    if (mode === 'grid') return [...document.querySelectorAll('#pages-grid-container input[type="checkbox"]:checked')].length || 1;
    const raw = currentText('page-range-input');
    const total = Math.max(1, Number.parseInt(currentText('printed-pages-input'), 10) || Number(window.detectedPageCount) || 1);
    if (!raw || /^all$|^ทั้งหมด$/i.test(raw)) return Math.min(total, Number(window.detectedPageCount) || total);
    const nums = new Set();
    for (const part of raw.replace(/\s/g,'').split(',')) {
      if (/^\d+$/.test(part)) nums.add(Number(part));
      else if (/^\d+-\d+$/.test(part)) {
        const [a,b] = part.split('-').map(Number);
        if (a > 0 && b >= a && b-a < 5001) for (let i=a;i<=b;i++) nums.add(i);
      } else return total;
    }
    return Math.max(1, nums.size);
  }

  async function loadServiceOptions(force = false) {
    if (configLoadPromise && !force) return configLoadPromise;
    configLoadPromise = (async () => {
      const client = db();
      if (!client) return;
      const [bindRes, deliveryRes, priceRes] = await Promise.all([
        client.from('binding_options').select('id,name,price,active').eq('active', true).order('id'),
        client.from('delivery_options').select('provider_key,name,fee,active').eq('active', true).order('name'),
        client.from('pricing').select('paper_size,black_white_price,color_price,duplex_price,active').eq('active', true).order('paper_size')
      ]);
      activeBindings = bindRes.error ? [] : (bindRes.data || []);
      activeDeliveries = deliveryRes.error ? [] : (deliveryRes.data || []).filter(x => x.fee !== null && x.fee !== undefined && Number.isFinite(Number(x.fee)));
      activePricing = priceRes.error ? [] : (priceRes.data || []);
      const bindSelect = $('binding-option');
      if (bindSelect && !bindRes.error) {
        const previous = bindSelect.value;
        bindSelect.innerHTML = activeBindings.length
          ? activeBindings.map(x => `<option value="${esc(x.id)}">${esc(x.name)} · ${money(x.price)} ฿/ชุด</option>`).join('')
          : '<option value="">ไม่มีตัวเลือกเข้าเล่มที่เปิดใช้</option>';
        bindSelect.disabled = !activeBindings.length;
        if (activeBindings.some(x => String(x.id) === previous)) bindSelect.value = previous;
        else {
          const noBinding = activeBindings.find(x => /ไม่เข้าเล่ม|ไม่ต้องเข้าเล่ม|none/i.test(x.name));
          bindSelect.value = String((noBinding || activeBindings[0] || {}).id ?? '');
        }
      }
      const providerSelect = $('delivery-provider');
      if (providerSelect && !deliveryRes.error) {
        const previous = providerSelect.value;
        providerSelect.innerHTML = activeDeliveries.length
          ? activeDeliveries.map(x => `<option value="${esc(x.provider_key)}">${esc(x.name)} · ${money(x.fee)} ฿</option>`).join('')
          : '<option value="">ไม่มีช่องทางจัดส่งที่เปิดใช้</option>';
        providerSelect.disabled = !activeDeliveries.length;
        if (activeDeliveries.some(x => x.provider_key === previous)) providerSelect.value = previous;
        else providerSelect.value = String((activeDeliveries.find(x => x.provider_key === 'parcel') || activeDeliveries[0] || {}).provider_key || '');
      }
      refreshPricePreview();
    })().catch(error => {
      console.warn('[PrintDekD] service options load failed:', error);
      configLoadPromise = null;
    }).finally(() => { configLoadPromise = null; });
    return configLoadPromise;
  }

  function refreshPricePreview() {
    const method = selectedDeliveryMethod();
    const paper = currentText('paper-size') || 'A4';
    const copies = Math.max(1, Number.parseInt(currentText('copies'), 10) || 1);
    const pages = selectedPageCount();
    const pricing = activePricing.find(x => x.paper_size === paper);
    const binding = activeBindings.find(x => String(x.id) === currentText('binding-option'));
    const provider = activeDeliveries.find(x => x.provider_key === currentText('delivery-provider'));
    const isColor = currentText('color-type') === 'color';
    const isDuplex = currentText('duplex-type') === 'duplex';
    if (!pricing) return;
    const pageRate = Number(isColor ? pricing.color_price : pricing.black_white_price) + (isDuplex ? Number(pricing.duplex_price || 0) : 0);
    const bindingFee = Number(binding?.price || 0) * copies;
    const deliveryFee = method === 'delivery' ? Number(provider?.fee || 0) : 0;
    const total = Number((pages * pageRate * copies + bindingFee + deliveryFee).toFixed(2));
    if ($('total-price')) $('total-price').textContent = `${money(total)} ฿`;
    if ($('price-breakdown')) $('price-breakdown').textContent = `${pages} หน้า × ${money(pageRate)} ฿ × ${copies} ชุด${bindingFee ? ` + เข้าเล่ม ${money(bindingFee)} ฿` : ''}${method === 'delivery' ? ` + จัดส่ง ${money(deliveryFee)} ฿` : ' + รับที่ร้าน 0.00 ฿'}`;
    if ($('delivery-fee-label')) $('delivery-fee-label').textContent = method === 'delivery' ? (provider ? `+ค่าส่ง ${money(provider.fee)} ฿ · ${provider.name}` : 'ยังไม่มีผู้ให้บริการที่กำหนดราคา') : 'รับที่ร้าน ไม่มีค่าจัดส่ง';
    return total;
  }

  function wrapPriceCalculator() {
    const original = window.calculatePrice;
    if (typeof original === 'function' && !original.__pdScopeWrapped) {
      const wrapped = function (...args) {
        let result;
        try { result = original.apply(this, args); } catch (e) { console.warn(e); }
        refreshPricePreview();
        return result;
      };
      wrapped.__pdScopeWrapped = true;
      window.calculatePrice = wrapped;
    }
    const methodInputs = document.querySelectorAll('input[name="delivery_method"]');
    methodInputs.forEach(el => el.addEventListener('change', () => { if (selectedDeliveryMethod() === 'delivery') loadServiceOptions(); refreshPricePreview(); }));
  }

  function activatePanel(name) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'เมนูนี้สำหรับ Admin เท่านั้น', 'shield-alert');
    const tabs = ['orders','topups','payments','users','services','printers','reports'];
    for (const t of tabs) {
      $(`admin-tab-${t}`)?.classList.toggle('hidden', t !== name);
      const btn = $(`admin-tab-${t}-btn`);
      if (btn) btn.className = `flex-1 min-w-max px-3 py-2 text-xs font-bold rounded-lg ${t===name?'bg-purple-600 text-white shadow-sm':'titanium-text opacity-80 hover:opacity-100'}`;
    }
    if (name === 'payments') loadAdminPayments();
    if (name === 'services') loadAdminServices();
    if (name === 'printers') loadAdminPrinters();
    if (name === 'reports') loadAdminReports();
    if (name === 'users' || name === 'orders' || name === 'topups') window.loadAdminData?.();
  }
  window.switchAdminTab = activatePanel;

  function priceRow(row) {
    return `<tr class="border-b border-slate-200/60 dark:border-white/10" data-pd-price-row="${esc(row.paper_size)}">
      <td class="py-3 px-2 font-black titanium-text">${esc(row.paper_size)}</td>
      <td class="py-3 px-2"><input data-price-field="black_white_price" type="number" min="0" step="0.01" value="${esc(row.black_white_price)}" class="ui-input rounded-lg p-2 w-24 text-xs"></td>
      <td class="py-3 px-2"><input data-price-field="color_price" type="number" min="0" step="0.01" value="${esc(row.color_price)}" class="ui-input rounded-lg p-2 w-24 text-xs"></td>
      <td class="py-3 px-2"><input data-price-field="duplex_price" type="number" min="0" step="0.01" value="${esc(row.duplex_price)}" class="ui-input rounded-lg p-2 w-24 text-xs"></td>
      <td class="py-3 px-2"><input data-price-field="active" type="checkbox" ${row.active?'checked':''} aria-label="เปิดใช้ ${esc(row.paper_size)}"></td>
      <td class="py-3 px-2"><button type="button" data-pd-save-price="${esc(row.paper_size)}" class="rounded-lg bg-purple-600 text-white px-3 py-2 font-bold">บันทึก</button></td></tr>`;
  }

  async function loadAdminServices() {
    if (!isAdmin() || !db()) return;
    const client = db();
    const [prices, bindings, delivery] = await Promise.all([
      client.from('pricing').select('paper_size,black_white_price,color_price,duplex_price,active').order('paper_size'),
      client.from('binding_options').select('id,name,price,active').order('id'),
      client.from('delivery_options').select('provider_key,name,fee,active').order('name')
    ]);
    if (prices.error || bindings.error || delivery.error) {
      const err = prices.error || bindings.error || delivery.error;
      $('pd-admin-pricing-tbody').innerHTML = `<tr><td colspan="6" class="py-5 text-rose-400">โหลดค่าบริการไม่สำเร็จ: ${esc(err.message)}</td></tr>`;
      return notice('โหลดค่าบริการไม่สำเร็จ', err.message || 'ตรวจสอบตารางและ RLS ของ pricing, binding_options, delivery_options', 'database');
    }
    $('pd-admin-pricing-tbody').innerHTML = (prices.data || []).map(priceRow).join('') || '<tr><td colspan="6" class="py-5 sub-text">ยังไม่มีตารางราคา</td></tr>';
    $('pd-admin-binding-list').innerHTML = (bindings.data || []).map(x => `<div class="pd-admin-config-row" data-binding-row="${esc(x.id)}"><input data-binding-name value="${esc(x.name)}" maxlength="80" class="ui-input rounded-lg p-2 min-w-0 flex-1 text-xs"><input data-binding-price type="number" min="0" step="0.01" value="${esc(x.price)}" class="ui-input rounded-lg p-2 w-24 text-xs"><label class="flex items-center gap-1 text-xs sub-text"><input data-binding-active type="checkbox" ${x.active?'checked':''}>เปิด</label><button data-pd-save-binding="${esc(x.id)}" type="button" class="rounded-lg bg-purple-600 text-white px-3 py-2 text-xs font-bold">บันทึก</button></div>`).join('') || '<p class="text-xs sub-text">ไม่มีตัวเลือกเข้าเล่ม</p>';
    $('pd-admin-delivery-list').innerHTML = (delivery.data || []).map(x => `<div class="pd-admin-config-row" data-delivery-row="${esc(x.provider_key)}"><span class="font-mono text-[10px] sub-text w-24 break-all">${esc(x.provider_key)}</span><input data-delivery-name value="${esc(x.name)}" maxlength="80" class="ui-input rounded-lg p-2 min-w-0 flex-1 text-xs"><input data-delivery-fee type="number" min="0" step="0.01" value="${x.fee===null?'':esc(x.fee)}" placeholder="ตั้งราคา" class="ui-input rounded-lg p-2 w-24 text-xs"><label class="flex items-center gap-1 text-xs sub-text"><input data-delivery-active type="checkbox" ${x.active?'checked':''}>เปิด</label><button data-pd-save-delivery="${esc(x.provider_key)}" type="button" class="rounded-lg bg-purple-600 text-white px-3 py-2 text-xs font-bold">บันทึก</button></div>`).join('') || '<p class="text-xs sub-text">ยังไม่มีช่องทางจัดส่ง</p>';
    await loadServiceOptions(true);
  }

  async function savePrice(button) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'เฉพาะ Admin เท่านั้นที่แก้ราคาได้', 'shield-alert');
    const row = button.closest('[data-pd-price-row]'); if (!row) return;
    const paper_size = row.dataset.pdPriceRow;
    const read = name => row.querySelector(`[data-price-field="${name}"]`);
    const item = { paper_size, black_white_price:Number(read('black_white_price').value), color_price:Number(read('color_price').value), duplex_price:Number(read('duplex_price').value), active:read('active').checked, updated_at:new Date().toISOString() };
    if (![item.black_white_price,item.color_price,item.duplex_price].every(x => Number.isFinite(x) && x >= 0)) return notice('ราคาไม่ถูกต้อง', 'กรอกราคาเป็นตัวเลขตั้งแต่ 0 ขึ้นไป', 'alert-triangle');
    button.disabled = true;
    try { const {error} = await db().from('pricing').upsert(item,{onConflict:'paper_size'}); if(error) throw error; notice('บันทึกราคาแล้ว', `${paper_size}: ขาวดำ ${money(item.black_white_price)} / สี ${money(item.color_price)} / เพิ่มหน้า-หลัง ${money(item.duplex_price)} บาท`, 'check-circle-2'); await loadAdminServices(); }
    catch(e) { notice('บันทึกราคาไม่สำเร็จ',e.message || 'ตรวจสอบ RLS ของ pricing','shield-alert'); }
    finally { button.disabled = false; }
  }
  async function saveBinding(button) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์','เฉพาะ Admin เท่านั้นที่แก้ค่าบริการได้','shield-alert');
    const row = button.closest('[data-binding-row]'); if(!row) return;
    const name=row.querySelector('[data-binding-name]').value.trim(), price=Number(row.querySelector('[data-binding-price]').value), active=row.querySelector('[data-binding-active]').checked;
    if(!name || !Number.isFinite(price) || price<0) return notice('ข้อมูลเข้าเล่มไม่ถูกต้อง','กรอกชื่อบริการและราคาตั้งแต่ 0 บาทขึ้นไป','alert-triangle');
    button.disabled=true;
    try { const {error}=await db().from('binding_options').update({name,price,active,updated_at:new Date().toISOString()}).eq('id',row.dataset.bindingRow); if(error)throw error; notice('บันทึกบริการเข้าเล่มแล้ว',name,'check-circle-2'); await loadAdminServices(); }
    catch(e){notice('บันทึกเข้าเล่มไม่สำเร็จ',e.message,'shield-alert');} finally {button.disabled=false;}
  }
  async function saveDelivery(button) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์','เฉพาะ Admin เท่านั้นที่แก้ค่าจัดส่งได้','shield-alert');
    const row=button.closest('[data-delivery-row]');if(!row)return;
    const provider_key=row.dataset.deliveryRow, name=row.querySelector('[data-delivery-name]').value.trim(), rawFee=row.querySelector('[data-delivery-fee]').value.trim(), active=row.querySelector('[data-delivery-active]').checked;
    const fee=rawFee===''?null:Number(rawFee);
    if(!name || (fee!==null&&(!Number.isFinite(fee)||fee<0)) || (active&&fee===null)) return notice('ข้อมูลจัดส่งไม่ถูกต้อง','ต้องมีชื่อบริการ และหากเปิดใช้งานต้องกำหนดค่าจัดส่งตั้งแต่ 0 บาทขึ้นไป','alert-triangle');
    button.disabled=true;
    try {const {error}=await db().from('delivery_options').update({name,fee,active,updated_at:new Date().toISOString()}).eq('provider_key',provider_key);if(error)throw error;notice('บันทึกช่องทางจัดส่งแล้ว',`${name} · ${fee===null?'ยังไม่ตั้งราคา':money(fee)+' บาท'} · ${active?'เปิดใช้':'ปิดใช้'}`,'check-circle-2');await loadAdminServices();}
    catch(e){notice('บันทึกช่องทางจัดส่งไม่สำเร็จ',e.message,'shield-alert');}finally{button.disabled=false;}
  }

  async function loadAdminPrinters() {
    if (!isAdmin() || !db()) return;
    const {data,error}=await db().from('printers').select('id,name,ip_address,location,status,last_seen_at').order('id');
    if(error){$('pd-admin-printers-tbody').innerHTML=`<tr><td colspan="5" class="py-5 text-rose-400">${esc(error.message)}</td></tr>`;return notice('โหลดเครื่องพิมพ์ไม่สำเร็จ',error.message,'database');}
    $('pd-admin-printers-tbody').innerHTML=(data||[]).map(x=>{
      const fresh=x.last_seen_at && (Date.now()-new Date(x.last_seen_at).getTime()<=180000);
      const hb=x.last_seen_at?`${new Date(x.last_seen_at).toLocaleString('th-TH')}${fresh?' · heartbeat ล่าสุด':' · ข้อมูลเก่า'}`:'ยังไม่มี heartbeat';
      const status=x.status||'offline';
      return `<tr class="border-b border-slate-200/60 dark:border-white/10" data-printer-row="${esc(x.id)}"><td class="py-3 px-2 min-w-[150px]"><input data-printer-name value="${esc(x.name)}" maxlength="100" class="ui-input rounded-lg p-2 w-full text-xs"><input data-printer-location value="${esc(x.location||'')}" maxlength="120" placeholder="ตำแหน่ง" class="ui-input rounded-lg p-2 w-full text-xs mt-1"></td><td class="py-3 px-2"><input data-printer-ip value="${esc(x.ip_address||'')}" maxlength="100" class="ui-input rounded-lg p-2 w-36 text-xs"></td><td class="py-3 px-2"><select data-printer-status class="ui-input rounded-lg p-2 text-xs"><option value="online" ${status==='online'?'selected':''}>ออนไลน์ (ค่าที่บันทึก)</option><option value="offline" ${status==='offline'?'selected':''}>ออฟไลน์</option><option value="busy" ${status==='busy'?'selected':''}>กำลังทำงาน</option><option value="error" ${status==='error'?'selected':''}>ขัดข้อง</option><option value="maintenance" ${status==='maintenance'?'selected':''}>บำรุงรักษา</option></select><p class="text-[10px] ${fresh?'text-emerald-500':'text-amber-500'} mt-1">${fresh?'เชื่อมต่อผ่าน heartbeat ล่าสุด':'ยังยืนยันการเชื่อมต่อจริงไม่ได้'}</p></td><td class="py-3 px-2 sub-text min-w-[180px]">${esc(hb)}</td><td class="py-3 px-2"><button type="button" data-pd-save-printer="${esc(x.id)}" class="rounded-lg bg-purple-600 text-white px-3 py-2 font-bold">บันทึก</button></td></tr>`;
    }).join('')||'<tr><td colspan="5" class="py-7 text-center sub-text">ยังไม่มีข้อมูลเครื่องพิมพ์ เพิ่มเครื่องแรกได้จากแบบฟอร์มด้านบน</td></tr>';
  }
  async function savePrinter(button) {
    if(!isAdmin())return notice('จำกัดสิทธิ์','เฉพาะ Admin เท่านั้นที่แก้ข้อมูลเครื่องพิมพ์ได้','shield-alert');
    const row=button.closest('[data-printer-row]');if(!row)return;
    const item={id:Number(row.dataset.printerRow),name:row.querySelector('[data-printer-name]').value.trim(),location:row.querySelector('[data-printer-location]').value.trim()||null,ip_address:row.querySelector('[data-printer-ip]').value.trim()||null,status:row.querySelector('[data-printer-status]').value,updated_at:new Date().toISOString()};
    if(!item.name)return notice('ข้อมูลไม่ครบ','กรุณากรอกชื่อเครื่องพิมพ์','alert-triangle');
    button.disabled=true;try{const {error}=await db().from('printers').update(item).eq('id',item.id);if(error)throw error;notice('บันทึกข้อมูลเครื่องพิมพ์แล้ว','การบันทึกนี้เป็นข้อมูล metadata ไม่ใช่การทดสอบเครือข่ายจากเบราว์เซอร์','check-circle-2');await loadAdminPrinters();}catch(e){notice('บันทึกเครื่องพิมพ์ไม่สำเร็จ',e.message,'shield-alert');}finally{button.disabled=false;}
  }

  function metricCard(title,value,note,accent='blue') { return `<div class="ui-card rounded-2xl p-4 border border-${accent}-500/20"><p class="text-xs sub-text">${esc(title)}</p><strong class="block text-2xl font-black titanium-text mt-2">${esc(value)}</strong><p class="text-[10px] sub-text mt-1">${esc(note||'')}</p></div>`; }
  function horizontalStat(label,count,total) {const pct=total?Math.max(3,Math.round(count/total*100)):0;return `<div><div class="flex justify-between gap-3 text-xs mb-1"><span class="titanium-text">${esc(label)}</span><strong class="sub-text">${esc(count)} (${pct}%)</strong></div><div class="h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden"><div class="h-full rounded-full bg-blue-500" style="width:${pct}%"></div></div></div>`;}
  async function loadAdminPayments() {
    if(!isAdmin()||!db())return;
    const tb=$('pd-admin-payments-tbody');if(tb)tb.innerHTML='<tr><td colspan="6" class="py-5 text-center sub-text">กำลังโหลดประวัติชำระเงิน…</td></tr>';
    const [payments,orders]=await Promise.all([
      db().from('payments').select('id,order_id,amount,status,payment_method,verification_status,verification_ref,created_at').order('created_at',{ascending:false}).limit(500),
      db().from('orders').select('id,queue_number').limit(1000)
    ]);
    const err=payments.error||orders.error;if(err){if(tb)tb.innerHTML=`<tr><td colspan="6" class="py-5 text-rose-400">${esc(err.message)}</td></tr>`;return notice('โหลดประวัติชำระเงินไม่สำเร็จ',err.message,'database');}
    const queues=new Map((orders.data||[]).map(o=>[String(o.id),o.queue_number]));
    tb.innerHTML=(payments.data||[]).map(x=>`<tr class="border-b border-slate-200/60 dark:border-white/10"><td class="py-3 px-2 sub-text">${esc(x.created_at?new Date(x.created_at).toLocaleString('th-TH'):'—')}</td><td class="py-3 px-2 font-mono font-bold">#${esc(queues.get(String(x.order_id))??x.order_id??'—')}</td><td class="py-3 px-2">${esc(x.payment_method||'—')}</td><td class="py-3 px-2 font-bold">${money(x.amount)} ฿</td><td class="py-3 px-2 font-bold ${x.status==='completed'?'text-emerald-500':x.status==='refunded'?'text-rose-500':'text-amber-500'}">${esc(x.status||'—')}</td><td class="py-3 px-2 sub-text">${esc(x.verification_status||'—')}${x.verification_ref?`<div class="font-mono text-[10px] break-all">${esc(x.verification_ref)}</div>`:''}</td></tr>`).join('')||'<tr><td colspan="6" class="py-8 text-center sub-text">ยังไม่มีประวัติการชำระเงิน</td></tr>';
  }

  async function loadAdminReports() {
    if(!isAdmin()||!db())return;
    const [orders,payments,topups,jobs,bindings]=await Promise.all([
      db().from('orders').select('id,status,total_amount,delivery_method,paper_size,color,created_at,copies,binding_option_id'),
      db().from('payments').select('amount,status,payment_method,created_at'),
      db().from('topups').select('amount,status'),
      db().from('print_jobs').select('paper_size,color,duplex,binding_option_id,status'),
      db().from('binding_options').select('id,name,price')
    ]);
    const errors=[orders,payments,topups,jobs,bindings].filter(x=>x.error).map(x=>x.error.message);
    if(orders.error){notice('สร้างรายงานไม่ได้',errors.join('\n'),'database');return;}
    const os=orders.data||[],ps=payments.error?[]:(payments.data||[]),ts=topups.error?[]:(topups.data||[]),js=jobs.error?[]:(jobs.data||[]),bindingMap=new Map((bindings.data||[]).map(x=>[String(x.id),x]));
    const gross=ps.filter(x=>x.status==='completed').reduce((sum,x)=>sum+Number(x.amount||0),0);
    const refunds=ps.filter(x=>x.status==='refunded').reduce((sum,x)=>sum+Number(x.amount||0),0);
    const credits=ts.filter(x=>x.status==='approved').reduce((sum,x)=>sum+Number(x.amount||0),0);
    const paidCount=ps.filter(x=>x.status==='completed').length;
    $('pd-admin-report-metrics').innerHTML=[
      metricCard('คำสั่งพิมพ์ทั้งหมด',os.length,'ทุกสถานะ','blue'),
      metricCard('ยอดธุรกรรมพิมพ์ชำระสำเร็จ',`${money(gross)} ฿`,`${paidCount} ธุรกรรม · ไม่รวมเติม Coins`,'emerald'),
      metricCard('เติม Coins ที่อนุมัติ',`${money(credits)} ฿`,`${ts.filter(x=>x.status==='approved').length} รายการ`,'amber'),
      metricCard('ยอดคืนเงินที่บันทึก',`${money(refunds)} ฿`,`${ps.filter(x=>x.status==='refunded').length} รายการ`,'rose')
    ].join('');
    const statuses=['queued','printing','completed','preparing','ready_for_pickup','shipped','finished','failed','cancelled'];
    $('pd-admin-report-status').innerHTML=statuses.map(st=>horizontalStat(humanStatus(st),os.filter(o=>o.status===st).length,os.length)).join('');
    const byPaper={};let color=0,bw=0,duplex=0,binding=0,pickup=0,delivery=0;
    js.forEach(j=>{const k=j.paper_size||'ไม่ระบุ';byPaper[k]=(byPaper[k]||0)+1;if(j.color)color++;else bw++;if(j.duplex)duplex++;if(j.binding_option_id){const chosen=bindingMap.get(String(j.binding_option_id));if(chosen&&!/ไม่เข้าเล่ม|ไม่ต้องเข้าเล่ม|\bnone\b/i.test(String(chosen.name||'')))binding++;}});
    os.forEach(o=>{if(o.delivery_method==='delivery')delivery++;else pickup++;});
    $('pd-admin-report-usage').innerHTML=[...Object.entries(byPaper).map(([k,v])=>[`กระดาษ ${k}`,v]),['พิมพ์สี',color],['ขาว-ดำ',bw],['พิมพ์สองหน้า',duplex],['เลือกเข้าเล่ม',binding],['รับที่ร้าน',pickup],['จัดส่ง',delivery]].map(([k,v])=>horizontalStat(k,v,Math.max(js.length,os.length))).join('');
    $('pd-admin-report-updated').textContent=`อัปเดตรายงานเมื่อ ${new Date().toLocaleString('th-TH')}${errors.length?' · บางแหล่งข้อมูลอ่านไม่ได้: '+errors.join(' / '):''}`;
    adminReportCache={orders:os,payments:ps,topups:ts,jobs:js};
  }

  async function loadEmployeeOrders() {
    if(!isStaff())return notice('จำกัดสิทธิ์','เฉพาะพนักงานและ Admin เท่านั้นที่ดูคิวงานในพื้นที่นี้ได้','shield-alert');
    const client=db();if(!client)return notice('ฐานข้อมูลไม่พร้อม','โปรดเชื่อมต่อ Supabase ก่อนโหลดงาน','database');
    const box=$('pd-employee-orders');if(box)box.innerHTML='<p class="text-sm sub-text text-center py-8">กำลังโหลดข้อมูลล่าสุด…</p>';
    try {
      const [ordersR,jobsR,deliveriesR,docsR]=await Promise.all([
        client.from('orders').select('id,user_id,queue_number,total_amount,status,payment_status,payment_method,estimated_pickup,admin_note,created_at,page_range,page_count,copies,color,paper_size,duplex,binding_option_id,binding_cost,delivery_method,delivery_fee').order('created_at',{ascending:false}).limit(250),
        client.from('print_jobs').select('id,order_id,document_id,copies,color,paper_size,duplex,page_range,binding_option_id,binding_cost,binding_completed,binding_completed_at,status,printer_id,attempt_count,last_error,finished_at').order('created_at',{ascending:false}).limit(250),
        client.from('deliveries').select('order_id,delivery_method,recipient_name,phone_number,delivery_address,delivery_provider,tracking_number,delivery_fee,actual_delivery_cost,status').limit(250),
        client.from('documents').select('id,file_name,file_path,page_count,file_size').limit(500)
      ]);
      const err=[ordersR,jobsR,deliveriesR,docsR].find(r=>r.error);if(err)throw err.error;
      const orderIds=(ordersR.data||[]).map(o=>o.id);
      let contactRows=[];
      if(orderIds.length){const contactRes=await client.rpc('pd_employee_order_contacts_v1',{p_order_ids:orderIds});if(contactRes.error)throw contactRes.error;contactRows=contactRes.data||[];}
      const contacts=new Map(contactRows.map(x=>[String(x.order_id),x]));
      const jobs=new Map((jobsR.data||[]).map(j=>[String(j.order_id),j]));
      const dels=new Map((deliveriesR.data||[]).map(d=>[String(d.order_id),d]));
      const docs=new Map((docsR.data||[]).map(d=>[String(d.id),d]));
      employeeOrdersCache=(ordersR.data||[]).map(o=>{const j=jobs.get(String(o.id))||{};const d=docs.get(String(j.document_id))||{};const delivery=dels.get(String(o.id))||{};const contact=contacts.get(String(o.id))||{};return {...o,customer_name:contact.customer_name||'',job:j,file_name:d.file_name||'เอกสาร PDF',file_path:d.file_path||'',page_count:d.page_count||o.page_count||1,page_range:j.page_range||o.page_range||'',copies:j.copies||o.copies||1,color:j.color??o.color??false,paper_size:j.paper_size||o.paper_size||'A4',duplex:j.duplex??o.duplex??false,binding_option_id:j.binding_option_id||o.binding_option_id,binding_cost:j.binding_cost??o.binding_cost??0,binding_completed:!!j.binding_completed,delivery_method:delivery.delivery_method||o.delivery_method||'pickup',recipient_name:delivery.recipient_name||'',phone_number:delivery.phone_number||'',delivery_address:delivery.delivery_address||'',delivery_provider:delivery.delivery_provider||'',tracking_number:delivery.tracking_number||'',delivery_fee:delivery.delivery_fee??o.delivery_fee??0,actual_delivery_cost:delivery.actual_delivery_cost??null,print_status:j.status||'',last_error:j.last_error||''};});
      const all=employeeOrdersCache;
      $('pd-employee-metrics').innerHTML=[
        metricCard('งานรอดำเนินการ',all.filter(x=>['queued','printing','pending'].includes(x.status)).length,'รอตรวจงานพิมพ์','blue'),
        metricCard('พิมพ์เสร็จแล้ว',all.filter(x=>x.status==='completed').length,'พร้อมจัดเตรียม','emerald'),
        metricCard('กำลังจัดเตรียม',all.filter(x=>x.status==='preparing').length,'เข้าเล่มและตรวจรายการ','amber'),
        metricCard('รอรับ / ส่งมอบ',all.filter(x=>['ready_for_pickup','shipped'].includes(x.status)).length,'รอส่งมอบให้ลูกค้า','purple')
      ].join('');
      renderEmployeeOrders();window.lucide?.createIcons?.();
    } catch(error){if(box)box.innerHTML=`<p class="text-sm text-rose-400 text-center py-8">โหลดคิวงานไม่สำเร็จ: ${esc(error.message||error)}</p>`;notice('โหลดงานพนักงานไม่สำเร็จ',error.message||'ตรวจสอบ RLS ของ orders, print_jobs, documents และ deliveries','database');}
  }
  window.loadEmployeeOrders=loadEmployeeOrders;

  function nextActions(o) {
    const st=String(o.status||'queued');
    if(['finished','cancelled'].includes(st)) return '<span class="text-xs sub-text">ปิดงานแล้ว</span>';
    if(st==='queued'||st==='printing') return `<button data-emp-status="completed" data-order-id="${esc(o.id)}" class="pd-emp-action primary">ยืนยันพิมพ์เสร็จ</button><p class="text-[10px] sub-text mt-1">ต้องตรวจเอกสารที่พิมพ์ออกจริงก่อนกด</p>`;
    if(st==='completed') return `<button data-emp-status="preparing" data-order-id="${esc(o.id)}" class="pd-emp-action primary">เริ่มจัดเตรียม / เข้าเล่ม</button>`;
    if(st==='preparing') {
      if(Number(o.binding_cost||0)>0 && !o.binding_completed) return `<button data-emp-binding="complete" data-order-id="${esc(o.id)}" class="pd-emp-action secondary">ยืนยันเข้าเล่มเสร็จ</button><p class="text-[10px] sub-text mt-1">ต้องตรวจการเข้าเล่มก่อนพร้อมรับ/จัดส่ง</p>`;
      return `<button data-emp-status="ready_for_pickup" data-order-id="${esc(o.id)}" class="pd-emp-action primary">ยืนยันเตรียมเสร็จ</button>`;
    }
    if(st==='ready_for_pickup' && o.delivery_method==='delivery') return `<button data-emp-track="${esc(o.id)}" class="pd-emp-action secondary">บันทึก Tracking</button><button data-emp-status="shipped" data-order-id="${esc(o.id)}" class="pd-emp-action primary">ยืนยันส่งออก</button>`;
    if(st==='ready_for_pickup') return `<button data-emp-status="finished" data-order-id="${esc(o.id)}" class="pd-emp-action primary">ยืนยันส่งมอบหน้าร้าน</button>`;
    if(st==='shipped') return `<button data-emp-status="finished" data-order-id="${esc(o.id)}" class="pd-emp-action primary">ยืนยันส่งมอบสำเร็จ</button>`;
    if(st==='failed') return `<button data-emp-status="queued" data-order-id="${esc(o.id)}" class="pd-emp-action secondary">ส่งกลับเข้าคิว</button>`;
    return '<span class="text-xs sub-text">ไม่มีการดำเนินการถัดไป</span>';
  }
  async function loadEmployeeTopupHistory() {
    const body = $('pd-employee-topup-history');
    if (!body || !isStaff()) return;
    body.innerHTML = '<tr><td colspan="4" class="pd-history-empty">กำลังโหลดประวัติเติม Coins…</td></tr>';
    const client = db();
    if (!client) {
      body.innerHTML = '<tr><td colspan="4" class="pd-history-error">ยังเชื่อมต่อฐานข้อมูลไม่ได้</td></tr>';
      return notice('โหลดประวัติเติม Coins ไม่สำเร็จ', 'ยังเชื่อมต่อ Supabase ไม่ได้ กรุณาลองใหม่', 'database-zap');
    }
    try {
      const { data, error } = await client.rpc('pd_employee_topup_history_v1');
      if (error) throw error;
      const rows = Array.isArray(data) ? data : [];
      if (!rows.length) {
        body.innerHTML = '<tr><td colspan="4" class="pd-history-empty">ยังไม่มีประวัติเติม Coins</td></tr>';
      } else {
        body.innerHTML = rows.map(row => {
          const status = String(row.status || 'pending').toLowerCase();
          const statusLabel = status === 'approved' ? 'อนุมัติแล้ว' : status === 'rejected' ? 'ปฏิเสธ' : 'รอตรวจสอบ';
          const statusClass = status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : 'pending';
          return `<tr><td data-label="วันที่">${esc(new Date(row.created_at).toLocaleString('th-TH'))}</td><td data-label="สมาชิก">${esc(row.customer_name || 'สมาชิก')}</td><td data-label="ยอดเติม">${money(row.amount)} Coins</td><td data-label="สถานะ"><span class="pd-topup-status ${statusClass}">${statusLabel}</span></td></tr>`;
        }).join('');
      }
      const count = $('pd-employee-topup-count');
      if (count) count.textContent = String(rows.length);
      const updated = $('pd-employee-topup-updated');
      if (updated) updated.textContent = `แสดงประวัติล่าสุดไม่เกิน 250 รายการ · อัปเดต ${new Date().toLocaleTimeString('th-TH')}`;
    } catch (error) {
      console.error('[PrintDekD] employee top-up history failed:', error);
      body.innerHTML = '<tr><td colspan="4" class="pd-history-error">โหลดประวัติไม่ได้ กรุณาตรวจสอบ Migration ล่าสุดและสิทธิ์ของบัญชี Employee</td></tr>';
      notice('โหลดประวัติเติม Coins ไม่สำเร็จ', /function .* does not exist|could not find the function/i.test(error?.message || '') ? 'ยังไม่ได้ติดตั้ง Migration 20261015_admin_employee_role_and_feedback.sql หรือยังไม่รีเฟรช Schema Cache' : 'ระบบไม่สามารถอ่านประวัติเติม Coins ได้ กรุณาตรวจสอบสิทธิ์ฐานข้อมูลแล้วลองใหม่', 'shield-alert');
    }
  }
  window.loadEmployeeTopupHistory = loadEmployeeTopupHistory;

  function renderEmployeeOrders() {
    const box=$('pd-employee-orders');if(!box)return;
    const term=currentText('pd-employee-search').toLowerCase();
    const rows=employeeOrdersCache.filter(o=>!term||[o.id,o.queue_number,o.file_name,o.customer_name,o.tracking_number,o.recipient_name,o.phone_number].some(v=>String(v||'').toLowerCase().includes(term)));
    if(!rows.length){box.innerHTML='<p class="text-sm sub-text text-center py-10">ไม่พบงานที่ตรงกับการค้นหา</p>';return;}
    box.innerHTML=rows.map(o=>{
      const shipping=o.delivery_method==='delivery';
      const picked=o.page_range?`ช่วงหน้าที่เลือก: ${o.page_range}`:`ทั้งหมด ${o.page_count} หน้า`;
      const binding=Number(o.binding_cost||0)>0?`เข้าเล่ม · ${money(o.binding_cost)} บาท (รวมตามคำสั่งซื้อ)`:'ไม่ได้ระบุค่าบริการเข้าเล่มในยอดสั่งซื้อ';
      const payLabel=/coins|wallet/i.test(String(o.payment_method||''))?'Coins / กระเป๋าเงิน':(o.payment_method||'ไม่ระบุช่องทาง');
      return `<article class="pd-employee-order" data-employee-order="${esc(o.id)}">
        <div class="pd-employee-order-head"><div><div class="pd-employee-card-context"><span class="pd-employee-queue">คิว #${esc(o.queue_number??o.id)}</span><span class="pd-employee-work-badge"><i data-lucide="user-round-check" aria-hidden="true"></i> งานที่พนักงานดูแล</span><span class="pd-employee-method-badge ${shipping?'delivery':'pickup'}"><i data-lucide="${shipping?'truck':'store'}" aria-hidden="true"></i>${shipping?'จัดส่ง':'รับที่ร้าน'}</span></div><h3 class="font-bold titanium-text mt-2">${esc(o.file_name)}</h3><p class="text-[11px] sub-text mt-1">ลูกค้า: ${esc(o.customer_name||'สมาชิก')} · ${esc(new Date(o.created_at).toLocaleString('th-TH'))}</p><p class="pd-employee-payment-line"><span>ชำระผ่าน ${esc(payLabel)}</span><strong>${money(o.total_amount)} ฿</strong></p></div><span class="pd-employee-status pd-status-${esc(o.status)}">${esc(humanStatus(o.status))}</span></div>
        <div class="pd-employee-specs"><span><b>ช่วงหน้า</b>${esc(picked)}</span><span><b>งานพิมพ์</b>${esc(o.paper_size)} · ${o.color?'สี':'ขาว-ดำ'} · ${o.duplex?'หน้า-หลัง':'หน้าเดียว'}</span><span><b>จำนวน</b>${esc(o.copies)} ชุด</span><span><b>เข้าเล่ม</b>${esc(binding)}</span><span><b>วิธีรับ</b>${shipping?'จัดส่ง':'รับที่ร้าน'}</span><span><b>ค่าจัดส่ง</b>${shipping?money(o.delivery_fee)+' ฿':'0.00 ฿'}</span></div>
        ${shipping?`<div class="pd-employee-delivery"><strong>ข้อมูลจัดส่ง</strong><p>${esc(o.recipient_name)} · ${esc(o.phone_number)}</p><p>${esc(o.delivery_address)}</p><p>ผู้ให้บริการ: ${esc(o.delivery_provider||'ยังไม่บันทึก')} · Tracking: ${esc(o.tracking_number||'ยังไม่บันทึก')}</p><p>ค่าจัดส่งที่ลูกค้าชำระ: ${money(o.delivery_fee)} ฿ · ต้นทุนจัดส่งจริง: ${o.actual_delivery_cost===null?'ยังไม่บันทึก':money(o.actual_delivery_cost)+' ฿'}</p><button type="button" data-emp-edit-delivery="${esc(o.id)}" class="pd-emp-action secondary mt-2">บันทึก/แก้ไขข้อมูลจัดส่ง</button></div>`:'<p class="pd-employee-delivery"><strong>รับที่หน้าร้าน</strong> · กรุณาตรวจคิวและจำนวนชุดก่อนส่งมอบ</p>'}
        ${o.last_error?`<p class="text-xs text-rose-400 mt-2">หมายเหตุงานพิมพ์: ${esc(o.last_error)}</p>`:''}
        <div class="pd-employee-actions"><button type="button" data-emp-open-file="${esc(o.file_path)}" class="pd-emp-action secondary" ${o.file_path?'':'disabled'}>เปิดไฟล์ PDF</button><details class="pd-employee-details"><summary>ดูรายละเอียดเพิ่มเติม</summary><div class="pt-3 text-xs sub-text space-y-1"><p>Order ID: ${esc(o.id)}</p><p>Print Job: ${esc(o.job?.id||'ไม่พบ Job')}</p><p>สถานะ Print Job: ${esc(humanStatus(o.print_status))}</p><p>วิธีรับสินค้า: ${shipping?'จัดส่งทาง '+(o.delivery_provider||'ยังไม่ระบุ'):'รับที่ร้าน'}</p><p>ค่าบริการเข้าเล่มรวมในคำสั่งซื้อ: ${money(o.binding_cost)} ฿</p><p>ยืนยันการเข้าเล่มแล้ว: ${o.binding_completed?'ใช่':'ยังไม่ได้ยืนยัน'}</p><p>ต้นทุนจัดส่งจริง: ${o.actual_delivery_cost===null?'ยังไม่บันทึก':money(o.actual_delivery_cost)+' ฿'}</p><p>หมายเหตุ: ${esc(o.admin_note||'—')}</p></div></details><div class="flex flex-wrap gap-2">${nextActions(o)}</div></div>
      </article>`;
    }).join('');
  }

  function employeeChangeStatus(button) {
    if(!isStaff())return notice('จำกัดสิทธิ์','ไม่มีสิทธิ์จัดการงานพิมพ์','shield-alert');
    const id=button.dataset.orderId,status=button.dataset.empStatus;
    const labels={completed:'พิมพ์เสร็จแล้ว',preparing:'กำลังจัดเตรียม',ready_for_pickup:'พร้อมรับ/พร้อมจัดส่ง',shipped:'จัดส่งแล้ว',finished:'ส่งมอบเรียบร้อย',queued:'รอจัดการ'};
    const messages={completed:'ยืนยันเมื่อพิมพ์เอกสารจริงเสร็จและตรวจจำนวนหน้า/ชุดแล้วเท่านั้น',preparing:'เริ่มจัดเตรียมเอกสารและเข้าเล่มตามคำสั่งซื้อ',ready_for_pickup:'ยืนยันว่าเตรียมเอกสารและเข้าเล่มครบแล้ว',shipped:'ตรวจผู้ให้บริการและ Tracking ให้ครบก่อนยืนยันส่งออก',finished:'ยืนยันเมื่อส่งมอบให้ลูกค้าหรือมีหลักฐานว่าจัดส่งถึงแล้ว',queued:'ส่งรายการกลับเข้าคิวตามข้อกำหนดของระบบ'};
    const perform = async () => {
      button.disabled=true;
      try {const success=await window.updateOrderStatus?.(id,status);if(success===true)await loadEmployeeOrders();}
      finally {if(button.isConnected)button.disabled=false;}
    };
    if(typeof window.pdShowAppConfirm === 'function') return window.pdShowAppConfirm({title:`ยืนยัน${labels[status]||'เปลี่ยนสถานะ'}`,message:messages[status]||'',icon:'clipboard-check',confirmText:'ยืนยัน',onConfirm:perform});
    if(typeof window.showCustomModal === 'function') return window.showCustomModal({title:`ยืนยัน${labels[status]||'เปลี่ยนสถานะ'}`,message:messages[status]||'',icon:'clipboard-check',showCancel:true,onConfirm:perform});
    return perform();
  }

  async function setBindingComplete(button) {
    if (!isStaff()) return notice('จำกัดสิทธิ์','เฉพาะพนักงานหรือ Admin เท่านั้น','shield-alert');
    const orderId=button.dataset.orderId;
    const perform=async()=>{
      button.disabled=true;
      try {
        const client=db();
        const {data,error}=await client.rpc('pd_employee_set_binding_v1',{p_order_id:orderId,p_completed:true,p_note:'พนักงานตรวจสอบการเข้าเล่มแล้ว'});
        if(error)throw error;
        notice('บันทึกการเข้าเล่มแล้ว',`คิว #${data?.queue_number||orderId} สามารถไปขั้นตอนตรวจความเรียบร้อยต่อได้`,'check-circle-2');
        await loadEmployeeOrders();
      } catch(e) { notice('บันทึกการเข้าเล่มไม่สำเร็จ',e.message||'ตรวจสอบการติดตั้ง migration และสิทธิ์ของพนักงาน','shield-alert'); }
      finally { if(button.isConnected)button.disabled=false; }
    };
    if(typeof window.showCustomModal==='function') window.showCustomModal({title:'ยืนยันเข้าเล่มเสร็จ',message:'ตรวจสอบว่างานเข้าเล่มตรงตามรายละเอียดในคำสั่งซื้อแล้วก่อนยืนยัน',icon:'book-open-check',showCancel:true,onConfirm:perform});
    else await perform();
  }

  function editDeliveryDetails(orderId) {
    if(!isStaff())return notice('จำกัดสิทธิ์','เฉพาะพนักงานหรือ Admin เท่านั้น','shield-alert');
    const order=employeeOrdersCache.find(o=>String(o.id)===String(orderId));
    if(!order || order.delivery_method!=='delivery')return notice('ไม่พบข้อมูลจัดส่ง','รายการนี้ไม่มีข้อมูลจัดส่ง','alert-triangle');
    let root=$('pd-employee-delivery-modal');
    if(!root){
      root=document.createElement('div');root.id='pd-employee-delivery-modal';root.className='pd-result-modal';root.hidden=true;
      root.innerHTML=`<section class="pd-result-card pd-tracking-card" role="dialog" aria-modal="true" aria-labelledby="pd-emp-delivery-title"><button type="button" class="pd-result-dismiss" data-emp-delivery-cancel aria-label="ปิด">×</button><div class="pd-result-mark"><i data-lucide="truck"></i></div><div class="pd-result-kicker">PRINTDEKD PRO · EMPLOYEE</div><h2 id="pd-emp-delivery-title">บันทึกข้อมูลจัดส่ง</h2><p>แก้ผู้ให้บริการ ที่อยู่จัดส่ง และ Tracking ได้ ส่วนต้นทุนจัดส่งจริงจะแยกจากค่าจัดส่งที่ลูกค้าชำระ ไม่เปลี่ยนยอดคำสั่งซื้อที่ชำระแล้ว</p><label class="pd-tracking-label" for="pd-emp-delivery-provider">ผู้ให้บริการจัดส่ง</label><input id="pd-emp-delivery-provider" class="pd-tracking-input" maxlength="80" required placeholder="เช่น ไปรษณีย์ไทย / Messenger"><label class="pd-tracking-label" for="pd-emp-delivery-name">ชื่อผู้รับ</label><input id="pd-emp-delivery-name" class="pd-tracking-input" maxlength="100" required><label class="pd-tracking-label" for="pd-emp-delivery-phone">เบอร์โทรศัพท์</label><input id="pd-emp-delivery-phone" class="pd-tracking-input" maxlength="20" required><label class="pd-tracking-label" for="pd-emp-delivery-address">ที่อยู่จัดส่ง</label><textarea id="pd-emp-delivery-address" class="pd-tracking-input" rows="3" maxlength="1000" required></textarea><label class="pd-tracking-label" for="pd-emp-delivery-actual-cost">ต้นทุนจัดส่งจริง (บาท)</label><input id="pd-emp-delivery-actual-cost" class="pd-tracking-input" type="number" min="0" max="100000" step="0.01" required placeholder="ค่าขนส่งที่ร้านจ่ายจริง"><label class="pd-tracking-label" for="pd-emp-delivery-tracking">หมายเลขติดตามพัสดุ (ถ้ามี)</label><input id="pd-emp-delivery-tracking" class="pd-tracking-input" maxlength="100" placeholder="เลข Tracking"><p class="pd-tracking-hint" id="pd-emp-delivery-fee-note"></p><div class="pd-tracking-actions"><button type="button" class="pd-tracking-cancel" data-emp-delivery-cancel>ยกเลิก</button><button type="button" class="pd-result-primary" data-emp-delivery-save>บันทึกข้อมูล</button></div></section>`;
      document.body.appendChild(root);
      root.addEventListener('click',e=>{if(e.target===root||e.target.closest('[data-emp-delivery-cancel]')){root.hidden=true;}});
      root.querySelector('[data-emp-delivery-save]').addEventListener('click',async()=>{
        const provider=root.querySelector('#pd-emp-delivery-provider').value.trim(),recipient=root.querySelector('#pd-emp-delivery-name').value.trim(),phone=root.querySelector('#pd-emp-delivery-phone').value.trim(),address=root.querySelector('#pd-emp-delivery-address').value.trim(),costRaw=root.querySelector('#pd-emp-delivery-actual-cost').value.trim(),tracking=root.querySelector('#pd-emp-delivery-tracking').value.trim();
        const cost=Number(costRaw);
        if(!provider||!recipient||!/^0[0-9\-\s]{8,14}$/.test(phone)||!address||costRaw===''||!Number.isFinite(cost)||cost<0||cost>100000){return notice('ข้อมูลจัดส่งไม่ครบ','ตรวจชื่อผู้ให้บริการ ชื่อผู้รับ เบอร์โทร ที่อยู่ และต้นทุนจัดส่งจริงให้ครบก่อนบันทึก','alert-triangle');}
        const save=root.querySelector('[data-emp-delivery-save]');save.disabled=true;
        try{const {data,error}=await db().rpc('pd_update_delivery_details_v1',{p_order_id:root.dataset.orderId,p_provider:provider,p_recipient_name:recipient,p_phone_number:phone,p_delivery_address:address,p_actual_delivery_cost:cost,p_tracking_number:tracking||null});if(error)throw error;root.hidden=true;notice('บันทึกข้อมูลจัดส่งสำเร็จ',`คิว #${data?.queue_number||root.dataset.orderId} · ต้นทุนจริง ${money(cost)} บาท`,'check-circle-2');await loadEmployeeOrders();}
        catch(error){notice('บันทึกข้อมูลจัดส่งไม่สำเร็จ',error.message||'ตรวจสอบ migration และสิทธิ์ของพนักงาน','shield-alert');}
        finally{save.disabled=false;}
      });
    }
    root.dataset.orderId=String(order.id);
    root.querySelector('#pd-emp-delivery-provider').value=order.delivery_provider||'';
    root.querySelector('#pd-emp-delivery-name').value=order.recipient_name||'';
    root.querySelector('#pd-emp-delivery-phone').value=order.phone_number||'';
    root.querySelector('#pd-emp-delivery-address').value=order.delivery_address||'';
    root.querySelector('#pd-emp-delivery-actual-cost').value=order.actual_delivery_cost===null?'':String(order.actual_delivery_cost);
    root.querySelector('#pd-emp-delivery-tracking').value=order.tracking_number||'';
    root.querySelector('#pd-emp-delivery-fee-note').textContent=`ค่าจัดส่งที่ลูกค้าชำระแล้ว ${money(order.delivery_fee)} บาท · การแก้ไขต้นทุนจริงจะไม่แก้ยอดเรียกเก็บลูกค้า`;
    root.hidden=false;window.lucide?.createIcons?.();requestAnimationFrame(()=>root.querySelector('#pd-emp-delivery-provider').focus());
  }

  async function saveNewPrinter(event) {
    event.preventDefault();if(!isAdmin())return notice('จำกัดสิทธิ์','เฉพาะ Admin เท่านั้น','shield-alert');
    const name=currentText('pd-printer-new-name'),ip=currentText('pd-printer-new-ip'),location=currentText('pd-printer-new-location'),status=currentText('pd-printer-new-status')||'offline';
    if(!name)return notice('กรอกชื่อเครื่องพิมพ์','ต้องระบุชื่ออุปกรณ์ก่อนบันทึก','alert-triangle');
    try{const {error}=await db().from('printers').insert({name,ip_address:ip||null,location:location||null,status});if(error)throw error;$('pd-printer-add-form').reset();notice('เพิ่มข้อมูลเครื่องพิมพ์แล้ว','ข้อมูลที่เพิ่มยังไม่ใช่การเชื่อมต่อจริงจนกว่า Print Server จะส่ง heartbeat','check-circle-2');await loadAdminPrinters();}
    catch(e){notice('เพิ่มเครื่องพิมพ์ไม่สำเร็จ',e.message,'shield-alert');}
  }

  function wireEvents() {
    document.addEventListener('click', async event => {
      const target=event.target.closest('button');if(!target)return;
      if(target.hasAttribute('data-pd-save-price')) return savePrice(target);
      if(target.hasAttribute('data-pd-save-binding')) return saveBinding(target);
      if(target.hasAttribute('data-pd-save-delivery')) return saveDelivery(target);
      if(target.hasAttribute('data-pd-save-printer')) return savePrinter(target);
      if(target.hasAttribute('data-pd-role-save')) {const id=target.dataset.userId,sel=document.querySelector(`[data-pd-role-select][data-user-id="${CSS.escape(String(target.dataset.userId||''))}"]`);const next=sel?.value;if(!id||!next)return notice('บันทึกสิทธิ์ไม่ได้','ไม่พบรหัสผู้ใช้หรือไม่ได้เลือกบทบาท กรุณารีเฟรชหน้าแล้วลองใหม่','alert-triangle');if(typeof window.changeUserRole!=='function')return notice('ระบบบันทึกสิทธิ์ยังไม่พร้อม','ไม่พบฟังก์ชันบันทึกสิทธิ์ กรุณาตรวจว่าติดตั้งไฟล์ assets/js/22-secure-rpc-bridge.js และ assets/js/23-employee-admin-scope-runtime.js ครบหรือไม่','shield-alert');return window.changeUserRole(id,next,target);}
      if(target.hasAttribute('data-emp-status')) return employeeChangeStatus(target);
      if(target.hasAttribute('data-emp-binding')) return setBindingComplete(target);
      if(target.hasAttribute('data-emp-edit-delivery')) return editDeliveryDetails(target.dataset.empEditDelivery);
      if(target.hasAttribute('data-emp-track')) { if(!isStaff())return; await window.promptTracking?.(target.dataset.empTrack); await loadEmployeeOrders(); return; }
      if(target.hasAttribute('data-emp-open-file')) {const path=target.dataset.empOpenFile;if(path) return window.openStoredPrintFile?.(path,'documents');}
      if(target.id==='pd-admin-reports-refresh') return loadAdminReports();
      if(target.id==='pd-admin-payments-refresh') return loadAdminPayments();
      if(target.id==='pd-employee-refresh') return loadEmployeeOrders();
    });
    $('pd-pricing-add-form')?.addEventListener('submit',async event=>{
      event.preventDefault();if(!isAdmin())return;
      const paper_size=currentText('pd-pricing-new-size').toUpperCase(),black_white_price=Number(currentText('pd-pricing-new-bw')),color_price=Number(currentText('pd-pricing-new-color')),duplex_price=Number(currentText('pd-pricing-new-duplex'));
      if(!/^[A-Z0-9_-]{1,12}$/.test(paper_size)||![black_white_price,color_price,duplex_price].every(v=>Number.isFinite(v)&&v>=0))return notice('ราคากระดาษไม่ถูกต้อง','ระบุชนิดกระดาษเป็นตัวอักษร/ตัวเลข และราคาทุกช่องต้องไม่ติดลบ','alert-triangle');
      try{const {error}=await db().from('pricing').insert({paper_size,black_white_price,color_price,duplex_price,active:true,updated_at:new Date().toISOString()});if(error)throw error;$('pd-pricing-add-form').reset();$('pd-pricing-new-duplex').value='0';notice('เพิ่มชนิดกระดาษแล้ว',`${paper_size} · ขาวดำ ${money(black_white_price)} · สี ${money(color_price)}`,'check-circle-2');await loadAdminServices();}
      catch(e){notice('เพิ่มชนิดกระดาษไม่สำเร็จ',e.message||'ตรวจสอบว่าชนิดกระดาษนี้มีอยู่แล้วหรือไม่','shield-alert');}
    });
    $('pd-binding-add-form')?.addEventListener('submit', async event=>{
      event.preventDefault();if(!isAdmin())return;
      const name=currentText('pd-binding-new-name'),price=Number(currentText('pd-binding-new-price'));
      if(!name||!Number.isFinite(price)||price<0)return notice('ข้อมูลเข้าเล่มไม่ถูกต้อง','กรอกชื่อและราคาตั้งแต่ 0 บาทขึ้นไป','alert-triangle');
      try{const {error}=await db().from('binding_options').insert({name,price,active:true});if(error)throw error;$('pd-binding-add-form').reset();notice('เพิ่มตัวเลือกเข้าเล่มแล้ว',name,'check-circle-2');await loadAdminServices();}
      catch(e){notice('เพิ่มตัวเลือกเข้าเล่มไม่สำเร็จ',e.message,'shield-alert');}
    });
    $('pd-delivery-add-form')?.addEventListener('submit',async event=>{
      event.preventDefault();if(!isAdmin())return;
      const provider_key=currentText('pd-delivery-new-key').toLowerCase(),name=currentText('pd-delivery-new-name'),fee=Number(currentText('pd-delivery-new-fee'));
      if(!/^[a-z0-9_-]{2,40}$/.test(provider_key)||!name||!Number.isFinite(fee)||fee<0)return notice('ข้อมูลจัดส่งไม่ถูกต้อง','ใช้ key ภาษาอังกฤษตัวเล็ก/ตัวเลข/ขีด และกรอกชื่อกับราคา','alert-triangle');
      try{const {error}=await db().from('delivery_options').insert({provider_key,name,fee,active:false});if(error)throw error;$('pd-delivery-add-form').reset();notice('เพิ่มช่องทางจัดส่งแล้ว','ช่องทางใหม่จะปิดไว้ก่อน ต้องตรวจสอบและเปิดใช้งานภายหลัง','check-circle-2');await loadAdminServices();}
      catch(e){notice('เพิ่มช่องทางจัดส่งไม่สำเร็จ',e.message,'shield-alert');}
    });
    $('pd-printer-add-form')?.addEventListener('submit',saveNewPrinter);
    $('pd-employee-search')?.addEventListener('input',()=>{renderEmployeeOrders();window.lucide?.createIcons?.();});
    $('pd-employee-topups-refresh')?.addEventListener('click',loadEmployeeTopupHistory);
  }

  // Keep Admin/Employee authorization separate: Admin loaders remain Admin-only; the RPCs enforce staff/admin status.
  window.addEventListener('pd:viewchange', event => {
    const name=event.detail?.viewName;
    if(name==='employee') { loadEmployeeOrders(); loadEmployeeTopupHistory(); }
    if(name==='admin' && isAdmin()) { loadServiceOptions(true); }
    if(name==='dashboard' || name==='admin') loadServiceOptions();
  });

  function updateRoleUI() {
    const r=role();
    const employee= isStaff() && r!=='admin';
    $('employee-menu-btn')?.classList.toggle('hidden',!isStaff());
    $('apple-employee-menu-btn')?.classList.toggle('hidden',!isStaff());
    $('admin-menu-btn')?.classList.toggle('hidden',!isAdmin());
    $('apple-admin-menu-btn')?.classList.toggle('hidden',!isAdmin());
    const badge=$('pd-account-role-badge');if(badge)badge.textContent=roleLabel(r).toUpperCase();
    document.body.dataset.pdRole = r || 'guest';
  }

  // Authoritative role-save handler loaded after legacy role handlers. No silent optional call;
  // saving returns an explicit success/failure notification and verifies the committed value.
  window.changeUserRole = async function changeUserRoleWithFeedback(userId, newRole, button = null) {
    if (!isAdmin()) return notice('จำกัดสิทธิ์', 'การเปลี่ยนบทบาททำได้เฉพาะบัญชี Admin เท่านั้น', 'shield-alert');
    const targetRole = String(newRole || '').toLowerCase();
    if (!['member','employee','admin'].includes(targetRole)) return notice('บทบาทไม่ถูกต้อง', 'เลือกได้เฉพาะ Member, Employee หรือ Admin', 'alert-triangle');
    if (!userId) return notice('ไม่พบผู้ใช้', 'ไม่พบรหัสบัญชีที่ต้องการเปลี่ยนสิทธิ์ กรุณารีเฟรชรายชื่อสมาชิก', 'alert-triangle');
    if (String(window.currentUser?.id || '') === String(userId)) return notice('ป้องกันการล็อกบัญชีตัวเอง', 'ไม่อนุญาตให้เปลี่ยนบทบาทของบัญชี Admin ที่กำลังใช้งานอยู่ ให้ใช้บัญชี Admin อีกบัญชีแทน', 'shield-alert');
    const client = db();
    if (!client) return notice('ฐานข้อมูลไม่พร้อม', 'ยังเชื่อมต่อ Supabase ไม่ได้ จึงไม่มีการเปลี่ยนสิทธิ์', 'database-zap');
    if (button?.disabled) return;
    const oldText = button?.textContent || 'บันทึกสิทธิ์';
    if (button) { button.disabled = true; button.dataset.savingRole = 'true'; button.textContent = 'กำลังบันทึก…'; }
    try {
      const { error } = await client.rpc('pd_admin_set_user_role_v2', { p_user_id: String(userId), p_new_role: targetRole });
      if (error) throw error;
      const verify = await client.from('users').select('id,role').eq('id', String(userId)).maybeSingle();
      if (verify.error) throw verify.error;
      if (!verify.data || String(verify.data.role || '').toLowerCase() !== targetRole) throw new Error('บันทึกแล้วแต่ระบบยืนยันบทบาทใหม่ไม่ได้ กรุณารีเฟรชหน้าและตรวจสอบฐานข้อมูล');
      notice('บันทึกสิทธิ์สำเร็จ', `เปลี่ยนบทบาทเป็น ${roleLabel(targetRole)} เรียบร้อยแล้ว`, 'shield-check');
      await window.loadAdminData?.();
    } catch (error) {
      const raw = String(error?.message || error || '');
      let friendly = raw;
      if (/function .*pd_admin_set_user_role_v2.*does not exist|could not find the function|schema cache/i.test(raw)) {
        friendly = 'ฐานข้อมูลยังไม่มี RPC สำหรับบันทึกสิทธิ์ กรุณารัน Migration 20261015_admin_employee_role_and_feedback.sql ใน Supabase แล้วลองใหม่';
      } else if (/ไม่มีสิทธิ์จัดการบทบาท|permission denied|row.level security|not authorized|policy/i.test(raw)) {
        friendly = 'ฐานข้อมูลปฏิเสธการเปลี่ยนสิทธิ์ ตรวจว่าบัญชีที่ล็อกอินเป็น Admin จริง และ Migration/สิทธิ์ RPC ติดตั้งครบแล้ว';
      } else if (/check constraint|users_role_scope_check|role.*check/i.test(raw)) {
        friendly = 'ข้อกำหนด role ในฐานข้อมูลยังเป็นชุดเดิม กรุณารัน Migration 20261015_admin_employee_role_and_feedback.sql เพื่อรองรับ Member, Employee และ Admin';
      } else if (!raw) {
        friendly = 'ไม่ทราบสาเหตุ กรุณารีเฟรชหน้า แล้วตรวจ Supabase Logs';
      }
      notice('บันทึกสิทธิ์ไม่สำเร็จ', friendly, 'shield-alert');
    } finally {
      if (button?.isConnected) { button.disabled = false; delete button.dataset.savingRole; button.textContent = oldText; }
    }
  };

  function init() {
    wrapPriceCalculator();
    wireEvents();
    updateRoleUI();
    if(db()) loadServiceOptions(true);
    const origUpdateUserUI=window.updateUserUI;
    if(typeof origUpdateUserUI==='function' && !origUpdateUserUI.__pdEmployeeWrapped){
      const wrapped=function(...args){const out=origUpdateUserUI.apply(this,args);updateRoleUI();loadServiceOptions(true);return out;};wrapped.__pdEmployeeWrapped=true;window.updateUserUI=wrapped;
    }
    // Refresh view labels when role changes after sign-in, and avoid duplicate queries while typing.
    const originalSwitch=window.switchView;
    if(typeof originalSwitch==='function'&&!originalSwitch.__pdEmployeeWrapped){
      const wrapped=function(view,...args){updateRoleUI();return originalSwitch.call(this,view,...args);};wrapped.__pdEmployeeWrapped=true;window.switchView=wrapped;
    }
    window.lucide?.createIcons?.();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init,{once:true});else init();
})();
