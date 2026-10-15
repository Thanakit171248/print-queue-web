
    const DEFAULT_SUPABASE_URL = 'https://gottklflkqnfsjftztst.supabase.co'; // New Supabase project URL.
    const DEFAULT_SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImdvdHRrbGZsa3FuZnNqZnR6dHN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE3OTU1ODAsImV4cCI6MjEwNzM3MTU4MH0.9yRTqqD8lvJ9q0UxNWqn5W5cLB-g9Js940WjLgLyLkA'; // Public anon key only; never place service_role here.

    let supabaseClient = null;
    let currentUser = null;
    let selectedFileObj = null;
    window.currentUser = currentUser;
    window.selectedFileObj = selectedFileObj;
    let detectedPageCount = 1;
    let currentPdfZoom = 1.0;
    let isPasswordValid = false;
    // Guard against duplicate Auth calls when users double-click or double-submit.
    let pdAuthActionInFlight = false;
    let currentOrdersList = [];
    let tempAvatarUrl = '';

    // SECURITY / VALIDATION HELPERS — client-side hardening only; Supabase RLS remains the server-side boundary.
    const MAX_PRINT_FILE_MB = 20;
    const MAX_SLIP_FILE_MB = 5;
    const MAX_AVATAR_FILE_MB = 2;
    const SESSION_IDLE_MS = 7 * 24 * 60 * 60 * 1000;
    const LOGIN_WINDOW_MS = 5 * 60 * 1000;
    const LOGIN_MAX_ATTEMPTS = 5;
    const ALLOWED_TOPUP_AMOUNTS = [20, 50, 100, 200, 500];
    const PRINT_STORAGE_BUCKET = localStorage.getItem('sp_print_bucket') || 'documents';

    function formatBytes(bytes) {
      const units = ['B', 'KB', 'MB', 'GB'];
      let value = Math.max(0, Number(bytes) || 0), i = 0;
      while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
      return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
    }

    function isAllowedImage(file) {
      return !!file && /^image\/(png|jpe?g|webp)$/i.test(file.type || '') && /\.(png|jpe?g|webp)$/i.test(file.name || '');
    }

    function validateUploadFile(file, { maxMB = 20, extensions = [], mimeTypes = [] } = {}) {
      if (!file) return { ok: false, message: 'ไม่พบไฟล์ที่เลือก' };
      const maxBytes = maxMB * 1024 * 1024;
      if (file.size > maxBytes) return { ok: false, message: `ไฟล์ใหญ่เกินกำหนด ${maxMB} MB (ไฟล์นี้ ${formatBytes(file.size)})` };
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const extOk = extensions.length === 0 || extensions.includes(ext);
      const mimeOk = mimeTypes.length === 0 || mimeTypes.includes(file.type);
      if (!extOk || (!mimeOk && file.type)) return { ok: false, message: 'ชนิดไฟล์ไม่ตรงกับไฟล์ที่ระบบอนุญาต กรุณาเลือก PDF, DOC, DOCX, JPG, PNG ตามช่องที่กำหนด' };
      return { ok: true };
    }

    function validSupabaseConfig(url, key) {
      try {
        const u = new URL(String(url || '').trim());
        const k = String(key || '').trim();
        if (u.protocol !== 'https:' || !/\.supabase\.co$/i.test(u.hostname) || u.username || u.password) return false;
        // Never permit Supabase secret/service-role keys in browser-side configuration.
        if (/^(sb_secret_|service_role)/i.test(k)) return false;
        // Current publishable API keys use sb_publishable_... (opaque, short keys).
        if (/^sb_publishable_[A-Za-z0-9_-]{20,}$/i.test(k)) return true;
        // Backward compatibility: accept only legacy Supabase JWT keys whose role is anon.
        const parts = k.split('.');
        if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) return false;
        const payloadPart = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = payloadPart + '='.repeat((4 - payloadPart.length % 4) % 4);
        const payload = JSON.parse(atob(padded));
        return payload?.role === 'anon' && typeof payload?.ref === 'string';
      } catch { return false; }
    }

    function setSecurityStatus(dotState, title, copy) {
      const dot = document.getElementById('security-dot');
      const titleEl = document.getElementById('security-title');
      const copyEl = document.getElementById('security-copy');
      if (dot) dot.className = `security-dot ${dotState || ''}`.trim();
      if (titleEl) titleEl.innerText = title;
      if (copyEl) copyEl.innerText = copy;
    }

    function setSecurityBadge(id, state, textValue) {
      const el = document.getElementById(id);
      if (!el) return;
      el.className = `security-badge ${state}`;
      el.innerText = textValue;
    }

    function sanitizeUserRecord(user) {
      if (!user || typeof user !== 'object') return null;
      const { password_hash, password, ...safeUser } = user;
      return safeUser;
    }

    function touchSession() {
      if (!currentUser) return;
      localStorage.setItem('sp_session_at', String(Date.now()));
    }

    async function runSecurityAudit(notify = false) {
      const transportSecure = window.isSecureContext || location.protocol === 'https:' || location.hostname === 'localhost';
      const dbReady = !!supabaseClient;
      const sessionReady = !!(currentUser && currentUser.id);
      const dbConfigReady = validSupabaseConfig(localStorage.getItem('sp_url') || DEFAULT_SUPABASE_URL, localStorage.getItem('sp_key') || DEFAULT_SUPABASE_KEY);

      setSecurityBadge('security-transport-status', transportSecure ? 'good' : 'bad', transportSecure ? 'HTTPS / Secure Context' : 'ไม่ใช่ Secure Context');
      setSecurityBadge('security-db-status', dbReady ? 'good' : (dbConfigReady ? 'warn' : 'bad'), dbReady ? 'Supabase เชื่อมต่อแล้ว' : (dbConfigReady ? 'กำลังเชื่อมต่อ' : 'ยังไม่พร้อม'));
      setSecurityBadge('security-session-status', sessionReady ? 'good' : 'warn', sessionReady ? 'เซสชันใช้งานอยู่' : 'ยังไม่ได้ล็อกอิน');

      let stripState = 'warn';
      let title = 'การเชื่อมต่อพร้อม — ต้องตรวจสอบ Policy';
      let copy = 'ตรวจ HTTPS และการเชื่อมต่อเบื้องต้นแล้ว แต่หน้าเว็บไม่สามารถยืนยัน RLS / Storage policies แทนฝั่ง Supabase ได้';
      if (!transportSecure) {
        stripState = 'bad'; title = 'ควรหยุดก่อน: การเชื่อมต่อไม่ปลอดภัย'; copy = 'เปิดเว็บผ่าน HTTPS เพื่อป้องกันข้อมูลระหว่างทาง';
      } else if (!dbReady) {
        stripState = 'warn'; title = 'ต้องตรวจสอบ: ฐานข้อมูลยังไม่พร้อม'; copy = 'ยังไม่ควรทำรายการที่ต้องบันทึกข้อมูลหรือชำระเงิน';
      } else if (!sessionReady) {
        stripState = 'warn'; title = 'พร้อมใช้งานแบบสาธารณะ'; copy = 'ต้องเข้าสู่ระบบก่อนสร้างคิวพิมพ์หรือจัดการ Coins';
      } else {
        stripState = 'warn'; title = 'เชื่อมต่อพร้อม — ยังไม่ยืนยันความปลอดภัยฐานข้อมูล';
        copy = 'ตรวจการเชื่อมต่อแล้วเท่านั้น ต้องตรวจ Supabase Auth, RLS และ Storage policies ใน Dashboard ก่อนใช้งานจริง';
      }
      setSecurityStatus(stripState, title, copy);

      const auditTime = document.getElementById('security-audit-time');
      if (auditTime) auditTime.innerText = `ตรวจสอบล่าสุด ${new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}`;

      if (notify) {
        const detail = !transportSecure
          ? 'การเชื่อมต่อไม่อยู่ใน Secure Context — อย่าทำรายการสำคัญจนกว่าจะเปิดผ่าน HTTPS'
          : !dbReady
            ? 'Supabase ยังไม่พร้อม ระบบจะไม่อนุญาตให้ส่งรายการสำคัญไปยังฐานข้อมูล'
            : 'เชื่อมต่อ HTTPS / Supabase ได้ แต่ฟังก์ชันนี้ไม่ได้ตรวจยืนยัน RLS หรือ Storage Policy โปรดตรวจ Security Advisor และ Policies ที่ฝั่ง Supabase';
        showCustomModal({ title: 'ผลตรวจการเชื่อมต่อ', message: detail, icon: 'shield-alert' });
      }
      return { transportSecure, dbReady, sessionReady, dbConfigReady };
    }

    function getLoginAttemptState() {
      try {
        const raw = JSON.parse(localStorage.getItem('sp_login_attempts') || '{}');
        if (!raw.startedAt || Date.now() - raw.startedAt > LOGIN_WINDOW_MS) return { startedAt: Date.now(), count: 0 };
        return raw;
      } catch { return { startedAt: Date.now(), count: 0 }; }
    }

    function noteLoginFailure() {
      const state = getLoginAttemptState();
      state.count = Number(state.count || 0) + 1;
      localStorage.setItem('sp_login_attempts', JSON.stringify(state));
      return state;
    }

    function resetLoginAttempts() { localStorage.removeItem('sp_login_attempts'); }

    function assertAdminAccess() {
      if (!currentUser || currentUser.role !== 'admin' || !supabaseClient) {
        showCustomModal({ title: 'จำกัดสิทธิ์', message: 'เซสชันผู้ดูแลหรือการเชื่อมต่อฐานข้อมูลไม่พร้อมสำหรับการทำรายการนี้', icon: 'shield-alert' });
        return false;
      }
      touchSession();
      return true;
    }

    function assertStaffAccess() {
      const role = String(currentUser?.role || '').toLowerCase();
      if (!currentUser || !['employee', 'staff', 'admin'].includes(role) || !supabaseClient) {
        showCustomModal({ title: 'จำกัดสิทธิ์', message: 'เมนูนี้สงวนสำหรับพนักงานและผู้ดูแลระบบที่เข้าสู่ระบบแล้ว', icon: 'shield-alert' });
        return false;
      }
      touchSession();
      return true;
    }
    window.assertStaffAccess = assertStaffAccess;
    window.assertAdminAccess = assertAdminAccess;

    const PBKDF2_ITERATIONS = 120000;

    function bytesToHex(bytes) {
      return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    function hexToBytes(hex) {
      if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2 !== 0) throw new Error('รูปแบบ salt ไม่ถูกต้อง');
      const out = new Uint8Array(hex.length / 2);
      for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return out;
    }

    async function derivePasswordHash(password, salt, iterations = PBKDF2_ITERATIONS) {
      if (!window.crypto?.subtle) throw new Error('เบราว์เซอร์ไม่รองรับการเข้ารหัสที่จำเป็น กรุณาเปิดผ่าน HTTPS');
      const baseKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), { name: 'PBKDF2' }, false, ['deriveBits']);
      const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, baseKey, 256);
      return bytesToHex(new Uint8Array(bits));
    }

    async function hashPasswordClient(password) {
      if (!window.crypto?.getRandomValues) throw new Error('เบราว์เซอร์ไม่รองรับตัวสร้างข้อมูลสุ่มที่ปลอดภัย');
      const salt = new Uint8Array(16);
      crypto.getRandomValues(salt);
      const derived = await derivePasswordHash(password, salt, PBKDF2_ITERATIONS);
      return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${derived}`;
    }

    async function authenticatePassword(data, password) {
      const storedHash = typeof data?.password_hash === 'string' ? data.password_hash : '';
      const legacyPlain = typeof data?.password === 'string' ? data.password : '';

      if (storedHash.startsWith('pbkdf2-sha256$')) {
        const parts = storedHash.split('$');
        if (parts.length === 4) {
          const iterations = Math.max(100000, Math.min(500000, Number(parts[1]) || PBKDF2_ITERATIONS));
          try {
            const candidate = await derivePasswordHash(password, hexToBytes(parts[2]), iterations);
            if (candidate === parts[3]) return { ok: true, upgrade: false };
          } catch { }
        }
      }

      // Backward compatibility with the previous client-side SHA-256 revision.
      if (/^[0-9a-f]{64}$/i.test(storedHash)) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
        if (bytesToHex(new Uint8Array(digest)) === storedHash.toLowerCase()) return { ok: true, upgrade: true, hashed: await hashPasswordClient(password) };
      }

      if (legacyPlain && legacyPlain === password) return { ok: true, upgrade: true, hashed: await hashPasswordClient(password) };
      // Backward compatibility when an earlier revision placed plaintext in password_hash.
      if (storedHash && storedHash === password) return { ok: true, upgrade: true, hashed: await hashPasswordClient(password) };
      return { ok: false };
    }

    // XSS DATA SANITIZATION FUNCTION
    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    window.addEventListener('load', () => {
      // Start the splash immediately. A non-critical boot error must never trap the user on 0%.
      try { runSplashAnimation(); } catch (err) {
        console.error('Splash animation error:', err);
        const splash = document.getElementById('splash-screen');
        if (splash) { splash.classList.add('opacity-0', 'pointer-events-none'); splash.style.display = 'none'; }
      }

      try {
        const savedTheme = localStorage.getItem('sp_theme');
        if (savedTheme === 'light') document.documentElement.classList.remove('dark');
        else document.documentElement.classList.add('dark');
      } catch (err) {
        console.warn('Theme restore skipped:', err);
      }

      try { initAppleContinuousScrollObserver(); } catch (err) { console.warn('Scroll observer skipped:', err); }
      try { if (typeof lucide !== 'undefined') lucide.createIcons(); } catch (err) { console.warn('Icon render skipped:', err); }

      try {
        // Prevent this new-auth build from silently reconnecting to the old legacy project.
        const previouslySavedUrl = localStorage.getItem('sp_url') || '';
        if (previouslySavedUrl.includes('hghutsekeubqpuxpusub.supabase.co')) {
          localStorage.removeItem('sp_url');
          localStorage.removeItem('sp_key');
          localStorage.removeItem('sp_user');
          localStorage.removeItem('sp_session_at');
        }
        const savedUrl = localStorage.getItem('sp_url') || DEFAULT_SUPABASE_URL;
        const savedKey = localStorage.getItem('sp_key') || DEFAULT_SUPABASE_KEY;

        if (savedUrl) document.getElementById('supabase-url').value = savedUrl;
        if (savedKey) document.getElementById('supabase-key').value = savedKey;

        if (savedUrl && savedKey) {
          initSupabase(savedUrl, savedKey).catch(err => console.warn('Supabase boot skipped:', err));
        } else {
          const configPanel = document.getElementById('config-panel');
          if (configPanel) configPanel.classList.remove('hidden');
          setSecurityStatus('warn', 'รอตั้งค่าฐานข้อมูลใหม่', 'กรอก Project URL และ Publishable/anon key จาก Supabase โปรเจกต์ใหม่ แล้วกดบันทึก');
        }
      } catch (err) {
        console.warn('Database boot skipped:', err);
      }

      try { runSecurityAudit(false); } catch (err) { console.warn('Security audit boot skipped:', err); }
      try { syncNavigationState('landing'); } catch (err) { console.warn('Navigation sync skipped:', err); }
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        toggleAppleTabMenu(false);
        closeUserProfileModal();
        closeQueueDetailModal();
        closeSlipModal();
        closeModal();
      }
    });

    function initAppleContinuousScrollObserver() {
      if (typeof IntersectionObserver !== 'function') return;
      if (!window.__pdAppleRevealObserver) {
        window.__pdAppleRevealObserver = new IntersectionObserver((entries) => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              entry.target.classList.add('is-visible');
              entry.target.classList.remove('is-scrolled-out');
            } else if (entry.boundingClientRect.top < 0) {
              entry.target.classList.add('is-scrolled-out');
            } else {
              entry.target.classList.remove('is-visible');
            }
          });
        }, { threshold: [0, 0.15, 0.85, 1], rootMargin: '-30px 0px -30px 0px' });
      }
      document.querySelectorAll('.apple-reveal:not([data-pd-reveal-bound])').forEach(el => {
        el.dataset.pdRevealBound = '1';
        window.__pdAppleRevealObserver.observe(el);
      });
    }

    function handleBackdropClick(event, modalId, closeFn) {
      if (event.target.id === modalId) closeFn();
    }

    async function copyPromptPay() {
      const account = '219-3-54005-0';
      try {
        if (navigator.clipboard?.writeText && window.isSecureContext) await navigator.clipboard.writeText(account);
        else {
          const helper = document.createElement('textarea'); helper.value = account; helper.setAttribute('readonly', '');
          helper.style.position = 'fixed'; helper.style.opacity = '0'; document.body.appendChild(helper); helper.select();
          const copied = document.execCommand('copy'); helper.remove(); if (!copied) throw new Error('เบราว์เซอร์ไม่อนุญาตให้คัดลอกอัตโนมัติ');
        }
        showCustomModal({ title: 'คัดลอกเลขบัญชีสำเร็จ', message: `คัดลอกเลขบัญชี ${account} เรียบร้อยแล้ว`, icon: 'check-circle' });
      } catch (_) {
        showCustomModal({ title: 'เลขบัญชีสำหรับโอนเงิน', message: `ธนาคารกสิกรไทย\nชื่อบัญชี: ธนกฤต พรมป้อ\nเลขบัญชี: ${account}`, icon: 'info' });
      }
    }

    function openUserProfileModal() {
      if (!currentUser) {
        showCustomModal({
          title: 'ยังไม่ได้เข้าสู่ระบบ',
          message: 'กรุณาเข้าสู่ระบบเพื่อดูข้อมูลโปรไฟล์ส่วนตัว',
          icon: 'lock',
          onConfirm: () => switchView('auth')
        });
        return;
      }

      document.getElementById('prof-fullname').innerText = currentUser.full_name || 'ผู้ใช้งาน';
      document.getElementById('prof-email').innerText = currentUser.email || '-';

      const avatarImg = document.getElementById('prof-avatar-img');
      const defaultAvatar = 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=300&q=80';
      avatarImg.src = currentUser.avatar_url || defaultAvatar;

      const roleBadge = document.getElementById('prof-role-badge');
      if (currentUser.role === 'admin') {
        roleBadge.innerText = 'ผู้ดูแลระบบ (Admin)';
        roleBadge.className = 'inline-block px-3.5 py-1 rounded-full text-xs font-bold bg-purple-500/20 text-purple-600 dark:text-purple-300 border border-purple-500/30';
      } else if (['employee','staff'].includes(String(currentUser.role || '').toLowerCase())) {
        roleBadge.innerText = currentUser.role === 'employee' ? 'พนักงาน (Employee)' : 'เจ้าหน้าที่ (Staff)';
        roleBadge.className = 'inline-block px-3.5 py-1 rounded-full text-xs font-bold bg-teal-500/20 text-teal-600 dark:text-teal-300 border border-teal-500/30';
      } else {
        roleBadge.innerText = 'สมาชิกทั่วไป (Member)';
        roleBadge.className = 'inline-block px-3.5 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
      }

      toggleProfileEdit(false);
      fetchUserWallet();
      document.getElementById('user-profile-modal').classList.remove('hidden');
      document.getElementById('user-profile-modal').setAttribute('aria-hidden', 'false');
      runSecurityAudit(false);
    }

    function closeUserProfileModal() {
      document.getElementById('user-profile-modal').classList.add('hidden');
      document.getElementById('user-profile-modal').setAttribute('aria-hidden', 'true');
    }

    function toggleProfileEdit(showEdit) {
      const viewSection = document.getElementById('profile-view-section');
      const editSection = document.getElementById('profile-edit-section');

      if (showEdit) {
        document.getElementById('edit-fullname').value = currentUser?.full_name || '';
        document.getElementById('edit-avatar-url').value = currentUser?.avatar_url || '';
        viewSection.classList.add('hidden');
        editSection.classList.remove('hidden');
      } else {
        viewSection.classList.remove('hidden');
        editSection.classList.add('hidden');
      }
    }

    function previewEditAvatarFile(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
          tempAvatarUrl = evt.target.result;
          document.getElementById('edit-avatar-url').value = tempAvatarUrl;
        };
        reader.readAsDataURL(file);
      }
    }

    function previewRegAvatarFile(e) {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (evt) {
          document.getElementById('reg-avatar-preview').src = evt.target.result;
        };
        reader.readAsDataURL(file);
      }
    }

    async function saveProfileChanges(e) {
      e.preventDefault();
      if (!currentUser || !supabaseClient) return showCustomModal({ title: 'เชื่อมต่อฐานข้อมูลไม่พร้อม', message: 'ระบบไม่บันทึกการเปลี่ยนแปลงเพื่อป้องกันข้อมูลค้างหรือผิดพลาด', icon: 'database-zap' });

      const newName = document.getElementById('edit-fullname').value.trim();
      const rawAvatar = document.getElementById('edit-avatar-url').value.trim() || tempAvatarUrl;
      if (newName.length < 2 || newName.length > 80) return showCustomModal({ title: 'ตรวจสอบชื่อผู้ใช้งาน', message: 'ชื่อ-นามสกุลต้องมีความยาว 2-80 ตัวอักษร', icon: 'alert-triangle' });

      let newAvatar = rawAvatar;
      if (newAvatar.startsWith('data:')) {
        if (newAvatar.length > MAX_AVATAR_FILE_MB * 1024 * 1024 * 1.37) return showCustomModal({ title: 'รูปโปรไฟล์ใหญ่เกินไป', message: `กรุณาใช้รูปที่มีขนาดไม่เกิน ${MAX_AVATAR_FILE_MB} MB`, icon: 'image-off' });
      } else if (newAvatar) {
        try {
          const u = new URL(newAvatar);
          if (u.protocol !== 'https:') throw new Error('protocol');
        } catch {
          return showCustomModal({ title: 'URL รูปโปรไฟล์ไม่ปลอดภัย', message: 'กรุณาใช้ URL HTTPS ที่ถูกต้อง หรืออัปโหลดรูปภาพจากเครื่อง', icon: 'shield-alert' });
        }
      }

      try {
        const { data, error } = await supabaseClient
          .from('users')
          .update({ full_name: newName, avatar_url: newAvatar })
          .eq('id', currentUser.id)
          .select('id,full_name,email,role,avatar_url')
          .single();
        if (error) throw error;
        currentUser = sanitizeUserRecord(data) || { ...currentUser, full_name: newName, avatar_url: newAvatar };
        localStorage.setItem('sp_user', JSON.stringify(currentUser));
        touchSession();
        updateUserUI();
        openUserProfileModal();
        showCustomModal({ title: 'อัปเดตสำเร็จ', message: 'ข้อมูลโปรไฟล์ถูกตรวจสอบและบันทึกเรียบร้อยแล้ว', icon: 'shield-check' });
      } catch (err) {
        showCustomModal({ title: 'บันทึกโปรไฟล์ไม่สำเร็จ', message: err.message || 'เกิดข้อผิดพลาด', icon: 'alert-circle' });
      }
    }

    let previousMenuFocus = null;
    function toggleAppleTabMenu(show = true) {
      const menu = document.getElementById('apple-tab-menu');
      if (!menu) return;
      if (show) {
        previousMenuFocus = document.activeElement;
        syncNavigationState(document.body.dataset.currentView || 'landing');
        menu.classList.remove('hidden', 'pointer-events-none');
        menu.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
        requestAnimationFrame(() => menu.classList.remove('opacity-0'));
        setTimeout(() => document.querySelector('#apple-tab-menu .apple-menu-item:not(.hidden)')?.focus(), 30);
      } else {
        menu.classList.add('opacity-0');
        menu.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
        setTimeout(() => menu.classList.add('hidden', 'pointer-events-none'), 320);
        previousMenuFocus?.focus?.();
      }
    }

    function syncNavigationState(viewName) {
      document.body.dataset.currentView = viewName;
      document.querySelectorAll('[data-view]').forEach(el => el.classList.toggle('is-active', el.getAttribute('data-view') === viewName));
    }

    function updateDemoPrice() {
      const pages = Math.max(1, parseInt(document.getElementById('demo-page-slider').value) || 1);
      const rate = parseFloat(document.getElementById('demo-color-select').value) || 1;
      const deliveryFee = parseFloat(document.getElementById('demo-delivery-select').value) || 0;

      document.getElementById('demo-page-val').innerText = `${pages} หน้า`;
      const total = (pages * rate) + deliveryFee;
      document.getElementById('demo-total-price').innerText = `${total.toFixed(2)} ฿`;

      const hintEl = document.getElementById('demo-delivery-hint');
      if (hintEl) {
        hintEl.innerText = deliveryFee > 0
          ? `(รวมค่าบริการพิมพ์ ${(pages * rate).toFixed(2)} ฿ + ค่าจัดส่งพัสดุ 30.00 ฿)`
          : `(รับสินค้าฟรีหน้าร้าน - ไม่มีค่าบริการจัดส่ง)`;
      }
    }

    function openQueueDetailModal(orderId) {
      const order = currentOrdersList.find(o => o.id === orderId);
      if (!order) return showCustomModal({ title: 'ไม่พบข้อมูล', message: 'ไม่พบรายละเอียดคิวงานพิมพ์นี้', icon: 'alert-triangle' });

      document.getElementById('qd-modal-order-id').innerText = `Queue ID: #${order.id}`;
      document.getElementById('qd-modal-filename').innerText = order.file_name || 'เอกสารพิมพ์';
      document.getElementById('qd-modal-pages').innerText = `${order.page_count || 1} หน้า`;
      document.getElementById('qd-modal-copies').innerText = `${order.copies || 1} ชุด`;
      document.getElementById('qd-modal-paper').innerText = order.paper_size || 'A4';
      document.getElementById('qd-modal-color').innerText = order.is_color ? 'พิมพ์สี' : 'ขาว-ดำ';
      document.getElementById('qd-modal-duplex').innerText = order.is_duplex ? 'พิมพ์หน้า-หลัง' : 'หน้าเดียว';
      document.getElementById('qd-modal-notes').innerText = order.admin_note || 'ไม่มีหมายเหตุเพิ่มเติม';
      document.getElementById('qd-modal-totalprice').innerText = `${parseFloat(order.total_price || 0).toFixed(2)} ฿`;
      document.getElementById('qd-modal-paymethod').innerText = order.payment_method === 'coins' ? 'Coins' : 'PromptPay Direct';

      const isDelivery = order.delivery_method === 'delivery';
      document.getElementById('qd-modal-pickup-info').innerText = isDelivery
        ? `🚚 การรับสินค้า: จัดส่งพัสดุถึงบ้าน (ค่าส่ง +30 ฿)`
        : `📍 การรับสินค้า: รับหน้าร้านโดยตรงเมื่อพิมพ์เสร็จ`;

      const trackingBox = document.getElementById('qd-modal-tracking-box');
      if (isDelivery) {
        document.getElementById('qd-modal-tracking-num').innerText = order.tracking_number ? `เลข Tracking: ${order.tracking_number} (${order.courier_name || 'Kerry Express'})` : `สถานะพัสดุ: กำลังเตรียมจัดส่ง`;
        document.getElementById('qd-modal-recipient-info').innerText = `ผู้รับ: ${order.recipient_name || '-'} (${order.recipient_phone || '-'}) | ที่อยู่: ${order.recipient_address || '-'}`;
        trackingBox.classList.remove('hidden');
      } else {
        trackingBox.classList.add('hidden');
      }

      const statusBadge = document.getElementById('qd-modal-status-badge');
      if (order.status === 'completed') {
        statusBadge.innerText = isDelivery ? '✅ พิมพ์เสร็จแล้ว (กำลังจัดส่ง)' : '✅ พิมพ์เสร็จแล้ว (พร้อมรับหน้าร้าน)';
        statusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30';
      } else if (order.status === 'printing') {
        statusBadge.innerText = '🖨️ กำลังพิมพ์เอกสาร...';
        statusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30';
      } else if (order.status === 'cancelled') {
        statusBadge.innerText = '❌ ยกเลิกรายการ';
        statusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30';
      } else {
        statusBadge.innerText = '⏳ รอยืนยันคิว / ตรวจสลิป';
        statusBadge.className = 'px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30';
      }

      const slipBox = document.getElementById('qd-modal-slip-box');
      if (order.slip_url) {
        document.getElementById('qd-modal-slip-img').src = order.slip_url;
        slipBox.classList.remove('hidden');
      } else {
        slipBox.classList.add('hidden');
      }

      document.getElementById('queue-detail-modal').classList.remove('hidden');
    }

    function closeQueueDetailModal() {
      document.getElementById('queue-detail-modal').classList.add('hidden');
    }

    let splashFailsafeTimer = null;

    function runSplashAnimation() {
      if (splashFailsafeTimer) clearTimeout(splashFailsafeTimer);
      const progressBar = document.getElementById('splash-progress-bar');
      const percentText = document.getElementById('splash-percent-text');
      let pct = 0;
      const interval = setInterval(() => {
        pct += 4;
        if (progressBar) progressBar.style.width = pct + '%';
        if (percentText) percentText.innerText = pct + '%';
        if (pct >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            const splash = document.getElementById('splash-screen');
            if (splash) {
              splash.classList.add('opacity-0', 'pointer-events-none');
              setTimeout(() => splash.style.display = 'none', 700);
            }
          }, 200);
        }
      }, 20);
    }

    splashFailsafeTimer = setTimeout(() => {
      const splash = document.getElementById('splash-screen');
      if (splash && splash.style.display !== 'none') {
        console.warn('Splash failsafe activated.');
        splash.classList.add('opacity-0', 'pointer-events-none');
        setTimeout(() => splash.style.display = 'none', 500);
      }
    }, 8000);

    function toggleTheme() {
      const htmlEl = document.documentElement;
      const isDark = !htmlEl.classList.contains('dark');
      htmlEl.classList.toggle('dark', isDark);
      localStorage.setItem('sp_theme', isDark ? 'dark' : 'light');
      const themeIcon = document.getElementById('theme-icon');
      if (themeIcon) themeIcon.setAttribute('data-lucide', isDark ? 'sun' : 'moon');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function animateRefresh(btnId, callback) {
      const btn = document.getElementById(btnId);
      if (!btn) return;
      const icon = btn.querySelector('.refresh-icon');
      if (icon) icon.classList.add('animate-spin');

      if (typeof callback === 'function') {
        callback().finally(() => {
          setTimeout(() => { if (icon) icon.classList.remove('animate-spin'); }, 600);
        });
      }
    }

    function togglePasswordVisibility(inputId, eyeIconId) {
      const input = document.getElementById(inputId);
      const eye = document.getElementById(eyeIconId);
      if (input.type === 'password') {
        input.type = 'text';
        eye.setAttribute('data-lucide', 'eye-off');
      } else {
        input.type = 'password';
        eye.setAttribute('data-lucide', 'eye');
      }
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function validatePasswordRequirements() {
      const pwd = document.getElementById('reg-password').value;
      const submitBtn = document.getElementById('reg-submit-btn');

      const reqs = {
        length: pwd.length >= 8,
        upper: /[A-Z]/.test(pwd),
        lower: /[a-z]/.test(pwd),
        num: /[0-9]/.test(pwd)
      };

      updateReqStatus('pwd-req-length', reqs.length, 'อย่างน้อย 8 ตัวอักษร');
      updateReqStatus('pwd-req-upper', reqs.upper, 'มีภาษาอังกฤษ พิมพ์ใหญ่ (A-Z)');
      updateReqStatus('pwd-req-lower', reqs.lower, 'มีภาษาอังกฤษ พิมพ์เล็ก (a-z)');
      updateReqStatus('pwd-req-num', reqs.num, 'มีตัวเลขอย่างน้อย 1 ตัว (0-9)');

      isPasswordValid = reqs.length && reqs.upper && reqs.lower && reqs.num;
      submitBtn.classList.toggle('opacity-60', !isPasswordValid);
    }

    function updateReqStatus(elementId, isValid, text) {
      const el = document.getElementById(elementId);
      if (!el) return;
      el.className = isValid ? 'flex items-center gap-1.5 text-emerald-500 font-medium' : 'flex items-center gap-1.5 text-rose-500 font-medium';
      el.innerHTML = `<i data-lucide="${isValid ? 'check-circle' : 'x-circle'}" class="w-3.5 h-3.5"></i> ${text}`;
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function toggleFilePreviewDrawer(show = true) {
      document.getElementById('file-preview-drawer').classList.toggle('hidden', !show);
    }

    function changeZoom(delta) {
      currentPdfZoom = Math.max(0.6, Math.min(2.5, currentPdfZoom + delta));
      document.getElementById('pdf-preview-wrapper').style.transform = `scale(${currentPdfZoom})`;
      document.getElementById('zoom-level-text').innerText = `${Math.round(currentPdfZoom * 100)}%`;
    }

    function resetZoom() {
      currentPdfZoom = 1.0;
      changeZoom(0);
    }

    function showCustomModal({ title, message = '', icon = 'info', showCancel = false, onConfirm = null }) {
      document.getElementById('modal-title').innerText = title || 'แจ้งเตือน';
      document.getElementById('modal-message').innerText = message || '';
      document.getElementById('modal-icon').setAttribute('data-lucide', icon);

      const cancelBtn = document.getElementById('modal-cancel-btn');
      cancelBtn.classList.toggle('hidden', !showCancel);

      document.getElementById('modal-confirm-btn').onclick = () => { closeModal(); if (onConfirm) onConfirm(); };
      if (typeof lucide !== 'undefined') lucide.createIcons();
      document.getElementById('custom-modal').classList.remove('hidden');
    }

    function closeModal() { document.getElementById('custom-modal').classList.add('hidden'); }

    function openSlipModal(imageUrl) {
      if (!imageUrl) return showCustomModal({ title: 'ไม่พบสลิป', message: 'ไม่มีรูปภาพสลิปสำหรับรายการนี้', icon: 'image-off' });
      document.getElementById('slip-modal-img').src = imageUrl;
      document.getElementById('slip-preview-modal').classList.remove('hidden');
    }

    function closeSlipModal() { document.getElementById('slip-preview-modal').classList.add('hidden'); }

    window.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      const menu = document.getElementById('apple-tab-menu');
      if (menu && !menu.classList.contains('hidden')) toggleAppleTabMenu(false);
      const profile = document.getElementById('user-profile-modal');
      if (profile && !profile.classList.contains('hidden')) closeUserProfileModal();
      const queue = document.getElementById('queue-detail-modal');
      if (queue && !queue.classList.contains('hidden')) closeQueueDetailModal();
      const modal = document.getElementById('custom-modal');
      if (modal && !modal.classList.contains('hidden')) closeModal();
    });

    function switchView(viewName) {
      const allowed = ['landing', 'auth', 'dashboard', 'wallet', 'admin', 'employee', 'help'];
      if (!allowed.includes(viewName)) viewName = 'landing';
      if (viewName === 'admin' && (!currentUser || currentUser.role !== 'admin' || !supabaseClient)) {
        showCustomModal({ title: 'จำกัดสิทธิ์', message: 'เฉพาะ Admin ที่มีเซสชันและฐานข้อมูลพร้อมเท่านั้นที่เข้าใช้งานได้', icon: 'shield-alert' });
        return switchView('landing');
      }
      if (viewName === 'employee' && (!currentUser || !['employee', 'staff', 'admin'].includes(String(currentUser.role || '').toLowerCase()) || !supabaseClient)) {
        showCustomModal({ title: 'จำกัดสิทธิ์', message: 'เฉพาะบัญชีพนักงานหรือผู้ดูแลระบบเท่านั้นที่เข้าพื้นที่ทำงานนี้ได้', icon: 'shield-alert' });
        return switchView('landing');
      }

      allowed.forEach(v => document.getElementById(`view-${v}`)?.classList.add('hidden'));
      const target = document.getElementById(`view-${viewName}`);
      if (!target) return;
      target.classList.remove('hidden');
      target.classList.remove('view-enter-once');
      requestAnimationFrame(() => target.classList.add('view-enter-once'));
      syncNavigationState(viewName);
      window.dispatchEvent(new CustomEvent('pd:viewchange', { detail: { viewName } }));

      touchSession();
      if (viewName === 'dashboard') fetchQueues();
      else if (viewName === 'wallet') { fetchUserTopups(); fetchUserWallet(); }
      else if (viewName === 'admin') loadAdminData();

      runSecurityAudit(false);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      setTimeout(initAppleContinuousScrollObserver, 90);
    }

    function handleStartPrinting() {
      if (currentUser) switchView('dashboard');
      else {
        showCustomModal({
          title: 'เข้าสู่ระบบก่อนสั่งพิมพ์',
          message: 'กรุณาเข้าสู่ระบบก่อนทำการสั่งพิมพ์เอกสาร',
          icon: 'lock',
          onConfirm: () => { switchView('auth'); switchAuthTab('login'); }
        });
      }
    }

    function switchAuthTab(tab) {
      const isLogin = tab === 'login';
      document.getElementById('form-login').classList.toggle('hidden', !isLogin);
      document.getElementById('form-register').classList.toggle('hidden', isLogin);

      document.getElementById('tab-login').className = isLogin ? 'flex-1 py-3 text-xs font-bold rounded-lg text-white bg-blue-600 shadow-sm' : 'flex-1 py-3 text-xs font-bold rounded-lg titanium-text opacity-80 hover:opacity-100';
      document.getElementById('tab-register').className = !isLogin ? 'flex-1 py-3 text-xs font-bold rounded-lg text-white bg-emerald-600 shadow-sm' : 'flex-1 py-3 text-xs font-bold rounded-lg titanium-text opacity-80 hover:opacity-100';
    }

    function toggleConfigPanel() { document.getElementById('config-panel').classList.toggle('hidden'); }

    async function saveAndInitSupabase() {
      const url = document.getElementById('supabase-url').value.trim();
      const key = document.getElementById('supabase-key').value.trim();
      if (!url || !key) return showCustomModal({ title: 'กรอกข้อมูลไม่ครบ', message: 'กรุณากรอก URL และ Key', icon: 'alert-triangle' });
      if (!validSupabaseConfig(url, key)) return showCustomModal({ title: 'ตรวจสอบการเชื่อมต่อ', message: 'กรุณาใช้ Project URL ของ Supabase และ Publishable key (sb_publishable_...) หรือ legacy anon JWT เท่านั้น ห้ามใส่ sb_secret หรือ service_role key ในเว็บไซต์ เพราะเป็นกุญแจสิทธิ์สูง', icon: 'shield-alert' });
      localStorage.setItem('sp_url', url); localStorage.setItem('sp_key', key);
      const ok = await initSupabase(url, key);
      if (!ok) return;
      showCustomModal({ title: 'เชื่อมต่อสำเร็จ', message: 'เชื่อมต่อฐานข้อมูลแล้ว และเปิดโหมดตรวจสอบความปลอดภัยไว้', icon: 'shield-check' });
    }

    async function initSupabase(url, key) {
      try {
        if (!window.supabase) throw new Error('ไม่พบ Supabase client');
        if (!validSupabaseConfig(url, key)) throw new Error('Supabase configuration ไม่ถูกต้อง');
        supabaseClient = window.supabase.createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } });
        setSecurityStatus('warn', 'กำลังเชื่อมต่อ Supabase', 'ตรวจสอบเซสชันและการเข้าถึงข้อมูลของบัญชี');
        await checkSession();
        await runSecurityAudit(false);
        return true;
      } catch (err) {
        supabaseClient = null;
        setSecurityStatus('bad', 'เชื่อมต่อฐานข้อมูลไม่สำเร็จ', 'ระบบจะหยุดรายการสำคัญไว้ก่อนจนกว่าจะตรวจสอบการเชื่อมต่อ');
        console.error('Supabase Init Error:', err);
        return false;
      }
    }

    async function checkSession() {
      if (!supabaseClient) {
        currentUser = null;
        window.currentUser = null;
        updateUserUI();
        return;
      }

      try {
        const { data: sessionData, error: sessionError } = await supabaseClient.auth.getSession();
        if (sessionError) throw sessionError;
        const session = sessionData?.session;
        const authUser = session?.user;
        if (!authUser) {
          currentUser = null;
          window.currentUser = null;
          localStorage.removeItem('sp_user');
          localStorage.removeItem('sp_session_at');
          updateUserUI();
          return;
        }

        const savedAt = Number(localStorage.getItem('sp_session_at') || 0);
        if (savedAt && Date.now() - savedAt > SESSION_IDLE_MS) {
          await supabaseClient.auth.signOut();
          currentUser = null;
          window.currentUser = null;
          localStorage.removeItem('sp_user');
          localStorage.removeItem('sp_session_at');
          updateUserUI();
          showCustomModal({ title: 'เซสชันหมดอายุ', message: 'เพื่อความปลอดภัย กรุณาเข้าสู่ระบบอีกครั้ง', icon: 'clock-alert' });
          return;
        }

        const { data: profile, error: profileError } = await supabaseClient
          .from('users')
          .select('id,full_name,email,role,avatar_url')
          .eq('id', authUser.id)
          .maybeSingle();
        if (profileError) throw profileError;
        if (!profile) throw new Error('เข้าสู่ระบบ Auth ได้ แต่ไม่พบโปรไฟล์ใน public.users กรุณาตรวจ trigger pd_auth_user_created ใน Supabase');

        currentUser = sanitizeUserRecord({ ...profile, email: profile.email || authUser.email });
        window.currentUser = currentUser;
        localStorage.setItem('sp_user', JSON.stringify(currentUser));
        touchSession();
        updateUserUI();
        try { await fetchUserWallet(); } catch (walletErr) { console.warn('Wallet refresh skipped:', walletErr); }
      } catch (e) {
        console.error('Supabase Auth session sync failed:', e);
        currentUser = null;
        window.currentUser = null;
        localStorage.removeItem('sp_user');
        localStorage.removeItem('sp_session_at');
        updateUserUI();
      }
    }

    function updateUserUI() {
      const guestBtns = document.getElementById('guest-buttons');
      const userMenu = document.getElementById('user-profile-menu');
      const coinsBadge = document.getElementById('user-coins-badge');
      const walletNavBtn = document.getElementById('nav-wallet-btn');
      const adminNavBtn = document.getElementById('admin-menu-btn');
      const appleAdminBtn = document.getElementById('apple-admin-menu-btn');
      const dbConfigBtn = document.getElementById('admin-db-config-btn');
      const employeeNavBtn = document.getElementById('employee-menu-btn');
      const appleEmployeeBtn = document.getElementById('apple-employee-menu-btn');

      if (currentUser) {
        guestBtns.classList.add('hidden');
        userMenu.classList.remove('hidden');
        coinsBadge.classList.remove('hidden');
        walletNavBtn.classList.remove('hidden');

        document.getElementById('user-display-name').innerText = currentUser.full_name || 'สมาชิก';
        if (currentUser.avatar_url) {
          document.getElementById('nav-avatar-img').src = currentUser.avatar_url;
        }

        if (currentUser.role === 'admin') {
          adminNavBtn?.classList.remove('hidden');
          appleAdminBtn?.classList.remove('hidden');
          dbConfigBtn?.classList.remove('hidden');
        } else {
          adminNavBtn?.classList.add('hidden');
          appleAdminBtn?.classList.add('hidden');
          dbConfigBtn?.classList.add('hidden');
        }
        if (['employee', 'staff', 'admin'].includes(String(currentUser.role || '').toLowerCase())) {
          employeeNavBtn?.classList.remove('hidden');
          appleEmployeeBtn?.classList.remove('hidden');
        } else {
          employeeNavBtn?.classList.add('hidden');
          appleEmployeeBtn?.classList.add('hidden');
        }
      } else {
        guestBtns.classList.remove('hidden');
        userMenu.classList.add('hidden');
        coinsBadge.classList.add('hidden');
        walletNavBtn.classList.add('hidden');
        adminNavBtn?.classList.add('hidden');
        appleAdminBtn?.classList.add('hidden');
        dbConfigBtn?.classList.remove('hidden');
        employeeNavBtn?.classList.add('hidden');
        appleEmployeeBtn?.classList.add('hidden');
      }
    }

    async function loadSupabaseAuthProfile(authUser) {
      if (!authUser?.id) throw new Error('Supabase Auth ไม่ได้ส่ง User ID กลับมา');
      const { data: profile, error } = await supabaseClient
        .from('users')
        .select('id,full_name,email,role,avatar_url')
        .eq('id', authUser.id)
        .maybeSingle();
      if (error) throw error;
      if (!profile) throw new Error('ยืนยันตัวตนสำเร็จ แต่ไม่พบโปรไฟล์ public.users ตรวจว่าได้รัน schema ใหม่ครบและมี trigger pd_auth_user_created แล้ว');
      return sanitizeUserRecord({ ...profile, email: profile.email || authUser.email });
    }

    function setAuthFormBusy(formId, busy, loadingText = 'กำลังดำเนินการ...') {
      const form = document.getElementById(formId);
      const button = form?.querySelector('button[type="submit"]');
      if (!button) return;
      if (busy) {
        if (!button.dataset.pdOriginalHtml) button.dataset.pdOriginalHtml = button.innerHTML;
        button.disabled = true;
        button.setAttribute('aria-busy', 'true');
        button.style.opacity = '0.78';
        button.style.cursor = 'wait';
        button.innerHTML = `<span>${loadingText}</span><i data-lucide="loader-circle" class="animate-spin" aria-hidden="true"></i>`;
      } else {
        button.disabled = false;
        button.removeAttribute('aria-busy');
        button.style.opacity = '';
        button.style.cursor = '';
        if (button.dataset.pdOriginalHtml) button.innerHTML = button.dataset.pdOriginalHtml;
        try { if (window.lucide?.createIcons) window.lucide.createIcons(); } catch (_) {}
      }
    }

    function friendlySupabaseAuthError(error, action = 'register') {
      const code = String(error?.code || error?.error_code || '').toLowerCase();
      const raw = String(error?.message || '').trim();
      const text = raw.toLowerCase();

      if (code === 'over_email_send_rate_limit' || /email rate limit exceeded|over_email_send_rate_limit/.test(text)) {
        return 'Supabase จำกัดการส่งอีเมลของโปรเจกต์ชั่วคราว ระบบอีเมลเริ่มต้นมีโควตาต่ำ อย่ากดซ้ำ ให้รอจนโควตาคลายก่อน หรือใช้ Custom SMTP เมื่อพร้อม';
      }
      if (code === 'email_address_not_authorized' || /email address.*not authorized/.test(text)) {
        return 'โปรเจกต์นี้ยังใช้ระบบส่งอีเมลเริ่มต้น ซึ่งส่งได้เฉพาะอีเมลที่ได้รับอนุญาตในองค์กร Supabase เท่านั้น การให้ผู้ใช้ทั่วไปสมัครต้องตั้ง SMTP ที่รองรับ';
      }
      if (code === 'email_address_invalid' || /email address .* is invalid/.test(text)) {
        return 'Supabase ปฏิเสธอีเมลนี้ว่าไม่รองรับหรือไม่ถูกต้อง ไม่ได้หมายความว่ารูปแบบ Gmail ทั้งหมดใช้ไม่ได้ หากเป็นอีเมลจริงที่คุณเข้าถึงได้ ให้ตรวจ Authentication Logs ใน Supabase เพื่อดูรายละเอียดเพิ่มเติม';
      }
      if (code === 'over_request_rate_limit' || /request rate limit reached|too many requests/.test(text)) {
        return 'มีคำขอสมัครหรือเข้าสู่ระบบมากเกินไปจากเครือข่ายนี้ กรุณาหยุดลองซ้ำและรอสักครู่ก่อนดำเนินการต่อ';
      }
      if (code === 'user_already_exists' || /user already registered|already been registered/.test(text)) {
        return 'อีเมลนี้มีบัญชีอยู่แล้ว กรุณาเปลี่ยนไปที่แท็บเข้าสู่ระบบ หรือใช้ขั้นตอนรีเซ็ตรหัสผ่าน';
      }
      if (/password.*(weak|short|least)|weak_password/.test(text)) {
        return 'รหัสผ่านไม่ผ่านข้อกำหนดของ Supabase กรุณาตั้งรหัสผ่านใหม่ตามเงื่อนไขที่หน้าเว็บแจ้ง';
      }
      if (/failed to fetch|networkerror|fetch failed/.test(text)) {
        return 'เชื่อมต่อ Supabase ไม่สำเร็จ กรุณาตรวจอินเทอร์เน็ตและ Project URL/anon key แล้วลองใหม่ภายหลัง';
      }
      if (action === 'login') return 'เข้าสู่ระบบไม่สำเร็จ กรุณาตรวจอีเมลและรหัสผ่าน หากเพิ่งลองหลายครั้งให้รอสักครู่ก่อนลองใหม่';
      return 'สมัครสมาชิกไม่สำเร็จ กรุณาตรวจ Authentication Logs ใน Supabase ก่อนสมัครซ้ำ เพื่อป้องกันการส่งคำขอหรืออีเมลเกินโควตา';
    }

    async function handleLogin(e) {
      e.preventDefault();
      if (!supabaseClient) return showCustomModal({ title: 'ระบบยังไม่พร้อม', message: 'กรุณาตรวจ URL และ Publishable/anon key ของ Supabase ก่อนเข้าสู่ระบบ', icon: 'database-zap' });

      const attemptState = getLoginAttemptState();
      if (attemptState.count >= LOGIN_MAX_ATTEMPTS) {
        return showCustomModal({ title: 'ลองเข้าสู่ระบบบ่อยเกินไป', message: 'เพื่อความปลอดภัย กรุณารอประมาณ 5 นาทีแล้วลองใหม่', icon: 'shield-alert' });
      }

      const email = document.getElementById('login-email').value.trim().toLowerCase();
      const password = document.getElementById('login-password').value;
      if (!email || password.length === 0) return showCustomModal({ title: 'ตรวจสอบข้อมูล', message: 'กรุณากรอกอีเมลและรหัสผ่านให้ครบถ้วน', icon: 'alert-triangle' });
      if (pdAuthActionInFlight) return;
      pdAuthActionInFlight = true;
      setAuthFormBusy('form-login', true, 'กำลังเข้าสู่ระบบ...');

      try {
        const { data: authData, error: authError } = await supabaseClient.auth.signInWithPassword({ email, password });
        if (authError) {
          const state = noteLoginFailure();
          const left = Math.max(0, LOGIN_MAX_ATTEMPTS - state.count);
          return showCustomModal({ title: 'เข้าสู่ระบบไม่สำเร็จ', message: `อีเมลหรือรหัสผ่านไม่ถูกต้อง${left ? ` · เหลือโอกาส ${left} ครั้ง` : ' · ระบบพักการเข้าสู่ระบบชั่วคราว'}`, icon: 'shield-alert' });
        }

        currentUser = await loadSupabaseAuthProfile(authData.user);
        window.currentUser = currentUser;
        resetLoginAttempts();
        localStorage.setItem('sp_user', JSON.stringify(currentUser));
        touchSession();
        updateUserUI();
        await fetchUserWallet();
        await runSecurityAudit(false);
        showCustomModal({ title: 'ยินดีต้อนรับ', message: `เข้าสู่ระบบสำเร็จ: ${currentUser.full_name || 'สมาชิก'}`, icon: 'shield-check' });
        switchView('dashboard');
      } catch (err) {
        console.error('Supabase Auth sign-in failed:', err);
        showCustomModal({ title: 'เข้าสู่ระบบไม่สำเร็จ', message: friendlySupabaseAuthError(err, 'login'), icon: 'alert-triangle' });
      } finally {
        pdAuthActionInFlight = false;
        setAuthFormBusy('form-login', false);
      }
    }

    async function handleRegister(e) {
      e.preventDefault();
      if (!isPasswordValid) return showCustomModal({ title: 'รหัสผ่านไม่ผ่านเงื่อนไข', message: 'กรุณาตั้งรหัสผ่านให้ตรงตามเงื่อนไขความปลอดภัย', icon: 'shield-alert' });
      if (!supabaseClient) return showCustomModal({ title: 'ระบบยังไม่พร้อม', message: 'กรุณาตรวจ URL และ Publishable/anon key ของ Supabase ก่อนสมัครสมาชิก', icon: 'database-zap' });

      const name = document.getElementById('reg-fullname').value.trim();
      const email = document.getElementById('reg-email').value.trim().toLowerCase();
      const password = document.getElementById('reg-password').value;
      if (name.length < 2 || name.length > 80) return showCustomModal({ title: 'ตรวจสอบชื่อ', message: 'ชื่อ-นามสกุลต้องมีความยาว 2-80 ตัวอักษร', icon: 'alert-triangle' });
      if (!email) return showCustomModal({ title: 'ตรวจสอบอีเมล', message: 'กรุณากรอกอีเมลให้ถูกต้อง', icon: 'alert-triangle' });

      const avatarFile = document.getElementById('reg-avatar-file')?.files?.[0] || null;
      const croppedRegistrationAvatar = String(window.pdRegistrationAvatarDataUrl || '');
      if (avatarFile && !isAllowedImage(avatarFile)) return showCustomModal({ title: 'รูปโปรไฟล์ไม่รองรับ', message: 'รองรับ PNG, JPG หรือ WEBP เท่านั้น', icon: 'image-off' });
      if (avatarFile && avatarFile.size > MAX_AVATAR_FILE_MB * 1024 * 1024) return showCustomModal({ title: 'รูปโปรไฟล์ใหญ่เกินไป', message: `ขนาดสูงสุด ${MAX_AVATAR_FILE_MB} MB`, icon: 'image-off' });
      if (avatarFile && !croppedRegistrationAvatar) return showCustomModal({ title: 'กรุณาครอปรูปก่อน', message: 'เลือกรูปแล้วจัดตำแหน่งในหน้าครอปให้เรียบร้อยก่อนสมัครสมาชิก', icon: 'image' });
      if (pdAuthActionInFlight) return;
      pdAuthActionInFlight = true;
      setAuthFormBusy('form-register', true, 'กำลังสร้างบัญชี...');

      try {
        // Password is sent only to Supabase Auth. Never write password_hash to public.users.
        const { data: signUpData, error: signUpError } = await supabaseClient.auth.signUp({
          email,
          password,
          options: {
            data: { full_name: name },
            emailRedirectTo: `${window.location.origin}/`
          }
        });
        if (signUpError) throw signUpError;

        const authUser = signUpData?.user;
        const session = signUpData?.session;
        if (!authUser) throw new Error('Supabase Auth ยังไม่ส่งข้อมูลผู้ใช้กลับมา กรุณาตรวจ Auth Logs');

        if (!session) {
          showCustomModal({
            title: 'ส่งคำขอสมัครสมาชิกแล้ว',
            message: 'หากอีเมลนี้สมัครได้ ระบบจะส่งอีเมลยืนยันให้ กรุณายืนยันอีเมลก่อนเข้าสู่ระบบ หากเปิด Email Confirmations ไว้ บัญชีจะยังไม่เข้าสู่ระบบอัตโนมัติ',
            icon: 'mail-check'
          });
          switchAuthTab(true);
          return;
        }

        // The database trigger creates public.users and wallets on auth.users insert.
        currentUser = await loadSupabaseAuthProfile(authUser);
        if (avatarFile) {
          // Save the normalized square crop produced by Profile Studio, never the original uncropped upload.
          const avatarUrl = croppedRegistrationAvatar;
          const { data: updated, error: avatarError } = await supabaseClient
            .from('users')
            .update({ avatar_url: avatarUrl })
            .eq('id', authUser.id)
            .select('id,full_name,email,role,avatar_url')
            .maybeSingle();
          if (avatarError) console.warn('Profile photo save skipped; use profile settings after sign-in:', avatarError.message);
          else if (updated) currentUser = sanitizeUserRecord(updated);
        }

        window.currentUser = currentUser;
        localStorage.setItem('sp_user', JSON.stringify(currentUser));
        window.pdRegistrationAvatarDataUrl = '';
        const registeredAvatarInput = document.getElementById('reg-avatar-file');
        if (registeredAvatarInput) registeredAvatarInput.value = '';
        const registeredAvatarStatus = document.getElementById('reg-avatar-crop-status');
        if (registeredAvatarStatus) registeredAvatarStatus.textContent = 'เลือกรูปเพื่อจัดกรอบก่อนสมัคร (ไม่บังคับ)';
        touchSession();
        updateUserUI();
        await fetchUserWallet();
        await runSecurityAudit(false);
        showCustomModal({ title: 'สมัครสมาชิกสำเร็จ', message: `สร้างบัญชีผ่าน Supabase Auth แล้ว: ${currentUser.full_name || name}`, icon: 'shield-check' });
        switchView('dashboard');
      } catch (err) {
        console.error('Supabase Auth sign-up failed:', err);
        showCustomModal({ title: 'ลงทะเบียนไม่สำเร็จ', message: friendlySupabaseAuthError(err, 'register'), icon: 'alert-triangle' });
      } finally {
        pdAuthActionInFlight = false;
        setAuthFormBusy('form-register', false);
      }
    }

    async function handleLogout() {
      try {
        if (supabaseClient?.auth) {
          const { error } = await supabaseClient.auth.signOut();
          if (error) console.warn('Supabase sign-out warning:', error.message);
        }
      } catch (err) {
        console.warn('Supabase sign-out failed:', err);
      }
      currentUser = null;
      window.currentUser = null;
      localStorage.removeItem('sp_user');
      localStorage.removeItem('sp_session_at');
      resetLoginAttempts();
      updateUserUI();
      switchView('landing');
      showCustomModal({
          title: 'ออกจากระบบสำเร็จ',
          message: 'ขอบคุณที่ใช้บริการ PrintDekD แล้วพบกันใหม่',
          icon: 'log-out'
        });
    }

    function handleFileSelect(e) {
      const file = e.target.files[0];
      if (!file) return;
      const check = validateUploadFile(file, { maxMB: MAX_PRINT_FILE_MB, extensions: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'], mimeTypes: ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'image/jpeg', 'image/png'] });
      if (!check.ok) {
        e.target.value = '';
        return showCustomModal({ title: 'ไฟล์ไม่ผ่านการตรวจสอบ', message: check.message, icon: 'file-warning' });
      }

      selectedFileObj = file;
      window.selectedFileObj = selectedFileObj;
      document.getElementById('upload-placeholder').classList.add('hidden');
      document.getElementById('file-details').classList.remove('hidden');
      document.getElementById('preview-file-drawer-btn').classList.remove('hidden');
      document.getElementById('file-info-name').innerText = file.name;
      document.getElementById('preview-modal-filename').innerText = file.name;
      document.getElementById('preview-modal-filesize').innerText = `ขนาดไฟล์: ${(file.size / (1024 * 1024)).toFixed(2)} MB`;

      if (window.pdfjsLib && (file.type === 'application/pdf' || /\.pdf$/i.test(file.name || ''))) {
        const fileReader = new FileReader();
        fileReader.onload = function () {
          const typedarray = new Uint8Array(this.result);
          pdfjsLib.getDocument({ data: typedarray, isEvalSupported: false }).promise.then(function (pdf) {
            detectedPageCount = pdf.numPages;
            document.getElementById('total-pages-display').innerText = `${detectedPageCount} หน้า`;
            document.getElementById('selected-pages-count-display').innerText = `${detectedPageCount} หน้า`;
            document.getElementById('printed-pages-input').value = detectedPageCount;
            document.getElementById('preview-modal-pages').innerText = `${detectedPageCount} หน้า`;
            renderPdfThumbnails(pdf);
            calculatePrice();
          }).catch(err => {
            detectedPageCount = 1;
            calculatePrice();
            window.__pdV15ShowPdfFailure?.(err);
            showCustomModal({ title: 'เปิด PDF ไม่สำเร็จ', message: 'ตรวจสอบไฟล์อีกครั้ง ไฟล์อาจเสียหาย เข้ารหัสไว้ หรือ PDF worker ถูกบล็อก', icon: 'file-warning' });
            console.warn('PDF parse error:', err);
          });
        };
        fileReader.onerror = () => {
          window.__pdV15ShowPdfFailure?.(new Error('อ่านไฟล์ไม่สำเร็จ'));
          showCustomModal({ title: 'อ่านไฟล์ไม่สำเร็จ', message: 'เบราว์เซอร์ไม่สามารถอ่านไฟล์นี้ได้', icon: 'file-warning' });
        };
        fileReader.readAsArrayBuffer(file);
      } else {
        detectedPageCount = 1;
        document.getElementById('total-pages-display').innerText = '1 หน้า';
        document.getElementById('selected-pages-count-display').innerText = '1 หน้า';
        document.getElementById('printed-pages-input').value = 1;
        document.getElementById('preview-modal-pages').innerText = '1 หน้า';
        calculatePrice();
      }
    }

    function renderPdfThumbnails(pdf) {
      const grid = document.getElementById('pages-grid-container');
      const drawer = document.getElementById('pdf-preview-wrapper');
      if (!grid) return;
      grid.className = 'pd-v10-page-picker ui-input';
      grid.innerHTML = '';
      if (drawer) drawer.innerHTML = '';

      for (let i = 1; i <= pdf.numPages; i++) {
        const card = document.createElement('label');
        card.className = 'pd-v10-page-card is-selected';
        card.dataset.page = String(i);
        card.innerHTML = `<input type="checkbox" checked value="${i}" class="sr-only"><span class="pd-page-check">✓</span><span class="pd-page-number">หน้า ${i}</span>`;
        const cb = card.querySelector('input');
        cb.addEventListener('change', () => {
          card.classList.toggle('is-selected', cb.checked);
          updateGridSelectedCount();
        });
        card.addEventListener('click', e => {
          if (e.target === cb) return;
          cb.checked = !cb.checked;
          cb.dispatchEvent(new Event('change', { bubbles: true }));
        });
        grid.appendChild(card);

        pdf.getPage(i).then(page => {
          const viewport = page.getViewport({ scale: 0.65 });
          const canvas = document.createElement('canvas');
          const ctx = canvas.getContext('2d', { alpha: false });
          canvas.width = Math.ceil(viewport.width);
          canvas.height = Math.ceil(viewport.height);
          canvas.setAttribute('aria-label', `ตัวอย่างหน้า ${i}`);
          canvas.className = 'rounded-xl';
          card.insertBefore(canvas, card.querySelector('.pd-page-number'));
          return page.render({ canvasContext: ctx, viewport }).promise;
        }).catch(() => { });
      }
      const selected = document.getElementById('selected-pages-count-display');
      const printed = document.getElementById('printed-pages-input');
      if (selected) selected.textContent = `${pdf.numPages} หน้า`;
      if (printed) printed.value = pdf.numPages;
      calculatePrice();
    }

    function updateGridSelectedCount() {
      const checked = [...document.querySelectorAll('#pages-grid-container input[type="checkbox"]')].filter(cb => cb.checked);
      document.querySelectorAll('#pages-grid-container .pd-v10-page-card').forEach(card => {
        const cb = card.querySelector('input[type="checkbox"]');
        card.classList.toggle('is-selected', !!cb?.checked);
      });
      const count = checked.length;
      document.getElementById('selected-pages-count-display').innerText = `${count} หน้า`;
      document.getElementById('printed-pages-input').value = count || 1;
      calculatePrice();
    }

    function selectAllPages(selectAll) {
      document.querySelectorAll('#pages-grid-container input[type="checkbox"]').forEach(cb => cb.checked = !!selectAll);
      updateGridSelectedCount();
    }

    function togglePageSelectionMode() {
      const mode = document.querySelector('input[name="page_selection_mode"]:checked').value;
      document.getElementById('page-mode-text-box').classList.toggle('hidden', mode !== 'text');
      document.getElementById('page-mode-grid-box').classList.toggle('hidden', mode !== 'grid');
    }

    function toggleDeliveryFields() {
      const isDelivery = document.querySelector('input[name="delivery_method"]:checked')?.value === 'delivery';
      const addressBox = document.getElementById('delivery-address-box');
      if (addressBox) addressBox.classList.toggle('hidden', !isDelivery);
      calculatePrice();
    }

    function calculatePrice() {
      const pages = Math.max(1, parseInt(document.getElementById('printed-pages-input').value) || 1);
      const copies = Math.max(1, parseInt(document.getElementById('copies').value) || 1);
      const isColor = document.getElementById('color-type').value === 'color';
      const isDuplex = document.getElementById('duplex-type').value === 'duplex';
      const isDelivery = document.querySelector('input[name="delivery_method"]:checked')?.value === 'delivery';

      let pageRate = isColor ? 5.0 : 1.0;
      if (isDuplex) pageRate += 0.5;

      const printCost = pages * pageRate * copies;
      const deliveryFee = isDelivery ? 30.0 : 0.0;
      const total = printCost + deliveryFee;

      document.getElementById('total-price').innerText = `${total.toFixed(2)} ฿`;
      document.getElementById('price-breakdown').innerText = isDelivery
        ? `(ค่าพิมพ์ ${printCost.toFixed(2)} ฿ + ค่าจัดส่ง 30.00 ฿)`
        : `(${pages} หน้า x ${pageRate.toFixed(2)} ฿ x ${copies} ชุด | รับหน้าร้านฟรี)`;
      return total;
    }

    function togglePaymentFields() {
      const method = document.querySelector('input[name="payment_method"]:checked').value;
      document.getElementById('promptpay-box').classList.toggle('hidden', method !== 'promptpay');
    }

    async function uploadPrintFile(file, orderId) {
      if (!supabaseClient) throw new Error('ฐานข้อมูลยังไม่พร้อมสำหรับการอัปโหลดไฟล์');
      if (!file) throw new Error('ไม่พบไฟล์เอกสาร');
      const primary = localStorage.getItem('sp_print_bucket') || 'documents';
      const candidates = [primary];
      if (primary === 'documents') candidates.push('print-files');
      else if (primary === 'print-files') candidates.push('documents');

      const safeName = String(file.name || 'document').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'document';
      const errors = [];
      for (const bucket of candidates) {
        const path = `${currentUser.id}/${orderId}-${Date.now()}-${safeName}`;
        try {
          const { error } = await supabaseClient.storage.from(bucket).upload(path, file, {
            upsert: false,
            contentType: file.type || 'application/octet-stream',
            cacheControl: '3600'
          });
          if (!error) {
            localStorage.setItem('sp_print_bucket', bucket);
            return { path, bucket, size: file.size, mime_type: file.type || 'application/octet-stream' };
          }
          errors.push(`${bucket}: ${error.message || 'upload failed'}`);
          if (!/bucket.*not found|not found/i.test(error.message || '')) break;
        } catch (err) {
          errors.push(`${bucket}: ${err.message || err}`);
        }
      }
      throw new Error(`อัปโหลดไม่สำเร็จ\n${errors.join('\\n')}\n\nตรวจสอบ Storage > Buckets และ Storage Policies สำหรับการ INSERT ใน bucket ที่เลือก`);
    }

    async function openStoredPrintFile(filePath) {
      if (!assertAdminAccess() && !currentUser) return;
      if (!filePath) return showCustomModal({ title: 'ยังไม่มีไฟล์ออนไลน์', message: 'รายการนี้ไม่มีตำแหน่งไฟล์ที่เก็บใน Storage', icon: 'file-warning' });
      try {
        const { data, error } = await supabaseClient.storage.from(PRINT_STORAGE_BUCKET).createSignedUrl(filePath, 900);
        if (error || !data?.signedUrl) throw error || new Error('สร้างลิงก์ไฟล์ชั่วคราวไม่สำเร็จ');
        window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
      } catch (err) {
        showCustomModal({ title: 'เปิดไฟล์ไม่สำเร็จ', message: err.message || 'ตรวจสอบ Storage Policy ของ Supabase', icon: 'file-warning' });
      }
    }

    async function handleOrderSubmit(e) {
      e.preventDefault();
      if (!currentUser) return showCustomModal({ title: 'กรุณาล็อกอิน', message: 'กรุณาล็อกอินก่อนทำการสั่งพิมพ์', icon: 'lock' });
      if (!supabaseClient) return showCustomModal({ title: 'ฐานข้อมูลยังไม่พร้อม', message: 'ระบบจะหยุดรายการสำคัญไว้ก่อนจนกว่าจะเชื่อมต่อ Supabase สำเร็จ', icon: 'database-zap' });
      touchSession();

      const pages = Math.max(1, parseInt(document.getElementById('printed-pages-input').value) || 1);
      const copies = Math.max(1, parseInt(document.getElementById('copies').value) || 1);
      const paper = document.getElementById('paper-size').value;
      const isColor = document.getElementById('color-type').value === 'color';
      const isDuplex = document.getElementById('duplex-type').value === 'duplex';
      const notes = document.getElementById('order-notes').value.trim();
      const payMethod = document.querySelector('input[name="payment_method"]:checked')?.value;
      const deliveryMethod = document.querySelector('input[name="delivery_method"]:checked')?.value;
      if (!payMethod || !deliveryMethod) return showCustomModal({ title: 'ตรวจสอบตัวเลือก', message: 'กรุณาเลือกการชำระเงินและการรับสินค้า', icon: 'alert-triangle' });

      if (!selectedFileObj) return showCustomModal({ title: 'ยังไม่ได้เลือกไฟล์', message: 'กรุณาอัปโหลดไฟล์เอกสารก่อนสร้างคิวพิมพ์', icon: 'file-plus-2' });
      const fileCheck = validateUploadFile(selectedFileObj, { maxMB: MAX_PRINT_FILE_MB, extensions: ['pdf', 'doc', 'docx', 'jpg', 'jpeg', 'png'] });
      if (!fileCheck.ok) return showCustomModal({ title: 'ไฟล์ไม่ผ่านการตรวจสอบ', message: fileCheck.message, icon: 'file-warning' });

      let recipientName = '', recipientPhone = '', recipientAddress = '';
      if (deliveryMethod === 'delivery') {
        recipientName = document.getElementById('recipient-name').value.trim();
        recipientPhone = document.getElementById('recipient-phone').value.trim();
        recipientAddress = document.getElementById('recipient-address').value.trim();
        if (!recipientName || !/^0[0-9\-\s]{8,14}$/.test(recipientPhone) || !recipientAddress) {
          return showCustomModal({ title: 'ตรวจสอบข้อมูลจัดส่ง', message: 'กรุณากรอกชื่อ เบอร์โทรศัพท์ และที่อยู่ให้ครบถ้วน และใช้หมายเลขโทรศัพท์ที่ถูกต้อง', icon: 'map-pin-x' });
        }
      }

      let pageRate = isColor ? 5.0 : 1.0;
      if (isDuplex) pageRate += 0.5;
      const printCost = pages * pageRate * copies;
      const deliveryFee = deliveryMethod === 'delivery' ? 30.0 : 0.0;
      const totalPrice = printCost + deliveryFee;

      if (payMethod === 'coins') {
        try { await fetchUserWallet(); } catch (walletErr) {
          return showCustomModal({ title: 'ตรวจสอบ Coins ไม่สำเร็จ', message: 'ระบบยังยืนยันยอด Coins ล่าสุดจากฐานข้อมูลไม่ได้ จึงยังไม่หักเงินหรือสร้างรายการ', icon: 'shield-alert' });
        }
        const freshCoins = parseFloat(currentUser.coins || 0);
        if (freshCoins < totalPrice) return showCustomModal({ title: 'Coins ไม่พอ', message: `ยอด Coins ปัจจุบัน ${freshCoins.toFixed(2)} ไม่เพียงพอสำหรับ ${totalPrice.toFixed(2)} Coins`, icon: 'coins' });
      }

      let slipUrl = '';
      if (payMethod === 'promptpay') {
        const slipFile = document.getElementById('order-slip-file').files[0];
        if (!isAllowedImage(slipFile) || slipFile.size > MAX_SLIP_FILE_MB * 1024 * 1024) return showCustomModal({ title: 'สลิปไม่ผ่านการตรวจสอบ', message: `รองรับ PNG/JPG/WEBP และขนาดไม่เกิน ${MAX_SLIP_FILE_MB} MB`, icon: 'image-off' });
        slipUrl = await readFileAsDataURL(slipFile);
      }

      const orderId = 'ORD-' + Math.floor(100000 + Math.random() * 900000);
      let uploadedPrintFile = null;
      try {
        uploadedPrintFile = await uploadPrintFile(selectedFileObj, orderId);
      } catch (uploadError) {
        return showCustomModal({ title: 'อัปโหลดเอกสารไม่สำเร็จ', message: `${uploadError.message || 'ไม่สามารถเก็บไฟล์บนระบบออนไลน์ได้'} กรุณาตรวจสอบ Storage bucket "${PRINT_STORAGE_BUCKET}" และ Policy ของ Supabase`, icon: 'cloud-off' });
      }

      const orderObj = {
        id: orderId, user_id: currentUser.id, user_name: currentUser.full_name,
        file_name: selectedFileObj.name, file_path: uploadedPrintFile.path, file_bucket: uploadedPrintFile.bucket, file_size: uploadedPrintFile.size, file_mime: uploadedPrintFile.mime_type,
        page_count: pages, copies, paper_size: paper, is_color: isColor, is_duplex: isDuplex,
        delivery_method: deliveryMethod, recipient_name: recipientName, recipient_phone: recipientPhone, recipient_address: recipientAddress,
        delivery_fee: deliveryFee, total_price: totalPrice, payment_method: payMethod, slip_url: slipUrl, admin_note: notes,
        status: 'pending', created_at: new Date().toISOString()
      };

      let orderCreated = false;
      try {
        const { error: orderError } = await supabaseClient.from('orders').insert([orderObj]);
        if (orderError) throw orderError;
        orderCreated = true;

        if (payMethod === 'coins') {
          const beforeCoins = parseFloat(currentUser.coins || 0);
          const afterCoins = Number((beforeCoins - totalPrice).toFixed(2));
          let coinUpdate;
          try {
            coinUpdate = await compareAndSwapWalletBalance(currentUser.id, beforeCoins, afterCoins);
          } catch (coinError) {
            if (orderCreated) {
              await supabaseClient.from('orders').delete().eq('id', orderObj.id).eq('user_id', currentUser.id);
            }
            throw coinError;
          }
          currentUser.coins = Number(coinUpdate.balance || 0);
        }

        localStorage.setItem('sp_user', JSON.stringify(currentUser));
        touchSession();
        updateUserUI();
        const successMsg = deliveryMethod === 'delivery'
          ? 'คิวงานพิมพ์ถูกบันทึกแล้ว ระบบจะแจ้ง Tracking เมื่อแอดมินอัปเดต'
          : 'คิวงานพิมพ์ถูกบันทึกแล้ว รอการยืนยันสถานะจากระบบ';
        showCustomModal({ title: 'สร้างคำขอพิมพ์สำเร็จ', message: successMsg, icon: 'shield-check' });
        document.getElementById('print-form').reset();
        selectedFileObj = null;
        window.selectedFileObj = selectedFileObj;
        document.getElementById('upload-placeholder').classList.remove('hidden');
        document.getElementById('file-details').classList.add('hidden');
        document.getElementById('preview-file-drawer-btn').classList.add('hidden');
        document.getElementById('pdf-preview-wrapper').innerHTML = '<p class="text-xs sub-text py-12">อัปโหลดไฟล์ PDF เพื่อแสดงพรีวิวหน้า...</p>';
        document.getElementById('pages-grid-container').innerHTML = '<p class="col-span-full text-center text-xs sub-text py-2">กรุณาอัปโหลดไฟล์ PDF เพื่อเลือกหน้า</p>';
        toggleDeliveryFields();
        fetchQueues();
        await fetchUserWallet();
      } catch (err) {
        try { if (uploadedPrintFile?.path && !orderCreated) await supabaseClient.storage.from(PRINT_STORAGE_BUCKET).remove([uploadedPrintFile.path]); } catch (_) { }
        showCustomModal({ title: 'สร้างรายการไม่สำเร็จ', message: err.message || 'ไม่สามารถบันทึกข้อมูลได้ ระบบยังไม่ถือว่ารายการสำเร็จ', icon: 'shield-alert' });
      }
    }

    async function fetchQueues() {
      const container = document.getElementById('queue-cards-container');
      if (!container) return;

      try {
        if (!supabaseClient || !currentUser?.id) {
          currentOrdersList = [];
          container.innerHTML = '<div class="p-8 rounded-2xl ui-card text-center space-y-3"><i data-lucide="database-zap" class="w-10 h-10 text-amber-500 mx-auto"></i><p class="text-sm font-bold titanium-text">ยังไม่พร้อมโหลดคิวงาน</p><p class="text-xs sub-text">กรุณาเข้าสู่ระบบและตรวจสอบการเชื่อมต่อฐานข้อมูล</p></div>';
          if (typeof lucide !== 'undefined') lucide.createIcons();
          return;
        }
        const { data, error } = await supabaseClient.from('orders').select('*').eq('user_id', currentUser.id).order('created_at', { ascending: false });
        if (error) throw error;
        currentOrdersList = data || [];
        renderQueueCards(currentOrdersList);
      } catch (err) {
        container.innerHTML = '<p class="py-8 text-center text-rose-500 text-xs">ไม่สามารถโหลดข้อมูลคิวงานได้</p>';
      }
    }

    function renderQueueCards(orders) {
      const container = document.getElementById('queue-cards-container');
      if (!orders || orders.length === 0) {
        container.innerHTML = `
          <div class="p-8 rounded-2xl ui-card text-center space-y-3">
            <i data-lucide="inbox" class="w-10 h-10 sub-text mx-auto"></i>
            <p class="text-sm font-bold titanium-text">ยังไม่มีคิวงานพิมพ์ในขณะนี้</p>
            <p class="text-xs sub-text">สร้างรายการใหม่ที่แบบฟอร์มด้านซ้ายมือได้ทันที</p>
          </div>`;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
      }

      container.innerHTML = orders.map(ord => {
        let statusTag = '<span class="px-3 py-1 rounded-full text-xs font-bold bg-amber-500/20 text-amber-500 border border-amber-500/30">⏳ รอดำเนินการ</span>';
        if (ord.status === 'completed') statusTag = '<span class="px-3 py-1 rounded-full text-xs font-bold bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">✅ พิมพ์เสร็จแล้ว</span>';
        else if (ord.status === 'printing') statusTag = '<span class="px-3 py-1 rounded-full text-xs font-bold bg-blue-500/20 text-blue-600 dark:text-blue-400 border border-blue-500/30">🖨️ กำลังพิมพ์</span>';
        else if (ord.status === 'cancelled') statusTag = '<span class="px-3 py-1 rounded-full text-xs font-bold bg-rose-500/20 text-rose-600 dark:text-rose-400 border border-rose-500/30">❌ ยกเลิก</span>';

        const isDelivery = ord.delivery_method === 'delivery';

        return `
          <div class="p-4 rounded-xl ui-card border space-y-2.5 hover:border-blue-500 transition cursor-pointer" role="button" tabindex="0" data-pd-order-detail="${escapeHtml(ord.id)}" aria-label="เปิดรายละเอียดคิวงานพิมพ์">
            <div class="flex items-center justify-between">
              <span class="text-xs font-bold font-mono text-blue-500">#${ord.id}</span>
              ${statusTag}
            </div>
            <div class="flex items-center justify-between">
              <div>
                <p class="text-sm font-bold titanium-text truncate max-w-[200px]">${escapeHtml(ord.file_name)}</p>
                <p class="text-[11px] sub-text">${ord.page_count} หน้า | ${ord.copies} ชุด | ${isDelivery ? '🚚 จัดส่งพัสดุ' : '📍 รับหน้าร้าน'}</p>
              </div>
              <span class="text-lg font-black blue-gradient-text">${parseFloat(ord.total_price).toFixed(2)} ฿</span>
            </div>
            ${ord.tracking_number ? `<div class="p-2 bg-emerald-500/10 rounded-lg border border-emerald-500/30 text-xs font-bold text-emerald-600 dark:text-emerald-400">🚚 Tracking: ${escapeHtml(ord.tracking_number)} (${escapeHtml(ord.courier_name || 'Kerry')})</div>` : ''}
          </div>`;
      }).join('');
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }

    function selectTopupAmount(amt) {
      document.getElementById('selected-topup-amount').value = amt;
      document.getElementById('topup-qr-amount').innerText = parseFloat(amt).toFixed(2);

      document.querySelectorAll('.topup-pkg-btn').forEach(btn => {
        if (btn.innerText.includes(`${amt} บาท`)) {
          btn.className = 'topup-pkg-btn p-4 border-2 border-amber-500 bg-amber-500/20 text-amber-400 font-black rounded-2xl text-center transition shadow-lg scale-105 active:scale-95';
        } else {
          btn.className = 'topup-pkg-btn p-4 ui-input border hover:border-amber-500 rounded-2xl font-bold text-center transition hover:scale-105 active:scale-95';
        }
      });
    }

    // Legacy top-up submission path disabled: it only checked MIME/size and could
    // enqueue a non-slip image without calling SlipOK. The active verified handler
    // is registered later as window.handleTopupSubmit by pd-v12-db-runtime.
    async function handleTopupSubmit(e) {
      e?.preventDefault();
      return showCustomModal({ title: 'ระบบตรวจสลิปยังไม่พร้อม', message: 'คำขอยังไม่ได้ถูกบันทึก กรุณารีเฟรชหน้าเว็บแล้วลองใหม่อีกครั้ง', icon: 'shield-alert' });
    }

    async function fetchUserTopups() {
      const list = document.getElementById('topup-history-list');
      if (!list) return;
      if (!currentUser || !supabaseClient) { list.innerHTML = '<p class="text-center py-8 sub-text text-xs">กรุณาเข้าสู่ระบบและเชื่อมต่อฐานข้อมูล</p>'; return; }
      try {
        const { data: topups, error } = await supabaseClient.from('topups').select('id,user_id,amount,status,created_at').eq('user_id', currentUser.id).order('created_at', { ascending: false });
        if (error) throw error;
        if (!topups?.length) { list.innerHTML = '<p class="text-center py-8 sub-text text-xs">ยังไม่มีประวัติการเติม Coins</p>'; return; }
        list.innerHTML = topups.map(tp => `<div class="p-4 rounded-2xl ui-card border flex items-center justify-between gap-3 text-xs shadow-sm"><div><p class="font-black text-amber-500 text-sm">+${Number(tp.amount || 0).toFixed(2)} Coins</p><p class="text-[10px] sub-text font-mono mt-0.5">${escapeHtml(new Date(tp.created_at).toLocaleString('th-TH'))}</p></div><span class="security-badge ${tp.status === 'approved' ? 'good' : tp.status === 'rejected' ? 'bad' : 'warn'}">${tp.status === 'approved' ? 'อนุมัติแล้ว' : tp.status === 'rejected' ? 'ปฏิเสธ' : 'รอตรวจสอบ'}</span></div>`).join('');
      } catch (e) { list.innerHTML = '<p class="text-center py-8 text-rose-500 text-xs">ไม่สามารถโหลดประวัติได้ · กรุณาตรวจสอบฐานข้อมูล</p>'; }
    }

    /* ==========================================================
       WALLET SOURCE OF TRUTH
       users      -> identity/profile
       wallets    -> balance
       currentUser.coins stays as a UI/cache field only.
       ========================================================== */

    async function ensureUserWallet(userId) {
      if (!supabaseClient || !userId) throw new Error('ไม่สามารถสร้างกระเป๋าในโหมดออฟไลน์ได้');

      const { data: existing, error: readError } = await supabaseClient
        .from('wallets')
        .select('id,user_id,balance,updated_at')
        .eq('user_id', userId)
        .maybeSingle();

      if (readError) throw readError;
      if (existing) return existing;

      const { data: created, error: createError } = await supabaseClient
        .from('wallets')
        .insert([{ user_id: userId, balance: 0 }])
        .select('id,user_id,balance,updated_at')
        .maybeSingle();

      if (createError) {
        // Recover from a concurrent create when the wallet row appeared just after the read.
        const { data: raced, error: racedError } = await supabaseClient
          .from('wallets')
          .select('id,user_id,balance,updated_at')
          .eq('user_id', userId)
          .maybeSingle();
        if (racedError || !raced) throw createError || racedError || new Error('สร้างกระเป๋า Coins ไม่สำเร็จ');
        return raced;
      }
      return created;
    }

    async function fetchUserWallet() {
      if (!currentUser || !currentUser.id) return 0;
      if (!supabaseClient) throw new Error('Supabase ยังไม่พร้อม');

      let { data, error } = await supabaseClient
        .from('wallets')
        .select('id,user_id,balance,updated_at')
        .eq('user_id', currentUser.id)
        .maybeSingle();

      if (error) throw error;
      if (!data) data = await ensureUserWallet(currentUser.id);

      const balance = Number(data?.balance || 0);
      if (!Number.isFinite(balance) || balance < 0) {
        throw new Error('ตรวจสอบข้อมูล: wallets.balance ไม่ถูกต้อง');
      }

      currentUser.coins = Number(balance.toFixed(2));
      const amount = currentUser.coins.toFixed(2);

      const coinEls = [
        document.getElementById('user-coins-amount'),
        document.getElementById('prof-coins-amount'),
        document.getElementById('menu-coins')
      ];
      if (coinEls[0]) coinEls[0].innerText = `${amount} Coins`;
      if (coinEls[1]) coinEls[1].innerText = `${amount} Coins`;
      if (coinEls[2]) coinEls[2].innerText = amount;

      localStorage.setItem('sp_user', JSON.stringify(currentUser));
      touchSession();
      return currentUser.coins;
    }

    async function compareAndSwapWalletBalance(userId, expectedBalance, nextBalance) {
      if (!supabaseClient || !userId) throw new Error('ฐานข้อมูลยังไม่พร้อม');

      const before = Number(expectedBalance);
      const after = Number(nextBalance);
      if (!Number.isFinite(before) || !Number.isFinite(after) || before < 0 || after < 0) {
        throw new Error('ตรวจสอบข้อมูล: ยอด Coins ไม่ถูกต้อง');
      }

      const { data, error } = await supabaseClient
        .from('wallets')
        .update({
          balance: Number(after.toFixed(2)),
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId)
        .eq('balance', Number(before.toFixed(2)))
        .select('id,user_id,balance,updated_at')
        .maybeSingle();

      if (error) throw error;
      if (!data) throw new Error('ยอด Coins ถูกเปลี่ยนระหว่างการทำรายการ กรุณาตรวจสอบยอดแล้วลองใหม่');
      return data;
    }


    function readFileAsDataURL(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    async function loadAdminData() {
      if (!assertAdminAccess()) return;
      try {
        const { data: orders, error: ordersError } = await supabaseClient.from('orders').select('*').order('created_at', { ascending: false });
        if (ordersError) throw ordersError;
        const ordersTb = document.getElementById('admin-orders-tbody');
        if (ordersTb) {
          ordersTb.innerHTML = (orders || []).map(ord => `
            <tr class="hover:bg-slate-200/50 dark:hover:bg-white/5 transition">
              <td class="py-3 px-3 font-mono text-blue-500 font-bold">#${escapeHtml(ord.id)}</td>
              <td class="py-3 px-3"><p class="font-bold titanium-text truncate max-w-[150px]">${escapeHtml(ord.file_name)}</p><p class="sub-text text-[10px]">${Number(ord.total_price || 0).toFixed(2)} ฿ (${Number(ord.page_count || 0)} หน้า)</p>${ord.file_path ? `<button type="button" data-pd-admin-action="open-file" data-file-path="${escapeHtml(ord.file_path)}" data-file-bucket="documents" class="mt-1 text-xs font-black text-blue-500 hover:underline inline-flex items-center gap-1"><i data-lucide="external-link" class="w-3 h-3"></i> เปิดไฟล์</button>` : '<span class="text-[10px] sub-text">ไม่มีไฟล์ Storage</span>'}</td>
              <td class="py-3 px-3">${ord.delivery_method === 'delivery' ? `<p class="text-blue-500 font-bold">🚚 จัดส่งพัสดุ</p><p class="sub-text text-[10px] truncate max-w-[120px]">${escapeHtml(ord.recipient_name || '')} (${escapeHtml(ord.recipient_phone || '')})</p>` : `<p class="text-emerald-500 font-bold">📍 หน้าร้าน</p>`}</td>
              <td class="py-3 px-3">${ord.slip_url ? `<button type="button" data-pd-admin-action="slip" data-slip-url="${safe(ord.slip_url)}" class="text-blue-500 underline font-bold">ดูสลิป</button>` : '<span class="sub-text">Coins</span>'}</td>
              <td class="py-3 px-3">
                <select data-pd-admin-action="status" data-order-id="${escapeHtml(ord.id)}" aria-label="เปลี่ยนสถานะงานพิมพ์" class="ui-input rounded-xl p-2 text-sm font-bold">
                  <option value="queued" ${ord.status === 'queued' || ord.status === 'pending' ? 'selected' : ''}>⏳ รอคิว</option>
                  <option value="printing" ${ord.status === 'printing' ? 'selected' : ''}>🖨️ กำลังพิมพ์</option>
                  <option value="completed" ${ord.status === 'completed' ? 'selected' : ''}>✅ พิมพ์เสร็จแล้ว</option>
                  <option value="cancelled" ${ord.status === 'cancelled' ? 'selected' : ''}>❌ ยกเลิก</option>
                </select>
              </td>
              <td class="py-3 px-3 text-right space-x-1">
                ${ord.delivery_method === 'delivery' ? `<button type="button" data-pd-admin-action="tracking" data-order-id="${safe(ord.id)}" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-bold">Tracking</button>` : ''}
                <button type="button" data-pd-admin-action="detail" data-order-id="${escapeHtml(ord.id)}" class="px-3 py-2 ui-card rounded-xl text-sm font-bold">ดูข้อมูล</button><button type="button" data-pd-admin-action="delete-order" data-order-id="${escapeHtml(ord.id)}" class="px-3 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white text-sm font-extrabold transition">⌫ ลบงาน</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="py-10 text-center sub-text">ยังไม่มีรายการ</td></tr>';
        }

        const { data: topups, error: topupsError } = await supabaseClient.from('topups').select('*').order('created_at', { ascending: false });
        if (topupsError) throw topupsError;
        const topupsTb = document.getElementById('admin-topups-tbody');
        if (topupsTb) {
          topupsTb.innerHTML = (topups || []).map(tp => `
            <tr data-pd-topup-row-id="${escapeHtml(tp.id)}" class="hover:bg-slate-200/50 dark:hover:bg-white/5 transition">
              <td class="py-3 px-3 sub-text text-[10px]">${escapeHtml(new Date(tp.created_at).toLocaleString('th-TH'))}</td>
              <td class="py-3 px-3 font-bold titanium-text">${escapeHtml(tp.user_name || tp.user_id)}</td>
              <td class="py-3 px-3 font-black text-amber-500">+${Number(tp.amount || 0).toFixed(2)} Coins</td>
              <td class="py-3 px-3">${tp.slip_url ? `<button type="button" data-pd-admin-action="slip" data-slip-url="${safe(tp.slip_url)}" class="text-blue-500 underline font-bold">ดูสลิป</button>` : '-'}</td>
              <td class="py-3 px-3 font-bold ${tp.status === 'approved' ? 'text-emerald-500' : tp.status === 'rejected' ? 'text-rose-500' : 'text-amber-500'}">${escapeHtml(tp.status || 'pending')}</td>
              <td class="py-3 px-3 text-right">${tp.status === 'pending' ? `<div class="flex gap-2 justify-end"><button type="button" data-pd-admin-action="approve-topup" data-topup-id="${escapeHtml(tp.id)}" data-user-id="${escapeHtml(tp.user_id)}" data-amount="${Number(tp.amount)}" class="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-sm">อนุมัติ</button><button type="button" data-pd-admin-action="reject-topup" data-topup-id="${escapeHtml(tp.id)}" class="px-3 py-2 bg-rose-600 hover:bg-rose-500 text-white font-bold rounded-xl text-sm">ปฏิเสธ</button></div>` : '-'}</td>
            </tr>`).join('') || '<tr><td colspan="6" class="py-10 text-center sub-text">ยังไม่มีคำขอเติม Coins</td></tr>';
        }

        // Never render password fields in Admin tables.
        const { data: users, error: usersError } = await supabaseClient.from('users').select('id,full_name,email,role');
        if (usersError) throw usersError;
        const usersTb = document.getElementById('admin-users-tbody');
        if (usersTb) {
          usersTb.innerHTML = (users || []).map(u => `
            <tr class="hover:bg-slate-200/50 dark:hover:bg-white/5 transition">
              <td class="py-3 px-3 font-bold titanium-text">${escapeHtml(u.full_name)}</td>
              <td class="py-3 px-3 sub-text">${escapeHtml(u.email)}</td>
              <td class="py-3 px-3 font-bold ${u.role === 'admin' ? 'text-purple-500' : 'text-emerald-500'}">${escapeHtml(u.role)}</td>
              <td class="py-3 px-3 text-right"><button type="button" data-pd-admin-action="role" data-user-id="${escapeHtml(u.id)}" data-target-role="${u.role === 'admin' ? 'member' : 'admin'}" class="px-3 py-2 ui-card hover:border-purple-500 rounded-xl text-sm font-extrabold">สลับสิทธิ์เป็น ${u.role === 'admin' ? 'Member' : 'Admin'}</button></td>
            </tr>`).join('') || '<tr><td colspan="4" class="py-10 text-center sub-text">ยังไม่มีสมาชิก</td></tr>';
        }
      } catch (err) {
        showCustomModal({ title: 'โหลดข้อมูล Admin ไม่สำเร็จ', message: err.message || 'ไม่สามารถดึงข้อมูลได้', icon: 'shield-alert' });
      }
    }

    async function promptTracking(orderId) {
      if (!assertAdminAccess()) return;
      const trackNo = prompt('กรุณากรอกหมายเลข Tracking พัสดุ:')?.trim();
      if (!trackNo) return;
      if (trackNo.length > 50) return showCustomModal({ title: 'Tracking ไม่ถูกต้อง', message: 'หมายเลข Tracking ยาวเกินกำหนด', icon: 'alert-triangle' });
      try {
        const { error } = await supabaseClient.from('orders').update({ tracking_number: trackNo, courier_name: 'Kerry Express' }).eq('id', orderId);
        if (error) throw error;
        showCustomModal({ title: 'บันทึก Tracking สำเร็จ', message: `บันทึกหมายเลข Tracking สำหรับออเดอร์ #${orderId} แล้ว`, icon: 'shield-check' });
        loadAdminData();
      } catch (err) { showCustomModal({ title: 'บันทึก Tracking ไม่สำเร็จ', message: err.message || 'เกิดข้อผิดพลาด', icon: 'shield-alert' }); }
    }

    function switchAdminTab(tab) {
      ['orders', 'topups', 'users'].forEach(t => {
        document.getElementById(`admin-tab-${t}`).classList.add('hidden');
        document.getElementById(`admin-tab-${t}-btn`).className = 'flex-1 py-2 text-xs font-bold rounded-lg titanium-text opacity-80 hover:opacity-100';
      });

      document.getElementById(`admin-tab-${tab}`).classList.remove('hidden');
      document.getElementById(`admin-tab-${tab}-btn`).className = 'flex-1 py-2 text-xs font-bold rounded-lg bg-purple-600 text-white shadow-sm';
    }

    async function updateOrderStatus(orderId, newStatus) {
      if (!assertAdminAccess()) return;
      const allowedStatuses = ['pending', 'printing', 'completed', 'cancelled'];
      if (!allowedStatuses.includes(newStatus)) return showCustomModal({ title: 'สถานะไม่ถูกต้อง', message: 'สถานะงานที่ส่งมาไม่อยู่ในรายการที่ระบบอนุญาต', icon: 'shield-alert' });
      try {
        const { error } = await supabaseClient.from('orders').update({ status: newStatus }).eq('id', orderId);
        if (error) throw error;
        showCustomModal({ title: 'อัปเดตสถานะสำเร็จ', message: `เปลี่ยนสถานะออเดอร์ #${orderId} เป็น ${newStatus} แล้ว`, icon: 'shield-check' });
        fetchQueues();
      } catch (err) { showCustomModal({ title: 'อัปเดตสถานะไม่สำเร็จ', message: err.message || 'เกิดข้อผิดพลาด', icon: 'shield-alert' }); loadAdminData(); }
    }

    async function approveTopup(topupId, userId, amount) {
      if (!assertAdminAccess()) return;
      const numericAmount = Number(amount);
      if (!Number.isFinite(numericAmount) || numericAmount <= 0) return showCustomModal({ title: 'ยอด Coins ไม่ถูกต้อง', message: 'ระบบหยุดการอนุมัติเพื่อป้องกันยอดเงินผิดพลาด', icon: 'shield-alert' });
      try {
        // Claim the pending topup first to prevent double approval from repeated clicks.
        const { data: claimed, error: claimError } = await supabaseClient.from('topups').update({ status: 'approved' }).eq('id', topupId).eq('status', 'pending').select('id').maybeSingle();
        if (claimError) throw claimError;
        if (!claimed) return showCustomModal({ title: 'รายการถูกจัดการแล้ว', message: 'คำขอนี้ไม่ได้อยู่ในสถานะรออนุมัติ จึงไม่เพิ่ม Coins ซ้ำ', icon: 'shield-check' });

        const wallet = await ensureUserWallet(userId);
        const before = Number(wallet.balance || 0);
        const after = Number((before + numericAmount).toFixed(2));
        try {
          await compareAndSwapWalletBalance(userId, before, after);
        } catch (walletUpdateError) {
          await supabaseClient.from('topups').update({ status: 'pending' }).eq('id', topupId).eq('status', 'approved');
          throw walletUpdateError;
        }
        showCustomModal({ title: 'อนุมัติเรียบร้อย', message: `เพิ่ม ${numericAmount.toFixed(2)} Coins ให้ผู้ใช้แล้ว`, icon: 'shield-check' });
        loadAdminData();
      } catch (err) { showCustomModal({ title: 'อนุมัติไม่สำเร็จ', message: err.message || 'ระบบยกเลิกรายการเพื่อความปลอดภัย', icon: 'shield-alert' }); loadAdminData(); }
    }

    async function rejectTopup(topupId) {
      if (!assertAdminAccess()) return;
      try {
        const { data, error } = await supabaseClient.from('topups').update({ status: 'rejected' }).eq('id', topupId).eq('status', 'pending').select('id').maybeSingle();
        if (error) throw error;
        if (!data) return showCustomModal({ title: 'รายการถูกจัดการแล้ว', message: 'คำขอนี้ไม่อยู่ในสถานะรออนุมัติแล้ว', icon: 'shield-check' });
        showCustomModal({ title: 'ปฏิเสธคำขอแล้ว', message: 'ระบบเปลี่ยนสถานะคำขอเติม Coins เรียบร้อยแล้ว', icon: 'x-circle' });
        loadAdminData();
      } catch (err) { showCustomModal({ title: 'ปฏิเสธรายการไม่สำเร็จ', message: err.message || 'เกิดข้อผิดพลาด', icon: 'shield-alert' }); }
    }

    async function changeUserRole(userId, newRole) {
      if (!assertAdminAccess()) return;
      if (!['member', 'admin'].includes(newRole)) return showCustomModal({ title: 'สิทธิ์ไม่ถูกต้อง', message: 'ระบบหยุดการเปลี่ยนสิทธิ์เพื่อความปลอดภัย', icon: 'shield-alert' });
      if (currentUser?.id === userId) return showCustomModal({ title: 'ป้องกันการเปลี่ยนสิทธิ์ตัวเอง', message: 'กรุณาใช้บัญชีผู้ดูแลอื่นเมื่อจำเป็นต้องเปลี่ยนสิทธิ์ของบัญชีนี้', icon: 'shield-alert' });
      try {
        const { error } = await supabaseClient.from('users').update({ role: newRole }).eq('id', userId);
        if (error) throw error;
        showCustomModal({ title: 'สลับสิทธิ์สำเร็จ', message: `อัปเดตสิทธิ์ผู้ใช้เป็น ${newRole} เรียบร้อยแล้ว`, icon: 'shield-check' });
        loadAdminData();
      } catch (err) { showCustomModal({ title: 'เปลี่ยนสิทธิ์ไม่สำเร็จ', message: err.message || 'เกิดข้อผิดพลาด', icon: 'shield-alert' }); }
    }
    /* ==========================================================
       DESIGNER ADVANCED v5 — INTERACTION ENGINE
       ========================================================== */
    (() => {
      'use strict';

      const PD = {
        activeView: 'landing',
        commandIndex: 0,
        commandItems: [],
        pointerFine: window.matchMedia?.('(pointer:fine)').matches ?? false,
        raf: 0,
        lastScroll: 0,
        themeMode: localStorage.getItem('sp_theme_mode') || (localStorage.getItem('sp_theme') || 'dark')
      };

      const $ = (s, root = document) => root.querySelector(s);
      const $$ = (s, root = document) => [...root.querySelectorAll(s)];

      function pdIconRefresh() {
        try { if (typeof lucide !== 'undefined') lucide.createIcons(); } catch (_) { }
      }

      function pdToast(title, message = '', tone = 'info') {
        const stack = $('#pd-toast-stack');
        if (!stack) return;
        const icons = { info: 'sparkles', success: 'check-circle-2', warn: 'triangle-alert', danger: 'shield-alert' };
        const toast = document.createElement('div');
        toast.className = `pd-toast pd-toast-${tone}`;
        toast.innerHTML = `
          <span class="pd-toast-icon"><i data-lucide="${icons[tone] || icons.info}"></i></span>
          <span class="pd-toast-copy"><b>${escapeHtml(title)}</b><small>${escapeHtml(message)}</small></span>
          <button type="button" class="pd-toast-close" aria-label="ปิด"><i data-lucide="x"></i></button>
          <span class="pd-toast-progress"></span>
        `;
        stack.appendChild(toast);
        pdIconRefresh();
        requestAnimationFrame(() => toast.classList.add('is-in'));
        const remove = () => {
          toast.classList.remove('is-in');
          setTimeout(() => toast.remove(), 380);
        };
        $('.pd-toast-close', toast)?.addEventListener('click', remove);
        setTimeout(remove, 4300);
      }

      window.pdToast = pdToast;

      function setThemeMode(mode) {
        const htmlEl = document.documentElement;
        let resolved = mode;
        if (mode === 'system') {
          resolved = window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
          localStorage.setItem('sp_theme_mode', 'system');
        } else {
          localStorage.setItem('sp_theme_mode', mode);
        }
        htmlEl.classList.toggle('dark', resolved === 'dark');
        localStorage.setItem('sp_theme', resolved);
        PD.themeMode = mode;
        updateThemeUI();
        pdIconRefresh();
      }

      function updateThemeUI() {
        const resolvedDark = document.documentElement.classList.contains('dark');
        const icon = $('#theme-icon');
        if (icon) icon.setAttribute('data-lucide', resolvedDark ? 'sun' : 'moon');
        $$('.pd-theme-option').forEach(btn => btn.classList.toggle('is-active', btn.dataset.pdTheme === PD.themeMode));
      }

      window.pdSetTheme = setThemeMode;

      /* Replace the original toggle with a premium theme selector entry point. */
      window.toggleTheme = function () {
        const sheet = $('#pd-theme-sheet');
        if (!sheet) return;
        sheet.classList.remove('hidden');
        updateThemeUI();
        pdIconRefresh();
      };

      function closeThemeSheet() {
        $('#pd-theme-sheet')?.classList.add('hidden');
      }

      function openPDCommandPalette() {
        const overlay = $('#pd-command-palette');
        const input = $('#pd-command-input');
        if (!overlay) return;
        overlay.classList.remove('hidden');
        buildCommandItems('');
        setTimeout(() => input?.focus(), 50);
        document.body.classList.add('pd-command-open');
      }

      function closePDCommandPalette() {
        $('#pd-command-palette')?.classList.add('hidden');
        document.body.classList.remove('pd-command-open');
      }

      window.openPDCommandPalette = openPDCommandPalette;
      window.closePDCommandPalette = closePDCommandPalette;

      function getCommandItems() {
        const items = [
          { id: 'home', icon: 'house', title: 'หน้าแรก', desc: 'กลับสู่หน้าแรกของ PrintDekD Pro', key: 'Home', action: () => switchView('landing') },
          { id: 'print', icon: 'file-up', title: 'สั่งพิมพ์เอกสาร', desc: 'อัปโหลดไฟล์และสร้างรายการพิมพ์', key: 'Print', action: () => handleStartPrinting() },
          { id: 'queue', icon: 'clock-3', title: 'คิวงานพิมพ์', desc: 'ดูสถานะงานและรายการล่าสุด', key: 'Queue', action: () => switchView('dashboard') },
          { id: 'wallet', icon: 'wallet-cards', title: 'Coins Wallet', desc: 'เติม Coins และตรวจสอบยอดคงเหลือ', key: 'Wallet', action: () => switchView('wallet') },
          { id: 'profile', icon: 'user-round', title: 'โปรไฟล์ของฉัน', desc: 'ข้อมูลบัญชี ความปลอดภัย และการตั้งค่า', key: 'Profile', action: () => currentUser ? openUserProfileModal() : (switchView('auth'), switchAuthTab('login')) },
          { id: 'theme', icon: 'sun-moon', title: 'เปลี่ยนธีม', desc: 'Dark / Light / System', key: 'Theme', action: () => { closePDCommandPalette(); toggleTheme(); } },
          { id: 'security', icon: 'shield-check', title: 'ตรวจสอบความปลอดภัย', desc: 'ตรวจสอบสถานะการเชื่อมต่อและเซสชัน', key: 'Security', action: () => runSecurityAudit(true) },
          { id: 'help', icon: 'life-buoy', title: 'ศูนย์ช่วยเหลือ PrintDekD', desc: 'ค้นหาคู่มือ วิธีใช้งาน และคำถามที่พบบ่อย', key: 'Help', action: () => switchView('help') },
          { id: 'performance', icon: 'gauge', title: 'ตรวจสุขภาพและความลื่นไหล', desc: 'ตรวจขนาดจอ, overflow, DOM, รูปภาพ และ long tasks ภายในเครื่อง', key: 'Performance', action: () => window.pdV17RunPerformanceAudit?.(true) }
        ];
        if (currentUser?.role === 'admin') {
          items.splice(5, 0, { id: 'admin', icon: 'layout-dashboard', title: 'Admin Backoffice', desc: 'จัดการคิว ผู้ใช้ และ Top-up', key: 'Admin', action: () => switchView('admin') });
        }
        return items;
      }

      function buildCommandItems(query = '') {
        const results = $('#pd-command-results');
        if (!results) return;
        const q = query.trim().toLowerCase();
        PD.commandItems = getCommandItems().filter(item => {
          const hay = `${item.title} ${item.desc} ${item.key}`.toLowerCase();
          return !q || hay.includes(q);
        });
        PD.commandIndex = Math.max(0, Math.min(PD.commandIndex, PD.commandItems.length - 1));
        results.innerHTML = PD.commandItems.length
          ? PD.commandItems.map((item, index) => `
              <button type="button" class="pd-command-item ${index === PD.commandIndex ? 'is-selected' : ''}" data-pd-command-index="${index}">
                <span class="pd-command-item-icon"><i data-lucide="${item.icon}"></i></span>
                <span><b>${escapeHtml(item.title)}</b><small>${escapeHtml(item.desc)}</small></span>
                <span>${escapeHtml(item.key)}</span>
              </button>
            `).join('')
          : '<div class="pd-command-empty">ไม่พบเมนูที่ตรงกับคำค้น ลองใช้คำว่า “พิมพ์”, “Coins” หรือ “โปรไฟล์”</div>';
        pdIconRefresh();
        $$('.pd-command-item', results).forEach(btn => {
          btn.addEventListener('mouseenter', () => {
            PD.commandIndex = Number(btn.dataset.pdCommandIndex);
            $$('.pd-command-item', results).forEach((x, i) => x.classList.toggle('is-selected', i === PD.commandIndex));
          });
          btn.addEventListener('click', () => {
            const item = PD.commandItems[Number(btn.dataset.pdCommandIndex)];
            closePDCommandPalette();
            item?.action?.();
          });
        });
      }

      function runCommand() {
        const item = PD.commandItems[PD.commandIndex];
        if (!item) return;
        closePDCommandPalette();
        item.action?.();
      }

      function setupCommandCenter() {
        $('#pd-command-input')?.addEventListener('input', e => {
          PD.commandIndex = 0;
          buildCommandItems(e.target.value);
        });
        $$('[data-pd-close-command]').forEach(el => el.addEventListener('click', closePDCommandPalette));
      }

      function setupThemeSheet() {
        $$('[data-pd-close-theme]').forEach(el => el.addEventListener('click', closeThemeSheet));
        $$('.pd-theme-option').forEach(btn => btn.addEventListener('click', () => {
          setThemeMode(btn.dataset.pdTheme);
          closeThemeSheet();
          pdToast('เปลี่ยนธีมแล้ว', btn.dataset.pdTheme === 'dark' ? 'Deep Titanium' : btn.dataset.pdTheme === 'light' ? 'Soft Silver' : 'ตามการตั้งค่าอุปกรณ์', 'success');
        }));
        const media = window.matchMedia?.('(prefers-color-scheme: dark)');
        media?.addEventListener?.('change', () => {
          if (PD.themeMode === 'system') setThemeMode('system');
        });
      }

      function setupKeyboard() {
        window.addEventListener('keydown', e => {
          const modifier = e.metaKey || e.ctrlKey;
          if (modifier && e.key.toLowerCase() === 'k') {
            e.preventDefault();
            if ($('#pd-command-palette')?.classList.contains('hidden')) openPDCommandPalette();
            else closePDCommandPalette();
            return;
          }
          const commandOpen = !$('#pd-command-palette')?.classList.contains('hidden');
          if (commandOpen) {
            if (e.key === 'Escape') return closePDCommandPalette();
            if (e.key === 'ArrowDown') { e.preventDefault(); PD.commandIndex = Math.min(PD.commandItems.length - 1, PD.commandIndex + 1); buildCommandItems($('#pd-command-input')?.value || ''); }
            if (e.key === 'ArrowUp') { e.preventDefault(); PD.commandIndex = Math.max(0, PD.commandIndex - 1); buildCommandItems($('#pd-command-input')?.value || ''); }
            if (e.key === 'Enter') { e.preventDefault(); runCommand(); }
          }
        });
      }

      function setupScrollEffects() {
        const progress = $('#pd-scroll-progress-bar');
        const nav = $('nav.sticky');
        const dock = $('#pd-quick-dock');
        const island = $('#pd-live-island');
        const update = () => {
          const max = Math.max(1, document.documentElement.scrollHeight - innerHeight);
          const pct = Math.min(100, Math.max(0, (scrollY / max) * 100));
          if (progress) { progress.style.width = '100%'; progress.style.transformOrigin = 'left center'; progress.style.transform = `scaleX(${pct / 100})`; }
          nav?.classList.toggle('is-compact', scrollY > 28);
          dock?.classList.toggle('is-hidden', scrollY < 220);
          island?.classList.toggle('is-visible', scrollY > 360);
          PD.lastScroll = scrollY;
        };
        let ticking = false;
        window.addEventListener('scroll', () => {
          if (ticking) return;
          ticking = true;
          requestAnimationFrame(() => { update(); ticking = false; });
        }, { passive: true });
        update();
      }

      function setupLiveIsland() {
        const clock = $('#pd-island-time');
        const tick = () => {
          if (!clock) return;
          clock.textContent = new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit' }).format(new Date());
        };
        tick();
        setInterval(tick, 30000);
      }

      function setupPointerEffects() { /* Disabled: keep interaction animation CSS-only and avoid a permanent animation loop. */ }

      function setupTilt() { /* Disabled: avoid per-pointer layout/3D-transform work on lower-power laptops. */ }

      function setupMagneticButtons() { /* Disabled: avoid per-pointer layout/3D-transform work on lower-power laptops. */ }

      function setupRevealObserver() {
        const targets = $$('.pd-reveal-card, .pd-story-section, .pd-final-cta');
        if (!('IntersectionObserver' in window)) {
          targets.forEach(x => x.classList.add('is-in'));
          return;
        }
        const observer = new IntersectionObserver(entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) entry.target.classList.add('is-in');
          });
        }, { threshold: .16, rootMargin: '0px 0px -7% 0px' });
        targets.forEach(x => observer.observe(x));
      }

      function setupDock() {
        $$('[data-pd-action]').forEach(btn => btn.addEventListener('click', () => {
          const action = btn.dataset.pdAction;
          if (action === 'home') switchView('landing');
          else if (action === 'print') handleStartPrinting();
          else if (action === 'wallet') switchView('wallet');
          else if (action === 'help') switchView('help');
          else if (action === 'theme') toggleTheme();
        }));
      }

      function setupNavigationObserver() {
        const map = {
          landing: ['view-landing', 'nav-home-btn'],
          auth: ['view-auth', null],
          dashboard: ['view-dashboard', 'nav-dashboard-btn'],
          wallet: ['view-wallet', 'nav-wallet-btn'],
          admin: ['view-admin', null],
          employee: ['view-employee', null],
          help: ['view-help', 'nav-help-btn']
        };
        const originalSwitch = window.switchView;
        if (typeof originalSwitch !== 'function') return;
        window.switchView = function (viewName) {
          PD.activeView = viewName;
          const result = originalSwitch(viewName);
          requestAnimationFrame(() => {
            document.body.dataset.pdView = viewName;
            updateThemeUI();
            pdIconRefresh();
          });
          return result;
        };
        Object.entries(map).forEach(([view, [, navId]]) => {
          if (!navId) return;
          const nav = document.getElementById(navId);
          nav?.addEventListener('click', () => { PD.activeView = view; });
        });
      }

      function setupProfileEnhancement() {
        const profileButton = $('#user-profile-menu button[aria-label="เปิดโปรไฟล์ผู้ใช้งาน"]');
        profileButton?.addEventListener('mouseenter', () => {
          profileButton.classList.add('pd-profile-hover');
        });
        profileButton?.addEventListener('mouseleave', () => {
          profileButton.classList.remove('pd-profile-hover');
        });
      }

      function setupMicroFeedback() {
        document.addEventListener('click', e => {
          const button = e.target.closest('button');
          if (!button || button.disabled || button.closest('#pd-command-palette')) return;
          button.classList.remove('pd-click-flash');
          requestAnimationFrame(() => {
            button.classList.add('pd-click-flash');
            setTimeout(() => button.classList.remove('pd-click-flash'), 260);
          });
        });
      }

      function setupIntersectionStatus() {
        const label = $('#pd-island-label');
        const sections = [
          ['view-landing', 'กำลังดูหน้าแรก'],
          ['view-auth', 'กำลังจัดการบัญชี'],
          ['view-dashboard', 'กำลังจัดการงานพิมพ์'],
          ['view-wallet', 'กำลังจัดการ Coins'],
          ['view-admin', 'กำลังดูแลระบบ'],
          ['view-employee', 'กำลังจัดเตรียมและส่งมอบงาน'],
          ['view-help', 'กำลังดูศูนย์ช่วยเหลือ']
        ];
        const update = () => {
          const visible = sections.find(([id]) => {
            const el = document.getElementById(id);
            return el && !el.classList.contains('hidden');
          });
          if (label && visible) label.textContent = visible[1];
        };
        update();
        window.addEventListener('pd:viewchange', update, { passive: true });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) update(); }, { passive: true });
      }

      function setupThemeFirstPaint() {
        const savedMode = localStorage.getItem('sp_theme_mode');
        if (savedMode) PD.themeMode = savedMode;
        else PD.themeMode = localStorage.getItem('sp_theme') || 'dark';
        if (PD.themeMode === 'system') setThemeMode('system');
        else setThemeMode(PD.themeMode === 'light' ? 'light' : 'dark');
      }

      function initDesignerAdvanced() {
        setupThemeFirstPaint();
        setupCommandCenter();
        setupThemeSheet();
        setupKeyboard();
        setupScrollEffects();
        setupLiveIsland();
        setupPointerEffects();
        setupTilt();
        setupMagneticButtons();
        setupRevealObserver();
        setupDock();
        setupNavigationObserver();
        setupProfileEnhancement();
        setupMicroFeedback();
        setupIntersectionStatus();
        pdIconRefresh();
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initDesignerAdvanced, { once: true });
      } else {
        initDesignerAdvanced();
      }
    })();

  
