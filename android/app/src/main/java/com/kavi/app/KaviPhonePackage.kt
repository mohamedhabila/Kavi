package com.kavi.mobile

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager
import com.kavi.mobile.phone.KaviPhoneModule

class KaviPhonePackage : ReactPackage {
  @Deprecated("ReactPackage#createNativeModules is deprecated upstream; legacy-package registration is still required here.")
  @Suppress("DEPRECATION")
  override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> =
    listOf(KaviPhoneModule(reactContext))

  @Deprecated("ReactPackage#createViewManagers is deprecated upstream; this package has no views.")
  @Suppress("DEPRECATION")
  override fun createViewManagers(
    reactContext: ReactApplicationContext,
  ): List<ViewManager<*, *>> = emptyList()
}
