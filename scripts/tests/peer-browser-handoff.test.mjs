import assert from 'node:assert/strict'
import test from 'node:test'
import { authStore, PeerAuth, PeerManager } from '../../packages/core/dist/index.js'

const peerRef = '90cda7da-f8b5-4a14-8c0a-fc38961c77ee'
const capability = 'inkcre.twitter.x-monkey.session.v1'
const jwt = 'test-peer-jwt-never-in-url'
const protocol = 'core.peer.protocol.browser-form.v1'

function harness({
  base = 'https://core.example/deployment',
  inboundProtocol = protocol,
  parameters = {
    method: 'POST',
    path: '/twitter/x-monkey/session',
    credential_field: 'token',
  },
} = {}) {
  const observation = { resolveCalls: [], credentialReads: 0, appended: [], submits: 0, removed: 0 }
  const form = {
    method: '',
    enctype: '',
    action: '',
    target: '',
    fields: [],
    append(field) {
      this.fields.push(field)
    },
    submit() {
      observation.submits += 1
    },
    remove() {
      observation.removed += 1
    },
  }
  const document = {
    createElement(tag) {
      if (tag === 'form') return form
      return { type: '', name: '', value: '' }
    },
    body: {
      append(value) {
        observation.appended.push(value)
      },
    },
  }
  const previousResolve = PeerManager.resolveLiveCapability.bind(PeerManager)
  const previousRefresh = authStore.refreshToken.bind(authStore)
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
  PeerManager.resolveLiveCapability = async (...args) => {
    observation.resolveCalls.push(args)
    return {
      peer: { id: peerRef, config: { http_public_base_url: base } },
      advertisement: { id: capability, inbound: { protocol: inboundProtocol, parameters } },
    }
  }
  authStore.refreshToken = async () => {
    observation.credentialReads += 1
    return jwt
  }
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document })
  return {
    observation,
    form,
    restore() {
      PeerManager.resolveLiveCapability = previousResolve
      authStore.refreshToken = previousRefresh
      if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument)
      else delete globalThis.document
    },
  }
}

void test('selected Peer handoff posts a fresh credential only in a top-level form body', async () => {
  const state = harness()
  try {
    const result = await PeerAuth.navigateWithCredential(peerRef, capability)

    assert.deepEqual(result, { status: 'initiated', peerRef })
    assert.deepEqual(state.observation.resolveCalls, [[peerRef, capability]])
    assert.equal(state.observation.credentialReads, 1)
    assert.equal(state.form.method, 'post')
    assert.equal(state.form.enctype, 'application/x-www-form-urlencoded')
    assert.equal(state.form.target, '_top')
    assert.equal(state.form.action, 'https://core.example/deployment/twitter/x-monkey/session')
    assert.deepEqual(state.form.fields, [{ type: 'hidden', name: 'token', value: jwt }])
    assert.equal(state.form.action.includes(jwt), false)
    assert.deepEqual(state.observation.appended, [state.form])
    assert.equal(state.observation.submits, 1)
    assert.equal(state.observation.removed, 1)
    assert.deepEqual(Object.keys(result).sort(), ['peerRef', 'status'])
  } finally {
    state.restore()
  }
})

void test('untrusted target shapes and wrong transport are rejected before credential access', async (t) => {
  for (const scenario of [
    { name: 'non-HTTPS public base', base: 'http://core.example' },
    { name: 'userinfo in public base', base: 'https://user:pass@core.example' },
    { name: 'query in public base', base: 'https://core.example/base?redirect=elsewhere' },
    {
      name: 'absolute or scheme-relative route',
      parameters: { method: 'POST', path: '//evil.example/a', credential_field: 'token' },
    },
    {
      name: 'encoded route characters',
      parameters: { method: 'POST', path: '/twitter/%2Fsession', credential_field: 'token' },
    },
    {
      name: 'arbitrary URL parameter',
      parameters: {
        method: 'POST',
        path: '/twitter/session',
        credential_field: 'token',
        url: 'https://evil.example/collect',
      },
    },
    {
      name: 'form-control field name',
      parameters: { method: 'POST', path: '/twitter/session', credential_field: 'submit' },
    },
    {
      name: 'wrong HTTP method',
      parameters: { method: 'GET', path: '/twitter/session', credential_field: 'token' },
    },
    { name: 'wrong transport', inboundProtocol: 'core.peer.protocol.http.v1' },
  ]) {
    await t.test(scenario.name, async () => {
      const state = harness(scenario)
      try {
        await assert.rejects(PeerAuth.navigateWithCredential(peerRef, capability))
        assert.equal(state.observation.credentialReads, 0)
        assert.equal(state.observation.submits, 0)
      } finally {
        state.restore()
      }
    })
  }
})
