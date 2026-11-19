import SwiftUI

struct MenuView: View {
  @EnvironmentObject private var controller: HostController

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      header
      if controller.isConnected {
        sessionCard
      } else {
        pairingCard
      }
      if let error = controller.streamError {
        Text(error)
          .font(.system(size: 12))
          .foregroundStyle(Theme.destructive)
          .fixedSize(horizontal: false, vertical: true)
      }
      permissions
      phones
      settings
      HStack {
        Spacer()
        Button("Quit Tetratop") { controller.quit() }
          .buttonStyle(PillButtonStyle())
      }
    }
    .padding(16)
    .frame(width: 340)
    .background(Theme.background)
  }

  private var header: some View {
    HStack(spacing: 8) {
      Circle()
        .fill(statusColor)
        .frame(width: 8, height: 8)
      VStack(alignment: .leading, spacing: 2) {
        Text("Tetratop")
          .font(.system(size: 16, weight: .semibold))
          .foregroundStyle(Theme.foreground)
        Text(statusText)
          .font(.system(size: 12))
          .foregroundStyle(Theme.muted)
          .fixedSize(horizontal: false, vertical: true)
      }
    }
  }

  private var pairingCard: some View {
    VStack(spacing: 10) {
      if let image = controller.qrCode {
        Image(nsImage: image)
          .interpolation(.none)
          .resizable()
          .frame(width: 196, height: 196)
          .padding(10)
          .background(RoundedRectangle(cornerRadius: 12).fill(.white))
      } else {
        RoundedRectangle(cornerRadius: 12)
          .fill(Theme.background)
          .frame(width: 216, height: 216)
          .overlay(ProgressView().controlSize(.small))
      }
      Text("Scan with Tetratop on your phone to pair it with this Mac.")
        .font(.system(size: 12))
        .foregroundStyle(Theme.muted)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
      HStack(spacing: 8) {
        Button("New code") { controller.rotateSecret() }
          .buttonStyle(PillButtonStyle())
        if let url = controller.pairingURL {
          Button("Copy link") {
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(url, forType: .string)
          }
          .buttonStyle(PillButtonStyle())
        }
      }
    }
    .padding(14)
    .frame(maxWidth: .infinity)
    .background(RoundedRectangle(cornerRadius: 16).fill(Theme.surface))
  }

  private var sessionCard: some View {
    HStack(spacing: 12) {
      Image(systemName: "iphone")
        .font(.system(size: 22))
        .foregroundStyle(Theme.primary)
      VStack(alignment: .leading, spacing: 2) {
        Text(connectedName)
          .font(.system(size: 14, weight: .medium))
          .foregroundStyle(Theme.foreground)
        Text(pathText)
          .font(.system(size: 12))
          .foregroundStyle(Theme.muted)
      }
      Spacer()
      Button("Disconnect") { controller.disconnect() }
        .buttonStyle(PillButtonStyle(kind: .destructive))
    }
    .padding(14)
    .background(RoundedRectangle(cornerRadius: 16).fill(Theme.surface))
  }

  private var permissions: some View {
    VStack(alignment: .leading, spacing: 2) {
      GroupTitle(text: "Permissions")
      GroupedRow(isFirst: true, isLast: false) {
        permissionRow(
          title: "Screen Recording", detail: "Lets your phone see this screen.",
          granted: controller.screenRecording, action: controller.requestScreenRecording
        )
      }
      GroupedRow(isFirst: false, isLast: true) {
        permissionRow(
          title: "Accessibility", detail: "Lets your phone move the pointer and type.",
          granted: controller.accessibility, action: controller.requestAccessibility
        )
      }
    }
  }

  private func permissionRow(title: String, detail: String, granted: Bool, action: @escaping () -> Void) -> some View {
    HStack {
      VStack(alignment: .leading, spacing: 2) {
        Text(title)
          .font(.system(size: 13))
          .foregroundStyle(Theme.foreground)
        Text(detail)
          .font(.system(size: 11))
          .foregroundStyle(Theme.muted)
      }
      Spacer()
      if granted {
        Image(systemName: "checkmark.circle.fill")
          .foregroundStyle(Theme.success)
      } else {
        Button("Allow", action: action)
          .buttonStyle(PillButtonStyle(kind: .primary))
      }
    }
  }

  private var phones: some View {
    VStack(alignment: .leading, spacing: 2) {
      GroupTitle(text: "Paired phones")
      if controller.phones.isEmpty {
        GroupedRow(isFirst: true, isLast: true) {
          Text("No phones yet.")
            .font(.system(size: 13))
            .foregroundStyle(Theme.muted)
        }
      }
      ForEach(Array(controller.phones.enumerated()), id: \.element.id) { index, phone in
        GroupedRow(isFirst: index == 0, isLast: index == controller.phones.count - 1) {
          HStack {
            VStack(alignment: .leading, spacing: 2) {
              Text(phone.name)
                .font(.system(size: 13))
                .foregroundStyle(Theme.foreground)
              Text("Paired \(phone.pairedAt.formatted(date: .abbreviated, time: .omitted))")
                .font(.system(size: 11))
                .foregroundStyle(Theme.muted)
            }
            Spacer()
            Button("Remove") { controller.remove(phone) }
              .buttonStyle(PillButtonStyle(kind: .destructive))
          }
        }
      }
    }
  }

  private var settings: some View {
    VStack(alignment: .leading, spacing: 2) {
      GroupTitle(text: "Settings")
      GroupedRow(isFirst: true, isLast: false) {
        VStack(alignment: .leading, spacing: 6) {
          Text("Relay")
            .font(.system(size: 13))
            .foregroundStyle(Theme.foreground)
          HStack(spacing: 8) {
            TextField("Public n0 relays", text: $controller.relayURL)
              .textFieldStyle(.roundedBorder)
              .font(.system(size: 12))
              .onSubmit { controller.applyRelay() }
            Button("Apply") { controller.applyRelay() }
              .buttonStyle(PillButtonStyle())
          }
          Text("Used when your phone can't reach this Mac directly. Leave empty for the public n0 relays.")
            .font(.system(size: 11))
            .foregroundStyle(Theme.muted)
            .fixedSize(horizontal: false, vertical: true)
        }
      }
      GroupedRow(isFirst: false, isLast: true) {
        Toggle(isOn: Binding(get: { controller.launchAtLogin }, set: { controller.setLaunchAtLogin($0) })) {
          Text("Open at login")
            .font(.system(size: 13))
            .foregroundStyle(Theme.foreground)
        }
        .toggleStyle(.switch)
        .controlSize(.small)
        .tint(Theme.primary)
      }
    }
  }

  private var statusColor: Color {
    switch controller.status {
    case .connected: Theme.success
    case .waiting: Theme.primary
    case .starting: Theme.muted
    case .failed: Theme.destructive
    }
  }

  private var statusText: String {
    switch controller.status {
    case .starting: "Starting…"
    case .waiting: "Waiting for a phone"
    case let .connected(name, _, _): "Connected to \(name)"
    case let .failed(message): message
    }
  }

  private var connectedName: String {
    if case let .connected(name, _, _) = controller.status {
      return name
    }
    return ""
  }

  private var pathText: String {
    guard case let .connected(_, path, rtt) = controller.status else { return "" }
    let kind = path == "relay" ? "Relay" : path == "direct" ? "Direct" : "Connecting"
    guard let rtt else { return kind }
    return "\(kind) · \(rtt) ms"
  }
}
