// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC20.sol";
import "../libraries/SafeERC20.sol";

/**
 * @title  UniswapAdapter
 * @notice Wraps Uniswap V3 NonfungiblePositionManager and SwapRouter.
 *         LP NFTs are held by this adapter as escrow — exitPosition() sends
 *         underlying tokens directly to userWallet.
 *
 * Pairs supported:
 *   - WETH/USDC  (fee = 0.3%)
 *   - USDC/USDT  (fee = 0.05%)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Uniswap V3 NonfungiblePositionManager
// ─────────────────────────────────────────────────────────────────────────────

interface IUniswapV3PositionManager {
    struct MintParams {
        address token0;
        address token1;
        uint24  fee;
        int24   tickLower;
        int24   tickUpper;
        uint256 amount0Desired;
        uint256 amount1Desired;
        uint256 amount0Min;
        uint256 amount1Min;
        address recipient;
        uint256 deadline;
    }

    struct DecreaseLiquidityParams {
        uint256 tokenId;
        uint128 liquidity;
        uint256 amount0Min;
        uint256 amount1Min;
        uint256 deadline;
    }

    /**
     * @notice FIX: Uniswap V3 collect() takes a struct, NOT (address, uint256).
     *         Using the wrong signature produces a different function selector and
     *         causes every exitPosition() call to silently fail or revert on mainnet.
     */
    struct CollectParams {
        uint256 tokenId;
        address recipient;
        uint128 amount0Max;
        uint128 amount1Max;
    }

    function mint(MintParams calldata params)
        external
        returns (uint256 tokenId, uint128 liquidity, uint256 amount0, uint256 amount1);

    function collect(CollectParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    function burn(uint256 tokenId) external;

    function decreaseLiquidity(DecreaseLiquidityParams calldata params)
        external
        returns (uint256 amount0, uint256 amount1);

    function positions(uint256 tokenId)
        external
        view
        returns (
            uint96  nonce,
            address operator,
            address token0,
            address token1,
            uint24  fee,
            int24   tickLower,
            int24   tickUpper,
            uint128 liquidity,
            uint256 feeGrowthInside0LastX128,
            uint256 feeGrowthInside1LastX128,
            uint128 tokensOwed0,
            uint128 tokensOwed1
        );
}

// ─────────────────────────────────────────────────────────────────────────────
// Uniswap V3 SwapRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice SwapRouter interface for single-hop exact-input swaps.
 *         This is the correct path for token swaps — NOT positionManager.mint().
 *         Celo mainnet SwapRouter02: 0x5615CDAb10dc425a742d643d949a7F474C01abc4
 *         Verify at: https://docs.uniswap.org/contracts/v3/reference/deployments
 */
interface ISwapRouter {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24  fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    function exactInputSingle(ExactInputSingleParams calldata params)
        external
        returns (uint256 amountOut);
}

// ─────────────────────────────────────────────────────────────────────────────
// UniswapAdapter
// ─────────────────────────────────────────────────────────────────────────────

