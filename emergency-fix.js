(function applyEmergencyFix() {
  if (!document.documentElement.hasAttribute('data-emergency-fix')) {
    return;
  }

  const root = document.documentElement;
  const body = document.body;
  const cardSelector = '.card, .product-card, .admin-card, .service-plus-card, .award-card, .team-card, .about__card, .contact__info-card, .selector-card, .admin-selector-card, .agenda-card, .client-request-card, .action-card';
  const buttonSelector = '.btn, .portal-access-btn, button, a[role="button"]';
  const clickableSelector = 'a, button, input, select, textarea, label, [role="button"], [onclick], .btn, .portal-access-btn, .product-card, .service-plus-card, .award-card, .team-card, .about__card, .contact__info-card, .selector-card, .admin-selector-card, .agenda-card, .client-request-card, .action-card';
  const allowedOverlaySelector = '.modal-overlay.active, .tech-modal.active, .sidai-backdrop.active, #sidaiBackdrop.active, .admin-modal.active, .ios-bottom-sheet.open, .ios-bottom-sheet-backdrop.open, .sidai-chat.open, .chat-panel.open';

  if (!body) {
    document.addEventListener('DOMContentLoaded', applyEmergencyFix, { once: true });
    return;
  }

  window.__SIDP_EMERGENCY_FIX__ = true;

  if (!window.__SIDP_PREVENT_DEFAULT_PATCHED__) {
    const originalPreventDefault = Event.prototype.preventDefault;
    Event.prototype.preventDefault = function patchedPreventDefault() {
      const target = this.target instanceof Element ? this.target : null;
      const allowScrollLock = target && target.closest('[data-allow-scroll-lock], .dragging-ghost, .daycell.drag-over');

      if ((this.type === 'wheel' || this.type === 'touchmove') && !allowScrollLock) {
        return;
      }

      return originalPreventDefault.apply(this, arguments);
    };
    window.__SIDP_PREVENT_DEFAULT_PATCHED__ = true;
  }

  function forceScrollableRoot() {
    [root, body].forEach((el) => {
      el.style.setProperty('height', 'auto', 'important');
      el.style.setProperty('overflow-y', 'scroll', 'important');
      el.style.setProperty('overflow-x', 'hidden', 'important');
      el.style.setProperty('position', 'static', 'important');
      el.style.setProperty('scroll-behavior', 'auto', 'important');
    });
    body.style.setProperty('min-height', '100%', 'important');
  }

  function clearScrollFallback() {
    document.getElementById('emergency-scroll-layer')?.remove();
    document.getElementById('emergency-scroll-spacer')?.remove();
  }

  function ensureScrollFallback() {
    // Always clean up synthetic scroll elements.
    // The #emergency-scroll-spacer (position:absolute; height:scrollHeight) caused a
    // self-referential loop: each interval read scrollHeight (which already included
    // the spacer) and kept the spacer at that inflated value, leaving permanent empty
    // space below the real content. Native browser scroll handles this correctly.
    clearScrollFallback();
  }

  function resetMotionStyles(el) {
    if (!(el instanceof HTMLElement)) {
      return;
    }

    el.style.removeProperty('transform');
    el.style.removeProperty('filter');

    const image = el.querySelector('.product-card__image');
    if (image instanceof HTMLElement) {
      image.style.removeProperty('transform');
    }

    el.querySelectorAll('.card-shine, .liquid-glass-cursor-glow').forEach((node) => {
      if (node instanceof HTMLElement) {
        node.style.opacity = '0';
      }
    });
  }

  function bindMotionKillSwitch(selector) {
    document.querySelectorAll(selector).forEach((el) => {
      if (!(el instanceof HTMLElement) || el.dataset.emergencyBound === 'true') {
        return;
      }

      const haltMotion = (event) => {
        event.stopPropagation();
        if (typeof event.stopImmediatePropagation === 'function') {
          event.stopImmediatePropagation();
        }
        resetMotionStyles(el);
      };

      el.addEventListener('mousemove', haltMotion, true);
      el.addEventListener('mouseover', haltMotion, true);
      el.addEventListener('mouseleave', () => resetMotionStyles(el), true);
      el.dataset.emergencyBound = 'true';
    });
  }

  function isAllowedFullscreenElement(el, style, rect) {
    if (el === body || el === root) {
      return true;
    }

    if (el.id === 'site-content' || el.id === 'app') {
      return true;
    }

    if (el.matches(allowedOverlaySelector) || el.closest(allowedOverlaySelector)) {
      return true;
    }

    if (el.matches('.nav, .nav__menu, .whatsapp-float, .sidai-trigger, .sidai-chat, .chat-panel')) {
      return true;
    }

    if (style.pointerEvents === 'none') {
      return true;
    }

    if (rect.width < window.innerWidth - 4 || rect.height < window.innerHeight - 4) {
      return true;
    }

    return false;
  }

  function neutralizeBlockers() {
    document.querySelectorAll('body *').forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }

      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if (
        (style.position === 'fixed' || style.position === 'absolute') &&
        !isAllowedFullscreenElement(el, style, rect)
      ) {
        el.style.setProperty('pointer-events', 'none', 'important');
      }
    });

    document.querySelectorAll(clickableSelector).forEach((el) => {
      if (!(el instanceof HTMLElement)) {
        return;
      }

      if (!el.style.position) {
        el.style.position = 'relative';
      }

      el.style.setProperty('z-index', '3', 'important');
      el.style.setProperty('pointer-events', 'auto', 'important');
    });
  }

  function stabilizeCards() {
    document.querySelectorAll(cardSelector).forEach(resetMotionStyles);
    document.querySelectorAll(buttonSelector).forEach(resetMotionStyles);
    bindMotionKillSwitch(cardSelector);
    bindMotionKillSwitch(buttonSelector);
  }

  function runEmergencyPass() {
    forceScrollableRoot();
    ensureScrollFallback();
    neutralizeBlockers();
    stabilizeCards();
  }

  function maxScrollY() {
    const scrollingElement = document.scrollingElement || root;
    return Math.max(0, scrollingElement.scrollHeight - window.innerHeight);
  }

  let manualScrollY = window.scrollY;
  let lastTouchY = null;

  window.__SIDP_RESET_EMERGENCY_SCROLL__ = function resetEmergencyScroll() {
    manualScrollY = 0;
    lastTouchY = null;

    const scrollingElement = document.scrollingElement || root;
    if (scrollingElement) {
      scrollingElement.scrollTop = 0;
    }

    window.scrollTo(0, 0);
  };

  window.addEventListener('wheel', (event) => {
    const before = window.scrollY;
    const deltaY = event.deltaY;

    requestAnimationFrame(() => {
      const after = window.scrollY;
      if (Math.abs(after - before) < 1 && deltaY !== 0) {
        manualScrollY = Math.max(0, Math.min(before + deltaY, maxScrollY()));
        window.scrollTo(0, manualScrollY);
      } else {
        manualScrollY = after;
      }
    });
  }, { passive: true });

  window.addEventListener('touchstart', (event) => {
    lastTouchY = event.touches[0] ? event.touches[0].clientY : null;
  }, { passive: true });

  window.addEventListener('touchmove', (event) => {
    if (lastTouchY == null || !event.touches[0]) {
      return;
    }

    const before = window.scrollY;
    const currentY = event.touches[0].clientY;
    const deltaY = lastTouchY - currentY;
    lastTouchY = currentY;

    requestAnimationFrame(() => {
      const after = window.scrollY;
      if (Math.abs(after - before) < 1 && deltaY !== 0) {
        manualScrollY = Math.max(0, Math.min(before + deltaY, maxScrollY()));
        window.scrollTo(0, manualScrollY);
      } else {
        manualScrollY = after;
      }
    });
  }, { passive: true });

  window.addEventListener('touchend', () => {
    lastTouchY = null;
  }, { passive: true });

  const observer = new MutationObserver(() => {
    runEmergencyPass();
  });

  observer.observe(body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class']
  });

  window.addEventListener('resize', runEmergencyPass, { passive: true });
  window.addEventListener('load', runEmergencyPass, { once: true });

  runEmergencyPass();
  window.setInterval(runEmergencyPass, 1000);
})();

