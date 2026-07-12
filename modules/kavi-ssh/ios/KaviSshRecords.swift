import ExpoModulesCore

internal struct SshEndpointRecord: Record {
  @Field var host: String
  @Field var port: Int
}

internal struct SshHostKeyRecord: Record {
  @Field var algorithm: String
  @Field var publicKeyBase64: String
  @Field var fingerprintSha256: String
}

internal enum SshAuthenticationKind: String, Enumerable {
  case password
  case privateKey = "private-key"
}

internal struct SshAuthenticationRecord: Record {
  @Field var kind: SshAuthenticationKind
  @Field var password: String?
  @Field var privateKey: String?
  @Field var passphrase: String?
}

internal struct DiscoverHostKeyRequestRecord: Record {
  @Field var endpoint: SshEndpointRecord
  @Field var timeoutMs: Int
}

internal struct ConnectVerifiedRequestRecord: Record {
  @Field var endpoint: SshEndpointRecord
  @Field var username: String
  @Field var authentication: SshAuthenticationRecord
  @Field var expectedHostKey: SshHostKeyRecord
  @Field var timeoutMs: Int
}

internal struct ExecRequestRecord: Record {
  @Field var connectionId: String
  @Field var command: String
  @Field var timeoutMs: Int
  @Field var outputLimitBytes: Int
}

internal struct DisconnectRequestRecord: Record {
  @Field var connectionId: String
  @Field var timeoutMs: Int
}
