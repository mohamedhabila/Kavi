import ExpoModulesCore

internal struct SshEndpointRecord: Record {
  @Field(.required) var host: String
  @Field(.required) var port: Int
}

internal struct SshHostKeyRecord: Record {
  @Field(.required) var algorithm: String
  @Field(.required) var publicKeyBase64: String
  @Field(.required) var fingerprintSha256: String
}

internal enum SshAuthenticationKind: String, Enumerable {
  case password
  case privateKey = "private-key"
}

internal struct SshAuthenticationRecord: Record {
  @Field(.required) var kind: SshAuthenticationKind = .password
  @Field var password: String?
  @Field var privateKey: String?
  @Field var passphrase: String?
}

internal struct DiscoverHostKeyRequestRecord: Record {
  @Field(.required) var endpoint: SshEndpointRecord
  @Field(.required) var timeoutMs: Int
}

internal struct ConnectVerifiedRequestRecord: Record {
  @Field(.required) var endpoint: SshEndpointRecord
  @Field(.required) var username: String
  @Field(.required) var authentication: SshAuthenticationRecord
  @Field(.required) var expectedHostKey: SshHostKeyRecord
  @Field(.required) var timeoutMs: Int
}

internal struct ExecRequestRecord: Record {
  @Field(.required) var connectionId: String
  @Field(.required) var command: String
  @Field(.required) var timeoutMs: Int
  @Field(.required) var outputLimitBytes: Int
}

internal struct DisconnectRequestRecord: Record {
  @Field(.required) var connectionId: String
  @Field(.required) var timeoutMs: Int
}
