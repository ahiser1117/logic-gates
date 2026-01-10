# Logic Gate Simulator Web App — Spec Sheet

## 1) Purpose

A web application for designing, simulating, and composing complex digital logic systems using an interactive, grid-based construction workspace. The system must be highly performant to support large circuits and enable reusable “fabricated chips” (user-defined composite components).

## 2) Target Users

* Students learning digital logic
* Hobbyists building digital circuits
* Engineers prototyping combinational/compound logic

## 3) Core Concepts

* **Primitive gates (v1):** NAND, NOR
* **Circuit:** A directed graph of components (gates/chips) connected by wires.
* **Pins:** Inputs/outputs on components and on the global input/output boards.
* **Net:** A logical wire group (one driver, many readers) with a resolved boolean value.
* **Fabricated chip:** A user-defined composite component created from a circuit; instantiable in other circuits.

## 4) Product Goals

* **Performance:** Smooth editing and near-instant simulation for large circuits.
* **Scalability:** Efficient data structures and incremental evaluation.
* **Composability:** User-fabricated chips can be nested and reused.
* **Determinism:** Reproducible simulation results; clear rules for evaluation.
* **Usability:** Fast building via drag/drop and grid snapping; clear visual debugging.

## 5) Non-Goals (v1)

* Analog timing, propagation delay modeling, hazards, metastability
* Clocked sequential elements (flip-flops, latches)
* Verilog/VHDL import/export
* Multi-bit buses (single-bit only in v1)

## 6) Primary User Flows

### 6.1 Build and Simulate a Circuit

1. Open workspace (blank or template)
2. Drag NAND/NOR from left menu into grid construction view
3. Add/remove global inputs and outputs (top input board, bottom output board)
4. Wire components by connecting pins
5. Toggle input values and observe outputs
6. Save circuit

### 6.2 Fabricate a Custom Chip

1. Build a circuit in workspace
2. Select “Fabricate Chip”
3. Define chip name, description, and pin mapping (which nets correspond to chip inputs/outputs)
4. Validate (acyclic, no floating required pins, no multiple drivers per net)
5. Save to component library
6. Instantiate chip from menu in other circuits

### 6.3 Compose Larger Systems

1. Create a new circuit
2. Drag fabricated chips and primitives into workspace
3. Wire chips together
4. Simulate at scale

## 7) Functional Requirements

### 7.1 Workspace (Grid Construction View)

* Infinite or large scrollable canvas with grid snapping
* Pan/zoom with smooth interaction
* Multi-select, move, copy/paste, delete
* Undo/redo
* Alignment aids: snap-to-grid, optional guides

### 7.2 Component Palette (Side Menu)

* Sections:

  * Primitive Gates: NAND, NOR
  * Fabricated Chips: user-created components
* Search/filter
* Drag-and-drop placement

### 7.3 Input Board (Top) and Output Board (Bottom)

* Input board:

  * Add/remove inputs
  * Label inputs (user editable)
  * Toggle each input between 0/1
  * Optional keyboard shortcuts (e.g., 1–9)
* Output board:

  * Add/remove outputs
  * Label outputs
  * Display current output values (0/1)

### 7.4 Wiring and Connectivity

* Click/drag to connect pins; auto-route visualization (orthogonal lines recommended)
* Wires visually represent nets; highlight active/true nets
* Pin types: input pin, output pin
* Enforcement:

  * Each net has **exactly one driver** (global input board or a component output)
  * Any number of readers allowed
  * Prevent connecting output-to-output or input-to-input
  * Detect and report floating inputs

### 7.5 Simulation

* Boolean simulation of combinational logic
* Evaluation should update outputs immediately when:

  * input toggles
  * wire connections change
  * components move (cosmetic only)
* Support large circuits with minimal recomputation
* Detect and handle invalid circuits:

  * cycles (combinational loops)
  * multiple drivers per net
  * unconnected required inputs

### 7.6 Fabrication (Chip Creation)

* Convert a circuit into a chip component definition:

  * Persist internal netlist
  * Expose a chosen set of chip inputs/outputs
  * Store metadata (name, description, version)
