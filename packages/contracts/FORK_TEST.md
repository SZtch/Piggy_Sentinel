# 🧪 Fork Test — PiggySentinel

Test full flow PiggySentinel di fork Celo Mainnet lokal.
**Tidak keluar uang.** Semua token gratis dari `deal()`.

---

## Yang Ditest

| # | Test | Yang Dicek |
|---|---|---|
| 1 | `test_1_UserDeposit` | User deposit USDC, posisi terdaftar |
| 2 | `test_2_AgentAaveSupply` | aToken masuk SentinelExecutor (bukan userWallet) |
| 3 | `test_3_AgentMentoSwap` | Swap USDm → USDC via Mento berhasil |
| 4 | `test_4_RebalanceGate` | Max 1x rebalance per 24 jam |
| 5 | `test_5_AgentAaveWithdraw` | Agent tarik dari Aave, dana ke userWallet |
| 6 | `test_6_UserWithdraw` | User withdraw semua, posisi terhapus |
| 7 | `test_7_CircuitBreaker` | Pause blokir agent, user tetap bisa withdraw |
| 8 | `test_8_SpendLimit` | Agent tidak bisa melebihi spend limit |
| 9 | `test_9_ResetSpendEpoch` | Reset epoch, agent bisa jalan lagi |

---

## Cara Install

```bash
# Install Foundry (kalau belum)
curl -L https://foundry.paradigm.xyz | bash
foundryup

# Masuk ke folder contracts
cd packages/contracts

# Install dependencies
forge install foundry-rs/forge-std --no-commit
```

---

## Cara Jalankan

### Opsi A — Langsung (paling simpel)

```bash
cd packages/contracts

forge test --match-path test/ForkFullFlow.t.sol \
  --fork-url https://forno.celo.org \
  -vvv
```

### Opsi B — Pakai Anvil (lebih cepat untuk banyak test)

```bash
# Terminal 1: jalankan fork
cd packages/contracts
chmod +x script/fork.sh
./script/fork.sh

# Terminal 2: jalankan test
cd packages/contracts
forge test --match-path test/ForkFullFlow.t.sol \
  --fork-url http://localhost:8545 \
  -vvv
```

---

## Contoh Output Sukses

```
=== Setup selesai ===
SentinelExecutor : 0x...
User USDC        : 1000 USDC
User USDm        : 1000 USDm

=== Test 1: User Deposit ===
Principal deposited: 100 USDC
PASS: Deposit berhasil

=== Test 2: Agent Supply ke Aave ===
aUSDC sebelum: 0
aUSDC sesudah: 49999832
aToken diterima: 49999832
PASS: aToken masuk ke SentinelExecutor, bukan userWallet

=== Test 3: Agent Mento Swap (USDm → USDC) ===
USDm di user sebelum: 1000
USDC di user sebelum: 900
USDC di user sesudah: 909
PASS: Mento swap berhasil

...

[PASS] test_1_UserDeposit()
[PASS] test_2_AgentAaveSupply()
[PASS] test_3_AgentMentoSwap()
[PASS] test_4_RebalanceGate()
[PASS] test_5_AgentAaveWithdraw()
[PASS] test_6_UserWithdraw()
[PASS] test_7_CircuitBreaker()
[PASS] test_8_SpendLimit()
[PASS] test_9_ResetSpendEpoch()
```

---

## Troubleshooting

**Error: "aToken address salah"**
Update address `A_USDC`, `A_USDT`, `A_USDM` di `ForkFullFlow.t.sol`:
```
Cek di: https://app.aave.com/markets/?marketName=proto_celo_v3
```

**Error: "forge-std not found"**
```bash
forge install foundry-rs/forge-std --no-commit
```

**Error: "RPC timeout"**
Pakai RPC yang lebih cepat:
```bash
--fork-url https://celo-mainnet.infura.io/v3/YOUR_KEY
```
