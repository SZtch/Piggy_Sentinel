export declare const SENTINEL_EXECUTOR_ABI: readonly [{
    readonly type: "function";
    readonly name: "executeAaveSupply";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }, {
        readonly name: "asset";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }, {
        readonly name: "minReturn";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "executeAaveWithdraw";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }, {
        readonly name: "asset";
        readonly type: "address";
    }, {
        readonly name: "amount";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "rebalance";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "userWallet";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "rebalance";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "userWallet";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "executeMentoSwap";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }, {
        readonly name: "fromToken";
        readonly type: "address";
    }, {
        readonly name: "toToken";
        readonly type: "address";
    }, {
        readonly name: "amountIn";
        readonly type: "uint256";
    }, {
        readonly name: "minAmountOut";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "checkAndExitLPIfIL";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }, {
        readonly name: "currentValues";
        readonly type: "uint256[]";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "lpPositions";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }, {
        readonly name: "index";
        readonly type: "uint256";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "tuple";
        readonly components: readonly [{
            readonly name: "pool";
            readonly type: "address";
        }, {
            readonly name: "tokenId";
            readonly type: "uint256";
        }, {
            readonly name: "entryValueUSD";
            readonly type: "uint256";
        }, {
            readonly name: "entryTimestamp";
            readonly type: "uint256";
        }];
    }];
}, {
    readonly type: "function";
    readonly name: "resetSpendEpoch";
    readonly stateMutability: "nonpayable";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }];
    readonly outputs: readonly [];
}, {
    readonly type: "function";
    readonly name: "spendLimitOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "cumulativeSpentOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "epochStartOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "uint256";
    }];
}, {
    readonly type: "function";
    readonly name: "agentOf";
    readonly stateMutability: "view";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
    }];
    readonly outputs: readonly [{
        readonly name: "";
        readonly type: "address";
    }];
}, {
    readonly type: "event";
    readonly name: "AaveSupplyExecuted";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "asset";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "amount";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "MentoSwapExecuted";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "fromToken";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "toToken";
        readonly type: "address";
        readonly indexed: false;
    }, {
        readonly name: "amountIn";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "amountOut";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "LPExited";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "tokenId";
        readonly type: "uint256";
        readonly indexed: false;
    }, {
        readonly name: "ilPct";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "event";
    readonly name: "SpendEpochReset";
    readonly inputs: readonly [{
        readonly name: "user";
        readonly type: "address";
        readonly indexed: true;
    }, {
        readonly name: "epochStart";
        readonly type: "uint256";
        readonly indexed: false;
    }];
}, {
    readonly type: "error";
    readonly name: "SpendLimitExceeded";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "NotAuthorizedAgent";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "SlippageExceeded";
    readonly inputs: readonly [];
}, {
    readonly type: "error";
    readonly name: "InsufficientBalance";
    readonly inputs: readonly [];
}];
//# sourceMappingURL=abi.d.ts.map