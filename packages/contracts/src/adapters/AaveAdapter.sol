// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IAaveV3Pool.sol";
import "../interfaces/IERC20.sol";
import "../libraries/SafeERC20.sol";

/**
 * @title  AaveAdapter
 * @notice Wraps Aave V3 supply/withdraw for SentinelExecutor.
 *
 * Desain aToken ownership:
 *   aToken di-mint ke SentinelExecutor (msg.sender), BUKAN ke userWallet.
 *
 *   Kenapa? Kalau aToken di-mint ke userWallet:
 *     - Saat withdraw, user harus sudah approve aUSDM + aUSDC + aUSDT ke SentinelExecutor
 *     - 3 approval tambahan yang membingungkan user
 *     - Kalau user lupa approve aToken, semua withdrawal gagal
 *
 *   Dengan mint ke SentinelExecutor:
 *     - User hanya perlu approve 1x: token asli (USDC/USDT/USDm) ke SentinelExecutor
 *     - SentinelExecutor pegang aToken — bisa withdraw kapan saja tanpa approval tambahan
 *     - Lebih simple, lebih aman
 *
 * Flow token:
 *   supply:   user → (transferFrom) → SentinelExecutor → (transfer) → AaveAdapter → Aave pool
 *             aToken: Aave pool → SentinelExecutor
 *
 *   withdraw: SentinelExecutor → (transfer) → AaveAdapter → Aave pool (burn aToken)
 *             underlying: Aave pool → recipient (userWallet atau SentinelExecutor)
 */
contract AaveAdapter {
    using SafeERC20 for IERC20;

    IAaveV3Pool public immutable pool;
    address     public executor;
    address     public owner;

    error NotExecutor();
    error NotOwner();
    error ZeroAddress();

    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    constructor(address _pool, address _executor) {
        require(_pool      != address(0), "AaveAdapter: zero pool");
        require(_executor  != address(0), "AaveAdapter: zero executor");
        pool     = IAaveV3Pool(_pool);
        executor = _executor;
        owner    = msg.sender;
    }

    modifier onlyExecutor() { if (msg.sender != executor) revert NotExecutor(); _; }
    modifier onlyOwner()    { if (msg.sender != owner)    revert NotOwner();    _; }

    function setExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroAddress();
        emit ExecutorUpdated(executor, _executor);
        executor = _executor;
    }

    /**
     * @notice Supply asset ke Aave.
     *         aToken di-mint ke SentinelExecutor (msg.sender) — bukan ke userWallet.
     *         User hanya butuh 1x approve token asli, tidak perlu approve aToken.
     *
     * @param asset   Underlying token (USDC, USDT, USDm)
     * @param amount  Amount dalam native decimals token
     * @return aTokensReceived Jumlah aToken yang diterima SentinelExecutor
     */
    function supply(address /* userWallet */, address asset, uint256 amount)
        external onlyExecutor returns (uint256 aTokensReceived)
    {
        // Step 1: pull underlying token dari SentinelExecutor ke sini
        IERC20(asset).safeTransferFrom(msg.sender, address(this), amount);

        // Step 2: approve pool (reset ke 0 dulu untuk kompatibilitas USDT-style tokens)
        IERC20(asset).approve(address(pool), 0);
        IERC20(asset).approve(address(pool), amount);

        // Step 3: supply — aToken di-mint ke msg.sender (SentinelExecutor)
        uint256 before = _aTokenBalance(msg.sender, asset);
        pool.supply(asset, amount, msg.sender, 0);
        aTokensReceived = _aTokenBalance(msg.sender, asset) - before;
    }

    /**
     * @notice Withdraw underlying dari Aave.
     *         SentinelExecutor pegang aToken — transfer ke sini dulu agar
     *         pool.withdraw() bisa burn dari address(this).
     *
     * @param asset     Underlying token
     * @param amount    Jumlah aToken yang mau di-burn
     * @param recipient Tujuan underlying setelah withdraw
     * @return withdrawn Jumlah underlying yang berhasil ditarik
     */
    function withdraw(address /* userWallet */, address asset, uint256 amount, address recipient)
        external onlyExecutor returns (uint256 withdrawn)
    {
        // SentinelExecutor (msg.sender) pegang aToken
        // Transfer aToken ke AaveAdapter dulu — pool.withdraw() burn dari msg.sender = address(this)
        address aToken = pool.getReserveData(asset).aTokenAddress;
        IERC20(aToken).safeTransferFrom(msg.sender, address(this), amount);

        // Burn aToken, terima underlying, kirim ke recipient
        withdrawn = pool.withdraw(asset, amount, recipient);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    function aTokenBalance(address asset) external view returns (uint256) {
        return _aTokenBalance(msg.sender, asset);
    }

    function _aTokenBalance(address account, address asset) internal view returns (uint256) {
        return IERC20(pool.getReserveData(asset).aTokenAddress).balanceOf(account);
    }
}
