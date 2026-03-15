// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/adapters/AaveAdapter.sol";
import "../src/adapters/MentoAdapter.sol";
import "../src/adapters/UniswapAdapter.sol";
import "../src/SentinelExecutor.sol";
import "../src/AaveOracleWrapper.sol";

contract Deploy is Script {

    // ── Celo Mainnet — Protocol Addresses ──────────────────────────────────
    // Semua address confirmed dari Aave docs resmi + Celoscan

    // Aave V3 Pool (confirmed Celoscan)
    address constant AAVE_POOL           = 0x3E59A31363E2ad014dcbc521c4a0d5757d9f3402;

    // Aave Oracle V3 (confirmed Celoscan: "Aave: Oracle V3")
    address constant AAVE_ORACLE         = 0x1e693D088ceFD1E95ba4c4a5F7EeA41a1Ec37e8b;

    // Mento Broker
    address constant MENTO_BROKER        = 0x777A8255cA72412f0d706dc03C9D1987306B4CaD;

    // Uniswap V3
    address constant UNISWAP_PM          = 0x3d2bD0e15829AA5C362a4144FdF4A1112fa29B5c;
    address constant UNISWAP_SWAP_ROUTER = 0x5615CDAb10dc425a742d643d949a7F474C01abc4;

    // ── Celo Mainnet — Token Addresses ─────────────────────────────────────
    address constant USDM = 0x765DE816845861e75A25fCA122bb6898B8B1282a;
    address constant USDT = 0x48065fbBE25f71C9282ddf5e1cD6D6A887483D5e;
    address constant USDC = 0xcebA9300f2b948710d2653dD7B07f33A8B32118C;
    // FIX: WETH yang benar di Celo mainnet (confirmed Celoscan: "Celo: WETH Token")
    address constant WETH = 0xD221812de1BD094f35587EE8E174B07B6167D9Af;

    function run() external {
        address deployer    = vm.envAddress("DEPLOYER_ADDRESS");
        address agentSigner = vm.envAddress("AGENT_SIGNER_ADDRESS");
        address treasury    = vm.envAddress("TREASURY_ADDRESS");

        vm.startBroadcast(deployer);

        // ── Step 1: Deploy adapters ───────────────────────────────────────────
        address tempExecutor = deployer;

        AaveAdapter    aaveAdapter    = new AaveAdapter(AAVE_POOL, tempExecutor);
        MentoAdapter   mentoAdapter   = new MentoAdapter(MENTO_BROKER, tempExecutor);
        UniswapAdapter uniswapAdapter = new UniswapAdapter(UNISWAP_PM, UNISWAP_SWAP_ROUTER, tempExecutor);

        // ── Step 2: Deploy SentinelExecutor ──────────────────────────────────
        SentinelExecutor sentinel = new SentinelExecutor(
            agentSigner,
            treasury,
            address(aaveAdapter),
            address(mentoAdapter),
            address(uniswapAdapter)
        );

        // ── Step 3: Wire adapters ke SentinelExecutor ────────────────────────
        aaveAdapter.setExecutor(address(sentinel));
        mentoAdapter.setExecutor(address(sentinel));
        uniswapAdapter.setExecutor(address(sentinel));

        // ── Step 4: Whitelist semua token ─────────────────────────────────────
        sentinel.setWhitelistedAsset(USDM, true);
        sentinel.setWhitelistedAsset(USDT, true);
        sentinel.setWhitelistedAsset(USDC, true);
        sentinel.setWhitelistedAsset(WETH, true);

        // ── Step 5: Set WETH sebagai volatile asset ───────────────────────────
        sentinel.setVolatileAssets(WETH);

        // ── Step 5b: Set USDm sebagai output asset saat withdraw ─────────────
        sentinel.setUsdm(USDM);

        // ── Step 6: Deploy AaveOracleWrapper dan set ke SentinelExecutor ──────
        // Wrapper diperlukan karena Aave Oracle pakai getAssetPrice() tapi
        // SentinelExecutor expect getPrice() — nama fungsi berbeda.
        AaveOracleWrapper oracle = new AaveOracleWrapper(AAVE_ORACLE);
        sentinel.setPriceOracle(address(oracle));

        vm.stopBroadcast();

        // ── Deployment summary ────────────────────────────────────────────────
        console.log(unicode"=== PiggySentinel Deployment — Celo Mainnet ===");
        console.log("");
        console.log("Contracts:");
        console.log("  SentinelExecutor :", address(sentinel));
        console.log("  AaveAdapter      :", address(aaveAdapter));
        console.log("  MentoAdapter     :", address(mentoAdapter));
        console.log("  UniswapAdapter   :", address(uniswapAdapter));
        console.log("  AaveOracleWrapper:", address(oracle));
        console.log("");
        console.log("Protocol:");
        console.log("  AavePool         :", AAVE_POOL);
        console.log("  AaveOracle       :", AAVE_ORACLE);
        console.log("  MentoBroker      :", MENTO_BROKER);
        console.log("");
        console.log("Tokens:");
        console.log("  USDC             :", USDC);
        console.log("  USDT             :", USDT);
        console.log("  USDm             :", USDM);
        console.log("  WETH             :", WETH);
        console.log("");
        console.log("Status:");
        console.log("  Adapters wired   : YES");
        console.log("  Assets whitelisted: YES (USDC, USDT, USDm, WETH)");
        console.log("  Oracle set       : YES (AaveOracleWrapper)");
        console.log("");
        console.log("Next steps:");
        console.log("  1. Copy addresses above ke config/contracts.ts");
        console.log("  2. Set env vars di .env production (lihat .env.example)");
        console.log("  3. Jalankan: pnpm db:migrate");
        console.log("  4. Set APP_ENV=prod ENABLE_MAINNET_EXECUTION=true");
        console.log("  5. Isi CELO di agent wallet untuk gas");
    }
}
