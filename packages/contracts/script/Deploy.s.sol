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
}

contract Deploy {
    Vm constant vm=Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant ARC_USDC=0x3600000000000000000000000000000000000000;
    uint256 constant ARC_CHAIN_ID=5042002;
    event Deployment(address oracle,address binaryVault,address shareVault,address binaryAmm,address yesShareAmm,address noShareAmm);

    function run() external {
        require(block.chainid==ARC_CHAIN_ID,"wrong chain");
        address owner=vm.envAddress("OWNER"); address feeRecipient=vm.envAddress("FEE_RECIPIENT"); uint256 feeBps=vm.envUint("FEE_BPS");
        require(feeBps == 30, "THELEMA app expects 30 basis points");

        uint256 cap6 = vm.envOr("CAP6", 500e6);
        uint256 eventDeadline = vm.envOr("EVENT_DEADLINE", 1798761599);
        uint256 tradingCutoff = vm.envOr("TRADING_CUTOFF", 1798847999);
        uint256 earliestPriceFix = vm.envOr("EARLIEST_PRICE_FIX", 1798847999);

        vm.startBroadcast();
        DemoOracle oracle=new DemoOracle(owner);
        BinaryVault binary=new BinaryVault(ARC_USDC,address(oracle),eventDeadline,tradingCutoff);
        ShareVault shares=new ShareVault(ARC_USDC,address(oracle),cap6,eventDeadline,tradingCutoff,earliestPriceFix);
        BinaryAMM binaryAmm=new BinaryAMM(binary,feeRecipient,feeBps);
        ShareAMM yesAmm=new ShareAMM(ARC_USDC,address(shares.yesShare()),address(shares),feeBps,"ysLP");
        ShareAMM noAmm=new ShareAMM(ARC_USDC,address(shares.noShare()),address(shares),feeBps,"nsLP");
        emit Deployment(address(oracle),address(binary),address(shares),address(binaryAmm),address(yesAmm),address(noAmm));
        vm.stopBroadcast();
    }
}