* Chips are instantiable components with their own pins
* Chips can be nested (chips can contain chips), with cycle detection across hierarchy

### 7.7 Persistence

* Save/load circuits locally (v1): browser storage and export/import JSON
* Save/load fabricated chips to a local library
* Versioning for chips:

  * Changes to a chip should not silently break existing circuits
  * Strategy: immutable chip versions; new fabrication creates a new version

### 7.8 Validation and Debugging

* Validation panel listing errors/warnings:

  * cycles, multiple drivers, floating inputs, unreachable outputs
* Click an error to focus/highlight involved nodes
* Probe tool:

  * click a net/pin to show its current value and driver
* Optional truth-table preview for small circuits (guarded by size limits)

## 8) Performance Requirements (Targets)

* Smooth pan/zoom/drag at ≥ 60 FPS for typical circuits
* Simulation update latency (input toggle to stable outputs):

  * Typical: < 16 ms
  * Large circuits: < 100 ms
* Practical scale goals (v1):

  * 10k–100k gates (depending on device)
  * 100k–1M wires/nodes (hierarchical + incremental)

## 9) Simulation Architecture (Suggested)

### 9.1 Internal Representation

* Maintain a compiled netlist representation separate from UI state.
* Use integer IDs for components, pins, and nets.
* Store adjacency lists:

  * net -> list(readers)
  * component -> input nets / output nets

### 9.2 Incremental Evaluation

* When an input changes, propagate only affected region:

  * event queue of nets whose values changed
  * recompute dependent components
  * update downstream nets if outputs change
* Use topological order for acyclic circuits;

  * if edits introduce cycles, block simulation and surface error

### 9.3 Compilation Step

* On structural edits (adding/removing wires/components), rebuild or incrementally update:

  * driver resolution for nets
  * topological sort (Kahn)
  * dependency graph
* Prefer incremental rebuild for small edits; full rebuild allowed with thresholds.

### 9.4 Web Worker / WASM

* Run compilation and simulation in a Web Worker to keep UI responsive.
* Consider WASM for the hot path (graph compilation + propagation) if needed.

## 10) UI/UX Specifications

### 10.1 Layout

* Left: component palette
* Center: grid construction view
* Top: input board
* Bottom: output board
* Right or bottom drawer: inspector/validation panel

### 10.2 Interactions

* Place components: drag from palette, snap to grid
* Wire: click output pin then click input pin; or drag wire
* Select: click, shift-click, marquee
* Edit labels: inline
* Fabricate: primary button in toolbar; opens modal for name/pin mapping

### 10.3 Visual Language

* Gates/chips as blocks with labeled pins
* Nets highlighted when true (optional)
* Error states with clear red markers + explanation

## 11) Data Model (High-Level)

### 11.1 Circuit JSON (export/import)

* metadata: name, createdAt, updatedAt
* inputs: [{id, label, position}]
* outputs: [{id, label, position}]
* components: [{id, type, x, y, rotation, props}]
* pins: implicit by component type (or explicit mapping)
* wires: [{id, fromPinId, toPinId}]

### 11.2 Chip Definition JSON

* chipId, version, name, description
* interface:

  * inputs: [{name, pinIndex}]
  * outputs: [{name, pinIndex}]
* internalNetlist: (circuit snapshot or compiled netlist)
* dependency list: referenced chipIds/versions

## 12) Security and Privacy

* v1 is local-first; no accounts required.
* If later adding cloud sync: isolate user libraries, encrypt at rest, and include export.


## 13) Telemetry (Optional)

* Local performance counters (frame time, sim latency) for debugging
* If cloud features added later: opt-in analytics only

## 14) Milestones

### v1 (MVP)

* NAND + NOR primitives
* Grid workspace + wiring
* Input/output boards (dynamic size)
* Deterministic combinational simulation
* Validation for multiple drivers + cycles + floating inputs
* Fabricate chip into local library
* Save/load/export/import JSON

### v1.1

* Search palette
* Probe tool + net highlighting
* Better routing/cleanup of wires
* Performance upgrades (worker, incremental rebuild)

### v2 (Forward-Looking)

* Multi-bit buses
* Sequential logic with clock
* Cloud sync and sharing
