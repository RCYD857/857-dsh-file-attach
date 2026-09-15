/**
 * Probe the host locator against real workspace paths.
 *
 * Usage: node probe-locate.mjs [root ...] [--name <fileName>]
 *
 * Reports what the bounded search actually finds, how long it took, and how
 * many directory entries it visited — the numbers behind "找不到该文件的原始路径".
 */
import { readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { locate, MAX_DEPTH, MAX_ENTRIES_PER_ROOT, SEARCH_BUDGET_MS } from './lib/index.js'

const args = process.argv.slice(2)
const nameIndex = args.indexOf('--name')
const wantedName = nameIndex >= 0 ? args[nameIndex + 1] : undefined
const roots = args.filter((arg, index) => !arg.startsWith('--') && index !== nameIndex + 1)

/** Pick a real file name from the first existing root to use as the probe target. */
async function firstFileUnder(root, depth = 0) {
	const queue = [{ path: root, depth }]
	const seen = []
	while (queue.length > 0) {
		const current = queue.shift()
		let entries
		try {
			entries = await readdir(current.path, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			if (entry.isFile()) seen.push(join(current.path, entry.name))
			else if (entry.isDirectory() && current.depth < 2 && !entry.name.startsWith('.')) queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 })
		}
		if (seen.length > 0) break
	}
	return seen[0]
}

/** Count the entries the bounded search would walk under one root. */
async function countEntries(root, depth = 0, budget = { left: MAX_ENTRIES_PER_ROOT }) {
	const queue = [{ path: root, depth }]
	let visited = 0
	while (queue.length > 0 && budget.left > 0) {
		const current = queue.shift()
		let entries
		try {
			entries = await readdir(current.path, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			visited += 1
			budget.left -= 1
			if (budget.left <= 0) break
			if (entry.isDirectory() && current.depth < MAX_DEPTH && !entry.name.startsWith('.')) queue.push({ path: join(current.path, entry.name), depth: current.depth + 1 })
		}
	}
	return visited
}

const target = wantedName === undefined ? await firstFileUnder(roots[0]) : undefined
const fileName = wantedName ?? (target === undefined ? undefined : target.split(/[\\/]/u).pop())
if (fileName === undefined) {
	console.error('probe: found no probe target; pass --name <file>')
	process.exit(1)
}

let size
for (const root of roots) {
	if (target !== undefined) {
		try {
			size = (await stat(target)).size
			break
		} catch {
			/* keep looking */
		}
	}
}

console.log(`target name : ${fileName}`)
console.log(`target size : ${size === undefined ? '(unknown)' : size}`)
console.log(`roots       : ${roots.join(' | ')}`)
console.log(`bounds      : depth<=${MAX_DEPTH} entries/root<=${MAX_ENTRIES_PER_ROOT} budget<=${SEARCH_BUDGET_MS}ms`)

for (const root of roots) {
	const started = performance.now()
	const visited = await countEntries(root)
	const elapsed = performance.now() - started
	const budgetLeft = Math.max(0, MAX_ENTRIES_PER_ROOT - visited)
	console.log(
		`root ${root}\n  entries visited in a full walk: ${visited}` +
			` (${budgetLeft === 0 ? 'EXHAUSTS the per-root budget' : `budget left ${budgetLeft}`}), ${elapsed.toFixed(0)}ms`,
	)
}

const started = performance.now()
const result = await locate({ file: { name: fileName, size }, workspacePaths: roots, currentWorkspacePath: roots[0] })
console.log(`locate(${fileName}) -> ${result.status} ${result.path ?? JSON.stringify(result.candidates ?? result.message ?? '')}`)
console.log(`locate took ${(performance.now() - started).toFixed(0)}ms`)
