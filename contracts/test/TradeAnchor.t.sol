// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {TradeAnchor} from "../src/TradeAnchor.sol";

contract TradeAnchorTest is Test {
    TradeAnchor private anchor;
    bytes32 private constant TRADE_ID = keccak256("demo trade");
    bytes32 private constant TRADE_HASH = keccak256("canonical JSON");

    event TradeAnchored(bytes32 indexed tradeId, bytes32 tradeHash);

    function setUp() public {
        anchor = new TradeAnchor(address(this));
    }

    function testOwnerAnchorsAndEmitsEvent() public {
        assertEq(anchor.tradeHashes(TRADE_ID), bytes32(0));
        vm.expectEmit(true, false, false, true, address(anchor));
        emit TradeAnchored(TRADE_ID, TRADE_HASH);
        anchor.anchor(TRADE_ID, TRADE_HASH);
        assertEq(anchor.tradeHashes(TRADE_ID), TRADE_HASH);
    }

    function testNonOwnerCannotAnchor() public {
        address outsider = makeAddr("outsider");
        vm.prank(outsider);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, outsider));
        anchor.anchor(TRADE_ID, TRADE_HASH);
    }

    function testCannotReanchorEvenWithTheSameHash() public {
        anchor.anchor(TRADE_ID, TRADE_HASH);
        vm.expectRevert(abi.encodeWithSelector(TradeAnchor.AlreadyAnchored.selector, TRADE_ID));
        anchor.anchor(TRADE_ID, TRADE_HASH);
    }

    function testRejectsZeroHash() public {
        vm.expectRevert(TradeAnchor.ZeroTradeHash.selector);
        anchor.anchor(TRADE_ID, bytes32(0));
    }
}
