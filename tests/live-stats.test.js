'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var LiveStats = require('../js/live-stats.js');

var config = LiveStats.DEFAULT_CONFIG;
var anchor = Date.parse('2026-01-01T00:00:00.000Z');

function stateAtBaseline() {
  return {
    anchorMs: anchor,
    baseline: {
      calls: config.baseline.calls,
      messages: config.baseline.messages,
      automations: config.baseline.automations
    }
  };
}

test('computeStatValue returns baseline at anchor time', function () {
  assert.equal(LiveStats.computeStatValue(60120, 15000, anchor, anchor), 60120);
});

test('computeStatValue increments calls every 15 seconds', function () {
  assert.equal(LiveStats.computeStatValue(60120, 15000, anchor, anchor + 14999), 60120);
  assert.equal(LiveStats.computeStatValue(60120, 15000, anchor, anchor + 15000), 60121);
  assert.equal(LiveStats.computeStatValue(60120, 15000, anchor, anchor + 45000), 60123);
});

test('computeStatValue increments messages every 5 minutes', function () {
  var interval = 300000;
  assert.equal(LiveStats.computeStatValue(4233, interval, anchor, anchor + interval - 1), 4233);
  assert.equal(LiveStats.computeStatValue(4233, interval, anchor, anchor + interval), 4234);
  assert.equal(LiveStats.computeStatValue(4233, interval, anchor, anchor + interval * 3), 4236);
});

test('computeStatValue increments automations every 15 minutes', function () {
  var interval = 900000;
  assert.equal(LiveStats.computeStatValue(150, interval, anchor, anchor + interval - 1), 150);
  assert.equal(LiveStats.computeStatValue(150, interval, anchor, anchor + interval), 151);
  assert.equal(LiveStats.computeStatValue(150, interval, anchor, anchor + interval * 2), 152);
});

test('computeStatValue does not increment before anchor', function () {
  assert.equal(LiveStats.computeStatValue(100, 1000, anchor, anchor - 1), 100);
});

test('computeAllStats returns all counters together', function () {
  var now = anchor + 900000;
  var stats = LiveStats.computeAllStats(stateAtBaseline(), now, config);
  assert.equal(stats.calls, 60120 + Math.floor(900000 / 15000));
  assert.equal(stats.messages, 4233 + Math.floor(900000 / 300000));
  assert.equal(stats.automations, 150 + Math.floor(900000 / 900000));
});

test('computeAllStats persists growth after long absence', function () {
  var weekMs = 7 * 24 * 60 * 60 * 1000;
  var stats = LiveStats.computeAllStats(stateAtBaseline(), anchor + weekMs, config);
  assert.equal(stats.calls, 60120 + Math.floor(weekMs / 15000));
  assert.equal(stats.messages, 4233 + Math.floor(weekMs / 300000));
  assert.equal(stats.automations, 150 + Math.floor(weekMs / 900000));
});

test('initState creates and persists new anchor on first visit', function () {
  var storage = { data: {}, get: function (k) { return this.data[k] || null; }, set: function (k, v) { this.data[k] = v; } };
  var now = anchor;
  var state = LiveStats.initState(storage, now, config);
  assert.equal(state.anchorMs, now);
  assert.deepEqual(state.baseline, config.baseline);
  assert.ok(storage.data[config.storageKey]);
});

test('initState reuses stored anchor on return visit', function () {
  var stored = JSON.stringify({
    anchorMs: anchor,
    baseline: { calls: 60120, messages: 4233, automations: 150 }
  });
  var storage = {
    data: { uipv_live_stats_v1: stored },
    get: function (k) { return this.data[k] || null; },
    set: function () { throw new Error('should not write'); }
  };
  var state = LiveStats.initState(storage, anchor + 600000, config);
  assert.equal(state.anchorMs, anchor);
  var stats = LiveStats.computeAllStats(state, anchor + 600000, config);
  assert.equal(stats.calls, 60120 + 40);
});

test('parseStoredState rejects invalid payloads', function () {
  assert.equal(LiveStats.parseStoredState(null, config), null);
  assert.equal(LiveStats.parseStoredState('{bad', config), null);
  assert.equal(LiveStats.parseStoredState('{"anchorMs":1}', config), null);
});

test('formatNumber adds thousands separators', function () {
  assert.equal(LiveStats.formatNumber(60120), '60,120');
  assert.equal(LiveStats.formatNumber(4233), '4,233');
});

test('formatStatLabel matches display copy', function () {
  assert.equal(LiveStats.formatStatLabel('calls', 60120), '60,120 calls handled');
  assert.equal(LiveStats.formatStatLabel('messages', 4233), '4,233 messages delivered');
  assert.equal(LiveStats.formatStatLabel('automations', 150), '+150 conversations automated');
});

test('msUntilNextIncrement schedules next tick correctly', function () {
  assert.equal(LiveStats.msUntilNextIncrement(15000, anchor, anchor), 15000);
  assert.equal(LiveStats.msUntilNextIncrement(15000, anchor, anchor + 5000), 10000);
  assert.equal(LiveStats.msUntilNextIncrement(15000, anchor, anchor + 15000), 15000);
});

test('throws on invalid interval', function () {
  assert.throws(function () {
    LiveStats.computeStatValue(1, 0, anchor, anchor);
  }, /Invalid baseline or interval/);
});
