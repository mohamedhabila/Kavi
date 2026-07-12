# Kavi SSH native module

This directory defines the replacement SSH boundary as an Expo Module. Expo
discovers the local native skeleton, but no production JavaScript path consumes
it. Both native implementations reject every operation with
`ERR_SSH_NATIVE_NOT_READY`. There is no bridge to the existing SSH package and
no compatibility fallback.

The four operations below are the first final-form subset, not the complete
replacement. Final-form interactive shell and SFTP operations must be added and
pass their native black-box contracts before the app switches atomically from
the current transport. Production code must never mix the two implementations.

## Public contract

The API has four operations:

1. `discoverHostKey` performs an unauthenticated SSH transport handshake and
   returns the negotiated algorithm, the base64 SSH wire-format public-key
   blob, and its canonical OpenSSH SHA-256 fingerprint.
2. `connectVerified` requires that exact host-key triple and one explicit
   authentication method. It has no unverified variant.
3. `exec` returns stdout and stderr separately, plus either a remote exit code
   or a terminating signal. Every request has a timeout and an output bound.
4. `disconnect` closes channels and transport resources. It is idempotent for
   every connection ID issued by the module; later execution fails with
   `ERR_SSH_CONNECTION_CLOSED`.

`fingerprintSha256` is `SHA256:` followed by the unpadded base64 SHA-256 digest
of the decoded SSH wire-format key blob. MD5 and colon-delimited fingerprints
are outside this contract. OpenSSH documents SHA-256 as its normal fingerprint
form in [`ssh-keygen(1)`](https://man.openbsd.org/ssh-keygen), and its reference
implementation is maintained in
[`sshkey.c`](https://github.com/openssh/openssh-portable/blob/master/sshkey.c).

## Required native security properties

An implementation is not ready to replace the current transport until all of
these are true on iOS and Android:

- Host-key comparison uses the raw key blob, algorithm, and canonical SHA-256
  fingerprint with exact, constant-time comparisons where available.
- The server host key is validated before any password, private key,
  passphrase, signature, or other user-authentication material is sent.
- A mismatch rejects with `ERR_SSH_HOST_KEY_MISMATCH`; it never downgrades to
  trust-on-first-use, an unverified session, MD5, or a different host key.
- Connections and channels have bounded setup, execution, output, and teardown
  paths. App/module destruction closes every live native resource.
- Secrets, commands, output, key material, and host identifiers are not logged.
- `exec` preserves stdout, stderr, exit status, and signal independently.
- The module retains a bounded closed-session tombstone so repeated disconnect
  is deterministic while fabricated connection IDs still reject with
  `ERR_SSH_CONNECTION_NOT_FOUND`.

## OpenSSH black-box contract

`contract/run-open-ssh-contract.mjs` is provider-neutral. An adapter module must
export a default object, or `createAdapter({ fixture })`, implementing the four
methods from `src/KaviSsh.types.ts`. Point it at an isolated OpenSSH fixture
whose credentials and host key are disposable.

The fixture JSON shape is:

```json
{
  "endpoint": { "host": "127.0.0.1", "port": 2222 },
  "username": "kavi-contract",
  "timeoutMs": 15000,
  "authentication": {
    "kind": "private-key",
    "privateKeyEnv": "KAVI_SSH_CONTRACT_PRIVATE_KEY",
    "passphraseEnv": "KAVI_SSH_CONTRACT_PASSPHRASE"
  },
  "expectedHostKey": {
    "algorithm": "ssh-ed25519",
    "publicKeyBase64": "<base64 SSH wire key from the fixture>",
    "fingerprintSha256": "SHA256:<43 unpadded base64 characters>"
  },
  "exec": {
    "command": "printf 'contract-stdout\\n'; printf 'contract-stderr\\n' >&2; exit 23",
    "outputLimitBytes": 4096,
    "expected": {
      "stdout": "contract-stdout\n",
      "stderr": "contract-stderr\n",
      "exitCode": 23,
      "signal": null
    }
  }
}
```

Run the harness without placing credentials in the fixture or command line:

```sh
node modules/kavi-ssh/contract/run-open-ssh-contract.mjs \
  --adapter /absolute/path/to/adapter.mjs \
  --fixture /absolute/path/to/fixture.json
```

It independently hashes the discovered wire key, attempts a deliberately wrong
pin, verifies the correct connection and exec result, disconnects twice, and
proves that execution after disconnect fails closed. The harness report never
contains authentication material. `node modules/kavi-ssh/contract/self-test.mjs`
tests the harness itself against a deterministic in-memory adapter and the
published GitHub Ed25519 host-key vector.
