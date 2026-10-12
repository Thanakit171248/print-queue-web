
    (() => {
      'use strict';
      const $ = (id) => document.getElementById(id);

      const copy = {
        login: {
          pageTitle: 'ยินดีต้อนรับกลับ',
          pageCopy: 'เข้าสู่ระบบเพื่อสั่งพิมพ์ ติดตามคิว และจัดการ Coins ของคุณได้จากที่เดียว',
          formTitle: 'เข้าสู่ระบบ',
          formCopy: 'ใช้บัญชีของคุณเพื่อเริ่มสั่งพิมพ์ต่อ'
        },
        register: {
          pageTitle: 'สร้างบัญชี PrintDekD Pro',
          pageCopy: 'สมัครสมาชิกครั้งเดียว แล้วจัดการงานพิมพ์ คิวรับงาน และ Coins ได้ง่ายขึ้น',
          formTitle: 'ลงทะเบียน',
          formCopy: 'สร้างบัญชีใหม่เพื่อเริ่มใช้งาน PrintDekD Pro'
        }
      };

      function paintAuthTab(tab) {
        const isLogin = tab === 'login';
        const login = $('tab-login'), register = $('tab-register');
        const loginForm = $('form-login'), registerForm = $('form-register');
        if (!login || !register || !loginForm || !registerForm) return;

        loginForm.classList.toggle('hidden', !isLogin);
        registerForm.classList.toggle('hidden', isLogin);
        login.setAttribute('aria-selected', isLogin ? 'true' : 'false');
        register.setAttribute('aria-selected', isLogin ? 'false' : 'true');

        const c = copy[isLogin ? 'login' : 'register'];
        if ($('auth-context-title')) $('auth-context-title').textContent = c.pageTitle;
        if ($('auth-context-copy')) $('auth-context-copy').textContent = c.pageCopy;
        if ($('auth-form-title')) $('auth-form-title').textContent = c.formTitle;
        if ($('auth-form-copy')) $('auth-form-copy').textContent = c.formCopy;

        if (window.lucide) window.lucide.createIcons();
      }

      window.switchAuthTab = paintAuthTab;
      document.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') return;
        const active = document.activeElement;
        if (active?.closest?.('#view-auth')) active.blur();
      });

      // Make the page start in a deterministic state without changing any auth logic.
      document.addEventListener('DOMContentLoaded', () => paintAuthTab('login'));
      window.addEventListener('load', () => {
        paintAuthTab('login');
        if (window.lucide) window.lucide.createIcons();
      });
    })();
  