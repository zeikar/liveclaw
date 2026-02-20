import { type RefObject, useEffect, useRef, useState } from 'react'
import type { RenderManager } from '@charivo/render-core'
import { APP_CHARACTER } from '../config/character'
import { LIVE2D_MODEL_PATH } from '../config/live2d'
import { getCharivoInstance } from '../lib/charivo/session'

type Live2DRendererModule = typeof import('@charivo/render-live2d')
type RenderCoreModule = typeof import('@charivo/render-core')

type UseLive2DRendererResult = {
  stageRef: RefObject<HTMLDivElement | null>
  isRendererReady: boolean
  rendererError: string | null
}

export function useLive2DRenderer(): UseLive2DRendererResult {
  const stageRef = useRef<HTMLDivElement>(null)
  const [isRendererReady, setIsRendererReady] = useState(false)
  const [rendererError, setRendererError] = useState<string | null>(null)

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    let disposed = false
    let renderManager: RenderManager | null = null

    const initialize = async (): Promise<void> => {
      setRendererError(null)
      setIsRendererReady(false)

      const canvas = document.createElement('canvas')
      canvas.className = 'live2d-canvas'
      canvas.width = 720
      canvas.height = 720
      stage.replaceChildren(canvas)

      const [{ Live2DRenderer }, { createRenderManager }] = await Promise.all([
        import('@charivo/render-live2d') as Promise<Live2DRendererModule>,
        import('@charivo/render-core') as Promise<RenderCoreModule>
      ])

      if (disposed) return

      const renderer = new Live2DRenderer({ canvas })
      const manager = createRenderManager(renderer, {
        canvas,
        mouseTracking: 'document'
      })
      renderManager = manager

      await manager.initialize()
      await manager.loadModel?.(LIVE2D_MODEL_PATH)

      if (disposed) {
        await manager.destroy()
        renderManager = null
        return
      }

      const charivo = getCharivoInstance()
      charivo.attachRenderer(manager)
      charivo.setCharacter(APP_CHARACTER)

      setIsRendererReady(true)
    }

    initialize().catch((error: unknown) => {
      if (disposed) return
      const message = error instanceof Error ? error.message : String(error)
      setRendererError(`Live2D initialization failed: ${message}`)
      setIsRendererReady(false)
    })

    return () => {
      disposed = true

      if (renderManager) {
        void renderManager.destroy().catch((error: unknown) => {
          console.error('Failed to destroy render manager:', error)
        })
      }

      stage.replaceChildren()
    }
  }, [])

  return {
    stageRef,
    isRendererReady,
    rendererError
  }
}
