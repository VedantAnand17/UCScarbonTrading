// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProjectRegistry} from "../src/ProjectRegistry.sol";
import {CarbonCredit} from "../src/CarbonCredit.sol";
import {Marketplace} from "../src/Marketplace.sol";

contract CarbonPlatformTest is Test {
    ProjectRegistry internal registry;
    CarbonCredit internal credit;
    Marketplace internal market;

    address internal owner     = address(0xA11CE);
    address internal developer = address(0xBEEF);
    address internal buyer     = address(0xCAFE);
    address internal treasury  = address(0xFEE5);

    uint256 internal projectId;

    function setUp() public {
        vm.startPrank(owner);
        registry = new ProjectRegistry(owner);
        credit   = new CarbonCredit(owner, address(registry));
        registry.setCreditToken(address(credit));
        market   = new Marketplace(owner, treasury, 250); // 2.5%

        projectId = registry.registerProject(
            developer,
            "Test Project",
            "Somewhere",
            "VCS VMXXXX",
            2025,
            "ipfs://test"
        );
        credit.issue(projectId, developer, 1_000);
        vm.stopPrank();
    }

    function test_RegistryTracksIssuance() public view {
        ProjectRegistry.Project memory p = registry.getProject(projectId);
        assertEq(p.totalIssued, 1_000);
        assertEq(p.totalRetired, 0);
        assertEq(credit.balanceOf(developer, projectId), 1_000);
    }

    function test_OnlyOwnerCanIssue() public {
        vm.prank(developer);
        vm.expectRevert();
        credit.issue(projectId, developer, 1);
    }

    function test_RetireBurnsAndLogs() public {
        vm.prank(developer);
        uint256 retId = credit.retire(projectId, 100, developer, "Q1 scope 1");
        assertEq(credit.balanceOf(developer, projectId), 900);

        ProjectRegistry.Project memory p = registry.getProject(projectId);
        assertEq(p.totalRetired, 100);

        CarbonCredit.Retirement memory r = credit.getRetirement(retId);
        assertEq(r.amount, 100);
        assertEq(r.beneficiary, developer);
        assertEq(r.projectId, projectId);
    }

    function test_MarketplaceHappyPath() public {
        vm.startPrank(developer);
        credit.setApprovalForAll(address(market), true);
        uint256 listingId = market.createListing(address(credit), projectId, 200, 0.01 ether);
        vm.stopPrank();

        assertEq(credit.balanceOf(address(market), projectId), 200);

        vm.deal(buyer, 5 ether);
        vm.prank(buyer);
        market.buy{value: 50 * 0.01 ether}(listingId, 50);

        assertEq(credit.balanceOf(buyer, projectId), 50);
        Marketplace.Listing memory l = market.getListing(listingId);
        assertEq(l.remaining, 150);

        // Seller got 97.5% * 0.5 ether; treasury got 2.5% * 0.5 ether
        assertEq(treasury.balance, (0.5 ether * 250) / 10_000);
        assertEq(developer.balance, 0.5 ether - (0.5 ether * 250) / 10_000);
    }

    function test_CancelListingRefunds() public {
        vm.startPrank(developer);
        credit.setApprovalForAll(address(market), true);
        uint256 listingId = market.createListing(address(credit), projectId, 200, 0.01 ether);
        market.cancelListing(listingId);
        vm.stopPrank();

        assertEq(credit.balanceOf(developer, projectId), 1_000);
        Marketplace.Listing memory l = market.getListing(listingId);
        assertFalse(l.active);
        assertEq(market.activeListingCount(), 0);
    }

    function test_BuyRevertsOnWrongPayment() public {
        vm.startPrank(developer);
        credit.setApprovalForAll(address(market), true);
        uint256 listingId = market.createListing(address(credit), projectId, 10, 0.01 ether);
        vm.stopPrank();

        vm.deal(buyer, 1 ether);
        vm.prank(buyer);
        vm.expectRevert(Marketplace.IncorrectPayment.selector);
        market.buy{value: 0.02 ether}(listingId, 5);
    }

    function test_ActiveListingsBookkeeping() public {
        vm.startPrank(developer);
        credit.setApprovalForAll(address(market), true);
        uint256 l1 = market.createListing(address(credit), projectId, 10, 1);
        uint256 l2 = market.createListing(address(credit), projectId, 10, 1);
        market.createListing(address(credit), projectId, 10, 1);
        assertEq(market.activeListingCount(), 3);
        market.cancelListing(l1);
        assertEq(market.activeListingCount(), 2);
        market.cancelListing(l2);
        assertEq(market.activeListingCount(), 1);
        vm.stopPrank();
    }
}
