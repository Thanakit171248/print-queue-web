
(() => {
  'use strict';
  const addressCard = document.getElementById('pd19-address-card');
  if (!addressCard || addressCard.dataset.pd23LocationReady === 'true') return;
  addressCard.dataset.pd23LocationReady = 'true';

  const configs = [
    { input: 'recipient-province', list: 'recipient-province-options', label: 'จังหวัด', placeholder: 'แตะเพื่อเลือกจังหวัด', help: 'เลือกจังหวัดที่ตรงกับรหัสไปรษณีย์' },
    { input: 'recipient-district', list: 'recipient-district-options', label: 'อำเภอ / เขต', placeholder: 'แตะเพื่อเลือกอำเภอ / เขต', help: 'รายการจะแสดงเฉพาะจังหวัดที่เลือก' },
    { input: 'recipient-subdistrict', list: 'recipient-subdistrict-options', label: 'ตำบล / แขวง', placeholder: 'แตะเพื่อเลือกตำบล / แขวง', help: 'รายการสัมพันธ์กับอำเภอและรหัสไปรษณีย์' }
  ];
  const widgets = [];
  let activeWidget = null;

  function optionData(list) {
    if (!list) return [];
    return Array.from(list.options || []).map(option => ({
      value: String(option.value || '').trim(),
      secondary: String(option.label || '').trim()
    })).filter(item => item.value);
  }

  function setExpanded(widget, expanded) {
    widget.input.setAttribute('aria-expanded', String(expanded));
    widget.menu.hidden = !expanded;
    widget.shell.classList.toggle('is-open', expanded);
    if (expanded) activeWidget = widget;
    else if (activeWidget === widget) activeWidget = null;
  }

  function renderOptions(widget) {
    const items = optionData(widget.list);
    widget.count.textContent = `${items.length} รายการ`;
    widget.results.replaceChildren();

    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'pd20-location-empty';
      empty.textContent = 'ยังไม่มีรายการให้เลือก กรุณาตรวจสอบรหัสไปรษณีย์และขั้นตอนก่อนหน้า';
      widget.results.appendChild(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    items.forEach(item => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'pd20-location-option';
      button.setAttribute('role', 'option');
      button.setAttribute('aria-selected', String(widget.input.value === item.value));
      button.setAttribute('data-location-value', item.value);

      const main = document.createElement('span');
      main.className = 'pd20-location-option-main';
      const thai = document.createElement('span');
      thai.className = 'pd20-location-option-th';
      thai.textContent = item.value;
      main.appendChild(thai);

      if (item.secondary && item.secondary !== item.value) {
        const english = document.createElement('span');
        english.className = 'pd20-location-option-en';
        english.textContent = item.secondary;
        main.appendChild(english);
      }

      const arrow = document.createElement('span');
      arrow.className = 'pd20-location-option-arrow';
      arrow.setAttribute('aria-hidden', 'true');
      arrow.textContent = '›';
      button.append(main, arrow);

      // Selection runs on click (not pointerdown) so touch browsers have a reliable activation event.
      // The outside-tap handler already ignores anything inside this shell, so blur cannot auto-close it.
      button.addEventListener('click', () => selectOption(widget, item.value));
      button.addEventListener('keydown', event => {
        if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
          event.preventDefault();
          const options = Array.from(widget.results.querySelectorAll('.pd20-location-option'));
          const current = options.indexOf(button);
          const step = event.key === 'ArrowDown' ? 1 : -1;
          options[(current + step + options.length) % options.length]?.focus();
        } else if (event.key === 'Escape') {
          event.preventDefault();
          closeMenu(widget, true);
        }
      });
      fragment.appendChild(button);
    });
    widget.results.appendChild(fragment);
  }

  function closeMenu(widget, returnFocus = false) {
    setExpanded(widget, false);
    if (returnFocus) {
      widget.skipFocusOpen = true;
      widget.input.focus({ preventScroll: true });
    }
  }

  function selectOption(widget, value) {
    // Close this menu before firing change; dependent lists are then refreshed by the address runtime.
    const restoreFocus = document.activeElement !== widget.input;
    setExpanded(widget, false);
    widget.input.value = value;
    widget.input.removeAttribute('aria-invalid');
    widget.skipFocusOpen = restoreFocus;
    widget.input.dispatchEvent(new Event('change', { bubbles: true }));
    if (restoreFocus) widget.input.focus({ preventScroll: true });
  }

  function openMenu(widget) {
    if (widget.input.getAttribute('aria-disabled') === 'true') return;
    if (activeWidget && activeWidget !== widget) setExpanded(activeWidget, false);
    renderOptions(widget);
    setExpanded(widget, true);
    // Do not focus a search box or any other input. This is deliberately tap-to-select,
    // so a mobile keyboard cannot resize the viewport and collapse the menu.
  }

  for (const config of configs) {
    const input = document.getElementById(config.input);
    const list = document.getElementById(config.list);
    const field = input?.closest('label.pd19-address-field');
    if (!input || !list || !field || !field.parentElement) continue;

    // Keep the datalist as a data source only; the browser must never draw its native popup.
    input.removeAttribute('list');
    input.readOnly = true;
    input.setAttribute('aria-readonly', 'true');
    input.setAttribute('aria-haspopup', 'listbox');
    input.setAttribute('aria-controls', `${config.input}-custom-options`);
    input.setAttribute('autocomplete', 'off');
    input.setAttribute('placeholder', config.placeholder);

    const shell = document.createElement('div');
    shell.className = 'pd20-select-shell';
    field.parentElement.insertBefore(shell, field);
    shell.appendChild(field);

    const menu = document.createElement('div');
    menu.className = 'pd20-location-menu';
    menu.hidden = true;
    menu.id = `${config.input}-custom-menu`;
    menu.setAttribute('role', 'group');
    menu.setAttribute('aria-label', `${config.label}: รายการตัวเลือก`);

    const head = document.createElement('div');
    head.className = 'pd20-location-menu-head';
    const title = document.createElement('p');
    title.className = 'pd20-location-menu-title';
    title.textContent = `เลือก${config.label}`;
    const count = document.createElement('span');
    count.className = 'pd20-location-menu-count';
    count.textContent = '0 รายการ';
    head.append(title, count);

    const results = document.createElement('div');
    results.className = 'pd20-location-results';
    results.id = `${config.input}-custom-options`;
    results.setAttribute('role', 'listbox');

    const foot = document.createElement('div');
    foot.className = 'pd20-location-foot';
    foot.textContent = config.help;
    menu.append(head, results, foot);
    shell.appendChild(menu);

    const widget = { ...config, input, list, field, shell, menu, count, results, skipFocusOpen: false };
    widgets.push(widget);

    input.addEventListener('focus', () => {
      if (widget.skipFocusOpen) {
        widget.skipFocusOpen = false;
        return;
      }
      if (input.getAttribute('aria-disabled') !== 'true') openMenu(widget);
    });
    input.addEventListener('click', () => {
      if (input.getAttribute('aria-disabled') !== 'true' && widget.menu.hidden) openMenu(widget);
    });
    input.addEventListener('pd-address-options-ready', () => {
      if (input.dataset.pdOpenWhenReady === 'true' && input.getAttribute('aria-disabled') !== 'true') {
        delete input.dataset.pdOpenWhenReady;
        openMenu(widget);
      }
    });
    input.addEventListener('keydown', event => {
      if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
        if (input.getAttribute('aria-disabled') !== 'true') {
          event.preventDefault();
          openMenu(widget);
          widget.results.querySelector('.pd20-location-option')?.focus();
        }
      } else if (event.key === 'Escape' && !widget.menu.hidden) {
        event.preventDefault();
        closeMenu(widget, false);
      }
    });

    const observer = new MutationObserver(() => {
      renderOptions(widget);
      if (input.getAttribute('aria-disabled') === 'true' && !menu.hidden) closeMenu(widget, false);
    });
    observer.observe(list, { childList: true, subtree: true, attributes: true, attributeFilter: ['value', 'label'] });
    renderOptions(widget);
  }

  // Close only when the user taps outside the open picker. Do not close on viewport resize:
  // mobile browsers resize viewports for toolbars/orientation changes and this used to collapse the menu.
  document.addEventListener('pointerdown', event => {
    if (!activeWidget) return;
    if (!activeWidget.shell.contains(event.target)) setExpanded(activeWidget, false);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeWidget) closeMenu(activeWidget, false);
  });
})();