/* ─────────────────────────────────────────────────
   INSTAGRAM FALLBACK DETECTOR
   Checks if Juicer loaded any posts; if not after
   a grace period, reveals the liquid-glass CTA.
───────────────────────────────────────────────── */
(function initInstagramFallback() {
  var GRACE_MS = 8000; // wait up to 8 s for Juicer

  function hasPosts() {
    var list = document.getElementById('juicerFeedList');
    if (!list) return false;
    // Juicer injects <li> elements with class "feed-item"
    var items = list.querySelectorAll('li.feed-item, li.juicer-post, li[class*="feed"]');
    return items.length > 0;
  }

  function showFallback() {
    var wrapper  = document.getElementById('juicerFeedWrapper');
    var fallback = document.getElementById('instagramFallbackCta');
    if (!fallback) return;
    if (wrapper) {
      wrapper.style.display = 'none';
    }
    fallback.style.display = 'flex';
  }

  function check() {
    if (!hasPosts()) {
      showFallback();
    }
  }

  function onReady(fn) {
    if (document.readyState !== 'loading') { fn(); }
    else { document.addEventListener('DOMContentLoaded', fn, { once: true }); }
  }

  onReady(function () {
    // Give Juicer its grace period, then decide
    setTimeout(check, GRACE_MS);
  });
})();
