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

export type ToolbarPlacement = "rail" | "panel" | "bottomRail" | "side" | "floating"

export type SessionLayout =
  | {
      kind: "stacked"
      video: Rect
      panel: Rect
      toolbar: "rail" | "panel" | "bottomRail"
      trackpad?: Rect
      trackpadAspect?: number
    }
  | {kind: "overlay"; video: Rect; toolbar: "rail" | "side" | "floating"}

export const MIN_PANEL_HEIGHT = 180
export const PANEL_GAP = 12
export const SIDE_TOOLBAR_WIDTH = 64
export const TRACKPAD_ASPECT = 16 / 9
export const TRACKPAD_INSET = 12

export interface SessionLayoutInput {
  width: number
  height: number
  insets: Insets
  rail: "left" | "right" | null
  aspect: number
  fold: Rect | null
  halfOpen?: boolean
  fullScreen?: boolean
}

function fitInside(area: Rect, aspect: number): Rect {
  const width = Math.min(area.width, area.height * aspect)
  const height = width / aspect
  return {x: area.x + (area.width - width) / 2, y: area.y + (area.height - height) / 2, width, height}
}

/**
 * A 16:9 trackpad as wide as the panel allows, centred between the bottom of
 * the screen above it and the bottom of the window, never outside the panel.
 */
function centredTrackpad(panel: Rect, screenBottom: number, windowHeight: number): Rect {
  const room: Rect = {
    x: panel.x + TRACKPAD_INSET,
    y: panel.y,
    width: panel.width - 2 * TRACKPAD_INSET,
    height: panel.height - TRACKPAD_INSET,
  }
  const fitted = fitInside(room, TRACKPAD_ASPECT)
  const centred = (screenBottom + windowHeight - fitted.height) / 2
  const y = Math.min(Math.max(centred, room.y), room.y + room.height - fitted.height)
  return {...fitted, y}
}

/** A fold that runs across the content, splitting it into a top and a bottom half. */
function horizontalFold(fold: Rect | null, content: Rect): Rect | null {
  if (!fold) return null
  const spans = fold.width >= content.width * 0.8
  const thin = fold.height < content.height / 4
  const inside = fold.y > content.y && fold.y + fold.height < content.y + content.height
  return spans && thin && inside ? fold : null
}

function splitAt(content: Rect, crease: Rect, aspect: number): {video: Rect; panel: Rect} {
  const top: Rect = {x: content.x, y: content.y, width: content.width, height: crease.y - content.y}
  const panelTop = crease.y + crease.height
  const panel: Rect = {x: content.x, y: panelTop, width: content.width, height: content.y + content.height - panelTop}
  return {video: fitInside(top, aspect), panel}
}

/**
 * Where the Mac's screen, the trackpad panel and the controls go. Whenever the
 * window has room under the screen it becomes a laptop: screen on top, trackpad
 * below, split at a horizontal fold when there is one so nothing sits in it.
 * Otherwise the screen fills the window. Controls go in the iPhone Duo's rail
 * when there is one, and then a laptop with no fold to split at (the folded
 * Duo) gets a 16:9 trackpad centred under the screen; without a rail the
 * panel centres a 16:9 trackpad above its toolbar (trackpadAspect). Full screen fits the
 * screen to the whole window, edge to edge, with floating controls. Decided
 * from sizes alone, never the device or orientation.
 */
export function sessionLayout({
  width,
  height,
  insets,
  rail,
  aspect,
  fold,
  halfOpen,
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
  if (halfOpen && height > width) {
    const hinge = horizontalFold(fold, content) ?? {x: 0, y: height / 2, width, height: 0}
    return {kind: "stacked", ...splitAt(content, hinge, aspect), toolbar: "bottomRail"}
  }
  const stackedToolbar = rail ? "rail" : "panel"
  const crease = horizontalFold(fold, content)
  if (crease) {
    const split = splitAt(content, crease, aspect)
    if (split.panel.height >= MIN_PANEL_HEIGHT) return {kind: "stacked", ...split, toolbar: stackedToolbar}
  }

  const videoHeight = content.width / aspect
  const below = content.height - videoHeight - PANEL_GAP
  if (below >= MIN_PANEL_HEIGHT) {
    const video: Rect = {x: content.x, y: content.y, width: content.width, height: videoHeight}
    const panel: Rect = {x: content.x, y: content.y + videoHeight + PANEL_GAP, width: content.width, height: below}
    if (!rail) return {kind: "stacked", video, panel, toolbar: stackedToolbar, trackpadAspect: TRACKPAD_ASPECT}
    const trackpad = centredTrackpad(panel, video.y + video.height, height)
    return {kind: "stacked", video, panel, toolbar: stackedToolbar, trackpad}
  }

  const video = fitInside(content, aspect)
  const spare = (content.width - video.width) / 2
  const toolbar = rail ? "rail" : spare >= SIDE_TOOLBAR_WIDTH ? "side" : "floating"
  return {kind: "overlay", video, toolbar}
}
