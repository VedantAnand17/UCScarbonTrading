// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Script, console2} from "forge-std/Script.sol";
import {TradeAnchor} from "../src/TradeAnchor.sol";

contract DeployTradeAnchor is Script {
    function run() external returns (TradeAnchor deployed) {
        uint256 deployerKey = vm.envUint("ANCHOR_PRIVATE_KEY");
        address owner = vm.envOr("TRADE_ANCHOR_OWNER", vm.addr(deployerKey));
        vm.broadcast(deployerKey);
        deployed = new TradeAnchor(owner);
        console2.log("TradeAnchor:", address(deployed));
    }
}
