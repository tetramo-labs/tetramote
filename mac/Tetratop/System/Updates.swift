import Foundation
import Sparkle

/// Sparkle reads the appcast attached to the newest GitHub release (SUFeedURL)
/// once a day and, when allowed, installs updates in the background. Test-pattern
/// runs never start it.
@MainActor
final class Updates: ObservableObject {
  private let controller: SPUStandardUpdaterController
  private var observation: NSKeyValueObservation?
  @Published private(set) var canCheck = false
  @Published var installsAutomatically: Bool {
    didSet { controller.updater.automaticallyDownloadsUpdates = installsAutomatically }
  }

  init(start: Bool) {
    controller = SPUStandardUpdaterController(startingUpdater: start, updaterDelegate: nil, userDriverDelegate: nil)
    installsAutomatically = controller.updater.automaticallyDownloadsUpdates
    observation = controller.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] updater, _ in
      let can = updater.canCheckForUpdates
      Task { @MainActor in self?.canCheck = can }
    }
  }

  func check() {
    controller.checkForUpdates(nil)
  }

  var version: String {
    let info = Bundle.main.infoDictionary
    let short = info?["CFBundleShortVersionString"] as? String ?? "?"
    let build = info?["CFBundleVersion"] as? String ?? "?"
    return "\(short) (\(build))"
  }
}
