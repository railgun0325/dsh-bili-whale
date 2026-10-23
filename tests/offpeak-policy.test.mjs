import test from 'node:test'
import assert from 'node:assert/strict'
import { activityAllowed } from '../lib/offpeak.js'

const at = (hhmm, day = '2026-10-23') => new Date(`${day}T${hhmm}:00+08:00`)
const full = { night: { offPeakOnly: true, windows: [{ start: '00:00', end: '24:00' }] } }
const configured = { night: { offPeakOnly: true, windows: [{ start: '12:10', end: '13:30', wakes: 1 }, { start: '18:10', end: '23:00', wakes: 1 }] } }

test('legacy configurations retain their original scheduling behavior', () => {
  assert.equal(activityAllowed({}, at('10:00')).allowed, true)
  assert.equal(activityAllowed({ night: { offPeakOnly: false } }, at('10:00')).allowed, true)
})

test('fixed Beijing peak boundaries apply conservatively every day', () => {
  for (const day of ['2026-10-23', '2026-10-24', '2026-10-01']) {
    for (const [time, expected] of [['08:59', true], ['09:00', false], ['11:59', false], ['12:00', true], ['13:59', true], ['14:00', false], ['17:59', false], ['18:00', true]]) {
      assert.equal(activityAllowed(full, at(time, day)).allowed, expected, `${day} ${time}`)
    }
  }
})

test('configured activity windows are half open and carry a precise deadline', () => {
  for (const [time, allowed] of [['12:09', false], ['12:10', true], ['13:29', true], ['13:30', false], ['18:09', false], ['18:10', true], ['22:59', true], ['23:00', false]]) {
    assert.equal(activityAllowed(configured, at(time)).allowed, allowed, time)
  }
  assert.equal(activityAllowed(configured, at('12:10')).deadline, '2026-10-23T05:30:00.000Z')
  assert.equal(activityAllowed(full, at('13:00')).deadline, '2026-10-23T06:00:00.000Z')
  assert.equal(activityAllowed(full, at('08:00')).deadline, '2026-10-23T01:00:00.000Z')
})

test('malformed enabled policy fails closed without widening an empty window', () => {
  for (const windows of [undefined, [], [{ start: '25:00', end: '26:00' }], [{ start: '18:00', end: '08:00' }], [{ start: '12:60', end: '13:00' }]]) {
    assert.equal(activityAllowed({ night: { offPeakOnly: true, windows } }, at('20:00')).allowed, false)
  }
  assert.equal(activityAllowed(configured, new Date('invalid')).allowed, false)
})
