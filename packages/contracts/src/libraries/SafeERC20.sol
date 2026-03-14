// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "../interfaces/IERC20.sol";

/**
 * @title SafeERC20
 * @notice Wraps ERC20 transfer calls and reverts if the token returns false
 *         or does not return a value (non-standard tokens like USDT).
 */
library SafeERC20 {
    error TransferFailed(address token, address from, address to, uint256 amount);
    error TransferFromFailed(address token, address from, address to, uint256 amount);

    function safeTransfer(IERC20 token, address to, uint256 amount) internal {
        bool success;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0xa9059cbb00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x24), amount)
            success := call(gas(), token, 0, ptr, 0x44, ptr, 0x20)
            // Accept if call succeeded and either no return data or return data is true
            if and(success, gt(returndatasize(), 0)) {
                success := mload(ptr)
            }
        }
        if (!success) revert TransferFailed(address(token), address(this), to, amount);
    }

    function safeTransferFrom(IERC20 token, address from, address to, uint256 amount) internal {
        bool success;
        assembly {
            let ptr := mload(0x40)
            mstore(ptr, 0x23b872dd00000000000000000000000000000000000000000000000000000000)
            mstore(add(ptr, 0x04), and(from, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x24), and(to, 0xffffffffffffffffffffffffffffffffffffffff))
            mstore(add(ptr, 0x44), amount)
            success := call(gas(), token, 0, ptr, 0x64, ptr, 0x20)
            if and(success, gt(returndatasize(), 0)) {
                success := mload(ptr)
            }
        }
        if (!success) revert TransferFromFailed(address(token), from, to, amount);
    }
}
