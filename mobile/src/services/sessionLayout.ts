export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Insets {
  top: number
  bottom: number
  left: number
  right: number
}

export type ToolbarPlacement = "rail" | "panel" | "side" | "floating"

export type SessionLayout =
  | {kind: "stacked"; video: Rect; panel: Rect; toolbar: "rail" | "panel"}
  | {kind: "overlay"; video: Rect; toolbar: "rail" | "side" | "floating"}

export const MIN_PANEL_HEIGHT = 180
export const PANEL_GAP = 12
export const SIDE_TOOLBAR_WIDTH = 64

export interface SessionLayoutInput {
  width: number
  height: number
  insets: Insets
  rail: "left" | "right" | null
  aspect: number
  fold: Rect | null
  fullScreen?: boolean
}

function fitInside(area: Rect, aspect: number): Rect {
  const width = Math.min(area.width, area.height * aspect)
  const height = width / aspect
  return {x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height}
}

/** A fold that runs across the content, splitting it into a top and a bottom half. */
function horizontalFold(fold: Rect | null, content: Rect): Rect | null {
  if (!fold) return null
  const spans = fold.width >= content.width * 0.8
  const thin = fold.height < content.height / 4
  const inside = fold.y > content.y && fold.y + fold.height < content.y + content.height
  return spans && thin && inside ? fold : null
}

/**
 * Where the Mac's screen, the trackpad panel and the controls go. Whenever the
 * window has room under the screen it becomes a laptop: screen on top, trackpad
 * below, split at a horizontal fold when there is one so nothing sits in it.
 * Otherwise the screen fills the window. Controls go in the iPhone Duo's rail
 * when there is one. Full screen fits the screen to the whole window, edge to
 * edge, with floating controls. Decided from sizes alone, never the device or
 * orientation.
 */
export function sessionLayout({
  width,
  height,
  insets,
  rail,
  aspect,
  fold,
  fullScreen,
}: SessionLayoutInput): SessionLayout {
  if (fullScreen) {
    const video = fitInside({x: 0, y: 0, width, height}, aspect)
    return {kind: "overlay", video, toolbar: (width - video.width) / 2 >= SIDE_TOOLBAR_WIDTH ? "side" : "floating"}
  }
  const content: Rect = {
    x: insets.left,
    y: insets.top,
    width: Math.max(0, width - insets.left - insets.right),
    height: Math.max(0, height - insets.top - insets.bottom),
  }
  const stackedToolbar = rail ? "rail" : "panel"
  const crease = horizontalFold(fold, content)
  if (crease) {
    const top: Rect = {x: content.x, y: content.y, width: content.width, height: crease.y - content.y}
    const panelTop = crease.y + crease.height
    const panel: Rect = {x: content.x, y: panelTop, width: content.width, height: content.y + content.height - panelTop}
    if (panel.height >= MIN_PANEL_HEIGHT)
      return {kind: "stacked", video: fitInside(top, aspect), panel, toolbar: stackedToolbar}
  }

  const videoHeight = content.width / aspect
  const below = content.height - videoHeight - PANEL_GAP
  if (below >= MIN_PANEL_HEIGHT) {
    return {
      kind: "stacked",
      video: {x: content.x, y: content.y, width: content.width, height: videoHeight},
      panel: {x: content.x, y: content.y + videoHeight + PANEL_GAP, width: content.width, height: below},
      toolbar: stackedToolbar,
    }
  }

  const video = fitInside(content, aspect)
  const spare = (content.width - video.width) / 2
  const toolbar = rail ? "rail" : spare >= SIDE_TOOLBAR_WIDTH ? "side" : "floating"
  return {kind: "overlay", video, toolbar}
}
