import {requireNativeView} from "expo"
import type {ViewProps} from "react-native"

/** Renders the current session's video, aspect-fit; size it to the stream's aspect ratio. */
export const RemoteScreen = requireNativeView<ViewProps>("TetraRemote")
