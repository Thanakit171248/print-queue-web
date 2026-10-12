
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);

      // Respect the user's motion preference early and avoid animated reveal states
      // from old layers that would leave content hidden if the observer missed it.
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      if (reduceMotion || window.matchMedia?.('(max-width: 767px)').matches) {
        document.querySelectorAll('.apple-reveal').forEach(el => {
          el.classList.add('is-visible'); el.classList.remove('is-scrolled-out');
          el.style.opacity = '1'; el.style.filter = 'none';
        });
      }

      // Help Center filtering: no network calls, no HTML injection, and native details remain keyboard accessible.
      const help = $('view-help');
      const helpSearch = $('pd-help-search');
      const helpItems = [...document.querySelectorAll('#view-help [data-help-filter-item]')];
      const categoryButtons = [...document.querySelectorAll('#view-help [data-help-category]')];
      let activeCategory = '';
      function updateHelpFilter() {
        if (!help) return;
        const term = String(helpSearch?.value || '').trim().toLocaleLowerCase('th-TH');
        let shown = 0;
        helpItems.forEach(item => {
          const hay = `${item.textContent || ''} ${item.dataset.helpSearch || ''}`.toLocaleLowerCase('th-TH');
          const groups = String(item.dataset.helpGroup || '').split(/\s+/).filter(Boolean);
          const textMatch = !term || hay.includes(term);
          const categoryMatch = !activeCategory || groups.includes(activeCategory);
          const visible = textMatch && categoryMatch;
          item.classList.toggle('pd-help-filtered-out', !visible);
          if (visible && item.classList.contains('pd-help-article')) shown++;
        });
        const noResults = $('pd-help-no-results');
        noResults?.classList.toggle('hidden', shown > 0);
        const count = $('pd-help-result-count');
        if (count) count.textContent = `${shown} หัวข้อ`;
        categoryButtons.forEach(btn => {
          const selected = btn.dataset.helpCategory === activeCategory;
          btn.setAttribute('aria-pressed', String(selected));
        });
        if (window.lucide) window.lucide.createIcons();
      }
      $('pd-help-search-form')?.addEventListener('submit', e => { e.preventDefault(); activeCategory = ''; updateHelpFilter(); });
      helpSearch?.addEventListener('input', () => { activeCategory = ''; updateHelpFilter(); });
      $('pd-help-clear')?.addEventListener('click', () => { if (helpSearch) helpSearch.value = ''; activeCategory = ''; updateHelpFilter(); helpSearch?.focus(); });
      $('pd-help-no-results-clear')?.addEventListener('click', () => { if (helpSearch) helpSearch.value = ''; activeCategory = ''; updateHelpFilter(); });
      document.querySelectorAll('[data-help-query]').forEach(btn => btn.addEventListener('click', () => {
        if (helpSearch) helpSearch.value = btn.dataset.helpQuery || '';
        activeCategory = ''; updateHelpFilter(); helpSearch?.focus();
      }));
      categoryButtons.forEach(btn => btn.addEventListener('click', () => {
        activeCategory = activeCategory === btn.dataset.helpCategory ? '' : (btn.dataset.helpCategory || '');
        if (helpSearch) helpSearch.value = '';
        updateHelpFilter();
        $('pd-help-article-list')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }));
      $('pd-help-open-assistant')?.addEventListener('click', () => {
        if (typeof window.togglePDAssistant === 'function') window.togglePDAssistant();
        else if (typeof window.openPDCommandPalette === 'function') window.openPDCommandPalette();
        else window.switchView?.('auth');
      });

      // Router metadata / titles and scroll restoration for the new first-class view.
      const originalSync = window.syncNavigationState;
      if (typeof originalSync === 'function' && !originalSync.__pd16wrapped) {
        const wrappedSync = function (viewName) {
          const result = originalSync.call(this, viewName);
          document.body.dataset.pdView = viewName;
          if (viewName === 'help') document.title = 'บริการช่วยเหลือของ PrintDekD — PrintDekD Pro';
          else document.title = 'PrintDekD Pro — ITI';
          return result;
        };
        wrappedSync.__pd16wrapped = true;
        window.syncNavigationState = wrappedSync;
      }

      // Mobile navigation: keep the active destination visually clear without running pointer-motion effects.
      document.querySelectorAll('#pd-quick-dock [data-pd-action="help"]').forEach(btn => {
        btn.setAttribute('aria-label', 'เปิดศูนย์ช่วยเหลือ PrintDekD');
        btn.title = 'ศูนย์ช่วยเหลือ';
      });

      // Add non-blocking file/viewport diagnostics for support without collecting user data.
      window.pdV16Diagnostics = function () {
        const viewport = { width: window.innerWidth, height: window.innerHeight, dpr: Math.min(3, window.devicePixelRatio || 1) };
        const root = document.documentElement;
        const result = {
          viewport,
          documentWidth: root.scrollWidth,
          horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
          reducedMotion: !!reduceMotion,
          secureContext: !!window.isSecureContext,
          supabaseConfigured: !!window.supabaseClient,
          pdfjsLoaded: !!window.pdfjsLib,
          helpViewRegistered: !!$('view-help')
        };
        console.info('[PrintDekD v16 diagnostics]', result);
        return result;
      };

      // Defer icon redraw once the help view is ready; this avoids repeated full-page icon scans on every keystroke.
      if (window.lucide) window.lucide.createIcons();
      updateHelpFilter();
      document.addEventListener('pd:viewchange', updateHelpFilter);
    })();
  
