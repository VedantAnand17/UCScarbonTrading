// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ProjectRegistry} from "../src/ProjectRegistry.sol";
import {CarbonCredit} from "../src/CarbonCredit.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {OffsetRouter} from "../src/OffsetRouter.sol";

/// @notice End-to-end deployment of the UCS carbon trading platform. Designed
///         for both local anvil and Sepolia. The deployer address becomes the
///         platform owner/verifier, the credit minter, and the marketplace
///         treasury.
///
///         Optionally seeds the deployment with two demo projects and some
///         minted credits when SEED=1 is set in the environment so the UI has
///         something to show immediately after deploy.
contract Deploy is Script {
    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);

        uint16 feeBps = uint16(vm.envOr("FEE_BPS", uint256(250))); // 2.5%
        address treasury = vm.envOr("TREASURY", deployer);
        bool seed = vm.envOr("SEED", uint256(0)) == 1;

        console2.log("Deployer:", deployer);
        console2.log("Treasury:", treasury);
        console2.log("Fee bps :", feeBps);

        vm.startBroadcast(pk);

        ProjectRegistry registry = new ProjectRegistry(deployer);
        CarbonCredit credit = new CarbonCredit(deployer, address(registry));
        registry.setCreditToken(address(credit));

        Marketplace market = new Marketplace(deployer, treasury, feeBps);
        OffsetRouter router = new OffsetRouter(address(market), address(credit));

        if (seed) {
            uint256 p1 = registry.registerProject(
                deployer,
                "Kasigau Corridor REDD+",
                "Kenya",
                "VCS VM0009",
                2024,
                "ipfs://bafkreigh2akiscaildc3zephrs5fqgenqwvcqyvwh2m4a3ifb2kgn6g7ba"
            );
            uint256 p2 = registry.registerProject(
                deployer,
                "Amazon Rainforest Conservation",
                "Brazil",
                "VCS VM0007 REDD+",
                2025,
                "ipfs://bafkreidj3z4xyp2qkcpbgpwb6rrtexisqd2z7spy27yjxh3tkrfmhfaoaa"
            );
            credit.issue(p1, deployer, 1_000);
            credit.issue(p2, deployer, 500);
            console2.log("Seeded project 1 id:", p1);
            console2.log("Seeded project 2 id:", p2);
        }

        vm.stopBroadcast();

        console2.log("ProjectRegistry:", address(registry));
        console2.log("CarbonCredit   :", address(credit));
        console2.log("Marketplace    :", address(market));
        console2.log("OffsetRouter   :", address(router));

        _writeDeployJson(address(registry), address(credit), address(market), address(router));
    }

    function _writeDeployJson(address registry, address credit, address market, address router) internal {
        string memory chainId = vm.toString(block.chainid);
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', chainId, ",\n",
            '  "projectRegistry": "', vm.toString(registry), '",\n',
            '  "carbonCredit": "', vm.toString(credit), '",\n',
            '  "marketplace": "', vm.toString(market), '",\n',
            '  "offsetRouter": "', vm.toString(router), '"\n',
            "}\n"
        );
        string memory path = string.concat("deployments/", chainId, ".json");
        vm.writeFile(path, json);
        console2.log("Wrote", path);
    }
}