contract UniswapAdapter {
    using SafeERC20 for IERC20;

    IUniswapV3PositionManager public immutable positionManager;
    ISwapRouter               public immutable swapRouter;
    address                   public executor;
    address                   public owner;

    // Fee tiers
    uint24 public constant FEE_STABLE   = 500;   // 0.05% for stable pairs
    uint24 public constant FEE_VOLATILE = 3000;  // 0.30% for ETH pairs

    // Full-range tick bounds (MVP default)
    int24 public constant TICK_LOWER = -887272;
    int24 public constant TICK_UPPER =  887272;

    // Collect max amounts — collect all available fees/tokens
    uint128 public constant COLLECT_MAX = type(uint128).max;

    // wETH on Celo mainnet
    // FIX: address WETH yang benar di Celo mainnet (confirmed dari Celoscan: "Celo: WETH Token")
    address public constant WETH_CELO = 0xD221812de1BD094f35587EE8E174B07B6167D9Af;

    error NotExecutor();
    error NotOwner();
    error ZeroAddress();

    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    constructor(address _positionManager, address _swapRouter, address _executor) {
        require(_positionManager != address(0), "UniswapAdapter: zero positionManager");
        require(_swapRouter      != address(0), "UniswapAdapter: zero swapRouter");
        require(_executor        != address(0), "UniswapAdapter: zero executor");
        positionManager = IUniswapV3PositionManager(_positionManager);
        swapRouter      = ISwapRouter(_swapRouter);
        executor        = _executor;
        owner           = msg.sender;
    }

    modifier onlyExecutor() { if (msg.sender != executor) revert NotExecutor(); _; }
    modifier onlyOwner()    { if (msg.sender != owner)    revert NotOwner();    _; }

    function setExecutor(address _executor) external onlyOwner {
        if (_executor == address(0)) revert ZeroAddress();
        emit ExecutorUpdated(executor, _executor);
        executor = _executor;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Mint LP Position
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Mint a new LP position.
     *
     * FIX — NFT ownership:
     *   NFT sebelumnya di-mint ke userWallet (non-custodial), tapi ini menyebabkan
     *   exitPosition() selalu revert karena UniswapAdapter bukan owner NFT dan tidak
     *   bisa memanggil decreaseLiquidity() / burn() tanpa approval dari user.
     *
     *   Fix: NFT di-mint ke address(this) (UniswapAdapter) sebagai escrow sementara.
     *   Adapter SELALU menjadi operator — bisa exit kapan saja tanpa approval tambahan.
     *   Saat exitPosition(), underlying token langsung dikirim ke userWallet.
     *   Ini tetap non-custodial secara efektif: user tidak bisa lose funds karena
     *   hanya SentinelExecutor (via onlyExecutor) yang bisa trigger exitPosition().
     *
     *   Refund: Uniswap V3 sering tidak pakai semua token (tick range tidak selalu exact).
     *   Sisa token di-refund ke userWallet setelah mint.
     */
    function mintPosition(
        address userWallet,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1
    ) external onlyExecutor returns (uint256 tokenId) {
        // Pull tokens from SentinelExecutor (msg.sender) into this adapter
        IERC20(token0).safeTransferFrom(msg.sender, address(this), amount0);
        IERC20(token1).safeTransferFrom(msg.sender, address(this), amount1);

        IERC20(token0).approve(address(positionManager), 0);
        IERC20(token0).approve(address(positionManager), amount0);
        IERC20(token1).approve(address(positionManager), 0);
        IERC20(token1).approve(address(positionManager), amount1);

        uint24 fee = (_isWETH(token0) || _isWETH(token1)) ? FEE_VOLATILE : FEE_STABLE;

        uint256 used0;
        uint256 used1;
        (tokenId, , used0, used1) = positionManager.mint(
            IUniswapV3PositionManager.MintParams({
                token0:         token0,
                token1:         token1,
                fee:            fee,
                tickLower:      TICK_LOWER,
                tickUpper:      TICK_UPPER,
                amount0Desired: amount0,
                amount1Desired: amount1,
                amount0Min:     0,           // slippage handled upstream in SentinelExecutor
                amount1Min:     0,
                recipient:      address(this), // NFT ke adapter — agar exitPosition() bisa jalan
                deadline:       block.timestamp + 300
            })
        );

        // Refund unused tokens (Uniswap V3 sering tidak pakai semua karena tick range)
        uint256 refund0 = amount0 - used0;
        uint256 refund1 = amount1 - used1;
        if (refund0 > 0) IERC20(token0).safeTransfer(userWallet, refund0);
        if (refund1 > 0) IERC20(token1).safeTransfer(userWallet, refund1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Exit LP Position
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Exit LP position — collect all fees + remove all liquidity.
     *         Tokens go back directly to userWallet.
     *
     * FIX: collect() now uses the correct struct-based signature:
     *   CollectParams { tokenId, recipient, amount0Max, amount1Max }
     *   The old signature collect(address, uint256) is a completely different
     *   function selector and would always revert on mainnet.
     */
    function exitPosition(address userWallet, uint256 tokenId) external onlyExecutor {
        (, , , , , , , uint128 liquidity, , , , ) = positionManager.positions(tokenId);

        if (liquidity > 0) {
            positionManager.decreaseLiquidity(
                IUniswapV3PositionManager.DecreaseLiquidityParams({
                    tokenId:    tokenId,
                    liquidity:  liquidity,
                    amount0Min: 0,
                    amount1Min: 0,
                    deadline:   block.timestamp + 300
                })
            );
        }

        // Collect all tokens + fees directly to userWallet
        positionManager.collect(
            IUniswapV3PositionManager.CollectParams({
                tokenId:    tokenId,
                recipient:  userWallet,
                amount0Max: COLLECT_MAX,
                amount1Max: COLLECT_MAX
            })
        );

        positionManager.burn(tokenId);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Token Swap
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * @notice Token swap via Uniswap V3 SwapRouter exactInputSingle.
     *         Used for WETH swaps (USDC ↔ WETH, USDT ↔ WETH).
     *         Output token goes directly to userWallet.
     *
     * FIX: previous implementation called positionManager.mint() for swaps,
     *      which creates an LP position — not a swap. Tokens would be locked
     *      in an unintended LP position instead of being exchanged.
     *      Replaced with ISwapRouter.exactInputSingle() — the correct path.
     */
    function swap(
        address userWallet,
        address fromAsset,
        address toAsset,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyExecutor returns (uint256 amountOut) {
        // Pull tokens from SentinelExecutor (already pulled from user + approved here)
        IERC20(fromAsset).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(fromAsset).approve(address(swapRouter), 0);
        IERC20(fromAsset).approve(address(swapRouter), amountIn);

        uint24 fee = (_isWETH(fromAsset) || _isWETH(toAsset)) ? FEE_VOLATILE : FEE_STABLE;

        amountOut = swapRouter.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn:           fromAsset,
                tokenOut:          toAsset,
                fee:               fee,
                recipient:         userWallet,    // output goes directly to user
                deadline:          block.timestamp + 300,
                amountIn:          amountIn,
                amountOutMinimum:  minAmountOut,
                sqrtPriceLimitX96: 0
            })
        );
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Internal
    // ─────────────────────────────────────────────────────────────────────────

    function _isWETH(address token) internal pure returns (bool) {
        return token == WETH_CELO;
    }
}
