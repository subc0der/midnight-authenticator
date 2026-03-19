/**
 * Witness implementations for TOTP Verifier contract.
 *
 * Witnesses provide private data to ZK circuits without revealing it on-chain.
 * The private state is stored encrypted in the extension vault.
 */

interface WitnessContext<Ledger, PrivateState> {
  ledger: Ledger;
  privateState: PrivateState;
  contractAddress: string;
}

/**
 * Private state for TOTP authentication.
 * Stored encrypted in extension, never on-chain.
 */
export interface TotpVerifierPrivateState {
  readonly secret: Uint8Array;   // 32-byte normalized secret
  readonly blinder: Uint8Array;  // 32-byte random blinding factor
}

/**
 * Create initial private state for a new account.
 */
export function createInitialPrivateState(
  secret: Uint8Array,
  blinder?: Uint8Array
): TotpVerifierPrivateState {
  if (secret.length !== 32) {
    throw new Error('Secret must be exactly 32 bytes');
  }

  const finalBlinder = blinder ?? crypto.getRandomValues(new Uint8Array(32));
  if (finalBlinder.length !== 32) {
    throw new Error('Blinder must be exactly 32 bytes');
  }

  return {
    secret: new Uint8Array(secret),
    blinder: new Uint8Array(finalBlinder),
  };
}

/**
 * Witness functions for the TOTP verifier contract.
 *
 * Each witness function receives the current context (ledger state, private state)
 * and returns a tuple: [updatedPrivateState, returnValue]
 *
 * The return value is used by the circuit but never appears on-chain.
 */
export const totpVerifierWitnesses = {
  /**
   * Provide the secret for authentication.
   * Called by the authenticate circuit.
   */
  getSecret: ({
    privateState,
  }: WitnessContext<unknown, TotpVerifierPrivateState>): [TotpVerifierPrivateState, Uint8Array] => {
    return [privateState, privateState.secret];
  },

  /**
   * Provide the blinding factor for commitment verification.
   * Called by the authenticate circuit.
   */
  getBlinder: ({
    privateState,
  }: WitnessContext<unknown, TotpVerifierPrivateState>): [TotpVerifierPrivateState, Uint8Array] => {
    return [privateState, privateState.blinder];
  },
};

export type TotpVerifierWitnesses = typeof totpVerifierWitnesses;
