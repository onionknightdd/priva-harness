# AGENTS.md

This file applies to the repository root and all of its subdirectories. If a
subdirectory contains a more specific `AGENTS.md`, follow the instructions in
the file closest to the code being changed.

## Project Status

The frontend lives in `agent-ui/` and uses React 19, TypeScript, Vite 8,
Tailwind CSS 4, shadcn/ui with Base UI primitives, Animate UI, Motion, and GSAP.
Use npm and run the following commands from `agent-ui/`:

- Install dependencies: `npm ci`
- Start development: `npm run dev`
- Run static analysis: `npm run lint`
- Build for production: `npm run build`
- Preview the production build: `npm run preview`

The TypeScript Agent Runner lives in `services/agent-runner/ts/`. Use npm and
run the following commands from that directory:

- Install dependencies: `npm ci`
- Start development: `npm run dev`
- Run static analysis: `npm run lint`
- Run strict type checking: `npm run typecheck`
- Run tests: `npm test`
- Build for production: `npm run build`
- Start the production build: `npm start`

No frontend automated test command or repository-wide formatter is currently
configured. Add their exact commands here when those tools are introduced.

## Engineering Principles

- Read the relevant code, configuration, documentation, and applicable
  `AGENTS.md` files before making changes.
- Keep each change small, focused, and limited to the current task. Do not
  refactor unrelated code along the way.
- Do not preserve backward compatibility. Remove obsolete paths instead of
  adding compatibility layers, fallbacks, or migrations.
- Choose the simplest implementation that fully meets the current
  requirements. Avoid speculative abstractions, configuration, and
  indirection.
- Grow the system in layers. Start with the smallest version that works end to
  end, then add each new capability on top of a product that already works.
  Never trade a working product for unfinished complexity.
- Keep components modular and concerns clearly separated.
- Prefer established, well-maintained libraries when they reduce overall
  complexity or improve reliability. Do not reimplement common functionality
  without a clear reason.
- Lean on dependencies already in the project before writing a custom
  implementation or adding packages. Do not assume a library lacks a
  capability without checking its documentation and types.
- Make architectural decisions for the long term. Do not accept a stopgap that
  only works for now and is meant to be replaced later.
- Follow the existing code style and directory structure. When an interface or
  convention must change, update its callers and documentation and explain the
  impact instead of adding compatibility code for obsolete behavior.
- Do not overwrite the user's existing changes or commit secrets, tokens,
  personal data, build artifacts, or large binary files.
- Fix root causes. Do not hide problems with silent failures, broad exception
  handling, or disabled checks.

## Implementation Workflow

1. Confirm the task scope, current behavior, and acceptance criteria.
2. Resolve unclear design decisions with the user before selecting an
   implementation.
3. Locate the affected implementation, callers, tests, and documentation.
4. Complete any required ASCII diagram and approval step described below.
5. Implement the smallest complete change that satisfies the requirements.
6. Run the repository's formatting, static analysis, test, and build commands.
7. When handing off, summarize the changes, verification results, and any
   remaining limitations or risks.

## Code and Documentation

- Use names that communicate intent, and keep functions and modules focused on
  a single responsibility.
- Use comments to explain rationale, constraints, and non-obvious tradeoffs,
  not to restate the code.
- Validate external input where necessary and return actionable error messages.
- When fixing a defect, prefer adding a regression test that reproduces it.
  Cover the normal path and important edge cases for new behavior.
- Update relevant documentation and examples whenever behavior, interfaces,
  configuration, or usage changes.

## Frontend Implementation

- All frontend work must use a consistent `shadcn/ui` visual language and
  component style across every screen and feature.
- Reuse and compose `shadcn/ui` components and primitives before creating
  custom equivalents. Extend them only when the product requirement cannot be
  met through composition.
- Define colors, typography, spacing, radii, and other visual decisions through
  shared theme tokens. Do not introduce isolated styles that diverge from the
  established design system.
- Use shadcn/ui for foundational UI components and visual structure.
- Prefer Animate UI for ready-made animated components that satisfy the product
  requirement.
- Use Motion for custom React interactions, gestures, and component-level state
  transitions.
- Reserve GSAP for the small number of complex scroll-driven or timeline-based
  animations that Motion does not express clearly.
- Every user-facing frontend implementation must include purposeful motion.
  Motion should clarify hierarchy, state changes, or user feedback rather than
  serve as decoration alone.
- Keep animation behavior consistent and reusable. Scope animation timelines
  and contexts to component lifecycles and clean them up when components
  unmount.
- Respect `prefers-reduced-motion` and provide a usable reduced-motion or
  no-motion experience without removing access to content or functionality.
- Preserve responsive behavior, keyboard navigation, visible focus states, and
  semantic accessibility while styling and animating interfaces.

## Design Communication and Approval

- Before implementing any frontend layout, present an ASCII wireframe to the
  user and obtain explicit approval. Do not begin layout implementation until
  the proposed layout has been confirmed.
- The ASCII wireframe must show the relevant page regions, content hierarchy,
  navigation, primary actions, and important states. Include separate desktop
  and mobile views when their layouts differ materially.
- Every discussion of a proposal, system architecture, component architecture,
  or user/data flow must include an ASCII diagram alongside the written
  explanation. Use the diagram form that best communicates the design, such as
  a wireframe, component tree, system block diagram, flowchart, or sequence
  diagram.
- If the requirements or design contain an unclear decision that could affect
  the result, use the available question or user-input tool to ask the user for
  confirmation. Do not silently choose an interpretation.
- If no question tool is available in the active environment, ask the user a
  concise direct question and wait for confirmation before proceeding.
- If a confirmed layout, proposal, architecture, or flow changes materially,
  update the ASCII diagram and obtain confirmation again before implementing
  the changed direction.

## Test Organization

- Do not place tests inside production source files or source directories.
- Keep tests in a dedicated top-level `tests/` directory.
- Mirror the production source directory structure under `tests/` whenever
  practical.
- Keep test fixtures, mocks, and test-only helpers outside production source
  directories.

## Verification

- Report only checks that were actually run; do not present assumptions as
  verified results.
- If a check cannot be run, state why and identify what remains unverified.
- If the repository has no test or validation tooling yet, do not invent
  commands for appearance's sake. Add the exact commands here once the tooling
  exists.

## Pre-commit Change Overview

Before every commit:

1. Generate a tree containing only the files included in the commit.
2. Preserve the repository-relative directory structure so that each file's
   location is clear.
3. Mark each file as added (`A`), modified (`M`), deleted (`D`), or renamed
   (`R`).
4. Add a concise description of the change beside each file.
5. Follow the tree with a brief overall change summary and the verification
   results.
6. Regenerate the overview if the staged changes are modified before the
   commit.

## Version Control

- Keep commits focused and exclude unrelated formatting changes or generated
  files.
- Unless explicitly requested, do not rewrite history, force-push, or delete
  user branches or tags.
- Write concise commit messages that describe the purpose of the change. If the
  project later adopts a commit convention, follow that convention instead.
