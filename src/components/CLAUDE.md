# components/ - React UI Components

Standard React components for the app shell. Note: circuit elements (gates, wires, boards) are rendered on canvas, not as React components.

## Files

### Layout.tsx
Main app layout with sidebar and canvas area.
```
┌─────────┬──────────────────┐
│ Palette │                  │
│         │ CanvasWorkspace  │
│         │                  │
└─────────┴──────────────────┘
```

### Palette.tsx
Sidebar with draggable gate components.
- Lists primitive gates from `GATE_DEFINITIONS` (including Split/Merge)
- Lists custom components from store
- Drag to canvas to add new gates/components
- Sets `dataTransfer.setData('componentType', type)` on drag
- "Create Component" button opens dialog to save current circuit
- Inline edit/delete buttons open confirmation dialogs
- Delete dialog shows dependency tree for impacted components

### DeleteComponentDialog.tsx / EditComponentDialog.tsx
In-app confirmations for deleting or reopening custom components.
- Shows dependency trees for higher-order components
- Highlights the target component in the tree

### CreateComponentDialog.tsx
Modal dialog for creating custom components.
- Name input field
- Shows input/output count from current circuit
- Displays validation errors if circuit is invalid
- Validates: all board pins connected, all component pins used

### SplitMergeContextMenu.tsx
Context menu for Split/Merge primitives.
- Right-click Split/Merge to set partition sizes (comma list)
- Toggle button switches between Split and Merge mode

### InputBoard.tsx / OutputBoard.tsx
**NOT USED** - Legacy React components. Input/output boards are now rendered directly on canvas in `renderer.ts` and are draggable.

## Styling
- `Layout.css` - flexbox layout
- `Palette.css` - sidebar and gate item styles
- `Board.css` - (legacy, unused)

## Adding UI Components
Standard React patterns apply. These components don't interact with the canvas directly - they use the Zustand store for state.
