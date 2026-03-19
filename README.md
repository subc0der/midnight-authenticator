# Midnight Authenticator

> Built on the [Midnight Network](https://midnight.network)

Zero-knowledge authenticator for the Midnight blockchain.

**Prove you have the right code without showing it.**

Midnight Authenticator enables users to prove they possess a valid authentication code without revealing the underlying secret or the code itself. It's privacy-preserving 2FA that doesn't leak secrets to verifiers.

## Important: ZK-Native Protocol

This authenticator uses Midnight's `persistentHash` for code generation, making it a **ZK-native protocol**. It is **NOT RFC 6238 (TOTP) compatible**.

| Aspect | Standard TOTP | Midnight Authenticator |
|--------|---------------|------------------------|
| Hash function | HMAC-SHA1 | persistentHash (ZK-friendly) |
| Interoperability | Works with Google Auth, etc. | Standalone ZK system |
| Privacy | Codes transmitted in plaintext | Codes never transmitted (ZK proof instead) |
| Verification | Server compares codes | Server verifies ZK proof |

Codes displayed in this app will **NOT match** standard authenticators like Google Authenticator.

## Status

**Phase 4: ZK Integration** - Active Development

| Component | Status | Notes |
|-----------|--------|-------|
| Compact Contract | Compiled | `totp-verifier.compact` with 3 circuits |
| TypeScript Bindings | Generated | Full type-safe API |
| Chrome Extension | MVP | Encrypted vault, ZK code generation |
| Proof Server | Running | Docker container on port 6300 |
| Preprod Deployment | Pending | Next milestone |

## Features

- Zero-knowledge authentication using Midnight's ZK proof system
- ZK-native code generation (`persistentHash`)
- Encrypted local vault (Argon2id + AES-256-GCM)
- Chrome extension (Manifest V3)
- Real-time countdown timer (30-second windows)
- Click-to-copy codes
- Auto-lock security timer (5 minutes)
- Dark theme UI

## How It Works

### Traditional TOTP Problem
- Service stores shared secrets (can be leaked)
- Codes transmitted in plaintext (can be intercepted)
- Service knows exact authentication times

### ZK Solution
- User proves: "I know secret S that produces a valid auth code"
- Service only learns: "user authenticated successfully"
- Secret never leaves the user's device
- Code never transmitted - replaced by ZK proof

### Protocol Flow

1. **Registration**: User commits `persistentCommit(secret, blinder)` on-chain
2. **Authentication**: User generates ZK proof showing knowledge of secret
3. **Verification**: Contract verifies proof without learning secret or code

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

After loading the extension:

1. Click the extension icon
2. Create a vault password
3. Add an account:
   - Issuer: `TestService`
   - Name: `user@example.com`
   - Secret: `JBSWY3DPEHPK3PXP` (any Base32 string)
4. Click the account to reveal the ZK auth code
5. The code refreshes every 30 seconds

**Note**: These codes are ZK-native and will NOT match Google Authenticator.

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

### What's Private vs Public

| Data | Visibility | Notes |
|------|------------|-------|
| accountId | Public | Identifies the account |
| nonce | Public | Replay protection |
| expectedTimeWindow | Public | Verifier-provided |
| secret | **Private** | Never revealed |
| blinder | **Private** | Commitment scheme |
| authCode | **Private** | Computed but never transmitted |

## Technology

| Layer | Technology |
|-------|------------|
| Smart Contracts | Compact (Midnight ZK language) |
| Extension | React + Vite, Chrome MV3 |
| Encryption | Argon2id + AES-256-GCM |
| ZK Proofs | Midnight proof server |
| Code Generation | `persistentHash` (ZK-friendly) |
| Network | Midnight Preprod (Mainnet planned) |

## Project Structure

```
midnight-authenticator/
  packages/
    contracts/              Compact contracts
      src/
        totp-verifier.compact   ZK authentication circuit
        managed/                Compiled output (zkir, keys, TS bindings)
    core/                   Core SDK
      src/
        index.ts            Exports and utilities
    extension/              Chrome extension
      src/
        popup/              React UI
        background/         Service worker (auth code, vault)
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
   - ZK-compatible approach using `persistentHash`
   - Circuit architecture design
   - Monorepo setup

2. **Phase 2: Core Circuits** - Complete
   - `totp-verifier.compact` with security reviews
   - Compact CLI compilation
   - TypeScript bindings

3. **Phase 3: Extension MVP** - Complete
   - Encrypted vault
   - ZK auth code generation
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
- [Midnight Releases](https://releases.midnight.network/)

## License

Apache 2.0 - See [LICENSE](LICENSE) for details.
