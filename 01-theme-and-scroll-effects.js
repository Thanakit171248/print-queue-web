
      /* Paint the requested dark experience before the first frame.
         Light mode is opt-in and remembered only after the user changes it. */
      (() => {
        try {
          const saved = localStorage.getItem('sp_theme');
          if (saved !== 'light') document.documentElement.classList.add('dark');
        } catch (_) {
          document.documentElement.classList.add('dark');
        }
      })();
  