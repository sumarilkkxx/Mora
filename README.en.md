<p align="center">
  <img src="./assets/readme/hero-en.gif" width="100%" alt="Mora local-first AI video workspace: use a text model for scripting, organize local or AI media, then produce voice, captions, and a final video">
</p>

<p align="right"><a href="./README.md">中文</a> · <strong>English</strong></p>

<h1 align="center">Mora</h1>
<p align="center"><strong>Not another isolated generated clip—a production path from creative intent to a traceable, recoverable, exportable final video.</strong></p>
<p align="center">A text model handles automatic scripting and storyboards; local media, open libraries, and generated visuals are used as needed; voice, captions, tasks, versions, and FFmpeg composition stay in one project.</p>

<p align="center">
  <a href="#showcase">Real cases</a> ·
  <a href="#workflow">How it works</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#desktop">Desktop</a> ·
  <a href="./README.md">中文</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/version-v0.1.0.0-087BDF?style=flat-square" alt="Version v0.1.0.0">
  <img src="https://img.shields.io/badge/license-AGPL--3.0--only-28526F?style=flat-square" alt="License AGPL-3.0-only">
  <img src="https://img.shields.io/badge/local--first-FFmpeg%20%2B%20SQLite-0D355A?style=flat-square" alt="Local-first with FFmpeg and SQLite">
  <img src="https://img.shields.io/badge/models-BYOK%20%7C%20Ollama-087BDF?style=flat-square" alt="Bring your own model keys or use local Ollama">
  <img src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS-111111?style=flat-square&logo=electron" alt="Windows and macOS desktop targets">
</p>

<a id="showcase"></a>

## Meet Mora through two real outputs

Short-video production often breaks between stages: product information exists but the script does not; the script exists but usable shots do not; footage has already been recorded but still needs to travel through transcription, pacing, voice, captions, and export. Mora is designed around those gaps, not around a single generation button.

Both MP4 files below came from real projects. They begin with different material but share the same project model for scripts, assets, tasks, versions, and exports. Click either board to play the complete video.

### Case one: turn product intent into a generative narrative when the shots do not yet exist

The pet-fountain project starts from a product goal and a creative direction. A text model organizes the selling points into a script, shot rhythm, and visual constraints. Generated or reference-conditioned media supplies candidate visuals. Results return to the project instead of remaining a folder of unrelated model outputs.

<p align="center">
  <a href="./docs/videos/mora-ai-showcase.mp4"><img src="./assets/readme/showcase-generative.webp" width="100%" alt="Play a 30-second pet-fountain film built from a text-model script, shot rhythm, and generated or reference visuals"></a>
</p>

<p align="center"><strong>Generative product film · 30.02s · 1080×1920</strong><br><sub>Product intent → text script → shot constraints → generated/reference visuals → complete video version</sub></p>

This output demonstrates that a model may produce the visuals, but a production system still has to own the script, shot relationships, candidates, and versions.

### Case two: when footage already exists, carry it through the complete post-production chain

The salon project does not regenerate the subject. Mora preserves the source footage, splits it into scenes, reorganizes the promotional script rhythm, creates voice and timed captions, and renders a new local version. The source, edit plan, and older outputs remain intact.

<p align="center">
  <a href="./docs/videos/mora-guided-edit-latest.mp4"><img src="./assets/readme/showcase-guided.webp" width="100%" alt="Play an existing salon video split into scenes, paced against a script, voiced, captioned, and rendered locally"></a>
</p>

<p align="center"><strong>Existing-footage edit · 16.4s · local render</strong><br><sub>Source upload → scene split → rhythm edit → voice and captions → local FFmpeg final</sub></p>

This output demonstrates that existing usable shots do not need to be regenerated for the sake of looking “AI.” The valuable work is connecting media understanding, text structure, and a reliable final render.

Together, the two films define Mora's boundary: **media may come from a camera, a library, or an AI model, but the final video's origin defines the production path.** An AI image can still be ordinary source media. If Mora and FFmpeg render the final MP4, the project remains on a local-final path. Only a final video directly produced by a cloud video model belongs to the generative-video path.

