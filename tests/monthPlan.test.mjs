import test from 'node:test'
import assert from 'node:assert/strict'
import { usHolidays } from '../lib/publish-schedule/holidays.js'
import { workingDays, planDueDay, allocate, interleave, buildMonthPlan } from '../lib/aeo/monthPlan.js'
import { planPublishDays } from '../lib/aeo/schedule.js'

test('2026 holidays', () => {
  assert.deepEqual([...usHolidays(2026).keys()], ['2026-01-01','2026-05-25','2026-07-03','2026-09-07','2026-11-26','2026-11-27','2026-12-25'])
})
test('2027 New Year observed and July 4 on Monday', () => {
  const h = usHolidays(2027)
  assert.ok(h.has('2027-01-01')); assert.ok(h.has('2027-07-05')); assert.ok(h.has('2027-12-24'))
})
test('working days', () => {
  assert.equal(workingDays('2026-12-01').length, 22)
  assert.equal(workingDays('2027-01-01').length, 20)
})
test('plan due day: 5 working days before December 2026', () => {
  assert.equal(planDueDay('2026-12-01'), '2026-11-20')
  assert.equal(planDueDay('2027-01-01'), '2026-12-24')
})
test('publish days skip holidays', () => {
  assert.deepEqual(planPublishDays(3, { today: '2026-11-24', start: '2026-11-25' }), ['2026-11-25','2026-11-30','2026-12-01'])
})
const mk = (pillar, n, score) => Array.from({ length: n }, (_, i) => ({ group: { id: pillar + i, code: pillar + i }, pillar: { id: pillar }, score: score - i * 0.01 }))
test('allocate decays per theme and caps', () => {
  const c = [...mk('A', 8, 1), ...mk('B', 8, 0.5)]
  const { picks, shortfall } = allocate(c, 6)
  assert.equal(shortfall, 0)
  const a = picks.filter((p) => p.pillar.id === 'A').length
  assert.equal(a, 4) // 1, .59, .35, .21 vs B .5, .29 ...
  const big = allocate(c, 14)
  assert.equal(big.picks.filter((p) => p.pillar.id === 'A').length, 8)
  assert.ok(big.capRelaxed)
})
test('shortfall when too few groups', () => {
  const { shortfall } = allocate(mk('A', 3, 1), 5)
  assert.equal(shortfall, 2)
})
test('interleave alternates themes', () => {
  const { picks } = allocate([...mk('A', 3, 1), ...mk('B', 3, 0.9)], 4)
  assert.deepEqual(interleave(picks).map((p) => p.pillar.id), ['A','B','A','B'])
})
test('buildMonthPlan leaves taken days out', () => {
  const pillars = [{ id: 'P' }]
  const groups = Array.from({ length: 30 }, (_, i) => ({ id: 'g' + i, code: 'g' + i, pillar_id: 'P', status: 'new', page_type: 'supporting' }))
  const plan = buildMonthPlan({ month: '2026-12-01', pillars, groups, prompts: [], takenDays: ['2026-12-01'] })
  assert.equal(plan.slots, 21)
  assert.equal(plan.picks[0].day, '2026-12-02')
  assert.equal(plan.shortfall, 0)
})
