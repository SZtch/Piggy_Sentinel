import type { Address } from "viem";

const PROTOCOL_ADDRESSES: Record<number, Record<string, Address>> = {
  42220: {
    mentoBroker: "0x777A8255cA72412f0d706dc03C9D1987306B4CaD",
    aaveV3Pool:  "0x794a61358D6845594F94dc1DB02A252b5b4814aD",
  },
  44787: {
    mentoBroker: "0x777A8255cA72412f0d706dc03C9D1987306B4CaD",
    aaveV3Pool:  "0xB09C16F559de0C6A0BdA7dC9b05B8589f7EC5d60",
  },
};

export function getProtocolAddress(chainId: number, name: string): Address {
  const addr = PROTOCOL_ADDRESSES[chainId]?.[name];
  if (!addr) throw new Error("Unknown protocol: " + name + " on chain " + chainId);
  return addr;
}
