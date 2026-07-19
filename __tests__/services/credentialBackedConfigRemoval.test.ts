import { removeCredentialBackedConfiguration } from '../../src/services/storage/credentialBackedConfigRemoval';

describe('removeCredentialBackedConfiguration', () => {
  it('removes configuration only after credential deletion settles', async () => {
    let settleDeletion: (() => void) | undefined;
    const deleteCredentials = jest.fn(
      () =>
        new Promise<void>((resolve) => {
          settleDeletion = resolve;
        }),
    );
    const removeConfiguration = jest.fn();

    const removal = removeCredentialBackedConfiguration({
      deleteCredentials,
      removeConfiguration,
      onCredentialDeleteFailure: jest.fn(),
    });

    expect(removeConfiguration).not.toHaveBeenCalled();
    settleDeletion?.();
    await expect(removal).resolves.toBe(true);
    expect(removeConfiguration).toHaveBeenCalledTimes(1);
  });

  it('keeps configuration and reports a content-free failure when deletion fails', async () => {
    const removeConfiguration = jest.fn();
    const onCredentialDeleteFailure = jest.fn();

    await expect(
      removeCredentialBackedConfiguration({
        deleteCredentials: async () => {
          throw new Error('private platform detail');
        },
        removeConfiguration,
        onCredentialDeleteFailure,
      }),
    ).resolves.toBe(false);

    expect(removeConfiguration).not.toHaveBeenCalled();
    expect(onCredentialDeleteFailure).toHaveBeenCalledTimes(1);
  });
});
