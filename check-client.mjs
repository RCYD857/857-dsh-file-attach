/**
 * Headless checks for dsh-file-attach's browser half.
 *
 * Loads the real client bundle with a fake module loader, minimal DOM, and fake
 * composer/conversation services — enough to exercise drag and paste admission,
 * path handling, the send-boundary expansion, and the overlay watchdog without
 * a browser. The composer draft must stay untouched by everything here.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

// --- fake DOM -------------------------------------------------------------

const styleTags = []
const fakeElement = (tag) => ({
	tagName: tag,
	dataset: {},
	style: {},
	classList: [],
	children: [],
	textContent: '',
	innerHTML: '',
	append(...kids) { this.children.push(...kids) },
	remove() { this.removed = true },
	setAttribute() {},
})

const documentListeners = new Map()
const documentSink = { addEventListener: (type, handler) => documentListeners.set(type, handler), removeEventListener: () => {} }
const bodyChildren = []

/** The composer card the rail measures itself against. */
const composerCard = {
	parentElement: null,
	getBoundingClientRect: () => ({ top: 100, bottom: 220, left: 0, right: 600, width: 600, height: 120 }),
}

/** Nodes currently in the document, mirroring the platform mask's presence. */
const documentNodes = []

globalThis.document = {
	head: { append: (tag) => styleTags.push(tag) },
	body: { append: (element) => bodyChildren.push(element), children: bodyChildren },
	createElement: fakeElement,
	createElementNS: () => fakeElement('svg'),
	querySelector: (selector) => (selector === '[data-composer-card]' ? composerCard : null),
	querySelectorAll: (selector) => (selector === '[class*="_mask"]'
		? documentNodes.filter((node) => node.classList.some((name) => name.includes('_mask')))
		: []),
	...documentSink,
}

/** MutationObserver stand-in that re-runs the callback on demand. */
const observers = []
globalThis.MutationObserver = class {
	constructor(callback) { this.callback = callback }
	observe() { observers.push(this) }
	disconnect() { this.disconnected = true }
}

const observedElements = []
globalThis.ResizeObserver = class {
	constructor(callback) { this.callback = callback }
	observe(element) { observedElements.push(element) }
	disconnect() { this.disconnected = true }
}
globalThis.getComputedStyle = () => ({ rowGap: '6px' })

const windowListeners = new Map()
globalThis.window = {
	addEventListener: (type, handler) => windowListeners.set(type, handler),
	removeEventListener: () => {},
}

// --- fake composer shell and conversation service -------------------------

const notices = []
const drafts = []
/** Image files the plugin handed to the draft-image registry, in order. */
const draftedImages = []
/** Ids the session facade was asked to attach, in order. */
const addedImageIds = []
const sendCalls = []
let sendOutcome = { kind: 'success' }
let inputBusy = false
let draftSeq = 0
let draftImageIds = []

/** The four media types the platform's draft-image registry admits. */
const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/**
 * The draft-image registry, following `dsh-client-ui-conversation` exactly:
 * `createDraftImages(files)` validates the media type, registers each file and
 * returns descriptors; `draftImages(ids)` resolves them back; the composer's own
 * reconciliation pass drops any id the registry never issued.
 *
 * The fake used to accept files directly in `addImages`, which is the wrong
 * contract — and blessing it is why a pasted screenshot looked attached to this
 * suite while the real composer threw it away without a word.
 */
const draftAttachments = new Map()

/** The draft text as the published input state reports it. */
const currentDraft = () => (drafts.length === 0 ? '' : drafts[drafts.length - 1])

/**
 * One fake session-input facade per session, mirroring the real facade. The
 * important part is what is *missing*: the plugin has no way to write draft text,
 * which is why `drafts` stays empty through every check here.
 */
const makeInput = (sessionId) => ({
	sessionId,
	state: {
		getSnapshot: () => ({
			draft: currentDraft(),
			imageIds: draftImageIds,
		}),
	},
	setDraft: (text) => drafts.push(text),
	addImages: (ids) => {
		if (inputBusy) return false
		addedImageIds.push(...ids)
		draftImageIds = [...draftImageIds, ...ids]
		return true
	},
	notify: (level, text) => notices.push({ level, text }),
})

/** One facade per session id, resolved from either the scoped event or the provide face. */
const shells = new Map()
const shellFor = (sessionId) => {
	if (!shells.has(sessionId)) shells.set(sessionId, makeInput(sessionId))
	return shells.get(sessionId)
}

const conversation = {
	input: { for: (scope) => shellFor(scope.sessionId) },
	createDraftImages(files) {
		for (const file of files) {
			if (ACCEPTED_IMAGE_TYPES.has(file.type)) continue
			const error = new Error(`unsupported image media type: ${file.type || '(empty)'}`)
			error.name = 'UnsupportedImageMediaTypeError'
			error.mediaType = file.type
			throw error
		}
		return files.map((file) => {
			draftSeq += 1
			const attachment = { id: `draft-${draftSeq}`, file, previewUrl: `blob:draft-${draftSeq}` }
			draftAttachments.set(attachment.id, attachment)
			draftedImages.push(file)
			return attachment
		})
	},
	draftImages: (ids) => ids.map((id) => draftAttachments.get(id)).filter((attachment) => attachment !== undefined),
	releaseDraftImages: (attachments) => {
		for (const attachment of attachments) draftAttachments.delete(attachment.id)
	},
	async sendSession(session, text, imageIds, mode) {
		sendCalls.push({ sessionId: session.sessionId, text, imageIds, mode })
		return sendOutcome
	},
}

