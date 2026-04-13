# UI Builder Architecture Overview

This document explains the core architecture of the UI Builder, breaking it down into state management, rendering, and property editing.

## 1. How UI Nodes Are Stored (State)

The UI builder is driven by a centralized store built with **Zustand** (`src/modules/ui-builder/store.ts`). 

* **The Tree Structure**: The state consists of a `DesignDocument`. A document contains `Pages`, and a page contains a nested, hierarchical tree of `DesignNode` objects.
* **Nodes**: Each `DesignNode` acts as a basic container representing an element on the screen (like a `FRAME` or `TEXT`). It holds physical dimensions (`x, y, width, height`), rotation, an `id`, and a `type`.
* **Stateful Decorators (Pattern)**: To keep the `DesignNode` clean, visual styles (like background colors, borders, font weights) are abstracted into **Decorators**. In the Zustand store, these are stored purely as `DecoratorState` objects (an array of JSON objects with an ID, type, and a `config` bag, completely devoid of class methods).

By keeping the nodes as pure JSON objects without methods or heavy class instantiations, the entire UI state can be effortlessly serialized, undo-redo can be easily implemented, and it syncs flawlessly over the network or across react re-renders.

## 2. How the Editor Renders Nodes

The heart of the visual display relies on the **CanvasViewport** and **CanvasRenderer** (`src/modules/ui-builder/renderer/CanvasRenderer.ts`). Let's walk through the rendering lifecycle:

1. **Triggering Render**: React's `CanvasViewport.tsx` acts as the bridge. Whenever the Zustand store updates, React tells the `<canvas>` to re-render.
2. **The Styling Pipeline**: Before anything is drawn on the 2D canvas, the renderer recursively passes every node through `NodeFactory.computeStyles(node)`. 
3. **Decorator execution**: The pipeline looks at the raw JSON `decorators` array on the node, fetches the respective execution logic from the `DecoratorRegistry`, and calls the singleton `decorate()` method. This translates the raw `config` (like `{ color: "#fff" }`) into a flat, predictable `attributes` object (the "CSS bag") on the transient node instance.
4. **Drawing**: The `CanvasRenderer` uses the computed `attributes` and the node's bounds (`x, y, width, height`) to draw standard HTML5 Canvas 2D routines (e.g. `ctx.fillRect()`, `ctx.fillText()`). 
5. **Recursion (Composite Pattern)**: After rendering the parent frame, it recursively applies the same logic and offset to its nested `children`.

## 3. How the Right-Side Property Pane Operates

The right-hand property pane (`PropertyInspector` in `src/modules/ui-builder/ui/PropertyRegistry.tsx`) takes a completely decoupled, plugin-based approach to modifying node properties.

Instead of hardcoding a massive switch-case statement of forms (checking if node is text, drawing text properties; if frame, drawing background properties), it delegates UI editing back to the decorators:

1. **Inspection**: When a user selects a node, `PropertyInspector` loops over the `node.decorators` array.
2. **Dynamic UI Render**: For each decorator state, it asks the `DecoratorRegistry` for the logic handler and invokes `decorator.renderUI(node, config, updateCallback)`. This means the `BackgroundDecorator` actually supplies its own color picker React component, and `LayoutDecorator` supplies its own X/Y inputs.
3. **Modifying Data**: When the user changes a control (e.g., sliding a color wheel), the decorator calls the `updateCallback(newConfig)`.
4. **Closing the Loop**: The callback executes `updateDecorator()` in the Zustand store. Zustand deeply clones the state, applies the new config patch, and React triggers another Canvas render matching the new UI configuration immediately.

Because of this decoupled control-flow, adding a new feature (like a "Drop Shadow") only requires creating a `ShadowDecorator` class logic and registering it. Neither the `Renderer` nor the `PropertyInspector` need to change.
