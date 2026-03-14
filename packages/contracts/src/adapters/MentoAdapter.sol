// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IMentoExchange.sol";
import "../interfaces/IERC20.sol";
import "../libraries/SafeERC20.sol";

contract MentoAdapter {
    using SafeERC20 for IERC20;
    IMentoExchange public immutable broker;
    address        public executor;
    address        public owner;

    error NotExecutor();
    error NotOwner();
    error ZeroAddress();
    error InsufficientOutput(uint256 received, uint256 minimum);
    error NoPairFound(address tokenIn, address tokenOut);

    event ExecutorUpdated(address indexed oldExecutor, address indexed newExecutor);

    constructor(address _broker, address _executor) {
        require(_executor != address(0), "MentoAdapter: zero executor");
        broker   = IMentoExchange(_broker);
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

    /// @dev Temukan exchange provider + ID yang support pair tokenIn/tokenOut
    function _findExchange(address tokenIn, address tokenOut)
        internal view returns (address provider, bytes32 exchangeId)
    {
        address[] memory providers = broker.getExchangeProviders();
        for (uint256 i = 0; i < providers.length; i++) {
            IExchangeProvider.Exchange[] memory exchanges =
                IExchangeProvider(providers[i]).getExchanges();
            for (uint256 j = 0; j < exchanges.length; j++) {
                address[] memory assets = exchanges[j].assets;
                bool hasIn;
                bool hasOut;
                for (uint256 k = 0; k < assets.length; k++) {
                    if (assets[k] == tokenIn)  hasIn  = true;
                    if (assets[k] == tokenOut) hasOut = true;
                }
                if (hasIn && hasOut) {
                    return (providers[i], exchanges[j].exchangeId);
                }
            }
        }
        revert NoPairFound(tokenIn, tokenOut);
    }

    function swap(
        address agentWallet,
        address fromAsset,
        address toAsset,
        uint256 amountIn,
        uint256 minAmountOut
    ) external onlyExecutor returns (uint256 amountOut) {
        IERC20(fromAsset).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(fromAsset).approve(address(broker), amountIn);

        (address provider, bytes32 exId) = _findExchange(fromAsset, toAsset);

        uint256 before = IERC20(toAsset).balanceOf(address(this));
        broker.swapIn(provider, exId, fromAsset, toAsset, amountIn, minAmountOut);
        amountOut = IERC20(toAsset).balanceOf(address(this)) - before;
        if (amountOut < minAmountOut) revert InsufficientOutput(amountOut, minAmountOut);
        IERC20(toAsset).safeTransfer(agentWallet, amountOut);
    }

    function getQuote(address fromAsset, address toAsset, uint256 amountIn)
        external view returns (uint256)
    {
        (address provider, bytes32 exId) = _findExchange(fromAsset, toAsset);
        return broker.getAmountOut(provider, exId, fromAsset, toAsset, amountIn);
    }
}