// --- load the bundle ------------------------------------------------------

let captured
globalThis.window.__ModuleLoader__ = { load: (definition) => { captured = definition } }
new Function(source)()
assert.equal(captured.id, 'dsh-file-attach')

// Only `react` is required: the composer editor is deliberately not imported.
// Component rendering is exercised by check-components.mjs; here the plugin is
// driven through its event intake and send boundary only.
const plugin = captured.factory((name) => {
	if (name !== 'react') throw new Error(`unexpected module request: ${name}`)
	return { createElement: () => ({}), useState: () => [null, () => {}], useRef: () => ({ current: null }), useEffect: () => {} }
})

assert.equal(typeof plugin.apply, 'function')
assert.deepEqual(plugin.inject, ['slots', 'sessions', 'workspaces', 'conversation'])
assert.equal(styleTags.length, 1, 'the rail stylesheet is injected once')

// --- the attachment chips follow the product spec --------------------------
//
// The form Doubao uses: one scrolling row of compact chips inside the composer
// card's own top area — file badge, name, state — with a page arrow at each end
// and a remove badge on the chip's top-right corner. The card's own padding claims
// the room the row takes, so the text row is pushed down rather than covered.

const css = styleTags[0].textContent
const railRule = /\.fa-rail\{[^}]*\}/u.exec(css)?.[0] ?? ''
assert.match(railRule, /position:absolute;top:0;left:0;right:0/u, 'the rail lives in the card, not above it')
assert.match(railRule, /display:flex;align-items:center/u, 'the attachments are one row, not a grid')
assert.match(source, /card\.style\.paddingTop = `\$\{height\}px`/u, 'the card claims exactly the room the row takes, inline')
assert.match(source, /cardPaddingOrigin\.set\(card, card\.style\.paddingTop\)/u, 'remembering the padding it found')
assert.match(source, /card\.removeAttribute\('data-file-attach'\)/u, 'and hands the card back when it empties')
assert.doesNotMatch(css, /--fa-card-tiles/u, 'no stylesheet rule is trusted with the reservation')

