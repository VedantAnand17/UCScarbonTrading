// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";
import {Marketplace} from "./Marketplace.sol";
import {CarbonCredit} from "./CarbonCredit.sol";

/// @title OffsetRouter
/// @notice One-shot "I want to offset N tonnes" router. Buys credits across
///         multiple Marketplace listings in a single transaction and retires
///         them on behalf of a beneficiary, producing one retirement
///         certificate per listing filled. The router never holds credits at
///         rest; every purchase is retired in the same tx.
contract OffsetRouter is IERC1155Receiver, ReentrancyGuard {
    Marketplace public immutable marketplace;
    CarbonCredit public immutable credit;

    error LengthMismatch();
    error EmptyOrder();
    error ZeroBeneficiary();
    error WrongToken();
    error InsufficientPayment();
    error RefundFailed();

    event Offset(
        address indexed buyer,
        address indexed beneficiary,
        uint256 totalTonnes,
        uint256 totalSpent,
        uint256[] retirementIds,
        string reason
    );

    constructor(address _marketplace, address _credit) {
        marketplace = Marketplace(_marketplace);
        credit = CarbonCredit(_credit);
    }

    /// @notice Atomically buy from the given listings and retire the credits.
    /// @dev Caller computes the route off-chain (typically: sort active listings
    ///      ascending by `pricePerUnit`, then walk filling until `tonnes` met).
    ///      All listings must reference the configured CarbonCredit token.
    /// @param listingIds  Marketplace listing ids to fill.
    /// @param quantities  Tonnes to take from each listing (same length).
    /// @param beneficiary Address recorded as offset beneficiary on each cert.
    /// @param reason      Free-form string stored in every retirement record.
    /// @return retirementIds CarbonCredit retirement ids (one per listing).
    /// @return totalTonnes   Sum of `quantities`.
    /// @return totalSpent    Wei paid to the marketplace (excludes refund).
    function offset(
        uint256[] calldata listingIds,
        uint256[] calldata quantities,
        address beneficiary,
        string calldata reason
    )
        external
        payable
        nonReentrant
        returns (uint256[] memory retirementIds, uint256 totalTonnes, uint256 totalSpent)
    {
        if (listingIds.length == 0) revert EmptyOrder();
        if (listingIds.length != quantities.length) revert LengthMismatch();
        if (beneficiary == address(0)) revert ZeroBeneficiary();

        retirementIds = new uint256[](listingIds.length);
        (totalTonnes, totalSpent) = _fillAndRetire(
            listingIds,
            quantities,
            beneficiary,
            reason,
            retirementIds
        );

        if (msg.value > totalSpent) {
            (bool ok, ) = msg.sender.call{value: msg.value - totalSpent}("");
            if (!ok) revert RefundFailed();
        }

        emit Offset(msg.sender, beneficiary, totalTonnes, totalSpent, retirementIds, reason);
    }

    /// @dev Split out to keep `offset` under stack-depth limits even without
    ///      via-IR. Mutates `retirementIds` in place; returns running totals.
    function _fillAndRetire(
        uint256[] calldata listingIds,
        uint256[] calldata quantities,
        address beneficiary,
        string calldata reason,
        uint256[] memory retirementIds
    ) internal returns (uint256 tonnes, uint256 spent) {
        for (uint256 i; i < listingIds.length; ++i) {
            (uint256 cost, uint256 retId) = _fillOne(
                listingIds[i],
                quantities[i],
                beneficiary,
                reason,
                spent
            );
            spent += cost;
            tonnes += quantities[i];
            retirementIds[i] = retId;
        }
    }

    /// @dev Inner helper. Buys one listing and immediately retires it.
    function _fillOne(
        uint256 listingId,
        uint256 q,
        address beneficiary,
        string calldata reason,
        uint256 spentSoFar
    ) internal returns (uint256 cost, uint256 retId) {
        Marketplace.Listing memory L = marketplace.getListing(listingId);
        if (L.token != address(credit)) revert WrongToken();
        cost = q * L.pricePerUnit;
        if (msg.value < spentSoFar + cost) revert InsufficientPayment();
        marketplace.buy{value: cost}(listingId, q);
        retId = credit.retire(L.tokenId, q, beneficiary, reason);
    }

    // -------- IERC1155Receiver (router accepts credits from marketplace) --------

    function onERC1155Received(address, address, uint256, uint256, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155Received.selector;
    }

    function onERC1155BatchReceived(address, address, uint256[] calldata, uint256[] calldata, bytes calldata)
        external
        pure
        returns (bytes4)
    {
        return IERC1155Receiver.onERC1155BatchReceived.selector;
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return
            interfaceId == type(IERC1155Receiver).interfaceId ||
            interfaceId == type(IERC165).interfaceId;
    }

    receive() external payable {}
}