> [!IMPORTANT]
> **A local final does not mean that no model is ever called.** Automatically generating, rewriting, or reviewing a script requires a text LLM. You can bring a key for a cloud OpenAI-compatible service or connect local Ollama. Manually writing, importing, and editing a script can skip that call. Image and video models remain optional and path-dependent; organizing local media, captions, and FFmpeg composition does not require a paid image or video model.

## What Mora is solving

### 1. One project owns the full production context

Scripts, storyboards, product data, media provenance, voice, captions, model jobs, compositions, and exports belong to one project. After a refresh or restart, users see recoverable production state instead of a pile of unrelated temporary results.

### 2. Automation begins with a script, not random visuals

A text model turns selling points, audience, platform, duration, and creative form into a structured script. That script drives media selection, voice length, caption timing, and final rhythm. Users may import or edit every script; model output is not treated as an immutable answer.

### 3. Local work and potentially billable calls stay distinct

Local transcription, scene splitting, captions, FFmpeg composition, and file management are separated from requests to text, image, video, or hosted voice providers. Mora does not collect provider fees or present unknown prices as fake precision.

### 4. Failure state is part of the product

Pipeline stages, cloud jobs, compositions, and failure reasons are persisted. A run can resume from a breakpoint, and completed or potentially billable stages are not accidentally resubmitted after a page refresh.

<a id="workflow"></a>

## How it works: the script is the spine, the final video's origin selects the path

```mermaid
flowchart TD
    INPUT["Product data / creative brief / existing footage"] --> SCRIPT_SOURCE{"Where does the script come from?"}
    SCRIPT_SOURCE -->|"Generate, rewrite, or review"| TEXT_LLM["Text LLM<br/>BYOK cloud service or local Ollama"]
    SCRIPT_SOURCE -->|"Write or import manually"| MANUAL["Editable script"]
    TEXT_LLM --> SCRIPT["Structured script<br/>shots, rhythm, and visual constraints"]
    MANUAL --> SCRIPT
    SCRIPT --> FINAL_SOURCE{"How is the final video produced?"}
    FINAL_SOURCE -->|"Local Mora + FFmpeg render"| LOCAL["Local composition<br/>local / stock / AI media"]
    FINAL_SOURCE -->|"Video model produces the final"| GENERATIVE["Generative video<br/>cloud job and persisted result"]
    FINAL_SOURCE -->|"Continue from recorded footage"| EDIT["Existing-footage edit<br/>scene split / transcript edit / local re-render"]
    LOCAL --> EXPORT["Versions, preview, QC, and export"]
    GENERATIVE --> EXPORT
    EDIT --> EXPORT
```

### Path A: local media composition

`Text model or manual script → local/stock/AI image media → voice → captions → BGM → FFmpeg composition → export`

- Use local uploads, project history, and configured open-media sources.
- Voice, burned captions, karaoke timing, BGM, ducking, aspect ratios, and render presets are supported.
- AI images do not automatically turn the project into “generative video.” If Mora renders the final MP4 locally, it remains a local-final path.

### Path B: generative video

`Text script → visual constraints → image/video provider → candidates or cloud final → persist in project → export`

- Pick providers and models independently for images, video, and reference-conditioned generation.
- Capabilities, resolution, aspect ratio, duration, and reference requirements are checked before submission.
- Cloud jobs and local compositions remain separate to prevent origin mistakes and duplicate billable submissions.

### Path C: existing-footage editing

`Upload → scene split/local transcription → rhythm or transcript edit → voice and captions → local render → export`

- Designed for talking-head clips, shop visits, tutorials, interviews, and previously recorded vertical footage.
- Guided editing and transcript-based cuts are both available.
- Source footage, edit plans, and earlier versions stay intact for comparison and rollback.

## Where models participate

| Stage | Required? | Location and behavior |
| --- | --- | --- |
| **Write or import a script manually** | No model | Edited by the user and stored in the project. |
| **Generate, rewrite, or review a script automatically** | Text LLM required | OpenRouter, DeepSeek, Kimi, GLM, MiniMax, Doubao, another OpenAI-compatible service, or local Ollama. |
| **Understand product images** | Optional | Uses a vision-capable model; script generation can still continue from product name and selling points if analysis fails. |
| **Generate new images or video shots** | Optional | Called only when the selected path needs missing visuals. |
| **Voice** | Optional | Edge TTS, provider TTS, existing audio, or a project voice configuration. |
| **Scene splitting, captions, and composition** | No generative model | FFmpeg/ffprobe and the local media pipeline; local transcription can be used when available. |

