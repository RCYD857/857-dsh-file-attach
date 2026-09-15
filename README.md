# dsh-file-attach

**Drop or paste any file into the DSH Web composer and it becomes an attachment card above the input:
click it to preview, press × to drop it, and it rides along with your prompt as a file reference when
you send.** The text box never receives a path — what you typed is all that is in it.

[中文说明](#中文说明) · [Behaviour](#behaviour) · [Install](#install) · [How files reach the model](#how-files-reach-the-model) · [The attachment strip](#the-attachment-strip) · [Limitations](#limitations) · [Design notes](#design-notes) · [Development](#development)

## Behaviour

| You do | You get |
| --- | --- |
| Drag a file anywhere on the page | a full-screen hint; on release a card appears above the input |
| Paste a file or a screenshot into the input | the same |
| Drag or paste an image | it also enters the platform's own image attachment pipeline (thumbnail row in the input, click to enlarge) |
| Click a card | preview panel — full image, the first 200 KiB of text or code, file metadata otherwise |
| Click × on a card | the card fades out, and is not sent |
| Click **Retry** on a failed card | the locate/stage step runs again |
| Attach more files than fit | gradient fades and arrow buttons scroll the strip one screen at a time |
| Press Enter | the attached files are expanded into the prompt as references |
| Press Enter while a card is still resolving or waiting on a pick | the notice names that attachment and says why, and the card stays |

Up to **20 attachments per message**. A card shows what it is doing while it resolves:
`preparing` → `locating the original path…` → `staging a copy…` → `referenced` or `copied into the workspace`.

## Install

```sh
dsh plugin --profile web add github:RCYD857/Huan857
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
  input; they also appear as a thumbnail card in the strip.
- **Every other file** is referenced by absolute path: the card resolves the file's real location, and
  at send time that path is expanded into the prompt as `@path` (quoted as `@"path"` when it contains
  spaces). The model opens it with its own read tool.

Nothing is written into the draft while you attach. The expansion happens inside the wrapped
`conversation.sendSession` — the single funnel every submission goes through, image-only sends
included. That means no draft writes, no chip injection, and no dependency on Lexical internals; a
failed send simply keeps the cards, so resending carries them again.

Already-sent messages need no extra work: `projectUserText` already renders `@path` as a
file-reference chip.

## Where the path comes from (three layers, most faithful first)

1. **The drag payload's own path.** Explorer attaches `text/uri-list`, which is the user's original
   file location. Nothing is copied.
2. **A bounded name search on the host** — `POST /file-attach/locate`. Search roots, in order: the
   current workspace → other workspaces → inbox-style directories directly under each workspace
   (`inbox`, `input`, `inputs`, `drops`) → `Desktop`, `Documents`, `Downloads` → directories that
   produced a hit before (remembered in `<DSH_HOME>/file-attach-roots.json`, at most 24 of them).
   Each root is walked breadth-first with a depth limit of 5 and 20,000 entries visited, a 3 s budget
   for the search as a whole, and at most 20 candidates. Same-name candidates are narrowed by byte
   size, then by content: copies holding identical bytes resolve themselves (the one inside the
   session's workspace wins, so the model gets a path it can open), and only genuinely different
   files make the card offer a picker. A card that is still unresolved when you send is named in the
   prompt's notice — see [Nothing is dropped in silence](#nothing-is-dropped-in-silence).
3. **A staged copy** — `POST /file-attach/stage`. The browser uploads the bytes and the host writes
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

Only a resolved card has a path to expand, so a card that is still locating, still staging, or
waiting on a pick contributes nothing to the prompt. That used to happen without a word: a user
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

## The attachment strip

- **Panel** — white `#ffffff`, 16 px radius, shadow `0 4px 16px rgb(0 0 0 / 8%)`, 12 px padding, 8 px row gap
- **Cards** — 48 px tall, 8 px radius, surface `#f5f5f7`, hover `#ebecef`, max width 200 px, 8 px gap
- **Information card** — a 36 px glyph area plus two lines: name at 14 px/500 `#1d1d1f` (ellipsised
  when too wide), subtitle at 12 px `#86868b` formatted as `ext · size` (for example `json · 30 KB`)
- **Glyph colours** — documents `#1677ff`, code `#00a870`, archives `#d48806`, PDF/spreadsheet/slides `#d4380d`
- **Image cards** — a 48 px square thumbnail, `object-fit: cover`
- **States** — loading shows a spinner and "uploading…"; failure shows a `#fff1f0` surface with a
  Retry button; a card awaiting a pick between same-named files replaces its `ext · size` subtitle
  with the question rather than looking resolved; drag hover outlines the panel in `#1677ff` with a
  drop hint
- **Overflow** — `overflow-x: auto` with the native scrollbar hidden, plus gradient fades and arrow
  buttons that scroll one screen. Lanes are per edge: the strip only reserves space on a side that
  actually has an arrow, so there is never an empty gap at an edge with nothing to scroll.

## Diagnostics

The desktop shell has no developer tools, so the browser half reports measured facts back through
`POST /file-attach/report` into `<DSH_HOME>/file-attach-report.json`, appended by checkpoint
(`apply` → `slot-probe` → `slot-registered` → `slot-component` → `rail-mounted` → `rail-rendered` →
`drop`) and including the strip's measured width and which edges overflow. `node read-report.mjs`
prints it.

Reports are written from `useEffect`, never during render — writing module state while rendering
trips React's re-render protection.

The same route doubles as the quickest liveness check on a running host: a registered route answers
`GET` with `405`, while a host that never loaded the plugin answers `404`.

## Limitations

- **The text area and the bottom action bar belong to DSH.** Their styling, placeholder and send
  button are the platform's and the plugin does not touch them. The "container" is therefore two
  stacked pieces — this strip, and the platform's input card — not a form the plugin fully owns.
- **The platform's image thumbnail row is rendered inside the input card** and cannot be injected
  into, so an attached image appears both there and as a card in the strip.
- The strip is anchored to the `conversation.input.overlay` slot, and the send expansion hooks
  `conversation.sendSession`. A change to either in DSH's client UI needs a matching update here.
- On Windows, Explorer does not reliably send `dragleave` when a drag ends, so overlay visibility is
  driven by a `dragover` heartbeat (hidden after 320 ms of silence) rather than by
  `dragenter`/`dragleave` counting.

## Design notes

Things that were tried and abandoned, recorded so they are not tried again:

- **Not in the document flow.** Registering the strip in `composer.dock` with `order: -1` and a
  negative margin did push the conversation upward, but it moved the input card with it, and the
  pull-back amount was wrong in every variant. Opening an attachment area must not move the composer.
- **Not merged into the input card.** `translateY(100%)` plus removing the card's bottom border
  (`22px 22px 0 0` radius, shared background) produced a single panel that looked like one form, but
  it changed the platform card's appearance and was reverted. The strip is a separate panel pinned to
  the card's top edge: `bottom: 100%`, no `order`, no negative margin, no measurement.
- **The slot component cannot rely on a `session` prop.** `conversation.input.overlay` renders its
  components without one (only `composer.dock` passes `session`), so the strip reads the current
  session from the store (`ctx.sessions.list.getSnapshot().current`). Judging by the prop makes the
  strip return `null` forever — the symptom is "I dropped a file and no attachment box appeared".
- **The scroller owns the ref.** An earlier version put the ref on the outer strip while the inner
  row was the scrolling element, so the arrow buttons did nothing.
- **Width comes from the card's own variable.** `left: 0; right: 0; width: 100%; max-width:
  var(--dsh-composer-card-max-width)` matches the platform card exactly; measuring against
  `--dsh-composer-side-clearance` produced a strip that did not line up with it.
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
  `stopImmediatePropagation` and then issues the exact same `input.addImages` call the platform would
  have made — same pipeline, triggered from a place that actually fires.
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

**把任意文件拖进或粘进 DSH Web 输入框，它就会变成输入框上方的一张附件卡片：点一下预览、按 × 移除，发送时作为文件引用跟着你的提示词一起送给模型。** 输入框里永远不会出现路径文本——你打的问题就是输入框里的全部内容。

[English](#dsh-file-attach) · [行为](#行为) · [安装](#安装) · [文件怎么到模型手里](#文件怎么到模型手里) · [附件条](#附件条) · [限制](#限制) · [设计取舍](#设计取舍) · [开发](#开发)

### 行为

| 操作 | 结果 |
| --- | --- |
| 把文件拖到页面任意位置 | 全屏提示；松手后输入框上沿出现一张卡片 |
| 在输入框里粘贴文件或截图 | 同上 |
| 拖/粘图片 | 同时走平台原生的图片附件（输入框内的缩略图栏 + 点开大图） |
| 点卡片 | 打开预览：图片显示原图，文本/代码显示开头 200 KiB，其他格式显示文件信息 |
| 点卡片上的 × | 卡片淡出移除，本次不发送 |
| 失败卡片上点「重试」 | 重新走一遍定位/暂存 |
| 附件多到放不下 | 渐变 + 箭头按钮，点击平滑滚动一屏 |
| 直接回车发送 | 附件在发送那一刻展开成文件引用 |
| 卡片还在处理中或等着你选路径时回车 | 提示会点名这个附件和原因，卡片保留 |

一条消息最多 **20 个附件**。卡片会显示自己的处理状态：`准备中` → `正在定位原始路径…` → `正在暂存副本…` → `已引用本地文件` / `已附加（工作区副本）`。

### 安装

```sh
dsh plugin --profile web add github:RCYD857/Huan857
```

这个包没有构建步骤，因此不需要 `allowBuilds` 构建授权。装完重启 DSH，再硬刷新页面。卸载：`dsh plugin --profile web remove dsh-file-attach`。

本地开发可以直接 link 源码目录：

```sh
dsh plugin --profile web add link:/path/to/dsh-file-attach
```

需要一个带 Web 客户端的 DSH profile（`--profile web`）。本项目在 DSH Desktop（Windows）上开发与验证，对应的平台版本见 release notes。

### 文件怎么到模型手里

DSH 没有给插件通用的文件附件通道，只有图片通道。所以这里做了分流：

- **图片**（`image/*`）走平台既有的图片管线，作为视觉输入发给模型；同时它也以缩略图卡片的形式出现在附件条里。
- **其他文件**按绝对路径引用：卡片负责找出文件的真实位置，发送时把该路径展开成 `@路径` 写进提示词（路径含空格时用 `@"路径"`），模型用自己的 read 工具打开。

附加过程中**不往草稿里写任何东西**。展开发生在被包装的 `conversation.sendSession` 内部——每个提交都必经的唯一漏斗，图片-only 发送也走它。因此没有草稿写入、没有 chip 注入，也不依赖 Lexical 内部结构；发送失败时卡片原样保留，重发即可带上。

已发送的消息不需要额外处理：`projectUserText` 本来就会把 `@路径` 渲染成带文件图标的引用标签。

### 路径从哪里来（三层，越靠前越保真）

1. **拖拽载荷自带的路径。** 资源管理器会附 `text/uri-list`，直接就是用户原始文件的位置，不复制任何东西。
2. **宿主侧的有界名字搜索** —— `POST /file-attach/locate`。搜索根依次为：当前工作区 → 其他工作区 → 各工作区下形如 `inbox`/`input`/`inputs`/`drops` 的收件目录 → `Desktop`/`Documents`/`Downloads` → 以前出过命中结果的目录（记在 `<DSH_HOME>/file-attach-roots.json`，最多 24 个）。每个根做广度优先遍历：深度上限 5、访问条目上限 20000；整个搜索的时间预算是 3 秒，候选上限 20 个。同名候选先按字节大小收窄，再按内容判定：字节完全相同的副本会自动选定（优先工作区里的那份，模型拿到的是它能直接打开的路径），只有内容确实不同的才让卡片弹出选择框。发送时仍未处理完的卡片会在提示里被点名，见 [不会静默丢弃](#不会静默丢弃)。
3. **宿主暂存副本** —— `POST /file-attach/stage`。浏览器把文件字节交上来，宿主写进 `<工作区>/.dsh-attachments/<文件名>`。这是让拖拽**永远可用**的兜底：浏览器不保证透露拖入文件的来源（Electron 的拖拽载荷通常什么都不给），而文件内容本来就是模型最终要读的东西。

暂存目录自带 `.gitignore`（内容 `*`），副本不会进版本控制。单文件上限 256 MiB，文件名做了穿越与非法字符清洗。卡片上带「副本」标记的表示走了这一层；整个 `.dsh-attachments` 随时可以删掉，不影响原件。

**复用只按字节判定，并且扫描所有同名副本**（`name`、`name-2`、`name-3`…）。此前两条规则都是错的，已经被替换掉：只比文件大小，会在用户做出等长修改后让模型读到旧内容；只比第一个候选路径（`name`），一旦变更后的副本落在 `name-2` 就永远匹配不上，于是每次拖入都新建一份。字节是唯一能真正标识一个文件的东西：**同名不同内容一定落新副本（`name-2.ext`），绝不静默覆盖；只有字节完全相同才复用。**

### 不会静默丢弃

只有已经解析出路径的卡片才能展开成引用，所以还在定位、还在暂存、或者等着你选路径的卡片，对这次提示词没有任何贡献。**这件事以前是无声发生的**：用户附了一个 `.yml`，它恰好在两个地方各有一份、同名同大小，宿主回了 `choose`，卡片留在附件条里——外观和已就绪的卡片一模一样——于是消息只带着正文发了出去。**缺陷是"没说"，不是"要选"。**

三处各修一层：

- **宿主把"选了也没差别"的情况直接定下来。** 同名候选逐字节比较（上限 8 个候选、每个 4 MiB，拖拽因此永远不会被它拖住）。全部候选字节相同就直接给出结果，不再提问；超过任一上限就判定为"无法证明相同"，仍然保留选择框，而不是猜一个。
- **卡片不再伪装成就绪。** 待选择的卡片副标题显示 `同名文件有 2 个，请先选择`，而已就绪的显示 `yml · 502 B`——不用点开任何东西就能看出状态。
- **发送时点名没跟上的附件。** 发送边界会列出每一张未就绪的卡片：哪个文件、为什么没跟上、该怎么办，并且保留卡片，下一次发送就能带上。

自检里都有对应的钉子：`check-host.mjs` 钉住"相同则自动定、不同则仍要问"（含超限回落为提问）；`check-client.mjs` 钉住未就绪卡片不产生引用、会发出提示、且发送后仍然存在；`check-spec.mjs` 钉住卡片文案。

### 附件条

- **面板** —— 白底 `#ffffff`、圆角 16 px、阴影 `0 4px 16px rgb(0 0 0 / 8%)`、内边距 12 px、行间距 8 px
- **卡片** —— 高 48 px、圆角 8 px、底色 `#f5f5f7`、hover `#ebecef`、最大宽 200 px、卡片间距 8 px
- **信息卡** —— 左侧 36 px 图标区 + 右侧两行：文件名 14 px/500 `#1d1d1f`（超宽省略号），副标题 12 px `#86868b`，格式为「后缀 · 大小」（如 `json · 30 KB`）
- **图标配色** —— 文档 `#1677ff`、代码 `#00a870`、压缩包 `#d48806`、PDF/表格/演示 `#d4380d`
- **图片卡片** —— 48 px 正方形缩略图，`object-fit: cover`
- **状态** —— 加载中转圈 +「上传中…」；失败为 `#fff1f0` 浅红底 + 「重试」按钮；同名待选择的卡片把副标题换成那句提问，而不是继续显示「后缀 · 大小」假装已就绪；拖拽悬停时面板描边变 `#1677ff` 并显示落点提示
- **溢出** —— `overflow-x: auto` 且隐藏原生滚动条，配渐变遮罩与箭头按钮，点击滚动一屏。留白按边计算：只有真的有箭头的那一侧才留出空位，没有可滚内容的一侧不会出现空档。

### 诊断

桌面壳没有开发者工具，所以浏览器半边把实测到的事实经 `POST /file-attach/report` 写进 `<DSH_HOME>/file-attach-report.json`，按检查点累积（`apply` → `slot-probe` → `slot-registered` → `slot-component` → `rail-mounted` → `rail-rendered` → `drop`），内容包括附件条的实测宽度与哪一侧溢出，用 `node read-report.mjs` 打印。

上报必须写在 `useEffect` 里，绝不能写在渲染期——渲染期写模块状态会触发 React 的重复渲染保护。

这个路由同时是在运行中的宿主上做存活检查最快的方式：已注册的路由对 `GET` 返回 `405`，而从未加载过插件的宿主返回 `404`。

### 限制

- **文字输入区与底部功能栏归 DSH。** 它们的样式、占位符、发送按钮都是平台的，插件不碰。所以「整个容器」其实是上下两块——本附件条 + 平台的输入卡片，而不是一个由插件完全掌控的表单。
- **平台的图片缩略图栏渲染在输入卡片内部**，无法被注入，所以一张图片会同时出现在那里和附件条里。
- 附件条挂在 `conversation.input.overlay` 槽位，发送展开挂在 `conversation.sendSession` 上。DSH 客户端 UI 若改动这两处，本项目需要同步适配。
- Windows 上资源管理器在拖拽结束时并不保证发 `dragleave`，所以遮罩的显隐由 `dragover` 心跳驱动（静默 320 ms 即隐藏），而不是靠 `dragenter`/`dragleave` 计数。

### 设计取舍

以下是试过又放弃的做法，记在这里以免再走一遍：

- **不放文档流。** 把附件条注册到 `composer.dock` 配合 `order: -1` 与负边距，确实能把对话往上顶，但会**带着输入卡片一起移动**，而且回拉量在每个变体里都算错。打开附件区不应该移动输入框。
- **不与输入卡片合并。** `translateY(100%)` 下移自身高度、去掉卡片下边框、`22px 22px 0 0` 上圆下直、共用背景，能把两块做成一整块面板，但改变了平台卡片的外观，已回退。现在的形态是一块独立面板钉在卡片上沿：`bottom: 100%`，无 `order`、无负边距、不做测量。
- **槽位组件不能依赖 `session` prop。** `conversation.input.overlay` 渲染组件时不传 `session`（只有 `composer.dock` 传），所以附件条统一从 store 读当前会话（`ctx.sessions.list.getSnapshot().current`）。按 prop 判断会让附件条永远返回 `null`，表现就是「拖了文件没有附件框」。
- **ref 必须给真正的滚动元素。** 早期版本把 ref 放在外层容器上、而真正滚动的是内层那一行，结果箭头按钮点了没反应。
- **宽度取自卡片自己的变量。** `left: 0; right: 0; width: 100%; max-width: var(--dsh-composer-card-max-width)` 才能与平台卡片严格对齐；用 `--dsh-composer-side-clearance` 去撑会得到一条对不齐的条。
- **媒体类型按扩展名补全。** 平台的图片管线只接受 `png`/`jpeg`/`webp`/`gif`，且没有扩展名兜底；而资源管理器拖出的文件 `file.type` 常常是空字符串（粘贴会带类型，所以粘贴一直正常）。空类型会抛 `UnsupportedImageMediaTypeError`，它打断整个 drop 处理器——而且是静默的，所以现象只是「图片拖不进来」。补不出映射的格式（如 `tif`）退回路径卡片，至少有反馈。下一步是改为读文件头魔数：有些工具导出的图片会带着 JPEG 字节却取 `.png` 名字。
- **drop 由本插件独占。** 平台自带的图片拖放目标要求 `dragActive`、`canAcceptDrop` 快照与媒体准入三者同时成立，而「它到底收没收到」在同一个任务里观察不到。所以本插件用 `stopImmediatePropagation` 接管落点，然后发出**与平台完全相同**的 `input.addImages` 调用——管线没变，只是触发点移到了真正会触发的地方。
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
