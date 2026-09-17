/**
 * Host half of dsh-file-attach.
 *
 * Two routes back the composer's attachment cards:
 *
 * - `POST /file-attach/locate` — the browser hands over a dropped file's
 *   metadata and gets back its native absolute path, reconstructed by a
 *   bounded name search. This is the preferred answer because the model then
 *   reads the user's *original* file.
 * - `POST /file-attach/stage` — the browser hands over the file's bytes and
 *   gets back a path inside the session workspace. This is the fallback that
 *   makes dropping reliable: a browser is not required to reveal any path (and
 *   Electron's drag payload usually reveals none), so name search alone cannot
 *   be the only route to a usable reference.
 *
 * Both answers are ordinary absolute paths that the model's own filesystem
 * tools can open.
 *
 * @module dsh-file-attach
 */
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

/** Route resolving a dropped file's original path. */
export const LOCATE_ROUTE = '/file-attach/locate'
/** Route accepting a dropped file's bytes. */
export const STAGE_ROUTE = '/file-attach/stage'
/** Route accepting one browser-side diagnostics report. */
export const REPORT_ROUTE = '/file-attach/report'
/** Diagnostics file under the harness home, read by the developer. */
export const REPORT_FILE = 'file-attach-report.json'
/** Maximum accepted JSON body for a locate request. */
export const MAX_BODY_BYTES = 256 * 1024
/** Maximum accepted upload size for one staged file. */
export const MAX_STAGE_BYTES = 256 * 1024 * 1024
/** Depth of the bounded name search below each root. */
export const MAX_DEPTH = 5
/** Directory entries visited per search root before giving up. */
export const MAX_ENTRIES_PER_ROOT = 20_000
/** Wall-clock budget for one locate request. */
export const SEARCH_BUDGET_MS = 3_000
/** Candidates reported back for a user pick. */
export const MAX_CANDIDATES = 20
/** Workspace directory that holds staged copies. */
export const STAGE_DIRECTORY = '.dsh-attachments'
/** Kept inside the staging directory so the copies never enter version control. */
export const STAGE_GITIGNORE = '*\n'
/** Remembered search directories, most recently used first. */
export const MAX_LEARNED_ROOTS = 24
/** File under the harness home that remembers where files were found before. */
export const LEARNED_ROOTS_FILE = 'file-attach-roots.json'

/** Reject a path that is not a plain absolute path. */
function safeAbsolute(value) {
	if (typeof value !== 'string' || value === '') return undefined
	if (value.includes('\u0000')) return undefined
	const resolved = resolve(value)
	return resolved === '' ? undefined : resolved
}

/** User folders worth searching when a workspace does not hold the file. */
function fallbackRoots() {
	const home = homedir()
	return ['Desktop', 'Documents', 'Downloads'].map((name) => join(home, name))
}

/** Where the learned-root list lives, or undefined without a resolvable home. */
function learnedRootsPath() {
	const home = process.env.DSH_HOME
	if (typeof home !== 'string' || home === '') return undefined
	return join(home, LEARNED_ROOTS_FILE)
}

/**
 * Directories this plugin has located files in before, most recent first.
 *
 * A browser never reveals where a dropped file came from, so the only cheap
 * signal about "where does this user keep files" is where previous drops
 * resolved. Remembering those directories turns the second drop from a
 * workspace-wide guess into a direct hit.
 */
export async function learnedRoots() {
	const path = learnedRootsPath()
	if (path === undefined) return []
	try {
		const parsed = JSON.parse(await readFile(path, 'utf8'))
		if (!Array.isArray(parsed)) return []
		return parsed.filter((value) => typeof value === 'string' && value !== '').slice(0, MAX_LEARNED_ROOTS)
	} catch {
		return []
	}
}

/** Remember one directory as a search root, newest first. Best-effort. */
export async function rememberRoot(directory) {
	const path = learnedRootsPath()
	const root = safeAbsolute(directory)
	if (path === undefined || root === undefined) return
	const known = await learnedRoots()
	const next = [root, ...known.filter((value) => value !== root)].slice(0, MAX_LEARNED_ROOTS)
	try {
		await mkdir(dirname(path), { recursive: true })
		await writeFile(path, `${JSON.stringify(next, undefined, 1)}\n`)
	} catch {
		/* remembering is an optimization; never fail a locate over it */
	}
}

/** Directory names that conventionally hold dropped-off inputs. */
export const INBOX_DIRECTORY_NAMES = ['inbox', 'input', 'inputs', 'drops']

