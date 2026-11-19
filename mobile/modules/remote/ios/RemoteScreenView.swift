import AVFoundation
import ExpoModulesCore
import UIKit

final class DisplayLayerView: UIView {
  override class var layerClass: AnyClass { AVSampleBufferDisplayLayer.self }

  var displayLayer: AVSampleBufferDisplayLayer { layer as! AVSampleBufferDisplayLayer }
}

final class RemoteScreenView: ExpoView {
  private let display = DisplayLayerView()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    backgroundColor = .black
    clipsToBounds = true
    display.displayLayer.videoGravity = .resizeAspect
    display.isUserInteractionEnabled = false
    addSubview(display)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    display.frame = bounds
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if window != nil {
      RemoteSession.shared.video.attach(display.displayLayer)
    } else {
      RemoteSession.shared.video.detach(display.displayLayer)
    }
  }
}
