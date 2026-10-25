# dsh-agent-teams-concourse

English | [中文](README.zh.md)

**Version:** `0.2.0` (DSH baseline `0.2.1-rc.2`; team layer has passed real-machine smoke on a scratch profile, Desktop acceptance pending) · [Changelog](CHANGELOG.md) · [Requirements](docs/REQUIREMENTS.html) · [Plan](DEVELOPMENT_PLAN.md) · [Collaboration norms](COLLABORATION.md)

The **organizational layer** for DSH: it turns "who may talk to whom, which model and
reasoning effort each execution unit gets, and how a product finds its way back to the
mainline" into editable first-class data. A topology is not *built*, it is *pruned* — the
substrate is physically a complete graph, so this plugin declares an open edge set on top
of it; a multi-level tree is therefore a view, and **the execution substrate stays exactly
one level deep**. Zero art assets: shape carries the semantics, colour only speeds up scanning.

> **Work in progress.** This is `0.2.x`: the team layer (topology, per-vertex model
> assignment, communication gates, plan card) works today; the **side-inquiry probe**
> (isolated, not echoed back, retrievable by handle, discardable) is the next stage and
> **not a single line of it exists yet**. The table below is the honest state, not the
> aspiration.

## What works today

| Area | State |
|---|---|
| Topology as data: `team_topology` declares vertices + open edges; tier classification (T0/T1a/T1b/T1.5/T2a); plan-time capacity and budget validation | ✅ |
| Per-vertex assignment: `model` / `reasoningEffort` / `budget` / `toolFilter` / `maxDepth`, fail-loud when out of range | ✅ |
| Auto-assignment suggestions (heuristic, with `rationale[]` / `signals[]` / `confidence`) | ✅ |
| Hard communication constraints: deny-by-default open edge set, `wake` defaults to never, hop TTL, idempotent dedup, rate degradation, per-edge and global budget fuses | ✅ |
| **Inbox-side authoritative gate** + bypass matrix (4 entry points sending over a closed edge: all blocked or logged) | ✅ |
| Single plan-approval gate (`team_plan` submits and does not spawn); zero team-building approvals at runtime | ✅ |
| JSONL ledger (decisions / comms / budget / echo counts) + replay on restart | ✅ |
| Right-sidebar panel and plan card: components and tests complete, **but the data bridge is not wired — the panel renders a placeholder today** | ⚠️ |
| Side-inquiry probe (`team_probe` / `team_peek`, `echo: handle` + `tick` notification) | ⏳ planned (P5) |
| Four-level discard / shadowing / promotion to member | ⏳ planned (P6) |
| Session join and T2a peer leaders (`team_join`) | ⏳ planned (P8) |

Real-machine smoke for T1a (star) and T1b (multi-level tree) has been run on a scratch
profile (during `0.1.0`), and the verbatim closed-edge rejection is on record; `0.2.0` was
installed into a Web profile and passed its health check. **The 0.2.0 fix batch was not
re-verified on a real machine** — both API keys were rejected as invalid by the service.
That is recorded here as it is, not presented as verified.

## Requirements

- DSH `0.2.1-rc.2` (`engines.dsh` and peers are currently **pinned exactly**; widening them
  to ranges is tech debt T-1, see plan §4).
- Node `^22.19 || >=24` and `pnpm`.
- A profile you are willing to modify. `enabled` **defaults to false**: with it off there is
  zero behaviour change.

## Quick start

```powershell
# 1) build + full gate + package
pnpm install
pnpm verify
pnpm pack

# 2) install into a profile, then **fully restart** the host (host plugins load at startup only)
dsh plugin --profile <profile> add <path-to>\dsh-agent-teams-concourse-0.2.0.tgz
```

Enable it in that profile's `cordis.patch.yml` (lazy by default):

```yaml
- override:
    id: concourse
    config:
      enabled: true
      storagePath: <dir>   # JSONL ledger directory; defaults to host storage, else memory
```

Then, in a session, in order:

```
team_topology   declare vertices and the open edge set (topology as data)
team_plan       submit the full plan for approval — the only approval gate
team_assign     assign per-vertex settings and spawn (children start via startActivation)
team_send       deliver a message (closed edges are hard-rejected, with reachable candidates)
team_status     one-line overview of topology / budget / communication health
```

## How it is built

| Layer | Does | Why here |
|---|---|---|
| **kernel** (`src/kernel`) | topology validation, tier classification, difficulty profiling, suggestions, comms gates (gate/hop/dedup/rate/budget), shape glyphs | Pure functions with zero host dependencies, pinned by corpus regression and unit tests (CI-enforced boundary) |
| **host** (`src/host`) | thin adapter over `startActivation` / `sendText` / `interrupt`, the provider, the model catalog | The only place allowed to touch host seams; degrades instead of crashing when `ctx.subagents` is absent |
| **service** (`src/service`) | lifecycle, **inbox-side authoritative admission**, ledger, JSONL persistence and replay | The gate belongs at the data write entry, not in each tool shell |
| **tools / client** | six `team_*` tools (scope-split by identity), React 18 sidebar and plan card | Tools only fail early for UX; the UI is read-only display |

