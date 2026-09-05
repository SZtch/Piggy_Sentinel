# PiggySentinel

Most people have money sitting in a wallet doing absolutely nothing. Not because they do not care â€” because managing it is annoying. You have to research protocols, monitor rates, rebalance positions, worry about rug pulls, and somehow remember to do all of this while living your actual life. So the money just sits there.

We built Penny to fix that.

Penny is an autonomous savings agent on Celo. You give her a goal â€” "I want $2,000 for Japan by October" or "emergency fund, $3,000, six months" â€” a deadline, and a monthly budget she is allowed to work with. She handles the rest. She moves your stablecoins into yield positions on Aave, monitors them, rebalances when something better comes along, and steps aside when you are done.

The important part: **your money never leaves your wallet.** Penny operates through an on-chain allowance you set. She can only move what you gave her permission to move, only within the monthly limit you defined. You can pause her, take back control, or withdraw everything at any second. No waiting. No asking anyone.

## Real goals, not yield strategies

- "I want $2,000 saved for Japan by October" â€” Penny allocates, monitors, and tells you when you are on track
- "Emergency fund â€” $3,000 in 6 months, I keep forgetting" â€” set it once, Penny handles it quietly
- "New laptop, $800, I am tired of waiting" â€” she will get you there while your money earns yield
- "I have idle USDC and I am tired of watching it do nothing" â€” Penny puts it to work immediately

These are goals. Not yield strategies. Penny manages them end to end.

## How it works

1. **Set a goal** â€” name it, set a target amount, a deadline, and a monthly budget for Penny
2. **Penny allocates into Aave V3 on Celo** â€” earning yield automatically across USDC, USDT, and USDm
3. **She monitors, rebalances, and protects** â€” pauses herself if something looks wrong
4. **Goal reached** â€” she returns everything. You withdraw directly from your wallet.

## Your money, your wallet

- Funds never leave your wallet until Penny moves them into yield â€” and even then, she operates within the allowance you set
- Penny operates via on-chain allowance â€” not ownership. She never holds your money.
- Withdraw anytime. No permission from anyone. No waiting period. Just do it.
- If our backend goes offline tomorrow â€” your funds are still safe, still withdrawable, directly on-chain

## Security as a design philosophy

We did not bolt security on after building. Every decision started with "what is the worst that can happen if this goes wrong?" â€” and then we built to make sure it could not.

The result:

- **Non-custodial by design** â€” Penny never holds private keys or direct ownership of funds
- **Allowance-bounded** â€” she can only spend up to the monthly limit you set, and only into Aave V3
- **Self-pausing** â€” if Penny detects an anomaly she pauses herself and waits for your confirmation
- **No third-party trust required** â€” your position lives in Aave smart contracts, not ours

## Stack

| Layer | Technology |
|---|---|
| Chain | Celo mainnet |
| Yield | Aave V3 (USDC, USDT, USDm) |
| Agent | TypeScript, autonomous position manager |
| Smart contracts | On-chain allowance pattern |

## License

MIT