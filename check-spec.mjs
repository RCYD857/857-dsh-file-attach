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
	// The chips live inside the composer card, in the form Doubao uses.
	['chips sit in the composer card', /\.fa-rail\{[^}]*position:absolute;top:0;left:0;right:0/u],
	['the attachments are one row', /\.fa-rail\{[^}]*display:flex;align-items:center/u],
	['the row scrolls sideways', /\.fa-scroll\{[^}]*overflow-x:auto/u],
	['and hides the native scrollbar', /\.fa-scroll::-webkit-scrollbar\{display:none\}/u],
	['a page arrow sits at each end', /\.fa-arrow\{[^}]*border-radius:8px/u],
	['the chip under an arrow fades out', /\.fa-scroll\[data-mask=start\]\{[^}]*mask-image:linear-gradient\(to right,transparent 0,#000 54px\)/u],
	['on the other side too', /\.fa-scroll\[data-mask=end\]\{[^}]*mask-image:linear-gradient\(to left,transparent 0,#000 54px\)/u],
	['both edges fade when both hide chips', /\.fa-scroll\[data-mask=both\]\{[^}]*transparent 100%/u],
	['and a row that fits stays fully opaque', /'data-mask': lane/u],
	['the arrow scrolls one page', /row\.scrollBy\(\{ left: direction \* step/u],
	['the left arrow follows the measured edge', /arrow\(-1, overflow\.start\)/u],
	['the right arrow too', /arrow\(1, overflow\.end\)/u],
	['the arrow decision follows the box', /new ResizeObserver\(measureOverflow\)/u],
	['and survives an equal re-measure', /seq: previous\.seq \+ 1/u],
	['the card claims the room the tiles take, inline', /card\.style\.paddingTop = `\$\{height\}px`/u],
	['the rail remembers the padding it found', /cardPaddingOrigin\.set\(card, card\.style\.paddingTop\)/u],
	['and hands the card back when empty', /card\.removeAttribute\('data-file-attach'\)/u],
	['a first-paint zero is retried', /requestAnimationFrame\(again\)/u],
	['the reservation follows later layout', /new ResizeObserver\(publish\)/u],
	['a chip is 244px wide', /\.fa-chip\{[^}]*width:244px/u],
	['a chip is 12px rounded', /\.fa-chip\{[^}]*border-radius:12px/u],
	['a chip is at least 62px tall', /\.fa-chip\{[^}]*min-height:62px/u],
	['chips sit on the light surface', /\.fa-chip\{[^}]*background:#f5f5f7/u],
	['hover deepens the chip', /\.fa-chip:hover\{background:#ebecef\}/u],
	['the file badge is 34px square', /\.fa-badge\{[^}]*width:34px;height:34px/u],
	['a picture fills its badge', /\.fa-badge img\{[^}]*object-fit:cover/u],
	['the name is 13.5px, ellipsised', /\.fa-name\{[^}]*font-size:13\.5px;[^}]*text-overflow:ellipsis/u],
	['the state line is 11.5px grey', /\.fa-sub\{[^}]*font-size:11\.5px;line-height:15px;color:#86868b/u],
	['the remove badge hangs off the corner', /\.fa-remove\{[^}]*top:-7px;right:-7px/u],
	['a failed chip turns red', /\.fa-chip\[data-tone=error\]\{background:#fff1f0/u],
	['failed text turns red too', /\.fa-chip\[data-tone=error\] \.fa-name/u],
	['retry control', /className: 'fa-retry'/u],
	['a pending chip shows a spinner', /className: 'fa-spin'/u],
	['clicking a chip previews the file', /onClick: \(\) => onPreview\(item\)/u],
	['an empty rail takes no room', /\.fa-rail\[data-empty=true\]\{padding:0\}/u],
	['the drop invitation highlights the rail', /\.fa-rail\[data-empty=true\]\[data-dragging=true\]\{padding:10px 12px;border:1px dashed #1677ff/u],
	['a drag over live chips outlines the row', /\.fa-rail\[data-dragging=true\]\[data-empty=false\]\{outline:1px dashed #1677ff/u],
	['the empty hint explains the drop', /松开即可把文件放进输入框/u],
	['a card awaiting a pick stops looking attached', /choosing\s*\?\s*choosingText\(item\)/u],
	['the open question is described in one place', /const count = Array\.isArray\(item\.candidates\) \? item\.candidates\.length : 2/u],
	['a same-name pick is offered on the tile', /className: 'fa-picker'/u],
	['a send reports the attachments it left behind', /reportUnsent\(sessionId\)/u],
	['one row holds pictures and files alike', /const chips = \[\.\.\.images, \.\.\.items\]/u],
	['the platform image row is hidden, not duplicated', /\[data-slot="conversation\.input\.attachments"\] > div\[class\$="_rail"\]\{display:none !important\}/u],
	['an empty rail collapses', /const empty = chips\.length === 0/u],
	['the drop outline follows the heartbeat', /setDragLiveness\(true\)/u],
	['geometry reporting', /function geometry\(rail, card\)/u],
	['the drop outline is blue', /outline:1px dashed #1677ff/u],
	['loading spinner animates', /@keyframes fa-spin/u],
	['remove fade', /\.fa-chip\[data-removing=true\]\{opacity:0/u],
	['empty rail keeps a hint line', /\.fa-emptyHint\{/u],
	['code glyph green', /code: \{ color: '#00a870'/u],
	['archive glyph yellow', /archive: \{ color: '#d48806'/u],
	['slide glyph red', /slide: \{ color: '#d4380d'/u],
	['doc glyph blue', /doc: \{ color: '#1677ff'/u],
	['subtitle from extension+size', /function fileSubtitle/u],
	['retry re-runs resolution', /function retryItem/u],
	['thumbnail for image cards', /function attachThumbnail/u],
	['a copied file travels with its fingerprint', /hash: await fingerprintOf\(file\)/u],
	['and a pasted clipboard is read for a path', /hints: pathHints\(clipboard\)/u],
]

let failed = 0
for (const [label, pattern] of checks) {
	const ok = pattern.test(css) || pattern.test(source)
	const verdict = ok ? 'OK' : 'MISSING'
	if (!ok) failed += 1
	console.log(`${verdict.padEnd(8)} ${label}`)
}

// Retired with the card-first form: a file is no longer parked in the strip once
// it resolves, and a picture was never the strip's to hold.
const retired = [
	['draft-image placeholder cards are gone', /ImagePlaceholderCard|useDraftImageCount/u],
	['the strip no longer counts platform images', /imageCount === 0/u],
	['the panel above the composer is gone', /bottom:100%/u],
	['the big Codex-style tiles are gone', /fa-tile|fa-tileArt|fa-tileMain/u],
	['the wrapping grid is gone', /flex-wrap:wrap/u],
	['the inline-chip detour is gone', /insertFileChip|INSERT_REFERENCE_EVENT|chipSourceName/u],
	['the reservation is not left to a stylesheet rule', /--fa-card-tiles/u],
]
for (const [label, pattern] of retired) {
	const gone = !pattern.test(css) && !pattern.test(source)
	if (!gone) failed += 1
	console.log(`${(gone ? 'OK' : 'PRESENT').padEnd(8)} ${label}`)
}

console.log(failed === 0 ? '\nall spec checks passed' : `\n${failed} spec check(s) missing`)
process.exit(failed === 0 ? 0 : 1)
