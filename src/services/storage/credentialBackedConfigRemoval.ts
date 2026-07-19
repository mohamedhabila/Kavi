type CredentialBackedConfigRemoval = {
  deleteCredentials: () => Promise<void>;
  removeConfiguration: () => void;
  onCredentialDeleteFailure: () => void;
};

/** Keep retryable configuration state until its stored credentials are gone. */
export async function removeCredentialBackedConfiguration(
  input: CredentialBackedConfigRemoval,
): Promise<boolean> {
  try {
    await input.deleteCredentials();
  } catch {
    input.onCredentialDeleteFailure();
    return false;
  }

  input.removeConfiguration();
  return true;
}
