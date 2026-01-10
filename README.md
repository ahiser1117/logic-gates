# Logic Gate Simulator

A web-based digital logic circuit designer and simulator built with React, TypeScript, and HTML5 Canvas.

## Features

- Design circuits using NAND and NOR gates
- Create custom reusable components from your circuits
- Interactive input board with toggle switches
- Output board displaying computed values
- Pan and zoom canvas navigation
- Custom components saved to localStorage

## Tech Stack

- **Framework**: React 18 + TypeScript
- **Build**: Vite
- **State**: Zustand with Immer
- **Rendering**: HTML5 Canvas

## Getting Started

### Prerequisites

- Node.js (v18 or higher recommended)
- npm

### Installation

```bash
npm install
```

### Development

```bash
npm run dev
```

Opens the development server at [http://localhost:5173](http://localhost:5173).

### Production Build

```bash
npm run build
npm run preview
```

## Project Structure

```
src/
├── canvas/       # Canvas rendering, hit testing, interactions
├── store/        # Zustand store (circuit + UI state)
├── simulation/   # Circuit compilation and evaluation
├── types/        # TypeScript type definitions
├── components/   # React UI components
└── hooks/        # Custom React hooks
```

## License

MIT
