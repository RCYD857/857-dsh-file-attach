/**
 * dsh-file-attach — browser half.
 *
 * Drag a file onto the composer (or paste it) and it becomes an attachment card
 * under the input: click to preview, × to remove, and it rides along with the
 * prompt as a real `@path` file reference the model can open with its tools.
 *
 * Images take the native DSH image-attachment path (thumbnail rail + vision
 * input) instead of a path card, which is what the composer already does well.
 *
 * The card is a real composer reference chip, so model serialization uses the
 * platform's own `@file` codec — no special prompt plumbing here.
 */
window.__ModuleLoader__.load({
	id: 'dsh-file-attach',
	factory: (require) => {
		var module = { exports: {} }
		var exports = module.exports
		Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

		const React = require('react')
		const h = React.createElement

		const LOCATE_ROUTE = '/file-attach/locate'
		const STAGE_ROUTE = '/file-attach/stage'
		const REPORT_ROUTE = '/file-attach/report'
		const MAX_ATTACHMENTS = 20
		const PREVIEW_TEXT_BYTES = 200 * 1024
		/** How long a card takes to fade before it leaves the list. */
		const REMOVE_FADE_MS = 150
		/**
		 * Liveness window for the drag invitation.
		 *
		 * Windows file-manager drags do not reliably deliver `dragleave` when the
		 * gesture ends or leaves the window, and the old overlay's drag-depth
		 * counting therefore sticks on screen. A `dragover` stream is the reliable
		 * signal, so the overlay hides as soon as that stream stops.
		 */
		const DRAG_IDLE_MS = 320
		const TEXT_EXTENSIONS = [
			'txt', 'md', 'markdown', 'json', 'jsonc', 'json5', 'yaml', 'yml', 'toml', 'ini', 'cfg', 'conf',
			'log', 'csv', 'tsv', 'xml', 'html', 'htm', 'css', 'scss', 'less', 'js', 'mjs', 'cjs', 'jsx',
			'ts', 'tsx', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp',
			'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'lua', 'r', 'swift', 'dart',
			'gradle', 'properties', 'env', 'gitignore', 'dockerfile', 'makefile', 'patch', 'diff', 'srt', 'vtt',
		]

		// ---------------------------------------------------------------------
		// Stylesheet
		// ---------------------------------------------------------------------

		const CSS = `
/* Attachment strip, laid out to the product spec: a white rounded container with
   a subtle shadow, holding a horizontally scrolling row of 48px attachment cards
   above the text input. The rail is pinned to the composer card's top edge from
   the card-internal slot anchor (bottom 100%), so it needs no ordering, no
   negative margin and no measurement — and it stays a separate panel rather than
   merging into the card, which is the arrangement the user kept. */
.fa-rail{box-sizing:border-box;position:absolute;bottom:100%;left:0;right:0;margin:0 auto 8px;width:100%;max-width:var(--dsh-composer-card-max-width);padding:12px;border:1px solid rgb(0 0 0 / 6%);border-radius:16px;background:#ffffff;box-shadow:0 4px 16px rgb(0 0 0 / 8%);display:flex;flex-direction:column;gap:8px;color:#1d1d1f;z-index:1}
.fa-rail[data-empty=true]{min-height:0;padding:4px 12px;border:0;box-shadow:none;background:0 0}
.fa-emptyHint{display:none;color:#86868b;font-size:12px;line-height:20px}
.fa-rail[data-empty=true][data-dragging=true]{padding:12px;border:1px dashed #1677ff;border-radius:16px;background:rgb(22 119 255 / 6%)}
.fa-rail[data-empty=true][data-dragging=true] .fa-emptyHint{display:block}
.fa-rail[data-dragging=true]{border-color:#1677ff;background:rgb(22 119 255 / 6%)}
.fa-rail[data-dragging=true]::after{content:'松开即可上传';align-self:center;padding:6px 0;color:#1677ff;font-size:13px;line-height:20px}
.fa-strip{position:relative;min-width:0}
/* The lane beside a scroll button is reserved per edge, and only while that edge
   actually has a button. One shared lane left a 30px gap on the left even when no
   left button existed, which is the gap the user reads as "the first card does not
   sit against the edge". */
.fa-cards{display:flex;align-items:center;gap:8px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;padding:0}
.fa-cards::-webkit-scrollbar{display:none}
.fa-rail[data-lane=start] .fa-cards{padding-left:30px}
.fa-rail[data-lane=end] .fa-cards{padding-right:30px}
.fa-rail[data-lane=both] .fa-cards{padding:0 30px}
.fa-fade{position:absolute;top:0;bottom:0;display:flex;align-items:center;width:56px;pointer-events:none}
.fa-fadeLeft{left:0;justify-content:flex-start;background:linear-gradient(to right, #ffffff 42%, rgb(255 255 255 / 0%))}
.fa-fadeRight{right:0;justify-content:flex-end;background:linear-gradient(to left, #ffffff 42%, rgb(255 255 255 / 0%))}
.fa-arrow{pointer-events:auto;display:grid;place-items:center;width:24px;height:24px;padding:0;border:0;border-radius:999px;cursor:pointer;background:rgb(0 0 0 / 6%);color:#1d1d1f}
.fa-arrow:hover{background:rgb(0 0 0 / 12%)}
.fa-card{position:relative;flex:none;height:48px;max-width:200px;border-radius:8px;border:1px solid rgb(0 0 0 / 6%);background:#f5f5f7;overflow:hidden;transition:background-color .15s ease-in-out,opacity .15s ease-out}
.fa-card:hover{background:#ebecef}
.fa-card[data-tone=error]{background:#fff1f0;border-color:#ffccc7}
.fa-card[data-removing=true]{opacity:0;transform:scale(.96)}
.fa-cardMain{display:flex;align-items:center;gap:8px;height:100%;padding:0 8px;background:0 0;border:0;color:inherit;font:inherit;text-align:left;cursor:zoom-in;min-width:0}
.fa-thumb{flex:none;display:grid;place-items:center;width:36px;height:36px;border-radius:6px;overflow:hidden}
.fa-thumbImage{width:48px;height:48px;border-radius:0;padding:0}
.fa-thumb img{width:100%;height:100%;object-fit:cover;display:block}
.fa-meta{display:flex;flex-direction:column;justify-content:center;min-width:0;gap:0}
.fa-name{font-size:14px;font-weight:500;line-height:18px;color:#1d1d1f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.fa-sub{font-size:12px;line-height:16px;color:#86868b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:170px}
.fa-card[data-tone=error] .fa-name,.fa-card[data-tone=error] .fa-sub{color:#d4380d}
.fa-retry{margin-left:8px;padding:2px 8px;border:1px solid #ffccc7;border-radius:6px;background:#fff;color:#d4380d;cursor:pointer;font:inherit;font-size:12px;line-height:16px}
.fa-remove{position:absolute;top:2px;right:2px;display:grid;place-items:center;width:18px;height:18px;padding:0;border:0;border-radius:50%;cursor:pointer;opacity:0;transition:opacity .15s ease-in-out;background:rgb(29 29 31 / 55%);color:#ffffff}
.fa-card:hover .fa-remove,.fa-remove:focus-visible{opacity:1}
.fa-spin{flex:none;display:grid;place-items:center;color:#86868b;animation:fa-spin 1s linear infinite}
@keyframes fa-spin{to{transform:rotate(360deg)}}
.fa-picker{flex:none;margin-left:6px;max-width:150px;padding:2px 6px;border:1px solid rgb(0 0 0 / 10%);border-radius:8px;background:#fff;color:#1d1d1f;font:inherit;font-size:12px}
@media (prefers-reduced-motion:reduce){.fa-card,.fa-remove{transition:none}.fa-spin{animation:none}}
.fa-lightbox{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:40px;background:rgb(15 23 42 / 62%);backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}
.fa-lightboxPanel{display:flex;flex-direction:column;max-width:min(1080px,92vw);max-height:88vh;border-radius:18px;overflow:hidden;background:var(--dsw-alias-bg-base);box-shadow:0 24px 64px rgb(0 0 0 / 36%)}
.fa-lightboxHead{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:.5px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary)}
.fa-lightboxTitle{font-size:14px;font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:520px}
.fa-lightboxSize{font-size:12px;color:var(--dsw-alias-label-tertiary)}
.fa-lightboxClose{margin-left:auto;display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:50%;cursor:pointer;background:0 0;color:var(--dsw-alias-label-secondary)}
.fa-lightboxClose:hover{background:var(--dsw-alias-interactive-bg-hover)}
.fa-lightboxBody{display:grid;place-items:center;overflow:auto;min-height:120px;background:var(--dsw-alias-interactive-bg-hover)}
.fa-lightboxImage{display:block;max-width:min(1080px,92vw);max-height:72vh;object-fit:contain}
.fa-lightboxText{margin:0;padding:16px;width:100%;box-sizing:border-box;max-height:72vh;overflow:auto;font:400 12.5px/19px ui-monospace,SFMono-Regular,Consolas,monospace;white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}
.fa-lightboxFallback{display:grid;justify-items:center;gap:8px;padding:36px;color:var(--dsw-alias-label-tertiary);text-align:center}
.fa-lightboxFallback p{margin:0;font-size:13px}
.fa-lightboxHint{font-size:12px;opacity:.75}
.fa-lightboxFoot{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:.5px solid var(--dsw-alias-border-l2);font-size:11.5px;color:var(--dsw-alias-label-tertiary)}
.fa-lightboxPath{direction:rtl;unicode-bidi:plaintext;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:640px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace}
.fa-lightboxNote{margin-left:auto}
/* Belt and braces for the platform's image-drop mask: this plugin's invitation is
   the only drag surface, and that mask lies about non-image files and gets stuck
   on Windows drags. The class is a CSS-module hash, hence the suffix match. */
[class*="_mask"]:not(#dsh-file-attach-overlay){display:none !important}
`
		if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css="dsh-file-attach"]') === null) {
			const tag = document.createElement('style')
			tag.dataset.plugin = 'dsh-file-attach'
			tag.dataset.pluginCss = 'dsh-file-attach'
			tag.textContent = CSS
			document.head.append(tag)
		}

		// ---------------------------------------------------------------------
		// Small utilities
		// ---------------------------------------------------------------------

		/**
		 * Media types the platform's image pipeline accepts, mapped from the file
		 * extension.
		 *
		 * This exists because a file dragged out of a file manager routinely arrives
		 * with an empty `file.type` (a pasted image carries one, a dragged one often
		 * does not), and the pipeline throws `UnsupportedImageMediaTypeError` on
		 * anything outside its four types. It has no extension fallback of its own, so
		 * an untyped drop used to fail silently: the throw escaped the drop handler
		 * and nothing was ever attached.
		 */
		const IMAGE_TYPES_BY_EXTENSION = {
			png: 'image/png',
			jpg: 'image/jpeg',
			jpeg: 'image/jpeg',
			jfif: 'image/jpeg',
			webp: 'image/webp',
			gif: 'image/gif',
		}

		/** The four media types the platform image pipeline admits. */
		const ACCEPTED_IMAGE_TYPES = new Set(Object.values(IMAGE_TYPES_BY_EXTENSION))

		/** Human-readable byte size. */
		function formatSize(bytes) {
			if (!Number.isFinite(bytes) || bytes < 0) return ''
			if (bytes < 1024) return `${bytes} B`
			if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
			if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
			return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
		}

		/** File extension, lower-cased, without the dot. */
		function extensionOf(name) {
			const dot = name.lastIndexOf('.')
			return dot <= 0 ? '' : name.slice(dot + 1).toLowerCase()
		}

		/** Whether the browser file carries an image media type. */
		function isImageFile(file) {
			return typeof file.type === 'string' && file.type.startsWith('image/')
		}

		/** Whether this file is an image by media type or by extension. */
		function isImageLike(file) {
			return isImageFile(file) || IMAGE_TYPES_BY_EXTENSION[extensionOf(file.name)] !== undefined
		}

		/**
		 * Which glyph a file gets: icons and colours follow file family, so a card
		 * reads as what it is before the file name is read.
		 */
		const CODE_EXTENSIONS = new Set([
			'js', 'mjs', 'cjs', 'jsx', 'ts', 'tsx', 'vue', 'svelte', 'py', 'rb', 'go', 'rs', 'java', 'kt',
			'c', 'h', 'cpp', 'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'lua',
			'r', 'swift', 'dart', 'html', 'htm', 'css', 'scss', 'less', 'json', 'jsonc', 'yaml', 'yml',
			'toml', 'ini', 'xml',
		])
		const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'zst'])
		const DOCUMENT_EXTENSIONS = new Set(['txt', 'md', 'markdown', 'log', 'csv', 'tsv', 'rtf', 'doc', 'docx'])
		const SLIDE_EXTENSIONS = new Set(['pdf', 'ppt', 'pptx', 'key', 'xls', 'xlsx', 'numbers', 'pages'])

		/** One of image, code, archive, slide, doc, file. */
		function fileKindOf(file) {
			if (isImageLike(file)) return 'image'
			const extension = extensionOf(file.name)
			if (CODE_EXTENSIONS.has(extension)) return 'code'
			if (ARCHIVE_EXTENSIONS.has(extension)) return 'archive'
			if (SLIDE_EXTENSIONS.has(extension)) return 'slide'
			if (DOCUMENT_EXTENSIONS.has(extension)) return 'doc'
			return 'file'
		}

		/** Human label for the second line of a card: `txt · 3 B`. */
		function fileSubtitle(file) {
			const extension = extensionOf(file.name)
			return `${extension === '' ? 'File' : extension} · ${formatSize(file.size)}`
		}

		/**
		 * The browser file to hand to the image pipeline, or undefined when this file
		 * cannot ride it.
		 *
		 * @param file - dropped or pasted file.
		 * @returns a file whose declared type the pipeline accepts.
		 */
		function imageFileFor(file) {
			if (typeof file.type === 'string' && ACCEPTED_IMAGE_TYPES.has(file.type)) return file
			const inferred = IMAGE_TYPES_BY_EXTENSION[extensionOf(file.name)]
			if (inferred === undefined) return undefined
			return new File([file], file.name, { type: inferred, lastModified: file.lastModified })
		}

		/** Whether this file can be shown as text in the preview panel. */
		function isTextLike(file) {
			if (typeof file.type === 'string' && file.type.startsWith('text/')) return true
			if (file.type === 'application/json' || file.type === 'application/xml' || file.type === 'application/x-yaml') return true
			return TEXT_EXTENSIONS.includes(extensionOf(file.name))
		}

		/** Basename of a native path in either slash dialect. */
		function basenameOf(path) {
			const parts = String(path).split(/[\\/]/u).filter((part) => part !== '')
			return parts.length === 0 ? String(path) : parts[parts.length - 1]
		}

		/**
		 * Format one resolved path as the composer's file mention.
		 *
		 * Mirrors the platform grammar: whitespace forces the quoted form and any
		 * path the grammar cannot represent safely is refused.
		 */
		function fileMention(path, isDirectory) {
			const value = isDirectory ? `${path}/` : path
			if (value === '' || /[\u0000-\u001f\u007f-\u009f"]/u.test(value) || value.includes('\uFFFC')) return undefined
			return /[\s]/u.test(value) ? `@"${value}"` : `@${value}`
		}

		/** Unique append that keeps insertion order. */
		function pushUnique(list, value) {
			if (!list.includes(value)) list.push(value)
		}

		/** Native absolute paths a file manager exposed on the drag payload. */
		function pathHints(dataTransfer) {
			const values = []
			const read = (type) => {
				try {
					return dataTransfer.getData(type)
				} catch {
					return ''
				}
			}
			for (const type of ['text/uri-list', 'text/plain']) {
				const raw = read(type)
				if (raw === '') continue
				for (const line of raw.split(/\r?\n/u)) {
					const candidate = line.trim()
					if (candidate === '' || candidate.startsWith('#')) continue
					values.push(candidate)
				}
			}
			const paths = []
			for (const value of values) {
				if (value.includes('\uFFFC')) continue
				if (/^[A-Za-z]:[\\/]/u.test(value) || value.startsWith('\\\\')) {
					pushUnique(paths, value.replace(/\//gu, '\\'))
					continue
				}
				if (!value.startsWith('file:')) continue
				try {
					const url = new URL(value)
					const pathname = decodeURIComponent(url.pathname)
					if (url.host !== '' && url.host !== 'localhost') {
						pushUnique(paths, `\\\\${decodeURIComponent(url.host)}${pathname.replace(/\//gu, '\\')}`)
						continue
					}
					const drive = /^\/([A-Za-z]:)(\/.*)$/u.exec(pathname)
					if (drive !== null) pushUnique(paths, `${drive[1]}${drive[2].replace(/\//gu, '\\')}`)
					else pushUnique(paths, pathname)
				} catch {
					/* an unparseable payload line is simply not a path */
				}
			}
			return paths
		}

		/** Whether an object looks like a file-manager directory entry. */
		function isDirectoryEntry(entry) {
			const type = String(entry && entry.type ? entry.type : '')
			return type === '' && Number(entry && entry.size) === 0
		}

		// ---------------------------------------------------------------------
		// Per-session attachment state
		// ---------------------------------------------------------------------

		/** Rail attachments per session id. */
		const states = new Map()
		const listeners = new Set()
		let seq = 0

		/** Session state record, created on demand. */
		function stateFor(sessionId) {
			let state = states.get(sessionId)
			if (state === undefined) {
				state = { items: [] }
				states.set(sessionId, state)
			}
			return state
		}

		/** Publish one mutation to every subscription. */
		function publish() {
			for (const listener of [...listeners]) {
				try {
					listener()
				} catch {
					/* a subscriber's own failure must not break the mutation */
				}
			}
		}

		/** Subscribe the React rail to attachment mutations. */
		function subscribe(listener) {
			listeners.add(listener)
			return () => {
				listeners.delete(listener)
			}
		}

		/** Merge one patch into a rail item and publish. */
		function patchItem(item, patch) {
			Object.assign(item, patch)
			publish()
		}

		/** Release the browser-owned URL of one item. */
		function releaseItem(item) {
			if (item.objectUrl === undefined || item.objectUrlOwner !== 'plugin') return
			try {
				URL.revokeObjectURL(item.objectUrl)
			} catch {
				/* already revoked */
			}
			item.objectUrl = undefined
			item.objectUrlOwner = undefined
		}

		/** Create a thumbnail URL for one item, owned by this plugin. */
		function attachThumbnail(item) {
			if (item.objectUrl !== undefined) return
			try {
				item.objectUrl = URL.createObjectURL(item.file)
				item.objectUrlOwner = 'plugin'
			} catch {
				/* some browsers refuse to object-URL an odd blob; the card falls back to an icon */
			}
		}

		// ---------------------------------------------------------------------
		// Attachment delivery
		//
		// Attachments never touch the composer draft: the text box stays exactly
		// what the user typed, and the ready cards are expanded into the outgoing
		// prompt at the send boundary (the one choke point every submission passes
		// through, including image-only sends).
		// ---------------------------------------------------------------------

		/** Whether the conversation send boundary is already wrapped. */
		let sendBoundaryInstalled = false

		/** Expand ready attachments into one outgoing prompt text. */
		function expandMentions(sessionId, text) {
			const parts = []
			for (const item of stateFor(sessionId).items) {
				if (item.status !== 'ready' || item.sent === true || item.mention === undefined) continue
				parts.push(item.mention)
			}
			if (parts.length === 0) return text
			return text === '' ? parts.join(' ') : `${text} ${parts.join(' ')}`
		}

		/** Drop every card whose attachment already left with a prompt. */
		function forgetSent(sessionId) {
			const state = stateFor(sessionId)
			const sent = state.items.filter((item) => item.sent === true)
			if (sent.length === 0) return
			for (const item of sent) releaseItem(item)
			state.items = state.items.filter((item) => item.sent !== true)
			publish()
		}

		/**
		 * Install the send-boundary expansion exactly once.
		 *
		 * `conversation.sendSession` is the single funnel every submission passes
		 * through, so wrapping it keeps this plugin out of the composer's text
		 * pipeline entirely: no draft writes, no chips, no serialization tricks.
		 * A failed submission keeps its cards, so the user can simply send again.
		 */
		function installSendBoundary(ctx) {
			if (sendBoundaryInstalled) return
			const conversation = ctx.get('conversation')
			if (conversation === undefined || typeof conversation.sendSession !== 'function') return
			sendBoundaryInstalled = true
			const original = conversation.sendSession
			conversation.sendSession = function patchedSendSession(session, text, imageIds, mode, signal) {
				const sessionId = session === undefined || session === null ? undefined : session.sessionId
				if (sessionId === undefined) return original.call(this, session, text, imageIds, mode, signal)
				const outgoing = expandMentions(sessionId, text)
				const pending = original.call(this, session, outgoing, imageIds, mode, signal)
				if (pending === undefined || typeof pending.then !== 'function') return pending
				return pending.then((outcome) => {
					if (outcome !== undefined && outcome.kind === 'success') {
						for (const item of stateFor(sessionId).items) if (item.status === 'ready') item.sent = true
						forgetSent(sessionId)
					}
					return outcome
				})
			}
		}

		/** Surface one composer notice without letting a failure escape. */
		function notify(input, level, text) {
			try {
				const outlet = input === undefined ? undefined : input.notify
				if (typeof outlet === 'function') outlet(level, text)
			} catch {
				/* notice outlets are best-effort */
			}
		}

		/**
		 * Record one resolved file as a ready attachment card.
		 *
		 * Nothing is written to the composer: the card is the only surface, and the
		 * path reaches the model when the next prompt is submitted.
		 */
		function commitResolved(item, path) {
			const mention = fileMention(path, item.isDirectory === true)
			if (mention === undefined) {
				patchItem(item, { status: 'error', error: '路径包含无法引用的字符' })
				return
			}
			patchItem(item, {
				status: 'ready',
				path,
				mention,
				label: basenameOf(path) || item.name,
				sent: false,
			})
		}

		/** The workspace root a session belongs to, when one is known. */
		function workspacePathOf(ctx, sessionId) {
			const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
			return typeof cwd === 'string' && cwd !== '' ? cwd : undefined
		}

		/** Ask the host for the dropped file's original absolute path. */
		async function locateOnHost(ctx, sessionId, file) {
			const workspacePaths = []
			for (const workspace of ctx.workspaces.list.getSnapshot().items) {
				if (typeof workspace.path === 'string' && workspace.path !== '') workspacePaths.push(workspace.path)
			}
			const response = await fetch(LOCATE_ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					phase: 'metadata',
					file: { kind: 'file', name: file.name, size: file.size, lastModified: file.lastModified },
					workspacePaths,
					currentWorkspacePath: workspacePathOf(ctx, sessionId),
				}),
			})
			if (!response.ok) return { status: 'error', message: `HTTP ${response.status}` }
			return response.json()
		}

		/**
		 * Hand the file's bytes to the host so it can stage a copy in the workspace.
		 *
		 * This is the reliable half of resolution: a browser is never obliged to
		 * reveal where a dropped file came from (Electron's drag payload usually
		 * reveals nothing), and the file's bytes are what the model ends up reading
		 * anyway. The name travels as a header, so the body is pure file content.
		 */
		async function stageOnHost(ctx, sessionId, file) {
			const workspacePath = workspacePathOf(ctx, sessionId)
			if (workspacePath === undefined) return { status: 'error', message: '当前会话没有工作区，无法暂存文件' }
			const response = await fetch(STAGE_ROUTE, {
				method: 'POST',
				headers: {
					'content-type': 'application/octet-stream',
					'x-file-name': encodeURIComponent(file.name),
					'x-workspace-path': encodeURIComponent(workspacePath),
				},
				body: file,
			})
			if (!response.ok) {
				let message = `HTTP ${response.status}`
				try {
					const body = await response.json()
					if (typeof body?.message === 'string') message = body.message
				} catch {
					/* keep the status line */
				}
				return { status: 'error', message }
			}
			return response.json()
		}

		/**
		 * Resolve one rail item to a path the model can open.
		 *
		 * Three tiers, best first: the drop payload's own path hint (the user's
		 * original file), a bounded name search on the host, and finally a staged
		 * copy inside the workspace.
		 */
		async function resolveItem(ctx, sessionId, input, item, hint) {
			if (typeof hint === 'string' && hint !== '') {
				commitResolved(item, hint)
				return
			}
			patchItem(item, { status: 'locating' })
			let result
			try {
				result = await locateOnHost(ctx, sessionId, item.file)
			} catch (error) {
				result = { status: 'error', message: error instanceof Error ? error.message : String(error) }
			}
			if (item.removed === true) return
			if (result.status === 'found') {
				commitResolved(item, result.path)
				return
			}
			if (result.status === 'choose' && Array.isArray(result.candidates) && result.candidates.length > 0) {
				patchItem(item, { status: 'choosing', candidates: result.candidates })
				return
			}
			if (item.isDirectory === true) {
				const why = '文件夹无法附加：本机没有给出它的原始路径'
				patchItem(item, { status: 'error', error: why })
				notify(input, 'error', `${item.name}：${why}`)
				return
			}

			patchItem(item, { status: 'staging' })
			let staged
			try {
				staged = await stageOnHost(ctx, sessionId, item.file)
			} catch (error) {
				staged = { status: 'error', message: error instanceof Error ? error.message : String(error) }
			}
			if (item.removed === true) return
			if (staged.status !== 'staged') {
				const why = `无法附加：${staged.message === undefined ? '暂存失败' : staged.message}`
				patchItem(item, { status: 'error', error: why })
				notify(input, 'error', `${item.name}：${why}`)
				return
			}
			commitResolved(item, staged.path)
			patchItem(item, { staged: true })
		}

		/**
		 * Admit dropped or pasted files for one session.
		 *
		 * Images take the native image-attachment path; everything else becomes a
		 * path card. The rail card exists before resolution starts, so the user sees
		 * the file immediately.
		 *
		 * `options.imagesHandledBy` skips the files one caller has already routed into
		 * the image pipeline itself, so a single drop never attaches a picture twice.
		 */
		function admitFiles(ctx, sessionId, input, files, options) {
			const state = stateFor(sessionId)
			const hints = options !== undefined && Array.isArray(options.hints) ? options.hints : []
			const handled = options !== undefined && options.imagesHandledBy instanceof Set ? options.imagesHandledBy : undefined
			const images = []
			let added = 0
			for (const file of files) {
				if (state.items.length >= MAX_ATTACHMENTS) {
					notify(input, 'error', `一次最多附带 ${MAX_ATTACHMENTS} 个文件`)
					break
				}
				const asImage = imageFileFor(file)
				if (asImage !== undefined && (handled === undefined || !handled.has(file))) {
					images.push(asImage)
					continue
				}
				seq += 1
				const hint = file.name === ''
					? undefined
					: hints.find((candidate) => basenameOf(candidate).toLowerCase() === file.name.toLowerCase())
				const item = {
					id: `fa-${seq}`,
					file,
					name: file.name === '' ? '未命名文件' : file.name,
					size: file.size,
					status: 'pending',
					isDirectory: isDirectoryEntry(file),
					removed: false,
					objectUrl: undefined,
					objectUrlOwner: undefined,
					path: undefined,
					mention: undefined,
					label: undefined,
					error: undefined,
				}
				// A picture that ends up on the card path still shows a thumbnail, so the
				// card reads as an image regardless of which pipeline carried it.
				if (isImageLike(file)) attachThumbnail(item)
				state.items.push(item)
				added += 1
				void resolveItem(ctx, sessionId, input, item, hint)
			}
			if (images.length > 0) {
				let accepted = false
				try {
					accepted = input.addImages(images) !== false
				} catch (error) {
					notify(input, 'error', error instanceof Error ? error.message : String(error))
				}
				if (!accepted) notify(input, 'error', '输入框正忙，图片没有加上')
			}
			if (added > 0) publish()
			return added + images.length
		}

		/**
		 * Drop one rail card.
		 *
		 * The card fades first and the list is updated a beat later, so removal reads
		 * as the card leaving rather than the row snapping shut under the pointer.
		 */
		function removeItem(sessionId, item) {
			const state = stateFor(sessionId)
			if (!state.items.includes(item) || item.removing === true) return
			item.removing = true
			publish()
			setTimeout(() => {
				const at = state.items.indexOf(item)
				if (at < 0) return
				state.items.splice(at, 1)
				item.removed = true
				item.removing = false
				releaseItem(item)
				publish()
			}, REMOVE_FADE_MS)
		}

		/** Run a failed attachment through resolution again. */
		function retryItem(ctx, sessionId, item) {
			if (item.status !== 'error') return
			patchItem(item, { status: 'pending', error: undefined, candidates: undefined })
			void resolveItem(ctx, sessionId, undefined, item, undefined)
		}

		// ---------------------------------------------------------------------
		// Rail rendering
		// ---------------------------------------------------------------------

		/** Reactive view over one session's attachment list. */
		function useAttachments(sessionId) {
			const [, force] = React.useState(0)
			React.useEffect(() => subscribe(() => force((value) => value + 1)), [])
			return stateFor(sessionId).items
		}

		/**
		 * How many draft images the composer itself is holding.
		 *
		 * Pictures ride the platform's image pipeline, so this plugin never receives
		 * their file descriptors — but the strip must still show that they are
		 * attached, otherwise a drag of eight images looks like nothing happened. The
		 * count comes from the published input state, which is the same authority the
		 * platform's own rail renders from.
		 */
		function useDraftImageCount(input) {
			const read = () => {
				try {
					const ids = input?.state?.getSnapshot?.()?.imageIds
					return Array.isArray(ids) ? ids.length : 0
				} catch {
					return 0
				}
			}
			const [count, setCount] = React.useState(read)
			React.useEffect(() => {
				const state = input?.state
				if (state === undefined || typeof state.subscribe !== 'function') return undefined
				return state.subscribe(() => setCount(read()))
			}, [input])
			return count
		}

		/**
		 * The session's input facade, or undefined when the session has no scope yet.
		 *
		 * Everything here happens during render, so a throw would take the rail — and
		 * with it the whole attachment strip — off the screen instead of degrading.
		 */
		function inputFor(ctx, sessionId) {
			try {
				const scope = ctx.sessions.scope(sessionId)
				if (scope === undefined) return undefined
				return ctx.get('conversation')?.input?.for?.(scope)
			} catch {
				return undefined
			}
		}

		/** One small line icon. */
		function Glyph({ path, size = 16 }) {
			return h(
				'svg',
				{ width: size, height: size, viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
				...path.map((d, index) =>
					h('path', { key: index, d, stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }),
				),
			)
		}

		const ICON_DOCUMENT = ['M14 3v5h5', 'M6 3h9l4 4v14H6z']
		const ICON_IMAGE = ['M4 5h16v14H4z', 'M4 16l5-5 4 4 3-3 4 4']
		const ICON_FOLDER = ['M3 6h6l2 2h10v11H3z']
		const ICON_CLOSE = ['M6 6l12 12', 'M18 6L6 18']
		const ICON_SPIN = ['M12 3a9 9 0 1 1-9 9']
		const ICON_CHEVRON = ['M9 6l6 6-6 6']
		const ICON_CHEVRON_LEFT = ['M15 6l-6 6 6 6']
		const ICON_ARCHIVE = ['M3 7h18v3H3z', 'M5 10v10h14V10', 'M10 14h4']
		const ICON_CODE = ['M9 8l-4 4 4 4', 'M15 8l4 4-4 4']

		/**
		 * The card glyph, coloured by file family per the spec: blue documents, green
		 * code, yellow archives, red/orange slides and sheets.
		 */
		const KIND_APPEARANCE = {
			doc: { color: '#1677ff', path: ICON_DOCUMENT },
			file: { color: '#1677ff', path: ICON_DOCUMENT },
			code: { color: '#00a870', path: ICON_CODE },
			archive: { color: '#d48806', path: ICON_ARCHIVE },
			slide: { color: '#d4380d', path: ICON_DOCUMENT },
			folder: { color: '#d48806', path: ICON_FOLDER },
			image: { color: '#8c8c8c', path: ICON_IMAGE },
		}

		/** One file-family glyph. */
		function KindIcon({ kind, size = 20 }) {
			const appearance = KIND_APPEARANCE[kind] ?? KIND_APPEARANCE.file
			return h(
				'span',
				{ style: { color: appearance.color, display: 'grid', placeItems: 'center' } },
				h(Glyph, { path: appearance.path, size }),
			)
		}

		/**
		 * One placeholder card standing in for a draft image the platform holds.
		 *
		 * The strip cannot see an image's bytes or its thumbnail (that lives in the
		 * platform's own rail), so the card shows the fact that a picture is attached
		 * rather than inventing a picture.
		 */
		function ImagePlaceholderCard({ index, total }) {
			return h(
				'div',
				{ className: 'fa-card', 'data-kind': 'image', title: `图片附件 ${index + 1}/${total}` },
				h(
					'span',
					{ className: 'fa-cardMain' },
					h('span', { className: 'fa-thumb' }, h(KindIcon, { kind: 'image', size: 20 })),
					h(
						'span',
						{ className: 'fa-meta' },
						h('span', { className: 'fa-name' }, `图片 ${index + 1}`),
						h('span', { className: 'fa-sub' }, '已附加为图片'),
					),
				),
			)
		}

		/**
		 * Scroll the strip by one screen in one direction.
		 *
		 * One screen per click means a click always reveals cards that were hidden,
		 * and the trailing lanes keep the buttons off the cards themselves.
		 */
		function scrollStrip(stripRef, direction) {
			const strip = stripRef.current
			if (strip === null) return
			const step = Math.max(160, strip.clientWidth - 96)
			strip.scrollBy({ left: direction * step, behavior: 'smooth' })
		}

		/** Per-item status copy, used by the preview panel and notices. */
		function statusText(item) {
			if (item.status === 'ready') return item.isDirectory === true ? '文件夹引用' : item.staged === true ? '已附加（工作区副本）' : '已引用本地文件'
			if (item.status === 'locating') return '正在定位原始路径…'
			if (item.status === 'staging') return '正在暂存副本…'
			if (item.status === 'choosing') return '同名文件有多个，请选择'
			if (item.status === 'error') return item.error === undefined ? '无法引用' : item.error
			return '准备中…'
		}

		/**
		 * One attachment card: 48px tall, an icon or thumbnail on the left and two
		 * lines of text on the right (`name` / `txt · 3 B`), per the product spec.
		 *
		 * States the spec calls for: loading (spinner plus "上传中…"), failed (red
		 * surface, red text, a retry button), and the ready state that carries the
		 * real subtitle.
		 */
		function AttachmentCard({ item, onPreview, onRemove, onPick, onRetry }) {
			const failed = item.status === 'error'
			const choosing = item.status === 'choosing'
			const pending = item.status !== 'ready' && !failed && !choosing
			const kind = item.isDirectory === true ? 'folder' : fileKindOf(item.file)
			const thumbnail = item.objectUrl
			const subtitle = pending
				? '上传中…'
				: failed
					? (item.error === undefined ? '定位失败' : item.error)
					: fileSubtitle(item.file)
			const picker = choosing && Array.isArray(item.candidates)
				? h(
						'select',
						{
							className: 'fa-picker',
							defaultValue: '',
							onChange: (event) => {
								if (event.target.value !== '') onPick(item, event.target.value)
							},
							'aria-label': `选择 ${item.name} 的路径`,
						},
						h('option', { value: '' }, '选择路径…'),
						...item.candidates.map((candidate) => h('option', { key: candidate, value: candidate }, candidate)),
					)
				: null
			return h(
				'div',
				{
					className: 'fa-card',
					'data-kind': kind,
					'data-status': item.status,
					'data-tone': failed ? 'error' : undefined,
					'data-removing': item.removing === true ? 'true' : undefined,
					title: `${item.name}${item.path === undefined ? '' : `\n${item.path}`}`,
				},
				h(
					'button',
					{
						type: 'button',
						className: 'fa-cardMain',
						onClick: () => onPreview(item),
						'aria-label': `预览 ${item.name}`,
					},
					thumbnail !== undefined && kind === 'image'						? h('span', { className: 'fa-thumb fa-thumbImage' }, h('img', { src: thumbnail, alt: '', draggable: false }))
						: h(
								'span',
								{ className: 'fa-thumb' },
								pending && !failed
									? h('span', { className: 'fa-spin' }, h(Glyph, { path: ICON_SPIN, size: 18 }))
									: h(KindIcon, { kind, size: 20 }),
							),
					h(
						'span',
						{ className: 'fa-meta' },
						h('span', { className: 'fa-name' }, item.name),
						h('span', { className: 'fa-sub' }, subtitle),
					),
					picker,
					failed && onRetry !== undefined
						? h(
								'button',
								{
									type: 'button',
									className: 'fa-retry',
									onClick: (event) => {
										event.stopPropagation()
										onRetry(item)
									},
								},
								'重试',
							)
						: null,
				),
				h(
					'button',
					{
						type: 'button',
						className: 'fa-remove',
						onClick: () => onRemove(item),
						'aria-label': `移除 ${item.name}`,
						title: '移除附件',
					},
					h(Glyph, { path: ICON_CLOSE, size: 12 }),
				),
			)
		}

		/** The preview panel: image, text head, or metadata fallback. */
		function PreviewPanel({ item, onClose }) {
			const [text, setText] = React.useState(null)
			const [note, setNote] = React.useState(null)
			const imageLike = isImageFile(item.file)
			React.useEffect(() => {
				if (imageLike || !isTextLike(item.file)) return undefined
				let cancelled = false
				if (item.file.size > PREVIEW_TEXT_BYTES) setNote(`文件较大，只预览开头 ${formatSize(PREVIEW_TEXT_BYTES)}`)
				item.file
					.slice(0, PREVIEW_TEXT_BYTES)
					.text()
					.then((value) => {
						if (!cancelled) setText(value)
					})
					.catch((error) => {
						if (!cancelled) setNote(error instanceof Error ? error.message : String(error))
					})
				return () => {
					cancelled = true
				}
			}, [item, imageLike])
			React.useEffect(() => {
				const onKey = (event) => {
					if (event.key === 'Escape') onClose()
				}
				window.addEventListener('keydown', onKey)
				return () => window.removeEventListener('keydown', onKey)
			}, [onClose])
			const body = imageLike
				? h('img', { className: 'fa-lightboxImage', src: item.objectUrl, alt: item.name })
				: text !== null
					? h('pre', { className: 'fa-lightboxText' }, text)
					: h(
							'div',
							{ className: 'fa-lightboxFallback' },
							h(Glyph, { path: ICON_DOCUMENT, size: 40 }),
							h('p', null, isTextLike(item.file) ? '正在读取…' : '这个格式无法在浏览器里预览'),
							h('p', { className: 'fa-lightboxHint' }, '发送后会作为文件引用交给模型读取'),
						)
			return h(
				'div',
				{ className: 'fa-lightbox', role: 'dialog', 'aria-modal': true, onClick: onClose },
				h(
					'div',
					{ className: 'fa-lightboxPanel', onClick: (event) => event.stopPropagation() },
					h(
						'div',
						{ className: 'fa-lightboxHead' },
						h(Glyph, { path: imageLike ? ICON_IMAGE : ICON_DOCUMENT, size: 16 }),
						h('span', { className: 'fa-lightboxTitle' }, item.name),
						h('span', { className: 'fa-lightboxSize' }, formatSize(item.size)),
						h(
							'button',
							{ type: 'button', className: 'fa-lightboxClose', onClick: onClose, 'aria-label': '关闭预览' },
							h(Glyph, { path: ICON_CLOSE, size: 14 }),
						),
					),
					h('div', { className: 'fa-lightboxBody' }, body),
					h(
						'div',
						{ className: 'fa-lightboxFoot' },
						h('code', { className: 'fa-lightboxPath' }, item.path === undefined ? item.name : item.path),
						note === null ? null : h('span', { className: 'fa-lightboxNote' }, note),
					),
				),
			)
		}

		/**
		 * Report what the browser actually measured, once per page load.
		 *
		 * The desktop shell has no devtools, so a layout fact the browser can see is
		 * written through the host route instead of being pasted from a console. It
		 * is a one-shot diagnostic: it says where this plugin's own rail ended up
		 * relative to the composer card, which is exactly what a wrong slot or an
		 * invented offset looks like from the outside.
		 */
		let reported = false
		function reportLayout(rail) {
			if (reported || rail === null) return
			reported = true
			const describe = (element) => {
				if (element === null || element === undefined) return null
				const box = element.getBoundingClientRect()
				const style = getComputedStyle(element)
				return {
					tag: element.tagName,
					className: String(element.className).slice(0, 120),
					top: Math.round(box.top),
					bottom: Math.round(box.bottom),
					height: Math.round(box.height),
					position: style.position,
					display: style.display,
					order: style.order,
					marginBottom: style.marginBottom,
					gap: style.rowGap,
				}
			}
			const chain = []
			let node = rail.parentElement
			for (let depth = 0; node !== null && depth < 6; depth += 1) {
				chain.push(describe(node))
				node = node.parentElement
			}
			const card = document.querySelector('[data-composer-card]')
			const payload = {
				rail: describe(rail),
				card: describe(card),
				parentChain: chain,
				siblings: rail.parentElement === null
					? []
					: [...rail.parentElement.children].map((child) => String(child.className).slice(0, 60)),
				viewport: { width: window.innerWidth, height: window.innerHeight },
			}
			void fetch(REPORT_ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(payload),
			}).catch(() => {})
		}

		/**
		 * Report what the browser actually did, at every checkpoint.
		 *
		 * The desktop shell has no devtools, and this plugin has to survive being
		 * edited without one: a silent failure has no other way out of the browser.
		 * Each report carries the stage it came from, so "no report at all", "report
		 * without a rail" and "rail at the wrong offset" are three distinguishable
		 * facts instead of one guess. Reports accumulate in one file, keyed by stage.
		 */
		/** What the browser actually measured, at the geometry level. */
		const reportStages = {}
		/**
		 * Widths and overflow facts for the rail against the composer card.
		 *
		 * This exists because "the strip's width does not match the text box" is
		 * exactly the kind of claim that has to be read off real boxes rather than
		 * reasoned about: the rail is an absolutely positioned box inside the card, so
		 * its containing block decides its width, not the card's own max-width.
		 */
		function geometry(rail, card) {
			const box = (element) => {
				if (element === null || element === undefined) return null
				const rect = element.getBoundingClientRect()
				return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) }
			}
			const strip = rail === null ? null : rail.querySelector('.fa-cards')
			return {
				rail: box(rail),
				card: box(card),
				railOffsetParent: rail === null || rail.offsetParent === null ? null : String(rail.offsetParent.className).slice(0, 60),
				strip: strip === null ? null : { ...box(strip), scrollWidth: strip.scrollWidth, clientWidth: strip.clientWidth, scrollLeft: Math.round(strip.scrollLeft) },
			}
		}
		function report(stage, detail) {
			const describe = (element) => {
				if (element === null || element === undefined) return null
				try {
					const box = element.getBoundingClientRect()
					const style = getComputedStyle(element)
					return {
						tag: element.tagName,
						className: String(element.className).slice(0, 120),
						top: Math.round(box.top),
						bottom: Math.round(box.bottom),
						height: Math.round(box.height),
						position: style.position,
						display: style.display,
						order: style.order,
						marginBottom: style.marginBottom,
					}
				} catch {
					return { tag: element.tagName, error: 'describe failed' }
				}
			}
			const payload = { stage, at: new Date().toISOString(), ...detail }
			if (stage === 'rail-rendered') {
				const rail = detail.railElement
				const card = document.querySelector('[data-composer-card]')
				const chain = []
				try {
					let node = rail.parentElement
					for (let depth = 0; node !== null && depth < 6; depth += 1) {
						chain.push(describe(node))
						node = node.parentElement
					}
				} catch {
					/* the chain is a convenience, not the point */
				}
				payload.rail = describe(rail)
				payload.card = describe(card)
				payload.parentChain = chain
				payload.siblings = rail.parentElement === null
					? []
					: [...rail.parentElement.children].map((child) => String(child.className).slice(0, 60))
				payload.viewport = { width: window.innerWidth, height: window.innerHeight }
				payload.widths = geometry(rail, card)
				delete payload.railElement
			}
			reportStages[stage] = payload
			void fetch(REPORT_ROUTE, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ reports: Object.values(reportStages) }),
			}).catch(() => {})
		}

		/**
		 * Rail host: the attachment cards, pinned to the top edge of the composer card.
		 *
		 * The rail is registered in `conversation.input.overlay` — the slot the card
		 * renders *inside itself*, at its top, in a zero-height `position: absolute;
		 * inset: 0 0 auto` anchor. `bottom: 100%` on the rail therefore lands it
		 * exactly on the card's top edge: no height to measure, no negative margin and
		 * no ordering trick.
		 *
		 * This is the arrangement the user chose after trying the in-flow variant: an
		 * in-flow rail pushes the transcript up but moves the composer with it, and the
		 * pinned rail keeps the composer still. It does float over the transcript when
		 * the transcript reaches that far down, which is the accepted trade.
		 */
		function AttachmentRail({ sessionId, ctx }) {
			const items = useAttachments(sessionId)
			const imageCount = useDraftImageCount(inputFor(ctx, sessionId))
			const [preview, setPreview] = React.useState(null)
			const [dragging, setDragging] = React.useState(false)
			// `seq` exists because React bails out of a state update whose value is
			// Object.is-equal to the current one: without it, measuring "no overflow"
			// once froze the arrow off for good, since every later measurement produced
			// a fresh but deep-equal object.
			const [overflow, setOverflow] = React.useState({ start: false, end: false, seq: 0 })
			const railRef = React.useRef(null)
			const stripRef = React.useRef(null)

			/** Recompute which edges of the strip still hide cards. */
			const measureOverflow = React.useCallback(() => {
				const strip = stripRef.current
				if (strip === null) return
				const max = strip.scrollWidth - strip.clientWidth
				setOverflow((previous) => ({
					start: strip.scrollLeft > 1,
					end: max > 1 && strip.scrollLeft < max - 1,
					seq: previous.seq + 1,
				}))
			}, [])

			React.useEffect(() => {
				measureOverflow()
				const rail = railRef.current
				const strip = stripRef.current
				if (strip !== null) report('strip-geometry', geometry(rail, document.querySelector('[data-composer-card]')))
			}, [items, measureOverflow])

			React.useEffect(() => {
				const strip = stripRef.current
				if (strip === null) return undefined
				strip.addEventListener('scroll', measureOverflow, { passive: true })
				window.addEventListener('resize', measureOverflow)
				// Cards settle asynchronously (a thumbnail decodes, a name re-wraps), so
				// the overflow decision follows the box instead of only the render that
				// created it.
				const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measureOverflow) : undefined
				observer?.observe(strip)
				const late = setTimeout(measureOverflow, 120)
				return () => {
					strip.removeEventListener('scroll', measureOverflow)
					window.removeEventListener('resize', measureOverflow)
					observer?.disconnect()
					clearTimeout(late)
				}
			}, [measureOverflow, items.length])

			React.useEffect(() => {
				if (preview !== null && !items.includes(preview)) setPreview(null)
			}, [items, preview])

			// Reporting touches module state, so it stays in an effect: a render-phase
			// write is exactly the kind of thing React is entitled to punish.
			React.useEffect(() => {
				report('rail-mounted', { itemCount: items.length, sessionId })
				const rail = railRef.current
				if (rail !== null) report('rail-rendered', { railElement: rail })
			})

			// Drop-target affordance: the rail reacts only to a drag whose target is
			// itself, so the full-viewport invitation keeps owning drags elsewhere.
			React.useEffect(() => {
				const rail = railRef.current
				if (rail === null) return undefined
				let depth = 0
				const onEnter = (event) => {
					if (event.dataTransfer?.types === undefined || ![...event.dataTransfer.types].includes('Files')) return
					depth += 1
					setDragging(true)
				}
				const onLeave = () => {
					depth = Math.max(0, depth - 1)
					if (depth === 0) setDragging(false)
				}
				const onDrop = () => {
					depth = 0
					setDragging(false)
				}
				rail.addEventListener('dragenter', onEnter)
				rail.addEventListener('dragleave', onLeave)
				rail.addEventListener('drop', onDrop)
				window.addEventListener('dragend', onDrop)
				return () => {
					rail.removeEventListener('dragenter', onEnter)
					rail.removeEventListener('dragleave', onLeave)
					rail.removeEventListener('drop', onDrop)
					window.removeEventListener('dragend', onDrop)
				}
			})

			const empty = items.length === 0 && imageCount === 0
			const lane = overflow.start && overflow.end ? 'both' : overflow.start ? 'start' : overflow.end ? 'end' : 'none'
			return h(
				'div',
				{
					className: 'fa-rail',
					'data-file-attach-rail': sessionId,
					'data-empty': empty ? 'true' : 'false',
					'data-dragging': dragging ? 'true' : 'false',
					'data-lane': lane,
					ref: railRef,
				},
				empty
					? h('div', { className: 'fa-emptyHint' }, '松开即可把文件放进输入框')
					: h(
							'div',
							{ className: 'fa-strip' },
							// The scroller is this row itself: an outer wrapper with the ref and
							// the scrolling on an inner div was why the arrow had nothing to
							// move.
							h(
								'div',
								{ className: 'fa-cards', ref: stripRef },
								// Images first, matching the spec's ordering, then the files that
								// carry their own path resolution.
								...Array.from({ length: imageCount }, (unused, index) =>
									h(ImagePlaceholderCard, { key: `image-${index}`, index, total: imageCount }),
								),
								...items.map((item) =>
									h(AttachmentCard, {
										key: item.id,
										item,
										onPreview: setPreview,
										onRemove: (target) => removeItem(sessionId, target),
										onPick: (target, path) => commitResolved(target, path),
										onRetry: (target) => retryItem(ctx, sessionId, target),
									}),
								),
							),
							overflow.start
								? h(
										'div',
										{ className: 'fa-fade fa-fadeLeft' },
										h(
											'button',
											{
												type: 'button',
												className: 'fa-arrow',
												onClick: () => scrollStrip(stripRef, -1),
												'aria-label': '向左查看更多附件',
												title: '向左查看更多附件',
											},
											h(Glyph, { path: ICON_CHEVRON_LEFT, size: 16 }),
										),
									)
								: null,
							overflow.end
								? h(
										'div',
										{ className: 'fa-fade fa-fadeRight' },
										h(
											'button',
											{
												type: 'button',
												className: 'fa-arrow',
												onClick: () => scrollStrip(stripRef, 1),
												'aria-label': '向右查看更多附件',
												title: '向右查看更多附件',
											},
											h(Glyph, { path: ICON_CHEVRON, size: 16 }),
										),
									)
								: null,
						),
				preview === null ? null : h(PreviewPanel, { item: preview, onClose: () => setPreview(null) }),
			)
		}

		// ---------------------------------------------------------------------
		// Drag overlay
		// ---------------------------------------------------------------------

		const OVERLAY_ID = 'dsh-file-attach-overlay'

		/**
		 * Class of the platform's image-drop mask (`dsh-client-ui-attachment`'s
		 * DropOverlay root), matched by suffix so the CSS-module hash can change.
		 */
		const PLATFORM_MASK_CLASS = /^[A-Za-z0-9_-]+_mask$/u

		/** Whether an element is the platform's drop mask rather than some other mask. */
		function isPlatformDropMask(element) {
			if (element === null || element.id === OVERLAY_ID) return false
			for (const name of element.classList) if (PLATFORM_MASK_CLASS.test(name)) return true
			return false
		}

		/**
		 * Remove the platform's image-drop mask the moment it appears.
		 *
		 * The overlay is that package's own drag invitation, and it is worse than
		 * redundant here: it announces "图片拖动到此处即可添加" for *any* dragged file,
		 * it counts `dragenter`/`dragleave` pairs that a Windows file-manager drag
		 * never balances (which is how it ends up stuck on screen), and it accepts a
		 * drop only when the pointer lands exactly on the composer card. This plugin
		 * owns file drops, so the mask is deleted rather than argued with.
		 *
		 * The observer watches the whole subtree — an overlay mounted anywhere under
		 * `body` must be caught, not only one added as a direct child — while the
		 * sweep stays a plain CSS query, so a mutation never costs a style read per
		 * element in the application.
		 */
		function createPlatformMaskSweeper() {
			/** Drop every platform mask currently in the document. */
			const sweep = () => {
				for (const element of document.querySelectorAll('[class*="_mask"]')) {
					if (isPlatformDropMask(element)) element.remove()
				}
			}
			if (typeof MutationObserver !== 'function') return { start: sweep, stop() {} }
			let observer
			return {
				start() {
					sweep()
					if (observer !== undefined) return
					observer = new MutationObserver(sweep)
					observer.observe(document.body, { childList: true, subtree: true })
				},
				stop() {
					sweep()
					observer?.disconnect()
					observer = undefined
				},
			}
		}

		/** Whole-viewport invitation shown while a file drag is in flight. */
		function createOverlay() {
			const root = document.createElement('div')
			root.id = OVERLAY_ID
			Object.assign(root.style, {
				position: 'fixed',
				inset: '0',
				zIndex: '2147483646',
				display: 'grid',
				placeItems: 'center',
				padding: '24px',
				pointerEvents: 'none',
				opacity: '0',
				visibility: 'hidden',
				transition: 'opacity 140ms ease, visibility 140ms ease',
				background: 'rgb(15 23 42 / 40%)',
				backdropFilter: 'blur(6px)',
				WebkitBackdropFilter: 'blur(6px)',
			})
			const panel = document.createElement('div')
			Object.assign(panel.style, {
				display: 'grid',
				justifyItems: 'center',
				gap: '10px',
				minWidth: '280px',
				padding: '26px 34px',
				borderRadius: '20px',
				color: '#ffffff',
				background: 'rgb(23 32 56 / 84%)',
				boxShadow: '0 18px 48px rgb(0 0 0 / 28%)',
				font: '600 16px/1.4 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
			})
			const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
			icon.setAttribute('viewBox', '0 0 24 24')
			icon.setAttribute('width', '42')
			icon.setAttribute('height', '42')
			icon.setAttribute('fill', 'none')
			icon.innerHTML = '<path d="M14 3v5h5M6 3h9l4 4v14H6z" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>'
			const label = document.createElement('span')
			label.textContent = '松开鼠标，作为附件加入输入框'
			const sub = document.createElement('span')
			sub.textContent = '附件会贴在输入框上沿，不会往输入框里写路径'
			Object.assign(sub.style, { font: '400 12px/1.5 inherit', opacity: '0.72' })
			panel.append(icon, label, sub)
			root.append(panel)
			document.body.append(root)
			return {
				setActive(active) {
					root.style.opacity = active ? '1' : '0'
					root.style.visibility = active ? 'visible' : 'hidden'
				},
				dispose() {
					root.remove()
				},
			}
		}

		// ---------------------------------------------------------------------
		// Plugin
		// ---------------------------------------------------------------------

		/** Services required by this plugin. */
		const inject = ['slots', 'sessions', 'workspaces', 'conversation']

		/** Session-scoped input facade for the selected session. */
		function currentSession(ctx) {
			const sessionId = ctx.sessions.list.getSnapshot().current
			if (sessionId === undefined) return undefined
			const scope = ctx.sessions.scope(sessionId)
			const conversation = ctx.get('conversation')
			if (scope === undefined || conversation === undefined) return undefined
			return { sessionId, input: conversation.input.for(scope) }
		}

		/**
		 * Mount the rail in the first slot that this build actually declares.
		 *
		 * The order matters: `conversation.input.overlay` lives *inside* the composer
		 * card at its top, which is where the rail belongs and needs no offset maths.
		 * `conversation.composer.dock` is the fallback for a build without it.
		 *
		 * The declaration is looked up before registering, because a slot that is
		 * missing, already occupied, or not yet declared throws — and an escaping throw
		 * here would take the whole `apply()` down with it, dragging listeners
		 * included. A missing rail must never cost the user the drag itself.
		 */
		function mountRail(ctx) {
			/**
			 * The session this rail belongs to.
			 *
			 * Taken from the store rather than the slot props: a slot entry's props
			 * differ per slot (`conversation.input.overlay` renders without a `session`
			 * prop, which silently produced no rail at all), while the selected session
			 * is one global fact both slots can read.
			 */
			const currentSessionId = () => ctx.sessions.list.getSnapshot().current
			const makeComponent = (slot) =>
				function FileAttachSlot() {
					const sessionId = currentSessionId()
					report('slot-component', { slot, hasSession: sessionId !== undefined })
					if (sessionId === undefined) return null
					try {
						return h(AttachmentRail, { sessionId, ctx })
					} catch (error) {
						report('slot-component-failed', { slot, message: error instanceof Error ? error.message : String(error) })
						return null
					}
				}
			const candidates = [
				// The card-top slot: it renders inside the composer card, above the input,
				// which is where the rail is pinned from.
				{ slot: 'conversation.input.overlay', component: makeComponent('conversation.input.overlay') },
				{ slot: 'conversation.composer.dock', component: makeComponent('conversation.composer.dock') },
			]
			for (const candidate of candidates) {
				const declared = ctx.slots.spec === undefined ? 'no-spec-api' : ctx.slots.spec(candidate.slot) !== undefined
				report('slot-probe', { slot: candidate.slot, declared })
				if (declared !== true) continue
				try {
					const dispose = ctx.slots.register({ name: candidate.slot, id: 'file-attach', order: 50 }, candidate.component)
					if (typeof dispose === 'function') {
						report('slot-registered', { slot: candidate.slot })
						return
					}
					report('slot-register-returned-nothing', { slot: candidate.slot })
				} catch (error) {
					report('slot-register-failed', { slot: candidate.slot, message: error instanceof Error ? error.message : String(error) })
				}
			}
		}

		/** Mount the rail and the global intake listeners. */
		function apply(ctx) {
			report('apply', { version: 'client-2026-09-15-a' })
			try {
				installSendBoundary(ctx)
			} catch (error) {
				report('send-boundary-failed', { message: error instanceof Error ? error.message : String(error) })
			}
			try {
				mountRail(ctx)
			} catch (error) {
				report('mount-rail-failed', { message: error instanceof Error ? error.message : String(error) })
			}

			const overlay = createOverlay()
			const maskSweeper = createPlatformMaskSweeper()
			let watchdog

			/** Show the invitation and keep it alive while drag events keep arriving. */
			const showOverlay = () => {
				maskSweeper.start()
				overlay.setActive(true)
				clearTimeout(watchdog)
				watchdog = setTimeout(hideOverlay, DRAG_IDLE_MS)
			}
			/** Hide the invitation and stop the liveness watchdog. */
			const hideOverlay = () => {
				clearTimeout(watchdog)
				watchdog = undefined
				maskSweeper.stop()
				overlay.setActive(false)
			}

			/** Whether the drag event carries files at all. */
			const hasFiles = (event) => {
				const types = event.dataTransfer?.types
				return types === undefined ? false : [...types].includes('Files')
			}

			/** Files on a DataTransfer that the browser will hand over. */
			const filesOf = (dataTransfer) => {
				if (dataTransfer === null || dataTransfer === undefined) return []
				try {
					return [...dataTransfer.files]
				} catch {
					return []
				}
			}

			/**
			 * Drag handling: this plugin owns the drop, the platform owns nothing.
			 *
			 * The platform's image-drop target (`dsh-client-ui-attachment`) reads well
			 * on paper but never accepted a real drop here: it needs its own
			 * `dragActive` set by `dragover`, a `canAcceptDrop` snapshot, and its media
			 * type admission to all agree. Images are therefore admitted through the
			 * very same `input.addImages` call that target would have made — the
			 * pipeline is unchanged, only the trigger moves somewhere that actually
			 * fires. The platform's handler is left in place (a drop may still reach
			 * it), and its claims are tracked so nothing is attached twice.
			 */
			/**
			 * Drag handling: this plugin owns the drop; the platform's drop target is
			 * stopped and re-implemented here.
			 *
			 * Its own path reads well but never accepted a real drop in this deployment
			 * (it needs its `dragActive` flag, a `canAcceptDrop` snapshot, and its media
			 * admission to all agree), and the media admission has no fallback for the
			 * empty `file.type` a file manager drag arrives with — it throws, which used
			 * to escape the drop handler and fail silently. Images are therefore routed
			 * through `imageFileFor` and handed to the same `input.addImages` call that
			 * target would have made.
			 */
			const onDragEnter = (event) => {
				if (!hasFiles(event)) return
				showOverlay()
			}
			const onDragOver = (event) => {
				if (!hasFiles(event)) return
				// Not prevented: this only makes the browser advertise a copy cursor.
				event.preventDefault()
				if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
				showOverlay()
			}
			const onDragEnd = () => hideOverlay()
			/** Escape retires the invitation for a drag the user abandoned. */
			const onKeyDown = (event) => {
				if (event.key === 'Escape') hideOverlay()
			}
			const onDrop = (event) => {
				if (!hasFiles(event)) return
				// The drop belongs to this plugin alone. Letting the platform's target
				// also react would attach the same picture twice, and there is no way to
				// observe what it took (its listener runs in the same task), so the
				// decision is made here instead: stop its handler, then make the very
				// same `addImages` call it would have made.
				event.preventDefault()
				event.stopImmediatePropagation()
				hideOverlay()
				const active = currentSession(ctx)
				const files = filesOf(event.dataTransfer)
				report('drop', {
					hasSession: active !== undefined,
					fileCount: files.length,
					imageCount: files.filter((file) => imageFileFor(file) !== undefined).length,
					types: files.map((file) => `${file.name}:${file.type || '(no type)'}`),
				})
				if (active === undefined) return
				if (files.length === 0) return
				const images = []
				const taken = new Set()
				for (const file of files) {
					const asImage = imageFileFor(file)
					if (asImage === undefined) continue
					images.push(asImage)
					taken.add(file)
				}
				try {
					admitFiles(ctx, active.sessionId, active.input, files, {
						hints: event.dataTransfer === null ? [] : pathHints(event.dataTransfer),
						imagesHandledBy: taken,
					})
				} catch (error) {
					report('admit-failed', { message: error instanceof Error ? error.message : String(error) })
				}
				if (images.length === 0) return
				let accepted = false
				try {
					accepted = active.input.addImages(images) !== false
				} catch (error) {
					report('add-images-failed', { message: error instanceof Error ? error.message : String(error) })
					notify(active.input, 'error', error instanceof Error ? error.message : String(error))
				}
				if (!accepted) notify(active.input, 'error', '输入框正忙，图片没有加上')
			}
			const onPaste = (event) => {
				const clipboard = event.clipboardData
				if (clipboard === null || clipboard === undefined) return
				const files = [...clipboard.items]
					.filter((item) => item.kind === 'file')
					.map((item) => item.getAsFile())
					.filter((file) => file !== null)
				if (files.length === 0) return
				event.preventDefault()
				event.stopPropagation()
				const active = currentSession(ctx)
				if (active === undefined) return
				admitFiles(ctx, active.sessionId, active.input, files, {})
			}

			document.addEventListener('dragenter', onDragEnter, true)
			document.addEventListener('dragover', onDragOver, true)
			document.addEventListener('drop', onDrop, true)
			document.addEventListener('paste', onPaste, true)
			window.addEventListener('dragend', onDragEnd)
			window.addEventListener('blur', onDragEnd)
			window.addEventListener('keydown', onKeyDown)

			ctx.effect(
				() => () => {
					clearTimeout(watchdog)
					document.removeEventListener('dragenter', onDragEnter, true)
					document.removeEventListener('dragover', onDragOver, true)
					document.removeEventListener('drop', onDrop, true)
					document.removeEventListener('paste', onPaste, true)
					window.removeEventListener('dragend', onDragEnd)
					window.removeEventListener('blur', onDragEnd)
					window.removeEventListener('keydown', onKeyDown)
					overlay.dispose()
					for (const state of states.values()) {
						for (const item of state.items) releaseItem(item)
						state.items.length = 0
					}
					states.clear()
				},
				'file-attach: composer intake',
			)
		}

		exports.apply = apply
		exports.inject = inject
		return module.exports
	},
})
