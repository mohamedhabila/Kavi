import ExpoModulesCore

private final class SshNativeNotReadyException: Exception {
  override var code: String {
    "ERR_SSH_NATIVE_NOT_READY"
  }

  override var reason: String {
    "The verified SSH transport has not been implemented for this platform."
  }
}

public final class KaviSshModule: Module {
  public func definition() -> ModuleDefinition {
    Name("KaviSsh")

    AsyncFunction("discoverHostKey") { (_: DiscoverHostKeyRequestRecord) -> [String: Any] in
      throw SshNativeNotReadyException()
    }

    AsyncFunction("connectVerified") { (_: ConnectVerifiedRequestRecord) -> [String: Any] in
      throw SshNativeNotReadyException()
    }

    AsyncFunction("exec") { (_: ExecRequestRecord) -> [String: Any] in
      throw SshNativeNotReadyException()
    }

    AsyncFunction("disconnect") { (_: DisconnectRequestRecord) -> [String: Any] in
      throw SshNativeNotReadyException()
    }
  }
}
