/* ═══════════════════════════════════════════════════════════════════════════
   SID PESAJE — js/hero-flyer.js
   CARGA DEL FLYER PRINCIPAL → fondo del hero en la mayor calidad disponible
   ───────────────────────────────────────────────────────────────────────────
   CONTRATO VERIFICADO EN VIVO (no supuesto):

     Firestore · proyecto `sidpesaje` · colección `public_settings`
     └─ única colección con `allow read: if true` en firestore.rules, así que
        se puede leer de forma anónima, sin SDK ni sesión iniciada.

     public_settings/hero_config → campo `flyerBase64`  → JPEG 200×200
     public_settings/site_flyer  → campo `imageUrl`     → JPEG 800×800

   Ambos campos traen un data URL completo (`data:image/jpeg;base64,…`).

   POLÍTICA DE CALIDAD: se descargan TODOS los candidatos y se mide la
   resolución nativa de cada uno con SIDPHero.measureImage(); se aplica el de
   MAYOR área. Con el estado actual eso elige site_flyer (800×800) en vez de
   hero_config (200×200), que es 16× más información de imagen.

   IMPORTANTE: ninguna técnica de CSS puede crear resolución que no existe en
   el archivo. Para nitidez nativa en un hero de pantalla completa hace falta
   publicar arte de >= 1920px de ancho (ideal 2880px para Retina) y, de
   preferencia, apaisado: las fuentes actuales son cuadradas, así que `cover`
   en un viewport panorámico recorta la mayor parte del flyer.

   La nitidez del render no se decide aquí: se delega en
   window.SIDPHero.applyBackground() (js/hero-immersive.js), que decodifica el
   Base64 completo, fija cover/center y aplica image-rendering adaptativo.
   ═══════════════════════════════════════════════════════════════════════════ */

const FIRESTORE_PROJECT_ID = 'sidpesaje';
const SETTINGS_COLLECTION = 'public_settings';

/* Nombres de campo aceptados, en orden de preferencia si empatan en resolución.
   Los dos primeros son los que existen hoy en producción. */
const FLYER_FIELDS = [
    'imageUrl', 'flyerBase64',
    'imageData', 'imageBase64', 'base64',
    'url', 'downloadURL', 'flyerUrl'
];

/* Reserva local de ALTA RESOLUCIÓN (assets/). Se elige 1× o 2× según el
   devicePixelRatio: 1376×768 cubre un portátil de forma nativa y 2752×1536
   cubre pantallas grandes/Retina sin que el navegador tenga que ampliar.
   Sólo se usa si Firestore no entrega ningún flyer. */
function fallbackImages() {
    const dpr = window.devicePixelRatio || 1;
    const hi = 'assets/hero-bg-industrial@2x.jpg';
    const lo = 'assets/hero-bg-industrial.jpg';
    return dpr > 1.5
        ? [hi, lo, 'hero_truck_scale.png', 'hero_industrial_bg.png']
        : [lo, hi, 'hero_truck_scale.png', 'hero_industrial_bg.png'];
}

/* Margen para que un módulo de flyer ajeno pinte primero (handshake). */
const HANDSHAKE_TIMEOUT = 250;
/* Cuánto esperamos al flyer real antes de pintar la reserva local (LCP). */
const SOFT_DEADLINE = 2500;
/* Tope de red por consulta antes de abortar. */
const FETCH_TIMEOUT = 8000;

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
       2. Si no aparece nada en SOFT_DEADLINE ms, se pinta la reserva local: el
          hero nunca queda vacío ni esperando a la red.
       3. Cuando el flyer real llega (aunque sea tarde) sustituye a la reserva
          con un cross-fade, pero sólo si el hero sigue en pantalla. */
    const flyerPromise = resolveFlyer(engine).catch((err) => {
        console.warn('[hero-flyer] No se pudo resolver el flyer:', msg(err));
        return null;
    });

    const flyer = await raceWithDeadline(flyerPromise, SOFT_DEADLINE);

    if (hasAppliedBackground(hero)) return;   /* otro módulo se nos adelantó */

    if (flyer) {
        const ok = await apply(engine, hero, flyer);
        if (ok) return;
    }

    /* ── Reserva local inmediata ── */
    const applied = await applyFallback(engine, hero);
    if (applied) markLoaded(hero, { source: 'fallback-local' });
    else if (skeleton) skeleton.textContent = 'Flyer no disponible';

    /* ── Mejora tardía: sólo si el hero sigue visible ── */
    const late = await flyerPromise;
    if (late && heroStillInView(hero)) await apply(engine, hero, late);
}

