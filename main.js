/* ═══════════════════════════════════════════════════════
   SID PESAJE — HYPER-ANIMATION ENGINE
   Dense scroll effects, multi-layer parallax, sequential 
   reveals, organic interactions, constant micro-animations
   ═══════════════════════════════════════════════════════ */

// ═══════════════════════════════════════════════════════
// 0. THEME INITIALIZATION (Run immediately to prevent FOUC)
// ═══════════════════════════════════════════════════════
const savedTheme = localStorage.getItem('sidp-theme');
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');
const emergencyFixMode = document.documentElement.hasAttribute('data-emergency-fix');
document.documentElement.setAttribute('data-theme', initialTheme);

// ═══════════════════════════════════════════════════════
// 0.8 PORTAL DE ACCESO — Firebase Auth (Cliente / Administrador)
// ─────────────────────────────────────────────────────────────
// FIX: los botones "Entrar como Cliente" / "Entrar como Administrador"
// invocaban window.abrirPortalClientes(...) pero la función NO estaba
// declarada en ningún archivo del proyecto, de modo que cada clic reventaba
// con:  Uncaught TypeError: window.abrirPortalClientes is not a function
//
// Aquí se declara de forma explícita y global (ver window.abrirPortalClientes
// más abajo) con toda la lógica de Firebase Auth: carga perezosa del SDK
// compat, inicio de sesión por correo/contraseña y Google, alta de cliente,
// resolución del rol contra Firestore (users/{uid}.role → admins/{email}) y
// ruteo hacia /agenda?intent=<rol>.
//
// La UI reutiliza la convención .modal-overlay + .modal-content del sitio y la
// extiende con body.sidp-portal-open: .modal-overlay.active es de lo poco que
// emergency-fix.js/css deja interactivo (el resto de overlays position:fixed
// reciben pointer-events:none en cada pasada, que corre cada 1 s).
// ═══════════════════════════════════════════════════════
const SIDP_PORTAL = (function initPortalAccess() {

    /* ── Configuración del proyecto (mismo proyecto que firebase-messaging-sw.js) ── */
    const FIREBASE_CONFIG = {
        apiKey: 'AIzaSyAOraPD6LrhNXEqM0ClPEwZwPEWfVG1ZMk',
        authDomain: 'sidpesaje.firebaseapp.com',
        projectId: 'sidpesaje',
        storageBucket: 'sidpesaje.firebasestorage.app',
        messagingSenderId: '449735968404',
        appId: '1:449735968404:web:8d103e1655e7cd76635681',
        measurementId: 'G-5KX8TYL5JX'
    };
    const SDK_BASE = 'https://www.gstatic.com/firebasejs/10.8.0';
    const SDK_FILES = ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-firestore-compat.js'];
    const SDK_TIMEOUT = 9000;
    const PORTAL_ROUTE = '/agenda';
    const TAG = '[portal]';

    const COPY = {
        cliente: {
            title: 'Portal de Clientes',
            subtitle: 'Consulta tus pesajes, solicita servicios y sigue tus turnos.',
            submit: 'Iniciar sesión',
            allowRegister: true
        },
        admin: {
            title: 'Portal de Administración',
            subtitle: 'Acceso restringido al equipo técnico y administrativo de SID Pesaje.',
            submit: 'Entrar como administrador',
            allowRegister: false
        }
    };

    /* ── Estado ─────────────────────────────────────────────────────── */
    let sdkPromise = null;
    let authListenerBound = false;
    let ui = null;                 // referencias al modal (se construye una sola vez)
    let activeIntent = 'cliente';
    let lastTrigger = null;        // botón que abrió el portal (para devolverle el foco)
    let lastAuth = { key: null, at: 0, role: null };
    let busy = false;

    /* ── Utilidades ─────────────────────────────────────────────────── */
    const warn = (...args) => { try { console.warn(TAG, ...args); } catch (e) { /* noop */ } };

    function h(tag, props, children) {
        const el = document.createElement(tag);
        Object.entries(props || {}).forEach(([key, value]) => {
            if (value === null || value === undefined || value === false) return;
            if (key === 'class') el.className = value;
            else if (key === 'text') el.textContent = value;
            else if (key === 'html') el.innerHTML = value;
            else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
            else if (key === 'style' && typeof value === 'object') Object.assign(el.style, value);
            else el.setAttribute(key, value === true ? '' : value);
        });
        (children || []).forEach(child => {
            if (child === null || child === undefined || child === false) return;
            el.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
        });
        return el;
    }

    function isOnline() {
        return typeof navigator === 'undefined' || navigator.onLine !== false;
    }

    function normalizeIntent(raw) {
        let value = raw;
        /* Tolera que le pasen el evento en vez del rol. */
        if (value && typeof value === 'object') {
            const node = value.currentTarget || value.target;
            value = node && typeof node.getAttribute === 'function'
                ? node.getAttribute('data-portal-intent')
                : null;
        }
        value = String(value || '').trim().toLowerCase();
        return value.indexOf('admin') === 0 ? 'admin' : 'cliente';
    }

    /* ── Carga perezosa del SDK compat de Firebase ──────────────────── */
    function loadScript(src, timeoutMs) {
        return new Promise(resolve => {
            try {
                if (document.querySelector(`script[data-sidp-sdk="${src}"]`)) { resolve(true); return; }
                let settled = false;
                const finish = ok => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timer);
                    resolve(ok);
                };
                const script = document.createElement('script');
                script.src = src;
                script.async = true;
                script.setAttribute('data-sidp-sdk', src);
                script.onload = () => finish(true);
                script.onerror = () => finish(false);
                const timer = setTimeout(() => finish(false), timeoutMs);
                (document.head || document.documentElement).appendChild(script);
            } catch (err) {
                warn('no se pudo inyectar el SDK', err && err.message);
                resolve(false);
            }
        });
    }

    function initApp(fb) {
        try {
            const apps = fb.apps || [];
            if (!apps.length) fb.initializeApp(FIREBASE_CONFIG);
        } catch (err) {
            /* duplicate-app: otra parte del sitio ya inicializó Firebase */
        }
        return fb;
    }

    function ensureFirebase() {
        if (sdkPromise) return sdkPromise;
        sdkPromise = (async () => {
            try {
                const existing = window.firebase;
                if (existing && typeof existing.auth === 'function') return initApp(existing);

                if (!isOnline()) {
                    warn('sin conexión: el portal queda en modo invitado.');
                    return null;
                }
                for (let i = 0; i < SDK_FILES.length; i++) {
                    const ok = await loadScript(`${SDK_BASE}/${SDK_FILES[i]}`, SDK_TIMEOUT);
                    if (!ok) {
                        warn(`no se pudo cargar ${SDK_FILES[i]}; el portal queda en modo invitado.`);
                        return null;
                    }
                }
                if (!window.firebase || typeof window.firebase.auth !== 'function') {
                    warn('el SDK cargó pero firebase.auth() no está disponible.');
                    return null;
                }
                return initApp(window.firebase);
            } catch (err) {
                warn('fallo al inicializar Firebase:', err && err.message);
                return null;
            }
        })();
        return sdkPromise;
    }

    function bindAuthListener(fb) {
        if (authListenerBound || !fb) return;
        authListenerBound = true;
        try {
            fb.auth().onAuthStateChanged(user => {
                if (user && ui && ui.overlay.classList.contains('active') && !busy) {
                    onAuthenticated(user, activeIntent);
                }
            });
        } catch (err) {
            warn('onAuthStateChanged no disponible:', err && err.message);
        }
    }

    /* ── Traducción de errores de Firebase Auth a español ───────────── */
    function friendlyAuthError(err) {
        const code = (err && (err.code || (err.message || '').match(/auth\/[a-z-]+/i)?.[0])) || '';
        const map = {
            'auth/invalid-email': 'El correo no tiene un formato válido.',
            'auth/user-not-found': 'No existe una cuenta con ese correo.',
            'auth/wrong-password': 'Contraseña incorrecta. Inténtalo de nuevo.',
            'auth/invalid-credential': 'Credenciales inválidas. Verifica correo y contraseña.',
            'auth/email-already-in-use': 'Ese correo ya está registrado. Inicia sesión.',
            'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
            'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos y vuelve a probar.',
            'auth/network-request-failed': 'No hay conexión con Firebase. Revisa tu red.',
            'auth/popup-blocked': 'El navegador bloqueó la ventana de Google. Permite las ventanas emergentes.',
            'auth/popup-closed-by-user': 'Cerraste la ventana de Google antes de terminar.',
            'auth/cancelled-popup-request': 'Se canceló la solicitud de acceso con Google.',
            'auth/operation-not-allowed': 'Este método de acceso no está habilitado en Firebase Console.',
            'auth/unauthorized-domain': 'Este dominio no está autorizado en Firebase Auth.',
            'auth/requires-recent-login': 'Por seguridad, vuelve a iniciar sesión.'
        };
        return map[code] || 'No pudimos completar el acceso. Revisa los datos e inténtalo de nuevo.';
    }

    /* ── Estilos del portal (se inyectan una sola vez) ──────────────── */
    function injectStyles() {
        if (document.getElementById('sidp-portal-styles')) return;
        const style = document.createElement('style');
        style.id = 'sidp-portal-styles';
        style.textContent = `
.sidp-portal.modal-overlay {
    z-index: 100000 !important;
    pointer-events: none;
    background: rgba(8, 8, 12, 0.62);
    -webkit-backdrop-filter: blur(6px);
    backdrop-filter: blur(6px);
    padding: 1rem;
    box-sizing: border-box;
}
.sidp-portal.modal-overlay.active { pointer-events: auto !important; }
body.sidp-portal-open { overflow: hidden; }
body.sidp-portal-open #site-content,
body.sidp-portal-open #app { pointer-events: none !important; }
.sidp-portal .modal-content {
    width: min(26rem, 92vw) !important;
    max-width: min(26rem, 92vw) !important;
    background: var(--surface, #ffffff) !important;
    color: var(--on-surface, #1a1a1a) !important;
    border: 1px solid var(--outline-variant, #e8e2de);
    border-radius: 18px;
    padding: clamp(1.25rem, 4vw, 1.75rem);
    box-shadow: 0 24px 70px rgba(0, 0, 0, 0.35);
    font-family: var(--font-body, 'Inter', sans-serif);
    text-align: center;
}
.sidp-portal__close {
    position: absolute; top: .6rem; right: .6rem;
    width: 2rem; height: 2rem; border: 0; border-radius: 50%;
    background: transparent; color: var(--on-surface-variant, #5a5755);
    cursor: pointer; font-size: 1.1rem; line-height: 1;
}
.sidp-portal__close:hover { background: var(--surface-container, #f0edec); }
.sidp-portal__badge {
    display: inline-flex; align-items: center; gap: .4rem;
    font-size: .68rem; letter-spacing: .08em; text-transform: uppercase;
    font-weight: 700; color: var(--primary, #cc0000);
    background: rgba(204, 0, 0, 0.10);
    background: color-mix(in srgb, var(--primary, #cc0000) 10%, transparent);
    border: 1px solid rgba(204, 0, 0, 0.22);
    border: 1px solid color-mix(in srgb, var(--primary, #cc0000) 22%, transparent);
    padding: .3rem .6rem; border-radius: 999px;
}
.sidp-portal__title {
    font-family: var(--font-display, 'Manrope', sans-serif);
    font-size: clamp(1.2rem, 4vw, 1.45rem);
    margin: .75rem 0 .35rem; line-height: 1.2;
}
.sidp-portal__subtitle {
    font-size: .88rem; color: var(--on-surface-variant, #5a5755);
    margin: 0 auto 1.1rem; max-width: 22rem; line-height: 1.5;
}
.sidp-portal__form { display: flex; flex-direction: column; gap: .65rem; text-align: left; }
.sidp-portal__label {
    font-size: .72rem; font-weight: 600; letter-spacing: .04em;
    text-transform: uppercase; color: var(--on-surface-variant, #5a5755);
    margin-bottom: .25rem; display: block;
}
.sidp-portal__input {
    width: 100%; box-sizing: border-box;
    padding: .7rem .85rem; font-size: .95rem;
    color: var(--on-surface, #1a1a1a);
    background: var(--surface-container-lowest, #ffffff);
    border: 1px solid var(--outline, #d4ccc8); border-radius: 12px;
    outline: none; transition: border-color .2s ease, box-shadow .2s ease;
}
.sidp-portal__input:focus {
    border-color: var(--primary, #cc0000);
    box-shadow: 0 0 0 3px rgba(204, 0, 0, 0.18);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--primary, #cc0000) 18%, transparent);
}
.sidp-portal__btn {
    display: inline-flex; align-items: center; justify-content: center; gap: .5rem;
    width: 100%; padding: .8rem 1rem; margin-top: .25rem;
    border: 0; border-radius: 12px; cursor: pointer;
    font-family: var(--font-display, 'Manrope', sans-serif);
    font-size: .95rem; font-weight: 700;
    background: var(--primary, #cc0000); color: #fff;
    transition: transform .18s var(--ease-out-expo, cubic-bezier(.16,1,.3,1)), filter .18s ease;
}
.sidp-portal__btn:hover { filter: brightness(1.08); }
.sidp-portal__btn:active { transform: scale(.985); }
.sidp-portal__btn:disabled { opacity: .6; cursor: progress; }
.sidp-portal__btn--ghost {
    background: transparent; color: var(--on-surface, #1a1a1a);
    border: 1px solid var(--outline, #d4ccc8);
}
.sidp-portal__divider {
    display: flex; align-items: center; gap: .6rem;
    margin: .9rem 0 .2rem; color: var(--on-surface-variant, #5a5755); font-size: .72rem;
}
.sidp-portal__divider::before, .sidp-portal__divider::after {
    content: ''; flex: 1; height: 1px; background: var(--outline-variant, #e8e2de);
}
.sidp-portal__status {
    min-height: 1.2rem; margin: .8rem 0 0; font-size: .84rem; line-height: 1.45;
    color: var(--on-surface-variant, #5a5755); text-align: center;
}
.sidp-portal__status[data-kind="error"] { color: #d92d20; font-weight: 600; }
.sidp-portal__status[data-kind="success"] { color: #12805c; font-weight: 600; }
.sidp-portal__status[data-kind="info"] { color: var(--on-surface-variant, #5a5755); }
.sidp-portal__switch {
    margin-top: .9rem; font-size: .84rem; color: var(--on-surface-variant, #5a5755);
}
.sidp-portal__switch button {
    border: 0; background: none; padding: 0; cursor: pointer;
    color: var(--primary, #cc0000); font-weight: 700; font-size: .84rem;
    text-decoration: underline; text-underline-offset: 2px;
}
.sidp-portal__session { text-align: center; }
.sidp-portal__avatar {
    width: 3.25rem; height: 3.25rem; border-radius: 50%; margin: 0 auto .75rem;
    display: flex; align-items: center; justify-content: center;
    background: rgba(204, 0, 0, 0.12);
    background: color-mix(in srgb, var(--primary, #cc0000) 12%, transparent);
    color: var(--primary, #cc0000);
    font-family: var(--font-display, 'Manrope', sans-serif); font-weight: 800; font-size: 1.2rem;
}
.sidp-portal__role {
    display: inline-block; margin-top: .35rem; padding: .25rem .6rem; border-radius: 999px;
    font-size: .72rem; font-weight: 700; letter-spacing: .04em; text-transform: uppercase;
    background: var(--surface-container, #f0edec); color: var(--on-surface-variant, #5a5755);
}
.sidp-portal__actions { display: flex; flex-direction: column; gap: .5rem; margin-top: 1.1rem; }
.sidp-portal .sidp-portal__view[hidden] { display: none !important; }
@media (prefers-reduced-motion: reduce) {
    .sidp-portal.modal-overlay.active { pointer-events: auto !important; }
body.sidp-portal-open { overflow: hidden; }
body.sidp-portal-open #site-content,
body.sidp-portal-open #app { pointer-events: none !important; }
.sidp-portal .modal-content { animation: none !important; }
}
`;
        (document.head || document.documentElement).appendChild(style);
    }

    /* ── Construcción del modal ─────────────────────────────────────── */
    function buildModal() {
        injectStyles();

        const email = h('input', {
            class: 'sidp-portal__input', type: 'email', id: 'sidpPortalEmail',
            name: 'email', autocomplete: 'email', inputmode: 'email',
            placeholder: 'tucorreo@empresa.com', required: true
        });
        const password = h('input', {
            class: 'sidp-portal__input', type: 'password', id: 'sidpPortalPassword',
            name: 'password', autocomplete: 'current-password',
            placeholder: '••••••••', minlength: '6', required: true
        });
        const status = h('p', { class: 'sidp-portal__status', id: 'sidpPortalStatus', 'data-kind': 'info', role: 'status', 'aria-live': 'polite' });
        const badge = h('span', { class: 'sidp-portal__badge', id: 'sidpPortalBadge' });
        const title = h('h2', { class: 'sidp-portal__title', id: 'sidpPortalTitle' });
        const subtitle = h('p', { class: 'sidp-portal__subtitle', id: 'sidpPortalSubtitle' });

        const submit = h('button', { class: 'sidp-portal__btn', type: 'submit', id: 'sidpPortalSubmit' }, ['Iniciar sesión']);
        const google = h('button', {
            class: 'sidp-portal__btn sidp-portal__btn--ghost', type: 'button', id: 'sidpPortalGoogle',
            onclick: () => signInWithGoogle()
        }, ['Continuar con Google']);

        const switchRow = h('div', { class: 'sidp-portal__switch', id: 'sidpPortalSwitchRow' });
        const switchHint = h('span', { id: 'sidpPortalSwitchHint' }, ['¿Aún no tienes cuenta?']);
        const switchBtn = h('button', {
            type: 'button', id: 'sidpPortalSwitch',
            onclick: () => setMode(mode === 'login' ? 'register' : 'login')
        }, ['Crear cuenta']);

        const form = h('form', {
            class: 'sidp-portal__form', id: 'sidpPortalForm', novalidate: true,
            onsubmit: evt => { evt.preventDefault(); submitEmailPassword(); }
        }, [
            h('label', {}, [h('span', { class: 'sidp-portal__label', text: 'Correo electrónico' }), email]),
            h('label', {}, [h('span', { class: 'sidp-portal__label', text: 'Contraseña' }), password]),
            submit,
            h('div', { class: 'sidp-portal__divider' }, ['o']),
            google,
            status,
            switchRow
        ]);
        switchRow.appendChild(switchHint);
        switchRow.appendChild(document.createTextNode(' '));
        switchRow.appendChild(switchBtn);

        const sessionView = h('div', { class: 'sidp-portal__view sidp-portal__session', id: 'sidpPortalSession', hidden: true });
        const loginView = h('div', { class: 'sidp-portal__view', id: 'sidpPortalLogin' }, [badge, title, subtitle, form]);

        const content = h('div', { class: 'modal-content sidp-portal__content' }, [
            h('button', {
                class: 'sidp-portal__close', type: 'button', id: 'sidpPortalClose',
                'aria-label': 'Cerrar portal', onclick: () => close()
            }, ['×']),
            loginView,
            sessionView
        ]);

        const overlay = h('div', {
            class: 'modal-overlay sidp-portal', id: 'sidpPortalOverlay',
            role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'sidpPortalTitle',
            'data-portal-modal': 'true', 'aria-hidden': 'true',
            onclick: evt => { if (evt.target === overlay) close(); }
        }, [content]);

        overlay.style.setProperty('display', 'none', 'important');
        (document.body || document.documentElement).appendChild(overlay);

        let mode = 'login';

        function setMode(next) {
            mode = next;
            const register = mode === 'register';
            submit.textContent = register ? 'Crear cuenta y entrar' : COPY[activeIntent].submit;
            password.setAttribute('autocomplete', register ? 'new-password' : 'current-password');
            switchHint.textContent = register ? '¿Ya tienes cuenta?' : '¿Aún no tienes cuenta?';
            switchBtn.textContent = register ? 'Iniciar sesión' : 'Crear cuenta';
            setStatus('', 'info');
        }

        return {
            overlay, content, loginView, sessionView, form,
            email, password, submit, google, status,
            badge, title, subtitle, switchRow,
            setMode, getMode: () => mode
        };
    }

    function ensureUi() {
        if (!ui) ui = buildModal();
        return ui;
    }

    function setStatus(message, kind) {
        if (!ui) return;
        ui.status.textContent = message || '';
        ui.status.setAttribute('data-kind', kind || 'info');
    }

    function setBusy(next, label) {
        busy = !!next;
        if (!ui) return;
        ui.submit.disabled = busy;
        ui.google.disabled = busy;
        ui.submit.textContent = busy ? (label || 'Verificando…') : COPY[activeIntent].submit;
    }

    /* ── Apertura / cierre ──────────────────────────────────────────── */
    async function open(intent, trigger) {
        activeIntent = normalizeIntent(intent);
        lastTrigger = trigger || lastTrigger || null;

        const refs = ensureUi();
        const copy = COPY[activeIntent];
        refs.badge.textContent = activeIntent === 'admin' ? 'Acceso restringido' : 'Acceso clientes';
        refs.title.textContent = copy.title;
        refs.subtitle.textContent = copy.subtitle;
        refs.switchRow.style.display = copy.allowRegister ? '' : 'none';
        refs.google.disabled = false;
        refs.sessionView.hidden = true;
        refs.loginView.hidden = false;
        refs.setMode('login');
        setStatus(isOnline() ? 'Cargando Firebase Auth…' : 'Sin conexión: puedes continuar en modo invitado.', 'info');

        refs.overlay.classList.add('active');
        refs.overlay.setAttribute('aria-hidden', 'false');
        refs.overlay.style.removeProperty('display');
        if (document.body) document.body.classList.add('sidp-portal-open');
        refs.overlay.style.setProperty('pointer-events', 'auto', 'important');

        document.addEventListener('keydown', onKeydown, true);
        try { refs.email.focus(); } catch (e) { /* noop */ }

        /* Lógica de Firebase Auth: SDK + sesión previa */
        const fb = await ensureFirebase();
        if (!refs.overlay.classList.contains('active')) return { ok: false, reason: 'closed' };
        bindAuthListener(fb);

        if (!fb) {
            renderOfflineMode();
            return { ok: false, reason: 'firebase-unavailable', intent: activeIntent };
        }

        let user = null;
        try { user = fb.auth().currentUser; } catch (err) { warn(err && err.message); }

        if (user) {
            setStatus('Sesión detectada…', 'info');
            await onAuthenticated(user, activeIntent);
            return { ok: true, intent: activeIntent, user: user };
        }

        setStatus('Ingresa tus credenciales para continuar.', 'info');
        return { ok: true, intent: activeIntent, user: null };
    }

    function renderOfflineMode() {
        if (!ui) return;
        ui.google.disabled = true;
        ui.submit.disabled = true;
        setStatus('No pudimos conectar con Firebase Auth (sin red o dominio no autorizado).', 'error');
        const guest = h('button', {
            class: 'sidp-portal__btn sidp-portal__btn--ghost', type: 'button', id: 'sidpPortalGuest',
            onclick: () => finishSession(null, activeIntent, true)
        }, ['Continuar en modo invitado']);
        const existing = ui.form.querySelector('#sidpPortalGuest');
        if (existing) existing.remove();
        ui.form.appendChild(guest);
    }

    function close() {
        if (!ui) return;
        ui.overlay.classList.remove('active');
        ui.overlay.setAttribute('aria-hidden', 'true');
        ui.overlay.style.setProperty('display', 'none', 'important');
        if (document.body) document.body.classList.remove('sidp-portal-open');
        ui.overlay.style.setProperty('pointer-events', 'none', 'important');
        document.removeEventListener('keydown', onKeydown, true);
        const guest = ui.form.querySelector('#sidpPortalGuest');
        if (guest) guest.remove();
        ui.submit.disabled = false;
        ui.google.disabled = false;
        busy = false;
        if (lastTrigger && typeof lastTrigger.focus === 'function') {
            try { lastTrigger.focus(); } catch (e) { /* noop */ }
        }
    }

    function onKeydown(evt) {
        if (!evt) return;
        if (evt.key === 'Escape' || evt.key === 'Esc') {
            evt.preventDefault();
            close();
            return;
        }
        if (evt.key !== 'Tab' || !ui) return;
        /* Focus trap sencillo */
        const nodes = ui.overlay.querySelectorAll('button, input, [href], select, textarea');
        const focusables = Array.prototype.slice.call(nodes).filter(el => !el.disabled);
        if (!focusables.length) return;
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (evt.shiftKey && active === first) { evt.preventDefault(); last.focus(); }
        else if (!evt.shiftKey && active === last) { evt.preventDefault(); first.focus(); }
    }

    /* ── Acciones de autenticación ──────────────────────────────────── */
    async function submitEmailPassword() {
        if (busy) return;
        const refs = ensureUi();
        const emailValue = String(refs.email.value || '').trim();
        const passwordValue = String(refs.password.value || '');
        const registering = refs.getMode() === 'register';

        if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
            setStatus('Escribe un correo electrónico válido.', 'error');
            refs.email.focus();
            return;
        }
        if (passwordValue.length < 6) {
            setStatus('La contraseña debe tener al menos 6 caracteres.', 'error');
            refs.password.focus();
            return;
        }

        const fb = await ensureFirebase();
        if (!fb) { renderOfflineMode(); return; }

        setBusy(true, registering ? 'Creando cuenta…' : 'Verificando…');
        try {
            const auth = fb.auth();
            const credential = registering
                ? await auth.createUserWithEmailAndPassword(emailValue, passwordValue)
                : await auth.signInWithEmailAndPassword(emailValue, passwordValue);
            const user = (credential && credential.user) || auth.currentUser;
            if (registering && user && typeof user.updateProfile === 'function') {
                try { await user.updateProfile({ displayName: emailValue.split('@')[0] }); } catch (e) { /* noop */ }
            }
            await onAuthenticated(user, activeIntent);
        } catch (err) {
            setBusy(false);
            const message = friendlyAuthError(err);
            setStatus(message, 'error');
            warn('auth email/contraseña:', (err && (err.code || err.message)) || err);
            /* auth/operation-not-allowed o dominio no autorizado → modo invitado */
            if (/operation-not-allowed|unauthorized-domain|network-request-failed/.test(String((err && err.code) || ''))) {
                renderOfflineMode();
            }
        }
    }

    async function signInWithGoogle() {
        if (busy) return;
        const fb = await ensureFirebase();
        if (!fb) { renderOfflineMode(); return; }

        setBusy(true, 'Abriendo Google…');
        try {
            const provider = new fb.auth.GoogleAuthProvider();
            provider.setCustomParameters({ prompt: 'select_account' });
            const auth = fb.auth();
            let credential = null;
            try {
                credential = await auth.signInWithPopup(provider);
            } catch (popupErr) {
                const code = String((popupErr && popupErr.code) || '');
                if (/popup-blocked/.test(code)) {
                    setStatus('Continúa en la ventana que abrió el navegador…', 'info');
                    await auth.signInWithRedirect(provider);
                    return;
                }
                throw popupErr;
            }
            const user = (credential && credential.user) || auth.currentUser;
            await onAuthenticated(user, activeIntent);
        } catch (err) {
            setBusy(false);
            setStatus(friendlyAuthError(err), 'error');
            warn('auth Google:', (err && (err.code || err.message)) || err);
            if (/operation-not-allowed|unauthorized-domain|network-request-failed/.test(String((err && err.code) || ''))) {
                renderOfflineMode();
            }
        }
    }

    /* ── Rol + ruteo ────────────────────────────────────────────────── */
    async function resolveRole(user, intent) {
        const fallback = intent === 'admin' ? 'admin' : 'cliente';
        if (!user) return fallback;
        const fb = await ensureFirebase();
        if (!fb || typeof fb.firestore !== 'function') return fallback;

        let db = null;
        try { db = fb.firestore(); } catch (err) { warn('firestore:', err && err.message); return fallback; }

        try {
            const snap = await db.collection('users').doc(user.uid).get();
            if (snap && snap.exists) {
                const data = snap.data() || {};
                const role = data.role || data.rol || data.fallbackRole;
                if (role === 'admin' || role === 'cliente') return role;
            }
        } catch (err) {
            warn('no se pudo leer users/{uid}:', err && err.message);
        }

        if (user.email) {
            try {
                const adminSnap = await db.collection('admins').doc(user.email).get();
                if (adminSnap && adminSnap.exists) return 'admin';
            } catch (err) {
                warn('no se pudo leer admins/{email}:', err && err.message);
            }
        }
        return fallback;
    }

    async function persistProfile(fb, user, role) {
        if (!fb || !user || typeof fb.firestore !== 'function') return;
        try {
            const db = fb.firestore();
            const payload = {
                uid: user.uid,
                email: user.email || null,
                displayName: user.displayName || (user.email ? user.email.split('@')[0] : null),
                role: role,
                updatedAt: new Date().toISOString()
            };
            await db.collection('users').doc(user.uid).set(payload, { merge: true });
        } catch (err) {
            /* Las reglas exigen permisos; no bloqueamos el acceso por esto */
            warn('no se pudo guardar el perfil:', err && err.message);
        }
    }

    async function portalRouteIsLive(target) {
        if (typeof fetch !== 'function') return false;
        try {
            const res = await fetch(target, { method: 'GET', credentials: 'same-origin', cache: 'no-store' });
            if (!res || !res.ok) return false;
            const html = await res.text();
            /* El fallback SPA sirve index.html: exigimos el punto de montaje #app */
            return /id=["']app["']/.test(String(html || ''));
        } catch (err) {
            return false;
        }
    }

    async function onAuthenticated(user, intent) {
        ensureUi();
        /* onAuthStateChanged y la comprobación de currentUser pueden coincidir:
           se procesa una única vez por sesión + intent (evita trabajo doble). */
        const authKey = `${(user && user.uid) || 'anon'}::${intent}`;
        if (lastAuth.key === authKey && Date.now() - lastAuth.at < 3000) {
            return { ok: true, deduped: true, role: lastAuth.role };
        }
        lastAuth = { key: authKey, at: Date.now(), role: lastAuth.role };
        const fb = await ensureFirebase();
        setBusy(true, 'Preparando panel…');
        const role = await resolveRole(user, intent);
        lastAuth = { key: authKey, at: Date.now(), role: role };
        await persistProfile(fb, user, role);
        setBusy(false);

        if (intent === 'admin' && role !== 'admin') {
            setStatus('Tu cuenta no tiene permisos de administrador. Un administrador debe agregarte en Firestore (admins/{email}).', 'error');
            warn(`acceso admin denegado para ${user && user.email} (rol=${role})`);
            return { ok: false, reason: 'forbidden', role: role };
        }
        await finishSession(user, role, false);
        return { ok: true, role: role, user: user };
    }

    async function finishSession(user, role, guest) {
        ensureUi();
        const target = `${PORTAL_ROUTE}?intent=${role}`;
        const live = await portalRouteIsLive(target);

        try {
            sessionStorage.setItem('sidp-portal-intent', role);
            sessionStorage.setItem('sidp-portal-guest', guest ? '1' : '0');
            if (user && user.email) sessionStorage.setItem('sidp-portal-email', user.email);
        } catch (err) { /* almacenamiento no disponible */ }

        if (live && window.history && typeof history.replaceState === 'function') {
            try { history.replaceState({ sidpPortal: role }, '', target); } catch (err) { warn('replaceState:', err && err.message); }
        }

        renderSession({ user, role, guest, target, live });

        /* Punto de extensión: si el SPA del panel está cargado, que se monte. */
        if (typeof window.SIDPRenderPortal === 'function') {
            try { window.SIDPRenderPortal({ user, role, guest, target }); } catch (err) { warn('SIDPRenderPortal:', err && err.message); }
        }
        return { ok: true, role, target, live };
    }

    function renderSession(state) {
        const refs = ensureUi();
        const email = (state.user && state.user.email) || 'invitado@sidpesaje.com';
        const initials = email.slice(0, 2).toUpperCase();
        const roleLabel = state.role === 'admin' ? 'Administrador' : 'Cliente';

        refs.sessionView.innerHTML = '';
        refs.sessionView.appendChild(h('div', { class: 'sidp-portal__avatar' }, [initials]));
        refs.sessionView.appendChild(h('h2', { class: 'sidp-portal__title', text: state.guest ? 'Modo invitado' : 'Sesión iniciada' }));
        refs.sessionView.appendChild(h('p', { class: 'sidp-portal__subtitle', text: email }));
        refs.sessionView.appendChild(h('span', { class: 'sidp-portal__role', text: `Rol: ${roleLabel}` }));

        const actions = h('div', { class: 'sidp-portal__actions' });
        if (state.live) {
            actions.appendChild(h('a', {
                class: 'sidp-portal__btn', href: state.target,
                onclick: () => { try { sessionStorage.setItem('sidp-portal-intent', state.role); } catch (e) { /* noop */ } }
            }, ['Continuar al panel']));
        } else {
            actions.appendChild(h('p', {
                class: 'sidp-portal__status', 'data-kind': 'info',
                text: `La ruta ${PORTAL_ROUTE} no está disponible en este entorno. Tu sesión queda activa y el rol guardado.`
            }));
        }
        if (!state.guest) {
            actions.appendChild(h('button', {
                class: 'sidp-portal__btn sidp-portal__btn--ghost', type: 'button', onclick: () => signOut()
            }, ['Cerrar sesión']));
        }
        actions.appendChild(h('button', {
            class: 'sidp-portal__btn sidp-portal__btn--ghost', type: 'button', onclick: () => close()
        }, ['Volver al sitio']));

        refs.sessionView.appendChild(actions);
        refs.loginView.hidden = true;
        refs.sessionView.hidden = false;
        setStatus('', 'info');
    }

    async function signOut() {
        const fb = await ensureFirebase();
        try {
            if (fb) await fb.auth().signOut();
        } catch (err) {
            warn('signOut:', err && err.message);
        }
        try {
            sessionStorage.removeItem('sidp-portal-intent');
            sessionStorage.removeItem('sidp-portal-guest');
            sessionStorage.removeItem('sidp-portal-email');
        } catch (err) { /* noop */ }
        lastAuth = { key: null, at: 0, role: null };
        if (ui) {
            ui.sessionView.hidden = true;
            ui.loginView.hidden = false;
            ui.password.value = '';
            setStatus('Sesión cerrada.', 'success');
        }
    }

    /* ── API pública del módulo ─────────────────────────────────────── */
    return {
        open,
        close,
        signOut,
        get intent() { return activeIntent; },
        get isOpen() { return !!(ui && ui.overlay.classList.contains('active')); },
        config: { route: PORTAL_ROUTE, projectId: FIREBASE_CONFIG.projectId }
    };
})();

