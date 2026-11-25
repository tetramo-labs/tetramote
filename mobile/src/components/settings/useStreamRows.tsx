import {useState, type ReactElement} from "react"

import {Row, ToggleRow} from "@/components/ui/Rows"
import {Segmented} from "@/components/ui/Segmented"
import {Slider} from "@/components/ui/Slider"
import {applyStreamSettings} from "@/services/remote"
import {useSetting} from "@/stores/settings"

/** The resolution, frame rate and bitrate rows, as Group children, applied to a live session as they change. */
export function useStreamRows(): ReactElement[] {
  const [resolution, setResolution] = useSetting("stream_resolution")
  const [fps, setFps] = useSetting("stream_fps")
  const [bitrateAuto, setBitrateAuto] = useSetting("stream_bitrate_auto")
  const [bitrate, setBitrate] = useSetting("stream_bitrate_mbps")
  const [bitratePreview, setBitratePreview] = useState<number | null>(null)

  const rows = [
    <Row
      key="resolution"
      labelTx="settings:resolution"
      below={
        <Segmented
          value={resolution}
          onChange={(value) => {
            setResolution(value)
            applyStreamSettings()
          }}
          options={[
            {value: "auto", tx: "settings:resolutionAuto"},
            {value: "640", tx: "settings:resolution360"},
            {value: "854", tx: "settings:resolution480"},
            {value: "1280", tx: "settings:resolution720"},
            {value: "1920", tx: "settings:resolution1080"},
            {value: "2560", tx: "settings:resolution1440"},
          ]}
        />
      }
    />,
    <Row
      key="fps"
      labelTx="settings:maxFps"
      below={
        <Segmented
          value={fps}
          onChange={(value) => {
            setFps(value)
            applyStreamSettings()
          }}
          options={[
            {value: "5", tx: "settings:fps5"},
            {value: "15", tx: "settings:fps15"},
            {value: "30", tx: "settings:fps30"},
            {value: "60", tx: "settings:fps60"},
            {value: "120", tx: "settings:fps120"},
          ]}
        />
      }
    />,
    <ToggleRow
      key="bitrateAuto"
      labelTx="settings:bitrateAuto"
      value={bitrateAuto}
      onValueChange={(value) => {
        setBitrateAuto(value)
        applyStreamSettings()
      }}
    />,
  ]
  if (bitrateAuto) return rows
  return [
    ...rows,
    <Row
      key="bitrate"
      labelTx="settings:bitrate"
      subtitleTx="settings:bitrateValue"
      subtitleOptions={{mbps: bitratePreview ?? bitrate}}
      below={
        <Slider
          value={bitrate}
          min={1}
          max={25}
          onPreview={setBitratePreview}
          onChange={(value) => {
            setBitrate(value)
            applyStreamSettings()
          }}
        />
      }
    />,
  ]
}
