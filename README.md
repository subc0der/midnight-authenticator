# Midnight Authenticator

> Built on the [Midnight Network](https://midnight.network)

Zero-knowledge TOTP authenticator for the Midnight blockchain.

**Prove you have the right code without showing it.**

Midnight Authenticator enables users to prove they possess a valid time-based one-time password without revealing the underlying secret or the code itself. It's privacy-preserving 2FA that doesn't leak secrets to verifiers.

## Status

**Phase 4: ZK Integration** - Active Development

| Component | Status | Notes |
|-----------|--------|-------|
| Compact Contract | Compiled | `totp-verifier.compact` with 3 circuits |
| TypeScript Bindings | Generated | Full type-safe API |
| Chrome Extension | MVP | Encrypted vault, TOTP generation |
| Proof Server | Running | Docker container on port 6300 |
| Preprod Deployment | Pending | Next milestone |

## Features

- Zero-knowledge TOTP authentication
- Encrypted local vault (Argon2id + AES-256-GCM)
- RFC 6238 compatible TOTP generation
- Chrome extension (Manifest V3)
- Real-time countdown timer
- Click-to-copy codes
- Auto-lock security timer
- Dark theme UI

## How It Works

### Traditional TOTP Problem
- Service stores shared secrets (can be leaked)
- Codes transmitted in plaintext (can be intercepted)
- Service knows exact authentication times

### ZK Solution
- User proves: "I know secret S such that TOTP(S, T) is valid"
- Service only learns: "user authenticated successfully"
- Secret never leaves the user's device
- Code never transmitted

## Packages

```
packages/
  contracts/        Compact smart contracts (ZK circuits)
  core/             Core SDK and proof generation
  extension/        Chrome extension (wallet + authenticator)
```

## Installation

### Prerequisites

- Node.js 18+
- pnpm 9+
- Docker (for proof server)
- WSL (Windows only, for Compact CLI)

### Setup

```bash
git clone https://github.com/subc0der/midnight-authenticator.git
cd midnight-authenticator
pnpm install
```

### Start Proof Server

```bash
docker run -d --name proof-server -p 6300:6300 \
  midnightntwrk/proof-server:7.0.0 midnight-proof-server -v

# Verify it's running
curl http://localhost:6300/version
```

### Build

```bash
# Build all packages
pnpm build

# Build contracts only (requires WSL on Windows)
pnpm build:contracts

# Build extension
pnpm --filter @midnight-authenticator/extension build
```

### Load Extension

1. Open Chrome and navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `packages/extension/dist`

## Quick Start

### Test TOTP Generation

After loading the extension:

1. Click the extension icon
2. Create a vault password
3. Add an account:
   - Issuer: `Google`
   - Name: `test@example.com`
   - Secret: `JBSWY3DPEHPK3PXP`
4. Click the account to reveal the TOTP code
5. Verify it matches Google Authenticator

## Contract Architecture

The `totp-verifier.compact` contract provides:

| Circuit | Purpose |
|---------|---------|
| `registerAccount` | Register commitment on-chain |
| `authenticate` | Prove knowledge of secret for time window |
| `isRegistered` | Check if account exists |
| `computeAuthCode` | Pure circuit for client-side code generation |

### Security Model

- **Commitment**: `persistentCommit(secret, blinder)` stored on-chain
- **Auth Proof**: `persistentHash(authCode, blinder, nonce)` for unlinkability
- **Time Window**: Public input from verifier (30-second intervals)
- **Replay Protection**: Monotonic nonce per account

## Technology

| Layer | Technology |
|-------|------------|
| Smart Contracts | Compact (Midnight ZK language) |
| Extension | React + Vite, Chrome MV3 |
| Encryption | Argon2id + AES-256-GCM |
| ZK Proofs | Midnight proof server |
| Network | Midnight Preprod (Mainnet planned) |

## Project Structure

```
midnight-authenticator/
  packages/
    contracts/              Compact contracts
      src/
        totp-verifier.compact   ZK TOTP verification
        managed/                Compiled output (zkir, keys, TS bindings)
    core/                   Core SDK
      src/
        index.ts            Exports and utilities
    extension/              Chrome extension
      src/
        popup/              React UI
        background/         Service worker (TOTP, vault)
        content/            Page integration
```

## Development

### Compile Contracts (WSL required on Windows)

```bash
cd packages/contracts
pnpm compile
```

### Run Extension in Dev Mode

```bash
cd packages/extension
pnpm dev
```

### Run Tests

```bash
pnpm test
```

## Roadmap

1. **Phase 1: Research & Foundation** - Complete
   - ZK-compatible TOTP approach using `persistentHash`
   - Circuit architecture design
   - Monorepo setup

2. **Phase 2: Core Circuits** - Complete
   - `totp-verifier.compact` with security reviews
   - Compact CLI compilation
   - TypeScript bindings

3. **Phase 3: Extension MVP** - Complete
   - Encrypted vault
   - TOTP generation (RFC 6238)
   - Account management UI

4. **Phase 4: ZK Integration** - In Progress
   - Deploy to Preprod
   - Real ZK proof generation
   - Demo verifier dApp

5. **Phase 5: Production**
   - QR code scanning
   - Security audit
   - Mainnet deployment
   - Chrome Web Store submission

## Resources

- [Midnight Developer Docs](https://docs.midnight.network/develop/tutorial)
- [Compact Language](https://docs.midnight.network/develop/tutorial/high-level-arch)
- [RFC 6238 (TOTP)](https://datatracker.ietf.org/doc/html/rfc6238)

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
