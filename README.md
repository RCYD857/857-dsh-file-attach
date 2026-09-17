# dsh-file-attach

**Drop or paste anything into the DSH Web composer — a file or a screenshot — and it appears as a chip
*inside* the input box, the form Doubao's composer uses: one scrolling row of compact chips (badge,
name, state) with a page arrow floating over whichever end still hides one, and a remove badge on every
chip's top-right corner.** The text box itself never receives a path; when you send, each file chip is
expanded into a real `@path` reference the model opens with its tools, while pictures keep going to the
model as pictures.

[中文说明](#中文说明) · [Behaviour](#behaviour) · [Install](#install) · [How files reach the model](#how-files-reach-the-model) · [The chip row](#the-chip-row) · [Limitations](#limitations) · [Design notes](#design-notes) · [Development](#development)

## Behaviour

| You do | You get |
| --- | --- |
| Drag a file anywhere on the page | a full-screen hint; on release a chip appears in the input box, above the text |
| Paste a file into the input | the same |
| Drag or paste a picture | it enters the platform's image pipeline — which is what sends it as a picture — and is drawn as a chip in this same row |
| Read what you attached | the chip: badge, name, `ext · size` (or the step it is on) |
| Click **×** on a chip | the chip fades out, and is not sent |
| Click a chip | preview panel — full image, the first 200 KiB of text or code, file metadata otherwise |
| Attach more files than fit | the row scrolls one page at a time; an end that still hides a chip shows a floating arrow, and the chip caught under it fades into the card |
| Send | every ready chip is expanded into the prompt as its `@path` |
| A file whose path must be found first | its chip shows `正在定位…` → `正在上传…`, then becomes ready |
| Drag a folder | it resolves to the folder's own path and the prompt carries `@folder/` — the model lists and reads inside it. A folder that lives outside every search root says so and suggests dragging the files inside instead |
| A name that exists twice with different bytes | the chip asks which one before it can be sent |
| Click **附加失败，重新试一次** on a failed chip | the locate/stage step runs again |
| Press Enter while a chip is still resolving or waiting on a pick | the notice names that attachment and says why, and the chip stays |

Up to **20 attachments per message**.

A pasted picture is handed to the platform the way the platform itself would hand it over, so a
screenshot from WeChat, Snipping Tool or anything else that copies a bitmap arrives as an ordinary
image attachment. The media type comes from the file, then from its extension, then from its first
bytes — a picture that describes itself as nothing at all still lands as a picture, and one that
never arrives as a file is named in the diagnostics instead of vanishing.

## Install

```sh
dsh plugin --profile web add github:RCYD857/857-dsh-file-attach
```

The package has no build step, so no `allowBuilds` approval is needed. Restart DSH afterwards and
hard-refresh the page. To remove it: `dsh plugin --profile web remove dsh-file-attach`.

For local development, link the source directory instead:

```sh
dsh plugin --profile web add link:/path/to/dsh-file-attach
```

Requires a DSH profile with the Web client (`--profile web`). Developed and verified on DSH Desktop
for Windows.

## How files reach the model

DSH gives plugins no general-purpose file attachment channel — only images. So the plugin splits the
work:

- **Images** (`image/*`) go through the platform's existing image pipeline and are sent as visual
  input. The door is the platform's own: `conversation.createDraftImages(files)` validates the media
  type and registers each file, and the session facade's `addImages(ids)` takes the **ids** it
  returns. Handing that facade the files themselves attaches nothing — its draft registry never
  issued those values, and the composer's own reconciliation pass drops them on the next render.
- **Every other file** becomes a card inside the input, and at send time the wrapped
  `conversation.sendSession` expands it into `@path` (quoted as `@"path"` when it contains spaces) —
  one choke point every submission passes through, image-only sends included. Nothing is written into
  the draft: the text box stays exactly what you typed, and a failed send keeps its cards so
  resending carries them again.

Already-sent messages need no extra work: `projectUserText` renders `@path` as a file-reference chip,
so the file reads as a reference in the transcript too.

## Where the path comes from (three layers, most faithful first)

1. **The drag payload's own path.** Explorer attaches `text/uri-list`, which is the user's original
   file location. Nothing is copied.
2. **The content fingerprint of a pasted file.** A file copied in Explorer and pasted into the composer
   arrives with no path at all — only a name and its bytes. Those bytes are the original's bytes, so the
   browser sends their SHA-256 (up to 64 MiB) with the locate request, and the host resolves a
   same-name crowd by that: **the copy that hashes to what the user handed over *is* the file they
   copied**, wherever they copied it from, and the picker is never shown. A fingerprint that matches
   nothing, or is missing because the file was too big to hash, falls back to the rules below.
3. **A bounded name search on the host** — `POST /file-attach/locate`. Search roots, in order: the
   current workspace → other workspaces → inbox-style directories directly under each workspace
   (`inbox`, `input`, `inputs`, `drops`) → `Desktop`, `Documents`, `Downloads` → directories that
   produced a hit before (remembered in `<DSH_HOME>/file-attach-roots.json`, at most 24 of them).
   The walk matches **folders as well as files**: a folder dragged out of Explorer carries no path
   either, so matching only files is what produced the dead end "a folder cannot be attached: the
   machine never gave its original path" — for a folder sitting on the Desktop. A folder that resolves
   becomes `@folder/`, which the model lists and reads inside.
   Each root is walked breadth-first with a depth limit of 5 and 20,000 entries visited, a 3 s budget
   for the search as a whole, and at most 20 candidates. Same-name candidates are narrowed by byte
   size, then by the fingerprint of what the user handed over, then by content among themselves:
   copies holding identical bytes resolve themselves (the one inside the session's workspace wins, so
   the model gets a path it can open), and only genuinely different files with no matching fingerprint
   make the card offer a picker. A card that is still unresolved when you send is named in the prompt's
   notice — see [Nothing is dropped in silence](#nothing-is-dropped-in-silence).
4. **A staged copy** — `POST /file-attach/stage`. The browser uploads the bytes and the host writes
   them to `<workspace>/.dsh-attachments/<name>`. This is the fallback that makes dropping always
   work: a browser is not obliged to reveal where a dropped file came from (Electron's drag payload
   usually reveals nothing at all), and the bytes are what the model ultimately needs.

The staging directory ships its own `.gitignore` (contents: `*`), so copies never enter version
control. The per-file cap is 256 MiB, and names are sanitized against traversal and illegal
characters. A card tagged as a copy took this layer; the whole `.dsh-attachments` directory can be
deleted at any time without touching the originals.

**Reuse is decided by bytes alone, across every same-named copy** (`name`, `name-2`, `name-3`, …).
Two earlier rules were wrong and were replaced: comparing size only served stale content after an
equal-length edit, and checking only the first candidate (`name`) never matched a copy that had
landed in `name-2`, so every drop created yet another file. Bytes are the only thing that identifies
a file: **a same-named file with different content always lands in a new copy (`name-2.ext`) and is
never silently overwritten; only byte-identical content is reused.**

### Nothing is dropped in silence

Only a resolved card has a path to expand, so a file that is still locating, still staging, or waiting
on a pick contributes nothing to the prompt. That used to happen without a word: a user
attached a `.yml` that happened to exist in two places under the same name and the same size, the
host answered `choose`, the card sat in the strip looking attached exactly like a resolved one, and
the message went out carrying only the text. **The bug was the silence, not the pick.**

Three things changed, at the layer each belongs to:

- **The host decides when the answer cannot matter.** Same-name candidates are compared byte for
  byte (bounded to 8 candidates and 4 MiB each, so a drop can never stall on it). If every candidate
  holds the same bytes, the question is answered rather than asked. Past either bound the answer is
  "not proven identical", which keeps the picker instead of guessing.
- **The card stops looking ready.** A card awaiting a pick shows `同名文件有 2 个，请先选择` where a
  resolved card shows `yml · 502 B`, so the state is legible without clicking anything.
- **The send reports what it left behind.** The send boundary names every unresolved card — the file,
  why it could not ride, and what to do — and keeps the card, so the next attempt carries it.

Recorded in the suites: `check-host.mjs` pins identical-versus-different resolution (including the
comparison ceiling falling back to the picker), `check-client.mjs` pins that an unresolved card adds
no mention, raises the notice, and survives the send, and `check-spec.mjs` pins the card copy.

## The chip row

- **Where they are** — in the composer card's own top area, the same place the platform's image rail
  lives, pushing the text row down. The rail is mounted in the card-internal slot anchor, a
  zero-height absolute box at the card's top edge, so the room the tiles take is claimed by the card's
  own `padding-top`: the rail measures itself (`offsetHeight`, which includes its padding) and writes
  that height straight onto the card's **inline** `padding-top` — inline because a stylesheet rule was
  tried first and lost to the platform's own padding (the report file from a real DSH showed the card
  keeping its 8px while a tile sat on top of it). With nothing attached the inline value is restored to
  what the card had before and the composer is exactly as tall as it is without this plugin.
- **Layout** — one row, 8 px between chips, 12 px side padding, 244 px chips, scrolled by the arrow at
  each end (one page per click) rather than wrapped. The arrows **float over** the chips and exist only
  while that end still hides one: a row that fits shows neither, a row at its left end shows only the
  right one. They take no layout space, so the first and last chip sit flush with the row, and the chip
  caught underneath one **fades into the card** rather than being cut off — a CSS mask on the scroller
  (54 px per hidden edge), driven by the same measurement as the arrows, so the two always appear and
  disappear together and the arrow itself stays fully opaque above the fade.
- **Pictures ride along** — a picture still goes through the platform's image pipeline (that is what
  makes it visual input), but it is drawn as a chip in this row instead of in the platform's own
  thumbnail row, which sits in the very same place and is hidden by one stylesheet rule. Its badge is
  the picture itself; its × releases the platform's registry entry and drops the draft id, exactly like
  the composer's own ×.
