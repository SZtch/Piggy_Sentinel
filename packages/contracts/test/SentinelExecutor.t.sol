// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SentinelExecutor.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Mock Contracts
// ─────────────────────────────────────────────────────────────────────────────

/// @dev Minimal ERC20 mock
contract MockERC20 {
    string  public name;
    string  public symbol;
    uint8   public decimals;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    constructor(string memory _name, string memory _symbol, uint8 _decimals) {
        name = _name; symbol = _symbol; decimals = _decimals;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "insufficient");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "ERC20: insufficient balance");
        require(allowance[from][msg.sender] >= amount, "ERC20: insufficient allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev AaveAdapter mock — supply dan withdraw 1:1
contract MockAaveAdapter {
    MockERC20 public aUsdc;
    MockERC20 public aUsdt;
    MockERC20 public aUsdm;
    address   public executor;

    // Simple pool struct untuk getReserveData
    struct ReserveData {
        uint256 configuration; uint128 liquidityIndex; uint128 currentLiquidityRate;
        uint128 variableBorrowIndex; uint128 currentVariableBorrowRate;
        uint128 currentStableBorrowRate; uint40 lastUpdateTimestamp; uint16 id;
        address aTokenAddress; address stableDebtTokenAddress;
        address variableDebtTokenAddress; address interestRateStrategyAddress;
        uint128 accruedToTreasury; uint128 unbacked; uint128 isolationModeTotalDebt;
    }

    mapping(address => address) public aTokenMap;

    constructor(address _aUsdc, address _aUsdt, address _aUsdm) {
        aUsdc = MockERC20(_aUsdc);
        aUsdt = MockERC20(_aUsdt);
        aUsdm = MockERC20(_aUsdm);
    }

    function setExecutor(address _executor) external { executor = _executor; }

    function setAToken(address underlying, address aToken) external {
        aTokenMap[underlying] = aToken;
    }

    // Expose pool() yang return this — untuk getReserveData
    function pool() external view returns (MockAaveAdapter) { return this; }

    function getReserveData(address asset) external view returns (ReserveData memory data) {
        data.aTokenAddress = aTokenMap[asset];
    }

    function supply(address, address asset, uint256 amount) external returns (uint256) {
        MockERC20(asset).transferFrom(msg.sender, address(this), amount);
        uint256 before = MockERC20(aTokenMap[asset]).balanceOf(msg.sender);
        MockERC20(aTokenMap[asset]).mint(msg.sender, amount);
        return MockERC20(aTokenMap[asset]).balanceOf(msg.sender) - before;
    }

    function withdraw(address, address asset, uint256 amount, address recipient) external returns (uint256) {
        MockERC20(aTokenMap[asset]).transferFrom(msg.sender, address(this), amount);
        MockERC20(asset).mint(recipient, amount);
        return amount;
    }
}

/// @dev MentoAdapter mock — swap 1:1, bisa di-set untuk fail
contract MockMentoAdapter {
    address public executor;
    bool    public shouldFail;

    function setExecutor(address _executor) external { executor = _executor; }
    function setShouldFail(bool _fail) external { shouldFail = _fail; }

    function swap(address recipient, address fromAsset, address toAsset, uint256 amountIn, uint256 minOut)
        external returns (uint256)
    {
        require(!shouldFail, "MockMento: forced failure");
        MockERC20(fromAsset).transferFrom(msg.sender, address(this), amountIn);
        require(amountIn >= minOut, "slippage");
        MockERC20(toAsset).mint(recipient, amountIn);
        return amountIn;
    }
}

/// @dev UniswapAdapter mock — bisa di-set supaya exitPosition fail untuk tokenId tertentu
contract MockUniswapAdapter {
    address public executor;
    bool    public exitShouldFail;
    uint256 public exitFailTokenId;

    function setExecutor(address _executor) external { executor = _executor; }

    function setExitFailure(bool _fail, uint256 _tokenId) external {
        exitShouldFail  = _fail;
        exitFailTokenId = _tokenId;
    }

    function mintPosition(address, address, address, uint256, uint256, uint256, uint256)
        external pure returns (uint256) { return 42; }

    function exitPosition(address, uint256 tokenId) external view {
        if (exitShouldFail && tokenId == exitFailTokenId)
            revert("MockUniswap: forced exit failure");
    }

    function swap(address, address, address, uint256, uint256) external pure returns (uint256) { return 0; }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Test Contract
// ─────────────────────────────────────────────────────────────────────────────

contract SentinelExecutorTest is Test {

    SentinelExecutor   executor;
    MockAaveAdapter    aaveMock;
    MockMentoAdapter   mentoMock;
    MockUniswapAdapter uniMock;

    MockERC20 usdc;  MockERC20 usdt;  MockERC20 usdm;  MockERC20 weth;
    MockERC20 aUsdc; MockERC20 aUsdt; MockERC20 aUsdm;

    address owner       = makeAddr("owner");
    address agentSigner = makeAddr("agent");
    address treasury    = makeAddr("treasury");
    address user        = makeAddr("user");
    address user2       = makeAddr("user2");
    address attacker    = makeAddr("attacker");

    uint256 constant DEPOSIT  = 100e6;
    uint256 constant LIMIT    = 500e6;
    uint256 constant LIMIT_18 = 500e18;
    uint256 constant TARGET   = 200e6;
    uint256 constant DEADLINE = 180 days;

    // ── Setup ─────────────────────────────────────────────────────────────

    function setUp() public {
        usdc  = new MockERC20("USDC",  "USDC",  6);
        usdt  = new MockERC20("USDT",  "USDT",  6);
        usdm  = new MockERC20("USDm",  "USDm",  18);
        weth  = new MockERC20("WETH",  "WETH",  18);
        aUsdc = new MockERC20("aUSDC", "aUSDC", 6);
        aUsdt = new MockERC20("aUSDT", "aUSDT", 6);
        aUsdm = new MockERC20("aUSDm", "aUSDm", 18);

        aaveMock  = new MockAaveAdapter(address(aUsdc), address(aUsdt), address(aUsdm));
        aaveMock.setAToken(address(usdc), address(aUsdc));
        aaveMock.setAToken(address(usdt), address(aUsdt));
        aaveMock.setAToken(address(usdm), address(aUsdm));
        mentoMock = new MockMentoAdapter();
        uniMock   = new MockUniswapAdapter();

        vm.prank(owner);
        executor = new SentinelExecutor(
            agentSigner, treasury,
            address(aaveMock), address(mentoMock), address(uniMock)
        );

        aaveMock.setExecutor(address(executor));
        mentoMock.setExecutor(address(executor));
        uniMock.setExecutor(address(executor));

        vm.startPrank(owner);
        executor.setAssetDecimals(address(usdc), 6);
        executor.setAssetDecimals(address(usdt), 6);
        executor.setAssetDecimals(address(usdm), 18);
        executor.setAssetDecimals(address(weth), 18);
        executor.setWhitelistedAsset(address(usdc), true);
        executor.setWhitelistedAsset(address(usdt), true);
        executor.setWhitelistedAsset(address(usdm), true);
        executor.setWhitelistedAsset(address(weth), true);
        executor.setVolatileAssets(address(weth));
        executor.setUsdm(address(usdm));
        vm.stopPrank();

        // Fund users
        usdc.mint(user,  DEPOSIT * 20);
        usdc.mint(user2, DEPOSIT * 20);
        usdm.mint(user,  100e18 * 20);
        usdm.mint(user2, 100e18 * 20);
        usdt.mint(address(mentoMock), DEPOSIT * 100);
        usdm.mint(address(mentoMock), 100e18 * 100);
    }

    // ── Helpers ───────────────────────────────────────────────────────────

    function _register(address _user, address asset, uint256 amount) internal {
        vm.startPrank(_user);
        MockERC20(asset).approve(address(executor), type(uint256).max);
        executor.registerGoal(
            asset, amount, TARGET,
            block.timestamp + DEADLINE,
            LIMIT, 10_000, 0, 0
        );
        vm.stopPrank();
    }

    function _supply(address _user, address asset, uint256 amount) internal returns (uint256) {
        vm.prank(agentSigner);
        return executor.executeAaveSupply(_user, asset, amount, 0);
    }

    function _withdrawAssets(address _user, address[] memory assets) internal {
        vm.prank(_user);
        executor.withdraw(assets);
    }

    function _oneAsset(address asset) internal pure returns (address[] memory) {
        address[] memory a = new address[](1);
        a[0] = asset;
        return a;
    }

    // ═════════════════════════════════════════════════════════════════════
    // P0-A: AGENT SIGNER TIMELOCK
    // ═════════════════════════════════════════════════════════════════════

    function test_timelock_propose_setsState() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        executor.proposeAgentSigner(newAgent);

        assertEq(executor.pendingAgentSigner(), newAgent);
        assertEq(executor.agentSignerChangeAt(), block.timestamp + 48 hours);
    }

    function test_timelock_execute_beforeDelay_reverts() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        executor.proposeAgentSigner(newAgent);

        vm.prank(owner);
        vm.expectRevert(
            abi.encodeWithSelector(
                SentinelExecutor.TimelockNotExpired.selector,
                block.timestamp + 48 hours
            )
        );
        executor.executeAgentSignerChange();
    }

    function test_timelock_execute_afterDelay_succeeds() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        executor.proposeAgentSigner(newAgent);

        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(owner);
        executor.executeAgentSignerChange();

        assertEq(executor.agentSigner(), newAgent);
        assertEq(executor.pendingAgentSigner(), address(0));
        assertEq(executor.agentSignerChangeAt(), 0);
    }

    function test_timelock_cancel_clearsPending() public {
        address newAgent = makeAddr("newAgent");
        vm.prank(owner);
        executor.proposeAgentSigner(newAgent);

        vm.prank(owner);
        executor.cancelAgentSignerChange();

        assertEq(executor.pendingAgentSigner(), address(0));
        assertEq(executor.agentSignerChangeAt(), 0);
    }

    function test_timelock_noPending_reverts() public {
        vm.prank(owner);
        vm.expectRevert(SentinelExecutor.NoPendingSignerChange.selector);
        executor.executeAgentSignerChange();
    }

    function test_timelock_oldAgent_works_during48h() public {
        _register(user, address(usdc), DEPOSIT);
        address newAgent = makeAddr("newAgent");

        vm.prank(owner);
        executor.proposeAgentSigner(newAgent);

        // Agent lama masih bisa beroperasi
        vm.prank(agentSigner);
        executor.executeAaveSupply(user, address(usdc), 10e6, 0);
        // tidak revert
    }

    function test_timelock_proposeSameAsCurrent_reverts() public {
        vm.prank(owner);
        vm.expectRevert("SentinelExecutor: same as current");
        executor.proposeAgentSigner(agentSigner);
    }

    function test_timelock_onlyOwner_canPropose() public {
        vm.prank(attacker);
        vm.expectRevert(SentinelExecutor.NotOwner.selector);
        executor.proposeAgentSigner(makeAddr("x"));
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX #4: RESET SPEND EPOCH — 30 DAY MINIMUM
    // ═════════════════════════════════════════════════════════════════════

    function test_epoch_resetTooSoon_reverts() public {
        _register(user, address(usdc), DEPOSIT);

        vm.prank(agentSigner);
        vm.expectRevert(); // EpochResetTooSoon — plain revert matches any custom error with args
        executor.resetSpendEpoch(user);
    }

    function test_epoch_resetAfter30Days_succeeds() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 50e6);

        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(agentSigner);
        executor.resetSpendEpoch(user);

        (,,,,,, uint256 spent,) = executor.positions(user);
        assertEq(spent, 0, "cumulativeSpent harus 0 setelah reset");
    }

    function test_epoch_agentCanReset() public {
        _register(user, address(usdc), DEPOSIT);
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(agentSigner);
        executor.resetSpendEpoch(user); // autonomous — tidak revert
    }

    function test_epoch_ownerCanReset() public {
        _register(user, address(usdc), DEPOSIT);
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(owner);
        executor.resetSpendEpoch(user);
    }

    function test_epoch_attackerCannotReset() public {
        _register(user, address(usdc), DEPOSIT);
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(attacker);
        vm.expectRevert();
        executor.resetSpendEpoch(user);
    }

    function test_epoch_consecutiveResets_require30Days() public {
        // Pakai absolute timestamps supaya tidak ada ambiguitas
        uint256 t0 = 1_000_000;
        vm.warp(t0);
        _register(user, address(usdc), DEPOSIT); // epochStart = t0

        // Reset pertama setelah 30 hari
        vm.warp(t0 + 30 days + 1);
        vm.prank(agentSigner);
        executor.resetSpendEpoch(user); // epochStart = t0 + 30 days + 1

        // Langsung reset lagi → revert
        vm.prank(agentSigner);
        vm.expectRevert(); // EpochResetTooSoon with args
        executor.resetSpendEpoch(user);

        // Reset setelah 30 hari dari epoch baru → OK
        vm.warp(t0 + 30 days + 1 + 30 days + 1);
        vm.prank(agentSigner);
        executor.resetSpendEpoch(user); // tidak revert
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX #2: PROPORTIONAL YIELD (totalATokenShares)
    // ═════════════════════════════════════════════════════════════════════

    function test_yield_totalSharesUpdatesOnSupply() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 50e6);

        assertEq(executor.totalATokenShares(address(usdc)), 50e6);
    }

    function test_yield_totalSharesUpdatesOnWithdraw() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);

        _withdrawAssets(user, _oneAsset(address(usdc)));

        assertEq(executor.totalATokenShares(address(usdc)), 0, "Total shares harus 0 setelah withdraw");
    }

    function test_yield_twoUsers_sharesCorrect() public {
        _register(user,  address(usdc), DEPOSIT);
        _register(user2, address(usdc), DEPOSIT);
        _supply(user,  address(usdc), 50e6);
        _supply(user2, address(usdc), 30e6);

        assertEq(executor.totalATokenShares(address(usdc)), 80e6);
        assertEq(executor.userATokenShares(user,  address(usdc)), 50e6);
        assertEq(executor.userATokenShares(user2, address(usdc)), 30e6);
    }

    function test_yield_withdraw_includesYield() public {
        // Pakai USDm (18 dec) — tidak lewat Mento, dikirim langsung ke user
        vm.startPrank(user);
        usdm.approve(address(executor), type(uint256).max);
        executor.registerGoal(address(usdm), 100e18, TARGET, block.timestamp + DEADLINE, type(uint256).max, 10_000, 0, 0);
        vm.stopPrank();
        vm.prank(agentSigner); executor.executeAaveSupply(user, address(usdm), 100e18, 0);

        // Simulasi 10 USDm yield
        aUsdm.mint(address(executor), 10e18);

        uint256 before = usdm.balanceOf(user);
        _withdrawAssets(user, _oneAsset(address(usdm)));
        uint256 received = usdm.balanceOf(user) - before;

        // 100 + 10 yield - 2 fee (20% dari 10) = 108 USDm
        assertApproxEqAbs(received, 108e18, 1e16, "User harus dapat principal + yield - fee");
    }

    function test_yield_twoUsers_proportionalYield() public {
        // Pakai USDm supaya tidak ada Mento conversion
        vm.startPrank(user);
        usdm.approve(address(executor), type(uint256).max);
        executor.registerGoal(address(usdm), 100e18, TARGET, block.timestamp + DEADLINE, LIMIT_18, 10_000, 0, 0);
        vm.stopPrank();
        vm.startPrank(user2);
        usdm.approve(address(executor), type(uint256).max);
        executor.registerGoal(address(usdm), 100e18, TARGET, block.timestamp + DEADLINE, LIMIT_18, 10_000, 0, 0);
        vm.stopPrank();
        _supply(user,  address(usdm), 100e18);
        _supply(user2, address(usdm), 100e18);

        // 20 USDm yield total
        aUsdm.mint(address(executor), 20e18);

        uint256 b1 = usdm.balanceOf(user);
        _withdrawAssets(user, _oneAsset(address(usdm)));
        uint256 r1 = usdm.balanceOf(user) - b1;

        uint256 b2 = usdm.balanceOf(user2);
        _withdrawAssets(user2, _oneAsset(address(usdm)));
        uint256 r2 = usdm.balanceOf(user2) - b2;

        // Masing-masing ~108 USDm (100 + 10 yield - 2 fee)
        assertApproxEqAbs(r1, 108e18, 2e16, "User1 harus dapat ~108 USDm");
        assertApproxEqAbs(r2, 108e18, 2e16, "User2 harus dapat ~108 USDm");
    }

    function test_yield_performanceFee_onYieldOnly() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);
        aUsdc.mint(address(executor), 10e6); // 10 USDC yield

        uint256 tBefore = usdc.balanceOf(treasury);
        _withdrawAssets(user, _oneAsset(address(usdc)));

        // 20% dari 10 = 2 USDC fee
        assertApproxEqAbs(usdc.balanceOf(treasury) - tBefore, 2e6, 1e4);
    }

    function test_yield_noYield_noFee() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);

        uint256 tBefore = usdc.balanceOf(treasury);
        _withdrawAssets(user, _oneAsset(address(usdc)));
        assertEq(usdc.balanceOf(treasury), tBefore, "Tidak ada fee kalau tidak ada yield");
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX #3: PARKEDFUNDS — MULTI-USER ISOLATION
    // ═════════════════════════════════════════════════════════════════════

    function test_parked_creditedAfterAaveWithdraw() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);

        vm.prank(agentSigner);
        executor.executeAaveWithdraw(user, address(usdc), 50e6);

        assertEq(executor.parkedFunds(user, address(usdc)), 50e6);
    }

    function test_parked_isolatedBetweenUsers() public {
        _register(user,  address(usdc), DEPOSIT);
        _register(user2, address(usdc), DEPOSIT);
        _supply(user,  address(usdc), 100e6);
        _supply(user2, address(usdc), 100e6);

        vm.prank(agentSigner);
        executor.executeAaveWithdraw(user, address(usdc), 100e6);

        assertEq(executor.parkedFunds(user,  address(usdc)), 100e6, "User1 punya 100 parked");
        assertEq(executor.parkedFunds(user2, address(usdc)), 0,     "User2 punya 0 parked");
    }

    function test_parked_forwardToUser_onlyOwnFunds() public {
        _register(user,  address(usdc), DEPOSIT);
        _register(user2, address(usdc), DEPOSIT);
        _supply(user,  address(usdc), 100e6);
        _supply(user2, address(usdc), 100e6);

        vm.startPrank(agentSigner);
        executor.executeAaveWithdraw(user,  address(usdc), 100e6);
        executor.executeAaveWithdraw(user2, address(usdc), 100e6);
        vm.stopPrank();

        uint256 b1 = usdc.balanceOf(user);
        uint256 b2 = usdc.balanceOf(user2);

        vm.prank(agentSigner);
        executor.forwardToUser(user, _oneAsset(address(usdc)));

        // Hanya user1 yang terima
        assertEq(usdc.balanceOf(user) - b1, 100e6, "User1 terima 100 USDC");
        assertEq(usdc.balanceOf(user2), b2,        "User2 tidak terima apa-apa");

        // parkedFunds user1 cleared, user2 masih 100
        assertEq(executor.parkedFunds(user,  address(usdc)), 0,     "User1 cleared");
        assertEq(executor.parkedFunds(user2, address(usdc)), 100e6, "User2 masih 100");
    }

    function test_parked_forwardToUser_clearAfterSend() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);

        vm.prank(agentSigner);
        executor.executeAaveWithdraw(user, address(usdc), 100e6);

        vm.prank(agentSigner);
        executor.forwardToUser(user, _oneAsset(address(usdc)));

        assertEq(executor.parkedFunds(user, address(usdc)), 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX A1: LP EXIT TRY/CATCH
    // ═════════════════════════════════════════════════════════════════════

    function _setupLP() internal returns (uint256 tokenId) {
        // Pakai USDC-USDT (stable pair) — tidak ada volatile allocation check
        // WETH pair butuh oracle untuk _toUSD, tanpa oracle 5e15 WETH >>
        // totalPortfolioUSD dalam 6 dec → VolatileAllocationExceeded selalu revert
        vm.startPrank(user);
        usdc.approve(address(executor), type(uint256).max);
        usdt.approve(address(executor), type(uint256).max);
        executor.registerGoal(
            address(usdc), DEPOSIT, TARGET,
            block.timestamp + DEADLINE,
            LIMIT,
            7_000, // 70% stable
            3_000, // 30% LP
            0      // 0% WETH
        );
        vm.stopPrank();

        usdt.mint(user, 100e6);
        vm.prank(user);
        usdt.approve(address(executor), type(uint256).max);

        _supply(user, address(usdc), 50e6);

        vm.prank(agentSigner);
        tokenId = executor.executeUniswapLP(
            user,
            address(usdc), address(usdt), // stable-stable, no volatile check
            10e6, 10e6,                    // 10 USDC + 10 USDT
            0, 0,                          // slippage mins
            20e6,                          // totalValueUSD = 20 USDC
            1000e6                         // totalPortfolioUSD = 1000 USDC, 20/1000 = 2% < 30% LP max
        );
    }

    function test_lp_exitFails_doesNotDeleteRecord() public {
        uint256 tokenId = _setupLP();
        uniMock.setExitFailure(true, tokenId);

        // Withdraw tidak revert
        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc)));

        // LP record masih ada
        (address pool,,,) = executor.lpPositions(user, 0);
        assertTrue(pool != address(0), "LP record harus masih ada");
    }

    function test_lp_exitFails_aaveStillWithdrawn() public {
        _setupLP();
        uniMock.setExitFailure(true, 42);

        uint256 before = usdm.balanceOf(user);
        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc)));

        assertGt(usdm.balanceOf(user), before, "Aave withdrawal tetap berhasil (dalam USDm)");
    }

    function test_lp_exitSucceeds_recordDeleted() public {
        _setupLP();

        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc)));

        // Array harus kosong — akses index 0 harus revert
        vm.expectRevert();
        executor.lpPositions(user, 0);
    }

    function test_lp_exitFails_emitsGuardrailEvent() public {
        uint256 tokenId = _setupLP();
        uniMock.setExitFailure(true, tokenId);

        vm.expectEmit(true, false, false, false, address(executor));
        emit SentinelExecutor.GuardrailTripped(user, "LP_EXIT_FAILED_ON_WITHDRAW");

        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc)));
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX A5: DECIMAL NORMALIZATION
    // ═════════════════════════════════════════════════════════════════════

    function test_decimal_usdc6dec_normalizedTo18() public {
        _register(user, address(usdc), 100e6); // 100 USDC (6 dec)
        (uint256 principal,,,,,,,) = executor.positions(user);
        assertEq(principal, 100e18, "USDC principal dinormalisasi ke 18 dec");
    }

    function test_decimal_usdm18dec_unchanged() public {
        _register(user, address(usdm), 100e18);
        (uint256 principal,,,,,,,) = executor.positions(user);
        assertEq(principal, 100e18, "USDm tidak perlu diubah");
    }

    function test_decimal_topup_mixedAssets_correct() public {
        _register(user, address(usdm), 100e18); // 100 USDm

        // Top-up dengan 50 USDC
        vm.prank(user);
        executor.registerGoal(
            address(usdc), 50e6, TARGET,
            block.timestamp + DEADLINE, LIMIT, 10_000, 0, 0
        );

        (uint256 principal,,,,,,,) = executor.positions(user);
        assertEq(principal, 150e18, "100 USDm + 50 USDC = 150e18 normalized");
    }

    function test_decimal_setAssetDecimals_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(SentinelExecutor.NotOwner.selector);
        executor.setAssetDecimals(address(usdc), 8);
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX A4: WETH CONFIGURABLE
    // ═════════════════════════════════════════════════════════════════════

    function test_weth_setVolatileAssets_updates() public {
        address newWETH = makeAddr("newWETH");
        vm.prank(owner);
        executor.setVolatileAssets(newWETH);
        assertEq(executor.wETH(), newWETH);
    }

    // ═════════════════════════════════════════════════════════════════════
    // FIX B2: MENTO FALLBACK EVENT
    // ═════════════════════════════════════════════════════════════════════

    function test_mento_fallback_emitsEvent() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);

        mentoMock.setShouldFail(true);
        // Fund executor untuk direct transfer (fallback path)
        usdc.mint(address(executor), 100e6);

        vm.expectEmit(true, true, false, false, address(executor));
        emit SentinelExecutor.WithdrawFallback(user, address(usdc), 0, "mento_swap_failed");

        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc)));
    }

    function test_mento_fallback_userStillReceivesTokens() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);
        mentoMock.setShouldFail(true);

        uint256 before = usdc.balanceOf(user);
        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc)));

        // User tetap menerima token (meskipun bukan USDm)
        assertGt(usdc.balanceOf(user), before, "User tetap dapat token walau Mento gagal");
    }

    // ═════════════════════════════════════════════════════════════════════
    // ACCESS CONTROL
    // ═════════════════════════════════════════════════════════════════════

    function test_access_onlyAgent_supply() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(attacker);
        vm.expectRevert(SentinelExecutor.NotAgent.selector);
        executor.executeAaveSupply(user, address(usdc), 10e6, 0);
    }

    function test_access_onlyAgent_rebalance() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(attacker);
        vm.expectRevert(SentinelExecutor.NotAgent.selector);
        executor.rebalance(user);
    }

    function test_access_onlyOwner_pause() public {
        vm.prank(attacker);
        vm.expectRevert(SentinelExecutor.NotOwner.selector);
        executor.pause();
    }

    function test_access_onlyOwner_whitelist() public {
        vm.prank(attacker);
        vm.expectRevert(SentinelExecutor.NotOwner.selector);
        executor.setWhitelistedAsset(address(usdc), false);
    }

    function test_access_paused_blocksAgent() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(owner);
        executor.pause();

        vm.prank(agentSigner);
        vm.expectRevert(SentinelExecutor.ContractPaused.selector);
        executor.executeAaveSupply(user, address(usdc), 10e6, 0);
    }

    function test_access_paused_allowsUserWithdraw() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 50e6);
        vm.prank(owner);
        executor.pause();

        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc))); // tidak revert
    }

    // ═════════════════════════════════════════════════════════════════════
    // SPEND LIMIT
    // ═════════════════════════════════════════════════════════════════════

    function test_spend_limit_enforced() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 50e6); // spent 50

        vm.prank(agentSigner);
        vm.expectRevert(
            abi.encodeWithSelector(SentinelExecutor.SpendLimitExceeded.selector, 451e18, 450e18)
        );
        executor.executeAaveSupply(user, address(usdc), 451e6, 0);
    }

    function test_spend_exactBoundary_succeeds() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 50e6);

        vm.prank(agentSigner);
        executor.executeAaveSupply(user, address(usdc), 450e6, 0); // persis sisa limit
    }

    function test_spend_restoredAfterEpochReset() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 450e6);

        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(agentSigner);
        executor.resetSpendEpoch(user);

        vm.prank(agentSigner);
        executor.executeAaveSupply(user, address(usdc), 100e6, 0); // tidak revert
    }

    // ═════════════════════════════════════════════════════════════════════
    // ALLOWANCE EXPIRY
    // ═════════════════════════════════════════════════════════════════════

    function test_allowance_expiry_blocksAgent() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(user);
        executor.setAllowanceExpiry(block.timestamp + 1 days);
        vm.warp(block.timestamp + 2 days);

        vm.prank(agentSigner);
        vm.expectRevert(SentinelExecutor.AllowanceExpired.selector);
        executor.executeAaveSupply(user, address(usdc), 10e6, 0);
    }

    function test_allowance_zero_neverExpires() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(user);
        executor.setAllowanceExpiry(0);
        vm.warp(block.timestamp + 365 days);

        vm.prank(agentSigner);
        executor.executeAaveSupply(user, address(usdc), 10e6, 0); // tidak revert
    }

    // ═════════════════════════════════════════════════════════════════════
    // REBALANCE GATE
    // ═════════════════════════════════════════════════════════════════════

    function test_rebalance_tooSoon_reverts() public {
        vm.warp(1_000_000);
        _register(user, address(usdc), DEPOSIT);

        vm.prank(agentSigner);
        executor.rebalance(user); // first rebalance OK

        vm.prank(agentSigner);
        vm.expectRevert(); // RebalanceTooSoon has args — use plain expectRevert
        executor.rebalance(user);
    }

    function test_rebalance_after24h_succeeds() public {
        vm.warp(1_000_000);
        _register(user, address(usdc), DEPOSIT);

        vm.prank(agentSigner);
        executor.rebalance(user);

        vm.warp(block.timestamp + 24 hours + 1);
        vm.prank(agentSigner);
        executor.rebalance(user); // tidak revert
    }

    // ═════════════════════════════════════════════════════════════════════
    // EMERGENCY WITHDRAW
    // ═════════════════════════════════════════════════════════════════════

    function test_emergency_onlyWhenPaused() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(agentSigner);
        vm.expectRevert(SentinelExecutor.NotPaused.selector);
        executor.emergencyWithdraw(user, _oneAsset(address(usdc)));
    }

    function test_emergency_whenPaused_clearPosition() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);
        vm.prank(owner); executor.pause();

        vm.prank(agentSigner);
        executor.emergencyWithdraw(user, _oneAsset(address(usdc)));

        (uint256 p,,,,,,,) = executor.positions(user);
        assertEq(p, 0);
    }

    function test_emergency_noFee() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 100e6);
        aUsdc.mint(address(executor), 10e6); // yield

        vm.prank(owner); executor.pause();
        uint256 tBefore = usdc.balanceOf(treasury);
        vm.prank(agentSigner);
        executor.emergencyWithdraw(user, _oneAsset(address(usdc)));
        assertEq(usdc.balanceOf(treasury), tBefore, "Emergency: tidak ada fee");
    }

    // ═════════════════════════════════════════════════════════════════════
    // SLIPPAGE
    // ═════════════════════════════════════════════════════════════════════

    function test_slippage_aaveSupply_minOutEnforced() public {
        _register(user, address(usdc), DEPOSIT);
        vm.prank(agentSigner);
        vm.expectRevert(); // SlippageExceeded with args
        executor.executeAaveSupply(user, address(usdc), 50e6, 51e6);
    }

    // ═════════════════════════════════════════════════════════════════════
    // NO POSITION GUARD
    // ═════════════════════════════════════════════════════════════════════

    function test_noPosition_withdraw_reverts() public {
        vm.prank(user);
        vm.expectRevert(SentinelExecutor.NoPosition.selector);
        executor.withdraw(_oneAsset(address(usdc)));
    }

    function test_noPosition_setUserPaused_reverts() public {
        vm.prank(user);
        vm.expectRevert(SentinelExecutor.NoPosition.selector);
        executor.setUserPaused(true);
    }

    // ═════════════════════════════════════════════════════════════════════
    // NON-WHITELISTED
    // ═════════════════════════════════════════════════════════════════════

    function test_nonWhitelisted_registerGoal_reverts() public {
        address random = makeAddr("random");
        vm.prank(user);
        vm.expectRevert(
            abi.encodeWithSelector(SentinelExecutor.AssetNotWhitelisted.selector, random)
        );
        executor.registerGoal(random, 100, 200, block.timestamp + 1 days, 1000, 10_000, 0, 0);
    }

    // ═════════════════════════════════════════════════════════════════════
    // FULL LIFECYCLE
    // ═════════════════════════════════════════════════════════════════════

    function test_lifecycle_register_supply_yield_withdraw() public {
        // Pakai USDm (18 dec) — tidak ada Mento conversion, mudah diukur langsung
        vm.startPrank(user);
        usdm.approve(address(executor), type(uint256).max);
        executor.registerGoal(address(usdm), 100e18, TARGET, block.timestamp + DEADLINE, LIMIT_18, 10_000, 0, 0);
        vm.stopPrank();

        uint256 aTokens = _supply(user, address(usdm), 100e18);
        assertGt(aTokens, 0);

        // Simulasi yield
        aUsdm.mint(address(executor), 5e18);

        uint256 before = usdm.balanceOf(user);
        _withdrawAssets(user, _oneAsset(address(usdm)));
        uint256 received = usdm.balanceOf(user) - before;

        assertGt(received, 100e18, "User dapat lebih dari principal karena yield");

        (uint256 p,,,,,,,) = executor.positions(user);
        assertEq(p, 0);
    }

    function test_lifecycle_twoUsers_independent() public {
        _register(user,  address(usdc), DEPOSIT);
        _register(user2, address(usdc), DEPOSIT);
        _supply(user,  address(usdc), 100e6);
        _supply(user2, address(usdc), 100e6);

        // User1 withdraw — user2 tidak terpengaruh
        _withdrawAssets(user, _oneAsset(address(usdc)));

        (uint256 p1,,,,,,,) = executor.positions(user);
        (uint256 p2,,,,,,,) = executor.positions(user2);

        assertEq(p1, 0,     "User1 cleared");
        assertGt(p2, 0,     "User2 masih aktif");
    }

    function test_lifecycle_userPause_blocksAgent_not_user() public {
        _register(user, address(usdc), DEPOSIT);
        _supply(user, address(usdc), 50e6);

        vm.prank(user);
        executor.setUserPaused(true);

        // Agent diblok
        vm.prank(agentSigner);
        vm.expectRevert(abi.encodeWithSelector(SentinelExecutor.UserPositionPaused.selector, user));
        executor.executeAaveSupply(user, address(usdc), 10e6, 0);

        // Tapi user sendiri masih bisa withdraw
        vm.prank(user);
        executor.withdraw(_oneAsset(address(usdc))); // tidak revert
    }
}