const chipRule = /\.fa-chip\{[^}]*\}/u.exec(css)?.[0] ?? ''
assert.match(chipRule, /width:244px/u, 'a chip is 244px wide')
assert.match(chipRule, /min-height:62px/u, 'and at least 62px tall')
assert.match(chipRule, /border-radius:12px/u, 'chips are 12px rounded')
assert.match(chipRule, /background:#f5f5f7/u, 'chips sit on the spec surface colour')
assert.match(css, /\.fa-chip:hover\{background:#ebecef\}/u, 'hover deepens the chip')
assert.match(css, /\.fa-scroll\{[^}]*overflow-x:auto/u, 'the row scrolls horizontally')
assert.match(css, /\.fa-scroll::-webkit-scrollbar\{display:none\}/u, 'and hides the native scrollbar')
assert.match(css, /\.fa-scroll\{[^}]*padding:9px 0 5px/u, 'with room for the remove badge above the chips')
assert.match(css, /\.fa-arrow\{[^}]*position:absolute;top:50%/u, 'the page arrows float over the row')
assert.match(css, /\.fa-arrow\[data-edge=start\]\{left:4px\}/u, 'the left arrow floats over the row edge')
assert.match(css, /\.fa-arrow\[data-edge=end\]\{right:4px\}/u, 'the right one over its right edge')
assert.match(source, /const arrow = \(direction, hidden\) =>\s*!hidden\s*\?\s*null/u, 'an arrow only exists while that end still hides a chip')
// The chip under that arrow fades into the card instead of being cut off, and the
// fade is driven by the same measurement — so no overflow means no fade at all.
assert.match(css, /\.fa-scroll\[data-mask=start\]\{[^}]*mask-image:linear-gradient\(to right,transparent 0,#000 54px\)/u, 'the chips fade out under a floating left arrow')
assert.match(css, /\.fa-scroll\[data-mask=end\]\{[^}]*mask-image:linear-gradient\(to left,transparent 0,#000 54px\)/u, 'and under a floating right arrow')
assert.match(css, /\.fa-scroll\[data-mask=both\]\{[^}]*transparent 100%/u, 'with both edges faded when chips hide on both sides')
assert.match(source, /'data-mask': lane/u, 'the mask follows the measured lane')
assert.match(source, /overflow\.start && overflow\.end\s*\?\s*'both'/u, 'nothing hidden on either side means no mask attribute at all')
assert.match(source, /row\.scrollBy\(\{ left: direction \* step/u, 'and a click scrolls one page')
assert.match(source, /arrow\(-1, overflow\.start\)/u, 'the left arrow is driven by the measured start edge')
assert.match(source, /arrow\(1, overflow\.end\)/u, 'and the right arrow by the end edge')
assert.match(source, /new ResizeObserver\(measureOverflow\)/u, 'the arrow decision follows the box')
assert.match(source, /seq: previous\.seq \+ 1/u, 'and survives an equal re-measure')
assert.match(css, /\.fa-badge\{[^}]*width:34px;height:34px/u, 'the file badge is 34px square')
assert.match(css, /\.fa-badge img\{[^}]*object-fit:cover/u, 'a picture fills its badge')
assert.match(css, /\.fa-name\{[^}]*font-size:13\.5px/u, 'the file name is 13.5px')
assert.match(css, /\.fa-name\{[^}]*text-overflow:ellipsis/u, 'and ellipsises')
assert.match(css, /\.fa-sub\{[^}]*font-size:11\.5px;line-height:15px;color:#86868b/u, 'the state line is 11.5px grey')
assert.match(css, /\.fa-remove\{[^}]*top:-7px;right:-7px/u, 'the remove badge hangs on the top-right corner')
assert.match(css, /\.fa-chip\[data-tone=error\]\{background:#fff1f0/u, 'a failed chip turns red')
assert.match(css, /\.fa-rail\[data-empty=true\]\{padding:0\}/u, 'an empty rail takes no room at all')
assert.match(css, /\.fa-rail\[data-empty=true\]\[data-dragging=true\]\{padding:10px 12px;border:1px dashed #1677ff/u, 'the drop invitation still highlights')
assert.match(css, /\.fa-rail\[data-dragging=true\]\[data-empty=false\]\{outline:1px dashed #1677ff/u, 'a drag over live chips outlines the row')
assert.match(source, /松开即可把文件放进输入框/u, 'the empty hint says what a drop does')
assert.match(source, /KIND_APPEARANCE/u, 'file families map to their own glyph and colour')
assert.match(source, /fileSubtitle/u, 'the state line is built from extension and size')
assert.match(source, /正在定位…/u, 'a pending chip says which step it is on')
assert.match(source, /正在上传…/u, 'including the upload it is doing')
assert.match(source, /function retryItem/u, 'a failure can be retried')
assert.match(source, /className: 'fa-picker'/u, 'a same-name pick is offered on the chip')
// Pictures ride the platform's image pipeline (that is what makes them visual
// input) but are drawn in this same row, so the platform's own thumbnail row —
// rendered in the very same place — is hidden rather than duplicated.
assert.match(source, /function useDraftImages\(ctx, sessionId\)/u, 'draft pictures are read from the platform')
assert.match(source, /const chips = \[\.\.\.images, \.\.\.items\]/u, 'and join the file chips in one row')
assert.match(source, /typeof conversation\?\.releaseDraftImage === 'function'/u, 'removing one goes through the platform')
assert.match(css, /\[data-slot="conversation\.input\.attachments"\] > div\[class\$="_rail"\]\{display:none !important\}/u, 'the platform image row is hidden')
// The drop outline follows the global dragover heartbeat: counting dragenter and
// dragleave left a dashed border stuck on screen after a Windows drag ended.
assert.match(source, /setDragLiveness\(true\)/u, 'a drag turns the outline on')
assert.match(source, /setDragLiveness\(false\)/u, 'and the heartbeat turning quiet turns it off')
assert.doesNotMatch(source, /rail\.addEventListener\('dragenter'/u, 'the rail does not count drag events itself')
// A paste lands on the file that was copied: it travels with the fingerprint of its
// own bytes (so the host can claim that exact copy), and it takes whatever path the
// clipboard handed over instead of searching by name.
assert.match(source, /hash: await fingerprintOf\(file\)/u, 'a locate request carries the file fingerprint')
assert.match(source, /hints: pathHints\(clipboard\)/u, 'the pasted clipboard is read for a path')
assert.match(source, /async function fingerprintOf\(file\)/u, 'the fingerprint is computed in the browser')

// Retired: the floating panel above the composer, the big Codex-style tiles, the
// wrapping grid, and the inline-chip detour.
assert.doesNotMatch(css, /\.fa-rail\{[^}]*bottom:100%/u, 'the rail no longer floats above the card')
assert.doesNotMatch(css, /flex-wrap:wrap/u, 'the row no longer wraps into a grid')
assert.doesNotMatch(source, /fa-tile|fa-tileArt|fa-tileMain/u, 'the big file tiles are gone')
assert.doesNotMatch(source, /insertFileChip|INSERT_REFERENCE_EVENT|chipSourceName/u, 'the inline-chip path is gone')
assert.doesNotMatch(source, /--fa-rail-pull|--fa-card-h|--fa-rail-h/u, 'no other layout-measurement variable is back')
assert.equal((source.match(/new ResizeObserver/gu) ?? []).length, 2, 'two observers: the card reservation and the row overflow')
assert.match(source, /'conversation\.input\.overlay', component/u, 'the card-top slot is the pipe the rail uses')

// The stylesheet is one template literal: a backtick inside it ends the literal
// early and turns the rest of the CSS into JavaScript.
assert.equal((source.match(/`/gu) ?? []).length % 2, 0, 'the CSS template literal is balanced')

// --- drive apply() with fake services -------------------------------------

const slotsRegistrations = []
/** Slots this fake build declares; a missing one must fall through, not throw. */
let declaredSlots = ['conversation.input.overlay', 'conversation.composer.dock']
/** The selected session, as the store would report it; undefined means "no composer yet". */
let currentSessionId = 'session-1'
const ctx = {
	slots: {
		inject: (name, factory) => { slotsRegistrations.push({ name, factory }); return () => {} },
		register: (options, component) => {
			if (!declaredSlots.includes(options.name)) throw new Error(`slot "${options.name}" is not declared`)
			slotsRegistrations.push({ name: options.name, registered: true, component })
			return () => {}
		},
		spec: (name) => (declaredSlots.includes(name) ? { kind: 'list' } : undefined),
	},
	sessions: {
		list: { getSnapshot: () => ({ current: currentSessionId, byId: { 'session-1': { cwd: 'F:\\DSH' } } }) },
		scope: (sessionId) => ({ sessionId, tag: 'scope' }),
	},
	workspaces: { list: { getSnapshot: () => ({ items: [{ path: 'F:\\DSH' }] }) } },
	conversation,
	get: (name) => (name === 'conversation' ? conversation : undefined),
	effect: (factory) => { ctx.disposer = factory(); return () => {} },
}

const fetches = []
const locateCalls = () => fetches.filter((call) => call.url === '/file-attach/locate')
const stageCalls = () => fetches.filter((call) => call.url === '/file-attach/stage')
globalThis.fetch = async (url, options) => {
	if (url === '/file-attach/report') {
		fetches.push({ url, body: JSON.parse(options.body) })
		return { ok: true, json: async () => ({ status: 'recorded' }) }
	}
	if (url === '/file-attach/stage') {
		const name = decodeURIComponent(options.headers['x-file-name'])
		fetches.push({
			url,
			name,
			workspacePath: decodeURIComponent(options.headers['x-workspace-path']),
			bytes: options.body instanceof File ? Buffer.from(await options.body.arrayBuffer()) : options.body,
		})
		if (name === 'unstaged.bin') return { ok: false, status: 500, json: async () => ({ status: 'error', message: 'disk full' }) }
		return { ok: true, json: async () => ({ status: 'staged', path: `F:\\DSH\\.dsh-attachments\\${name}`, name }) }
	}
	fetches.push({ url, body: JSON.parse(options.body) })
	const name = JSON.parse(options.body).file.name
	if (name === 'missing.txt' || name === 'unstaged.bin') return { ok: true, json: async () => ({ status: 'not-found' }) }
	if (name === 'choose.yml') {
		return {
			ok: true,
			json: async () => ({
				status: 'choose',
				candidates: ['F:\\DSH\\out\\choose.yml', 'C:\\Users\\Huan\\Desktop\\choose.yml'],
			}),
		}
	}
	return { ok: true, json: async () => ({ status: 'found', path: `F:\\DSH\\inbox\\comfyui\\${name}` }) }
}

plugin.apply(ctx)

assert.equal(slotsRegistrations.length, 1)
assert.equal(slotsRegistrations[0].name, 'conversation.input.overlay')
assert.equal(slotsRegistrations[0].registered, true, 'the card-top slot is the one used when this build declares it')
assert.deepEqual(
	Object.keys(Object.fromEntries(documentListeners)).sort(),
	['dragenter', 'dragover', 'drop', 'paste'],
	'no dragleave listener: Windows drags do not deliver it reliably',
)
assert.deepEqual(Object.keys(Object.fromEntries(windowListeners)).sort(), ['blur', 'dragend', 'keydown'])

// Every checkpoint reports, so a silent failure in the browser is still legible
// from the host side (the desktop shell has no devtools).
const reportStages = () => [...new Set(fetches.filter((call) => call.url === '/file-attach/report').flatMap((call) => call.body.reports.map((entry) => entry.stage)))]
assert.ok(reportStages().includes('apply'), 'the plugin reports that it was applied')
assert.ok(reportStages().includes('slot-probe'), 'the slot probe is reported')

// The rail component must render from the store's current session, not from the
// slot props: `conversation.input.overlay` renders without a `session` prop, and
// trusting the prop is what silently produced no rail at all.
{
	const registered = slotsRegistrations.find((entry) => entry.registered === true)
	assert.ok(registered !== undefined, 'a slot entry was registered')
	const rendered = registered.component({})
	assert.notEqual(rendered, null, 'the rail renders even though the slot passes no session prop')
}

// --- paste a text file and a json workflow --------------------------------

const textFile = new File([JSON.stringify({ a: 1 })], 'QuadView_krea2_v1.json', { type: 'application/json' })
documentListeners.get('paste')({
	clipboardData: { items: [{ kind: 'file', getAsFile: () => textFile }] },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
})

// Intake is asynchronous from here on — a file that does not describe itself is
// identified by its leading bytes before it is routed — so assertions wait for
// the admission to settle rather than for a synchronous side effect.
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))

assert.equal(locateCalls().length, 1, 'one locate request per non-image file')
assert.equal(locateCalls()[0].body.file.name, 'QuadView_krea2_v1.json')
assert.equal(locateCalls()[0].body.currentWorkspacePath, 'F:\\DSH')
assert.deepEqual(locateCalls()[0].body.workspacePaths, ['F:\\DSH'])
assert.equal(
	locateCalls()[0].body.file.hash,
	createHash('sha256').update(JSON.stringify({ a: 1 })).digest('hex'),
	'the file travels with the fingerprint of its own bytes, so the host can claim the copy the user made',
)
assert.equal(stageCalls().length, 0, 'a located file is not copied')
assert.deepEqual(drafts, [], 'the draft is never written on admission')

// --- sending carries the attachment, the draft stays clean ----------------

await conversation.sendSession({ sessionId: 'session-1' }, '看看这个工作流', [], 'queue')
assert.equal(sendCalls.length, 1)
assert.equal(sendCalls[0].text, '看看这个工作流 @F:\\DSH\\inbox\\comfyui\\QuadView_krea2_v1.json')
assert.equal(
	sendCalls[0].text.split('QuadView_krea2_v1.json').length - 1,
	1,
	'the card is the attachment: the file rides the prompt exactly once, not twice',
)
assert.deepEqual(drafts, [], 'the composer draft never saw a path')
notices.length = 0

// --- an image-only send still carries pending attachments -----------------

const png = new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' })
documentListeners.get('paste')({
	clipboardData: { items: [{ kind: 'file', getAsFile: () => png }] },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(draftedImages, [png], 'a pasted image takes the platform draft-image path')
assert.deepEqual(
	addedImageIds,
	['draft-1'],
	'the composer is handed draft ids — the fake used to bless handing it files, which the real registry drops',
)
assert.deepEqual(draftImageIds, ['draft-1'], 'the draft now holds the image the paste produced')
assert.equal(locateCalls().length, 1, 'images never hit the locate route')

// --- a drag carrying a file:// uri resolves without the host route --------

const dragged = new File(['hello'], 'notes.txt', { type: 'text/plain' })
documentListeners.get('drop')({
	dataTransfer: {
		types: ['Files'],
		files: [dragged],
		dropEffect: '',
		getData: (type) => (type === 'text/uri-list' ? 'file:///F:/DSH/inbox/comfyui/notes.txt\r\n' : ''),
	},
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
	clientX: 10,
	clientY: 10,
})
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(locateCalls().length, 1, 'a path hint skips the locate request')
assert.deepEqual(drafts, [], 'a drop never writes into the draft either')

await conversation.sendSession({ sessionId: 'session-1' }, '', [png], 'queue')
assert.equal(sendCalls.at(-1).text, '@F:\\DSH\\inbox\\comfyui\\notes.txt', 'an image-only send still carries the file')
assert.equal(sendCalls.at(-1).imageIds.length, 1)

// --- paths with spaces use the quoted grammar -----------------------------

const spaced = new File(['x'], 'my report.csv', { type: 'text/csv' })
documentListeners.get('drop')({
	dataTransfer: {
		types: ['Files'],
		files: [spaced],
		dropEffect: '',
		getData: (type) => (type === 'text/uri-list' ? 'file:///F:/DSH/out/my%20report.csv' : ''),
	},
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
		clientX: 10,
		clientY: 10,
	})
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
await conversation.sendSession({ sessionId: 'session-1' }, '读一下', [], 'queue')
assert.equal(sendCalls.at(-1).text, '读一下 @"F:\\DSH\\out\\my report.csv"', 'whitespace forces the quoted mention')

// --- a failed send keeps its attachments for the next attempt -------------

const retryFile = new File(['x'], 'retry.json', { type: 'application/json' })
documentListeners.get('drop')({
	dataTransfer: {
		types: ['Files'],
		files: [retryFile],
		dropEffect: '',
		getData: (type) => (type === 'text/uri-list' ? 'file:///F:/DSH/inbox/comfyui/retry.json' : ''),
	},
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
	clientX: 10,
	clientY: 10,
})
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
sendOutcome = { kind: 'error' }
await conversation.sendSession({ sessionId: 'session-1' }, '再来', [], 'queue')
assert.match(sendCalls.at(-1).text, /retry\.json/u)
sendOutcome = { kind: 'success' }
await conversation.sendSession({ sessionId: 'session-1' }, '再来', [], 'queue')
assert.match(sendCalls.at(-1).text, /retry\.json/u, 'the failed attachment rides the retry')

// --- an attachment that cannot ride the prompt is reported, not dropped ----
//
// The reported bug: a file present in two places under one name (same name, same
// size) left the card in `choosing`, and the send boundary only expands `ready`
// cards — so the attachment disappeared from the message while the strip still
// showed it attached. Silence is the defect; the card and the send both speak up
// now. The host resolves byte-identical copies on its own (see check-host.mjs),
// which is the other half of the fix.

const choosy = new File(['url: https://example.test/entry\n'], 'choose.yml', { type: '' })
documentListeners.get('drop')({
	dataTransfer: { types: ['Files'], files: [choosy], dropEffect: '', getData: () => '' },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
	clientX: 10,
	clientY: 10,
})
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(
	stageCalls().filter((call) => call.name === 'choose.yml').length,
	0,
	'an ambiguous name is never silently copied to end the ambiguity',
)

notices.length = 0
await conversation.sendSession({ sessionId: 'session-1' }, '看下这个条目', [], 'queue')
assert.equal(sendCalls.at(-1).text, '看下这个条目', 'a card that is not ready contributes no mention')
assert.equal(notices.length, 1, 'the send itself reports the attachment it had to leave behind')
assert.equal(notices[0].level, 'error', 'it is loud enough to be seen')
assert.match(notices[0].text, /1 个附件没有随本次消息发出/u)
assert.match(notices[0].text, /choose\.yml/u, 'the report names the file')
assert.match(notices[0].text, /同名文件有 2 个/u, 'and says which question is still open')
assert.match(notices[0].text, /在卡片上选一个/u, 'and what to do about it')

// The card survives the send it missed: an attachment that did not leave is
// still attached, and the next attempt says so again.
notices.length = 0
await conversation.sendSession({ sessionId: 'session-1' }, '再发一次', [], 'queue')
assert.equal(notices.length, 1, 'the unresolved card is still there for the next send')
assert.match(notices[0].text, /choose\.yml/u)
notices.length = 0

// --- an unlocatable file is staged instead of refused ---------------------

const missing = new File(['payload-bytes'], 'missing.txt', { type: 'text/plain' })
documentListeners.get('drop')({
	dataTransfer: { types: ['Files'], files: [missing], dropEffect: '', getData: () => '' },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
	clientX: 10,
	clientY: 10,
})
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(notices.length, 0, 'a nameless-path file is no longer refused')
const stagedCall = stageCalls().at(-1)
assert.equal(stagedCall.name, 'missing.txt')
assert.equal(stagedCall.workspacePath, 'F:\\DSH', 'the copy goes into the session workspace')
assert.equal(stagedCall.bytes.toString(), 'payload-bytes', 'the real bytes are uploaded')
await conversation.sendSession({ sessionId: 'session-1' }, '看这个文件', [], 'queue')
assert.equal(
	sendCalls.at(-1).text,
	'看这个文件 @F:\\DSH\\.dsh-attachments\\missing.txt',
	'a staged copy is attached like any other file',
)

// --- a staging failure still reports an error and attaches nothing --------

const unstageable = new File(['x'], 'unstaged.bin', { type: 'application/octet-stream' })
documentListeners.get('drop')({
	dataTransfer: { types: ['Files'], files: [unstageable], dropEffect: '', getData: () => '' },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
	clientX: 10,
	clientY: 10,
})
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(notices.at(-1).level, 'error')
assert.match(notices.at(-1).text, /disk full/u)
notices.length = 0
await conversation.sendSession({ sessionId: 'session-1' }, '没有任何附件', [], 'queue')
assert.equal(sendCalls.at(-1).text, '没有任何附件', 'an unstageable file never reaches the prompt')

// --- file drags are claimed from the platform's image-drop target ---------

/** One document-level file drag event that records what the handlers did to it. */
const fileDragEvent = () => ({
	dataTransfer: { types: ['Files'], files: [], dropEffect: '' },
	preventDefault() { this.defaultPrevented = true },
	stopPropagation() { this.propagationStopped = true },
	stopImmediatePropagation() { this.immediateStopped = true },
})

const dragOver = () => {
	const event = fileDragEvent()
	documentListeners.get('dragover')(event)
	return event
}

const firstDragOver = dragOver()
assert.equal(
	firstDragOver.immediateStopped,
	undefined,
	'the platform keeps its dragover: starving it is what silently killed image drops',
)
assert.equal(firstDragOver.defaultPrevented, true, 'the drop effect stays a copy')

const overlay = bodyChildren.find((element) => element.id === 'dsh-file-attach-overlay')
assert.ok(overlay !== undefined, 'the drag invitation is mounted once')
assert.equal(overlay.style.visibility, 'visible', 'a file drag shows the invitation')

// dragenter must stay untouched as well: the platform's own drop target counts
// that event, and swallowing it would unbalance the counter.
const enterEvent = fileDragEvent()
documentListeners.get('dragenter')(enterEvent)
assert.equal(enterEvent.immediateStopped, undefined, 'dragenter still reaches the platform')
assert.equal(enterEvent.defaultPrevented, undefined, 'dragenter is not consumed')

// A dropped image is admitted here, through the same call the platform's target
// would have made — and crucially with a media type the pipeline accepts, which
// is what a file-manager drag does not provide on its own.
const droppedImage = new File([new Uint8Array([1])], 'dropped.png', { type: '' })
const dropEvent = fileDragEvent()
dropEvent.dataTransfer.files = [droppedImage]
dropEvent.dataTransfer.getData = () => ''
const imagesBefore = draftedImages.length
const locateBeforeDrop = locateCalls().length
documentListeners.get('drop')(dropEvent)
assert.equal(dropEvent.immediateStopped, true, 'the drop belongs to this plugin, so it cannot be attached twice')
assert.equal(overlay.style.visibility, 'hidden', 'the drop retires the invitation')
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(draftedImages.length, imagesBefore + 1, 'a dragged image reaches the image pipeline')
assert.equal(draftedImages.at(-1).type, 'image/png', 'the empty type a file-manager drag delivers is repaired')
assert.equal(draftedImages.at(-1).name, 'dropped.png')
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(
	locateCalls().length,
	locateBeforeDrop,
	'a picture stays a picture: it rides the image row and is never hunted for on disk',
)

// No further events: the watchdog must retire it, because Windows drags stop
// delivering dragover (and never deliver dragleave) when the gesture ends.
dragOver()
assert.equal(overlay.style.visibility, 'visible')
await new Promise((resolve) => setTimeout(resolve, 500))
assert.equal(overlay.style.visibility, 'hidden', 'the invitation retires once the drag stops')

dragOver()
assert.equal(overlay.style.visibility, 'visible')
windowListeners.get('dragend')({})
assert.equal(overlay.style.visibility, 'hidden', 'dragend hides it immediately')

dragOver()
assert.equal(overlay.style.visibility, 'visible')
windowListeners.get('keydown')({ key: 'Escape' })
assert.equal(overlay.style.visibility, 'hidden', 'Escape hides an abandoned drag')

// A non-file drag is left alone: other drop surfaces keep working.
const textDrag = fileDragEvent()
textDrag.dataTransfer.types = ['text/plain']
documentListeners.get('dragover')(textDrag)
assert.equal(textDrag.immediateStopped, undefined, 'non-file drags pass through untouched')

// An image format the platform pipeline cannot take (it admits png/jpeg/webp/gif
// only) must fall back to a file reference instead of throwing inside the drop.
const tiff = new File(['x'], 'scan.tiff', { type: '' })
const tiffDrop = fileDragEvent()
tiffDrop.dataTransfer.files = [tiff]
tiffDrop.dataTransfer.getData = () => ''
const imagesBeforeTiff = draftedImages.length
documentListeners.get('drop')(tiffDrop)
await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(draftedImages.length, imagesBeforeTiff, 'an unsupported image format is not forced into the image pipeline')
const tiffLocate = locateCalls().at(-1)
assert.equal(tiffLocate.body.file.name, 'scan.tiff', 'it becomes an ordinary file attachment instead')

// --- a paste the plugin cannot carry is left to the platform -----------------
//
// The regression this suite missed: Ctrl+V of a screenshot did nothing at all.
// Two faults had to line up, and both are pinned here — the plugin swallowed a
// paste it then failed to attach, and it attached pictures through a call the
// draft registry ignores. The second one is pinned above.

currentSessionId = undefined
const orphanImage = new File([new Uint8Array([1])], 'shot.png', { type: 'image/png' })
let orphanSwallowed = false
documentListeners.get('paste')({
	clipboardData: { items: [{ kind: 'file', getAsFile: () => orphanImage }] },
	preventDefault() {
		orphanSwallowed = true
	},
	stopPropagation() {},
	stopImmediatePropagation() {},
})
assert.equal(orphanSwallowed, false, 'with no session to attach to, the platform keeps its paste')
currentSessionId = 'session-1'

// --- an anonymous clipboard blob is identified by its bytes ------------------
//
// A screenshot handoff is not obliged to describe itself: copied pictures can
// arrive with an empty media type and no name, which leaves extension-guessing
// with nothing to work from. The leading bytes decide instead, so the picture
// lands as a picture rather than as an unnamed document card.

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4])
const anonymous = new File([pngBytes], '', { type: '' })
documentListeners.get('paste')({
	clipboardData: { items: [{ kind: 'file', getAsFile: () => anonymous }] },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(draftedImages.at(-1).type, 'image/png', 'an untyped clipboard blob is sniffed as a picture')
assert.equal(draftedImages.at(-1).name, '粘贴的图片.png', 'and given a name the pipeline can carry')
assert.equal(draftedImages.at(-1).size, anonymous.size, 'without losing a byte on the way')
assert.equal(locateCalls().at(-1).body.file.name, 'scan.tiff', 'a sniffed picture is never hunted for on disk')

// --- a busy composer says so instead of dropping the picture silently --------

inputBusy = true
notices.length = 0
const busyIds = addedImageIds.length
documentListeners.get('paste')({
	clipboardData: { items: [{ kind: 'file', getAsFile: () => new File([pngBytes], 'shot.png', { type: 'image/png' }) }] },
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
})
await new Promise((resolve) => setTimeout(resolve, 0))
assert.equal(addedImageIds.length, busyIds, 'a refused image is not recorded as attached')
assert.match(notices.at(-1).text, /输入框正忙/u, 'the refusal is spoken out loud')
notices.length = 0
inputBusy = false

// --- the platform's image-drop mask is deleted, not negotiated with --------
//
// It announces "图片拖动到此处即可添加" for any file, counts dragenter/dragleave
// pairs a Windows drag never balances, and only accepts a drop aimed exactly at
// the composer card. This plugin owns file drops, so the mask goes away.
const platformMask = fakeElement('div')
platformMask.classList.push('K9xd_G_mask')

dragOver()
assert.ok(observers.length > 0, 'a file drag installs the mask observer')
platformMask.removed = undefined
documentNodes.push(platformMask)
for (const observer of observers) observer.callback()
assert.equal(platformMask.removed, true, 'the platform mask is removed as soon as it mounts')

// Our own invitation must never be swept away by its own sweeper.
const mine = bodyChildren.find((element) => element.id === 'dsh-file-attach-overlay')
assert.equal(mine.removed, undefined, "this plugin's own overlay is left alone")
assert.match(
	styleTags[0].textContent,
	/\[class\*="_mask"\]:not\(#dsh-file-attach-overlay\)\{display:none !important\}/u,
	'the stylesheet hides any element whose class contains _mask, except this plugin own overlay',
)
assert.match(source, /\{ childList: true, subtree: true \}/u, 'the observer watches the whole subtree, not just direct body children')

// Leave no watchdog timer armed, so the check process exits promptly.
windowListeners.get('dragend')({})

console.log('dsh-file-attach client checks passed')

// --- host half: bounded locate route -------------------------------------

const { locate, LOCATE_ROUTE, MAX_CANDIDATES } = await import('./lib/index.js')
assert.equal(LOCATE_ROUTE, '/file-attach/locate', 'the client and host halves agree on the route')

const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
const { join: joinPath } = await import('node:path')

// The fixture lives inside the plugin directory: OS temp is off-limits to the
// confined runner, and a workspace-local tree keeps the checks self-contained.
const fixturesRoot = joinPath(here, '.fixtures')
await rm(fixturesRoot, { recursive: true, force: true })
await mkdir(fixturesRoot, { recursive: true })
const sandbox = await mkdtemp(joinPath(fixturesRoot, 'case-'))
await mkdir(joinPath(sandbox, 'inbox', 'comfyui'), { recursive: true })
await mkdir(joinPath(sandbox, 'other'), { recursive: true })
await writeFile(joinPath(sandbox, 'inbox', 'comfyui', 'unique.ndjson'), 'abc')
await writeFile(joinPath(sandbox, 'inbox', 'dup.json'), 'aaa')
await writeFile(joinPath(sandbox, 'other', 'dup.json'), 'bbbbbb')

const unique = await locate({
	file: { name: 'unique.ndjson', size: 3 },
	workspacePaths: [sandbox],
	currentWorkspacePath: sandbox,
})
assert.equal(unique.status, 'found', 'a uniquely named file resolves')
assert.equal(unique.path, joinPath(sandbox, 'inbox', 'comfyui', 'unique.ndjson'))

const ambiguous = await locate({ file: { name: 'dup.json', size: 999 }, workspacePaths: [sandbox] })
assert.equal(ambiguous.status, 'choose', 'same-named files become a user pick')
assert.equal(ambiguous.candidates.length, 2)
assert.ok(ambiguous.candidates.length <= MAX_CANDIDATES)

const narrowed = await locate({ file: { name: 'dup.json', size: 6 }, workspacePaths: [sandbox] })
assert.equal(narrowed.status, 'found', 'byte size narrows the candidates')
assert.equal(narrowed.path, joinPath(sandbox, 'other', 'dup.json'))

const absent = await locate({ file: { name: 'nope-anywhere.xyz', size: 1 }, workspacePaths: [sandbox] })
assert.equal(absent.status, 'not-found')

const malformed = await locate({ file: { name: '   ', size: 1 }, workspacePaths: [sandbox] })
assert.equal(malformed.status, 'error')

await rm(fixturesRoot, { recursive: true, force: true })
console.log('dsh-file-attach host locate checks passed')

// --- a build without the card-top slot still gets a rail ------------------

// Slot availability must never cost the drag itself: if the preferred slot
// refuses the registration, the rail falls back, and the intake listeners are
// installed either way.
{
	const railSlots = []
	const previous = declaredSlots
	const originalApply = plugin.apply
	const makeCtx = () => ({
		...ctx,
		slots: {
			...ctx.slots,
			register: (options) => {
				if (!declaredSlots.includes(options.name)) throw new Error(`slot "${options.name}" is not declared`)
				railSlots.push(options.name)
				return () => {}
			},
		},
	})

	// Only the fallback slot declared: the rail still mounts, drag still works.
	declaredSlots = ['conversation.composer.dock']
	const listenersBefore = documentListeners.size
	originalApply(makeCtx())
	assert.deepEqual(railSlots, ['conversation.composer.dock'], 'the dock is the fallback slot')
	assert.equal(documentListeners.size, listenersBefore, 'the drag intake is unaffected by slot availability')

	// Both declared: the card-top slot wins, because it is the one the rail is
	// positioned against.
	railSlots.length = 0
	declaredSlots = ['conversation.input.overlay', 'conversation.composer.dock']
	originalApply(makeCtx())
	assert.deepEqual(railSlots, ['conversation.input.overlay'], 'the card-top slot is preferred when present')
	declaredSlots = previous
}

console.log('dsh-file-attach slot fallback checks passed')

// --- a rail with no selected session renders nothing ----------------------

{
	const probe = []
	const sessionlessCtx = {
		...ctx,
		sessions: { list: { getSnapshot: () => ({ current: undefined }) }, scope: () => undefined },
		slots: {
			...ctx.slots,
			register: (options, component) => {
				if (!declaredSlots.includes(options.name)) throw new Error(`slot "${options.name}" is not declared`)
				probe.push(component)
				return () => {}
			},
		},
	}
	plugin.apply(sessionlessCtx)
	assert.equal(probe.at(-1)({}), null, 'with no session selected the rail renders nothing')
}

console.log('dsh-file-attach session-less checks passed')
