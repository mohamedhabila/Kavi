require 'json'

package = JSON.parse(File.read(File.join(__dir__, '..', 'package.json')))

Pod::Spec.new do |s|
  s.name           = 'KaviSsh'
  s.version        = package['version']
  s.summary        = package['description']
  s.description    = package['description']
  s.license        = package['license']
  s.homepage       = 'https://github.com/mohamedhabila/Kavi'
  s.author         = 'Kavi contributors'
  s.source         = { :git => 'https://github.com/mohamedhabila/Kavi.git', :tag => s.version.to_s }
  s.platforms      = { :ios => '15.1' }
  s.swift_version  = '5.9'
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{h,m,mm,swift}'
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }
end
