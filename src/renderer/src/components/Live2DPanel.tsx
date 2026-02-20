import { useLive2DRenderer } from '../hooks/useLive2DRenderer'

export function Live2DPanel(): React.JSX.Element {
  const { stageRef, isRendererReady, rendererError } = useLive2DRenderer()

  return (
    <section className="live2d-panel">
      <div className="live2d-panel-header">
        <span className="live2d-panel-title">Hiyori</span>
        {!rendererError && (
          <span className={`live2d-status ${isRendererReady ? 'is-ready' : 'is-loading'}`}>
            {isRendererReady ? 'Ready' : 'Loading'}
          </span>
        )}
      </div>

      <div className="live2d-stage" ref={stageRef} />

      {rendererError && <p className="live2d-error">{rendererError}</p>}
    </section>
  )
}