<a id="quick-start"></a>

## Quick start

### Requirements

- Node.js `20+`
- pnpm `10+`
- Windows 10/11, macOS, or a common Linux development environment
- FFmpeg and ffprobe ship through project dependencies; a separate system install is not required

```bash
git clone https://github.com/sumarilkkxx/Mora.git mora
cd mora
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Drizzle applies migrations to `data/sqlite.db` when database-backed features are first used.

### Recommended first run

1. Configure a text script model in Settings. You may skip this if you only plan to import scripts manually.
2. Choose a cloud OpenAI-compatible service and bring your own key, or connect local Ollama at `http://127.0.0.1:11434/v1`.
3. Create a project from product information, a creative brief, or existing footage.
4. Confirm the script before choosing local media, generative shots, or existing-footage editing.
5. Before export, check media rights, provider cost, captions, audio, and platform AIGC-label requirements.

### CLI: start from one topic

The CLI `create` command writes the script automatically, so it requires a text model:

```bash
export MORA_LLM_BASE_URL="https://your-endpoint.example/v1"
export MORA_LLM_API_KEY="your-key"
export MORA_LLM_MODEL="your-model"

pnpm cli -- create --topic "Make better coffee at home" --duration 25 --style lifestyle --karaoke
```

Use `$env:MORA_LLM_BASE_URL=...` in Windows PowerShell. Run `pnpm cli -- --help` for product-link creation, script import, dubbing, platform export, QC, release gates, media credits, covers, and other commands.

### Development checks

```bash
pnpm lint
pnpm test
pnpm build
```

## Capability map

| Stage | Current capabilities |
| --- | --- |
| **Inputs and assets** | Product images and link ingestion, manual product data, creative briefs, video upload, product library, presenter assets, project media |
| **Scripts and storyboards** | Structured fields, text-model scripts, manual scripts, template structures, shot rhythm, script checks, visual descriptions, creative intent, and constraints |
| **Visual media** | Local media plus Pexels, Pixabay, Openverse, Coverr, and other adapters; image generation, image-to-video, reference-to-video |
| **Voice and captions** | Edge TTS, provider TTS, voice and speed, burned captions, karaoke timing, BGM, ducking, subtitle export |
| **Editing and composition** | Scene splitting, structure cloning, transcript editing, camera/look presets, FFmpeg composition, poster extraction, versions |
| **Production management** | Persistent pipelines, resumable state, batches, task center, model preflight, production console, final-video QC |
| **Export and publishing** | Platform presets, preview/download, publishing copy, media credits, AIGC labels, publishing checks |
| **Developer surfaces** | Web UI, HTTP API, zero-dependency Node CLI, Electron shell, SQLite/Drizzle data layer |

## Product surface

<table>
  <tr>
    <th align="center">Creation studio</th>
    <th align="center">Script workspace</th>
    <th align="center">Production console</th>
  </tr>
  <tr>
    <td><img src="./docs/assets/mora-ui/studio-home-full.jpg" width="360" alt="Mora creation studio"></td>
    <td><img src="./docs/assets/mora-ui/script-studio.jpg" width="360" alt="Mora script workspace"></td>
    <td><img src="./docs/assets/mora-ui/production-studio.jpg" width="360" alt="Mora production console"></td>
  </tr>
  <tr>
    <th align="center">Local composer</th>
    <th align="center">Transcript editor</th>
    <th align="center">Task center</th>
  </tr>
  <tr>
    <td><img src="./docs/assets/mora-ui/local-composer.jpg" width="360" alt="Mora local composer"></td>
    <td><img src="./docs/assets/mora-ui/transcript-editor.jpg" width="360" alt="Mora transcript editor"></td>
    <td><img src="./docs/assets/mora-ui/task-center-full.jpg" width="360" alt="Mora global task center"></td>
  </tr>
</table>

<a id="architecture"></a>

