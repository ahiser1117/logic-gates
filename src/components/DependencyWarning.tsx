import type { DependencyInfo } from '../utils/componentDependencies'

interface Props {
  dependencyInfo: DependencyInfo
  message: string
}

export function DependencyWarning({ dependencyInfo, message }: Props) {
  if (dependencyInfo.total === 0) return null

  return (
    <div className="dialog-warning">
      <p>
        This component is used by {dependencyInfo.total} custom component
        {dependencyInfo.total > 1 ? 's' : ''}:
      </p>
      <div className="dialog-warning-tree">
        {dependencyInfo.lines.map((line, index) => (
          <div key={`${line.prefix}${line.name}-${index}`} className="dialog-warning-line">
            <span className="dialog-warning-prefix">{line.prefix}</span>
            <span
              className={line.isTarget ? 'dialog-warning-target' : undefined}
            >
              {line.name}
            </span>
            {line.note && !line.isTarget && (
              <span className="dialog-warning-note">({line.note})</span>
            )}
          </div>
        ))}
      </div>
      <p>{message}</p>
    </div>
  )
}