function apply(engine, hero, flyer) {
    return engine.applyBackground(flyer.value, {
        position: flyer.position || 'center',
        link: flyer.link || null,
        alt: flyer.alt || 'Ultimo Flyer SIDPESAJE',
        source: flyer.source || 'flyer'
    }).then(function (ok) {
        if (ok) {
            markLoaded(hero, flyer);
            console.info(
                '[hero-flyer] Fondo aplicado: ' + flyer.width + '×' + flyer.height +
                ' desde ' + flyer.source + ' (' + flyer.doc + '.' + flyer.field + ').'
            );
        }
        return ok;
    });
}

/* ─────────────────────────────────────────────────────────────────────────
   Selección del candidato de MAYOR resolución
   ───────────────────────────────────────────────────────────────────────── */

/**
 * Mide todos los candidatos en paralelo y devuelve el de mayor área nativa.
 * Éste es el único paso que de verdad mejora la calidad del fondo: elegir la
 * fuente con más píxeles reales disponibles.
 */
async function pickBestCandidate(engine, candidates) {
    if (!candidates.length) return null;
    if (candidates.length === 1) {
        const only = candidates[0];
        const m = await engine.measureImage(only.value);
        return withSize(only, m);
    }

    const measured = await Promise.all(candidates.map(async function (cand) {
        const m = await engine.measureImage(cand.value);
        return withSize(cand, m);
    }));

    const valid = measured.filter(Boolean);
    if (!valid.length) return null;

    /* Mayor área gana; a igualdad, respeta el orden de FLYER_FIELDS. */
    valid.sort(function (a, b) {
        if (b.area !== a.area) return b.area - a.area;
        return a.fieldRank - b.fieldRank;
    });

    if (valid.length > 1 && typeof console.info === 'function') {
        console.info(
            '[hero-flyer] Candidatos medidos: ' +
            valid.map(function (c) {
                return c.doc + '.' + c.field + ' ' + c.width + '×' + c.height;
            }).join(' · ') +
            ' → se usa ' + valid[0].doc + '.' + valid[0].field + '.'
        );
    }
    return valid[0];
}

function withSize(candidate, measured) {
    if (!measured) return null;
    return Object.assign({}, candidate, {
        width: measured.width,
        height: measured.height,
        area: measured.area
    });
}

/* ─────────────────────────────────────────────────────────────────────────
   Resolución de la fuente
   ───────────────────────────────────────────────────────────────────────── */

/** Devuelve el mejor candidato disponible, o null. */
async function resolveFlyer(engine) {
    /* 1) Punto de extensión: la app puede inyectar su propio proveedor. */
    if (typeof window.SIDP_HERO_FLYER_PROVIDER === 'function') {
        try {
            const custom = await window.SIDP_HERO_FLYER_PROVIDER();
            const cand = normalizeProvider(custom);
            if (cand) {
                const sized = await withSize(cand, await engine.measureImage(cand.value));
                if (sized) return Object.assign(sized, { source: 'provider' });
            }
        } catch (err) {
            console.warn('[hero-flyer] proveedor externo falló:', msg(err));
        }
    }

    /* Espera breve: si un módulo propio va a pintar el fondo, que lo haga
       primero y este archivo se retira solo. */
    await delay(HANDSHAKE_TIMEOUT);
    if (hasAppliedBackground(document.getElementById('hero') || document.querySelector('.hero'))) {
        return null;
    }

    /* 2) Firebase compat SDK, si la app ya lo inicializó. */
    let candidates = await readViaCompatSdk();

    /* 3) Firestore REST sobre public_settings (lectura pública, sin SDK). */
    if (!candidates.length) candidates = await readViaRest();

    if (!candidates.length) return null;

    const best = await pickBestCandidate(engine, candidates);
    return best ? Object.assign(best, { source: best.source || 'firestore' }) : null;
}