/* API pública (no depende del alcance léxico de main.js) */
window.SIDPPortal = SIDP_PORTAL;

/* ─────────────────────────────────────────────────────────────────────
   FUNCIÓN GLOBAL DE ACCESO AL PORTAL
   Declaración explícita en window: es lo que invocan los botones
   "Entrar como Cliente" / "Entrar como Administrador" de index.html.
   Acepta 'cliente' (por defecto) o 'admin'.
   ───────────────────────────────────────────────────────────────────── */
window.abrirPortalClientes = function (intent) {
    // lógica de Firebase Auth aquí
    try {
        const trigger = (typeof document !== 'undefined' && document.activeElement) || null;
        const result = SIDP_PORTAL.open(intent, trigger);
        /* Nunca dejamos una promesa rechazada sin manejar → consola limpia */
        if (result && typeof result.catch === 'function') {
            result.catch(err => console.warn('[portal] apertura interrumpida:', err && err.message));
        }
        return result;
    } catch (err) {
        /* Red de seguridad: ni un clic puede volver a lanzar un TypeError */
        console.warn('[portal] no se pudo abrir el portal:', err && err.message);
        try {
            const role = String(intent || 'cliente').toLowerCase().indexOf('admin') === 0 ? 'admin' : 'cliente';
            window.location.href = `/agenda?intent=${role}`;
        } catch (navErr) {
            /* noop */
        }
        return null;
    }
};

