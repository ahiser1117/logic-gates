import { CanvasWorkspace } from '../canvas/CanvasWorkspace'
import { Palette } from './Palette'
import './Layout.css'

export function Layout() {
  return (
    <div className="layout">
      <Palette />
      <div className="main-area">
        <CanvasWorkspace />
      </div>
    </div>
  )
}
