pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract PointsSwap_FHE is ZamaEthereumConfig {
    struct LoyaltyAccount {
        euint32 encryptedPoints;
        uint32 publicPoints;
        uint256 lastUpdated;
        bool isActive;
    }

    struct ExchangeRate {
        euint32 encryptedRate;
        uint32 publicRate;
        uint256 lastUpdated;
    }

    mapping(address => LoyaltyAccount) public accounts;
    mapping(string => ExchangeRate) public exchangeRates;
    mapping(string => bool) public supportedBrands;

    address public owner;
    string[] public brandList;

    event AccountCreated(address indexed user, uint32 initialPoints);
    event PointsConverted(address indexed user, string fromBrand, string toBrand, uint32 amount);
    event ExchangeRateUpdated(string brandPair, uint32 newRate);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not authorized");
        _;
    }

    constructor() ZamaEthereumConfig() {
        owner = msg.sender;
    }

    function createAccount(externalEuint32 encryptedPoints, bytes calldata inputProof, uint32 publicPoints) external {
        require(accounts[msg.sender].publicPoints == 0, "Account already exists");
        require(FHE.isInitialized(FHE.fromExternal(encryptedPoints, inputProof)), "Invalid encrypted input");

        accounts[msg.sender] = LoyaltyAccount({
            encryptedPoints: FHE.fromExternal(encryptedPoints, inputProof),
            publicPoints: publicPoints,
            lastUpdated: block.timestamp,
            isActive: true
        });

        FHE.allowThis(accounts[msg.sender].encryptedPoints);
        FHE.makePubliclyDecryptable(accounts[msg.sender].encryptedPoints);

        emit AccountCreated(msg.sender, publicPoints);
    }

    function addSupportedBrand(string calldata brandId) external onlyOwner {
        require(!supportedBrands[brandId], "Brand already supported");
        supportedBrands[brandId] = true;
        brandList.push(brandId);
    }

    function setExchangeRate(string calldata brandPair, externalEuint32 encryptedRate, bytes calldata rateProof, uint32 publicRate) external onlyOwner {
        require(supportedBrands[brandPair], "Brand pair not supported");
        require(FHE.isInitialized(FHE.fromExternal(encryptedRate, rateProof)), "Invalid encrypted rate");

        exchangeRates[brandPair] = ExchangeRate({
            encryptedRate: FHE.fromExternal(encryptedRate, rateProof),
            publicRate: publicRate,
            lastUpdated: block.timestamp
        });

        FHE.allowThis(exchangeRates[brandPair].encryptedRate);
        FHE.makePubliclyDecryptable(exchangeRates[brandPair].encryptedRate);

        emit ExchangeRateUpdated(brandPair, publicRate);
    }

    function convertPoints(string calldata fromBrand, string calldata toBrand, uint32 amount) external {
        require(accounts[msg.sender].isActive, "Account inactive");
        require(supportedBrands[fromBrand] && supportedBrands[toBrand], "Unsupported brand");
        require(amount > 0, "Invalid amount");

        string memory brandPair = string(abi.encodePacked(fromBrand, "-", toBrand));
        require(exchangeRates[brandPair].publicRate > 0, "Exchange rate not set");

        // Homomorphic computation of converted points
        euint32 memory convertedAmount = FHE.mul(FHE.fromU32(amount), exchangeRates[brandPair].encryptedRate);

        // Update user's encrypted points balance
        accounts[msg.sender].encryptedPoints = FHE.sub(accounts[msg.sender].encryptedPoints, FHE.fromU32(amount));
        accounts[msg.sender].lastUpdated = block.timestamp;

        // Create new encrypted balance for target brand
        euint32 memory newTargetBalance = convertedAmount;
        accounts[msg.sender].encryptedPoints = FHE.add(accounts[msg.sender].encryptedPoints, newTargetBalance);

        emit PointsConverted(msg.sender, fromBrand, toBrand, amount);
    }

    function getAccountBalance(address user) external view returns (euint32, uint32) {
        require(accounts[user].isActive, "Account not found");
        return (accounts[user].encryptedPoints, accounts[user].publicPoints);
    }

    function getExchangeRate(string calldata brandPair) external view returns (euint32, uint32) {
        require(exchangeRates[brandPair].publicRate > 0, "Rate not found");
        return (exchangeRates[brandPair].encryptedRate, exchangeRates[brandPair].publicRate);
    }

    function getSupportedBrands() external view returns (string[] memory) {
        return brandList;
    }

    function deactivateAccount() external {
        require(accounts[msg.sender].isActive, "Account not active");
        accounts[msg.sender].isActive = false;
    }

    function updatePublicPoints(uint32 newPoints) external {
        require(accounts[msg.sender].isActive, "Account not active");
        accounts[msg.sender].publicPoints = newPoints;
        accounts[msg.sender].lastUpdated = block.timestamp;
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Invalid address");
        owner = newOwner;
    }

    function isContractAvailable() external pure returns (bool) {
        return true;
    }
}


