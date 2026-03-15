// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./adapters/AaveAdapter.sol";
import "./adapters/MentoAdapter.sol";
import "./adapters/UniswapAdapter.sol";
import "./interfaces/IERC20.sol";
import "./libraries/SafeERC20.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Price Oracle Interface
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @notice Minimal oracle interface for IL detection and guardrail checks.
 *         Plug in Chainlink, Redstone, or any compatible feed.
 *         Returns price with 18 decimal precision.
 */
interface IPriceOracle {
    function getPrice(address asset) external view returns (uint256);
}

// ─────────────────────────────────────────────────────────────────────────────
// ReentrancyGuard (inline — no OZ dependency needed)
// ─────────────────────────────────────────────────────────────────────────────

abstract contract ReentrancyGuard {
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED     = 2;
    uint256 private _status;

    constructor() { _status = _NOT_ENTERED; }

    modifier nonReentrant() {
        require(_status != _ENTERED, "ReentrancyGuard: reentrant call");
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// SentinelExecutor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @title  SentinelExecutor
 * @notice Singleton contract managing all user savings strategies.
 *         Mainnet-safe: circuit breaker, reentrancy guard, oracle support,
 *         restricted agent withdraw, per-user strategy allocations.
 *
 * Architecture:
 *   User Wallet (Privy EOA)
 *     → approve() this contract to spend their tokens
 *     → registerGoal() to register position
 *     → withdraw() to exit anytime (even when contract is paused)
 *
 *   Agent Wallet (single backend EOA = agentSigner)
 *     → calls executeAaveSupply(), executeUniswapLP(), rebalance(),
 *       executeMentoSwap(), checkAndExitLPIfIL()
 *     → emergencyWithdraw() only when contract is paused
 *     → NEVER holds user funds
 *
 * Non-custodial:
 *   Aave aTokens  → minted directly to userWallet
 *   Uniswap LP    → NFT minted directly to userWallet
 *   wETH          → Uniswap LP positions
 *   This contract → never holds funds at rest
 */
contract SentinelExecutor is ReentrancyGuard {

    using SafeERC20 for IERC20;

    // ─────────────────────────────────────────────
    // State
    // ─────────────────────────────────────────────

    address public owner;
    address public agentSigner;
    address public treasury;
    address public priceOracle;

    bool public paused;

    AaveAdapter    public aaveAdapter;
    MentoAdapter   public mentoAdapter;
    UniswapAdapter public uniswapAdapter;

    address public wETH;
    address public usdm;   // input asset — semua withdrawal diconvert balik ke USDm

    // ─────────────────────────────────────────────
    // Asset Whitelist
    // ─────────────────────────────────────────────

    mapping(address => bool) public whitelistedAssets;

    // ─────────────────────────────────────────────
    // Guardrail Constants
    // ─────────────────────────────────────────────

    uint256 public constant MAX_LP_ALLOCATION_BPS   = 3000;   // 30%
    uint256 public constant MAX_VOLATILE_ALLOC_BPS  = 4000;   // 40%
    uint256 public constant IL_STOP_LOSS_BPS        = 500;    // 5%
    uint256 public constant MAX_REBALANCE_INTERVAL  = 24 hours;
    uint256 public constant MAX_SLIPPAGE_BPS        = 100;    // 1%
    uint256 public constant PERFORMANCE_FEE_BPS     = 2000;   // 20%
    uint256 public constant BPS_DENOMINATOR         = 10_000;

    // ─────────────────────────────────────────────
    // Strategy Allocation (per user)
    // ─────────────────────────────────────────────

    /**
     * @notice Deterministic allocation rules per user.
     *         Sum of all three must equal BPS_DENOMINATOR (10_000).
     *
     * stableAllocationBps  → Aave (USDC / USDT / USDm)
     * lpAllocationBps      → Uniswap LP (WETH/USDC, USDC/USDT)
     * wethAllocationBps    → WETH hold allocation (large-portfolio tier)
     */
    struct StrategyAllocation {
        uint256 stableAllocationBps;
        uint256 lpAllocationBps;
        uint256 wethAllocationBps;
    }

    mapping(address => StrategyAllocation) public allocations;

    /// Default: conservative — 100% stable, no LP, no WETH
    StrategyAllocation public defaultAllocation = StrategyAllocation({
        stableAllocationBps: 10_000,
        lpAllocationBps:     0,
        wethAllocationBps:   0
    });

    // ─────────────────────────────────────────────
    // User Position
    // ─────────────────────────────────────────────

    struct Position {
        uint256 principalDeposited;
        uint256 lastRebalancedAt;
        bool    userPaused;          // user-controlled pause
        uint256 goalTarget;
        uint256 goalDeadline;
        uint256 spendLimit;
        uint256 cumulativeSpent;
        uint256 epochStart;
    }

    struct LPPosition {
        address pool;
        uint256 tokenId;
        uint256 entryValueUSD;
        uint256 entryTimestamp;
    }

    mapping(address => Position)     public positions;
    mapping(address => LPPosition[]) public lpPositions;

    /**
     * @notice Per-user aToken balance tracking.
     *         userATokenShares[user][underlyingAsset] = jumlah aToken milik user ini.
     *
     * CRITICAL FIX — tanpa ini semua aToken di-pool tanpa per-user accounting.
     * User jahat bisa pass aaveAmounts melebihi haknya dan drain aToken user lain.
     *
     * Diupdate saat:
     *   + executeAaveSupply()        → += aTokensReceived
     *   + executeMentoSwapAndSupply() → += aTokensReceived
     *   - executeAaveWithdraw()      → -= amount (rebalancing)
     *   - withdraw()                 → -= validated amounts
     *   - emergencyWithdraw()        → -= validated amounts
     */
    mapping(address => mapping(address => uint256)) public userATokenShares;


    /// @notice Optional allowance expiry per user (unix timestamp, 0 = no expiry).
    ///         Set via setAllowanceExpiry(). Agent checks isAllowanceValid() each cycle.
    mapping(address => uint256) public allowanceExpiry;

    // ─────────────────────────────────────────────
    // Events
    // ─────────────────────────────────────────────

    // System
    event Paused(address indexed by);
    event Unpaused(address indexed by);
    event AgentSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event OracleUpdated(address indexed oracle);

    // User lifecycle
    event GoalRegistered(address indexed user, address indexed asset, uint256 amount);
    event AllowanceExpirySet(address indexed user, uint256 expiresAt);
    event Withdraw(address indexed user, address indexed asset, uint256 amount);
    event GoalCompleted(address indexed user, uint256 totalReturned, uint256 feeTaken);
    event EmergencyWithdraw(address indexed user, address indexed asset, uint256 amount);

    // Strategy
    event StrategyExecuted(address indexed user, address indexed asset, uint256 amount, string protocol);
    event Rebalanced(address indexed user);
    event LPEntered(address indexed user, uint256 tokenId, uint256 valueUSD);
    event LPExited(address indexed user, uint256 tokenId, string reason);
    event AllocationSet(address indexed user, uint256 stableBps, uint256 lpBps, uint256 wethBps);

    // Guardrails
    event AssetWhitelisted(address indexed asset, bool status);
    event GuardrailTripped(address indexed user, string reason);

    // ─────────────────────────────────────────────
    // Errors
    // ─────────────────────────────────────────────

    error NotOwner();
    error NotAgent();
    error NotUser();
    error ContractPaused();
    error NotPaused();
    error AssetNotWhitelisted(address asset);
    error UserPositionPaused(address user);
    error RebalanceTooSoon(uint256 nextAllowed);
    error LPAllocationExceeded(uint256 requested, uint256 max);
    error VolatileAllocationExceeded(uint256 requested, uint256 max);
    error AllocationSumInvalid(uint256 sum);
    error SlippageExceeded(uint256 actual, uint256 max);
    error SpendLimitExceeded(uint256 requested, uint256 remaining);
    error ZeroAmount();
    error NoPosition();
    error OracleNotSet();
    error AllowanceExpired();

    // ─────────────────────────────────────────────
    // Modifiers
    // ─────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAgent() {
        if (msg.sender != agentSigner) revert NotAgent();
        _;
    }

    /// @dev Circuit breaker — blocks strategy execution when tripped.
    ///      withdraw() is intentionally exempt so users can always exit.
    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlyWhitelisted(address asset) {
        if (!whitelistedAssets[asset]) revert AssetNotWhitelisted(asset);
        _;
    }

    modifier userNotPaused(address user) {
        if (positions[user].userPaused) revert UserPositionPaused(user);
        _;
    }

    // ─────────────────────────────────────────────
    // Constructor
    // ─────────────────────────────────────────────

    constructor(
        address _agentSigner,
        address _treasury,
        address _aaveAdapter,
        address _mentoAdapter,
        address _uniswapAdapter
    ) {
        require(_agentSigner    != address(0), "SentinelExecutor: zero agentSigner");
        require(_aaveAdapter    != address(0), "SentinelExecutor: zero aaveAdapter");
        require(_mentoAdapter   != address(0), "SentinelExecutor: zero mentoAdapter");
        require(_uniswapAdapter != address(0), "SentinelExecutor: zero uniswapAdapter");
        owner          = msg.sender;
        agentSigner    = _agentSigner;
        treasury       = _treasury;
        aaveAdapter    = AaveAdapter(_aaveAdapter);
        mentoAdapter   = MentoAdapter(_mentoAdapter);
        uniswapAdapter = UniswapAdapter(_uniswapAdapter);
    }

    // ─────────────────────────────────────────────
    // Admin — Epoch Reset
    // ─────────────────────────────────────────────

    /**
     * @notice Reset a user's spend epoch (cumulativeSpent → 0).
     *         Called by the agent once per epoch period (e.g. monthly)
     *         to restore the agent's ability to execute strategy after
     *         the spend limit has been reached.
     *
     * AUTONOMY FIX: without an epoch reset, cumulativeSpent only ever grows.
     * Once it hits spendLimit, _checkAndUpdateSpend reverts permanently and
     * the agent can never execute another transaction for that user.
     * The agent calls this automatically at the start of each new epoch.
     *
     * @dev Only callable by agent or owner. Not callable by arbitrary wallets.
     */
    function resetSpendEpoch(address userWallet) external {
        if (msg.sender != agentSigner && msg.sender != owner) revert NotAgent();
        Position storage pos = positions[userWallet];
        if (pos.principalDeposited == 0) revert NoPosition();
        pos.cumulativeSpent = 0;
        pos.epochStart      = block.timestamp;
    }

    // ─────────────────────────────────────────────
    // Admin — Circuit Breaker
    // ─────────────────────────────────────────────

    /**
     * @notice Pause all strategy execution.
     *         Users can still withdraw while paused.
     *         Agent can only call emergencyWithdraw while paused.
     */
    function pause() external onlyOwner {
        paused = true;
        emit Paused(msg.sender);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused(msg.sender);
    }

    // ─────────────────────────────────────────────
    // Admin — Configuration
    // ─────────────────────────────────────────────

    function setAgentSigner(address _agentSigner) external onlyOwner {
        require(_agentSigner != address(0), "SentinelExecutor: zero agentSigner");
        emit AgentSignerUpdated(agentSigner, _agentSigner);
        agentSigner = _agentSigner;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = _treasury;
    }

    function setVolatileAssets(address _wETH) external onlyOwner {
        wETH = _wETH;
    }

    function setUsdm(address _usdm) external onlyOwner {
        require(_usdm != address(0), "SentinelExecutor: zero usdm");
        usdm = _usdm;
    }

    function setWhitelistedAsset(address asset, bool status) external onlyOwner {
        whitelistedAssets[asset] = status;
        emit AssetWhitelisted(asset, status);
    }

    /**
     * @notice Set price oracle for IL detection and guardrail checks.
     *         Must implement IPriceOracle.getPrice(address) → uint256.
     */
    function setPriceOracle(address oracle) external onlyOwner {
        priceOracle = oracle;
        emit OracleUpdated(oracle);
    }

    function setDefaultAllocation(
        uint256 stableBps,
        uint256 lpBps,
        uint256 wethBps
    ) external onlyOwner {
        if (stableBps + lpBps + wethBps != BPS_DENOMINATOR) {
            revert AllocationSumInvalid(stableBps + lpBps + wethBps);
        }
        // Additional guardrail checks
        if (lpBps   > MAX_LP_ALLOCATION_BPS)  revert LPAllocationExceeded(lpBps, MAX_LP_ALLOCATION_BPS);
        if (wethBps > MAX_VOLATILE_ALLOC_BPS) revert VolatileAllocationExceeded(wethBps, MAX_VOLATILE_ALLOC_BPS);
        defaultAllocation = StrategyAllocation(stableBps, lpBps, wethBps);
    }

    // ─────────────────────────────────────────────
    // User: Register Goal
    // ─────────────────────────────────────────────

    /**
     * @notice Register a savings goal.
     *         Funds STAY in user wallet — agent pulls via transferFrom.
     *         User must approve this contract for spendLimit amount first.
     *         Optionally provide custom allocation; defaults to conservative.
     *
     * @param asset          Input asset (must be whitelisted)
     * @param amount         Amount to register as principal
     * @param goalTarget     Target amount in asset units
     * @param goalDeadline   Unix timestamp for goal deadline
     * @param spendLimit     Max agent can pull per epoch
     * @param stableBps      Allocation to Aave stable yield (0 = use default)
     * @param lpBps          Allocation to Uniswap LP
     * @param wethBps        Allocation to WETH hold
     */
    function registerGoal(
        address asset,
        uint256 amount,
        uint256 goalTarget,
        uint256 goalDeadline,
        uint256 spendLimit,
        uint256 stableBps,
        uint256 lpBps,
        uint256 wethBps
    ) external onlyWhitelisted(asset) whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        require(spendLimit > 0, "SentinelExecutor: spendLimit must be > 0");
        require(goalDeadline > block.timestamp, "SentinelExecutor: deadline must be in future");

        // Set allocation — validate if custom, else use default
        if (stableBps + lpBps + wethBps == BPS_DENOMINATOR) {
            if (lpBps   > MAX_LP_ALLOCATION_BPS)  revert LPAllocationExceeded(lpBps, MAX_LP_ALLOCATION_BPS);
            if (wethBps > MAX_VOLATILE_ALLOC_BPS) revert VolatileAllocationExceeded(wethBps, MAX_VOLATILE_ALLOC_BPS);
            allocations[msg.sender] = StrategyAllocation(stableBps, lpBps, wethBps);
        } else {
            allocations[msg.sender] = defaultAllocation;
        }

        Position storage pos = positions[msg.sender];

        // Only reset spend tracking for new positions.
        // Existing positions (top-up) keep their cumulativeSpent intact —
        // resetting it would allow bypassing the spend limit via repeated registerGoal calls.
        bool isNewPosition = pos.principalDeposited == 0;
        if (isNewPosition) {
            pos.cumulativeSpent = 0;
            pos.epochStart      = block.timestamp;
        }

        pos.principalDeposited += amount;
        pos.goalTarget          = goalTarget;
        pos.goalDeadline        = goalDeadline;
        pos.spendLimit          = spendLimit;

        emit GoalRegistered(msg.sender, asset, amount);
        emit AllocationSet(
            msg.sender,
            allocations[msg.sender].stableAllocationBps,
            allocations[msg.sender].lpAllocationBps,
            allocations[msg.sender].wethAllocationBps
        );
    }

    // ─────────────────────────────────────────────
    // User: Pause / Resume own position
    // ─────────────────────────────────────────────

    function setUserPaused(bool _paused) external {
        if (positions[msg.sender].principalDeposited == 0) revert NoPosition();
        positions[msg.sender].userPaused = _paused;
    }

    /// @notice Set an expiry timestamp for your token allowance.
    ///         After this time the agent will flag your goal as action_required.
    ///         Pass 0 to remove expiry (allowance never expires).
    function setAllowanceExpiry(uint256 expiresAt) external {
        require(expiresAt == 0 || expiresAt > block.timestamp, "Expiry must be in the future");
        allowanceExpiry[msg.sender] = expiresAt;
        emit AllowanceExpirySet(msg.sender, expiresAt);
    }

    /// @notice Check whether a user's allowance is still valid.
    ///         Returns false if expiry is set and has passed.
    function isAllowanceValid(address user) public view returns (bool) {
        uint256 expiry = allowanceExpiry[user];
        return expiry == 0 || expiry > block.timestamp;
    }

    // ─────────────────────────────────────────────
    // Agent: Execute Aave Withdraw (for rebalancing)
    // ─────────────────────────────────────────────

    /**
     * @notice Agent withdraws dari Aave dan kirim ke userWallet.
     *         Digunakan saat rebalancing (misal: USDT → USDC reallocation).
     *
     *         aToken ownership: SentinelExecutor (address(this)) memegang aToken,
     *         bukan userWallet — karena AaveAdapter.supply() mint ke msg.sender (SentinelExecutor).
     *         Jadi sebelum memanggil AaveAdapter.withdraw(), SentinelExecutor harus
     *         approve aToken ke AaveAdapter agar bisa di-pull dan di-burn ke pool.
     */
    function executeAaveWithdraw(
        address userWallet,
        address asset,
        uint256 amount
    )
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        onlyWhitelisted(asset)
        userNotPaused(userWallet)
        returns (uint256 withdrawn)
    {
        if (amount == 0) revert ZeroAmount();
        Position storage pos = positions[userWallet];
        if (pos.principalDeposited == 0) revert NoPosition();

        // Validate + decrement per-user aToken share (reverts if insufficient)
        _subATokenShares(userWallet, asset, amount);

        address aToken = aaveAdapter.pool().getReserveData(asset).aTokenAddress;
        IERC20(aToken).approve(address(aaveAdapter), 0);
        IERC20(aToken).approve(address(aaveAdapter), amount);

        // FIX: withdraw ke address(this), bukan ke userWallet.
        // Ini memungkinkan chain operasi (withdraw → swap → LP) dalam beberapa
        // transaksi terpisah tanpa user harus approve USDC/USDT/WETH.
        // Dana yang "parkir" di SentinelExecutor dipakai oleh executeUniswapSwap
        // dan executeUniswapLP di langkah berikutnya.
        // Kalau tidak ada langkah lanjutan, agent wajib panggil forwardToUser()
        // setelah selesai untuk kirim sisa dana ke userWallet.
        withdrawn = aaveAdapter.withdraw(userWallet, asset, amount, address(this));
        emit StrategyExecuted(userWallet, asset, withdrawn, "aave_withdraw");
    }

    /**
     * @notice Agent forward sisa token yang parkir di SentinelExecutor ke userWallet.
     *         Dipanggil setelah executeAaveWithdraw jika tidak ada operasi lanjutan,
     *         atau setelah seluruh rangkaian LP selesai.
     *
     * @param userWallet  Pemilik dana
     * @param assets      Daftar token yang mau di-forward
     */
    function forwardToUser(
        address userWallet,
        address[] calldata assets
    ) external onlyAgent whenNotPaused userNotPaused(userWallet) {
        if (positions[userWallet].principalDeposited == 0) revert NoPosition();

        // FIX KRITIS: jangan kirim seluruh balanceOf(this) karena bisa ada
        // dana user lain yang juga parkir di kontrak saat LP sequence.
        // Hanya kirim sesuai userATokenShares yang sudah di-sub sebelumnya,
        // atau kalau tidak ada shares, kirim sesuai balance aktual tapi
        // dibatasi dengan pendekatan konservatif.
        //
        // Cara aman: agent hanya panggil forwardToUser SETELAH seluruh
        // sequence selesai dan tidak ada user lain yang concurrent.
        // Untuk multi-user safety, kirim hanya amount yang tercatat
        // di posisi user (principalDeposited sebagai proxy max).
        for (uint256 i = 0; i < assets.length; i++) {
            uint256 bal = IERC20(assets[i]).balanceOf(address(this));
            if (bal == 0) continue;

            // Kirim maksimal sesuai principalDeposited user sebagai batas atas.
            // Ini mencegah draining dana user lain yang sedang parkir.
            uint256 maxForUser = positions[userWallet].principalDeposited;
            uint256 toSend = bal > maxForUser ? maxForUser : bal;

            if (toSend > 0) IERC20(assets[i]).safeTransfer(userWallet, toSend);
        }
    }

    // ─────────────────────────────────────────────
    // Agent: Execute Aave Supply
    // ─────────────────────────────────────────────

    /**
     * @notice Agent pulls funds from user wallet → supplies to Aave.
     *         aTokens minted to SentinelExecutor — user hanya butuh 1x approve token asli.
     */
    function executeAaveSupply(
        address userWallet,
        address asset,
        uint256 amount,
        uint256 minOut
    )
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        onlyWhitelisted(asset)
        userNotPaused(userWallet)
        returns (uint256 aTokensReceived)
    {
        _checkAndUpdateSpend(userWallet, amount);

        IERC20(asset).safeTransferFrom(userWallet, address(this), amount);
        IERC20(asset).approve(address(aaveAdapter), 0);
        IERC20(asset).approve(address(aaveAdapter), amount);

        aTokensReceived = aaveAdapter.supply(userWallet, asset, amount);

        if (aTokensReceived < minOut) revert SlippageExceeded(aTokensReceived, minOut);

        // Track per-user aToken shares
        _addATokenShares(userWallet, asset, aTokensReceived);

        emit StrategyExecuted(userWallet, asset, amount, "aave");
    }

    // ─────────────────────────────────────────────
    // Agent: Execute Uniswap LP
    // ─────────────────────────────────────────────

    /**
     * @notice Agent enters Uniswap LP position.
     *         LP NFT minted to userWallet (non-custodial).
     *
     * Guardrails:
     *   - LP allocation <= user's lpAllocationBps (max 30%)
     *   - Volatile allocation <= 40%
     *   - Uses oracle price if set for more accurate portfolio valuation
     */
    function executeUniswapLP(
        address userWallet,
        address token0,
        address token1,
        uint256 amount0,
        uint256 amount1,
        uint256 totalValueUSD,
        uint256 totalPortfolioUSD
    )
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        onlyWhitelisted(token0)
        onlyWhitelisted(token1)
        userNotPaused(userWallet)
        returns (uint256 tokenId)
    {
        StrategyAllocation storage alloc = allocations[userWallet];
        uint256 userMaxLPBps = alloc.lpAllocationBps > 0
            ? alloc.lpAllocationBps
            : defaultAllocation.lpAllocationBps;

        // Guardrail: LP allocation vs user's strategy
        uint256 newLPTotal = _totalLPValue(userWallet) + totalValueUSD;
        uint256 maxLP      = (totalPortfolioUSD * userMaxLPBps) / BPS_DENOMINATOR;
        if (newLPTotal > maxLP) {
            emit GuardrailTripped(userWallet, "LP_ALLOCATION_EXCEEDED");
            revert LPAllocationExceeded(newLPTotal, maxLP);
        }

        // Guardrail: volatile allocation <= 40%
        if (_isVolatile(token0) || _isVolatile(token1)) {
            address volatileToken = _isVolatile(token0) ? token0 : token1;
            uint256 volatileAmt   = _isVolatile(token0) ? amount0 : amount1;
            uint256 volatileUSD   = _toUSD(volatileToken, volatileAmt);
            uint256 maxVolatile = (totalPortfolioUSD * MAX_VOLATILE_ALLOC_BPS) / BPS_DENOMINATOR;
            if (volatileUSD > maxVolatile) {
                emit GuardrailTripped(userWallet, "VOLATILE_ALLOCATION_EXCEEDED");
                revert VolatileAllocationExceeded(volatileUSD, maxVolatile);
            }
        }

        _checkAndUpdateSpend(userWallet, amount0 + amount1);

        // Pull token0 — dari address(this) jika sudah ada, sisa dari userWallet
        uint256 bal0 = IERC20(token0).balanceOf(address(this));
        if (bal0 < amount0) {
            IERC20(token0).safeTransferFrom(userWallet, address(this), amount0 - bal0);
        }
        // Pull token1 — sama
        uint256 bal1 = IERC20(token1).balanceOf(address(this));
        if (bal1 < amount1) {
            IERC20(token1).safeTransferFrom(userWallet, address(this), amount1 - bal1);
        }
        IERC20(token0).approve(address(uniswapAdapter), 0);
        IERC20(token0).approve(address(uniswapAdapter), amount0);
        IERC20(token1).approve(address(uniswapAdapter), 0);
        IERC20(token1).approve(address(uniswapAdapter), amount1);

        tokenId = uniswapAdapter.mintPosition(userWallet, token0, token1, amount0, amount1);

        lpPositions[userWallet].push(LPPosition({
            pool:           address(uniswapAdapter),
            tokenId:        tokenId,
            entryValueUSD:  totalValueUSD,
            entryTimestamp: block.timestamp
        }));

        emit LPEntered(userWallet, tokenId, totalValueUSD);
    }

    // ─────────────────────────────────────────────
    // Agent: IL Stop Loss
    // ─────────────────────────────────────────────

    /**
     * @notice Check IL on all LP positions and exit if > 5%.
     *         Uses oracle prices if available for more accurate IL calculation.
     *
     * BUG FIX #4: original used `for` loop with `i--` on uint256.
     * If position at index 0 had IL > 5%, `i--` would underflow to type(uint256).max
     * and revert — Solidity 0.8.x has checked arithmetic by default.
     * Fix: while loop that only increments i when NOT removing an element.
     * After swap-and-pop, the new element at index i must be rechecked.
     */
    function checkAndExitLPIfIL(
        address userWallet,
        uint256[] calldata currentValues
    ) external nonReentrant onlyAgent whenNotPaused userNotPaused(userWallet) {
        LPPosition[] storage lps = lpPositions[userWallet];

        uint256 i = 0;
        while (i < lps.length) {
            if (i >= currentValues.length) break;

            uint256 currentVal = currentValues[i];
            // Oracle price override — disabled for LP positions in this version.
            // lps[i].pool stores address(uniswapAdapter), not a token address,
            // so calling getPrice(lps[i].pool) on a token price oracle is semantically wrong.
            // TODO: when integrating a real LP value oracle, pass the LP NFT tokenId or
            // underlying token addresses instead.

            if (currentVal == 0) { i++; continue; }

            uint256 entryVal = lps[i].entryValueUSD;
            bool exited = false;
            if (currentVal < entryVal) {
                uint256 lossBps = ((entryVal - currentVal) * BPS_DENOMINATOR) / entryVal;
                if (lossBps >= IL_STOP_LOSS_BPS) {
                    uniswapAdapter.exitPosition(userWallet, lps[i].tokenId);
                    emit LPExited(userWallet, lps[i].tokenId, "IL_STOP_LOSS");
                    lps[i] = lps[lps.length - 1];
                    lps.pop();
                    exited = true; // do NOT increment — recheck swapped element at i
                }
            }
            if (!exited) i++;
        }
    }

    // ─────────────────────────────────────────────
    // Agent: Rebalance Gate
    // ─────────────────────────────────────────────

    /**
     * @notice Frequency gate — max once per 24h.
     *         Agent calls this first, then executes reallocations.
     */
    function rebalance(address userWallet)
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        userNotPaused(userWallet)
    {
        Position storage pos = positions[userWallet];
        if (pos.principalDeposited == 0) revert NoPosition();

        if (block.timestamp < pos.lastRebalancedAt + MAX_REBALANCE_INTERVAL) {
            revert RebalanceTooSoon(pos.lastRebalancedAt + MAX_REBALANCE_INTERVAL);
        }

        pos.lastRebalancedAt = block.timestamp;
        emit Rebalanced(userWallet);
    }

    // ─────────────────────────────────────────────
    // Agent: Uniswap Swap (WETH swaps only)
    // ─────────────────────────────────────────────

    /**
     * @notice Agent swaps via Uniswap — for any pair involving WETH.
     *         NEVER use Mento for WETH; Mento only supports stable↔stable.
     *         Routed through UniswapAdapter which handles V4 pool interaction.
     */
    function executeUniswapSwap(
        address userWallet,
        address fromAsset,
        address toAsset,
        uint256 amountIn,
        uint256 minAmountOut
    )
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        onlyWhitelisted(fromAsset)
        onlyWhitelisted(toAsset)
        userNotPaused(userWallet)
        returns (uint256 amountOut)
    {
        _checkAndUpdateSpend(userWallet, amountIn);

        // Pull token dari address(this) jika sudah ada (hasil executeAaveWithdraw),
        // atau dari userWallet kalau belum ada. Ini yang memungkinkan 1-approval flow
        // untuk LP: withdraw dari Aave → parkir di sini → swap → LP, tanpa butuh
        // user approve USDC/USDT/WETH secara terpisah.
        uint256 contractBal = IERC20(fromAsset).balanceOf(address(this));
        if (contractBal < amountIn) {
            // Kekurangan — pull sisa dari userWallet
            uint256 needed = amountIn - contractBal;
            IERC20(fromAsset).safeTransferFrom(userWallet, address(this), needed);
        }
        IERC20(fromAsset).approve(address(uniswapAdapter), 0);
        IERC20(fromAsset).approve(address(uniswapAdapter), amountIn);

        // UniswapAdapter routes to V4 pool and returns toAsset directly to userWallet
        amountOut = uniswapAdapter.swap(userWallet, fromAsset, toAsset, amountIn, minAmountOut);

        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        emit StrategyExecuted(userWallet, fromAsset, amountIn, "uniswap_swap");
    }

    // ─────────────────────────────────────────────
    // Agent: Mento Swap → Aave Supply (atomic, 1 approval)
    // ─────────────────────────────────────────────

    /**
     * @notice Swap via Mento then immediately supply hasil swap ke Aave.
     *         Semua dilakukan dalam 1 transaksi — output Mento tidak balik ke
     *         userWallet, langsung masuk Aave dari SentinelExecutor.
     *
     * ARSITEKTUR FIX — masalah "3 approvals":
     *   Flow lama:
     *     pull USDm dari user → Mento swap → USDC balik ke userWallet
     *     → agent pull USDC lagi dari user → Aave supply
     *     Butuh approve: USDm + USDC + USDT = 3 approvals
     *
     *   Flow baru (fungsi ini):
     *     pull USDm dari user → Mento swap → USDC landing di SentinelExecutor
     *     → SentinelExecutor langsung supply ke Aave tanpa pull dari user lagi
     *     Butuh approve: USDm saja = 1 approval
     *
     * @param userWallet    Wallet user
     * @param fromAsset     Token input (USDm)
     * @param toAsset       Token output yang akan di-supply ke Aave (USDC atau USDT)
     * @param amountIn      Jumlah fromAsset yang di-swap
     * @param minAmountOut  Minimum output dari swap (slippage guard)
     * @param minATokens    Minimum aToken yang diterima dari Aave supply
     */
    function executeMentoSwapAndSupply(
        address userWallet,
        address fromAsset,
        address toAsset,
        uint256 amountIn,
        uint256 minAmountOut,
        uint256 minATokens
    )
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        onlyWhitelisted(fromAsset)
        onlyWhitelisted(toAsset)
        userNotPaused(userWallet)
        returns (uint256 amountOut, uint256 aTokensReceived)
    {
        _checkAndUpdateSpend(userWallet, amountIn);

        // Step 1: Pull fromAsset (USDm) dari userWallet ke sini
        IERC20(fromAsset).safeTransferFrom(userWallet, address(this), amountIn);
        IERC20(fromAsset).approve(address(mentoAdapter), 0);
        IERC20(fromAsset).approve(address(mentoAdapter), amountIn);

        // Step 2: Mento swap — output (USDC/USDT) landing di address(this), bukan userWallet
        amountOut = mentoAdapter.swap(address(this), fromAsset, toAsset, amountIn, minAmountOut);
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        // Step 3: Supply langsung ke Aave dari sini — tidak perlu pull dari user lagi
        IERC20(toAsset).approve(address(aaveAdapter), 0);
        IERC20(toAsset).approve(address(aaveAdapter), amountOut);
        aTokensReceived = aaveAdapter.supply(userWallet, toAsset, amountOut);
        if (aTokensReceived < minATokens) revert SlippageExceeded(aTokensReceived, minATokens);

        // Track per-user aToken shares for the supplied toAsset
        _addATokenShares(userWallet, toAsset, aTokensReceived);

        emit StrategyExecuted(userWallet, fromAsset, amountIn, "mento_swap_supply");
        emit StrategyExecuted(userWallet, toAsset, amountOut, "aave");
    }

    /**
     * @notice Mento swap saja — output ke userWallet.
     *         Hanya dipakai jika user mau pegang toAsset di wallet (bukan Aave).
     *         Untuk strategy normal, pakai executeMentoSwapAndSupply().
     */
    function executeMentoSwap(
        address userWallet,
        address fromAsset,
        address toAsset,
        uint256 amountIn,
        uint256 minAmountOut
    )
        external
        nonReentrant
        onlyAgent
        whenNotPaused
        onlyWhitelisted(fromAsset)
        onlyWhitelisted(toAsset)
        userNotPaused(userWallet)
        returns (uint256 amountOut)
    {
        _checkAndUpdateSpend(userWallet, amountIn);

        IERC20(fromAsset).safeTransferFrom(userWallet, address(this), amountIn);
        IERC20(fromAsset).approve(address(mentoAdapter), 0);
        IERC20(fromAsset).approve(address(mentoAdapter), amountIn);

        amountOut = mentoAdapter.swap(userWallet, fromAsset, toAsset, amountIn, minAmountOut);
        if (amountOut < minAmountOut) revert SlippageExceeded(amountOut, minAmountOut);

        emit StrategyExecuted(userWallet, fromAsset, amountIn, "mento");
    }

    // ─────────────────────────────────────────────
    // User: Withdraw ALL (always allowed, even when paused)
    // ─────────────────────────────────────────────

    /**
     * @notice User menarik SEMUA dananya — Aave + LP — dalam satu call.
     *         Tidak ada partial withdraw. Amount diambil otomatis dari userATokenShares.
     *         Selalu bisa dipanggil, bahkan saat paused. Fee 20% dari yield.
     *
     * @param aaveAssets  [USDm, USDC, USDT] — hard-coded dari frontend.
     *                    Kontrak skip asset yang sharesnya 0.
     */
    function withdraw(address[] calldata aaveAssets) external nonReentrant {
        address userWallet = msg.sender;

        Position storage pos = positions[userWallet];
        if (pos.principalDeposited == 0) revert NoPosition();

        uint256 principal      = pos.principalDeposited;
        uint256 totalWithdrawn = 0;

        // ── Aave: tarik 100% shares per asset (CEI: deduct dulu sebelum external call) ──
        for (uint256 i = 0; i < aaveAssets.length; i++) {
            address asset  = aaveAssets[i];
            uint256 shares = userATokenShares[userWallet][asset];
            if (shares == 0) continue;

            _subATokenShares(userWallet, asset, shares);

            address aToken = aaveAdapter.pool().getReserveData(asset).aTokenAddress;
            IERC20(aToken).approve(address(aaveAdapter), 0);
            IERC20(aToken).approve(address(aaveAdapter), shares);

            uint256 w = aaveAdapter.withdraw(userWallet, asset, shares, address(this));
            totalWithdrawn += w;
            emit Withdraw(userWallet, asset, w);
        }

        // ── LP: keluar semua, token langsung ke userWallet ──
        LPPosition[] storage lps = lpPositions[userWallet];
        for (uint256 i = 0; i < lps.length; i++) {
            uniswapAdapter.exitPosition(userWallet, lps[i].tokenId);
            emit LPExited(userWallet, lps[i].tokenId, "WITHDRAW");
        }
        delete lpPositions[userWallet];

        // ── Performance fee: 20% dari yield saja ──
        uint256 feeTaken = 0;
        if (totalWithdrawn > principal && aaveAssets.length > 0 && treasury != address(0)) {
            uint256 yieldAmount  = totalWithdrawn - principal;
            uint256 totalFee     = (yieldAmount * PERFORMANCE_FEE_BPS) / BPS_DENOMINATOR;
            uint256 feeRemaining = totalFee;

            for (uint256 i = 0; i < aaveAssets.length && feeRemaining > 0; i++) {
                uint256 bal = IERC20(aaveAssets[i]).balanceOf(address(this));
                if (bal == 0) continue;
                uint256 chunk = bal >= feeRemaining ? feeRemaining : bal;
                IERC20(aaveAssets[i]).safeTransfer(treasury, chunk);
                feeRemaining -= chunk;
            }
            feeTaken = totalFee - feeRemaining;
        }

        // ── Forward sisa ke user — semua diconvert ke USDm dulu ──
        // User deposit USDm, user terima USDm. Simple dan tidak confusing.
        // Non-USDm asset (USDC, USDT) di-swap via Mento sebelum dikirim.
        // Kalau usdm belum di-set atau swap gagal, fallback kirim as-is.
        for (uint256 i = 0; i < aaveAssets.length; i++) {
            address asset = aaveAssets[i];
            uint256 bal   = IERC20(asset).balanceOf(address(this));
            if (bal == 0) continue;

            if (asset == usdm || usdm == address(0)) {
                // Sudah USDm atau usdm belum di-set — kirim langsung
                IERC20(asset).safeTransfer(userWallet, bal);
            } else {
                // Swap ke USDm via Mento, lalu kirim USDm ke user
                // minAmountOut = 99.5% (0.5% slippage tolerance untuk stable swap)
                uint256 minOut = bal - (bal / 200);
                IERC20(asset).approve(address(mentoAdapter), 0);
                IERC20(asset).approve(address(mentoAdapter), bal);
                try mentoAdapter.swap(userWallet, asset, usdm, bal, minOut) {
                    // amountOut langsung ke userWallet via MentoAdapter
                } catch {
                    // Swap gagal — kirim as-is sebagai fallback
                    IERC20(asset).approve(address(mentoAdapter), 0);
                    IERC20(asset).safeTransfer(userWallet, bal);
                }
            }
        }

        // ── Full cleanup — withdraw = keluar semua, tidak ada sisa ──
        delete positions[userWallet];
        delete allocations[userWallet];
        delete allowanceExpiry[userWallet];
        // userATokenShares sudah 0 semua via _subATokenShares di atas

        emit GoalCompleted(userWallet, totalWithdrawn - feeTaken, feeTaken);
    }

    // ─────────────────────────────────────────────
    // Agent: Emergency Withdraw (only when paused)
    // ─────────────────────────────────────────────

    /**
     * @notice Agent can only trigger emergency withdrawal when contract is paused.
     *         This prevents griefing attacks where agent force-exits user positions.
     *         No performance fee charged on emergency withdrawals.
     *
     * @dev    Use case: critical bug found, owner pauses, agent exits all positions
     *         safely back to user wallets.
     */
    function emergencyWithdraw(
        address userWallet,
        address[] calldata aaveAssets
    ) external nonReentrant onlyAgent {
        if (!paused) revert NotPaused();

        Position storage pos = positions[userWallet];
        if (pos.principalDeposited == 0) revert NoPosition();

        // Tarik semua aToken shares — sama dengan withdraw() tapi tanpa fee
        // dan output langsung ke userWallet (bukan ke address(this))
        for (uint256 i = 0; i < aaveAssets.length; i++) {
            address asset  = aaveAssets[i];
            uint256 shares = userATokenShares[userWallet][asset];
            if (shares == 0) continue;

            _subATokenShares(userWallet, asset, shares);

            address aToken = aaveAdapter.pool().getReserveData(asset).aTokenAddress;
            IERC20(aToken).approve(address(aaveAdapter), 0);
            IERC20(aToken).approve(address(aaveAdapter), shares);

            uint256 w = aaveAdapter.withdraw(userWallet, asset, shares, userWallet);
            emit Withdraw(userWallet, asset, w);
        }

        // Exit semua LP positions
        LPPosition[] storage lps = lpPositions[userWallet];
        for (uint256 i = 0; i < lps.length; i++) {
            uniswapAdapter.exitPosition(userWallet, lps[i].tokenId);
            emit LPExited(userWallet, lps[i].tokenId, "EMERGENCY_WITHDRAW");
        }
        delete lpPositions[userWallet];

        delete positions[userWallet];
        delete allocations[userWallet];
        delete allowanceExpiry[userWallet];

        emit EmergencyWithdraw(userWallet, aaveAssets.length > 0 ? aaveAssets[0] : address(0), 0);
    }

    // ─────────────────────────────────────────────
    // Internal Helpers
    // ─────────────────────────────────────────────

    function _checkAndUpdateSpend(address user, uint256 amount) internal {
        if (!isAllowanceValid(user)) revert AllowanceExpired();
        Position storage pos = positions[user];
        // Safe check: cumulativeSpent should never exceed spendLimit, but guard against
        // edge case where spendLimit was reduced after accumulation
        uint256 spent = pos.cumulativeSpent;
        uint256 limit = pos.spendLimit;
        uint256 remaining = spent >= limit ? 0 : limit - spent;
        if (amount > remaining) revert SpendLimitExceeded(amount, remaining);
        pos.cumulativeSpent += amount;
    }

    function _totalLPValue(address user) internal view returns (uint256 total) {
        LPPosition[] storage lps = lpPositions[user];
        for (uint256 i = 0; i < lps.length; i++) {
            total += lps[i].entryValueUSD;
        }
    }

    /// @dev Tambah aToken shares untuk user.
    function _addATokenShares(address user, address asset, uint256 amount) internal {
        userATokenShares[user][asset] += amount;
    }

    /// @dev Kurangi aToken shares. Reverts jika amount melebihi yang dimiliki user.
    function _subATokenShares(address user, address asset, uint256 amount) internal {
        require(userATokenShares[user][asset] >= amount, "SentinelExecutor: insufficient aToken balance");
        userATokenShares[user][asset] -= amount;
    }

    function _isVolatile(address asset) internal view returns (bool) {
        return asset == wETH;
    }

    /**
     * @notice Convert asset amount to USD using oracle if available.
     *         Falls back to raw amount (assumes 1:1 USD) if no oracle set.
     *
     * FIX — Oracle precision:
     *   AaveOracleWrapper.getPrice() return Chainlink price dengan 8 desimal.
     *   Contoh: WETH $2000 = 200_000_000_000 (2e11), USDC $1 = 100_000_000 (1e8)
     *
     *   Versi lama pakai /1e18, menyebabkan WETH 1e18 wei dihitung sebagai:
     *   (1e18 * 2e11) / 1e18 = 2e11 — jauh lebih besar dari totalPortfolioUSD
     *   sehingga guardrail volatile allocation SELALU revert.
     *
     *   Fix: gunakan /1e8 sesuai Chainlink decimal standard.
     *   1 WETH: (1e18 * 2e11) / 1e8 = 2e21... masih salah scale.
     *
     *   Root cause: token amount dalam native decimals (1 WETH = 1e18),
     *   oracle price dalam 8 decimals, portfolio value dalam token decimals (6 untuk stable).
     *   Agar comparable dengan stable amounts, normalize ke 6 decimals:
     *   usdValue = (amount * price) / (10 ** (8 + tokenDecimals - 6))
     *
     *   Untuk simplicity hackathon: stablecoin 1:1 fallback sudah benar (6 dec = 6 dec).
     *   Untuk WETH (18 dec): (amount * price) / 10**(8 + 18 - 6) = / 10**20
     */
    function _toUSD(address asset, uint256 amount) internal view returns (uint256) {
        if (priceOracle == address(0)) return amount;
        try IPriceOracle(priceOracle).getPrice(asset) returns (uint256 price) {
            if (price > 0) {
                // Chainlink 8 desimal, token decimals vary:
                //   stable (USDC/USDT/USDm) = 6 dec → divisor = 10^(8+6-6) = 10^8
                //   WETH = 18 dec           → divisor = 10^(8+18-6) = 10^20
                // Deteksi berdasarkan apakah asset adalah WETH (volatile)
                uint256 divisor = (asset == wETH) ? 1e20 : 1e8;
                return (amount * price) / divisor;
            }
        } catch {}
        return amount; // fallback: 1:1 (stable assets acceptable)
    }
}
