/**
 * Upstate IP Voice - Main JavaScript
 */

(function () {
  'use strict';

  // Set current year in footer
  var yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = new Date().getFullYear();
  }

  document.querySelectorAll('.support-ticket').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var emailInput = form.querySelector('#support-email');
      var messageInput = form.querySelector('#support-message');
      if (!emailInput || !messageInput) return;
      if (!form.checkValidity()) {
        form.reportValidity();
        return;
      }
      var email = emailInput.value.trim();
      var message = messageInput.value.trim();
      window.location.href =
        'mailto:tech@upstateipvoice.com?subject=' +
        encodeURIComponent('Support ticket') +
        '&body=' +
        encodeURIComponent('From: ' + email + '\n\n' + message);
    });
  });

  function prefersReducedMotion() {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  function scrollToGetSupport() {
    var el = document.getElementById('get-support');
    if (!el) return;
    el.scrollIntoView({
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      block: 'start'
    });
  }

  if (window.location.hash === '#get-support' && document.getElementById('get-support')) {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    window.scrollTo(0, 0);
    var startGetSupportScroll = function () {
      setTimeout(scrollToGetSupport, 60);
    };
    if (document.readyState === 'complete') {
      startGetSupportScroll();
    } else {
      window.addEventListener('load', startGetSupportScroll);
    }
  }

  document.querySelectorAll('a[href="#get-support"], a[href$="support.html#get-support"]').forEach(function (link) {
    link.addEventListener('click', function (event) {
      if (!document.getElementById('get-support')) return;
      event.preventDefault();
      if (history.replaceState) {
        history.replaceState(null, '', '#get-support');
      } else {
        window.location.hash = 'get-support';
      }
      scrollToGetSupport();
    });
  });

  document.querySelectorAll('.site-footer__book-form').forEach(function (form) {
    form.addEventListener('submit', function (event) {
      event.preventDefault();
      var emailInput = form.querySelector('.site-footer__book-email');
      if (!emailInput) return;
      if (!emailInput.checkValidity()) {
        emailInput.reportValidity();
        return;
      }
      var email = emailInput.value.trim();
      window.location.href =
        'mailto:info@upstateipvoice.com?subject=' +
        encodeURIComponent('Subscribe') +
        '&body=' +
        encodeURIComponent('Please subscribe: ' + email);
    });
  });

  // Homepage hero: black frame until video is ready (avoids static poster flash)
  var heroVideo = document.querySelector('.index-hero-video__media');
  if (heroVideo) {
    var showHeroVideo = function () {
      heroVideo.classList.add('is-ready');
    };
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      showHeroVideo();
    } else if (heroVideo.readyState >= 2) {
      showHeroVideo();
    } else {
      heroVideo.addEventListener('canplay', showHeroVideo, { once: true });
      heroVideo.addEventListener('playing', showHeroVideo, { once: true });
    }
  }

  // About page: hide hero immediately when navigating home (avoids stale image during reload)
  var aboutHero = document.querySelector('.about-figma__hero');
  if (aboutHero) {
    document.querySelectorAll('a[href="index.html"], a[href="/"]').forEach(function (link) {
      link.addEventListener('click', function () {
        aboutHero.style.visibility = 'hidden';
        document.body.style.background = '#000';
      });
    });
  }

  // Support email card: click to copy, show "Copied"
  var supportEmailEl = document.querySelector('.support-email');
  if (supportEmailEl) {
    var email = supportEmailEl.getAttribute('data-email') || '';
    var feedbackEl = supportEmailEl.querySelector('.support-email-feedback');
    function copyEmail() {
      if (!email) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(email).then(function () {
          if (feedbackEl) {
            feedbackEl.textContent = 'Copied';
            setTimeout(function () {
              feedbackEl.textContent = '';
            }, 2000);
          }
        });
      } else {
        var ta = document.createElement('textarea');
        ta.value = email;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
          if (feedbackEl) {
            feedbackEl.textContent = 'Copied';
            setTimeout(function () {
              feedbackEl.textContent = '';
            }, 2000);
          }
        } catch (err) { /* no-op */ }
        document.body.removeChild(ta);
      }
    }
    supportEmailEl.addEventListener('click', copyEmail);
    supportEmailEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        copyEmail();
      }
    });
  }

  // Mobile nav (new component: max-width 1023px) — open/close, scroll lock, focus
  var menuBtn = document.querySelector('.mobileHeader .menuBtn');
  var closeBtn = document.querySelector('.mobileHeader .closeBtn');
  var mobileOverlay = document.querySelector('.mobileMenuOverlay');
  var mobilePanel = document.querySelector('.mobileMenuPanel');
  var menuLinks = document.querySelectorAll(
    '.mobileMenuPanel .menuLinks a, .mobileMenuPanel .menuCTA a, .mobileMenuPanel .menuMeta a, .mobileMenuPanel .menuTop-logo'
  );
  var scrollLockY = 0;
  var previouslyFocused = null;

  function getFocusableInPanel() {
    if (!mobilePanel) return [];
    return Array.prototype.slice.call(
      mobilePanel.querySelectorAll(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter(function (el) {
      return !el.hasAttribute('disabled') && el.offsetParent !== null;
    });
  }

  function closeMobileMenu() {
    if (!document.body.classList.contains('mobileMenuOpen')) return;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var delay = reducedMotion ? 0 : 580;
    document.body.classList.add('mobileMenuClosing');
    if (mobileOverlay) mobileOverlay.setAttribute('aria-hidden', 'true');
    if (mobilePanel) mobilePanel.setAttribute('aria-hidden', 'true');
    setTimeout(function () {
      document.body.classList.remove('mobileMenuOpen', 'mobileMenuClosing');
      if (menuBtn) {
        menuBtn.setAttribute('aria-expanded', 'false');
        menuBtn.setAttribute('aria-label', 'Open menu');
      }
      document.body.style.overflow = '';
      document.body.style.touchAction = '';
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      if (scrollLockY !== undefined) {
        window.scrollTo(0, scrollLockY);
      }
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') {
        previouslyFocused.focus();
      } else if (menuBtn) {
        menuBtn.focus();
      }
      previouslyFocused = null;
    }, delay);
  }

  function openMobileMenu() {
    previouslyFocused = document.activeElement;
    scrollLockY = window.scrollY || window.pageYOffset;
    document.body.classList.add('mobileMenuOpen');
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'true');
      menuBtn.setAttribute('aria-label', 'Close menu');
    }
    if (mobileOverlay) mobileOverlay.setAttribute('aria-hidden', 'false');
    if (mobilePanel) mobilePanel.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    document.body.style.touchAction = 'none';
    document.body.style.position = 'fixed';
    document.body.style.top = -scrollLockY + 'px';
    document.body.style.left = '0';
    document.body.style.right = '0';
    document.body.style.width = '100%';
    if (closeBtn) {
      closeBtn.focus();
    }
  }

  if (menuBtn) {
    menuBtn.addEventListener('click', function () {
      if (document.body.classList.contains('mobileMenuOpen')) {
        closeMobileMenu();
      } else {
        openMobileMenu();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', closeMobileMenu);
  }

  if (mobileOverlay) {
    mobileOverlay.addEventListener('click', closeMobileMenu);
  }

  function scrollToConvincedExact(target) {
    var top = target.getBoundingClientRect().top + (window.pageYOffset || document.documentElement.scrollTop);
    window.scrollTo(0, top);
  }

  menuLinks.forEach(function (link) {
    link.addEventListener('click', function (e) {
      closeMobileMenu();
      var href = link.getAttribute('href') || '';
      if (href.indexOf('#') === 0) {
        var id = href.slice(1);
        var target = document.getElementById(id);
        if (target) {
          e.preventDefault();
          setTimeout(function () {
            if (id === 'convinced') {
              scrollToConvincedExact(target);
            } else {
              target.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
          }, 100);
        }
      }
    });
  });

  document.addEventListener('keydown', function (e) {
    if (!document.body.classList.contains('mobileMenuOpen')) return;
    if (e.key === 'Escape') {
      closeMobileMenu();
      return;
    }
    if (e.key !== 'Tab' || !mobilePanel) return;
    var focusable = getFocusableInPanel();
    if (!focusable.length) return;
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  });

  // Atmos-style: section scroll-reveal (add .in-view when section enters viewport)
  var sections = document.querySelectorAll('.section');
  if (sections.length && 'IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('in-view');
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0 }
    );
    sections.forEach(function (el) {
      observer.observe(el);
    });
  }

  // Big-screen header: scroll effect (when horizontal menu is shown, ≥901px)
  var siteHeader = document.querySelector('.site-header');
  var desktopScroll = function () {
    if (!siteHeader || !window.matchMedia('(min-width: 901px)').matches) return;
    if (window.scrollY > 30) {
      siteHeader.classList.add('is-scrolled');
    } else {
      siteHeader.classList.remove('is-scrolled');
    }
  };
  window.addEventListener('scroll', desktopScroll, { passive: true });
  desktopScroll();

  // Desktop dropdown: close on outside click, Escape, keyboard (aria-expanded)
  var dropdownTriggers = document.querySelectorAll('.nav-item-has-dropdown > a[aria-controls]');
  function closeAllDropdowns() {
    dropdownTriggers.forEach(function (t) {
      t.setAttribute('aria-expanded', 'false');
    });
    document.querySelectorAll('.nav-item-has-dropdown.is-open').forEach(function (el) {
      el.classList.remove('is-open');
    });
  }
  function openDropdown(trigger) {
    closeAllDropdowns();
    trigger.setAttribute('aria-expanded', 'true');
    trigger.closest('.nav-item-has-dropdown').classList.add('is-open');
  }
  dropdownTriggers.forEach(function (trigger) {
    trigger.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (this.getAttribute('aria-expanded') === 'true') {
          closeAllDropdowns();
        } else {
          openDropdown(this);
        }
      }
    });
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') closeAllDropdowns();
  });
  document.addEventListener('click', function (e) {
    if (!window.matchMedia('(min-width: 901px)').matches) return;
    if (e.target.closest('.nav-item-has-dropdown')) return;
    closeAllDropdowns();
  });

  // Pricing: Monthly / Annually toggle
  var pricingTable = document.querySelector('.pricing-table');
  var toggleBtns = document.querySelectorAll('.pricing-toggle-btn');
  if (pricingTable && toggleBtns.length) {
    toggleBtns.forEach(function (btn) {
      btn.addEventListener('click', function () {
        var period = this.getAttribute('data-period');
        toggleBtns.forEach(function (b) {
          b.classList.toggle('active', b.getAttribute('data-period') === period);
          b.setAttribute('aria-pressed', b.getAttribute('data-period') === period ? 'true' : 'false');
        });
        pricingTable.classList.toggle('annual', period === 'annual');
        var amounts = pricingTable.querySelectorAll('.pricing-amount');
        amounts.forEach(function (el) {
          var monthly = el.getAttribute('data-monthly');
          var annual = el.getAttribute('data-annual');
          if (monthly && annual) {
            el.textContent = '$' + (period === 'annual' ? annual : monthly);
          }
        });
      });
    });
  }

  // Contact from any page: show ONLY "READY TO ELEVATE..." block. Run after browser's default hash scroll so first click works.
  function scrollToContactBlockIfNeeded() {
    if (window.location.hash !== '#convinced') return;
    var el = document.getElementById('convinced');
    if (!el) return;
    requestAnimationFrame(function () {
      scrollToConvincedExact(el);
      requestAnimationFrame(function () {
        scrollToConvincedExact(el);
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scrollToContactBlockIfNeeded);
  } else {
    scrollToContactBlockIfNeeded();
  }
  window.addEventListener('load', function () {
    if (window.location.hash !== '#convinced' || !document.getElementById('convinced')) return;
    var el = document.getElementById('convinced');
    function applyScroll() {
      scrollToConvincedExact(el);
    }
    setTimeout(applyScroll, 0);
    setTimeout(applyScroll, 100);
    setTimeout(applyScroll, 250);
    setTimeout(applyScroll, 500);
  });

  // Scroll reveal: image slight parallax, text 20px fade-up
  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion && 'IntersectionObserver' in window) {
    var revealSections = document.querySelectorAll('.section-image-text');
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-inview');
          }
        });
      },
      { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
    );
    revealSections.forEach(function (section) {
      observer.observe(section);
      if (section.getBoundingClientRect().top < window.innerHeight) {
        section.classList.add('is-inview');
      }
    });
  } else {
    document.querySelectorAll('.section-image-text').forEach(function (section) {
      section.classList.add('is-inview');
    });
  }

  // Solutions feature cards — smooth scroll to detail sections
  var SOLUTIONS_SECTION_IDS = ['ip-phone-system', 'our-app', 'automations'];

  function scrollToSolutionsSection(id) {
    var target = document.getElementById(id);
    if (!target) return;
    var smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
  }

  document.querySelectorAll('.index-science-features--solutions .index-science-features__cta[href^="#"], .solutions-buckets__links a[href^="#"]').forEach(function (link) {
    link.addEventListener('click', function (e) {
      var id = (link.getAttribute('href') || '').slice(1);
      if (!id || !document.getElementById(id)) return;
      e.preventDefault();
      if (history.replaceState) {
        history.replaceState(null, '', '#' + id);
      } else {
        window.location.hash = id;
      }
      scrollToSolutionsSection(id);
    });
  });

  if (document.querySelector('.index-science-features--solutions') && window.location.hash) {
    var hashId = window.location.hash.slice(1);
    if (SOLUTIONS_SECTION_IDS.indexOf(hashId) !== -1 && document.getElementById(hashId)) {
      if ('scrollRestoration' in history) {
        history.scrollRestoration = 'manual';
      }
      window.scrollTo(0, 0);

      function animateSolutionsHashScroll() {
        scrollToSolutionsSection(hashId);
      }

      requestAnimationFrame(function () {
        requestAnimationFrame(animateSolutionsHashScroll);
      });
      window.addEventListener('load', function () {
        setTimeout(animateSolutionsHashScroll, 120);
      });
    }
  }
})();
