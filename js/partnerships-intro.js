/**
 * Partnerships intro — live stats + vertical rotator.
 */
(function () {
  'use strict';

  var LiveStats = window.LiveStats;
  if (!LiveStats) {
    return;
  }

  var STAT_ORDER = ['calls', 'messages', 'automations'];
  var ROTATE_MS = 4000;

  function PartnershipsIntro(root) {
    this.root = root;
    this.track = root.querySelector('.partnerships-intro__rotator-track');
    this.items = root.querySelectorAll('.partnerships-intro__stat');
    this.state = null;
    this.config = LiveStats.DEFAULT_CONFIG;
    this.activeIndex = 0;
    this.rotateTimer = null;
    this.tickTimers = {};
    this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  PartnershipsIntro.prototype.init = function () {
    if (!this.track || this.items.length !== STAT_ORDER.length) {
      return;
    }

    var storage = LiveStats.createBrowserStorage();
    this.state = LiveStats.initState(storage, Date.now(), this.config);
    this.syncValues();

    var self = this;
    requestAnimationFrame(function () {
      self.showIndex(0, false);
      if (!self.reducedMotion) {
        self.startRotation();
      }
    });

    this.scheduleTicks();
  };

  PartnershipsIntro.prototype.syncValues = function () {
    var stats = LiveStats.computeAllStats(this.state, Date.now(), this.config);
    var self = this;

    STAT_ORDER.forEach(function (key) {
      var item = self.root.querySelector('.partnerships-intro__stat[data-stat="' + key + '"]');
      if (!item) {
        return;
      }
      var textEl = item.querySelector('[data-stat-text]');
      var value = stats[key];
      var label = LiveStats.formatStatLabel(key, value);
      if (textEl) {
        textEl.textContent = label;
      }
      item.setAttribute('aria-label', label);
    });

    this.root.setAttribute(
      'aria-label',
      LiveStats.formatStatLabel(STAT_ORDER[this.activeIndex], stats[STAT_ORDER[this.activeIndex]])
    );
  };

  PartnershipsIntro.prototype.showIndex = function (index, animate) {
    this.activeIndex = index;
    if (!this.items[0]) {
      return;
    }
    var itemHeight = this.items[0].offsetHeight;
    if (!itemHeight) {
      itemHeight = parseFloat(getComputedStyle(this.items[0]).lineHeight) || 22;
    }
    this.track.style.transition = animate && !this.reducedMotion ? 'transform 0.55s cubic-bezier(0.4, 0, 0.2, 1)' : 'none';
    this.track.style.transform = 'translate3d(0, ' + -index * itemHeight + 'px, 0)';
    this.syncValues();
  };

  PartnershipsIntro.prototype.startRotation = function () {
    var self = this;
    clearInterval(this.rotateTimer);
    this.rotateTimer = setInterval(function () {
      var next = (self.activeIndex + 1) % STAT_ORDER.length;
      self.showIndex(next, true);
    }, ROTATE_MS);
  };

  PartnershipsIntro.prototype.scheduleTicks = function () {
    var self = this;
    STAT_ORDER.forEach(function (key) {
      clearTimeout(self.tickTimers[key]);
      self.scheduleTick(key);
    });
  };

  PartnershipsIntro.prototype.scheduleTick = function (key) {
    var self = this;
    var intervalMs = this.config.intervals[key];
    var delay = LiveStats.msUntilNextIncrement(intervalMs, this.state.anchorMs, Date.now());

    this.tickTimers[key] = setTimeout(function () {
      self.syncValues();
      self.scheduleTick(key);
    }, delay);
  };

  PartnershipsIntro.prototype.destroy = function () {
    clearInterval(this.rotateTimer);
    var self = this;
    STAT_ORDER.forEach(function (key) {
      clearTimeout(self.tickTimers[key]);
    });
  };

  document.addEventListener('DOMContentLoaded', function () {
    var root = document.querySelector('.index-hero-video__stats.partnerships-intro');
    if (!root) {
      return;
    }
    var intro = new PartnershipsIntro(root);
    intro.init();
  });
})();
