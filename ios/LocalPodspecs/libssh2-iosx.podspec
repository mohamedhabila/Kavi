Pod::Spec.new do |s|
  s.name = 'libssh2-iosx'
  s.version = '1.11.0.1'
  s.summary = 'LIBSSH2 for iOS and iOS Simulator.'
  s.homepage = 'https://github.com/apotocki/libssh2-iosx'
  s.license = 'BSD-3-Clause License'
  s.authors = {
    'Alexander Pototskiy' => 'alex.a.potocki@gmail.com'
  }
  s.source = {
    :git => 'https://github.com/apotocki/libssh2-iosx.git',
    :tag => s.version.to_s
  }

  s.platforms = {
    :ios => '13.4'
  }
  s.static_framework = true
  s.requires_arc = false
  s.header_mappings_dir = 'frameworks/Headers'
  s.public_header_files = 'frameworks/Headers/**/*.{h,H,c}'
  s.source_files = 'frameworks/Headers/**/*.{h,H,c}'
  s.vendored_frameworks = [
    'frameworks/ssh2.xcframework',
    'frameworks/ssl.xcframework',
    'frameworks/crypto.xcframework'
  ]
  s.pod_target_xcconfig = {
    'ONLY_ACTIVE_ARCH' => 'YES'
  }

  s.prepare_command = <<~CMD
    set -e
    export OPENSSL_RELEASE_LINK="https://github.com/apotocki/openssl-iosx/releases/download/1.1.1w.3"
    rm -rf scripts/Pods/openssl-iosx
    ruby - <<'RUBY'
    path = 'scripts/build.sh'
    source = File.read(path)
    cmake_stale = 'cmake $4 -DCMAKE_OSX_ARCHITECTURES=$2 '
    cmake_fixed = 'cmake $4 -DCMAKE_POLICY_VERSION_MINIMUM=3.5 -DCMAKE_OSX_ARCHITECTURES=$2 '
    unless source.include?(cmake_fixed)
      abort('libssh2-iosx build script changed; review the local CMake compatibility patch') unless source.include?(cmake_stale)
      source = source.gsub(cmake_stale, cmake_fixed)
    end
    header_stale = "mv ssl.xcframework frameworks/\n"
    header_fixed = <<~'SH'
      mv ssl.xcframework frameworks/
      curl -L --fail https://github.com/openssl/openssl/archive/refs/tags/OpenSSL_1_1_1w.zip -o openssl-source.zip
      unzip -q openssl-source.zip
      cp frameworks/Headers/openssl/opensslconf.h opensslconf.generated.h
      cp -R openssl-OpenSSL_1_1_1w/include/openssl/. frameworks/Headers/openssl/
      mv opensslconf.generated.h frameworks/Headers/openssl/opensslconf.h
      test -f frameworks/Headers/openssl/opensslv.h
      rm -rf openssl-source.zip openssl-OpenSSL_1_1_1w
    SH
    unless source.include?('OpenSSL_1_1_1w.zip')
      abort('libssh2-iosx build script changed; review the local OpenSSL header completion patch') unless source.include?(header_stale)
      source = source.gsub(header_stale, header_fixed)
    end
    ios_build_start = <<~'SH'.strip
      generic_build ios arm64 "-sdk iphoneos" "-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_DEPLOYMENT_TARGET=$IOS_VERSION" "-fembed-bitcode" "ios-arm64"
    SH
    ios_build_end = <<~'SH'
      if [ -d $XROSSYSROOT/SDKs/XROS.sdk ]; then
          LIBARGS="$LIBARGS -library $BUILD_DIR/build.xros.arm64/src/Release-xros/libssh2.a"
      fi
    SH
    ios_only_replacement = <<~'SH'
      # Kavi iOS-only libssh2 build: this app links iOS device and simulator slices only.
      generic_build ios arm64 "-sdk iphoneos" "-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_DEPLOYMENT_TARGET=$IOS_VERSION" "-fembed-bitcode" "ios-arm64"
      generic_build ios-simulator "arm64;x86_64" "-sdk iphonesimulator" "-DCMAKE_SYSTEM_NAME=iOS -DCMAKE_OSX_DEPLOYMENT_TARGET=$IOS_SIM_VERSION -DCMAKE_XCODE_ATTRIBUTE_ONLY_ACTIVE_ARCH=NO" "-fembed-bitcode" "ios-*-simulator"

      LIBARGS="-library $BUILD_DIR/build.ios.arm64/src/Release-iphoneos/libssh2.a \
          -library $BUILD_DIR/build.ios-simulator.arm64_x86_64/src/Release-iphonesimulator/libssh2.a"

    SH
    unless source.include?('Kavi iOS-only libssh2 build')
      start_index = source.index(ios_build_start)
      abort('libssh2-iosx build script changed; review the local iOS slice patch') unless start_index
      end_index = source.index(ios_build_end, start_index)
      abort('libssh2-iosx build script changed; review the local iOS slice patch') unless end_index
      end_index += ios_build_end.length
      source = source[0...start_index] + ios_only_replacement + source[end_index..]
    end
    framework_stale = "xcodebuild -create-xcframework $LIBARGS -output $BUILD_DIR/frameworks/ssh2.xcframework\n\n"
    framework_fixed = <<~'SH'
      xcodebuild -create-xcframework $LIBARGS -output $BUILD_DIR/frameworks/ssh2.xcframework
      cp -R "$OPENSSL_PATH/ssl.xcframework" "$BUILD_DIR/frameworks/"
      cp -R "$OPENSSL_PATH/crypto.xcframework" "$BUILD_DIR/frameworks/"

    SH
    unless source.include?('crypto.xcframework" "$BUILD_DIR/frameworks/"')
      abort('libssh2-iosx build script changed; review the local OpenSSL framework vendoring patch') unless source.include?(framework_stale)
      source = source.gsub(framework_stale, framework_fixed)
    end
    File.write(path, source)
    RUBY
    sh scripts/build.sh
  CMD
end
