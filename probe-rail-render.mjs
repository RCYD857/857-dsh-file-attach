/**
 * Render the rail component through a minimal hook engine to catch the crash.
 *
 * The browser report shows no `rail-mounted` checkpoint at all, which means the
 * component throws during render rather than rendering empty. This runs the real
 * component with real-ish inputs so the throw surfaces with a stack.
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
	style: { setProperty() {} },
	classList: [],
	children: [],
	textContent: '',
	innerHTML: '',
	append(...kids) { this.children.push(...kids) },
	remove() {},
	setAttribute() {},
	querySelector: () => null,
	querySelectorAll: () => [],
	getBoundingClientRect: () => ({ top: 0, bottom: 0, left: 0, right: 800, width: 800, height: 48 }),
	addEventListener() {},
	removeEventListener() {},
})
globalThis.document = {
	head: { append: (tag) => styleTags.push(tag) },
	body: { append() {}, children: [] },
	createElement: fakeElement,
	createElementNS: () => fakeElement('svg'),
	querySelector: () => null,
	querySelectorAll: () => [],
	addEventListener() {},
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
const input = {
	state: {
		getSnapshot: () => ({ draft: '', imageIds: ['img-1', 'img-2'] }),
		subscribe: () => () => {},
	},
	addImages: () => true,
	notify: (level, text) => notices.push({ level, text }),
}
const conversation = { input: { for: () => input } }
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

// Several renders, as React would do, with the rail holding two draft images.
// `ctx.registered` is the slot wrapper, so the check walks down to the element
// the rail actually rendered.
for (let pass = 0; pass < 4; pass += 1) {
	cursor = 0
	try {
		const tree = ctx.registered({})
		const rail = find(tree, (node) => node.props?.className === 'fa-rail')
		if (rail === undefined) {
			console.error(`render ${pass}: FAIL — no .fa-rail element in the tree`)
			process.exit(1)
		}
		const empty = rail.props['data-empty']
		const placeholder = find(rail, (node) => node.props?.className === 'fa-card')
		console.log(
			`render ${pass}: ok, data-empty=${String(empty)}, imageCards=${placeholder === undefined ? 0 : 'present'}`,
		)
		if (empty !== 'false') {
			console.error(`FAIL: two draft images should make the rail non-empty, got data-empty=${String(empty)}`)
			process.exit(1)
		}
		if (placeholder === undefined) {
			console.error('FAIL: the draft images produced no card in the strip')
			process.exit(1)
		}
	} catch (error) {
		console.error(`render ${pass}: THREW`)
		console.error(error instanceof Error ? error.stack : String(error))
		process.exit(1)
	}
}
console.log('rail rendered without throwing, and draft images appear as cards')