**Route A is deliberate.** A P2 probe falsified the assumption that the official
`spawnTeammate` forwards `agentOptions`, so this plugin builds its own vertex registry,
mailbox, task-board mapping and persistence, and depends only on four stable host surfaces:
`ctx.subagents`, `ctx.llm`, `ctx.tools`, `ctx.agents`. The cost is a minimal home-grown CAS
and reconciliation; the benefit is not being held hostage by an experimental substrate.

## What the gates actually check

- **Open edge set**: any edge not in `E` is closed. Default is closed (deny-by-default), so
  forgetting to open one produces a hard rejection plus a ledger entry — immediately visible.
  The opposite default would silently create unplanned channels, so the plugin is fail-closed.
- **Inbox-side authority**: admission looks only at `(from, to, content, hops)` and **ignores
  any routing metadata**. A forged direct `send_message` therefore takes the same path. Tools
  fail early for UX; they are not the security boundary.
- **Bypass matrix** (`test/tools/bypass-matrix.test.ts`): tool call / direct service call /
  forged direct send / bare runtime — four entry points, all blocked or logged. This is the
  only accepted proof for NFR-9.
- **Zero art assets**: no `.png/.jpg/.svg/.gif` inside the package; no emoji code points
  anywhere under `src/`.
- **Module boundaries**: a `@deepseek-ai/*` or `node:*` import inside `kernel` fails the build.

## Safety and degradation

- **Lazy**: with `enabled !== true` there is no registration, no listener, no behaviour change.
- **Failures never block the conversation**: each step of `apply` has its own `try/catch` and
  only warns. This matters — a throwing registration makes the host **roll back the whole
  plugin effect**, and downstream callers then report `NO_PROVIDER`, which is deeply misleading.
- **Degrade, don't crash**: when `ctx.subagents` is absent the substrate enters a `degraded`
  mode and every method rejects with a typed error instead of failing during assembly.
- It never reads or rewrites session logs and never patches the host; all state lives in the
  configured `storagePath` (append-only JSONL).
- Every rejection, degradation and fuse is logged. Otherwise users assume messages were lost,
  which is harder to diagnose than a message storm.

## Known boundaries

- **The panel does not show real state**: components and tests exist, but the session
  projection bridge is not wired (plan §9 residue #3, fixed in P7).
- After a vertex task finishes, concourse still shows `running` (no host completion events).
- No `contextMode: fork`, no quiescence detection, no model price-tier source — see plan §4.
- Per-child tool split registration waits on a host session-identity surface (currently the
  full set is registered in root/leader contexts only).
- The probe layer is entirely unimplemented (20 FRs in the requirements).
- Not published to npm yet: install from a tarball.
- Tool names sit next to the official `team_task_*` family (no collisions); the boundary is
  stated in every tool description: **concourse owns topology and routing, the official
  layer owns members and tasks**.

## Authorship and maintenance

- **Authors by version range**
  - `0.1.0` – `0.2.0`: the **previous AI collaborator** (coding through DeepSeek Harness;
    process recorded in `CHANGELOG.md`, `docs/mvp-exit-v0.1.0.md` and `docs/decisions/`).
  - From `0.2.1` / `0.3.0` on: **DeepSeek-V4.1-Flash-1017** (AI model, coding through
    DeepSeek Harness).
- **Producer / repository owner**: KEI.NEO (@neo805) — human producer, responsible for the
  contents of this repository.
- **Maintenance scope**: this is the producer's personal hobby (vibe-coding) project.
  Published for sharing only; **no commitment to maintenance or updates driven by external
  requirements**.
- **Collaboration policy**: this repository **does not accept Issues or Pull Requests**.
  Feel free to fork and evolve under the MIT licence.
- **Disclaimer**: provided "as is", without warranty of any kind (see LICENSE). Evaluate
  before using it in production.

## Acknowledgements and licence

MIT. References and lessons: `@nanmicoder/dsh-agent-teams` (anthropomorphic UI and
misplaced-approval anti-pattern), `dsh-team-rooms` (a gate living only in the tool shell that
was bypassed), `@deepseek-ai/dsh-experimental-agent-team` (the official baseline and its
"no nested teams" boundary), `dsh-thoughtdag` ("wires are the context", exclusion rather than
deletion), `@yfwu2020/dsh-selection-explain` (the human-side entry interaction for side
queries). Competitor and platform-primitive evidence lives in `research/`.
