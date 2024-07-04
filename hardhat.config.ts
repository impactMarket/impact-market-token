import { task } from "hardhat/config";
import "solidity-coverage";
import "hardhat-docgen";
// import "@nomiclabs/hardhat-waffle";
import "hardhat-deploy";
import "@nomiclabs/hardhat-ethers";
// import '@openzeppelin/hardhat-upgrades'; //conflict with @nomicfoundation/hardhat-verify. must comment one of them
import "@nomicfoundation/hardhat-verify";

task("accounts", "Prints the list of accounts", async (args, hre) => {
  const accounts = await hre.ethers.getSigners();

  for (const account of accounts) {
    console.log(await account.address);
  }
});

function getMnemonic(network:string) : string {
  require("dotenv").config({ path: `.env.${network}` });
  return process.env.MNEMONIC || '';
}

function getPrivateKey(network:string) : string {
  require("dotenv").config({ path: `.env.${network}` });
  return process.env.PRIVATE_KEY || '0000000000000000000000000000000000000000000000000000000000000001';
}

export default {
  networks: {
    hardhat: {
      hardfork: "istanbul",
      allowUnlimitedContractSize: true,
      timeout: 100000,
      gasPrice: "auto",
      gas: 13000000,
      // forking: {
      //   chainId: 42220,
      //   url: "https://forno.celo.org"
      // },
      forking: {
        chainId: 84532,
        url: "https://sepolia.base.org",
      },
    },
    alfajores: {
      chainId: 44787,
      url: "https://alfajores-forno.celo-testnet.org",
      hardfork: "istanbul",
      accounts: [getPrivateKey("alfajores")],
      allowUnlimitedContractSize: true,
      gas: "auto",
      gasPrice: "auto",
      blockGasLimit: 13000000,
    },
    mainnet: {
      chainId: 42220,
      url: "https://forno.celo.org",
      hardfork: "istanbul",
      accounts: [getPrivateKey("mainnet")],
      allowUnlimitedContractSize: true,
      gasPrice: "auto",
      gas: "auto",
      blockGasLimit: 13000000,
    },
    baseSepolia: {
      url: 'https://sepolia.base.org',
      accounts:
        [getPrivateKey("mainnet")]
    },
  },
  solidity: {
    compilers: [
      {
        version: "0.8.4",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      },
      {
        version: "0.6.12",
        settings: {},
      },
      {
        version: "0.7.6",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200
          }
        }
      }
    ],
  },
  namedAccounts: {
    deployer: {
      default: 0
    }
  },
  docgen: {
    path: './docs',
    clear: true,
    runOnCompile: true,
  },
  sourcify: {
    enabled: true
  },
  etherscan: {
    apiKey: {
      mainnet: "C9E1APEXRU2GT61PDAR4CYMHJZ1E6K5P28",
    },
    customChains: [
      {
        network: "mainnet",
        chainId: 42220,
        urls: {
          apiURL: "https://api.celoscan.io/api",
          browserURL: "https://celoscan.io"
        }
      },
      {
        network: "alfajores",
        chainId: 44787,
        urls: {
          apiURL: "https://api-alfajores.celoscan.io/api",
          browserURL: "https://alfajores.celoscan.io",
        },
      },
    ]
  },
};
