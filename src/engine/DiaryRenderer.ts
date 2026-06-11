import type { Diary, DiaryContent, PipelineStep } from '@/types'
import { DiaryState } from '@/types'
import { renderPipeline } from './RenderPipeline'
import { pluginLoader } from './PluginLoader'
import { diaryLifecycle } from './DiaryLifecycle'
import { globalTimeline } from './Timeline'

export interface RenderOptions {
  targetTime?: number
  compact?: boolean
}

export interface ScheduledRenderOptions {
  timeToPublish: number
  compact?: boolean
}

export interface DeadRenderOptions {
  compact?: boolean
}

export class DiaryRenderer {
  renderDiary(
    diary: Diary,
    ctx: CanvasRenderingContext2D,
    options: RenderOptions = {}
  ): void {
    if (diary.state === DiaryState.SCHEDULED) {
      const scheduleStatus = diaryLifecycle.getScheduleStatus(diary, options.targetTime)
      this.renderScheduled(ctx, {
        timeToPublish: scheduleStatus.timeToPublish,
        compact: options.compact
      })
      return
    }

    if (diary.state === DiaryState.DEAD && diary.tombstone) {
      this.renderDead(ctx, diary, { compact: options.compact })
      return
    }

    this.renderNormal(diary, ctx, options)
  }

  renderScheduled(
    ctx: CanvasRenderingContext2D,
    options: ScheduledRenderOptions
  ): void {
    const width = ctx.canvas.width
    const height = ctx.canvas.height
    const compact = options.compact ?? false

    ctx.fillStyle = '#1a1a2e'
    ctx.fillRect(0, 0, width, height)

    if (compact) {
      ctx.fillStyle = '#60a5fa'
      ctx.font = '48px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⏰', width / 2, height / 2 - 20)

      ctx.fillStyle = '#94a3b8'
      ctx.font = '14px monospace'
      ctx.fillText('待发布', width / 2, height / 2 + 30)

      if (options.timeToPublish > 0) {
        ctx.fillStyle = '#60a5fa'
        ctx.font = '12px monospace'
        ctx.fillText(`+${Math.floor(options.timeToPublish)}`, width / 2, height / 2 + 50)
      }
    } else {
      ctx.fillStyle = '#60a5fa'
      ctx.font = '80px sans-serif'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText('⏰', width / 2, height / 2 - 40)

      ctx.fillStyle = '#94a3b8'
      ctx.font = '20px monospace'
      ctx.fillText('日记尚未发布', width / 2, height / 2 + 20)

      if (options.timeToPublish > 0) {
        ctx.fillStyle = '#60a5fa'
        ctx.font = '16px monospace'
        ctx.fillText(`距离发布还有 ${Math.floor(options.timeToPublish)} 时间单位`, width / 2, height / 2 + 60)
      }
    }
  }

  renderDead(
    ctx: CanvasRenderingContext2D,
    diary: Diary,
    options: DeadRenderOptions = {}
  ): void {
    const width = ctx.canvas.width
    const height = ctx.canvas.height

    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, width, height)

    if (diary.tombstone) {
      const tombstone = pluginLoader.getTombstone(diary.tombstone)
      if (tombstone) {
        tombstone.render(ctx, diary)
      }
    }
  }

  renderNormal(
    diary: Diary,
    ctx: CanvasRenderingContext2D,
    options: RenderOptions = {}
  ): void {
    const decayRate = diaryLifecycle.getDecayRate(diary)
    renderPipeline.render(diary, ctx, options.targetTime, decayRate)
  }

  renderPreview(
    content: DiaryContent,
    pipeline: PipelineStep[],
    decayLevel: number,
    ctx: CanvasRenderingContext2D
  ): void {
    renderPipeline.renderPreview(content, pipeline, decayLevel, ctx)
  }

  getDecayLevelForRender(diary: Diary, targetTime?: number): number {
    return diaryLifecycle.getDecayLevel(diary, targetTime ?? globalTimeline.getTime())
  }
}

export const diaryRenderer = new DiaryRenderer()
