/**
 * Live platform metrics — clock-synced counters.
 * Rolling odometer is used for Calls only; Messages / Automations stay plain.
 */
(function () {
  'use strict';

  var root = document.querySelector('[data-live-metrics]');
  if (!root) return;

  var EPOCH_MS = Date.parse('2026-07-31T17:05:00.000Z');

  var METRICS = {
    calls: { base: 62000, perMs: 1 / 15000, odometer: true },
    messages: { base: 4200, perMs: 1 / 60000, odometer: false },
    automations: { base: 120, perMs: 25 / 86400000, odometer: false }
  };

  var reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var meters = {};
  var plain = {};

  function trueValue(key, now) {
    var cfg = METRICS[key];
    return cfg.base + Math.max(0, now - EPOCH_MS) * cfg.perMs;
  }

  function formatInt(n) {
    return Math.floor(n).toLocaleString('en-US');
  }

  function formatParts(n) {
    var s = formatInt(n);
    var parts = [];
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch >= '0' && ch <= '9') parts.push({ type: 'digit', d: +ch });
      else parts.push({ type: 'sep', ch: ch });
    }
    return parts;
  }

  function buildMeter(host) {
    host.textContent = '';
    host.classList.add('odometer');
    host.setAttribute('aria-live', 'off');

    var track = document.createElement('span');
    track.className = 'odometer__track';
    host.appendChild(track);

    return {
      host: host,
      track: track,
      slots: [],
      lastInt: -1
    };
  }

  function digitRibbon() {
    var wrap = document.createElement('span');
    wrap.className = 'odometer__digit';
    var ribbon = document.createElement('span');
    ribbon.className = 'odometer__ribbon';
    for (var i = 0; i <= 10; i++) {
      var n = document.createElement('span');
      n.className = 'odometer__num';
      n.textContent = String(i % 10);
      ribbon.appendChild(n);
    }
    wrap.appendChild(ribbon);
    return { wrap: wrap, ribbon: ribbon };
  }

  function ensureSlots(meter, parts) {
    var needRebuild = meter.slots.length !== parts.length;
    if (!needRebuild) {
      for (var i = 0; i < parts.length; i++) {
        if (meter.slots[i].type !== parts[i].type) {
          needRebuild = true;
          break;
        }
      }
    }
    if (!needRebuild) return;

    meter.track.textContent = '';
    meter.slots = [];
    parts.forEach(function (part) {
      if (part.type === 'sep') {
        var sep = document.createElement('span');
        sep.className = 'odometer__sep';
        sep.textContent = part.ch;
        meter.track.appendChild(sep);
        meter.slots.push({ type: 'sep', el: sep });
      } else {
        var dig = digitRibbon();
        meter.track.appendChild(dig.wrap);
        meter.slots.push({ type: 'digit', wrap: dig.wrap, ribbon: dig.ribbon, shown: 0 });
      }
    });
  }

  function setRibbon(ribbon, value, withTransition) {
    if (withTransition && !reducedMotion) {
      ribbon.style.transition = '';
      ribbon.classList.add('is-rolling');
    } else {
      ribbon.style.transition = 'none';
      ribbon.classList.remove('is-rolling');
    }
    ribbon.style.transform = 'translate3d(0, ' + (-value) + 'em, 0)';
  }

  function renderOdometer(meter, value, forceSnap) {
    var intVal = Math.floor(value);
    var frac = value - intVal;
    var parts = formatParts(intVal);
    ensureSlots(meter, parts);

    var digitIndex = 0;
    var digitCount = 0;
    for (var p = 0; p < parts.length; p++) {
      if (parts[p].type === 'digit') digitCount++;
    }

    parts.forEach(function (part, i) {
      var slot = meter.slots[i];
      if (part.type === 'sep') return;

      digitIndex += 1;
      var isUnits = digitIndex === digitCount;
      var target = part.d;

      if (isUnits && !reducedMotion && !forceSnap) {
        target = part.d + frac;
      }

      var higherChanged = !isUnits && slot.shown !== part.d && meter.lastInt !== -1;
      setRibbon(slot.ribbon, target, higherChanged && !forceSnap);
      slot.shown = part.d;
    });

    if (intVal !== meter.lastInt && meter.lastInt !== -1) {
      meter.host.classList.remove('is-ticking');
      void meter.host.offsetWidth;
      meter.host.classList.add('is-ticking');
    }

    meter.lastInt = intVal;
    meter.host.setAttribute('aria-label', formatInt(intVal));
  }

  function renderPlain(el, value) {
    el.textContent = formatInt(value);
  }

  Object.keys(METRICS).forEach(function (key) {
    var el = root.querySelector('[data-metric="' + key + '"] [data-metric-value]');
    if (!el) return;
    if (METRICS[key].odometer) {
      meters[key] = buildMeter(el);
    } else {
      el.classList.remove('odometer');
      plain[key] = el;
    }
  });

  function paint(now, snap) {
    Object.keys(meters).forEach(function (key) {
      renderOdometer(meters[key], trueValue(key, now), !!snap);
    });
    Object.keys(plain).forEach(function (key) {
      renderPlain(plain[key], trueValue(key, now));
    });
  }

  paint(Date.now(), true);

  var lastTs = 0;
  function frame(ts) {
    if (ts - lastTs >= 33) {
      paint(Date.now(), false);
      lastTs = ts;
    }
    window.requestAnimationFrame(frame);
  }
  window.requestAnimationFrame(frame);

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'visible') paint(Date.now(), true);
  });
})();
