# Compiler regression fixes

The first hosted run passed the full app TypeScript check, 158 Node tests, 2 genuine EIP-191 signer tests, 17 browser checks, Solidity compilation and a real public Arc RPC/USDC-decimals probe. Four Solidity tests and CRE compilation failed; they were not marked passed.

## Settlement test setup
Nested public token getters consumed Foundry's next-call prank/expectation before redeem was called. Token addresses are now cached before those cheatcodes. Losing-token tests require the precise WrongToken selector. Fractional redemption asserts both the intended caller's balance increase and token burn. Added cross-account/double-redemption and binary/share zero-payout dust regressions. No production contract code was changed to hide failures.

## CRE runtime types
TEE-native HTTP does not permit DON cache settings; removed them rather than casting away the error. The compiler configuration now follows the upstream SDK customer environment at commit b4dbdc0780a7397481686f4d7d3b7438b9c76260, packages/cre-sdk-examples/tsconfig.json. types:[] avoids auto-injecting Bun/Node globals. Strict workflow checking and the compiler's runtime compatibility validation remain enabled. skipLibCheck:true is the upstream-supported setting for restricted ambient declarations; this is not an audit of third-party declaration files. No fake typings, ts-ignore, any-cast workaround or --skip-typechecks flag was used.

These corrections require a new successful run before being considered verified. Compile success remains distinct from deployment, confidential execution and human release approval.
