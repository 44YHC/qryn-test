const { _it, clokiExtUrl, axiosGet, axiosPost, axiosDelete } = require('./common')
const yaml = require('yaml')

// Recording-rule CRUD against the Prometheus ruler API (/api/v1/rules...).
// A unique namespace/group keeps the tests isolated and idempotent.
const ns = 'e2e_rec_ns'
const groupName = 'e2e_rec_group'
const recordName = 'e2e:test_recording_rule'
const expr = 'sum(rate(test_metric_min[1m]))'

const ruleGroup = {
  name: groupName,
  interval: '10s',
  rules: [{
    record: recordName,
    expr,
    labels: { e2e: 'true' }
  }]
}

const anyStatus = () => ({ validateStatus: () => true })

// The rule store is ClickHouse-backed (INSERT + SELECT ... FINAL), so writes are
// not immediately visible. Poll until `check` returns truthy or we time out.
const waitFor = async (check, { tries = 30, delayMs = 1000 } = {}) => {
  let last
  for (let i = 0; i < tries; i++) {
    try {
      const res = await check()
      if (res) return res
    } catch (e) {
      last = e
    }
    await new Promise(f => setTimeout(f, delayMs))
  }
  throw last || new Error('waitFor: condition not met within timeout')
}

_it('should create a recording rule group', async () => {
  const res = await axiosPost(
    `http://${clokiExtUrl}/api/v1/rules/${ns}`,
    yaml.stringify(ruleGroup),
    { headers: { 'Content-Type': 'application/yaml' } }
  )
  expect(res.status).toEqual(202)
  expect(res.data).toHaveProperty('status', 'success')
})

_it('should read the recording rule group back by namespace', async () => {
  const group = await waitFor(async () => {
    const res = await axiosGet(`http://${clokiExtUrl}/api/v1/rules/${ns}`, anyStatus())
    if (res.status !== 200) return null
    const parsed = yaml.parse(res.data)
    return (parsed[ns] || []).find(g => g.name === groupName)
  })
  expect(group.rules[0]).toMatchObject({ record: recordName, expr })
}, ['should create a recording rule group'])

_it('should read a single recording rule group by name', async () => {
  const group = await waitFor(async () => {
    const res = await axiosGet(`http://${clokiExtUrl}/api/v1/rules/${ns}/${groupName}`, anyStatus())
    if (res.status !== 200) return null
    return yaml.parse(res.data)
  })
  expect(group).toMatchObject({ name: groupName, interval: '10s' })
  expect(group.rules[0]).toMatchObject({ record: recordName, expr })
}, ['should create a recording rule group'])

_it('should expose the recording rule in Prometheus /api/v1/rules format', async () => {
  const rule = await waitFor(async () => {
    const res = await axiosGet(`http://${clokiExtUrl}/api/v1/rules`, anyStatus())
    if (res.status !== 200 || res.data.status !== 'success') return null
    const group = (res.data.data.groups || []).find(g => g.name === groupName && g.file === ns)
    return group && group.rules.find(r => r.name === recordName)
  })
  expect(rule).toMatchObject({ type: 'recording', query: expr })
}, ['should create a recording rule group'])

_it('should delete the recording rule group', async () => {
  const res = await axiosDelete(`http://${clokiExtUrl}/api/v1/rules/${ns}/${groupName}`)
  expect(res.status).toEqual(202)
  expect(res.data).toHaveProperty('status', 'success')
}, [
  'should read the recording rule group back by namespace',
  'should read a single recording rule group by name',
  'should expose the recording rule in Prometheus /api/v1/rules format'
])

_it('should 404 the namespace after deletion', async () => {
  await waitFor(async () => {
    const res = await axiosGet(`http://${clokiExtUrl}/api/v1/rules/${ns}`, anyStatus())
    return res.status === 404
  })
}, ['should delete the recording rule group'])
