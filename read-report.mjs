/**
 * Read the browser-side diagnostics the plugin writes into the harness home.
 *
 * The desktop shell has no devtools, so layout and lifecycle facts arrive as a
 * JSON file instead of a console paste. This prints them in reading order.
 *
 * Usage: node read-report.mjs [--watch]
 */
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

const home = process.env.DSH_HOME ?? join(process.env.APPDATA ?? '', 'dsh-desktop', 'harness')
const path = join(home, 'file-attach-report.json')

/** Print one report file, or say why it cannot be read. */
async function show() {
	let raw
	try {
		raw = await readFile(path, 'utf8')
	} catch {
		console.log(`no report yet at ${path}`)
		return false
	}
	const body = JSON.parse(raw)
	const reports = Array.isArray(body.reports) ? body.reports : [body]
	for (const entry of reports) {
		console.log(`\n=== ${entry.stage} @ ${entry.at ?? '?'}`)
		for (const [key, value] of Object.entries(entry)) {
			if (key === 'stage' || key === 'at') continue
			console.log(`  ${key}: ${JSON.stringify(value)}`)
		}
	}
	return true
}

const printSize = async () => {
	try {
		return (await stat(path)).size
	} catch {
		return -1
	}
}

await show()
if (process.argv.includes('--watch')) {
	let seen = await printSize()
	console.log('\nwatching for changes — drag a file into the GUI…')
	for (;;) {
		await new Promise((resolve) => setTimeout(resolve, 1000))
		const size = await printSize()
		if (size !== seen) {
			seen = size
			console.log('\n--- changed ---')
			await show()
		}
	}
}
