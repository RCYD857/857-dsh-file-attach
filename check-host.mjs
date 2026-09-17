/** Host-half route wiring and staging checks (run with `node check-host.mjs`). */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
	apply,
	inject,
	IDENTICAL_COMPARE_MAX_BYTES,
	learnedRoots,
	LOCATE_ROUTE,
	MAX_STAGE_BYTES,
	REPORT_FILE,
	REPORT_ROUTE,
	STAGE_DIRECTORY,
	STAGE_ROUTE,
	locate,
	safeFingerprint,
	safeFileName,
	stage,
} from './lib/index.js'

const here = dirname(fileURLToPath(import.meta.url))

const routes = []
const ctx = {
	webServer: { register: (route) => { routes.push(route); return () => {} } },
	effect: (factory) => { factory(); return () => {} },
}

apply(ctx)
assert.deepEqual(inject, ['webServer'])
assert.equal(routes.length, 3, 'locate, stage and report are all registered')
assert.deepEqual(routes.map((route) => route.path).sort(), [LOCATE_ROUTE, REPORT_ROUTE, STAGE_ROUTE].sort())
for (const route of routes) {
	assert.equal(route.kind, 'exact')
	assert.equal(typeof route.handler, 'function')
}

const locateRoute = routes.find((route) => route.path === LOCATE_ROUTE)
const stageRoute = routes.find((route) => route.path === STAGE_ROUTE)
const reportRoute = routes.find((route) => route.path === REPORT_ROUTE)

const respond = () => {
	const res = { status: undefined, body: undefined }
	res.writeHead = (status) => { res.status = status }
	res.end = (body) => { res.body = body }
	return res
}

const post = (body, headers = {}) => ({
	method: 'POST',
	headers,
	async *[Symbol.asyncIterator]() {
		yield Buffer.isBuffer(body) ? body : Buffer.from(body)
	},
})

// --- locate route ---------------------------------------------------------

const getRes = respond()
await locateRoute.handler({ method: 'GET' }, getRes)
assert.equal(getRes.status, 405)

const badRes = respond()
await locateRoute.handler(post('{not json'), badRes)
assert.equal(badRes.status, 400)
assert.equal(JSON.parse(badRes.body).status, 'error')

const okRes = respond()
await locateRoute.handler(post(JSON.stringify({ file: { name: 'zzz-not-here.bin', size: 1 } })), okRes)
assert.equal(okRes.status, 200)
assert.equal(JSON.parse(okRes.body).status, 'not-found')

assert.deepEqual(await locate({}), { status: 'error', message: 'missing file metadata' })
assert.deepEqual(await locate({ file: {} }), { status: 'error', message: 'missing file name' })

// --- stage route ----------------------------------------------------------

const getStageRes = respond()
await stageRoute.handler({ method: 'GET' }, getStageRes)
assert.equal(getStageRes.status, 405)

const noWorkspaceRes = respond()
await stageRoute.handler(post('bytes', { 'x-file-name': 'a.txt' }), noWorkspaceRes)
assert.equal(noWorkspaceRes.status, 400)
assert.match(JSON.parse(noWorkspaceRes.body).message, /workspace/u)

// --- staging behaviour ----------------------------------------------------

const fixturesRoot = join(here, '.fixtures-host')
await rm(fixturesRoot, { recursive: true, force: true })
await mkdir(fixturesRoot, { recursive: true })
const workspace = await mkdtemp(join(fixturesRoot, 'case-'))

// --- the locator remembers where a file was found -------------------------
//
// A browser never reveals the dropped file's origin, so a directory that just
// produced a hit becomes the first root the next drop searches.
const fakeHome = join(fixturesRoot, 'home')
await mkdir(fakeHome, { recursive: true })
const previousHome = process.env.DSH_HOME
process.env.DSH_HOME = fakeHome

const outside = join(fixturesRoot, 'outside-workspace')
await mkdir(outside, { recursive: true })
await writeFile(join(outside, 'remembered.ndjson'), 'first')
assert.equal(
	(await locate({ file: { name: 'remembered.ndjson', size: 5 }, workspacePaths: [outside] })).status,
	'found',
)
assert.deepEqual(await learnedRoots(), [outside], 'a hit teaches the locator its directory')

// A file that lives only in that learned directory is now findable from a drop
// whose search starts somewhere else entirely.
await writeFile(join(outside, 'later-only.ndjson'), 'second')
const laterHit = await locate({ file: { name: 'later-only.ndjson', size: 6 }, workspacePaths: [workspace] })
assert.equal(laterHit.status, 'found', 'the learned directory is searched first')
assert.equal(laterHit.path, join(outside, 'later-only.ndjson'))

