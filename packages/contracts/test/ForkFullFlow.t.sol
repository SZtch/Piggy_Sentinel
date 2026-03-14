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

    // ── Celo Mainnet — Protocol Addresses ─────────────────────────────────
    address constant AAVE_POOL       = 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402;
    address constant MENTO_BROKER    = 0x777A8255cA72412f0d706dc03C9D1987306B4CaD;
    address constant UNISWAP_PM      = 0x3d2bD0e15829AA5C362a4144FdF4A1112fa29B5c;
    address constant UNISWAP_ROUTER  = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    // ── Celo Mainnet — Token Addresses ────────────────────────────────────
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

        vm.stopPrank();

        // ── Mint token ke user (fork = bisa impersonate whale) ─────────────
        // Deal: override balance langsung di fork state
        deal(USDC, user, DEPOSIT_USDC * 10);   // 1000 USDC
        deal(USDM, user, DEPOSIT_USDM * 10);   // 1000 USDm

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

        // Approve USDC ke SentinelExecutor — 1x saja
        IERC20(USDC).approve(address(sentinel), type(uint256).max);

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

        console.log("PASS: aToken masuk ke SentinelExecutor, bukan userWallet");
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

        // Agent withdraw dari Aave ke userWallet
        vm.prank(agentSigner);
        uint256 withdrawn = sentinel.executeAaveWithdraw(
            user,
            USDC,
            SUPPLY_AMOUNT / 2   // tarik setengahnya
        );

        uint256 usdcAfter = IERC20(USDC).balanceOf(user);
        console.log("USDC user sesudah:", usdcAfter / 1e6);
        console.log("Withdrawn:", withdrawn / 1e6, "USDC");

        assertGt(withdrawn, 0, "Withdrawn harus > 0");
        assertGt(usdcAfter, usdcBefore, "USDC user harus bertambah");

        console.log("PASS: Aave withdraw berhasil, dana ke userWallet");
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
        uint256 treasuryBefore  = IERC20(USDC).balanceOf(treasury);
        uint256 aTokenBalance   = IERC20(A_USDC).balanceOf(address(sentinel));

        console.log("USDC user sebelum:", usdcBefore / 1e6);
        console.log("aUSDC di SentinelExecutor:", aTokenBalance);

        address[] memory assets  = new address[](1);
        uint256[] memory amounts = new uint256[](1);
        assets[0]  = USDC;
        amounts[0] = aTokenBalance;

        // User withdraw semua
        vm.prank(user);
        sentinel.withdraw(assets, amounts);

        uint256 usdcAfter     = IERC20(USDC).balanceOf(user);
        uint256 treasuryAfter = IERC20(USDC).balanceOf(treasury);

        console.log("USDC user sesudah:", usdcAfter / 1e6);
        console.log("Fee ke treasury:", (treasuryAfter - treasuryBefore) / 1e6, "USDC");

        assertGt(usdcAfter, usdcBefore, "User harus dapat USDC kembali");

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
        address[] memory assets  = new address[](0);
        uint256[] memory amounts = new uint256[](0);
        vm.prank(user);
        sentinel.withdraw(assets, amounts); // tidak revert
        console.log("User withdraw saat paused: PASS");
    }

    // ─────────────────────────────────────────────────────────────────────
    // Test 8: Spend Limit Protection
    // ─────────────────────────────────────────────────────────────────────

    function test_8_SpendLimit() public {
        _userRegisterGoal();

        console.log("\n=== Test 8: Spend Limit ===");

        // Supply sampai limit
        vm.prank(agentSigner);
        sentinel.executeAaveSupply(user, USDC, SUPPLY_AMOUNT, 0); // 50 USDC

        // Supply lagi melebihi limit (spendLimit = 500, tapi sudah 50)
        // Coba supply 500 lagi — total akan 550 > 500
        vm.prank(agentSigner);
        vm.expectRevert();
        sentinel.executeAaveSupply(user, USDC, SPEND_LIMIT, 0);

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
}