function normalizeProvider(custom) {
    if (!custom) return null;
    const value = custom.imageData || custom.flyerBase64 || custom.imageUrl || custom.url || custom.value;
    if (!value || typeof value !== 'string') return null;
    return {
        value: value.trim(),
        doc: 'provider',
        field: 'value',
        fieldRank: 0,
        link: custom.link || null,
        alt: custom.alt || null,
        position: custom.position || 'center',
        source: custom.source || 'provider'
    };
}

/** Extrae TODOS los campos de imagen de TODOS los docs, como candidatos. */
function collectCandidates(docs, sourceName) {
    const out = [];
    (docs || []).forEach(function (doc) {
        const fields = doc.fields || {};
        const docId = shortName(doc.name);
        const link = firstString(fields, ['link', 'linkUrl', 'ctaUrl']);
        const alt = firstString(fields, ['alt', 'altText', 'title']);
        if (isDisabled(fields)) return;

        FLYER_FIELDS.forEach(function (field, rank) {
            const raw = fields[field];
            const value = raw && typeof raw.stringValue === 'string' ? raw.stringValue.trim() : '';
            /* Se acepta data URL, Base64 puro o URL http(s)/ruta. */
            if (value && (value.startsWith('data:') || value.startsWith('http') ||
                          value.startsWith('/') || /^[A-Za-z0-9+/]{64,}/.test(value))) {
                out.push({
                    value: value, doc: docId, field: field, fieldRank: rank,
                    link: link, alt: alt, position: 'center', source: sourceName
                });
            }
        });
    });
    return out;
}

function isDisabled(fields) {
    return ['active', 'published', 'visible', 'enabled'].some(function (key) {
        return fields[key] && fields[key].booleanValue === false;
    });
}

function firstString(fields, names) {
    for (let i = 0; i < names.length; i++) {
        const f = fields[names[i]];
        if (f && typeof f.stringValue === 'string' && f.stringValue.trim()) return f.stringValue.trim();
    }
    return null;
}

function shortName(fullName) {
    if (!fullName) return 'doc';
    const parts = String(fullName).split('/');
    return parts[parts.length - 1] || 'doc';
}

/* ── Vía 1: Firebase compat SDK ─────────────────────────────────────────── */
async function readViaCompatSdk() {
    const fb = window.firebase;
    if (!fb || typeof fb.firestore !== 'function') return [];
    try {
        const db = fb.firestore();
        if (!db || typeof db.collection !== 'function') return [];
        const snap = await db.collection(SETTINGS_COLLECTION).get();
        if (!snap || snap.empty) return [];
        const docs = [];
        snap.forEach(function (d) { docs.push({ name: d.id, fields: toRestFields(d.data()) }); });
        return collectCandidates(docs, 'firestore-sdk');
    } catch (err) {
        return [];
    }
}

/** Adapta datos del SDK al formato { stringValue } que usa collectCandidates. */
function toRestFields(data) {
    const out = {};
    Object.keys(data || {}).forEach(function (k) {
        const v = data[k];
        if (typeof v === 'string') out[k] = { stringValue: v };
        else if (typeof v === 'boolean') out[k] = { booleanValue: v };
        else if (v && typeof v === 'object') out[k] = { mapValue: { fields: toRestFields(v) } };
    });
    return out;
}

/* ── Vía 2: Firestore REST (sin dependencias) ───────────────────────────── */
function restBase() {
    return 'https://firestore.googleapis.com/v1/projects/' +
        encodeURIComponent(FIRESTORE_PROJECT_ID) +
        '/databases/(default)/documents/' + encodeURIComponent(SETTINGS_COLLECTION);
}

