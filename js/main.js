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
  var menuLinks = document.querySelectorAll('.mobileMenuPanel .menuLinks a, .mobileMenuPanel .menuCTA a');
  var scrollLockY = 0;

  function closeMobileMenu() {
    if (!document.body.classList.contains('mobileMenuOpen')) return;
    var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var delay = reducedMotion ? 0 : 580;
    document.body.classList.add('mobileMenuClosing');
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
      if (menuBtn) {
        menuBtn.focus();
      }
    }, delay);
  }

  function openMobileMenu() {
    scrollLockY = window.scrollY || window.pageYOffset;
    document.body.classList.add('mobileMenuOpen');
    if (menuBtn) {
      menuBtn.setAttribute('aria-expanded', 'true');
      menuBtn.setAttribute('aria-label', 'Close menu');
    }
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
    if (e.key === 'Escape' && document.body.classList.contains('mobileMenuOpen')) {
      closeMobileMenu();
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
})();
