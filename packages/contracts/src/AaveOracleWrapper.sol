// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title  AaveOracleWrapper
 * @notice Wrapper tipis yang menyesuaikan interface Aave Oracle V3
 *         dengan interface IPriceOracle yang dipakai SentinelExecutor.
 *
 * Masalah:
 *   SentinelExecutor expect:  getPrice(address asset) → uint256
 *   Aave Oracle V3 punya:     getAssetPrice(address asset) → uint256
 *   Nama fungsi berbeda — tidak bisa langsung di-set tanpa wrapper.
 *
 * Solusi:
 *   Deploy wrapper ini, lalu panggil:
 *   SentinelExecutor.setPriceOracle(address(wrapper))
 *
 * Celo Mainnet:
 *   AaveOracle: 0x1e693D088ceFD1E95ba4c4a5F7EeA41a1Ec37e8b
 *   (Confirmed Celoscan: "Aave: Oracle V3")
 *
 * Harga dikembalikan dalam USD dengan 8 desimal (Chainlink standard).
 * Contoh: 1 USDC = 100000000 (= $1.00)
 */

interface IAaveOracleV3 {
    function getAssetPrice(address asset) external view returns (uint256);
}

contract AaveOracleWrapper {

    IAaveOracleV3 public immutable aaveOracle;
    address       public immutable owner;

    error NotOwner();
    error ZeroAddress();

    event OracleSet(address indexed oracle);

    constructor(address _aaveOracle) {
        if (_aaveOracle == address(0)) revert ZeroAddress();
        aaveOracle = IAaveOracleV3(_aaveOracle);
        owner      = msg.sender;
        emit OracleSet(_aaveOracle);
    }

    /**
     * @notice Ambil harga asset dalam USD (8 desimal, Chainlink standard).
     *         Interface ini match dengan IPriceOracle di SentinelExecutor.
     *
     * @param  asset   Address token yang mau dicek harganya
     * @return price   Harga dalam USD dengan 8 desimal
     *
     * @dev    Contoh return values:
     *           USDC  → ~100000000  ($1.00)
     *           USDT  → ~100000000  ($1.00)
     *           WETH  → ~200000000000 ($2000.00)
     *           CELO  → ~70000000   ($0.70)
     */
    function getPrice(address asset) external view returns (uint256) {
        return aaveOracle.getAssetPrice(asset);
    }
}
