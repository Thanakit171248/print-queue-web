
    (() => {
      'use strict';
      const $ = id => document.getElementById(id);
      const reduceMotion = !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      const coarsePointer = !!window.matchMedia?.('(pointer: coarse)').matches;
      const memory = Number(navigator.deviceMemory || 0);
      const cores = Number(navigator.hardwareConcurrency || 0);
      const lowPower = coarsePointer || (memory > 0 && memory <= 4) || (cores > 0 && cores <= 4);
      document.documentElement.dataset.pdMotion = reduceMotion ? 'reduced' : (lowPower ? 'lite' : 'full');

      // Keep the landing reveal one-way: no fade/blur while scrolling back up.
      if ('IntersectionObserver' in window) {
        const revealIO = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              entry.target.classList.remove('is-scrolled-out');
              revealIO.unobserve(entry.target);
            }
          });
        }, { threshold: .06, rootMargin: '0px 0px -4% 0px' });
        document.querySelectorAll('#view-landing .apple-reveal, #view-landing .pd-reveal-card, #view-landing .pd-final-cta').forEach(el => revealIO.observe(el));
      } else {
        document.querySelectorAll('.apple-reveal,.pd-reveal-card,.pd-final-cta').forEach(el => el.classList.add('is-visible', 'is-in'));
      }

      // Fix navigation indicators after visiting the Support Center (previous map omitted 'help').
      window.addEventListener('pd:viewchange', ev => {
        const view = ev.detail?.viewName || document.body.dataset.pdView;
        document.body.dataset.pdView = view || '';
        document.querySelectorAll('[data-view]').forEach(el => {
          const active = el.dataset.view === view;
          el.classList.toggle('is-active', active);
          if (el.matches('button[role="tab"],a[role="tab"]')) el.setAttribute('aria-selected', String(active));
        });
        if (window.lucide && !lowPower) window.lucide.createIcons();
      });

      // Defer below-the-fold images and decode asynchronously without touching data URLs.
      document.querySelectorAll('img').forEach(img => {
        if (img.closest('.pd17-hero-stage')) {
          img.loading = 'eager'; img.fetchPriority = 'high';
        } else if (!img.complete || img.naturalWidth === 0) {
          img.loading = 'lazy';
        }
        if (!img.hasAttribute('decoding')) img.decoding = 'async';
      });

      // Honor memory-aware motion profile: disable decorative, infinite, paint-heavy effects only.
      if (lowPower || reduceMotion) {
        document.documentElement.classList.add('pd-motion-lite');
        document.querySelectorAll('.pd-card-glow,.pd-final-orb,.pd-ai-pulse').forEach(el => { el.style.animation = 'none'; });
      }
      document.addEventListener('visibilitychange', () => {
        document.documentElement.classList.toggle('pd-page-hidden', document.hidden);
      }, { passive: true });

      // Allow the browser to yield before recalculating off-screen text metrics.
      // Existing v9 ResizeObserver still performs the exact text-overflow checks.

      // Non-invasive diagnostics: logs aggregate device/page facts only; never sends telemetry.
      let longTaskCount = 0;
      try {
        if ('PerformanceObserver' in window && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
          const po = new PerformanceObserver(list => { longTaskCount += list.getEntries().length; });
          po.observe({ type: 'longtask', buffered: true });
        }
      } catch (_) { }
      window.pdV17RunPerformanceAudit = function (showModal = false) {
        const root = document.documentElement;
        const nav = performance.getEntriesByType?.('navigation')?.[0];
        const result = {
          viewport: `${innerWidth}×${innerHeight}`,
          documentWidth: root.scrollWidth,
          horizontalOverflow: root.scrollWidth > root.clientWidth + 2,
          imageCount: document.images.length,
          lazyImages: document.querySelectorAll('img[loading="lazy"]').length,
          scripts: document.scripts.length,
          stylesheetCount: document.styleSheets.length,
          domNodes: document.getElementsByTagName('*').length,
          loadMs: nav ? Math.round(nav.loadEventEnd || nav.duration) : null,
          longTasksObserved: longTaskCount,
          motionProfile: root.dataset.pdMotion || 'default',
          secureContext: !!window.isSecureContext,
          pdfjsLoaded: !!window.pdfjsLib,
          supabaseClientReady: !!(window.supabaseClient || (typeof supabaseClient !== 'undefined' && supabaseClient)),
          helpCenterAvailable: !!$('view-help')
        };
        console.table(result);
        if (showModal && typeof window.showCustomModal === 'function') {
          const message = [
            `Viewport: ${result.viewport}`,
            `Horizontal overflow: ${result.horizontalOverflow ? 'พบ — ตรวจ layout ตามขนาดจอ' : 'ไม่พบ'}`,
            `DOM nodes: ${result.domNodes}`,
            `Images: ${result.imageCount} (lazy ${result.lazyImages})`,
            `Long tasks observed: ${result.longTasksObserved}`,
            `Motion profile: ${result.motionProfile}`,
            `HTTPS secure context: ${result.secureContext ? 'ใช่' : 'ไม่ใช่'}`,
            'ผลนี้เป็น diagnostics ฝั่งเบราว์เซอร์ ไม่ใช่ผลทดสอบ performance จริงของผู้ใช้ทุกคน'
          ].join('\n');
          window.showCustomModal({ title: 'ตรวจสุขภาพหน้าเว็บ', message, icon: result.horizontalOverflow ? 'activity' : 'gauge' });
        }
        return result;
      };
      window.pdV17Diagnostics = window.pdV17RunPerformanceAudit;



      // Theme state should be restored without changing storage semantics from previous versions.
      try {
        const mode = localStorage.getItem('sp_theme_mode') || localStorage.getItem('sp_theme') || 'dark';
        document.documentElement.classList.toggle('dark', mode !== 'light');
      } catch (_) { }

      // Run a light viewport diagnostic after initial layout settles; no alert and no network traffic.
      if ('requestIdleCallback' in window) requestIdleCallback(() => window.pdV17RunPerformanceAudit(false), { timeout: 1800 });
      else setTimeout(() => window.pdV17RunPerformanceAudit(false), 900);
    })();
  