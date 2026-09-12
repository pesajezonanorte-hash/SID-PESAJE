/* ═══════════════════════════════════════════════════════════════════════════
   SID PESAJE — js/hero-flyer.js
   CARGA DEL FLYER PRINCIPAL → imageData (Base64) → fondo de alta definición
   ───────────────────────────────────────────────────────────────────────────
   NOTA DE INTEGRACIÓN: este archivo estaba referenciado en index.html pero no
   existía en el repositorio (devolvía 404), así que el hero se quedaba sin
   fotografía y sólo se veía el degradado de reserva. Se repone aquí de forma
   NO DESTRUCTIVA:

     · Si otro módulo ya aplicó un fondo real, éste se retira (handshake).
     · Orden de resolución:
         1. window.SIDP_HERO_FLYER_PROVIDER()  ← punto de extensión propio
         2. Firebase compat SDK (window.firebase) → colección `public-flyers`
         3. Firestore REST (sin SDK) → colección `public-flyers`
         4. Reserva local (hero_truck_scale.png)

   La nitidez nunca se decide aquí: se delega en
   window.SIDPHero.applyBackground() (js/hero-immersive.js), que decodifica el
   Base64 completo y lo fija con cover/center/crisp-edges.
   ═══════════════════════════════════════════════════════════════════════════ */

const FIRESTORE_PROJECT_ID = 'sidpesaje';
const FLYER_COLLECTION = 'public-flyers';
const FALLBACK_IMAGES = ['hero_truck_scale.png', 'hero_industrial_bg.png'];

/* Margen para que un módulo de flyer ajeno pinte primero (handshake). */
const HANDSHAKE_TIMEOUT = 250;
/* Cuánto esperamos al flyer real antes de pintar la reserva local (LCP). */
const SOFT_DEADLINE = 1100;
/* Tope de red para la consulta a Firestore antes de abortar. */
const FETCH_TIMEOUT = 4000;

/** Marca global para no ejecutar dos veces si el script se duplica. */
if (window.__SIDP_HERO_FLYER_LOADED__) {
    // noop
} else {
    window.__SIDP_HERO_FLYER_LOADED__ = true;
    bootstrap();
}

async function bootstrap() {
    const hero = document.getElementById('hero') || document.querySelector('.hero');
    if (!hero) return;

    /* Espera a que el motor de nitidez esté disponible (se carga antes, pero
       por robustez se reintenta unos frames). */
    const engine = await waitForEngine();
    if (!engine) {
        console.warn('[hero-flyer] window.SIDPHero no está disponible; se omite el fondo dinámico.');
        return;
    }

    /* ── Handshake: si ya hay una foto aplicada, no la pisamos ── */
    if (hasAppliedBackground(hero)) return;

    const skeleton = document.getElementById('hero-flyer-skeleton');

    /* Estrategia de arranque (LCP primero):
       1. Se lanza la búsqueda del flyer real SIN bloquear el pintado.
       2. Si no aparece nada en SOFT_DEADLINE ms, se pinta la reserva local al
          instante: el hero nunca queda vacío ni esperando a la red.
       3. Cuando el flyer real llega (aunque sea tarde), sustituye a la reserva
          con un cross-fade. */
    const flyerPromise = resolveFlyer().catch((err) => {
        console.warn('[hero-flyer] No se pudo resolver el flyer:', err && err.message ? err.message : err);
        return null;
    });

    const flyer = await raceWithDeadline(flyerPromise, SOFT_DEADLINE);

    if (hasAppliedBackground(hero)) return;   /* otro módulo se nos adelantó */

    if (flyer && (flyer.imageData || flyer.url)) {
        const ok = await engine.applyBackground(flyer.imageData || flyer.url, {
            position: flyer.position || 'center',
            link: flyer.link || null,
            alt: flyer.alt || 'Ultimo Flyer SIDPESAJE',
            source: flyer.source || 'flyer'
        });
        if (ok) markLoaded(hero, flyer);
        return;
    }

    /* ── Reserva local inmediata ── */
    const applied = await applyFallback(engine, hero);
    if (applied) markLoaded(hero, { source: 'fallback-local' });
    else if (skeleton) skeleton.textContent = 'Flyer no disponible';

    /* ── Mejora tardía: si el flyer real aparece después, se aplica encima.
       Sólo si el hero sigue en pantalla: sustituir el fondo cuando el usuario
       ya bajó sería un cambio distractivo en vez de una mejora. ── */
    const late = await flyerPromise;
    if (late && (late.imageData || late.url) && late.source !== 'fallback-local' && heroStillInView(hero)) {
        const ok = await engine.applyBackground(late.imageData || late.url, {
            position: late.position || 'center',
            link: late.link || null,
            alt: late.alt || 'Ultimo Flyer SIDPESAJE',
            source: late.source || 'flyer'
        });
        if (ok) markLoaded(hero, late);
    }
}

