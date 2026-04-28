// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ProjectRegistry} from "../src/ProjectRegistry.sol";
import {CarbonCredit} from "../src/CarbonCredit.sol";
import {Marketplace} from "../src/Marketplace.sol";
import {OffsetRouter} from "../src/OffsetRouter.sol";

contract OffsetRouterTest is Test {
    ProjectRegistry internal registry;
    CarbonCredit internal credit;
    Marketplace internal market;
    OffsetRouter internal router;

    address internal owner     = address(0xA11CE);
    address internal sellerA   = address(0xBEEF);
    address internal sellerB   = address(0xB0B);
    address internal buyer     = address(0xCAFE);
    address internal benefic   = address(0x6E7);
    address internal treasury  = address(0xFEE5);

    uint256 internal projectId;

    function setUp() public {
        vm.startPrank(owner);
        registry = new ProjectRegistry(owner);
        credit   = new CarbonCredit(owner, address(registry));
        registry.setCreditToken(address(credit));
        market   = new Marketplace(owner, treasury, 250); // 2.5%
        router   = new OffsetRouter(address(market), address(credit));

        projectId = registry.registerProject(
            sellerA, "Demo", "Earth", "VCS VMXXXX", 2025, "ipfs://x"
        );
        credit.issue(projectId, sellerA, 1_000);
        credit.issue(projectId, sellerB, 1_000);
        vm.stopPrank();

        vm.prank(sellerA);
        credit.setApprovalForAll(address(market), true);
        vm.prank(sellerB);
        credit.setApprovalForAll(address(market), true);
    }

    function _list(address seller, uint256 qty, uint256 price) internal returns (uint256 id) {
        vm.prank(seller);
        id = market.createListing(address(credit), projectId, qty, price);
    }

    function test_OffsetSingleListing() public {
        uint256 id = _list(sellerA, 100, 0.01 ether);

        uint256[] memory ids = new uint256[](1);
        uint256[] memory qty = new uint256[](1);
        ids[0] = id; qty[0] = 30;

        vm.deal(buyer, 5 ether);
        vm.prank(buyer);
        (uint256[] memory retIds, uint256 totalT, uint256 spent) =
            router.offset{value: 30 * 0.01 ether}(ids, qty, benefic, "scope 1 q1");

        assertEq(totalT, 30);
        assertEq(spent, 30 * 0.01 ether);
        assertEq(retIds.length, 1);

        // credits burned, not held by router
        assertEq(credit.balanceOf(address(router), projectId), 0);
        assertEq(credit.balanceOf(buyer, projectId), 0);

        // beneficiary index populated
        uint256[] memory bRets = credit.retirementsForBeneficiary(benefic);
        assertEq(bRets.length, 1);
        assertEq(bRets[0], retIds[0]);

        CarbonCredit.Retirement memory r = credit.getRetirement(retIds[0]);
        assertEq(r.amount, 30);
        assertEq(r.beneficiary, benefic);
        assertEq(r.retiredBy, address(router));

        // registry retired count incremented
        ProjectRegistry.Project memory p = registry.getProject(projectId);
        assertEq(p.totalRetired, 30);
    }

    function test_OffsetAcrossListingsRefundsExcess() public {
        uint256 idA = _list(sellerA, 100, 0.01 ether); // cheaper
        uint256 idB = _list(sellerB, 100, 0.02 ether);

        uint256[] memory ids = new uint256[](2);
        uint256[] memory qty = new uint256[](2);
        ids[0] = idA; qty[0] = 40;
        ids[1] = idB; qty[1] = 10;
        uint256 cost = 40 * 0.01 ether + 10 * 0.02 ether; // 0.6 ether

        vm.deal(buyer, 5 ether);
        uint256 before = buyer.balance;
        vm.prank(buyer);
        (uint256[] memory retIds, uint256 totalT, uint256 spent) =
            router.offset{value: 1 ether}(ids, qty, benefic, "fy26");

        assertEq(totalT, 50);
        assertEq(spent, cost);
        assertEq(retIds.length, 2);
        assertEq(buyer.balance, before - cost); // refunded the 0.4 excess

        uint256[] memory bRets = credit.retirementsForBeneficiary(benefic);
        assertEq(bRets.length, 2);

        ProjectRegistry.Project memory p = registry.getProject(projectId);
        assertEq(p.totalRetired, 50);
    }

    function test_RevertInsufficientPayment() public {
        uint256 id = _list(sellerA, 100, 0.01 ether);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory qty = new uint256[](1);
        ids[0] = id; qty[0] = 30;

        vm.deal(buyer, 5 ether);
        vm.prank(buyer);
        vm.expectRevert(OffsetRouter.InsufficientPayment.selector);
        router.offset{value: 0.1 ether}(ids, qty, benefic, "");
    }

    function test_RevertEmptyOrder() public {
        uint256[] memory ids = new uint256[](0);
        uint256[] memory qty = new uint256[](0);
        vm.prank(buyer);
        vm.expectRevert(OffsetRouter.EmptyOrder.selector);
        router.offset(ids, qty, benefic, "");
    }

    function test_RevertLengthMismatch() public {
        uint256[] memory ids = new uint256[](1);
        uint256[] memory qty = new uint256[](2);
        ids[0] = 1; qty[0] = 1; qty[1] = 2;
        vm.prank(buyer);
        vm.expectRevert(OffsetRouter.LengthMismatch.selector);
        router.offset(ids, qty, benefic, "");
    }

    function test_RevertZeroBeneficiary() public {
        uint256 id = _list(sellerA, 10, 1);
        uint256[] memory ids = new uint256[](1);
        uint256[] memory qty = new uint256[](1);
        ids[0] = id; qty[0] = 1;
        vm.deal(buyer, 1 ether);
        vm.expectRevert(OffsetRouter.ZeroBeneficiary.selector);
        vm.prank(buyer);
        router.offset{value: 1}(ids, qty, address(0), "");
    }
}