/** Search roots in priority order, de-duplicated. */
async function searchRoots(payload) {
	const roots = []
	const push = (value) => {
		const candidate = safeAbsolute(value)
		if (candidate === undefined) return
		if (!roots.includes(candidate)) roots.push(candidate)
	}
	push(payload.currentWorkspacePath)
	if (Array.isArray(payload.workspacePaths)) for (const value of payload.workspacePaths) push(value)
	// Workspace-level inboxes come before the user folders: a workflow dropped
	// from the user's input convention should be found where they put it.
	for (const value of await workspaceInboxes(payload)) push(value)
	for (const value of fallbackRoots()) push(value)
	for (const value of await learnedRoots()) push(value)
	return roots
}

/** Existing inbox-style directories directly under each declared workspace. */
async function workspaceInboxes(payload) {
	const declared = []
	if (typeof payload.currentWorkspacePath === 'string') declared.push(payload.currentWorkspacePath)
	if (Array.isArray(payload.workspacePaths)) {
		for (const value of payload.workspacePaths) if (typeof value === 'string') declared.push(value)
	}
	const inboxes = []
	for (const workspace of declared) {
		const root = safeAbsolute(workspace)
		if (root === undefined) continue
		for (const name of INBOX_DIRECTORY_NAMES) {
			const candidate = join(root, name)
			try {
				const info = await stat(candidate)
				if (info.isDirectory() && !inboxes.includes(candidate)) inboxes.push(candidate)
			} catch {
				/* not every workspace uses the convention */
			}
		}
	}
	return inboxes
}

/**
 * Breadth-first search for one name under a root: files and folders alike.
 *
 * Bounded three ways (depth, visited entries, wall clock) so an unlucky drop
 * cannot stall the host; the deadline is checked between directory reads. Every
 * match is collected rather than the first one, because a shallow match must not
 * hide a deeper one from the caller's disambiguation.
 *
 * Folders are candidates too. A folder dropped from Explorer arrives with no path
 * (only its name and an empty entry), so the name search is the only way to find
 * it — and a reference to the folder is a perfectly good attachment: the model
 * lists and reads inside it. Matching only files is what produced the dead end
 * "a folder cannot be attached: the machine never gave its original path".
 */
