/**
 * One distinguishable color per row in a chart's own legend — for a pie/donut/stacked-bar where every
 * category must be tellable apart at a glance (a fault-type breakdown, a device-model split, ...). Never
 * key a chart's per-category color off a small enum like severity: two categories sharing a severity
 * would then share a color too, and the legend would claim to distinguish rows the chart cannot actually
 * show apart (found on the fleet dashboard's "active faults by type" donut, where every fault type
 * shares one of only 4 severities).
 *
 * 12 hues around the wheel, chosen to stay legible on both the light and dark surfaces this app uses
 * (mid saturation/lightness — no near-black or near-white entries). Pass each row's position in the
 * array being charted (`data.map((row, i) => categoricalColor(i))`): sequential indices guarantee no two
 * of a chart's own rows collide, up to 12 of them — every category this app charts today (≤ 11 fault
 * types) fits inside that with room to spare.
 */
const CATEGORICAL_PALETTE = [
  '#2563EB', // blue
  '#DC2626', // red
  '#059669', // emerald
  '#D97706', // amber
  '#7C3AED', // violet
  '#0891B2', // cyan
  '#DB2777', // pink
  '#65A30D', // lime
  '#EA580C', // orange
  '#4F46E5', // indigo
  '#0D9488', // teal
  '#CA8A04', // gold
];

export function categoricalColor(index: number): string {
  return CATEGORICAL_PALETTE[((index % CATEGORICAL_PALETTE.length) + CATEGORICAL_PALETTE.length) % CATEGORICAL_PALETTE.length];
}