- **Chip** — 12 px radius, `1px rgb(0 0 0 / 6%)` border, `#f5f5f7` surface, hover `#ebecef`. On the
  left a 34 px badge (the picture itself for a picture, the file family's glyph otherwise), on the
  right two lines: the name at 13.5 px `#1d1d1f` (ellipsised) and the state at 11.5 px `#86868b`.
- **Remove** — a 20 px dark circle on the chip's top-right corner, always visible; the row's vertical
  padding is what keeps it from being clipped.
- **States** — a pending chip spins in its badge and names the step it is on (`正在定位… · 2.0 KB`,
  `正在上传… · 1.5 MB`); a failure turns border, surface and text red (`#ffccc7` / `#fff1f0` /
  `#d4380d`) and offers `附加失败，重新试一次` under the name; a same-name pick puts the question there
  and a picker under it. Drag hover outlines the row in `#1677ff`.

## Diagnostics

The desktop shell has no developer tools, so the browser half reports measured facts back through
`POST /file-attach/report` into `<DSH_HOME>/file-attach-report.json`, appended by checkpoint
(`apply` → `slot-probe` → `slot-registered` → `slot-component` → `rail-mounted` → `rail-rendered` →
`strip-geometry` → `drop` → `drop-admitted`, plus `paste`, `paste-no-files` and `drop-ignored` for the
cases that never reach a card) and including the rail's measured box against the composer card, the
card's computed `padding-top` and the number of tiles. `node read-report.mjs` prints it.

Reports are written from `useEffect`, never during render — writing module state while rendering
trips React's re-render protection.

The same route doubles as the quickest liveness check on a running host: a registered route answers
`GET` with `405`, while a host that never loaded the plugin answers `404`.

## Limitations

- **The text area and the bottom action bar belong to DSH.** The cards sit in the card's top area but
  they are this plugin's own markup; styling, placeholder and send button remain the platform's.
- **Making room means setting one property on the platform's card.** The rail is absolute inside the
  card's zero-height anchor, so it writes the measured height onto `[data-composer-card]`'s inline
  `padding-top` (and restores the value it found when it empties). That is the one place this plugin
  writes to an element it does not own; it is inline rather than a stylesheet rule because the
  platform — or another composer-restyling plugin — can hold a rule of the same specificity, and the
  measured 8px on the card is what a stylesheet rule lost to.
- **The platform's image thumbnail row is hidden by one stylesheet rule** (a suffix match on its
  CSS-module class, scoped to the attachments slot). The platform still owns the pictures' bytes,
  previews and vision payload — the plugin only draws their chips in the same row as the files. If the
  platform renames that class the rule stops matching and pictures show up twice (once in this row, once
  in its own) until the selector is updated.
