// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {ERC1155Supply} from "@openzeppelin/contracts/token/ERC1155/extensions/ERC1155Supply.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ProjectRegistry} from "./ProjectRegistry.sol";

/// @title CarbonCredit
/// @notice ERC1155 token where each tokenId corresponds to a registered carbon
///         offset project. One token unit represents 1 tonne of CO2 equivalent
///         offset. Credits are minted by the platform operator to project
///         developers and can be permanently retired (burned) by holders to
///         claim the offset on behalf of a named beneficiary.
contract CarbonCredit is ERC1155, ERC1155Supply, Ownable {
    ProjectRegistry public immutable registry;

    /// @notice Retirement receipts, indexed by a monotonic retirement id.
    struct Retirement {
        uint256 id;
        uint256 projectId;
        address retiredBy;
        address beneficiary;
        uint256 amount;
        uint64 timestamp;
        string reason;
    }

    uint256 public nextRetirementId = 1;
    mapping(uint256 => Retirement) private _retirements;
    mapping(address => uint256[]) private _retirementsByUser;
    mapping(address => uint256[]) private _retirementsByBeneficiary;
    mapping(uint256 => uint256[]) private _retirementsByProject;

    event CreditsIssued(uint256 indexed projectId, address indexed to, uint256 amount);
    event CreditsRetired(
        uint256 indexed retirementId,
        uint256 indexed projectId,
        address indexed retiredBy,
        address beneficiary,
        uint256 amount,
        string reason
    );

    error ProjectNotActive();

    constructor(address initialOwner, address registryAddress)
        ERC1155("")
        Ownable(initialOwner)
    {
        registry = ProjectRegistry(registryAddress);
    }

    /// @notice Each tokenId's metadata URI is the registered project's URI.
    function uri(uint256 tokenId) public view override returns (string memory) {
        return registry.getProject(tokenId).metadataURI;
    }

    /// @notice Issue (mint) credits for a project to its developer or any address.
    ///         Only the contract owner (verifier / platform operator) may mint.
    function issue(uint256 projectId, address to, uint256 amount) external onlyOwner {
        ProjectRegistry.Project memory p = registry.getProject(projectId);
        if (!p.active) revert ProjectNotActive();
        _mint(to, projectId, amount, "");
        registry.recordIssuance(projectId, amount);
        emit CreditsIssued(projectId, to, amount);
    }

    /// @notice Permanently retire credits, producing an on-chain retirement
    ///         receipt that can be referenced as a proof of offset.
    /// @param projectId   Carbon project the credits belong to.
    /// @param amount      Number of tonnes to retire.
    /// @param beneficiary Address / entity on whose behalf the offset is claimed.
    /// @param reason      Free-form string (e.g. "2026 Q1 scope 1 emissions").
    function retire(
        uint256 projectId,
        uint256 amount,
        address beneficiary,
        string calldata reason
    ) external returns (uint256 retirementId) {
        _burn(msg.sender, projectId, amount);
        registry.recordRetirement(projectId, amount);

        retirementId = nextRetirementId++;
        _retirements[retirementId] = Retirement({
            id: retirementId,
            projectId: projectId,
            retiredBy: msg.sender,
            beneficiary: beneficiary,
            amount: amount,
            timestamp: uint64(block.timestamp),
            reason: reason
        });
        _retirementsByUser[msg.sender].push(retirementId);
        if (beneficiary != address(0) && beneficiary != msg.sender) {
            _retirementsByBeneficiary[beneficiary].push(retirementId);
        }
        _retirementsByProject[projectId].push(retirementId);

        emit CreditsRetired(retirementId, projectId, msg.sender, beneficiary, amount, reason);
    }

    function getRetirement(uint256 retirementId) external view returns (Retirement memory) {
        return _retirements[retirementId];
    }

    function retirementsOf(address user) external view returns (uint256[] memory) {
        return _retirementsByUser[user];
    }

    /// @notice Retirements where `user` is recorded as the beneficiary
    ///         (e.g. when a router or third-party retired on their behalf).
    ///         Combine with `retirementsOf(user)` for a complete user history.
    function retirementsForBeneficiary(address user) external view returns (uint256[] memory) {
        return _retirementsByBeneficiary[user];
    }

    function retirementsByProject(uint256 projectId) external view returns (uint256[] memory) {
        return _retirementsByProject[projectId];
    }

    // -------- overrides required by Solidity multiple-inheritance --------

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values)
        internal
        override(ERC1155, ERC1155Supply)
    {
        super._update(from, to, ids, values);
    }
}
