export class RestrictedMemoryFactPersistenceError extends Error {
  constructor() {
    super('memory_fact_restricted_content');
    this.name = 'RestrictedMemoryFactPersistenceError';
  }
}
