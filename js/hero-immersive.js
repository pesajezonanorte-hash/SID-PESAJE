/* ═══════════════════════════════════════════════════════════════════════════
   SID PESAJE — js/hero-immersive.js
   MOTOR DE NITIDEZ (imageData Base64) + IMMERSIVE SCROLL
   ───────────────────────────────────────────────────────────────────────────
   Responsabilidades:

   A. NITIDEZ NATIVA — recibe el string Base64 (`imageData`) del flyer, lo
      decodifica COMPLETO antes de pintarlo (nada de JPEG progresivo borroso),
      detecta el MIME real y lo fija como fondo con `cover` + `center`.
      Nunca permite `contain` ni tamaños en px que estiren la imagen.

   B. COMPATIBILIDAD — si otro módulo (p. ej. un js/hero-flyer.js propio)
      escribió la foto como `background-image` inline sobre .hero, se MIGRA
      automáticamente a --hero-flyer-bg-image para que el nuevo sistema de
      capas (::before escalable con GPU) la reciba.

   C. IMMERSIVE SCROLL — escribe --hero-ui-progress / --hero-bg-scale /
      --hero-bg-shift / --hero-tint en cada frame. El suavizado de 700ms+ y
      las curvas cubic-bezier viven en hero-polish.css.

   API pública: window.SIDPHero.applyBackground(imageData, opts)
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
    'use strict';

    if (window.SIDPHero && window.SIDPHero.installed) return;

    const VAR_IMAGE = '--hero-flyer-bg-image';
    const VAR_SIZE = '--hero-flyer-bg-size';
    const VAR_POSITION = '--hero-flyer-bg-position';
    const VAR_PROGRESS = '--hero-ui-progress';
    const VAR_SCALE = '--hero-bg-scale';
    const VAR_SHIFT = '--hero-bg-shift';
    const VAR_TINT = '--hero-tint';

    /* Cuánto se expande la foto y cuánto se levanta el tinte al hacer scroll.
       Valores conservadores: por encima de ~1.08 el navegador empieza a
       re-muestrear la capa y se pierde la nitidez nativa. */
    const BG_SCALE_MAX = 0.07;
    const BG_SHIFT_MAX = -22;      /* px */
    const TRAVEL_RATIO = 0.78;     /* la UI se disuelve en el 78% del viewport */
    const DISMISS_AT = 0.86;

    const root = document.documentElement;
    let hero = null;

    const reduceMotion = window.matchMedia
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : { matches: false };

    /* ─────────────────────────────────────────────────────────────────────
       A. NITIDEZ — normalización del string Base64
       ───────────────────────────────────────────────────────────────────── */

    /** Cabeceras Base64 conocidas → MIME real (sin decodificar el payload). */
    const BASE64_MAGICS = [
        { prefix: '/9j/', mime: 'image/jpeg' },
        { prefix: 'iVBORw0KGgo', mime: 'image/png' },
        { prefix: 'R0lGOD', mime: 'image/gif' },
        { prefix: 'UklGR', mime: 'image/webp' },
        { prefix: 'Qk', mime: 'image/bmp' },
        { prefix: 'PHN2Zy', mime: 'image/svg+xml' },
        { prefix: 'PFNWRz', mime: 'image/svg+xml' },
        { prefix: 'AAABAAE', mime: 'image/x-icon' },
        /* AVIF/HEIF: caja ftyp codificada */
        { prefix: 'AAAAHGZ0eXBh', mime: 'image/avif' },
        { prefix: 'AAAAHGZ0eXBo', mime: 'image/heic' }
    ];

    /** Detecta el MIME real leyendo la cabecera del Base64 (sin decodificar). */
    function detectMime(b64) {
        const head = b64.slice(0, 16);
        for (let i = 0; i < BASE64_MAGICS.length; i++) {
            if (head.startsWith(BASE64_MAGICS[i].prefix)) return BASE64_MAGICS[i].mime;
        }
        return 'image/jpeg';
    }

    /**
     * Convierte cualquier entrada (Base64 puro, data URL, URL http(s) o ruta
     * relativa) en un origen listo para background-image, sin recomprimir.
     *
     * OJO con el orden: el Base64 de un JPEG empieza por "/9j/", así que NO se
     * puede decidir "es una ruta" mirando si empieza por "/". Se decide por la
     * cabecera mágica del Base64 y por la ausencia de extensión de archivo.
     */
    function toImageSource(input) {
        if (!input || typeof input !== 'string') return null;
        const value = input.trim();
        if (!value) return null;

        /* 1) Envoltorio CSS url("…") */
        if (/^url\(/i.test(value)) {
            const inner = value.replace(/^url\(\s*['"]?/i, '').replace(/['"]?\s*\)$/i, '');
            return toImageSource(inner);
        }

        /* 2) data URL ya construida: se respeta tal cual (cero recompresión) */
        if (/^data:/i.test(value)) return value;

        /* 3) Base64 puro → data URL con el MIME real detectado */
        const b64 = value.replace(/^base64,/i, '').replace(/\s+/g, '');
        const hasImageExtension = /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico)([?#]|$)/i.test(b64);
        const isBase64Charset = /^[A-Za-z0-9+/]+={0,2}$/.test(b64);
        const hasKnownMagic = BASE64_MAGICS.some(function (magic) { return b64.startsWith(magic.prefix); });
        /* Una cadena larga en charset Base64 también se acepta aunque la
           cabecera no esté en la lista (p. ej. AVIF/TIFF raros). */
        if (!hasImageExtension && isBase64Charset && (hasKnownMagic || b64.length >= 512)) {
            return 'data:' + detectMime(b64) + ';base64,' + b64;
        }

        /* 4) URL o ruta de archivo */
        if (hasImageExtension ||
            /^(https?:)?\/\//i.test(value) ||
            value.startsWith('/') ||
            value.startsWith('./') ||
            value.startsWith('../')) {
            return value;
        }

        return null;
    }

    /**
     * Decodifica la imagen por completo ANTES de pintarla.
     * `img.decode()` garantiza que el navegador tenga el bitmap completo y a
     * resolución nativa; así el primer paint ya es nítido (sin el barrido
     * borroso típico de un Base64 grande aplicado directamente al CSS).
     */
    function decodeImage(src) {
        return new Promise(function (resolve, reject) {
            const img = new Image();
            img.decoding = 'async';
            img.onload = function () { resolve(img); };
            img.onerror = function () { reject(new Error('No se pudo decodificar la imagen del hero')); };
            img.src = src;
            if (typeof img.decode === 'function') {
                img.decode().catch(function () { /* onload ya resuelve */ });
            }
        });
    }

    /** ¿El elemento llega a pintarse? (evita trabajo inútil sobre nodos ocultos) */
    function isRendered(el) {
        if (!el) return false;
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return false;
        return getComputedStyle(el).display !== 'none';
    }

    function writeBackgroundVar(src, position) {
        /* Sobre .hero (autoritativo para .hero::before) … */
        hero.style.setProperty(VAR_IMAGE, 'url("' + src + '")', 'important');
        hero.style.setProperty(VAR_SIZE, 'cover', 'important');
        hero.style.setProperty(VAR_POSITION, position || 'center', 'important');
        /* … y sobre :root, por si algún otro módulo lee el token global. */
        root.style.setProperty(VAR_IMAGE, 'url("' + src + '")', 'important');
        root.style.setProperty(VAR_SIZE, 'cover', 'important');
        root.style.setProperty(VAR_POSITION, position || 'center', 'important');
    }

    /**
     * Mide una fuente de imagen SIN aplicarla: devuelve { width, height, area }
     * o null si no decodifica. Sirve para elegir entre varios candidatos
     * (p. ej. flyerBase64 de 200×200 vs imageUrl de 800×800) el de mayor
     * resolución nativa, que es lo único que de verdad aporta nitidez.
     */
    async function measureImage(source) {
        const src = toImageSource(source);
        if (!src) return null;
        try {
            const img = await decodeImage(src);
            const w = img.naturalWidth || 0;
            const h = img.naturalHeight || 0;
            if (!w || !h) return null;
            return { width: w, height: h, area: w * h, src: src };
        } catch (err) {
            return null;
        }
    }

    /** Ancho físico real que necesita el hero (px CSS × devicePixelRatio). */
    function neededPhysicalWidth() {
        if (!hero) return 0;
        const dpr = window.devicePixelRatio || 1;
        return Math.round((hero.clientWidth || window.innerWidth || 0) * dpr);
    }

    /**
     * Aplica el fondo en alta definición y decide el modo de remuestreo.
     * @param {string} imageData  Base64 puro, data URL o URL de imagen.
     * @param {{position?:string, link?:string, alt?:string, source?:string}} [opts]
     * @returns {Promise<boolean>} true si la imagen decodificó y se pintó.
     */
    async function applyBackground(imageData, opts) {
        const options = opts || {};
        const src = toImageSource(imageData);
        if (!hero || !src) return false;

        try {
            const img = await decodeImage(src);

            /* Diagnóstico de nitidez: avisar (sin bloquear) si el arte es menor
               que el lienzo físico del panel — ahí `cover` tendría que upsamplear
               y la nitidez nativa es imposible. */
            const neededWidth = neededPhysicalWidth();
            const upscale = neededWidth && img.naturalWidth
                ? neededWidth / img.naturalWidth
                : 1;

            if (upscale > 1.33) {
                console.info(
                    '[SIDPHero] El flyer (' + img.naturalWidth + '×' + img.naturalHeight +
                    ') se está ampliando ' + upscale.toFixed(1) + '× para llenar ' +
                    neededWidth + 'px físicos. Para nitidez nativa, subí arte de >= ' +
                    neededWidth + 'px de ancho.'
                );
            }

            /* ── image-rendering ADAPTATIVO ──
               `crisp-edges` preserva el contraste cuando NO hay remuestreo, pero
               sobre una fuente que se está ampliando 2× o más produce dientes de
               sierra y bordes dentados: justo lo contrario de "mayor calidad".
               Por eso sólo se usa crisp cuando el arte cubre el lienzo; si hay
               que ampliar, se deja el remuestreo suave del navegador, que es lo
               que mejor se ve con fotos. */
            hero.classList.toggle('hero--bg-upscaled', upscale > 1.15);
            hero.dataset.flyerUpscale = upscale.toFixed(2);

            writeBackgroundVar(src, options.position);

            /* Si ya había una foto (p. ej. la reserva local), se reinicia el
               cross-fade para que la sustitución se vea como una transición y
               no como un corte seco. */
            if (hero.classList.contains('hero--has-flyer-bg')) {
                hero.classList.remove('hero--has-flyer-bg');
                void hero.offsetWidth;   /* reflujo mínimo, sólo en el swap */
            }
            hero.classList.add('hero--has-flyer-bg');
            hero.dataset.flyerSource = options.source || 'unknown';

            /* ── EL FLYER COMPLETO vive en el <img> del hero ──────────────
               Ya no es un espejo opcional: #hero-flyer-img ES la capa que
               muestra la imagen ENTERA (object-fit: contain) a scroll 0, y
               escala hasta cover al bajar. Se le asigna SIEMPRE que exista;
               el coste de decodificación lo absorbe la caché de imágenes del
               navegador (misma URL que ::before y el ambiente). */
            const imgEl = document.getElementById('hero-flyer-img');
            if (imgEl) {
                imgEl.src = src;
                if (options.alt) imgEl.alt = options.alt;
                imgEl.removeAttribute('hidden');
            }

            /* Factor k con el que el encaje contain coincide con cover. */
            state.flyerW = img.naturalWidth;
            state.flyerH = img.naturalHeight;
            updateCompleteScale();
            const skeleton = document.getElementById('hero-flyer-skeleton');
            if (skeleton) skeleton.setAttribute('hidden', '');

            const link = document.getElementById('hero-flyer-link');
            if (link && options.link) {
                link.href = options.link;
                link.removeAttribute('aria-hidden');
                link.tabIndex = 0;
            }

            measure();
            sync(true);
            return true;
        } catch (err) {
            console.warn('[SIDPHero] Fondo no aplicado:', err && err.message ? err.message : err);
            return false;
        }
    }

    /* ─────────────────────────────────────────────────────────────────────
       B. COMPATIBILIDAD — migración de fondos inline heredados
       ───────────────────────────────────────────────────────────────────── */
    let migrated = null;

    /**
     * Si un módulo anterior pintó la foto directamente sobre .hero
     * (`hero.style.backgroundImage = url(...)`), ese inline se pierde contra
     * `background-image: none !important` de la nueva capa. Lo rescatamos.
     */
    function migrateInlineBackground() {
        if (!hero) return;
        const inline = hero.style.backgroundImage;
        if (!inline || inline === 'none') return;
        const match = inline.match(/url\((['"]?)([^'")]+)\1\)/);
        if (!match) return;
        const src = match[2];
        if (src === migrated) return;
        migrated = src;
        hero.style.removeProperty('background-image');
        hero.style.removeProperty('background-size');
        hero.style.removeProperty('background-position');
        writeBackgroundVar(src, 'center');
        hero.classList.add('hero--has-flyer-bg');
        const skeleton = document.getElementById('hero-flyer-skeleton');
        if (skeleton) skeleton.setAttribute('hidden', '');
    }

    function watchInlineBackground() {
        if (typeof MutationObserver !== 'function' || !hero) return;
        const mo = new MutationObserver(function () { migrateInlineBackground(); });
        mo.observe(hero, { attributes: true, attributeFilter: ['style'] });
        mo.observe(root, { attributes: true, attributeFilter: ['style'] });
    }

    /* ─────────────────────────────────────────────────────────────────────
       C. IMMERSIVE SCROLL
       ───────────────────────────────────────────────────────────────────── */
    const state = {
        progress: -1,
        vh: 0,
        travel: 1,
        queued: false,
        pendingForce: false,
        flyerW: 0,
        flyerH: 0
    };

    /**
     * Calcula k = cover/contain para el flyer actual y lo publica como
     * --hero-complete-k. CSS lo combina con --hero-ui-progress:
     *   scale = 1 + progress × (k − 1)
     * de modo que a scroll 0 el <img> encaja la imagen ENTERA y, al bajar,
     * ese mismo elemento crece hasta recortarse exactamente como `cover`.
     * Para un flyer cuadrado en un hero 2:1, k = 2.
     */
    function updateCompleteScale() {
        if (!hero) return;
        const W = hero.clientWidth || window.innerWidth || 0;
        const H = hero.clientHeight || hero.offsetHeight || window.innerHeight || 0;
        const nw = state.flyerW, nh = state.flyerH;
        let k = 1;
        if (W > 0 && H > 0 && nw > 0 && nh > 0) {
            const cover = Math.max(W / nw, H / nh);
            const contain = Math.min(W / nw, H / nh);
            if (contain > 0) k = cover / contain;
        }
        hero.style.setProperty('--hero-complete-k', k.toFixed(4));
    }

    /** Lee geometría UNA vez (fuera del bucle de scroll: cero reflow por frame). */
    function measure() {
        if (!hero) return;
        state.vh = window.innerHeight || root.clientHeight || 800;
        const heroHeight = hero.offsetHeight || state.vh;
        state.travel = Math.max(240, Math.min(state.vh, heroHeight) * TRAVEL_RATIO);
        /* Si cambió la caja del hero (resize/orientación), k también cambia. */
        updateCompleteScale();
    }

    function writeFrame(force) {
        if (!hero) return;

        const y = window.scrollY || window.pageYOffset || 0;
        const raw = state.travel > 0 ? y / state.travel : 0;
        const p = Math.min(1, Math.max(0, raw));

        /* Cuantizamos a 4 decimales: evita recalcular estilos en cada frame
           cuando el delta es imperceptible (scroll suave, trackpads de alta
           frecuencia) y mantiene la curva perfectamente fluida. */
        const q = Math.round(p * 10000) / 10000;
        if (!force && q === state.progress) return;
        state.progress = q;

        const active = y > 1;
        hero.classList.toggle('hero--immersive', active);
        hero.classList.toggle('hero--ui-dismissed', q >= DISMISS_AT);

        hero.style.setProperty(VAR_PROGRESS, q.toFixed(4));

        if (!reduceMotion.matches) {
            hero.style.setProperty(VAR_SCALE, (1 + q * BG_SCALE_MAX).toFixed(4));
            hero.style.setProperty(VAR_SHIFT, (q * BG_SHIFT_MAX).toFixed(2) + 'px');
        } else {
            hero.style.setProperty(VAR_SCALE, '1');
            hero.style.setProperty(VAR_SHIFT, '0px');
        }

        /* NOTA: --hero-tint NO se anima por frame. Multiplicarlo por el progreso
           cambiaría el valor computado de background-image y forzaría a repintar
           los degradados de una capa a pantalla completa en cada frame (paint, no
           composición), arruinando la fluidez. Queda como token estático y
           ajustable en hero-polish.css. El scroll inmersivo sólo toca propiedades
           compuestas: transform (foto) y opacity (UI). */
    }

    /**
     * Programa UNA escritura por frame. El flag de cola se activa antes de
     * pedir el frame (no depende del valor de retorno de requestAnimationFrame),
     * de modo que el driver no pueda quedar enquistado si un entorno resuelve
     * el callback de forma síncrona.
     */
    function sync(force) {
        if (force === true) state.pendingForce = true;
        if (state.queued) return;
        state.queued = true;
        window.requestAnimationFrame(function () {
            state.queued = false;
            const forced = state.pendingForce;
            state.pendingForce = false;
            writeFrame(forced);
        });
    }

    function onScroll() {
        sync(false);
    }

    let resizeTimer = 0;
    function onResize() {
        window.clearTimeout(resizeTimer);
        resizeTimer = window.setTimeout(function () {
            measure();
            state.progress = -1;   /* fuerza reescritura */
            sync(true);
        }, 120);
    }

    /* ─────────────────────────────────────────────────────────────────────
       Arranque
       ───────────────────────────────────────────────────────────────────── */
    function init() {
        hero = document.getElementById('hero') || document.querySelector('.hero');
        if (!hero) return;

        measure();
        migrateInlineBackground();
        watchInlineBackground();

        /* Semilla: sin esto, el primer scroll partiría de valores por defecto
           y se vería un salto en la primera curva. */
        hero.style.setProperty(VAR_PROGRESS, '0');
        hero.style.setProperty(VAR_SCALE, '1');
        hero.style.setProperty(VAR_SHIFT, '0px');
        hero.style.setProperty(VAR_TINT, '1');

        window.addEventListener('scroll', onScroll, { passive: true });
        window.addEventListener('resize', onResize, { passive: true });
        window.addEventListener('orientationchange', onResize, { passive: true });

        /* Un cambio de tema re-resuelve los gradientes: re-sincronizamos. */
        const themeObserver = new MutationObserver(function () { sync(true); });
        themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(function () { measure(); sync(true); }).catch(function () {});
        }
        window.addEventListener('load', function () { measure(); sync(true); });

        sync(true);
    }

    window.SIDPHero = {
        installed: true,
        version: '1.1.0',
        applyBackground: applyBackground,
        measureImage: measureImage,          /* mide candidatos sin aplicarlos */
        neededPhysicalWidth: neededPhysicalWidth,
        toImageSource: toImageSource,
        sync: sync,
        measure: measure                     /* re-mide la geometría del hero */
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
})();
