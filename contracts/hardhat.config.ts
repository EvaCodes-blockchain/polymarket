import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";

const MNEMONIC =
  process.env["GANACHE_MNEMONIC"] ??
  "justify social prediction market mvp test test test test test test junk";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "cancun",
    },
  },
  networks: {
    hardhat: {
      chainId: 1337,
    },
    ganache: {
      url: process.env["RPC_URL"] ?? "http://127.0.0.1:8545",
      chainId: 1337,
      accounts: {
        mnemonic: MNEMONIC,
        count: 10,
      },
    },
    // Circle Arc testnet — chain 5042002, gas paid in USDC. RPC + mnemonic come
    // from env so the same deploy script targets Arc with no code change.
    arc: {
      url: process.env["RPC_URL"] ?? "https://rpc.testnet.arc.network",
      chainId: Number(process.env["CHAIN_ID"] ?? 5042002),
      accounts: {
        mnemonic: MNEMONIC,
        count: 10,
      },
    },
  },
  paths: {
    sources: "./src",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
