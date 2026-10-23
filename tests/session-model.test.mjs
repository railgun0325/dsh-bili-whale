import test from 'node:test'
import assert from 'node:assert/strict'
import { selectWhaleSessionModel, resolveWhaleModelSelection } from '../lib/model-selection.js'
import { resolveSessionConfig } from '../lib/session-config.js'

const desired = { provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'high' }
const target = { id: 'bili-whale', cwd: '/whale/workspace' }
function fixture() {
  const globalDefault = { provider: 'codex-chatgpt', model: 'gpt-6.1-sol', reasoningEffort: 'xhigh' }
  const original = JSON.stringify(globalDefault)
  const events = []
  const agent = { id: target.id, status: 'idle', session: { header: { cwd: target.cwd } } }
  const current = { value: null }
  const ctx = {
    agentDefaultModel: { saveSelection() { throw new Error('global model mutation forbidden') } },
    llm: {
      async listProviders() { return [{ id: desired.provider }] },
      async listModels() { return [{ id: desired.model }] },
      async resolveCallConfig(value) { return { ...value } },
    },
    sessionController: {
      async resolveAgent(id) { assert.equal(id, target.id); return { agent } },
      selectModel() { throw new Error('global-changing RPC forbidden') },
      agents: {
        async serializeImageAdmission(subject, action) { assert.equal(subject, agent); return action() },
        selectForNextRequest(subject, value) {
          assert.equal(subject, agent)
          events.push({ type: 'model/selection', sessionId: subject.id, data: { ...value } })
          current.value = { ...value }
        },
      },
    },
  }
  return { ctx, agent, events, current, globalDefault, original }
}

test('selects and logs only the fixed whale model; global default stays byte identical', async () => {
  const f = fixture()
  const result = await selectWhaleSessionModel(f.ctx, target, desired)
  assert.deepEqual(result, { sessionId: target.id, selected: desired })
  assert.deepEqual(f.current.value, desired)
  assert.deepEqual(f.events, [{ type: 'model/selection', sessionId: target.id, data: desired }])
  assert.equal(JSON.stringify(f.globalDefault), f.original)
})

test('missing/unsupported route or secrets in config fail closed, never using global default', async () => {
  for (const selection of [undefined, {}, { ...desired, provider: 'codex-chatgpt' }, { ...desired, model: 'deepseek-v4-pro' }, { ...desired, reasoningEffort: 'xhigh' }, { ...desired, apiKey: 'fixture' }]) {
    const f = fixture()
    await assert.rejects(selectWhaleSessionModel(f.ctx, target, selection))
    assert.equal(f.events.length, 0)
    assert.equal(JSON.stringify(f.globalDefault), f.original)
  }
})

test('target identity, cwd, subagent and running-session guards prevent any selection', async () => {
  for (const change of [
    (f) => { f.agent.id = 'chief' },
    (f) => { f.agent.session.header.cwd = '/chief' },
    (f) => { f.agent.session.header.origin = 'subagent' },
    (f) => { f.agent.session.header.parentSession = 'chief' },
    (f) => { f.agent.status = 'running' },
  ]) {
    const f = fixture(); change(f)
    await assert.rejects(selectWhaleSessionModel(f.ctx, target, desired))
    assert.equal(f.events.length, 0)
  }
  const f = fixture()
  await assert.rejects(selectWhaleSessionModel(f.ctx, { ...target, id: 'chief' }, desired))
  assert.equal(f.events.length, 0)
})

test('missing Host capability, missing provider/model, resolution failure or route substitution refuses binding', async () => {
  for (const change of [
    (f) => { delete f.ctx.sessionController.agents.selectForNextRequest },
    (f) => { delete f.ctx.sessionController.agents.serializeImageAdmission },
    (f) => { f.ctx.llm.listProviders = async () => [] },
    (f) => { f.ctx.llm.listModels = async () => [] },
    (f) => { f.ctx.llm.resolveCallConfig = async () => { throw new Error('model unavailable') } },
    (f) => { f.ctx.llm.resolveCallConfig = async () => ({ ...desired, provider: 'codex-chatgpt' }) },
    (f) => { f.ctx.llm.resolveCallConfig = async () => { f.agent.status = 'running'; return desired } },
  ]) {
    const f = fixture(); change(f)
    await assert.rejects(selectWhaleSessionModel(f.ctx, target, desired))
    assert.equal(f.events.length, 0)
    assert.equal(JSON.stringify(f.globalDefault), f.original)
  }
})

test('session settings preserve validated model selection through save normalization', () => {
  assert.deepEqual(resolveSessionConfig({ session: { ...target, modelSelection: desired } }, target), { ...target, modelSelection: desired })
  assert.throws(() => resolveSessionConfig({ session: { ...target, modelSelection: { ...desired, token: 'fixture' } } }, target))
  assert.deepEqual(resolveWhaleModelSelection(desired), desired)
})


test('disposed scheduler cannot commit a late asynchronous model resolution', async () => {
  const f = fixture()
  const lifetime = new AbortController()
  let ready
  const pending = new Promise((resolve) => { ready = resolve })
  f.ctx.llm.resolveCallConfig = async () => pending
  const selecting = selectWhaleSessionModel(f.ctx, target, desired, { signal: lifetime.signal })
  for (let i = 0; i < 10; i++) await Promise.resolve()
  lifetime.abort()
  ready(desired)
  await assert.rejects(selecting)
  assert.equal(f.events.length, 0)
})


test('binding acknowledges only after an asynchronous selection commit resolves', async () => {
  const f = fixture()
  let release
  const waiting = new Promise((resolve) => { release = resolve })
  const commit = f.ctx.sessionController.agents.selectForNextRequest
  f.ctx.sessionController.agents.selectForNextRequest = async (...args) => { await waiting; commit(...args) }
  let complete = false
  const binding = selectWhaleSessionModel(f.ctx, target, desired).then(() => { complete = true })
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(complete, false)
  assert.equal(f.events.length, 0)
  release()
  await binding
  assert.equal(complete, true)
  assert.equal(f.events.length, 1)
})