/** ¿El hero sigue visible? (para no swaps distractivos fuera de pantalla) */
function heroStillInView(hero) {
    const y = window.scrollY || window.pageYOffset || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return y < Math.max(vh, hero.offsetHeight || vh) * 0.6;
}

/** Espera `ms` como máximo; devuelve null si la promesa no se resolvió a tiempo. */
function raceWithDeadline(promise, ms) {
    return Promise.race([
        promise,
        new Promise((resolve) => window.setTimeout(() => resolve(null), ms))
    ]);
}

/* ─────────────────────────────────────────────────────────────────────────
   Utilidades
   ───────────────────────────────────────────────────────────────────────── */

function waitForEngine(attempt = 0) {
    return new Promise((resolve) => {
        if (window.SIDPHero && typeof window.SIDPHero.applyBackground === 'function') {
            resolve(window.SIDPHero);
            return;
        }
        if (attempt > 40) { resolve(null); return; }
        window.setTimeout(() => resolve(waitForEngine(attempt + 1)), 50);
    });
}

/** ¿Ya hay una fotografía real aplicada (por este módulo o por uno ajeno)? */
function hasAppliedBackground(hero) {
    const candidates = [
        hero.style.getPropertyValue('--hero-flyer-bg-image'),
        getComputedStyle(hero).getPropertyValue('--hero-flyer-bg-image'),
        getComputedStyle(document.documentElement).getPropertyValue('--hero-flyer-bg-image')
    ];
    return candidates.some((value) => value && value.indexOf('url(') !== -1);
}

function markLoaded(hero, flyer) {
    /* Activa el cross-fade de la foto sobre .hero::before (hero-polish.css) */
    hero.classList.add('hero--has-flyer-bg');

    const skeleton = document.getElementById('hero-flyer-skeleton');
    if (skeleton) skeleton.setAttribute('hidden', '');

    /* OJO: NO se quita el atributo `hidden` de #hero-flyer. Ese contenedor es
       un overlay absolute inset:0 con z-index 2 que hoy sólo alberga nodos
       ocultos (emergency-fix.css pasó la foto al fondo del hero). Mostrarlo
       añadiría una capa vacía por encima de la fotografía sin aportar nada. */
    if (flyer && flyer.source) hero.dataset.flyerSource = flyer.source;
    if (window.SIDPHero) window.SIDPHero.sync(true);
}

/**
 * Resuelve el flyer activo siguiendo la cadena de proveedores.
 * Devuelve { imageData, url, link, alt, position, source }.
 */
async function resolveFlyer() {
    /* 1) Punto de extensión: la app puede inyectar su propio proveedor. */
    if (typeof window.SIDP_HERO_FLYER_PROVIDER === 'function') {
        try {
            const custom = await window.SIDP_HERO_FLYER_PROVIDER();
            if (custom && (custom.imageData || custom.url)) {
                return { position: 'center', ...custom, source: custom.source || 'provider' };
            }
        } catch (err) {
            console.warn('[hero-flyer] proveedor externo falló:', err);
        }
    }

    /* Espera breve: si un módulo propio de flyer va a pintar el fondo, que lo
       haga primero y este archivo se retira solo. */
    await delay(HANDSHAKE_TIMEOUT);
    if (hasAppliedBackground(document.getElementById('hero') || document.querySelector('.hero'))) {
        return null;
    }

    /* 2) Firebase compat SDK, si la app ya lo inicializó. */
    const fromSdk = await readFromCompatSdk();
    if (fromSdk) return fromSdk;

    /* 3) Firestore REST, sin dependencias. */
    const fromRest = await readFromFirestoreRest();
    if (fromRest) return fromRest;

    return null;
}

