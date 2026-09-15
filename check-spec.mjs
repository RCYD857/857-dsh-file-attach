/**
 * Confirm the product spec landed in the stylesheet and the components.
 *
 * The spec is a checklist, so this reads as one: each row is a requirement and
 * the pattern that proves it.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')
const css = /const CSS = `([\s\S]*?)`/u.exec(source)?.[1] ?? ''

const checks = [
	['container 16px radius', /\.fa-rail\{[^}]*border-radius:16px/u],
	['container matches the card width', /\.fa-rail\{[^}]*max-width:var\(--dsh-composer-card-max-width\)/u],
	['container spans the card box', /\.fa-rail\{[^}]*left:0;right:0/u],
	['container white', /\.fa-rail\{[^}]*background:#ffffff/u],
	['container shadow', /\.fa-rail\{[^}]*box-shadow:0 4px 16px/u],
	['container 12px padding', /\.fa-rail\{[^}]*padding:12px/u],
	['container 8px row gap', /\.fa-rail\{[^}]*gap:8px/u],
	['cards 48px tall', /\.fa-card\{[^}]*height:48px/u],
	['cards 8px radius', /\.fa-card\{[^}]*border-radius:8px/u],
	['card surface #f5f5f7', /\.fa-card\{[^}]*background:#f5f5f7/u],
	['card hover #ebecef', /\.fa-card:hover\{background:#ebecef\}/u],
	['card max width 200px', /\.fa-card\{[^}]*max-width:200px/u],
	['failed card red', /\.fa-card\[data-tone=error\]\{background:#fff1f0/u],
	['retry control', /\.fa-retry\{/u],
	['strip scrolls horizontally', /\.fa-cards\{[^}]*overflow-x:auto/u],
	['native scrollbar hidden', /\.fa-cards::-webkit-scrollbar\{display:none\}/u],
	['both edges get a gradient', /\.fa-fadeLeft\{[^}]*linear-gradient[\s\S]*\.fa-fadeRight\{[^}]*linear-gradient/u],
	['overflow arrow', /\.fa-arrow\{/u],
	['arrows scroll one screen', /strip\.scrollBy\(\{ left: direction \* step/u],
	['left arrow appears after scrolling', /overflow\.start/u],
	['right arrow hides at the end', /overflow\.end/u],
	['no lane while nothing overflows', /\.fa-cards\{[^}]*scrollbar-width:none;padding:0\}/u],
	['left lane only with a left arrow', /\.fa-rail\[data-lane=start\] \.fa-cards\{padding-left:30px\}/u],
	['right lane only with a right arrow', /\.fa-rail\[data-lane=end\] \.fa-cards\{padding-right:30px\}/u],
	['both arrows reserve both lanes', /\.fa-rail\[data-lane=both\] \.fa-cards\{padding:0 30px\}/u],
	['the lane follows the measured edges', /overflow\.start && overflow\.end \? 'both'/u],
	['strip overflow edges measured', /measureOverflow/u],
	['overflow survives an equal re-measure', /seq: previous\.seq \+ 1/u],
	['overflow follows the box', /new ResizeObserver\(measureOverflow\)/u],
	['images get a strip card too', /function ImagePlaceholderCard/u],
	['image count read from the input state', /function useDraftImageCount/u],
	['the scroller owns the ref', /className: 'fa-cards', ref: stripRef/u],
	['geometry reporting', /function geometry\(rail, card\)/u],
	['drag highlight blue', /\.fa-rail\[data-dragging=true\]\{border-color:#1677ff/u],
	['drop hint copy', /松开即可上传/u],
	['name 14px / 500', /\.fa-name\{[^}]*font-size:14px;font-weight:500/u],
	['subtitle 12px grey', /\.fa-sub\{[^}]*font-size:12px;line-height:16px;color:#86868b/u],
	['image card 48px square', /\.fa-thumbImage\{width:48px;height:48px/u],
	['loading spinner', /\.fa-spin\{/u],
	['close button on hover', /\.fa-card:hover \.fa-remove/u],
	['remove fade', /\.fa-card\[data-removing=true\]\{opacity:0/u],
	['empty rail keeps a hint line', /\.fa-emptyHint\{/u],
	['empty rail highlights on drag', /\.fa-rail\[data-empty=true\]\[data-dragging=true\]\{padding:12px;border:1px dashed #1677ff/u],
	['empty rail is no longer zero-height', /\.fa-rail\[data-empty=true\]\{min-height:0;padding:4px 12px/u],
	['code glyph green', /code: \{ color: '#00a870'/u],
	['archive glyph yellow', /archive: \{ color: '#d48806'/u],
	['slide glyph red', /slide: \{ color: '#d4380d'/u],
	['doc glyph blue', /doc: \{ color: '#1677ff'/u],
	['subtitle from extension+size', /function fileSubtitle/u],
	['retry re-runs resolution', /function retryItem/u],
	['thumbnail for image cards', /function attachThumbnail/u],
]

let failed = 0
for (const [label, pattern] of checks) {
	const ok = pattern.test(css) || pattern.test(source)
	const verdict = ok ? 'OK' : 'MISSING'
	if (!ok) failed += 1
	console.log(`${verdict.padEnd(8)} ${label}`)
}
console.log(failed === 0 ? '\nall spec checks passed' : `\n${failed} spec check(s) missing`)
process.exit(failed === 0 ? 0 : 1)
