/**
 * Live counter stats — time-based increments with persistent anchor in storage.
 * Calls +1 / 15s, messages +1 / 5m, automations +1 / 15m.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  } else {
    root.LiveStats = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var DEFAULT_CONFIG = {
    storageKey: 'uipv_live_stats_v1',
    baseline: {
      calls: 60120,
      messages: 4233,
      automations: 150
    },
    intervals: {
      calls: 15000,
      messages: 300000,
      automations: 900000
    }
  };

  function computeStatValue(baseline, intervalMs, anchorMs, nowMs) {
    if (!Number.isFinite(baseline) || !Number.isFinite(intervalMs) || intervalMs <= 0) {
      throw new Error('Invalid baseline or interval');
    }
    if (!Number.isFinite(anchorMs) || !Number.isFinite(nowMs)) {
      throw new Error('Invalid timestamp');
    }
    if (nowMs < anchorMs) {
      return baseline;
    }
    return baseline + Math.floor((nowMs - anchorMs) / intervalMs);
  }

  function computeAllStats(state, nowMs, config) {
    config = config || DEFAULT_CONFIG;
    var baseline = state.baseline;
    var anchorMs = state.anchorMs;
    var intervals = config.intervals;

    return {
      calls: computeStatValue(baseline.calls, intervals.calls, anchorMs, nowMs),
      messages: computeStatValue(baseline.messages, intervals.messages, anchorMs, nowMs),
      automations: computeStatValue(
        baseline.automations,
        intervals.automations,
        anchorMs,
        nowMs
      )
    };
  }

  function parseStoredState(raw, config) {
    config = config || DEFAULT_CONFIG;
    if (!raw) {
      return null;
    }
    try {
      var parsed = JSON.parse(raw);
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        !Number.isFinite(parsed.anchorMs) ||
        !parsed.baseline ||
        !Number.isFinite(parsed.baseline.calls) ||
        !Number.isFinite(parsed.baseline.messages) ||
        !Number.isFinite(parsed.baseline.automations)
      ) {
        return null;
      }
      return {
        anchorMs: parsed.anchorMs,
        baseline: {
          calls: parsed.baseline.calls,
          messages: parsed.baseline.messages,
          automations: parsed.baseline.automations
        }
      };
    } catch (err) {
      return null;
    }
  }

  function initState(storage, nowMs, config) {
    config = config || DEFAULT_CONFIG;
    var existing = storage && storage.get ? storage.get(config.storageKey) : null;
    var state = parseStoredState(existing, config);

    if (!state) {
      state = {
        anchorMs: nowMs,
        baseline: {
          calls: config.baseline.calls,
          messages: config.baseline.messages,
          automations: config.baseline.automations
        }
      };
      if (storage && storage.set) {
        storage.set(config.storageKey, JSON.stringify(state));
      }
    }

    return state;
  }

  function formatNumber(value) {
    return Number(value).toLocaleString('en-US');
  }

  function formatStatLabel(key, value) {
    var formatted = formatNumber(value);
    if (key === 'automations') {
      return '+' + formatted + ' conversations automated';
    }
    if (key === 'calls') {
      return formatted + ' calls handled';
    }
    if (key === 'messages') {
      return formatted + ' messages delivered';
    }
    return formatted;
  }

  function msUntilNextIncrement(intervalMs, anchorMs, nowMs) {
    var elapsed = Math.max(0, nowMs - anchorMs);
    var remainder = elapsed % intervalMs;
    return intervalMs - remainder;
  }

  function createBrowserStorage() {
    return {
      get: function (key) {
        try {
          return window.localStorage.getItem(key);
        } catch (err) {
          return null;
        }
      },
      set: function (key, value) {
        try {
          window.localStorage.setItem(key, value);
        } catch (err) {
          /* no-op */
        }
      }
    };
  }

  return {
    DEFAULT_CONFIG: DEFAULT_CONFIG,
    computeStatValue: computeStatValue,
    computeAllStats: computeAllStats,
    parseStoredState: parseStoredState,
    initState: initState,
    formatNumber: formatNumber,
    formatStatLabel: formatStatLabel,
    msUntilNextIncrement: msUntilNextIncrement,
    createBrowserStorage: createBrowserStorage
  };
});