- The rail is anchored to the `conversation.input.overlay` slot and the send expansion hooks
  `conversation.sendSession`. A change to either in DSH's client UI needs a matching update here.
- On Windows, Explorer does not reliably send `dragleave` when a drag ends, so overlay visibility is
  driven by a `dragover` heartbeat (hidden after 320 ms of silence) rather than by
  `dragenter`/`dragleave` counting.

## Design notes

Things that were tried and abandoned, recorded so they are not tried again:

- **Not in the document flow.** Registering the rail in `composer.dock` with `order: -1` and a negative
  margin did push the conversation upward, but it moved the input card with it, and the pull-back
  amount was wrong in every variant. The rail belongs *inside* the card, where the platform puts its
  own attachments, not above it.
- **Not a second panel.** An earlier form floated a white panel with its own shadow above the card
  (`bottom: 100%`), and before that `translateY(100%)` plus a shared background tried to merge the two
  into one form, which changed the platform card's appearance and was reverted. The cards are now
  chrome-less tiles laid directly on the card's own surface, so there is nothing to merge.
- **The card's growth is measured, not guessed.** The rail sits in a zero-height absolute anchor, so
  the only way its height can push the text row down is through the card's own padding. That value is
  published by the rail (`--fa-card-tiles`, with a marker attribute scoping the rule) and re-measured by
  a `ResizeObserver`, because tiles re-wrap, names re-ellipsise and thumbnails decode after the first
  paint. Removing the marker on empty is what keeps an unused composer exactly its normal height.
- **The slot component cannot rely on a `session` prop.** `conversation.input.overlay` renders its
  components without one (only `composer.dock` passes `session`), so the rail reads the current
  session from the store (`ctx.sessions.list.getSnapshot().current`). Judging by the prop makes the
  strip return `null` forever — the symptom is "I dropped a file and no attachment box appeared".
- **Big tiles were tried; the row is the wanted form.** A revision drew Codex-style tiles (a 118 px
  glyph area over the name, wrapping into a grid, the card growing with every row). It is a faithful
  copy of that form, and it was rejected on sight: with seven files it fills the composer. The row —
  chips, two arrows, one page per click — keeps the input box its own size, which is what the user
  asked for after pointing at Doubao's composer.
- **The drop outline follows the heartbeat, never the drag events.** The rail first drew its dashed
  border from its own `dragenter`/`dragleave` pairs, and on Windows a drag that ends without ever
  delivering `dragleave` left the border stuck on screen. It now reads the same `dragover` heartbeat the
  full-screen invitation already uses (`DRAG_IDLE_MS` of silence retires both).
- **Pictures were folded into the row, not left beside it.** The platform draws draft pictures in
  `conversation.input.attachments` — a *single* slot in the same place this rail occupies — so there was
  no way to add file chips to that row; the row had to become this plugin's, and the platform's own
  thumbnail strip is hidden behind it. The alternative (a second row of thumbnails under the chips) is
  what the user rejected, and a picture's chip still keeps the platform's pipeline, preview URL and
  removal path untouched.
- **Media types are filled in from the extension.** The platform's image pipeline accepts only
  `png`/`jpeg`/`webp`/`gif` and has no extension fallback, while a file dragged out of Explorer
  frequently arrives with an empty `file.type` (a paste carries a type, so pasting always worked). An
  empty type throws `UnsupportedImageMediaTypeError`, which aborts the entire drop handler — and it
  does so silently, so the visible symptom was "images cannot be dropped". Formats that cannot be
  mapped (such as `tif`) fall back to a path card, which at least gives feedback. Sniffing the file
  header instead of trusting the extension is the next step here: exported images sometimes carry
  JPEG bytes under a `.png` name.
