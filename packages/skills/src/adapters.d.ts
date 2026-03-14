declare module '@piggy/adapters' {
  export const aave: {
    getATokenBalance(address: `0x${string}`): Promise<bigint>;
    getCurrentApy(): Promise<number>;
  };
}
