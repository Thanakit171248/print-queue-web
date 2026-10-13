
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      // Prefer same-origin Vercel rewrites to remove browser CORS dependence.
      // The remote API host below is the host documented by Open Admin Data.
      // If the API is unavailable, use its CC BY 4.0 dataset files as a read-only fallback.
      const API = '/api/address/';
      const STATIC_API = '/api/address-static/';
      const OFFICIAL_API = 'https://api.openadmindata.org/api/v1/th/';
      const RAW_DATA_API = 'https://raw.githubusercontent.com/open-admin-data/thailand-administrative-divisions/main/data/';
      const state = {
        provinceRows: null, districtRows: null, subdistrictRows: null, dataPromise: null,
        sourceByLevel: {}, selectedProvince: null, selectedDistrict: null, selectedSubdistrict: null,
        postalSubdistricts: [], postalDistricts: [], postalProvinces: [],
        filteredDistricts: [], filteredSubdistricts: [], postalOptions: [],
        activePostal: '', pendingPostal: '', postalGeneration: 0, submitBusy: false
      };
      const normalize = value => String(value ?? '').trim().normalize('NFC').replace(/\s+/g, ' ');
      const sameName = (a, b) => normalize(a).toLocaleLowerCase('th-TH') === normalize(b).toLocaleLowerCase('th-TH');
      const toId = value => String(value ?? '');
      const ui = {
        province: $('recipient-province'), district: $('recipient-district'), subdistrict: $('recipient-subdistrict'), postal: $('recipient-postal-code'),
        provinceList: $('recipient-province-options'), districtList: $('recipient-district-options'), subdistrictList: $('recipient-subdistrict-options'), postalList: $('recipient-postal-options'),
        message: $('pd19-address-message'), summary: $('pd19-address-summary'), hidden: $('recipient-address'), card: $('pd19-address-card')
      };
      function addressMessage(message, kind = 'info') {
        if (!ui.message) return;
        ui.message.dataset.state = kind;
        ui.message.replaceChildren();
        const icon = document.createElement('i');
        icon.setAttribute('data-lucide', kind === 'error' ? 'alert-triangle' : kind === 'loading' ? 'loader-circle' : kind === 'success' ? 'check-circle-2' : 'info');
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span'); text.textContent = message;
        ui.message.append(icon, text);
        if (window.lucide) { try { window.lucide.createIcons({ root: ui.message }); } catch (_) { } }
      }
      function clearDatalist(list) { if (list) list.replaceChildren(); }
      function populateDatalist(list, rows, options = {}) {
        if (!list) return;
        const frag = document.createDocumentFragment();
        for (const row of rows || []) {
          const name = options.postal ? String(row) : normalize(row.name_local || row.name || row.name_th);
          if (!name) continue;
          const option = document.createElement('option'); option.value = name;
          if (!options.postal && row.name_en) option.label = String(row.name_en);
          frag.appendChild(option);
        }
        list.replaceChildren(frag);
      }
      function unwrapRecords(payload, level) {
        const candidates = [payload?.data?.[level], payload?.data?.[level + 's'], payload?.[level], payload?.data, payload?.records, payload?.items, payload?.results, payload];
        let rows = candidates.find(Array.isArray);
        if (!rows && payload?.data && typeof payload.data === 'object') rows = Object.values(payload.data).find(Array.isArray);
        if (!Array.isArray(rows)) throw new Error(`รูปแบบข้อมูล${level}ไม่ถูกต้อง`);
        return rows.map(row => {
          let parentId = row.parent_id || row.parent?.id || null;
          if (!parentId) {
            if (level === 'district') parentId = row.province_id ?? row.provinceCode ?? row.province_code ?? '';
            else if (level === 'subdistrict') parentId = row.district_id ?? row.districtCode ?? row.district_code ?? '';
            else parentId = '';
          }
          const rawZip = row.postal_code ?? row.postalCode ?? row.zip_code ?? row.zipCode ?? null;
          const zips = [...(Array.isArray(row.zip_codes) ? row.zip_codes : []), ...(rawZip == null ? [] : [rawZip])];
          return {
            id: toId(row.id ?? row.code ?? row[`${level}_code`] ?? row[`${level}Code`]),
            name_local: normalize(row.name_local ?? row.name?.local ?? row.name_th ?? row[`${level}_name_th`] ?? row[`${level}NameTh`] ?? row.th),
            name_en: normalize(row.name_en ?? row.name?.en ?? row[`${level}_name_en`] ?? row[`${level}NameEn`] ?? row.en),
            parent_id: toId(parentId),
            parent_name_local: normalize(row.parent_name_local ?? row.parent?.name_local ?? row.parent?.name?.local ?? row.parent_name_th ?? ''),
            postal_code: rawZip == null ? null : String(rawZip),
            zip_codes: [...new Set(zips.map(v => String(v).replace(/\D/g, '')).filter(v => /^\d{5}$/.test(v)))],
            slug: row.slug || ''
          };
        }).filter(row => row.id && row.name_local);
      }
      async function fetchLevel(level, minimum) {
        const cacheKey = level + 'Rows';
        if (state[cacheKey]) return state[cacheKey];
        const candidates = [
          { url: `${API}${level}.json`, source: 'Vercel same-origin API proxy' },
          { url: `${STATIC_API}all-${level}.json`, source: 'Vercel same-origin CC BY 4.0 dataset fallback' },
          { url: `${OFFICIAL_API}${level}.json`, source: 'Open Admin Data official API fallback' },
          { url: `${RAW_DATA_API}all-${level}.json`, source: 'Open Admin Data GitHub CC BY 4.0 dataset fallback' }
        ];
        const failures = [];
        for (const candidate of candidates) {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), 9000);
          try {
            const response = await fetch(candidate.url, {
              method: 'GET', mode: 'cors', credentials: 'omit', cache: 'force-cache', signal: controller.signal,
              headers: { 'Accept': 'application/json' }
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const payload = await response.json();
            const rows = unwrapRecords(payload, level);
            if (rows.length < minimum) throw new Error(`ข้อมูลมี ${rows.length} รายการ ต่ำกว่าเกณฑ์ ${minimum}`);
            if (new Set(rows.map(x => x.id)).size !== rows.length) throw new Error('พบรหัสรายการซ้ำ');
            state[cacheKey] = rows;
            state.sourceByLevel[level] = candidate.source;
            return rows;
          } catch (err) {
            const reason = err?.name === 'AbortError' ? 'หมดเวลา' : (err?.message || String(err));
            failures.push(`${candidate.source}: ${reason}`);
          } finally {
            clearTimeout(timer);
          }
        }
        throw new Error(`โหลดข้อมูล${level}ไม่ได้จากทุกแหล่งที่ตั้งไว้ — ${failures.join(' | ')}`);
      }
      async function ensureAddressData() {
        if (state.provinceRows && state.districtRows && state.subdistrictRows) return;
        if (state.dataPromise) return state.dataPromise;
        state.dataPromise = (async () => {
          const [provinces, districts, subdistricts] = await Promise.all([
            fetchLevel('province', 77), fetchLevel('district', 928), fetchLevel('subdistrict', 7364)
          ]);
          const provinceIds = new Set(provinces.map(x => x.id));
          const districtIds = new Set(districts.map(x => x.id));
          const linkedDistricts = districts.filter(x => provinceIds.has(x.parent_id)).length;
          const linkedSubdistricts = subdistricts.filter(x => districtIds.has(x.parent_id)).length;
          if (linkedDistricts < 850 || linkedSubdistricts < 6500) throw new Error('โครงสร้างจังหวัด/อำเภอ/ตำบลจากแหล่งข้อมูลไม่สัมพันธ์กัน ระบบจึงไม่เปิดให้เลือกที่อยู่ กรุณาลองใหม่ภายหลัง');
          state.provinceRows = provinces; state.districtRows = districts; state.subdistrictRows = subdistricts;
        })();
        try { await state.dataPromise; }
        finally { state.dataPromise = null; }
      }
      function getPostalOptions(record) {
        const raw = Array.isArray(record?.zip_codes) ? record.zip_codes : (record?.postal_code != null ? [record.postal_code] : []);
        return [...new Set(raw.map(v => String(v).replace(/\D/g, '')).filter(v => /^\d{5}$/.test(v)))];
      }
      function postalMatches(record, zip) { return getPostalOptions(record).includes(zip); }
      function exactRow(rows, value) { return (rows || []).find(row => sameName(row.name_local, value)); }
      function setEnabled(input, enabled, placeholder) {
        if (!input) return;
        // Keep a read-only display field; pd-v22 provides a branded searchable menu instead of Chrome datalist UI.
        input.readOnly = true;
        input.setAttribute('aria-readonly', 'true');
        input.setAttribute('aria-disabled', String(!enabled));
        input.placeholder = placeholder;
        const label = input.closest('.pd19-address-field');
        label?.classList.toggle('is-disabled', !enabled);
        if (!enabled) input.setAttribute('aria-expanded', 'false');
        else input.removeAttribute('aria-invalid');
      }
      function clearInput(input, list, placeholder, disabled = true) {
        if (input) {
          input.value = ''; input.removeAttribute('aria-invalid'); input.setAttribute('aria-expanded', 'false');
          setEnabled(input, !disabled, placeholder);
        }
        clearDatalist(list);
      }
      function clearFromProvince() {
        state.selectedDistrict = null; state.selectedSubdistrict = null; state.filteredDistricts = []; state.filteredSubdistricts = [];
        clearInput(ui.district, ui.districtList, 'เลือกจังหวัดก่อน', true);
        clearInput(ui.subdistrict, ui.subdistrictList, 'เลือกอำเภอ/เขตก่อน', true);
        updateAddressSummary();
      }
      function clearFromDistrict() {
        state.selectedSubdistrict = null; state.filteredSubdistricts = [];
        clearInput(ui.subdistrict, ui.subdistrictList, 'เลือกอำเภอ/เขตก่อน', true);
        updateAddressSummary();
      }
      function resetAreaSelections(keepPostal = true) {
        state.selectedProvince = null; state.selectedDistrict = null; state.selectedSubdistrict = null;
        state.postalSubdistricts = []; state.postalDistricts = []; state.postalProvinces = []; state.filteredDistricts = []; state.filteredSubdistricts = []; state.postalOptions = [];
        state.activePostal = '';
        if (ui.province) clearInput(ui.province, ui.provinceList, 'กรอกรหัสไปรษณีย์ก่อน', true);
        clearInput(ui.district, ui.districtList, 'เลือกจังหวัดก่อน', true);
        clearInput(ui.subdistrict, ui.subdistrictList, 'เลือกอำเภอ/เขตก่อน', true);
        if (!keepPostal && ui.postal) ui.postal.value = '';
        updateAddressSummary();
      }
      function uniqueById(rows) { return [...new Map((rows || []).map(r => [r.id, r])).values()]; }
      function derivePostalMatches(zip) {
        const matchingSubdistricts = state.subdistrictRows.filter(row => postalMatches(row, zip));
        if (!matchingSubdistricts.length) throw new Error(`ไม่พบรหัสไปรษณีย์ ${zip} ในฐานข้อมูลอ้างอิง กรุณาตรวจสอบตัวเลข 5 หลัก หรือค้นหากับไปรษณีย์ไทย`);
        const possibleDistrictIds = new Set(matchingSubdistricts.map(row => row.parent_id).filter(Boolean));
        const districts = state.districtRows.filter(row => possibleDistrictIds.has(row.id));
        if (!districts.length) throw new Error('พบรหัสไปรษณีย์ แต่ข้อมูลเชื่อมโยงกับอำเภอไม่ครบ ระบบหยุดไว้เพื่อป้องกันการเลือกที่อยู่ผิด');
        const possibleProvinceIds = new Set(districts.map(row => row.parent_id).filter(Boolean));
        const provinces = state.provinceRows.filter(row => possibleProvinceIds.has(row.id));
        if (!provinces.length) throw new Error('พบรหัสไปรษณีย์ แต่ข้อมูลเชื่อมโยงกับจังหวัดไม่ครบ กรุณาลองใหม่ภายหลัง');
        const districtIdSet = new Set(districts.map(row => row.id));
        const linkedSubs = matchingSubdistricts.filter(row => districtIdSet.has(row.parent_id));
        if (!linkedSubs.length) throw new Error('ไม่สามารถยืนยันความสัมพันธ์ของรหัสไปรษณีย์กับตำบลได้ จึงยังเลือกต่อไม่ได้');
        return { subdistricts: linkedSubs, districts, provinces };
      }
      let postalLookupPromise = null;
      async function lookupPostal(force = false) {
        const zip = normalize(ui.postal?.value).replace(/\D/g, '').slice(0, 5);
        if (ui.postal && ui.postal.value !== zip) ui.postal.value = zip;
        if (!/^\d{5}$/.test(zip)) {
          state.postalGeneration++;
          state.pendingPostal = ''; resetAreaSelections(true);
          if (ui.postal) { ui.postal.setAttribute('aria-invalid', 'false'); }
          addressMessage('กรอกรหัสไปรษณีย์ 5 หลักก่อน แล้วเลือกจังหวัด → อำเภอ/เขต → ตำบล/แขวง', 'info');
          return false;
        }
        if (!force && state.activePostal === zip && state.postalSubdistricts.length) return true;
        if (!force && state.pendingPostal === zip && postalLookupPromise) return postalLookupPromise;
        const generation = ++state.postalGeneration;
        state.pendingPostal = zip;
        resetAreaSelections(true);
        state.pendingPostal = zip;
        addressMessage(`กำลังค้นหาพื้นที่จากรหัสไปรษณีย์ ${zip}…`, 'loading');
        const operation = (async () => {
          try {
            await ensureAddressData();
            if (generation !== state.postalGeneration || normalize(ui.postal?.value) !== zip) return false;
            const matches = derivePostalMatches(zip);
            state.activePostal = zip;
            state.postalSubdistricts = matches.subdistricts;
            state.postalDistricts = matches.districts;
            state.postalProvinces = matches.provinces;
            state.postalOptions = [zip];
            populateDatalist(ui.provinceList, state.postalProvinces);
            setEnabled(ui.province, true, 'แตะเพื่อเลือกจังหวัดที่ตรงกับรหัสไปรษณีย์');
            if (ui.postal) ui.postal.setAttribute('aria-invalid', 'false');
            addressMessage(`รหัส ${zip} พบ ${matches.provinces.length} จังหวัดที่เป็นไปได้ • กรุณาเลือกจังหวัดที่ถูกต้อง`, 'success');
            return true;
          } catch (err) {
            if (generation !== state.postalGeneration) return false;
            state.pendingPostal = ''; state.activePostal = ''; resetAreaSelections(true);
            if (ui.postal) ui.postal.setAttribute('aria-invalid', 'true');
            addressMessage(`${err.message || 'ค้นหาที่อยู่ไม่สำเร็จ'} • ตรวจสอบรหัสไปรษณีย์หรือเชื่อมต่ออินเทอร์เน็ตแล้วลองใหม่`, 'error');
            return false;
          } finally {
            if (generation === state.postalGeneration) state.pendingPostal = '';
            if (postalLookupPromise === operation) postalLookupPromise = null;
          }
        })();
        postalLookupPromise = operation;
        return operation;
      }
      async function onProvinceInput() {
        const zip = normalize(ui.postal?.value), value = normalize(ui.province?.value);
        if (!/^\d{5}$/.test(zip) || state.activePostal !== zip) {
          resetAreaSelections(true); addressMessage('กรอกรหัสไปรษณีย์ 5 หลักก่อน จึงจะเลือกจังหวัดได้', 'error'); ui.postal?.focus(); return;
        }
        const record = exactRow(state.postalProvinces, value);
        if (!record) {
          state.selectedProvince = null; clearFromProvince();
          if (value) addressMessage('เลือกจังหวัดจากรายการที่สัมพันธ์กับรหัสไปรษณีย์นี้เท่านั้น', 'info');
          else addressMessage(`รหัส ${zip} พร้อมแล้ว • กรุณาเลือกจังหวัดก่อน`, 'info');
          return;
        }
        if (state.selectedProvince?.id === record.id) return;
        state.selectedProvince = record; clearFromProvince();
        const subdistrictDistrictIds = new Set(state.postalSubdistricts.map(row => row.parent_id));
        const allowedDistrictIds = new Set(state.postalDistricts.filter(row => row.parent_id === record.id && subdistrictDistrictIds.has(row.id)).map(row => row.id));
        const candidates = state.postalDistricts.filter(row => allowedDistrictIds.has(row.id));
        if (!candidates.length) { state.selectedProvince = null; clearFromProvince(); addressMessage('ไม่พบอำเภอที่ตรงกับรหัสไปรษณีย์และจังหวัดที่เลือก กรุณาเลือกจังหวัดอีกครั้ง', 'error'); return; }
        state.filteredDistricts = candidates;
        populateDatalist(ui.districtList, candidates); setEnabled(ui.district, true, 'แตะเพื่อเลือกอำเภอ/เขต');
        addressMessage(`เลือกจังหวัด ${record.name_local} แล้ว • พบ ${candidates.length} อำเภอ/เขต กรุณาเลือกต่อ`, 'success');
      }
      async function onDistrictInput() {
        const zip = normalize(ui.postal?.value);
        if (!state.selectedProvince || state.activePostal !== zip) { addressMessage('เลือกจังหวัดหลังกรอกรหัสไปรษณีย์ก่อน แล้วจึงเลือกอำเภอ/เขต', 'error'); (state.activePostal ? ui.province : ui.postal)?.focus(); return; }
        const value = normalize(ui.district?.value), record = exactRow(state.filteredDistricts, value);
        if (!record) {
          state.selectedDistrict = null; clearFromDistrict();
          if (value) addressMessage('เลือกอำเภอ/เขตจากรายการของจังหวัดและรหัสไปรษณีย์ที่เลือกเท่านั้น', 'info');
          else addressMessage('เลือกอำเภอ/เขตก่อน แล้วจึงเลือกตำบล/แขวง', 'info');
          return;
        }
        if (state.selectedDistrict?.id === record.id) return;
        state.selectedDistrict = record; clearFromDistrict();
        const children = state.postalSubdistricts.filter(row => row.parent_id === record.id && postalMatches(row, zip));
        if (!children.length) { state.selectedDistrict = null; clearFromDistrict(); addressMessage('ไม่พบตำบลที่ตรงกับรหัสไปรษณีย์ในอำเภอนี้ กรุณาตรวจสอบจังหวัดหรือรหัสอีกครั้ง', 'error'); return; }
        state.filteredSubdistricts = children;
        populateDatalist(ui.subdistrictList, children); setEnabled(ui.subdistrict, true, 'แตะเพื่อเลือกตำบล/แขวง');
        addressMessage(`เลือกอำเภอ/เขต ${record.name_local} แล้ว • พบ ${children.length} ตำบล/แขวงที่เข้ากับรหัสนี้`, 'success');
      }
      function onSubdistrictInput() {
        const zip = normalize(ui.postal?.value), value = normalize(ui.subdistrict?.value);
        if (!state.selectedProvince || !state.selectedDistrict || state.activePostal !== zip) {
          addressMessage('ต้องเลือกรหัสไปรษณีย์ จังหวัด และอำเภอ/เขตให้ครบตามลำดับก่อน', 'error');
          (!state.activePostal ? ui.postal : !state.selectedProvince ? ui.province : ui.district)?.focus(); return;
        }
        const record = exactRow(state.filteredSubdistricts, value);
        if (!record || !postalMatches(record, zip) || record.parent_id !== state.selectedDistrict.id) {
          state.selectedSubdistrict = null; updateAddressSummary();
          if (value) addressMessage('เลือกตำบล/แขวงที่อยู่ในอำเภอและรหัสไปรษณีย์ที่เลือกจากรายการเท่านั้น', 'info');
          else addressMessage('เลือกตำบล/แขวงเป็นขั้นตอนสุดท้าย', 'info');
          return;
        }
        state.selectedSubdistrict = record; state.postalOptions = [zip];
        if (ui.postal) { ui.postal.value = zip; ui.postal.setAttribute('aria-invalid', 'false'); }
        updateAddressSummary();
        addressMessage(`ตรวจพบที่อยู่ ${record.name_local} • รหัสไปรษณีย์ ${zip} ตรงกับข้อมูลอ้างอิงแล้ว`, 'success');
      }
      function composeAddress() {
        const val = id => normalize($(id)?.value);
        const pieces = [];
        if (val('recipient-house-no')) pieces.push(`บ้านเลขที่ ${val('recipient-house-no')}`);
        if (val('recipient-moo')) pieces.push(/^หมู่/.test(val('recipient-moo')) ? val('recipient-moo') : `หมู่ ${val('recipient-moo')}`);
        if (val('recipient-village')) pieces.push(val('recipient-village'));
        if (val('recipient-soi')) pieces.push(/^ซอย/.test(val('recipient-soi')) ? val('recipient-soi') : `ซอย ${val('recipient-soi')}`);
        if (val('recipient-road')) pieces.push(/^ถนน/.test(val('recipient-road')) ? val('recipient-road') : `ถนน ${val('recipient-road')}`);
        const bangkok = state.selectedProvince?.name_local === 'กรุงเทพมหานคร';
        if (state.selectedSubdistrict) pieces.push(`${bangkok ? 'แขวง' : 'ตำบล'}${state.selectedSubdistrict.name_local}`);
        if (state.selectedDistrict) pieces.push(`${bangkok ? 'เขต' : 'อำเภอ'}${state.selectedDistrict.name_local}`);
        if (state.selectedProvince) pieces.push(bangkok ? 'กรุงเทพมหานคร' : `จังหวัด${state.selectedProvince.name_local}`);
        const zip = normalize(ui.postal?.value); if (zip) pieces.push(zip);
        if (val('recipient-address-extra')) pieces.push(`รายละเอียดเพิ่มเติม: ${val('recipient-address-extra')}`);
        return pieces.join(' ');
      }
      function updateAddressSummary() {
        const address = composeAddress();
        if (ui.hidden) ui.hidden.value = address;
        const zip = normalize(ui.postal?.value);
        const valid = !!(state.activePostal && state.activePostal === zip && state.selectedProvince && state.selectedDistrict && state.selectedSubdistrict && postalMatches(state.selectedSubdistrict, zip) && normalize($('recipient-house-no')?.value));
        if (ui.summary) {
          const span = ui.summary.querySelector('span'); if (span) span.textContent = address || 'ที่อยู่จะปรากฏตรงนี้เมื่อเลือกครบทุกขั้นตอน';
          ui.summary.hidden = !valid;
        }
      }
      async function ensureAddressReady() {
        const zip = normalize(ui.postal?.value).replace(/\D/g, '');
        if (!/^\d{5}$/.test(zip)) { addressMessage('กรอกรหัสไปรษณีย์ 5 หลักก่อนดำเนินการต่อ', 'error'); ui.postal?.focus(); throw new Error('invalid postal code'); }
        if (state.activePostal !== zip || !state.postalSubdistricts.length) {
          const ok = await lookupPostal(true);
          if (!ok || state.activePostal !== zip) throw new Error('postal lookup failed');
        }
      }

      // Public validator used by the last-loaded secure RPC bridge. The legacy
      // submit wrapper below was replaced by the RPC bridge, so expose only the
      // closure-backed address validation (not the whole internal state object).
      window.pdEnsureValidatedDeliveryAddress = async function () {
        if (state.submitBusy) throw new Error('กำลังตรวจสอบที่อยู่/ส่งคำสั่งซื้ออยู่ กรุณารอสักครู่');
        state.submitBusy = true;
        try {
          await ensureAddressReady();
          const name = normalize($('recipient-name')?.value);
          const phone = normalize($('recipient-phone')?.value).replace(/\D/g, '');
          const house = normalize($('recipient-house-no')?.value);
          const zip = normalize(ui.postal?.value);
          if (!name) { addressMessage('กรุณากรอกชื่อ-นามสกุลผู้รับ', 'error'); $('recipient-name')?.focus(); throw new Error('กรุณากรอกชื่อ-นามสกุลผู้รับ'); }
          if (!/^0\d{8,9}$/.test(phone)) { addressMessage('กรุณากรอกเบอร์โทรศัพท์ไทย 9–10 หลัก และขึ้นต้นด้วย 0', 'error'); $('recipient-phone')?.focus(); throw new Error('เบอร์โทรศัพท์จัดส่งไม่ถูกต้อง'); }
          if (!house) { addressMessage('กรุณากรอกบ้านเลขที่ก่อนยืนยันจัดส่ง', 'error'); $('recipient-house-no')?.setAttribute('aria-invalid', 'true'); $('recipient-house-no')?.focus(); throw new Error('กรุณากรอกบ้านเลขที่'); }
          $('recipient-house-no')?.removeAttribute('aria-invalid');
          if (!/^\d{5}$/.test(zip) || state.activePostal !== zip || !state.postalSubdistricts.length) { addressMessage('กรุณากรอกรหัสไปรษณีย์ที่ตรวจสอบแล้วก่อน', 'error'); ui.postal?.focus(); throw new Error('กรุณาตรวจสอบรหัสไปรษณีย์ก่อน'); }
          if (!state.selectedProvince || !state.postalProvinces.some(x => x.id === state.selectedProvince.id)) { addressMessage('เลือกจังหวัดจากรายการที่สัมพันธ์กับรหัสไปรษณีย์ก่อน', 'error'); ui.province?.focus(); throw new Error('กรุณาเลือกจังหวัดที่ตรงกับรหัสไปรษณีย์'); }
          if (!state.selectedDistrict || !state.filteredDistricts.some(x => x.id === state.selectedDistrict.id) || state.selectedDistrict.parent_id !== state.selectedProvince.id) { addressMessage('เลือกอำเภอ/เขตที่อยู่ภายในจังหวัดที่เลือกก่อน', 'error'); ui.district?.focus(); throw new Error('กรุณาเลือกอำเภอ/เขตที่อยู่ในจังหวัดที่เลือก'); }
          if (!state.selectedSubdistrict || !state.filteredSubdistricts.some(x => x.id === state.selectedSubdistrict.id) || state.selectedSubdistrict.parent_id !== state.selectedDistrict.id || !postalMatches(state.selectedSubdistrict, zip)) { addressMessage('เลือกตำบล/แขวงที่ตรงกับอำเภอและรหัสไปรษณีย์ก่อน', 'error'); ui.subdistrict?.focus(); throw new Error('กรุณาเลือกตำบล/แขวงที่ตรงกับอำเภอและรหัสไปรษณีย์'); }
          const address = composeAddress();
          if (!address) { addressMessage('ที่อยู่จัดส่งยังไม่ครบ', 'error'); $('recipient-house-no')?.focus(); throw new Error('ที่อยู่จัดส่งยังไม่ครบ'); }
          if (ui.hidden) ui.hidden.value = address;
          updateAddressSummary();
          addressMessage('ตรวจสอบที่อยู่ครบแล้ว กำลังส่งรายการไปยังระบบ…', 'success');
          return { recipientName: name, phone, address };
        } finally { state.submitBusy = false; }
      };
      function resetAddressFields() {
        state.postalGeneration++; state.pendingPostal = '';
        resetAreaSelections(false);
        if (ui.postal) { ui.postal.value = ''; ui.postal.setAttribute('aria-invalid', 'false'); }
        for (const id of ['recipient-house-no', 'recipient-moo', 'recipient-village', 'recipient-soi', 'recipient-road', 'recipient-address-extra']) if ($(id)) $(id).value = '';
        if (ui.hidden) ui.hidden.value = ''; if (ui.summary) ui.summary.hidden = true;
        addressMessage('เริ่มจากกรอกรหัสไปรษณีย์ 5 หลักก่อน แล้วเลือกจังหวัด อำเภอ และตำบลตามลำดับ', 'info');
      }

      // Do not fetch geography until a real 5-digit postcode is entered or delivery is selected.
      const oldToggleDelivery = window.toggleDeliveryFields;
      if (typeof oldToggleDelivery === 'function' && !oldToggleDelivery.__pd20) {
        const wrapped = function () {
          const result = oldToggleDelivery.apply(this, arguments);
          const delivery = document.querySelector('input[name="delivery_method"]:checked')?.value === 'delivery';
          if (delivery) {
            addressMessage('ขั้นตอนแรก: กรอกรหัสไปรษณีย์ 5 หลัก จากนั้นเลือกจังหวัด → อำเภอ/เขต → ตำบล/แขวง', 'info');
            if (/^\d{5}$/.test(normalize(ui.postal?.value))) lookupPostal().catch(() => { });
          }
          return result;
        };
        wrapped.__pd20 = true; window.toggleDeliveryFields = wrapped;
      }
      let postalInputTimer = null;
      ui.postal?.addEventListener('input', () => {
        if (postalInputTimer) clearTimeout(postalInputTimer);
        const digits = normalize(ui.postal.value).replace(/\D/g, '').slice(0, 5);
        if (ui.postal.value !== digits) ui.postal.value = digits;
        if (digits.length < 5) {
          lookupPostal().catch(err => addressMessage(err.message || 'ค้นหาพื้นที่ไม่สำเร็จ', 'error'));
          return;
        }
        postalInputTimer = setTimeout(() => {
          lookupPostal().catch(err => addressMessage(err.message || 'ค้นหาพื้นที่ไม่สำเร็จ', 'error'));
        }, 180);
      });
      ui.postal?.addEventListener('change', () => {
        if (postalInputTimer) clearTimeout(postalInputTimer);
        // Do not re-run a failed request twice on the same keystroke/blur cycle.
        const zip = normalize(ui.postal.value).replace(/\D/g, '').slice(0, 5);
        if (zip === state.activePostal && state.postalSubdistricts.length) return;
        if (zip.length === 5 && state.pendingPostal === zip && postalLookupPromise) return;
        lookupPostal().catch(err => addressMessage(err.message || 'ค้นหาพื้นที่ไม่สำเร็จ', 'error'));
      });
      ui.province?.addEventListener('input', () => onProvinceInput().catch(err => addressMessage(err.message || 'ค้นหาจังหวัดไม่สำเร็จ', 'error')));
      ui.province?.addEventListener('change', () => onProvinceInput().catch(err => addressMessage(err.message || 'ค้นหาจังหวัดไม่สำเร็จ', 'error')));
      ui.district?.addEventListener('focus', () => { if (ui.district.getAttribute('aria-disabled') === 'true') addressMessage('เลือกจังหวัดที่ตรงกับรหัสไปรษณีย์ก่อน จึงจะเลือกอำเภอ/เขตได้', 'error'); });
      ui.district?.addEventListener('click', () => { if (ui.district.getAttribute('aria-disabled') === 'true') addressMessage('กรุณากรอกรหัสไปรษณีย์และเลือกจังหวัดก่อน', 'error'); });
      ui.district?.addEventListener('input', () => onDistrictInput().catch(err => addressMessage(err.message || 'ค้นหาอำเภอไม่สำเร็จ', 'error')));
      ui.district?.addEventListener('change', () => onDistrictInput().catch(err => addressMessage(err.message || 'ค้นหาอำเภอไม่สำเร็จ', 'error')));
      ui.subdistrict?.addEventListener('focus', () => { if (ui.subdistrict.getAttribute('aria-disabled') === 'true') addressMessage('เลือกอำเภอ/เขตให้ครบก่อน จึงจะเลือกตำบล/แขวงได้', 'error'); });
      ui.subdistrict?.addEventListener('click', () => { if (ui.subdistrict.getAttribute('aria-disabled') === 'true') addressMessage('กรุณาเลือกรหัสไปรษณีย์ จังหวัด และอำเภอ/เขตก่อน', 'error'); });
      ui.subdistrict?.addEventListener('input', onSubdistrictInput);
      ui.subdistrict?.addEventListener('change', onSubdistrictInput);
      ['recipient-house-no', 'recipient-moo', 'recipient-village', 'recipient-soi', 'recipient-road', 'recipient-address-extra'].forEach(id => $(id)?.addEventListener('input', updateAddressSummary, { passive: true }));

      // Validate postal-first hierarchy before passing the combined address to the existing order flow.
      const originalSubmit = window.handleOrderSubmit;
      if (typeof originalSubmit === 'function' && !originalSubmit.__pd20) {
        const wrappedSubmit = async function (event) {
          if (state.submitBusy) {
            event?.preventDefault();
            addressMessage('กำลังส่งคำสั่งซื้ออยู่ กรุณารอให้รายการแรกเสร็จก่อน', 'loading');
            return;
          }
          state.submitBusy = true;
          try {
            const delivery = document.querySelector('input[name="delivery_method"]:checked')?.value === 'delivery';
            if (!delivery) return await originalSubmit.apply(this, arguments);
            event?.preventDefault();
            try { await ensureAddressReady(); } catch (_) { return; }
            const name = normalize($('recipient-name')?.value), phone = normalize($('recipient-phone')?.value).replace(/\D/g, '');
            const house = normalize($('recipient-house-no')?.value), zip = normalize(ui.postal?.value);
            if (!name) { addressMessage('กรุณากรอกชื่อ-นามสกุลผู้รับ', 'error'); $('recipient-name')?.focus(); return; }
            if (!/^0\d{8,9}$/.test(phone)) { addressMessage('กรุณากรอกเบอร์โทรศัพท์ไทย 9–10 หลัก และขึ้นต้นด้วย 0', 'error'); $('recipient-phone')?.focus(); return; }
            if (!house) { addressMessage('กรุณากรอกบ้านเลขที่ก่อนยืนยันจัดส่ง', 'error'); $('recipient-house-no')?.setAttribute('aria-invalid', 'true'); $('recipient-house-no')?.focus(); return; }
            $('recipient-house-no')?.removeAttribute('aria-invalid');
            if (!/^\d{5}$/.test(zip) || state.activePostal !== zip || !state.postalSubdistricts.length) { addressMessage('กรุณากรอกรหัสไปรษณีย์ที่ตรวจสอบแล้วก่อน', 'error'); ui.postal?.focus(); return; }
            if (!state.selectedProvince || !state.postalProvinces.some(x => x.id === state.selectedProvince.id)) { addressMessage('เลือกจังหวัดจากรายการที่สัมพันธ์กับรหัสไปรษณีย์ก่อน', 'error'); ui.province?.focus(); return; }
            if (!state.selectedDistrict || !state.filteredDistricts.some(x => x.id === state.selectedDistrict.id) || state.selectedDistrict.parent_id !== state.selectedProvince.id) { addressMessage('เลือกอำเภอ/เขตที่อยู่ภายในจังหวัดที่เลือกก่อน', 'error'); ui.district?.focus(); return; }
            if (!state.selectedSubdistrict || !state.filteredSubdistricts.some(x => x.id === state.selectedSubdistrict.id) || state.selectedSubdistrict.parent_id !== state.selectedDistrict.id || !postalMatches(state.selectedSubdistrict, zip)) { addressMessage('เลือกตำบล/แขวงที่ตรงกับอำเภอและรหัสไปรษณีย์ก่อน', 'error'); ui.subdistrict?.focus(); return; }
            const address = composeAddress();
            if (!address) { addressMessage('ที่อยู่จัดส่งยังไม่ครบ', 'error'); $('recipient-house-no')?.focus(); return; }
            if (ui.hidden) ui.hidden.value = address;
            updateAddressSummary(); addressMessage('ตรวจสอบที่อยู่ครบแล้ว กำลังส่งรายการไปยังระบบ…', 'success');
            return await originalSubmit.apply(this, arguments);
          } finally { state.submitBusy = false; }
        };
        wrappedSubmit.__pd20 = true; window.handleOrderSubmit = wrappedSubmit;
      }

      // Remove PII from old localStorage print drafts. The address stays in form memory only.
      try {
        for (const key of ['pd_print_draft_v6', 'pd_last_print_v6']) {
          const raw = localStorage.getItem(key); if (!raw) continue;
          const data = JSON.parse(raw);
          const keys = ['recipient-name', 'recipient-phone', 'recipient-address', 'recipient-house-no', 'recipient-moo', 'recipient-village', 'recipient-soi', 'recipient-road', 'recipient-province', 'recipient-district', 'recipient-subdistrict', 'recipient-postal-code', 'recipient-address-extra'];
          if (data.values) keys.forEach(k => delete data.values[k]);
          keys.forEach(k => delete data[k]);
          localStorage.setItem(key, JSON.stringify(data));
        }
      } catch (_) { }

      // Consistent package state: selected amount is represented semantically, not by overwriting className.
      function syncTopupSelection(amount) {
        const amt = Number(amount);
        const hidden = $('selected-topup-amount'); if (hidden) hidden.value = String(amt);
        if ($('topup-qr-amount')) $('topup-qr-amount').textContent = amt.toFixed(2);
        document.querySelectorAll('#view-wallet .topup-pkg-btn').forEach(btn => {
          const match = btn.innerText.match(/(\d+)\s*บาท/);
          const value = Number(btn.dataset.topupAmount || match?.[1]);
          btn.dataset.topupAmount = String(value);
          const selected = value === amt;
          btn.classList.toggle('is-selected', selected);
          btn.classList.remove('border-2', 'border-amber-500', 'bg-amber-500/20', 'text-amber-400', 'shadow-lg', 'scale-105', 'font-black');
          btn.setAttribute('aria-pressed', String(selected));
          btn.setAttribute('aria-label', `${value} บาท ได้ ${value} Coins${selected ? ' เลือกอยู่' : ''}`);
          let check = btn.querySelector('.pd19-selected-check');
          if (selected && !check) { check = document.createElement('span'); check.className = 'pd19-selected-check'; check.setAttribute('aria-hidden', 'true'); const icon = document.createElement('i'); icon.setAttribute('data-lucide', 'check'); check.appendChild(icon); btn.appendChild(check); }
          if (!selected && check) check.remove();
        });
        if (window.lucide) { try { window.lucide.createIcons() } catch (_) { } }
      }
      window.selectTopupAmount = function (amount) {
        const allowed = [20, 50, 100, 200, 500]; const n = Number(amount);
        if (!allowed.includes(n)) { if (typeof window.showCustomModal === 'function') window.showCustomModal({ title: 'แพ็กเกจไม่ถูกต้อง', message: 'กรุณาเลือกจำนวนเงินจากแพ็กเกจที่กำหนด', icon: 'alert-triangle' }); return; }
        syncTopupSelection(n);
      };
      syncTopupSelection(Number($('selected-topup-amount')?.value || 20));

      // Stop accidental duplicate top-up requests while upload + database insert are in flight.
      const originalTopupSubmit = window.handleTopupSubmit;
      if (typeof originalTopupSubmit === 'function' && !originalTopupSubmit.__pd20BusyGuard) {
        const guardedTopupSubmit = async function (event) {
          if (window.__pd20TopupSubmitBusy) {
            event?.preventDefault();
            if (typeof window.showCustomModal === 'function') window.showCustomModal({ title: 'กำลังส่งคำขอเติม Coins', message: 'กรุณารอให้รายการแรกเสร็จก่อน เพื่อป้องกันคำขอซ้ำ', icon: 'loader-circle' });
            return;
          }
          window.__pd20TopupSubmitBusy = true;
          try { return await originalTopupSubmit.apply(this, arguments); }
          finally { window.__pd20TopupSubmitBusy = false; }
        };
        guardedTopupSubmit.__pd20BusyGuard = true;
        window.handleTopupSubmit = guardedTopupSubmit;
      }

      // Home-page order flow is intentionally the first section; product brand story remains at the end.
      $('pd19-home-order-title')?.setAttribute('aria-label', 'สั่งพิมพ์เอกสารออนไลน์ ทุกขั้นตอนอยู่ในที่เดียว');
      if (window.lucide) { try { window.lucide.createIcons(); } catch (_) { } }

      window.pdV20TestAddressApi = async function () {
        const url = `${API}province.json`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 9000);
        try {
          const response = await fetch(url, { method: 'GET', credentials: 'omit', cache: 'no-store', signal: controller.signal, headers: { 'Accept': 'application/json' } });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const payload = await response.json();
          const rows = unwrapRecords(payload, 'province');
          const result = { ok: rows.length >= 77, mode: 'same-origin (browser CORS not required)', path: url, httpStatus: response.status, provinceCount: rows.length, note: rows.length >= 70 ? 'proxy answered with a valid province dataset' : 'expected at least 77 provinces' };
          console.info('[PrintDekD API/CORS check]', result);
          if (ui.message) addressMessage(result.ok ? `ทดสอบเส้นทางข้อมูลสำเร็จ (${rows.length} จังหวัด) · same-origin` : 'เส้นทาง API ตอบกลับ แต่จำนวนจังหวัดไม่ครบ', result.ok ? 'success' : 'error');
          return result;
        } catch (err) {
          const result = { ok: false, mode: 'same-origin (browser CORS not required)', path: url, error: err?.name === 'AbortError' ? 'หมดเวลารอ proxy' : (err?.message || String(err)) };
          console.error('[PrintDekD API/CORS check]', result);
          if (ui.message) addressMessage('ทดสอบ API proxy ไม่ผ่าน: ตรวจ Vercel rewrites/Deployment ก่อน', 'error');
          return result;
        } finally { clearTimeout(timer); }
      };
      window.pdV20AddressDiagnostics = function () {
        const result = {
          postalFirst: true,
          postalCode: ui.postal?.value || null,
          postalVerified: !!(state.activePostal && state.activePostal === normalize(ui.postal?.value)),
          matchingProvinces: state.postalProvinces.length,
          matchingDistricts: state.filteredDistricts.length,
          matchingSubdistricts: state.filteredSubdistricts.length,
          selectedProvince: state.selectedProvince?.name_local || null,
          selectedDistrict: state.selectedDistrict?.name_local || null,
          selectedSubdistrict: state.selectedSubdistrict?.name_local || null,
          dataCounts: { provinces: state.provinceRows?.length || 0, districts: state.districtRows?.length || 0, subdistricts: state.subdistrictRows?.length || 0 },
          dataSource: state.sourceByLevel,
          attribution: 'Thailand Administrative Divisions Dataset — Open Admin Data, CC BY 4.0 (data release 2026.06); check the real address with the recipient/postal service.'
        };
        console.info('[PrintDekD postcode-first diagnostics]', result); return result;
      };
      if (ui.card && !$('pd-v20-address-attribution')) {
        const attribution = document.createElement('p');
        attribution.id = 'pd-v20-address-attribution';
        attribution.className = 'mt-3 text-[10px] leading-relaxed sub-text';
        attribution.append(document.createTextNode('ข้อมูลเขตการปกครองอ้างอิง '));
        const sourceLink = document.createElement('a');
        sourceLink.href = 'https://github.com/open-admin-data/thailand-administrative-divisions';
        sourceLink.target = '_blank'; sourceLink.rel = 'noopener noreferrer';
        sourceLink.className = 'underline underline-offset-2';
        sourceLink.textContent = 'Open Admin Data Thailand Administrative Divisions';
        attribution.append(sourceLink, document.createTextNode(' (CC BY 4.0) · โปรดตรวจสอบที่อยู่และรหัสไปรษณีย์ก่อนยืนยันจัดส่ง'));
        ui.card.appendChild(attribution);
      }
      window.pdV19AddressDiagnostics = window.pdV20AddressDiagnostics;
      addressMessage('กรอกรหัสไปรษณีย์ 5 หลักก่อน แล้วเลือกจังหวัด → อำเภอ/เขต → ตำบล/แขวง', 'info');
      if (window.lucide) { try { window.lucide.createIcons(); } catch (_) { } }
    })();
  
