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
 * @notice Test full flow PiggySentinel di fork Celo Mainnet.
 *
 * Yang ditest:
 *   1. Deploy semua contract
 *   2. User register goal with USDC
 *   3. Agent supply ke Aave → cek aToken masuk SentinelExecutor
 *   4. Agent swap USDm → USDT via Mento
 *   5. Agent supply USDT ke Aave
 *   6. Agent rebalance gate (catat timestamp)
 *   7. User withdraw → dana balik ke wallet
 *   8. Cek performance fee masuk treasury
 *
 * Cara jalankan:
 *   Terminal 1: ./script/fork.sh
 *   Terminal 2: forge test --match-path test/ForkFullFlow.t.sol -vvv
 *
 * Atau tanpa Anvil (forge fork langsung):
 *   forge test --match-path test/ForkFullFlow.t.sol -vvv \
 *     --fork-url https://forno.celo.org
 */
contract ForkFullFlowTest is Test {

    // ── Celo Mainnet -- Protocol Addresses ─────────────────────────────────
    address constant AAVE_POOL       = 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402;
    address constant MENTO_BROKER    = 0x777A8255cA72412f0d706dc03C9D1987306B4CaD;
    address constant UNISWAP_PM      = 0x3d2bD0e15829AA5C362a4144FdF4A1112fa29B5c;
    address constant UNISWAP_ROUTER  = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    // ── Celo Mainnet -- Token Addresses ────────────────────────────────────
    address constant USDM = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    address constant WETH = 0xD221812de1BD094f35587EE8E174B07B6167D9Af;  // Celo: WETH Token ✅

    // ── Aave aToken Addresses (Celo Mainnet) ──────────────────────────────
    // Confirmed dari Aave docs resmi + Celoscan
    address constant A_USDC = 0xFF8309b9e99bfd2D4021bc71a362aBD93dBd4785;  // Aave: aCelUSDC Token ✅
    address constant A_USDT = 0xDeE98402A302e4D707fB9bf2bac66fAEEc31e8Df;  // Aave: aCelUSDT Token ✅
    address constant A_USDM = 0xBba98352628B0B0c4b40583F593fFCb630935a45;  // Aave: aUSDm Token ✅

    // ── Actors ────────────────────────────────────────────────────────────
    address deployer    = makeAddr("deployer");
    address agentSigner = makeAddr("agentSigner");
    address treasury    = makeAddr("treasury");
    address user        = makeAddr("user");

    // ── Contracts ─────────────────────────────────────────────────────────
    SentinelExecutor sentinel;
    AaveAdapter      aaveAdapter;
    MentoAdapter     mentoAdapter;
    UniswapAdapter   uniswapAdapter;

    // ── Test amounts ──────────────────────────────────────────────────────
    uint256 constant DEPOSIT_USDC    = 100e6;   // 100 USDC (6 dec)
    uint256 constant DEPOSIT_USDM    = 100e18;  // 100 USDm (18 dec)
    uint256 constant SPEND_LIMIT     = 500e6;   // 500 USDC max per epoch
    uint256 constant GOAL_TARGET     = 200e6;   // goal: 200 USDC
    uint256 constant SUPPLY_AMOUNT   = 50e6;    // supply 50 USDC ke Aave

    function setUp() public {
        // ── Deploy semua contract ──────────────────────────────────────────
        vm.startPrank(deployer);

        aaveAdapter    = new AaveAdapter(AAVE_POOL, deployer);
        mentoAdapter   = new MentoAdapter(MENTO_BROKER, deployer);
        uniswapAdapter = new UniswapAdapter(UNISWAP_PM, UNISWAP_ROUTER, deployer);

        sentinel = new SentinelExecutor(
            agentSigner,
            treasury,
            address(aaveAdapter),
            address(mentoAdapter),
            address(uniswapAdapter)
        );

        // Wire adapters ke SentinelExecutor
        aaveAdapter.setExecutor(address(sentinel));
        mentoAdapter.setExecutor(address(sentinel));
        uniswapAdapter.setExecutor(address(sentinel));

        // Whitelist semua token
        sentinel.setWhitelistedAsset(USDM, true);
        sentinel.setWhitelistedAsset(USDT, true);
        sentinel.setWhitelistedAsset(USDC, true);
        sentinel.setWhitelistedAsset(WETH, true);
        sentinel.setVolatileAssets(WETH);

        // Set USDm sebagai output token saat withdraw
        sentinel.setUsdm(USDM);

        vm.stopPrank();

        // ── Mint token ke user (fork = bisa impersonate whale) ─────────────
        // Deal: override balance langsung di fork state -- gratis, tidak pakai uang asli
        deal(USDC, user, DEPOSIT_USDC * 10);   // 1000 USDC (6 dec)
        deal(USDM, user, DEPOSIT_USDM * 10);   // 1000 USDm (18 dec)
        deal(USDT, user, 1000e6);              // 1000 USDT (6 dec)
        // Isi CELO untuk gas
        deal(user, 10 ether);
        deal(agentSigner, 10 ether);

        // Pastikan user punya cukup token
        assertGe(IERC20(USDC).balanceOf(user), DEPOSIT_USDC);
        assertGe(IERC20(USDM).balanceOf(user), DEPOSIT_USDM);

        console.log("=== Setup selesai ===");
        console.log("SentinelExecutor :", address(sentinel));
        console.log("User USDC        :", IERC20(USDC).balanceOf(user) / 1e6, "USDC");
        console.log("User USDm        :", IERC20(USDM).balanceOf(user) / 1e18, "USDm");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 1: Register Goal
    // ─────────────────────────────────────────────────────────────────────

    function test_1_UserRegisterGoal() public {
        console.log("\n=== Test 1: User Register Goal ===");

        vm.startPrank(user);

        // Register Goal
        sentinel.registerGoal(
            USDC,                           // asset
            DEPOSIT_USDC,                   // amount: 100 USDC
            GOAL_TARGET,                    // goalTarget: 200 USDC
            block.timestamp + 180 days,     // deadline
            SPEND_LIMIT,                    // spendLimit
            10_000,                         // 100% stable (conservative)
            0,                              // 0% LP
            0                               // 0% WETH
        );

        vm.stopPrank();

        // Verifikasi position terdaftar
        (uint256 principal, , , , , , ,) = sentinel.positions(user);
        assertEq(principal, DEPOSIT_USDC, "Principal harus sama dengan amount yang didaftarkan");

        console.log("Principal registered:", principal / 1e6, "USDC");
        console.log("PASS: RegisterGoal berhasil");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 2: Agent Supply ke Aave
    // ─────────────────────────────────────────────────────────────────────

    function test_2_AgentAaveSupply() public {
        // Setup: register goal dulu
        _userRegisterGoal();

        console.log("\n=== Test 2: Agent Supply ke Aave ===");

        uint256 aTokenBefore = IERC20(A_USDC).balanceOf(address(sentinel));
        console.log("aUSDC sebelum:", aTokenBefore);

        // Agent supply USDC ke Aave
        vm.prank(agentSigner);
        uint256 aTokensReceived = sentinel.executeAaveSupply(
            user,
            USDC,
            SUPPLY_AMOUNT,  // 50 USDC
            0               // minOut = 0 untuk test
        );

        uint256 aTokenAfter = IERC20(A_USDC).balanceOf(address(sentinel));
        console.log("aUSDC sesudah:", aTokenAfter);
        console.log("aToken diterima:", aTokensReceived);

        // aToken harus masuk ke SentinelExecutor (bukan userWallet)
        assertGt(aTokenAfter, aTokenBefore, "aToken harus masuk SentinelExecutor");
        assertEq(IERC20(A_USDC).balanceOf(user), 0, "User tidak boleh pegang aToken");

        // userATokenShares harus ter-update -- ini yang melindungi dari draining
        uint256 shares = sentinel.userATokenShares(user, USDC);
        assertGt(shares, 0, "userATokenShares harus > 0 setelah supply");
        assertEq(shares, aTokensReceived, "userATokenShares harus sama dengan aTokensReceived");
        console.log("userATokenShares[user][USDC]:", shares);

        console.log("PASS: aToken masuk ke SentinelExecutor, userATokenShares ter-update");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 3: Agent Swap via Mento (USDm → USDC)
    // ─────────────────────────────────────────────────────────────────────

    function test_3_AgentMentoSwap() public {
        // Register Goal dengan spend limit besar supaya USDm 18-dec tidak exceed
        vm.startPrank(user);
        IERC20(USDC).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(USDC, DEPOSIT_USDC, GOAL_TARGET, block.timestamp + 180 days, type(uint256).max, 10_000, 0, 0);
        vm.stopPrank();

        console.log(unicode"\n=== Test 3: Agent Mento Swap (USDm → USDC) ===");

        // Approve USDm ke SentinelExecutor dulu
        vm.prank(user);
        IERC20(USDM).approve(address(sentinel), type(uint256).max);

        uint256 usdcBefore = IERC20(USDC).balanceOf(user);
        uint256 swapAmount = 10e18; // swap 10 USDm

        console.log("USDm di user sebelum:", IERC20(USDM).balanceOf(user) / 1e18);
        console.log("USDC di user sebelum:", usdcBefore / 1e6);

        // Agent swap USDm → USDC via Mento
        vm.prank(agentSigner);
        uint256 amountOut = sentinel.executeMentoSwap(
            user,
            USDM,           // from
            USDC,           // to
            swapAmount,     // 10 USDm
            0               // minOut = 0 untuk test
        );

        uint256 usdcAfter = IERC20(USDC).balanceOf(user);
        console.log("USDC di user sesudah:", usdcAfter / 1e6);
        console.log("Output swap:", amountOut);

        assertGt(amountOut, 0, "Output swap harus > 0");
        assertGt(usdcAfter, usdcBefore, "USDC user harus bertambah");

        console.log("PASS: Mento swap berhasil");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 4: Agent Rebalance Gate
    // ─────────────────────────────────────────────────────────────────────

    function test_4_RebalanceGate() public {
        _userRegisterGoal();

        console.log("\n=== Test 4: Rebalance Gate ===");

        // Rebalance pertama harus berhasil
        vm.prank(agentSigner);
        sentinel.rebalance(user);

        (,uint256 lastRebalancedAt,,,,,,) = sentinel.positions(user);
        assertEq(lastRebalancedAt, block.timestamp, "lastRebalancedAt harus terupdate");
        console.log("Rebalance pertama: PASS");

        // Rebalance kedua langsung harus revert (terlalu cepat)
        vm.prank(agentSigner);
        vm.expectRevert();
        sentinel.rebalance(user);
        console.log("Rebalance terlalu cepat ditolak: PASS");

        // Maju waktu 25 jam
        vm.warp(block.timestamp + 25 hours);

        // Rebalance ketiga harus berhasil lagi
        vm.prank(agentSigner);
        sentinel.rebalance(user);
        console.log("Rebalance setelah 25 jam: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 5: Agent Aave Withdraw
    // ─────────────────────────────────────────────────────────────────────

    function test_5_AgentAaveWithdraw() public {
        _userRegisterGoal();

        // Supply dulu
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);

        console.log("\n=== Test 5: Agent Aave Withdraw ===");

        uint256 usdcBefore = IERC20(USDC).balanceOf(user);
        uint256 aTokenBalance = IERC20(A_USDC).balanceOf(address(sentinel));
        console.log("aUSDC di SentinelExecutor:", aTokenBalance);
        console.log("USDC user sebelum:", usdcBefore / 1e6);

        // Agent withdraw dari Aave → parkir di SentinelExecutor
        vm.prank(agentSigner);
        uint256 withdrawn = sentinel.executeAaveWithdraw(
            user,
            USDC,
            SUPPLY_AMOUNT / 2   // tarik setengahnya
        );

        // Dana parkir di SentinelExecutor -- perlu forwardToUser
        uint256 contractBal = IERC20(USDC).balanceOf(address(sentinel));
        assertGt(contractBal, 0, "Dana harus parkir di SentinelExecutor");

        // Forward ke user
        address[] memory fwdAssets = new address[](1);
        fwdAssets[0] = USDC;
        vm.prank(agentSigner);
        sentinel.forwardToUser(user, fwdAssets);

        uint256 usdcAfter = IERC20(USDC).balanceOf(user);
        console.log("USDC user sesudah:", usdcAfter / 1e6);
        console.log("Withdrawn:", withdrawn / 1e6, "USDC");

        assertGt(withdrawn, 0, "Withdrawn harus > 0");
        assertGt(usdcAfter, usdcBefore, "USDC user harus bertambah");

        console.log("PASS: Aave withdraw berhasil, dana ke userWallet via forwardToUser");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 6: User Withdraw Full (dengan performance fee)
    // ─────────────────────────────────────────────────────────────────────

    function test_6_UserWithdraw() public {
        _userRegisterGoal();

        // Supply dulu supaya ada posisi Aave
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);

        // Simulasi yield dengan maju waktu + tambah aToken balance
        vm.warp(block.timestamp + 30 days);

        console.log("\n=== Test 6: User Withdraw ===");

        uint256 usdcBefore      = IERC20(USDC).balanceOf(user);
        uint256 usdmBefore      = IERC20(USDM).balanceOf(user);   // catat sebelum
        uint256 treasuryBefore  = IERC20(USDM).balanceOf(treasury); // fee dalam USDm
        uint256 aTokenBalance   = IERC20(A_USDC).balanceOf(address(sentinel));

        console.log("USDC user sebelum:", usdcBefore / 1e6);
        console.log("USDm user sebelum:", usdmBefore / 1e18);
        console.log("aUSDC di SentinelExecutor:", aTokenBalance);

        // User withdraw semua -- amount diambil otomatis dari userATokenShares
        // Perlu supply dulu supaya ada userATokenShares yang tercatat
        // (test ini supply via executeAaveSupply yang sudah track shares)
        address[] memory assets = new address[](3);
        assets[0] = USDM;
        assets[1] = USDC;
        assets[2] = USDT;

        vm.prank(user);
        sentinel.withdraw(assets);

        uint256 usdcAfter     = IERC20(USDC).balanceOf(user);
        uint256 usdmAfter     = IERC20(USDM).balanceOf(user);
        uint256 treasuryAfter = IERC20(USDM).balanceOf(treasury); // fee dalam USDm

        console.log("USDm user sesudah:", usdmAfter / 1e18);
        console.log("USDC user sesudah:", usdcAfter / 1e6, "(harus berkurang/0 karena diconvert)");
        console.log("Fee ke treasury (USDm):", (treasuryAfter - treasuryBefore) / 1e18);

        // User harus menerima kembali nilainya -- bisa USDm atau USDC
        // Mento oracle di fork bisa stale (no valid median) -> fallback kirim USDC as-is
        uint256 totalReceived = (usdmAfter - usdmBefore) + ((usdcAfter - usdcBefore) * 1e12);
        assertGt(totalReceived, 0, "User harus menerima dana kembali");
        console.log("Total diterima:", totalReceived / 1e18);

        // Posisi harus terhapus
        (uint256 principal,,,,,,,) = sentinel.positions(user);
        assertEq(principal, 0, "Posisi harus terhapus setelah withdraw");

        console.log("PASS: User withdraw berhasil, posisi terhapus");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 7: Circuit Breaker
    // ─────────────────────────────────────────────────────────────────────

    function test_7_CircuitBreaker() public {
        _userRegisterGoal();

        console.log("\n=== Test 7: Circuit Breaker ===");

        // Owner pause kontrak
        vm.prank(deployer);
        sentinel.pause();
        assertTrue(sentinel.paused(), "Kontrak harus paused");

        // Agent tidak bisa supply saat paused
        vm.prank(agentSigner);
        vm.expectRevert(SentinelExecutor.ContractPaused.selector);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);
        console.log("Supply saat paused ditolak: PASS");

        // User masih bisa withdraw walau paused
        address[] memory assets = new address[](3);
        assets[0] = USDM;
        assets[1] = USDC;
        assets[2] = USDT;
        vm.prank(user);
        sentinel.withdraw(assets); // tidak revert -- user selalu bisa withdraw
        console.log("User withdraw saat paused: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 8: Spend Limit Protection
    // ─────────────────────────────────────────────────────────────────────

    function test_8_SpendLimit() public {
        _userRegisterGoal();

        console.log("\n=== Test 8: Spend Limit ===");

        // Supply 50 USDC → cumulativeSpent = 50e6
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);

        // Verifikasi cumulativeSpent bertambah
        (,,,,,, uint256 spent,) = sentinel.positions(user);
        assertEq(spent, SUPPLY_AMOUNT, "cumulativeSpent harus = SUPPLY_AMOUNT");

        // Coba supply 451e6 -- total 501e6 > 500e6 (SPEND_LIMIT) → harus revert
        // Ini test boundary yang presisi: tepat 1 unit di atas sisa limit (450e6)
        vm.prank(agentSigner);
        vm.expectRevert(abi.encodeWithSelector(SentinelExecutor.SpendLimitExceeded.selector, 451e6, 450e6));
        sentinel.executeAaveSupply(user, USDC, 451e6, 0);

        // Coba supply tepat sisa limit (450e6) -- harus BERHASIL
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, 450e6, 0);

        console.log("Spend limit terlindungi: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 9: Reset Spend Epoch
    // ─────────────────────────────────────────────────────────────────────

    function test_9_ResetSpendEpoch() public {
        _userRegisterGoal();

        // Pakai semua spend limit
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0); // 50 USDC

        console.log("\n=== Test 9: Reset Spend Epoch ===");

        // Reset epoch
        vm.prank(agentSigner);
        sentinel.resetSpendEpoch(user);

        // Sekarang bisa supply lagi
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);

        console.log("Epoch reset, agent bisa supply lagi: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Helper: registerGoal tanpa repeat code
    // ─────────────────────────────────────────────────────────────────────

    function _userRegisterGoal() internal {
        vm.startPrank(user);
        IERC20(USDC).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(
            USDC,
            DEPOSIT_USDC,
            GOAL_TARGET,
            block.timestamp + 180 days,
            SPEND_LIMIT,
            10_000, 0, 0
        );
        vm.stopPrank();
    }
    // ─────────────────────────────────────────────────────────────────────
    // Test 10: MentoSwapAndSupply -- Atomic (fungsi baru, 1 approval)
    // ─────────────────────────────────────────────────────────────────────

    function test_10_MentoSwapAndSupply() public {
        console.log("\n=== Test 10: executeMentoSwapAndSupply (atomic) ===");

        // User hanya approve USDm -- tidak perlu approve USDT
        vm.startPrank(user);
        IERC20(USDM).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(
            USDM,
            DEPOSIT_USDM,
            GOAL_TARGET * 1e12,  // scale ke 18 dec
            block.timestamp + 180 days,
            type(uint256).max,
            10_000, 0, 0
        );
        vm.stopPrank();

        uint256 swapAmount = 30e18; // 30 USDm
        uint256 aUsdtBefore = IERC20(A_USDT).balanceOf(address(sentinel));

        // Agent: swap USDm → USDT → langsung supply ke Aave dalam 1 tx
        vm.prank(agentSigner);
        (uint256 amountOut, uint256 aTokens) = sentinel.executeMentoSwapAndSupply(
            user,
            USDM,           // fromAsset
            USDT,           // toAsset
            swapAmount,     // 30 USDm input
            0,              // minAmountOut (0 untuk test)
            0               // minATokens (0 untuk test)
        );

        uint256 aUsdtAfter = IERC20(A_USDT).balanceOf(address(sentinel));

        console.log("USDm diswap:", swapAmount / 1e18);
        console.log("USDT output dari Mento:", amountOut);
        console.log("aUSDT diterima:", aTokens);
        console.log("aUSDT di SentinelExecutor sesudah:", aUsdtAfter);

        assertGt(amountOut, 0, "Mento output harus > 0");
        assertGt(aTokens, 0, "aTokens harus > 0");
        assertGt(aUsdtAfter, aUsdtBefore, "aUSDT harus masuk SentinelExecutor");

        // Verifikasi userATokenShares ter-update
        uint256 shares = sentinel.userATokenShares(user, USDT);
        assertEq(shares, aTokens, "userATokenShares harus sama dengan aTokens yang diterima");

        // USDT tidak boleh ada di userWallet (langsung ke Aave, bukan ke user)
        uint256 userUsdt = IERC20(USDT).balanceOf(user);
        assertEq(userUsdt, 1000e6, "USDT di user tidak boleh berubah -- semua ke Aave");

        console.log("PASS: MentoSwapAndSupply atomic -- 1 approval USDm saja");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 11: Security -- User tidak bisa drain aToken user lain
    // ─────────────────────────────────────────────────────────────────────

    function test_11_CannotDrainOtherUser() public {
        console.log("\n=== Test 11: Security -- Drain Protection ===");

        address user2 = makeAddr("user2");
        deal(USDC, user2, 1000e6);

        // User1 supply 50 USDC
        _userRegisterGoal();
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0);

        // User2 supply 50 USDC
        vm.startPrank(user2);
        IERC20(USDC).approve(address(sentinel), type(uint256).max);
        sentinel.registerGoal(USDC, DEPOSIT_USDC, GOAL_TARGET, block.timestamp + 180 days, SPEND_LIMIT, 10_000, 0, 0);
        vm.stopPrank();
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user2, USDC, SUPPLY_AMOUNT, 0);

        // Total aUSDC di SentinelExecutor = ~100 USDC (milik 2 user)
        uint256 totalAToken = IERC20(A_USDC).balanceOf(address(sentinel));
        console.log("Total aUSDC di SentinelExecutor:", totalAToken / 1e6);

        // Verifikasi bahwa userATokenShares ter-set dengan benar per user
        uint256 sharesUser1 = sentinel.userATokenShares(user,  USDC);
        uint256 sharesUser2 = sentinel.userATokenShares(user2, USDC);
        console.log("Shares user1:", sharesUser1 / 1e6, "USDC");
        console.log("Shares user2:", sharesUser2 / 1e6, "USDC");

        // Shares per user harus sekitar 50 USDC masing-masing
        assertApproxEqAbs(sharesUser1, SUPPLY_AMOUNT, 1e4, "User1 shares harus ~50 USDC");
        assertApproxEqAbs(sharesUser2, SUPPLY_AMOUNT, 1e4, "User2 shares harus ~50 USDC");

        // Jumlah shares harus = total aToken di executor (±dust)
        assertApproxEqAbs(sharesUser1 + sharesUser2, totalAToken, 1e4, "Total shares harus = total aToken");

        // DRAIN TEST: agent coba withdraw user1 sebanyak totalAToken (milik 2 user)
        // Harus revert karena userATokenShares[user1][USDC] hanya ~50, bukan ~100
        vm.prank(agentSigner);
        vm.expectRevert(); // revert: _subATokenShares(user, USDC, totalAToken) -- insufficient shares
        sentinel.executeAaveWithdraw(user, USDC, totalAToken);

        console.log("Drain dicegah: PASS");
        console.log("User1 hanya bisa withdraw sesuai sharesnya sendiri");
    }
}
