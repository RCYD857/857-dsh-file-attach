/**
 * Render the rail through a minimal hook engine and run its effects.
 *
 * Two things are checked here that nothing else can see: the component survives a
 * render with real attachments in it (the original bug was a throw during render,
 * which reached the report as "no `rail-mounted` checkpoint at all"), and the
 * layout contract holds — the chip row inside the composer card hands its measured
 * height to that card, and an empty rail hands the card back untouched.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const source = readFileSync(join(here, 'lib', 'client.js'), 'utf8')

// --- DOM ---
const styleTags = []
const fakeElement = (tag) => ({
	tagName: tag,
	dataset: {},
	style: {
		values: {},
		setProperty(name, value) {
			this.values[name] = value
		},
		removeProperty(name) {
			delete this.values[name]
			// `paddingTop` is also written as a plain property, so clear the camel-case
			// spelling of a dashed name too — that is what the rail's restore path does.
			const camel = name.replace(/-([a-z])/gu, (unused, letter) => letter.toUpperCase())
			delete this[camel]
		},
	},
	attributes: {},
	classList: [],
	children: [],
	textContent: '',
	innerHTML: '',
	offsetHeight: 0,
	append(...kids) { this.children.push(...kids) },
	remove() {},
	setAttribute(name, value) { this.attributes[name] = String(value) },
	getAttribute(name) { return this.attributes[name] ?? null },
	removeAttribute(name) { delete this.attributes[name] },
	closest: (selector) => (selector === '[data-composer-card]' ? composerCard : null),
	querySelector: () => null,
	querySelectorAll: () => [],
	getBoundingClientRect: () => ({ top: 400, bottom: 470, left: 0, right: 800, width: 800, height: 70 }),
	addEventListener() {},
	removeEventListener() {},
})
/** The composer card the rail has to make room in. */
const composerCard = fakeElement('div')
composerCard.setAttribute('data-composer-card', 'true')
const documentListeners = new Map()
globalThis.document = {
	head: { append: (tag) => styleTags.push(tag) },
	body: { append() {}, children: [] },
	createElement: fakeElement,
	createElementNS: () => fakeElement('svg'),
	querySelector: (selector) => (selector === '[data-composer-card]' ? composerCard : null),
	querySelectorAll: () => [],
	addEventListener: (type, handler) => documentListeners.set(type, handler),
	removeEventListener() {},
}
globalThis.window = { addEventListener() {}, removeEventListener() {}, innerWidth: 1400, innerHeight: 900 }
globalThis.ResizeObserver = class { observe() {} disconnect() {} }
globalThis.getComputedStyle = () => ({ position: 'relative', display: 'flex', order: '0', marginBottom: '0px', rowGap: '0px' })

// --- hooks ---
const hooks = []
let cursor = 0
const fakeReact = {
	createElement: (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat() }),
	useState: (initial) => {
		const index = cursor
		cursor += 1
		if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
		return [hooks[index], (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }]
	},
	useRef: (initial) => {
		const index = cursor
		cursor += 1
		if (!(index in hooks)) hooks[index] = { current: initial ?? null }
		return hooks[index]
	},
	useEffect: (callback) => {
		const index = cursor
		cursor += 1
		hooks[index] = callback
	},
	useCallback: (callback) => callback,
}

// --- load the bundle ---
let captured
globalThis.window.__ModuleLoader__ = { load: (definition) => { captured = definition } }
new Function(source)()
const plugin = captured.factory((name) => {
	if (name !== 'react') throw new Error(`unexpected module request: ${name}`)
	return fakeReact
})

// --- fake services, with an input face shaped like the real one ---
const notices = []
/** The composer's own draft pictures, as the platform's input state reports them. */
let draftImageIds = ['img-1']
/** Subscribers to that state, so a change can be published the way the real store does. */
const draftListeners = new Set()
const setDraftImages = (ids) => {
	draftImageIds = ids
	for (const listener of [...draftListeners]) listener()
}
const input = {
	state: {
		getSnapshot: () => ({ draft: '', imageIds: draftImageIds, draftRev: 1 }),
		subscribe: (listener) => {
			draftListeners.add(listener)
			return () => draftListeners.delete(listener)
		},
	},
	addImages: () => true,
	removeImage: (id) => {
		setDraftImages(draftImageIds.filter((candidate) => candidate !== id))
	},
	caretSpan: () => ({ start: 0, end: 0 }),
	notify: (level, text) => notices.push({ level, text }),
}
const conversation = {
	input: { for: () => input },
	// The platform's own draft-image registry: ids in, descriptors (with the browser
	// file and the preview URL) out. The rail draws these as chips like any other
	// attachment, which is what puts pictures and files on one line.
	draftImages: (ids) => ids.map((id) => ({
		id,
		file: new File([new Uint8Array([1, 2, 3])], 'shot.png', { type: 'image/png' }),
		previewUrl: `blob:${id}`,
	})),
	releaseDraftImage: () => {},
}
const ctx = {
	slots: {
		inject: () => () => {},
		spec: (name) => (name === 'conversation.input.overlay' ? { kind: 'list' } : undefined),
		register: (options, component) => { ctx.registered = component; return () => {} },
	},
	sessions: {
		list: { getSnapshot: () => ({ current: 'session-1', byId: { 'session-1': { cwd: 'F:\\DSH' } } }) },
		scope: () => ({ tag: 'scope' }),
	},
	workspaces: { list: { getSnapshot: () => ({ items: [{ path: 'F:\\DSH' }] }) } },
	conversation,
	// No `inputTriggers` on purpose: this build has no chip pipeline at all, which
	// is the strongest form of "the chip was refused" — the file must still appear.
	get: (name) => (name === 'conversation' ? conversation : undefined),
	effect: () => () => {},
}

