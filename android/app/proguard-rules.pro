# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated
-keep class com.swmansion.reanimated.** { *; }
-keep class com.facebook.react.turbomodule.** { *; }

# Expo background task infrastructure uses reflection for these classes.
# If R8 strips or renames them, startup-time task registration can fail in
# release builds when TaskManager tries to load the headless app loader.
-keep class expo.modules.adapters.react.apploader.** { *; }
-keep class expo.modules.apploader.** { *; }
-keep class expo.modules.ExpoModulesPackageList { *; }

# expo/fetch marshals NativeRequestInit through Expo records at runtime.
# If R8 strips or renames these request/response classes, Android release
# builds fail streaming requests with NativeRequestInit cast errors.
-keep class expo.modules.fetch.** { *; }

# expo-modules-core builds NativeRequestInit converters via the Kotlin record
# and type-converter layer. The shipped consumer rules keep Record implementors,
# but this release setup still let R8 strip the converter internals
# (RecordTypeConverter, AnyType, TypeConverterProvider). When that happens,
# expo/fetch falls back to raw ReadableNativeMap arguments and release chat
# turns fail before the first tool call.
-keep class expo.modules.kotlin.records.** { *; }
-keep class expo.modules.kotlin.types.** { *; }

# LiteRT-LM's JNI conversation streaming path resolves callback methods by
# their exact JVM names (`onMessage`, `onDone`, `onError`). R8 was obfuscating
# the library's callback implementers in release builds, which made
# `nativeSendMessageAsync` abort with `NoSuchMethodError` as soon as the first
# streamed response arrived.
-keep class com.google.ai.edge.litertlm.LiteRtLmJni$JniMessageCallback { *; }
-keep class com.google.ai.edge.litertlm.LiteRtLmJni$JniInferenceCallback { *; }
-keep class * implements com.google.ai.edge.litertlm.LiteRtLmJni$JniMessageCallback { *; }
-keep class * implements com.google.ai.edge.litertlm.LiteRtLmJni$JniInferenceCallback { *; }
# LiteRT-LM also resolves SamplerConfig getters by exact JVM name inside
# nativeCreateConversation/nativeCreateSession. If R8 renames or strips them,
# release builds abort with `JNI DETECTED ERROR IN APPLICATION: mid == null`
# during on-device conversation creation.
-keep class com.google.ai.edge.litertlm.SamplerConfig { *; }
-keepclasseswithmembernames class com.google.ai.edge.litertlm.** {
	native <methods>;
}

# JSch resolves algorithms and auth handlers from string config values and
# instantiates them reflectively. R8 removed `com.jcraft.jsch.jce.Random` and
# related SSH primitives from the release build. Keep only the runtime surface
# this app actually negotiates on Android so optional desktop/server adapters
# (Pageant, AF_UNIX, SLF4J, Log4J, GSSAPI) can still be stripped.
-keep,allowoptimization class com.jcraft.jsch.CipherNone { *; }
-keep,allowoptimization class com.jcraft.jsch.DH* { *; }
-keep,allowoptimization class com.jcraft.jsch.DHE* { *; }
-keep,allowoptimization class com.jcraft.jsch.UserAuthNone { *; }
-keep,allowoptimization class com.jcraft.jsch.UserAuthPassword { *; }
-keep,allowoptimization class com.jcraft.jsch.UserAuthPublicKey { *; }
-keep,allowoptimization class com.jcraft.jsch.UserAuthKeyboardInteractive { *; }
-keep,allowoptimization class com.jcraft.jsch.bc.** { *; }
-keep,allowoptimization class com.jcraft.jsch.jbcrypt.** { *; }
-keep,allowoptimization class com.jcraft.jsch.jce.** { *; }
-keep,allowoptimization class com.jcraft.jsch.jzlib.** { *; }

# Add any project specific keep options here:
