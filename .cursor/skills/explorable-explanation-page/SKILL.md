---
name: explorable-explanation-page
description: Builds a single-file offline explorable explanation (plain HTML with embedded CSS and vanilla JS) for a specific subsystem, with linked interactive and visual representations plus guided narrative. Use only when explicitly invoked to create an explorable explanation, interactive system walkthrough, or behavior simulation.
---

# Explorable Explanation Page

Create a **single-file** explorable explanation for a chosen part of a system.

An explorable explanation is not a dashboard, not a sandbox, and not a tutorial. It is **authored text integrated with live, interactive models** -- the reader can play with the author's assumptions and see consequences, while the author guides attention toward key phenomena. Text is the environment to think in, not information to consume.

## Hard Requirements

- Output exactly one file: `index.html` (embed CSS and JS inline).
- Plain HTML / CSS / vanilla JS only. No frameworks, no CDN, no build tools.
- Must run locally offline by opening the file directly.
- Optimise for understanding behavior, not UI chrome.

## Core Design Principles

These are non-negotiable. Every design decision flows from them.

### 1. Show behavior, not structure

The system is doing something -- make that visible. A schematic, a code listing, a database diagram: these show _structure_. Structure is what the system _is_. Behavior is what the system _does_. The reader needs to see all the key variables, all at once, changing over time.

Think: the circuit board with live voltage plots on every node, not the static schematic.

### 2. Channel-switch: visual + interactive + symbolic

People think through three channels (Bruner / Piaget):

- **Interactive** -- thinking by doing, adjusting, playing (hands)
- **Visual** -- thinking by seeing many things in parallel, recognizing shapes, comparing (eyes)
- **Symbolic** -- thinking step-by-step with language and logic (language)

Traditional explanations are almost entirely symbolic. The explorable should fire on all three. Move the core understanding out of symbolic reasoning and into visual + interactive, so the reader _sees_ the behavior and _plays_ with the parameters. Use symbolic (text, equations, labels) to anchor and name what they're seeing.

### 3. Linked representations

Show the same behavior from multiple views that update together. When the reader adjusts a parameter, all views respond simultaneously. When the reader points at one representation, corresponding parts of other representations highlight.

This builds intuition: the reader sees how a change in one view ripples through all the others, building associations between different ways of understanding the same phenomenon.

### 4. Author-guided exploration (not a sandbox)

> Most interactive widgets dump the user in a sandbox and say "figure it out for yourself." Those are not explanations. -- Bret Victor

The author must hold up their end of the conversation. The text should:

- Present a clear narrative arc
- Embed interactive elements _within_ the narrative (not in a separate panel)
- Guide attention: "notice how X changes when you drag Y"
- Provide 3-5 "try this" prompts that reveal surprising behavior
- Explain _why_ the surprising thing happens

The reader interacts when they want to go deeper, not because they're forced to.

### 5. Immediate feedback

Parameter changes update outputs instantly. No "run" buttons, no loading states. The tight loop between action and reaction is what builds intuition. The reader should feel like they're directly manipulating the system, not issuing commands to it.

### 6. Make the abstract concrete

Replace abstract variables with concrete, vivid examples. In Nielsen's Simpson's paradox explanation, "treatment A vs B" is abstract and forgettable; "Democrats vs Republicans voting on the Civil Rights Act" is concrete and memorable. Choose a domain-specific example that makes the parameters _mean something_.

### 7. Reveal surprise (then explain it)

The best explorables have a moment where the reader's intuition breaks -- where the system does something unexpected. Design for this moment. Set up the reader's expectation, then let the interactive model shatter it. Then explain why.

### 8. Deep mode by default

Include derived metrics, intermediate state, threshold crossings, comparisons to baseline. Don't just show the final output -- show the machinery. The reader should see the system's internal reasoning, not just its conclusions.

## Workflow

### 1. Read the codebase first

Before writing any HTML, understand the subsystem:

- Read the actual source code for the subsystem
- Identify the key inputs, outputs, and internal state
- Find the invariants, edge cases, and failure modes
- Understand what behavior is surprising or non-obvious

If any are unclear, ask concise clarifying questions before coding.

### 2. Frame the subsystem (in chat)

Capture in 3-6 bullets:

- subsystem boundary (what is in / out)
- key inputs the reader will control
- key outputs / behavior to visualize
- important internal state to expose
- the "surprise" -- the non-obvious behavior to reveal
- invariants or failure modes worth demonstrating

### 3. Design the representations

Plan at least 3 linked views before coding:

