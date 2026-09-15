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
const addedImages = []
const sendCalls = []
let sendOutcome = { kind: 'success' }

const makeInput = () => ({
	state: { getSnapshot: () => ({ draft: drafts.length === 0 ? '' : drafts[drafts.length - 1] }) },
	setDraft: (text) => drafts.push(text),
	addImages: (files) => { addedImages.push(...files); return true },
	notify: (level, text) => notices.push({ level, text }),
})

const conversation = {
	input: { for: () => makeInput() },
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

// --- the attachment strip follows the product spec -------------------------
//
// White rounded container with a soft shadow, holding a horizontally scrolling
// row of 48px cards. The merge into the composer card was tried and reverted, so
// this stays its own panel pinned above the card.

const css = styleTags[0].textContent
const railRule = /\.fa-rail\{[^}]*\}/u.exec(css)?.[0] ?? ''
assert.match(railRule, /position:absolute;bottom:100%;/u, 'the rail is pinned above the card')
assert.match(railRule, /border-radius:16px/u, 'the container is a 16px rounded rectangle')
assert.match(railRule, /background:#ffffff/u, 'the container is white')
assert.match(railRule, /box-shadow:0 4px 16px/u, 'the container carries a soft shadow')
assert.match(railRule, /padding:12px/u, 'the container holds 12px of inner padding')
assert.match(railRule, /gap:8px/u, 'its rows are separated by 8px')

const cardRule = /\.fa-card\{[^}]*\}/u.exec(css)?.[0] ?? ''
assert.match(cardRule, /height:48px/u, 'cards are 48px tall')
assert.match(cardRule, /border-radius:8px/u, 'cards are 8px rounded')
assert.match(cardRule, /background:#f5f5f7/u, 'cards sit on the spec surface colour')
assert.match(cardRule, /max-width:200px/u, 'a card caps its width at 200px')
assert.match(css, /\.fa-card:hover\{background:#ebecef\}/u, 'hover deepens the card surface')
assert.match(css, /\.fa-card\[data-tone=error\]\{background:#fff1f0/u, 'a failed card turns red')
assert.match(css, /\.fa-retry\{/u, 'a failed card offers a retry control')
assert.match(css, /\.fa-cards\{[^}]*overflow-x:auto/u, 'the strip scrolls horizontally')
assert.match(css, /\.fa-cards::-webkit-scrollbar\{display:none\}/u, 'and hides the native scrollbar')
assert.match(css, /\.fa-fadeLeft\{[^}]*linear-gradient/u, 'a gradient marks the left overflow edge')
assert.match(css, /\.fa-fadeRight\{[^}]*linear-gradient/u, 'a gradient marks the right overflow edge')
assert.match(css, /\.fa-arrow\{/u, 'arrow controls scroll the strip')
assert.match(css, /\.fa-rail\[data-dragging=true\]\{border-color:#1677ff/u, 'the container highlights while a file hovers it')
assert.match(css, /\.fa-name\{[^}]*font-size:14px;font-weight:500/u, 'the file name is 14px medium')
assert.match(css, /\.fa-sub\{[^}]*font-size:12px;line-height:16px;color:#86868b/u, 'the subtitle is 12px grey')
assert.match(css, /\.fa-thumbImage\{width:48px;height:48px/u, 'an image card is a 48px square thumbnail')
assert.match(source, /KIND_APPEARANCE/u, 'file families map to their own glyph and colour')
assert.match(source, /fileSubtitle/u, 'the subtitle is built from extension and size')

assert.doesNotMatch(css, /\.fa-rail\{[^}]*transform:translateY/u, 'the reverted merge transform is gone')
assert.doesNotMatch(source, /fa-divider/u, 'the reverted divider is gone')
assert.doesNotMatch(css, /\.fa-rail\{[^}]*order:-1/u, 'no reordering is involved')
assert.doesNotMatch(css, /\.fa-rail\{[^}]*calc\(-1 \*/u, 'no negative-margin pull is involved')
// The rail must not be positioned by measurement again: the only ResizeObserver
// allowed is the one that decides whether the strip overflows.
assert.doesNotMatch(source, /--fa-rail-pull|--fa-card-h|--fa-rail-h/u, 'no layout-measurement variable is back')
assert.equal((source.match(/new ResizeObserver/gu) ?? []).length, 1, 'exactly one ResizeObserver, for strip overflow')
assert.match(source, /'conversation\.input\.overlay', component/u, 'the card-top slot is the pipe the rail uses')

// The stylesheet is one template literal: a backtick inside it ends the literal
// early and turns the rest of the CSS into JavaScript.
assert.equal((source.match(/`/gu) ?? []).length % 2, 0, 'the CSS template literal is balanced')

// --- drive apply() with fake services -------------------------------------

const slotsRegistrations = []
/** Slots this fake build declares; a missing one must fall through, not throw. */
let declaredSlots = ['conversation.input.overlay', 'conversation.composer.dock']
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
		list: { getSnapshot: () => ({ current: 'session-1', byId: { 'session-1': { cwd: 'F:\\DSH' } } }) },
		scope: () => ({ tag: 'scope' }),
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

assert.equal(locateCalls().length, 1, 'one locate request per non-image file')
assert.equal(locateCalls()[0].body.file.name, 'QuadView_krea2_v1.json')
assert.equal(locateCalls()[0].body.currentWorkspacePath, 'F:\\DSH')
assert.deepEqual(locateCalls()[0].body.workspacePaths, ['F:\\DSH'])
assert.equal(stageCalls().length, 0, 'a located file is not copied')
assert.deepEqual(drafts, [], 'the draft is never written on admission')

await new Promise((resolve) => setTimeout(resolve, 0))
await new Promise((resolve) => setTimeout(resolve, 0))

// --- sending carries the attachment, the draft stays clean ----------------

await conversation.sendSession({ sessionId: 'session-1' }, '看看这个工作流', [], 'queue')
assert.equal(sendCalls.length, 1)
assert.equal(sendCalls[0].text, '看看这个工作流 @F:\\DSH\\inbox\\comfyui\\QuadView_krea2_v1.json')
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
assert.deepEqual(addedImages, [png], 'images take the native attachment path')
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
assert.equal(locateCalls().length, 1, 'a path hint skips the locate request')

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
const imagesBefore = addedImages.length
documentListeners.get('drop')(dropEvent)
assert.equal(dropEvent.immediateStopped, true, 'the drop belongs to this plugin, so it cannot be attached twice')
assert.equal(addedImages.length, imagesBefore + 1, 'a dragged image reaches the image pipeline')
assert.equal(addedImages.at(-1).type, 'image/png', 'the empty type a file-manager drag delivers is repaired')
assert.equal(addedImages.at(-1).name, 'dropped.png')
assert.equal(overlay.style.visibility, 'hidden', 'the drop retires the invitation')

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
// only) must fall back to a path card instead of throwing inside the drop.
const tiff = new File(['x'], 'scan.tiff', { type: '' })
const tiffDrop = fileDragEvent()
tiffDrop.dataTransfer.files = [tiff]
tiffDrop.dataTransfer.getData = () => ''
const imagesBeforeTiff = addedImages.length
documentListeners.get('drop')(tiffDrop)
assert.equal(addedImages.length, imagesBeforeTiff, 'an unsupported image format is not forced into the image pipeline')
const tiffLocate = locateCalls().at(-1)
assert.equal(tiffLocate.body.file.name, 'scan.tiff', 'it becomes an ordinary file attachment instead')

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