- **The plugin owns the drop.** The platform's own image drop target needs `dragActive`, a
  `canAcceptDrop` snapshot and media admission to hold at once, and whether it received a drop at all
  is not observable from the same task. The plugin therefore takes the drop with
  `stopImmediatePropagation` and then issues the exact same image intake the platform would have made
  — same pipeline, triggered from a place that actually fires.
- **`addImages` takes draft ids, not files.** The session facade's `addImages(ids)` links ids the
  composer's draft-image registry already owns; the files go to `conversation.createDraftImages`,
  which validates their media type and returns the ids. Calling `addImages(files)` instead pushed
  values no registry had ever issued: `draftImages(ids)` resolved them to nothing, the composer's
  reconcile pass dropped them one render later, and the visible result was a pasted screenshot that
  produced no thumbnail, no card and no error. The paste made it worse than a no-op — this plugin
  listens in the capture phase and had already `preventDefault`-ed the event, so Lexical's own
  `PASTE_COMMAND` (which would have attached the picture correctly) never ran. Pictures now travel
  `createDraftImages` → `addImages(ids)`; a paste is swallowed only once there is a session to
  attach to; and every refusal past that point is spoken out loud. The old `check-client.mjs` fake
  blessed the wrong contract — it let `addImages` take files — which is exactly why the suite stayed
  green while the app stayed silent; the fake now models the registry.
- **An inline `@` chip was tried and is not what was asked for.** Reading "make it like Codex" as
  "insert the file into the text", an earlier revision inserted the platform's own atomic reference
  chip at the caret through the scoped `slash/input-insert-reference` event. That worked, and is
  recorded here because it is a reasonable thing to want and would be easy to rebuild — but the form
  the user pointed at is the one in the picture: *cards in the input box*, with the text left alone.
  So the chips are gone, and the card is once again the only surface a file has.
- **The platform's drag overlay is removed, not restyled.** It labelled every file "drop an image
  here", counted `dragenter`/`dragleave` in a way that never balances on Windows (so it stuck on
  screen), and only accepted a drop that landed on the input card. A `MutationObserver` with
  `subtree: true` removes any element whose class contains `_mask` while a file drag is in progress,
  with a CSS rule as a fallback. Since the plugin handles file drags itself, the overlay has nothing
  left to do.
- **Slot registration is probed, not assumed.** The slot is checked with `ctx.slots.spec` and the
  registration is wrapped in `try`/`catch`, so a host without that slot cannot take the drag
  listeners down with it.

## Development

```sh
npm run check            # four suites: browser half / host routes / visual spec / rail rendering
node probe-locate.mjs "<workspace root>" --name <filename>   # timing and hits of the locator
```

All four suites run under plain Node — no DSH and no browser. The visual spec suite asserts the
strip's geometry, colours, spacing and the arrow/overflow relationship one rule at a time; the rail
render probe mounts the real component through a minimal hook engine and fails on any throw.

