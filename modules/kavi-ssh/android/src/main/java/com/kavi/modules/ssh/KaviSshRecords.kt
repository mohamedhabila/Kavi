package com.kavi.modules.ssh

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.Enumerable

internal class SshEndpointRecord : Record {
  @Field
  lateinit var host: String

  @Field
  var port: Int = 0
}

internal class SshHostKeyRecord : Record {
  @Field
  lateinit var algorithm: String

  @Field
  lateinit var publicKeyBase64: String

  @Field
  lateinit var fingerprintSha256: String
}

internal enum class SshAuthenticationKind(val value: String) : Enumerable {
  PASSWORD("password"),
  PRIVATE_KEY("private-key")
}

internal class SshAuthenticationRecord : Record {
  @Field
  lateinit var kind: SshAuthenticationKind

  @Field
  var password: String? = null

  @Field
  var privateKey: String? = null

  @Field
  var passphrase: String? = null
}

internal class DiscoverHostKeyRequestRecord : Record {
  @Field
  lateinit var endpoint: SshEndpointRecord

  @Field
  var timeoutMs: Int = 0
}

internal class ConnectVerifiedRequestRecord : Record {
  @Field
  lateinit var endpoint: SshEndpointRecord

  @Field
  lateinit var username: String

  @Field
  lateinit var authentication: SshAuthenticationRecord

  @Field
  lateinit var expectedHostKey: SshHostKeyRecord

  @Field
  var timeoutMs: Int = 0
}

internal class ExecRequestRecord : Record {
  @Field
  lateinit var connectionId: String

  @Field
  lateinit var command: String

  @Field
  var timeoutMs: Int = 0

  @Field
  var outputLimitBytes: Int = 0
}

internal class DisconnectRequestRecord : Record {
  @Field
  lateinit var connectionId: String

  @Field
  var timeoutMs: Int = 0
}