plugin.apply(ctx)
if (ctx.registered === undefined) {
	console.error('FAIL: no slot entry was registered')
	process.exit(1)
}

/**
 * Depth-first search for one node whose props match a predicate.
 *
 * React is what normally calls a function component; here the search does it, so
 * the walk can reach the elements a component returns.
 */
const find = (node, predicate) => {
	if (node === null || node === undefined || typeof node !== 'object') return undefined
	if (typeof node.type === 'function') {
		let rendered
		try {
			rendered = node.type(node.props ?? {})
		} catch (error) {
			throw new Error(`component ${node.type.name || '(anonymous)'} threw: ${error instanceof Error ? error.message : String(error)}`)
		}
		return find(rendered, predicate)
	}
	if (predicate(node)) return node
	for (const child of Array.isArray(node.children) ? node.children : []) {
		const hit = find(child, predicate)
		if (hit !== undefined) return hit
	}
	return undefined
}

/** Render the rail once, run the effects it registered, and hand back its element. */
const renderRail = () => {
	cursor = 0
	const tree = ctx.registered({})
	const rail = find(tree, (node) => node.props?.className === 'fa-rail')
	if (rail === undefined) {
		console.error('FAIL — no .fa-rail element in the tree')
		process.exit(1)
	}
	// React attaches the ref and the hook engine skips the effects; both are done by
	// hand here so the card-space wiring runs against a real box. The empty rail
	// measures 0 because the stylesheet collapses it — that is the whole point.
	const railElement = fakeElement('div')
	railElement.className = 'fa-rail'
	railElement.offsetHeight = rail.props['data-empty'] === 'true' ? 0 : 148
	if (rail.props.ref !== undefined && rail.props.ref !== null) rail.props.ref.current = railElement
	for (const hook of hooks) if (typeof hook === 'function') hook()
	return rail
}

// Several renders, as React would do, with one draft picture attached. `ctx.registered`
// is the slot wrapper, so the check walks down to what the rail actually rendered:
// a picture is a chip in this row, not a second row of its own.
for (let pass = 0; pass < 4; pass += 1) {
	try {
		const rail = renderRail()
		const chips = find(rail, (node) => node.props?.className === 'fa-chip')
		const empty = rail.props['data-empty']
		console.log(`render ${pass}: ok, data-empty=${String(empty)}, chips=${chips === undefined ? 0 : 'present'}`)
		if (empty !== 'false' || chips === undefined) {
			console.error('FAIL: a draft picture must show up as a chip in the row')
			process.exit(1)
		}
		if (find(chips, (node) => node.props?.className === 'fa-badge') === undefined) {
			console.error('FAIL: the picture chip must carry its badge')
			process.exit(1)
		}
		if (composerCard.style.paddingTop !== '148px') {
			console.error('FAIL: the picture row must make room in the composer card like any other')
			process.exit(1)
		}
	} catch (error) {
		console.error(`render ${pass}: THREW`)
		console.error(error instanceof Error ? error.stack : String(error))
		process.exit(1)
	}
}

// Take the picture away again: the row empties and the card gets its own height back.
setDraftImages([])
await new Promise((resolve) => setTimeout(resolve, 0))
{
	const rail = renderRail()
	if (rail.props['data-empty'] !== 'true' || find(rail, (node) => node.props?.className === 'fa-chip') !== undefined) {
		console.error('FAIL: removing the last picture must leave the row empty')
		process.exit(1)
	}
	if (composerCard.getAttribute('data-file-attach') !== null || composerCard.style.paddingTop !== undefined) {
		console.error('FAIL: an empty rail must hand the composer card back untouched')
		process.exit(1)
	}
}

// Now a real file: it becomes a chip inside the composer card, and the card hands
// over exactly the room that row takes.
documentListeners.get('drop')({
	dataTransfer: {
		types: ['Files'],
		files: [new File(['hello'], 'notes.txt', { type: 'text/plain' })],
		dropEffect: '',
		getData: (type) => (type === 'text/uri-list' ? 'file:///F:/DSH/out/notes.txt' : ''),
	},
	preventDefault() {},
	stopPropagation() {},
	stopImmediatePropagation() {},
})
await new Promise((resolve) => setTimeout(resolve, 0))
{
	const rail = renderRail()
	const chip = find(rail, (node) => node.props?.className === 'fa-chip')
	if (rail.props['data-empty'] !== 'false' || chip === undefined) {
		console.error('FAIL: a dropped file must show up as a chip in the composer')
		process.exit(1)
	}
	if (find(chip, (node) => node.props?.className === 'fa-badge') === undefined) {
		console.error('FAIL: the chip must carry the file badge the form is built on')
		process.exit(1)
	}
	if (find(rail, (node) => node.props?.className === 'fa-scroll') === undefined) {
		console.error('FAIL: the chips must live in the scrolling row')
		process.exit(1)
	}
	if (composerCard.getAttribute('data-file-attach') !== 'tiles' || composerCard.style.paddingTop !== '148px') {
		console.error('FAIL: the composer card must claim the room the row takes')
		process.exit(1)
	}
	console.log('rail rendered without throwing: files become chips in a scrolling row, and the card makes room')
}
