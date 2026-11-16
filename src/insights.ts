import type { Review } from './types'

export function buildRadar(reviews: Review[]) {
  const findings = reviews.flatMap((review) => (review.findings ?? []).filter((finding) => finding.level !== 'Clear').map((finding) => ({ review, finding })))
  const counts = new Map<string, { title: string; type: string; count: number; reviewIds: string[] }>()
  for (const { review, finding } of findings) {
    const key = finding.sourceId || finding.title
    const current = counts.get(key) ?? { title: finding.title, type: finding.type.split(' · ')[0], count: 0, reviewIds: [] }
    current.count += 1
    if (!current.reviewIds.includes(review.id)) current.reviewIds.push(review.id)
    counts.set(key, current)
  }
  const repeated = [...counts.values()].sort((a, b) => b.count - a.count)
  const statuses = reviews.reduce<Record<string, number>>((all, review) => ({ ...all, [review.status]: (all[review.status] ?? 0) + 1 }), {})
  const openFindings = findings.length
  const resolvedActions = reviews.reduce((total, review) => total + (review.events ?? []).filter((item) => /resolved|dismissed|confirmed/i.test(item.action)).length, 0)
  const changesRequested = reviews.reduce((total, review) => total + (review.events ?? []).filter((item) => /changes requested/i.test(item.action)).length, 0)
  const ambiguous = repeated.filter((item) => item.count >= 2)
  return { repeated, statuses, openFindings, resolvedActions, changesRequested, ambiguous, reviewCount: reviews.length }
}