## Architecture

Mora reuses the same Next.js application in Web development and the Electron desktop build. The desktop shell starts a standalone server bound to the local machine and redirects SQLite, uploads, caches, and outputs into the OS user-data directory. FFmpeg and ffprobe are packaged with the application.

```mermaid
flowchart TB
    subgraph ENTRY["Entry surfaces"]
        WEB["Next.js Web UI"]
        CLI["Node CLI"]
        DESKTOP["Electron desktop shell"]
    end

    subgraph LOCAL["Local runtime"]
        APP["Next.js App Router<br/>pages + API routes + i18n"]
        CORE["Script engine + provider adapters<br/>pipeline runner + task center"]
        DB[("SQLite + Drizzle<br/>projects / scripts / tasks / versions")]
        FILES[("Local files<br/>uploads / cache / outputs / logs")]
        MEDIA["FFmpeg / ffprobe<br/>composition / captions / audio / analysis"]
        OUTPUT["Versioned MP4 / subtitles / publishing bundle"]
    end

    subgraph OPTIONAL["Optional third-party services"]
        LLM["Text or vision LLM"]
        GEN["Image / video providers"]
        STOCK["Open media / hosted voice"]
    end

    WEB --> APP
    CLI --> APP
    DESKTOP -->|"starts a local standalone server"| APP
    APP --> CORE
    CORE <--> DB
    CORE <--> FILES
    CORE --> MEDIA
    MEDIA --> OUTPUT
    CORE -. "BYOK request" .-> LLM
    CORE -. "generate when needed" .-> GEN
    CORE -. "search or synthesize voice" .-> STOCK
    LLM -. "structured script or analysis" .-> CORE
    GEN -. "candidate media or final video" .-> FILES
    STOCK -. "media or audio" .-> FILES
```

### Directory responsibilities

| Path | Responsibility |
| --- | --- |
| `src/app/` | App Router pages, workspaces, and HTTP APIs. |
| `src/lib/script-engine/` | Product/topic prompts, structured generation, and response parsing. |
| `src/lib/providers/` | Image, video, stock-media, and other external-capability adapters. |
| `src/lib/video-composer/` | FFmpeg composition, captions, audio, and media processing. |
| `src/lib/db/`, `drizzle/` | SQLite schema, queries, and migrations. |
| `electron/` | Desktop window, local server, user-data paths, and binary resolution. |
| `bin/mora.mjs` | CLI entry and end-to-end production commands. |

### Persisted production objects

- **Projects** store content type, production path, target duration, and status.
- **Scripts** store structured shots, roles, versions, and the selected variant.
- **Media** stores local files, remote provenance, licensing context, and project ownership.
- **AI jobs and pipelines** store provider jobs, stages, failure reasons, and breakpoints.
- **Compositions and edit plans** store input relationships, render state, output files, and version history.

## Models, media, and cost boundaries

Most configuration lives in Settings; keys do not need to be committed.

| Purpose | Optional integrations |
| --- | --- |
| **Script text models** | OpenRouter, DeepSeek, Kimi, GLM, MiniMax, Doubao, other OpenAI-compatible endpoints, local Ollama |
| **Image/video models** | Atlas Cloud, OpenRouter, Replicate, Volcengine, Alibaba Bailian, SiliconFlow; OpenAI image generation/editing |
| **Open media** | Local media first; optional Pexels, Pixabay, Openverse, Coverr, Jamendo, Freesound, and other sources |
| **Voice and local media** | Edge TTS, provider TTS, project audio, FFmpeg/ffprobe, local transcription capabilities |

Provider keys, balances, regional availability, and content rules remain with each provider. Before starting a potentially billable generation, verify the model, duration, resolution, and current provider price.

## Data boundary and security

- Development data lives under `data/`; packaged desktop data lives in Mora's OS user-data directory.
- SQLite state, uploads, cached media, outputs, and logs remain local by default.
- Script, image, video, stock, and voice requests send the data required for that request to the third-party services you configure.
- Product-link ingestion includes SSRF protection. Login walls, anti-bot systems, regional restrictions, and browser-cookie requirements may prevent backend ingestion.
- Before publishing, verify media licenses, likeness rights, trademarks, advertising rules, and platform AIGC-labeling requirements.

