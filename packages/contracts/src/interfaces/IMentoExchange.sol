// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IExchangeProvider {
    struct Exchange {
        bytes32 exchangeId;
        address[] assets;
    }
    function getExchanges() external view returns (Exchange[] memory);
}

interface IMentoExchange {
    // Mento V2 Broker API
    function getExchangeProviders() external view returns (address[] memory);

    function swapIn(
        address exchangeProvider,
        bytes32 exchangeId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin
    ) external returns (uint256 amountOut);

    function getAmountOut(
        address exchangeProvider,
        bytes32 exchangeId,
        address tokenIn,
        address tokenOut,
        uint256 amountIn
    ) external view returns (uint256 amountOut);
}
