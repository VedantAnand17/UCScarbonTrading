// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract TradeAnchor is Ownable {
    mapping(bytes32 tradeId => bytes32 tradeHash) public tradeHashes;

    error AlreadyAnchored(bytes32 tradeId);
    error ZeroTradeHash();

    event TradeAnchored(bytes32 indexed tradeId, bytes32 tradeHash);

    constructor(address initialOwner) Ownable(initialOwner) {}

    function anchor(bytes32 tradeId, bytes32 tradeHash) external onlyOwner {
        if (tradeHashes[tradeId] != bytes32(0)) revert AlreadyAnchored(tradeId);
        if (tradeHash == bytes32(0)) revert ZeroTradeHash();
        tradeHashes[tradeId] = tradeHash;
        emit TradeAnchored(tradeId, tradeHash);
    }
}