async function searchRoot(root, name, deadline) {
	const wanted = name.toLowerCase()
	const queue = [{ path: root, depth: 0 }]
	const found = []
	let visited = 0
	while (queue.length > 0 && found.length < MAX_CANDIDATES) {
		if (Date.now() > deadline) break
		const { path, depth } = queue.shift()
		let entries
		try {
			entries = await readdir(path, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			visited += 1
			if (visited > MAX_ENTRIES_PER_ROOT) return found
			if (entry.isDirectory()) {
				if (entry.name.toLowerCase() === wanted) found.push(join(path, entry.name))
				if (depth < MAX_DEPTH && !entry.name.startsWith('.')) queue.push({ path: join(path, entry.name), depth: depth + 1 })
				continue
			}
			if (entry.isFile() && entry.name.toLowerCase() === wanted) found.push(join(path, entry.name))
		}
	}
	return found
}

/** Narrow candidates by byte size so same-named files can be told apart. */
async function filterBySize(candidates, size) {
	if (typeof size !== 'number' || !Number.isFinite(size)) return candidates
	const kept = []
	for (const candidate of candidates) {
		try {
			const info = await stat(candidate)
			if (info.size === size) kept.push(candidate)
		} catch {
			/* an unreadable candidate simply does not match */
		}
	}
	return kept.length === 0 ? candidates : kept
}

/**
 * Resolve one dropped file's payload to a native path.
 *
 * A single unambiguous hit is remembered as a search root, so the folder this
 * user keeps dropped files in is searched first from then on.
 *
 * @param payload - `{ file: { name, size }, workspacePaths, currentWorkspacePath }`.
 * @returns the route's answer: found, choose, not-found, or error.
 */
export async function locate(payload) {
	const file = payload === null || typeof payload !== 'object' ? undefined : payload.file
	if (file === null || typeof file !== 'object') return { status: 'error', message: 'missing file metadata' }
	const name = typeof file.name === 'string' ? basename(file.name.trim()) : ''
	if (name === '' || name === '.' || name === '..') return { status: 'error', message: 'missing file name' }

	const deadline = Date.now() + SEARCH_BUDGET_MS
	const candidates = []
	for (const root of await searchRoots(payload)) {
		const found = await searchRoot(root, name, deadline)
		for (const candidate of found) if (!candidates.includes(candidate)) candidates.push(candidate)
		if (candidates.length > MAX_CANDIDATES) break
		if (Date.now() > deadline) break
	}
	if (candidates.length === 0) return { status: 'not-found' }
	const answer = candidates.length === 1
		? { status: 'found', path: candidates[0] }
		: await narrowCandidate(candidates, file.size, payload.currentWorkspacePath, file.hash)
	// Awaited rather than fired and forgotten: remembering is one tiny write, and
	// the caller must not be able to observe a hit that has not been learned yet.
	if (answer.status === 'found') await rememberRoot(dirname(answer.path))
	return answer
}

/**
 * Narrow several same-named candidates down to one, or ask the user to choose.
 *
 * Size is only a hint, so it can leave several candidates standing — and asking
 * about copies that hold the same bytes makes the user answer a question with no
 * consequence. That question is not free either: a card waiting on an answer is
 * not `ready`, and an attachment that is not `ready` does not ride the prompt.
 * A user who never noticed the picker therefore watched a file they had attached
 * go out with nothing but the text.
 *
 * So the bytes decide whenever they can: identical copies resolve silently (the
 * one inside the session's workspace wins, so the model gets a path it can open),
 * and only genuinely different files still ask.
 *
 * The strongest form of that is the fingerprint the browser sends: a file copied
 * from Explorer arrives with no path at all, but its bytes are exactly the bytes of
 * the original, so a candidate whose SHA-256 matches *is* the file the user copied
 * — wherever they copied it from. That answers the picker's question before it is
 * asked, which is the whole point: "same name, different content" is only ambiguous
 * to a search that cannot look at what the user handed over.
 */
async function narrowCandidate(candidates, size, currentWorkspacePath, hash) {
	const exact = await filterBySize(candidates, size)
	if (exact.length === 1) return { status: 'found', path: exact[0] }
	const claimed = await matchFingerprint(exact, hash)
	if (claimed.length > 0) return { status: 'found', path: insideWorkspace(claimed, currentWorkspacePath) }
	if (await allBytesEqual(exact)) return { status: 'found', path: insideWorkspace(exact, currentWorkspacePath) }
	return { status: 'choose', candidates: exact.slice(0, MAX_CANDIDATES) }
}

/** Byte ceiling for hashing one candidate against the browser's fingerprint. */
export const FINGERPRINT_MAX_BYTES = 64 * 1024 * 1024

/** A SHA-256 fingerprint as the browser sends it: 64 lower-case hex characters. */
export function safeFingerprint(value) {
	return typeof value === 'string' && /^[0-9a-f]{64}$/u.test(value) ? value : undefined
}

/**
 * The candidates whose content hashes to the fingerprint the browser sent.
 *
 * Bounded exactly like the identity comparison: past either ceiling the answer is
 * "not proven", which keeps the picker rather than guessing at the user's file.
 *
 * @param candidates - same-name candidates that already survived the size filter.
 * @param hash - the browser's SHA-256 of the file it holds, when it could afford one.
 * @returns the candidates that hash to it, in candidate order (empty when unproven).
 */
async function matchFingerprint(candidates, hash) {
	const wanted = safeFingerprint(hash)
	if (wanted === undefined) return []
	if (candidates.length === 0 || candidates.length > IDENTICAL_COMPARE_MAX_CANDIDATES) return []
	const matches = []
	for (const candidate of candidates) {
		const bytes = await readFileBytes(candidate)
		if (bytes === undefined || bytes.length > FINGERPRINT_MAX_BYTES) return []
		if (createHash('sha256').update(bytes).digest('hex') === wanted) matches.push(candidate)
	}
	return matches
}

/** Byte ceiling for the "these copies are the same file" comparison. */
export const IDENTICAL_COMPARE_MAX_BYTES = 4 * 1024 * 1024
/** Candidate ceiling for the same comparison, so a wide match cannot stall a drop. */
export const IDENTICAL_COMPARE_MAX_CANDIDATES = 8

/**
 * Whether every candidate is a readable file with byte-identical content.
 *
 * Bounded on purpose: past either ceiling the answer is "not proven identical",
 * which falls back to the picker rather than to a guess.
 */
async function allBytesEqual(candidates) {
	if (candidates.length < 2 || candidates.length > IDENTICAL_COMPARE_MAX_CANDIDATES) return false
	let first
	for (const candidate of candidates) {
		const bytes = await readFileBytes(candidate)
		if (bytes === undefined || bytes.length > IDENTICAL_COMPARE_MAX_BYTES) return false
		if (first === undefined) first = bytes
		else if (!bytes.equals(first)) return false
	}
	return first !== undefined
}

/**
 * The candidate that already lives in the session's workspace, else the first.
 *
 * Only ever called for byte-identical copies, so this changes which path the
 * transcript carries — never which bytes the model reads.
 */
function insideWorkspace(candidates, workspacePath) {
	const root = safeAbsolute(workspacePath)
	if (root === undefined) return candidates[0]
	const prefix = root.toLowerCase()
	const inside = candidates.find((candidate) => {
		const value = candidate.toLowerCase()
		return value.startsWith(`${prefix}\\`) || value.startsWith(`${prefix}/`)
	})
	return inside === undefined ? candidates[0] : inside
}

/** File-name characters that are unsafe or illegal on Windows and POSIX. */
const UNSAFE_NAME = /[<>:"/\\|?*\u0000-\u001f\u007f]+/gu

/**
 * Turn a browser-supplied file name into one safe path segment.
 *
 * The name is user-visible in the transcript, so it stays as close to the
 * original as the filesystem allows instead of being replaced by a hash.
 */
export function safeFileName(value) {
	const raw = typeof value === 'string' ? basename(value.trim()) : ''
	let name = raw.replace(UNSAFE_NAME, '_').replace(/^\.+/u, '').trim()
	if (name === '' || name === '.' || name === '..') name = 'file'
	if (name.length > 150) {
		const dot = name.lastIndexOf('.')
		const extension = dot > 0 && name.length - dot <= 16 ? name.slice(dot) : ''
		name = `${name.slice(0, 150 - extension.length)}${extension}`
	}
	return name
}

/** First free `name`, `name-2`, `name-3`… inside a directory. */
async function freePath(directory, name) {
	const dot = name.lastIndexOf('.')
	const stem = dot > 0 ? name.slice(0, dot) : name
	const extension = dot > 0 ? name.slice(dot) : ''
	for (let attempt = 1; attempt <= 100; attempt += 1) {
		const candidate = join(directory, attempt === 1 ? name : `${stem}-${attempt}${extension}`)
		try {
			await stat(candidate)
		} catch {
			return candidate
		}
	}
	return join(directory, `${stem}-${Date.now()}${extension}`)
}

/**
 * Write one uploaded file into the session workspace.
 *
 * The copy is what the model ends up reading, so it is written under a
 * dot-directory that carries its own `.gitignore`, and it is always the bytes the
 * user just handed over.
 *
 * Reuse is decided by *bytes only*, across every copy this directory already
 * holds under that name (`name`, `name-2`, `name-3`, …). Two earlier versions of
 * this function were wrong in opposite directions: comparing only file sizes
 * reused a stale copy when an edit kept the length, and comparing only the first
 * candidate path made reuse essentially impossible once a second copy existed.
 * Content is the only thing that actually identifies a file.
 *
 * @param workspacePath - absolute directory of the target session workspace.
 * @param name - browser-supplied file name.
 * @param body - the file bytes.
 * @returns the staged path plus whether an identical copy already existed.
 */
export async function stage(workspacePath, name, body) {
	const root = safeAbsolute(workspacePath)
	if (root === undefined) return { status: 'error', message: 'missing workspace path' }
	if (!isAbsolute(root)) return { status: 'error', message: 'workspace path is not absolute' }
	if (body.length === 0) return { status: 'error', message: 'empty file body' }
	if (body.length > MAX_STAGE_BYTES) return { status: 'error', message: 'file too large to stage' }

	const fileName = safeFileName(name)
	const directory = join(root, STAGE_DIRECTORY)
	try {
		await mkdir(directory, { recursive: true })
		await writeFile(join(directory, '.gitignore'), STAGE_GITIGNORE, { flag: 'wx' }).catch(() => {})
	} catch (error) {
		return { status: 'error', message: `cannot prepare staging directory: ${error instanceof Error ? error.message : String(error)}` }
	}

	// Existing copies under this name, in the order `freePath` would produce them.
	for (const candidate of await existingCopies(directory, fileName)) {
		const stored = await readFileBytes(candidate)
		if (stored !== undefined && stored.equals(body)) {
			return { status: 'staged', path: candidate, name: basename(candidate), reused: true }
		}
	}

	const target = await freePath(directory, fileName)
	try {
		await writeFile(target, body)
	} catch (error) {
		return { status: 'error', message: error instanceof Error ? error.message : String(error) }
	}
	return { status: 'staged', path: target, name: basename(target), reused: false }
}

/** Every copy already staged under one file name, primary path first. */
async function existingCopies(directory, fileName) {
	const dot = fileName.lastIndexOf('.')
	const stem = dot > 0 ? fileName.slice(0, dot) : fileName
	const extension = dot > 0 ? fileName.slice(dot) : ''
	const copies = [join(directory, fileName)]
	for (let attempt = 2; attempt <= 100; attempt += 1) copies.push(join(directory, `${stem}-${attempt}${extension}`))
	const present = []
	for (const candidate of copies) {
		try {
			const info = await stat(candidate)
			if (info.isFile()) present.push(candidate)
		} catch {
			/* a gap in the numbering simply has no copy */
		}
	}
	return present
}

/** Read a file's bytes, or undefined when it is unreadable. */
async function readFileBytes(path) {
	try {
		return await readFile(path)
	} catch {
		return undefined
	}
}

/** Read and validate one JSON request body. */
async function readJson(req) {
	const chunks = []
	let size = 0
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		size += buffer.length
		if (size > MAX_BODY_BYTES) throw new Error('request body too large')
		chunks.push(buffer)
	}
	return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

/** Read one upload body, refusing anything past the staging limit. */
async function readUpload(req) {
	const chunks = []
	let size = 0
	for await (const chunk of req) {
		const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
		size += buffer.length
		if (size > MAX_STAGE_BYTES) throw new Error('file too large to stage')
		chunks.push(buffer)
	}
	return Buffer.concat(chunks)
}

/** Write one JSON response. */
function sendJson(res, status, body) {
	res.writeHead(status, {
		'content-type': 'application/json; charset=utf-8',
		'cache-control': 'no-store',
		'x-content-type-options': 'nosniff',
	})
	res.end(JSON.stringify(body))
}

/** Decode the browser-supplied file-name header. */
function headerFileName(req) {
	const raw = req.headers['x-file-name']
	if (typeof raw !== 'string' || raw === '') return ''
	try {
		return decodeURIComponent(raw)
	} catch {
		return raw
	}
}

/** Decode the browser-supplied workspace header. */
function headerWorkspace(req) {
	const raw = req.headers['x-workspace-path']
	if (typeof raw !== 'string' || raw === '') return undefined
	try {
		return decodeURIComponent(raw)
	} catch {
		return raw
	}
}

/** Services required by the host half. */
export const inject = ['webServer']

/** Register the locate and staging routes on the host web server. */
export function apply(ctx) {
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: LOCATE_ROUTE,
				handler: async (req, res) => {
					if (req.method !== 'POST') {
						sendJson(res, 405, { status: 'error', message: 'method not allowed' })
						return
					}
					try {
						const answer = await locate(await readJson(req))
						sendJson(res, 200, answer)
					} catch (error) {
						sendJson(res, 400, { status: 'error', message: error instanceof Error ? error.message : String(error) })
					}
				},
			}),
		'file-attach: locate route',
	)
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: STAGE_ROUTE,
				handler: async (req, res) => {
					if (req.method !== 'POST') {
						sendJson(res, 405, { status: 'error', message: 'method not allowed' })
						return
					}
					try {
						const workspacePath = headerWorkspace(req)
						if (workspacePath === undefined) {
							sendJson(res, 400, { status: 'error', message: 'missing workspace path' })
							return
						}
						const body = await readUpload(req)
						const answer = await stage(workspacePath, headerFileName(req), body)
						sendJson(res, answer.status === 'staged' ? 200 : 400, answer)
					} catch (error) {
						sendJson(res, 400, { status: 'error', message: error instanceof Error ? error.message : String(error) })
					}
				},
			}),
		'file-attach: stage route',
	)
	ctx.effect(
		() =>
			ctx.webServer.register({
				kind: 'exact',
				path: REPORT_ROUTE,
				handler: async (req, res) => {
					if (req.method !== 'POST') {
						sendJson(res, 405, { status: 'error', message: 'method not allowed' })
						return
					}
					try {
						// A layout bug the browser can see but the developer cannot (no
						// devtools in the desktop shell) has to travel some other way. The
						// browser posts what it measured; the host writes it where a
						// filesystem read can pick it up.
						const body = await readJson(req)
						const home = process.env.DSH_HOME
						if (typeof home === 'string' && home !== '') {
							await mkdir(home, { recursive: true })
							await writeFile(join(home, REPORT_FILE), `${JSON.stringify(body, undefined, 1)}\n`)
						}
						sendJson(res, 200, { status: 'recorded' })
					} catch (error) {
						sendJson(res, 400, { status: 'error', message: error instanceof Error ? error.message : String(error) })
					}
				},
			}),
		'file-attach: report route',
	)
}