Editing `lib/client.js` or `lib/index.js` requires a DSH restart before either half picks up the new
code (the client's HMR only runs under `dev:web`), followed by a hard refresh of the page.

| File | Responsibility |
| --- | --- |
| `lib/index.js` | host half: `/file-attach/locate` bounded name search, `/file-attach/stage` copy staging, `/file-attach/report` diagnostics |
| `lib/client.js` | browser half: attachment state, the card strip, the preview panel, drag/paste capture, send-time expansion |
| `cordis.patch.yml` | bundle patch layer that mounts the host half into a profile |
| `check-client.mjs` | admission and routing, the draft staying untouched, send-time expansion, staging fallback, retry, overlay liveness, layout contract |
| `check-host.mjs` | host routes and staging boundaries, including traversal, name conflicts and the size cap |
| `check-spec.mjs` | the visual spec assertions listed above |
| `probe-rail-render.mjs` | renders the strip without a browser and asserts no throw and image cards present |
| `probe-locate.mjs` | locator hits and timing against a real directory |
| `read-report.mjs` | prints the layout and lifecycle checkpoints written back by the browser |

## License

MIT — see [LICENSE](LICENSE).

---

## 中文说明

**把任意东西——文件或截图——拖进/粘进 DSH Web 输入框，它都会变成输入框**内部**的一枚标签，就是豆包那种形式：一行紧凑的标签条（图标 + 文件名 + 状态），哪一侧还有藏着的标签哪一侧才浮出一个翻页箭头，每枚标签右上角是删除按钮。** 文本框本身永远不收路径：发送时文件标签展开成 `@路径` 引用交给模型用自己的工具打开，图片则照旧作为图片送给模型。

[English](#dsh-file-attach) · [行为](#行为) · [安装](#安装) · [文件怎么到模型手里](#文件怎么到模型手里) · [标签条](#标签条) · [限制](#限制) · [设计取舍](#设计取舍) · [开发](#开发)

### 行为

| 操作 | 结果 |
| --- | --- |
| 把文件拖到页面任意位置 | 全屏提示；松手后输入框里、文字上方出现一枚标签 |
| 在输入框里粘贴文件 | 同上 |
| 拖/粘图片 | 走平台的图片管线（那是它作为图片被送给模型的原因），并**以标签的形式画在同一行里** |
| 看自己附了什么 | 就是标签本身：文件图标、文件名、`后缀 · 大小`（或它当前在哪一步） |
| 点标签上的 × | 标签淡出移除，本次不发送 |
| 点标签 | 打开预览：图片显示原图，文本/代码显示开头 200 KiB，其他格式显示文件信息 |
| 附件多到一行放不下 | 标签条横向滚动、一次翻一屏；只有**还藏着标签的那一侧**才浮出箭头，被箭头压住的那枚标签会渐隐进卡片 |
| 发送 | 每枚就绪的标签展开成自己的 `@路径` 写进提示词 |
| 需要先找路径的文件 | 标签上显示 `正在定位…` → `正在上传…`，解析完就变就绪 |
| 拖入一个文件夹 | 解析成文件夹自己的路径，提示词里带 `@文件夹/`，模型可以列目录、读里面的文件；如果这个文件夹不在任何搜索根下，标签会直说，并建议把里面的文件拖进来 |
| 同名文件内容确实不同 | 标签会先问你要哪一个，选完才能发 |
| 失败标签上点「附加失败，重新试一次」 | 重新走一遍定位/暂存 |
| 标签还在处理中或等着你选路径时回车 | 提示会点名这个文件和原因，标签保留 |

一条消息最多 **20 个附件**。

粘贴进来的图片按平台自己的方式交给平台，所以用微信截图、系统截图工具或任何「复制位图」的方式拿到的截图，都会作为普通图片附件进来。图片来源的判定顺序是：文件自带的类型 → 扩展名 → 文件头字节——一个不说明自己是什么的图片仍然会当图片处理，而一个根本没以文件形式出现的图片会在诊断里被点名，而不是无声消失。

### 安装

```sh
dsh plugin --profile web add github:RCYD857/857-dsh-file-attach
```

这个包没有构建步骤，因此不需要 `allowBuilds` 构建授权。装完重启 DSH，再硬刷新页面。卸载：`dsh plugin --profile web remove dsh-file-attach`。

本地开发可以直接 link 源码目录：

```sh
dsh plugin --profile web add link:/path/to/dsh-file-attach
```

需要一个带 Web 客户端的 DSH profile（`--profile web`）。本项目在 DSH Desktop（Windows）上开发与验证，对应的平台版本见 release notes。

### 文件怎么到模型手里

DSH 没有给插件通用的文件附件通道，只有图片通道。所以这里做了分流：

- **图片**（`image/*`）走平台既有的图片管线，作为视觉输入发给模型。走的门也是平台自己的门：`conversation.createDraftImages(files)` 负责校验媒体类型并登记文件，会话门面的 `addImages(ids)` 只接受它返回的 **id**。把文件本身交给那个门面等于什么都没附加——草稿图片注册表从没发过这些值，下一次渲染时就被平台自己的对账逻辑清掉了。
- **其余文件**变成输入框里的一张卡片，发送时由被包装的 `conversation.sendSession` 展开成 `@路径`（含空格时用 `@"路径"`）——每个提交都必经的唯一漏斗，图片-only 发送也走它。**不往草稿里写任何东西**：文本框里始终只有你打的字；发送失败时卡片原样保留，重发即可带上。

已发送的消息不需要额外处理：`projectUserText` 会把 `@路径` 渲染成带文件图标的引用标签，所以文件在对话里读起来就是一个引用。

### 路径从哪里来（三层，越靠前越保真）

1. **拖拽载荷自带的路径。** 资源管理器会附 `text/uri-list`，直接就是用户原始文件的位置，不复制任何东西。
2. **粘贴文件的内容指纹。** 在资源管理器里复制文件再粘进输入框，浏览器**不会**给出路径，只有文件名和字节。而这些字节就是原件的字节，所以浏览器会把它们的 SHA-256（上限 64 MiB）随定位请求一起送过去；宿主用它在同名候选里认领：**谁的哈希等于用户递过来的那份，谁就是他从那儿复制来的那个文件**，选择框根本不会出现。指纹对不上、或文件太大没算指纹时，才落到下面的规则。
3. **宿主侧的有界名字搜索** —— `POST /file-attach/locate`。搜索根依次为：当前工作区 → 其他工作区 → 各工作区下形如 `inbox`/`input`/`inputs`/`drops` 的收件目录 → `Desktop`/`Documents`/`Downloads` → 以前出过命中结果的目录（记在 `<DSH_HOME>/file-attach-roots.json`，最多 24 个）。每个根做广度优先遍历：深度上限 5、访问条目上限 20000；整个搜索的时间预算是 3 秒，候选上限 20 个。这一遍**把文件夹也当候选**：从资源管理器拖出来的文件夹同样不带路径，只按文件匹配就会出现「文件夹无法附加」的死胡同（哪怕它就躺在桌面上）。解析到的文件夹会变成 `@文件夹/`，模型可以列目录、读里面的文件。同名候选先按字节大小收窄，再按指纹认领，最后才互相比较内容：字节完全相同的副本会自动选定（优先工作区里的那份，模型拿到的是它能直接打开的路径），只有内容确实不同、指纹也没对上时，才让卡片弹出选择框。发送时仍未处理完的卡片会在提示里被点名，见 [不会静默丢弃](#不会静默丢弃)。
4. **宿主暂存副本** —— `POST /file-attach/stage`。浏览器把文件字节交上来，宿主写进 `<工作区>/.dsh-attachments/<文件名>`。这是让拖拽**永远可用**的兜底：浏览器不保证透露拖入文件的来源（Electron 的拖拽载荷通常什么都不给），而文件内容本来就是模型最终要读的东西。

暂存目录自带 `.gitignore`（内容 `*`），副本不会进版本控制。单文件上限 256 MiB，文件名做了穿越与非法字符清洗。卡片上带「副本」标记的表示走了这一层；整个 `.dsh-attachments` 随时可以删掉，不影响原件。

**复用只按字节判定，并且扫描所有同名副本**（`name`、`name-2`、`name-3`…）。此前两条规则都是错的，已经被替换掉：只比文件大小，会在用户做出等长修改后让模型读到旧内容；只比第一个候选路径（`name`），一旦变更后的副本落在 `name-2` 就永远匹配不上，于是每次拖入都新建一份。字节是唯一能真正标识一个文件的东西：**同名不同内容一定落新副本（`name-2.ext`），绝不静默覆盖；只有字节完全相同才复用。**

### 不会静默丢弃

只有已经解析出路径的卡片才有路径可展开，所以还在定位、还在暂存、或者等着你选路径的文件对这次提示词没有任何贡献。**这件事以前是无声发生的**：用户附了一个 `.yml`，它恰好在两个地方各有一份、同名同大小，宿主回了 `choose`，卡片留在那里——外观和已就绪的卡片一模一样——于是消息只带着正文发了出去。**缺陷是"没说"，不是"要选"。**

三处各修一层：

- **宿主把"选了也没差别"的情况直接定下来。** 同名候选逐字节比较（上限 8 个候选、每个 4 MiB，拖拽因此永远不会被它拖住）。全部候选字节相同就直接给出结果，不再提问；超过任一上限就判定为"无法证明相同"，仍然保留选择框，而不是猜一个。
- **卡片不再伪装成就绪。** 待选择的卡片副标题显示 `同名文件有 2 个，请先选择`，而已就绪的显示 `yml · 502 B`——不用点开任何东西就能看出状态。
- **发送时点名没跟上的附件。** 发送边界会列出每一张未就绪的卡片：哪个文件、为什么没跟上、该怎么办，并且保留卡片，下一次发送就能带上。

自检里都有对应的钉子：`check-host.mjs` 钉住"相同则自动定、不同则仍要问"（含超限回落为提问）；`check-client.mjs` 钉住未就绪卡片不产生引用、会发出提示、且发送后仍然存在；`check-spec.mjs` 钉住卡片文案。

### 标签条

- **位置** —— 在输入卡片自己的顶部区域，也就是平台图片缩略图栏所在的位置，把文字行往下让。轨道挂在卡片内部的槽位锚点上（那是一块零高度、绝对定位在卡片上沿的盒子），所以卡片占用的空间由卡片自己的 `padding-top` 让出来：轨道测量自己（`offsetHeight`，已含内边距）并把测到的高度直接写成卡片的**内联** `padding-top`——用内联是因为样式规则那一版在真实 DSH 里输了（诊断报告显示卡片始终是它自己的 8px，卡片上却压着内容）。没有附件时把内联值还原成它原本的值，输入框的高度与没装插件时一致。
- **排布** —— 只有一行：标签间距 8 px、两侧内边距 12 px、单枚宽 244 px；放不下时横向滚动，由箭头翻页（一次一屏），不换行、不叫输入框变高。箭头**浮在标签上面**，而且只在那一侧确实还藏着标签时才存在：一行放得下就一个箭头都没有，滚到最左就只剩右边的箭头。它们不占布局，所以第一枚和最后一枚标签是贴着边缘的；被箭头压住的那枚标签**渐隐进卡片底色**（滚动容器上的 CSS 遮罩，每个藏着标签的边 54 px），遮罩与箭头用同一次测量驱动，因此永远同时出现/消失，而箭头本身保持完全不透明。
- **图片也在同一行** —— 图片依旧走平台的图片管线（那是它作为图片被送给模型的原因），但不再画在平台自己的缩略图栏里，而是和文件一起画在这一行；那条缩略图栏就在同一个位置，被一条样式规则隐藏。图片标签的图标块直接显示这张图，它的 × 走平台自己的两步：释放注册表条目 + 从草稿里去掉 id。
- **标签** —— 圆角 12 px、`1px rgb(0 0 0 / 6%)` 描边、底色 `#f5f5f7`、悬停 `#ebecef`。左侧 34 px 图标块（图片直接显示图片，其余显示文件族图标），右侧两行：13.5 px `#1d1d1f` 文件名（超宽省略号）+ 11.5 px `#86868b` 状态行。
- **移除** —— 标签右上角 20 px 的深色圆形按钮，**常显**；标签条自己的上下内边距就是留给它不被裁掉的空间。
- **状态** —— 排队中：图标块转圈，状态行写清在哪一步（`正在定位… · 2.0 KB`、`正在上传… · 1.5 MB`）；失败：描边、底色与文字变红（`#ffccc7` / `#fff1f0` / `#d4380d`），名字下面出现「附加失败，重新试一次」；同名待选择：状态行换成那句提问，下面给出选择框。拖拽悬停时整行描边变 `#1677ff`。
- **图标配色** —— 文档 `#1677ff`、代码 `#00a870`、压缩包 `#d48806`、PDF/表格/演示 `#d4380d`

### 诊断

桌面壳没有开发者工具，所以浏览器半边把实测到的事实经 `POST /file-attach/report` 写进 `<DSH_HOME>/file-attach-report.json`，按检查点累积（`apply` → `slot-probe` → `slot-registered` → `slot-component` → `rail-mounted` → `rail-rendered` → `strip-geometry` → `drop` → `drop-admitted`），内容包括轨道相对输入卡片的实测盒子、卡片计算后的 `padding-top` 与卡片数量，用 `node read-report.mjs` 打印。

`drop` 之后还有 `drop-admitted`；另外 `paste`、`paste-no-files`、`drop-ignored` 三个检查点专门记录那些连卡片都没走到的情形。

上报必须写在 `useEffect` 里，绝不能写在渲染期——渲染期写模块状态会触发 React 的重复渲染保护。

这个路由同时是在运行中的宿主上做存活检查最快的方式：已注册的路由对 `GET` 返回 `405`，而从未加载过插件的宿主返回 `404`。

### 限制

- **文字输入区与底部功能栏归 DSH。** 卡片落在卡片顶部区域，但那是本插件自己的标记；样式、占位符、发送按钮仍然是平台的。
- **腾地方意味着在平台卡片上写一个属性。** 轨道在卡片内部那块零高度锚点里是绝对定位，所以它把测到的高度写进 `[data-composer-card]` 的内联 `padding-top`，空了再把原本的值还原回去。这是本插件唯一一处写自己没拥有的元素；之所以用内联而不是样式规则，是因为平台自己（或另一个重绘输入框的插件）可以持有同优先级的规则——诊断里那个 8px 就是样式规则输掉的结果。
- **平台的图片缩略图栏被一条样式规则隐藏**（按 CSS-module 类名后缀匹配，并且限定在 attachments 槽位内）。图片的字节、预览地址、视觉载荷仍然全部归平台，本插件只是把它们的标签画进同一行。平台若改掉那个类名，这条规则会失配，图片会同时出现在这里和它自己那一栏——那时更新选择器即可。
- 轨道挂在 `conversation.input.overlay` 槽位，发送展开挂在 `conversation.sendSession` 上。DSH 客户端 UI 若改动这两处中任何一处，本项目需要同步适配。
- Windows 上资源管理器在拖拽结束时并不保证发 `dragleave`，所以遮罩的显隐由 `dragover` 心跳驱动（静默 320 ms 即隐藏），而不是靠 `dragenter`/`dragleave` 计数。

### 设计取舍

以下是试过又放弃的做法，记在这里以免再走一遍：

- **不放文档流。** 把轨道注册到 `composer.dock` 配合 `order: -1` 与负边距，确实能把对话往上顶，但会**带着输入卡片一起移动**，而且回拉量在每个变体里都算错。附件区应该在卡片**里面**，也就是平台自己放附件的位置，而不是卡片上沿。
- **不做第二块面板。** 早期形态是在卡片上沿再钉一块带阴影的白面板（`bottom: 100%`），更早还试过 `translateY(100%)` + 共用背景把两块并成一块，改变了平台卡片的外观，已回退。现在卡片是无面板的贴片，直接铺在卡片自己的底色上，没有可合并的东西。
- **让卡片变高靠测量，也不能靠样式优先级去赌。** 轨道在零高度绝对定位的锚点里，唯一能把文字行往下推的途径就是卡片自己的内边距。第一版是把高度发布成自定义属性、由一条按标记生效的规则读取——在真实 DSH 里输了：诊断报告显示卡片始终是它自己的 8px（多半是某个重绘输入框的插件用同优先级规则、且样式表排在本插件之后）。现在直接把测到的高度写进卡片的**内联** `padding-top`，并用 `ResizeObserver` 与几帧重试跟上后续变化（铺片重排、文件名重新省略、缩略图首帧之后才解码）。空了就把内联值还原成它原本的值。
- **槽位组件不能依赖 `session` prop。** `conversation.input.overlay` 渲染组件时不传 `session`（只有 `composer.dock` 传），所以轨道统一从 store 读当前会话（`ctx.sessions.list.getSnapshot().current`）。按 prop 判断会让轨道永远返回 `null`，表现就是「拖了文件没有附件框」。
- **ref 必须给真正的滚动元素。** 早期版本把 ref 放在外层容器上、而真正滚动的是内层那一行，结果箭头按钮点了没反应。
- **宽度取自卡片自己的变量。** `left: 0; right: 0; width: 100%; max-width: var(--dsh-composer-card-max-width)` 才能与平台卡片严格对齐；用 `--dsh-composer-side-clearance` 去撑会得到一条对不齐的条。
- **媒体类型按扩展名补全，再按文件头兜底。** 平台的图片管线只接受 `png`/`jpeg`/`webp`/`gif`，且没有扩展名兜底；而资源管理器拖出的文件 `file.type` 常常是空字符串。空类型会抛 `UnsupportedImageMediaTypeError`，它打断整个 drop 处理器——而且是静默的，所以现象只是「图片拖不进来」。现在判定顺序是「自带类型 → 扩展名 → 文件头魔数」：有些工具导出的图片会带着 JPEG 字节却取 `.png` 名字，而微信那种既没有类型、也没有像样文件名的图片，靠文件头仍然会当成图片。终归认不出来的格式（如 `tif`）退回路径卡片，至少有反馈。
- **drop 由本插件独占。** 平台自带的图片拖放目标要求 `dragActive`、`canAcceptDrop` 快照与媒体准入三者同时成立，而「它到底收没收到」在同一个任务里观察不到。所以本插件用 `stopImmediatePropagation` 接管落点，然后走平台自己的两条管线（图片走草稿图片注册表，其余文件走附件卡片 + 发送时展开）——管线没变，只是触发点移到了真正会触发的地方。
- **`addImages` 要的是草稿 id，不是文件。** 会话门面的 `addImages(ids)` 挂上去的是草稿图片注册表已经持有的 id；文件要先交给 `conversation.createDraftImages`，由它校验媒体类型并返回那些 id。原来直接 `addImages(files)` 塞进去的是注册表从没发过的值：`draftImages(ids)` 解析成空，平台自己的对账逻辑下一次渲染就清掉——现象是粘贴截图后**缩略图、卡片、报错全都没有**。粘贴比纯粹的无效更糟：本插件的监听在捕获阶段，已经先 `preventDefault` 了，于是 Lexical 自己的 `PASTE_COMMAND`（本来会正确附加图片的那条路）根本没机会跑。现在图片统一走 `createDraftImages` → `addImages(ids)`；只有在确实有会话可附加时才吞掉粘贴；此后任何一次拒绝都会说出来。旧的 `check-client.mjs` 假环境把错误契约当成正确的（它允许 `addImages` 直接收文件），这正是测试全绿而应用全程沉默的原因；假环境现在按注册表的真实契约建模。
- **试过行内 `@` chip，但那不是要的形态。** 把「做成 Codex 那样」先理解成「把文件插进正文」，于是做过一版：通过作用域事件 `slash/input-insert-reference` 把平台自己的原子引用 chip 插到光标处。那版是能跑的，写在这里是因为它确实是一种合理诉求、也很容易重建——但用户指的形态是图上那种：**卡片在输入框里，正文不动**。所以 chip 那套已经撤掉，文件重新回到「卡片是唯一界面」。
- **拖拽高亮跟着心跳走，绝不数拖拽事件。** 最早这圈虚线是轨道自己数 `dragenter`/`dragleave` 配对画出来的，而 Windows 上拖拽结束时不一定发 `dragleave`，于是虚线圈会一直卡在屏幕上。现在它读的是全屏提示已经在用的同一个 `dragover` 心跳（静默 `DRAG_IDLE_MS` 之后两者一起退场）。
- **图片是并进这一行，而不是留在旁边。** 平台把草稿图片画在 `conversation.input.attachments`——一个**单占**槽位，而且就在本轨道所在的同一个位置，所以「把文件标签加进它那一行」是做不到的；只能是这一行归本插件，再把平台自己的缩略图栏隐藏到它后面。用户否掉的正是另一种做法（标签下面再起一行缩略图），而图片标签仍然完全沿用平台的管线、预览地址与移除路径。
- **平台遮罩是删掉而不是改样式。** 它给任何文件都提示「图片拖动到此处即可添加」，用 Windows 上永远配不平的 `dragenter`/`dragleave` 计数（所以会卡在屏幕上不消失），而且只在落点正好砸中输入卡片时才接收。现在用 `subtree: true` 的 `MutationObserver`，在文件拖拽期间移除所有类名含 `_mask` 的元素，并配一条 CSS 兜底。既然文件拖拽已由本插件接管，它没有剩下的事可做。
- **注册槽位先探测再注册。** 先用 `ctx.slots.spec` 查槽位是否存在，注册包在 `try`/`catch` 里，这样缺少该槽位的宿主不会连带把拖拽监听一起弄挂。

### 开发

```sh
npm run check            # 四套自检：浏览器半边 / 宿主路由 / 视觉规格 / 附件条渲染
node probe-locate.mjs "<工作区根目录>" --name <文件名>   # 定位算法的命中与耗时
```

四套自检都用纯 Node 跑，不需要 DSH、也不需要浏览器。视觉规格那套逐条断言附件条的几何、配色、间距与「箭头 ↔ 留白」的对应关系；渲染探针通过一个最小 hook 引擎真的挂载一次组件，任何抛错都会失败。

改完 `lib/client.js` 或 `lib/index.js` 都需要重启 DSH 才能让浏览器/宿主拿到新代码（客户端 HMR 只在 `dev:web` 下生效），然后硬刷新页面。

| 文件 | 职责 |
| --- | --- |
| `lib/index.js` | 宿主半边：`/file-attach/locate` 有界名字搜索、`/file-attach/stage` 副本暂存、`/file-attach/report` 诊断 |
| `lib/client.js` | 浏览器半边：附件状态、卡片轨道、预览面板、拖拽/粘贴接管、发送时展开 |
| `cordis.patch.yml` | bundle 补丁层，把宿主半边挂进 profile |
| `check-client.mjs` | 准入与分流、草稿不被写、发送时展开、暂存兜底、失败重试、遮罩存活、布局契约 |
| `check-host.mjs` | 宿主路由与暂存边界：路径穿越、同名冲突、体积上限 |
| `check-spec.mjs` | 上面列出的视觉规格断言 |
| `probe-rail-render.mjs` | 无浏览器渲染附件条，断言不抛异常且出现图片卡片 |
| `probe-locate.mjs` | 拿真实目录探测定位算法的命中与耗时 |
| `read-report.mjs` | 打印浏览器写回的布局与生命周期检查点 |

### 许可证

MIT，见 [LICENSE](LICENSE)。
