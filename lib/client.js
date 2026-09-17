/**
 * dsh-file-attach — browser half.
 *
 * Drag a file onto the composer (or paste it) and it becomes an attachment card
 * inside the input box — the form Codex uses: a file glyph over the name, a remove
 * badge on the hovered corner, the card's own text row pushed down to make room.
 * Nothing is typed into the draft: when the prompt is sent, every ready card is
 * expanded into a real `@path` reference the model opens with its tools.
 *
 * Images take the native DSH image-attachment path instead (thumbnail row +
 * vision input): a picture is not a path, and the composer already draws it well.
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
/* Attachment chips, in the composer card's own top area — the form Doubao uses:
   one scrolling row of compact chips (badge, name, state), pictures and files
   alike, with a page arrow floating over the row's edge and a remove badge on each
   chip's top-right corner. The rail is mounted in the composer's card-internal slot
   anchor, a zero-height absolute box at the card's top edge, so the space the row
   occupies has to come out of the card's own padding: the rail measures itself and
   writes that height straight onto the card's inline padding-top (see the layout
   effect in the rail: a stylesheet rule was tried first, and lost to the platform's
   own padding). */
.fa-rail{box-sizing:border-box;position:absolute;top:0;left:0;right:0;display:flex;align-items:center;padding:8px 12px 4px;color:#1d1d1f;z-index:1}
.fa-rail[data-empty=true]{padding:0}
.fa-emptyHint{display:none;color:#86868b;font-size:12px;line-height:20px}
.fa-rail[data-empty=true][data-dragging=true]{padding:10px 12px;border:1px dashed #1677ff;border-radius:12px;background:rgb(22 119 255 / 6%)}
.fa-rail[data-empty=true][data-dragging=true] .fa-emptyHint{display:block}
.fa-rail[data-dragging=true][data-empty=false]{outline:1px dashed #1677ff;outline-offset:-6px;border-radius:12px}
/* The chips row draws the draft pictures as well, so the platform's own thumbnail
   row — rendered in the same place, inside this same card — is hidden. It is a
   suffix match because that class is a CSS-module hash. */
[data-slot="conversation.input.attachments"] > div[class$="_rail"]{display:none !important}
/* The row scrolls one page at a time; the vertical padding is what lets a chip's
   remove badge stick out above the chip without being clipped by the scroller. */
.fa-scroll{display:flex;align-items:center;gap:8px;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;flex:1 1 auto;min-width:0;padding:9px 0 5px}
.fa-scroll::-webkit-scrollbar{display:none}
/* The chip caught under a floating arrow fades out instead of being cut off, the
   way Doubao's row does it. It is a mask rather than a gradient panel, so it works
   on any card colour (light or dark) without matching one, and the arrow — a
   sibling of the scroller, not a child — stays fully opaque above it. Each edge's
   fade exists exactly when that edge's arrow does. */
.fa-scroll[data-mask=start]{-webkit-mask-image:linear-gradient(to right,transparent 0,#000 54px);mask-image:linear-gradient(to right,transparent 0,#000 54px)}
.fa-scroll[data-mask=end]{-webkit-mask-image:linear-gradient(to left,transparent 0,#000 54px);mask-image:linear-gradient(to left,transparent 0,#000 54px)}
.fa-scroll[data-mask=both]{-webkit-mask-image:linear-gradient(to right,transparent 0,#000 54px,#000 calc(100% - 54px),transparent 100%);mask-image:linear-gradient(to right,transparent 0,#000 54px,#000 calc(100% - 54px),transparent 100%)}
/* The arrows float over the chips and only exist while that end still hides one:
   a row that fits shows neither, and a row at its end shows only the other. */
.fa-arrow{position:absolute;top:50%;z-index:2;display:grid;place-items:center;width:26px;height:26px;padding:0;border:0;border-radius:8px;cursor:pointer;background:rgb(255 255 255 / 94%);color:#4a4a4f;box-shadow:0 1px 4px rgb(0 0 0 / 14%);transform:translateY(-50%);transition:background-color .14s ease}
.fa-arrow[data-edge=start]{left:4px}
.fa-arrow[data-edge=end]{right:4px}
.fa-arrow:hover{background:#ffffff}
.fa-chip{position:relative;flex:none;display:flex;align-items:center;gap:9px;width:244px;min-height:62px;padding:8px 10px;border:1px solid rgb(0 0 0 / 6%);border-radius:12px;background:#f5f5f7;transition:background-color .15s ease-in-out,opacity .15s ease-out}
.fa-chip:hover{background:#ebecef}
.fa-chip[data-tone=error]{background:#fff1f0;border-color:#ffccc7}
.fa-chip[data-removing=true]{opacity:0;transform:scale(.97)}
.fa-chipMain{display:flex;align-items:center;gap:9px;flex:1 1 auto;min-width:0;padding:0;border:0;background:0 0;color:inherit;font:inherit;text-align:left;cursor:zoom-in}
.fa-badge{flex:none;display:grid;place-items:center;width:34px;height:34px;border-radius:9px;background:rgb(0 0 0 / 4%);overflow:hidden}
.fa-badge img{width:100%;height:100%;object-fit:cover;display:block}
.fa-chipText{display:flex;flex-direction:column;justify-content:center;min-width:0;gap:1px}
.fa-name{font-size:13.5px;line-height:18px;color:#1d1d1f;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fa-sub{font-size:11.5px;line-height:15px;color:#86868b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fa-chip[data-tone=error] .fa-name,.fa-chip[data-tone=error] .fa-sub{color:#d4380d}
.fa-retry{margin-top:1px;padding:0;border:0;background:0 0;color:#d4380d;font:inherit;font-size:11.5px;line-height:15px;text-align:left;text-decoration:underline;cursor:pointer}
/* The remove badge sits on the chip's top-right corner, always visible, like the
   one in Doubao's row — the scroller's padding is what keeps it un-clipped. */
.fa-remove{position:absolute;top:-7px;right:-7px;display:grid;place-items:center;width:20px;height:20px;padding:0;border:0;border-radius:50%;cursor:pointer;background:rgb(29 29 31 / 82%);color:#ffffff;box-shadow:0 1px 3px rgb(0 0 0 / 18%)}
.fa-remove:hover{background:rgb(29 29 31 / 100%)}
.fa-spin{display:grid;place-items:center;color:#86868b;animation:fa-spin 1s linear infinite}
@keyframes fa-spin{to{transform:rotate(360deg)}}
.fa-picker{width:100%;margin-top:1px;padding:1px 4px;border:1px solid rgb(0 0 0 / 10%);border-radius:7px;background:#fff;color:#1d1d1f;font:inherit;font-size:11.5px}
@media (prefers-reduced-motion:reduce){.fa-chip,.fa-remove{transition:none}.fa-spin{animation:none}}
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

		/** Extension a sniffed family is filed under when the file carries no name. */
		const IMAGE_EXTENSION_BY_TYPE = {
			'image/png': 'png',
			'image/jpeg': 'jpg',
			'image/webp': 'webp',
			'image/gif': 'gif',
		}

		/**
		 * The accepted media type the leading bytes prove, or undefined.
		 *
		 * A screenshot handoff is under no obligation to describe itself: WeChat's
		 * own drag payload and an anonymous clipboard blob both arrive with an empty
		 * `type` and often an empty or meaningless name, and extension-guessing then
		 * files a picture as an unnamed document. The four families the platform
		 * accepts all start with bytes that cannot be confused with each other.
		 *
		 * @param bytes - the file's first bytes.
		 * @returns one of the accepted media types, or undefined.
		 */
		function sniffImageType(bytes) {
			const ascii = (at, length) =>
				bytes.length < at + length ? '' : String.fromCharCode(...bytes.slice(at, at + length))
			if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png'
			if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
			if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp'
			const gif = ascii(0, 6)
			if (gif === 'GIF87a' || gif === 'GIF89a') return 'image/gif'
			return undefined
		}

		/** The first bytes of one file; empty when they cannot be read. */
		async function headOf(file) {
			try {
				return new Uint8Array(await file.slice(0, 16).arrayBuffer())
			} catch {
				return new Uint8Array(0)
			}
		}

		/**
		 * Resolve one dropped or pasted file to something the image pipeline can take.
		 *
		 * Three answers, best first: the declared media type, the extension, and the
		 * leading bytes. The last one is what makes an anonymous screenshot — no
		 * type, no useful name — arrive as a picture instead of as a document card
		 * the user never asked for.
		 *
		 * @param file - dropped or pasted file.
		 * @param stem - name to invent for a picture that arrives unnamed.
		 * @returns a file the pipeline accepts, or undefined for a non-image.
		 */
		async function imageFileForAsync(file, stem) {
			const declared = imageFileFor(file)
			if (declared !== undefined) return declared
			if (isDirectoryEntry(file) || file.size === 0) return undefined
			const type = sniffImageType(await headOf(file))
			if (type === undefined) return undefined
			const name = file.name === '' ? `${stem}.${IMAGE_EXTENSION_BY_TYPE[type]}` : file.name
			return new File([file], name, { type, lastModified: file.lastModified })
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

		/**
		 * The native path one file already came with, when the transfer carried one.
		 *
		 * Two sources, in order of fidelity: the file object's own `path` (Electron
		 * exposed it for OS files before version 32, and honouring it costs one line),
		 * and a payload path whose base name matches the file — which is what an
		 * Explorer drag gives, and what a clipboard occasionally gives on paste.
		 *
		 * @param file - the browser file being admitted.
		 * @param hints - absolute paths the payload carried.
		 * @returns the path to trust without searching, or undefined.
		 */
		function hintFor(file, hints) {
			if (typeof file.path === 'string' && /^([A-Za-z]:[\\/]|\\\\)/u.test(file.path)) return file.path
			if (file.name === '') return undefined
			const wanted = file.name.toLowerCase()
			return hints.find((candidate) => basenameOf(candidate).toLowerCase() === wanted)
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

		/**
		 * The composer card's own inline `padding-top`, as found the first time this
		 * plugin had to make room in it. Restoring that exact value — rather than
		 * assuming it is empty — is what lets an idle composer go back to being the
		 * platform's card and nothing else.
		 */
		const cardPaddingOrigin = new WeakMap()

		/**
		 * Whether a file drag is in flight, driven by the global `dragover` heartbeat.
		 *
		 * Windows never delivers a reliable `dragleave` when a drag ends, so the rail
		 * cannot count entry and exit events to decide whether to draw its drop outline
		 * — doing that left the dashed border stuck on screen after a drop. The
		 * heartbeat that already drives the full-screen invitation is the one honest
		 * signal, so the rail reads the same flag.
		 */
		const dragLiveness = { active: false, listeners: new Set() }

		/** Publish one heartbeat tick to every subscriber, once per change. */
		function setDragLiveness(active) {
			if (dragLiveness.active === active) return
			dragLiveness.active = active
			for (const listener of [...dragLiveness.listeners]) {
				try {
					listener()
				} catch {
					/* a subscriber's own failure must not break the drag */
				}
			}
		}

		/** Reactive read of {@link dragLiveness} for the rail. */
		function useDragLiveness() {
			const [, force] = React.useState(0)
			React.useEffect(() => {
				const listener = () => force((value) => value + 1)
				dragLiveness.listeners.add(listener)
				return () => {
					dragLiveness.listeners.delete(listener)
				}
			}, [])
			return dragLiveness.active
		}

		/** Session state record, created on demand. */
		function stateFor(sessionId) {
			let state = states.get(sessionId)
			if (state === undefined) {
				state = { items: [], input: undefined }
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

		/**
		 * Attachments this prompt will NOT carry.
		 *
		 * Only a `ready` item has a path to expand, so anything still resolving —
		 * or waiting on a pick between same-named files — is left out. Leaving it
		 * out silently was the bug the user hit: the card sat in the strip looking
		 * attached while the prompt went without it. Every skip is therefore
		 * reported at the send boundary.
		 */
		function unsentItems(sessionId) {
			return stateFor(sessionId).items.filter((item) => item.sent !== true && item.status !== 'ready')
		}

		/** Say why one attachment could not ride this prompt. */
		function unsentReason(item) {
			if (item.status === 'choosing') return `${choosingText(item)}，在卡片上选一个`
			if (item.status === 'error') return '附加失败，可点卡片上的重试'
			return '还在准备中，请稍后重发'
		}

		/** Report unattached cards instead of letting the prompt leave without them. */
		function reportUnsent(sessionId) {
			const items = unsentItems(sessionId)
			if (items.length === 0) return
			const detail = items
				.map((item) => `${item.label === undefined ? item.name : item.label}（${unsentReason(item)}）`)
				.join('；')
			notify(stateFor(sessionId).input, 'error', `${items.length} 个附件没有随本次消息发出：${detail}`)
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
		 * This is how an attached file reaches the model: the cards live beside the
		 * draft rather than inside it (the composer's own text stays exactly what the
		 * user typed), so every ready card is expanded into its `@path` here — one
		 * choke point every submission passes through. Anything not resolved is named
		 * in a notice instead of being left out in silence.
		 *
		 * `conversation.sendSession` is the single funnel every submission passes
		 * through, image-only sends included, which is why the boundary lives here.
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
				// Before the prompt leaves, not after: a card that cannot ride this
				// message has to say so while the user is still looking at the send.
				reportUnsent(sessionId)
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
		 * The card is the surface: nothing is written into the composer draft, and the
		 * path reaches the model when the next prompt is submitted (the send boundary
		 * expands every ready card into its `@path`).
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

		/** Byte ceiling for the content fingerprint sent with a locate request. */
		const FINGERPRINT_MAX_BYTES = 64 * 1024 * 1024

		/**
		 * SHA-256 of one browser file, as 64 hex characters — or undefined when it
		 * cannot be afforded.
		 *
		 * A file copied in Explorer and pasted here arrives with no path at all, so the
		 * host has nothing but its name to search with, and two same-named files turn
		 * into a question. Its *bytes* are the original's bytes, though, so this is what
		 * lets the host recognise which file was copied — wherever it was copied from.
		 * Bounded, because hashing is linear work on the main thread's behalf: past the
		 * ceiling the host simply keeps its name-and-size search and the picker.
		 */
		async function fingerprintOf(file) {
			if (!Number.isFinite(file.size) || file.size === 0 || file.size > FINGERPRINT_MAX_BYTES) return undefined
			try {
				const subtle = globalThis.crypto?.subtle
				if (subtle === undefined) return undefined
				const digest = await subtle.digest('SHA-256', await file.arrayBuffer())
				return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
			} catch {
				return undefined
			}
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
					file: {
						kind: 'file',
						name: file.name,
						size: file.size,
						lastModified: file.lastModified,
						hash: await fingerprintOf(file),
					},
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
				const why = '文件夹没能定位：本机没有给出它的路径，把里面的文件直接拖进来，或用 @ 引用它'
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

		/** Say why the image pipeline refused a file, in the user's own terms. */
		function describeImageError(error) {
			if (error !== null && typeof error === 'object' && error.name === 'UnsupportedImageMediaTypeError') {
				const type = typeof error.mediaType === 'string' && error.mediaType !== '' ? error.mediaType : '未知格式'
				return `图片格式不支持（${type}），只能发 PNG / JPEG / WebP / GIF`
			}
			return error instanceof Error ? error.message : String(error)
		}

		/**
		 * Hand image files to the platform's own draft-image pipeline.
		 *
		 * The composer's `addImages` takes draft-image **ids**, not files: the ids
		 * come from `conversation.createDraftImages`, which validates the media type
		 * and owns the preview URL. Calling `addImages(files)` on the session facade
		 * — what this plugin used to do — pushed objects the draft registry had
		 * never handed out, and the composer's own reconciliation pass dropped them
		 * again on the very next render. The symptom was a pasted screenshot that
		 * produced nothing at all: no thumbnail, no card, no error.
		 *
		 * @param ctx - client plugin context.
		 * @param input - session input facade.
		 * @param files - image files `imageFileForAsync` has admitted.
		 * @returns how many of them reached the draft.
		 */
		function admitImages(ctx, input, files) {
			if (files.length === 0) return 0
			const refuse = (message) => {
				notify(input, 'error', message)
				return 0
			}
			const conversation = ctx.get('conversation')
			if (conversation === undefined || typeof conversation.createDraftImages !== 'function') {
				// A build without a draft-image registry: the facade takes the files.
				try {
					return input.addImages(files) === false ? refuse('输入框正忙，图片没有加上') : files.length
				} catch (error) {
					return refuse(describeImageError(error))
				}
			}
			let attachments
			try {
				attachments = conversation.createDraftImages(files)
			} catch (error) {
				return refuse(describeImageError(error))
			}
			try {
				if (input.addImages(attachments.map((attachment) => attachment.id)) === false) {
					conversation.releaseDraftImages(attachments)
					return refuse('输入框正忙，图片没有加上')
				}
			} catch (error) {
				try {
					conversation.releaseDraftImages(attachments)
				} catch {
					/* the registry already let go of them */
				}
				return refuse(describeImageError(error))
			}
			return files.length
		}

		/**
		 * Admit dropped or pasted files for one session.
		 *
		 * Two destinations:
		 *
		 * - A picture goes to the platform's image pipeline, which is where the
		 *   composer's own thumbnail row reads from.
		 * - Every other file becomes a card in the rail — the composer card's own top
		 *   area — first as a pending card, then as a ready one carrying the `@path`
		 *   the send boundary expands.
		 *
		 * @returns how many cards were added and how many pictures reached the draft.
		 */
		async function admitFiles(ctx, sessionId, input, files, options) {
			const state = stateFor(sessionId)
			// Kept so the send boundary can report a card it had to leave behind:
			// that notice has no composer of its own to talk to.
			state.input = input
			const hints = options !== undefined && Array.isArray(options.hints) ? options.hints : []
			const stem = options !== undefined && options.paste === true ? '粘贴的图片' : '图片'
			const images = []
			let added = 0
			for (const file of files) {
				const asImage = await imageFileForAsync(file, stem)
				if (asImage !== undefined) {
					images.push(asImage)
					continue
				}
				const descriptor = {
					name: file.name === '' ? '未命名文件' : file.name,
					isDirectory: isDirectoryEntry(file),
				}
				const hint = hintFor(file, hints)
				if (state.items.length >= MAX_ATTACHMENTS) {
					notify(input, 'error', `一次最多附带 ${MAX_ATTACHMENTS} 个文件`)
					break
				}
				seq += 1
				const item = {
					id: `fa-${seq}`,
					file,
					name: descriptor.name,
					size: file.size,
					status: 'pending',
					isDirectory: descriptor.isDirectory,
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
			if (added > 0) publish()
			return { cards: added, images: admitImages(ctx, input, images) }
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
		 * The composer's own draft pictures, shaped as chips for the same row.
		 *
		 * A picture is not a path, so it still travels the platform's image pipeline —
		 * that is what makes it visual input. But the row the platform draws it in sits
		 * in the very place this rail does, so this plugin draws it here instead (and
		 * hides that row with one stylesheet rule), which is what puts pictures and
		 * files on one line. The chip carries the platform's own preview URL and the
		 * registry's own descriptor, so nothing is copied and removal goes through the
		 * platform's two calls: release the registry entry, then drop the draft id.
		 */
		function useDraftImages(ctx, sessionId) {
			const input = inputFor(ctx, sessionId)
			const read = () => {
				try {
					const ids = input?.state?.getSnapshot?.()?.imageIds
					if (!Array.isArray(ids) || ids.length === 0) return []
					const conversation = ctx.get('conversation')
					if (conversation === undefined || typeof conversation.draftImages !== 'function') return []
					return conversation.draftImages(ids).map((attachment) => ({
						id: `fa-img-${attachment.id}`,
						imageId: attachment.id,
						file: attachment.file,
						name: attachment.file === undefined || attachment.file.name === '' ? '图片' : attachment.file.name,
						size: (attachment.file?.size ?? 0),
						status: 'ready',
						isDirectory: false,
						removed: false,
						objectUrl: attachment.previewUrl,
						objectUrlOwner: 'platform',
					}))
				} catch {
					return []
				}
			}
			const [images, setImages] = React.useState(read)
			React.useEffect(() => {
				const state = input?.state
				if (state === undefined || typeof state.subscribe !== 'function') return undefined
				const sync = () => setImages(read())
				sync()
				return state.subscribe(sync)
			}, [input])
			return images
		}

		/** Remove one draft picture the way the composer's own × does. */
		function removeDraftImage(ctx, input, item) {
			try {
				const conversation = ctx.get('conversation')
				if (typeof conversation?.releaseDraftImage === 'function') conversation.releaseDraftImage(item.imageId)
				if (typeof input?.removeImage === 'function') input.removeImage(item.imageId)
			} catch {
				/* a refusal (mid-submit) leaves the picture where it is, which is honest */
			}
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
		 * Copy for "several files share this name — pick one".
		 *
		 * Shared by the card subtitle, the preview panel and the send-time notice,
		 * so the one state a user can be stuck in is described the same way
		 * everywhere. It is also the copy that tells them the attachment is not
		 * attached yet, which the card previously hid behind a normal-looking
		 * `yml · 502 B` subtitle.
		 */
		function choosingText(item) {
			const count = Array.isArray(item.candidates) ? item.candidates.length : 2
			return `同名文件有 ${count} 个，请先选择`
		}

		/** Per-item status copy, used by the preview panel and notices. */
		function statusText(item) {
			if (item.status === 'ready') return item.isDirectory === true ? '文件夹引用' : item.staged === true ? '已附加（工作区副本）' : '已引用本地文件'
			if (item.status === 'locating') return '正在定位原始路径…'
			if (item.status === 'staging') return '正在暂存副本…'
			if (item.status === 'choosing') return choosingText(item)
			if (item.status === 'error') return item.error === undefined ? '无法引用' : item.error
			return '准备中…'
		}

		/**
		 * One attachment chip, in the form Doubao's composer uses: a file badge on the
		 * left, the name with its `ext · size` (or the state it is in) stacked next to
		 * it, and a remove badge on the top-right corner of the chip.
		 *
		 * The same chip carries every state a file can be in: a spinner while it is
		 * located, the same-name question where a pick is needed, a red surface with an
		 * inline Retry when it failed, and the resolved state — which is what the model
		 * ultimately receives as `@path`.
		 */
		function AttachmentCard({ item, onPreview, onRemove, onPick, onRetry }) {
			const failed = item.status === 'error'
			const choosing = item.status === 'choosing'
			const pending = item.status !== 'ready' && !failed && !choosing
			const kind = item.isDirectory === true ? 'folder' : fileKindOf(item.file)
			const thumbnail = item.objectUrl
			const showsImage = thumbnail !== undefined && kind === 'image'
			const subtitle = pending
				? item.status === 'staging'
					? `正在上传… · ${formatSize(item.size)}`
					: `正在定位… · ${formatSize(item.size)}`
				: failed
					? (item.error === undefined ? '定位失败' : item.error)
					: choosing
						? choosingText(item)
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
					className: 'fa-chip',
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
						className: 'fa-chipMain',
						onClick: () => onPreview(item),
						'aria-label': `预览 ${item.name}`,
						disabled: choosing,
					},
					// The badge doubles as the state indicator: a picture shows itself, a
					// pending file spins, everything else wears its file family's glyph.
					h(
						'span',
						{ className: 'fa-badge' },
						showsImage
							? h('img', { src: thumbnail, alt: '', draggable: false })
							: pending
								? h('span', { className: 'fa-spin' }, h(Glyph, { path: ICON_SPIN, size: 18 }))
								: h(KindIcon, { kind, size: 20 }),
					),
					h(
						'span',
						{ className: 'fa-chipText' },
						h('span', { className: 'fa-name' }, item.name),
						h('span', { className: 'fa-sub' }, subtitle),
						failed && onRetry !== undefined
							? h(
									'button',
									{
										type: 'button',
										className: 'fa-retry',
										onClick: (event) => {
											event.stopPropagation()
											event.preventDefault()
											onRetry(item)
										},
									},
									'附加失败，重新试一次',
								)
							: null,
						picker,
					),
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
		 * Widths for the rail against the composer card.
		 *
		 * This exists because "the cards do not sit where the text box does" is
		 * exactly the kind of claim that has to be read off real boxes rather than
		 * reasoned about: the rail is an absolutely positioned box inside the card, so
		 * its containing block decides its width, not the card's own max-width.
		 */
		function geometry(rail, card) {
			const box = (element) => {
				if (element === null || element === undefined) return null
				const rect = element.getBoundingClientRect()
				return {
					left: Math.round(rect.left),
					right: Math.round(rect.right),
					top: Math.round(rect.top),
					bottom: Math.round(rect.bottom),
					width: Math.round(rect.width),
					height: Math.round(rect.height),
				}
			}
			return {
				rail: box(rail),
				card: box(card),
				railHeight: rail === null ? null : rail.offsetHeight,
				cardPaddingTop: card === null || card === undefined ? null : getComputedStyle(card).paddingTop,
				tiles: rail === null ? null : rail.children.length,
				railOffsetParent: rail === null || rail.offsetParent === null || rail.offsetParent === undefined
					? null
					: String(rail.offsetParent.className).slice(0, 60),
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
				payload.siblings = rail.parentElement === null || rail.parentElement === undefined
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
		 * Rail host: the attachment cards, inside the composer card's own top area.
		 *
		 * The rail is registered in `conversation.input.overlay` — the slot the card
		 * renders *inside itself*, at its top, in a zero-height `position: absolute;
		 * inset: 0 0 auto` anchor. So the tiles are absolutely placed on the card's
		 * top edge and the space they take is claimed by the card's own padding: the
		 * rail measures itself and writes that height onto the card's inline
		 * `padding-top` (plus a `data-file-attach=tiles` marker for the diagnostics),
		 * which is what makes the card grow instead of the tiles floating over the
		 * text.
		 *
		 * That is deliberate: the form the user asked for is the one Codex uses, where
		 * attachments live *in* the input box. Nothing moves the composer's own
		 * geometry — the card grows upward from a fixed bottom edge, which is exactly
		 * what the platform does when its own image rail has items.
		 */
		function AttachmentRail({ sessionId, ctx }) {
			const items = useAttachments(sessionId)
			const images = useDraftImages(ctx, sessionId)
			// One row for everything: the composer's own draft pictures first (they ride
			// the platform's pipeline, which is what makes them visual input), then the
			// files this plugin resolved into `@path` references.
			const chips = [...images, ...items]
			const [preview, setPreview] = React.useState(null)
			const dragging = useDragLiveness()
			// The row scrolls one page at a time, so which ends still hide chips has to
			// be measured after every layout change; `seq` exists because React bails out
			// of a state update that is `Object.is`-equal to the current one, which would
			// otherwise freeze a stale "nothing is hidden" answer in place.
			const [overflow, setOverflow] = React.useState({ start: false, end: false, seq: 0 })
			const railRef = React.useRef(null)
			const scrollRef = React.useRef(null)

			/** Recompute which ends of the row still hide chips. */
			const measureOverflow = React.useCallback(() => {
				const row = scrollRef.current
				if (row === null) return
				const max = row.scrollWidth - row.clientWidth
				setOverflow((previous) => ({
					start: row.scrollLeft > 1,
					end: max > 1 && row.scrollLeft < max - 1,
					seq: previous.seq + 1,
				}))
			}, [])

			React.useEffect(() => {
				const row = scrollRef.current
				if (row === null) return undefined
				measureOverflow()
				row.addEventListener('scroll', measureOverflow, { passive: true })
				window.addEventListener('resize', measureOverflow)
				// Chips settle asynchronously (a name re-ellipsises, a badge decodes), so
				// the arrow decision follows the box rather than only the render that made
				// it, and one late pass covers a box that was still empty when it mounted.
				const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measureOverflow) : undefined
				observer?.observe(row)
				const late = setTimeout(measureOverflow, 120)
				return () => {
					row.removeEventListener('scroll', measureOverflow)
					window.removeEventListener('resize', measureOverflow)
					observer?.disconnect()
					clearTimeout(late)
				}
			}, [measureOverflow, chips.length])

			/**
			 * Make room in the card that has to hold the rail.
			 *
			 * The rail is absolute inside a zero-height anchor, so the card's flow
			 * content would otherwise sit underneath it. The room is claimed by writing
			 * the rail's measured height straight onto the card's own `padding-top` —
			 * inline, not through a stylesheet rule: the first attempt published a custom
			 * property for a rule to read, and the card kept its own 8px (measured in
			 * `file-attach-report.json`), which left the tiles floating over the text and
			 * spilling out of the card. An inline value cannot lose that fight.
			 *
			 * `offsetHeight` includes the rail's own padding, so the reservation is the
			 * whole gap: tiles, then the card's content right underneath.
			 */
			React.useEffect(() => {
				const rail = railRef.current
				const card = rail === null
					? null
					: rail.closest('[data-composer-card]') ?? document.querySelector('[data-composer-card]')
				if (rail === null || card === null) return undefined
				if (!cardPaddingOrigin.has(card)) cardPaddingOrigin.set(card, card.style.paddingTop)
				const origin = cardPaddingOrigin.get(card)
				/** Apply one reservation; 0 hands the card back to the platform. */
				const reserve = (height) => {
					if (height > 0) {
						card.style.paddingTop = `${height}px`
						card.setAttribute('data-file-attach', 'tiles')
						return
					}
					card.removeAttribute('data-file-attach')
					if (origin === undefined || origin === '') card.style.removeProperty('padding-top')
					else card.style.paddingTop = origin
				}
				const publish = () => {
					// An empty rail reserves nothing — not even while a drag shows its dashed
					// invitation, which would otherwise make the composer jump.
					reserve(chips.length === 0 ? 0 : rail.offsetHeight)
				}
				publish()
				report('strip-geometry', geometry(rail, card))
				// The first paint can measure 0 (a chip with no box yet, a re-mount inside
				// the same commit), and the box keeps changing after it: an image decodes, a
				// name re-ellipsises, a chip grows a picker. Both are covered — a few frames
				// of retries and a ResizeObserver for everything after.
				let frames = 0
				let frame
				const again = () => {
					publish()
					frames += 1
					if (frames < 5 && chips.length > 0 && rail.offsetHeight <= 0) frame = requestAnimationFrame(again)
				}
				if (typeof requestAnimationFrame === 'function') frame = requestAnimationFrame(again)
				const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(publish) : undefined
				observer?.observe(rail)
				window.addEventListener('resize', publish)
				return () => {
					if (frame !== undefined) cancelAnimationFrame(frame)
					observer?.disconnect()
					window.removeEventListener('resize', publish)
					// Hand the card back exactly as it was found.
					reserve(0)
				}
			}, [chips.length])

			React.useEffect(() => {
				if (preview !== null && !chips.includes(preview)) setPreview(null)
			}, [chips, preview])

			// Reporting touches module state, so it stays in an effect: a render-phase
			// write is exactly the kind of thing React is entitled to punish.
			React.useEffect(() => {
				report('rail-mounted', { itemCount: chips.length, sessionId })
				const rail = railRef.current
				if (rail !== null) report('rail-rendered', { railElement: rail })
			})

			// Nothing attached: the rail reserves no space at all, so the composer keeps
			// exactly the height it has without this plugin.
			const empty = chips.length === 0
			// Which edges fade the chips under their arrow: the same measurement the
			// arrows use, so a fade and an arrow always appear and disappear together.
			// Nothing overflows → no lane → the attribute is absent → full brightness.
			const lane = overflow.start && overflow.end
				? 'both'
				: overflow.start
					? 'start'
					: overflow.end
						? 'end'
						: undefined
			/** One page of the row: a click always uncovers chips that were hidden. */
			const page = (direction) => {
				const row = scrollRef.current
				if (row === null) return
				const step = Math.max(160, row.clientWidth - 96)
				row.scrollBy({ left: direction * step, behavior: 'smooth' })
			}
			const arrow = (direction, hidden) =>
				!hidden
					? null
					: h(
					'button',
					{
						type: 'button',
						className: 'fa-arrow',
						onClick: () => page(direction),
						'data-edge': direction < 0 ? 'start' : 'end',
						'aria-label': direction < 0 ? '向前查看附件' : '向后查看附件',
						title: direction < 0 ? '向前查看附件' : '向后查看附件',
					},
					h(Glyph, { path: direction < 0 ? ICON_CHEVRON_LEFT : ICON_CHEVRON, size: 15 }),
				)
			return h(
				'div',
				{
					className: 'fa-rail',
					'data-file-attach-rail': sessionId,
					'data-empty': empty ? 'true' : 'false',
					'data-dragging': dragging ? 'true' : 'false',
					ref: railRef,
				},
				empty
					? h('div', { className: 'fa-emptyHint' }, '松开即可把文件放进输入框')
					: [
							arrow(-1, overflow.start),
							h(
								'div',
								{ className: 'fa-scroll', ref: scrollRef, 'data-mask': lane },
								...chips.map((item) =>
									h(AttachmentCard, {
										key: item.id,
										item,
										onPreview: setPreview,
										onRemove: (target) => (target.imageId === undefined
											? removeItem(sessionId, target)
											: removeDraftImage(ctx, inputFor(ctx, sessionId), target)),
										onPick: (target, path) => commitResolved(target, path),
										onRetry: (target) => retryItem(ctx, sessionId, target),
									}),
								),
							),
							arrow(1, overflow.end),
						],
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
			sub.textContent = '文件会变成输入框里的附件卡片，发送时展开成 @ 引用交给模型'
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
			report('apply', { version: 'client-2026-09-16-i' })
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
				setDragLiveness(true)
				clearTimeout(watchdog)
				watchdog = setTimeout(hideOverlay, DRAG_IDLE_MS)
			}
			/** Hide the invitation and stop the liveness watchdog. */
			const hideOverlay = () => {
				clearTimeout(watchdog)
				watchdog = undefined
				maskSweeper.stop()
				overlay.setActive(false)
				setDragLiveness(false)
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
			 * Drag handling: this plugin owns the drop; the platform's drop target is
			 * stopped and re-implemented here.
			 *
			 * The platform's own target (`dsh-client-ui-attachment`) needs its
			 * `dragActive` flag, a `canAcceptDrop` snapshot and its media admission to
			 * agree before it takes a drop, and its admission has no fallback for the
			 * empty `file.type` a file manager drag arrives with. Its listener sits in
			 * the bubble phase, so one capture-phase `stopImmediatePropagation` here
			 * owns every drop; the files then travel the same two routes the platform
			 * uses — its draft-image registry for pictures, this plugin's path cards
			 * for everything else.
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
				if (!hasFiles(event)) {
					// Worth a line in the report: a drag that carries no `Files` type is
					// invisible from the user's side, and this is where it shows up.
					report('drop-ignored', { types: [...(event.dataTransfer?.types ?? [])] })
					return
				}
				// The drop belongs to this plugin alone. Letting the platform's target
				// also react would attach the same picture twice, and there is no way to
				// observe what it took (its listener runs in the same task), so the
				// decision is made here instead: stop its handler, then make the same
				// `createDraftImages` + `addImages(ids)` pair it would have made.
				event.preventDefault()
				event.stopImmediatePropagation()
				hideOverlay()
				const active = currentSession(ctx)
				const files = filesOf(event.dataTransfer)
				report('drop', {
					hasSession: active !== undefined,
					fileCount: files.length,
					declaredImageCount: files.filter((file) => imageFileFor(file) !== undefined).length,
					types: files.map((file) => `${file.name === '' ? '(unnamed)' : file.name}:${file.type || '(no type)'}`),
				})
				if (active === undefined) return
				if (files.length === 0) return
				void admitFiles(ctx, active.sessionId, active.input, files, {
					hints: event.dataTransfer === null ? [] : pathHints(event.dataTransfer),
				}).then(
					(admitted) => report('drop-admitted', admitted),
					(error) => {
						report('admit-failed', { message: error instanceof Error ? error.message : String(error) })
					},
				)
			}
			/**
			 * Paste handling: this plugin owns a paste only when it can carry it.
			 *
			 * The composer's own paste route is Lexical's PASTE_COMMAND, which already
			 * hands clipboard files to the image pipeline. This listener runs in the
			 * capture phase, i.e. before that one, and stopping the event is the only
			 * way to keep a picture from being attached twice — but stopping it and
			 * then failing to attach anything is what made a pasted screenshot do
			 * nothing at all. So the event is only swallowed once there is a session
			 * to attach to, and every failure past that point is spoken out loud.
			 */
			const onPaste = (event) => {
				const clipboard = event.clipboardData
				if (clipboard === null || clipboard === undefined) return
				const files = [...clipboard.items]
					.filter((item) => item.kind === 'file')
					.map((item) => item.getAsFile())
					.filter((file) => file !== null)
				if (files.length === 0) {
					// A clipboard that carries a picture without offering it as a file is
					// the one shape this plugin cannot take; name it rather than letting
					// the paste disappear without a trace.
					const items = [...clipboard.items].map((item) => `${item.kind}:${item.type}`)
					if (items.length > 0) report('paste-no-files', { items })
					return
				}
				const active = currentSession(ctx)
				report('paste', {
					hasSession: active !== undefined,
					fileCount: files.length,
					types: files.map((file) => `${file.name === '' ? '(unnamed)' : file.name}:${file.type || '(no type)'}`),
				})
				// No composer to attach to: leave the paste to the platform rather than
				// eating it.
				if (active === undefined) return
				event.preventDefault()
				event.stopPropagation()
				// A clipboard sometimes carries the file's own URL or path as text — the
				// same hint an Explorer drag gives — so a paste can skip the name search
				// entirely and land on the exact file the user copied.
				void admitFiles(ctx, active.sessionId, active.input, files, {
					paste: true,
					hints: pathHints(clipboard),
				}).catch((error) => {
					report('admit-failed', { message: error instanceof Error ? error.message : String(error) })
				})
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
