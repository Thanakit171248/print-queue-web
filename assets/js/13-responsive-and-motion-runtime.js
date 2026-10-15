
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

      // Help Center category filters. The text-search UI was removed because it was not useful.
      const help = $('view-help');
      const helpItems = [...document.querySelectorAll('#view-help [data-help-filter-item]')];
      const categoryButtons = [...document.querySelectorAll('#view-help [data-help-category]')];
      let activeCategory = '';
      function updateHelpFilter() {
        if (!help) return;
        let shown = 0;
        helpItems.forEach(item => {
          const groups = String(item.dataset.helpGroup || '').split(/\s+/).filter(Boolean);
          const visible = !activeCategory || groups.includes(activeCategory);
          item.classList.toggle('pd-help-filtered-out', !visible);
          if (visible && item.classList.contains('pd-help-article')) shown++;
        });
        $('pd-help-no-results')?.classList.toggle('hidden', shown > 0);
        const count = $('pd-help-result-count');
        if (count) count.textContent = `${shown} หัวข้อ`;
        categoryButtons.forEach(btn => {
          const selected = btn.dataset.helpCategory === activeCategory;
          btn.setAttribute('aria-pressed', String(selected));
        });
        if (window.lucide) window.lucide.createIcons();
      }
      $('pd-help-clear')?.addEventListener('click', () => {
        activeCategory = '';
        updateHelpFilter();
      });
      $('pd-help-no-results-clear')?.addEventListener('click', () => {
        activeCategory = '';
        updateHelpFilter();
      });
      categoryButtons.forEach(btn => btn.addEventListener('click', () => {
        activeCategory = activeCategory === btn.dataset.helpCategory ? '' : (btn.dataset.helpCategory || '');
        updateHelpFilter();
        $('pd-help-article-list')?.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
      }));
      updateHelpFilter();
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
  
