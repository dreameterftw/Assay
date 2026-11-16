import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const fixture = JSON.parse(await readFile(new URL('../benchmarks/deterministic-review.json', import.meta.url), 'utf8'))
const source = await readFile(new URL('../src/checks.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const moduleUrl = `data:text/javascript;base64,${Buffer.from(compiled.outputText).toString('base64')}`
const { runDeterministicChecks } = await import(moduleUrl)

const metrics = new Map()
let exactCaseMatches = 0
let citedFindings = 0
let totalFindings = 0
const failures = []

for (const item of fixture.cases) {
  const findings = runDeterministicChecks(item.content, fixture.rules, fixture.claims, fixture.today).filter((finding) => finding.level !== 'Clear')
  const actual = new Set(findings.map((finding) => finding.type.split(' · ')[0]))
  const expected = new Set(item.expected)
  const categories = new Set([...actual, ...expected])
  for (const category of categories) {
    const stats = metrics.get(category) ?? { tp: 0, fp: 0, fn: 0 }
    if (expected.has(category) && actual.has(category)) stats.tp += 1
    else if (actual.has(category)) stats.fp += 1
    else stats.fn += 1
    metrics.set(category, stats)
  }
  if ([...expected].every((value) => actual.has(value)) && [...actual].every((value) => expected.has(value))) exactCaseMatches += 1
  totalFindings += findings.length
  citedFindings += findings.filter((finding) => Boolean(finding.sourceId && finding.source.trim())).length
  if ([...expected].some((value) => !actual.has(value)) || [...actual].some((value) => !expected.has(value))) failures.push({ id: item.id, expected: [...expected], actual: [...actual] })
}

const byCategory = Object.fromEntries([...metrics.entries()].map(([category, value]) => [category, {
  ...value,
  precision: value.tp + value.fp ? Number((value.tp / (value.tp + value.fp)).toFixed(3)) : 1,
  recall: value.tp + value.fn ? Number((value.tp / (value.tp + value.fn)).toFixed(3)) : 1,
}]))
const report = {
  benchmark: fixture.version,
  cases: fixture.cases.length,
  exactCaseMatchRate: Number((exactCaseMatches / fixture.cases.length).toFixed(3)),
  citationRate: totalFindings ? Number((citedFindings / totalFindings).toFixed(3)) : 1,
  byCategory,
  failures,
  note: 'Synthetic smoke benchmark; not a representative quality or safety evaluation.',
}
console.log(JSON.stringify(report, null, 2))
if (failures.length) process.exitCode = 1
