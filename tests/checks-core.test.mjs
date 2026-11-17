import assert from 'node:assert/strict'
import test from 'node:test'
import { findingKey, runChecks, runImageChecks } from '../src/lib/checks-core.ts'

test('finding keys and saved text fit database limits for long rules and claims', () => {
  const rules = [{
    id: 'a2000000-0000-4000-8000-000000000001',
    rule_key: 'long-description',
    version: 1,
    category: 'tone',
    title: '😀'.repeat(180),
    description: '😀'.repeat(20000),
    source_label: 'test',
    severity: 'medium',
    match_text: 'flag',
    active: true,
    status: 'approved',
  }]
  const claims = [{
    id: 'a3000000-0000-4000-8000-000000000001',
    version: 1,
    statement: 'approved value '.repeat(300),
    evidence_label: 'source',
    owner_label: 'owner',
    expires_at: '2020-01-01',
    active: true,
  }]

  const findings = runChecks({
    content: `flag ${claims[0].statement}`,
    rules,
    claims,
    today: '2026-01-01',
  })

  assert.equal(findings.length, 2)
  for (const finding of findings) {
    assert.ok(Buffer.byteLength(finding.finding_key, 'utf8') <= 2000)
    assert.ok(Buffer.byteLength(finding.title, 'utf8') <= 500)
    assert.ok(Buffer.byteLength(finding.explanation, 'utf8') <= 50000)
  }
})

test('image checks emit stable database findings without browser APIs', () => {
  const asset = {
    id: 'a9000000-0000-4000-8000-000000000001',
    filename: 'campaign.png',
    width: 100,
    height: 100,
    alt_text: '',
    palette: ['#ffffff'],
  }
  const first = runImageChecks({ asset })
  const second = runImageChecks({ asset })

  assert.deepEqual(first, second)
  assert.ok(first.some((finding) => finding.source_kind === 'image_check' && finding.category === 'accessibility'))
  assert.ok(first.every((finding) => Buffer.byteLength(finding.finding_key, 'utf8') <= 2000))
  assert.equal(findingKey({ sourceId: asset.id, type: 'image_check', title: 'issue', excerpt: 'x'.repeat(5000) }),
    findingKey({ sourceId: asset.id, type: 'image_check', title: 'issue', excerpt: 'x'.repeat(100) }))
})