if (previousHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousHome

// --- same-named copies: the bytes decide whether the user is asked ---------
//
// A card that is waiting to be told which of two files is meant is not `ready`,
// and only a `ready` card rides the prompt. So asking about copies that hold the
// same bytes did not just waste a click: it silently dropped the attachment from
// the message, which is exactly what a user reported ("the yml does not go out
// with the text"). Identical copies therefore resolve themselves. Genuinely
// different files still ask, because guessing there would attach the wrong bytes.
const twinRoot = join(fixturesRoot, 'twins')
const twinLeft = join(twinRoot, 'left')
const twinRight = join(twinRoot, 'right')
await mkdir(twinLeft, { recursive: true })
await mkdir(twinRight, { recursive: true })

/** Locate one name that exists in both twin directories. */
const twins = async (name, leftBytes, rightBytes, hash) => {
	await writeFile(join(twinLeft, name), leftBytes)
	await writeFile(join(twinRight, name), rightBytes)
	return locate({
		file: { name, size: Buffer.byteLength(leftBytes), hash },
		currentWorkspacePath: twinLeft,
		workspacePaths: [twinLeft, twinRight],
	})
}

const identical = await twins('entry.yml', 'url: https://example.test\n', 'url: https://example.test\n')
assert.equal(identical.status, 'found', 'byte-identical copies resolve without asking')
assert.equal(identical.path, join(twinLeft, 'entry.yml'), 'the copy inside the session workspace is preferred')

const differing = await twins('twin.yml', 'url: https://example.test/one\n', 'url: https://example.test/two\n')
assert.equal(differing.status, 'choose', 'same name and same size but different bytes still asks')
assert.equal(differing.candidates.length, 2)

assert.equal(safeFingerprint('a'.repeat(64)), 'a'.repeat(64), 'a well-formed fingerprint is accepted')
assert.equal(safeFingerprint('A'.repeat(64)), undefined, 'upper-case hex is not a fingerprint this round')
assert.equal(safeFingerprint('a'.repeat(63)), undefined, 'nor is a truncated one')
assert.equal(safeFingerprint(undefined), undefined, 'and absence stays absent')

// A file copied out of Explorer brings its bytes but no path. Those bytes are the
// original's, so the fingerprint the browser sends decides which copy the user
// means — the picker never appears, and the path is the one the file came from.
{
	const rightBytes = 'url: https://example.test/two\n'
	const rightHash = createHash('sha256').update(rightBytes).digest('hex')
	const claimed = await twins('twin.yml', 'url: https://example.test/one\n', rightBytes, rightHash)
	assert.equal(claimed.status, 'found', 'a fingerprint matching one copy resolves without asking')
	assert.equal(claimed.path, join(twinRight, 'twin.yml'), 'and it is that copy, not the workspace one')

	const staleHash = createHash('sha256').update('url: https://example.test/three\n').digest('hex')
	const unmatched = await twins('twin.yml', 'url: https://example.test/one\n', rightBytes, staleHash)
	assert.equal(unmatched.status, 'choose', 'a fingerprint matching nothing keeps the picker instead of guessing')

	const malformed = await twins('twin.yml', 'url: https://example.test/one\n', rightBytes, 'not-a-hash')
	assert.equal(malformed.status, 'choose', 'an unparsable fingerprint is ignored, not trusted')
}

const oversized = 'x'.repeat(IDENTICAL_COMPARE_MAX_BYTES + 1)
const tooLarge = await twins('huge.yml', oversized, oversized)
assert.equal(tooLarge.status, 'choose', 'identical but past the comparison ceiling asks rather than guesses')

// --- folders are candidates too --------------------------------------------
//
// A folder dropped from Explorer arrives as a nameless, pathless, empty entry, so
// the name search is the only way to find it. Matching files only is what produced
// the dead end "a folder cannot be attached: the machine never gave its original
// path" — for a folder that was sitting right there on the Desktop.
{
	// A name the real Desktop cannot collide with: the fallback roots include the
	// machine's own Desktop, and this suite runs on a machine that has one.
	const folderName = 'folder-case-7b21'
	const folder = join(twinLeft, folderName)
	await mkdir(join(folder, 'inner'), { recursive: true })
	const hit = await locate({
		file: { name: folderName, size: 0 },
		currentWorkspacePath: twinLeft,
		workspacePaths: [twinLeft],
	})
	assert.equal(hit.status, 'found', 'a dropped folder resolves to its own path')
	assert.equal(hit.path, folder, 'and the path is the folder, not something inside it')

	// A same-named file next to it is an honest ambiguity: the folder reports no
	// size and carries no fingerprint, so neither can be proven to be the one.
	await writeFile(join(twinRight, folderName), '')
	const ambiguous = await locate({
		file: { name: folderName, size: 0 },
		currentWorkspacePath: twinLeft,
		workspacePaths: [twinLeft, twinRight],
	})
	assert.equal(ambiguous.status, 'choose', 'a folder and an empty file of the same name still ask')
}

const first = await stage(workspace, 'workflow.json', Buffer.from('{"a":1}'))
assert.equal(first.status, 'staged')
assert.equal(first.path, join(workspace, STAGE_DIRECTORY, 'workflow.json'))
assert.equal(await readFile(first.path, 'utf8'), '{"a":1}')
assert.equal(
	await readFile(join(workspace, STAGE_DIRECTORY, '.gitignore'), 'utf8'),
	'*\n',
	'the staging directory keeps itself out of version control',
)

// Same name, same bytes: reuse the existing copy instead of piling up.
const repeat = await stage(workspace, 'workflow.json', Buffer.from('{"a":1}'))
assert.equal(repeat.reused, true)
assert.equal(repeat.path, first.path)

// Same name, different bytes: a fresh path, never a silent overwrite.
const changed = await stage(workspace, 'workflow.json', Buffer.from('{"a":2}'))
assert.equal(changed.reused, false)
assert.notEqual(changed.path, first.path)
assert.equal(await readFile(changed.path, 'utf8'), '{"a":2}')
assert.equal(await readFile(first.path, 'utf8'), '{"a":1}', 'the first copy is untouched')

// --- a re-dropped file always wins over the stored copy -------------------
//
// Reuse is decided by bytes, across every copy this directory holds under the
// name (`same.txt`, `same-2.txt`, …). Two earlier versions were wrong in
// opposite directions: a size-only check reused a stale copy when an edit kept
// the length, and checking only the first candidate path made reuse impossible
// once a second copy existed.

const firstDrop = await stage(workspace, 'same.txt', Buffer.from('AAAAA'))

// Equal length, different bytes: staged as a new copy, never the old one.
const editedDrop = await stage(workspace, 'same.txt', Buffer.from('BBBBB'))
assert.equal(editedDrop.reused, false, 'an equal-length edit is not mistaken for the stored copy')
assert.notEqual(editedDrop.path, firstDrop.path)
assert.equal(await readFile(editedDrop.path, 'utf8'), 'BBBBB', 'the model would read the new content')
assert.equal(await readFile(firstDrop.path, 'utf8'), 'AAAAA', 'the older copy is left alone')

// The same bytes again: the copy that holds them is found among the candidates,
// so a re-drop is cheap instead of piling up another duplicate.
const redropped = await stage(workspace, 'same.txt', Buffer.from('BBBBB'))
assert.equal(redropped.reused, true, 'identical bytes reuse the copy that holds them')
assert.equal(redropped.path, editedDrop.path)

// And an edit after that still lands as a new copy.
const editedAgain = await stage(workspace, 'same.txt', Buffer.from('CCCCC'))
assert.equal(editedAgain.reused, false)
assert.notEqual(editedAgain.path, editedDrop.path)
assert.equal(await readFile(editedAgain.path, 'utf8'), 'CCCCC')

// Path traversal and illegal characters cannot escape the staging directory.
const hostile = await stage(workspace, '../../evil.sh', Buffer.from('x'))
assert.equal(hostile.status, 'staged')
assert.equal(dirname(hostile.path), join(workspace, STAGE_DIRECTORY))
const weird = await stage(workspace, 'a<b>c:d|e?.txt', Buffer.from('x'))
assert.equal(dirname(weird.path), join(workspace, STAGE_DIRECTORY))
assert.equal(await readFile(weird.path, 'utf8'), 'x')

assert.equal(safeFileName(''), 'file')
assert.equal(safeFileName('..'), 'file')
assert.equal(safeFileName('.hidden'), 'hidden')
assert.equal(safeFileName('ok name.txt'), 'ok name.txt')

assert.deepEqual(await stage(workspace, 'a.txt', Buffer.alloc(0)), { status: 'error', message: 'empty file body' })
assert.equal((await stage(undefined, 'a.txt', Buffer.from('x'))).status, 'error')
assert.equal(
	(await stage(workspace, 'a.txt', Buffer.alloc(MAX_STAGE_BYTES + 1))).status,
	'error',
	'the staging limit is enforced',
)

// The route end-to-end: headers carry name and workspace, body carries bytes.
const routeRes = respond()
await stageRoute.handler(
	post(Buffer.from('staged-through-route'), {
		'x-file-name': encodeURIComponent('我的 报表.csv'),
		'x-workspace-path': encodeURIComponent(workspace),
	}),
	routeRes,
)
assert.equal(routeRes.status, 200)
const staged = JSON.parse(routeRes.body)
assert.equal(staged.status, 'staged')
assert.equal(staged.name, '我的 报表.csv')
assert.equal(await readFile(staged.path, 'utf8'), 'staged-through-route')

// --- the diagnostics route the browser uses when there is no devtools -----

const reportHome = join(fixturesRoot, 'report-home')
await mkdir(reportHome, { recursive: true })
const previousReportHome = process.env.DSH_HOME
process.env.DSH_HOME = reportHome

const getReportRes = respond()
await reportRoute.handler({ method: 'GET' }, getReportRes)
assert.equal(getReportRes.status, 405)

const reportRes = respond()
await reportRoute.handler(
	post(JSON.stringify({ reports: [{ stage: 'apply', version: 'x' }, { stage: 'slot-probe', slot: 's', declared: true }] })),
	reportRes,
)
assert.equal(reportRes.status, 200)
assert.deepEqual(JSON.parse(await readFile(join(reportHome, REPORT_FILE), 'utf8')), {
	reports: [
		{ stage: 'apply', version: 'x' },
		{ stage: 'slot-probe', slot: 's', declared: true },
	],
})

if (previousReportHome === undefined) delete process.env.DSH_HOME
else process.env.DSH_HOME = previousReportHome

await rm(fixturesRoot, { recursive: true, force: true })
console.log('dsh-file-attach host route checks passed')
