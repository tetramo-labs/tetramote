require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'TetraRemote'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.author         = 'Tetramo'
  s.homepage       = 'https://tetramo.com'
  s.platforms      = { :ios => '17.0' }
  s.swift_version  = '5.9'
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # TetraCore.xcframework and include/ come from scripts/build-core.sh ios.
  s.source_files = '*.swift'
  s.preserve_paths = 'include/**/*'
  s.vendored_frameworks = 'TetraCore.xcframework'
  s.frameworks = 'AVFoundation', 'AudioToolbox', 'CoreFoundation', 'CoreMedia', 'GameController', 'Network', 'Security', 'SystemConfiguration', 'VideoToolbox'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_INCLUDE_PATHS' => '$(PODS_TARGET_SRCROOT)/include'
  }
end
