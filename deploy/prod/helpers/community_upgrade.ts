import {HardhatRuntimeEnvironment} from "hardhat/types";
import {DeployFunction} from "hardhat-deploy/types";
import {SignerWithAddress} from "@nomiclabs/hardhat-ethers/signers";
import {deployments, ethers} from "hardhat";

const {deploy} = deployments;
let deployer: SignerWithAddress;

let implementationAddress: string;
let contractName: string = 'TreasuryImplementation';

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const accounts: SignerWithAddress[] = await ethers.getSigners();
  deployer = accounts[0];

  console.log(`Deploying new ${contractName} contract`);

  await new Promise((resolve) => setTimeout(resolve, 6000));
  implementationAddress = (
    await deploy(contractName, {
      from: deployer.address,
      args: [],
      log: true,
    })
  ).address;

  console.log(`${contractName} address: ${implementationAddress}`);
}

export default func;
func.tags = ["Deploy_implementation_prod"];
