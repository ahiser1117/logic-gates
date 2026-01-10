import { useStore } from '../store'
import './Board.css'

export function InputBoard() {
  const inputs = useStore((s) => s.circuit.inputs)
  const addInput = useStore((s) => s.addInput)
  const removeInput = useStore((s) => s.removeInput)
  const toggleInput = useStore((s) => s.toggleInput)
  const renameInput = useStore((s) => s.renameInput)

  return (
    <div className="board input-board">
      <div className="board-label">Inputs</div>
      <div className="board-items">
        {inputs.map((input) => (
          <div key={input.id} className="board-item">
            <button
              className={`toggle-btn ${input.value ? 'on' : 'off'}`}
              onClick={() => toggleInput(input.id)}
            >
              {input.value ? '1' : '0'}
            </button>
            <input
              type="text"
              className="item-label"
              value={input.label}
              onChange={(e) => renameInput(input.id, e.target.value)}
            />
            <button
              className="remove-btn"
              onClick={() => removeInput(input.id)}
              title="Remove input"
            >
              ×
            </button>
          </div>
        ))}
        <button className="add-btn" onClick={() => addInput()}>
          + Add Input
        </button>
      </div>
    </div>
  )
}
