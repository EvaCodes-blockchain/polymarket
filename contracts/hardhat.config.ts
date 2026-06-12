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
      // Arc's public RPC rejects hardhat's auto eth_estimateGas on txs that do
      // nested CREATE (MarketFactory.createMarket deploys 2 contracts), even
      // though the tx executes fine. Pin an explicit gas limit so hardhat skips
      // estimation. 8M comfortably covers createMarket (~1.3M observed).
      gas: 8_000_000,
      gasPrice: 25_000_000_000, // ~25 gwei; Arc testnet gas price ~20 gwei
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
