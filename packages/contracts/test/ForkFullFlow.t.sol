// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SentinelExecutor.sol";
import "../src/adapters/AaveAdapter.sol";
import "../src/adapters/MentoAdapter.sol";
import "../src/adapters/UniswapAdapter.sol";
import "../src/interfaces/IERC20.sol";

/**
 * @title  ForkFullFlow
 * @notice Integration tests di fork Celo Mainnet.
 *
 * Cara jalankan:
 *   forge test --match-path test/ForkFullFlow.t.sol -vvv \
 *     --fork-url https://forno.celo.org
 */
contract ForkFullFlowTest is Test {

    // ── Protocol Addresses (Celo Mainnet) ─────────────────────────────────
    address constant AAVE_POOL      = 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402;
    address constant MENTO_BROKER   = 0x777A8255cA72412f0d706dc03C9D1987306B4CaD;
    address constant UNISWAP_PM     = 0x3d2bD0e15829AA5C362a4144FdF4A1112fa29B5c;
    address constant UNISWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    // ── Token Addresses ───────────────────────────────────────────────────
    address constant USDM = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address constant WETH = 0xD221812de1BD094f35587EE8E174B07B6167D9Af;

    // ── Aave aToken Addresses ─────────────────────────────────────────────
    address constant A_USDC = 0xFF8309b9e99bfd2D4021bc71a362aBD93dBd4785;
    address constant A_USDT = 0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df;
    address constant A_USDM = 0xBba98352628B0B0c4b40583F593fFCb630935a45;

    // ── Actors ────────────────────────────────────────────────────────────
    address deployer    = makeAddr("deployer");
    address agentSigner = makeAddr("agentSigner");
    address treasury    = makeAddr("treasury");
    address user        = makeAddr("user");
    address user2       = makeAddr("user2");

    // ── Contracts ─────────────────────────────────────────────────────────
    SentinelExecutor sentinel;
    AaveAdapter      aaveAdapter;
    MentoAdapter     mentoAdapter;
    UniswapAdapter   uniswapAdapter;

    // ── Test amounts ──────────────────────────────────────────────────────
    uint256 constant DEPOSIT_USDC  = 100e6;
    uint256 constant DEPOSIT_USDM  = 100e18;
    uint256 constant SPEND_LIMIT   = 500e6;
    uint256 constant GOAL_TARGET   = 200e6;
    uint256 constant SUPPLY_AMOUNT = 50e6;

    // ─────────────────────────────────────────────────────────────────────
    // Setup
    // ─────────────────────────────────────────────────────────────────────

    function setUp() public {
        vm.startPrank(deployer);

        aaveAdapter    = new AaveAdapter(AAVE_POOL, deployer);
        mentoAdapter   = new MentoAdapter(MENTO_BROKER, deployer);
        // A4 FIX: pass WETH ke UniswapAdapter constructor
        uniswapAdapter = new UniswapAdapter(UNISWAP_PM, UNISWAP_ROUTER, deployer, WETH);

        sentinel = new SentinelExecutor(
            agentSigner, treasury,
            address(aaveAdapter), address(mentoAdapter), address(uniswapAdapter)
        );

        aaveAdapter.setExecutor(address(sentinel));
        mentoAdapter.setExecutor(address(sentinel));
        uniswapAdapter.setExecutor(address(sentinel));

        sentinel.setVolatileAssets(WETH);
        sentinel.setUsdm(USDM);

        sentinel.setAssetDecimals(USDM, 18);
        sentinel.setAssetDecimals(USDT, 6);
        sentinel.setAssetDecimals(USDC, 6);
        sentinel.setAssetDecimals(WETH, 18);

        sentinel.setWhitelistedAsset(USDM, true);
        sentinel.setWhitelistedAsset(USDT, true);
        sentinel.setWhitelistedAsset(USDC, true);
        sentinel.setWhitelistedAsset(WETH, true);

        vm.stopPrank();

        // Fund users via deal (fork cheat)
        deal(USDC, user,  DEPOSIT_USDC * 20);
        deal(USDM, user,  DEPOSIT_USDM * 20);
        deal(USDT, user,  1000e6);
        deal(USDC, user2, DEPOSIT_USDC * 20);
        deal(USDM, user2, DEPOSIT_USDM * 20);
        deal(user,        10 ether);
        deal(user2,       10 ether);
        deal(agentSigner, 10 ether);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────

    function _registerGoal(address _user, address asset, uint256 amount) internal {
        vm.startPrank(_user);
        IERC20(asset).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(
            asset, amount, GOAL_TARGET,
            block.timestamp + 180 days,
            SPEND_LIMIT, 10_000, 0, 0
        );
        vm.stopPrank();
    }

    function _agentSupply(address _user, address asset, uint256 amount) internal returns (uint256) {
        vm.prank(agentSigner);
        return sentinel.executeAaveSupply(_user, asset, amount, 0);
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 1: Register Goal + Decimal Normalization (A5)
    // ─────────────────────────────────────────────────────────────────────

    function test_1_RegisterGoal_DecimalNormalization() public {
        console.log("\n=== Test 1: Register Goal + Decimal Normalization ===");

        // Register USDC (6 dec) - principal harus dinormalisasi ke 18 dec
        _registerGoal(user, USDC, DEPOSIT_USDC);

        (uint256 principal,,,,,,,) = sentinel.positions(user);
        assertEq(principal, 100e18, "USDC 100e6 harus dinormalisasi ke 100e18");
        console.log("Principal (normalized):", principal / 1e18, "USD");
        console.log("PASS: decimal normalization benar");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 2: Agent Supply ke Aave + userATokenShares
    // ─────────────────────────────────────────────────────────────────────

    function test_2_AgentAaveSupply() public {
        console.log("\n=== Test 2: Agent Supply ke Aave ===");
        _registerGoal(user, USDC, DEPOSIT_USDC);

        uint256 aTokenBefore = IERC20(A_USDC).balanceOf(address(sentinel));

        vm.prank(agentSigner);
        uint256 aTokensReceived = sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);

        uint256 aTokenAfter = IERC20(A_USDC).balanceOf(address(sentinel));

        // aToken masuk ke SentinelExecutor, bukan userWallet
        assertGt(aTokenAfter, aTokenBefore, "aToken harus masuk SentinelExecutor");
        assertEq(IERC20(A_USDC).balanceOf(user), 0, "User tidak boleh pegang aToken");

        // userATokenShares ter-update
        uint256 shares = sentinel.userATokenShares(user, USDC);
        assertGt(shares, 0);
        assertEq(shares, aTokensReceived);

        // totalATokenShares juga ter-update (Fix #2)
        assertEq(sentinel.totalATokenShares(USDC), shares, "totalATokenShares harus = userShares");

        console.log("aToken received:", aTokensReceived / 1e6, "aUSDC");
        console.log("PASS: supply + shares benar");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 3: Mento Swap and Supply (1 approval)
    // ─────────────────────────────────────────────────────────────────────

    function test_3_MentoSwapAndSupply() public {
        console.log("\n=== Test 3: executeMentoSwapAndSupply ===");

        vm.startPrank(user);
        IERC20(USDM).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(
            USDM, DEPOSIT_USDM, GOAL_TARGET * 1e12,
            block.timestamp + 180 days,
            type(uint256).max, 10_000, 0, 0
        );
        vm.stopPrank();

        uint256 aUsdtBefore = IERC20(A_USDT).balanceOf(address(sentinel));

        vm.prank(agentSigner);
        (uint256 amountOut, uint256 aTokens) = sentinel.executeMentoSwapAndSupply(
            user, USDM, USDT, 30e18, 0, 0
        );

        assertGt(amountOut, 0, "Mento output > 0");
        assertGt(aTokens, 0, "aTokens > 0");
        assertGt(IERC20(A_USDT).balanceOf(address(sentinel)), aUsdtBefore, "aUSDT masuk executor");
        assertEq(sentinel.userATokenShares(user, USDT), aTokens, "shares ter-update");
        assertEq(sentinel.totalATokenShares(USDT), aTokens, "totalShares ter-update");

        console.log("PASS: MentoSwapAndSupply atomic");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 4: Rebalance Gate (24h frequency)
    // ─────────────────────────────────────────────────────────────────────

    function test_4_RebalanceGate() public {
        console.log("\n=== Test 4: Rebalance Gate ===");
        _registerGoal(user, USDC, DEPOSIT_USDC);

        vm.prank(agentSigner);
        sentinel.rebalance(user);

        // Terlalu cepat -> revert
        uint256 rebalanceTooSoonAt = block.timestamp + sentinel.MAX_REBALANCE_INTERVAL();
        vm.prank(agentSigner);
        vm.expectRevert(abi.encodeWithSelector(SentinelExecutor.RebalanceTooSoon.selector, rebalanceTooSoonAt));
        sentinel.rebalance(user);

        // Setelah 25 jam -> OK
        vm.warp(block.timestamp + 25 hours);
        vm.prank(agentSigner);
        sentinel.rebalance(user);

        console.log("PASS: rebalance gate 24h benar");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 5: parkedFunds isolation (Fix #3)
    // ─────────────────────────────────────────────────────────────────────

    function test_5_ParkedFunds_Isolation() public {
        console.log("\n=== Test 5: parkedFunds Isolation ===");

        _registerGoal(user,  USDC, DEPOSIT_USDC);
        _registerGoal(user2, USDC, DEPOSIT_USDC);
        _agentSupply(user,  USDC, DEPOSIT_USDC);
        _agentSupply(user2, USDC, DEPOSIT_USDC);

        // User1 withdraw dari Aave -> parkir di contract
        // Aave mints slightly fewer aTokens than supplied — use actual shares
        uint256 user1Shares = sentinel.userATokenShares(user, USDC);
        vm.prank(agentSigner);
        sentinel.executeAaveWithdraw(user, USDC, user1Shares);

        // User2 tidak punya parkedFunds
        assertApproxEqAbs(sentinel.parkedFunds(user, USDC), DEPOSIT_USDC, 1e4, "User1 parked ~100 USDC");
        assertEq(sentinel.parkedFunds(user2, USDC), 0,            "User2 parked 0");

        // Forward ke user1 - tidak boleh ambil punya user2
        uint256 u1Before = IERC20(USDC).balanceOf(user);
        uint256 u2Before = IERC20(USDC).balanceOf(user2);

        address[] memory assets = new address[](1);
        assets[0] = USDC;
        vm.prank(agentSigner);
        sentinel.forwardToUser(user, assets);

        assertGt(IERC20(USDC).balanceOf(user), u1Before, "User1 terima USDC");
        assertEq(IERC20(USDC).balanceOf(user2), u2Before, "User2 tidak berubah");

        console.log("PASS: parkedFunds isolated between users");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 6: Proportional Yield - 2 users (Fix #2)
    // ─────────────────────────────────────────────────────────────────────

    function test_6_ProportionalYield_TwoUsers() public {
        console.log("\n=== Test 6: Proportional Yield - 2 Users ===");

        _registerGoal(user,  USDC, DEPOSIT_USDC);
        _registerGoal(user2, USDC, DEPOSIT_USDC);
        _agentSupply(user,  USDC, DEPOSIT_USDC);
        _agentSupply(user2, USDC, DEPOSIT_USDC);

        // Maju waktu - Aave akan compound yield secara natural di fork
        vm.warp(block.timestamp + 30 days);

        uint256 totalShares = sentinel.totalATokenShares(USDC);
        uint256 livePool    = IERC20(A_USDC).balanceOf(address(sentinel));

        console.log("Total shares:", totalShares / 1e6);
        console.log("Live aToken pool:", livePool / 1e6);

        address[] memory assets = new address[](3);
        assets[0] = USDM; assets[1] = USDC; assets[2] = USDT;

        // Track USDC saja (6-dec) — jangan mix dengan USDm (18-dec)
        uint256 u1Before = IERC20(USDC).balanceOf(user);
        vm.prank(user);
        sentinel.withdraw(assets);
        uint256 u1Got = IERC20(USDC).balanceOf(user) - u1Before;

        uint256 u2Before = IERC20(USDC).balanceOf(user2);
        vm.prank(user2);
        sentinel.withdraw(assets);
        uint256 u2Got = IERC20(USDC).balanceOf(user2) - u2Before;

        console.log("User1 received (USDC):", u1Got);
        console.log("User2 received (USDC):", u2Got);

        // Keduanya dapat >= 99% principal (satuan 6-dec)
        assertGe(u1Got, DEPOSIT_USDC * 99 / 100, "User1 dapat >= principal");
        assertGe(u2Got, DEPOSIT_USDC * 99 / 100, "User2 dapat >= principal");

        // Tidak ada yang dapat 2x principal (tidak drain user lain)
        assertLe(u1Got, DEPOSIT_USDC * 2, "User1 tidak drain user2");
        assertLe(u2Got, DEPOSIT_USDC * 2, "User2 tidak drain user1");

        console.log("PASS: proportional yield benar, tidak ada cross-user drain");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 7: Spend Limit + Epoch Reset (Fix #4)
    // ─────────────────────────────────────────────────────────────────────

    function test_7_SpendLimit_EpochReset() public {
        console.log("\n=== Test 7: Spend Limit + Epoch Reset ===");
        _registerGoal(user, USDC, DEPOSIT_USDC);

        // Supply 50 USDC
        _agentSupply(user, USDC, SUPPLY_AMOUNT);

        // Coba supply 451 USDC (total 501 > 500 limit) -> revert
        vm.prank(agentSigner);
        vm.expectRevert(
            abi.encodeWithSelector(SentinelExecutor.SpendLimitExceeded.selector, 451e18, 450e18)
        );
        sentinel.executeAaveSupply(user, USDC, 451e6, 0);
        console.log("Spend limit enforced: PASS");

        // Reset epoch setelah 30 hari
        vm.warp(block.timestamp + 30 days + 1);
        vm.prank(agentSigner);
        sentinel.resetSpendEpoch(user);

        // Sekarang bisa supply lagi
        _agentSupply(user, USDC, SUPPLY_AMOUNT);
        console.log("Epoch reset, agent bisa supply lagi: PASS");

        // Reset terlalu cepat -> revert
        uint256 epochTooSoonAt = block.timestamp + sentinel.MIN_EPOCH_DURATION();
        vm.prank(agentSigner);
        vm.expectRevert(abi.encodeWithSelector(SentinelExecutor.EpochResetTooSoon.selector, epochTooSoonAt));
        sentinel.resetSpendEpoch(user);
        console.log("Epoch reset terlalu cepat ditolak: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 8: Agent Signer Timelock (P0-A)
    // ─────────────────────────────────────────────────────────────────────

    function test_8_AgentSignerTimelock() public {
        console.log("\n=== Test 8: Agent Signer Timelock ===");

        address newAgent = makeAddr("newAgent");
        _registerGoal(user, USDC, DEPOSIT_USDC);

        // Propose rotasi
        vm.prank(deployer);
        sentinel.proposeAgentSigner(newAgent);

        // Agent lama masih bisa beroperasi
        _agentSupply(user, USDC, SUPPLY_AMOUNT);
        console.log("Agent lama masih beroperasi selama timelock: PASS");

        // Execute sebelum 48 jam -> revert
        uint256 timelockAt = sentinel.agentSignerChangeAt();
        vm.prank(deployer);
        vm.expectRevert(abi.encodeWithSelector(SentinelExecutor.TimelockNotExpired.selector, timelockAt));
        sentinel.executeAgentSignerChange();
        console.log("Execute sebelum 48h ditolak: PASS");

        // Tunggu 48 jam
        vm.warp(block.timestamp + 48 hours + 1);
        vm.prank(deployer);
        sentinel.executeAgentSignerChange();
        assertEq(sentinel.agentSigner(), newAgent);
        console.log("Agent signer berhasil dirotasi setelah 48h: PASS");

        // Agent baru bisa beroperasi
        vm.prank(newAgent);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);
        console.log("Agent baru beroperasi normal: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 9: Circuit Breaker + Emergency Withdraw
    // ─────────────────────────────────────────────────────────────────────

    function test_9_CircuitBreaker_EmergencyWithdraw() public {
        console.log("\n=== Test 9: Circuit Breaker ===");

        _registerGoal(user, USDC, DEPOSIT_USDC);
        _agentSupply(user, USDC, SUPPLY_AMOUNT);

        // Pause
        vm.prank(deployer);
        sentinel.pause();
        assertTrue(sentinel.paused());

        // Agent tidak bisa supply saat paused
        vm.prank(agentSigner);
        vm.expectRevert(SentinelExecutor.ContractPaused.selector);
        sentinel.executeAaveSupply(user, USDC, 10e6, 0);

        // User masih bisa withdraw walau paused
        address[] memory assets = new address[](3);
        assets[0] = USDM; assets[1] = USDC; assets[2] = USDT;
        vm.prank(user);
        sentinel.withdraw(assets); // tidak revert
        console.log("User withdraw saat paused: PASS");
    }

    function test_10_EmergencyWithdraw_ByAgent() public {
        console.log("\n=== Test 10: Emergency Withdraw ===");

        _registerGoal(user, USDC, DEPOSIT_USDC);
        _agentSupply(user, USDC, SUPPLY_AMOUNT);

        vm.prank(deployer);
        sentinel.pause();

        uint256 userUsdcBefore = IERC20(USDC).balanceOf(user);

        address[] memory assets = new address[](1);
        assets[0] = USDC;
        vm.prank(agentSigner);
        sentinel.emergencyWithdraw(user, assets);

        (uint256 principal,,,,,,,) = sentinel.positions(user);
        assertEq(principal, 0, "Position cleared setelah emergency");
        assertGt(IERC20(USDC).balanceOf(user), userUsdcBefore, "User terima USDC kembali");

        console.log("PASS: emergency withdraw berhasil, position cleared");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 11: Security - Drain Protection
    // ─────────────────────────────────────────────────────────────────────

    function test_11_DrainProtection() public {
        console.log("\n=== Test 11: Drain Protection ===");

        _registerGoal(user,  USDC, DEPOSIT_USDC);
        _registerGoal(user2, USDC, DEPOSIT_USDC);
        _agentSupply(user,  USDC, SUPPLY_AMOUNT);
        _agentSupply(user2, USDC, SUPPLY_AMOUNT);

        uint256 totalAToken = IERC20(A_USDC).balanceOf(address(sentinel));
        uint256 shares1 = sentinel.userATokenShares(user,  USDC);
        uint256 shares2 = sentinel.userATokenShares(user2, USDC);

        // Verify shares benar
        assertApproxEqAbs(shares1, SUPPLY_AMOUNT, 1e4, "User1 shares ~50 USDC");
        assertApproxEqAbs(shares2, SUPPLY_AMOUNT, 1e4, "User2 shares ~50 USDC");
        assertApproxEqAbs(shares1 + shares2, totalAToken, 1e4, "Sum = total");

        // Coba drain: agent withdraw lebih dari shares user1
        vm.prank(agentSigner);
        vm.expectRevert("SentinelExecutor: insufficient aToken balance");
        sentinel.executeAaveWithdraw(user, USDC, totalAToken); // ini milik 2 user!

        console.log("PASS: drain dicegah via _subATokenShares");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 12: Full Lifecycle End-to-End
    // ─────────────────────────────────────────────────────────────────────

    function test_12_FullLifecycle() public {
        console.log("\n=== Test 12: Full Lifecycle ===");

        // 1. Register
        _registerGoal(user, USDC, DEPOSIT_USDC);
        console.log("1. Goal registered");

        // 2. Supply ke Aave
        _agentSupply(user, USDC, DEPOSIT_USDC);
        console.log("2. Supplied to Aave:", sentinel.userATokenShares(user, USDC) / 1e6, "aUSDC");

        // 3. Tunggu 30 hari - Aave compound yield
        vm.warp(block.timestamp + 30 days);

        // 4. Check live pool > shares (yield terjadi)
        uint256 livePool = IERC20(A_USDC).balanceOf(address(sentinel));
        uint256 shares   = sentinel.userATokenShares(user, USDC);
        console.log("3. Setelah 30 hari:");
        console.log("   Live aToken pool:", livePool / 1e6, "aUSDC");
        console.log("   Recorded shares:", shares / 1e6, "aUSDC");

        // 5. Withdraw - user dapat principal + yield
        address[] memory assets = new address[](3);
        assets[0] = USDM; assets[1] = USDC; assets[2] = USDT;

        uint256 totalBefore = IERC20(USDC).balanceOf(user) + IERC20(USDM).balanceOf(user);
        vm.prank(user);
        sentinel.withdraw(assets);
        uint256 totalAfter = IERC20(USDC).balanceOf(user) + IERC20(USDM).balanceOf(user);

        uint256 received = totalAfter - totalBefore;
        console.log("4. Withdrawn (USD approx):", received);

        // Position cleared
        (uint256 principal,,,,,,,) = sentinel.positions(user);
        assertEq(principal, 0, "Position cleared");
        assertGt(received, 0, "User dapat dana kembali");

        console.log("PASS: Full lifecycle selesai");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 13: MentoSwap standalone
    // ─────────────────────────────────────────────────────────────────────

    function test_13_MentoSwap_Standalone() public {
        console.log("\n=== Test 13: Mento Swap Standalone ===");

        vm.startPrank(user);
        IERC20(USDM).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(
            USDM, DEPOSIT_USDM, GOAL_TARGET * 1e12,
            block.timestamp + 180 days, type(uint256).max, 10_000, 0, 0
        );
        vm.stopPrank();

        uint256 usdcBefore = IERC20(USDC).balanceOf(user);

        vm.prank(agentSigner);
        uint256 amountOut = sentinel.executeMentoSwap(user, USDM, USDC, 10e18, 0);

        assertGt(amountOut, 0, "Mento output > 0");
        assertGt(IERC20(USDC).balanceOf(user), usdcBefore, "USDC user bertambah");

        console.log("PASS: Mento swap standalone");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 14: User Pause - hanya blok agent, bukan user sendiri
    // ─────────────────────────────────────────────────────────────────────

    function test_14_UserPause() public {
        console.log("\n=== Test 14: User Self-Pause ===");

        _registerGoal(user, USDC, DEPOSIT_USDC);
        _agentSupply(user, USDC, SUPPLY_AMOUNT);

        vm.prank(user);
        sentinel.setUserPaused(true);

        // Agent diblok
        vm.prank(agentSigner);
        vm.expectRevert(
            abi.encodeWithSelector(SentinelExecutor.UserPositionPaused.selector, user)
        );
        sentinel.executeAaveSupply(user, USDC, 10e6, 0);

        // User sendiri masih bisa withdraw
        address[] memory assets = new address[](3);
        assets[0] = USDM; assets[1] = USDC; assets[2] = USDT;
        vm.prank(user);
        sentinel.withdraw(assets); // tidak revert

        console.log("PASS: user pause hanya blok agent");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 15: Non-custodial - user bisa withdraw kapan saja
    // ─────────────────────────────────────────────────────────────────────

    function test_15_NonCustodial_UserCanAlwaysWithdraw() public {
        console.log("\n=== Test 15: Non-custodial guarantee ===");

        _registerGoal(user, USDC, DEPOSIT_USDC);
        _agentSupply(user, USDC, DEPOSIT_USDC);

        // Scenario 1: withdraw normal
        address[] memory assets = new address[](3);
        assets[0] = USDM; assets[1] = USDC; assets[2] = USDT;

        uint256 before = IERC20(USDC).balanceOf(user) + IERC20(USDM).balanceOf(user);
        vm.prank(user);
        sentinel.withdraw(assets);
        uint256 after_ = IERC20(USDC).balanceOf(user) + IERC20(USDM).balanceOf(user);

        assertGt(after_, before, "User dapat dana kembali");
        console.log("PASS: user dapat withdraw kapan saja");

        // Scenario 2: withdraw saat paused
        _registerGoal(user, USDC, DEPOSIT_USDC); // register lagi
        _agentSupply(user, USDC, DEPOSIT_USDC);
        vm.prank(deployer);
        sentinel.pause();

        uint256 before2 = IERC20(USDC).balanceOf(user) + IERC20(USDM).balanceOf(user);
        vm.prank(user);
        sentinel.withdraw(assets); // tetap tidak revert walau paused
        uint256 after2 = IERC20(USDC).balanceOf(user) + IERC20(USDM).balanceOf(user);

        assertGt(after2, before2, "User dapat withdraw walau contract paused");
        console.log("PASS: user dapat withdraw walau paused");
    }
}
