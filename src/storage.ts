import type { Review } from './types'
import type { BrandRule, ApprovedClaim } from './types'

const STORAGE_KEY = 'assay-workspace-v1'

export type AssayData = { reviews: Review[]; rules: BrandRule[]; claims: ApprovedClaim[] }

export function loadAssayData(reviews: Review[], rules: BrandRule[], claims: ApprovedClaim[]): AssayData {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (!saved) return { reviews, rules, claims }
    const parsed = JSON.parse(saved) as Partial<AssayData>
    return {
      reviews: Array.isArray(parsed.reviews) ? parsed.reviews : reviews,
      rules: Array.isArray(parsed.rules) ? parsed.rules : rules,
      claims: Array.isArray(parsed.claims) ? parsed.claims : claims,
    }
  } catch {
    return { reviews, rules, claims }
  }
}

export function saveAssayData(data: AssayData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    return true
  } catch {
    return false
  }
}
