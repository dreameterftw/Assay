import type { Finding } from './types'

export type PaletteColor = { name: string; hex: string }

const clamp = (value: number) => Math.max(0, Math.min(255, value))

function rgb(hex: string) {
  const value = hex.replace('#', '')
  return [0, 2, 4].map((index) => Number.parseInt(value.slice(index, index + 2), 16))
}

function distance(left: string, right: string) {
  const a = rgb(left)
  const b = rgb(right)
  return Math.sqrt(a.reduce((total, channel, index) => total + (channel - b[index]) ** 2, 0))
}

export function checkImageMetadata(image: { name: string; width: number; height: number; altText: string; palette: string[] }, approvedPalette: PaletteColor[]): Finding[] {
  const findings: Finding[] = []
  if (!image.altText.trim()) {
    findings.push({ id: 'image-alt-missing', level: 'Needs review', type: 'ACCESSIBILITY · ALT TEXT', title: 'Add descriptive alt text', excerpt: image.name, source: 'WCAG practice · Provide text alternatives for meaningful images', note: 'Describe the image’s purpose and important visible information. Decorative images can use empty alt text when the publishing system supports it.', origin: 'image' })
  }
  if (image.width < 600 || image.height < 400) {
    findings.push({ id: 'image-small', level: 'Watch', type: 'VISUAL · RESOLUTION', title: 'Image may be too small for campaign use', excerpt: `${image.width} × ${image.height}px`, source: 'Workspace check · Minimum recommended image size 600 × 400px', note: 'Check the intended placement; this image may look soft when used in a larger layout.', origin: 'image' })
  }
  if (approvedPalette.length && image.palette.length) {
    const nearest = image.palette.map((color) => Math.min(...approvedPalette.map((approved) => distance(color, approved.hex))))
    const average = nearest.reduce((sum, value) => sum + value, 0) / nearest.length
    if (average > 115) {
      findings.push({ id: 'image-palette-review', level: 'Watch', type: 'VISUAL · PALETTE REVIEW', title: 'Image colors differ from the brand palette', excerpt: image.palette.join(' · '), source: 'Brand Brain · Approved palette', note: 'This is a simple dominant-color comparison. It cannot identify a logo, judge composition, or determine whether the image is intentionally off-palette; review it in context.', origin: 'image' })
    }
  }
  if (!findings.length) {
    findings.push({ id: 'image-check-clear', level: 'Clear', type: 'IMAGE CHECK · BASIC', title: 'Basic image checks passed', excerpt: `${image.width} × ${image.height}px · alt text present`, source: 'Workspace image checks · Metadata and dominant colors', note: 'This check does not inspect logo placement, image meaning, layout, or visual quality.', origin: 'image' })
  }
  return findings
}

export async function inspectImage(file: File): Promise<{ name: string; dataUrl: string; width: number; height: number; altText: string; palette: string[] }> {
  if (!file.type.startsWith('image/')) throw new Error('Choose an image file.')
  if (file.size > 5 * 1024 * 1024) throw new Error('Image is too large. Choose a file under 5 MB.')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Could not read this image.'))
    reader.onload = () => resolve(String(reader.result))
    reader.readAsDataURL(file)
  })
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image()
    image.onerror = () => reject(new Error('This image could not be decoded.'))
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
    image.src = dataUrl
  })
  const thumbnail = await createImageBitmap(file)
  const previewScale = Math.min(1, 900 / Math.max(dimensions.width, dimensions.height))
  const previewCanvas = document.createElement('canvas')
  previewCanvas.width = Math.max(1, Math.round(dimensions.width * previewScale))
  previewCanvas.height = Math.max(1, Math.round(dimensions.height * previewScale))
  const previewContext = previewCanvas.getContext('2d')
  if (!previewContext) throw new Error('Canvas is not available in this browser.')
  previewContext.drawImage(thumbnail, 0, 0, previewCanvas.width, previewCanvas.height)
  const previewDataUrl = previewCanvas.toDataURL('image/jpeg', 0.76)
  const canvas = document.createElement('canvas')
  canvas.width = 32
  canvas.height = 32
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('Canvas is not available in this browser.')
  context.drawImage(thumbnail, 0, 0, 32, 32)
  thumbnail.close()
  const pixels = context.getImageData(0, 0, 32, 32).data
  const bins = new Map<string, number>()
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 160) continue
    const r = clamp(Math.round(pixels[i] / 64) * 64)
    const g = clamp(Math.round(pixels[i + 1] / 64) * 64)
    const b = clamp(Math.round(pixels[i + 2] / 64) * 64)
    const color = `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`
    bins.set(color, (bins.get(color) ?? 0) + 1)
  }
  const palette = [...bins.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([color]) => color)
  return { name: file.name, dataUrl: previewDataUrl, ...dimensions, altText: '', palette }
}
