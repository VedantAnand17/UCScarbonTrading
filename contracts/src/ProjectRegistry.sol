// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ProjectRegistry
/// @notice On-chain registry of carbon offset projects. Only the contract owner
///         (the platform operator / verifier) can register projects. Each project
///         is identified by a monotonically increasing uint256 id which is also
///         used as the ERC1155 tokenId in the {CarbonCredit} token.
contract ProjectRegistry is Ownable {
    struct Project {
        uint256 id;
        address developer;       // Beneficiary of minted credits (project developer)
        string name;
        string location;
        string methodology;      // e.g. "VCS VM0007 REDD+"
        uint16 vintageYear;      // Year the offset was generated
        uint256 totalIssued;     // Total credits ever issued for this project
        uint256 totalRetired;    // Total credits permanently retired
        string metadataURI;      // IPFS / HTTPS pointer to full project docs
        bool active;
    }

    uint256 public nextProjectId = 1;
    mapping(uint256 => Project) private _projects;
    uint256[] private _allIds;

    /// @notice The CarbonCredit contract allowed to update issued/retired stats.
    address public creditToken;

    event ProjectRegistered(
        uint256 indexed id,
        address indexed developer,
        string name,
        uint16 vintageYear,
        string metadataURI
    );
    event ProjectUpdated(uint256 indexed id, string metadataURI, bool active);
    event CreditTokenSet(address indexed creditToken);
    event StatsUpdated(uint256 indexed id, uint256 totalIssued, uint256 totalRetired);

    error ProjectDoesNotExist();
    error NotCreditToken();

    constructor(address initialOwner) Ownable(initialOwner) {}

    modifier onlyCreditToken() {
        if (msg.sender != creditToken) revert NotCreditToken();
        _;
    }

    /// @notice Wires the {CarbonCredit} token contract that is allowed to push
    ///         issued / retired stats back to the registry.
    function setCreditToken(address _creditToken) external onlyOwner {
        creditToken = _creditToken;
        emit CreditTokenSet(_creditToken);
    }

    function registerProject(
        address developer,
        string calldata name,
        string calldata location,
        string calldata methodology,
        uint16 vintageYear,
        string calldata metadataURI
    ) external onlyOwner returns (uint256 id) {
        id = nextProjectId++;
        _projects[id] = Project({
            id: id,
            developer: developer,
            name: name,
            location: location,
            methodology: methodology,
            vintageYear: vintageYear,
            totalIssued: 0,
            totalRetired: 0,
            metadataURI: metadataURI,
            active: true
        });
        _allIds.push(id);
        emit ProjectRegistered(id, developer, name, vintageYear, metadataURI);
    }

    function updateProject(
        uint256 id,
        string calldata metadataURI,
        bool active
    ) external onlyOwner {
        Project storage p = _projects[id];
        if (p.id == 0) revert ProjectDoesNotExist();
        p.metadataURI = metadataURI;
        p.active = active;
        emit ProjectUpdated(id, metadataURI, active);
    }

    function recordIssuance(uint256 id, uint256 amount) external onlyCreditToken {
        Project storage p = _projects[id];
        if (p.id == 0) revert ProjectDoesNotExist();
        p.totalIssued += amount;
        emit StatsUpdated(id, p.totalIssued, p.totalRetired);
    }

    function recordRetirement(uint256 id, uint256 amount) external onlyCreditToken {
        Project storage p = _projects[id];
        if (p.id == 0) revert ProjectDoesNotExist();
        p.totalRetired += amount;
        emit StatsUpdated(id, p.totalIssued, p.totalRetired);
    }

    function getProject(uint256 id) external view returns (Project memory) {
        Project memory p = _projects[id];
        if (p.id == 0) revert ProjectDoesNotExist();
        return p;
    }

    function exists(uint256 id) external view returns (bool) {
        return _projects[id].id != 0;
    }

    function totalProjects() external view returns (uint256) {
        return _allIds.length;
    }

    function allProjectIds() external view returns (uint256[] memory) {
        return _allIds;
    }
}
