package com.kavi.modules.ssh

import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private class SshNativeNotReadyException : CodedException(
  code = "ERR_SSH_NATIVE_NOT_READY",
  message = "The verified SSH transport has not been implemented for this platform.",
  cause = null
)

private fun rejectNativeNotReady(): Map<String, Any?> {
  throw SshNativeNotReadyException()
}

class KaviSshModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("KaviSsh")

    AsyncFunction("discoverHostKey") { _: DiscoverHostKeyRequestRecord ->
      rejectNativeNotReady()
    }

    AsyncFunction("connectVerified") { _: ConnectVerifiedRequestRecord ->
      rejectNativeNotReady()
    }

    AsyncFunction("exec") { _: ExecRequestRecord ->
      rejectNativeNotReady()
    }

    AsyncFunction("disconnect") { _: DisconnectRequestRecord ->
      rejectNativeNotReady()
    }
  }
}
