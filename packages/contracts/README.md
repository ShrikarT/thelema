> Continuation note: consult current docs/CONTRACTS.md or docs/AUTOMATION.md first. Later source corrections supersede this imported draft.

# THELEMA contracts

Self-contained Solidity 0.8.24 implementation for Arc Testnet (chain ID 5042002). No external Solidity imports are required.

- Sources: `src/`
- Interfaces: `src/interfaces/IImpact.sol`
- Tests: `test/Impact.t.sol` (minimal cheatcode interface; no forge-std)
- Deployment script: `script/Deploy.s.sol` (no forge-std)
- Web ABI mirror: `abi/IImpact.json`
- Integration and formulas: `../../docs/CONTRACTS.md`
- Review notes: `../../docs/contract-review.md`

This package was produced without an available Solidity compiler or Foundry installation. It must be compiled and tested before use.