function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function normalizeDoc(data, source) {
    if (!data || typeof data !== 'object') return null;
    const imageData = data.imageData || data.imageBase64 || data.base64 || null;
    const url = data.downloadURL || data.downloadUrl || data.url || data.imageUrl || null;
    if (!imageData && !url) return null;
    if (data.active === false || data.published === false || data.visible === false) return null;
    return {
        imageData: typeof imageData === 'string' ? imageData.trim() : null,
        url: typeof url === 'string' ? url.trim() : null,
        link: data.link || data.linkUrl || data.ctaUrl || null,
        alt: data.alt || data.altText || data.title || 'Ultimo Flyer SIDPESAJE',
        position: data.position || 'center',
        source
    };
}

async function readFromCompatSdk() {
    const fb = window.firebase;
    if (!fb || typeof fb.firestore !== 'function') return null;
    try {
        const db = typeof fb.firestore === 'function' ? fb.firestore() : null;
        if (!db || typeof db.collection !== 'function') return null;
        const snap = await db.collection(FLYER_COLLECTION)
            .orderBy('createdAt', 'desc')
            .limit(1)
            .get();
        if (!snap || snap.empty) return null;
        return normalizeDoc(snap.docs[0].data(), 'firestore-sdk');
    } catch (err) {
        /* Sin índice, sin permisos o sin SDK: se continúa con la siguiente vía */
        return null;
    }
}

async function readFromFirestoreRest() {
    const endpoint = 'https://firestore.googleapis.com/v1/projects/' +
        encodeURIComponent(FIRESTORE_PROJECT_ID) +
        '/databases/(default)/documents/' + encodeURIComponent(FLYER_COLLECTION) +
        '?pageSize=1&orderBy=' + encodeURIComponent('createdAt.desc');

    try {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? window.setTimeout(() => controller.abort(), FETCH_TIMEOUT) : 0;
        const res = await fetch(endpoint, {
            method: 'GET',
            signal: controller ? controller.signal : undefined,
            headers: { 'Accept': 'application/json' }
        });
        if (controller) window.clearTimeout(timer);
        if (!res.ok) return null;

        const payload = await res.json();
        const doc = payload && payload.documents && payload.documents[0];
        if (!doc || !doc.fields) return null;
        return normalizeDoc(unwrapFirestoreFields(doc.fields), 'firestore-rest');
    } catch (err) {
        return null;
    }
}

/** Convierte { imageData: { stringValue: '…' } } del REST a valores planos. */
function unwrapFirestoreFields(fields) {
    const out = {};
    Object.keys(fields || {}).forEach((key) => {
        const value = fields[key] || {};
        if ('stringValue' in value) out[key] = value.stringValue;
        else if ('booleanValue' in value) out[key] = value.booleanValue;
        else if ('integerValue' in value) out[key] = Number(value.integerValue);
        else if ('doubleValue' in value) out[key] = value.doubleValue;
        else if ('timestampValue' in value) out[key] = value.timestampValue;
        else if ('mapValue' in value) out[key] = unwrapFirestoreFields(value.mapValue.fields);
        else out[key] = null;
    });
    return out;
}

/**
 * Reserva local: se pasa la URL (no Base64) para no inflar el CSS con un string
 * de ~1.3 MB. El motor la decodifica igual y aplica cover/center/crisp-edges.
 */
async function applyFallback(engine, hero) {
    for (const src of FALLBACK_IMAGES) {
        try {
            const ok = await engine.applyBackground(src, {
                position: 'center',
                alt: 'SID PESAJE — Sistemas de pesaje industrial',
                source: 'fallback-local'
            });
            if (ok) {
                console.info(
                    '[hero-flyer] Usando imagen de reserva (' + src + '). ' +
                    'Para nitidez nativa en Retina, publica un flyer de >= 1920px de ancho ' +
                    'en la colección "' + FLYER_COLLECTION + '" (campo imageData en Base64).'
                );
                return true;
            }
        } catch (err) {
            /* prueba la siguiente */
        }
    }
    return false;
}
