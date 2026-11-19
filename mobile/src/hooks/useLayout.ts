import {useWindowDimensions} from "react-native"

import {useRailSide, useSaferAreaInsets, type RailSide} from "@/contexts/SaferAreaContext"

export const REGULAR_WIDTH = 600

export interface Layout {
  width: number
  height: number
  regular: boolean
  landscape: boolean
  insetLeft: number
  insetRight: number
  rail: RailSide | null
  columnWidth: number
}

/** Sizes come from the window, never the device: an iPhone Duo resizes it on every open and close. */
export function layoutFor(width: number, height: number, left: number, right: number, rail: RailSide | null): Layout {
  const insetLeft = Math.max(0, left)
  const insetRight = Math.max(0, right)
  const safeWidth = width - insetLeft - insetRight
  return {
    width,
    height,
    regular: safeWidth >= REGULAR_WIDTH,
    landscape: width > height,
    insetLeft,
    insetRight,
    rail,
    columnWidth: Math.min(safeWidth, REGULAR_WIDTH),
  }
}

export function useLayout(): Layout {
  const {width, height} = useWindowDimensions()
  const {left, right} = useSaferAreaInsets()
  return layoutFor(width, height, left, right, useRailSide())
}
