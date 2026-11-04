/** An SVG path along `share` of a circle, clockwise from its top. A whole circle's two ends would meet and draw nothing, so it stops just short. */
export function arcFromTop(center: number, radius: number, share: number): string {
  if (share <= 0) return ""
  const angle = Math.min(share, 0.9999) * 2 * Math.PI
  return `M ${center} ${center - radius} A ${radius} ${radius} 0 ${angle > Math.PI ? 1 : 0} 1 ${center + radius * Math.sin(angle)} ${center - radius * Math.cos(angle)}`
}