async function readViaRest() {
    /* (a) Listar la colección: descubre docs y nombres de campo desconocidos. */
    const listed = await fetchJson(restBase() + '?pageSize=25');
    if (listed && listed.documents && listed.documents.length) {
        return collectCandidates(listed.documents, 'firestore-rest');
    }

    /* (b) Si el listado está denegado, se intenta doc por doc. */
    const docs = [];
    for (const id of ['site_flyer', 'hero_config']) {
        const one = await fetchJson(restBase() + '/' + encodeURIComponent(id));
        if (one && one.fields) docs.push(one);
    }
    return collectCandidates(docs, 'firestore-rest');
}

async function fetchJson(url) {
    try {
        const controller = typeof AbortController === 'function' ? new AbortController() : null;
        const timer = controller ? window.setTimeout(function () { controller.abort(); }, FETCH_TIMEOUT) : 0;
        const res = await fetch(url, {
            method: 'GET',
            signal: controller ? controller.signal : undefined,
            headers: { 'Accept': 'application/json' }
        });
        if (controller) window.clearTimeout(timer);
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        return null;
    }
}

/* ─────────────────────────────────────────────────────────────────────────
   Utilidades
   ───────────────────────────────────────────────────────────────────────── */

function waitForEngine(attempt = 0) {
    return new Promise(function (resolve) {
        if (window.SIDPHero && typeof window.SIDPHero.applyBackground === 'function' &&
            typeof window.SIDPHero.measureImage === 'function') {
            resolve(window.SIDPHero);
            return;
        }
        if (attempt > 60) { resolve(null); return; }
        window.setTimeout(function () { resolve(waitForEngine(attempt + 1)); }, 50);
    });
}

/** ¿Ya hay una fotografía real aplicada (por este módulo o por uno ajeno)? */
function hasAppliedBackground(hero) {
    if (!hero) return false;
    const candidates = [
        hero.style.getPropertyValue('--hero-flyer-bg-image'),
        getComputedStyle(hero).getPropertyValue('--hero-flyer-bg-image'),
        getComputedStyle(document.documentElement).getPropertyValue('--hero-flyer-bg-image')
    ];
    return candidates.some(function (v) { return v && v.indexOf('url(') !== -1; });
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

/** ¿El hero sigue visible? (para no hacer swaps distractivos fuera de pantalla) */
function heroStillInView(hero) {
    const y = window.scrollY || window.pageYOffset || 0;
    const vh = window.innerHeight || document.documentElement.clientHeight || 0;
    return y < Math.max(vh, hero.offsetHeight || vh) * 0.6;
}

/** Espera `ms` como máximo; devuelve null si la promesa no se resolvió a tiempo. */
function raceWithDeadline(promise, ms) {
    return Promise.race([
        promise,
        new Promise(function (resolve) { window.setTimeout(function () { resolve(null); }, ms); })
    ]);
}

function delay(ms) {
    return new Promise(function (resolve) { window.setTimeout(resolve, ms); });
}

function msg(err) {
    return err && err.message ? err.message : err;
}

/**
 * Reserva local: se pasa la URL (no Base64) para no inflar el CSS con un string
 * enorme. El motor la decodifica igual y aplica cover/center.
 */
async function applyFallback(engine, hero) {
    for (const src of fallbackImages()) {
        try {
            const ok = await engine.applyBackground(src, {
                position: 'center',
                alt: 'SID PESAJE — Sistemas de pesaje industrial',
                source: 'fallback-local'
            });
            if (ok) {
                console.info(
                    '[hero-flyer] Usando imagen de reserva (' + src + '). ' +
                    'No se pudo leer "' + SETTINGS_COLLECTION + '". Para nitidez nativa, ' +
                    'publicá un flyer de >= 1920px de ancho.'
                );
                return true;
            }
        } catch (err) {
            /* prueba la siguiente */
        }
    }
    return false;
}
