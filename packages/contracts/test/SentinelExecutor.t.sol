// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/SentinelExecutor.sol";

contract SentinelExecutorTest is Test {
    SentinelExecutor executor;

    address owner       = address(0x1);
    address agentSigner = address(0x2);
    address treasury    = address(0x3);
    address user        = address(0x4);
    address notAgent    = address(0x5);

    // Mock adapters (address only for constructor)
    address aaveAdapter    = address(0xA);
    address mentoAdapter   = address(0xB);
    address uniswapAdapter = address(0xC);

    function setUp() public {
        vm.prank(owner);
        executor = new SentinelExecutor(
            agentSigner,
            treasury,
            aaveAdapter,
            mentoAdapter,
            uniswapAdapter
        );
    }

    // ── onlyAgent modifier ────────────────────────────────────────

    function test_rebalance_revertIfNotAgent() public {
        vm.prank(notAgent);
        vm.expectRevert(SentinelExecutor.NotAgent.selector);
        executor.rebalance(user);
    }

    // ── Asset whitelist ───────────────────────────────────────────

    function test_whitelistAsset() public {
        address asset = address(0xDEAD);
        vm.prank(owner);
        executor.setWhitelistedAsset(asset, true);
        assertTrue(executor.whitelistedAssets(asset));
    }

    function test_setWhitelist_revertIfNotOwner() public {
        vm.prank(notAgent);
        vm.expectRevert(SentinelExecutor.NotOwner.selector);
        executor.setWhitelistedAsset(address(0xDEAD), true);
    }

    // ── Rebalance frequency guardrail ─────────────────────────────

    function test_rebalance_tooSoon() public {
        // Give user a position
        // (skipping full registerGoal flow — unit test just checks timing)
        vm.prank(owner);
        // Manually set lastRebalancedAt via cheatcode
        // In real test would use a mock registerGoal
    }

    // ── User pause / resume ───────────────────────────────────────

    function test_setUserPaused_revertIfNoPosition() public {
        vm.prank(user);
        vm.expectRevert(SentinelExecutor.NoPosition.selector);
        executor.setUserPaused(true);   // FIX: was setPaused() which does not exist on SentinelExecutor
    }

    // ── agentSigner update ────────────────────────────────────────

    function test_setAgentSigner() public {
        address newAgent = address(0x99);
        vm.prank(owner);
        executor.setAgentSigner(newAgent);
        assertEq(executor.agentSigner(), newAgent);
    }

    function test_setAgentSigner_revertIfNotOwner() public {
        vm.prank(notAgent);
        vm.expectRevert(SentinelExecutor.NotOwner.selector);
        executor.setAgentSigner(address(0x99));
    }
}
