import { CHAIN_ID } from "./chains.js";

type Address = string;

const PROTOCOL_ADDRESSES: Record<number, Record<string, Address>> = {
  [CHAIN_ID]: {
    aavePool:      "0x3E59A31363E2ad014BcF4A6F64Bf5c56e8F2AC8D",
    mentoExchange: "0x7D4A3741eCdB83e22e8aff3A1D28e1Be2a6f8A89",
    uniswapRouter: "0x5615CDAb10dc425a742d643d949a7F474C01abc4",
  },
};

export function getProtocolAddress(name: string): Address {
  const addr = PROTOCOL_ADDRESSES[CHAIN_ID]?.[name];
  if (!addr) throw new Error("Unknown protocol: " + name);
  return addr;
}
