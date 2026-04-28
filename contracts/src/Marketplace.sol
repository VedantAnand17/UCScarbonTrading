// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC1155} from "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import {IERC1155Receiver} from "@openzeppelin/contracts/token/ERC1155/IERC1155Receiver.sol";
import {IERC165} from "@openzeppelin/contracts/utils/introspection/IERC165.sol";

/// @title Marketplace
/// @notice Simple on-chain order book for ERC1155 carbon credits. Sellers
///         escrow credits with the marketplace and set a price per unit in
///         native ETH. Buyers pay exactly `pricePerUnit * quantity` wei.
///         The contract charges a configurable fee (bps) on every fill, which
///         is forwarded to a treasury address.
contract Marketplace is Ownable, ReentrancyGuard, IERC1155Receiver {
    struct Listing {
        uint256 id;
        address seller;
        address token;          // ERC1155 token contract
        uint256 tokenId;        // = carbon projectId
        uint256 remaining;      // Units still for sale
        uint256 pricePerUnit;   // In wei
        bool active;
    }

    uint256 public nextListingId = 1;
    mapping(uint256 => Listing) private _listings;
    uint256[] private _activeListingIds;
    mapping(uint256 => uint256) private _activeIndex; // listingId => index+1 in _activeListingIds

    address public treasury;
    uint16 public feeBps;               // 100 = 1%
    uint16 public constant MAX_FEE_BPS = 1000; // 10% hard cap

    event ListingCreated(
        uint256 indexed id,
        address indexed seller,
        address indexed token,
        uint256 tokenId,
        uint256 quantity,
        uint256 pricePerUnit
    );
    event ListingCancelled(uint256 indexed id, uint256 refunded);
    event ListingFilled(
        uint256 indexed id,
        address indexed buyer,
        uint256 quantity,
        uint256 totalPrice,
        uint256 fee
    );
    event TreasuryUpdated(address indexed treasury);
    event FeeUpdated(uint16 feeBps);

    error InvalidListing();
    error NotSeller();
    error IncorrectPayment();
    error InsufficientRemaining();
    error FeeTooHigh();
    error ZeroAmount();

    constructor(address initialOwner, address _treasury, uint16 _feeBps) Ownable(initialOwner) {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        treasury = _treasury;
        feeBps = _feeBps;
        emit TreasuryUpdated(_treasury);
        emit FeeUpdated(_feeBps);
    }

    // -------- admin --------

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
        emit TreasuryUpdated(_treasury);
    }

    function setFeeBps(uint16 _feeBps) external onlyOwner {
        if (_feeBps > MAX_FEE_BPS) revert FeeTooHigh();
        feeBps = _feeBps;
        emit FeeUpdated(_feeBps);
    }

    // -------- listings --------

    /// @notice Create a new listing. Seller must have approved this contract
    ///         for the given ERC1155 token (`setApprovalForAll`).
    function createListing(
        address token,
        uint256 tokenId,
        uint256 quantity,
        uint256 pricePerUnit
    ) external returns (uint256 id) {
        if (quantity == 0 || pricePerUnit == 0) revert ZeroAmount();

        id = nextListingId++;
        _listings[id] = Listing({
            id: id,
            seller: msg.sender,
            token: token,
            tokenId: tokenId,
            remaining: quantity,
            pricePerUnit: pricePerUnit,
            active: true
        });
        _activeListingIds.push(id);
        _activeIndex[id] = _activeListingIds.length; // store index+1

        IERC1155(token).safeTransferFrom(msg.sender, address(this), tokenId, quantity, "");
        emit ListingCreated(id, msg.sender, token, tokenId, quantity, pricePerUnit);
    }

    /// @notice Cancel an active listing and refund all remaining credits to the seller.
    function cancelListing(uint256 id) external nonReentrant {
        Listing storage l = _listings[id];
        if (!l.active) revert InvalidListing();
        if (l.seller != msg.sender) revert NotSeller();

        uint256 refund = l.remaining;
        l.remaining = 0;
        l.active = false;
        _removeFromActive(id);

        if (refund > 0) {
            IERC1155(l.token).safeTransferFrom(address(this), l.seller, l.tokenId, refund, "");
        }
        emit ListingCancelled(id, refund);
    }

    /// @notice Buy up to `quantity` units from a listing. `msg.value` must be
    ///         exactly `quantity * pricePerUnit`.
    function buy(uint256 id, uint256 quantity) external payable nonReentrant {
        Listing storage l = _listings[id];
        if (!l.active) revert InvalidListing();
        if (quantity == 0) revert ZeroAmount();
        if (quantity > l.remaining) revert InsufficientRemaining();

        uint256 totalPrice = quantity * l.pricePerUnit;
        if (msg.value != totalPrice) revert IncorrectPayment();

        uint256 fee = (totalPrice * feeBps) / 10_000;
        uint256 sellerProceeds = totalPrice - fee;

        l.remaining -= quantity;
        if (l.remaining == 0) {
            l.active = false;
            _removeFromActive(id);
        }

        // Effects done; now interactions.
        IERC1155(l.token).safeTransferFrom(address(this), msg.sender, l.tokenId, quantity, "");

        if (fee > 0 && treasury != address(0)) {
            (bool okFee, ) = payable(treasury).call{value: fee}("");
            require(okFee, "fee transfer failed");
        } else {
            sellerProceeds = totalPrice; // no fee configured
        }
        (bool okSeller, ) = payable(l.seller).call{value: sellerProceeds}("");
        require(okSeller, "seller transfer failed");

        emit ListingFilled(id, msg.sender, quantity, totalPrice, fee);
    }

    // -------- views --------

    function getListing(uint256 id) external view returns (Listing memory) {
        return _listings[id];
    }

    function activeListingIds() external view returns (uint256[] memory) {
        return _activeListingIds;
    }

    function activeListingCount() external view returns (uint256) {
        return _activeListingIds.length;
    }

    // -------- internal helpers --------

    function _removeFromActive(uint256 id) internal {
        uint256 idxPlusOne = _activeIndex[id];
        if (idxPlusOne == 0) return;
        uint256 idx = idxPlusOne - 1;
        uint256 lastIdx = _activeListingIds.length - 1;
        if (idx != lastIdx) {
            uint256 lastId = _activeListingIds[lastIdx];
            _activeListingIds[idx] = lastId;
            _activeIndex[lastId] = idx + 1;
        }
        _activeListingIds.pop();
        delete _activeIndex[id];
    }

    // -------- IERC1155Receiver --------

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
}