<a id="desktop"></a>

## Desktop builds and installers

```bash
# Next.js standalone + Electron directory package
pnpm pack:dir

# Windows x64 NSIS installer
pnpm dist:win

# macOS DMG (run on the matching macOS architecture or CI runner)
pnpm dist:mac
```

GitHub Actions includes Windows x64, macOS Apple Silicon, and macOS Intel build jobs, followed by a packaged-app smoke test. Public macOS distribution still requires an Apple Developer certificate, code signing, and notarization; unsigned builds are for development validation only.

| Version layer | Current convention |
| --- | --- |
| Git tag | `v0.1.0.0` |
| npm / Electron SemVer | `0.1.0` |
| Windows FileVersion | `0.1.0.0` |
| Artifacts | `Mora-Setup-v0.1.0.0-win-x64.exe` / `Mora-v0.1.0.0-mac-<arch>.dmg` |

## HTTP API and automation surfaces

| Surface | Purpose |
| --- | --- |
| `POST /api/llm/script` | Generate and persist a commerce script from product data and text-model configuration. |
| `POST /api/topic/script` | Create a project from one topic and generate several narration scripts. |
| `POST /api/project/:id/compose` | Submit a local composition and return a pollable composition record. |
| `GET /api/tasks` | Aggregate pipeline, render, cloud-generation, and batch task state. |
| `GET /api/health` | Inspect runtime, database migration, and FFmpeg/ffprobe health. |
| `pnpm cli -- --help` | Discover CLI commands from creation and dubbing through QC and publishing checks. |

## Current limits

`v0.1.0.0` is an early release. “Supported” in this README means an implementation exists in the repository; it does not mean every provider, model, or region is always available.

- Automatic scripting needs a reachable text model. For fully offline work, import a script manually or configure local Ollama.
- E-commerce login walls, CAPTCHAs, anti-bot systems, and cookie isolation can prevent product-link ingestion.
- Model specifications, pricing, and policies can change; Mora submits only parameters currently supported by the selected adapter.
- Public macOS packages must be built on macOS/CI and complete Apple signing and notarization.
- The publisher remains responsible for media rights, advertising compliance, and AIGC labels.

## FAQ

<details>
<summary><strong>Is local media composition completely offline?</strong></summary>
<br>
Local media, captions, and FFmpeg composition can remain on the machine. Automatic scripting still needs a text model, and Edge TTS or open-media search may access the network. Manual scripts, local Ollama, existing audio, and purely local media minimize external requests.
</details>

<details>
<summary><strong>Does using an AI image make the project an AI-video project?</strong></summary>
<br>
No. Path classification follows the origin of the final video. AI images may be ordinary source media in a local composition. Only a final video generated by a cloud video model belongs to the generative-video path.
</details>

<details>
<summary><strong>Why can Taobao or Tmall product links fail?</strong></summary>
<br>
Backend ingestion does not share login cookies from an external Edge or browser session and must enforce SSRF and private-address protection. Login walls, anti-bot systems, regional restrictions, and client-side rendering may require manual product data or uploaded screenshots.
</details>

<details>
<summary><strong>Does Mora automatically upload the whole project?</strong></summary>
<br>
Mora does not require every project to enter one central cloud. Only the text, image, video, stock, or voice services you explicitly call receive the data needed for that request. The local database and output files remain on the machine.
</details>

## Contributing

1. Start from an existing issue or a small, well-bounded change.
2. Create a focused branch.
3. Add tests for behavior changes and run `pnpm lint && pnpm test && pnpm build`.
4. Explain the user scenario, before/after behavior, verification, and any model-cost, migration, or desktop-packaging impact in the pull request.

Do not commit API keys, user media under `data/`, debug logs, or desktop signing certificates.

## License

The package metadata declares `AGPL-3.0-only`. If you modify Mora and make it available over a network, understand the AGPL source-availability obligations and the separate licenses of model providers, fonts, and media. A root `LICENSE` file should be added before the repository is made public.

---

<p align="center"><strong>Mora</strong><br><sub>Multimodal Orchestration for Retail Automation</sub></p>