/* ─────────────────────────────────────────────────────────────────────
   LISTENER DELEGADO EQUIVALENTE
   Respaldo del onclick inline: funciona aunque un CSP prohíba los
   manejadores en línea. Se ignora cuando el botón ya trae onclick para
   no abrir el portal dos veces.
   ───────────────────────────────────────────────────────────────────── */
document.addEventListener('click', function onPortalDelegatedClick(event) {
    try {
        const trigger = event && event.target && typeof event.target.closest === 'function'
            ? event.target.closest('[data-portal-intent]')
            : null;
        if (!trigger) return;
        event.preventDefault();
        if (trigger.hasAttribute('onclick')) return; // el inline ya lo gestiona
        window.abrirPortalClientes(trigger.getAttribute('data-portal-intent'));
    } catch (err) {
        console.warn('[portal] listener delegado:', err && err.message);
    }
}, true);

// ═══════════════════════════════════════════════════════
// 1. BOOTSTRAP DE LA PÁGINA
// ═══════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {

    // Safety reset — remove stale lock classes
    document.body.classList.remove('sidebar-open');

    // ═══════════════════════════════════════════════════
    // 0.5. THEME TOGGLE LOGIC
    // ═══════════════════════════════════════════════════
    const themeToggle = document.getElementById('themeToggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            // Add transition class for smooth color changes without breaking other transitions
            document.documentElement.classList.add('theme-transition');
            
            const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
            const app = document.getElementById('app');
            if (isDark) {
                document.documentElement.setAttribute('data-theme', 'light');
                if (app) app.setAttribute('data-theme', 'light');
                localStorage.setItem('sidp-theme', 'light');
            } else {
                document.documentElement.setAttribute('data-theme', 'dark');
                if (app) app.setAttribute('data-theme', 'dark');
                localStorage.setItem('sidp-theme', 'dark');
            }
            
            // Remove transition class after animation completes
            setTimeout(() => {
                document.documentElement.classList.remove('theme-transition');
            }, 600);
        });
    }

    // Advanced custom cursor removed for native OS cursor performance

    // ═══════════════════════════════════════════════════
    // 2. NAVBAR SCROLL EFFECT (enhanced)
    // ═══════════════════════════════════════════════════
    const navbar = document.getElementById('navbar');

    window.addEventListener('scroll', () => {
        if (window.scrollY > 60) {
            navbar.classList.add('nav--scrolled');
        } else {
            navbar.classList.remove('nav--scrolled');
        }
    }, { passive: true });



    // ═══════════════════════════════════════════════════
    // 4. ACTIVE NAV LINK
    // ═══════════════════════════════════════════════════
    const sections = document.querySelectorAll('section[id]');
    window.addEventListener('scroll', () => {
        const scrollPos = window.scrollY + 200;
        sections.forEach(section => {
            const top = section.offsetTop;
            const height = section.offsetHeight;
            const id = section.getAttribute('id');
            if (scrollPos >= top && scrollPos < top + height) {
                document.querySelectorAll('.nav__link').forEach(link => {
                    link.classList.remove('active');
                    if (link.getAttribute('href') === `#${id}`) link.classList.add('active');
                });
            }
        });
    }, { passive: true });

    // ═══════════════════════════════════════════════════
    // 5. SCROLL-DRIVEN ANIMATION ENGINE
    //    Every element gets continuous scroll-aware transforms
    // ═══════════════════════════════════════════════════

    // Reveal observer — staggered entrance with varied animations
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = parseInt(entry.target.dataset.delay) || 0;
                setTimeout(() => {
                    entry.target.classList.add('revealed');
                }, delay);
            } else {
                entry.target.classList.remove('revealed');
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal-element').forEach(el => revealObserver.observe(el));

    // Metric & contact cards reveal
    const batchRevealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const selector = entry.target.dataset.revealChildren;
                const children = entry.target.querySelectorAll(selector);
                children.forEach((child, i) => {
                    setTimeout(() => child.classList.add('revealed'), i * 120);
                });
            } else {
                const selector = entry.target.dataset.revealChildren;
                entry.target.querySelectorAll(selector).forEach(child => {
                    child.classList.remove('revealed');
                });
            }
        });
    }, { threshold: 0.2 });

    document.querySelectorAll('[data-reveal-children]').forEach(el => batchRevealObserver.observe(el));

    // ═══════════════════════════════════════════════════
    // 6. CONTINUOUS SCROLL-DRIVEN PARALLAX ENGINE
    //    Multi-layer parallax on EVERY section
    // ═══════════════════════════════════════════════════

    const parallaxElements = [];

    // Register parallax elements
    document.querySelectorAll('[data-parallax]').forEach(el => {
        parallaxElements.push({
            el,
            speed: parseFloat(el.dataset.parallax) || 0.1,
            rotate: parseFloat(el.dataset.parallaxRotate) || 0,
            scale: parseFloat(el.dataset.parallaxScale) || 0,
            opacity: el.dataset.parallaxOpacity === 'true',
        });
    });

    // ─── HERO: IMMERSIVE SCROLL ────────────────────────────────────────
    // El parallax del hero ya no se escribe aquí con estilos inline: esos
    // valores quedaban anulados por `.reveal-element.revealed { opacity: 1
    // !important; transform: translateY(0) !important }` de emergency-fix.css,
    // de modo que el efecto estaba muerto. Ahora todo el estado del hero lo
    // calcula js/hero-immersive.js sobre variables CSS (--hero-ui-progress,
    // --hero-bg-scale, --hero-bg-shift, --hero-tint) que SÍ se consumen dentro
    // de las declaraciones !important, y las curvas largas viven en
    // hero-polish.css. Aquí sólo se le cede el turno en cada frame.
    function driveHeroImmersive() {
        if (window.SIDPHero && typeof window.SIDPHero.sync === 'function') {
            window.SIDPHero.sync(false);
        }
    }

    // All section headers for scroll-driven animations
    const sectionHeaders = document.querySelectorAll('.section__header');
    const allCards = document.querySelectorAll('.award-card, .product-card, .service-card, .about__card, .metric, .contact__info-card');

    function handleScrollAnimations() {
        const scrollY = window.scrollY;
        const vh = window.innerHeight;
        // (scrollPercent eliminado: no se usaba y leía document.body.scrollHeight
        //  en cada frame, forzando un reflujo de layout en pleno scroll.)

        // ─── HERO — Immersive Scroll (delegado al motor dedicado) ───
        driveHeroImmersive();

        // ─── REGISTERED PARALLAX ELEMENTS ───
        parallaxElements.forEach(({ el, speed, rotate, scale, opacity }) => {
            const rect = el.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const distFromCenter = (centerY - vh / 2) / vh;

            let transform = `translateY(${distFromCenter * speed * -100}px)`;

            if (rotate) {
                transform += ` rotate(${distFromCenter * rotate}deg)`;
            }
            if (scale) {
                const s = 1 + (1 - Math.abs(distFromCenter)) * scale;
                transform += ` scale(${s})`;
            }

            el.style.transform = transform;

            if (opacity) {
                el.style.opacity = Math.max(0.2, 1 - Math.abs(distFromCenter) * 1.5);
            }
        });

        // ─── SECTION HEADERS — Scroll-driven text entrance ───
        sectionHeaders.forEach(header => {
            const rect = header.getBoundingClientRect();
            const progress = 1 - Math.max(0, Math.min(1, (rect.top - vh * 0.3) / (vh * 0.5)));
            const title = header.querySelector('.section__title');
            const label = header.querySelector('.section__label');
            const subtitle = header.querySelector('.section__subtitle');

            if (title && progress > 0) {
                title.style.transform = `translateY(${(1 - progress) * 30}px)`;
                title.style.opacity = progress;
            }
            if (label && progress > 0) {
                label.style.transform = `translateY(${(1 - progress) * 20}px)`;
                label.style.opacity = Math.min(1, progress * 1.5);
            }
            if (subtitle && progress > 0) {
                subtitle.style.transform = `translateY(${(1 - progress) * 40}px)`;
                subtitle.style.opacity = Math.max(0, progress - 0.2);
            }
        });

        // ─── CARDS — Continuous scroll-aware tilt ───
        if (!emergencyFixMode) {
            allCards.forEach(card => {
            const rect = card.getBoundingClientRect();
            const centerY = rect.top + rect.height / 2;
            const distFromCenter = (centerY - vh / 2) / vh;

            // Subtle tilt based on scroll position
            const tiltX = distFromCenter * 3;
            const translateY = distFromCenter * 8;

            if (Math.abs(distFromCenter) < 1.2) {
                card.style.transform = card.classList.contains('revealed')
                    ? `perspective(800px) rotateX(${tiltX}deg) translateY(${translateY}px)`
                    : card.style.transform;
            }
            });
        }

        // ─── FLOATING DECORATIONS — Continuous movement ───
        document.querySelectorAll('.floating-shape').forEach((shape, i) => {
            const speed = 0.02 + (i * 0.008);
            const offset = i * 100;
            shape.style.transform = `translateY(${Math.sin(scrollY * speed + offset) * 15}px) rotate(${scrollY * (0.02 + i * 0.01)}deg)`;
        });
    }

    // Optimized scroll handler with RAF
    let ticking = false;
    window.addEventListener('scroll', () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                handleScrollAnimations();
                ticking = false;
            });
            ticking = true;
        }
    }, { passive: true });

    // Initial call
    handleScrollAnimations();

    // ═══════════════════════════════════════════════════
    // 7. COUNTER ANIMATION (enhanced with easing)
    // ═══════════════════════════════════════════════════

    function animateCounter(element, target) {
        const duration = 2200;
        const start = performance.now();

        function update(currentTime) {
            const elapsed = currentTime - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 5);
            element.textContent = Math.round(target * eased);
            if (progress < 1) requestAnimationFrame(update);
        }
        requestAnimationFrame(update);
    }

    const counterObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.querySelectorAll('[data-count]').forEach(el => {
                    const target = parseInt(el.dataset.count);
                    if (target) setTimeout(() => animateCounter(el, target), 200);
                });
                counterObserver.unobserve(entry.target);
            }
        });
    }, { threshold: 0.3 });

    document.querySelectorAll('.hero__stats, .about__metrics').forEach(el => counterObserver.observe(el));

    // ═══════════════════════════════════════════════════
    // 8. PRODUCT CARD 3D TILT (hyper-responsive)
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.product-card').forEach(card => {
            const shine = document.createElement('div');
            shine.className = 'card-shine';
            card.appendChild(shine);

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;

                const rotateX = (y - 0.5) * -12;
                const rotateY = (x - 0.5) * 12;

                card.style.transform = `perspective(600px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-12px) scale(1.02)`;
                shine.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,0.15), transparent 60%)`;
                shine.style.opacity = '1';
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                shine.style.opacity = '0';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 9. SERVICE CARD HOVER EFFECTS & 3D TILT
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.service-plus-card').forEach(card => {
            const shine = document.createElement('div');
            shine.className = 'card-shine';
            card.appendChild(shine);

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;

                const rotateX = (y - 0.5) * -10;
                const rotateY = (x - 0.5) * 10;

                card.style.transform = `perspective(800px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-8px) scale(1.02)`;
                shine.style.background = `radial-gradient(circle at ${x * 100}% ${y * 100}%, rgba(255,255,255,0.1), transparent 60%)`;
                shine.style.opacity = '1';

                const icon = card.querySelector('.service-plus-card__icon-wrapper');
                if (icon) {
                    icon.style.transform = `scale(1.1) translateZ(20px)`;
                }
            });

            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
                shine.style.opacity = '0';

                const icon = card.querySelector('.service-plus-card__icon-wrapper');
                if (icon) {
                    icon.style.transform = '';
                }
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 10. ABOUT CARD HOVER (icon rotation)
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.about__card').forEach(card => {
            const icon = card.querySelector('.about__card-icon');
            card.addEventListener('mouseenter', () => {
                if (icon) icon.style.transform = 'scale(1.15) rotate(8deg)';
            });
            card.addEventListener('mouseleave', () => {
                if (icon) icon.style.transform = '';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 11. AWARD CARD HOVER (icon pulse)
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.award-card').forEach(card => {
            const icon = card.querySelector('.award-card__icon');
            card.addEventListener('mouseenter', () => {
                if (icon) icon.style.transform = 'scale(1.2) translateY(-4px)';
            });
            card.addEventListener('mouseleave', () => {
                if (icon) icon.style.transform = '';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 12. BUTTON MAGNETIC EFFECT
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.btn').forEach(btn => {
            btn.addEventListener('mousemove', (e) => {
                const rect = btn.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                btn.style.transform = `translate(${x * 0.2}px, ${y * 0.2}px) scale(1.05)`;
            });

            btn.addEventListener('mouseleave', () => {
                btn.style.transform = '';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 13. NAV LINK HOVER UNDERLINE ANIMATION
    // ═══════════════════════════════════════════════════

    document.querySelectorAll('.nav__link:not(.nav__link--cta)').forEach(link => {
        const underline = document.createElement('span');
        underline.className = 'nav__link-underline';
        link.appendChild(underline);
    });

    // ═══════════════════════════════════════════════════
    // 14. SMOOTH SCROLL
    // ═══════════════════════════════════════════════════

    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', (e) => {
            e.preventDefault();
            const target = document.querySelector(anchor.getAttribute('href'));
            if (target) {
                window.scrollTo({ top: target.offsetTop - 80, behavior: emergencyFixMode ? 'auto' : 'smooth' });
            }
        });
    });

    // ═══════════════════════════════════════════════════
    // 15. FORM INTERACTIONS (enhanced)
    // ═══════════════════════════════════════════════════

    const contactForm = document.getElementById('contactForm');
    if (contactForm) {
        contactForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const btn = contactForm.querySelector('.btn--primary');
            const originalText = btn.innerHTML;
            btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" class="spin-icon"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> Enviando...`;
            btn.disabled = true;
            setTimeout(() => {
                btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg> ¡Mensaje Enviado!`;
                btn.style.background = 'linear-gradient(135deg, #1a7a1a, #0f5c0f)';
                setTimeout(() => {
                    btn.innerHTML = originalText;
                    btn.style.background = '';
                    btn.disabled = false;
                    contactForm.reset();
                }, 2500);
            }, 1500);
        });
    }

    // ═══════════════════════════════════════════════════
    // 16. HERO TEXT SPLIT REVEAL (letter-by-letter)
    // ═══════════════════════════════════════════════════

    function splitTextReveal(element, delay = 0) {
        if (!element) return;
        const text = element.textContent;
        element.innerHTML = '';
        element.style.opacity = '1';

        text.split('').forEach((char, i) => {
            const span = document.createElement('span');
            span.textContent = char === ' ' ? '\u00A0' : char;
            span.className = 'char-reveal';
            span.style.animationDelay = `${delay + i * 25}ms`;
            element.appendChild(span);
        });
    }

    // Apply to hero label
    setTimeout(() => {
        const heroLabelEl = document.querySelector('.hero__label');
        if (heroLabelEl && heroLabelEl.classList.contains('revealed')) {
            splitTextReveal(heroLabelEl, 0);
        }
    }, 400);

    // ═══════════════════════════════════════════════════
    // 17. HERO ENTRANCE ANIMATION
    // ═══════════════════════════════════════════════════

    setTimeout(() => {
        document.querySelectorAll('.hero .reveal-element').forEach(el => {
            const delay = parseInt(el.dataset.delay) || 0;
            setTimeout(() => el.classList.add('revealed'), delay);
        });
    }, 100);

    // ═══════════════════════════════════════════════════
    // 18. STATS HOVER — RIPPLE EFFECT
    // ═══════════════════════════════════════════════════

    document.querySelectorAll('.hero__stat, .metric').forEach(stat => {
        stat.addEventListener('click', (e) => {
            const ripple = document.createElement('span');
            ripple.className = 'ripple';
            const rect = stat.getBoundingClientRect();
            ripple.style.left = (e.clientX - rect.left) + 'px';
            ripple.style.top = (e.clientY - rect.top) + 'px';
            stat.appendChild(ripple);
            setTimeout(() => ripple.remove(), 800);
        });
    });

    // ═══════════════════════════════════════════════════
    // 19. CONTINUOUS IDLE ANIMATIONS (always alive)
    // ═══════════════════════════════════════════════════

    function idleAnimations(time) {
        // Floating shapes gentle movement
        document.querySelectorAll('.floating-shape').forEach((shape, i) => {
            const x = Math.sin(time * 0.0008 + i * 1.5) * 10;
            const y = Math.cos(time * 0.0006 + i * 2) * 8;
            const r = Math.sin(time * 0.0004 + i) * 5;
            shape.style.transform = `translate(${x}px, ${y}px) rotate(${r}deg)`;
        });

        // Logo gentle pulse
        const logo = document.querySelector('.nav__logo-img');
        if (logo) {
            const pulse = 1 + Math.sin(time * 0.002) * 0.02;
            logo.style.transform = `scale(${pulse})`;
        }

        // Scroll line pulse
        const scrollLine = document.querySelector('.hero__scroll-line');
        if (scrollLine) {
            scrollLine.style.height = `${48 + Math.sin(time * 0.003) * 10}px`;
        }

        requestAnimationFrame(idleAnimations);
    }
    requestAnimationFrame(idleAnimations);

    // ═══════════════════════════════════════════════════
    // 20. CONTACT INFO CARD TILT ON HOVER
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.contact__info-card').forEach(card => {
            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width - 0.5;
                const y = (e.clientY - rect.top) / rect.height - 0.5;
                card.style.transform = `perspective(600px) rotateX(${y * -6}deg) rotateY(${x * 6}deg) translateX(6px)`;
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = '';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 21. SECTION BACKGROUND PARALLAX
    // ═══════════════════════════════════════════════════

    const sectionsBg = document.querySelectorAll('.awards, .services, .contact');
    window.addEventListener('scroll', () => {
        sectionsBg.forEach(section => {
            const rect = section.getBoundingClientRect();
            if (rect.top < window.innerHeight && rect.bottom > 0) {
                const progress = (window.innerHeight - rect.top) / (window.innerHeight + rect.height);
                section.style.backgroundPosition = `center ${50 + (progress - 0.5) * 20}%`;
            }
        });
    }, { passive: true });

    // ═══════════════════════════════════════════════════
    // 22. LIQUID GLASS REFRACTION ENGINE
    //     Dynamic SVG turbulence + mouse/scroll interaction
    // ═══════════════════════════════════════════════════

    const liquidGlass = (() => {
        if (emergencyFixMode) return null;

        // SVG filter elements
        const turbNav = document.getElementById('turb-nav');
        const turbCards = document.getElementById('turb-cards');
        const turbSections = document.getElementById('turb-sections');
        const dispNav = document.getElementById('disp-nav');
        const dispCards = document.getElementById('disp-cards');
        const dispSections = document.getElementById('disp-sections');

        if (!turbNav || !turbCards || !turbSections) return null;

        // State
        let lerpMX = 0.5, lerpMY = 0.5; // lerped mouse position (0-1)
        let scrollFactor = 0;
        let seed = 1;
        let lastTime = 0;

        // Smooth mouse tracking
        document.addEventListener('mousemove', (e) => {
            lerpMX += ((e.clientX / window.innerWidth) - lerpMX) * 0.08;
            lerpMY += ((e.clientY / window.innerHeight) - lerpMY) * 0.08;
        });

        // Animation loop
        function animate(time) {
            const delta = time - lastTime;
            lastTime = time;

            const scrollY = window.scrollY;
            const vh = window.innerHeight;
            scrollFactor = Math.min(1, scrollY / (vh * 0.8));

            // Organic seed evolution (slow, constant motion)
            if (delta > 0) {
                seed += delta * 0.0003;
                if (seed > 1000) seed = 1;
            }

            // ─── NAV FILTER: subtle constant organic motion ───
            const navFreqX = 0.012 + Math.sin(time * 0.0004) * 0.003 + lerpMX * 0.004;
            const navFreqY = 0.018 + Math.cos(time * 0.0003) * 0.003 + lerpMY * 0.003;
            const navScale = 2 + scrollFactor * 2 + Math.sin(time * 0.001) * 0.5;

            turbNav.setAttribute('baseFrequency', `${navFreqX.toFixed(4)} ${navFreqY.toFixed(4)}`);
            turbNav.setAttribute('seed', Math.floor(seed));
            dispNav.setAttribute('scale', navScale.toFixed(2));

            // ─── CARDS FILTER: responsive to mouse distance ───
            const cardFreqX = 0.01 + lerpMX * 0.006 + Math.sin(time * 0.0005) * 0.002;
            const cardFreqY = 0.015 + lerpMY * 0.005 + Math.cos(time * 0.0004) * 0.002;
            const cardScale = 3 + Math.sin(time * 0.0008) * 1;

            turbCards.setAttribute('baseFrequency', `${cardFreqX.toFixed(4)} ${cardFreqY.toFixed(4)}`);
            turbCards.setAttribute('seed', Math.floor(seed + 3));
            dispCards.setAttribute('scale', cardScale.toFixed(2));

            // ─── SECTIONS FILTER: slow, breathing distortion ───
            const secFreqX = 0.006 + Math.sin(time * 0.0002) * 0.002;
            const secFreqY = 0.008 + Math.cos(time * 0.00025) * 0.002;
            const secScale = 1.5 + scrollFactor * 1 + Math.sin(time * 0.0006) * 0.5;

            turbSections.setAttribute('baseFrequency', `${secFreqX.toFixed(4)} ${secFreqY.toFixed(4)}`);
            turbSections.setAttribute('seed', Math.floor(seed + 7));
            dispSections.setAttribute('scale', secScale.toFixed(2));

            requestAnimationFrame(animate);
        }

        requestAnimationFrame(animate);

        return { getScrollFactor: () => scrollFactor };
    })();

    // ═══════════════════════════════════════════════════
    // 23. LIQUID GLASS CURSOR GLOW ON CARDS
    //     Subtle radial glow follows mouse on glass cards
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        const glassCards = document.querySelectorAll(
            '.product-card, .service-plus-card, .award-card, .about__card, .benefit-glass, .team-card, .contact__info-card'
        );

        glassCards.forEach(card => {
            const glow = document.createElement('div');
            glow.className = 'liquid-glass-cursor-glow';
            card.style.position = card.style.position || 'relative';
            card.appendChild(glow);

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                glow.style.left = `${x}px`;
                glow.style.top = `${y}px`;
                glow.style.opacity = '1';
            });

            card.addEventListener('mouseleave', () => {
                glow.style.opacity = '0';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 24. ENHANCED PRODUCT CARD 3D WITH LIQUID DEPTH
    //     Extends existing tilt with translateZ for depth
    // ═══════════════════════════════════════════════════

    if (!emergencyFixMode) {
        document.querySelectorAll('.product-card').forEach(card => {
            const img = card.querySelector('.product-card__image');
            if (!img) return;

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = (e.clientX - rect.left) / rect.width;
                const y = (e.clientY - rect.top) / rect.height;

                // Enhanced 3D depth with translateZ
                const rotateX = (y - 0.5) * -14;
                const rotateY = (x - 0.5) * 14;
                const translateZ = 20 + (1 - Math.abs(x - 0.5) * 2) * 15;

                img.style.transform = `perspective(800px) rotateX(${rotateX * 0.3}deg) rotateY(${rotateY * 0.3}deg) scale(1.06) translateZ(${translateZ}px)`;
            });

            card.addEventListener('mouseleave', () => {
                img.style.transform = '';
            });
        });
    }

    // ═══════════════════════════════════════════════════
    // 25. TECH SPEC MODALS
    // ═══════════════════════════════════════════════════
    const techSpecs = {
        'industriales': { title: 'Industriales', desc: 'Equipos de alta capacidad para entornos de producción exigentes. Estructura reforzada y durabilidad superior.' },
        'camioneras': { title: 'Camioneras', desc: 'Sistemas diseñados para el pesaje de vehículos de carga pesada con máxima precisión en cada eje.' },
        'ganaderas': { title: 'Ganaderas', desc: 'Plataformas especializadas para el pesaje de ganado, con sistemas de estabilización de peso y superficies antideslizantes.' },
        'plataforma': { title: 'Plataforma', desc: 'Soluciones versátiles para el pesaje de mercancía general en bodegas y puntos de despacho.' },
        'gruas': { title: 'Para Grúas', desc: 'Dispositivos de pesaje suspendido para carga aérea, ideales para logística y movimiento de materiales.' },
        'precision': { title: 'De Precisión', desc: 'Equipos de alta resolución para joyería y procesos industriales que requieren medidas exactas en gramos.' },
        'comerciales': { title: 'Comerciales', desc: 'Diseñadas para puntos de venta con funciones de cálculo automático y pantallas de visualización claras.' },
        'ind-balanzas': { title: 'Industriales', desc: 'Balanzas compactas de alto rendimiento para control de calidad y producción en planta.' },
        'contadoras': { title: 'Contadoras', desc: 'Tecnología avanzada para el conteo automático de piezas basado en peso unitario, optimizando inventarios.' },
        'laboratorio': { title: 'Para Laboratorio', desc: 'Instrumentos analíticos de máxima sensibilidad para entornos químicos, científicos y médicos.' }
    };

    const techModal = document.getElementById('techSpecModal');
    const techModalOverlay = document.getElementById('techModalOverlay');
    const techModalClose = document.getElementById('techModalClose');
    const techModalTitle = document.getElementById('techModalTitle');
    const techModalDesc = document.getElementById('techModalDesc');

    if (techModal) {
        document.querySelectorAll('.tech-spec-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const specId = link.getAttribute('data-spec');
                const data = techSpecs[specId];
                if (data) {
                    techModalTitle.textContent = data.title;
                    techModalDesc.textContent = data.desc;
                    techModal.classList.add('active');
                    techModal.setAttribute('aria-hidden', 'false');
                }
            });
        });

        const closeTechModal = () => {
            techModal.classList.remove('active');
            techModal.setAttribute('aria-hidden', 'true');
        };

        techModalClose.addEventListener('click', closeTechModal);
        techModalOverlay.addEventListener('click', closeTechModal);
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && techModal.classList.contains('active')) {
                closeTechModal();
            }
        });
    }

});

// Global styles for dynamic elements
const dynamicStyles = document.createElement('style');
dynamicStyles.textContent = `
    @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
    .spin-icon { animation: spin 1s linear infinite; }

    @keyframes charReveal {
        from { opacity: 0; transform: translateY(10px) rotateX(40deg); filter: blur(4px); }
        to   { opacity: 1; transform: translateY(0) rotateX(0deg); filter: blur(0); }
    }
    .char-reveal {
        display: inline-block;
        opacity: 0;
        animation: charReveal 0.5s var(--ease-out-expo, cubic-bezier(0.16,1,0.3,1)) forwards;
    }

    .card-shine {
        position: absolute;
        inset: 0;
        border-radius: inherit;
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.3s ease;
        z-index: 10;
    }

    .ripple {
        position: absolute;
        border-radius: 50%;
        background: rgba(204, 0, 0, 0.15);
        width: 10px;
        height: 10px;
        transform: translate(-50%, -50%) scale(0);
        animation: rippleEffect 0.8s ease-out forwards;
        pointer-events: none;
    }
    @keyframes rippleEffect {
        to { transform: translate(-50%, -50%) scale(20); opacity: 0; }
    }

    .nav__link-underline {
        position: absolute;
        bottom: 0;
        left: 50%;
        width: 0;
        height: 2px;
        background: var(--primary, #cc0000);
        transition: all 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        transform: translateX(-50%);
        border-radius: 1px;
    }
    .nav__link:hover .nav__link-underline {
        width: 70%;
    }
`;
document.head.appendChild(dynamicStyles);

// ═══════════════════════════════════════════════════════
// SID-AI VIRTUAL ASSISTANT — Chat Engine
// Keyword-based auto-response + UI management
// ═══════════════════════════════════════════════════════

(function initSidAI() {
    const trigger = document.getElementById('sidaiTrigger');
    const chat = document.getElementById('sidaiChat');
    const backdrop = document.getElementById('sidaiBackdrop');
    const closeBtn = document.getElementById('sidaiClose');
    const input = document.getElementById('sidaiInput');
    const sendBtn = document.getElementById('sidaiSend');
    const messagesContainer = document.getElementById('sidaiMessages');

    if (!trigger || !chat) return;

    let isOpen = false;

    // ─── OPEN/CLOSE ───
    function toggleChat() {
        const isCurrentlyOpen = chat.classList.contains('open');
        console.log('[SID-AI] Toggling chat. Current state open:', isCurrentlyOpen);
        
        if (!isCurrentlyOpen) {
            chat.classList.add('open');
            backdrop.classList.add('active');
            trigger.classList.add('active');
            trigger.style.animation = 'none';
            console.log('[SID-AI] Chat opened. Classes added to:', chat.id, backdrop.id, trigger.id);
            setTimeout(() => input.focus(), 400);
        } else {
            chat.classList.remove('open');
            backdrop.classList.remove('active');
            trigger.classList.remove('active');
            trigger.style.animation = '';
            console.log('[SID-AI] Chat closed. Classes removed from:', chat.id, backdrop.id, trigger.id);
        }
    }

    trigger.addEventListener('click', toggleChat);
    closeBtn.addEventListener('click', toggleChat);
    backdrop.addEventListener('click', toggleChat);

    // ─── MESSAGE RENDERING ───
    function getTimeStr() {
        const now = new Date();
        return now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
    }

    function addMessage(text, sender = 'bot') {
        // Remove chips after first interaction
        const chips = messagesContainer.querySelector('.sidai-chat__chips');
        if (chips) chips.remove();

        const msg = document.createElement('div');
        msg.className = `sidai-msg sidai-msg--${sender}`;
        msg.innerHTML = `
            <div class="sidai-msg__bubble">${text}</div>
            <span class="sidai-msg__time">${getTimeStr()}</span>
        `;
        messagesContainer.appendChild(msg);
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
        return msg;
    }

    function showTyping() {
        const typing = document.createElement('div');
        typing.className = 'sidai-typing';
        typing.id = 'sidaiTyping';
        typing.innerHTML = `
            <span class="sidai-typing__dot"></span>
            <span class="sidai-typing__dot"></span>
            <span class="sidai-typing__dot"></span>
        `;
        messagesContainer.appendChild(typing);
        messagesContainer.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });
        return typing;
    }

    function removeTyping() {
        const t = document.getElementById('sidaiTyping');
        if (t) t.remove();
    }

    // ─── KEYWORD RESPONSE ENGINE ───
    const responses = [
        {
            keywords: ['báscula', 'basculas', 'bascula', 'camionera', 'camioneras', 'camión', 'camion', 'truck'],
            response: '🚛 <strong>Básculas Camioneras SID</strong><br><br>Ofrecemos básculas camioneras de alta precisión con capacidades desde 30 hasta 120 toneladas. Nuestras plataformas están fabricadas en acero estructural de alta resistencia con celdas de carga de grado industrial.<br><br>✅ Instalación completa incluida<br>✅ Software de gestión integrado<br>✅ Garantía de 2 años<br>✅ Soporte técnico 24/7<br><br>¿Te gustaría solicitar una cotización personalizada?'
        },
        {
            keywords: ['balanza', 'balanzas', 'precisión', 'precision', 'analítica', 'analitica', 'laboratorio', 'gramera'],
            response: '⚖️ <strong>Balanzas de Precisión</strong><br><br>Contamos con balanzas analíticas y de precisión para laboratorio, comerciales, contadoras e industriales. Resolución desde 0.001g hasta 0.1g.<br><br>🔬 Balanzas analíticas de laboratorio<br>🏪 Balanzas comerciales certificadas<br>🏭 Balanzas industriales de plataforma<br>📦 Balanzas contadoras de piezas<br><br>¿Necesitas asesoría para elegir la balanza adecuada para tu operación?'
        },
        {
            keywords: ['servicio', 'servicios', 'técnico', 'tecnico', 'mantenimiento', 'reparación', 'reparacion'],
            response: '🔧 <strong>Servicios Técnicos Especializados</strong><br><br>Nuestro equipo de ingenieros certificados ofrece:<br><br>🛠️ <strong>Mantenimiento preventivo</strong> — Programa personalizado<br>🔄 <strong>Mantenimiento correctivo</strong> — Respuesta en menos de 24 horas<br>📐 <strong>Calibración</strong> — Con certificados trazables<br>💻 <strong>Integración de software</strong> — Sistemas ERP y gestión<br>📋 <strong>Verificación metrológica</strong> — Normas NTC/ISO<br><br>¿Deseas programar una visita técnica?'
        },
        {
            keywords: ['cotización', 'cotizacion', 'precio', 'precios', 'costo', 'costos', 'valor', 'comprar', 'adquirir'],
            response: '💰 <strong>Solicitar Cotización</strong><br><br>Con gusto te preparamos una cotización personalizada. Para darte la mejor propuesta necesitamos saber:<br><br>1️⃣ ¿Qué tipo de equipo necesitas?<br>2️⃣ ¿Cuál es la capacidad requerida?<br>3️⃣ ¿Dónde se ubicará el equipo?<br><br>📞 También puedes contactarnos directamente:<br>WhatsApp: <strong>+57 301 132 4453</strong><br>📧 ventas@sidpesaje.com<br><br>¡Respuesta garantizada en menos de 2 horas!'
        },
        {
            keywords: ['calibración', 'calibracion', 'calibrar', 'certificado', 'certificación'],
            response: '📐 <strong>Servicio de Calibración</strong><br><br>Realizamos calibración profesional con certificados trazables a patrones nacionales e internacionales:<br><br>✅ Calibración in-situ (en tu instalación)<br>✅ Certificados según norma NTC-ISO/IEC 17025<br>✅ Pesas patrón certificadas<br>✅ Informes técnicos detallados<br><br>¿Necesitas programar una calibración?'
        },
        {
            keywords: ['soporte', 'ayuda', 'problema', 'falla', 'error', 'no funciona', 'dañada', 'dañado'],
            response: '🆘 <strong>Soporte Técnico 24/7</strong><br><br>Nuestro equipo de soporte está disponible las 24 horas, los 7 días de la semana.<br><br>📞 Línea directa: <strong>+57 301 132 4453</strong><br>📧 soporte@sidpesaje.com<br><br>Para atención más rápida, por favor ten disponible:<br>• Modelo y serie del equipo<br>• Descripción del problema<br>• Foto del error (si aplica)<br><br>⏱️ Tiempo promedio de respuesta: <strong>menos de 1 hora</strong>'
        },
        {
            keywords: ['horario', 'hora', 'abierto', 'atención', 'atencion', 'ubicación', 'ubicacion', 'dirección', 'direccion', 'donde'],
            response: '📍 <strong>Información de Contacto</strong><br><br>🕐 <strong>Horario de atención:</strong><br>Lunes a Viernes: 8:00 AM - 6:00 PM<br>Sábados: 8:00 AM - 1:00 PM<br><br>📍 <strong>Ubicación:</strong> Colombia<br>📞 <strong>Teléfono:</strong> +57 301 132 4453<br>📧 <strong>Email:</strong> info@sidpesaje.com<br>🌐 <strong>Web:</strong> sidpesaje.com<br><br>¡Te esperamos!'
        },
        {
            keywords: ['hola', 'buenos', 'buenas', 'saludos', 'hey', 'oye', 'qué tal'],
            response: '¡Hola! 😊 Bienvenido a <strong>SID Pesaje</strong>. Estoy aquí para ayudarte con información sobre:<br><br>🚛 Básculas camioneras e industriales<br>⚖️ Balanzas de precisión y laboratorio<br>🔧 Servicios técnicos y calibración<br>💰 Cotizaciones personalizadas<br><br>¿Sobre cuál de estos temas te gustaría saber más?'
        }
    ];

    const defaultResponse = '🤔 Interesante pregunta. Aunque no tengo una respuesta específica para eso, puedo ayudarte con información sobre:<br><br>🚛 <strong>Básculas camioneras</strong> — Escribe "báscula"<br>⚖️ <strong>Balanzas de precisión</strong> — Escribe "balanza"<br>🔧 <strong>Servicios técnicos</strong> — Escribe "servicio"<br>💰 <strong>Cotizaciones</strong> — Escribe "cotización"<br><br>O contáctanos directamente por WhatsApp al <strong>+57 301 132 4453</strong> 📱';

    function getResponse(userMsg) {
        const lower = userMsg.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        for (const entry of responses) {
            for (const keyword of entry.keywords) {
                const normalizedKeyword = keyword.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
                if (lower.includes(normalizedKeyword)) {
                    return entry.response;
                }
            }
        }
        return defaultResponse;
    }

    // ─── SEND MESSAGE ───
    function handleSend() {
        const text = input.value.trim();
        if (!text) return;

        addMessage(text, 'user');
        input.value = '';

        // Show typing, then respond
        const typing = showTyping();
        const delay = 800 + Math.random() * 800;
        setTimeout(() => {
            removeTyping();
            const response = getResponse(text);
            addMessage(response, 'bot');
        }, delay);
    }

    sendBtn.addEventListener('click', handleSend);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    });

    // Clean Close Logic for SID-AI
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            console.log('[SID-AI] Escape key pressed. Forcing close.');
            chat.classList.remove('open');
            backdrop.classList.remove('active');
            trigger.classList.remove('active');
            trigger.style.animation = '';
        }
    });

    // Failsafe: Ensure backdrop doesn't block on start
    if (backdrop) {
        backdrop.classList.remove('active');
        backdrop.style.display = 'none';
    }

    // ─── SUGGESTION CHIPS ───
    document.querySelectorAll('.sidai-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const msg = chip.getAttribute('data-msg');
            if (msg) {
                input.value = msg;
                handleSend();
            }
        });
    });
})();

// ═══════════════════════════════════════════════════════
// PHASE 1 — iOS REVEAL SYSTEM (replaces AOS)
// ═══════════════════════════════════════════════════════
(function iosRevealSystem() {
    const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('revealed');
            } else {
                entry.target.classList.remove('revealed');
            }
        });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });

    // Observe all [data-reveal] and [data-reveal-stagger]
    document.querySelectorAll('[data-reveal], [data-reveal-stagger]').forEach(el => {
        revealObserver.observe(el);
    });

    // Auto-migrate: convert leftover data-aos to data-reveal
    document.querySelectorAll('[data-aos]').forEach(el => {
        el.setAttribute('data-reveal', '');
        el.removeAttribute('data-aos');
        revealObserver.observe(el);
    });
})();

// ═══════════════════════════════════════════════════════
// PHASE 1 — PARALLAX DEPTH
// ═══════════════════════════════════════════════════════
(function iosParallax() {
    if (document.documentElement.hasAttribute('data-emergency-fix')) return;

    const parallaxElements = document.querySelectorAll('[data-parallax]');
    if (!parallaxElements.length) return;

    let ticking = false;
    window.addEventListener('scroll', () => {
        if (ticking) return;
        ticking = true;
        requestAnimationFrame(() => {
            const scrollY = window.scrollY;
            parallaxElements.forEach(el => {
                const speed = parseFloat(el.getAttribute('data-parallax')) || 0.1;
                const rotate = parseFloat(el.getAttribute('data-parallax-rotate')) || 0;
                const y = scrollY * speed;
                const r = scrollY * (rotate / 500);
                el.style.transform = `translateY(${y}px) rotate(${r}deg)`;
            });
            ticking = false;
        });
    }, { passive: true });
})();
