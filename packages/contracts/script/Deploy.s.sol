// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DemoOracle} from "../src/DemoOracle.sol";
import {BinaryVault} from "../src/vault/BinaryVault.sol";
import {ShareVault} from "../src/vault/ShareVault.sol";
import {BinaryAMM} from "../src/amm/BinaryAMM.sol";
import {ShareAMM} from "../src/amm/ShareAMM.sol";

interface Vm {
    function startBroadcast() external;
    function stopBroadcast() external;
    function envAddress(string calldata) external returns(address);
    function envUint(string calldata) external returns(uint256);
    function envOr(string calldata, uint256) external returns(uint256);
    function envOr(string calldata, address) external returns(address);
}

contract Deploy {
    Vm constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    // Documented defaults: Arc mainnet (5042) and Arc testnet (5042002) both route native USDC via the precompile.
    address constant DEFAULT_ARC_USDC = 0x3600000000000000000000000000000000000000;
    uint256 constant DEFAULT_CHAIN_ID = 5042002;

    event Deployment(address oracle, address binaryVault, address shareVault, address binaryAmm, address yesShareAmm, address noShareAmm);

    function run() external {
        uint256 targetChainId = vm.envOr("ARC_CHAIN_ID", DEFAULT_CHAIN_ID);
        require(block.chainid == targetChainId, "wrong chain");

        address usdc = vm.envOr("ARC_USDC", DEFAULT_ARC_USDC);
        address owner = vm.envAddress("OWNER");
        require(owner != address(0), "owner cannot be zero");

        // C1 requirement: Oracle owner on mainnet (chain 5042) must be a multisig Safe, never msg.sender
        if (block.chainid == 5042) {
            require(owner != msg.sender, "Oracle owner must be a multisig Safe on mainnet, not deployer EOA");
        }

        address feeRecipient = vm.envAddress("FEE_RECIPIENT");
        uint256 feeBps = vm.envUint("FEE_BPS");
        require(feeBps == 30, "THELEMA app expects 30 basis points");

        uint256 cap6 = vm.envOr("CAP6", 500e6);
        uint256 eventDeadline = vm.envOr("EVENT_DEADLINE", 1798761599);
        uint256 tradingCutoff = vm.envOr("TRADING_CUTOFF", 1798847999);
        uint256 earliestPriceFix = vm.envOr("EARLIEST_PRICE_FIX", 1798847999);

        vm.startBroadcast();
        // 1. Deploy Vaults first (passing address(0) for oracle)
        BinaryVault binary = new BinaryVault(usdc, address(0), eventDeadline, tradingCutoff);
        ShareVault shares = new ShareVault(usdc, address(0), cap6, eventDeadline, tradingCutoff, earliestPriceFix);

        // 2. Deploy DemoOracle with existing vault addresses (stored immutably in oracle)
        DemoOracle oracle = new DemoOracle(owner, address(binary), address(shares));

        // 3. Post-deploy init: wire oracle to vaults
        binary.setOracle(address(oracle));
        shares.setOracle(address(oracle));

        // 4. Deploy AMMs
        BinaryAMM binaryAmm = new BinaryAMM(binary, feeRecipient, feeBps);
        ShareAMM yesAmm = new ShareAMM(usdc, address(shares.yesShare()), address(shares), feeBps, "ysLP");
        ShareAMM noAmm = new ShareAMM(usdc, address(shares.noShare()), address(shares), feeBps, "nsLP");

        emit Deployment(address(oracle), address(binary), address(shares), address(binaryAmm), address(yesAmm), address(noAmm));
        vm.stopBroadcast();
    }
}