- **What visual representation best reveals the behavior?** (Not "what chart type" -- what way of seeing makes the invisible visible?)
- **What should the reader be able to adjust?** (Parameters that change behavior in interesting, non-linear ways)
- **What derived view reveals something the primary view hides?** (Deltas, ratios, frequency domain, distribution shape, etc.)

Think about channel-switching: if the behavior is currently only understandable symbolically (reading code, tracing logic), how do you move it to visual + interactive?

### 4. Implement the model

Keep model logic separate from rendering:

```
const initialState = { ... }
function stepModel(state, inputs) { ... }     // pure
function deriveMetrics(history) { ... }        // pure
```

- Small pure functions, no deep nesting
- Validate/sanitize user input
- Model should be testable without any DOM

### 5. Build the page

Use this section structure in the HTML:

1. **Header**: subsystem name + one-sentence purpose
2. **Narrative intro**: what the reader will learn, framed around the "surprise"
3. **Interactive narrative**: text interleaved with controls and views (NOT a separate controls panel + separate view panel). Each paragraph of text should flow into the interactive element it's discussing.
4. **"Try these" prompts**: 3-5 specific explorations that reveal edge cases
5. **"What this means" section**: interpretation and implications

### 6. Wire up linked views

All views must share a single model state. When any control changes:

1. Update the model
2. Re-render ALL views from the new model state
3. Highlight correspondences across views

### 7. Verify before finalizing

- All views stay synchronized on every interaction
- No external dependencies
- Runs by opening `index.html` directly
- Edge inputs handled safely (clamp, default, warn)
- Narrative reads well even without interacting
- "Try this" prompts actually reveal something interesting
- There is at least one moment of genuine surprise

## JS Organization

```
// --- MODEL (no DOM) ---
const initialState = { ... }
function sanitizeInputs(raw) { ... }
function stepModel(state, inputs) { ... }
function deriveMetrics(stateHistory) { ... }

// --- RENDERING (reads model, writes DOM) ---
function renderControlView(state) { ... }
function renderBehaviorView(state) { ... }
function renderDerivedView(state) { ... }
function highlightCorrespondences(element) { ... }

// --- WIRING ---
function onParameterChange() {
  const state = stepModel(currentState, getInputs())
  renderControlView(state)
  renderBehaviorView(state)
  renderDerivedView(state)
}

function main() { ... }
```

## Visual Design Guidelines

- Use `<canvas>` for dynamic plots / animations; plain DOM for controls and text.
- Muted, professional palette. Reserve saturated color for the 1-2 most important things.
- Inline controls in the text flow using `<span>` or inline-block elements where possible (Bret Victor "reactive document" style). Sliders/toggles can appear mid-sentence.
- Labels directly on the visualization, not in a separate legend.
- Transitions/animations only when they help show _change over time_ -- never decorative.
- Responsive: should work at reasonable desktop widths (800px+).

## Adapting to This Codebase

When explaining a subsystem of this specific codebase:

- Read the actual source files before designing the explorable
- Use the real function names, variable names, and data shapes from the code
- If the subsystem involves a pipeline (e.g. file processing, chat completions, auth flow), show data transforming at each stage with the ability to inspect intermediate state
- If the subsystem involves configuration/parameters (e.g. AI model settings, subscription tiers), make those the adjustable inputs
- Link back to source file paths in the narrative so the reader can find the real code

## Anti-Patterns

- **Sandbox without guidance**: controls + chart with no narrative. Not an explorable.
- **Static illustrations with interactivity bolted on**: if removing the interactivity doesn't lose anything, the interactivity is decorative.
- **Disconnected widgets**: multiple interactive elements that don't share state or update together.
- **Framework setup / build tooling**: no React, no Vite, no npm. Single file.
- **Giant monolithic JS**: if you can't name each function's purpose in 5 words, break it up.
- **Unexplained controls**: every slider/toggle/select must be introduced by the narrative before or alongside it.
- **Symbolic-only explanation**: if the reader has to trace logic in their head, you haven't channel-switched.

## Required Output

When executing this skill, return:

1. `index.html` implemented.
2. A short **Model Notes** section in chat:
   - subsystem scope
   - the "surprise" or key insight
   - what each linked view reveals
   - assumptions made
3. A **How to continue** list with 3-5 options (mark one recommended).

## Prompt Starters

- "Create an explorable explanation for `SUBSYSTEM_NAME`."
- "Build an explorable for `FLOW_OR_COMPONENT` that shows how `BEHAVIOR` changes with `PARAMETER`."
- "Make an explorable that reveals why `SURPRISING_THING` happens in `SUBSYSTEM`."
