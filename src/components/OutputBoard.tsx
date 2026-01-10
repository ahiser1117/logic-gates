import { useStore } from '../store'
import { useSimulation } from '../hooks/useSimulation'
import './Board.css'

export function OutputBoard() {
  const outputs = useStore((s) => s.circuit.outputs)
  const addOutput = useStore((s) => s.addOutput)
  const removeOutput = useStore((s) => s.removeOutput)
  const renameOutput = useStore((s) => s.renameOutput)
  const simulation = useSimulation()

  return (
    <div className="board output-board">
      <div className="board-label">Outputs</div>
      <div className="board-items">
        {outputs.map((output) => {
          const value = simulation.outputValues.get(output.id) ?? false
          return (
            <div key={output.id} className="board-item">
              <div className={`value-indicator ${value ? 'on' : 'off'}`}>
                {value ? '1' : '0'}
              </div>
              <input
                type="text"
                className="item-label"
                value={output.label}
                onChange={(e) => renameOutput(output.id, e.target.value)}
              />
              <button
                className="remove-btn"
                onClick={() => removeOutput(output.id)}
                title="Remove output"
              >
                ×
              </button>
            </div>
          )
        })}
        <button className="add-btn" onClick={() => addOutput()}>
          + Add Output
        </button>
      </div>
    </div>
  )
}
