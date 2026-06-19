Pod::Spec.new do |s|
  s.name = 'NMSSH'
  s.version = '2.3.1'
  s.summary = 'A clean, easy-to-use framework that wraps libssh2.'
  s.homepage = 'https://github.com/NMSSH/NMSSH'
  s.license = { :type => 'MIT' }
  s.authors = {
    'Christoffer Lejdborg' => 'hello@9muses.se',
    'Tommaso Madonia' => 'tommaso@madonia.me'
  }
  s.source = {
    :git => 'https://github.com/NMSSH/NMSSH.git',
    :tag => s.version.to_s
  }

  s.requires_arc = true
  s.platforms = { :ios => '13.4' }
  s.source_files = [
    'NMSSH',
    'NMSSH/**/*.{h,m}'
  ]
  s.public_header_files = [
    'NMSSH/*.h',
    'NMSSH/Protocols/*.h',
    'NMSSH/Config/NMSSHLogger.h'
  ]
  s.private_header_files = [
    'NMSSH/Config/NMSSH+Protected.h',
    'NMSSH/Config/socket_helper.h'
  ]
  s.libraries = 'z'
  s.frameworks = 'CFNetwork'
  s.dependency 'libssh2-iosx', '1.11.0.1'
end
