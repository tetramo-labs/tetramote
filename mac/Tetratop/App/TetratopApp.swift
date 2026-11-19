import SwiftUI

@main
struct TetratopApp: App {
  @StateObject private var controller = HostController()
  @StateObject private var updates = Updates(
    start: !UserDefaults.standard.bool(forKey: "TetratopTestPattern")
  )

  var body: some Scene {
    MenuBarExtra {
      MenuView()
        .environmentObject(controller)
        .environmentObject(updates)
        .fontDesign(.rounded)
    } label: {
      Image(systemName: controller.isConnected ? "macbook.and.iphone" : "macbook")
    }
    .menuBarExtraStyle(.window)
  }
}
