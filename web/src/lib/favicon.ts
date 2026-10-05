const LINKIT_MARK_RECT = { x: 13.5, y: 13.5, width: 37, height: 37 }

const FAVICON_STROKE = {
  light: "#000",
  dark: "#fff",
} as const

// Browsers render the SVG favicon once and never re-evaluate its
// prefers-color-scheme styles, so a theme change leaves the old color in the
// tab until the next page load. Replacing the link with a data URL carrying
// the theme-colored mark updates the icon immediately.
export function applyFavicon(resolvedTheme: keyof typeof FAVICON_STROKE) {
  const { x, y, width, height } = LINKIT_MARK_RECT
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect x="${x}" y="${y}" width="${width}" height="${height}" fill="none" stroke="${FAVICON_STROKE[resolvedTheme]}" stroke-width="9" stroke-linejoin="round"/></svg>`
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')!
  link.href = `data:image/svg+xml,${encodeURIComponent(svg)}`
}
